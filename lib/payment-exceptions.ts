import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { cleanDoc } from './firestore-db';
import {
  cashfreeRefunds,
  paymentStatusForRefund,
  RefundClient,
  refundIdForOrder,
  requestRefund,
} from './order-cancellation';
import type { CashfreeRefund } from './cashfree';

/**
 * Payments that Cashfree confirmed but that could not become an order (meal sold out while
 * paying, or an amount mismatch). One document per checkout ID, written in the same transaction
 * that refuses fulfilment, so every such payment is traceable and can be refunded exactly once.
 */
export const PAYMENT_EXCEPTIONS = 'payment_exceptions';

/**
 * NOT_REQUESTED  sold-out payment, refund not yet requested (requested automatically)
 * MANUAL_REVIEW  an admin decides before any refund: paid after the cutoff, meal no longer served
 *                (holiday/disabled), or amount mismatch
 * ORDER_ACCEPTED an admin accepted the payment as an order (no refund; the order exists)
 * REFUND_PENDING refund requested, gateway has not confirmed it yet
 * REFUNDED       gateway confirmed the refund
 * REFUND_FAILED  request failed or gateway cancelled it; an admin can retry
 *
 * Only sold-out payments are refunded automatically (exactly once). Everything else waits for an
 * admin; accepting and refunding are mutually exclusive transitions out of MANUAL_REVIEW.
 */
export function isAutoRefundReason(reason: unknown): boolean {
  return reason === 'STOCK_UNAVAILABLE';
}

/** Reasons an admin may resolve by accepting the payment as a normal order. */
export function isAcceptableReason(reason: unknown): boolean {
  return reason === 'PAID_AFTER_CUTOFF' || reason === 'SERVICE_UNAVAILABLE';
}

export type ExceptionReason = 'STOCK_UNAVAILABLE' | 'PAID_AFTER_CUTOFF' | 'SERVICE_UNAVAILABLE' | 'AMOUNT_MISMATCH';

export type ExceptionRefundState =
  | 'NOT_REQUESTED'
  | 'MANUAL_REVIEW'
  | 'ORDER_ACCEPTED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REFUND_FAILED';

export class PaymentReviewError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'PaymentReviewError';
    this.status = status;
  }
}

export interface PaymentExceptionInput {
  orderId: string;
  orderType: 'PARENT' | 'TEACHER';
  ownerId: string | null;
  reason: ExceptionReason;
  detail: string;
  expectedAmount: number;
  payment: { amount: number; currency?: string; transactionRef?: string; cashfreeOrderId?: string | null };
  cashfreeOrderId?: string | null;
  items: any[];
  now: string;
}

/**
 * Transaction writes only: records the exception and closes the pending checkout so later
 * webhook/verify retries cannot fulfil it.
 */
export function recordPaymentException(
  transaction: Transaction,
  exceptionRef: DocumentReference,
  pendingRef: DocumentReference,
  input: PaymentExceptionInput
): void {
  transaction.set(
    exceptionRef,
    cleanDoc({
      id: input.orderId,
      orderId: input.orderId,
      orderType: input.orderType,
      ownerId: input.ownerId,
      reason: input.reason,
      detail: input.detail,
      expectedAmount: Number(input.expectedAmount) || 0,
      paidAmount: Number(input.payment.amount) || 0,
      currency: String(input.payment.currency || 'INR').toUpperCase(),
      transactionRef: input.payment.transactionRef || null,
      cashfreeOrderId: input.payment.cashfreeOrderId || input.cashfreeOrderId || null,
      // Identifiers and quantities only; no names or contact details.
      items: (input.items || []).map((item: any) =>
        cleanDoc({
          mealId: item.mealId,
          date: item.date || null,
          quantity: Number(item.quantity || 1),
          studentId: item.studentId || null,
          menuId: item.menuId || null,
        })
      ),
      refundId: refundIdForOrder(input.orderId),
      refundState: (isAutoRefundReason(input.reason) ? 'NOT_REQUESTED' : 'MANUAL_REVIEW') as ExceptionRefundState,
      createdAt: input.now,
      updatedAt: input.now,
    })
  );
  transaction.update(pendingRef, {
    status: 'PAYMENT_EXCEPTION',
    reviewReason: input.reason,
    paidAmount: Number(input.payment.amount) || 0,
    updatedAt: input.now,
  });
}

