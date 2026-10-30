'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  UtensilsCrossed,
  ArrowLeft,
  GraduationCap,
  ShoppingBag,
  Plus,
  Minus,
  Sparkles,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  X,
  CreditCard,
  AlertCircle,
  Coffee,
  Sun,
  Clock,
} from 'lucide-react';
import VegBadge from '@/components/VegBadge';
import { formatINR, formatDatePretty, getTodayString } from '@/lib/utils';
import { useToast } from '@/components/ToastContext';
import { useAuth } from '@/components/AuthContext';
import { INVALID_PHONE_MESSAGE, normalizeIndianMobile, TEACHER_PHONE_REQUIRED_MESSAGE } from '@/lib/phone';
import { loadCashfreeSdk } from '@/lib/cashfree-client';
import { useSyncWatcher } from '@/lib/client-sync';

interface TeacherMeal {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  isVegetarian: boolean;
  isAvailable?: boolean;
}

interface CartEntry {
  meal: TeacherMeal;
  quantity: number;
}

export default function TeacherMenuPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { user } = useAuth();
  const todayDateStr = getTodayString();

  const [meals, setMeals] = useState<TeacherMeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Cart state: mealId -> CartEntry
  const [cart, setCart] = useState<Record<string, CartEntry>>({});

  // Checkout modal state
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [teacherName, setTeacherName] = useState('');
  const [teacherPhone, setTeacherPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (user?.name && !teacherName) {
      setTeacherName(user.name);
    }
    if (user?.phone && !teacherPhone) {
      setTeacherPhone(user.phone);
    }
  }, [user]);

  // Fetch teacher menu
  const fetchMenu = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const res = await fetch('/api/teacher/menu', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setMeals(data.meals || []);
      }
    } catch (err) {
      console.error('Failed to load teacher menu:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMenu();
  }, []);

  // Real-time synchronization when staff updates/saves the teacher menu
  useSyncWatcher({
    onTeacherOrdersUpdate: () => {
      fetchMenu(true);
    },
    onMenuUpdate: () => {
      fetchMenu(true);
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    meals.forEach((m) => {
      if (m.category) set.add(m.category.toUpperCase());
    });
    return ['ALL', ...Array.from(set)];
  }, [meals]);

  const filteredMeals = useMemo(() => {
    if (selectedCategory === 'ALL') return meals;
    return meals.filter((m) => (m.category || 'LUNCH').toUpperCase() === selectedCategory);
  }, [meals, selectedCategory]);

  const totalItemsCount = useMemo(() => {
    return Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const totalAmount = useMemo(() => {
    return Object.values(cart).reduce((sum, item) => sum + item.meal.price * item.quantity, 0);
  }, [cart]);

  const handleUpdateQuantity = (meal: TeacherMeal, delta: number) => {
    setCart((prev) => {
      const currentQty = prev[meal.id]?.quantity || 0;
      const newQty = currentQty + delta;
      if (newQty <= 0) {
        const copy = { ...prev };
        delete copy[meal.id];
        return copy;
      }
      return {
        ...prev,
        [meal.id]: {
          meal,
          quantity: newQty,
        },
      };
    });
  };

  const handleProceedToPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanName = teacherName.trim();
    if (!cleanName) {
      setErrorMessage('Please enter your name');
      return;
    }

    if (totalItemsCount === 0) {
      setErrorMessage('Your cart is empty. Please select food items.');
      return;
    }

    // The payment gateway needs the payer's own mobile number: the one typed here,
    // otherwise the number saved on the account (the server checks this again).
    const typedPhone = teacherPhone.trim();
    if (typedPhone ? !normalizeIndianMobile(typedPhone) : !normalizeIndianMobile(user?.phone)) {
      setErrorMessage(typedPhone ? INVALID_PHONE_MESSAGE : TEACHER_PHONE_REQUIRED_MESSAGE);
      return;
    }

    setSubmitting(true);

    try {
      const cartItemsPayload = Object.values(cart).map((entry) => ({
        mealId: entry.meal.id,
        mealName: entry.meal.name,
        category: entry.meal.category,
        price: entry.meal.price,
        quantity: entry.quantity,
        isVegetarian: entry.meal.isVegetarian,
      }));

      // 1. Create Teacher Order on Server
      const res = await fetch('/api/teacher/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherName: cleanName,
          teacherPhone: teacherPhone.trim() || undefined,
          notes: notes.trim() || undefined,
          items: cartItemsPayload,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorText = data.error || 'Failed to place order. Please try again.';
        setErrorMessage(errorText);
        showToast(errorText, 'error');
        setSubmitting(false);
        return;
      }

      const { orderId, paymentSessionId, cashfreeMode } = data;

      // 2. Open Cashfree Checkout Modal
      if (paymentSessionId) {
        try {
          // The server reports which Cashfree environment created the session.
          if (cashfreeMode !== 'production' && cashfreeMode !== 'sandbox') {
            throw new Error('Payment gateway mode was not provided by the server');
          }
          const CashfreeSDK = await loadCashfreeSdk();
          const cashfree = CashfreeSDK({ mode: cashfreeMode });

          cashfree
            .checkout({
              paymentSessionId,
              redirectTarget: '_modal',
            })
            .then(async (result: any) => {
              if (result?.error) {
                setErrorMessage(result.error.message || 'Payment cancelled or could not be completed.');
                showToast(result.error.message || 'Payment cancelled', 'error');
                setSubmitting(false);
              } else {
                // Verify payment on server
                try {
                  await fetch('/api/teacher/orders/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId }),
                  });
                } catch {}

                showToast('Payment successful! Your order has been placed.', 'success');
                router.push(`/teacher/confirmation/${orderId}`);
              }
            })
            .catch(() => {
              // The payment window failed: let the teacher check the order status instead of paying again.
              setErrorMessage('The payment window closed unexpectedly. If you paid, open the confirmation page before trying again.');
              setSubmitting(false);
              router.push(`/teacher/confirmation/${orderId}`);
            });
          return;
        } catch (sdkErr: any) {
          console.error('Error opening Cashfree Checkout:', sdkErr);
          setErrorMessage('Could not open payment window. Please try again.');
          showToast('Payment window failed to load', 'error');
          setSubmitting(false);
          return;
        }
      }

      // Fallback
      router.push(`/teacher/confirmation/${orderId}`);
    } catch {
      setErrorMessage('Network error during checkout. Please retry.');
      showToast('Network error during checkout', 'error');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-32">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-amber-100 shadow-2xs">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              title="Back to Login"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <GraduationCap className="w-3 h-3" />
                  <span>Teacher & Staff Direct Order</span>
                </span>
              </div>
              <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-1.5 mt-0.5">
                <UtensilsCrossed className="w-4 h-4 text-amber-500" />
                <span>Today&apos;s Teacher Menu</span>
              </h1>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Direct Orders
            </span>
            <span className="text-xs font-black text-amber-600">
              {formatDatePretty(todayDateStr)}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Notice Banner */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl p-4 text-white shadow-sm flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-wide uppercase bg-white/20 px-2 py-0.5 rounded-md">
                Teachers Only
              </span>
              <span className="text-[11px] font-semibold text-emerald-100">
                • 100% Pure Vegetarian
              </span>
            </div>
            <p className="text-sm sm:text-base font-extrabold text-white">
              Order fresh food & collect at counter with your name
            </p>
            <p className="text-xs text-emerald-100/90 font-medium">
              Direct orders for today. Pay securely online via UPI or card.
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/10 hidden sm:flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Authentication & Role Notice */}
        {user?.role === 'PARENT' && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-2xl flex items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>You are signed in as a Parent. The Teacher Menu is reserved for Staff & Faculty.</span>
            </div>
            <Link
              href="/parent/menu"
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shrink-0 transition-colors"
            >
              Go to Parent Menu →
            </Link>
          </div>
        )}

        {/* Category Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {cat === 'ALL'
                ? 'All Dishes'
                : cat === 'BREAKFAST'
                ? 'Breakfast'
                : cat === 'LUNCH'
                ? 'Lunch'
                : cat === 'BEVERAGE'
                ? 'Beverages'
                : cat}
            </button>
          ))}
        </div>

        {/* Menu Cards List */}
        {loading ? (
          <div className="min-h-[40vh] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredMeals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center space-y-2">
            <UtensilsCrossed className="w-10 h-10 mx-auto text-slate-300" />
            <h3 className="font-extrabold text-slate-800 text-base">No Items Available Right Now</h3>
            <p className="text-xs text-slate-500">
              The canteen kitchen has not activated any items in this category today. Please check back shortly.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredMeals.map((meal) => {
              const qtyInCart = cart[meal.id]?.quantity || 0;

              return (
                <div
                  key={meal.id}
                  className={`bg-white rounded-2xl p-4 sm:p-5 border-2 transition-all flex flex-col justify-between gap-3 ${
                    qtyInCart > 0
                      ? 'border-amber-400 shadow-sm ring-1 ring-amber-300/50'
                      : 'border-slate-200/90 hover:border-slate-300 shadow-2xs'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <VegBadge isVegetarian={meal.isVegetarian} size="sm" />
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          {meal.category || 'LUNCH'}
                        </span>
                      </div>
                      <span className="text-base sm:text-lg font-black text-amber-600">
                        {formatINR(meal.price)}
                      </span>
                    </div>

                    <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-snug">
                      {meal.name}
                    </h2>
                    {meal.description && (
                      <p className="text-xs text-slate-500 font-medium line-clamp-2">
                        {meal.description}
                      </p>
                    )}
                  </div>

                  {/* Quantity Actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">
                      {qtyInCart > 0 ? (
                        <span className="text-amber-700 font-extrabold">
                          Subtotal: {formatINR(meal.price * qtyInCart)}
                        </span>
                      ) : (
                        'Select quantity'
                      )}
                    </span>

                    {qtyInCart === 0 ? (
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(meal, 1)}
                        className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5 text-amber-600" />
                        <span>Add</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-xl p-1 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(meal, -1)}
                          className="w-7 h-7 bg-white hover:bg-amber-100 text-amber-900 rounded-lg flex items-center justify-center font-bold text-sm shadow-2xs cursor-pointer active:scale-90"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-black text-amber-900">
                          {qtyInCart}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(meal, 1)}
                          className="w-7 h-7 bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center justify-center font-bold text-sm shadow-2xs cursor-pointer active:scale-90"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Bottom Cart Bar */}
      {totalItemsCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-amber-200 p-3 sm:p-4 shadow-xl animate-in slide-in-from-bottom duration-200">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block leading-tight">
                  {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'items'} in cart
                </span>
                <span className="text-lg sm:text-xl font-black text-slate-900 leading-tight">
                  {formatINR(totalAmount)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsCheckoutOpen(true)}
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-sm font-black transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-amber-500/20 active:scale-98"
            >
              <span>Continue to Order</span>
              <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
              <span>{formatINR(totalAmount)}</span>
            </button>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <GraduationCap className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">Teacher Meal Order</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Direct collection at canteen</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCheckoutOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleProceedToPayment} className="space-y-4">
              {/* Teacher Details */}
              <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    Your Name (Teacher / Staff) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    placeholder="e.g. Pooja Sharma, Rajiv Verma"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Tell this name at the canteen counter to collect your food.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    Mobile Number (required for payment)
                  </label>
                  <input
                    type="tel"
                    value={teacherPhone}
                    onChange={(e) => setTeacherPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    Special Note / Instruction (Optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Less spicy, keep ready by 1:15 PM"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
              </div>

              {/* Order Items Summary */}
              <div className="space-y-2 border border-slate-200 rounded-2xl p-3.5">
                <span className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                  Items Summary
                </span>
                <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto pr-1">
                  {Object.values(cart).map((entry) => (
                    <div key={entry.meal.id} className="py-2 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-extrabold text-slate-900">{entry.meal.name}</span>
                        <span className="text-slate-500 ml-1.5 font-medium">x {entry.quantity}</span>
                      </div>
                      <span className="font-black text-slate-800">
                        {formatINR(entry.meal.price * entry.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-sm">
                  <span className="font-black text-slate-900">Total Payable</span>
                  <span className="font-black text-amber-600 text-base">
                    {formatINR(totalAmount)}
                  </span>
                </div>
              </div>

              {/* Secure Payment Note */}
              <div className="flex items-center gap-2 p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Secure payment via Cashfree Gateway (UPI, Cards, NetBanking).</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCheckoutOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-amber-500/20"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CreditCard className="w-4 h-4" />
                  )}
                  <span>Pay {formatINR(totalAmount)} & Place Order</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
