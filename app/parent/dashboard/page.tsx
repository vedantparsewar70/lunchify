'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  UtensilsCrossed,
  Calendar,
  Clock,
  ArrowRight,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  FileText,
  CalendarOff,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { useCart } from '@/components/CartContext';
import { useToast } from '@/components/ToastContext';
import { useChildren } from '@/components/ChildrenContext';
import { formatINR, formatDatePretty, getTodayString, getOrderStatusColor } from '@/lib/utils';
import VegBadge from '@/components/VegBadge';
import ChildAvatar from '@/components/ChildAvatar';
import MealIcon from '@/components/MealIcon';
import MealCategoryBadge from '@/components/MealCategoryBadge';
import { useSyncWatcher } from '@/lib/client-sync';
import { MenuDayItem } from '@/types';

export default function ParentDashboard() {
  const { user, isLoading } = useAuth();
  const { children: childrenList } = useChildren();
  const { addToCart } = useCart();
  const { showToast } = useToast();

  const [orders, setOrders] = useState<any[]>([]);
  const [todayMenu, setTodayMenu] = useState<MenuDayItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  const todayStr = getTodayString();

  // Set default child once loaded
  useEffect(() => {
    if (childrenList.length > 0 && !selectedChildId) {
      setSelectedChildId(childrenList[0].id);
    }
  }, [childrenList, selectedChildId]);

  const loadDashboardData = async (isBackground = false) => {
    if (!isBackground) setDataLoading(true);
    try {
      const menuUrl = selectedChildId
        ? `/api/menu?date=${todayStr}&childId=${encodeURIComponent(selectedChildId)}`
        : `/api/menu?date=${todayStr}`;

      const [ordersRes, menuRes] = await Promise.all([
        fetch('/api/parent/orders?limit=20', { cache: 'no-store' }),
        fetch(menuUrl, { cache: 'no-store' }),
      ]);

      if (ordersRes.ok) {
        const ordData = await ordersRes.json();
        setOrders(ordData.orders || []);
      }

      if (menuRes.ok) {
        const mData = await menuRes.json();
        setTodayMenu(mData.menus || []);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      if (!isBackground) setDataLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [todayStr, selectedChildId]);

  // Live real-time synchronization for parent dashboard without manual page refresh
  useSyncWatcher({
    onOrdersUpdate: () => {
      loadDashboardData(true);
    },
    onMenuUpdate: () => {
      loadDashboardData(true);
    },
  });

  if (isLoading || dataLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500 font-medium">Loading parent dashboard...</p>
        </div>
      </div>
    );
  }

  // Calculate statistics
  const todayOrders = orders.filter((o) =>
    o.items?.some((it: any) => it.date === todayStr && o.orderStatus !== 'CANCELLED')
  );

  const upcomingMealsCount = orders
    .filter((o) => o.orderStatus !== 'CANCELLED')
    .reduce((sum, o) => {
      const futureItems = o.items?.filter((it: any) => it.date >= todayStr);
      return sum + (futureItems?.length || 0);
    }, 0);

  const pendingPaymentsCount = orders.filter((o) => o.paymentStatus === 'PENDING').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-amber-500/15">
        <div className="absolute right-0 top-0 w-80 h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/20 to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-xs rounded-full text-xs font-semibold">
              <Calendar className="w-3.5 h-3.5" />
              <span>Today: {formatDatePretty(todayStr)}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Welcome back, {user?.name || 'Parent'}! 👋
            </h1>
            <p className="text-amber-100 text-xs sm:text-sm max-w-xl">
              Plan nutritious school meals for your children, review active orders, and top up meal balances.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/parent/menu"
              className="px-5 py-2.5 bg-white text-amber-800 hover:bg-amber-50 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all flex items-center gap-1.5"
            >
              <UtensilsCrossed className="w-4 h-4" />
              <span>Order Lunch</span>
            </Link>
            <Link
              href="/parent/orders"
              className="px-4 py-2.5 bg-amber-700/60 hover:bg-amber-700/80 border border-white/20 text-white rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" />
              <span>Order History</span>
            </Link>
            <Link
              href="/parent/children"
              className="px-4 py-2.5 bg-amber-700/60 hover:bg-amber-700/80 border border-white/20 text-white rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Add Child</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {/* Card 1: Children */}
        <Link
          href="/parent/children"
          className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs hover:shadow-md hover:border-amber-200 transition-all group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Children</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{childrenList.length}</p>
            <span className="text-[11px] font-semibold text-blue-600 flex items-center">
              Manage <ChevronRight className="w-3 h-3" />
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {childrenList.map((c) => c.name.split(' ')[0]).join(', ') || 'No children added'}
          </p>
        </Link>

        {/* Card 2: Today's Orders */}
        <Link
          href="/parent/orders"
          className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs hover:shadow-md hover:border-amber-200 transition-all group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Today's Meals</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <UtensilsCrossed className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{todayOrders.length}</p>
            <span className="text-[11px] font-semibold text-amber-600 flex items-center">
              View <ChevronRight className="w-3 h-3" />
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {todayOrders.length > 0 ? 'Lunch being prepared' : 'No meals booked today'}
          </p>
        </Link>

        {/* Card 3: Upcoming Meals */}
        <Link
          href="/parent/orders"
          className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs hover:shadow-md hover:border-amber-200 transition-all group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Upcoming Meals</span>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{upcomingMealsCount}</p>
            <span className="text-[11px] font-semibold text-purple-600 flex items-center">
              Schedule <ChevronRight className="w-3 h-3" />
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Lunches pre-booked</p>
        </Link>
      </div>

      {/* Children Quick Cards Strip */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">Your Registered Children</h2>
            <p className="text-xs text-slate-500">Pick a child to select meals or view their diet profile</p>
          </div>
          <Link
            href="/parent/children"
            className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
          >
            Manage Children <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {childrenList.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-8 text-center space-y-3">
            <Users className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">No children registered yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Add your child with their Class, Division, and dietary requirements to start scheduling lunches.
            </p>
            <Link
              href="/parent/children"
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-amber-600"
            >
              <PlusCircle className="w-4 h-4" /> Add Child Now
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {childrenList.map((child) => (
              <div
                key={child.id}
                className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <ChildAvatar size="md" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-bold text-slate-900 text-sm">{child.name}</h4>
                      <VegBadge isVegetarian={child.isVegetarian} size="sm" />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Class {child.grade}-{child.division} • Roll: {child.rollNo}
                    </p>
                  </div>
                </div>

                <Link
                  href={`/parent/menu?childId=${child.id}`}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl transition-colors shrink-0"
                >
                  Order
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* October 2026 Timetable Spotlight Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-300/60 rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-500/20">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500 text-white px-2 py-0.5 rounded-md">
                Official Timetable
              </span>
              <span className="text-xs font-bold text-slate-500">October 2026</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 mt-0.5">
              October 2026 School Brunch Menu
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 max-w-xl">
              Category-tailored nutritious meals for <strong>Pre-primary</strong>, <strong>Primary</strong>, and <strong>Secondary</strong> students across all 31 days.
            </p>
          </div>
        </div>
        <Link
          href="/parent/menu"
          className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm font-extrabold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer"
        >
          <span>View October Timetable</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Main Grid: Today's Menu Preview & Recent Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Today's Menu */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Today's Lunch Menu</h2>
              <p className="text-xs text-slate-500">
                Fresh timetable items for {formatDatePretty(todayStr)}
              </p>
            </div>
            <Link
              href="/parent/menu"
              className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
            >
              Full October Menu <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Child Category Tabs if multiple children */}
          {childrenList.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-[11px] font-bold text-slate-400">Viewing for:</span>
              {childrenList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedChildId(c.id)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                    selectedChildId === c.id
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {c.name.split(' ')[0]} ({c.studentCategory?.replace('_', '-') || 'Class ' + c.grade})
                </button>
              ))}
            </div>
          )}

          {todayMenu.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 border border-slate-100 text-center text-xs text-slate-500">
              No menu items scheduled for today. Check the full October menu calendar.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {todayMenu.slice(0, 4).map((menuItem) => (
                <div
                  key={menuItem.id}
                  className={`rounded-2xl p-4 border shadow-xs hover:shadow-md transition-all flex flex-col justify-between gap-3 ${
                    menuItem.isHoliday
                      ? 'border-rose-200 bg-rose-50/40'
                      : 'border-slate-200/80 bg-white'
                  }`}
                >
                  {menuItem.isHoliday ? (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                        <CalendarOff className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-200">
                            Holiday Today — No Brunch Scheduled
                          </span>
                          {menuItem.studentCategory && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {menuItem.studentCategory.replace('_', '-')}
                            </span>
                          )}
                        </div>
                        <h4 className="font-extrabold text-slate-900 text-sm leading-tight">
                          {menuItem.holidayReason || 'School Holiday'}
                        </h4>
                        <p className="text-xs text-slate-500">
                          School canteen closed for brunch. No meal booking required.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <MealIcon
                        name={menuItem.meal?.name || ''}
                        category={menuItem.meal?.category || 'LUNCH'}
                        size="md"
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <MealCategoryBadge category={menuItem.meal?.category || 'LUNCH'} size="sm" />
                          {menuItem.studentCategory && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {menuItem.studentCategory.replace('_', '-')}
                            </span>
                          )}
                        </div>
                        <h4 className="font-extrabold text-slate-900 text-sm leading-tight truncate">
                          {menuItem.meal?.name}
                        </h4>
                        <p className="text-xs font-black text-amber-600">
                          {formatINR(menuItem.meal?.price || 0)}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    {menuItem.isHoliday ? (
                      <span className="text-[11px] font-bold text-rose-700">
                        Canteen Closed for Brunch
                      </span>
                    ) : menuItem.isPastDate ? (
                      <span className="text-[11px] font-semibold text-slate-400">
                        Past Date • Closed
                      </span>
                    ) : (
                      <>
                        <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          Available
                        </span>
                        <Link
                          href={`/parent/menu?date=${todayStr}${selectedChildId ? `&childId=${selectedChildId}` : ''}`}
                          className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                        >
                          Select
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Recent Orders */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Recent Orders</h2>
              <p className="text-xs text-slate-500">Live order status</p>
            </div>
            <Link
              href="/parent/orders"
              className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
            >
              All Orders <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {orders.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 border border-slate-100 text-center text-xs text-slate-500">
              No orders placed yet. Choose a meal from today's menu to place your first order.
            </div>
          ) : (
            <div className="space-y-3">
              {orders.slice(0, 4).map((order) => {
                const statusStyle = getOrderStatusColor(order.orderStatus);
                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs space-y-2 hover:border-amber-200 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-800">{order.id}</span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${statusStyle.bg}`}
                      >
                        {statusStyle.text}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1">
                      {order.items?.map((it: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-[11px]">
                          <span>
                            <strong>{it.studentName}</strong>: {it.mealName}
                          </span>
                          <span className="text-slate-400">{formatDatePretty(it.date)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        Paid: <strong className="text-slate-800">{formatINR(order.totalAmount)}</strong>
                      </span>
                      <Link
                        href={`/parent/orders?orderId=${order.id}`}
                        className="text-amber-600 hover:underline font-bold text-[11px]"
                      >
                        Details →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
