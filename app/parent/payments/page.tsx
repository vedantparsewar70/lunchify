'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CreditCard,
  QrCode,
  Building2,
  Calendar,
  Filter,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { formatINR, formatDateTimePretty } from '@/lib/utils';
import { PaymentData } from '@/types';

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  SUCCESS: 'Paid',
  PENDING: 'Pending',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  REFUND_PENDING: 'Refund in progress',
  REFUND_FAILED: 'Refund issue (canteen will contact you)',
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');

  const fetchPayments = async () => {
    try {
      let url = '/api/parent/payments';
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (dateFilter) params.append('date', dateFilter);
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setPayments(data.payments || []);
      }
    } catch (err) {
      console.error('Failed to fetch payments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [statusFilter, dateFilter]);

  const totalSpent = payments
    .filter((p) => p.status === 'SUCCESS')
    .reduce((sum, p) => sum + p.amount, 0);

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'UPI':
        return <QrCode className="w-4 h-4 text-purple-600" />;
      case 'CARD':
        return <CreditCard className="w-4 h-4 text-blue-600" />;
      case 'NET_BANKING':
        return <Building2 className="w-4 h-4 text-amber-600" />;
      default:
        return <CreditCard className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <CreditCard className="w-7 h-7 text-amber-500" />
            <span>Payment History</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Audit trail of all online transactions, UPI references, and card payments.
          </p>
        </div>

        {/* Right Header Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/parent/orders"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-2xs"
          >
            <FileText className="w-4 h-4 text-amber-500" />
            <span>Order History</span>
          </Link>

          <div className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-2xl flex items-center gap-3">
            <div>
              <p className="text-[10px] uppercase font-bold text-amber-800">Total Spent</p>
              <p className="text-lg font-black text-amber-900">{formatINR(totalSpent)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Filter Status:</span>
          {['ALL', 'SUCCESS', 'REFUNDED', 'REFUND_PENDING'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-2 rounded-xl font-bold transition-all ${
                statusFilter === st
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {st === 'ALL' ? 'All' : PAYMENT_STATUS_LABELS[st] || st}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Filter Date:</span>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
          />
          {dateFilter && (
            <button
              onClick={() => setDateFilter('')}
              className="text-xs font-semibold text-rose-600 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="min-h-[30vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : payments.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-3 max-w-md mx-auto">
          <CreditCard className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">No Payments Recorded</h3>
          <p className="text-xs text-slate-500">Your transactions and receipts will appear here.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase font-bold text-[10px]">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6">Transaction ID</th>
                  <th className="py-3.5 px-4">Order ID</th>
                  <th className="py-3.5 px-4">Date & Time</th>
                  <th className="py-3.5 px-4">Method & Details</th>
                  <th className="py-3.5 px-4 text-right">Amount</th>
                  <th className="py-3.5 px-4 sm:px-6 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-4 sm:px-6">
                      <span className="font-mono font-bold text-slate-800">{p.id}</span>
                      <p className="text-[10px] text-slate-400 font-mono">{p.transactionRef}</p>
                    </td>

                    <td className="py-4 px-4">
                      <Link
                        href={`/parent/orders?orderId=${p.orderId}`}
                        className="font-mono font-bold text-amber-700 hover:underline flex items-center gap-1"
                      >
                        {p.orderId}
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>

                    <td className="py-4 px-4 text-slate-600 font-medium">
                      {formatDateTimePretty(p.createdAt)}
                    </td>

                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        {getMethodIcon(p.paymentMethod)}
                        <span className="font-bold text-slate-800">{p.paymentMethod}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {p.upiId || p.cardLastFour ? `Ending in ${p.cardLastFour}` : p.bankName || 'Direct'}
                      </p>
                    </td>

                    <td className="py-4 px-4 text-right font-extrabold text-slate-900 text-sm">
                      {formatINR(p.amount)}
                    </td>

                    <td className="py-4 px-4 sm:px-6 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          p.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : p.status === 'PENDING' || p.status === 'REFUND_PENDING'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : p.status === 'REFUNDED'
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {p.status === 'SUCCESS' && <CheckCircle2 className="w-3 h-3" />}
                        <span>{PAYMENT_STATUS_LABELS[p.status] || p.status}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
