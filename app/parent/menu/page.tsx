'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CalendarDays,
  Clock,
  AlertCircle,
  Plus,
  Minus,
  ArrowRight,
  FileText,
  ShoppingCart,
  Search,
  X,
  Utensils,
  Calendar,
  Sparkles,
  Info,
  CheckCircle2,
  CalendarOff,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { useCart } from '@/components/CartContext';
import { useToast } from '@/components/ToastContext';
import { useChildren } from '@/components/ChildrenContext';
import { useSyncWatcher } from '@/lib/client-sync';
import VegBadge from '@/components/VegBadge';
import ChildAvatar from '@/components/ChildAvatar';
import MealIcon from '@/components/MealIcon';
import MealCategoryBadge from '@/components/MealCategoryBadge';
import {
  formatINR,
  formatDatePretty,
  getTodayString,
  getOffsetDateString,
  isDeadlinePassed,
  APP_TIMEZONE,
} from '@/lib/utils';
import {
  OCTOBER_2026_TIMETABLE,
  STUDENT_CATEGORIES,
  getStudentCategory,
  StudentCategory,
} from '@/lib/october-2026-timetable';

function MenuPageContent() {
  const searchParams = useSearchParams();
  const preselectedChildId = searchParams.get('childId');
  const urlDateParam = searchParams.get('date');

  const { addToCart, updateQuantity, cartItems, totalItems, subtotal } = useCart();
  const { showToast } = useToast();
  const {
    children,
    isLoading: childrenLoading,
    selectedChildId,
    setSelectedChildId,
    selectedChild,
  } = useChildren();

  const todayStr = useMemo(() => getTodayString(APP_TIMEZONE), []);
  const tomorrowStr = useMemo(() => getOffsetDateString(1, APP_TIMEZONE), []);

  // Selected date state (defaults to URL param or tomorrow)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (urlDateParam && /^\d{4}-\d{2}-\d{2}$/.test(urlDateParam)) {
      return urlDateParam;
    }
    return tomorrowStr;
  });

  const [menus, setMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);
  const [timetableCategoryTab, setTimetableCategoryTab] = useState<StudentCategory>('Primary');

  // Handle URL child selection
  useEffect(() => {
    if (preselectedChildId && children.some((c) => c.id === preselectedChildId)) {
      setSelectedChildId(preselectedChildId);
    }
  }, [preselectedChildId, children, setSelectedChildId]);

  // Derive selected child's category
  const activeStudentCategory: StudentCategory = useMemo(() => {
    if (!selectedChild) return 'Primary';
    return getStudentCategory(selectedChild.grade, selectedChild.studentCategory);
  }, [selectedChild]);

  // Keep timetable modal tab aligned with active child's category
  useEffect(() => {
    setTimetableCategoryTab(activeStudentCategory);
  }, [activeStudentCategory]);

  // Fetch menu for selected date & child's category
  const fetchMenuForDate = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('date', selectedDate);
      if (selectedChildId) queryParams.append('childId', selectedChildId);
      queryParams.append('category', activeStudentCategory);

      const res = await fetch(`/api/menu?${queryParams.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setMenus(data.menus || []);
      }
    } catch (err) {
      console.error('Failed to fetch menu:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    if (childrenLoading && !selectedChildId) return;
    fetchMenuForDate();
  }, [selectedDate, selectedChildId, activeStudentCategory, childrenLoading]);

  // Real-time synchronization
  useSyncWatcher({
    onMenuUpdate: () => {
      fetchMenuForDate(true);
    },
  });

  const isPastDate = selectedDate < todayStr;
  const isToday = selectedDate === todayStr;

  const executeAddToCart = (menuItem: any, date: string, hasConflict: boolean, matchingAllergens: string[]) => {
    if (!selectedChild) return;

    addToCart({
      studentId: selectedChild.id,
      studentName: selectedChild.name,
      studentGrade: selectedChild.grade,
      studentDivision: selectedChild.division,
      studentCategory: activeStudentCategory,
      mealId: menuItem.meal.id,
      mealName: menuItem.meal.name,
      mealPrice: menuItem.meal.price,
      mealCategory: menuItem.meal.category,
      mealImage: null,
      isVegetarian: menuItem.meal.isVegetarian,
      date,
      quantity: 1,
      orderingDeadline: menuItem.orderingDeadline,
      hasAllergyAlert: hasConflict,
      conflictAllergens: matchingAllergens,
    });

    showToast(
      `Added ${menuItem.meal.name} for ${selectedChild.name.split(' ')[0]} (${activeStudentCategory})!`,
      hasConflict ? 'info' : 'success'
    );
  };

  const handleSelectMeal = (menuItem: any, date: string) => {
    if (!selectedChild) {
      showToast('Please select a child first', 'error');
      return;
    }

    if (isPastDate) {
      showToast('Ordering is closed for past dates', 'error');
      return;
    }

    if (menuItem.isHoliday) {
      showToast('School is closed for brunch on this date (Holiday)', 'error');
      return;
    }

    if (menuItem.availableQuantity <= 0) {
      showToast('Sorry, this meal is sold out for this date', 'error');
      return;
    }

    if (isDeadlinePassed(date, menuItem.orderingDeadline)) {
      showToast(`Ordering deadline (${menuItem.orderingDeadline}) for this meal has passed`, 'error');
      return;
    }

    executeAddToCart(menuItem, date, false, []);
  };

  // Filter menus based on search
  const filteredMenus = menus.filter((menuItem) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const name = (menuItem.meal?.name || '').toLowerCase();
    return name.includes(q);
  });

  // Category styling tokens
  const categoryBadgeStyles = {
    'Pre-primary': 'bg-purple-100 text-purple-800 border-purple-200',
    Primary: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Secondary: 'bg-amber-100 text-amber-800 border-amber-200',
  };

  return (
    <div
      className={`max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6 ${
        totalItems > 0 ? 'pb-36 sm:pb-40 md:pb-28' : 'pb-20'
      }`}
    >
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-amber-500 to-orange-500 text-white uppercase tracking-wider">
              October 2026 Timetable
            </span>
            <span className="text-xs font-semibold text-slate-500">
              School Brunch Schedule
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2 mt-1">
            <CalendarDays className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500 shrink-0" />
            <span>School Brunch Menu</span>
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
            Viewing menu for <strong className="text-slate-800 font-bold">{formatDatePretty(selectedDate)}</strong> • Nutritious meals for S.B. Patil School students.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsTimetableModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>October Timetable</span>
          </button>

          <Link
            href="/parent/orders"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300 rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-amber-500" />
            <span>My Orders</span>
          </Link>
        </div>
      </div>

      {/* Child Selector Strip with Student Category Badge */}
      <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/5 border border-amber-200 p-3 sm:p-4 rounded-2xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
              ORDER RECIPIENT
            </span>
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
              Select child to view category-specific menu
            </h3>
          </div>

          {childrenLoading ? (
            <div className="flex items-center gap-2 py-1">
              <div className="h-8 w-28 bg-amber-200/50 rounded-xl animate-pulse" />
              <div className="h-8 w-28 bg-amber-200/30 rounded-xl animate-pulse" />
            </div>
          ) : children.length === 0 ? (
            <div className="text-xs text-rose-600 font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>You have not registered any children yet.</span>
              <Link
                href="/parent/children"
                className="px-2.5 py-1 bg-amber-500 text-white rounded-lg text-xs font-bold"
              >
                Register Child
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {children.map((child) => {
                const isSelected = selectedChildId === child.id;
                const cat = getStudentCategory(child.grade, child.studentCategory);

                return (
                  <button
                    key={child.id}
                    onClick={() => setSelectedChildId(child.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white border-amber-500 shadow-xs ring-2 ring-amber-500/30'
                        : 'bg-white/80 border-slate-200 hover:bg-white text-slate-700'
                    }`}
                  >
                    <ChildAvatar size="sm" />
                    <div className="text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 block leading-tight">{child.name}</span>
                        <span className={`px-1.5 py-0.2 rounded-md text-[9px] font-black uppercase ${categoryBadgeStyles[cat]}`}>
                          {cat}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium">Class {child.grade}-{child.division}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedChild && (
          <div className="pt-2 border-t border-amber-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-600">
            <div>
              <span className="font-semibold text-slate-700">Active Student: </span>
              <strong className="text-slate-900">{selectedChild.name}</strong> • Class {selectedChild.grade}-{selectedChild.division}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Student Category:</span>
              <span className={`px-2 py-0.5 rounded-md font-extrabold text-[10px] uppercase border ${categoryBadgeStyles[activeStudentCategory]}`}>
                {activeStudentCategory}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Date Navigator Bar across October 2026 */}
      <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
              Select Brunch Date (October 2026)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold text-slate-500">Jump to Date:</label>
            <input
              type="date"
              min="2026-10-01"
              max="2026-10-31"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              className="px-2.5 py-1 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-hidden focus:border-amber-500"
            />
          </div>
        </div>

        {/* Horizontal Quick Date Chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
          {OCTOBER_2026_TIMETABLE.map((entry) => {
            const isSel = entry.date === selectedDate;
            const isEntryPast = entry.date < todayStr;
            const isEntryToday = entry.date === todayStr;
            const catMenu = entry.menus[activeStudentCategory];
            const isHol = catMenu.isHoliday;

            // Day number and short day name
            const dayNum = entry.date.split('-')[2];
            const shortDay = entry.day.slice(0, 3);

            let chipStyle = 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100';
            if (isSel) {
              chipStyle = 'bg-amber-500 text-white border-amber-600 shadow-xs ring-2 ring-amber-500/30';
            } else if (isHol) {
              chipStyle = 'bg-rose-50/60 border-rose-200 text-rose-700 hover:bg-rose-100/60';
            } else if (isEntryToday) {
              chipStyle = 'bg-blue-50/80 border-blue-200 text-blue-800 hover:bg-blue-100';
            } else if (isEntryPast) {
              chipStyle = 'bg-slate-100/50 border-slate-200 text-slate-400 hover:bg-slate-100';
            }

            return (
              <button
                key={entry.date}
                type="button"
                onClick={() => setSelectedDate(entry.date)}
                className={`flex flex-col items-center justify-center min-w-[62px] px-2 py-1.5 rounded-xl border text-center transition-all cursor-pointer shrink-0 ${chipStyle}`}
                title={`${entry.day}, ${entry.displayDate}: ${catMenu.dish}`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">{shortDay}</span>
                <span className="text-sm font-black leading-tight">{dayNum}</span>
                <span className="text-[8px] font-semibold mt-0.5 leading-none">
                  {isHol ? 'Holiday' : isEntryToday ? 'Today' : isEntryPast ? 'Past' : 'Open'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Menu & Availability Status for Selected Date */}
      <div className="space-y-4">
        {loading ? (
          <div className="min-h-[30vh] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : menus.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center space-y-3 max-w-md mx-auto">
            <Clock className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-800">No Meals Published For {formatDatePretty(selectedDate)}</h3>
            <p className="text-xs text-slate-500">
              Please choose another date or inspect the full October timetable.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {menus.map((menuItem) => {
              const isHoliday = Boolean(menuItem.isHoliday);
              const holidayReason = menuItem.holidayReason || 'School Holiday';
              const isSoldOut = !isHoliday && !isPastDate && menuItem.availableQuantity <= 0;
              const deadlinePassed = !isHoliday && isDeadlinePassed(selectedDate, menuItem.orderingDeadline);
              const isOrderable = !isHoliday && !isPastDate && !isSoldOut && !deadlinePassed;

              const inCart = cartItems.find(
                (c) =>
                  c.mealId === menuItem.meal.id &&
                  c.date === selectedDate &&
                  c.studentId === selectedChildId
              );

              // 1. HOLIDAY DISPLAY CARD
              if (isHoliday) {
                return (
                  <div
                    key={menuItem.id}
                    className="bg-gradient-to-br from-rose-50 via-orange-50/50 to-amber-50 rounded-3xl p-6 sm:p-8 border border-rose-200/80 shadow-sm text-center max-w-xl mx-auto space-y-4 animate-in fade-in duration-150"
                  >
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shadow-inner">
                      <CalendarOff className="w-7 h-7" />
                    </div>

                    <div className="space-y-1.5">
                      <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200">
                        Holiday — No Brunch
                      </span>
                      <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900">
                        {holidayReason}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto">
                        The school canteen is closed for brunch on {formatDatePretty(selectedDate)} for{' '}
                        <strong className="text-slate-800">{activeStudentCategory}</strong>. No meal booking is required.
                      </p>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => setSelectedDate(tomorrowStr)}
                        className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Calendar className="w-3.5 h-3.5 text-amber-500" />
                        <span>Switch to Next School Day</span>
                      </button>
                    </div>
                  </div>
                );
              }

              // 2. ACTIVE OR PAST MEAL DISPLAY CARD
              return (
                <div
                  key={menuItem.id}
                  className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/90 shadow-sm hover:shadow-md transition-all max-w-2xl mx-auto space-y-5"
                >
                  {/* Top Status Strip */}
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <MealCategoryBadge category={menuItem.meal.category} size="md" />
                      <VegBadge isVegetarian={menuItem.meal.isVegetarian} size="md" />
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${categoryBadgeStyles[activeStudentCategory]}`}>
                        {activeStudentCategory} Section
                      </span>
                    </div>

                    {isPastDate ? (
                      <span className="px-2.5 py-1 text-[10px] font-bold bg-slate-100 text-slate-600 rounded-full">
                        Past Date
                      </span>
                    ) : isToday ? (
                      <span className="px-2.5 py-1 text-[10px] font-bold bg-blue-100 text-blue-800 rounded-full">
                        Today&apos;s Meal
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full">
                        Upcoming Brunch
                      </span>
                    )}
                  </div>

                  {/* Meal Header + Name + Price */}
                  <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 border border-amber-200/80 flex items-center justify-center shrink-0 p-2 shadow-inner">
                      <MealIcon name={menuItem.meal.name} category={menuItem.meal.category} size="md" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">
                        {menuItem.meal.name}
                      </h2>
                      <p className="text-xs text-slate-500 line-clamp-2">
                        {menuItem.meal.description}
                      </p>
                      <div className="pt-1 flex items-baseline gap-2 justify-center sm:justify-start">
                        <span className="text-xl sm:text-2xl font-black text-amber-600">
                          {formatINR(menuItem.meal.price)}
                        </span>
                        <span className="text-[11px] font-bold text-slate-400">per portion</span>
                      </div>
                    </div>
                  </div>

                  {/* Ingredients & Nutritional details */}
                  {menuItem.meal.ingredients && (
                    <div className="bg-slate-50 rounded-2xl p-3 sm:p-4 text-xs space-y-1.5 border border-slate-100">
                      <div className="flex items-center gap-1.5 font-bold text-slate-700">
                        <Info className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>Ingredients & Nutrition:</span>
                      </div>
                      <p className="text-slate-600 leading-relaxed text-[11px]">
                        {menuItem.meal.ingredients}
                      </p>
                      {menuItem.meal.allergens && (
                        <p className="text-[11px] text-amber-800 font-medium pt-0.5">
                          <strong>Contains allergens:</strong> {menuItem.meal.allergens}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Allergy conflict warning */}
                  {menuItem.allergyEvaluation?.hasConflict && (
                    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 flex items-start gap-2.5 text-xs text-rose-800 font-medium">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>Allergy Alert:</strong> Child profile notes sensitivity to{' '}
                        <span className="font-bold underline">
                          {menuItem.allergyEvaluation.matchingAllergens?.join(', ')}
                        </span>.
                      </div>
                    </div>
                  )}

                  {/* Bottom Action Area */}
                  <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {isPastDate ? (
                        <span>Ordering closed for this date</span>
                      ) : deadlinePassed ? (
                        <span className="text-rose-600 font-semibold">Morning deadline ({menuItem.orderingDeadline} AM) passed</span>
                      ) : (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Freshly prepared • {menuItem.availableQuantity} portions available
                        </span>
                      )}
                    </div>

                    <div>
                      {isPastDate ? (
                        <button
                          disabled
                          className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 text-slate-400 font-bold rounded-xl text-xs cursor-not-allowed"
                        >
                          Past Date — Closed
                        </button>
                      ) : deadlinePassed ? (
                        <button
                          disabled
                          className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 text-slate-400 font-bold rounded-xl text-xs cursor-not-allowed"
                        >
                          Deadline Passed
                        </button>
                      ) : isSoldOut ? (
                        <button
                          disabled
                          className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 text-slate-400 font-bold rounded-xl text-xs cursor-not-allowed"
                        >
                          Sold Out
                        </button>
                      ) : inCart ? (
                        <div className="flex items-center justify-between sm:justify-start gap-2 bg-amber-50 border border-amber-300 rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => updateQuantity(inCart.cartItemId, inCart.quantity - 1)}
                            className="w-8 h-8 rounded-lg bg-white border border-amber-200 text-amber-900 font-bold hover:bg-amber-100 flex items-center justify-center cursor-pointer transition-colors shadow-2xs"
                            title="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-black text-amber-900 px-2">
                            {inCart.quantity} in cart
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (inCart.quantity >= menuItem.availableQuantity) {
                                showToast(`Only ${menuItem.availableQuantity} portions available`, 'error');
                                return;
                              }
                              updateQuantity(inCart.cartItemId, inCart.quantity + 1);
                            }}
                            className="w-8 h-8 rounded-lg bg-amber-500 text-white font-bold hover:bg-amber-600 flex items-center justify-center cursor-pointer transition-colors shadow-2xs"
                            title="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectMeal(menuItem, selectedDate)}
                          className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-[0.98] text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Add to Cart</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FULL OCTOBER 2026 TIMETABLE MODAL */}
      {isTimetableModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-100">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800">
                  Official Timetable
                </span>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 mt-1">
                  October 2026 Brunch Schedule
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any upcoming date to quickly select and order that day&apos;s meal.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsTimetableModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="p-3 sm:p-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2 overflow-x-auto">
              <span className="text-xs font-bold text-slate-500 shrink-0">Student Category:</span>
              {STUDENT_CATEGORIES.map((cat) => {
                const isTabActive = timetableCategoryTab === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setTimetableCategoryTab(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                      isTabActive
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Timetable Table List */}
            <div className="p-3 sm:p-6 overflow-y-auto flex-1 divide-y divide-slate-100 space-y-1">
              {OCTOBER_2026_TIMETABLE.map((entry) => {
                const catMenu = entry.menus[timetableCategoryTab];
                const isHol = catMenu.isHoliday;
                const isDatePast = entry.date < todayStr;
                const isSelected = entry.date === selectedDate;

                return (
                  <div
                    key={entry.date}
                    className={`p-3 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all ${
                      isSelected
                        ? 'bg-amber-50 border border-amber-200'
                        : isHol
                        ? 'bg-rose-50/40 text-rose-900'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-[70px]">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">{entry.day}</span>
                        <span className="text-sm font-black text-slate-800">{entry.displayDate}</span>
                      </div>

                      <div className="flex-1">
                        {isHol ? (
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-100 text-rose-800">
                              Holiday — No Brunch
                            </span>
                            <span className="text-xs font-bold text-slate-700">
                              {catMenu.holidayReason || catMenu.dish}
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="text-xs sm:text-sm font-extrabold text-slate-900 block">
                              {catMenu.dish}
                            </span>
                            <span className="text-[10px] text-slate-400 font-semibold">
                              Nutritious School Brunch • Pure Veg (₹80)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="self-end sm:self-auto">
                      {!isHol && !isDatePast ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDate(entry.date);
                            setIsTimetableModalOpen(false);
                          }}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                        >
                          Select Date
                        </button>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-400 px-2 py-1">
                          {isHol ? 'No Brunch' : 'Past Date'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 border-t border-slate-100 bg-slate-50 rounded-b-3xl flex justify-end">
              <button
                type="button"
                onClick={() => setIsTimetableModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Mobile Floating Order Summary Bar */}
      {totalItems > 0 && (
        <div className="fixed bottom-[58px] md:bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-amber-200 px-3 py-2 sm:px-6 sm:py-3 shadow-[0_-8px_20px_rgba(0,0,0,0.1)]">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-wider block leading-tight">
                  {totalItems} {totalItems === 1 ? 'Meal' : 'Meals'}
                </span>
                <p className="text-sm sm:text-lg font-black text-slate-900 leading-tight">
                  {formatINR(subtotal)}
                </p>
              </div>
            </div>

            <Link
              href="/parent/cart"
              className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-[0.98] text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md shadow-amber-500/25 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <span>View Cart & Pay</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MenuPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MenuPageContent />
    </Suspense>
  );
}
