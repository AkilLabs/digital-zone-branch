import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import {
  ShoppingCart,
  Plus,
  Search,
  Calendar,
  User,
  FileText,
  X,
  Smartphone,
  Package,
  CheckCircle2,
  Clock,
  ArrowRight,
  Boxes,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown
} from 'lucide-react';
import type { Purchase } from '../types';
import { getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { useStore } from '../context/StoreContext';

const Purchases: React.FC = () => {
  const navigate = useNavigate();
  const { getCollectionRef, getDocRef } = useStore();
  const { showToast } = useToast();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [filteredPurchases, setFilteredPurchases] = useState<Purchase[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'credit'>('all');
  const [purchaseType, setPurchaseType] = useState<'all' | 'imei' | 'other'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [legacyImeiCount, setLegacyImeiCount] = useState(0);
  const [isMigrating, setIsMigrating] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Supplier filter
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSupplier, setSelectedSupplier] = useState('');

  // Date filter
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchPurchases();
    fetchSuppliers();
  }, []);

  useEffect(() => {
    filterPurchases();
  }, [searchTerm, filterStatus, startDate, endDate, purchases, selectedSupplier, purchaseType]);

  const fetchPurchases = async () => {
    setIsLoading(true);
    try {
      const purchasesRef = getCollectionRef('purchases');
      const imeiPurchasesRef = getCollectionRef('imeiPurchases');

      const [purchasesSnap, imeiSnap] = await Promise.all([
        getDocs(purchasesRef),
        getDocs(imeiPurchasesRef)
      ]);

      const mapDoc = (docSnap: any, colName: 'purchases' | 'imeiPurchases') => {
        const data = docSnap.data();
        let createdAtDate: Date;
        if (data.createdAt?.toDate) {
          createdAtDate = data.createdAt.toDate();
        } else if (data.createdAt instanceof Date) {
          createdAtDate = data.createdAt;
        } else if (typeof data.createdAt === 'string') {
          createdAtDate = new Date(data.createdAt);
        } else {
          createdAtDate = new Date();
        }
        return {
          id: docSnap.id,
          ...data,
          createdAt: createdAtDate,
          _collection: colName
        };
      };

      const regularList = purchasesSnap.docs.map(d => mapDoc(d, 'purchases'));
      const imeiList = imeiSnap.docs.map(d => mapDoc(d, 'imeiPurchases'));

      // Check for legacy unmigrated IMEI purchases in purchases collection
      const legacyImei = regularList.filter(p => p.isIMEIPurchase || (p.purchaseNumber && p.purchaseNumber.includes('IMEI')));
      setLegacyImeiCount(legacyImei.length);

      const purchasesList = [...regularList, ...imeiList] as Purchase[];

      // Sort by purchase number (highest to lowest) for proper sequential order
      purchasesList.sort((a, b) => {
        const getNum = (purchaseNum: string) => {
          if (!purchaseNum) return 0;
          const parts = purchaseNum.split('-');
          return parseInt(parts[parts.length - 1] || '0', 10);
        };
        const numA = getNum(a.purchaseNumber);
        const numB = getNum(b.purchaseNumber);

        if (numA !== numB) {
          return numB - numA;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      setPurchases(purchasesList);
      setFilteredPurchases(purchasesList);
    } catch (error) {
      console.error('Error fetching purchases:', error);
      showToast('Failed to load purchases', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const suppliersRef = getCollectionRef('suppliers');
      const snapshot = await getDocs(suppliersRef);
      const suppliersList = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name
      }));
      setSuppliers(suppliersList);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  const handleMigrateLegacyIMEI = async () => {
    if (isMigrating) return;
    setIsMigrating(true);
    try {
      const purchasesRef = getCollectionRef('purchases');
      const snapshot = await getDocs(purchasesRef);
      const legacyDocs = snapshot.docs.filter(docSnap => {
        const data = docSnap.data();
        return data.isIMEIPurchase === true || (data.purchaseNumber && data.purchaseNumber.includes('IMEI'));
      });

      if (legacyDocs.length === 0) {
        showToast('No legacy IMEI purchases found to migrate', 'info');
        setIsMigrating(false);
        return;
      }

      for (const docSnap of legacyDocs) {
        const data = docSnap.data();
        await setDoc(getDocRef('imeiPurchases', docSnap.id), {
          ...data,
          isIMEIPurchase: true
        });
        await deleteDoc(getDocRef('purchases', docSnap.id));
      }

      showToast(`Successfully migrated ${legacyDocs.length} IMEI purchase(s) to 'imeiPurchases' collection!`, 'success');
      await fetchPurchases();
    } catch (err) {
      console.error('Error migrating legacy IMEI purchases:', err);
      showToast('Failed to migrate IMEI purchases', 'error');
    } finally {
      setIsMigrating(false);
    }
  };

  const filterPurchases = () => {
    let filtered = [...purchases];

    // Purchase Type filter
    if (purchaseType === 'imei') {
      filtered = filtered.filter(p => (p as any)._collection === 'imeiPurchases' || p.isIMEIPurchase || p.purchaseNumber?.includes('IMEI'));
    } else if (purchaseType === 'other') {
      filtered = filtered.filter(p => (p as any)._collection !== 'imeiPurchases' && !p.isIMEIPurchase && !p.purchaseNumber?.includes('IMEI'));
    }

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(purchase =>
        purchase.purchaseNumber.toLowerCase().includes(term) ||
        purchase.supplierName?.toLowerCase().includes(term) ||
        purchase.invoiceNumber?.toLowerCase().includes(term) ||
        purchase.items.some(item =>
          item.productName.toLowerCase().includes(term) ||
          item.brand.toLowerCase().includes(term) ||
          item.category.toLowerCase().includes(term) ||
          (item.imei && item.imei.toLowerCase().includes(term))
        )
      );
    }

    // Status filter
    if (filterStatus !== 'all') {
      if (filterStatus === 'credit') {
        filtered = filtered.filter(purchase => purchase.isCredit || purchase.pendingAmount > 0);
      } else {
        filtered = filtered.filter(purchase => purchase.paymentStatus === filterStatus);
      }
    }

    // Supplier filter
    if (selectedSupplier) {
      filtered = filtered.filter(purchase => purchase.supplierId === selectedSupplier || purchase.supplierName === selectedSupplier);
    }

    // Date filter
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filtered = filtered.filter(purchase => purchase.createdAt >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(purchase => purchase.createdAt <= end);
    }

    setFilteredPurchases(filtered);
  };

  const handleViewDetails = (purchase: Purchase) => {
    navigate(`/purchases/${purchase.id}`);
  };

  const calculateTotals = () => {
    const totalPurchases = purchases.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
    const totalPaid = purchases.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
    const totalPending = purchases.reduce((sum, p) => sum + (p.pendingAmount || 0), 0);
    const totalUnits = purchases.reduce((sum, p) => sum + (p.totalQuantity || 0), 0);
    return { totalPurchases, totalPaid, totalPending, totalUnits };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Paid
          </span>
        );
      case 'pending':
      case 'partial':
      case 'credit-partial':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Pending
          </span>
        );
      case 'unpaid':
      case 'credit':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Credit Due
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            {status || 'Unknown'}
          </span>
        );
    }
  };

  const isIMEIType = (purchase: Purchase) => {
    return (purchase as any)._collection === 'imeiPurchases' || purchase.isIMEIPurchase || purchase.purchaseNumber?.includes('IMEI');
  };

  const { totalPurchases, totalPaid, totalPending, totalUnits } = calculateTotals();

  // Counts for tabs
  const imeiCount = purchases.filter(p => isIMEIType(p)).length;
  const otherCount = purchases.length - imeiCount;

  const hasActiveFilters = Boolean(searchTerm || selectedSupplier || startDate || endDate || filterStatus !== 'all' || purchaseType !== 'all');

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedSupplier('');
    setStartDate('');
    setEndDate('');
    setFilterStatus('all');
    setPurchaseType('all');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50/60">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-80px)]">
          <div className="text-center">
            <div className="w-12 h-12 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm font-medium text-slate-600">Loading purchase directory...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-800">
      <Navbar />

      <main className="w-full px-3 sm:px-6 lg:px-8 py-5 pb-28 sm:pb-12">
        {/* Top Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Purchases
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200/80 text-slate-700">
                  {purchases.length} Records
                </span>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Manage inbound supplier shipments, IMEI serial inventories, and supplier credit balances
            </p>
          </div>

          {/* Action Header Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchPurchases}
              title="Refresh Purchases"
              className="p-2.5 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all shadow-2xs cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* Split / Dropdown Add Button */}
            <div className="relative">
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium text-sm rounded-xl hover:bg-blue-700 transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Purchase</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-80" />
              </button>

              {showAddMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowAddMenu(false)}
                  ></div>
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Select Purchase Flow
                    </div>
                    <button
                      onClick={() => { navigate('/add-purchase-imei'); setShowAddMenu(false); }}
                      className="w-full px-3.5 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium flex items-center gap-2.5 text-left cursor-pointer"
                    >
                      <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg">
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-xs">IMEI Purchase</div>
                        <div className="text-[11px] text-slate-500 font-normal">Track serial numbers per unit</div>
                      </div>
                    </button>
                    <button
                      onClick={() => { navigate('/add-purchase'); setShowAddMenu(false); }}
                      className="w-full px-3.5 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium flex items-center gap-2.5 text-left border-t border-slate-100 cursor-pointer"
                    >
                      <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                        <Package className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-xs">Standard / Other</div>
                        <div className="text-[11px] text-slate-500 font-normal">Accessories & general goods</div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Legacy Migration Alert Banner */}
        {legacyImeiCount > 0 && (
          <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl">
                <Smartphone className="w-5 h-5 flex-shrink-0" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-950">
                  {legacyImeiCount} legacy IMEI purchase{legacyImeiCount > 1 ? 's' : ''} stored in regular purchases
                </p>
                <p className="text-xs text-amber-800">
                  Migrate them into the isolated 'imeiPurchases' schema for unified tracking and fast barcode lookups.
                </p>
              </div>
            </div>
            <button
              onClick={handleMigrateLegacyIMEI}
              disabled={isMigrating}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-50 whitespace-nowrap self-start sm:self-auto cursor-pointer"
            >
              {isMigrating ? 'Migrating...' : 'Migrate Collection Now'}
            </button>
          </div>
        )}

        {/* High-level KPI Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          {/* Total Inward Volume */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Total Purchases</span>
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                <ShoppingCart className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-slate-900">
              ₹{totalPurchases.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 font-medium">
              <span>{purchases.length} total orders</span>
            </div>
          </div>

          {/* Settled / Paid */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Paid to Suppliers</span>
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-emerald-600">
              ₹{totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 font-medium">
              <span>Settled amount</span>
            </div>
          </div>

          {/* Outstanding / Pending */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Credit Outstanding</span>
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-amber-600">
              ₹{totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 font-medium">
              <span>Payable to vendors</span>
            </div>
          </div>

          {/* Total Units */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-3.5 sm:p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Total Units Inwarded</span>
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-bold font-mono tracking-tight text-slate-900">
              {totalUnits.toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 font-medium">
              <span>Stock volume received</span>
            </div>
          </div>
        </div>

        {/* Filter and Control Toolbar */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-3.5 sm:p-4 mb-5 space-y-3.5">
          {/* Top row: Type Segmented Tabs + Search + Filter Modal Trigger */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Type Segmented Tabs */}
            <div className="flex bg-slate-100/90 p-1 rounded-xl border border-slate-200/70 overflow-x-auto hide-scrollbar">
              <button
                onClick={() => setPurchaseType('all')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  purchaseType === 'all'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>All Purchases</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/70 text-slate-700 font-bold">
                  {purchases.length}
                </span>
              </button>

              <button
                onClick={() => setPurchaseType('imei')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  purchaseType === 'imei'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                <span>IMEI Devices</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-700 font-bold">
                  {imeiCount}
                </span>
              </button>

              <button
                onClick={() => setPurchaseType('other')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  purchaseType === 'other'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Package className="w-3.5 h-3.5 text-slate-600" />
                <span>Standard Items</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/70 text-slate-700 font-bold">
                  {otherCount}
                </span>
              </button>
            </div>

            {/* Search Input Bar */}
            <div className="flex-1 max-w-md relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search purchase #, supplier, invoice, product, or IMEI..."
                className="w-full pl-9 pr-9 py-2 text-xs sm:text-sm bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Drawer / Dialog Button */}
            <button
              onClick={() => setShowFilterModal(true)}
              className={`flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition-all cursor-pointer ${
                selectedSupplier || startDate || endDate
                  ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Filters</span>
              {(selectedSupplier || startDate || endDate) && (
                <span className="w-2 h-2 rounded-full bg-blue-600"></span>
              )}
            </button>
          </div>

          {/* Bottom row: Payment Status Quick Filters + Active Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-medium text-slate-500 mr-1 hidden sm:inline">Status:</span>
              {[
                { key: 'all', label: 'All Status' },
                { key: 'paid', label: 'Paid Full' },
                { key: 'credit', label: 'Credit / Due' },
              ].map(s => (
                <button
                  key={s.key}
                  onClick={() => setFilterStatus(s.key as any)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    filterStatus === s.key
                      ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Results count & Clear All */}
            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-500 font-medium">
                Showing <strong className="text-slate-900 font-semibold">{filteredPurchases.length}</strong> of {purchases.length}
              </span>
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Active Filter Chips */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2">
              {searchTerm && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-lg font-medium">
                  Search: "{searchTerm}"
                  <button onClick={() => setSearchTerm('')} className="hover:text-rose-600 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {selectedSupplier && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs rounded-lg font-medium border border-blue-200/60">
                  Supplier: {suppliers.find(s => s.id === selectedSupplier)?.name || selectedSupplier}
                  <button onClick={() => setSelectedSupplier('')} className="hover:text-rose-600 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {startDate && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-lg font-medium">
                  From: {new Date(startDate).toLocaleDateString()}
                  <button onClick={() => setStartDate('')} className="hover:text-rose-600 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {endDate && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-lg font-medium">
                  To: {new Date(endDate).toLocaleDateString()}
                  <button onClick={() => setEndDate('')} className="hover:text-rose-600 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filterStatus !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-lg font-medium">
                  Status: {filterStatus.toUpperCase()}
                  <button onClick={() => setFilterStatus('all')} className="hover:text-rose-600 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Purchases Listing - Responsive Desktop Manifest Table & Mobile Cards */}
        {filteredPurchases.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-10 sm:p-14 text-center">
            <div className="w-14 h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShoppingCart className="w-7 h-7" />
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-1">No purchases found</h3>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mb-6">
              {hasActiveFilters
                ? "No purchase records matched your search terms or active filters. Try adjusting or clearing your filters."
                : "No purchase records currently exist. Inward inventory and log stock receipts by creating a new purchase voucher."}
            </p>

            {hasActiveFilters ? (
              <button
                onClick={clearAllFilters}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-200 transition-all cursor-pointer"
              >
                Reset All Filters
              </button>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => navigate('/add-purchase-imei')}
                  className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Smartphone className="w-4 h-4" />
                  Create IMEI Purchase
                </button>
                <button
                  onClick={() => navigate('/add-purchase')}
                  className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Package className="w-4 h-4" />
                  Create Standard Purchase
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Manifest Table View */}
            <div className="hidden lg:block bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                      <th className="py-3.5 px-4 font-semibold">Purchase Voucher</th>
                      <th className="py-3.5 px-4 font-semibold">Supplier & Invoice</th>
                      <th className="py-3.5 px-4 font-semibold">Manifest Preview</th>
                      <th className="py-3.5 px-3 font-semibold text-center">Units</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Total Amount</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Paid</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Balance Due</th>
                      <th className="py-3.5 px-4 font-semibold text-center">Status</th>
                      <th className="py-3.5 px-4 font-semibold">Date</th>
                      <th className="py-3.5 px-4 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredPurchases.map((purchase) => {
                      const isIMEI = isIMEIType(purchase);
                      const pendingAmt = purchase.pendingAmount || 0;
                      return (
                        <tr
                          key={purchase.id}
                          onClick={() => handleViewDetails(purchase)}
                          className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                        >
                          {/* Purchase Voucher */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="font-mono font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                                {purchase.purchaseNumber}
                              </span>
                              {isIMEI ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  <Smartphone className="w-2.5 h-2.5" />
                                  IMEI Manifest
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                  <Package className="w-2.5 h-2.5" />
                                  General
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Supplier & Invoice */}
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900">
                              {purchase.supplierName || 'Unknown Supplier'}
                            </div>
                            {purchase.invoiceNumber ? (
                              <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono mt-0.5">
                                <FileText className="w-3 h-3 text-slate-400" />
                                <span>{purchase.invoiceNumber}</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No invoice #</span>
                            )}
                          </td>

                          {/* Manifest Preview */}
                          <td className="py-3.5 px-4 max-w-xs">
                            <div className="truncate text-slate-700 font-medium">
                              {purchase.items?.[0]?.productName || 'Inventory items'}
                              {purchase.items?.length > 1 && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                  +{purchase.items.length - 1} more
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              {purchase.items?.[0]?.brand} {purchase.items?.[0]?.model ? `• ${purchase.items[0].model}` : ''}
                            </div>
                          </td>

                          {/* Units */}
                          <td className="py-3.5 px-3 text-center">
                            <span className="inline-block px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-mono font-bold text-xs">
                              {purchase.totalQuantity}
                            </span>
                          </td>

                          {/* Total Amount */}
                          <td className="py-3.5 px-4 text-right">
                            <span className="font-mono font-bold text-slate-900">
                              ₹{(purchase.totalAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </td>

                          {/* Paid */}
                          <td className="py-3.5 px-4 text-right">
                            <span className="font-mono font-semibold text-emerald-600">
                              ₹{(purchase.paidAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </td>

                          {/* Balance Due */}
                          <td className="py-3.5 px-4 text-right">
                            {pendingAmt > 0 ? (
                              <span className="font-mono font-bold text-amber-600">
                                ₹{pendingAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            ) : (
                              <span className="font-mono text-slate-400 font-medium">₹0.00</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-4 text-center">
                            {getStatusBadge(purchase.paymentStatus)}
                          </td>

                          {/* Date */}
                          <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                            <div>{purchase.createdAt.toLocaleDateString()}</div>
                            {purchase.createdByName && (
                              <div className="text-[10px] text-slate-400 mt-0.5">By {purchase.createdByName}</div>
                            )}
                          </td>

                          {/* Action */}
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewDetails(purchase);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-blue-600 text-slate-700 hover:text-white rounded-lg text-xs font-semibold transition-all shadow-2xs group-hover:bg-blue-600 group-hover:text-white cursor-pointer"
                            >
                              <span>View</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile / Tablet Cards View */}
            <div className="lg:hidden space-y-3">
              {filteredPurchases.map((purchase) => {
                const isIMEI = isIMEIType(purchase);
                const pendingAmt = purchase.pendingAmount || 0;
                return (
                  <div
                    key={purchase.id}
                    onClick={() => handleViewDetails(purchase)}
                    className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    {/* Header Row: Voucher + Status */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-slate-900">
                            {purchase.purchaseNumber}
                          </span>
                          {isIMEI ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              IMEI
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                              General
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold mt-1">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{purchase.supplierName || 'Unknown Supplier'}</span>
                        </div>
                      </div>
                      <div>
                        {getStatusBadge(purchase.paymentStatus)}
                      </div>
                    </div>

                    {/* Invoice & Manifest Items preview */}
                    <div className="bg-slate-50 rounded-xl p-2.5 mb-3 border border-slate-100 text-xs">
                      <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1">
                        <span>Items ({purchase.items.length}) • {purchase.totalQuantity} units</span>
                        {purchase.invoiceNumber && (
                          <span className="font-mono text-slate-600">Inv: {purchase.invoiceNumber}</span>
                        )}
                      </div>
                      <div className="font-medium text-slate-800 truncate">
                        {purchase.items.slice(0, 2).map(i => i.productName).join(', ')}
                        {purchase.items.length > 2 && ` +${purchase.items.length - 2} more`}
                      </div>
                    </div>

                    {/* Financial Strip: 3 columns */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-100/50 rounded-xl p-2.5 mb-3 text-center">
                      <div>
                        <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Total</div>
                        <div className="text-xs sm:text-sm font-bold font-mono text-slate-900 mt-0.5">
                          ₹{(purchase.totalAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Paid</div>
                        <div className="text-xs sm:text-sm font-bold font-mono text-emerald-600 mt-0.5">
                          ₹{(purchase.paidAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Due</div>
                        <div className={`text-xs sm:text-sm font-bold font-mono mt-0.5 ${pendingAmt > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                          ₹{pendingAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    </div>

                    {/* Footer Row: Date & Action */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{purchase.createdAt.toLocaleDateString()}</span>
                        {purchase.createdByName && (
                          <span>• {purchase.createdByName}</span>
                        )}
                      </div>
                      <span className="font-semibold text-blue-600 flex items-center gap-1">
                        View Voucher <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Filter Modal Dialog */}
        {showFilterModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-5 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <SlidersHorizontal className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Filter Purchases</h3>
                    <p className="text-xs text-slate-500">Refine orders by supplier & date range</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowFilterModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4">
                {/* Supplier Filter */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Supplier Vendor
                  </label>
                  <select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800"
                  >
                    <option value="">All Suppliers</option>
                    {suppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Range */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Inward Date Window
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">From Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">To Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50">
                <button
                  onClick={() => {
                    setSelectedSupplier('');
                    setStartDate('');
                    setEndDate('');
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  Clear Selection
                </button>
                <button
                  onClick={() => setShowFilterModal(false)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Floating Action Button (FAB) */}
        <div className="sm:hidden fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2.5">
          {showAddMenu && (
            <>
              <div
                className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-30"
                onClick={() => setShowAddMenu(false)}
              ></div>
              <div className="flex flex-col gap-2 z-40 mb-1 animate-in slide-in-from-bottom-2 duration-150">
                <button
                  onClick={() => { navigate('/add-purchase-imei'); setShowAddMenu(false); }}
                  className="px-4 py-2.5 rounded-full bg-white shadow-xl text-xs font-bold text-slate-800 flex items-center justify-end gap-2 border border-slate-200 active:scale-95 cursor-pointer"
                >
                  <span>IMEI Device Purchase</span>
                  <Smartphone className="w-4 h-4 text-blue-600" />
                </button>
                <button
                  onClick={() => { navigate('/add-purchase'); setShowAddMenu(false); }}
                  className="px-4 py-2.5 rounded-full bg-white shadow-xl text-xs font-bold text-slate-800 flex items-center justify-end gap-2 border border-slate-200 active:scale-95 cursor-pointer"
                >
                  <span>Standard Purchase</span>
                  <Package className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            </>
          )}
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="w-13 h-13 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center relative z-40 active:scale-95 transition-transform cursor-pointer"
            aria-label="Add Purchase"
            style={{ transform: showAddMenu ? 'rotate(45deg)' : 'rotate(0deg)' }}
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </main>
    </div>
  );
};

export default Purchases;
