'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import {
  ChefHat,
  RefreshCw,
  UtensilsCrossed,
  CheckSquare,
  Square,
  Save,
  Search,
  Plus,
  Edit2,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Check,
  CalendarDays,
  CalendarOff,
  Clock,
  Layers,
  Sparkles,
  Info,
  Calendar,
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
  getStudentCategory,
  StudentCategory,
} from '@/lib/october-2026-timetable';

function StaffKitchenContent() {
  const { showToast } = useToast();
  const [todayDateStr, setTodayDateStr] = useState(() => getTodayString());
  const [tomorrowDateStr, setTomorrowDateStr] = useState(() => getOffsetDateString(1));
  const [selectedDateStr, setSelectedDateStr] = useState(() => getTodayString());
  const [selectedStudentCategory, setSelectedStudentCategory] = useState<string>('ALL');
  const [currentDayMenus, setCurrentDayMenus] = useState<any[]>([]);
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);

  // --- Tomorrow's Complete Menu State ---
  const [allMeals, setAllMeals] = useState<MealData[]>([]);
  const [selectedMealIds, setSelectedMealIds] = useState<string[]>([]);
  const [initialSavedMealIds, setInitialSavedMealIds] = useState<string[]>([]);
  const [loadingTomorrow, setLoadingTomorrow] = useState(false);
  const [savingTomorrow, setSavingTomorrow] = useState(false);
  const [tomorrowSearch, setTomorrowSearch] = useState('');
  const [tomorrowCategoryFilter, setTomorrowCategoryFilter] = useState('ALL');

  const hasUnsavedChanges = useMemo(() => {
    if (selectedMealIds.length !== initialSavedMealIds.length) return true;
    const initialSet = new Set(initialSavedMealIds);
    return selectedMealIds.some((id) => !initialSet.has(id));
  }, [selectedMealIds, initialSavedMealIds]);

  // --- Add Food Item Modal State ---
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newMealName, setNewMealName] = useState('');
  const [newMealCategory, setNewMealCategory] = useState('LUNCH');
  const [newMealPrice, setNewMealPrice] = useState('80');
  const [newMealIsVeg, setNewMealIsVeg] = useState(true);
  const [newMealAvailableTomorrow, setNewMealAvailableTomorrow] = useState(true);
  const [creatingMeal, setCreatingMeal] = useState(false);

  // --- Edit Food Item Modal State ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<MealData | null>(null);
  const [editMealName, setEditMealName] = useState('');
  const [editMealCategory, setEditMealCategory] = useState('LUNCH');
  const [editMealPrice, setEditMealPrice] = useState('80');
  const [editMealIsVeg, setEditMealIsVeg] = useState(true);
  const [updatingMeal, setUpdatingMeal] = useState(false);

  // Fetch Complete Master Menu & Active Schedule for selected date & category
  const fetchTomorrowMenuData = async (targetDate?: string, targetCategory?: string) => {
    const queryDate = targetDate || selectedDateStr;
    const queryCat = targetCategory !== undefined ? targetCategory : selectedStudentCategory;
    setLoadingTomorrow(true);
    try {
      const catParam = queryCat && queryCat !== 'ALL' ? `&category=${encodeURIComponent(queryCat)}` : '';
      const [mealsRes, menusRes] = await Promise.all([
        fetch('/api/admin/meals'),
        fetch(`/api/admin/menus?date=${queryDate}${catParam}`),
      ]);

      if (mealsRes.ok) {
        const data = await mealsRes.json();
        setAllMeals(data.meals || []);
      }

      if (menusRes.ok) {
        const menuData = await menusRes.json();
        const menusList = menuData.menus || [];
        setCurrentDayMenus(menusList);

        const activeIds = menusList
          .filter((item: any) => Boolean(item.isActive))
          .map((item: any) => item.mealId);

        setSelectedMealIds(activeIds);
        setInitialSavedMealIds(activeIds);
      }
    } catch (err) {
      console.error('Failed to load menu data:', err);
      showToast('Error loading menu items', 'error');
    } finally {
      setLoadingTomorrow(false);
    }
  };

  useEffect(() => {
    fetchTomorrowMenuData();
  }, [selectedDateStr, selectedStudentCategory]);

  // Live real-time synchronization across staff and parents without manual refresh
  useSyncWatcher({
    onMenuUpdate: () => {
      fetchTomorrowMenuData();
    },
  });

  useEffect(() => {
    // 1. Schedule exact timer at 12:00:00 AM midnight
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
        setSelectedMealIds([]);
        setInitialSavedMealIds([]);

        showToast(
          '12:00 AM Rollover: New school day active.',
          'info'
        );

        fetchTomorrowMenuData(newToday);
        scheduleMidnight();
      }, msUntilMidnight);
    };

    scheduleMidnight();

    // 2. Periodic safety interval (every 15s) for background tab or device wake from sleep
    const intervalId = setInterval(() => {
      const currentToday = getTodayString();
      if (currentToday !== todayDateStr) {
        const newTomorrow = getOffsetDateString(1);
        setTodayDateStr(currentToday);
        setTomorrowDateStr(newTomorrow);
        setSelectedMealIds([]);
        setInitialSavedMealIds([]);

        showToast(
          'Date changed: Updated to current school day.',
          'info'
        );

        fetchTomorrowMenuData(currentToday);
      }
    }, 15000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [todayDateStr]);

  // Toggle selection for Tomorrow
  const handleToggleMeal = (mealId: string) => {
    setSelectedMealIds((prev) =>
      prev.includes(mealId) ? prev.filter((id) => id !== mealId) : [...prev, mealId]
    );
  };

  const getDisplayCategory = (cat?: string | null) => {
    const c = (cat || 'LUNCH').toUpperCase().trim();
    if (c === 'SNACK') return 'BREAKFAST';
    return c;
  };

  // Filter meals for Tomorrow's list
  const filteredMeals = useMemo(() => {
    return allMeals.filter((meal) => {
      const matchesSearch =
        !tomorrowSearch.trim() ||
        meal.name.toLowerCase().includes(tomorrowSearch.toLowerCase().trim());
      const mealCat = getDisplayCategory(meal.category);
      const matchesCategory =
        tomorrowCategoryFilter === 'ALL' || mealCat === tomorrowCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [allMeals, tomorrowSearch, tomorrowCategoryFilter]);

  // Unique categories in catalog (Snack merged into Breakfast)
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    allMeals.forEach((m) => {
      set.add(getDisplayCategory(m.category));
    });
    const order = ['LUNCH', 'BREAKFAST'];
    const sorted = Array.from(set).sort((a, b) => {
      const idxA = order.indexOf(a);
      const idxB = order.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [allMeals]);

  // Group filtered meals by category (Snack items grouped under Breakfast)
  const groupedMeals = useMemo(() => {
    const groups: Record<string, MealData[]> = {};
    filteredMeals.forEach((m) => {
      const cat = getDisplayCategory(m.category);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    });
    return groups;
  }, [filteredMeals]);

  // Visual feedback state for Select All / Deselect All controls
  const [actionFeedback, setActionFeedback] = useState<'select' | 'deselect' | null>(null);

  const isAllVisibleSelected = useMemo(() => {
    if (filteredMeals.length === 0) return false;
    return filteredMeals.every((m) => selectedMealIds.includes(m.id));
  }, [filteredMeals, selectedMealIds]);

  const isAllVisibleDeselected = useMemo(() => {
    if (filteredMeals.length === 0) return true;
    return filteredMeals.every((m) => !selectedMealIds.includes(m.id));
  }, [filteredMeals, selectedMealIds]);

  const handleSelectAll = () => {
    if (filteredMeals.length === 0) return;
    setActionFeedback('select');
    setTimeout(() => {
      setActionFeedback((prev) => (prev === 'select' ? null : prev));
    }, 1200);

    if (isAllVisibleSelected) return;

    const visibleIds = filteredMeals.map((m) => m.id);
    const combined = Array.from(new Set([...selectedMealIds, ...visibleIds]));
    setSelectedMealIds(combined);
    showToast(`Selected all ${visibleIds.length} visible items`, 'info');
  };

  const handleDeselectAll = () => {
    if (filteredMeals.length === 0) return;
    setActionFeedback('deselect');
    setTimeout(() => {
      setActionFeedback((prev) => (prev === 'deselect' ? null : prev));
    }, 1200);

    if (isAllVisibleDeselected) return;

    const visibleIds = new Set(filteredMeals.map((m) => m.id));
    setSelectedMealIds((prev) => prev.filter((id) => !visibleIds.has(id)));
    showToast('Deselected visible items', 'info');
  };

  // Save Menu
  const handleSaveTomorrowMenu = async () => {
    setSavingTomorrow(true);
    try {
      const res = await fetch('/api/admin/menus/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDateStr,
          studentCategory: selectedStudentCategory,
          selectedMealIds,
        }),
      });

      if (res.ok) {
        setInitialSavedMealIds([...selectedMealIds]);
        broadcastSyncEvent('MENU_UPDATED');
        showToast(
          `Custom menu adjustments for ${formatDatePretty(selectedDateStr)} saved!`,
          'success'
        );
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save menu', 'error');
      }
    } catch {
      showToast('Network error saving menu', 'error');
    } finally {
      setSavingTomorrow(false);
    }
  };

  // Add New Food Item
  const handleCreateNewMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newMealName.trim();
    const priceNum = parseFloat(newMealPrice);

    if (!cleanName) {
      showToast('Please enter a food item name', 'error');
      return;
    }
    if (isNaN(priceNum) || priceNum <= 0) {
      showToast('Please enter a valid price greater than 0', 'error');
      return;
    }

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

      if (res.ok) {
        const data = await res.json();
        const createdMeal: MealData = data.meal;

        // Add to catalog
        setAllMeals((prev) => [createdMeal, ...prev]);

        // If selected for tomorrow, immediately add to selected list
        if (newMealAvailableTomorrow) {
          setSelectedMealIds((prev) => Array.from(new Set([createdMeal.id, ...prev])));
        }

        broadcastSyncEvent('MENU_UPDATED');

        showToast(
          `"${createdMeal.name}" added to menu catalog!`,
          'success'
        );

        // Reset form
        setIsAddModalOpen(false);
        setNewMealName('');
        setNewMealPrice('80');
        setNewMealIsVeg(true);
        setNewMealAvailableTomorrow(true);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to create meal', 'error');
      }
    } catch {
      showToast('Network error creating meal', 'error');
    } finally {
      setCreatingMeal(false);
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

        // Update local meals array
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
        showToast(err.error || 'Failed to update item', 'error');
      }
    } catch {
      showToast('Network error updating item', 'error');
    } finally {
      setUpdatingMeal(false);
    }
  };

  // Date context flags
  const isPastDate = selectedDateStr < todayDateStr;
  const isToday = selectedDateStr === todayDateStr;
  const isTomorrow = selectedDateStr === tomorrowDateStr;

  // Resolve official timetable day entry
  const officialDayEntry = useMemo(() => {
    return OCTOBER_2026_TIMETABLE.find((d) => d.date === selectedDateStr) || null;
  }, [selectedDateStr]);

  // Which student categories to display in the official timetable section
  const categoriesToDisplay: StudentCategory[] = useMemo(() => {
    if (selectedStudentCategory === 'ALL') {
      return ['Pre-primary', 'Primary', 'Secondary'];
    }
    const normalized = getStudentCategory(undefined, selectedStudentCategory);
    return [normalized];
  }, [selectedStudentCategory]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-5 space-y-6 print:p-0 print:m-0 pb-28 sm:pb-16">
      {/* Canteen Staff Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-100/90 px-2.5 py-0.5 rounded-md">
              Canteen Operations & Timetable
            </span>
            <span className="text-xs text-slate-500 font-semibold">S.B. Patil School</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-amber-500" />
            <span>Student Menu Management</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Review scheduled October 2026 timetable meals for student categories and manage kitchen recipe catalog.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsTimetableModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black shadow-2xs transition-all cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Full Month Timetable</span>
          </button>

          <button
            onClick={() => fetchTomorrowMenuData()}
            disabled={loadingTomorrow}
            className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs cursor-pointer"
            title="Refresh menu data"
          >
            <RefreshCw
              className={`w-4 h-4 ${loadingTomorrow ? 'animate-spin text-amber-500' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Global Filter Bar: Date & Student Category Selector */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          {/* Quick Date Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-slate-600 text-[11px] uppercase tracking-wider">Date:</span>
            <button
              type="button"
              onClick={() => setSelectedDateStr(todayDateStr)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
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
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
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
              min="2026-10-01"
              max="2026-10-31"
              onChange={(e) => setSelectedDateStr(e.target.value)}
              className="text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus:outline-hidden focus:border-amber-500 cursor-pointer"
            />
          </div>

          {/* Student Category Selector Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <span className="font-extrabold text-slate-600 text-[11px] uppercase tracking-wider">Category:</span>
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
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                  selectedStudentCategory === cat.id
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION A: OFFICIAL SCHOOL BRUNCH TIMETABLE (Authoritative & Prominent)   */}
      {/* ========================================================================= */}
      <section className="bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-white p-5 sm:p-6 rounded-3xl border-2 border-amber-300/80 shadow-md space-y-4">
        {/* Section A Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-200/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white uppercase tracking-wider">
                Official School Timetable
              </span>
              <span className="text-xs font-extrabold text-slate-600">
                {formatDatePretty(selectedDateStr)}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-amber-600" />
              <span>Scheduled Brunch for {formatDatePretty(selectedDateStr)}</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Authoritative school menu from the October 2026 timetable. The system automatically serves these dishes to students without manual catalog selection.
            </p>
          </div>

          <div className="self-start sm:self-auto shrink-0">
            {isPastDate ? (
              <span className="px-3 py-1 bg-slate-100 text-slate-600 border border-slate-300 rounded-xl text-xs font-black inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Historical Timetable (Read-Only)</span>
              </span>
            ) : isToday ? (
              <span className="px-3 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-black inline-flex items-center gap-1.5 animate-pulse">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Today&apos;s Active Timetable</span>
              </span>
            ) : (
              <span className="px-3 py-1 bg-blue-100 text-blue-900 border border-blue-300 rounded-xl text-xs font-black inline-flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
                <span>Upcoming Scheduled Date</span>
              </span>
            )}
          </div>
        </div>

        {/* Category Cards Grid */}
        <div
          className={`grid gap-4 ${
            categoriesToDisplay.length > 1
              ? 'grid-cols-1 md:grid-cols-3'
              : 'grid-cols-1 max-w-2xl mx-auto'
          }`}
        >
          {categoriesToDisplay.map((cat) => {
            const officialMenu = officialDayEntry?.menus[cat];
            const dbMenu = currentDayMenus.find((m) => {
              const mCat = getStudentCategory(undefined, m.studentCategory);
              return mCat === cat;
            });

            const isHoliday = Boolean(officialMenu?.isHoliday || dbMenu?.isHoliday);
            const holidayReason =
              officialMenu?.holidayReason || dbMenu?.holidayReason || 'School Holiday — No Brunch';
            const dishName =
              officialMenu?.dish && !officialMenu.isHoliday
                ? officialMenu.dish
                : dbMenu?.meal?.name && !dbMenu?.isHoliday
                ? dbMenu.meal.name
                : isHoliday
                ? 'Holiday — No Brunch'
                : 'Scheduled Brunch';

            // Lookup meal details from catalog
            const catalogMeal = OCTOBER_2026_MEAL_CATALOG.find(
              (m) => m.name.toLowerCase().trim() === dishName.toLowerCase().trim()
            ) || dbMenu?.meal;

            // Card theme styles per category
            const themeStyles = {
              'Pre-primary': {
                border: 'border-purple-300',
                badgeBg: 'bg-purple-100 text-purple-900 border-purple-200',
                cardBg: isHoliday ? 'bg-rose-50/70 border-rose-200' : 'bg-white',
                label: 'Pre-primary (Nursery & KG)',
              },
              Primary: {
                border: 'border-emerald-300',
                badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-200',
                cardBg: isHoliday ? 'bg-rose-50/70 border-rose-200' : 'bg-white',
                label: 'Primary (Classes 1 - 5)',
              },
              Secondary: {
                border: 'border-amber-300',
                badgeBg: 'bg-amber-100 text-amber-900 border-amber-200',
                cardBg: isHoliday ? 'bg-rose-50/70 border-rose-200' : 'bg-white',
                label: 'Secondary (Classes 6 - 10)',
              },
            }[cat];

            if (isHoliday) {
              return (
                <div
                  key={cat}
                  className={`p-5 rounded-3xl border-2 ${themeStyles.cardBg} ${themeStyles.border} shadow-2xs space-y-3 flex flex-col justify-between`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${themeStyles.badgeBg}`}>
                        {themeStyles.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200">
                        Holiday
                      </span>
                    </div>

                    <div className="pt-2 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                        <CalendarOff className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-slate-900 leading-snug">
                          {holidayReason}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          School is closed for brunch on this date. No food preparation or parent ordering is required.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-rose-200/70 text-[11px] font-bold text-rose-700 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Canteen Closed for Brunch</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={cat}
                className={`p-5 rounded-3xl border-2 bg-white ${themeStyles.border} shadow-2xs space-y-3 flex flex-col justify-between`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${themeStyles.badgeBg}`}>
                      {themeStyles.label}
                    </span>
                    <VegBadge isVegetarian={true} />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                      {dishName}
                    </h3>
                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                      {catalogMeal?.description || 'Freshly prepared wholesome school brunch.'}
                    </p>
                  </div>

                  {catalogMeal?.ingredients && (
                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        Scheduled Ingredients:
                      </div>
                      <p className="text-[11px] text-slate-600 font-medium line-clamp-2">
                        {catalogMeal.ingredients}
                      </p>
                    </div>
                  )}

                  {catalogMeal?.allergens && (
                    <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                      Allergens: {catalogMeal.allergens}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                  {isPastDate ? (
                    <span className="text-slate-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Past Date (Closed)</span>
                    </span>
                  ) : (
                    <span className="text-emerald-700 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Active for Student Ordering</span>
                    </span>
                  )}
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-black">
                    Official Timetable
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Clear Notice Explaining Automatic Timetable Workflow */}
        <div className="p-3 bg-amber-100/60 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-xs text-amber-950 font-medium">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p>
            <strong>Note for Canteen Team:</strong> The scheduled dish shown above is automatically active on the parent dashboard for each student category. You do <em>not</em> need to select random dishes from the recipe catalog below to make the official timetable appear.
          </p>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SECTION B: CANTEEN RECIPE CATALOG & CUSTOM MENU CONTROLS                  */}
      {/* ========================================================================= */}
      <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
        {/* Section B Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                Master Database
              </span>
              <span className="text-xs font-bold text-slate-500">
                {allMeals.length} Total Recipes
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight mt-0.5 flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-500" />
              <span>Food Item Catalog & Recipe Controls</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Add new dishes, update recipes, or adjust catalog pricing. This catalog stores all canteen culinary records.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-black transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5 text-amber-600" />
              <span>Add New Item</span>
            </button>

            <button
              type="button"
              onClick={handleSaveTomorrowMenu}
              disabled={savingTomorrow || !hasUnsavedChanges}
              title={!hasUnsavedChanges ? 'No unsaved custom changes' : 'Save custom changes for this date'}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-amber-500 disabled:hover:to-orange-500 disabled:shadow-none"
            >
              {savingTomorrow ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save Catalog Changes</span>
            </button>
          </div>
        </div>

        {/* Search Field & Category Filter Pills */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={tomorrowSearch}
                onChange={(e) => setTomorrowSearch(e.target.value)}
                placeholder="Search recipe catalog by name..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 focus:bg-white border border-slate-200 focus:border-amber-500 rounded-xl text-xs sm:text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-amber-500/20 text-slate-900 transition-all placeholder:text-slate-400"
              />
              {tomorrowSearch && (
                <button
                  type="button"
                  onClick={() => setTomorrowSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Select All / Deselect All */}
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                type="button"
                onClick={handleSelectAll}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <CheckSquare className="w-3.5 h-3.5 text-amber-600" />
                <span>Select All</span>
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 text-slate-500" />
                <span>Deselect All</span>
              </button>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => setTomorrowCategoryFilter('ALL')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                tomorrowCategoryFilter === 'ALL'
                  ? 'bg-amber-500 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Items ({allMeals.length})
            </button>
            {availableCategories.map((cat) => {
              const count = allMeals.filter(
                (m) => getDisplayCategory(m.category) === cat
              ).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setTomorrowCategoryFilter(cat)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                    tomorrowCategoryFilter === cat
                      ? 'bg-amber-500 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat.charAt(0) + cat.slice(1).toLowerCase()} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Meals Grouped by Category */}
        {loadingTomorrow ? (
          <div className="min-h-[25vh] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredMeals.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
            <UtensilsCrossed className="w-10 h-10 mx-auto text-slate-300" />
            <h3 className="font-extrabold text-slate-800 text-sm">No Food Items Found</h3>
            <p className="text-xs text-slate-500">
              {tomorrowSearch
                ? `No items match "${tomorrowSearch}". Try clearing search.`
                : 'Click "Add New Item" to create items in your canteen menu.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedMeals).map(([catName, mealsInGroup]) => (
              <div key={catName} className="space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span>{catName}</span>
                    <span className="text-slate-400 font-semibold">
                      ({mealsInGroup.length})
                    </span>
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {mealsInGroup.map((meal) => {
                    const isSelected = selectedMealIds.includes(meal.id);

                    return (
                      <div
                        key={meal.id}
                        onClick={() => handleToggleMeal(meal.id)}
                        className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                          isSelected
                            ? 'bg-amber-50/70 border-amber-400 shadow-2xs ring-1 ring-amber-300/60'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 shadow-2xs'
                        }`}
                      >
                        {/* Left: Checkbox + Icon + Info */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="shrink-0">
                            <div
                              className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all ${
                                isSelected
                                  ? 'bg-amber-500 border-amber-600 text-white shadow-2xs'
                                  : 'bg-white border-slate-300 text-transparent'
                              }`}
                            >
                              <Check className="w-4 h-4 stroke-[3]" />
                            </div>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <h5 className="font-extrabold text-xs sm:text-sm text-slate-900 truncate">
                                {meal.name}
                              </h5>
                              <VegBadge isVegetarian={meal.isVegetarian} />
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                              <span className="font-bold text-slate-700">₹{formatINR(meal.price)}</span>
                              <span>•</span>
                              <span className="capitalize">{meal.category?.toLowerCase() || 'Lunch'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Right: Edit Button */}
                        <button
                          type="button"
                          onClick={(e) => handleOpenEdit(meal, e)}
                          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors shrink-0"
                          title="Edit recipe details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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
                  Authoritative Timetable
                </span>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 mt-1">
                  Complete October 2026 School Brunch Schedule
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Full 31-day school brunch timetable for Pre-primary, Primary, and Secondary.
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
              <div className="divide-y divide-slate-100 border border-slate-150 rounded-2xl overflow-hidden">
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
              <span>Click any date row to inspect its full details.</span>
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
                <h3 className="font-extrabold text-base text-slate-900">Add New Food Item</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewMeal} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Food Item Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newMealName}
                  onChange={(e) => setNewMealName(e.target.value)}
                  placeholder="e.g. Veg Pulao with Raita"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Price (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={newMealPrice}
                    onChange={(e) => setNewMealPrice(e.target.value)}
                    placeholder="80"
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

              {/* Vegetarian Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-xs font-bold text-slate-700">Vegetarian Dish</span>
                <input
                  type="checkbox"
                  checked={newMealIsVeg}
                  onChange={(e) => setNewMealIsVeg(e.target.checked)}
                  className="w-4 h-4 rounded-md text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
              </div>

              {/* Available for Tomorrow Checkbox */}
              <div className="flex items-center justify-between p-3 bg-amber-50/70 rounded-xl border border-amber-200">
                <div>
                  <span className="text-xs font-extrabold text-amber-900 block">
                    Available in Kitchen Catalog
                  </span>
                  <span className="text-[10px] text-amber-700 font-medium">
                    Include in active kitchen items
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={newMealAvailableTomorrow}
                  onChange={(e) => setNewMealAvailableTomorrow(e.target.checked)}
                  className="w-4 h-4 rounded-md text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
              </div>

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
                  <span>Add Item</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Edit Existing Food Item                                            */}
      {/* ========================================================================= */}
      {isEditModalOpen && editingMeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Edit2 className="w-4 h-4" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900">
                  Edit Food Item
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
                  Food Item Name <span className="text-rose-500">*</span>
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
                    Price (₹) <span className="text-rose-500">*</span>
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
                    onChange={(e) => setNewMealCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500"
                  >
                    <option value="LUNCH">Lunch</option>
                    <option value="BREAKFAST">Breakfast</option>
                  </select>
                </div>
              </div>

              {/* Vegetarian Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-xs font-bold text-slate-700">Vegetarian Dish</span>
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