/** An attempt in flight longer than this is treated as abandoned (e.g. the process crashed). */
export const REFUND_ATTEMPT_LEASE_MS = 2 * 60 * 1000;

/**
 * A refund whose outcome was never recorded (crash after claiming), is unknown (timeout,
 * 429/5xx) or could not be looked up (e.g. 401). Safe to re-attempt after the lease: each
 * attempt looks the refund up and only creates it after a 404, with a fixed idempotency key.
 */
export function isAbandonedAttempt(exception: Record<string, any>, nowMs: number): boolean {
  if (exception.refundState !== 'REFUND_PENDING') return false;
  if (!['REQUESTED', 'UNKNOWN', 'LOOKUP_FAILED'].includes(exception.gatewayRefundStatus)) return false;
  const requestedAt = Date.parse(exception.refundRequestedAt || '');
  return !Number.isFinite(requestedAt) || nowMs - requestedAt > REFUND_ATTEMPT_LEASE_MS;
}

/** Exceptions an admin should look at: refund not done and not progressing on its own. */
export function needsAttention(exception: Record<string, any>, nowMs: number): boolean {
  const state = exception.refundState as ExceptionRefundState;
  if (state === 'REFUND_FAILED' || state === 'MANUAL_REVIEW') return true;
  const since = Date.parse(exception.refundRequestedAt || exception.createdAt || '');
  const stale = !Number.isFinite(since) || nowMs - since > 15 * 60 * 1000;
  if (state === 'NOT_REQUESTED') return stale;
  return state === 'REFUND_PENDING' && stale && isAbandonedAttempt(exception, nowMs);
}

export interface ExceptionRefundResult {
  orderId: string;
  refundState: ExceptionRefundState;
  refundAmount: number;
  requested: boolean;
}

/**
 * Refunds the payment behind an exception.
 * - automatic (default): only sold-out exceptions whose refund was never requested; repeated
 *   webhooks/verifies are no-ops once a refund has been requested.
 * - manual (admin): also retries failed/pending refunds and refunds amount-mismatch exceptions.
 * The refund_id is fixed per checkout, so concurrent or repeated calls cannot create a second refund.
 */
export async function refundPaymentException(
  orderId: string,
  options: { manual?: boolean; actorId?: string } = {},
  firestore: Firestore = db,
  refunds: RefundClient = cashfreeRefunds
): Promise<ExceptionRefundResult> {
  const ref = firestore.collection(PAYMENT_EXCEPTIONS).doc(orderId);
  const now = new Date().toISOString();

  const claim = await firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new Error(`Payment exception ${orderId} not found`);
    }
    const exception = snap.data() || {};
    const state = exception.refundState as ExceptionRefundState;
    const amount = Number(exception.paidAmount) || 0;

    // An accepted payment became a normal order: it is never refunded from here (cancelling the
    // order refunds it through the order's own refund flow).
    const claimable = options.manual
      ? state !== 'REFUNDED' && state !== 'ORDER_ACCEPTED'
      : isAutoRefundReason(exception.reason) && (state === 'NOT_REQUESTED' || isAbandonedAttempt(exception, Date.now()));
    if (!claimable || amount <= 0) {
      return { exception, amount, requested: false };
    }

    transaction.update(ref, {
      refundState: 'REFUND_PENDING',
      gatewayRefundStatus: 'REQUESTED',
      refundRequestedAt: now,
      updatedAt: now,
      ...(options.manual && state === 'MANUAL_REVIEW'
        ? { resolution: 'REFUNDED_BY_ADMIN', reviewedBy: options.actorId || null, reviewedAt: now }
        : {}),
    });
    return { exception, amount, requested: true };
  });

  if (!claim.requested) {
    return { orderId, refundState: claim.exception.refundState, refundAmount: claim.amount, requested: false };
  }

  const refundId = String(claim.exception.refundId || refundIdForOrder(orderId));
  const outcome = await requestRefund(claim.exception, orderId, refundId, claim.amount, refunds);
  const refundState = await recordExceptionRefundOutcome(orderId, refundId, outcome, firestore);
  return { orderId, refundState, refundAmount: claim.amount, requested: true };
}

