'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  History as HistoryIcon,
  Search,
  CheckCircle2,
  RefreshCw,
  Users,
  GraduationCap,
  Calendar,
  RotateCcw,
  Clock,
  ArrowLeft,
  ChefHat,
  Filter,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import { formatDatePretty, getTodayString, formatINR, formatDateTimePretty } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';
import { broadcastSyncEvent, useSyncWatcher } from '@/lib/client-sync';

/** The fields used to show one day of an order (the API returns more). */
type DayOrder = { serviceStatus?: string | null; orderStatus?: string; items?: Array<{ date?: string }> };

export default function StaffOrderHistoryPage() {
  const { showToast } = useToast();
  const todayStr = getTodayString();

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [historyTab, setHistoryTab] = useState<'ALL' | 'STUDENTS' | 'TEACHERS'>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const [studentOrders, setStudentOrders] = useState<any[]>([]);
  const [teacherOrders, setTeacherOrders] = useState<any[]>([]);

  const fetchHistory = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [studentRes, teacherRes] = await Promise.all([
        fetch(`/api/admin/orders?date=${selectedDate}`),
        fetch(`/api/staff/teacher-orders?date=${selectedDate}`),
      ]);

      if (studentRes.ok) {
        const studentData = await studentRes.json();
        // Only include orders whose meal for this date was marked COLLECTED / GIVEN
        // (a multi-day order appears only on the days actually handed over).
        const givenStudents = (studentData.orders || [])
          .map((o: DayOrder) => ({
            ...o,
            orderStatus: o.serviceStatus || o.orderStatus,
            items: (o.items || []).filter((it) => !it.date || it.date === selectedDate),
          }))
          .filter((o: DayOrder) => o.orderStatus === 'COLLECTED');
        setStudentOrders(givenStudents);
      } else {
        showToast('Could not load student history. Pull to refresh or try again.', 'error');
      }

      if (teacherRes.ok) {
        const teacherData = await teacherRes.json();
        // Only include teacher orders that have been marked GIVEN / COLLECTED
        const givenTeachers = (teacherData.orders || []).filter(
          (o: any) => o.orderStatus === 'GIVEN' || o.orderStatus === 'COLLECTED'
        );
        setTeacherOrders(givenTeachers);
      } else {
        showToast('Could not load teacher history. Please try again.', 'error');
      }
    } catch (err) {
      console.error('Failed to load history:', err);
      showToast('Error loading order history', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [selectedDate]);

  // Handovers and undos made on another device appear without a manual refresh.
  useSyncWatcher({ onOrdersUpdate: () => fetchHistory(true), onTeacherOrdersUpdate: () => fetchHistory(true) });

  // Revert a given student order back to Active
  const handleRevertStudentOrder = async (orderId: string) => {
    if (!confirm('Revert this order back to Active Orders?')) return;
    setRevertingId(orderId);
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, orderStatus: 'CONFIRMED', date: selectedDate }),
      });

      if (res.ok) {
        showToast('Order reverted back to Active Orders', 'success');
        setStudentOrders((prev) => prev.filter((o) => o.id !== orderId));
        broadcastSyncEvent('ORDERS_UPDATED');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to revert order', 'error');
        fetchHistory(true);
      }
    } catch {
      showToast('Network error reverting order', 'error');
    } finally {
      setRevertingId(null);
    }
  };

  // Revert a given teacher order back to Active
  const handleRevertTeacherOrder = async (orderId: string) => {
    if (!confirm('Revert this teacher order back to Active Orders?')) return;
    setRevertingId(orderId);
    try {
      const res = await fetch('/api/staff/teacher-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, orderStatus: 'CONFIRMED' }),
      });

      if (res.ok) {
        showToast('Teacher order reverted back to Active Orders', 'success');
        setTeacherOrders((prev) => prev.filter((o) => o.id !== orderId));
        broadcastSyncEvent('TEACHER_ORDERS_UPDATED');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to revert teacher order', 'error');
        fetchHistory(true);
      }
    } catch {
      showToast('Network error reverting teacher order', 'error');
    } finally {
      setRevertingId(null);
    }
  };

  // Filter student items by search
  const filteredStudents = useMemo(() => {
    if (!search.trim()) return studentOrders;
    const q = search.toLowerCase().trim();
    return studentOrders.filter((o) => {
      const studentName = (o.items?.[0]?.studentName || '').toLowerCase();
      const rollNo = (o.items?.[0]?.studentRollNo || '').toLowerCase();
      const grade = (o.items?.[0]?.studentGrade || '').toLowerCase();
      const orderId = (o.id || '').toLowerCase();
      const hasMealMatch = (o.items || []).some((it: any) =>
        (it.mealName || '').toLowerCase().includes(q)
      );
      return (
        studentName.includes(q) ||
        rollNo.includes(q) ||
        grade.includes(q) ||
        orderId.includes(q) ||
        hasMealMatch
      );
    });
  }, [studentOrders, search]);

  // Filter teacher items by search
  const filteredTeachers = useMemo(() => {
    if (!search.trim()) return teacherOrders;
    const q = search.toLowerCase().trim();
    return teacherOrders.filter((o) => {
      const teacherName = (o.teacherName || '').toLowerCase();
      const orderId = (o.id || '').toLowerCase();
      const hasMealMatch = (o.items || []).some((it: any) =>
        (it.mealName || '').toLowerCase().includes(q)
      );
      return teacherName.includes(q) || orderId.includes(q) || hasMealMatch;
    });
  }, [teacherOrders, search]);

  const totalGivenStudentsCount = studentOrders.length;
  const totalGivenTeachersCount = teacherOrders.length;
  const totalGivenCombinedCount = totalGivenStudentsCount + totalGivenTeachersCount;

  const formatGivenTime = (timestamp?: string) => {
    if (!timestamp) return 'Given today';
    try {
      const d = new Date(timestamp);
      return `Given at ${d.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })}`;
    } catch {
      return 'Given';
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4 pb-28 sm:pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/staff/orders"
              className="p-1 -ml-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
              title="Back to Active Orders"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
              Canteen Archive
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            <HistoryIcon className="w-6 h-6 text-emerald-600" />
            <span>Order History</span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/staff/orders"
            className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition-all shadow-2xs"
          >
            Active Orders →
          </Link>

          <button
            onClick={() => fetchHistory()}
            disabled={loading}
            className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs cursor-pointer"
            title="Refresh History"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-bold text-slate-700">Date:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {selectedDate !== todayStr && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
              className="px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer border border-emerald-200"
            >
              Today
            </button>
          )}
          <span className="text-xs text-slate-500 font-semibold">
            {formatDatePretty(selectedDate)}
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Total Given
          </span>
          <span className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 block">
            {totalGivenCombinedCount}
          </span>
        </div>

        <div className="bg-amber-50/60 p-3 rounded-2xl border border-amber-200/80 shadow-2xs text-center">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">
            Students Given
          </span>
          <span className="text-xl sm:text-2xl font-black text-amber-900 mt-0.5 block">
            {totalGivenStudentsCount}
          </span>
        </div>

        <div className="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-200/80 shadow-2xs text-center">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
            Teachers Given
          </span>
          <span className="text-xl sm:text-2xl font-black text-emerald-900 mt-0.5 block">
            {totalGivenTeachersCount}
          </span>
        </div>
      </div>

      {/* Segmented Tab Bar: ALL | STUDENTS | TEACHERS */}
      <div className="grid grid-cols-3 gap-1.5 bg-slate-200/70 p-1 rounded-2xl text-xs font-bold">
        <button
          type="button"
          onClick={() => setHistoryTab('ALL')}
          className={`py-2 px-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            historyTab === 'ALL'
              ? 'bg-slate-900 text-white shadow-sm font-black'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <span>All ({totalGivenCombinedCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setHistoryTab('STUDENTS')}
          className={`py-2 px-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            historyTab === 'STUDENTS'
              ? 'bg-amber-500 text-white shadow-sm font-black'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Students ({totalGivenStudentsCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setHistoryTab('TEACHERS')}
          className={`py-2 px-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            historyTab === 'TEACHERS'
              ? 'bg-emerald-600 text-white shadow-sm font-black'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>Teachers ({totalGivenTeachersCount})</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student, roll number, teacher, or meal name..."
          className="w-full pl-11 pr-4 py-3 bg-white border-2 border-slate-200 rounded-2xl text-sm font-medium text-slate-900 focus:outline-hidden focus:border-emerald-500 shadow-2xs"
        />
      </div>

      {/* Loading Spinner */}
      {loading ? (
        <div className="min-h-[35vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : null}

      {/* Empty State */}
      {!loading &&
        ((historyTab === 'ALL' && filteredStudents.length === 0 && filteredTeachers.length === 0) ||
          (historyTab === 'STUDENTS' && filteredStudents.length === 0) ||
          (historyTab === 'TEACHERS' && filteredTeachers.length === 0)) && (
          <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <HistoryIcon className="w-6 h-6" />
            </div>
            <h3 className="font-extrabold text-slate-800 text-base">No Given Meals Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {search
                ? `No given meals matched "${search}".`
                : `No meals have been marked as given yet for ${formatDatePretty(selectedDate)}.`}
            </p>
            <div className="pt-1">
              <Link
                href="/staff/orders"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-xs font-black shadow-sm"
              >
                <span>View Active Orders</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        )}

      {/* History Lists */}
      {!loading && (
        <div className="space-y-4">
          {/* STUDENT HISTORY CARDS */}
          {(historyTab === 'ALL' || historyTab === 'STUDENTS') && filteredStudents.length > 0 && (
            <div className="space-y-2.5">
              {historyTab === 'ALL' && (
                <div className="flex items-center gap-1.5 text-xs font-black text-amber-900 uppercase tracking-wider px-1 pt-1">
                  <Users className="w-3.5 h-3.5 text-amber-600" />
                  <span>Student Meals ({filteredStudents.length})</span>
                </div>
              )}

              {filteredStudents.map((o) => {
                const firstItem = o.items?.[0];
                return (
                  <div
                    key={o.id}
                    className="p-4 sm:p-5 rounded-2xl border-2 border-slate-200 bg-white hover:border-slate-300 transition-all shadow-2xs space-y-3"
                  >
                    {/* Header: Student Name & Given Badge */}
                    <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                      <div>
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                          Student
                        </span>
                        <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight mt-0.5">
                          {firstItem?.studentName || 'Student'}
                        </h2>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs text-slate-500 font-semibold">
                          <span className="bg-slate-100 px-2 py-0.5 rounded-md text-[11px] font-bold text-slate-700">
                            Class {firstItem?.studentGrade || '-'}-{firstItem?.studentDivision || '-'}
                          </span>
                          <span>•</span>
                          <span>Roll: {firstItem?.studentRollNo || '-'}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>GIVEN</span>
                        </span>
                        <span className="block text-[10px] font-semibold text-slate-400 mt-1">
                          {formatGivenTime(o.collectedAt || o.updatedAt)}
                        </span>
                      </div>
                    </div>

                    {/* Meal Items */}
                    <div className="space-y-1">
                      {(o.items || []).map((it: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs py-0.5">
                          <div className="flex items-center gap-2 font-bold text-slate-800">
                            <VegBadge isVegetarian={it.isVegetarian !== false} size="sm" />
                            <span>{it.mealName}</span>
                          </div>
                          <span className="font-extrabold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md text-xs">
                            Qty: {it.quantity}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Footer: Order ID and Revert Button */}
                    <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="font-mono text-[11px] text-slate-400 truncate max-w-[150px] sm:max-w-none">
                        {o.id}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleRevertStudentOrder(o.id)}
                        disabled={revertingId === o.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                        title="Move back to Active Orders"
                      >
                        <RotateCcw className="w-3 h-3 text-slate-500" />
                        <span>Revert to Active</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TEACHER HISTORY CARDS */}
          {(historyTab === 'ALL' || historyTab === 'TEACHERS') && filteredTeachers.length > 0 && (
            <div className="space-y-2.5">
              {historyTab === 'ALL' && (
                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-900 uppercase tracking-wider px-1 pt-2">
                  <GraduationCap className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Teacher Meals ({filteredTeachers.length})</span>
                </div>
              )}

              {filteredTeachers.map((to) => (
                <div
                  key={to.id}
                  className="p-4 sm:p-5 rounded-2xl border-2 border-slate-200 bg-white hover:border-slate-300 transition-all shadow-2xs space-y-3"
                >
                  {/* Header: Teacher Name & Given Badge */}
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                        Teacher
                      </span>
                      <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight mt-0.5">
                        {to.teacherName}
                      </h2>
                      {to.teacherPhone && to.teacherPhone !== '9999999999' && (
                        <span className="text-xs text-slate-500 font-medium">
                          Phone: {to.teacherPhone}
                        </span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>GIVEN</span>
                      </span>
                      <span className="block text-[10px] font-semibold text-slate-400 mt-1">
                        {formatGivenTime(to.collectedAt || to.updatedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Meal Items */}
                  <div className="space-y-1">
                    {(to.items || []).map((it: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs py-0.5">
                        <div className="flex items-center gap-2 font-bold text-slate-800">
                          <VegBadge isVegetarian={it.isVegetarian !== false} size="sm" />
                          <span>{it.mealName}</span>
                        </div>
                        <span className="font-extrabold text-emerald-900 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-xs">
                          x {it.quantity}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Footer: Order ID and Revert Button */}
                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-slate-400 truncate max-w-[150px] sm:max-w-none">
                      {to.id}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRevertTeacherOrder(to.id)}
                      disabled={revertingId === to.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                      title="Move back to Active Orders"
                    >
                      <RotateCcw className="w-3 h-3 text-slate-500" />
                      <span>Revert to Active</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
