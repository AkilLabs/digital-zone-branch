import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import {
  Users,
  TrendingDown,
  Edit2,
  Search,
  LayoutGrid,
  List,
  X,
  ShoppingCart,
  Plus,
  RefreshCw,
  Loader2,
  Phone,
  Building,
  CreditCard,
  Receipt,
  Check,
  MessageCircle,
  ExternalLink
} from 'lucide-react';
import type { Supplier } from '../types';
import {
  getDocs,
  query,
  orderBy,
  addDoc,
  updateDoc,
  Timestamp
} from 'firebase/firestore';

const Suppliers: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef } = useStore();
  const { success, error: showError } = useToastContext();
  const navigate = useNavigate();

  // Primary data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Search, filter, and sort state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'settled'>('all');
  const [sortBy, setSortBy] = useState<'pending_desc' | 'pending_asc' | 'purchase_desc' | 'name_asc' | 'recent'>('pending_desc');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Modal visibility states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);

  // Double-submission protection locks
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingSupplierRef = useRef(false);

  // Add / Edit Supplier Form state
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    gstNumber: ''
  });

  // Load suppliers on initial mount
  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setIsRefreshing(true);
      const suppliersRef = getCollectionRef('suppliers');
      const q = query(suppliersRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const suppliersList = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAtDate = new Date();
        if (data.createdAt?.toDate) {
          createdAtDate = data.createdAt.toDate();
        } else if (data.createdAt instanceof Date) {
          createdAtDate = data.createdAt;
        }

        return {
          id: doc.id,
          ...data,
          totalPurchaseAmount: Number(data.totalPurchaseAmount) || 0,
          totalPaid: Number(data.totalPaid) || 0,
          totalPending: Number(data.totalPending) || 0,
          createdAt: createdAtDate,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : undefined
        };
      }) as Supplier[];

      setSuppliers(suppliersList);
    } catch (err: any) {
      console.error('Failed to load suppliers:', err);
      showError('Failed to load suppliers: ' + (err.message || 'Network error'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Filter and Sort Suppliers Directory
  const filteredAndSortedSuppliers = useMemo(() => {
    return suppliers
      .filter(supplier => {
        if (statusFilter === 'pending' && supplier.totalPending <= 0) return false;
        if (statusFilter === 'settled' && supplier.totalPending > 0) return false;

        if (!searchTerm.trim()) return true;
        const term = searchTerm.toLowerCase().trim();
        return (
          supplier.name.toLowerCase().includes(term) ||
          supplier.phone.includes(term) ||
          (supplier.contactPerson && supplier.contactPerson.toLowerCase().includes(term)) ||
          (supplier.gstNumber && supplier.gstNumber.toLowerCase().includes(term)) ||
          (supplier.email && supplier.email.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'pending_desc') return b.totalPending - a.totalPending;
        if (sortBy === 'pending_asc') return a.totalPending - b.totalPending;
        if (sortBy === 'purchase_desc') return b.totalPurchaseAmount - a.totalPurchaseAmount;
        if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
        if (sortBy === 'recent') return b.createdAt.getTime() - a.createdAt.getTime();
        return 0;
      });
  }, [suppliers, searchTerm, statusFilter, sortBy]);

  // Overall metrics
  const metrics = useMemo(() => {
    const totalSuppliers = suppliers.length;
    const totalPendingDues = suppliers.reduce((sum, s) => sum + Math.max(s.totalPending || 0, 0), 0);
    const suppliersWithDuesCount = suppliers.filter(s => (s.totalPending || 0) > 0).length;
    const totalPurchaseAmount = suppliers.reduce((sum, s) => sum + (s.totalPurchaseAmount || 0), 0);
    const totalPaidAmount = suppliers.reduce((sum, s) => sum + (s.totalPaid || 0), 0);
    const settledSuppliersCount = suppliers.filter(s => (s.totalPending || 0) <= 0).length;

    return {
      totalSuppliers,
      totalPendingDues,
      suppliersWithDuesCount,
      totalPurchaseAmount,
      totalPaidAmount,
      settledSuppliersCount
    };
  }, [suppliers]);

  // Add Supplier
  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingSupplierRef.current) return;

    if (!supplierForm.name.trim()) {
      showError('Supplier name is required');
      return;
    }
    if (!supplierForm.phone.trim()) {
      showError('Phone number is required');
      return;
    }

    try {
      isSubmittingSupplierRef.current = true;
      setIsSubmitting(true);

      const newSupplierData = {
        name: supplierForm.name.trim(),
        contactPerson: supplierForm.contactPerson.trim() || undefined,
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim() || undefined,
        address: supplierForm.address.trim() || undefined,
        gstNumber: supplierForm.gstNumber.trim().toUpperCase() || undefined,
        totalPurchaseAmount: 0,
        totalPaid: 0,
        totalPending: 0,
        isActive: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'HQ Admin'
      };

      const docRef = await addDoc(getCollectionRef('suppliers'), newSupplierData);
      success(`Supplier "${supplierForm.name}" registered successfully`);
      setShowAddModal(false);
      resetSupplierForm();
      await fetchSuppliers();

      // Navigate straight to the new supplier's dedicated ledger page
      navigate(`/suppliers/${docRef.id}`);
    } catch (err: any) {
      console.error('Error adding supplier:', err);
      showError('Failed to add supplier: ' + (err.message || 'Network error'));
    } finally {
      isSubmittingSupplierRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Edit Supplier
  const handleEditSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingSupplierRef.current) return;
    if (!selectedSupplier?.id) return;

    if (!supplierForm.name.trim()) {
      showError('Supplier name is required');
      return;
    }
    if (!supplierForm.phone.trim()) {
      showError('Phone number is required');
      return;
    }

    try {
      isSubmittingSupplierRef.current = true;
      setIsSubmitting(true);

      const supplierRef = getDocRef('suppliers', selectedSupplier.id);
      await updateDoc(supplierRef, {
        name: supplierForm.name.trim(),
        contactPerson: supplierForm.contactPerson.trim() || '',
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim() || '',
        address: supplierForm.address.trim() || '',
        gstNumber: supplierForm.gstNumber.trim().toUpperCase() || '',
        updatedAt: Timestamp.now()
      });

      success(`Updated details for ${supplierForm.name}`);
      setShowEditModal(false);
      resetSupplierForm();
      await fetchSuppliers();
    } catch (err: any) {
      console.error('Error updating supplier:', err);
      showError('Failed to update supplier: ' + (err.message || 'Network error'));
    } finally {
      isSubmittingSupplierRef.current = false;
      setIsSubmitting(false);
    }
  };

  const openAddModal = () => {
    resetSupplierForm();
    setShowAddModal(true);
  };

  const openEditModal = (supplier: Supplier, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedSupplier(supplier);
    setSupplierForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson || '',
      phone: supplier.phone,
      email: supplier.email || '',
      address: supplier.address || '',
      gstNumber: supplier.gstNumber || ''
    });
    setShowEditModal(true);
  };

  const resetSupplierForm = () => {
    setSupplierForm({
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      gstNumber: ''
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)]">
          <div className="relative">
            <div className="w-12 h-12 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <Building className="w-5 h-5 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="mt-4 text-slate-600 text-sm font-medium">Loading supplier registry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="w-full max-w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-28 sm:pb-12">
        {/* ========================================================================= */}
        {/* HEADER & TOP CONTROLS                                                     */}
        {/* ========================================================================= */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                <Building className="w-5 h-5" />
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Supplier Management
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              {filteredAndSortedSuppliers.length} vendor{filteredAndSortedSuppliers.length !== 1 ? 's' : ''} • Central HQ Procurement & Dedicated Supplier Ledgers
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => fetchSuppliers(true)}
              disabled={isRefreshing}
              className="px-3 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
              title="Refresh suppliers list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={openAddModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center gap-1.5 shadow-sm whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Supplier</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 4 PROFESSIONAL KPI METRIC CARDS                                            */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Total Suppliers</span>
              <Users className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900">
              {metrics.totalSuppliers}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {metrics.settledSuppliersCount} accounts settled
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Total Purchases Billed</span>
              <ShoppingCart className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
              ₹{Math.round(metrics.totalPurchaseAmount).toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Lifetime procurement invoices
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Total Cleared / Paid</span>
              <Check className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-600 font-mono">
              ₹{Math.round(metrics.totalPaidAmount).toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Disbursed vendor payments
            </div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
            className={`rounded-xl border p-4 shadow-2xs cursor-pointer transition-all ${
              statusFilter === 'pending'
                ? 'bg-rose-50/70 border-rose-300 ring-2 ring-rose-500/20'
                : 'bg-white border-slate-200/90 hover:border-rose-300'
            }`}
          >
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium text-rose-700">Outstanding Balance Due</span>
              <TrendingDown className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-rose-600 font-mono">
              ₹{Math.round(metrics.totalPendingDues).toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-rose-600/80 mt-0.5 flex items-center justify-between">
              <span>{metrics.suppliersWithDuesCount} suppliers with balance</span>
              {statusFilter === 'pending' && <span className="font-bold text-[10px] uppercase">Active Filter</span>}
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SEARCH, STATUS FILTER CHIPS & SORT CONTROLS                               */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-xl border border-slate-200 p-2.5 sm:p-3 mb-4 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
          {/* Status Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { key: 'all', label: `All Vendors (${suppliers.length})` },
              { key: 'pending', label: `Dues Pending (${metrics.suppliersWithDuesCount})` },
              { key: 'settled', label: `Settled (${metrics.settledSuppliersCount})` }
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Bar + Sort & View Mode */}
          <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-[240px] sm:min-w-[340px]">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search vendor, phone, GST, contact..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="py-1.5 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            >
              <option value="pending_desc">Due: High to Low</option>
              <option value="pending_asc">Due: Low to High</option>
              <option value="purchase_desc">Purchases: High to Low</option>
              <option value="name_asc">Name: A to Z</option>
              <option value="recent">Recently Added</option>
            </select>

            <div className="flex items-center border border-slate-200 rounded-lg p-0.5 bg-slate-50">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'grid' ? 'bg-white text-blue-600 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Grid cards"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'table' ? 'bg-white text-blue-600 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Table view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SUPPLIERS CONTENT (GRID OR DIRECTORY TABLE)                              */}
        {/* ========================================================================= */}
        {filteredAndSortedSuppliers.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-2xs">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3 border border-blue-100">
              <Building className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No suppliers found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              {searchTerm
                ? `No supplier matched "${searchTerm}". Try checking your spelling or filters.`
                : statusFilter === 'pending'
                ? 'All supplier accounts are completely settled with ₹0 pending balance.'
                : 'Get started by registering your first supplier.'}
            </p>
            <div className="mt-4">
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  Clear filters
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Register First Supplier</span>
                </button>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* GRID VIEW */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredAndSortedSuppliers.map(supplier => {
              const hasDues = (supplier.totalPending || 0) > 0;
              const initial = supplier.name.charAt(0).toUpperCase() || 'S';

              return (
                <div
                  key={supplier.id}
                  onClick={() => navigate(`/suppliers/${supplier.id}`)}
                  className="bg-white rounded-xl border border-slate-200/90 hover:border-blue-400 hover:shadow-xs transition-all duration-150 flex flex-col justify-between overflow-hidden cursor-pointer group"
                >
                  {/* Top vendor info */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center font-bold text-sm flex-shrink-0 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-200 transition-colors">
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-slate-900 text-sm truncate group-hover:text-blue-600 transition-colors" title={supplier.name}>
                            {supplier.name}
                          </h3>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {supplier.contactPerson || 'Vendor / Distributor'}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => openEditModal(supplier, e)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
                        title="Edit vendor"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Contact details */}
                    <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                      <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-100">
                        <span className="flex items-center gap-1.5 font-medium text-slate-700">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          <a
                            href={`tel:${supplier.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-blue-600 hover:underline"
                          >
                            {supplier.phone}
                          </a>
                        </span>
                        <a
                          href={`https://wa.me/${supplier.phone.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-emerald-600 hover:text-emerald-700 font-semibold inline-flex items-center gap-1 text-[11px]"
                        >
                          <MessageCircle className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </a>
                      </div>

                      {supplier.gstNumber && (
                        <div className="flex items-center gap-1.5 text-[11px] px-1 text-slate-500">
                          <span className="text-slate-400 font-semibold uppercase">GSTIN:</span>
                          <span className="font-mono text-slate-700">{supplier.gstNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Financial Due Summary */}
                  <div className="px-4 pb-3">
                    <div className="p-3 bg-slate-50/80 rounded-lg border border-slate-200/80">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-500 font-medium">Balance Status</span>
                        {hasDues ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            Due Pending
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Settled ✓
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between mt-1">
                        <div>
                          <div className={`text-base font-bold font-mono ${hasDues ? 'text-rose-600' : 'text-slate-900'}`}>
                            ₹{supplier.totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-[10px] text-slate-400">Current Balance</div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs font-semibold text-slate-700 font-mono">
                            ₹{Math.round(supplier.totalPurchaseAmount).toLocaleString('en-IN')}
                          </div>
                          <div className="text-[10px] text-slate-400">Invoiced</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/suppliers/${supplier.id}`);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors shadow-2xs"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>Ledger Statement</span>
                    </button>

                    {hasDues && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/suppliers/${supplier.id}?tab=pay`);
                        }}
                        className="px-3 py-2 bg-white hover:bg-rose-50 text-rose-700 font-semibold text-xs rounded-lg border border-rose-200 transition-colors inline-flex items-center gap-1"
                        title="Record Payment"
                      >
                        <CreditCard className="w-3.5 h-3.5 text-rose-600" />
                        <span>Pay</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* TABLE DIRECTORY VIEW */
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Vendor / Supplier</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4 text-right">Invoiced (Purchases)</th>
                    <th className="py-3 px-4 text-right">Disbursed (Paid)</th>
                    <th className="py-3 px-4 text-right">Balance Due</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredAndSortedSuppliers.map(supplier => {
                    const hasDues = (supplier.totalPending || 0) > 0;
                    const initial = supplier.name.charAt(0).toUpperCase() || 'S';

                    return (
                      <tr
                        key={supplier.id}
                        onClick={() => navigate(`/suppliers/${supplier.id}`)}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center font-bold text-xs flex-shrink-0">
                              {initial}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 text-xs sm:text-sm hover:text-blue-600 transition-colors">
                                {supplier.name}
                              </div>
                              {supplier.gstNumber && (
                                <div className="text-[11px] font-mono text-slate-400">
                                  GST: {supplier.gstNumber}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-slate-900 font-medium text-xs">{supplier.phone}</div>
                          {supplier.contactPerson && (
                            <div className="text-[11px] text-slate-500">{supplier.contactPerson}</div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-xs text-slate-800">
                          ₹{supplier.totalPurchaseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-xs text-emerald-600">
                          ₹{supplier.totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span className={`font-mono font-bold text-xs sm:text-sm ${hasDues ? 'text-rose-600' : 'text-slate-400'}`}>
                            ₹{supplier.totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {hasDues ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              Due Pending
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Settled ✓
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => navigate(`/suppliers/${supplier.id}`)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors inline-flex items-center gap-1"
                            >
                              <span>Ledger</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                            {hasDues && (
                              <button
                                type="button"
                                onClick={() => navigate(`/suppliers/${supplier.id}?tab=pay`)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                              >
                                Pay
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => openEditModal(supplier, e)}
                              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Edit vendor"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL: ADD NEW SUPPLIER                                                   */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Add New Supplier</h2>
                  <p className="text-xs text-slate-500">Register vendor or wholesale supplier account</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                disabled={isSubmitting}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSupplier} className="p-5 sm:p-6 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier / Company Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Electronics Ltd."
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 9876543210"
                    value={supplierForm.phone}
                    onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={supplierForm.contactPerson}
                    onChange={e => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="supplier@example.com"
                    value={supplierForm.email}
                    onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GSTIN Number
                  </label>
                  <input
                    type="text"
                    placeholder="22AAAAA0000A1Z5"
                    value={supplierForm.gstNumber}
                    onChange={e => setSupplierForm({ ...supplierForm, gstNumber: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs uppercase bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Address
                </label>
                <textarea
                  rows={2}
                  placeholder="Street address, City, State..."
                  value={supplierForm.address}
                  onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !supplierForm.name.trim() || !supplierForm.phone.trim()}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Register Supplier</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT SUPPLIER                                                      */}
      {/* ========================================================================= */}
      {showEditModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Edit Supplier</h2>
                  <p className="text-xs text-slate-500">Update supplier contact & business information</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                disabled={isSubmitting}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSupplier} className="p-5 sm:p-6 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier / Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={supplierForm.phone}
                    onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={supplierForm.contactPerson}
                    onChange={e => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={supplierForm.email}
                    onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GSTIN Number
                  </label>
                  <input
                    type="text"
                    value={supplierForm.gstNumber}
                    onChange={e => setSupplierForm({ ...supplierForm, gstNumber: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs uppercase bg-white border border-slate-300 rounded-lg outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Address
                </label>
                <textarea
                  rows={2}
                  value={supplierForm.address}
                  onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !supplierForm.name.trim() || !supplierForm.phone.trim()}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Suppliers;
