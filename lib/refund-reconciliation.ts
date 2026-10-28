import type { CashfreeRefund } from './cashfree';

export type RefundCategory =
  | 'CONFIRMED_REFUND' // Cashfree reports successful refunds covering the order amount
  | 'REFUND_IN_PROGRESS' // Cashfree has a refund that is not yet successful
  | 'PARTIAL_REFUND' // successful refunds exist but total less than the order amount
  | 'MISSING_REFUND' // paid through Cashfree, cancelled, and Cashfree holds no refund
  | 'NO_GATEWAY_RECORD' // no Cashfree order on file (mock/legacy direct fallback): verify manually
  | 'LOOKUP_FAILED' // Cashfree could not be queried for this order: uncertain
  | 'NOT_CHECKED_LEGACY' // marked REFUNDED by pre-b11791b code without a refund ID; gateway not queried
  | 'NOT_CHECKED_TRACKED' // refund ID recorded by the current code; gateway not queried
  | 'NOT_PAID'; // cancelled before payment: nothing to refund

export interface CancelledOrderRecord {
  id: string;
  totalAmount?: number;
  paymentStatus?: string;
  cashfreeOrderId?: string | null;
  refundId?: string | null;
}

/**
 * Classifies a cancelled order. gateway is the list of Cashfree refunds for the order,
 * 'ERROR' if the lookup failed, or null when the gateway was not queried.
 */
export function classifyCancelledOrder(
  order: CancelledOrderRecord,
  gateway: CashfreeRefund[] | 'ERROR' | null
): RefundCategory {
  const paid = ['PAID', 'REFUNDED', 'REFUND_PENDING', 'REFUND_FAILED'].includes(String(order.paymentStatus));
  if (!paid) return 'NOT_PAID';

  if (gateway === null) {
    return order.refundId ? 'NOT_CHECKED_TRACKED' : 'NOT_CHECKED_LEGACY';
  }
  if (!order.cashfreeOrderId) return 'NO_GATEWAY_RECORD';
  if (gateway === 'ERROR') return 'LOOKUP_FAILED';

  const amount = Number(order.totalAmount) || 0;
  const refunded = gateway.filter((r) => r.status === 'SUCCESS').reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  if (refunded > 0 && refunded >= amount - 0.01) return 'CONFIRMED_REFUND';
  if (gateway.some((r) => ['PENDING', 'ONHOLD', 'PENDING_APPROVAL'].includes(r.status))) return 'REFUND_IN_PROGRESS';
  if (refunded > 0) return 'PARTIAL_REFUND';
  return 'MISSING_REFUND';
}
