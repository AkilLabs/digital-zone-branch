import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { collection, getDocs, doc, query, orderBy, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Product, StockTransfer, StockTransferItem } from '../types';
import { syncStoreProducts, updateLocalProductQuantities, upsertLocalProducts } from '../utils/productSyncCache';
import { useInvalidateCache } from '../hooks/useFirestoreCache';
import { printStockTransferInvoice } from '../utils/printStockTransferInvoice';
import {
  ArrowLeftRight,
  ArrowRight,
  Warehouse,
  Search,
  Package,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Plus,
  Printer,
  Store,
  Boxes,
  Check
} from 'lucide-react';

/**
 * Returns the correct Firestore collection reference for products at a given location.
 * - Hub warehouse products live at root 'products' collection
 * - Store products live at 'stores/{storeId}/products'
 */
const getProductsColRef = (locationId: string, hubId: string | undefined) => {
  if (
    locationId === hubId ||
    locationId === 'hub_warehouse' ||
    locationId === 'digital_zone_hq'
  ) {
    return collection(db, 'products');
  }
  return collection(db, 'stores', locationId, 'products');
};

/** Returns a single product doc reference at the correct path. */
const getProductDocRefByLocation = (locationId: string, hubId: string | undefined, productId: string) => {
  if (
    locationId === hubId ||
    locationId === 'hub_warehouse' ||
    locationId === 'digital_zone_hq'
  ) {
    return doc(db, 'products', productId);
  }
  return doc(db, 'stores', locationId, 'products', productId);
};

const StockTransferPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { currentHub, stores } = useStore();
  const { invalidateProducts } = useInvalidateCache();
  const [searchParams] = useSearchParams();

  // Navigation tab: 'create' or 'history'
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');

  // Multi-step state: 1 = Route, 2 = Items, 3 = Review & Dispatch
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Transfer locations
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');

  // Source inventory & selected manifest
  const [sourceProducts, setSourceProducts] = useState<Product[]>([]);
  const [selectedItems, setSelectedItems] = useState<StockTransferItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [notes, setNotes] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Completed transfer receipt state
  const [completedTransfer, setCompletedTransfer] = useState<{
    id: string;
    fromName: string;
    toName: string;
    totalQuantity: number;
    totalValue: number;
    items: StockTransferItem[];
    notes?: string;
    date: Date;
  } | null>(null);

  // History state
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedTransferForView, setSelectedTransferForView] = useState<StockTransfer | null>(null);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Pre-populate source (Central Warehouse) and destination from URL query params
  useEffect(() => {
    if (!currentHub?.id) return;
    const toParam = searchParams.get('to');
    const fromParam = searchParams.get('from');

    if (fromParam) {
      setFromStoreId(fromParam);
    } else if (!fromStoreId) {
      setFromStoreId(currentHub.id);
    }

    if (toParam && toParam !== (fromParam || currentHub.id)) {
      setToStoreId(toParam);
    }
  }, [currentHub?.id, searchParams]);

  useEffect(() => {
    if (currentHub?.id) {
      loadTransfers();
    }
  }, [currentHub?.id, stores.length]);

  useEffect(() => {
    if (fromStoreId && currentHub?.id) {
      loadSourceProducts();
    } else {
      setSourceProducts([]);
    }
  }, [fromStoreId, currentHub?.id]);

  const getLocationName = (id: string) => {
    if (!id) return 'Select location';
    if (id === currentHub?.id) return `${currentHub?.name || 'Head Office'} (Central Warehouse)`;
    return stores.find(s => s.id === id)?.name || 'Branch Store';
  };

  const loadSourceProducts = async () => {
    if (!fromStoreId) return;
    setLoadingProducts(true);
    try {
      const isHq =
        fromStoreId === currentHub?.id ||
        fromStoreId === 'hub_warehouse' ||
        fromStoreId === 'digital_zone_hq';
      const storeScopeId = isHq ? null : fromStoreId;
      const prods = await syncStoreProducts(storeScopeId);

      if (isHq) {
        // Collect current branch quantities across all branches to isolate true HQ warehouse stock
        const branchQtyMap = new Map<string, number>();
        await Promise.all(
          stores.map(async (st) => {
            if (!st.id) return;
            try {
              const branchProds = await syncStoreProducts(st.id);
              branchProds.forEach((bp) => {
                const code = bp.productCode || bp.id;
                if (code) {
                  branchQtyMap.set(
                    code,
                    (branchQtyMap.get(code) || 0) + (Number(bp.quantity) || 0)
                  );
                }
              });
            } catch {
              // ignore
            }
          })
        );

        const netHqProducts = prods
          .filter((p) => {
            if (
              p.storeId &&
              p.storeId !== 'hub_warehouse' &&
              p.storeId !== 'digital_zone_hq' &&
              stores.some((s) => s.id === p.storeId)
            ) {
              return false;
            }
            return true;
          })
          .map((p) => {
            const code = p.productCode || p.id || '';
            const inBranchQty = branchQtyMap.get(code) || 0;
            const netQty = Math.max(0, (Number(p.quantity) || 0) - inBranchQty);
            return {
              ...p,
              quantity: netQty,
            };
          })
          .filter((p) => (Number(p.quantity) || 0) > 0)
          .sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));

        setSourceProducts(netHqProducts);
      } else {
        const validProds = prods.filter((p) => (p.quantity || 0) > 0);
        validProds.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
        setSourceProducts(validProds);
      }
    } catch (err) {
      console.error('Error loading products:', err);
      showToast('Failed to load source inventory', 'error');
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadTransfers = async () => {
    if (!currentHub?.id) return;
    setLoadingTransfers(true);
    try {
      const q = query(
        collection(db, 'stockTransfers'),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const allTransfers: StockTransfer[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate ? d.data().createdAt.toDate() : new Date(),
        completedAt: d.data().completedAt?.toDate ? d.data().completedAt.toDate() : undefined,
      } as StockTransfer));
      allTransfers.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setTransfers(allTransfers);
    } catch (err) {
      console.error('Error loading transfers:', err);
    } finally {
      setLoadingTransfers(false);
    }
  };

  const handleSwapLocations = () => {
    if (!fromStoreId && !toStoreId) return;
    const prevFrom = fromStoreId;
    const prevTo = toStoreId;
    setFromStoreId(prevTo);
    setToStoreId(prevFrom);
    setSelectedItems([]);
  };

  const addProductToTransfer = (product: Product) => {
    if (!product.id) return;
    const cleanCode = (product.productCode || '').trim();
    const existing = selectedItems.find(
      (i) =>
        i.productId === product.id ||
        (cleanCode && (i.productCode || '').trim() === cleanCode)
    );
    if (existing) {
      updateItemQty(existing.productId, existing.quantity + 1);
      return;
    }
    setSelectedItems(prev => [
      ...prev,
      {
        productId: product.id!,
        productCode: cleanCode || product.productCode || '',
        productName: product.name,
        brand: product.brand,
        category: product.category,
        quantity: 1,
        cost: product.cost,
        mrp: product.mrp,
      },
    ]);
  };

  const updateItemQty = (productId: string, qty: number) => {
    const product = sourceProducts.find(p => p.id === productId);
    const maxQty = product?.quantity || 1;
    setSelectedItems(prev =>
      prev.map(i =>
        i.productId === productId ? { ...i, quantity: Math.max(1, Math.min(qty, maxQty)) } : i
      )
    );
  };

  const removeItem = (productId: string) => {
    setSelectedItems(prev => prev.filter(i => i.productId !== productId));
  };

  const handleSubmitTransfer = async () => {
    if (!currentHub?.id || !fromStoreId || !toStoreId || selectedItems.length === 0) return;
    if (fromStoreId === toStoreId) {
      showToast('Source and destination must be different', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const fromStoreName = getLocationName(fromStoreId);
      const toStoreName = getLocationName(toStoreId);

      const totalQuantity = selectedItems.reduce((sum, i) => sum + i.quantity, 0);
      const totalValue = selectedItems.reduce((sum, i) => sum + i.cost * i.quantity, 0);

      // Create transfer record
      const transferData = {
        hubId: currentHub.id,
        transferType: (fromStoreId === currentHub.id ? 'hq_to_branch' : 'branch_to_branch') as any,
        fromStoreId,
        fromStoreName,
        toStoreId,
        toStoreName,
        items: selectedItems,
        totalItems: selectedItems.length,
        totalQuantity,
        totalValue,
        status: 'completed' as const,
        notes: notes.trim(),
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'HQ Admin',
        completedAt: Timestamp.now(),
        completedBy: currentUser?.uid || '',
        completedByName: currentUser?.displayName || currentUser?.email || 'HQ Admin',
      };

      // Collect destination product data from local Delta-Sync cache
      const destStoreScopeId = toStoreId === currentHub?.id ? null : toStoreId;
      const sourceStoreScopeId = fromStoreId === currentHub?.id ? null : fromStoreId;
      const destLocalProducts = await syncStoreProducts(destStoreScopeId);
      const destProductData = new Map<string, { ref: any; id: string; quantity: number } | null>();

      for (const item of selectedItems) {
        const destProd = destLocalProducts.find(p => p.productCode === item.productCode);
        if (destProd && destProd.id) {
          const destRef = getProductDocRefByLocation(toStoreId, currentHub?.id, destProd.id);
          destProductData.set(item.productId, { ref: destRef, id: destProd.id, quantity: destProd.quantity || 0 });
        } else {
          destProductData.set(item.productId, null);
        }
      }

      // Create batch — all writes atomic
      const batch = writeBatch(db);
      const nowTs = Timestamp.now();

      const transferDocRef = doc(collection(db, 'stockTransfers'));
      batch.set(transferDocRef, transferData);

      const sourceQuantityChanges: Array<{ productId: string; quantityDelta: number }> = [];
      const destQuantityChanges: Array<{ productId: string; quantityDelta: number }> = [];
      const destNewProducts: Array<Partial<Product> & { id: string }> = [];
      const createdRefsByCode = new Map<string, { ref: any; id: string; quantity: number }>();

      for (const item of selectedItems) {
        // Decrease quantity in source
        const sourceRef = getProductDocRefByLocation(fromStoreId, currentHub?.id, item.productId);
        const sourceProduct = sourceProducts.find(p => p.id === item.productId);
        if (sourceProduct) {
          const newQty = sourceProduct.quantity - item.quantity;
          batch.update(sourceRef, {
            quantity: newQty,
            isAvailable: newQty > 0,
            updatedAt: nowTs,
          });
          sourceQuantityChanges.push({ productId: item.productId, quantityDelta: -item.quantity });
        }

        // Increase quantity in destination
        const cleanCode = (item.productCode || '').trim();
        const destData =
          destProductData.get(item.productId) ||
          (cleanCode ? createdRefsByCode.get(cleanCode) : null);

        if (destData) {
          destData.quantity += item.quantity;
          batch.update(destData.ref, {
            quantity: destData.quantity,
            isAvailable: true,
            updatedAt: nowTs,
          });
          destQuantityChanges.push({ productId: destData.id, quantityDelta: item.quantity });
        } else {
          const destProductsRef = getProductsColRef(toStoreId, currentHub?.id);
          const newProductRef = doc(destProductsRef);
          const newProductPayload = {
            productCode: cleanCode || item.productCode,
            name: item.productName,
            brand: item.brand,
            category: item.category,
            cost: item.cost,
            mrp: item.mrp,
            quantity: item.quantity,
            isAvailable: true,
            paymentType: 'transfer',
            supplier: `Transfer from ${fromStoreName}`,
            storeId: toStoreId === currentHub.id ? null : toStoreId,
            createdAt: nowTs,
            updatedAt: nowTs,
            createdBy: currentUser?.uid || '',
            createdByName: currentUser?.displayName || 'HQ Admin',
          };
          batch.set(newProductRef, newProductPayload);
          if (cleanCode) {
            createdRefsByCode.set(cleanCode, {
              ref: newProductRef,
              id: newProductRef.id,
              quantity: item.quantity,
            });
          }
          destNewProducts.push({
            id: newProductRef.id,
            ...newProductPayload,
            paymentType: 'cash',
            createdAt: nowTs.toDate(),
            updatedAt: nowTs.toDate(),
          } as Partial<Product> & { id: string });
        }
      }

      await batch.commit();

      await updateLocalProductQuantities(sourceStoreScopeId, sourceQuantityChanges);
      if (destQuantityChanges.length > 0) {
        await updateLocalProductQuantities(destStoreScopeId, destQuantityChanges);
      }
      if (destNewProducts.length > 0) {
        await upsertLocalProducts(destStoreScopeId, destNewProducts);
      }
      invalidateProducts();

      // Show completed receipt screen
      setCompletedTransfer({
        id: transferDocRef.id,
        fromName: fromStoreName,
        toName: toStoreName,
        totalQuantity,
        totalValue,
        items: [...selectedItems],
        notes: notes.trim(),
        date: new Date()
      });

      // Reset items form
      setSelectedItems([]);
      setNotes('');
      await loadSourceProducts();
      await loadTransfers();
      showToast(`Dispatched ${totalQuantity} units to ${toStoreName} successfully!`);
    } catch (error) {
      console.error('Error submitting transfer:', error);
      showToast('Failed to complete stock transfer. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintDeliveryChallan = (transfer: {
    id: string;
    fromName: string;
    toName: string;
    totalQuantity: number;
    totalValue: number;
    items: StockTransferItem[];
    notes?: string;
    date: Date;
  }) => {
    printStockTransferInvoice({
      transfer: {
        id: transfer.id,
        fromStoreName: transfer.fromName,
        toStoreName: transfer.toName,
        totalQuantity: transfer.totalQuantity,
        totalValue: transfer.totalValue,
        items: transfer.items,
        notes: transfer.notes,
        createdAt: transfer.date,
        status: 'completed',
      },
      hubName: currentHub?.name || 'DIGITAL ZONE',
      hubAddress: currentHub?.address || 'Central Warehouse & Head Office',
      hubPhone: currentHub?.phone || '+91 98765 43210',
      hubEmail: currentHub?.email || 'support@digitalzone.com',
      hubGst: (currentHub as any)?.gst || '33AAAAA0000A1Z5',
    });
  };

  // Distinct brands in source inventory
  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    sourceProducts.forEach(p => {
      if (p.brand) set.add(p.brand);
    });
    return Array.from(set).sort();
  }, [sourceProducts]);

  const filteredProducts = useMemo(() => {
    return sourceProducts.filter(p => {
      if (brandFilter !== 'all' && p.brand !== brandFilter) return false;
      const q = searchText.trim().toLowerCase();
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.productCode?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q)
      );
    });
  }, [sourceProducts, brandFilter, searchText]);

  const totalTransferQty = useMemo(() => {
    return selectedItems.reduce((acc, i) => acc + i.quantity, 0);
  }, [selectedItems]);

  const totalTransferValuation = useMemo(() => {
    return selectedItems.reduce((acc, i) => acc + (i.cost || 0) * i.quantity, 0);
  }, [selectedItems]);

  const filteredTransfers = useMemo(() => {
    return transfers.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!historySearch.trim()) return true;
      const q = historySearch.toLowerCase().trim();
      return (
        t.fromStoreName?.toLowerCase().includes(q) ||
        t.toStoreName?.toLowerCase().includes(q) ||
        t.id?.toLowerCase().includes(q) ||
        t.items?.some(i => i.productName?.toLowerCase().includes(q) || i.productCode?.toLowerCase().includes(q))
      );
    });
  }, [transfers, statusFilter, historySearch]);

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-800">
      <Navbar />

      <main className="w-full max-w-full px-3 sm:px-6 lg:px-8 py-5 pb-28 sm:pb-12">
        {/* Toast Alert */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150 ${
              toast.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            {toast.type === 'error' ? <AlertCircle className="w-4 h-4 text-rose-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* Top Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
                <ArrowLeftRight className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Stock Transfer
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/80">
                  Head Office Dispatch
                </span>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Dispatch inventory seamlessly between Central Warehouse and branch stores with real-time stock sync
            </p>
          </div>

          {/* Tab Switcher: Create Transfer vs History */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/80 w-fit">
            <button
              onClick={() => {
                setActiveTab('create');
                setCompletedTransfer(null);
              }}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'create'
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Transfer</span>
            </button>
            <button
              onClick={() => navigate('/stock-transfer/history')}
              className="px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 cursor-pointer text-slate-600 hover:text-blue-700 hover:bg-white"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Transfer History</span>
              {transfers.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700">
                  {transfers.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {activeTab === 'create' ? (
          completedTransfer ? (
            /* ================= SUCCESS DISPATCH RECEIPT ================= */
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6 sm:p-10 text-center max-w-2xl mx-auto animate-in zoom-in-95 duration-150">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-200">
                <Check className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                Stock Dispatched Successfully!
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mb-6">
                Transfer voucher <strong className="font-mono text-slate-800">{completedTransfer.id}</strong> has been created and destination stock levels updated atomically.
              </p>

              {/* Receipt Summary Card */}
              <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border border-slate-200/80 mb-6 text-left space-y-3">
                <div className="flex items-center justify-between text-xs pb-3 border-b border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Origin Location</span>
                    <span className="font-bold text-slate-800 text-sm">{completedTransfer.fromName}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Destination Branch</span>
                    <span className="font-bold text-slate-800 text-sm">{completedTransfer.toName}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-slate-500">Total Units Dispatched:</span>
                    <span className="ml-2 font-mono font-bold text-slate-900">{completedTransfer.totalQuantity} units</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500">Gross Transfer Value:</span>
                    <span className="ml-2 font-mono font-bold text-blue-700">₹{completedTransfer.totalValue.toFixed(2)}</span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 pt-1">
                  Line Items: <strong>{completedTransfer.items.length} product(s)</strong>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => handlePrintDeliveryChallan(completedTransfer)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Gate Pass / Challan</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCompletedTransfer(null);
                    setCurrentStep(1);
                  }}
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  Start Another Transfer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCompletedTransfer(null);
                    navigate('/stock-transfer/history');
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  View in History
                </button>
              </div>
            </div>
          ) : (
            /* ================= MULTI-STEP CREATION FLOW ================= */
            <div className="space-y-6">
              {/* Stepper Navigation Indicator */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-3 sm:p-4">
                <div className="flex items-center justify-between w-full px-2 sm:px-6">
                  {/* Step 1 Pill */}
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="flex items-center gap-2.5 cursor-pointer text-left group"
                  >
                    <div
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-xs font-bold transition-all ${
                        currentStep === 1
                          ? 'bg-blue-600 text-white shadow-xs ring-4 ring-blue-500/10'
                          : currentStep > 1
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {currentStep > 1 ? <Check className="w-4 h-4" /> : '1'}
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Step 1</div>
                      <div className={`text-xs font-bold ${currentStep === 1 ? 'text-blue-600' : 'text-slate-700'}`}>
                        Route
                      </div>
                    </div>
                  </button>

                  <div className={`flex-1 h-0.5 mx-2 sm:mx-4 ${currentStep > 1 ? 'bg-emerald-400' : 'bg-slate-200'}`} />

                  {/* Step 2 Pill */}
                  <button
                    type="button"
                    onClick={() => {
                      if (fromStoreId && toStoreId && fromStoreId !== toStoreId) {
                        setCurrentStep(2);
                      }
                    }}
                    disabled={!fromStoreId || !toStoreId || fromStoreId === toStoreId}
                    className="flex items-center gap-2.5 cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <div
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-xs font-bold transition-all ${
                        currentStep === 2
                          ? 'bg-blue-600 text-white shadow-xs ring-4 ring-blue-500/10'
                          : currentStep > 2
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {currentStep > 2 ? <Check className="w-4 h-4" /> : '2'}
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Step 2</div>
                      <div className={`text-xs font-bold ${currentStep === 2 ? 'text-blue-600' : 'text-slate-700'}`}>
                        Items ({selectedItems.length})
                      </div>
                    </div>
                  </button>

                  <div className={`flex-1 h-0.5 mx-2 sm:mx-4 ${currentStep > 2 ? 'bg-emerald-400' : 'bg-slate-200'}`} />

                  {/* Step 3 Pill */}
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedItems.length > 0) {
                        setCurrentStep(3);
                      }
                    }}
                    disabled={selectedItems.length === 0}
                    className="flex items-center gap-2.5 cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <div
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-xs font-bold transition-all ${
                        currentStep === 3
                          ? 'bg-blue-600 text-white shadow-xs ring-4 ring-blue-500/10'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      3
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Step 3</div>
                      <div className={`text-xs font-bold ${currentStep === 3 ? 'text-blue-600' : 'text-slate-700'}`}>
                        Dispatch
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* ================= STEP 1: ROUTE SELECTION ================= */}
              {currentStep === 1 && (
                <div className="space-y-6 animate-in fade-in duration-150">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">
                    {/* Source Origin Card */}
                    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-3.5">
                      <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                        <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                          <Warehouse className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">1. Origin Location (From)</h3>
                          <p className="text-[11px] text-slate-500">Warehouse or branch stock will be deducted</p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                          Select Source Location
                        </label>
                        <select
                          value={fromStoreId}
                          onChange={(e) => {
                            setFromStoreId(e.target.value);
                            setSelectedItems([]);
                          }}
                          className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800"
                        >
                          {currentHub && (
                            <option value={currentHub.id}>
                              {currentHub.name} (Central Warehouse / HQ)
                            </option>
                          )}
                          {stores.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} {s.branchId ? `(${s.branchId})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs text-slate-600">
                        <span>Available Source SKUs:</span>
                        <span className="font-mono font-bold text-slate-900">
                          {loadingProducts ? 'Scanning...' : `${sourceProducts.length} items`}
                        </span>
                      </div>
                    </div>

                    {/* Swap Button In Between */}
                    <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                      <button
                        type="button"
                        onClick={handleSwapLocations}
                        title="Swap Origin and Destination"
                        className="p-3 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-300 shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
                      >
                        <ArrowLeftRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Destination Target Card */}
                    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-3.5">
                      <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                          <Store className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">2. Destination Branch (To)</h3>
                          <p className="text-[11px] text-slate-500">Receiving branch inventory will be credited</p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                          Select Destination Branch
                        </label>
                        <select
                          value={toStoreId}
                          onChange={(e) => setToStoreId(e.target.value)}
                          className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800"
                        >
                          <option value="">-- Choose Target Branch --</option>
                          {stores
                            .filter((s) => s.id !== fromStoreId)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.branchId ? `(${s.branchId})` : ''}
                              </option>
                            ))}
                          {currentHub && fromStoreId !== currentHub.id && (
                            <option value={currentHub.id}>
                              {currentHub.name} (Central Warehouse / HQ)
                            </option>
                          )}
                        </select>
                      </div>

                      {fromStoreId && toStoreId && fromStoreId === toStoreId && (
                        <div className="p-3 bg-rose-50 text-rose-700 rounded-xl border border-rose-200 text-xs flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          <span>Origin and destination cannot be the same store location.</span>
                        </div>
                      )}

                      {toStoreId && fromStoreId !== toStoreId && (
                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-between text-xs text-blue-700">
                          <span>Target Ready:</span>
                          <span className="font-bold">{getLocationName(toStoreId)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visual Route Strip */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-xs sm:text-sm">
                      <span className="font-bold text-slate-900">{getLocationName(fromStoreId)}</span>
                      <ArrowRight className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="font-bold text-blue-600">
                        {toStoreId ? getLocationName(toStoreId) : 'Choose Destination Branch'}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={!fromStoreId || !toStoreId || fromStoreId === toStoreId}
                      onClick={() => setCurrentStep(2)}
                      className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>Continue to Select Products</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* ================= STEP 2: PRODUCT SELECTION & MANIFEST ================= */}
              {currentStep === 2 && (
                <div className="space-y-6 animate-in fade-in duration-150">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* Left: Source Inventory Picker (7 cols) */}
                    <div className="lg:col-span-7 space-y-4">
                      {/* Search and Filter Box */}
                      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                            <Package className="w-4 h-4 text-blue-600" />
                            <span>Source Inventory Catalog</span>
                          </h3>
                          <span className="text-xs font-medium text-slate-500">
                            {filteredProducts.length} items available
                          </span>
                        </div>

                        {/* Search Bar */}
                        <div className="relative">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            placeholder="Search by product name, brand, SKU code..."
                            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                          />
                        </div>

                        {/* Brand filter chips */}
                        {availableBrands.length > 0 && (
                          <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pt-1">
                            <button
                              type="button"
                              onClick={() => setBrandFilter('all')}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                                brandFilter === 'all'
                                  ? 'bg-blue-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              All Brands
                            </button>
                            {availableBrands.map((b) => (
                              <button
                                key={b}
                                type="button"
                                onClick={() => setBrandFilter(b)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                                  brandFilter === b
                                  ? 'bg-blue-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                {b}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Products List */}
                      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4">
                        {loadingProducts ? (
                          <div className="py-12 text-center text-slate-500 text-xs">
                            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                            Loading source warehouse inventory...
                          </div>
                        ) : filteredProducts.length === 0 ? (
                          <div className="py-10 text-center text-slate-400 text-xs">
                            <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            No available stock found matching your query.
                          </div>
                        ) : (
                          <div className="max-h-[500px] overflow-y-auto space-y-2 pr-1">
                            {filteredProducts.map((product) => {
                              const alreadyAdded = selectedItems.find((i) => i.productId === product.id);
                              return (
                                <div
                                  key={product.id}
                                  className="p-3 bg-slate-50/70 hover:bg-blue-50/40 rounded-xl border border-slate-200/80 transition-colors flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-bold text-slate-900 truncate">{product.name}</div>
                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                                      <span className="font-mono">{product.productCode || 'No SKU'}</span>
                                      <span>•</span>
                                      <span>{product.brand}</span>
                                      <span>•</span>
                                      <span className="font-semibold text-emerald-600">
                                        {product.quantity} in stock
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="font-mono font-bold text-slate-900 text-xs">
                                      ₹{product.cost?.toFixed(2)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => addProductToTransfer(product)}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                        alreadyAdded
                                          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                          : 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                                      }`}
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>{alreadyAdded ? 'Add More' : 'Add'}</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Selected Transfer Manifest (5 cols) */}
                    <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-20">
                      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-3.5">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                            <Boxes className="w-4 h-4 text-blue-600" />
                            <span>Transfer Manifest</span>
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {selectedItems.length} SKUs
                          </span>
                        </div>

                        {selectedItems.length === 0 ? (
                          <div className="py-12 text-center text-slate-400 text-xs border-2 border-dashed border-slate-200 rounded-xl">
                            <ArrowLeftRight className="w-6 h-6 mx-auto mb-2 opacity-40" />
                            <p>No items added yet</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">Click "Add" on any item from the left catalog</p>
                          </div>
                        ) : (
                          <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                            {selectedItems.map((item) => {
                              const sourceProd = sourceProducts.find((p) => p.id === item.productId);
                              const maxAvailable = sourceProd?.quantity || item.quantity;
                              return (
                                <div
                                  key={item.productId}
                                  className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="font-bold text-slate-900 truncate">{item.productName}</div>
                                      <div className="text-[11px] text-slate-500 font-mono">
                                        {item.productCode} • Max available: {maxAvailable}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeItem(item.productId)}
                                      className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => updateItemQty(item.productId, item.quantity - 1)}
                                        className="w-6 h-6 bg-white border border-slate-300 hover:bg-slate-100 rounded-md font-bold text-xs flex items-center justify-center cursor-pointer"
                                      >
                                        −
                                      </button>
                                      <input
                                        type="number"
                                        min="1"
                                        max={maxAvailable}
                                        value={item.quantity}
                                        onChange={(e) => updateItemQty(item.productId, parseInt(e.target.value) || 1)}
                                        className="w-12 text-center py-0.5 border border-slate-300 rounded-md font-mono font-bold text-xs bg-white"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => updateItemQty(item.productId, item.quantity + 1)}
                                        className="w-6 h-6 bg-white border border-slate-300 hover:bg-slate-100 rounded-md font-bold text-xs flex items-center justify-center cursor-pointer"
                                      >
                                        +
                                      </button>
                                    </div>

                                    <div className="text-right">
                                      <div className="font-mono font-bold text-slate-900">
                                        ₹{((item.cost || 0) * item.quantity).toFixed(2)}
                                      </div>
                                      <div className="text-[10px] text-slate-400">@ ₹{item.cost?.toFixed(2)}/u</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Running Totals Strip */}
                        {selectedItems.length > 0 && (
                          <div className="p-3.5 bg-slate-100/70 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                            <div className="flex justify-between text-slate-600">
                              <span>Total Units:</span>
                              <span className="font-mono font-bold text-slate-900">{totalTransferQty} units</span>
                            </div>
                            <div className="flex justify-between text-slate-600">
                              <span>Gross Cost Valuation:</span>
                              <span className="font-mono font-bold text-blue-700 text-sm">
                                ₹{totalTransferValuation.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setCurrentStep(1)}
                            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                          >
                            ← Back
                          </button>
                          <button
                            type="button"
                            disabled={selectedItems.length === 0}
                            onClick={() => setCurrentStep(3)}
                            className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <span>Proceed to Review ({totalTransferQty} units)</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ================= STEP 3: REVIEW & DISPATCH ================= */}
              {currentStep === 3 && (
                <div className="space-y-6 animate-in fade-in duration-150 w-full">
                  {/* Route & Metrics Summary Card */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Dispatch Order Summary</div>
                        <h3 className="text-base font-bold text-slate-900">Inter-Store Stock Movement</h3>
                      </div>
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 self-start sm:self-auto">
                        Ready for Dispatch
                      </span>
                    </div>

                    {/* From -> To Route Banner */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Origin Location</div>
                        <div className="text-sm font-bold text-slate-900">{getLocationName(fromStoreId)}</div>
                      </div>
                      <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
                        <ArrowRight className="w-5 h-5" />
                      </div>
                      <div className="sm:text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Target Destination</div>
                        <div className="text-sm font-bold text-blue-600">{getLocationName(toStoreId)}</div>
                      </div>
                    </div>

                    {/* 3 Metrics Strip */}
                    <div className="grid grid-cols-3 gap-3 text-center bg-slate-50/70 rounded-xl p-3 border border-slate-100">
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium">Distinct SKUs</div>
                        <div className="font-mono font-bold text-slate-900 text-base">{selectedItems.length}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium">Total Quantity</div>
                        <div className="font-mono font-bold text-emerald-600 text-base">{totalTransferQty} units</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium">Gross Cost Valuation</div>
                        <div className="font-mono font-bold text-blue-700 text-base">₹{totalTransferValuation.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Manifest Review Table */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
                    <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Itemized Transfer Manifest ({selectedItems.length} items)
                      </h3>
                      <button
                        type="button"
                        onClick={() => setCurrentStep(2)}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                      >
                        Edit Items
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase border-b border-slate-200">
                            <th className="py-2.5 px-3 text-center w-10">#</th>
                            <th className="py-2.5 px-4">Item Name</th>
                            <th className="py-2.5 px-3">SKU Code</th>
                            <th className="py-2.5 px-3">Brand / Category</th>
                            <th className="py-2.5 px-3 text-center">Qty</th>
                            <th className="py-2.5 px-4 text-right">Cost/Unit</th>
                            <th className="py-2.5 px-4 text-right">Total Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedItems.map((item, index) => (
                            <tr key={item.productId} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3 text-center font-mono text-slate-400">{index + 1}</td>
                              <td className="py-2.5 px-4 font-bold text-slate-900">{item.productName}</td>
                              <td className="py-2.5 px-3 font-mono text-slate-600">{item.productCode || '—'}</td>
                              <td className="py-2.5 px-3 text-slate-600">{item.brand} • {item.category}</td>
                              <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-900 bg-slate-50/50">
                                {item.quantity}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                                ₹{item.cost?.toFixed(2)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                                ₹{((item.cost || 0) * item.quantity).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                            <td colSpan={4} className="py-3 px-4 text-right text-slate-700">
                              Total Dispatched Quantity & Valuation:
                            </td>
                            <td className="py-3 px-3 text-center font-mono text-emerald-600 text-sm">
                              {totalTransferQty}
                            </td>
                            <td></td>
                            <td className="py-3 px-4 text-right font-mono text-blue-700 text-sm">
                              ₹{totalTransferValuation.toFixed(2)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Notes & Gate Pass Instructions */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                      Dispatch Notes / Waybill / Gate Pass Memo (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Dispatched via vehicle DL-1AB-1234, Driver: Rajesh Kumar, Contact: 9876543210..."
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                    />
                  </div>

                  {/* Step 3 Action Buttons */}
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(2)}
                      className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                    >
                      ← Back to Edit Items
                    </button>

                    <button
                      type="button"
                      disabled={submitting || selectedItems.length === 0}
                      onClick={handleSubmitTransfer}
                      className="flex-1 max-w-sm py-3 px-6 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs hover:shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {submitting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Dispatching Inventory...</span>
                        </>
                      ) : (
                        <>
                          <ArrowLeftRight className="w-4 h-4" />
                          <span>Confirm & Dispatch Transfer ({totalTransferQty} units)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          /* ================= TRANSFER HISTORY VIEW ================= */
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Filter and Search Bar */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-3.5 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex-1 max-w-md relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search transfers by branch, ID, product..."
                  className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
                  {['all', 'completed', 'in-transit'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                        statusFilter === st
                          ? 'bg-white text-blue-700 shadow-2xs font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st === 'all' ? 'All' : st === 'completed' ? 'Completed' : 'In Transit'}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={loadTransfers}
                  title="Refresh transfers"
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>

                <div className="text-xs text-slate-500 font-medium">
                  Showing <strong>{filteredTransfers.length}</strong> transfers
                </div>
              </div>
            </div>

            {/* Transfers Table */}
            {loadingTransfers ? (
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-12 text-center text-slate-500 text-xs">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                Loading transfer records...
              </div>
            ) : filteredTransfers.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-12 text-center text-slate-400 text-xs">
                <ArrowLeftRight className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No stock transfer records found.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase border-b border-slate-200">
                        <th className="py-3 px-4">Transfer Route</th>
                        <th className="py-3 px-3">Date & Operator</th>
                        <th className="py-3 px-3 text-center">SKUs</th>
                        <th className="py-3 px-3 text-center">Units</th>
                        <th className="py-3 px-4 text-right">Valuation</th>
                        <th className="py-3 px-3 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTransfers.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <span>{t.fromStoreName}</span>
                              <ArrowRight className="w-3 h-3 text-blue-600" />
                              <span className="text-blue-700">{t.toStoreName}</span>
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              ID: {t.id}
                            </div>
                          </td>

                          <td className="py-3 px-3">
                            <div className="text-slate-800">
                              {t.createdAt?.toLocaleDateString ? t.createdAt.toLocaleDateString() : '—'}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              By {t.createdByName || 'HQ'}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-center font-mono font-semibold text-slate-700">
                            {t.items?.length || t.totalItems || 0}
                          </td>

                          <td className="py-3 px-3 text-center">
                            <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-mono font-bold text-xs border border-emerald-200">
                              {t.totalQuantity} units
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                            ₹{(t.totalValue || 0).toFixed(2)}
                          </td>

                          <td className="py-3 px-3 text-center">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Check className="w-3 h-3" />
                              {t.status}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedTransferForView(t)}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handlePrintDeliveryChallan({
                                    id: t.id || 'N/A',
                                    fromName: t.fromStoreName,
                                    toName: t.toStoreName,
                                    totalQuantity: t.totalQuantity,
                                    totalValue: t.totalValue,
                                    items: t.items || [],
                                    notes: t.notes,
                                    date: t.createdAt instanceof Date ? t.createdAt : new Date()
                                  })
                                }
                                title="Print Gate Pass Challan"
                                className="p-1 text-slate-400 hover:text-blue-600 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* View Transfer Detail Drawer / Modal */}
        {selectedTransferForView && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
            onClick={() => setSelectedTransferForView(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 w-full max-w-2xl max-h-[85vh] flex flex-col border border-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start pb-3 border-b border-slate-100 mb-4">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">Stock Transfer Details</div>
                  <h3 className="text-base font-bold text-slate-900 font-mono">
                    {selectedTransferForView.id}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTransferForView(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <AlertCircle className="w-0 h-0 hidden" />
                  ✕
                </button>
              </div>

              {/* Route banner */}
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 mb-4 flex justify-between text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px]">From:</span>
                  <strong className="text-slate-900">{selectedTransferForView.fromStoreName}</strong>
                </div>
                <ArrowRight className="w-4 h-4 text-blue-600 self-center" />
                <div className="text-right">
                  <span className="text-slate-400 block text-[10px]">To:</span>
                  <strong className="text-blue-700">{selectedTransferForView.toStoreName}</strong>
                </div>
              </div>

              {/* Items scroll */}
              <div className="flex-1 overflow-y-auto space-y-1.5 mb-4 text-xs pr-1">
                {selectedTransferForView.items?.map((it, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-100 flex justify-between items-center"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{it.productName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {it.productCode} • {it.brand}
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-bold text-slate-900">{it.quantity} units</div>
                      <div className="text-[10px] text-blue-600">₹{((it.cost || 0) * it.quantity).toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Notes */}
              {selectedTransferForView.notes && (
                <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 mb-4">
                  <strong>Notes:</strong> {selectedTransferForView.notes}
                </div>
              )}

              {/* Footer */}
              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedTransferForView(null)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handlePrintDeliveryChallan({
                      id: selectedTransferForView.id || 'N/A',
                      fromName: selectedTransferForView.fromStoreName,
                      toName: selectedTransferForView.toStoreName,
                      totalQuantity: selectedTransferForView.totalQuantity,
                      totalValue: selectedTransferForView.totalValue,
                      items: selectedTransferForView.items || [],
                      notes: selectedTransferForView.notes,
                      date: selectedTransferForView.createdAt instanceof Date ? selectedTransferForView.createdAt : new Date()
                    })
                  }
                  className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Delivery Challan</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default StockTransferPage;
