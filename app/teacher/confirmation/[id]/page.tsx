'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  UtensilsCrossed,
  ArrowRight,
  ShieldCheck,
  GraduationCap,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import { formatINR, formatDatePretty } from '@/lib/utils';

export default function TeacherConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const orderId = resolvedParams.id;

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  // PAID | PENDING | NOT_PAID | EXCEPTION | CANCELLED | NO_ACCESS (other device) | UNKNOWN (could not check)
  const [state, setState] = useState('UNKNOWN');
  const [message, setMessage] = useState('');
  const [checks, setChecks] = useState(0);

  const fetchOrder = async () => {
    setChecking(true);
    try {
      const verifyRes = await fetch('/api/teacher/orders/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      }).catch(() => null);

      const verifyData = verifyRes ? await verifyRes.json().catch(() => null) : null;
      let nextState = 'UNKNOWN';
      if (verifyRes?.ok) nextState = verifyData?.state || 'UNKNOWN';
      else if (verifyRes?.status === 401 || verifyRes?.status === 404) nextState = 'NO_ACCESS';
      setState(nextState);
      setMessage(verifyData?.message || '');

      if (nextState === 'PAID') {
        const res = await fetch(`/api/teacher/orders/${orderId}`);
        if (res.ok) setOrder((await res.json()).order);
      }
    } catch (err) {
      console.error('Failed to load teacher order:', err);
    } finally {
      setLoading(false);
      setChecking(false);
      setChecks((n) => n + 1);
    }
  };

  useEffect(() => {
    if (orderId) fetchOrder();
  }, [orderId]);

  // Keep checking an unresolved payment for about two minutes.
  useEffect(() => {
    if ((state !== 'PENDING' && state !== 'UNKNOWN') || checks === 0 || checks >= 24) return;
    const timer = setTimeout(fetchOrder, 5000);
    return () => clearTimeout(timer);
  }, [state, checks]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/70 py-8 px-4 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-9 h-9 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-500">Verifying payment status...</p>
        </div>
      </div>
    );
  }

  const isPaid = state === 'PAID' && order?.paymentStatus === 'PAID';

  if (!isPaid) {
    const unresolved = state === 'PENDING' || state === 'UNKNOWN' || (state === 'PAID' && !order);
    const view =
      state === 'NOT_PAID'
        ? { tone: 'rose', badge: 'Payment Not Completed', title: 'No Order Created', text: message || 'This payment was not completed, so no order was placed. If money was debited, your bank will reverse it automatically.' }
        : state === 'EXCEPTION'
        ? { tone: 'sky', badge: 'Payment Received', title: 'Order Needs Canteen Review', text: message || 'The canteen will review this payment.' }
        : state === 'CANCELLED'
        ? { tone: 'sky', badge: 'Cancelled', title: 'Order Cancelled', text: 'This order was cancelled by the canteen.' }
        : state === 'NO_ACCESS'
        ? { tone: 'amber', badge: 'Order Status', title: 'Open This Page on the Same Phone', text: 'Order details can only be shown on the device used to place the order. If you paid, the canteen has your order — please do not pay again. Ask the canteen counter with your name if unsure.' }
        : { tone: 'amber', badge: 'Checking Payment', title: 'Confirming Your Payment', text: message || 'If you completed the payment, it can take a minute to confirm. Please do not pay again.' };
    const toneClass = view.tone === 'rose' ? 'bg-rose-100 text-rose-600' : view.tone === 'sky' ? 'bg-sky-100 text-sky-600' : 'bg-amber-100 text-amber-600';
    return (
      <div className="min-h-screen bg-slate-50/70 py-8 px-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-200 space-y-6 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto shadow-sm ${toneClass}`}>
            {unresolved ? <Clock className="w-9 h-9" /> : <AlertCircle className="w-9 h-9" />}
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
              <span>{view.badge}</span>
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">{view.title}</h1>
            <p className="text-sm text-slate-600 font-medium">{view.text}</p>
            <p className="text-xs text-slate-400">Order ID: {orderId}</p>
          </div>
          <div className="pt-2 space-y-2">
            {unresolved && (
              <button
                onClick={fetchOrder}
                disabled={checking}
                className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-xl transition-all cursor-pointer shadow-md disabled:opacity-60"
              >
                {checking ? 'Checking…' : 'Check Payment Status'}
              </button>
            )}
            {state === 'NOT_PAID' && (
              <Link
                href="/teacher/menu"
                className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <span>Back to Teacher Menu</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70 py-8 px-4 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-200 space-y-6 text-center animate-in fade-in zoom-in-95 duration-200">
        {/* Success Header */}
        <div className="space-y-2">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Payment Received • Order Confirmed</span>
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Order Placed Successfully!
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Order ID: <strong className="text-slate-800 font-bold">{orderId}</strong>
          </p>
        </div>

        {/* Big Counter Collection Card */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 p-5 rounded-2xl text-left space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-900">
              Canteen Pickup
            </span>
            <span className="text-xs font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
              PAID
            </span>
          </div>
          <div>
            <span className="text-xs text-amber-800 font-medium block">Collection Name:</span>
            <p className="text-2xl font-black text-slate-900 tracking-tight">
              {loading ? '...' : order?.teacherName || 'Teacher'}
            </p>
          </div>
          <div className="pt-2 border-t border-amber-200/80 text-xs font-bold text-amber-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Tell this name at the canteen counter to collect your food.</span>
          </div>
        </div>

        {/* Items Summary */}
        {order && order.items && (
          <div className="text-left space-y-2 border border-slate-200 rounded-2xl p-4">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 block">
              Ordered Items
            </span>
            <div className="divide-y divide-slate-100">
              {order.items.map((item: any, idx: number) => (
                <div key={idx} className="py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <VegBadge isVegetarian={item.isVegetarian} size="sm" />
                    <div>
                      <span className="font-bold text-slate-800">{item.mealName}</span>
                      <span className="text-slate-500 ml-1.5 font-medium">x {item.quantity}</span>
                    </div>
                  </div>
                  <span className="font-black text-slate-800">
                    {formatINR(item.totalPrice || item.unitPrice * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-sm">
              <span className="font-black text-slate-800">Total Paid</span>
              <span className="font-black text-amber-600 text-base">
                {formatINR(order.totalAmount || 0)}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 space-y-2">
          <Link
            href="/teacher/menu"
            className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
          >
            <span>Order Another Meal</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
