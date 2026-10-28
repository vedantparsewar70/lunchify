'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  UtensilsCrossed,
  Mail,
  Lock,
  User,
  Phone,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Sparkles,
  KeyRound,
  GraduationCap,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { useToast } from '@/components/ToastContext';
import { INVALID_PHONE_MESSAGE, normalizeIndianMobile } from '@/lib/phone';

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get('mode');

  const { user, isLoading: authLoading, setAuthUser, refreshUser } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<'login' | 'register'>(
    modeParam === 'register' ? 'register' : 'login'
  );

  // Sync mode with query param if it changes
  useEffect(() => {
    if (modeParam === 'register') {
      setMode('register');
    } else if (modeParam === 'login' || !modeParam) {
      setMode('login');
    }
  }, [modeParam]);

  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setError('');
    const targetUrl = newMode === 'register' ? '/?mode=register' : '/';
    window.history.replaceState(null, '', targetUrl);
  };

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form state
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPhone, setRegisterPhone] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (!authLoading && user) {
      if (user.role === 'ADMIN') {
        router.replace('/admin/orders');
      } else {
        router.replace('/parent/children');
      }
    }
  }, [user, authLoading, router]);

  // Validation helper for Parent Login email field
  const validateParentEmail = (input: HTMLInputElement) => {
    const val = input.value.trim();
    if (!val) {
      input.setCustomValidity('');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (input.validity.typeMismatch || !emailRegex.test(val)) {
      input.setCustomValidity('Please enter a valid email address.');
    } else {
      input.setCustomValidity('');
    }
  };

  // Handler for login submission
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // Non-JSON response (e.g. Vercel serverless gateway error)
      }

      if (!res.ok) {
        setError(
          data?.error ||
          data?.diagnostic?.details ||
          `Server error (${res.status}). Please check database connection.`
        );
        setSubmitting(false);
        return;
      }

      setAuthUser(data.user);
      refreshUser().catch(() => {});
      showToast(`Welcome, ${data.user.name}!`, 'success');

      if (data.user.role === 'ADMIN') {
        router.push('/admin/orders');
      } else {
        router.push('/parent/children');
      }
    } catch (err: any) {
      setError(err?.message || 'Network connection error. Please try again.');
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (registerPassword !== registerConfirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (registerPassword.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (!normalizeIndianMobile(registerPhone)) {
      setError(INVALID_PHONE_MESSAGE);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: registerName.trim(),
          email: registerEmail.trim().toLowerCase(),
          phone: registerPhone.trim(),
          password: registerPassword,
          confirmPassword: registerConfirmPassword,
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
          data?.details ||
          `Server error (${res.status}). Please check database connection.`
        );
        setSubmitting(false);
        return;
      }

      setAuthUser(data.user);
      refreshUser().catch(() => {});
      showToast('Parent account registered successfully!', 'success');
      router.push('/parent/children');
    } catch (err: any) {
      setError(err?.message || 'Network connection error. Please try again.');
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-center py-10 sm:py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-amber-50/50 via-white to-slate-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-3">
        {/* Brand Icon */}
        <div className="inline-block">
          <img
            src="/logo.png"
            alt="School Bite Logo"
            className="w-16 h-16 rounded-2xl shadow-lg shadow-amber-500/25 object-contain mx-auto"
          />
        </div>

        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            School<span className="text-amber-600">-Bite</span> Parent Portal
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Order fresh, wholesome school canteen meals for your child at S.B. Patil School
          </p>
        </div>

        {/* Tab switch between Login and Register */}
        <div className="pt-2">
          <div className="bg-slate-100 p-1 rounded-2xl flex max-w-xs mx-auto border border-slate-200">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Parent Login
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Register
            </button>
          </div>
        </div>

        {/* Teachers Button */}
        <div className="pt-1 flex justify-center">
          <Link
            href="/teacher/menu"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 rounded-full text-xs font-extrabold shadow-2xs transition-colors cursor-pointer"
          >
            <GraduationCap className="w-3.5 h-3.5 text-teal-600" />
            <span>Teachers Only →</span>
          </Link>
        </div>
      </div>

      {/* Main Form Card */}
      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-5 sm:px-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-6">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-2xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {mode === 'login' ? (
            /* PARENT LOGIN FORM */
            <form
              onSubmit={handleLoginSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const emailInput = e.currentTarget.querySelector<HTMLInputElement>('input[type="email"]');
                  if (emailInput) validateParentEmail(emailInput);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Parent Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => {
                      setLoginEmail(e.target.value);
                      validateParentEmail(e.currentTarget);
                    }}
                    onInput={(e) => validateParentEmail(e.currentTarget)}
                    onBlur={(e) => validateParentEmail(e.currentTarget)}
                    onInvalid={(e) => validateParentEmail(e.currentTarget)}
                    placeholder="Enter parent email address"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900 transition-all font-medium"
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
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                onClick={(e) => {
                  const form = e.currentTarget.closest('form');
                  const emailInput = form?.querySelector<HTMLInputElement>('input[type="email"]');
                  if (emailInput) validateParentEmail(emailInput);
                }}
                className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 mt-2"
              >
                {submitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Parent Login</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <p className="text-xs text-slate-500">
                  New to School-Bite?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="font-bold text-amber-600 hover:text-amber-700 hover:underline cursor-pointer"
                  >
                    Register as Parent
                  </button>
                </p>
              </div>
            </form>
          ) : (
            /* PARENT REGISTRATION FORM */
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900 transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity('Please enter a valid email address.')}
                    onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
                    placeholder="Enter parent email address"
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900 transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={registerPhone}
                    onChange={(e) => setRegisterPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900 transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Create Password (min. 6 chars)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={registerConfirmPassword}
                    onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 mt-2"
              >
                {submitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Register as Parent</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <p className="text-xs text-slate-500">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="font-bold text-amber-600 hover:text-amber-700 hover:underline cursor-pointer"
                  >
                    Parent Login
                  </button>
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Footer info & Staff/Admin login links */}
        <div className="mt-6 text-center space-y-2">
          <div className="flex items-center justify-center text-xs pt-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200/80 rounded-full font-bold shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              <span>100% Pure Vegetarian</span>
            </span>
          </div>

          <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5 flex-wrap">
            <span>Are you school canteen staff or an administrator?</span>
            <Link
              href="/login?role=staff"
              className="text-amber-600 hover:text-amber-700 font-bold hover:underline"
            >
              Staff Login →
            </Link>
            <span className="text-slate-300">•</span>
            <Link
              href="/login?role=admin"
              className="text-purple-600 hover:text-purple-700 font-bold hover:underline"
            >
              Admin Login →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[80vh] flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
