import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listPaymentExceptions, PaymentReviewError, refundPaymentException } from '@/lib/payment-exceptions';
import { acceptPaymentException } from '@/lib/order-fulfillment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reconciliation for payments Cashfree confirmed but that could not become an order.
 * Admin only: refunds move money.
 */
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
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
 * Resolves one exception:
 * - action "refund" (default): requests or retries the refund. Uses the same refund ID every
 *   time, so repeating this cannot create a second refund.
 * - action "accept": accepts a late / no-longer-served payment as a normal order.
 * Both are transitions of the same exception document, so a payment is never both.
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const { orderId, action = 'refund' } = await req.json().catch(() => ({}));
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    if (action === 'accept') {
      const result = await acceptPaymentException(orderId, user.id);
      return NextResponse.json({ success: true, refundState: 'ORDER_ACCEPTED', ...result });
    }
    if (action !== 'refund') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const result = await refundPaymentException(orderId, { manual: true, actorId: user.id });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof PaymentReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (String(error?.message || '').includes('not found')) {
      return NextResponse.json({ error: 'Payment exception not found' }, { status: 404 });
    }
    console.error('Error resolving payment exception:', error);
    return NextResponse.json({ error: 'Failed to resolve payment exception' }, { status: 500 });
  }
}
