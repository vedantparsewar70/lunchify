'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { formatDatePretty } from '@/lib/utils';

type Outcome = 'create' | 'unchanged' | 'replace' | 'conflict-has-orders' | 'conflict-differs' | 'conflict-shared' | 'skip-past' | 'skip-blank' | 'skip-error';

interface DishDecision {
  price: string;
  isVegetarian: '' | 'yes' | 'no';
  allergens: string;
  noAllergens: boolean;
}

const CATEGORIES = ['Pre-primary', 'Primary', 'Secondary'] as const;

const OUTCOME_LABEL: Record<Outcome, string> = {
  create: 'New',
  unchanged: 'Already saved',
  replace: 'Will replace',
  'conflict-has-orders': 'Kept (has orders)',
  'conflict-differs': 'Different from saved',
  'conflict-shared': 'Kept (one dish for all classes)',
  'skip-past': 'Past date',
  'skip-blank': 'Empty — not bookable',
  'skip-error': 'Error',
};

export default function MonthlyMenuImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DishDecision>>({});
  const [replaceUnordered, setReplaceUnordered] = useState(false);
  const [busy, setBusy] = useState<'' | 'preview' | 'publish'>('');
  const [error, setError] = useState('');
  const [published, setPublished] = useState(false);

  const send = async (action: 'preview' | 'publish') => {
    if (!file) return;
    setBusy(action);
    setError('');
    try {
      const dishes: Record<string, unknown> = {};
      for (const [key, d] of Object.entries(decisions)) {
        dishes[key] = {
          price: d.price === '' ? undefined : Number(d.price),
          isVegetarian: d.isVegetarian === '' ? undefined : d.isVegetarian === 'yes',
          allergens: d.allergens,
          noAllergens: d.noAllergens,
        };
      }
      const form = new FormData();
      form.set('file', file);
      form.set('action', action);
      form.set('options', JSON.stringify({ dishes, replaceUnordered }));
      const res = await fetch('/api/admin/menus/import', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (!data || (!res.ok && !data.days)) {
        setError(data?.error || 'Could not read the file. Please try again.');
        return;
      }
      setResult(data);
      setPublished(Boolean(data.written));
      if (action === 'publish' && !data.written) setError('Not published yet — please fix the items marked below.');
    } catch {
      setError('Network error. Nothing was published; please try again.');
    } finally {
      setBusy('');
    }
  };

  const decisionFor = (key: string): DishDecision => decisions[key] || { price: '', isVegetarian: '', allergens: '', noAllergens: false };
  const setDecision = (key: string, patch: Partial<DishDecision>) => setDecisions((prev) => ({ ...prev, [key]: { ...decisionFor(key), ...patch } }));

  const errors = (result?.issues || []).filter((i: any) => i.severity === 'error');
  const warnings = (result?.issues || []).filter((i: any) => i.severity === 'warning');
  const newDishes = (result?.dishes || []).filter((d: any) => !d.existing);
  const hasDiffering = (result?.counts?.['conflict-differs'] || 0) > 0 || (result?.counts?.replace || 0) > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/staff/kitchen" className="p-2 rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Back to Student Menu">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-emerald-600" /> Monthly Student Menu
          </h1>
          <p className="text-sm text-slate-600">Upload the school&apos;s monthly menu spreadsheet, check it, then publish it in one go.</p>
        </div>
      </div>

      {/* Step 1: file */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
        <h2 className="font-bold text-slate-900">1. Choose the spreadsheet</h2>
        <p className="text-sm text-slate-600">
          Columns: <strong>Day, Date, Pre-primary, Primary, Secondary</strong> (.xlsx). Nothing is saved until you press Publish.
        </p>
        <label className="flex items-center gap-3 p-4 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-slate-50">
          <FileSpreadsheet className="w-6 h-6 text-emerald-600 shrink-0" />
          <span className="text-sm font-semibold text-slate-800 break-all">{file ? file.name : 'Tap to choose the .xlsx file'}</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setResult(null);
              setPublished(false);
              setError('');
            }}
          />
        </label>
        <button
          onClick={() => send('preview')}
          disabled={!file || busy !== ''}
          className="w-full sm:w-auto px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2"
        >
          {busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Check the file
        </button>
        {error && <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p>}
      </section>

      {published && result && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex gap-3" role="status">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
          <div className="text-sm text-emerald-900">
            <p className="font-bold">Menu for {result.month} published.</p>
            <p>
              {result.counts.create} new, {result.counts.replace} replaced, {result.counts.unchanged} already saved
              {result.counts['conflict-has-orders'] ? `, ${result.counts['conflict-has-orders']} kept because they have orders` : ''}.
              Parents can now order for these dates. You can still change a single day from the Student Menu page.
            </p>
          </div>
        </section>
      )}

      {result && (
        <>
          {/* Issues */}
          {(errors.length > 0 || warnings.length > 0) && (
            <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
              <h2 className="font-bold text-slate-900">Things to check</h2>
              {errors.map((i: any, idx: number) => (
                <p key={`e${idx}`} className="text-sm text-rose-800 bg-rose-50 rounded-lg px-3 py-2 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{i.row ? `Row ${i.row}: ` : ''}{i.message}</span>
                </p>
              ))}
              {warnings.map((i: any, idx: number) => (
                <p key={`w${idx}`} className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
                  {i.row ? `Row ${i.row}: ` : ''}{i.message}
                </p>
              ))}
              {errors.length > 0 && <p className="text-sm font-semibold text-rose-800">Please correct the spreadsheet and choose it again; errors block publishing.</p>}
            </section>
          )}

          {/* New dishes */}
          {newDishes.length > 0 && (
            <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
              <h2 className="font-bold text-slate-900">2. New dishes ({newDishes.length})</h2>
              <p className="text-sm text-slate-600">
                These dishes are not in the meal list yet. Enter the price and allergen information for each one. Allergens protect children with allergies.
              </p>
              <div className="space-y-3">
                {newDishes.map((d: any) => {
                  const v = decisionFor(d.key);
                  const missing = d.problems || [];
                  return (
                    <div key={d.key} className={`rounded-xl border p-3 space-y-2 ${missing.length ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{d.name}</p>
                        <p className="text-xs text-slate-500">{d.categories.join(', ')} · {d.dates.length} day(s)</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="text-xs font-semibold text-slate-700">
                          Price (₹)
                          <input
                            type="number"
                            inputMode="decimal"
                            min="1"
                            value={v.price}
                            onChange={(e) => setDecision(d.key, { price: e.target.value })}
                            className="mt-1 w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm"
                          />
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          Vegetarian?
                          <select
                            value={v.isVegetarian}
                            onChange={(e) => setDecision(d.key, { isVegetarian: e.target.value as DishDecision['isVegetarian'] })}
                            className="mt-1 w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white"
                          >
                            <option value="">Choose…</option>
                            <option value="yes">Yes, vegetarian</option>
                            <option value="no">No</option>
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          Allergens (comma separated)
                          <input
                            type="text"
                            placeholder="e.g. Wheat, Milk"
                            value={v.allergens}
                            disabled={v.noAllergens}
                            onChange={(e) => setDecision(d.key, { allergens: e.target.value })}
                            className="mt-1 w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm disabled:bg-slate-100"
                          />
                        </label>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="w-5 h-5"
                          checked={v.noAllergens}
                          onChange={(e) => setDecision(d.key, { noAllergens: e.target.checked, allergens: e.target.checked ? '' : v.allergens })}
                        />
                        This dish contains none of the listed allergens
                      </label>
                      {missing.length > 0 && <p className="text-xs font-semibold text-amber-800">Still needed: {missing.join(', ')}</p>}
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => send('preview')}
                disabled={busy !== ''}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {busy === 'preview' ? 'Checking…' : 'Re-check'}
              </button>
            </section>
          )}

          {/* Day by day preview */}
          <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
            <h2 className="font-bold text-slate-900">{newDishes.length > 0 ? '3' : '2'}. Preview {result.title ? `— ${result.title}` : ''}</h2>
            <div className="space-y-2">
              {result.days.map((day: any) => (
                <div key={day.row} className={`rounded-xl border p-3 ${day.errors.length ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200'}`}>
                  <p className="text-sm font-bold text-slate-900">
                    {day.date ? formatDatePretty(day.date) : `Row ${day.row}`}{' '}
                    <span className="font-medium text-slate-500">({day.dayLabel || day.weekday})</span>
                  </p>
                  <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    {CATEGORIES.map((cat) => {
                      const c = day.cells[cat];
                      const text = c.kind === 'MEAL' ? c.dish : c.kind === 'HOLIDAY' ? c.reason : c.kind === 'BLANK' ? 'No entry' : c.value;
                      const tone =
                        c.kind === 'HOLIDAY' ? 'bg-sky-50 text-sky-900' : c.kind === 'MEAL' ? 'bg-slate-50 text-slate-900' : 'bg-amber-50 text-amber-900';
                      return (
                        <div key={cat} className={`rounded-lg px-2.5 py-2 text-xs ${tone}`}>
                          <span className="block text-[10px] font-bold uppercase text-slate-500">{cat}</span>
                          <span className="block font-semibold break-words">{text}</span>
                          <span className="block text-[10px] text-slate-500 mt-0.5">{OUTCOME_LABEL[c.outcome as Outcome]}</span>
                        </div>
                      );
                    })}
                  </div>
                  {day.errors.map((e: string, i: number) => (
                    <p key={i} className="mt-1 text-xs font-semibold text-rose-800">{e}</p>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* Publish */}
          {!published && (
            <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
              {hasDiffering && (
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="w-5 h-5 mt-0.5" checked={replaceUnordered} onChange={(e) => setReplaceUnordered(e.target.checked)} />
                  <span>
                    Replace saved days that differ from this file. Days that already have orders are never changed.
                  </span>
                </label>
              )}
              <button
                onClick={() => send('publish')}
                disabled={busy !== '' || errors.length > 0}
                className="w-full px-5 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-base flex items-center justify-center gap-2"
              >
                {busy === 'publish' ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                Publish {result.month || 'menu'}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
