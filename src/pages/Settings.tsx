import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import shopLogo from '../assets/logo.png';
import { getCurrentPosition } from '../utils/geolocation';
import { useToastContext } from '../context/ToastContext';
import type { User } from '../types';
import { cn } from '../lib/utils';
import { 
  Sliders, 
  Store, 
  Users, 
  MapPin, 
  Plus, 
  Trash2, 
  ExternalLink, 
  Search, 
  Layers, 
  Smartphone, 
  AlertCircle 
} from 'lucide-react';

interface ShopDetails {
  shopName: string;
  ownerName: string;
  address: string;
  phone: string;
  email: string;
  gst?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  upiId?: string;
  merchantName?: string;
}

type TabType = 'project' | 'shop' | 'users';

const Settings: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { success, error } = useToastContext();

  const isOwner = currentUser?.role === 'owner';
  const isAdmin = isOwner || currentUser?.role === 'admin' || currentUser?.role === 'hub-admin' || currentUser?.role === 'store-admin';

  // Active tab selection
  const initialTab = (searchParams.get('tab') as TabType) || 'project';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Sync tab with URL if searchParams change
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab') as TabType;
    if (tabFromUrl && ['project', 'shop', 'users'].includes(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  // Access check
  useEffect(() => {
    if (currentUser && !isAdmin) {
      navigate('/dashboard');
    }
  }, [currentUser, isAdmin, navigate]);

  // ==========================================
  // TAB 1: Project Settings (Recharge Toggle)
  // ==========================================
  const [rechargeEnabled, setRechargeEnabled] = useState<boolean>(() => {
    const cached = localStorage.getItem('recharge_enabled');
    return cached !== null ? cached === 'true' : true;
  });
  const [savingRechargeToggle, setSavingRechargeToggle] = useState(false);

  useEffect(() => {
    const fetchProjectSettings = async () => {
      try {
        const docRef = doc(db, 'settings', 'projectSettings');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (typeof data.rechargeEnabled === 'boolean') {
            setRechargeEnabled(data.rechargeEnabled);
            localStorage.setItem('recharge_enabled', String(data.rechargeEnabled));
          }
        }
      } catch (err) {
        console.warn('Could not fetch projectSettings:', err);
      }
    };
    fetchProjectSettings();
  }, []);

  const handleToggleRecharge = async () => {
    const nextVal = !rechargeEnabled;
    setSavingRechargeToggle(true);
    try {
      setRechargeEnabled(nextVal);
      localStorage.setItem('recharge_enabled', String(nextVal));

      // Emit custom event for instant sidebar update in same tab
      window.dispatchEvent(new CustomEvent('recharge-setting-changed', {
        detail: { rechargeEnabled: nextVal }
      }));

      // Persist in Firestore
      const docRef = doc(db, 'settings', 'projectSettings');
      await setDoc(docRef, {
        rechargeEnabled: nextVal,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.displayName || currentUser?.email || 'admin'
      }, { merge: true });

      success(nextVal ? 'Recharge section enabled in sidebar!' : 'Recharge section hidden from sidebar.');
    } catch (err: any) {
      console.error('Failed to toggle recharge setting:', err);
      // Revert on failure
      setRechargeEnabled(!nextVal);
      localStorage.setItem('recharge_enabled', String(!nextVal));
      error('Failed to save recharge setting. Please try again.');
    } finally {
      setSavingRechargeToggle(false);
    }
  };

  // ==========================================
  // TAB 2: Shop Details (from About)
  // ==========================================
  const [shopDetails, setShopDetails] = useState<ShopDetails>({
    shopName: '',
    ownerName: '',
    address: '',
    phone: '',
    email: '',
    gst: '',
    description: '',
    latitude: undefined,
    longitude: undefined,
    upiId: '',
    merchantName: ''
  });
  const [isEditingShop, setIsEditingShop] = useState(false);
  const [loadingShop, setLoadingShop] = useState(true);
  const [savingShop, setSavingShop] = useState(false);
  const [fetchingLocation, setFetchingLocation] = useState(false);

  useEffect(() => {
    fetchShopDetails();
  }, []);

  const fetchShopDetails = async () => {
    try {
      setLoadingShop(true);
      const docRef = doc(db, 'settings', 'shopDetails');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setShopDetails(docSnap.data() as ShopDetails);
      }
    } catch (err) {
      console.error('Error fetching shop details:', err);
    } finally {
      setLoadingShop(false);
    }
  };

  const handleGetLocation = async () => {
    setFetchingLocation(true);
    try {
      const position = await getCurrentPosition();
      if (position) {
        setShopDetails(prev => ({
          ...prev,
          latitude: position.latitude,
          longitude: position.longitude
        }));
        success('Location fetched successfully!');
      } else {
        error('Failed to get location. Please enable location access.');
      }
    } catch (err) {
      error('Error fetching location');
    } finally {
      setFetchingLocation(false);
    }
  };

  const handleSaveShop = async () => {
    setSavingShop(true);
    try {
      const docRef = doc(db, 'settings', 'shopDetails');
      await setDoc(docRef, shopDetails, { merge: true });
      setIsEditingShop(false);
      success('Shop details updated successfully!');
    } catch (err: any) {
      console.error('Error saving shop details:', err);
      error(`Failed to save shop details: ${err.message || 'Unknown error'}`);
    } finally {
      setSavingShop(false);
    }
  };

  const handleCancelShop = () => {
    setIsEditingShop(false);
    fetchShopDetails();
  };

  // ==========================================
  // TAB 3: Users (from UserList)
  // ==========================================
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [userSearchText, setUserSearchText] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      setUsersError('');
      const usersCollection = collection(db, 'users');
      const userSnapshot = await getDocs(usersCollection);
      const userList = userSnapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      })) as User[];
      setUsers(userList);
    } catch (err) {
      console.error('Error fetching users:', err);
      setUsersError('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!isOwner) {
      alert('Only owners can delete users.');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;

    try {
      await deleteDoc(doc(db, 'users', userId));
      setUsers(prev => prev.filter(user => user.uid !== userId));
      success('User deleted successfully.');
    } catch (err) {
      console.error('Error deleting user:', err);
      error('Failed to delete user');
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearchText.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => 
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q))
    );
  }, [users, userSearchText]);

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'admin': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'hub-admin': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'store-admin': return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      case 'employee': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-32 md:pb-24">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage project preferences, business profile, and user access in one place.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 mb-6 gap-2 sm:gap-4 overflow-x-auto pb-px">
          <button
            onClick={() => switchTab('project')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-all border-b-2 whitespace-nowrap",
              activeTab === 'project'
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            )}
          >
            <Sliders className="w-4 h-4" />
            <span>Project Settings</span>
          </button>

          <button
            onClick={() => switchTab('shop')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-all border-b-2 whitespace-nowrap",
              activeTab === 'shop'
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            )}
          >
            <Store className="w-4 h-4" />
            <span>Shop Profile</span>
          </button>

          <button
            onClick={() => switchTab('users')}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-all border-b-2 whitespace-nowrap",
              activeTab === 'users'
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            )}
          >
            <Users className="w-4 h-4" />
            <span>Users & Access</span>
          </button>
        </div>

        {/* ========================================================= */}
        {/* TAB 1: Project Preferences / Recharge Toggle              */}
        {/* ========================================================= */}
        {activeTab === 'project' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Feature Toggles Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-lg">
                  <Sliders className="w-5 h-5 text-blue-600" />
                  <h2>Feature Toggles</h2>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Control which operational modules appear in the navigation sidebar.
                </p>
              </div>

              <div className="p-5 sm:p-6 divide-y divide-slate-100">
                {/* Recharge Toggle Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 mt-0.5">
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm sm:text-base">Recharge Module</span>
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase",
                          rechargeEnabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                        )}>
                          {rechargeEnabled ? 'Active' : 'Hidden'}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                        Show or hide the Recharge section (Recharge Accounts, Bulk Recharge, Reports, Providers) in the sidebar.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rechargeEnabled}
                      onClick={handleToggleRecharge}
                      disabled={savingRechargeToggle}
                      className={cn(
                        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2",
                        rechargeEnabled ? "bg-blue-600" : "bg-slate-200",
                        savingRechargeToggle && "opacity-60 cursor-not-allowed"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          rechargeEnabled ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Links & Project Configuration */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-lg">
                  <Layers className="w-5 h-5 text-indigo-600" />
                  <h2>Master & Project Tools</h2>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Access catalog master settings, inventory classifications, and defect management.
                </p>
              </div>

              <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div 
                  onClick={() => navigate('/master')}
                  className="p-4 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer group flex items-start justify-between"
                >
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm group-hover:text-blue-600 flex items-center gap-1.5">
                      <span>Master Settings</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Configure brands, product categories, and finance providers for purchases and sales.
                    </p>
                  </div>
                </div>

                <div 
                  onClick={() => navigate('/defect-management')}
                  className="p-4 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer group flex items-start justify-between"
                >
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm group-hover:text-blue-600 flex items-center gap-1.5">
                      <span>Defect & Damage Management</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Review damaged inventory, service return items, and write-off logs.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: Shop Details (Moved from About)                     */}
        {/* ========================================================= */}
        {activeTab === 'shop' && (
          <div className="animate-in fade-in duration-200">
            {loadingShop ? (
              <div className="flex justify-center items-center h-64 bg-white rounded-2xl border border-slate-200">
                <div className="text-slate-500">Loading shop profile...</div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8 space-y-6">
                {/* Header & Edit Button */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Shop Profile</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                      Business name, contact details, and tax information displayed on printed invoices and customer receipts.
                    </p>
                  </div>

                  {isEditingShop ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCancelShop}
                        disabled={savingShop}
                        className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveShop}
                        disabled={savingShop}
                        className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-98 rounded-xl transition disabled:opacity-50"
                      >
                        {savingShop ? 'Saving...' : 'Save Profile'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditingShop(true)}
                      className="px-4 py-2 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition"
                    >
                      Edit Shop Details
                    </button>
                  )}
                </div>

                {/* Logo Section */}
                <div className="flex items-center gap-6 pb-6 border-b border-slate-100">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border border-slate-200 bg-white p-3 flex items-center justify-center shadow-xs">
                    <img
                      src={shopLogo}
                      alt="Shop Logo"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm sm:text-base">{shopDetails.shopName || 'Shop Name'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Default logo printed on all customer bills and service job sheets.</p>
                  </div>
                </div>

                {/* Form Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Shop Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Shop Name <span className="text-red-500">*</span>
                    </label>
                    {isEditingShop ? (
                      <input
                        type="text"
                        value={shopDetails.shopName}
                        onChange={(e) => setShopDetails({ ...shopDetails, shopName: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="Enter registered shop name"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 font-medium">
                        {shopDetails.shopName || 'Not set'}
                      </div>
                    )}
                  </div>

                  {/* Owner Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Owner Name <span className="text-red-500">*</span>
                    </label>
                    {isEditingShop ? (
                      <input
                        type="text"
                        value={shopDetails.ownerName}
                        onChange={(e) => setShopDetails({ ...shopDetails, ownerName: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="Enter owner name"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 font-medium">
                        {shopDetails.ownerName || 'Not set'}
                      </div>
                    )}
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
                    {isEditingShop ? (
                      <input
                        type="tel"
                        value={shopDetails.phone}
                        onChange={(e) => setShopDetails({ ...shopDetails, phone: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="Enter phone number"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 font-mono">
                        {shopDetails.phone || 'Not set'}
                      </div>
                    )}
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    {isEditingShop ? (
                      <input
                        type="email"
                        value={shopDetails.email}
                        onChange={(e) => setShopDetails({ ...shopDetails, email: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="Enter shop email"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900">
                        {shopDetails.email || 'Not set'}
                      </div>
                    )}
                  </div>

                  {/* GSTIN */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      GSTIN / Tax Number
                    </label>
                    {isEditingShop ? (
                      <input
                        type="text"
                        value={shopDetails.gst || ''}
                        onChange={(e) => setShopDetails({ ...shopDetails, gst: e.target.value.toUpperCase() })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none uppercase"
                        placeholder="e.g. 33AAAAA0000A1Z5"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 font-mono">
                        {shopDetails.gst || 'Not registered / None'}
                      </div>
                    )}
                  </div>

                  {/* Merchant Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      UPI Merchant Name
                    </label>
                    {isEditingShop ? (
                      <input
                        type="text"
                        value={shopDetails.merchantName || ''}
                        onChange={(e) => setShopDetails({ ...shopDetails, merchantName: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="Enter name for UPI transactions"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900">
                        {shopDetails.merchantName || 'Not set'}
                      </div>
                    )}
                  </div>

                  {/* UPI ID */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      UPI ID / VPA
                    </label>
                    {isEditingShop ? (
                      <input
                        type="text"
                        value={shopDetails.upiId || ''}
                        onChange={(e) => setShopDetails({ ...shopDetails, upiId: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="e.g. shopname@upi"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 font-mono">
                        {shopDetails.upiId || 'Not set'}
                      </div>
                    )}
                  </div>

                  {/* Coordinates & Location */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Store GPS Coordinates
                      </label>
                      {isEditingShop && (
                        <button
                          type="button"
                          onClick={handleGetLocation}
                          disabled={fetchingLocation}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>{fetchingLocation ? 'Fetching...' : 'Detect Current Location'}</span>
                        </button>
                      )}
                    </div>
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 font-mono">
                      {shopDetails.latitude && shopDetails.longitude 
                        ? `${shopDetails.latitude.toFixed(6)}, ${shopDetails.longitude.toFixed(6)}`
                        : 'Location coordinates not set'}
                    </div>
                  </div>

                  {/* Full Address */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      Full Address <span className="text-red-500">*</span>
                    </label>
                    {isEditingShop ? (
                      <textarea
                        rows={3}
                        value={shopDetails.address}
                        onChange={(e) => setShopDetails({ ...shopDetails, address: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="Enter full shop address"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 whitespace-pre-line">
                        {shopDetails.address || 'Not set'}
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                      About Shop / Invoice Footer Note
                    </label>
                    {isEditingShop ? (
                      <textarea
                        rows={2}
                        value={shopDetails.description || ''}
                        onChange={(e) => setShopDetails({ ...shopDetails, description: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="Optional note printed at bottom of invoices"
                      />
                    ) : (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-sm text-slate-900 whitespace-pre-line">
                        {shopDetails.description || 'None'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: User Management (Moved from UserList)              */}
        {/* ========================================================= */}
        {activeTab === 'users' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Top Bar */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">User Management</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Manage login accounts, employee roles, and system access permissions.
                </p>
              </div>

              {isOwner && (
                <button
                  type="button"
                  onClick={() => navigate('/add-employee')}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition shadow-sm hover:shadow"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New User</span>
                </button>
              )}
            </div>

            {/* Filter Search */}
            <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-3 flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400 ml-1" />
              <input
                type="text"
                placeholder="Search user by name, email, or role..."
                value={userSearchText}
                onChange={(e) => setUserSearchText(e.target.value)}
                className="w-full text-sm bg-transparent border-none focus:outline-none text-slate-900 placeholder:text-slate-400"
              />
              {userSearchText && (
                <button 
                  onClick={() => setUserSearchText('')} 
                  className="text-xs text-slate-400 hover:text-slate-600 px-2"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Content Table / Cards */}
            {loadingUsers ? (
              <div className="flex justify-center items-center h-64 bg-white rounded-2xl border border-slate-200">
                <div className="text-slate-500">Loading system users...</div>
              </div>
            ) : usersError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-2 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{usersError}</span>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Desktop Table View */}
                <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-semibold tracking-wider">
                        <th className="px-6 py-4">User</th>
                        <th className="px-6 py-4">Role</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Joined Date</th>
                        {isOwner && <th className="px-6 py-4 text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                            No users found matching your filter
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => (
                          <tr key={user.uid} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center">
                                <div className="h-10 w-10 flex-shrink-0 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-base uppercase">
                                  {user.name ? user.name.charAt(0) : user.email?.charAt(0) || 'U'}
                                </div>
                                <div className="ml-4">
                                  <div className="font-semibold text-slate-900">{user.name || 'Unknown Name'}</div>
                                  <div className="text-xs text-slate-500">{user.email}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2.5 py-1 rounded-full text-xs font-semibold border capitalize",
                                getRoleBadgeColor(user.role)
                              )}>
                                {user.role}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "h-2 w-2 rounded-full",
                                  user.isActive ? "bg-emerald-500" : "bg-red-500"
                                )}></span>
                                <span className="text-xs font-medium text-slate-700">
                                  {user.isActive ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-600 font-mono">
                              {user.createdAt ? (
                                new Date(typeof user.createdAt === 'object' && 'seconds' in user.createdAt ? (user.createdAt as any).seconds * 1000 : user.createdAt).toLocaleDateString()
                              ) : 'N/A'}
                            </td>
                            {isOwner && (
                              <td className="px-6 py-4 text-right">
                                {user.role !== 'owner' && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteUser(user.uid)}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition"
                                    title="Delete User"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden space-y-3">
                  {filteredUsers.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 bg-white rounded-2xl border border-slate-200">
                      No users found
                    </div>
                  ) : (
                    filteredUsers.map((user) => (
                      <div key={user.uid} className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-base uppercase">
                              {user.name ? user.name.charAt(0) : user.email?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">{user.name || 'Unknown Name'}</h3>
                              <p className="text-xs text-slate-500 break-all">{user.email}</p>
                            </div>
                          </div>
                          {isOwner && user.role !== 'owner' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(user.uid)}
                              className="text-red-500 hover:bg-red-50 p-2 rounded-lg"
                              title="Delete User"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                          <span className={cn(
                            "px-2.5 py-0.5 rounded-full font-semibold border capitalize",
                            getRoleBadgeColor(user.role)
                          )}>
                            {user.role}
                          </span>
                          <span className="text-slate-500 font-mono">
                            {user.createdAt ? (
                              new Date(typeof user.createdAt === 'object' && 'seconds' in user.createdAt ? (user.createdAt as any).seconds * 1000 : user.createdAt).toLocaleDateString()
                            ) : 'N/A'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Settings;

