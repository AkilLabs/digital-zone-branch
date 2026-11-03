import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { useToastContext } from '../context/ToastContext';
import {
  doc,
  setDoc,
  Timestamp
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { db, firebaseConfig } from '../config/firebase';
import { initializeApp, deleteApp } from 'firebase/app';
import { cn } from '../lib/utils';
import type { UserRole } from '../types';

// ─── Role Definitions ────────────────────────────────────────────────────────
interface RoleOption {
  value: UserRole;
  label: string;
  description: string;
  color: string;           // Tailwind color prefix (blue, purple, etc.)
  icon: React.ReactNode;
  needsStore: boolean;     // Whether a store assignment is required
  needsDeviceBind: boolean; // Whether device-binding applies
  scope: 'hub' | 'store';
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: 'employee',
    label: 'Employee',
    description: 'Daily operations — billing, services, recharge, product viewing. Requires attendance check-in.',
    color: 'blue',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    needsStore: true,
    needsDeviceBind: false,
    scope: 'store',
  },
  {
    value: 'store-admin',
    label: 'Store Admin',
    description: 'Full store access — purchases, expenses, suppliers, reports, employee management. Device-bound.',
    color: 'purple',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    needsStore: true,
    needsDeviceBind: true,
    scope: 'store',
  },
  {
    value: 'hub-admin',
    label: 'Hub Admin',
    description: 'Hub-level management — all stores, stock transfers, store management. Device-bound.',
    color: 'indigo',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    needsStore: false,
    needsDeviceBind: true,
    scope: 'hub',
  },
];