/**
 * Stores a refund outcome on the exception. Ignores outcomes for a different refund and never
 * downgrades a confirmed refund.
 */
export async function recordExceptionRefundOutcome(
  orderId: string,
  refundId: string,
  outcome: { paymentStatus: string; refundStatus: string; cfRefundId?: string | null; error?: string | null },
  firestore: Firestore = db
): Promise<ExceptionRefundState> {
  const ref = firestore.collection(PAYMENT_EXCEPTIONS).doc(orderId);
  const now = new Date().toISOString();

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return 'NOT_REQUESTED';
    const current = snap.data() || {};
    if (current.refundId !== refundId || current.refundState === 'REFUNDED' || current.refundState === 'ORDER_ACCEPTED') {
      return current.refundState as ExceptionRefundState;
    }
    const refundState = outcome.paymentStatus as ExceptionRefundState;
    transaction.update(ref, {
      refundState,
      gatewayRefundStatus: outcome.refundStatus,
      cfRefundId: outcome.cfRefundId || current.cfRefundId || null,
      refundError: outcome.error || null,
      updatedAt: now,
    });
    return refundState;
  });
}

/** Applies a gateway-confirmed refund status (e.g. from a verified refund webhook) to an exception. */
export function applyExceptionRefundStatus(orderId: string, refund: CashfreeRefund, firestore: Firestore = db) {
  return recordExceptionRefundOutcome(
    orderId,
    refund.refundId,
    { paymentStatus: paymentStatusForRefund(refund.status), refundStatus: refund.status, cfRefundId: refund.cfRefundId },
    firestore
  );
}

export async function listPaymentExceptions(firestore: Firestore = db, limit = 200) {
  const snap = await firestore.collection(PAYMENT_EXCEPTIONS).get();
  const nowMs = Date.now();
  return snap.docs
    .map((d) => {
      const exception: Record<string, any> = d.data();
      return { ...exception, needsAttention: needsAttention(exception, nowMs) } as Record<string, any>;
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit);
}

/** What a parent sees for a payment that did not (yet) become an order. */
export function parentIssueState(refundState: unknown): 'PENDING_REVIEW' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED' | 'ORDER_ACCEPTED' {
  if (refundState === 'MANUAL_REVIEW') return 'PENDING_REVIEW';
  if (refundState === 'REFUNDED') return 'REFUNDED';
  if (refundState === 'REFUND_FAILED') return 'REFUND_FAILED';
  if (refundState === 'ORDER_ACCEPTED') return 'ORDER_ACCEPTED';
  return 'REFUND_PENDING';
}

/** A parent's own payment exceptions (accepted ones are listed as normal orders instead). */
export async function listOwnPaymentIssues(parentId: string, firestore: Firestore = db) {
  const snap = await firestore.collection(PAYMENT_EXCEPTIONS).where('ownerId', '==', parentId).get();
  return snap.docs
    .map((d) => d.data())
    .filter((e) => e.orderType === 'PARENT' && e.refundState !== 'ORDER_ACCEPTED')
    .map((e) => ({
      orderId: String(e.orderId),
      reason: e.reason,
      state: parentIssueState(e.refundState),
      paidAmount: Number(e.paidAmount) || 0,
      dates: Array.from(new Set((e.items || []).map((it: { date?: string | null }) => it.date).filter(Boolean))).sort(),
      createdAt: e.createdAt || null,
    }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
