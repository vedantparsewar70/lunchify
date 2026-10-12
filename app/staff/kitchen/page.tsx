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
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import MealIcon from '@/components/MealIcon';
import MealCategoryBadge from '@/components/MealCategoryBadge';
import { formatDatePretty, getTodayString, getOffsetDateString, formatINR } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';
import { useSyncWatcher, broadcastSyncEvent } from '@/lib/client-sync';
import { MealData } from '@/types';

function StaffKitchenContent() {
  const { showToast } = useToast();
  const [todayDateStr, setTodayDateStr] = useState(() => getTodayString());
  const [tomorrowDateStr, setTomorrowDateStr] = useState(() => getOffsetDateString(1));

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

  // Fetch Tomorrow's Complete Master Menu & Active Schedule
  const fetchTomorrowMenuData = async (targetDate?: string) => {
    const queryDate = targetDate || tomorrowDateStr;
    setLoadingTomorrow(true);
    try {
      const [mealsRes, menusRes] = await Promise.all([
        fetch('/api/admin/meals'),
        fetch(`/api/admin/menus?date=${queryDate}`),
      ]);

      if (mealsRes.ok) {
        const data = await mealsRes.json();
        setAllMeals(data.meals || []);
      }

      if (menusRes.ok) {
        const menuData = await menusRes.json();
        // Server's ensureTomorrowMenuReset already ensures tomorrow's menu is reset unless published today
        const activeIds = (menuData.menus || [])
          .filter((item: any) => Boolean(item.isActive))
          .map((item: any) => item.mealId);

        setSelectedMealIds(activeIds);
        setInitialSavedMealIds(activeIds);
      }
    } catch (err) {
      console.error('Failed to load tomorrow menu data:', err);
      showToast('Error loading menu items', 'error');
    } finally {
      setLoadingTomorrow(false);
    }
  };

  useEffect(() => {
    fetchTomorrowMenuData();
  }, []);

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
          '12:00 AM Rollover: All meals unticked for the new day. Please select tomorrow\'s menu.',
          'info'
        );

        fetchTomorrowMenuData(newTomorrow);
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
          'Date changed: All meals unticked for the new day. Please select tomorrow\'s menu.',
          'info'
        );

        fetchTomorrowMenuData(newTomorrow);
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
    showToast(`Selected all ${visibleIds.length} visible items for tomorrow`, 'info');
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

  // Save Tomorrow's Menu
  const handleSaveTomorrowMenu = async () => {
    setSavingTomorrow(true);
    try {
      const res = await fetch('/api/admin/menus/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: tomorrowDateStr,
          selectedMealIds,
        }),
      });

      if (res.ok) {
        setInitialSavedMealIds([...selectedMealIds]);
        broadcastSyncEvent('MENU_UPDATED');
        showToast(
          `Tomorrow's menu saved! ${selectedMealIds.length} items will be available for parents.`,
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
          `"${createdMeal.name}" added to menu catalog${
            newMealAvailableTomorrow ? ' and selected for tomorrow' : ''
          }!`,
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-5 print:p-0 print:m-0 pb-28 sm:pb-12">
      {/* Canteen Staff Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 print:hidden">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
            Canteen Kitchen Staff
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-amber-500" />
            <span>Student Menu</span>
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fetchTomorrowMenuData()}
            disabled={loadingTomorrow}
            className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs cursor-pointer"
            title="Refresh"
          >
            <RefreshCw
              className={`w-4 h-4 ${loadingTomorrow ? 'animate-spin text-amber-500' : ''}`}
            />
          </button>
        </div>
      </div>
        <div className="space-y-4">
          {/* Header Summary & Actions Toolbar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Tomorrow&apos;s Menu
                  </span>
                  {hasUnsavedChanges ? (
                    <span className="text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 text-amber-600" />
                      <span>Unsaved Changes</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Saved</span>
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-black text-slate-900 mt-0.5">
                  {formatDatePretty(tomorrowDateStr)}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">
                  <strong className="text-amber-600 font-bold">{selectedMealIds.length}</strong> of{' '}
                  <strong className="text-slate-800">{allMeals.length}</strong> items available for
                  parents to order.
                </p>
              </div>

              {/* Action Buttons: Add Item & Save */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-extrabold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5 text-amber-600" />
                  <span>Add New Item</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveTomorrowMenu}
                  disabled={savingTomorrow || !hasUnsavedChanges}
                  title={!hasUnsavedChanges ? "No changes to save" : "Save tomorrow's menu"}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-amber-500 disabled:hover:to-orange-500 disabled:shadow-none"
                >
                  {savingTomorrow ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Save Tomorrow&apos;s Menu</span>
                </button>
              </div>
            </div>

            {/* Quick Select All / Deselect All Controls */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-semibold text-[11px]">
                Showing {filteredMeals.length} items
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  title={isAllVisibleSelected ? "All visible items are selected" : "Select all visible items"}
                  className={`min-w-[90px] justify-center px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1 border transition-all duration-200 active:scale-95 cursor-pointer ${
                    actionFeedback === 'select'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-400 ring-2 ring-emerald-300/60 scale-[0.98] font-black shadow-xs'
                      : isAllVisibleSelected
                      ? 'bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 border-emerald-300 font-extrabold shadow-2xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200/60 font-bold hover:text-slate-900'
                  }`}
                >
                  {isAllVisibleSelected || actionFeedback === 'select' ? (
                    <Check className="w-3 h-3 text-emerald-600 stroke-[2.5] shrink-0" />
                  ) : (
                    <CheckSquare className="w-3 h-3 text-amber-600 shrink-0" />
                  )}
                  <span>{isAllVisibleSelected ? 'All Selected' : 'Select All'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  title={isAllVisibleDeselected ? "All visible items are deselected" : "Deselect all visible items"}
                  className={`min-w-[100px] justify-center px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1 border transition-all duration-200 active:scale-95 cursor-pointer ${
                    actionFeedback === 'deselect'
                      ? 'bg-slate-200 text-slate-900 border-slate-400 ring-2 ring-slate-300/60 scale-[0.98] font-black shadow-xs'
                      : isAllVisibleDeselected
                      ? 'bg-slate-50 text-slate-400 border-slate-200/70 font-medium'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200/60 font-bold hover:text-slate-900'
                  }`}
                >
                  <Square className={`w-3 h-3 shrink-0 ${isAllVisibleDeselected ? 'text-slate-300' : 'text-slate-500'}`} />
                  <span>{isAllVisibleDeselected ? 'None Selected' : 'Deselect All'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Search Field & Category Filter Pills */}
          <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs space-y-2.5">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={tomorrowSearch}
                onChange={(e) => setTomorrowSearch(e.target.value)}
                placeholder="Search food item by name..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 focus:bg-white border border-slate-200 focus:border-amber-500 rounded-xl text-xs sm:text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-amber-500/20 text-slate-900 transition-all placeholder:text-slate-400"
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
            <div className="min-h-[35vh] flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredMeals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center space-y-2">
              <UtensilsCrossed className="w-10 h-10 mx-auto text-slate-300" />
              <h3 className="font-extrabold text-slate-800 text-base">No Food Items Found</h3>
              <p className="text-xs text-slate-500">
                {tomorrowSearch
                  ? `No items match "${tomorrowSearch}". Try clearing search.`
                  : 'Click "Add New Item" to create items in your canteen menu.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
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
                              ? 'bg-amber-50/60 border-amber-400 shadow-2xs ring-1 ring-amber-300/60'
                              : 'bg-white border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/60 shadow-2xs'
                          }`}
                        >
                          {/* Left: Checkbox + Icon + Info */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Big Touch-Friendly Toggle Checkbox */}
                            <div className="shrink-0">
                              <div
                                className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                                  isSelected
                                    ? 'bg-amber-500 text-white shadow-xs'
                                    : 'border-2 border-slate-300 bg-white'
                                }`}
                              >
                                {isSelected && <CheckSquare className="w-4 h-4 stroke-[3]" />}
                              </div>
                            </div>

                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                              <MealIcon name={meal.name} category={getDisplayCategory(meal.category)} size="sm" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <VegBadge isVegetarian={meal.isVegetarian} size="sm" />
                                <h5 className="font-extrabold text-xs sm:text-sm text-slate-900 truncate">
                                  {meal.name}
                                </h5>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs font-black text-amber-700">
                                  {formatINR(meal.price || 0)}
                                </span>
                                <MealCategoryBadge category={getDisplayCategory(meal.category)} size="sm" />
                              </div>
                            </div>
                          </div>

                          {/* Right: Edit Button */}
                          <div className="shrink-0 pl-1">
                            <button
                              type="button"
                              onClick={(e) => handleOpenEdit(meal, e)}
                              className="p-2 rounded-xl text-slate-400 hover:text-amber-800 hover:bg-amber-100 border border-transparent hover:border-amber-200 transition-colors cursor-pointer"
                              title={`Edit ${meal.name}`}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Sticky Mobile Floating Save Bar */}
          <div className="fixed bottom-[58px] md:bottom-0 left-0 right-0 z-30 p-2.5 sm:p-3 bg-white/95 backdrop-blur-md border-t border-amber-200 shadow-lg">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block leading-tight">
                  Tomorrow&apos;s Menu
                </span>
                <p className="text-xs sm:text-sm font-black text-slate-900 leading-tight">
                  {selectedMealIds.length} items active
                </p>
              </div>

              <button
                type="button"
                onClick={handleSaveTomorrowMenu}
                disabled={savingTomorrow || !hasUnsavedChanges}
                title={!hasUnsavedChanges ? "No changes to save" : "Save tomorrow's menu"}
                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-[0.98] text-white font-black text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-amber-500 disabled:hover:to-orange-500 disabled:shadow-none"
              >
                {savingTomorrow ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Save Tomorrow&apos;s Menu</span>
              </button>
            </div>
          </div>
        </div>

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
                    Available for Tomorrow
                  </span>
                  <span className="text-[10px] text-amber-700 font-medium">
                    Automatically select for tomorrow&apos;s menu
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
                    onChange={(e) => setEditMealCategory(e.target.value)}
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