// Color utility maps
const colorMap: Record<string, { bg: string; border: string; text: string; light: string; ring: string }> = {
  blue:   { bg: 'bg-blue-500',   border: 'border-blue-500', text: 'text-blue-600',   light: 'bg-blue-50',   ring: 'ring-blue-200' },
  purple: { bg: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-600', light: 'bg-purple-50', ring: 'ring-purple-200' },
  indigo: { bg: 'bg-indigo-500', border: 'border-indigo-500', text: 'text-indigo-600', light: 'bg-indigo-50', ring: 'ring-indigo-200' },
  teal:   { bg: 'bg-teal-500',   border: 'border-teal-500', text: 'text-teal-600',   light: 'bg-teal-50',   ring: 'ring-teal-200' },
};

// ─── Form Data ────────────────────────────────────────────────────────────────
interface UserFormData {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  storeId: string;         // Assigned store (for store-scoped roles)
  locationCheckIn: 'required' | 'not-required';
}

const AddEmployee: React.FC = () => {
  const { currentUser } = useAuth();
  const { stores, currentHub } = useStore();
  const navigate = useNavigate();
  const toast = useToastContext();

  const [formData, setFormData] = useState<UserFormData>({
    name: '',
    email: '',
    password: '',
    role: 'employee',
    storeId: stores.length === 1 ? (stores[0].id || '') : '',
    locationCheckIn: 'not-required',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isOwner = currentUser?.role === 'owner';
  const selectedRole = ROLE_OPTIONS.find(r => r.value === formData.role) || ROLE_OPTIONS[0];
  const colors = colorMap[selectedRole.color] || colorMap.blue;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleRoleChange = (role: UserRole) => {
    setFormData(prev => ({
      ...prev,
      role,
      locationCheckIn: role === 'employee' ? prev.locationCheckIn : 'not-required',
      storeId: ROLE_OPTIONS.find(r => r.value === role)?.needsStore
        ? (stores.length === 1 ? (stores[0].id || '') : prev.storeId)
        : '',
    }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isOwner) {
      setError('Only owners can add users');
      return;
    }

    if (!formData.name.trim() || !formData.email.trim() || !formData.password.trim()) {
      setError('Name, email, and password are required');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Please enter a valid email');
      return;
    }

    // Store required for store-scoped roles
    if (selectedRole.needsStore && !formData.storeId && stores.length > 0) {
      setError('Please select a store for this user');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Create user via a secondary Firebase app to avoid logging out the current admin
      const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
      const secondaryAuth = getAuth(secondaryApp);

      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        formData.email,
        formData.password
      );

      const newUserId = userCredential.user.uid;

      // Build the Firestore user document
      const userData: Record<string, any> = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        scope: selectedRole.scope,
        isActive: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid,
        createdByName: currentUser?.displayName || currentUser?.email || 'Unknown',
      };

      // Hub assignment
      if (currentUser?.hubId) {
        userData.hubId = currentUser.hubId;
      }

      // Store assignment (for store-scoped roles)
      if (selectedRole.needsStore && formData.storeId) {
        userData.storeId = formData.storeId;
      }

      // Location check-in (employee only)
      if (formData.role === 'employee') {
        userData.locationCheckIn = formData.locationCheckIn;
      }

      await setDoc(doc(db, 'users', newUserId), userData);

      // Cleanup secondary auth
      await secondaryAuth.signOut();
      await deleteApp(secondaryApp);

      toast.success(`${selectedRole.label} "${formData.name}" added successfully!`);

      // Reset form
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'employee',
        storeId: stores.length === 1 ? (stores[0].id || '') : '',
        locationCheckIn: 'not-required',
      });
    } catch (error: any) {
      console.error('Error adding user:', error);
      if (error.code === 'auth/email-already-in-use') {
        setError('This email is already registered');
      } else if (error.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else if (error.code === 'auth/weak-password') {
        setError('Password is too weak');
      } else {
        setError(`Failed to add user: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      name: '',
      email: '',
      password: '',
      role: 'employee',
      storeId: stores.length === 1 ? (stores[0].id || '') : '',
      locationCheckIn: 'not-required',
    });
    setError('');
    navigate('/settings?tab=users');
  };

  // Access denied for non-owners
  if (!isOwner) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <main className="max-w mx-auto px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-6">
          <div className="max-w-2xl mx-auto mt-8 md:mt-12">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 md:p-12">
              <div className="text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="h-10 w-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-3">Access Denied</h2>
                <p className="text-sm text-gray-600 mb-6">Only owners can add new users.</p>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-8 rounded-lg transition-all"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w mx-auto px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-6">
        {/* Header */}
        <div className="mb-4 md:mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-1">Add New User</h1>
            <p className="text-sm md:text-base text-gray-600">
              Create a new {selectedRole.label.toLowerCase()} account
              {currentHub ? ` for ${currentHub.name}` : ''}
            </p>
          </div>
          <button
            onClick={() => navigate('/settings?tab=users')}
            className="flex items-center justify-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-medium transition-all shadow-sm text-sm"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            View All Users
          </button>
        </div>

        {/* Form Card */}
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">

            {/* ── Role Selector ─────────────────────────────────────── */}
            <div className="p-4 md:p-6 border-b border-gray-100">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Select Role <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
                {ROLE_OPTIONS.map(role => {
                  const rc = colorMap[role.color] || colorMap.blue;
                  const isSelected = formData.role === role.value;
                  return (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => handleRoleChange(role.value)}
                      className={cn(
                        "relative flex flex-col items-center gap-1.5 p-3 md:p-4 rounded-xl border-2 transition-all duration-200 text-center",
                        isSelected
                          ? `${rc.border} ${rc.light} shadow-sm`
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                        isSelected ? `${rc.bg} text-white` : "bg-gray-100 text-gray-500"
                      )}>
                        {role.icon}
                      </div>
                      <span className={cn(
                        "text-xs md:text-sm font-semibold",
                        isSelected ? rc.text : "text-gray-700"
                      )}>
                        {role.label}
                      </span>
                      {isSelected && (
                        <div className={cn("absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center", rc.bg)}>
                          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Role Description */}
              <div className={cn("mt-3 p-3 rounded-lg border", `${colors.light} border-${selectedRole.color}-100`)}>
                <p className={cn("text-xs md:text-sm font-medium", colors.text)}>{selectedRole.description}</p>
              </div>
            </div>

            {/* ── Form Fields ──────────────────────────────────────── */}
            <div className="p-4 md:p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-start">
                  <svg className="h-5 w-5 text-red-500 mr-2 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-700 font-medium">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
                {/* Name */}
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-2">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder={`Enter ${selectedRole.label.toLowerCase()} name`}
                    className="w-full px-3 md:px-4 py-2 md:py-2.5 border-2 border-gray-200 rounded-lg text-sm md:text-base bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                    required
                    disabled={loading}
                  />
                </div>

                {/* Email */}
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="user@example.com"
                    className="w-full px-3 md:px-4 py-2 md:py-2.5 border-2 border-gray-200 rounded-lg text-sm md:text-base bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                    required
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-500 mt-1.5">This email will be used for login</p>
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    placeholder="Minimum 6 characters"
                    className="w-full px-3 md:px-4 py-2 md:py-2.5 border-2 border-gray-200 rounded-lg text-sm md:text-base bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                    required
                    minLength={6}
                    disabled={loading}
                  />
                </div>

                {/* Store Assignment (for store-scoped roles) */}
                {selectedRole.needsStore && stores.length > 0 && (
                  <div>
                    <label htmlFor="storeId" className="block text-sm font-semibold text-gray-700 mb-2">
                      Assign to Store <span className="text-red-500">*</span>
                    </label>
                    {stores.length === 1 ? (
                      <div className="w-full px-3 md:px-4 py-2 md:py-2.5 border-2 border-gray-200 rounded-lg text-sm md:text-base bg-gray-50 text-gray-700">
                        {stores[0].name}
                      </div>
                    ) : (
                      <select
                        id="storeId"
                        name="storeId"
                        value={formData.storeId}
                        onChange={handleInputChange}
                        className="w-full px-3 md:px-4 py-2 md:py-2.5 border-2 border-gray-200 rounded-lg text-sm md:text-base bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                        required
                        disabled={loading}
                      >
                        <option value="">Select a store...</option>
                        {stores.map(store => (
                          <option key={store.id} value={store.id}>{store.name}</option>
                        ))}
                      </select>
                    )}
                    <p className="text-xs text-gray-500 mt-1.5">
                      This user will only have access to the selected store's data
                    </p>
                  </div>
                )}

                {/* Device Binding Warning (for admin roles) */}
                {selectedRole.needsDeviceBind && (
                  <div className={cn("border rounded-lg p-4", `${colors.light} border-${selectedRole.color}-200`)}>
                    <div className="flex items-start">
                      <svg className={cn("h-5 w-5 mt-0.5 mr-3 shrink-0", colors.text)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <div>
                        <h4 className={cn("text-sm font-semibold", `text-${selectedRole.color}-900`)}>Device Binding</h4>
                        <p className={cn("text-sm mt-1", `text-${selectedRole.color}-700`)}>
                          This account will be permanently bound to the first device used for login. 
                          The user cannot log in from another device without owner intervention.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Location Check-in (Employee Only) */}
                {formData.role === 'employee' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      Location Check-in
                    </label>
                    <div className="space-y-2">
                      <label className={cn(
                        "flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50",
                        formData.locationCheckIn === 'not-required' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      )}>
                        <input
                          type="radio"
                          name="locationCheckIn"
                          value="not-required"
                          checked={formData.locationCheckIn === 'not-required'}
                          onChange={handleInputChange}
                          className="mt-0.5 h-4 w-4 text-blue-500 cursor-pointer"
                          disabled={loading}
                        />
                        <div className="ml-3">
                          <span className="text-sm font-semibold text-gray-900">No Location Restriction</span>
                          <p className="text-xs text-gray-600 mt-0.5">Can check in/out from anywhere</p>
                        </div>
                      </label>

                      <label className={cn(
                        "flex items-start p-3 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50",
                        formData.locationCheckIn === 'required' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      )}>
                        <input
                          type="radio"
                          name="locationCheckIn"
                          value="required"
                          checked={formData.locationCheckIn === 'required'}
                          onChange={handleInputChange}
                          className="mt-0.5 h-4 w-4 text-blue-500 cursor-pointer"
                          disabled={loading}
                        />
                        <div className="ml-3">
                          <span className="text-sm font-semibold text-gray-900">Location Required</span>
                          <p className="text-xs text-gray-600 mt-0.5">Must be at shop location to check in/out</p>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* Access Summary */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Access Summary</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {formData.role === 'employee' && (
                      <>
                        {['Billing', 'Products (view)', 'Services', 'Customers', 'Recharge', 'Stock Req.', 'QR Payment', 'Attendance'].map(f => (
                          <span key={f} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">{f}</span>
                        ))}
                      </>
                    )}
                    {(formData.role === 'store-admin' || formData.role === 'admin') && (
                      <>
                        {['All Store Features', 'Purchases', 'Expenses', 'Suppliers', 'Reports', 'Invoices', 'Employees', 'Users', 'Defects', 'Master Settings'].map(f => (
                          <span key={f} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">{f}</span>
                        ))}
                      </>
                    )}
                    {formData.role === 'hub-admin' && (
                      <>
                        {['Hub Dashboard', 'All Stores', 'Stock Transfer', 'Store Management', 'All Store Features'].map(f => (
                          <span key={f} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">{f}</span>
                        ))}
                      </>
                    )}
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className={cn(
                      "flex-1 text-white font-semibold py-2.5 md:py-3 px-6 rounded-lg transition-all shadow-sm hover:shadow-md text-sm md:text-base",
                      loading ? "cursor-not-allowed opacity-70" : "",
                      `${colors.bg} hover:opacity-90 disabled:opacity-50`
                    )}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Adding...
                      </span>
                    ) : (
                      `Add ${selectedRole.label}`
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={loading}
                    className="flex-1 sm:flex-initial bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white font-semibold py-2.5 md:py-3 px-6 rounded-lg transition-all shadow-sm text-sm md:text-base"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AddEmployee;
