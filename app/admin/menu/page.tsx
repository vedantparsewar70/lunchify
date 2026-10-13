'use client';

import React, { useEffect, useState } from 'react';
import {
  UtensilsCrossed,
  CheckSquare,
  Square,
  Save,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  Loader2,
  Calendar,
  Sparkles,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import MealIcon from '@/components/MealIcon';
import MealCategoryBadge from '@/components/MealCategoryBadge';
import { formatINR, formatDatePretty, getTodayString, getOffsetDateString } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';
import { useSyncWatcher, broadcastSyncEvent } from '@/lib/client-sync';
import { MealData } from '@/types';

export default function AdminMenuPage() {
  const { showToast } = useToast();
  const [todayDate, setTodayDate] = useState(() => getTodayString());
  const [tomorrowDate, setTomorrowDate] = useState(() => getOffsetDateString(1));
  const [selectedDate, setSelectedDate] = useState(() => getOffsetDateString(1));
  const [selectedStudentCategory, setSelectedStudentCategory] = useState<string>('ALL');
  const [currentDayMenus, setCurrentDayMenus] = useState<any[]>([]);

  const [meals, setMeals] = useState<MealData[]>([]);
  const [selectedMealIds, setSelectedMealIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Add new food item modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newMealName, setNewMealName] = useState('');
  const [newMealCategory, setNewMealCategory] = useState('LUNCH');
  const [newMealPrice, setNewMealPrice] = useState('80');
  const [newMealIsVeg, setNewMealIsVeg] = useState(true);
  const [newMealDesc, setNewMealDesc] = useState('');
  const [creatingMeal, setCreatingMeal] = useState(false);

  const fetchData = async (targetDate?: string, targetCategory?: string) => {
    const queryDate = targetDate || selectedDate;
    const queryCat = targetCategory !== undefined ? targetCategory : selectedStudentCategory;
    setLoading(true);
    try {
      const catParam = queryCat && queryCat !== 'ALL' ? `&category=${encodeURIComponent(queryCat)}` : '';
      const [mealsRes, menusRes] = await Promise.all([
        fetch('/api/admin/meals'),
        fetch(`/api/admin/menus?date=${queryDate}${catParam}`),
      ]);

      let allMeals: MealData[] = [];
      if (mealsRes.ok) {
        const m = await mealsRes.json();
        allMeals = m.meals || [];
        setMeals(allMeals);
      }

      if (menusRes.ok) {
        const menuData = await menusRes.json();
        const menusList = menuData.menus || [];
        setCurrentDayMenus(menusList);

        const activeIds = menusList
          .filter((item: any) => Boolean(item.isActive))
          .map((item: any) => item.mealId);

        setSelectedMealIds(activeIds);
      }
    } catch (err) {
      console.error('Failed to load menu data:', err);
      showToast('Error loading menu items', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDate, selectedStudentCategory]);

  useSyncWatcher({
    onMenuUpdate: () => {
      fetchData();
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

        setTodayDate(newToday);
        setTomorrowDate(newTomorrow);
        setSelectedMealIds([]);

        showToast(
          '12:00 AM Rollover: All meals unticked for the new day. Please select tomorrow\'s menu.',
          'info'
        );

        fetchData(newTomorrow);
        scheduleMidnight();
      }, msUntilMidnight);
    };

    scheduleMidnight();

    // 2. Periodic safety interval (every 15s)
    const intervalId = setInterval(() => {
      const currentToday = getTodayString();
      if (currentToday !== todayDate) {
        const newTomorrow = getOffsetDateString(1);
        setTodayDate(currentToday);
        setTomorrowDate(newTomorrow);
        setSelectedMealIds([]);

        showToast(
          'Date changed: All meals unticked for the new day. Please select tomorrow\'s menu.',
          'info'
        );

        fetchData(newTomorrow);
      }
    }, 15000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [todayDate]);

  const handleToggleMeal = (mealId: string) => {
    setSelectedMealIds((prev) =>
      prev.includes(mealId) ? prev.filter((id) => id !== mealId) : [...prev, mealId]
    );
  };

  const handleSelectAll = () => {
    const visibleIds = filteredMeals.map((m) => m.id);
    const combined = Array.from(new Set([...selectedMealIds, ...visibleIds]));
    setSelectedMealIds(combined);
    showToast(`Selected all ${visibleIds.length} visible items`, 'info');
  };

  const handleUnselectAll = () => {
    const visibleIds = new Set(filteredMeals.map((m) => m.id));
    setSelectedMealIds((prev) => prev.filter((id) => !visibleIds.has(id)));
    showToast('Unselected visible items', 'info');
  };

  const handlePublishMenu = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/menus/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          studentCategory: selectedStudentCategory,
          selectedMealIds,
        }),
      });

      if (res.ok) {
        broadcastSyncEvent('MENU_UPDATED');
        showToast(
          `Menu for ${formatDatePretty(selectedDate)} saved successfully with ${selectedMealIds.length} items!`,
          'success'
        );
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to publish menu', 'error');
      }
    } catch {
      showToast('Network error publishing menu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNewMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMealName.trim()) return;

    setCreatingMeal(true);
    try {
      const res = await fetch('/api/admin/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMealName.trim(),
          category: newMealCategory,
          price: parseFloat(newMealPrice) || 80,
          isVegetarian: newMealIsVeg,
          description: newMealDesc.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        showToast(`"${data.meal.name}" added to food catalog!`, 'success');
        setIsAddModalOpen(false);
        setNewMealName('');
        setNewMealDesc('');
        // Add to local state & select it automatically
        setMeals((prev) => [data.meal, ...prev]);
        setSelectedMealIds((prev) => [...prev, data.meal.id]);
        broadcastSyncEvent('MENU_UPDATED');
      } else {
        showToast('Failed to add food item', 'error');
      }
    } catch {
      showToast('Network error creating food item', 'error');
    } finally {
      setCreatingMeal(false);
    }
  };

  const filteredMeals = meals.filter((meal) => {
    const matchesSearch =
      meal.name.toLowerCase().includes(search.toLowerCase()) ||
      meal.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'ALL' || meal.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const holidayItem = currentDayMenus.find((m) => m.isHoliday);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider bg-purple-100 text-purple-700 rounded-md">
              Daily Menu Availability & Timetable
            </span>
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-purple-600" />
              <span>{formatDatePretty(selectedDate)}</span>
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <span>Menu & Timetable Manager</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage daily dishes and verify October 2026 timetable items across student categories.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-purple-600" />
            <span>Add New Dish</span>
          </button>

          <button
            type="button"
            onClick={handlePublishMenu}
            disabled={saving}
            className="px-4 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md shadow-purple-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-70"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Save Menu ({selectedMealIds.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Date & Student Category Selector Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Quick Date Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500">Date:</span>
            <button
              type="button"
              onClick={() => setSelectedDate(tomorrowDate)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                selectedDate === tomorrowDate
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Tomorrow ({formatDatePretty(tomorrowDate).split(',')[0]})
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(todayDate)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                selectedDate === todayDate
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Today ({formatDatePretty(todayDate).split(',')[0]})
            </button>
            <input
              type="date"
              value={selectedDate}
              min="2026-10-01"
              max="2026-10-31"
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus:outline-hidden"
            />
          </div>

          {/* Student Category Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <span className="text-xs font-bold text-slate-500">Category:</span>
            {[
              { id: 'ALL', label: 'All Students' },
              { id: 'Pre-primary', label: 'Pre-primary' },
              { id: 'Primary', label: 'Primary' },
              { id: 'Secondary', label: 'Secondary' },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedStudentCategory(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  selectedStudentCategory === cat.id
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Holiday Alert if Applicable */}
      {holidayItem && (
        <div className="bg-purple-100/80 border border-purple-300 rounded-2xl p-4 flex items-center gap-3 text-purple-950">
          <AlertCircle className="w-5 h-5 text-purple-600 shrink-0" />
          <div>
            <h4 className="font-extrabold text-sm">Holiday — No Brunch</h4>
            <p className="text-xs text-purple-800 mt-0.5">
              {holidayItem.holidayReason || 'School Holiday'} is recorded for {formatDatePretty(selectedDate)}.
            </p>
          </div>
        </div>
      )}

      {/* Published Status Pill Banner */}
      <div className="bg-purple-50/70 border border-purple-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <p className="font-extrabold text-purple-950">
              {selectedMealIds.length} Food Items Active for {formatDatePretty(selectedDate)}
            </p>
            <p className="text-[11px] text-purple-800">
              Only checked items are orderable for {selectedStudentCategory === 'ALL' ? 'all categories' : selectedStudentCategory}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className="px-3 py-1.5 bg-white hover:bg-purple-100 text-purple-800 font-bold rounded-lg border border-purple-200 transition-colors shadow-2xs text-xs cursor-pointer flex items-center gap-1"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>Select All</span>
          </button>

          <button
            type="button"
            onClick={handleUnselectAll}
            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-200 transition-colors shadow-2xs text-xs cursor-pointer flex items-center gap-1"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Unselect All</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search food item by name..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-purple-500 shadow-2xs text-slate-900"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {['ALL', 'BREAKFAST', 'LUNCH', 'SNACK'].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat === 'ALL' ? 'All Dishes' : cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Food Items Selection Grid */}
      {filteredMeals.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-3">
          <UtensilsCrossed className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-800">No Food Items Found</p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {search ? `No dishes match "${search}". Try clearing search.` : 'Click "Add New Dish" above to create dishes in your canteen catalog.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
          {filteredMeals.map((meal) => {
            const isSelected = selectedMealIds.includes(meal.id);

            return (
              <div
                key={meal.id}
                onClick={() => handleToggleMeal(meal.id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                  isSelected
                    ? 'bg-purple-50/70 border-purple-400 shadow-sm ring-1 ring-purple-300'
                    : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/60 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0">
                    <MealIcon name={meal.name} category={meal.category} size="md" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <VegBadge isVegetarian={meal.isVegetarian} size="sm" />
                      <h3 className="font-extrabold text-sm text-slate-900 truncate">
                        {meal.name}
                      </h3>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-black text-slate-800">
                        {formatINR(meal.price || 0)}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        • {meal.category}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Big Touch-Friendly Toggle Checkbox */}
                <div className="shrink-0 pl-2">
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'border-2 border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <CheckSquare className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Save Bar on Mobile to guarantee easy single-tap publish */}
      <div className="sm:hidden fixed bottom-16 left-0 right-0 z-30 p-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg">
        <button
          type="button"
          onClick={handlePublishMenu}
          disabled={saving}
          className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save & Publish Tomorrow&apos;s Menu ({selectedMealIds.length})</span>
            </>
          )}
        </button>
      </div>

      {/* Add New Dish Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <UtensilsCrossed className="w-5 h-5 text-purple-600" />
                <h3 className="font-extrabold text-base text-slate-900">Add New Dish to Catalog</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewMeal} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Dish Name *</label>
                <input
                  type="text"
                  required
                  value={newMealName}
                  onChange={(e) => setNewMealName(e.target.value)}
                  placeholder="e.g. Masala Dosa, Poha, Pav Bhaji"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-purple-500 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Category</label>
                  <select
                    value={newMealCategory}
                    onChange={(e) => setNewMealCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                  >
                    <option value="BREAKFAST">Breakfast</option>
                    <option value="LUNCH">Lunch</option>
                    <option value="SNACK">Snack</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Price (₹ INR) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newMealPrice}
                    onChange={(e) => setNewMealPrice(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-purple-500 text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">Dietary Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer font-bold">
                    <input
                      type="radio"
                      name="isVeg"
                      checked={newMealIsVeg}
                      onChange={() => setNewMealIsVeg(true)}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-emerald-700">Pure Veg</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-bold">
                    <input
                      type="radio"
                      name="isVeg"
                      checked={!newMealIsVeg}
                      onChange={() => setNewMealIsVeg(false)}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span className="text-rose-700">Non-Veg</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Short Description (Optional)</label>
                <textarea
                  rows={2}
                  value={newMealDesc}
                  onChange={(e) => setNewMealDesc(e.target.value)}
                  placeholder="e.g. Served hot with fresh coconut chutney and sambar"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingMeal}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-extrabold rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-70"
                >
                  {creatingMeal ? 'Saving...' : 'Add Dish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
