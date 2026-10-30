'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import {
  FileText,
  Search,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  GraduationCap,
  Users,
  Clock,
  Sparkles,
  ChefHat,
  X,
  Printer,
  UtensilsCrossed,
  History,
  Calendar,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import { formatDatePretty, getTodayString, getOffsetDateString, formatINR } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';
import { useSyncWatcher, broadcastSyncEvent } from '@/lib/client-sync';

/** The fields used to show one day of an order (the API returns more). */
type DayOrder = { serviceStatus?: string | null; orderStatus?: string; items?: Array<{ date?: string }> };

function StaffOrdersContent() {
  const todayDateStr = getTodayString();
  const tomorrowDateStr = getOffsetDateString(1);
  const { showToast } = useToast();

  // Active tab: 'STUDENTS' | 'TEACHERS'
  const [activeTab, setActiveTab] = useState<'STUDENTS' | 'TEACHERS'>('STUDENTS');

  // Student orders state (active only)
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyStudentCount, setHistoryStudentCount] = useState(0);

  // Teacher orders state (active only)
  const [teacherOrders, setTeacherOrders] = useState<any[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [historyTeacherCount, setHistoryTeacherCount] = useState(0);

  // Kitchen Production Modal state (Today & Tomorrow)
  const [showTotalOrdersModal, setShowTotalOrdersModal] = useState(false);
  const [todayKitchenData, setTodayKitchenData] = useState<any>(null);
  const [tomorrowKitchenData, setTomorrowKitchenData] = useState<any>(null);
  const [loadingKitchen, setLoadingKitchen] = useState(false);

  const [search, setSearch] = useState('');
  // Orders with a handover in flight; one entry per order, so another card's reply never
  // re-enables this card's button early.
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const setUpdating = (orderId: string, busy: boolean) =>
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  // A failed load must not look like "no orders today".
  const [loadError, setLoadError] = useState('');

  // Fetch kitchen production summaries for today and tomorrow
  const fetchKitchenSummary = async (bypassCache = false) => {
    setLoadingKitchen(true);
    try {
      const cacheParam = bypassCache ? '&bypassCache=true' : '';
      const [todayRes, tomorrowRes] = await Promise.all([
        fetch(`/api/admin/kitchen?date=${todayDateStr}${cacheParam}`, { cache: 'no-store' }),
        fetch(`/api/admin/kitchen?date=${tomorrowDateStr}${cacheParam}`, { cache: 'no-store' }),
      ]);
      if (todayRes.ok) {
        const todayData = await todayRes.json();
        setTodayKitchenData(todayData);
      }
      if (tomorrowRes.ok) {
        const tomorrowData = await tomorrowRes.json();
        setTomorrowKitchenData(tomorrowData);
      }
    } catch (err) {
      console.error('Failed to load kitchen production summary:', err);
    } finally {
      setLoadingKitchen(false);
    }
  };


  // Fetch student orders (active non-collected only)
  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('date', todayDateStr);
      if (search) params.append('search', search);

      const res = await fetch(`/api/admin/orders?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        // Status and items for today only: a multi-day order shows just today's meal here,
        // and giving it never marks the other days as given.
        const allOrders = (data.orders || []).map((o: DayOrder) => ({
          ...o,
          orderStatus: o.serviceStatus || o.orderStatus,
          items: (o.items || []).filter((it) => !it.date || it.date === todayDateStr),
        }));
        // Only active orders remain in this section until staff clicks 'Given'
        const activeOrders = allOrders.filter(
          (o: any) => o.orderStatus !== 'COLLECTED' && o.orderStatus !== 'CANCELLED'
        );
        const givenCount = allOrders.filter((o: any) => o.orderStatus === 'COLLECTED').length;
        setOrders(activeOrders);
        setHistoryStudentCount(givenCount);
        setLoadError('');
      } else {
        const data = await res.json().catch(() => ({}));
        setLoadError(data.error || `Could not load orders (error ${res.status}).`);
      }
    } catch (err) {
      console.error('Failed to load student orders:', err);
      setLoadError('Could not load orders. Check the connection.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch teacher orders (active non-given only)
  const fetchTeacherOrders = async () => {
    setLoadingTeachers(true);
    try {
      const params = new URLSearchParams();
      params.append('date', todayDateStr);
      if (search) params.append('search', search);

      const res = await fetch(`/api/staff/teacher-orders?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const allTeacherOrders = data.orders || [];
        // Only active teacher orders remain in this section until staff clicks 'Given'
        const activeTeachers = allTeacherOrders.filter(
          (o: any) => o.orderStatus !== 'GIVEN' && o.orderStatus !== 'COLLECTED' && o.orderStatus !== 'CANCELLED'
        );
        const givenCount = allTeacherOrders.filter(
          (o: any) => o.orderStatus === 'GIVEN' || o.orderStatus === 'COLLECTED'
        ).length;
        setTeacherOrders(activeTeachers);
        setHistoryTeacherCount(givenCount);
        setLoadError('');
      } else {
        const data = await res.json().catch(() => ({}));
        setLoadError(data.error || `Could not load teacher orders (error ${res.status}).`);
      }
    } catch (err) {
      console.error('Failed to load teacher orders:', err);
      setLoadError('Could not load teacher orders. Check the connection.');
    } finally {
      setLoadingTeachers(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'STUDENTS') {
        fetchOrders();
      } else {
        fetchTeacherOrders();
      }
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, activeTab]);

  // Initial load of teacher orders count
  useEffect(() => {
    fetchTeacherOrders();
  }, []);

  // Live real-time synchronization across staff and parents without manual refresh
  useSyncWatcher({
    onOrdersUpdate: () => {
      fetchOrders();
      // The production summary is only visible in its modal, which reloads it when opened.
      if (showTotalOrdersModal) fetchKitchenSummary(true);
    },
    onTeacherOrdersUpdate: () => {
      fetchTeacherOrders();
    },
  });

  const handleMarkCollected = async (orderId: string) => {
    if (updatingIds.has(orderId)) return;
    setUpdating(orderId, true);
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, orderStatus: 'COLLECTED', date: todayDateStr }),
      });

      if (res.ok) {
        showToast('Meal marked as given! Moved to History.', 'success');
        // Once marked given, remove from active orders and move to history
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        setHistoryStudentCount((c) => c + 1);
        broadcastSyncEvent('ORDERS_UPDATED');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to update order status', 'error');
        fetchOrders();
      }
    } catch {
      showToast('Network error updating status', 'error');
    } finally {
      setUpdating(orderId, false);
    }
  };

  const handleMarkTeacherGiven = async (orderId: string) => {
    if (updatingIds.has(orderId)) return;
    setUpdating(orderId, true);
    try {
      const res = await fetch('/api/staff/teacher-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, orderStatus: 'GIVEN' }),
      });

      if (res.ok) {
        showToast('Teacher meal marked as given! Moved to History.', 'success');
        // Once marked given, remove from active orders and move to history
        setTeacherOrders((prev) => prev.filter((o) => o.id !== orderId));
        setHistoryTeacherCount((c) => c + 1);
        broadcastSyncEvent('TEACHER_ORDERS_UPDATED');
      } else {
        // e.g. already given on another device: show why and refresh the list.
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to update teacher order', 'error');
        fetchTeacherOrders();
      }
    } catch {
      showToast('Network error updating status', 'error');
    } finally {
      setUpdating(orderId, false);
    }
  };

  // Memoized active food products to prepare for today & tomorrow
  const todayMealCounts = useMemo(() => {
    return (todayKitchenData?.mealCounts || []).filter(
      (mc: any) => (mc.quantityToPrepare ?? mc.count ?? mc.orderCount ?? 0) > 0
    );
  }, [todayKitchenData]);

  const tomorrowMealCounts = useMemo(() => {
    return (tomorrowKitchenData?.mealCounts || []).filter(
      (mc: any) => (mc.quantityToPrepare ?? mc.count ?? mc.orderCount ?? 0) > 0
    );
  }, [tomorrowKitchenData]);

  const pendingTeacherOrdersCount = teacherOrders.filter(
    (o) => o.orderStatus !== 'GIVEN' && o.orderStatus !== 'COLLECTED'
  ).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4 pb-28 sm:pb-12">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
            Canteen Roster
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-500" />
            <span>Orders</span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/staff/history"
            className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-2xs"
            title="View Given Order History"
          >
            <History className="w-4 h-4 text-emerald-600" />
            <span>History ({historyStudentCount + historyTeacherCount})</span>
          </Link>

          <button
            onClick={activeTab === 'STUDENTS' ? fetchOrders : fetchTeacherOrders}
            disabled={activeTab === 'STUDENTS' ? loading : loadingTeachers}
            className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs cursor-pointer"
            title="Refresh Orders"
          >
            <RefreshCw
              className={`w-4 h-4 ${
                (activeTab === 'STUDENTS' ? loading : loadingTeachers)
                  ? 'animate-spin text-amber-500'
                  : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Segmented Tab Switch: Student Orders vs Teacher Orders */}
      <div className="grid grid-cols-2 gap-2 bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => {
            setActiveTab('STUDENTS');
            setSearch('');
          }}
          className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center justify-center gap-2 ${
            activeTab === 'STUDENTS'
              ? 'bg-amber-500 text-white shadow-md'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Student Orders ({orders.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('TEACHERS');
            setSearch('');
          }}
          className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center justify-center gap-2 relative ${
            activeTab === 'TEACHERS'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>Teacher Orders ({teacherOrders.length})</span>
          {pendingTeacherOrdersCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-2 right-2 ring-2 ring-white animate-pulse" />
          )}
        </button>
      </div>

      {/* Action Button: Check Total Orders */}
      <div>
        <button
          type="button"
          onClick={() => {
            fetchKitchenSummary(true);
            setShowTotalOrdersModal(true);
          }}
          className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-[0.99] text-white rounded-2xl font-black text-sm shadow-sm transition-all flex items-center justify-center gap-2.5 cursor-pointer"
        >
          <ChefHat className="w-5 h-5" />
          <span>Check Total Orders</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            activeTab === 'STUDENTS'
              ? 'Search student name or roll number...'
              : 'Search teacher name or order ID...'
          }
          className="w-full pl-11 pr-4 py-3 bg-white border-2 border-slate-200 rounded-2xl text-sm font-medium text-slate-900 focus:outline-hidden focus:border-amber-500 shadow-2xs"
        />
      </div>

      {loadError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-rose-800 text-xs font-bold">
          <span>{loadError} The list below may be out of date.</span>
          <button
            type="button"
            onClick={() => (activeTab === 'STUDENTS' ? fetchOrders() : fetchTeacherOrders())}
            className="px-3 py-1.5 bg-white border border-rose-300 rounded-lg text-rose-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 1: STUDENT ORDERS                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'STUDENTS' && (
        <>
          {loading ? (
            <div className="min-h-[40vh] flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="font-extrabold text-slate-800 text-base">
                {historyStudentCount > 0 ? 'All Student Meals Given!' : 'No Active Student Orders'}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {historyStudentCount > 0
                  ? `All ${historyStudentCount} student meals for today have been handed out and moved to History.`
                  : `No pending student orders for ${formatDatePretty(todayDateStr)}.`}
              </p>
              {historyStudentCount > 0 && (
                <div className="pt-1">
                  <Link
                    href="/staff/history"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-sm transition-all"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>View Student History ({historyStudentCount}) →</span>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 font-semibold px-1">
                Total {orders.length} student {orders.length === 1 ? 'order' : 'orders'} for{' '}
                {formatDatePretty(todayDateStr)}
              </p>

              {orders.map((o) => {
                const isCollected = o.orderStatus === 'COLLECTED';

                // One block per child: a parent can order for several children in one payment,
                // and staff must see whose meal they are handing over.
                type StudentGroup = {
                  key: string;
                  name: string;
                  grade: string;
                  division: string;
                  rollNo: string;
                  allergens: string[];
                  meals: Map<string, { mealName: string; isVegetarian: boolean; quantity: number }>;
                };
                const studentMap = new Map<string, StudentGroup>();
                for (const it of o.items || []) {
                  const key = it.studentId || it.studentName || 'student';
                  let group = studentMap.get(key);
                  if (!group) {
                    group = {
                      key,
                      name: it.studentName || 'Student',
                      grade: it.studentGrade || '-',
                      division: it.studentDivision || '-',
                      rollNo: it.studentRollNo || '',
                      allergens: [],
                      meals: new Map(),
                    };
                    studentMap.set(key, group);
                  }
                  if (it.hasAllergyAlert && it.conflictAllergens && !group.allergens.includes(it.conflictAllergens)) {
                    group.allergens.push(it.conflictAllergens);
                  }
                  const mealKey = it.mealName || it.mealId;
                  const existing = group.meals.get(mealKey);
                  if (existing) {
                    existing.quantity += it.quantity;
                  } else {
                    group.meals.set(mealKey, { mealName: it.mealName, isVegetarian: it.isVegetarian, quantity: it.quantity });
                  }
                }
                const students = Array.from(studentMap.values());
                const hasAllergyToday = (o.items || []).some((it: { hasAllergyAlert?: boolean }) => it.hasAllergyAlert);

                return (
                  <div
                    key={o.id}
                    className={`p-4 sm:p-5 rounded-2xl border transition-all shadow-xs space-y-3.5 ${
                      isCollected
                        ? 'bg-slate-50/70 border-slate-200 opacity-75'
                        : 'bg-white border-slate-200 hover:border-amber-400 hover:shadow-md'
                    }`}
                  >
                    {students.map((st) => (
                      <div key={st.key} className="space-y-2 pb-3 border-b border-slate-100 last:border-b-0 last:pb-0">
                        {/* Student: name, class & roll number */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-black text-slate-900 text-sm break-words">{st.name}</span>
                          <span className="inline-flex items-center px-3 py-1 rounded-xl text-xs font-black bg-purple-100 text-purple-800 border border-purple-200/80 tracking-wide">
                            Class {st.grade}-{st.division}
                          </span>
                          {st.rollNo && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-extrabold bg-slate-100 text-slate-700">
                              Roll #{st.rollNo}
                            </span>
                          )}
                        </div>

                        {Array.from(st.meals.values()).map((it, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 py-1 text-xs">
                            <div className="flex items-center gap-2 font-bold text-slate-800 text-[13px] leading-tight">
                              <VegBadge isVegetarian={it.isVegetarian} size="sm" />
                              <span>{it.mealName}</span>
                            </div>
                            <span className="font-black text-amber-900 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-lg text-xs shrink-0">
                              Qty: {it.quantity}
                            </span>
                          </div>
                        ))}

                        {st.allergens.length > 0 && (
                          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-bold">
                            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>Allergy alert for {st.name}: {st.allergens.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    ))}

                    {hasAllergyToday && students.every((st) => st.allergens.length === 0) && (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-bold">
                        <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Allergy alert noted on file. Check before handing over.</span>
                      </div>
                    )}

                    {/* Card Footer: Clean ID & Handout Action Button */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                      <span
                        className="font-mono text-xs font-semibold text-slate-400 truncate max-w-[160px] sm:max-w-none"
                        title={o.id}
                      >
                        {o.id}
                      </span>

                      {isCollected ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-700 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>Collected</span>
                        </span>
                      ) : (
                      <button
                        type="button"
                        onClick={() => handleMarkCollected(o.id)}
                        disabled={updatingIds.has(o.id)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 disabled:opacity-60 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white rounded-xl text-xs font-black shadow-sm hover:shadow transition-all cursor-pointer shrink-0"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>
                          {updatingIds.has(o.id)
                            ? 'Saving…'
                            : students.length > 1
                            ? `Mark Given (all ${students.length} children)`
                            : 'Mark Given'}
                        </span>
                      </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: TEACHER ORDERS                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'TEACHERS' && (
        <>
          {loadingTeachers ? (
            <div className="min-h-[40vh] flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : teacherOrders.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="font-extrabold text-slate-800 text-base">
                {historyTeacherCount > 0 ? 'All Teacher Meals Given!' : 'No Active Teacher Orders'}
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {historyTeacherCount > 0
                  ? `All ${historyTeacherCount} teacher meals for today have been handed out and moved to History.`
                  : `No pending teacher direct orders for ${formatDatePretty(todayDateStr)}.`}
              </p>
              {historyTeacherCount > 0 && (
                <div className="pt-1">
                  <Link
                    href="/staff/history"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-sm transition-all"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>View Teacher History ({historyTeacherCount}) →</span>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="font-bold text-slate-600 uppercase tracking-wider text-[11px]">
                  Teacher Collection Roster
                </span>
                <span className="text-slate-500 font-semibold text-[11px]">
                  {pendingTeacherOrdersCount} pending collection
                </span>
              </div>

              {teacherOrders.map((to) => {
                const isGiven = to.orderStatus === 'GIVEN' || to.orderStatus === 'COLLECTED';
                const isPaid = to.paymentStatus === 'PAID';

                return (
                  <div
                    key={to.id}
                    className={`p-4 sm:p-5 rounded-2xl border-2 transition-all shadow-xs space-y-3.5 ${
                      isGiven
                        ? 'bg-slate-50/70 border-slate-200 opacity-70'
                        : 'bg-white border-emerald-200 hover:border-emerald-400 hover:shadow-md'
                    }`}
                  >
                    {/* Top: Teacher Name & Payment Badge */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          Teacher
                        </span>
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight mt-0.5">
                          {to.teacherName}
                        </h2>
                        {to.teacherPhone && to.teacherPhone !== '9999999999' && (
                          <span className="text-xs text-slate-500 font-medium">
                            Phone: {to.teacherPhone}
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl border ${
                            isPaid
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>{isPaid ? 'PAID • Online' : to.paymentStatus}</span>
                        </span>
                        <span className="block text-xs font-black text-slate-900 mt-1">
                          {formatINR(to.totalAmount || 0)}
                        </span>
                      </div>
                    </div>

                    {/* Ordered Items */}
                    <div className="space-y-1.5">
                      {(to.items || []).map((it: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-0.5 text-xs">
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

                    {to.notes && (
                      <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium">
                        <strong>Note:</strong> {to.notes}
                      </div>
                    )}

                    {/* Footer: Order ID and "Mark Given" Button */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-semibold text-slate-400">
                        {to.id}
                      </span>

                      {isGiven ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-700 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>Given to Teacher</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleMarkTeacherGiven(to.id)}
                          disabled={updatingIds.has(to.id)}
                          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 disabled:opacity-60 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                        >
                          <UserCheck className="w-4 h-4" />
                          <span>Mark Given</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Total Orders & Kitchen Production Dashboard (Today & Tomorrow)     */}
      {/* ========================================================================= */}
      {showTotalOrdersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto print:p-0 print:bg-white print:fixed print:inset-0 print:z-[9999] print:block">
          <div className="bg-slate-50 rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200/80 animate-in fade-in zoom-in-95 duration-150 print:max-w-none print:w-full print:max-h-none print:shadow-none print:border-none print:p-0 print:rounded-none">
            {/* Modal Sticky Header */}
            <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-200 bg-white sticky top-0 z-20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20">
                  <ChefHat className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg sm:text-xl text-slate-900 leading-tight">
                    Kitchen Production Dashboard
                  </h3>
                  <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider block mt-0.5">
                    Student Meals &bull; Quantity to Prepare
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 print:hidden">
                <button
                  type="button"
                  onClick={() => fetchKitchenSummary(true)}
                  disabled={loadingKitchen}
                  className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  title="Refresh counts"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingKitchen ? 'animate-spin text-amber-500' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  title="Print summary"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowTotalOrdersModal(false)}
                  className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 space-y-6">
              {/* Top Summary Cards (Requirement 2) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                {/* Today's Summary Card */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 p-5 text-white shadow-lg shadow-amber-500/15">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/20 text-amber-100 text-[10px] font-black uppercase tracking-wider">
                        <Calendar className="w-3 h-3" />
                        Today&apos;s Production
                      </span>
                      <p className="text-sm font-black text-amber-100 mt-2">
                        {formatDatePretty(todayDateStr)}
                      </p>
                      <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-200 mt-2 block">
                        Today&apos;s Total Orders
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                        {todayKitchenData?.totalOrders ?? 0}
                      </p>
                      <span className="text-[10px] font-black text-amber-100 uppercase tracking-wider block mt-1">
                        Orders
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tomorrow's Summary Card */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-700 p-5 text-white shadow-lg shadow-indigo-600/15">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/20 text-indigo-100 text-[10px] font-black uppercase tracking-wider">
                        <Calendar className="w-3 h-3" />
                        Tomorrow&apos;s Production
                      </span>
                      <p className="text-sm font-black text-indigo-100 mt-2">
                        {formatDatePretty(tomorrowDateStr)}
                      </p>
                      <span className="text-[11px] font-extrabold uppercase tracking-widest text-indigo-200 mt-2 block">
                        Tomorrow&apos;s Total Orders
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-none">
                        {tomorrowKitchenData?.totalOrders ?? 0}
                      </p>
                      <span className="text-[10px] font-black text-indigo-100 uppercase tracking-wider block mt-1">
                        Orders
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Two Separate Production Sections (Requirements 1, 3, 5, 6) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 items-start">
                {/* SECTION 1: TODAY'S TOTAL ORDERS */}
                <div className="bg-white rounded-2xl border-2 border-amber-200/80 p-4 sm:p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-amber-100">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <div>
                        <h4 className="font-black text-sm text-slate-900 uppercase tracking-wider">
                          Today&apos;s Total Orders
                        </h4>
                        <span className="text-xs font-bold text-slate-500">
                          {formatDatePretty(todayDateStr)}
                        </span>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-black">
                      {todayKitchenData?.totalOrders ?? 0} Student Orders
                    </span>
                  </div>

                  {loadingKitchen && !todayKitchenData ? (
                    <div className="py-12 flex items-center justify-center">
                      <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : todayMealCounts.length === 0 ? (
                    <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
                      <UtensilsCrossed className="w-8 h-8 mx-auto text-slate-300" />
                      <h5 className="font-extrabold text-slate-700 text-sm">No Orders for Today</h5>
                      <p className="text-xs text-slate-500">
                        No food product orders recorded for today ({formatDatePretty(todayDateStr)}).
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {todayMealCounts.map((mc: any, idx: number) => {
                        const qty = mc.quantityToPrepare ?? mc.count ?? mc.orderCount ?? 0;
                        return (
                          <div
                            key={mc.mealId || idx}
                            className="bg-slate-50/70 hover:bg-amber-50/40 p-4 rounded-2xl border border-slate-200 hover:border-amber-300 shadow-2xs transition-all flex items-center justify-between gap-3"
                          >
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <VegBadge isVegetarian={mc.isVegetarian} size="sm" />
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                  {mc.category || 'LUNCH'}
                                </span>
                              </div>
                              <h5 className="text-base sm:text-lg font-black text-slate-900 tracking-tight uppercase truncate">
                                {mc.mealName}
                              </h5>
                              <p className="text-xs font-bold text-slate-600">
                                Qty to Prepare: <span className="text-slate-900 font-extrabold">{qty}</span>
                              </p>
                            </div>

                            <div className="bg-amber-50 border-2 border-amber-300 px-3.5 py-2 rounded-2xl min-w-[95px] text-center shrink-0 shadow-2xs">
                              <span className="text-2xl sm:text-3xl font-black text-amber-600 block leading-tight">
                                {qty}
                              </span>
                              <span className="text-[9px] font-black text-amber-900 uppercase tracking-wider block">
                                QTY TO PREPARE
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <TeacherMealsNote data={todayKitchenData} />
                </div>

                {/* SECTION 2: TOMORROW'S TOTAL ORDERS */}
                <div className="bg-white rounded-2xl border-2 border-indigo-200/80 p-4 sm:p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-indigo-100">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                      <div>
                        <h4 className="font-black text-sm text-slate-900 uppercase tracking-wider">
                          Tomorrow&apos;s Total Orders
                        </h4>
                        <span className="text-xs font-bold text-slate-500">
                          {formatDatePretty(tomorrowDateStr)}
                        </span>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-lg text-xs font-black">
                      {tomorrowKitchenData?.totalOrders ?? 0} Student Orders
                    </span>
                  </div>

                  {loadingKitchen && !tomorrowKitchenData ? (
                    <div className="py-12 flex items-center justify-center">
                      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : tomorrowMealCounts.length === 0 ? (
                    <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
                      <UtensilsCrossed className="w-8 h-8 mx-auto text-slate-300" />
                      <h5 className="font-extrabold text-slate-700 text-sm">No Orders for Tomorrow</h5>
                      <p className="text-xs text-slate-500">
                        No food product orders recorded for tomorrow ({formatDatePretty(tomorrowDateStr)}).
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {tomorrowMealCounts.map((mc: any, idx: number) => {
                        const qty = mc.quantityToPrepare ?? mc.count ?? mc.orderCount ?? 0;
                        return (
                          <div
                            key={mc.mealId || idx}
                            className="bg-slate-50/70 hover:bg-indigo-50/40 p-4 rounded-2xl border border-slate-200 hover:border-indigo-300 shadow-2xs transition-all flex items-center justify-between gap-3"
                          >
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <VegBadge isVegetarian={mc.isVegetarian} size="sm" />
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                  {mc.category || 'LUNCH'}
                                </span>
                              </div>
                              <h5 className="text-base sm:text-lg font-black text-slate-900 tracking-tight uppercase truncate">
                                {mc.mealName}
                              </h5>
                              <p className="text-xs font-bold text-slate-600">
                                Qty to Prepare: <span className="text-slate-900 font-extrabold">{qty}</span>
                              </p>
                            </div>

                            <div className="bg-indigo-50 border-2 border-indigo-300 px-3.5 py-2 rounded-2xl min-w-[95px] text-center shrink-0 shadow-2xs">
                              <span className="text-2xl sm:text-3xl font-black text-indigo-600 block leading-tight">
                                {qty}
                              </span>
                              <span className="text-[9px] font-black text-indigo-900 uppercase tracking-wider block">
                                QTY TO PREPARE
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <TeacherMealsNote data={tomorrowKitchenData} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <StaffOrdersContent />
    </Suspense>
  );
}

/** Teacher meals for the day, listed separately from the student counts above. */
function TeacherMealsNote({ data }: { data?: { teacherMealsTotal?: number; teacherMeals?: Array<{ mealName: string; quantity: number }> } | null }) {
  if (!data?.teacherMealsTotal) return null;
  return (
    <div className="p-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 text-xs text-emerald-900 space-y-1">
      <p className="font-black uppercase tracking-wider">Plus teacher meals: {data.teacherMealsTotal}</p>
      <p className="font-semibold break-words">
        {(data.teacherMeals || []).map((m) => `${m.mealName} × ${m.quantity}`).join(', ')}
      </p>
    </div>
  );
}
