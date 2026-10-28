'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  User,
  Phone,
  Mail,
  Users,
  ShieldCheck,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { INVALID_PHONE_MESSAGE, normalizeIndianMobile } from '@/lib/phone';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  const savePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError('');
    if (!normalizeIndianMobile(phoneInput)) {
      setPhoneError(INVALID_PHONE_MESSAGE);
      return;
    }
    setSavingPhone(true);
    try {
      const res = await fetch('/api/parent/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhoneError(data.error || 'Could not update phone number. Please try again.');
        return;
      }
      await refreshUser();
      setEditingPhone(false);
    } catch {
      setPhoneError('Network error. Please try again.');
    } finally {
      setSavingPhone(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
          <User className="w-7 h-7 text-amber-500" />
          <span>Parent Profile</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Manage your account credentials, emergency phone number, and registered children.
        </p>
      </div>

      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-400 to-orange-500 text-white flex items-center justify-center font-black text-2xl shadow-md shadow-amber-500/20">
            {user?.name?.charAt(0) || 'P'}
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">{user?.name}</h2>
            <span className="text-xs font-semibold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md">
              Parent Account
            </span>
          </div>
        </div>

        <div className="space-y-4 pt-2 text-xs divide-y divide-slate-100">
          <div className="flex items-center justify-between py-3">
            <span className="text-slate-500 font-bold uppercase text-[10px] flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-400" /> Email Address
            </span>
            <span className="font-semibold text-slate-800 text-sm">{user?.email}</span>
          </div>

          <div id="phone" className="py-3 space-y-2 scroll-mt-24">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500 font-bold uppercase text-[10px] flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" /> Mobile Number
              </span>
              {editingPhone ? null : (
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 text-sm">{user?.phone || 'Not provided'}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPhoneInput(user?.phone || '');
                      setPhoneError('');
                      setEditingPhone(true);
                    }}
                    className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl border border-amber-200 transition-colors"
                  >
                    {user?.phone ? 'Edit' : 'Add'}
                  </button>
                </span>
              )}
            </div>
            {editingPhone && (
              <form onSubmit={savePhone} className="flex flex-wrap items-center gap-2">
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="10-digit mobile number"
                  autoFocus
                  className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900"
                />
                <button
                  type="submit"
                  disabled={savingPhone}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold rounded-xl transition-colors"
                >
                  {savingPhone ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingPhone(false)}
                  className="px-3 py-2 text-slate-600 hover:text-slate-900 font-bold rounded-xl"
                >
                  Cancel
                </button>
              </form>
            )}
            {phoneError && <p className="text-rose-600 font-medium">{phoneError}</p>}
            <p className="text-slate-400">Used by the payment gateway for your payment confirmation.</p>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-slate-500 font-bold uppercase text-[10px] flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" /> Registered Children
            </span>
            <Link
              href="/parent/children"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl border border-amber-200 transition-colors"
            >
              <span>Manage Children</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-slate-500 font-bold uppercase text-[10px] flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" /> Order History
            </span>
            <Link
              href="/parent/orders"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl border border-amber-200 transition-colors"
            >
              <span>View Past Orders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 leading-relaxed">
            <p className="font-semibold text-slate-800">Account Security</p>
            <p className="text-slate-500 mt-0.5">
              Your details are verified with the school administration. Meals ordered are delivered directly to your child's classroom.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
