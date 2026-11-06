import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Store } from '../types';
import {
  Building2,
  Plus,
  Search,
  Edit3,
  Copy,
  Check,
  Navigation,
  X,
  Receipt,
  ArrowLeftRight,
  RefreshCw,
  CheckCircle2,
  ArrowRight,
  KeyRound,
  AlertCircle,
} from 'lucide-react';

const BranchManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentHub, stores, refreshStores } = useStore();
  const navigate = useNavigate();

  const isOwner = currentUser?.role === 'owner';

  // ── Toast Notification ──
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Exact 2-Step Branch Creation Modal from HQ Dashboard (Strictly Owner Only) ──
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false);
  const [createBranchStep, setCreateBranchStep] = useState<1 | 2 | 3>(1);
  const [branchForm, setBranchForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    managerName: '',
    managerId: '',
    purchaseEnabled: true,
  });
  const [createdBranchId, setCreatedBranchId] = useState<string>('');
  const [creatingBranch, setCreatingBranch] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingGps, setFetchingGps] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    ownerName: '',
    managerName: '',
    address: '',
    phone: '',
    email: '',
    gst: '',
    upiId: '',
    merchantName: '',
    latitude: '',
    longitude: '',
    rechargeEnabled: true,
    isActive: true,
  });

  const resetForm = () => {
    setFormData({
      name: '',
      ownerName: '',
      managerName: '',
      address: '',
      phone: '',
      email: '',
      gst: '',
      upiId: '',
      merchantName: '',
      latitude: '',
      longitude: '',
      rechargeEnabled: true,
      isActive: true,
    });
  };

  const handleFormChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFetchCurrentGps = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setFetchingGps(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData(prev => ({
          ...prev,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
        setFetchingGps(false);
      },
      (error) => {
        console.error('Error fetching GPS:', error);
        alert('Could not fetch GPS coordinates. Please check location permissions or enter coordinates manually.');
        setFetchingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const buildStorePayload = () => {
    const lat = formData.latitude.trim() !== '' ? parseFloat(formData.latitude) : undefined;
    const lng = formData.longitude.trim() !== '' ? parseFloat(formData.longitude) : undefined;
    return {
      name: formData.name.trim(),
      ownerName: formData.ownerName.trim(),
      managerName: formData.managerName.trim(),
      address: formData.address.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      gst: formData.gst.trim(),
      upiId: formData.upiId.trim(),
      merchantName: formData.merchantName.trim(),
      latitude: typeof lat === 'number' && !isNaN(lat) ? lat : null,
      longitude: typeof lng === 'number' && !isNaN(lng) ? lng : null,
      rechargeEnabled: formData.rechargeEnabled,
      isActive: formData.isActive,
    };
  };

  const openCreateBranchModal = () => {
    setBranchForm({
      name: '',
      address: '',
      phone: '',
      email: '',
      managerName: '',
      managerId: '',
      purchaseEnabled: true,
    });
    setCreateBranchStep(1);
    setCreatedBranchId('');
    setShowCreateBranchModal(true);
  };

  const handleCopyBranchId = (branchId: string, asEnvVar = false) => {
    const textToCopy = asEnvVar ? `VITE_BRANCH_ID=${branchId}` : branchId;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(branchId);
    showToast(asEnvVar ? 'Copied VITE_BRANCH_ID code to clipboard!' : 'Copied Branch ID!', 'success');
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleCreateBranch = async () => {
    if (!isOwner) {
      showToast('Only the Owner can create a new branch.', 'error');
      return;
    }
    if (!branchForm.name.trim() || !branchForm.address.trim()) {
      showToast('Branch Name (Area) and Address are mandatory.', 'error');
      return;
    }

    try {
      setCreatingBranch(true);
      const hubId = currentHub?.id || 'digital_zone_hq';
      const now = Timestamp.now();

      const newBranchPayload = {
        hubId,
        shopName: 'Digital Zone',
        name: branchForm.name.trim(),
        address: branchForm.address.trim(),
        phone: branchForm.phone.trim(),
        email: branchForm.email.trim(),
        managerName: branchForm.managerName.trim(),
        managerId: branchForm.managerId || '',
        purchaseEnabled: Boolean(branchForm.purchaseEnabled),
        isActive: true,
        totalStockUnits: 0,
        lifetimeRevenue: 0,
        lifetimeBills: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser?.uid || '',
      };

      const docRef = await addDoc(collection(db, 'stores'), newBranchPayload);

      // If an existing employee was selected as Branch Manager, assign them to this branch
      if (branchForm.managerId) {
        await updateDoc(doc(db, 'users', branchForm.managerId), {
          storeId: docRef.id,
          storeName: branchForm.name.trim(),
          role: 'manager',
        });
      }

      setCreatedBranchId(docRef.id);
      setCreateBranchStep(3);
      await refreshStores();
      showToast(`Branch "Digital Zone - ${branchForm.name.trim()}" created!`, 'success');
    } catch (error) {
      console.error('Error creating branch:', error);
      showToast('Failed to create branch. Please try again.', 'error');
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleEditStore = (store: Store) => {
    setEditingStore(store);
    setFormData({
      name: store.name,
      ownerName: store.ownerName || '',
      managerName: store.managerName || '',
      address: store.address || '',
      phone: store.phone || '',
      email: store.email || '',
      gst: store.gst || '',
      upiId: store.upiId || '',
      merchantName: store.merchantName || '',
      latitude: store.latitude != null ? String(store.latitude) : '',
      longitude: store.longitude != null ? String(store.longitude) : '',
      rechargeEnabled: typeof store.rechargeEnabled === 'boolean' ? store.rechargeEnabled : true,
      isActive: typeof store.isActive === 'boolean' ? store.isActive : true,
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!formData.name.trim() || !editingStore?.id) return;

    setLoading(true);
    try {
      const payload = buildStorePayload();
      const storeRef = doc(db, 'stores', editingStore.id);
      await updateDoc(storeRef, {
        ...payload,
        updatedAt: Timestamp.now(),
      });

      await refreshStores();
      setShowEditModal(false);
      setEditingStore(null);
      resetForm();
    } catch (error) {
      console.error('Error updating branch:', error);
      alert('Failed to update branch.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (store: Store) => {
    if (!store.id) return;

    try {
      const storeRef = doc(db, 'stores', store.id);
      await updateDoc(storeRef, {
        isActive: !store.isActive,
        updatedAt: Timestamp.now(),
      });
      await refreshStores();
    } catch (error) {
      console.error('Error toggling branch status:', error);
    }
  };

  // Metrics
  const activeCount = useMemo(() => stores.filter(s => s.isActive !== false).length, [stores]);
  const rechargeEnabledCount = useMemo(() => stores.filter(s => s.rechargeEnabled !== false).length, [stores]);
  const geofenceCount = useMemo(
    () => stores.filter(s => s.latitude != null && s.longitude != null).length,
    [stores]
  );

  // Filtered stores
  const filteredStores = useMemo(() => {
    return stores.filter(store => {
      if (statusFilter === 'active' && store.isActive === false) return false;
      if (statusFilter === 'inactive' && store.isActive !== false) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        store.name.toLowerCase().includes(q) ||
        (store.managerName || '').toLowerCase().includes(q) ||
        (store.ownerName || '').toLowerCase().includes(q) ||
        (store.address || '').toLowerCase().includes(q) ||
        (store.phone || '').toLowerCase().includes(q) ||
        (store.gst || '').toLowerCase().includes(q) ||
        (store.upiId || '').toLowerCase().includes(q)
      );
    });
  }, [stores, statusFilter, searchQuery]);

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-800">
      <Navbar />

      <main className="w-full max-w-full px-3 sm:px-6 lg:px-8 py-5 pb-28 sm:pb-12">
        {/* Toast Alert */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-[90] px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150 ${
              toast.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            )}
            <span>{toast.message}</span>
          </div>
        )}

        {/* Top Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Branch Management
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  Owner Control
                </span>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Configure retail branch profiles, store managers, GST credentials, UPI payment details, and GPS attendance geofencing
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => refreshStores()}
              title="Refresh branches list"
              className="p-2.5 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all shadow-2xs cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {isOwner && (
              <button
                onClick={openCreateBranchModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-medium text-xs sm:text-sm rounded-xl transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Branch</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 High-Level KPI Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          {/* Total Branches */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Total Branches</span>
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-slate-900">
              {stores.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Under {currentHub?.name || 'Head Office'}
            </div>
          </div>

          {/* Active Retail Stores */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Active Operational</span>
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-emerald-600">
              {activeCount} <span className="text-xs font-normal text-slate-400">/ {stores.length}</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Operating retail branches
            </div>
          </div>

          {/* GPS Geofenced */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">GPS Geofence Configured</span>
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <Navigation className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-slate-900">
              {geofenceCount} <span className="text-xs font-normal text-slate-400">stores</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Location-locked staff check-in
            </div>
          </div>

          {/* Recharge Enabled */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Universal Recharge</span>
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-slate-900">
              {rechargeEnabledCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Branches enabled for recharges
            </div>
          </div>
        </div>

        {/* Search & Status Filter Bar */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-3.5 sm:p-4 mb-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/80 w-fit">
            {[
              { key: 'all', label: 'All Branches' },
              { key: 'active', label: 'Active' },
              { key: 'inactive', label: 'Inactive' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key as any)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  statusFilter === tab.key
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="flex-1 max-w-md relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search branch name, manager, phone, address, GST..."
              className="w-full pl-9 pr-9 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Branches Grid (Full Width) */}
        {filteredStores.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-12 text-center">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-900 mb-1">No retail branches found</h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mb-5">
              {searchQuery
                ? 'No stores matched your search query. Try searching by name or manager.'
                : 'Start expanding your network by setting up your first branch under Head Office management.'}
            </p>
            {isOwner && !searchQuery && (
              <button
                onClick={openCreateBranchModal}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Branch</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredStores.map(store => {
              const isActive = store.isActive !== false;
              const hasGps = store.latitude != null && store.longitude != null;
              return (
                <div
                  key={store.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 hover:border-slate-300 transition-all flex flex-col justify-between space-y-4"
                >
                  {/* Top Branch Header */}
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 shrink-0 border border-blue-100">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate">
                            {store.name}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[11px] text-slate-500">
                              ID: {store.id?.slice(0, 8)}...
                            </span>
                            <button
                              onClick={() => handleCopyText(store.id || '', `id-${store.id}`)}
                              className="text-slate-400 hover:text-slate-600 cursor-pointer"
                              title="Copy full store ID"
                            >
                              {copiedId === `id-${store.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Active Status Toggle */}
                      {isOwner ? (
                        <button
                          onClick={() => handleToggleActive(store)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                          }`}
                          title={isActive ? 'Click to deactivate branch' : 'Click to activate branch'}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                          <span>{isActive ? 'Active' : 'Inactive'}</span>
                        </button>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                          <span>{isActive ? 'Active' : 'Inactive'}</span>
                        </span>
                      )}
                    </div>

                    {/* Manager & Address */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-xs space-y-1.5 my-3">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Manager:</span>
                        <span className="font-semibold text-slate-800">{store.managerName || 'Not Assigned'}</span>
                      </div>
                      {store.phone && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Phone:</span>
                          <span className="font-mono text-slate-700 font-medium">{store.phone}</span>
                        </div>
                      )}
                      {store.address && (
                        <div className="flex items-start justify-between gap-2 pt-1 border-t border-slate-200/60 text-[11px]">
                          <span className="text-slate-500 shrink-0">Address:</span>
                          <span className="text-slate-700 text-right truncate">{store.address}</span>
                        </div>
                      )}
                    </div>

                    {/* Operational Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      {hasGps ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
                          <Navigation className="w-2.5 h-2.5" />
                          <span>GPS Locked</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-medium">
                          No GPS Lock
                        </span>
                      )}

                      {store.gst && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono font-medium">
                          GST: {store.gst}
                        </span>
                      )}

                      {store.rechargeEnabled !== false && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                          Recharge OK
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Action Controls */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => navigate(`/stock-transfer?to=${store.id}`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                      title="Dispatch stock to this branch"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      <span>Dispatch Stock</span>
                    </button>

                    {isOwner && (
                      <button
                        onClick={() => handleEditStore(store)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit Config</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ================= EXACT 2-STEP BRANCH CREATION MODAL FROM HQ DASHBOARD (OWNER ONLY) ================= */}
        {showCreateBranchModal && isOwner && (
          <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                    Owner Only • Shop Name: Digital Zone
                  </span>
                  <h3 className="text-base font-bold text-slate-900">
                    {createBranchStep === 1 && 'Step 1 of 2 — Branch Basic Information'}
                    {createBranchStep === 2 && 'Step 2 of 2 — Branch Purchase Configuration'}
                    {createBranchStep === 3 && 'Branch Created — Host Environment Code'}
                  </h3>
                </div>
                <button
                  onClick={() => setShowCreateBranchModal(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {createBranchStep === 1 && (
                <div className="p-5 space-y-4">
                  <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-100 text-xs text-blue-800">
                    <strong>Shop Name:</strong> Digital Zone (kept identical across all branches).
                    Enter the <strong>Branch Area</strong> below as the Branch Name.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Branch Name (Area of the Branch) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={branchForm.name}
                      onChange={(e) => setBranchForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g., Anna Nagar, T. Nagar, Velachery"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Branch Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={branchForm.address}
                      onChange={(e) => setBranchForm((p) => ({ ...p, address: e.target.value }))}
                      placeholder="Full street address and landmark"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Branch Phone
                      </label>
                      <input
                        type="tel"
                        value={branchForm.phone}
                        onChange={(e) => setBranchForm((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="Phone number"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Branch Email
                      </label>
                      <input
                        type="email"
                        value={branchForm.email}
                        onChange={(e) => setBranchForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="branch@digitalzone.com"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Branch Manager
                    </label>
                    <input
                      type="text"
                      value={branchForm.managerName}
                      onChange={(e) =>
                        setBranchForm((p) => ({ ...p, managerName: e.target.value }))
                      }
                      placeholder="Manager name (optional)"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      onClick={() => setShowCreateBranchModal(false)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!branchForm.name.trim() || !branchForm.address.trim()) {
                          showToast('Branch Name (Area) and Address are mandatory.', 'error');
                          return;
                        }
                        setCreateBranchStep(2);
                      }}
                      className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5 cursor-pointer"
                    >
                      Next: Branch Purchase
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {createBranchStep === 2 && (
                <div className="p-5 space-y-4">
                  <p className="text-sm text-slate-700">
                    Should <strong>Digital Zone — {branchForm.name}</strong> have{' '}
                    <strong>Branch Purchase</strong> enabled?
                  </p>

                  <div className="grid grid-cols-1 gap-3">
                    <button
                      type="button"
                      onClick={() => setBranchForm((p) => ({ ...p, purchaseEnabled: true }))}
                      className={`p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
                        branchForm.purchaseEnabled
                          ? 'border-blue-600 bg-blue-50/50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-900">
                          Yes — Turn ON Branch Purchase
                        </span>
                        <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">
                          Enabled
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        This branch will have access to Purchase, Add Purchase, Add Purchase IMEI, and Master Setting.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setBranchForm((p) => ({ ...p, purchaseEnabled: false }))}
                      className={`p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
                        !branchForm.purchaseEnabled
                          ? 'border-blue-600 bg-blue-50/50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-900">
                          No — Mandatory Features Only (HQ Stock Only)
                        </span>
                        <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-700">
                          Disabled
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        Branch receives stock from HQ and does not record direct supplier purchases.
                      </p>
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <button
                      onClick={() => setCreateBranchStep(1)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleCreateBranch}
                      disabled={creatingBranch}
                      className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                    >
                      {creatingBranch ? 'Creating Branch...' : 'Create Branch'}
                    </button>
                  </div>
                </div>
              )}

              {createBranchStep === 3 && (
                <div className="p-5 space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
                    <div className="flex items-center gap-2 font-bold text-sm mb-1">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      Digital Zone — {branchForm.name} Created!
                    </div>
                    <p className="text-xs text-emerald-700">
                      Copy the Branch ID below and place it in the branch deployment&apos;s{' '}
                      <code>.env</code> file to host this branch separately.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                        Branch ID (Owner Only)
                      </span>
                      <button
                        onClick={() => handleCopyBranchId(createdBranchId, true)}
                        className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-2xs transition-all"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy .env Code</span>
                      </button>
                    </div>
                    <code className="block text-xs font-mono font-semibold text-blue-700 bg-white p-2.5 rounded-lg border border-slate-200/90 select-all">
                      VITE_BRANCH_ID={createdBranchId}
                    </code>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => setShowCreateBranchModal(false)}
                      className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= EDIT BRANCH CONFIGURATION MODAL ================= */}
        {showEditModal && (
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
            onClick={() => {
              setShowEditModal(false);
              resetForm();
            }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Configure: {editingStore?.name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Update retail branch metadata, manager details, and GPS coordinates
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    resetForm();
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Body */}
              <div className="p-5 overflow-y-auto space-y-4 text-xs">
                {/* 1. Identity & Manager */}
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-3">
                  <div className="font-bold uppercase tracking-wider text-slate-700 text-[11px]">
                    1. Branch Identity & Contacts
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">
                        Branch Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={e => handleFormChange('name', e.target.value)}
                        placeholder="e.g. City Mall Branch"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">
                        Branch Manager Name
                      </label>
                      <input
                        type="text"
                        value={formData.managerName}
                        onChange={e => handleFormChange('managerName', e.target.value)}
                        placeholder="Assigned store manager"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Phone Number</label>
                      <input
                        type="text"
                        value={formData.phone}
                        onChange={e => handleFormChange('phone', e.target.value)}
                        placeholder="e.g. 9876543210"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-slate-800"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">Branch Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={e => handleFormChange('email', e.target.value)}
                        placeholder="branch@digitalzone.com"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-semibold mb-1">Physical Address</label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={e => handleFormChange('address', e.target.value)}
                      placeholder="Shop No, Street, City, Pincode"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                    />
                  </div>
                </div>

                {/* 2. Billing & UPI credentials */}
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-3">
                  <div className="font-bold uppercase tracking-wider text-slate-700 text-[11px]">
                    2. Invoicing, GST & Payment UPI
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">GST Number</label>
                      <input
                        type="text"
                        value={formData.gst}
                        onChange={e => handleFormChange('gst', e.target.value)}
                        placeholder="e.g. 29AAAAA0000A1Z5"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-slate-800"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-semibold mb-1">UPI ID (VPA)</label>
                      <input
                        type="text"
                        value={formData.upiId}
                        onChange={e => handleFormChange('upiId', e.target.value)}
                        placeholder="e.g. digitalzone@upi"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-slate-800"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. GPS Geofencing Coordinates */}
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold uppercase tracking-wider text-slate-700 text-[11px]">
                      3. GPS Geofencing (Staff Attendance)
                    </div>
                    <button
                      type="button"
                      onClick={handleFetchCurrentGps}
                      disabled={fetchingGps}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-blue-600 border border-slate-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Navigation className="w-3 h-3" />
                      <span>{fetchingGps ? 'Detecting...' : 'Detect GPS Here'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-500 mb-1 text-[11px]">Latitude</label>
                      <input
                        type="text"
                        value={formData.latitude}
                        onChange={e => handleFormChange('latitude', e.target.value)}
                        placeholder="e.g. 12.971598"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1 text-[11px]">Longitude</label>
                      <input
                        type="text"
                        value={formData.longitude}
                        onChange={e => handleFormChange('longitude', e.target.value)}
                        placeholder="e.g. 77.594566"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Capabilities & Active Status */}
                <div className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 text-xs">Enable Universal Recharge</div>
                    <div className="text-[11px] text-slate-500">Allow staff to perform customer mobile recharges</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.rechargeEnabled}
                    onChange={e => handleFormChange('rechargeEnabled', e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between p-4 border-t border-slate-100 bg-slate-50">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    resetForm();
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loading || !formData.name.trim()}
                  onClick={handleSaveEdit}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  {loading ? <span>Saving...</span> : <span>Save Changes</span>}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default BranchManagement;
