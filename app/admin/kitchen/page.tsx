'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ChefHat,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Users,
  UtensilsCrossed,
  RefreshCw,
  Clock,
  Sparkles,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import ChildAvatar from '@/components/ChildAvatar';
import MealIcon from '@/components/MealIcon';
import { formatINR, formatDatePretty, getTodayString, getOffsetDateString, getOrderStatusColor } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';

function KitchenPageContent() {
  const searchParams = useSearchParams();
  const tomorrowDateStr = getOffsetDateString(1);
  const todayDateStr = getTodayString();
  const initialDate = searchParams.get('date') || tomorrowDateStr;

  const { showToast } = useToast();

  const [date, setDate] = useState<string>(initialDate);
  const [kitchenData, setKitchenData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchKitchenData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/kitchen?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setKitchenData(data);
      }
    } catch (err) {
      console.error('Failed to fetch kitchen data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKitchenData();
  }, [date]);

  const handlePrint = () => {
    window.print();
  };

  const isTomorrow = date === tomorrowDateStr;
  const isToday = date === todayDateStr;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-12 space-y-6 print:p-0 print:m-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 rounded-md">
              Kitchen Operations
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1 flex items-center gap-2.5">
            <ChefHat className="w-7 h-7 text-amber-500" />
            <span>Kitchen Production Summary</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Exact quantity of each food item the kitchen team needs to prepare.
          </p>
        </div>

        {/* Date Selector & Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchKitchenData}
            disabled={loading}
            className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer shadow-2xs"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-500' : ''}`} />
          </button>

          <button
            onClick={handlePrint}
            className="px-3.5 py-2 bg-white border border-slate-200 hover:border-amber-400 text-slate-800 rounded-xl text-xs font-bold shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-amber-500" />
            <span>Print Sheet</span>
          </button>
        </div>
      </div>

      {/* Date Quick Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs print:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(tomorrowDateStr)}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              isTomorrow
                ? 'bg-amber-500 text-white shadow-md'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Tomorrow ({formatDatePretty(tomorrowDateStr).split(',')[0]})
          </button>
          <button
            onClick={() => setDate(todayDateStr)}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              isToday
                ? 'bg-amber-500 text-white shadow-md'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Today ({formatDatePretty(todayDateStr).split(',')[0]})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus:outline-hidden"
          />
        </div>
      </div>

      {/* Printable Sheet Header */}
      <div className="hidden print:block text-center border-b pb-4 mb-4">
        <h1 className="text-xl font-black text-black">
          SCHOOL-BITE CANTEEN — KITCHEN PRODUCTION SHEET
        </h1>
        <p className="text-sm font-bold text-gray-700 mt-1">
          Meal Date: {formatDatePretty(date)} | Total Portions: {kitchenData?.totalMeals || 0}
        </p>
      </div>

      {loading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* CORE SECTION 1: Kitchen Production Table & Cards (Requirement 4) */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 sm:p-6 bg-gradient-to-r from-amber-500 to-amber-600 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-100">
                  {isTomorrow ? "TOMORROW'S PRODUCTION" : isToday ? "TODAY'S PRODUCTION" : 'MEAL PRODUCTION'}
                </span>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight mt-0.5">
                  {formatDatePretty(date)}
                </h2>
                <p className="text-xs text-amber-100 mt-1">
                  Total food items to prepare: <strong className="text-white text-sm">{kitchenData?.totalMeals || 0}</strong> portions across <strong className="text-white text-sm">{kitchenData?.totalOrders || 0}</strong> confirmed student orders.
                </p>
              </div>
            </div>

            {/* Production Summary Cards - Large, readable numbers for mobile kitchen staff */}
            <div className="p-4 sm:p-6 space-y-4">
              {/* Category Breakdown Badges */}
              {kitchenData?.studentCategoryBreakdown && (
                <div className="flex flex-wrap items-center gap-3 p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl">
                  <span className="text-[11px] font-black uppercase text-amber-900 tracking-wider">
                    Category Breakdown:
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-1 bg-white border border-amber-200 text-amber-900 rounded-xl text-xs font-bold shadow-2xs">
                      Pre-primary: <strong className="text-amber-600">{kitchenData.studentCategoryBreakdown.PRE_PRIMARY || 0}</strong>
                    </span>
                    <span className="px-2.5 py-1 bg-white border border-amber-200 text-amber-900 rounded-xl text-xs font-bold shadow-2xs">
                      Primary: <strong className="text-amber-600">{kitchenData.studentCategoryBreakdown.PRIMARY || 0}</strong>
                    </span>
                    <span className="px-2.5 py-1 bg-white border border-amber-200 text-amber-900 rounded-xl text-xs font-bold shadow-2xs">
                      Secondary: <strong className="text-amber-600">{kitchenData.studentCategoryBreakdown.SECONDARY || 0}</strong>
                    </span>
                  </div>
                </div>
              )}

              {(!kitchenData?.mealCounts || kitchenData.mealCounts.length === 0) ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <UtensilsCrossed className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="text-sm font-bold text-slate-600">No Orders Placed for This Date</p>
                  <p className="text-xs text-slate-400">
                    No confirmed student meals have been ordered for {formatDatePretty(date)}.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {kitchenData.mealCounts.map((mc: any) => (
                    <div
                      key={mc.mealId}
                      className="bg-slate-50 hover:bg-amber-50/50 p-4 sm:p-5 rounded-2xl border border-slate-200 hover:border-amber-300 transition-all flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <VegBadge isVegetarian={mc.isVegetarian} size="sm" />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {mc.category}
                          </span>
                        </div>
                        <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                          {mc.mealName}
                        </h3>
                        <p className="text-[11px] text-slate-500 font-semibold">
                          Need to prepare:
                        </p>
                      </div>

                      <div className="text-right pl-4">
                        <span className="text-3xl sm:text-4xl font-black text-amber-600 block tracking-tight">
                          {mc.count}
                        </span>
                        <span className="text-[11px] text-slate-400 font-bold uppercase">
                          Portions
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Clean summary table for printing */}
            {kitchenData?.mealCounts && kitchenData.mealCounts.length > 0 && (
              <div className="border-t border-slate-200 px-4 sm:px-6 py-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-2">Food Item</th>
                      <th className="py-2">Category</th>
                      <th className="py-2 text-right">Total Quantity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kitchenData.mealCounts.map((mc: any) => (
                      <tr key={mc.mealId} className="font-semibold text-slate-800">
                        <td className="py-2.5 flex items-center gap-2 font-bold text-sm">
                          <VegBadge isVegetarian={mc.isVegetarian} size="sm" />
                          <span>{mc.mealName}</span>
                        </td>
                        <td className="py-2.5 text-slate-500">{mc.category}</td>
                        <td className="py-2.5 text-right font-black text-base text-amber-600">
                          {mc.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* SECTION 2: Classroom & Student Distribution Roster */}
          {kitchenData?.studentList && kitchenData.studentList.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden print:mt-6">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-500" />
                    <span>Student Distribution Roster ({kitchenData.studentList.length} Students)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Organized for canteen pickup and classroom meal distribution.
                  </p>
                </div>
              </div>

              {/* Classroom breakdown pills */}
              {kitchenData.classBreakdown && kitchenData.classBreakdown.length > 0 && (
                <div className="p-4 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-2 text-xs">
                  {kitchenData.classBreakdown.map((cb: any, i: number) => (
                    <div
                      key={i}
                      className="inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 font-bold"
                    >
                      <span>{cb.classDivision}:</span>
                      <span className="text-amber-600 font-extrabold">{cb.count} meals</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Student table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[600px]">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase font-bold text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4">Student</th>
                      <th className="py-2.5 px-4">Class</th>
                      <th className="py-2.5 px-4">Roll No</th>
                      <th className="py-2.5 px-4">Meal Ordered</th>
                      <th className="py-2.5 px-4 text-center">Qty</th>
                      <th className="py-2.5 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kitchenData.studentList.map((s: any, idx: number) => {
                      const statusStyle = getOrderStatusColor(s.orderStatus);
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="py-3 px-4 font-bold text-slate-900">
                            {s.studentName}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-700">
                            Class {s.grade}-{s.division}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600">
                            {s.rollNo || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 font-bold text-slate-800">
                              <VegBadge isVegetarian={s.isVegetarian} size="sm" />
                              <span>{s.mealName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center font-extrabold text-amber-600">
                            {s.quantity}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusStyle.bg}`}
                            >
                              {statusStyle.text}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function KitchenPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <KitchenPageContent />
    </Suspense>
  );
}
