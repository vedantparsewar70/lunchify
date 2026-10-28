import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listPaymentExceptions, refundPaymentException } from '@/lib/payment-exceptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reconciliation for payments Cashfree confirmed but that could not become an order.
 * Admin only: refunds move money.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ exceptions: await listPaymentExceptions() });
  } catch (error) {
    console.error('Error listing payment exceptions:', error);
    return NextResponse.json({ error: 'Failed to list payment exceptions' }, { status: 500 });
  }
}

/**
 * Requests (or retries) the refund for one exception. Uses the same refund ID every time,
 * so repeating this cannot create a second refund.
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    const result = await refundPaymentException(orderId, { manual: true });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (String(error?.message || '').includes('not found')) {
      return NextResponse.json({ error: 'Payment exception not found' }, { status: 404 });
    }
    console.error('Error refunding payment exception:', error);
    return NextResponse.json({ error: 'Failed to request refund' }, { status: 500 });
  }
}
