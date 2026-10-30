'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ArrowRight,
  UtensilsCrossed,
  Calendar,
  AlertCircle,
  ShieldCheck,
  FileText,
  Loader2,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
import { useCart } from '@/components/CartContext';
import { useAuth } from '@/components/AuthContext';
import { useToast } from '@/components/ToastContext';
import VegBadge from '@/components/VegBadge';
import MealIcon from '@/components/MealIcon';
import { formatINR, formatDatePretty } from '@/lib/utils';

const CHECKOUT_KEY_STORAGE = 'sb_checkout_key';

function checkoutSignature(items: Array<{ studentId: string; mealId: string; date: string; quantity: number }>, notes: string) {
  const lines = items.map((i) => `${i.studentId}|${i.mealId}|${i.date}|${i.quantity}`).sort();
  return `${lines.join(';')}#${notes.trim()}`;
}

/** Same cart -> same key (so retries never create a second payment); `fresh` starts a new checkout. */
function checkoutKeyFor(signature: string, fresh = false): string {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_KEY_STORAGE) || 'null');
    if (!fresh && stored?.signature === signature && typeof stored.key === 'string') return stored.key;
  } catch {
    // storage unavailable: fall through to a new key
  }
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Math.random()}`.slice(2);
  const key = `CHK-${Date.now()}-${random}`;
  try {
    sessionStorage.setItem(CHECKOUT_KEY_STORAGE, JSON.stringify({ signature, key }));
  } catch {
    // ignore
  }
  return key;
}

function forgetCheckoutKey() {
  try {
    sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
  } catch {
    // ignore
  }
}

export default function CartPage() {
  const router = useRouter();
  const { cartItems, updateQuantity, removeFromCart, clearCart, subtotal, totalItems } = useCart();
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();

  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [phoneRequired, setPhoneRequired] = useState(false);

  // Live availability tracking: Map of `${mealId}__${date}` -> reason
  const [unavailableItemsMap, setUnavailableItemsMap] = useState<Record<string, string>>({});
  const [isValidatingAvailability, setIsValidatingAvailability] = useState(false);

  // Group cart items by student and date for clear visual organization
  const groupedByChildAndDate: Record<string, typeof cartItems> = {};
  cartItems.forEach((item) => {
    const key = `${item.studentName} (Class ${item.studentGrade}-${item.studentDivision})__${item.date}`;
    if (!groupedByChildAndDate[key]) groupedByChildAndDate[key] = [];
    groupedByChildAndDate[key].push(item);
  });

  // Revalidate availability on mount and whenever cartItems change
  useEffect(() => {
    if (cartItems.length === 0) {
      setUnavailableItemsMap({});
      return;
    }

    let isMounted = true;
    async function checkAvailability() {
      setIsValidatingAvailability(true);
      try {
        const res = await fetch('/api/parent/cart/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cartItems }),
        });

        if (res.ok && isMounted) {
          const data = await res.json();
          const map: Record<string, string> = {};
          if (Array.isArray(data.items)) {
            data.items.forEach((it: any) => {
              if (!it.isAvailable) {
                map[`${it.mealId}__${it.date}`] = it.reason || 'Not available for this date';
              }
            });
          }
          setUnavailableItemsMap(map);
        }
      } catch (err) {
        console.error('Failed to validate cart items:', err);
      } finally {
        if (isMounted) setIsValidatingAvailability(false);
      }
    }

    checkAvailability();

    return () => {
      isMounted = false;
    };
  }, [cartItems]);

  const unavailableCount = Object.keys(unavailableItemsMap).length;
  const hasUnavailableItems = unavailableCount > 0;

  // One-click remove all unavailable meals from cart
  const handleRemoveAllUnavailable = () => {
    let removedCount = 0;
    cartItems.forEach((item) => {
      const key = `${item.mealId}__${item.date}`;
      if (unavailableItemsMap[key]) {
        removeFromCart(item.cartItemId);
        removedCount++;
      }
    });
    setUnavailableItemsMap({});
    setErrorMessage('');
    showToast(`Removed ${removedCount} unavailable item(s) from cart`, 'info');
  };

  // Preload Cashfree SDK in background so checkout is instant
  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as any).Cashfree) {
      const script = document.createElement('script');
      script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  const loadCashfreeSdk = (): Promise<any> => {
    if (typeof window !== 'undefined' && (window as any).Cashfree) {
      return Promise.resolve((window as any).Cashfree);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      script.async = true;
      script.onload = () => {
        if ((window as any).Cashfree) {
          resolve((window as any).Cashfree);
        } else {
          reject(new Error('Cashfree SDK failed to initialize'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load Cashfree SDK script'));
      document.body.appendChild(script);
    });
  };

  const handleProceedToPayment = async () => {
    if (processing) return;
    if (cartItems.length === 0) return;

    if (!user) {
      router.push('/login?redirect=/parent/cart');
      return;
    }

    if (hasUnavailableItems) {
      showToast('Please remove unavailable meals before proceeding to payment', 'error');
      return;
    }

    setErrorMessage('');
    setPhoneRequired(false);
    setProcessing(true);

    try {
      // The same cart reuses the same checkout key, so pressing Pay again (or retrying after a
      // network error) continues the existing payment instead of creating a second one.
      const signature = checkoutSignature(cartItems, notes);
      const submit = (idempotencyKey: string) =>
        fetch('/api/parent/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cartItems,
            paymentMethod: 'UPI',
            notes: notes.trim() || undefined,
            idempotencyKey,
          }),
        });

      let res = await submit(checkoutKeyFor(signature));
      let data = await res.json();
      if (res.status === 409 && data.code === 'CHECKOUT_EXPIRED') {
        // The previous payment window closed unpaid: start a new one.
        res = await submit(checkoutKeyFor(signature, true));
        data = await res.json();
      }

      if (!res.ok) {
        const errorText = data.error || 'Unable to create order. Please try again.';
        setErrorMessage(errorText);
        setPhoneRequired(data.code === 'PHONE_REQUIRED');
        if (data.unavailableItem) {
          const key = `${data.unavailableItem.mealId}__${data.unavailableItem.date}`;
          setUnavailableItemsMap((prev) => ({
            ...prev,
            [key]: data.unavailableItem.reason || 'Disabled by canteen staff',
          }));
        }
        showToast(errorText, 'error');
        setProcessing(false);
        return;
      }

      // If Cashfree Payment Gateway Session is returned, launch official Cashfree modal directly
      if (data.paymentSessionId) {
        try {
          // The server reports which Cashfree environment created the session.
          if (data.cashfreeMode !== 'production' && data.cashfreeMode !== 'sandbox') {
            throw new Error('Payment gateway mode was not provided by the server');
          }
          const CashfreeSDK = await loadCashfreeSdk();
          const cashfree = CashfreeSDK({ mode: data.cashfreeMode });

          cashfree
            .checkout({
              paymentSessionId: data.paymentSessionId,
              redirectTarget: '_modal',
            })
            .then((result: any) => {
              if (result?.error) {
                setErrorMessage(result.error.message || 'Payment was cancelled or could not be completed.');
                showToast(result.error.message || 'Payment cancelled', 'error');
                setProcessing(false);
              } else {
                // Completed inside modal or redirected: the confirmation page verifies with Cashfree.
                // The checkout key is kept until that page sees the payment confirmed, so paying
                // again for this cart while a UPI payment is still pending reopens the same payment.
                refreshUser().catch(() => {});
                showToast('Payment submitted! Verifying order...', 'success');
                router.push(`/parent/confirmation/${data.orderId}`);
              }
            })
            .catch(() => {
              // The payment window failed; the server still knows this checkout, so it is safe to retry.
              setErrorMessage('The payment window closed unexpectedly. If you paid, check My Orders before trying again.');
              setProcessing(false);
            });
          return;
        } catch (sdkErr: any) {
          console.error('Error opening Cashfree Checkout:', sdkErr);
          setErrorMessage('Could not open payment window. Please try again.');
          showToast('Payment window could not be opened', 'error');
          setProcessing(false);
          return;
        }
      }

      // No payment needed now: an earlier attempt for this cart was already paid, or mock mode.
      forgetCheckoutKey();
      refreshUser().catch(() => {});
      showToast(data.alreadyPaid ? 'This order was already paid. Showing its status...' : 'Order submitted!', 'success');
      router.push(`/parent/confirmation/${data.orderId}`);
    } catch {
      setErrorMessage('A network error occurred while connecting to payment gateway. Please retry.');
      showToast('Network error connecting to payment gateway', 'error');
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <ShoppingCart className="w-7 h-7 text-amber-500" />
            <span>Shopping Cart</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Review your selected meals grouped by child and date before proceeding to payment.
          </p>
        </div>

        {cartItems.length > 0 && (
          <button
            onClick={clearCart}
            disabled={processing}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
          >
            Clear All
          </button>
        )}
      </div>

      {cartItems.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-4 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <ShoppingCart className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-800">Your Cart is Empty</h3>
          <p className="text-xs text-slate-500">
            Browse today&apos;s or the weekly lunch menu, select a child, and add delicious nutritious meals.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Link
              href="/parent/menu"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-xs font-bold shadow-md hover:from-amber-600 hover:to-orange-600 transition-all"
            >
              <UtensilsCrossed className="w-4 h-4" />
              <span>Explore Menu</span>
            </Link>
            <Link
              href="/parent/orders"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition-all"
            >
              <FileText className="w-4 h-4 text-amber-600" />
              <span>Order History</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Cart Items List */}
          <div className="lg:col-span-8 space-y-6">
            {/* Unavailable Meals Warning Banner */}
            {hasUnavailableItems && (
              <div className="bg-rose-50 border border-rose-200 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-rose-900">
                      Meal Availability Alert ({unavailableCount} item{unavailableCount > 1 ? 's' : ''} unavailable)
                    </h4>
                    <p className="text-xs text-rose-700 mt-0.5">
                      Some meals in your cart are no longer available for their selected date (disabled by canteen staff or ordering cutoff passed). Please remove them to proceed.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleRemoveAllUnavailable}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shrink-0 transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Unavailable Items</span>
                </button>
              </div>
            )}

            {Object.entries(groupedByChildAndDate).map(([groupKey, items]) => {
              const [studentInfo, dateStr] = groupKey.split('__');
              return (
                <div
                  key={groupKey}
                  className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden"
                >
                  {/* Group Header: Student & Date */}
                  <div className="bg-amber-50/70 px-4 sm:px-5 py-3 border-b border-amber-100 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">{studentInfo}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-amber-900 shrink-0">
                      <Calendar className="w-3.5 h-3.5 text-amber-600" />
                      <span>{formatDatePretty(dateStr)}</span>
                    </div>
                  </div>

                  {/* Items for this student & date */}
                  <div className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const itemKey = `${item.mealId}__${item.date}`;
                      const itemUnavailableReason = unavailableItemsMap[itemKey];
                      const isItemUnavailable = Boolean(itemUnavailableReason);

                      return (
                        <div
                          key={item.cartItemId}
                          className={`p-3.5 sm:p-5 transition-colors space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4 ${
                            isItemUnavailable ? 'bg-rose-50/40 border-l-4 border-l-rose-500' : 'hover:bg-slate-50/50'
                          }`}
                        >
                          {/* Top on mobile, Left on desktop: Meal Icon & Info */}
                          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                            <div className="shrink-0 mt-0.5 sm:mt-0">
                              <MealIcon
                                name={item.mealName}
                                category={item.mealCategory}
                                size="md"
                              />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <VegBadge isVegetarian={item.isVegetarian} size="sm" />
                                <h4 className="font-bold text-slate-900 text-sm leading-snug break-words">
                                  {item.mealName}
                                </h4>
                              </div>
                              <p className="text-xs font-semibold text-amber-700 mt-0.5">
                                {formatINR(item.mealPrice)} each
                              </p>

                              {/* Item Availability Badge */}
                              {isItemUnavailable && (
                                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-rose-700 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-md w-fit">
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  <span>Unavailable: {itemUnavailableReason}</span>
                                </div>
                              )}
                            </div>

                            {/* Mobile-only trash button in top-right corner */}
                            <button
                              onClick={() => removeFromCart(item.cartItemId)}
                              disabled={processing}
                              className="sm:hidden p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                              title="Remove meal"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Bottom on mobile, Right on desktop: Quantity Controls & Subtotal */}
                          <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 pt-2.5 sm:pt-0 border-t border-slate-100 sm:border-0">
                            <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50 overflow-hidden shadow-2xs">
                              <button
                                onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                                disabled={processing}
                                className="p-1.5 sm:p-2 hover:bg-white text-slate-600 transition-colors disabled:opacity-50 cursor-pointer"
                                title="Decrease quantity"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="px-3 text-xs font-bold text-slate-800 min-w-6 text-center">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                                disabled={processing}
                                className="p-1.5 sm:p-2 hover:bg-white text-slate-600 transition-colors disabled:opacity-50 cursor-pointer"
                                title="Increase quantity"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="font-extrabold text-slate-900 text-sm sm:text-base text-right whitespace-nowrap">
                                {formatINR(item.mealPrice * item.quantity)}
                              </span>

                              {/* Desktop-only trash button */}
                              <button
                                onClick={() => removeFromCart(item.cartItemId)}
                                disabled={processing}
                                className="hidden sm:block p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                                title="Remove meal"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Payment & Order Box */}
          <div className="lg:col-span-4 bg-white rounded-3xl p-6 border border-slate-100 shadow-xl space-y-5 sticky top-24">
            <h3 className="font-extrabold text-slate-900 text-lg border-b border-slate-100 pb-3">
              Order Summary
            </h3>

            {/* Price Breakdown */}
            <div className="space-y-3 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Total Meals</span>
                <span className="font-bold text-slate-800">{totalItems} portions</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-bold text-slate-800">{formatINR(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Taxes & Fees</span>
                <span className="font-bold text-emerald-600">₹0</span>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-between items-baseline">
                <span className="text-base font-extrabold text-slate-900">Total Payable</span>
                <span className="text-2xl font-black text-amber-600">{formatINR(subtotal)}</span>
              </div>
            </div>

            {/* Special Instructions */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
                <span>Kitchen Instructions (Optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Mild spice, warm packing..."
                rows={2}
                disabled={processing}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none placeholder:text-slate-400"
              />
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-700 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed font-medium">
                  {errorMessage}
                  {phoneRequired && (
                    <Link href="/parent/profile#phone" className="block mt-1.5 font-bold underline text-rose-800">
                      Add mobile number →
                    </Link>
                  )}
                </span>
              </div>
            )}

            {/* Proceed to Payment Button */}
            <button
              onClick={handleProceedToPayment}
              disabled={processing || cartItems.length === 0 || hasUnavailableItems}
              className={`w-full py-3.5 text-white rounded-2xl font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                hasUnavailableItems
                  ? 'bg-rose-500 shadow-rose-500/20 hover:bg-rose-600'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-500/25 active:scale-[0.99]'
              }`}
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting to Cashfree...</span>
                </>
              ) : hasUnavailableItems ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span>Remove {unavailableCount} Unavailable Meal{unavailableCount > 1 ? 's' : ''} to Pay</span>
                </>
              ) : (
                <>
                  <span>Proceed to Payment</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {hasUnavailableItems && (
              <p className="text-[11px] text-rose-600 text-center font-medium">
                Please remove disabled meals or update your cart above before paying.
              </p>
            )}

            {/* Security & Gateway Trust Badge */}
            <div className="pt-1 text-center space-y-1">
              <div className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Secured by Cashfree Payments</span>
              </div>
              <p className="text-[10px] text-slate-400">
                Supports UPI, Cards, Net Banking & Wallets • 256-bit Bank Grade Security
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
