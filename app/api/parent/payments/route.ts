import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getTodayString, APP_TIMEZONE } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const date = searchParams.get('date');

    const payments = await prisma.payment.findMany({
      where: {
        order: {
          parentId: user.parentId,
        },
        ...(status ? { status } : {}),
      },
      include: {
        order: {
          include: {
            items: {
              include: {
                student: true,
                meal: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // A payment record stays SUCCESS when its order is cancelled; show the refund state instead,
    // so refunded money is not counted as spent.
    const REFUND_STATES = ['REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'];
    const withRefundState = payments.map((p: any) => {
      const orderPayment = p.order?.paymentStatus;
      return p.status === 'SUCCESS' && REFUND_STATES.includes(orderPayment) ? { ...p, status: orderPayment } : p;
    });

    const filtered = withRefundState.filter((p: any) => {
      if (status && p.status !== status) return false;
      if (date) {
        const created = p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt);
        if (getTodayString(APP_TIMEZONE, created) !== date) return false;
      }
      return true;
    });

    return NextResponse.json({ payments: filtered });
  } catch (error) {
    console.error('Error fetching payments:', error);
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
  }
}
