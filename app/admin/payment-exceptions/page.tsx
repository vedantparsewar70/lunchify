'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { formatINR, formatDateTimePretty } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';

const REASON_LABEL: Record<string, string> = {
  STOCK_UNAVAILABLE: 'Meal sold out before payment completed',
  PAID_AFTER_CUTOFF: 'Payment completed after the ordering cutoff',
  SERVICE_UNAVAILABLE: 'Meal no longer served that day (holiday or menu disabled)',
  AMOUNT_MISMATCH: 'Paid amount differs from order total',
};

const STATE_LABEL: Record<string, { text: string; tone: string }> = {
  NOT_REQUESTED: { text: 'Refund not started', tone: 'bg-amber-100 text-amber-900' },
  MANUAL_REVIEW: { text: 'Needs your decision', tone: 'bg-amber-100 text-amber-900' },
  ORDER_ACCEPTED: { text: 'Accepted as order', tone: 'bg-emerald-100 text-emerald-900' },
  REFUND_PENDING: { text: 'Refund in progress', tone: 'bg-sky-100 text-sky-900' },
  REFUNDED: { text: 'Refunded', tone: 'bg-emerald-100 text-emerald-900' },
  REFUND_FAILED: { text: 'Refund failed', tone: 'bg-rose-100 text-rose-900' },
};

const ACCEPTABLE_REASONS = ['PAID_AFTER_CUTOFF', 'SERVICE_UNAVAILABLE'];

/**
 * Payments that were received but could not become an order (sold out, late, no longer served,
 * amount mismatch). Late / no-longer-served payments wait here for a decision: accept as an order
 * or refund. The two are exclusive on the server, and the refund ID is fixed per payment, so
 * pressing a button again can never refund twice or create a second order.
 */
export default function PaymentExceptionsPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/payment-exceptions', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load payment issues');
      setItems(data.exceptions || []);
    } catch (err: any) {
      setError(err.message || 'Could not load payment issues');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resolve = async (item: any, action: 'refund' | 'accept') => {
    const question =
      action === 'accept'
        ? `Accept ${item.orderId} as a normal order? The kitchen will serve it and no refund will be made.`
        : `Request a refund of ${formatINR(item.paidAmount)} for ${item.orderId}? It goes back to the original payment method.`;
    if (!window.confirm(question)) return;
    setWorking(item.orderId);
    try {
      const res = await fetch('/api/admin/payment-exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: item.orderId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request failed');
      showToast(`Status: ${STATE_LABEL[data.refundState]?.text || data.refundState}`, data.refundState === 'REFUND_FAILED' ? 'error' : 'success');
    } catch (err: any) {
      showToast(err.message || 'Request failed', 'error');
    } finally {
      setWorking(null);
      await load();
    }
  };

  const attention = items.filter((i) => i.needsAttention);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">Payment Issues &amp; Refunds</h1>
          <p className="text-sm text-slate-600">Payments that were received but could not become an order.</p>
        </div>
        <button onClick={load} className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50" aria-label="Refresh">
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p>}

      {!loading && !error && (
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${attention.length ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
          {attention.length ? <AlertTriangle className="w-6 h-6 text-amber-600" /> : <CheckCircle2 className="w-6 h-6 text-emerald-600" />}
          <p className="text-sm font-semibold text-slate-800">
            {attention.length ? `${attention.length} payment(s) need attention.` : 'Nothing needs attention right now.'}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-slate-400" /></div>
      ) : items.length === 0 && !error ? (
        <p className="text-sm text-slate-500 text-center py-8">No payment issues have been recorded.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const state = STATE_LABEL[item.refundState] || { text: item.refundState, tone: 'bg-slate-100 text-slate-800' };
            const canRefund = !['REFUNDED', 'REFUND_PENDING', 'ORDER_ACCEPTED'].includes(item.refundState);
            const canAccept = item.refundState === 'MANUAL_REVIEW' && ACCEPTABLE_REASONS.includes(item.reason);
            const canRetryPending = item.refundState === 'REFUND_PENDING' && item.needsAttention;
            return (
              <div key={item.orderId} className={`bg-white rounded-2xl border p-4 space-y-2 ${item.needsAttention ? 'border-amber-300' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-sm font-bold text-slate-900 break-all">{item.orderId}</p>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${state.tone}`}>{state.text}</span>
                </div>
                <p className="text-sm text-slate-700">{REASON_LABEL[item.reason] || item.reason}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-600">
                  <span>Paid: <strong className="text-slate-900">{formatINR(item.paidAmount || 0)}</strong></span>
                  <span>Order total: <strong className="text-slate-900">{formatINR(item.expectedAmount || 0)}</strong></span>
                  <span>Type: <strong className="text-slate-900">{item.orderType === 'TEACHER' ? 'Teacher' : 'Parent'}</strong></span>
                  <span>{item.createdAt ? formatDateTimePretty(item.createdAt) : ''}</span>
                </div>
                {item.detail && <p className="text-xs text-slate-500">{item.detail}</p>}
                {item.refundError && <p className="text-xs font-semibold text-rose-700">Last refund error: {item.refundError}</p>}
                <div className="flex flex-col sm:flex-row gap-2">
                  {canAccept && (
                    <button
                      onClick={() => resolve(item, 'accept')}
                      disabled={working === item.orderId}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold"
                    >
                      {working === item.orderId ? 'Working…' : 'Accept as order'}
                    </button>
                  )}
                  {(canRefund || canRetryPending) && (
                    <button
                      onClick={() => resolve(item, 'refund')}
                      disabled={working === item.orderId}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-bold"
                    >
                      {working === item.orderId ? 'Working…' : item.refundState === 'REFUND_FAILED' || canRetryPending ? 'Retry refund' : 'Refund payment'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
