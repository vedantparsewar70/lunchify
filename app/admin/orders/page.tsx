'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  FileText,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Printer,
  Calendar,
  X,
  RefreshCw,
  User,
  GraduationCap,
  ShieldCheck,
  ChevronRight,
  Phone,
  Hash,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import ChildAvatar from '@/components/ChildAvatar';
import MealIcon from '@/components/MealIcon';
import { formatINR, formatDatePretty, formatDateTimePretty, getOrderStatusColor, getTodayString, getOffsetDateString } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';
import OrderReceiptModal from '@/components/OrderReceiptModal';

function AdminOrdersContent() {
  const searchParams = useSearchParams();
  const initialDate = searchParams.get('date') || '';

  const { showToast } = useToast();

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const tomorrowDateStr = getOffsetDateString(1);
  const todayDateStr = getTodayString();
  const [dateFilter, setDateFilter] = useState(initialDate || tomorrowDateStr);
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [search, setSearch] = useState('');

  // Selected Order for Detail Modal and Receipt Modal
  const [detailOrder, setDetailOrder] = useState<any | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<any | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateFilter) params.append('date', dateFilter);
      if (classFilter) params.append('class', classFilter);
      if (statusFilter) params.append('orderStatus', statusFilter);
      if (paymentFilter) params.append('paymentStatus', paymentFilter);
      if (search) params.append('search', search);

      const ordRes = await fetch(`/api/admin/orders?${params.toString()}`);
      if (ordRes.ok) {
        const data = await ordRes.json();
        // With a date selected, each order shows (and changes) that day's status only.
        setOrders(
          (data.orders || []).map((o: { serviceStatus?: string | null; orderStatus?: string }) => ({
            ...o,
            orderStatus: (dateFilter && o.serviceStatus) || o.orderStatus,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      showToast('Could not load orders', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchOrders();
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [dateFilter, classFilter, statusFilter, paymentFilter, search]);

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      setUpdatingStatusId(orderId);
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Preparation and handover are per day; the selected date says which day.
        body: JSON.stringify({ orderId, orderStatus: newStatus, ...(dateFilter && newStatus !== 'CANCELLED' ? { date: dateFilter } : {}) }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // For a cancellation, show the real refund outcome (requested, pending or failed).
        const paymentStatus = data?.order?.paymentStatus;
        showToast(
          data?.message || `Order status updated to ${newStatus}`,
          paymentStatus === 'REFUND_FAILED' ? 'error' : 'success'
        );
        // Update local state immediately
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, orderStatus: newStatus, ...(paymentStatus ? { paymentStatus } : {}) } : o))
        );
        if (detailOrder && detailOrder.id === orderId) {
          setDetailOrder((prev: any) => ({ ...prev, orderStatus: newStatus, ...(paymentStatus ? { paymentStatus } : {}) }));
        }
        fetchOrders();
      } else {
        showToast(data?.error || 'Failed to update status', 'error');
      }
    } catch {
      showToast('Network error updating status', 'error');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleResetFilters = () => {
    setDateFilter('');
    setClassFilter('');
    setStatusFilter('');
    setPaymentFilter('');
    setSearch('');
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-12 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <FileText className="w-7 h-7 text-amber-500" />
            <span>Student Orders</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Quickly see which student ordered what and track meal deliveries.
          </p>
        </div>

        <button
          onClick={fetchOrders}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
          title="Refresh List"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-500' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Quick Date Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setDateFilter(tomorrowDateStr)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilter === tomorrowDateStr
              ? 'bg-amber-500 text-white shadow-md'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Tomorrow ({formatDatePretty(tomorrowDateStr).split(',')[0]})
        </button>
        <button
          onClick={() => setDateFilter(todayDateStr)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilter === todayDateStr
              ? 'bg-amber-500 text-white shadow-md'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Today ({formatDatePretty(todayDateStr).split(',')[0]})
        </button>
        <button
          onClick={() => setDateFilter('')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            !dateFilter
              ? 'bg-slate-900 text-white shadow-md'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          All Dates
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search student / order */}
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Search Student / Order
            </label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Student name, roll no, order ID..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Meal Date Picker */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Meal Date
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-3 top-3 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
              />
            </div>
          </div>

          {/* Order Status */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Order Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
            >
              <option value="">All Statuses</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PREPARING">Preparing</option>
              <option value="READY">Ready for Pickup</option>
              <option value="COLLECTED">Collected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        {(classFilter || statusFilter || paymentFilter || search || (dateFilter && dateFilter !== tomorrowDateStr)) && (
          <div className="flex justify-end pt-1">
            <button
              onClick={handleResetFilters}
              className="text-xs text-amber-600 hover:text-amber-700 font-bold hover:underline cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Orders Count Banner */}
      <div className="flex items-center justify-between text-xs text-slate-600 px-1 font-medium">
        <span>
          Showing <strong className="text-slate-900 font-extrabold">{orders.length}</strong> {orders.length === 1 ? 'order' : 'orders'}
          {dateFilter ? ` for ${formatDatePretty(dateFilter)}` : ''}
        </span>
        <span className="text-[11px] text-slate-400">Tap order to inspect & change status</span>
      </div>

      {/* Orders List / Cards */}
      {loading ? (
        <div className="min-h-[35vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-3 max-w-md mx-auto">
          <FileText className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">No Orders Found</h3>
          <p className="text-xs text-slate-500">
            {dateFilter
              ? `No pre-orders found for ${formatDatePretty(dateFilter)}.`
              : 'No orders match the selected filters.'}
          </p>
          <button
            onClick={() => setDateFilter('')}
            className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            Show All Dates
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const statusStyle = getOrderStatusColor(o.orderStatus);
            const firstItem = o.items?.[0];
            const studentName = firstItem?.studentName || 'Student';
            const studentGrade = firstItem?.studentGrade || '-';
            const studentDivision = firstItem?.studentDivision || '-';
            const studentRollNo = firstItem?.studentRollNo || '-';
            const mealDate = firstItem?.date || dateFilter || todayDateStr;

            // Group items by meal for clean display
            const groupedItemsMap = new Map<string, { mealName: string; isVegetarian: boolean; quantity: number }>();
            for (const it of (o.items || [])) {
              const key = it.mealName || it.mealId;
              const existing = groupedItemsMap.get(key);
              if (existing) {
                existing.quantity += it.quantity;
              } else {
                groupedItemsMap.set(key, {
                  mealName: it.mealName,
                  isVegetarian: it.isVegetarian,
                  quantity: it.quantity,
                });
              }
            }
            const groupedItems = Array.from(groupedItemsMap.values());

            return (
              <div
                key={o.id}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:border-amber-400 hover:shadow-md transition-all overflow-hidden"
              >
                {/* Clean Card Top Header: Class & Roll Number (Child name removed from top) */}
                <div className="p-4 sm:p-5 flex items-center justify-between gap-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-3 py-1 rounded-xl text-xs font-black bg-purple-100 text-purple-800 border border-purple-200/80 tracking-wide">
                      Class {studentGrade}-{studentDivision}
                    </span>
                    {studentRollNo !== '-' && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-extrabold bg-slate-100 text-slate-700">
                        Roll #{studentRollNo}
                      </span>
                    )}
                  </div>

                  <span className="text-xs font-mono font-semibold text-slate-400">
                    {o.id}
                  </span>
                </div>

                {/* Items & Meal Summary */}
                <div className="p-4 sm:p-5 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 font-bold mb-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Meal Date: {formatDatePretty(mealDate)}</span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {groupedItems.map((it, idx) => (
                        <div
                          key={idx}
                          className="inline-flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 shadow-2xs"
                        >
                          <VegBadge isVegetarian={it.isVegetarian} size="sm" />
                          <span className="font-bold">{it.mealName}</span>
                          <span className="bg-amber-100 text-amber-900 font-extrabold px-1.5 py-0.5 rounded-md text-[11px]">
                            × {it.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold block text-left sm:text-right">
                        Total Amount
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-base font-extrabold text-slate-900">
                          {formatINR(o.totalAmount)}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                          {o.paymentStatus || 'PAID'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDetailOrder(o)}
                        className="px-3 py-1.5 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => setReceiptOrder(o)}
                        className="p-1.5 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs"
                        title="Print Meal Voucher"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick Status Action Controls for Admin/Staff */}
                <div className="px-4 py-2.5 bg-white border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 font-semibold text-[11px]">
                    Status: <strong className="text-slate-700">{o.orderStatus}</strong>
                    {o.isMultiDate && !dateFilter && (
                      <span className="block text-amber-700">Several days: pick a date above to update one day</span>
                    )}
                  </span>

                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    {['CONFIRMED', 'PREPARING', 'READY', 'COLLECTED'].map((st) => (
                      <button
                        key={st}
                        onClick={() => handleUpdateStatus(o.id, st)}
                        disabled={updatingStatusId === o.id || o.orderStatus === st}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                          o.orderStatus === st
                            ? 'bg-slate-900 text-white shadow-2xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {st === 'READY' ? 'Ready' : st === 'COLLECTED' ? 'Collected' : st === 'PREPARING' ? 'Preparing' : 'Confirmed'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Clean Order Detail Modal (Requirement 11) */}
      {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-100 p-6 space-y-5 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest block">
                  Order Details
                </span>
                <h3 className="text-lg font-extrabold text-slate-900">
                  {detailOrder.items?.[0]?.studentName || 'Student Order'}
                </h3>
              </div>
              <button
                onClick={() => setDetailOrder(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Clean Fields (Requirement 11) */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Student:</span>
                <span className="font-extrabold text-slate-900 text-sm">
                  {detailOrder.items?.[0]?.studentName || 'N/A'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Class:</span>
                <span className="font-bold text-slate-800">
                  Class {detailOrder.items?.[0]?.studentGrade || '-'}-{detailOrder.items?.[0]?.studentDivision || '-'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Roll No:</span>
                <span className="font-bold text-slate-800">
                  {detailOrder.items?.[0]?.studentRollNo || '-'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Parent:</span>
                <span className="font-semibold text-slate-800">
                  {detailOrder.parentName} {detailOrder.parentPhone ? `(${detailOrder.parentPhone})` : ''}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Meal Date:</span>
                <span className="font-bold text-amber-700">
                  {formatDatePretty(detailOrder.items?.[0]?.date || todayDateStr)}
                </span>
              </div>

              {/* Items List */}
              <div className="py-2 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px] block mb-2">
                  Items Ordered:
                </span>
                <div className="space-y-1.5">
                  {detailOrder.items?.map((it: any, i: number) => (
                    <div key={i} className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-2 min-w-0">
                        <VegBadge isVegetarian={it.isVegetarian} size="sm" />
                        <span className="font-bold text-slate-900">{it.mealName}</span>
                        {it.date && (
                          <span className="text-[11px] text-slate-500 whitespace-nowrap">
                            {formatDatePretty(it.date)} · {it.serviceStatus === 'COLLECTED' ? 'Given' : it.serviceStatus || ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-extrabold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                          × {it.quantity}
                        </span>
                        <span className="font-semibold text-slate-600">
                          {formatINR(it.totalPrice || it.unitPrice * it.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Total:</span>
                <span className="font-extrabold text-slate-900 text-base">
                  {formatINR(detailOrder.totalAmount)}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Payment:</span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800">
                  {detailOrder.paymentStatus || 'SUCCESS'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Order Status:</span>
                <span className="font-bold text-slate-800">
                  {detailOrder.orderStatus}
                </span>
              </div>

              <div className="flex justify-between py-1">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Order ID:</span>
                <span className="font-mono text-slate-500 text-[11px]">
                  {detailOrder.id}
                </span>
              </div>
            </div>

            {/* Quick Status Buttons in Modal */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Change Status
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {['CONFIRMED', 'PREPARING', 'READY', 'COLLECTED'].map((st) => (
                  <button
                    key={st}
                    onClick={() => handleUpdateStatus(detailOrder.id, st)}
                    className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      detailOrder.orderStatus === st
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {st === 'READY' ? 'Ready' : st === 'COLLECTED' ? 'Collected' : st === 'PREPARING' ? 'Preparing' : 'Confirmed'}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                onClick={() => {
                  setReceiptOrder(detailOrder);
                  setDetailOrder(null);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Voucher
              </button>
              <button
                onClick={() => setDetailOrder(null)}
                className="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voucher Print Modal */}
      {receiptOrder && (
        <OrderReceiptModal
          order={receiptOrder}
          onClose={() => setReceiptOrder(null)}
        />
      )}
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <AdminOrdersContent />
    </Suspense>
  );
}
