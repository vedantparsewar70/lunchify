import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { isDeadlinePassed } from '@/lib/utils';
import { CartItem, PaymentMethod } from '@/types';
import { evaluateAllergyConflict, getSystemSetting } from '@/lib/allergy';
import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cleanDoc, generateId } from '@/lib/firestore-db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { createCashfreeOrder, getCashfreeOrder } from '@/lib/cashfree';
import { BUSINESS_CONFIG } from '@/lib/business-config';
import { savePendingParentOrder, fulfillParentOrder } from '@/lib/order-fulfillment';
import { validateCartAvailability } from '@/lib/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const take = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;

    const orders = await prisma.order.findMany({
      where: {
        parentId: user.parentId,
        paymentStatus: 'PAID', // Strictly exclude incomplete or failed order attempts
      },
      take,
      include: {
        items: {
          include: {
            student: true,
            meal: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedOrders = orders.map((order) => ({
      id: order.id,
      parentId: order.parentId,
      totalAmount: order.totalAmount,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      notes: order.notes,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : new Date(order.createdAt).toISOString(),
      items: (order.items || []).map((item) => ({
        id: item.id,
        studentId: item.studentId,
        studentName: item.student?.name || 'Student',
        studentGrade: item.student?.grade || '',
        studentDivision: item.student?.division || '',
        studentRollNo: item.student?.rollNo || '',
        mealId: item.mealId,
        mealName: item.meal?.name || 'Meal',
        mealCategory: item.meal?.category || 'General',
        mealImage: item.meal?.imageUrl || null,
        isVegetarian: Boolean(item.meal?.isVegetarian),
        date: item.date,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        hasAllergyAlert: Boolean(item.hasAllergyAlert),
        conflictAllergens: item.conflictAllergens || null,
      })),
      payments: (order.payments || []).map((p) => ({
        id: p.id,
        orderId: p.orderId,
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        status: p.status,
        transactionRef: p.transactionRef,
        upiId: p.upiId,
        cardLastFour: p.cardLastFour,
        bankName: p.bankName,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date(p.createdAt).toISOString(),
      })),
    }));

    return NextResponse.json({ orders: formattedOrders });
  } catch (error) {
    console.error('Error fetching parent orders:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let lockAcquired = false;
  let requestKey: string | undefined = undefined;
  let lockToken: string | undefined = undefined;
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate Limiting: 30 checkout submissions per minute per parent
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`order_${user.parentId}_${clientIp}`, {
      windowMs: 60000,
      maxRequests: 30,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many order requests. Please wait a moment before trying again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateLimit.resetMs / 1000)) },
        }
      );
    }

    const body = await req.json();
    const {
      cartItems,
      paymentMethod = 'UPI',
      upiId,
      cardLastFour,
      bankName,
      notes,
      idempotencyKey,
    }: {
      cartItems: CartItem[];
      paymentMethod: PaymentMethod;
      upiId?: string;
      cardLastFour?: string;
      bankName?: string;
      notes?: string;
      idempotencyKey?: string;
    } = body;

    requestKey = idempotencyKey;

    // Check for duplicate submission using idempotency key if provided
    if (idempotencyKey) {
      const existingOrder = await prisma.order.findUnique({
        where: { id: idempotencyKey },
        include: {
          items: {
            include: {
              student: true,
              meal: true,
            },
          },
          payments: true,
        },
      });

      if (existingOrder) {
        return NextResponse.json({
          success: true,
          orderId: existingOrder.id,
          totalAmount: existingOrder.totalAmount,
          order: existingOrder,
          isDuplicateSubmission: true,
        });
      }

      // Check for pending checkout session to prevent duplicate Cashfree payment sessions
      const pendingSnap = await db.collection('pending_orders').doc(idempotencyKey).get();
      if (pendingSnap.exists) {
        const pendingData = pendingSnap.data() as any;
        return NextResponse.json({
          success: true,
          orderId: idempotencyKey,
          paymentSessionId: pendingData?.paymentSessionId || null,
          cfOrderId: pendingData?.cashfreeOrderId || null,
          isCashfree: Boolean(pendingData?.paymentSessionId),
          totalAmount: pendingData?.totalAmount,
          isDuplicateSubmission: true,
        });
      }
    }

    // Atomic Concurrency Lock: Prevent simultaneous parallel checkouts from creating duplicate sessions
    if (idempotencyKey) {
      const lockRef = db.collection('idempotency_locks').doc(idempotencyKey);
      lockToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const nowMs = Date.now();
      const LOCK_TTL_MS = 30000;

      try {
        await lockRef.create({
          id: idempotencyKey,
          parentId: user.parentId,
          createdAt: new Date().toISOString(),
          createdAtMs: nowMs,
          status: 'PROCESSING',
          lockToken,
        });
        lockAcquired = true;
      } catch (lockErr: any) {
        // Code 6 is ALREADY_EXISTS: A concurrent request is already in-flight for this exact key
        if (lockErr.code === 6 || lockErr.message?.includes('ALREADY_EXISTS') || lockErr.message?.includes('already exists')) {
          // Check if existing lock is stale (e.g. prior crashed request)
          const existingLockSnap = await lockRef.get();
          if (existingLockSnap.exists) {
            const data = existingLockSnap.data() as any;
            const lockAge = nowMs - (data?.createdAtMs || new Date(data?.createdAt || 0).getTime() || 0);
            if (lockAge > LOCK_TTL_MS) {
              await db.runTransaction(async (t) => {
                const freshSnap = await t.get(lockRef);
                if (freshSnap.exists) {
                  const freshData = freshSnap.data() as any;
                  const freshAge = Date.now() - (freshData?.createdAtMs || new Date(freshData?.createdAt || 0).getTime() || 0);
                  if (freshAge > LOCK_TTL_MS) {
                    t.set(lockRef, {
                      id: idempotencyKey,
                      parentId: user.parentId,
                      createdAt: new Date().toISOString(),
                      createdAtMs: Date.now(),
                      status: 'PROCESSING',
                      lockToken,
                    });
                    lockAcquired = true;
                  }
                }
              });
            }
          }

          if (!lockAcquired) {
            for (let attempt = 0; attempt < 15; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 200));

              // Check if order was completed and confirmed
              const readyOrder = await prisma.order.findUnique({
                where: { id: idempotencyKey },
                include: { items: { include: { student: true, meal: true } }, payments: true },
              });
              if (readyOrder) {
                return NextResponse.json({
                  success: true,
                  orderId: readyOrder.id,
                  totalAmount: readyOrder.totalAmount,
                  order: readyOrder,
                  isDuplicateSubmission: true,
                });
              }

              // Check if pending checkout session is saved
              const readyPending = await db.collection('pending_orders').doc(idempotencyKey).get();
              if (readyPending.exists) {
                const pendingData = readyPending.data() as any;
                return NextResponse.json({
                  success: true,
                  orderId: idempotencyKey,
                  paymentSessionId: pendingData?.paymentSessionId || null,
                  cfOrderId: pendingData?.cashfreeOrderId || null,
                  isCashfree: Boolean(pendingData?.paymentSessionId),
                  totalAmount: pendingData?.totalAmount,
                  isDuplicateSubmission: true,
                });
              }

              // Check if lock was released by earlier request (e.g. error or validation failure)
              const checkLock = await lockRef.get();
              if (!checkLock.exists) {
                try {
                  await lockRef.create({
                    id: idempotencyKey,
                    parentId: user.parentId,
                    createdAt: new Date().toISOString(),
                    createdAtMs: Date.now(),
                    status: 'PROCESSING',
                    lockToken,
                  });
                  lockAcquired = true;
                  break;
                } catch {
                  // Another concurrent request acquired it, keep waiting
                }
              }
            }

            if (!lockAcquired) {
              return NextResponse.json(
                { error: 'An order checkout is already in progress for this request. Please wait a moment.' },
                { status: 409 }
              );
            }
          }
        } else {
          throw lockErr;
        }
      }
    }

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // Check parent record
    const parentRecord = await prisma.parent.findUnique({
      where: { id: user.parentId },
    });
    if (!parentRecord) {
      return NextResponse.json({ error: 'Parent record not found' }, { status: 404 });
    }

    // Verify all students belong to this parent and load their allergies in 1 parallel query
    const parentStudents = await prisma.student.findMany({
      where: { parentId: user.parentId, isActive: true },
      include: {
        studentAllergies: { include: { allergy: true } },
      },
    });
    const parentStudentsMap = new Map(parentStudents.map((s: any) => [s.id, s]));

    for (const item of cartItems) {
      if (!parentStudentsMap.has(item.studentId)) {
        return NextResponse.json(
          { error: `Unauthorized child selection for student ${item.studentName}` },
          { status: 403 }
        );
      }
    }

    // Batch-fetch all meals from authoritative database to verify prices and allergens
    const mealIds = Array.from(new Set(cartItems.map((it) => it.mealId)));
    const meals = await prisma.meal.findMany({
      where: { id: { in: mealIds } },
      include: {
        mealAllergens: { include: { allergen: true } },
      },
    });
    const mealsMap = new Map(meals.map((m: any) => [m.id, m]));

    // Authoritative Server-side Menu Availability Validation (Single Source of Truth)
    const cartItemsWithCategory = cartItems.map((it) => {
      const student = parentStudentsMap.get(it.studentId);
      const studentCategory =
        student?.studentCategory ||
        (student?.grade?.toLowerCase().includes('nursery') ||
        student?.grade?.toLowerCase().includes('kg')
          ? 'Pre-primary'
          : parseInt(student?.grade || '1', 10) <= 5
          ? 'Primary'
          : 'Secondary');
      return {
        ...it,
        studentCategory,
      };
    });
    const availabilityResult = await validateCartAvailability(cartItemsWithCategory);
    if (!availabilityResult.valid && availabilityResult.firstUnavailableItem) {
      const unavail = availabilityResult.firstUnavailableItem;
      return NextResponse.json(
        {
          error: availabilityResult.errorMessage || `Meal "${unavail.mealName}" is not available for ${unavail.date}.`,
          unavailableItem: {
            mealId: unavail.mealId,
            mealName: unavail.mealName,
            date: unavail.date,
            reason: unavail.reason,
          },
        },
        { status: 400 }
      );
    }

    // Authoritative Server-side Price & Allergy Evaluation
    let totalAmount = 0;
    const evaluatedCartItems = cartItems.map((item) => {
      const meal = mealsMap.get(item.mealId);
      if (!meal) {
        throw new Error(`Meal not found: ${item.mealName || item.mealId}`);
      }

      const serverUnitPrice = Number(meal.price || 0);
      const itemQuantity = Math.max(1, parseInt(String(item.quantity), 10) || 1);
      totalAmount += serverUnitPrice * itemQuantity;

      // Extract student allergies
      const student = parentStudentsMap.get(item.studentId);
      const studentAllergiesList: string[] = [];
      if (student?.studentAllergies) {
        student.studentAllergies.forEach((sa: any) => {
          if (sa.allergy?.name) studentAllergiesList.push(sa.allergy.name);
          if (sa.customNote) studentAllergiesList.push(sa.customNote);
        });
      }
      if (student?.allergies) {
        student.allergies.split(/[,;]/).forEach((p: string) => {
          const t = p.trim();
          if (t && !studentAllergiesList.includes(t)) studentAllergiesList.push(t);
        });
      }

      // Extract meal allergens
      const mealAllergensList = (meal.mealAllergens || []).map((ma: any) => ma.allergen?.name).filter(Boolean);
      if (meal.allergens && mealAllergensList.length === 0) {
        meal.allergens.split(/[,;]/).forEach((p: string) => {
          const t = p.trim();
          if (t && !mealAllergensList.includes(t)) mealAllergensList.push(t);
        });
      }

      const allergyResult = evaluateAllergyConflict(studentAllergiesList, mealAllergensList, student?.name, meal.name);

      return {
        ...item,
        quantity: itemQuantity,
        mealPrice: serverUnitPrice,
        mealName: meal.name,
        mealCategory: meal.category,
        isVegetarian: meal.isVegetarian,
        hasAllergyAlert: allergyResult.hasConflict,
        conflictAllergens: allergyResult.matchingAllergens.join(', ') || null,
      };
    });

    // Check school allergy policy
    const allowAllergySetting = await getSystemSetting('ALLOW_ALLERGY_ORDERS', 'true');
    if (allowAllergySetting !== 'true') {
      const conflictingItem = evaluatedCartItems.find((it) => it.hasAllergyAlert);
      if (conflictingItem) {
        return NextResponse.json(
          {
            error: `Meal "${conflictingItem.mealName}" contains allergen (${conflictingItem.conflictAllergens}) conflicting with ${conflictingItem.studentName}'s profile. Ordering meals with allergy warnings is currently restricted by school policy.`,
          },
          { status: 400 }
        );
      }
    }

    // Validate payment credentials
    if (paymentMethod === 'UPI' && upiId && !upiId.includes('@')) {
      return NextResponse.json(
        { error: 'Please enter a valid UPI ID format (e.g. mobile@upi or username@okbank)' },
        { status: 400 }
      );
    }

    const validMethods: PaymentMethod[] = ['UPI', 'CARD', 'NET_BANKING'];
    if (!validMethods.includes(paymentMethod)) {
      return NextResponse.json(
        { error: 'Invalid payment method. Please pay securely using UPI, Card, or Net Banking.' },
        { status: 400 }
      );
    }

    // Generate collision-resistant unique identifiers
    const randomSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const orderId = idempotencyKey || `ORD-${randomSuffix}`;
    const paymentId = `PAY-${randomSuffix}`;
    const txnRef =
      paymentMethod === 'UPI'
        ? `UPI-${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`
        : paymentMethod === 'CARD'
        ? `CARD-${Date.now().toString().slice(-8)}`
        : `NETB-${Date.now().toString().slice(-8)}`;

    const now = new Date().toISOString();

    // Determine host for Cashfree return and webhook notifications
    const proto = req.headers.get('x-forwarded-proto') || (req.url.startsWith('https://') ? 'https' : 'http');
    const host = req.headers.get('host') || 'localhost:3000';
    const originUrl = `${proto}://${host}`;

    const isCashfreeEnabled = Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
    let cfSession: any = null;

    const hasLockOwnership = async (): Promise<boolean> => {
      if (!idempotencyKey || !lockToken) return true;
      try {
        const currentLockSnap = await db.collection('idempotency_locks').doc(idempotencyKey).get();
        return currentLockSnap.exists && currentLockSnap.data()?.lockToken === lockToken;
      } catch {
        return false;
      }
    };

    // Pre-gateway Lock Ownership Check: abort if another request reclaimed our expired lock
    if (idempotencyKey && lockToken) {
      const isOwner = await hasLockOwnership();
      if (!isOwner) {
        const existingOrder = await prisma.order.findUnique({
          where: { id: idempotencyKey },
          include: { items: { include: { student: true, meal: true } }, payments: true },
        });
        if (existingOrder) {
          return NextResponse.json({
            success: true,
            orderId: existingOrder.id,
            totalAmount: existingOrder.totalAmount,
            order: existingOrder,
            isDuplicateSubmission: true,
          });
        }
        const existingPending = await db.collection('pending_orders').doc(idempotencyKey).get();
        if (existingPending.exists) {
          const pendingData = existingPending.data() as any;
          return NextResponse.json({
            success: true,
            orderId: idempotencyKey,
            paymentSessionId: pendingData?.paymentSessionId || null,
            cfOrderId: pendingData?.cashfreeOrderId || null,
            isCashfree: Boolean(pendingData?.paymentSessionId),
            totalAmount: pendingData?.totalAmount,
            isDuplicateSubmission: true,
          });
        }
        return NextResponse.json(
          { error: 'Checkout session lock expired and was reclaimed by a concurrent request. Please retry.' },
          { status: 409 }
        );
      }
    }

    if (isCashfreeEnabled) {
      try {
        cfSession = await createCashfreeOrder({
          orderId,
          orderAmount: totalAmount,
          customer: {
            customerId: parentRecord.id,
            customerName: user.name || 'Parent',
            customerEmail: user.email || 'parent@schoolbite.in',
            customerPhone: user.phone || BUSINESS_CONFIG.supportPhone.replace(/\D/g, ''),
          },
          returnUrl: `${originUrl}/parent/confirmation/${orderId}?order_id={order_id}`,
          notifyUrl: `${originUrl}/api/webhooks/cashfree`,
          orderNote: `SchoolBite Order - ${evaluatedCartItems.length} meals`,
        });
      } catch (cfErr: any) {
        console.error('Failed to create Cashfree payment session:', cfErr);
        if (cfErr.message?.includes('already present') || cfErr.message?.includes('already exists')) {
          try {
            const existingCf = await getCashfreeOrder(orderId);
            if (existingCf) {
              cfSession = {
                cfOrderId: String(existingCf.cf_order_id || ''),
                orderId: existingCf.order_id,
                orderStatus: existingCf.order_status,
                paymentSessionId: existingCf.payment_session_id,
                orderAmount: Number(existingCf.order_amount),
                orderCurrency: existingCf.order_currency || 'INR',
              };
            }
          } catch (getErr) {
            console.error('Failed to retrieve existing Cashfree session:', getErr);
          }
        }

        if (!cfSession) {
          return NextResponse.json(
            { error: `Payment gateway error: ${cfErr.message || 'Failed to initialize payment session'}` },
            { status: 500 }
          );
        }
      }
    }

    // Pre-write Lock Ownership Check: abort before writing if another request reclaimed our expired lock
    if (idempotencyKey && lockToken) {
      const stillOwner = await hasLockOwnership();
      if (!stillOwner) {
        const existingOrder = await prisma.order.findUnique({
          where: { id: idempotencyKey },
          include: { items: { include: { student: true, meal: true } }, payments: true },
        });
        if (existingOrder) {
          return NextResponse.json({
            success: true,
            orderId: existingOrder.id,
            totalAmount: existingOrder.totalAmount,
            order: existingOrder,
            isDuplicateSubmission: true,
          });
        }
        const existingPending = await db.collection('pending_orders').doc(idempotencyKey).get();
        if (existingPending.exists) {
          const pendingData = existingPending.data() as any;
          return NextResponse.json({
            success: true,
            orderId: idempotencyKey,
            paymentSessionId: pendingData?.paymentSessionId || null,
            cfOrderId: pendingData?.cashfreeOrderId || null,
            isCashfree: Boolean(pendingData?.paymentSessionId),
            totalAmount: pendingData?.totalAmount,
            isDuplicateSubmission: true,
          });
        }
        return NextResponse.json(
          { error: 'Checkout session lock expired and was reclaimed by a concurrent request. Please retry.' },
          { status: 409 }
        );
      }
    }

    // If Cashfree Payment Gateway is enabled, save as pending checkout intent.
    // Strictly DO NOT create any record in 'orders', 'orderItems', or 'payments',
    // and DO NOT decrement portions until payment is verified as PAID!
    if (isCashfreeEnabled) {
      await savePendingParentOrder({
        id: orderId,
        parentId: parentRecord.id,
        totalAmount,
        paymentMethod,
        upiId: upiId || null,
        cardLastFour: cardLastFour || null,
        bankName: bankName || null,
        notes: notes || null,
        cartItems: evaluatedCartItems,
        cashfreeOrderId: cfSession?.cfOrderId || null,
        paymentSessionId: cfSession?.paymentSessionId || null,
        createdAt: now,
      });

      return NextResponse.json({
        success: true,
        orderId,
        paymentSessionId: cfSession?.paymentSessionId || null,
        cfOrderId: cfSession?.cfOrderId || null,
        isCashfree: true,
        totalAmount,
      });
    }

    // Direct fallback (when Cashfree is disabled for local mock testing):
    // Save pending and immediately fulfill as PAID
    await savePendingParentOrder({
      id: orderId,
      parentId: parentRecord.id,
      totalAmount,
      paymentMethod,
      upiId: upiId || null,
      cardLastFour: cardLastFour || null,
      bankName: bankName || null,
      notes: notes || null,
      cartItems: evaluatedCartItems,
      cashfreeOrderId: null,
      paymentSessionId: null,
      createdAt: now,
    });

    const fulfillRes = await fulfillParentOrder(orderId, {
      transactionRef: txnRef,
      paymentMethod,
      upiId: upiId || null,
      cardLastFour: cardLastFour || null,
      bankName: bankName || null,
      amount: totalAmount,
    });

    return NextResponse.json({
      success: true,
      orderId: fulfillRes.orderId,
      paymentSessionId: null,
      cfOrderId: null,
      isCashfree: false,
      paymentId,
      transactionRef: txnRef,
      totalAmount,
    });
  } catch (error: any) {
    console.error('Error placing order:', error);
    const userMessage = error?.message || 'Failed to process order';
    return NextResponse.json({ error: userMessage }, { status: 400 });
  } finally {
    if (lockAcquired && requestKey && lockToken) {
      try {
        const lockRef = db.collection('idempotency_locks').doc(requestKey);
        await db.runTransaction(async (t) => {
          const snap = await t.get(lockRef);
          if (snap.exists && snap.data()?.lockToken === lockToken) {
            t.delete(lockRef);
          }
        });
      } catch (releaseErr) {
        console.error('Failed to release idempotency lock safely:', releaseErr);
      }
    }
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        parentId: user.parentId,
      },
      include: {
        items: true,
        payments: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'Order is already cancelled' }, { status: 400 });
    }

    if (order.orderStatus === 'READY' || order.orderStatus === 'COLLECTED') {
      return NextResponse.json(
        { error: 'Cannot cancel order that has already been prepared or collected' },
        { status: 400 }
      );
    }

    // Check deadlines for each item in the order
    for (const item of order.items || []) {
      const menu = await prisma.menu.findUnique({
        where: {
          mealId_date: {
            mealId: item.mealId,
            date: item.date,
          },
        },
      });

      const deadline = menu?.orderingDeadline || '08:30';
      if (isDeadlinePassed(item.date, deadline)) {
        return NextResponse.json(
          {
            error: `Cannot cancel: Cancellation deadline (${deadline}) for meal date ${item.date} has passed.`,
          },
          { status: 400 }
        );
      }
    }

    const now = new Date().toISOString();

    // Atomic cancellation transaction: updates status and restores available stock
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('orders').doc(order.id);

      // 1. Mark order cancelled and refunded
      transaction.update(orderRef, {
        orderStatus: 'CANCELLED',
        paymentStatus: 'REFUNDED',
        updatedAt: now,
      });

      // 2. Restore available portion quantities for each menu item
      for (const item of order.items || []) {
        const menuRef = db.collection('menus').doc(`${item.mealId}_${item.date}`);
        transaction.update(menuRef, {
          availableQuantity: FieldValue.increment(Number(item.quantity)),
          updatedAt: now,
        });
      }
    });

    const refundDestination = 'your original payment source';

    return NextResponse.json({
      success: true,
      message: `Order ${orderId} cancelled successfully and ₹${order.totalAmount} refunded to ${refundDestination}.`,
    });
  } catch (error: any) {
    console.error('Error cancelling order:', error);
    return NextResponse.json({ error: error?.message || 'Failed to cancel order' }, { status: 500 });
  }
}
