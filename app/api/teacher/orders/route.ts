import { NextResponse } from 'next/server';
import {
  createCashfreeOrder,
  getAppBaseUrl,
  getCashfreeMode,
  isCashfreeConfigured,
  isMockPaymentAllowed,
  PaymentConfigError,
} from '@/lib/cashfree';
import { savePendingTeacherOrder } from '@/lib/order-fulfillment';
import { generateTeacherOrderId, resolveTeacherCart } from '@/lib/teacher-orders';
import { resolveCheckoutPhone } from '@/lib/phone';
import { getTodayString } from '@/lib/utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(`teacher_order_${clientIp}`, {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many order attempts. Please wait a minute and try again.' },
        { status: 429 }
      );
    }

    // DEF-02: Authentication and Role Authorization Guard
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required. Please log in as staff or faculty to place teacher orders.' },
        { status: 401 }
      );
    }

    if (user.role !== 'STAFF' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden: Teacher meal ordering is restricted to school staff and faculty. Parents must order through the parent portal.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { teacherName, teacherPhone, notes, items } = body;

    const cleanTeacherName = String(teacherName || user.name || '').trim();
    if (!cleanTeacherName) {
      return NextResponse.json({ error: 'Please enter your name to place the order' }, { status: 400 });
    }

    // DEF-01: Authoritative Server-Side Item Resolution & Price Calculation
    // Never trust client-submitted prices, item names, or categories.
    const cart = await resolveTeacherCart(items);
    if (!cart.ok) {
      return NextResponse.json({ error: cart.error }, { status: cart.status });
    }
    const { items: orderItems, totalAmount } = cart;

    const todayStr = getTodayString();
    const orderId = generateTeacherOrderId();

    // The payer's own mobile number is required by the payment gateway: the number typed at
    // checkout, otherwise the one saved on the staff account. Nothing is substituted or saved.
    const phoneCheck = resolveCheckoutPhone(teacherPhone, user.phone);
    if (!phoneCheck.ok) {
      return NextResponse.json({ error: phoneCheck.error, code: phoneCheck.code }, { status: 400 });
    }
    const phone = phoneCheck.phone;

    // Create Cashfree session
    let paymentSessionId = '';
    let cfOrderId = '';
    let cashfreeMode: string | null = null;

    if (isCashfreeConfigured()) {
      let appUrl: string;
      try {
        cashfreeMode = getCashfreeMode();
        appUrl = getAppBaseUrl();
      } catch (configErr) {
        if (configErr instanceof PaymentConfigError) {
          console.error('[Payment Config Error in Teacher Order]:', configErr.message);
          return NextResponse.json(
            { error: 'Online payment gateway is temporarily unavailable. Please try again later.' },
            { status: 503 }
          );
        }
        throw configErr;
      }

      try {
        const cfResponse = await createCashfreeOrder({
          orderId,
          orderAmount: totalAmount,
          customer: {
            customerId: `teacher_${user.id}`,
            customerName: cleanTeacherName,
            customerEmail: user.email || 'teacher@schoolbite.in',
            customerPhone: phone,
          },
          returnUrl: `${appUrl}/teacher/confirmation/${orderId}?cf_id={order_id}`,
          notifyUrl: `${appUrl}/api/webhooks/cashfree`,
          orderNote: `Teacher Meal Order - ${cleanTeacherName}`,
        });

        paymentSessionId = cfResponse.paymentSessionId;
        cfOrderId = cfResponse.cfOrderId;
      } catch (cfErr: any) {
        console.error('[Cashfree Error in Teacher Order]:', cfErr.message || cfErr);
        return NextResponse.json(
          { error: 'Payment gateway is currently unavailable. Please try again shortly.' },
          { status: 502 }
        );
      }
    } else if (isMockPaymentAllowed()) {
      // Non-production test session only (strictly kept in pending_teacher_orders)
      paymentSessionId = `mock_sess_${orderId}`;
      cfOrderId = `mock_cf_${orderId}`;
    } else {
      console.error('[Payment Gateway Error]: Cashfree credentials are not configured.');
      return NextResponse.json(
        { error: 'Online payment gateway is not configured.' },
        { status: 503 }
      );
    }

    const now = new Date().toISOString();
    // Strictly DO NOT create order in 'teacher_orders' until payment is verified as PAID!
    await savePendingTeacherOrder({
      id: orderId,
      orderType: 'TEACHER',
      userId: user.id,
      teacherName: cleanTeacherName,
      teacherPhone: phone,
      totalAmount,
      date: todayStr,
      paymentMethod: 'ONLINE',
      cashfreeOrderId: cfOrderId,
      paymentSessionId,
      notes: typeof notes === 'string' ? notes.trim() || null : null,
      items: orderItems,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      orderId,
      paymentSessionId,
      cashfreeMode,
      totalAmount,
    });
  } catch (error) {
    console.error('Error placing teacher order:', error);
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  }
}
