'use client';

import React, { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldCheck,
  ChefHat,
  Mail,
  Lock,
  ArrowRight,
  AlertCircle,
  ArrowLeft,
  UtensilsCrossed,
  GraduationCap,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { useToast } from '@/components/ToastContext';

function StaffOrAdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = searchParams.get('role');
  const isStaff = roleParam === 'staff';
  const isAdmin = roleParam === 'admin';

  // If visited without role=admin or role=staff, redirect to root parent portal
  useEffect(() => {
    if (!isAdmin && !isStaff) {
      router.replace('/');
    }
  }, [isAdmin, isStaff, router]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { setAuthUser, refreshUser } = useAuth();
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          requestedRole: isStaff ? 'staff' : 'admin',
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // Non-JSON response
      }

      if (!res.ok) {
        setError(
          data?.error ||
          data?.diagnostic?.details ||
          `Server error (${res.status}). Please verify your database connection.`
        );
        setLoading(false);
        return;
      }

      setAuthUser(data.user);
      refreshUser().catch(() => {});
      showToast(`Welcome back, ${data.user.name}!`, 'success');

      if (data.redirectUrl) {
        router.push(data.redirectUrl);
      } else if (data.user.role === 'STAFF') {
        router.push('/staff/kitchen');
      } else if (data.user.role === 'ADMIN') {
        router.push('/admin/dashboard');
      } else {
        router.push('/parent/children');
      }
    } catch (err: any) {
      setError(err?.message || 'A network error occurred. Please try again.');
      setLoading(false);
    }
  };

  if (!isAdmin && !isStaff) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const themeColors = isStaff
    ? {
        bgGradient: 'from-amber-50/50 via-white to-slate-50',
        badgeBg: 'bg-amber-100 text-amber-800',
        iconBg: 'from-amber-500 to-orange-600 shadow-amber-500/25',
        buttonGradient: 'from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 shadow-amber-500/20',
        focusRing: 'focus:ring-amber-500',
      }
    : {
        bgGradient: 'from-purple-50/50 via-white to-slate-50',
        badgeBg: 'bg-purple-100 text-purple-700',
        iconBg: 'from-purple-600 to-indigo-600 shadow-purple-600/25',
        buttonGradient: 'from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-purple-600/20',
        focusRing: 'focus:ring-purple-500',
      };

  return (
    <div className={`min-h-[calc(100vh-4rem)] flex flex-col justify-center py-8 sm:py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b ${themeColors.bgGradient}`}>
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-3">
        {/* Back to Parent Portal Button */}
        <div className="flex items-center justify-start max-w-md mx-auto mb-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-amber-600 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs hover:border-amber-300 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Parent Portal</span>
          </Link>
        </div>

        <div className={`inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr ${themeColors.iconBg} items-center justify-center text-white shadow-lg`}>
          {isStaff ? <ChefHat className="w-7 h-7" /> : <ShieldCheck className="w-7 h-7" />}
        </div>

        <div>
          <div className="inline-block mb-1.5">
            <span className={`px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider rounded-md ${themeColors.badgeBg}`}>
              {isStaff ? 'Canteen Staff Portal' : 'School Administration Portal'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            {isStaff ? 'Canteen Staff Sign In' : 'Canteen & Admin Sign In'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {isStaff
              ? 'Access kitchen production summary and daily student meal collection'
              : 'Access overview dashboard, menu publishing, and student orders'}
          </p>
        </div>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-5 sm:px-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-2xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                {isStaff ? 'Staff Email Address' : 'Admin Email Address'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity('Please enter a valid email address.')}
                  onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
                  placeholder={isStaff ? 'staff@school.com' : 'admin@school.com'}
                  className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 ${themeColors.focusRing} focus:bg-white text-slate-900 transition-all font-medium`}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 ${themeColors.focusRing} focus:bg-white text-slate-900 transition-all`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-3 px-4 bg-gradient-to-r ${themeColors.buttonGradient} text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 mt-2`}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{isStaff ? 'Sign In as Canteen Staff' : 'Sign In as Admin'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Switch Between Admin & Staff */}
          <div className="pt-4 border-t border-slate-100 text-center">
            {isStaff ? (
              <p className="text-xs text-slate-500">
                Need full admin privileges?{' '}
                <Link
                  href="/login?role=admin"
                  className="text-purple-600 hover:text-purple-700 font-bold hover:underline"
                >
                  Switch to Admin Login →
                </Link>
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Kitchen or Canteen Staff?{' '}
                <Link
                  href="/login?role=staff"
                  className="text-amber-600 hover:text-amber-700 font-bold hover:underline"
                >
                  Switch to Staff Login →
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* Teacher Direct Food Order Button */}
        <div className="mt-4">
          <Link
            href="/teacher/menu"
            className="w-full py-3 px-4 bg-gradient-to-r from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 text-emerald-950 border-2 border-emerald-300 font-extrabold text-xs sm:text-sm rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xs group cursor-pointer"
          >
            <GraduationCap className="w-4 h-4 text-emerald-700 group-hover:scale-110 transition-transform" />
            <span>Teachers Only →</span>
          </Link>
        </div>

        {/* Clear Return to Parent Portal link */}
        <div className="mt-4 text-center space-y-2">
          <p className="text-xs text-slate-500">
            Are you a parent looking to pre-order food?{' '}
            <Link
              href="/"
              className="text-amber-600 hover:text-amber-700 font-bold hover:underline"
            >
              Go to Parent Login →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[80vh] flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <StaffOrAdminLoginForm />
    </Suspense>
  );
}

