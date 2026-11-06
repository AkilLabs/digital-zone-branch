import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { useToastContext } from '../context/ToastContext';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { db, firebaseConfig } from '../config/firebase';
import { initializeApp, deleteApp } from 'firebase/app';
import type { UserRole } from '../types';
import { ShieldCheck, Building2, UserPlus, Users, ArrowRight } from 'lucide-react';

interface LoginRoleOption {
  value: UserRole;
  label: string;
  target: 'HQ' | 'Branch';
  description: string;
  needsBranch: boolean;
  scope: 'hub' | 'store';
}

const LOGIN_ROLES: LoginRoleOption[] = [
  {
    value: 'hq-admin',
    label: 'HQ Admin',
    target: 'HQ',
    description:
      'Head Office administrator login — access to HQ operations, stock value, stock transfers, and employee management.',
    needsBranch: false,
    scope: 'hub',
  },
  {
    value: 'admin',
    label: 'Branch Admin',
    target: 'Branch',
    description:
      'Branch login account — full access to the assigned branch (Billing, Products, Stock Received, Stock Transfer, Service, Reports).',
    needsBranch: true,
    scope: 'store',
  },
];

const AddEmployee: React.FC = () => {
  const { currentUser } = useAuth();
  const { stores } = useStore();
  const navigate = useNavigate();
  const toast = useToastContext();

  const canCreateLoginUser =
    currentUser?.role === 'owner' ||
    currentUser?.role === 'hq-admin' ||
    currentUser?.role === 'hub-admin';

  const [formData, setFormData] = useState<{
    name: string;
    email: string;
    password: string;
    role: UserRole;
    storeId: string;
  }>({
    name: '',
    email: '',
    password: '',
    role: 'hq-admin',
    storeId: stores[0]?.id || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedRoleOption =
    LOGIN_ROLES.find((r) => r.value === formData.role) || LOGIN_ROLES[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateLoginUser) {
      setError('Only Owner or HQ Admin can create login users.');
      return;
    }

    if (!formData.name.trim() || !formData.email.trim() || !formData.password.trim()) {
      setError('Full Name, Email, and Password are required.');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (selectedRoleOption.needsBranch && !formData.storeId) {
      setError('Please select a branch for this Branch Admin login.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const secondaryAppName = `SecondaryAuth_${Date.now()}`;
      const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        formData.email.trim(),
        formData.password
      );

      const newUid = userCredential.user.uid;
      const assignedStore = stores.find((s) => s.id === formData.storeId);

      const userPayload: Record<string, any> = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        role: formData.role,
        scope: selectedRoleOption.scope,
        isActive: true,
        hubId: currentUser?.hubId || 'digital_zone_hq',
        storeId: selectedRoleOption.needsBranch ? formData.storeId : '',
        storeName: selectedRoleOption.needsBranch ? assignedStore?.name || '' : 'Head Office',
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'HQ',
      };

      await setDoc(doc(db, 'users', newUid), userPayload);

      await secondaryAuth.signOut();
      await deleteApp(secondaryApp);

      toast.success(
        `${selectedRoleOption.label} login "${formData.name.trim()}" created successfully!`
      );

      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'hq-admin',
        storeId: stores[0]?.id || '',
      });
    } catch (err: any) {
      console.error('Error creating login user:', err);
      if (err.code === 'auth/email-already-in-use') {
        setError('This email address is already registered.');
      } else {
        setError(err.message || 'Failed to create login user.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!canCreateLoginUser) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main className="max-w-xl mx-auto px-4 py-12 text-center">
          <div className="bg-white rounded-xl border border-slate-200 p-8">
            <h2 className="text-lg font-bold text-slate-900">Access Restricted</h2>
            <p className="text-xs text-slate-500 mt-1">
              Only Owner and HQ Admin can create login accounts.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="max-w-3xl mx-auto px-3 sm:px-4 md:px-6 py-5 pb-24 md:pb-10">
        {/* Top Banner linking to Separate 3-Step Employee Flow */}
        <div className="mb-5 p-4 rounded-xl bg-blue-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-blue-900">
              Looking to create & assign a Branch/HQ Employee (Manager, Sales Person, Technician, Cashier)?
            </h2>
            <p className="text-xs text-blue-700 mt-0.5">
              Use the dedicated 3-step Employee Creation flow in Employee Management.
            </p>
          </div>
          <button
            onClick={() => navigate('/employee-management')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <Users className="w-4 h-4" />
            Open 3-Step Employee Flow
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Main Card: Add Login User (HQ Admin / Branch Admin) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold text-slate-900">
                  Add System Login User (HQ Only)
                </h1>
                <p className="text-xs text-slate-500">
                  Create login credentials for <strong>HQ Admin</strong> or <strong>Branch Admin</strong>. (Owner login works universally on HQ & every branch.)
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                {error}
              </div>
            )}

            {/* Select Login Role */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Select Login Role *
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {LOGIN_ROLES.map((opt) => {
                  const active = formData.role === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormData((p) => ({ ...p, role: opt.value }))}
                      className={`p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
                        active
                          ? 'border-blue-600 bg-blue-50/40'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                          {opt.target === 'HQ' ? (
                            <ShieldCheck className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Building2 className="w-4 h-4 text-purple-600" />
                          )}
                          {opt.label}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                          {opt.target} Login
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{opt.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Branch selection when creating Branch Admin */}
            {selectedRoleOption.needsBranch && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assign Branch (Digital Zone Area) <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.storeId}
                  onChange={(e) => setFormData((p) => ({ ...p, storeId: e.target.value }))}
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select a branch...</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      Digital Zone — {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Enter full name"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Login Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                  placeholder="admin@digitalzone.com"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Login Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                placeholder="Minimum 6 characters"
                minLength={6}
                required
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Creating Login...' : `Create ${selectedRoleOption.label} Login`}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

export default AddEmployee;
