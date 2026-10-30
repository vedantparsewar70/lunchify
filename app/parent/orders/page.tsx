'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  FileText,
  Clock,
  Calendar,
  Eye,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  UtensilsCrossed,
} from 'lucide-react';
import { useToast } from '@/components/ToastContext';
import { useAuth } from '@/components/AuthContext';
import { useSyncWatcher } from '@/lib/client-sync';
import VegBadge from '@/components/VegBadge';
import ChildAvatar from '@/components/ChildAvatar';
import MealIcon from '@/components/MealIcon';
import {
  formatINR,
  formatDatePretty,
  formatDateTimePretty,
  getOrderStatusColor,
  isDeadlinePassed,
} from '@/lib/utils';
import { BUSINESS_CONFIG } from '@/lib/business-config';

const PAYMENT_BADGE: Record<string, { label: string; tone: string }> = {
  PAID: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REFUND_PENDING: { label: 'Refund in progress', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  REFUNDED: { label: 'Refunded', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  REFUND_FAILED: { label: 'Refund issue', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** Payments received that did not become an order automatically (see /api/parent/orders). */
const ISSUE_STATE: Record<string, { label: string; text: string; tone: string }> = {
  PENDING_REVIEW: {
    label: 'Payment received · under review',
    text: 'The canteen will either accept this as an order or refund it in full. Please do not pay again.',
    tone: 'bg-amber-50 border-amber-200 text-amber-900',
  },
  REFUND_PENDING: {
    label: 'Refund in progress',
    text: 'A full refund has been started to your original payment method.',
    tone: 'bg-sky-50 border-sky-200 text-sky-900',
  },
  REFUNDED: {
    label: 'Refunded',
    text: 'This payment was refunded in full to your original payment method.',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  },
  REFUND_FAILED: {
    label: 'Refund issue',
    text: 'The refund could not be completed automatically. Please contact the school canteen.',
    tone: 'bg-rose-50 border-rose-200 text-rose-900',
  },
};

const ISSUE_REASON: Record<string, string> = {
  PAID_AFTER_CUTOFF: 'Payment completed after the ordering deadline.',
  SERVICE_UNAVAILABLE: 'The meal is no longer being served that day.',
  STOCK_UNAVAILABLE: 'A meal sold out before the payment completed.',
  AMOUNT_MISMATCH: 'The amount paid did not match the order total.',
};

const SERVICE_LABEL: Record<string, string> = {
  PREPARING: 'Being prepared',
  READY: 'Ready',
  COLLECTED: 'Given',
};

function OrdersPageContent() {
  const searchParams = useSearchParams();
  const highlightedOrderId = searchParams.get('orderId');

  const { refreshUser } = useAuth();
  const { showToast } = useToast();

  const [orders, setOrders] = useState<any[]>([]);
  const [paymentIssues, setPaymentIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const res = await fetch('/api/parent/orders', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
        setPaymentIssues(data.paymentIssues || []);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Mirrors the server rule (the server re-checks): paid, no day prepared or given yet, and before
  // every meal's cutoff. A multi-day order is cancelled and refunded as a whole.
  const canCancel = (order: any) =>
    order.paymentStatus === 'PAID' &&
    order.orderStatus === 'CONFIRMED' &&
    (order.items || []).every(
      (it: { date: string; serviceStatus?: string }) =>
        (it.serviceStatus || 'CONFIRMED') === 'CONFIRMED' && !isDeadlinePassed(it.date, '08:30')
    );

  const cancelOrder = async (order: any, mode: 'cancel' | 'retry') => {
    const days = new Set((order.items || []).map((it: { date?: string }) => it.date)).size;
    const scope = days > 1 ? ` This cancels all ${days} days in this order.` : '';
    if (mode === 'cancel' && !window.confirm(`Cancel order ${order.id}?${scope} ${formatINR(order.totalAmount)} will be refunded to your original payment method.`)) {
      return;
    }
    setCancellingId(order.id);
    try {
      const res = await fetch('/api/parent/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'This order could not be cancelled.', 'error');
      } else {
        showToast(data.message || 'Order cancelled.', data.paymentStatus === 'REFUND_FAILED' ? 'error' : 'success');
      }
      await fetchOrders(true);
    } catch {
      showToast('Network error. Please check your order status before trying again.', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  // Live real-time synchronization: updates order status immediately when canteen staff marks it as Given/Collected
  useSyncWatcher({
    onOrdersUpdate: () => {
      fetchOrders(true);
    },
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <FileText className="w-7 h-7 text-amber-500" />
            <span>Order History</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            All your placed school lunch orders and payments.
          </p>
        </div>

        <Link
          href="/parent/menu"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs sm:text-sm font-extrabold shadow-md shadow-amber-500/20 transition-all self-start sm:self-auto cursor-pointer"
        >
          <UtensilsCrossed className="w-4 h-4" />
          <span>Order Lunch</span>
        </Link>
      </div>

      {!loading && paymentIssues.length > 0 && (
        <section className="space-y-3" aria-label="Payments under review or refunded">
          <h2 className="text-sm font-extrabold text-slate-800">Payments not turned into orders</h2>
          {paymentIssues.map((issue) => {
            const state = ISSUE_STATE[issue.state] || ISSUE_STATE.PENDING_REVIEW;
            return (
              <div key={issue.orderId} className={`rounded-2xl border p-4 space-y-1.5 text-sm ${state.tone}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-extrabold">{state.label}</span>
                  <span className="font-bold">{formatINR(issue.paidAmount)}</span>
                </div>
                <p className="text-xs">{ISSUE_REASON[issue.reason] || ''} {state.text}</p>
                <p className="text-[11px] opacity-80 break-all">
                  Ref {issue.orderId}
                  {issue.dates?.length ? ` · for ${issue.dates.map((d: string) => formatDatePretty(d)).join(', ')}` : ''}
                </p>
              </div>
            );
          })}
        </section>
      )}

      {loading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-4 max-w-md mx-auto">
          <FileText className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">No Orders Placed Yet</h3>
          <p className="text-xs text-slate-500">
            You have not placed any meal orders yet. Choose from our fresh lunch menu!
          </p>
          <Link
            href="/parent/menu"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-500/20 transition-all"
          >
            <UtensilsCrossed className="w-4 h-4" />
            <span>Order Lunch Now</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const statusStyle = getOrderStatusColor(order.orderStatus);
            const isHighlighted = order.id === highlightedOrderId;

            return (
              <div
                key={order.id}
                className={`bg-white rounded-3xl p-5 sm:p-6 border transition-all ${
                  isHighlighted ? 'border-amber-400 ring-2 ring-amber-300/30' : 'border-slate-100 shadow-sm'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-extrabold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg">
                      {order.id}
                    </span>
                    <span className="text-xs text-slate-400">
                      Ordered: {formatDateTimePretty(order.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusStyle.bg}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${statusStyle.badge}`} />
                      <span>{statusStyle.text}</span>
                    </span>

                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${PAYMENT_BADGE[order.paymentStatus]?.tone || PAYMENT_BADGE.PAID.tone}`}>
                      {(PAYMENT_BADGE[order.paymentStatus] || PAYMENT_BADGE.PAID).label}: {formatINR(order.totalAmount)}
                    </span>
                  </div>
                </div>

                {/* Items in this order */}
                <div className="py-3 divide-y divide-slate-100">
                  {order.items?.map((item: any, idx: number) => (
                    <div key={idx} className="py-3 flex items-start sm:items-center justify-between text-xs gap-3">
                      <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                        <div className="shrink-0 mt-0.5 sm:mt-0">
                          <MealIcon name={item.mealName} category={item.mealCategory} size="sm" />
                        </div>
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <VegBadge isVegetarian={item.isVegetarian} size="sm" />
                            <span className="font-bold text-slate-800 text-sm leading-snug break-words">{item.mealName}</span>
                            <span className="text-slate-400 font-semibold">× {item.quantity}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 flex-wrap">
                            <ChildAvatar size="xs" />
                            <span className="break-words">
                              For: <strong className="text-slate-700">{item.studentName}</strong> (Class {item.studentGrade}-{item.studentDivision}, Roll: {item.studentRollNo})
                            </span>
                          </div>
                          <p className="text-[11px] font-semibold text-amber-700 flex flex-wrap items-center gap-1.5">
                            <span>Scheduled for: {formatDatePretty(item.date)}</span>
                            {order.orderStatus !== 'CANCELLED' && SERVICE_LABEL[item.serviceStatus] && (
                              <span
                                className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${
                                  item.serviceStatus === 'COLLECTED'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                                }`}
                              >
                                {SERVICE_LABEL[item.serviceStatus]}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0 pt-0.5 sm:pt-0">
                        <span className="font-extrabold text-slate-900 text-sm whitespace-nowrap">{formatINR(item.totalPrice)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Footer Info */}
                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="text-slate-400 text-[11px]">
                    Payment Ref: {order.payments?.[0]?.transactionRef || 'PAID'} • {order.payments?.[0]?.paymentMethod || 'UPI'}
                  </div>
                  {canCancel(order) && (
                    <button
                      onClick={() => cancelOrder(order, 'cancel')}
                      disabled={cancellingId === order.id}
                      className="px-4 py-2.5 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-sm font-bold disabled:opacity-60"
                    >
                      {cancellingId === order.id ? 'Cancelling…' : 'Cancel order'}
                    </button>
                  )}
                  {order.paymentStatus === 'REFUND_FAILED' && (
                    <button
                      onClick={() => cancelOrder(order, 'retry')}
                      disabled={cancellingId === order.id}
                      className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-bold disabled:opacity-60"
                    >
                      {cancellingId === order.id ? 'Retrying…' : 'Retry refund'}
                    </button>
                  )}
                </div>
                {order.paymentStatus === 'PAID' && !['CANCELLED', 'COLLECTED'].includes(order.orderStatus) && !canCancel(order) && (
                  <p className="pt-2 text-[11px] text-slate-500">
                    {new Set((order.items || []).map((it: { date?: string }) => it.date)).size > 1
                      ? `This order covers several days and is cancelled and refunded as a whole, only before the ${BUSINESS_CONFIG.cancellationCutoffTime} cutoff of its first day and before any meal is prepared or given. Single days cannot be cancelled separately yet. For help, contact the canteen.`
                      : `Cancellation closes at the ${BUSINESS_CONFIG.cancellationCutoffTime} cutoff, or once the meal is being prepared.`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] flex items-center justify-center">Loading orders...</div>}>
      <OrdersPageContent />
    </Suspense>
  );
}
