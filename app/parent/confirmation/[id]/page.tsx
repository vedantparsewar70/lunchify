'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import confetti from 'canvas-confetti';
import {
  CheckCircle2,
  ArrowRight,
  UtensilsCrossed,
  Calendar,
  CreditCard,
  FileText,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { formatINR, formatDateTimePretty, formatDatePretty } from '@/lib/utils';
import VegBadge from '@/components/VegBadge';
import { useCart } from '@/components/CartContext';

const CLEARED_ORDERS_STORAGE = 'sb_cart_cleared_orders';

/** True the first time this paid order is shown in this browser; also ends its checkout session. */
function firstPaidVisit(orderId: string): boolean {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(CLEARED_ORDERS_STORAGE) || '[]');
    if (seen.includes(orderId)) return false;
    localStorage.setItem(CLEARED_ORDERS_STORAGE, JSON.stringify([...seen, orderId].slice(-20)));
    sessionStorage.removeItem('sb_checkout_key');
  } catch {
    // storage unavailable: clear as before
  }
  return true;
}

export default function OrderConfirmationPage() {
  const params = useParams();
  const orderId = params?.id as string;
  const { clearCart } = useCart();

  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  // Payment state as reported by the server's verification with Cashfree:
  // PAID | PENDING (not confirmed yet) | NOT_PAID | EXCEPTION (paid, no order) | CANCELLED | UNKNOWN (could not check)
  const [state, setState] = useState<string>('UNKNOWN');
  const [message, setMessage] = useState('');
  // For EXCEPTION: PENDING_REVIEW | REFUND_PENDING | REFUNDED | REFUND_FAILED
  const [issueState, setIssueState] = useState('');
  const [checks, setChecks] = useState(0);

  const loadAndVerifyOrder = async () => {
    if (!orderId) return;
    setVerifying(true);
    try {
      let data: any = null;
      try {
        const res = await fetch('/api/parent/orders/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        data = await res.json().catch(() => null);
        if (!res.ok) data = { state: res.status === 404 ? 'NOT_FOUND' : 'UNKNOWN', message: data?.error };
      } catch {
        data = { state: 'UNKNOWN' };
      }

      const nextState = data?.state || 'UNKNOWN';
      setState(nextState);
      setMessage(data?.message || '');
      setIssueState(data?.issueState || '');

      if (nextState === 'PAID' || nextState === 'CANCELLED') {
        const res = await fetch(`/api/parent/orders?id=${encodeURIComponent(orderId)}`);
        if (res.ok) {
          const listing = await res.json();
          setOrder(listing.orders?.find((o: any) => o.id === orderId) || null);
        }
      }
      if (nextState === 'PAID' && firstPaidVisit(orderId)) {
        // Only on the first visit: reopening an old order's page must not empty a newer cart.
        clearCart();
        try {
          confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
        } catch {
          // Ignore confetti error
        }
      }
    } catch (err) {
      console.error('Failed to load order:', err);
    } finally {
      setLoading(false);
      setVerifying(false);
      setChecks((n) => n + 1);
    }
  };

  useEffect(() => {
    loadAndVerifyOrder();
  }, [orderId]);

  // While the result is unresolved, keep checking for about two minutes.
  useEffect(() => {
    if ((state !== 'PENDING' && state !== 'UNKNOWN') || checks === 0 || checks >= 24) return;
    const timer = setTimeout(loadAndVerifyOrder, 5000);
    return () => clearTimeout(timer);
  }, [state, checks]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <div className="w-9 h-9 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-semibold text-slate-500">Verifying payment with Cashfree...</p>
      </div>
    );
  }

  const isPaid = state === 'PAID';
  const isPending = state === 'PENDING' || state === 'UNKNOWN';
  // Automatic checks stop after about two minutes.
  const stoppedChecking = isPending && checks >= 24;
  const primaryPayment = order?.payments?.[0];
  const statusPanel = (tone: 'amber' | 'rose' | 'sky', title: string, text: string, action?: React.ReactNode) => (
    <>
      <div
        className={`inline-flex items-center justify-center w-16 h-16 rounded-3xl mb-2 ${
          tone === 'amber' ? 'bg-amber-100 text-amber-600' : tone === 'rose' ? 'bg-rose-100 text-rose-600' : 'bg-sky-100 text-sky-600'
        }`}
      >
        <AlertCircle className="w-10 h-10" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{title}</h1>
      <p className="text-sm text-slate-600 max-w-md mx-auto">{text}</p>
      {action}
    </>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      {/* Celebration or Status Header */}
      <div className="text-center space-y-3">
        {isPaid ? (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 shadow-lg shadow-emerald-500/10 mb-2">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
              Order Confirmed & Paid
            </h1>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Your meal order has been verified via Cashfree and scheduled with the S.B. Patil School canteen.
            </p>
          </>
        ) : isPending ? (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-amber-100 text-amber-600 shadow-lg shadow-amber-500/10 mb-2">
              <RefreshCw className={`w-9 h-9 ${stoppedChecking ? '' : 'animate-spin'}`} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {state === 'UNKNOWN' ? 'Checking Your Payment' : 'Payment Awaiting Confirmation'}
            </h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              {state === 'UNKNOWN'
                ? 'We could not reach the payment service just now. We will keep checking. Please do not pay again.'
                : message || 'If you completed the payment, it can take a minute to confirm. Please do not pay again.'}
            </p>
            <button
              onClick={loadAndVerifyOrder}
              disabled={verifying}
              className="mt-2 inline-flex items-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold shadow-md transition-all cursor-pointer"
            >
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>Check Payment Status</span>
            </button>
            {stoppedChecking && (
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Still not confirmed. If your payment failed or you closed the payment page, you can{' '}
                <Link href="/parent/cart" className="font-bold text-amber-700 underline">go back to the cart and try again</Link>
                . The same payment is reopened, so you cannot be charged twice for this order.
              </p>
            )}
          </>
        ) : state === 'EXCEPTION' ? (
          statusPanel('sky',
            issueState === 'PENDING_REVIEW'
              ? 'Payment Received — Awaiting Canteen Review'
              : issueState === 'REFUNDED'
              ? 'Payment Refunded'
              : 'Payment Received — No Order Created',
            message || 'The canteen will review this payment.',
            <Link href="/parent/orders" className="mt-2 inline-block px-5 py-3 bg-slate-800 text-white rounded-xl text-sm font-bold">
              View My Orders
            </Link>)
        ) : state === 'CANCELLED' ? (
          statusPanel('sky', 'Order Cancelled',
            order?.paymentStatus === 'REFUNDED'
              ? 'This order was cancelled and the payment has been refunded.'
              : order?.paymentStatus === 'REFUND_FAILED'
              ? 'This order was cancelled. The refund could not be completed automatically; the canteen will follow up.'
              : 'This order was cancelled. The refund is being processed.',
            <Link href="/parent/orders" className="mt-2 inline-block px-5 py-3 bg-slate-800 text-white rounded-xl text-sm font-bold">
              View My Orders
            </Link>)
        ) : state === 'NOT_FOUND' ? (
          statusPanel('rose', 'Order Not Found', 'We could not find this order on your account.',
            <Link href="/parent/orders" className="mt-2 inline-block px-5 py-3 bg-slate-800 text-white rounded-xl text-sm font-bold">
              View My Orders
            </Link>)
        ) : (
          statusPanel('rose', 'Payment Not Completed',
            message || 'This payment was not completed, so no order was created. If money was debited, your bank will reverse it automatically.',
            <Link href="/parent/cart" className="mt-2 inline-block px-5 py-3 bg-amber-500 text-white rounded-xl text-sm font-bold shadow-md hover:bg-amber-600">
              Back to Cart
            </Link>)
        )}
      </div>

      {/* Confirmation Card: Only rendered when payment is successfully confirmed and order exists */}
      {isPaid && order ? (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xl space-y-6">
        {/* Order Meta Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 p-3.5 sm:p-4 rounded-2xl bg-amber-50/60 border border-amber-100 text-xs">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Order ID</span>
            <p className="font-mono font-extrabold text-slate-900 text-sm truncate">{orderId}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Child Name</span>
            <p className="font-extrabold text-slate-800 text-xs truncate">
              {order?.items?.[0]?.studentName || 'Student'}
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Meal Date</span>
            <p className="font-extrabold text-slate-800 text-xs truncate">
              {order?.items?.[0]?.date ? formatDatePretty(order.items[0].date) : 'Tomorrow'}
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Total Amount</span>
            <p className="font-black text-amber-700 text-sm">{formatINR(order?.totalAmount || 0)}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Payment Status</span>
            <span
              className={`inline-block mt-0.5 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                isPaid
                  ? 'bg-emerald-100 text-emerald-800'
                  : isPending
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {order?.paymentStatus || 'PENDING'}
            </span>
          </div>
        </div>

        {/* Transaction Reference (Cashfree) */}
        {primaryPayment?.transactionRef && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="font-bold text-slate-700">Cashfree Transaction Ref:</span>
              <span className="font-mono text-slate-900 font-semibold">{primaryPayment.transactionRef}</span>
            </div>
            <span className="text-[11px] text-slate-400">Secured by Cashfree Payments</span>
          </div>
        )}

        {/* Ordered Meals Breakdown */}
        <div className="space-y-3">
          <h3 className="font-extrabold text-slate-900 text-sm uppercase tracking-wider">
            Meals Scheduled ({order?.items?.length || 0})
          </h3>

          <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
            {order?.items?.map((item: any, idx: number) => (
              <div key={idx} className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/60">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <VegBadge isVegetarian={item.isVegetarian !== false} size="sm" />
                    <span className="font-bold text-slate-900 text-sm">{item.mealName}</span>
                    <span className="text-slate-400 font-semibold">× {item.quantity}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    For: <strong className="text-slate-700">{item.studentName}</strong> (Class {item.studentGrade}-{item.studentDivision}, Roll: {item.studentRollNo})
                  </div>
                  <div className="text-[11px] font-semibold text-amber-700">
                    Meal Date: {formatDatePretty(item.date)}
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-extrabold text-slate-900">{formatINR(item.totalPrice)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-100">
          <Link
            href="/parent/children"
            className="w-full sm:w-auto text-center px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
          >
            My Children
          </Link>
          <Link
            href="/parent/orders"
            className="w-full sm:w-auto text-center px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition-colors"
          >
            Order History
          </Link>
          <Link
            href="/parent/menu"
            className="w-full sm:w-auto text-center px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5"
          >
            <span>Order More</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
      ) : null}
    </div>
  );
}
