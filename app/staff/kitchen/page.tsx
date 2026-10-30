'use client';

import React, { useEffect, useRef, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  CalendarOff,
  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar,
  UtensilsCrossed,
  Layers,
  ChevronDown,
  ChevronUp,
  Search,
  Plus,
  Edit2,
  X,
  Loader2,
  RefreshCw,
  Info,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Check,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import MealIcon from '@/components/MealIcon';
import MealCategoryBadge from '@/components/MealCategoryBadge';
import { formatDatePretty, getTodayString, getOffsetDateString, formatINR } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';
import { useSyncWatcher, broadcastSyncEvent } from '@/lib/client-sync';
import { MealData } from '@/types';
import {
  OCTOBER_2026_TIMETABLE,
  OCTOBER_2026_MEAL_CATALOG,
  StudentCategory,
} from '@/lib/october-2026-timetable';
import { displayMenuEntry } from '@/lib/menu-entries';

function StaffKitchenContent() {
  const { showToast } = useToast();
  const [todayDateStr, setTodayDateStr] = useState(() => getTodayString());
  const [tomorrowDateStr, setTomorrowDateStr] = useState(() => getOffsetDateString(1));
  const [selectedDateStr, setSelectedDateStr] = useState(() => getTodayString());
  const [selectedStudentCategory, setSelectedStudentCategory] = useState<string>('ALL');
  const [currentDayMenus, setCurrentDayMenus] = useState<any[]>([]);
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);
  const [isCatalogExpanded, setIsCatalogExpanded] = useState(false);

  // --- Master Recipe Catalog State ---
  const [allMeals, setAllMeals] = useState<MealData[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState('ALL');

  // --- Add Food Item Modal State ---
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newMealName, setNewMealName] = useState('');
  const [newMealCategory, setNewMealCategory] = useState('LUNCH');
  const [newMealPrice, setNewMealPrice] = useState('80');
  const [newMealIsVeg, setNewMealIsVeg] = useState(true);
  const [creatingMeal, setCreatingMeal] = useState(false);
  // Shown inside the modal: the app's toasts are silent, so errors must be visible here.
  const [addMealError, setAddMealError] = useState('');
  // Blocks a second submit before React re-renders the disabled button (fast double click).
  const addMealInFlight = useRef(false);

  // --- Put a catalog recipe on the menu for the selected date ---
  const [assignCategory, setAssignCategory] = useState<StudentCategory | 'ALL'>('Primary');
  const [assignMealId, setAssignMealId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // --- Edit Food Item Modal State ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<MealData | null>(null);
  const [editMealName, setEditMealName] = useState('');
  const [editMealCategory, setEditMealCategory] = useState('LUNCH');
  const [editMealPrice, setEditMealPrice] = useState('80');
  const [editMealIsVeg, setEditMealIsVeg] = useState(true);
  const [updatingMeal, setUpdatingMeal] = useState(false);

  // Fetch Master Menu Catalog & Active Database Menus for selected date & category
  const fetchMenuData = async (targetDate?: string, targetCategory?: string) => {
    const queryDate = targetDate || selectedDateStr;
    const queryCat = targetCategory !== undefined ? targetCategory : selectedStudentCategory;
    setLoadingMeals(true);
    try {
      const catParam = queryCat && queryCat !== 'ALL' ? `&category=${encodeURIComponent(queryCat)}` : '';
      const [mealsRes, menusRes] = await Promise.all([
        fetch('/api/admin/meals'),
        fetch(`/api/admin/menus?date=${queryDate}${catParam}`),
      ]);

      if (mealsRes.ok) {
        const data = await mealsRes.json();
        const catalog = (data.meals || []).filter(
          (m: any) => m.id !== 'meal_holiday_no_brunch' && !m.name.toLowerCase().includes('holiday')
        );
        setAllMeals(catalog);
      }

      if (menusRes.ok) {
        const menuData = await menusRes.json();
        setCurrentDayMenus(menuData.menus || []);
      }
    } catch (err) {
      console.error('Failed to load menu data:', err);
      showToast('Error loading timetable data', 'error');
    } finally {
      setLoadingMeals(false);
    }
  };

  useEffect(() => {
    fetchMenuData();
  }, [selectedDateStr, selectedStudentCategory]);

  // Live real-time synchronization
  useSyncWatcher({
    onMenuUpdate: () => {
      fetchMenuData();
    },
  });

  // Safe date rollover handler
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const scheduleMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 200);
      const msUntilMidnight = Math.max(500, nextMidnight.getTime() - now.getTime());

      timeoutId = setTimeout(() => {
        const newToday = getTodayString();
        const newTomorrow = getOffsetDateString(1);

        setTodayDateStr(newToday);
        setTomorrowDateStr(newTomorrow);

        showToast('12:00 AM Rollover: New school day active.', 'info');
        fetchMenuData(newToday);
        scheduleMidnight();
      }, msUntilMidnight);
    };

    scheduleMidnight();

    const intervalId = setInterval(() => {
      const currentToday = getTodayString();
      if (currentToday !== todayDateStr) {
        const newTomorrow = getOffsetDateString(1);
        setTodayDateStr(currentToday);
        setTomorrowDateStr(newTomorrow);
        fetchMenuData(currentToday);
      }
    }, 15000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [todayDateStr]);

  // Date status indicators
  const isPastDate = selectedDateStr < todayDateStr;
  const isToday = selectedDateStr === todayDateStr;
  const isTomorrow = selectedDateStr === tomorrowDateStr;

  // Authoritative entry from October 2026 Timetable
  const officialDayEntry = useMemo(() => {
    return OCTOBER_2026_TIMETABLE.find((d) => d.date === selectedDateStr);
  }, [selectedDateStr]);

  // Categories to display based on filter
  const categoriesToDisplay: StudentCategory[] = useMemo(() => {
    if (selectedStudentCategory === 'Pre-primary') return ['Pre-primary'];
    if (selectedStudentCategory === 'Primary') return ['Primary'];
    if (selectedStudentCategory === 'Secondary') return ['Secondary'];
    return ['Pre-primary', 'Primary', 'Secondary'];
  }, [selectedStudentCategory]);

  // Recipe Catalog filtering
  const filteredCatalogMeals = useMemo(() => {
    return allMeals.filter((meal) => {
      const matchesSearch =
        !catalogSearch.trim() ||
        meal.name.toLowerCase().includes(catalogSearch.toLowerCase().trim());
      const cat = (meal.category || 'LUNCH').toUpperCase().trim();
      const displayCat = cat === 'SNACK' ? 'BREAKFAST' : cat;
      const matchesCategory =
        catalogCategoryFilter === 'ALL' || displayCat === catalogCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [allMeals, catalogSearch, catalogCategoryFilter]);

  // Add New Food Item
  const handleCreateNewMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addMealInFlight.current) return;
    const cleanName = newMealName.trim().replace(/\s+/g, ' ');
    const priceNum = Number(newMealPrice);

    if (cleanName.length < 2) {
      setAddMealError('Please enter a recipe name (at least 2 characters).');
      return;
    }
    if (!newMealPrice.trim() || !Number.isFinite(priceNum) || priceNum <= 0 || priceNum > 10000) {
      setAddMealError('Please enter a valid rate greater than ₹0 (up to ₹10,000).');
      return;
    }

    addMealInFlight.current = true;
    setAddMealError('');
    setCreatingMeal(true);
    try {
      const res = await fetch('/api/admin/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          category: newMealCategory.toUpperCase().trim(),
          price: priceNum,
          isVegetarian: newMealIsVeg,
          description: `${cleanName} - Prepared fresh at school canteen`,
        }),
      });
      // Error pages (e.g. a gateway timeout) may not be JSON.
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.meal) {
        const createdMeal: MealData = data.meal;
        setAllMeals((prev) => [createdMeal, ...prev.filter((m) => m.id !== createdMeal.id)]);
        showToast(`"${createdMeal.name}" added to master recipe catalog!`, 'success');
        setIsAddModalOpen(false);
        setNewMealName('');
        setNewMealPrice('80');
        setNewMealIsVeg(true);
        // Other screens refresh, and this page's sync watcher reloads the catalog from the server.
        broadcastSyncEvent('MENU_UPDATED');
      } else if (res.status === 401 || res.status === 403) {
        setAddMealError('Your session does not allow adding recipes. Please sign in again as canteen staff.');
      } else {
        setAddMealError(data.error || `The recipe could not be saved (error ${res.status}). Please try again.`);
      }
    } catch {
      setAddMealError('Could not reach the server. Check the connection and try again.');
    } finally {
      addMealInFlight.current = false;
      setCreatingMeal(false);
    }
  };

  // Publish an existing catalog recipe (same ID and price) for one date and category.
  const handleAssignRecipe = async (replace = false) => {
    if (!assignMealId) {
      setAssignMessage({ ok: false, text: 'Choose a recipe from the catalog first.' });
      return;
    }
    setAssigning(true);
    setAssignMessage(null);
    try {
      const res = await fetch('/api/admin/menus/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDateStr, studentCategory: assignCategory, mealId: assignMealId, replace }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAssignMessage({ ok: true, text: data.message || 'Menu published.' });
        broadcastSyncEvent('MENU_UPDATED');
      } else if (data.code === 'NEEDS_REPLACE' && !replace) {
        setAssigning(false);
        if (window.confirm(`${data.error}\n\nReplace it?`)) await handleAssignRecipe(true);
        return;
      } else {
        setAssignMessage({ ok: false, text: data.error || `The menu could not be saved (error ${res.status}).` });
      }
    } catch {
      setAssignMessage({ ok: false, text: 'Could not reach the server. Check the connection and try again.' });
    } finally {
      setAssigning(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (meal: MealData, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingMeal(meal);
    setEditMealName(meal.name);
    setEditMealCategory(meal.category || 'LUNCH');
    setEditMealPrice(String(meal.price || 80));
    setEditMealIsVeg(meal.isVegetarian);
    setIsEditModalOpen(true);
  };

  // Save Edit Food Item
  const handleUpdateMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMeal) return;

    const cleanName = editMealName.trim();
    const priceNum = parseFloat(editMealPrice);

    if (!cleanName) {
      showToast('Item name cannot be empty', 'error');
      return;
    }
    if (isNaN(priceNum) || priceNum <= 0) {
      showToast('Please enter a valid price greater than 0', 'error');
      return;
    }

    setUpdatingMeal(true);
    try {
      const res = await fetch('/api/admin/meals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingMeal.id,
          name: cleanName,
          category: editMealCategory.toUpperCase().trim(),
          price: priceNum,
          isVegetarian: editMealIsVeg,
        }),
      });

      if (res.ok) {
        showToast(`"${cleanName}" updated successfully!`, 'success');
        setAllMeals((prev) =>
          prev.map((m) =>
            m.id === editingMeal.id
              ? {
                  ...m,
                  name: cleanName,
                  category: editMealCategory.toUpperCase().trim(),
                  price: priceNum,
                  isVegetarian: editMealIsVeg,
                }
              : m
          )
        );
        setIsEditModalOpen(false);
        setEditingMeal(null);
        broadcastSyncEvent('MENU_UPDATED');
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to update recipe', 'error');
      }
    } catch {
      showToast('Network error updating recipe', 'error');
    } finally {
      setUpdatingMeal(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6 pb-24">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER BANNER: Authoritative Timetable Dashboard                   */}
      {/* ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-white shadow-xs">
              Official Timetable
            </span>
            <span className="text-xs font-bold text-slate-500">
              School Brunch Timetable
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2 mt-1">
            <CalendarDays className="w-6 h-6 sm:w-7 sm:h-7 text-amber-500 shrink-0" />
            <span>Canteen Daily Production Schedule</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Daily brunch menu from the school&apos;s monthly timetable.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          <Link
            href="/staff/menu-import"
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2"
          >
            <CalendarDays className="w-4 h-4" />
            Upload monthly menu
          </Link>
          <button
            type="button"
            onClick={() => setIsTimetableModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
          >
            <Calendar className="w-4 h-4" />
            <span>Full Month Timetable (31 Days)</span>
          </button>

          <button
            type="button"
            onClick={() => fetchMenuData()}
            disabled={loadingMeals}
            className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs cursor-pointer"
            title="Refresh timetable data"
          >
            <RefreshCw
              className={`w-4 h-4 ${loadingMeals ? 'animate-spin text-amber-500' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. DATE & CATEGORY CONTROLS (Intuitive & Always Accessible)               */}
      {/* ========================================================================= */}
      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs">
          {/* Quick Date Selectors */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-slate-600 text-[11px] uppercase tracking-wider mr-1">
              Select Date:
            </span>
            <button
              type="button"
              onClick={() => setSelectedDateStr(todayDateStr)}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                isToday
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setSelectedDateStr(tomorrowDateStr)}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                isTomorrow
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Tomorrow
            </button>
            <input
              type="date"
              value={selectedDateStr}
              min="2026-01-01"
              max={getOffsetDateString(120)}
              onChange={(e) => setSelectedDateStr(e.target.value)}
              className="text-xs font-black text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-hidden focus:border-amber-500 cursor-pointer shadow-2xs"
            />
            <span className="text-xs font-bold text-slate-500 hidden sm:inline ml-1">
              ({formatDatePretty(selectedDateStr)})
            </span>
          </div>

          {/* Student Category Selector Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            <span className="font-black text-slate-600 text-[11px] uppercase tracking-wider mr-1 shrink-0">
              Category:
            </span>
            {[
              { id: 'ALL', label: 'All Categories' },
              { id: 'Pre-primary', label: 'Pre-primary' },
              { id: 'Primary', label: 'Primary' },
              { id: 'Secondary', label: 'Secondary' },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedStudentCategory(cat.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                  selectedStudentCategory === cat.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. SECTION A: OFFICIAL SCHEDULED MENU (PRIMARY & DOMINANT HERO INTERFACE) */}
      {/* ========================================================================= */}
      <section className="bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-white p-5 sm:p-7 rounded-3xl border-2 border-amber-300 shadow-md space-y-6">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-amber-200/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white uppercase tracking-wider">
                Official Daily Brunch Schedule
              </span>
              <span className="text-xs font-extrabold text-slate-600">
                {new Date(`${selectedDateStr}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
              <span>{formatDatePretty(selectedDateStr)}</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Saved schedule for this date. Active dishes can be ordered by parents until the ordering deadline.
            </p>
          </div>

          <div className="self-start sm:self-auto shrink-0">
            {isPastDate ? (
              <span className="px-3.5 py-1.5 bg-slate-100 text-slate-600 border border-slate-300 rounded-xl text-xs font-black inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Historical Timetable (Service Closed)</span>
              </span>
            ) : isToday ? (
              <span className="px-3.5 py-1.5 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-black inline-flex items-center gap-1.5 animate-pulse">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Today&apos;s Active Service</span>
              </span>
            ) : (
              <span className="px-3.5 py-1.5 bg-blue-100 text-blue-900 border border-blue-300 rounded-xl text-xs font-black inline-flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
                <span>Upcoming Scheduled Service</span>
              </span>
            )}
          </div>
        </div>

        {/* Category Cards Grid */}
        <div
          className={`grid gap-5 ${
            categoriesToDisplay.length > 1
              ? 'grid-cols-1 md:grid-cols-3'
              : 'grid-cols-1 max-w-2xl mx-auto'
          }`}
        >
          {categoriesToDisplay.map((cat) => {
            const officialMenu = officialDayEntry?.menus[cat];
            // The same entry parents see and can order (one dish per date and category).
            const dbMenu = displayMenuEntry(currentDayMenus, selectedDateStr, cat);

            // The saved menu is authoritative (it reflects imports and staff corrections); the
            // built-in October 2026 table is only a fallback for dates with no saved menu.
            const isHoliday = dbMenu ? Boolean(dbMenu.isHoliday) : Boolean(officialMenu?.isHoliday);
            const holidayReason =
              (dbMenu ? dbMenu.holidayReason : officialMenu?.holidayReason) || 'Holiday Today — No Brunch Scheduled';

            const dishName =
              dbMenu?.meal?.name && !dbMenu?.isHoliday
                ? dbMenu.meal.name
                : !dbMenu && officialMenu?.dish && !officialMenu.isHoliday
                ? officialMenu.dish
                : isHoliday
                ? 'Holiday Today — No Brunch Scheduled'
                : 'No menu published';
            // Parents can only order from a saved, active menu; the October table is reference only.
            const publishState = !dbMenu ? 'NOT_PUBLISHED' : dbMenu.isActive === false ? 'DISABLED' : 'PUBLISHED';

            // Lookup meal details from master catalog for ingredient notes
            const catalogMeal = OCTOBER_2026_MEAL_CATALOG.find(
              (m) => m.name.toLowerCase().trim() === dishName.toLowerCase().trim()
            ) || dbMenu?.meal;

            // Visual styling per student category
            const theme = {
              'Pre-primary': {
                border: 'border-purple-300',
                badgeBg: 'bg-purple-100 text-purple-900 border-purple-200',
                label: 'Pre-primary (Nursery & KG)',
              },
              Primary: {
                border: 'border-emerald-300',
                badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-200',
                label: 'Primary (Classes 1 - 5)',
              },
              Secondary: {
                border: 'border-amber-300',
                badgeBg: 'bg-amber-100 text-amber-900 border-amber-200',
                label: 'Secondary (Classes 6 - 10)',
              },
            }[cat];

            if (isHoliday) {
              return (
                <div
                  key={cat}
                  className={`p-5 sm:p-6 rounded-3xl border-2 bg-rose-50/70 border-rose-200 shadow-sm space-y-4 flex flex-col justify-between`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${theme.badgeBg}`}>
                        {theme.label}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200">
                        Holiday
                      </span>
                    </div>

                    <div className="pt-2 flex items-start gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 shadow-inner">
                        <CalendarOff className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
                          {holidayReason}
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          School is closed for brunch on this date for {cat}. No kitchen food preparation or student ordering is scheduled.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-rose-200/80 text-[11px] font-bold text-rose-700 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Canteen Closed for Brunch</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={cat}
                className={`p-5 sm:p-6 rounded-3xl border-2 bg-white ${theme.border} shadow-sm space-y-4 flex flex-col justify-between`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${theme.badgeBg}`}>
                      {theme.label}
                    </span>
                    <VegBadge isVegetarian={true} />
                  </div>

                  {/* Full Dish Name without unnecessary truncation */}
                  <div className="space-y-1.5 pt-1">
                    <h3 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
                      {dishName}
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {catalogMeal?.description || 'Freshly prepared wholesome school brunch.'}
                    </p>
                  </div>

                  {/* Scheduled Ingredients */}
                  {catalogMeal?.ingredients && (
                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Scheduled Recipe Ingredients:
                      </div>
                      <p className="text-xs text-slate-700 font-medium leading-relaxed">
                        {catalogMeal.ingredients}
                      </p>
                    </div>
                  )}

                  {/* Dietary Allergens */}
                  {catalogMeal?.allergens && (
                    <div className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                      Contains: {catalogMeal.allergens}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold">
                  {isPastDate ? (
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>Past Service (Closed)</span>
                    </span>
                  ) : publishState === 'PUBLISHED' ? (
                    <span className="text-emerald-700 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Published: parents can order</span>
                    </span>
                  ) : (
                    <span className="text-rose-700 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>{publishState === 'DISABLED' ? 'Disabled: parents cannot order' : 'Not published: parents cannot order'}</span>
                    </span>
                  )}
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg text-[10px] font-black uppercase tracking-wider">
                    {dbMenu ? 'Saved Menu' : 'Timetable Reference'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Put an existing catalog recipe on this date's menu */}
        {!isPastDate && (
          <div className="p-3.5 bg-white border border-amber-200 rounded-2xl space-y-2.5 text-xs">
            <p className="font-black text-slate-800">Publish a catalog recipe for {formatDatePretty(selectedDateStr)}</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={assignCategory}
                onChange={(e) => setAssignCategory(e.target.value as StudentCategory | 'ALL')}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900"
              >
                <option value="ALL">All categories</option>
                <option value="Pre-primary">Pre-primary</option>
                <option value="Primary">Primary</option>
                <option value="Secondary">Secondary</option>
              </select>
              <select
                value={assignMealId}
                onChange={(e) => setAssignMealId(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900"
              >
                <option value="">Choose a recipe…</option>
                {[...allMeals]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((meal) => (
                    <option key={meal.id} value={meal.id}>
                      {meal.name} · {formatINR(meal.price)}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => handleAssignRecipe()}
                disabled={assigning}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-black disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>{assigning ? 'Publishing…' : 'Publish for parents'}</span>
              </button>
            </div>
            {assignMessage && (
              <p role="status" className={`font-bold ${assignMessage.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                {assignMessage.text}
              </p>
            )}
          </div>
        )}

        {/* Operational Note for Kitchen Crew */}
        <div className="p-3.5 bg-amber-100/70 border border-amber-200/90 rounded-2xl flex items-start gap-3 text-xs text-amber-950 font-medium">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p>
            <strong>Canteen Team Notice:</strong> Parents can only order a dish that shows <em>Published</em> above. A dish marked <em>Timetable Reference</em> or <em>Not published</em> is not on sale: import the monthly menu, or publish a catalog recipe for that date above. You do <em>not</em> need to select items from the recipe catalog.
          </p>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. SECTION B: MASTER RECIPE CATALOG (SEPARATE & COLLAPSIBLE)              */}
      {/* ========================================================================= */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Collapsible Header */}
        <div
          onClick={() => setIsCatalogExpanded(!isCatalogExpanded)}
          className="p-5 sm:p-6 bg-slate-50/70 hover:bg-slate-100/70 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 select-none"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  Master Recipe Catalog & Culinary Reference
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-200 text-slate-700">
                  {allMeals.length} Recipes
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Kitchen culinary database for reviewing recipe ingredients and prep notes. (Does not override the daily timetable).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs font-bold text-slate-600">
              {isCatalogExpanded ? 'Hide Catalog' : 'View Catalog'}
            </span>
            <div className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600">
              {isCatalogExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>

        {/* Collapsible Content */}
        {isCatalogExpanded && (
          <div className="p-5 sm:p-6 space-y-5 animate-in fade-in duration-200">
            {/* Search, Filter, and Add Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Search Field */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search recipe catalog by dish name..."
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 focus:bg-white border border-slate-200 focus:border-amber-500 rounded-xl text-xs sm:text-sm font-semibold focus:outline-hidden text-slate-900 transition-all placeholder:text-slate-400"
                />
                {catalogSearch && (
                  <button
                    type="button"
                    onClick={() => setCatalogSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Add New Item Button */}
              <button
                type="button"
                onClick={() => {
                  setAddMealError('');
                  setIsAddModalOpen(true);
                }}
                className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs shrink-0"
              >
                <Plus className="w-4 h-4 text-amber-600" />
                <span>Add New Recipe</span>
              </button>
            </div>

            {/* Catalog Grid */}
            {loadingMeals ? (
              <div className="py-12 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredCatalogMeals.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
                <UtensilsCrossed className="w-8 h-8 mx-auto text-slate-300" />
                <h4 className="font-extrabold text-slate-700 text-sm">No Recipes Found</h4>
                <p className="text-xs text-slate-500">
                  {catalogSearch ? `No recipes match "${catalogSearch}".` : 'No recipes in catalog.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredCatalogMeals.map((meal) => (
                  <div
                    key={meal.id}
                    className="p-4 bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-xs transition-all flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          {meal.category || 'Lunch'}
                        </span>
                        <VegBadge isVegetarian={meal.isVegetarian} />
                      </div>

                      <h4 className="font-black text-sm text-slate-900 leading-snug">
                        {meal.name}
                      </h4>

                      {meal.ingredients && (
                        <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                          {meal.ingredients}
                        </p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-[11px] font-extrabold text-slate-700">
                        Authorized Rate: ₹{formatINR(meal.price || 80)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleOpenEdit(meal, e)}
                        className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        title="Edit recipe"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* MODAL: Full Month October 2026 Timetable                                  */}
      {/* ========================================================================= */}
      {isTimetableModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-100">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800">
                  Spreadsheet Timetable
                </span>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 mt-1">
                  October 2026 Brunch Timetable (All 31 Dates)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any date row to load that day&apos;s full schedule on the main kitchen view.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsTimetableModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content Table */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-3 flex-1">
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                {OCTOBER_2026_TIMETABLE.map((day) => {
                  const isDayPast = day.date < todayDateStr;
                  const isDayToday = day.date === todayDateStr;
                  const isSelected = day.date === selectedDateStr;

                  return (
                    <div
                      key={day.date}
                      onClick={() => {
                        setSelectedDateStr(day.date);
                        setIsTimetableModalOpen(false);
                      }}
                      className={`p-3.5 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                        isSelected
                          ? 'bg-amber-50/80 border-l-4 border-l-amber-500'
                          : isDayToday
                          ? 'bg-blue-50/60 border-l-4 border-l-blue-500'
                          : isDayPast
                          ? 'bg-slate-50/50 hover:bg-slate-100/60'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="w-36 shrink-0">
                        <div className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                          <span>{day.displayDate}</span>
                          <span className="text-[10px] text-slate-400">({day.day.slice(0, 3)})</span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                          {isDayToday ? 'Today' : isDayPast ? 'Historical' : 'Upcoming'}
                        </div>
                      </div>

                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        {/* Pre-primary */}
                        <div className="p-2 rounded-xl bg-purple-50/50 border border-purple-100/80">
                          <span className="text-[10px] font-black uppercase text-purple-700 block">Pre-primary:</span>
                          <span className={`text-[11px] font-bold ${day.menus['Pre-primary'].isHoliday ? 'text-rose-600' : 'text-slate-800'}`}>
                            {day.menus['Pre-primary'].dish}
                          </span>
                        </div>

                        {/* Primary */}
                        <div className="p-2 rounded-xl bg-emerald-50/50 border border-emerald-100/80">
                          <span className="text-[10px] font-black uppercase text-emerald-700 block">Primary:</span>
                          <span className={`text-[11px] font-bold ${day.menus.Primary.isHoliday ? 'text-rose-600' : 'text-slate-800'}`}>
                            {day.menus.Primary.dish}
                          </span>
                        </div>

                        {/* Secondary */}
                        <div className="p-2 rounded-xl bg-amber-50/50 border border-amber-100/80">
                          <span className="text-[10px] font-black uppercase text-amber-700 block">Secondary:</span>
                          <span className={`text-[11px] font-bold ${day.menus.Secondary.isHoliday ? 'text-rose-600' : 'text-slate-800'}`}>
                            {day.menus.Secondary.dish}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Click any date to inspect its full production view.</span>
              <button
                type="button"
                onClick={() => setIsTimetableModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Add New Food Item                                                  */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900">Add New Recipe</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* noValidate: every problem is shown in the message below, also on phones where the
                browser's own validation can block the submit without saying why. */}
            <form onSubmit={handleCreateNewMeal} noValidate className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Recipe Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newMealName}
                  onChange={(e) => setNewMealName(e.target.value)}
                  placeholder="e.g. Vegetable Khichdi + Curd"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Rate (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={newMealPrice}
                    onChange={(e) => setNewMealPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={newMealCategory}
                    onChange={(e) => setNewMealCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="LUNCH">Lunch</option>
                    <option value="BREAKFAST">Breakfast</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-xs font-bold text-slate-700">Vegetarian Recipe</span>
                <input
                  type="checkbox"
                  checked={newMealIsVeg}
                  onChange={(e) => setNewMealIsVeg(e.target.checked)}
                  className="w-4 h-4 rounded-md text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
              </div>

              {addMealError && (
                <p role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700">
                  {addMealError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingMeal}
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {creatingMeal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>{creatingMeal ? 'Saving…' : 'Add Recipe'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Edit Food Item                                                     */}
      {/* ========================================================================= */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Edit2 className="w-4 h-4" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900">
                  Edit Recipe Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateMeal} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Recipe Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editMealName}
                  onChange={(e) => setEditMealName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Rate (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={editMealPrice}
                    onChange={(e) => setEditMealPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={editMealCategory}
                    onChange={(e) => setEditMealCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="LUNCH">Lunch</option>
                    <option value="BREAKFAST">Breakfast</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-xs font-bold text-slate-700">Vegetarian Recipe</span>
                <input
                  type="checkbox"
                  checked={editMealIsVeg}
                  onChange={(e) => setEditMealIsVeg(e.target.checked)}
                  className="w-4 h-4 rounded-md text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingMeal}
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {updatingMeal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffKitchenPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <StaffKitchenContent />
    </Suspense>
  );
}
