/**
 * READ-ONLY refund reconciliation report.
 *
 * Lists cancelled orders, open payment exceptions and legacy review checkouts, and (optionally)
 * compares cancelled orders with the refunds Cashfree actually holds.
 *
 * It never writes: Firestore is only read with .get(), and Cashfree is only queried with
 * GET /orders/{order_id}/refunds. Output contains order IDs, amounts and statuses only,
 * no names, emails or phone numbers.
 *
 * Usage (needs production credentials in a local, git-ignored env file):
 *   npx tsx --env-file=.env.production.local scripts/reconcile-refunds.ts
 *   npx tsx --env-file=.env.production.local scripts/reconcile-refunds.ts --check-cashfree
 *
 * --check-cashfree queries the Cashfree environment selected by CASHFREE_ENV. Orders paid in
 * the other environment (sandbox vs production) report LOOKUP_FAILED.
 */
import { db } from '../lib/firebase-admin';
import { getCashfreeMode, getCashfreeOrderRefunds, CashfreeRefund } from '../lib/cashfree';
import { classifyCancelledOrder, RefundCategory } from '../lib/refund-reconciliation';

const checkCashfree = process.argv.includes('--check-cashfree');

async function main() {
  if (checkCashfree) {
    // Outside production the code would default to sandbox; require an explicit choice here.
    if (!process.env.CASHFREE_ENV) {
      throw new Error('Set CASHFREE_ENV (TEST or PROD) to the environment the payments were made in.');
    }
    console.log(`Querying Cashfree ${getCashfreeMode()} (read-only GET /orders/{id}/refunds).`);
  }
  console.log(`Refund reconciliation (read-only)${checkCashfree ? ' with Cashfree lookups' : ''}\n`);

  const cancelled = await db.collection('orders').where('orderStatus', '==', 'CANCELLED').get();
  const counts = new Map<RefundCategory, number>();
  const rows: string[] = [];

  for (const doc of cancelled.docs) {
    const order = doc.data();
    let gateway: CashfreeRefund[] | 'ERROR' | null = null;
    if (checkCashfree && order.cashfreeOrderId) {
      gateway = await getCashfreeOrderRefunds(doc.id).catch(() => 'ERROR' as const);
    }
    const category = classifyCancelledOrder({ id: doc.id, ...order }, gateway);
    counts.set(category, (counts.get(category) || 0) + 1);
    rows.push(
      [
        doc.id,
        String(order.cancelledAt || order.updatedAt || '').slice(0, 10),
        `₹${Number(order.totalAmount) || 0}`,
        order.paymentStatus,
        order.refundId ? 'refundId' : 'no-refundId',
        order.cashfreeOrderId ? 'cashfree' : 'no-cashfree',
        category,
      ].join(' | ')
    );
  }

  console.log('Cancelled orders: id | date | amount | paymentStatus | refundId | gateway | category');
  rows.sort().forEach((r) => console.log(`  ${r}`));
  console.log('\nSummary:');
  for (const [category, n] of counts) console.log(`  ${category}: ${n}`);

  const exceptions = await db.collection('payment_exceptions').get();
  const open = exceptions.docs.map((d) => d.data()).filter((e) => e.refundState !== 'REFUNDED');
  console.log(`\nPayment exceptions not yet refunded: ${open.length}`);
  open.forEach((e) => console.log(`  ${e.orderId} | ${e.reason} | ₹${e.paidAmount} | ${e.refundState}`));

  // Checkouts flagged by b11791b before payment exceptions existed (paid, no order, no refund).
  const review = await db.collection('pending_orders').where('status', '==', 'NEEDS_REVIEW').get();
  console.log(`\nLegacy NEEDS_REVIEW checkouts (paid, no order): ${review.size}`);
  review.docs.forEach((d) => {
    const p = d.data();
    console.log(`  ${d.id} | ${p.reviewReason} | ₹${p.paidAmount ?? p.totalAmount}`);
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('Reconciliation failed:', err?.message || err);
    process.exit(1);
  }
);
