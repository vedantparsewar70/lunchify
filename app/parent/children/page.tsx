'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  UtensilsCrossed,
  Eye,
  X,
  FileText,
} from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { useToast } from '@/components/ToastContext';
import { useChildren } from '@/components/ChildrenContext';
import VegBadge from '@/components/VegBadge';
import ChildAvatar from '@/components/ChildAvatar';
import { StudentData } from '@/types';

export default function ChildrenPage() {
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();
  const {
    children,
    isLoading: loading,
    addChild,
    updateChild,
    removeChild,
    refreshChildren,
  } = useChildren();

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingChild, setEditingChild] = useState<StudentData | null>(null);
  const [viewingChild, setViewingChild] = useState<StudentData | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formDob, setFormDob] = useState('');
  const [formGrade, setFormGrade] = useState('');
  const [formDivision, setFormDivision] = useState('');
  const [formRollNo, setFormRollNo] = useState('');
  const [formStudentId, setFormStudentId] = useState('');
  const [formIsVeg, setFormIsVeg] = useState(true);

  // Dietary / preference fields
  const [formDietaryRestrictions, setFormDietaryRestrictions] = useState('');
  const [formFoodPreference, setFormFoodPreference] = useState('Vegetarian');
  const [formNotes, setFormNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const openAddModal = () => {
    setEditingChild(null);
    setFormName('');
    setFormDob('');
    setFormGrade('');
    setFormDivision('');
    setFormRollNo('');
    setFormStudentId('');
    setFormIsVeg(true);
    setFormDietaryRestrictions('');
    setFormFoodPreference('Vegetarian');
    setFormNotes('');
    setIsAddModalOpen(true);
  };

  const openEditModal = (child: StudentData) => {
    setEditingChild(child);
    setFormName(child.name);
    setFormDob(child.dob || '');
    setFormGrade(child.grade);
    setFormDivision(child.division);
    setFormRollNo(child.rollNo);
    setFormStudentId(child.studentId);
    setFormIsVeg(child.isVegetarian);
    setFormDietaryRestrictions(child.dietaryRestrictions || '');
    setFormFoodPreference(child.foodPreference || (child.isVegetarian ? 'Vegetarian' : 'Non-Vegetarian'));
    setFormNotes(child.notes || '');
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        id: editingChild?.id,
        name: formName,
        dob: formDob,
        grade: formGrade,
        division: formDivision,
        rollNo: formRollNo,
        studentId: formStudentId,
        allergies: null,
        allergiesList: [],
        dietaryRestrictions: formDietaryRestrictions,
        foodPreference: formFoodPreference,
        notes: formNotes,
        isVegetarian: formIsVeg,
      };

      const res = await fetch('/api/parent/children', {
        method: editingChild ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const savedChild: StudentData = {
          id: data.student?.id || editingChild?.id || '',
          parentId: user?.parentId || '',
          name: formName,
          dob: formDob || null,
          grade: formGrade,
          division: formDivision,
          rollNo: formRollNo,
          studentId: data.student?.studentId || formStudentId,
          allergies: null,
          allergiesList: [],
          dietaryRestrictions: formDietaryRestrictions || null,
          foodPreference: formFoodPreference || null,
          notes: formNotes || null,
          isVegetarian: formIsVeg,
          profilePhoto: null,
          isActive: true,
          allergyAlertStatus: 'NO_ALLERGY',
          ...data.student,
        };

        if (editingChild) {
          updateChild(savedChild);
        } else {
          addChild(savedChild);
        }

        showToast(
          editingChild ? `Updated profile for ${formName}` : `Added ${formName} to your children list!`,
          'success'
        );
        setIsAddModalOpen(false);
        refreshChildren();
        refreshUser();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save child details', 'error');
      }
    } catch {
      showToast('Network error saving child details', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (childId: string, name: string) => {
    if (!confirm(`Are you sure you want to deactivate ${name}?`)) return;

    try {
      const res = await fetch(`/api/parent/children?id=${childId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        removeChild(childId);
        showToast(`Removed ${name}`, 'info');
        refreshChildren();
        refreshUser();
      } else {
        showToast('Failed to remove child', 'error');
      }
    } catch {
      showToast('Network error while deleting child', 'error');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Users className="w-7 h-7 text-amber-500" />
            <span>Select Child</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Select a child below to view and order Tomorrow&apos;s Meal, or add a new child.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link
            href="/parent/orders"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold shadow-2xs transition-all"
          >
            <FileText className="w-4 h-4 text-amber-500" />
            <span>Order History</span>
          </Link>
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Child</span>
          </button>
        </div>
      </div>

      {/* Children Cards Grid */}
      {loading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : children.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-4 max-w-lg mx-auto">
          <ChildAvatar size="xl" className="mx-auto" />
          <h3 className="text-lg font-bold text-slate-800">No Children Added Yet</h3>
          <p className="text-xs text-slate-500">
            Please add your child&apos;s details to start ordering nutritious school meals.
          </p>
          <button
            onClick={openAddModal}
            className="px-6 py-3 bg-amber-500 text-white rounded-xl text-xs font-bold shadow-md hover:bg-amber-600 transition-colors cursor-pointer inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Child</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {children.map((child) => {
            return (
              <div
                key={child.id}
                className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-xl transition-all space-y-5 flex flex-col justify-between"
              >
                <div>
                  {/* Child Header with Generic Avatar */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5">
                      <ChildAvatar size="lg" />
                      <div>
                        <h3 className="font-extrabold text-slate-900 text-base">{child.name}</h3>
                        <span className="text-[11px] font-mono text-slate-400 font-semibold">{child.studentId}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md border ${
                        (child.studentCategory === 'Pre-primary' || child.grade?.toLowerCase().includes('nursery') || child.grade?.toLowerCase().includes('kg'))
                          ? 'bg-purple-50 text-purple-800 border-purple-200'
                          : (child.studentCategory === 'Secondary' || parseInt(child.grade, 10) > 5)
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}>
                        {child.studentCategory || (child.grade?.toLowerCase().includes('nursery') || child.grade?.toLowerCase().includes('kg') ? 'Pre-primary' : parseInt(child.grade, 10) <= 5 ? 'Primary' : 'Secondary')}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-md">
                        {child.grade?.toLowerCase().includes('kg') || child.grade?.toLowerCase().includes('nursery') ? child.grade : `Class ${child.grade}`}-{child.division}
                      </span>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="mt-4 grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Class</p>
                      <p className="text-sm font-extrabold text-slate-800">{child.grade}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Division</p>
                      <p className="text-sm font-extrabold text-slate-800">{child.division}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Roll No.</p>
                      <p className="text-sm font-extrabold text-slate-800">{child.rollNo}</p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setViewingChild(child)}
                      className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                      title="View Student Profile"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openEditModal(child)}
                      className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-colors cursor-pointer"
                      title="Edit Child Details"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(child.id, child.name)}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                      title="Deactivate Child"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <Link
                    href={`/parent/menu?childId=${child.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
                  >
                    <UtensilsCrossed className="w-3.5 h-3.5" />
                    <span>Select & Order Tomorrow&apos;s Meal →</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Child Modal with Multi-select Allergies */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ChildAvatar size="md" />
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900">
                    {editingChild ? `Edit Child: ${editingChild.name}` : 'Register a Child'}
                  </h3>
                  <p className="text-xs text-slate-500">Provide school credentials and dietary preferences</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Student Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Aarav Sharma"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-500 focus:bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={formDob}
                  onChange={(e) => setFormDob(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Class / Grade *
                  </label>
                  <select
                    required
                    value={formGrade}
                    onChange={(e) => setFormGrade(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900"
                  >
                    <option value="" disabled>Select Class</option>
                    <optgroup label="Pre-primary (Nursery & KG)">
                      <option value="Nursery">Nursery</option>
                      <option value="Jr. KG">Jr. KG</option>
                      <option value="Sr. KG">Sr. KG</option>
                    </optgroup>
                    <optgroup label="Primary (Classes 1 - 5)">
                      {['1', '2', '3', '4', '5'].map((g) => (
                        <option key={g} value={g}>Class {g}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Secondary (Classes 6 - 12)">
                      {['6', '7', '8', '9', '10', '11', '12'].map((g) => (
                        <option key={g} value={g}>Class {g}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Division *
                  </label>
                  <select
                    required
                    value={formDivision}
                    onChange={(e) => setFormDivision(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900"
                  >
                    <option value="" disabled>Select Div (e.g. Div A)</option>
                    {['A', 'B', 'C', 'D', 'E'].map((d) => (
                      <option key={d} value={d}>
                        Div {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Roll No *
                  </label>
                  <input
                    type="text"
                    required
                    value={formRollNo}
                    onChange={(e) => setFormRollNo(e.target.value)}
                    placeholder="e.g. 12"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900"
                  />
                </div>
              </div>



              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md transition-colors cursor-pointer"
                >
                  {submitting ? 'Saving...' : editingChild ? 'Save Changes' : 'Register Child'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clean Child Profile Modal (Requirement 11) */}
      {viewingChild && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 border border-slate-100 space-y-5 text-center">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Student Profile Card
              </span>
              <button
                onClick={() => setViewingChild(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Default Avatar silhouette */}
            <div className="flex justify-center">
              <ChildAvatar size="xl" className="ring-4 ring-amber-300 shadow-md" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-center gap-1.5">
                <h3 className="text-xl font-extrabold text-slate-900">{viewingChild.name}</h3>
              </div>
              <p className="font-mono text-xs font-bold text-amber-700">{viewingChild.studentId}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl text-xs">
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Class</p>
                <p className="font-extrabold text-slate-800">{viewingChild.grade}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Division</p>
                <p className="font-extrabold text-slate-800">{viewingChild.division}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Roll No</p>
                <p className="font-extrabold text-slate-800">{viewingChild.rollNo}</p>
              </div>
            </div>

            {viewingChild.notes && (
              <div className="text-left text-xs bg-slate-50/80 p-4 rounded-2xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Notes</span>
                <span className="text-slate-700 italic">{viewingChild.notes}</span>
              </div>
            )}

            <Link
              href={`/parent/menu?childId=${viewingChild.id}`}
              onClick={() => setViewingChild(null)}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-md flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <UtensilsCrossed className="w-4 h-4" />
              <span>Select Meals for {viewingChild.name.split(' ')[0]}</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
