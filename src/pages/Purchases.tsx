import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import { ShoppingCart, Plus, Search, Calendar, User, FileText, Eye, Filter, X, Smartphone, Package } from 'lucide-react';
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
  const [showSearch, setShowSearch] = useState(false);
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
        // Extract number from purchase number (e.g., "PUR-0036" -> 36, "PUR-IMEI-0036" -> 36)
        const getNum = (purchaseNum: string) => {
          if (!purchaseNum) return 0;
          const parts = purchaseNum.split('-');
          return parseInt(parts[parts.length - 1] || '0', 10);
        };
        const numA = getNum(a.purchaseNumber);
        const numB = getNum(b.purchaseNumber);
        
        if (numA !== numB) {
          return numB - numA; // Descending order (highest number first)
        }
        
        // If purchase numbers are exactly the same (e.g. duplicated), fallback to date
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
        // Show purchases that are on credit (have pending amount)
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
    const totalPurchases = purchases.reduce((sum, p) => sum + p.totalAmount, 0);
    const totalPaid = purchases.reduce((sum, p) => sum + p.paidAmount, 0);
    const totalPending = purchases.reduce((sum, p) => sum + p.pendingAmount, 0);
    return { totalPurchases, totalPaid, totalPending };
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      paid: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      unpaid: 'bg-red-100 text-red-700',
      // Legacy mappings for existing data
      partial: 'bg-yellow-100 text-yellow-700',
      credit: 'bg-red-100 text-red-700',
      'credit-partial': 'bg-yellow-100 text-yellow-700'
    };
    return badges[status as keyof typeof badges] || 'bg-gray-100 text-gray-700';
  };

  const { totalPurchases, totalPaid, totalPending } = calculateTotals();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Loading purchases...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8">
        {/* Compact Header */}
        <div className="mb-3 sm:mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Purchases
            </h1>
          </div>
          <div className="relative z-40">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Purchase
            </button>

            {showAddMenu && (
              <>
                <div 
                  className="fixed inset-0 z-0 hidden sm:block" 
                  onClick={() => setShowAddMenu(false)}
                ></div>
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-10 overflow-hidden">
                  <button
                    onClick={() => { navigate('/add-purchase-imei'); setShowAddMenu(false); }}
                    className="w-full px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium flex items-center gap-2"
                  >
                    <Smartphone className="w-4 h-4" />
                    IMEI Purchase
                  </button>
                  <button
                    onClick={() => { navigate('/add-purchase'); setShowAddMenu(false); }}
                    className="w-full px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors border-t border-gray-100 font-medium flex items-center gap-2"
                  >
                    <Package className="w-4 h-4" />
                    Other Purchase
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Migration Tool removed per request */}

        {/* Compact Stats - Hide on Mobile */}
        <div className="hidden sm:grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-600">Total</p>
            <p className="text-lg font-bold text-gray-900">₹{totalPurchases.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-600">Paid</p>
            <p className="text-lg font-bold text-green-600">₹{totalPaid.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-600">Pending</p>
            <p className="text-lg font-bold text-red-600">₹{totalPending.toFixed(2)}</p>
          </div>
        </div>

        {legacyImeiCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 sm:p-4 mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Smartphone className="w-5 h-5 text-amber-700 flex-shrink-0" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-900">
                  {legacyImeiCount} legacy IMEI purchase{legacyImeiCount > 1 ? 's' : ''} in regular purchases collection
                </p>
                <p className="text-xs text-amber-700">
                  Move them to the separate 'imeiPurchases' collection for clean data architecture.
                </p>
              </div>
            </div>
            <button
              onClick={handleMigrateLegacyIMEI}
              disabled={isMigrating}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
            >
              {isMigrating ? 'Migrating...' : 'Migrate to Separate Collection'}
            </button>
          </div>
        )}

        {/* Purchase Type Tabs */}
        <div className="flex bg-white rounded-lg p-1 border border-gray-200 mb-3 sm:mb-4 overflow-x-auto hide-scrollbar sm:w-max">
          {[
            { key: 'all', label: 'All Purchases', icon: ShoppingCart },
            { key: 'imei', label: 'IMEI Purchases', icon: Smartphone },
            { key: 'other', label: 'Other Purchases', icon: Package }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setPurchaseType(tab.key as any)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none flex items-center justify-center gap-2 ${
                  purchaseType === tab.key
                    ? 'bg-blue-100 text-blue-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Compact Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Status Filter Tags */}
            {[
              { key: 'all', label: 'All' },
              { key: 'paid', label: 'Paid' },
              { key: 'credit', label: 'Credit' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setFilterStatus(s.key as any)}
                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${filterStatus === (s.key as any)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
              >
                {s.label}
              </button>
            ))}

            {/* Search Button */}
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors border ${showSearch || searchTerm
                ? 'bg-blue-50 text-blue-700 border-blue-300'
                : 'bg-gray-100 text-gray-700 border-gray-300'
                }`}
            >
              <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm">Search</span>
              {searchTerm && (
                <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
              )}
            </button>

            {/* Filter Modal Button */}
            <button
              onClick={() => setShowFilterModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg transition-colors border border-gray-300"
            >
              <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm">Filters</span>
              {(selectedSupplier || startDate || endDate) && (
                <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
              )}
            </button>
          </div>

          {/* Search Input (Collapsible) */}
          {showSearch && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by purchase #, supplier, invoice, product, or IMEI..."
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Active Filters Indicator */}
          {(searchTerm || selectedSupplier || startDate || endDate) && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm text-gray-600">Active filters:</span>
                {searchTerm && (
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                    Search: "{searchTerm}"
                  </span>
                )}
                {selectedSupplier && (
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                    Supplier: {suppliers.find(s => s.id === selectedSupplier)?.name || selectedSupplier}
                  </span>
                )}
                {startDate && (
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                    From: {new Date(startDate).toLocaleDateString()}
                  </span>
                )}
                {endDate && (
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                    To: {new Date(endDate).toLocaleDateString()}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSelectedSupplier('');
                  setStartDate('');
                  setEndDate('');
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* Filter Modal */}
        {showFilterModal && (
          <div className="fixed inset-0 bg-transparent bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Filter className="w-5 h-5 text-blue-600" />
                  Filter Purchases
                </h3>
                <button
                  onClick={() => setShowFilterModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-4">
                {/* Supplier Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Supplier
                  </label>
                  <select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date Range
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">From</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">To</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <button
                  onClick={() => {
                    setSelectedSupplier('');
                    setStartDate('');
                    setEndDate('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Clear Filters
                </button>
                <button
                  onClick={() => setShowFilterModal(false)}
                  className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Purchases List - Responsive: Cards on Mobile, Table on Desktop */}
        {filteredPurchases.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">No purchases found</p>
            <p className="text-gray-400 text-sm mt-2">
              {searchTerm || filterStatus !== 'all' || startDate || endDate
                ? 'Try adjusting your filters'
                : 'Start by adding your first purchase'}
            </p>
            {!searchTerm && filterStatus === 'all' && !startDate && !endDate && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => navigate('/add-purchase-imei')}
                  className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto flex items-center justify-center gap-2"
                >
                  <Smartphone className="w-4 h-4" />
                  Add IMEI Purchase
                </button>
                <button
                  onClick={() => navigate('/add-purchase')}
                  className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors w-full sm:w-auto flex items-center justify-center gap-2"
                >
                  <Package className="w-4 h-4" />
                  Add Other Purchase
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Card View */}
            <div className="md:hidden space-y-4">
              {filteredPurchases.map(purchase => (
                <div key={purchase.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 hover:shadow-md transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    {/* Purchase Info */}
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold text-gray-900">{purchase.purchaseNumber}</h3>
                            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getStatusBadge(purchase.paymentStatus)}`}>
                              {purchase.paymentStatus.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <User className="w-4 h-4" />
                            <span className="font-medium">{purchase.supplierName || 'Unknown Supplier'}</span>
                          </div>
                          {purchase.invoiceNumber && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                              <FileText className="w-4 h-4" />
                              <span>Invoice: {purchase.invoiceNumber}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Items Summary */}
                      <div className="bg-gray-50 rounded-lg p-3 mb-3">
                        <p className="text-sm font-medium text-gray-700 mb-2">Items ({purchase.items.length}):</p>
                        <div className="space-y-1">
                          {purchase.items.slice(0, 3).map((item, index) => (
                            <div key={index} className="flex justify-between text-sm">
                              <span className="text-gray-600">
                                {item.productName} {item.imei && <span className="text-blue-600 font-mono text-[10px]">({item.imei})</span>} ({item.quantity} units)
                              </span>
                              <span className="font-medium text-gray-900">₹{item.totalCost.toFixed(2)}</span>
                            </div>
                          ))}
                          {purchase.items.length > 3 && (
                            <p className="text-xs text-blue-600 font-medium">
                              +{purchase.items.length - 3} more items
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Financial Summary */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-gray-500 text-xs">Total Quantity</p>
                          <p className="font-semibold text-gray-900">{purchase.totalQuantity}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Total Amount</p>
                          <p className="font-semibold text-gray-900">₹{purchase.totalAmount.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Paid</p>
                          <p className="font-semibold text-green-600">₹{purchase.paidAmount.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Pending</p>
                          <p className="font-semibold text-red-600">₹{purchase.pendingAmount.toFixed(2)}</p>
                        </div>
                      </div>

                      {/* Date and Creator */}
                      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          <span>{purchase.createdAt.toLocaleDateString()}</span>
                        </div>
                        <span>By: {purchase.createdByName}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex sm:flex-col gap-2">
                      <button
                        onClick={() => handleViewDetails(purchase)}
                        className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                      >
                        <Eye className="w-4 h-4" />
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3">Purchase #</th>
                    <th className="text-left px-4 py-3">Supplier</th>
                    <th className="text-right px-4 py-3">Amount</th>
                    <th className="text-right px-4 py-3">Paid</th>
                    <th className="text-right px-4 py-3">Pending</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-right px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchases.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{p.purchaseNumber}</td>
                      <td className="px-4 py-3">{p.supplierName || 'Unknown'}</td>
                      <td className="px-4 py-3 text-right">₹{p.totalAmount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-green-600">₹{p.paidAmount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-red-600">₹{p.pendingAmount.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadge(p.paymentStatus)}`}>{p.paymentStatus.toUpperCase()}</span>
                      </td>
                      <td className="px-4 py-3">{p.createdAt.toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleViewDetails(p)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                          aria-label="View details"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Mobile Add Purchase FAB */}
        <div className="sm:hidden fixed bottom-24 right-4 z-50 flex flex-col items-end gap-3">
          {showAddMenu && (
            <>
              <div 
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity" 
                onClick={() => setShowAddMenu(false)}
              ></div>
              <div className="flex flex-col gap-3 z-50 mb-2">
                <button
                  onClick={() => { navigate('/add-purchase-imei'); setShowAddMenu(false); }}
                  className="px-5 py-3 rounded-full bg-white shadow-xl text-sm font-semibold text-gray-800 flex items-center justify-end gap-2 border border-gray-100 hover:bg-gray-50 active:scale-95 transition-all w-full text-right"
                >
                  <span>IMEI Purchase</span>
                  <Smartphone className="w-4 h-4 text-gray-600" />
                </button>
                <button
                  onClick={() => { navigate('/add-purchase'); setShowAddMenu(false); }}
                  className="px-5 py-3 rounded-full bg-white shadow-xl text-sm font-semibold text-gray-800 flex items-center justify-end gap-2 border border-gray-100 hover:bg-gray-50 active:scale-95 transition-all w-full text-right"
                >
                  <span>Other Purchase</span>
                  <Package className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            </>
          )}
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="px-4 py-4 rounded-full bg-blue-600 text-white shadow-xl hover:bg-blue-700 relative z-50 transition-transform duration-200"
            aria-label="Add Purchase"
            style={{ transform: showAddMenu ? 'rotate(45deg)' : 'rotate(0deg)' }}
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Purchases;
