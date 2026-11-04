import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { collection, getDocs, doc, query, orderBy, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Product, StockTransfer, StockTransferItem } from '../types';
import { syncStoreProducts, updateLocalProductQuantities, upsertLocalProducts } from '../utils/productSyncCache';
import { useInvalidateCache } from '../hooks/useFirestoreCache';

type Step = 'locations' | 'products' | 'review';

/**
 * Returns the correct Firestore collection reference for products at a given location.
 * - Hub warehouse products live at root 'products' collection
 * - Store products live at 'stores/{storeId}/products'
 */
const getProductsColRef = (locationId: string, hubId: string | undefined) => {
  if (locationId === hubId) {
    // Hub warehouse: products are stored at the root 'products' collection
    return collection(db, 'products');
  }
  return collection(db, 'stores', locationId, 'products');
};

/** Returns a single product doc reference at the correct path. */
const getProductDocRefByLocation = (locationId: string, hubId: string | undefined, productId: string) => {
  if (locationId === hubId) {
    return doc(db, 'products', productId);
  }
  return doc(db, 'stores', locationId, 'products', productId);
};

const StockTransferPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentHub, stores } = useStore();
  const { invalidateProducts } = useInvalidateCache();
  const navigate = useNavigate();

  // Step-based wizard
  const [currentStep, setCurrentStep] = useState<Step>('locations');

  // Transfer form state
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [sourceProducts, setSourceProducts] = useState<Product[]>([]);
  const [selectedItems, setSelectedItems] = useState<StockTransferItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [notes, setNotes] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Transfer history
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [expandedTransferId, setExpandedTransferId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    if (currentHub?.id) loadTransfers();
  }, [currentHub?.id, stores.length]);

  useEffect(() => {
    if (fromStoreId && currentHub?.id) loadSourceProducts();
  }, [fromStoreId]);

  const getLocationName = (id: string) => {
    if (id === currentHub?.id) return `${currentHub?.name} (Warehouse)`;
    return stores.find(s => s.id === id)?.name || 'Unknown';
  };

  const loadSourceProducts = async () => {
    if (!fromStoreId) return;
    setLoadingProducts(true);
    try {
      const storeScopeId = fromStoreId === currentHub?.id ? null : fromStoreId;
      const prods = await syncStoreProducts(storeScopeId);

      const validProds = prods.filter(p => (p.quantity || 0) > 0);
      validProds.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));

      setSourceProducts(validProds);
    } catch (err) {
      console.error('Error loading products:', err);
      showToast('Failed to load products', 'error');
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
        createdAt: d.data().createdAt?.toDate() || new Date(),
        completedAt: d.data().completedAt?.toDate(),
      } as StockTransfer));
      allTransfers.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setTransfers(allTransfers);
    } catch {
      // ignore
    } finally {
      setLoadingTransfers(false);
    }
  };

  const addProductToTransfer = (product: Product) => {
    if (selectedItems.find(i => i.productId === product.id)) return;
    setSelectedItems(prev => [...prev, {
      productId: product.id!,
      productCode: product.productCode,
      productName: product.name,
      brand: product.brand,
      category: product.category,
      quantity: 1,
      cost: product.cost,
      mrp: product.mrp,
    }]);
  };

  const updateItemQty = (productId: string, qty: number) => {
    const product = sourceProducts.find(p => p.id === productId);
    const maxQty = product?.quantity || 1;
    setSelectedItems(prev => prev.map(i =>
      i.productId === productId ? { ...i, quantity: Math.max(1, Math.min(qty, maxQty)) } : i
    ));
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
    setShowConfirmDialog(false);
    try {
      const fromStoreName = getLocationName(fromStoreId);
      const toStoreName = getLocationName(toStoreId);

      const totalQuantity = selectedItems.reduce((sum, i) => sum + i.quantity, 0);
      const totalValue = selectedItems.reduce((sum, i) => sum + i.cost * i.quantity, 0);

      // Create transfer record
      const transferData = {
        hubId: currentHub.id,
        fromStoreId,
        fromStoreName,
        toStoreId,
        toStoreName,
        items: selectedItems,
        totalItems: selectedItems.length,
        totalQuantity,
        totalValue,
        status: 'completed',
        notes: notes.trim(),
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || '',
        completedAt: Timestamp.now(),
        completedBy: currentUser?.uid || '',
        completedByName: currentUser?.displayName || currentUser?.email || '',
      };

      // Collect destination product data from local Delta-Sync cache (0 extra N+1 reads)
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

      // Create batch — all writes are atomic (all succeed or all fail)
      const batch = writeBatch(db);
      const nowTs = Timestamp.now();

      // Store the transfer record inside the shared root stockTransfers collection for atomicity
      const transferDocRef = doc(collection(db, 'stockTransfers'));
      batch.set(transferDocRef, transferData);

      const sourceQuantityChanges: Array<{ productId: string; quantityDelta: number }> = [];
      const destQuantityChanges: Array<{ productId: string; quantityDelta: number }> = [];
      const destNewProducts: Array<Partial<Product> & { id: string }> = [];

      for (const item of selectedItems) {
        // Decrease quantity in source (use helper for correct path)
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

        // Handle destination product
        const destData = destProductData.get(item.productId);
        if (destData) {
          // Product exists — increase quantity
          batch.update(destData.ref, {
            quantity: destData.quantity + item.quantity,
            isAvailable: true,
            updatedAt: nowTs,
          });
          destQuantityChanges.push({ productId: destData.id, quantityDelta: item.quantity });
        } else {
          // New product doesn't exist in destination – create it
          const destProductsRef = getProductsColRef(toStoreId, currentHub?.id);

          const newProductRef = doc(destProductsRef);
          const newProductPayload = {
            productCode: item.productCode,
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
            createdByName: currentUser?.displayName || '',
          };
          batch.set(newProductRef, newProductPayload);
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

      // Reset form
      setSelectedItems([]);
      setNotes('');
      setFromStoreId('');
      setToStoreId('');
      setSourceProducts([]);
      setCurrentStep('locations');
      setActiveTab('history');
      loadTransfers();
      showToast(`Transfer completed! ${totalQuantity} items moved to ${toStoreName}`);
    } catch (error) {
      console.error('Error submitting transfer:', error);
      showToast('Failed to complete transfer. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = sourceProducts.filter(p => {
    const q = searchText.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.productCode?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q);
  });

  const filteredTransfers = statusFilter === 'all' ? transfers : transfers.filter(t => t.status === statusFilter);

  const totalItemsCount = selectedItems.reduce((s, i) => s + i.quantity, 0);
  const totalValueCount = selectedItems.reduce((s, i) => s + i.cost * i.quantity, 0);

  const canProceedToProducts = fromStoreId && toStoreId && fromStoreId !== toStoreId;
  const canProceedToReview = selectedItems.length > 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'in-transit': return 'bg-sky-100 text-sky-700 border-sky-200';
      case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    {
      key: 'locations',
      label: 'Select Locations',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    },
    {
      key: 'products',
      label: 'Select Products',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>,
    },
    {
      key: 'review',
      label: 'Review & Confirm',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    },
  ];

  const stepIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="min-h-screen bg-white pb-20 md:pb-0 font-sans">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 mt-16 md:mt-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/hub-dashboard')}
              className="w-9 h-9 bg-white border border-gray-200 rounded-xl flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">Stock Transfer</h1>
              <p className="text-xs text-gray-400">Move inventory between locations</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-6">
          <button onClick={() => setActiveTab('create')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${activeTab === 'create' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Transfer
          </button>
          <button onClick={() => setActiveTab('history')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${activeTab === 'history' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            History ({transfers.length})
          </button>
        </div>

        {activeTab === 'create' ? (
          <div>
            {/* Step Indicator */}
            <div className="flex items-center justify-between mb-6 px-2">
              {steps.map((step, idx) => (
                <React.Fragment key={step.key}>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      idx < stepIndex ? 'bg-emerald-500 text-white' :
                      idx === stepIndex ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' :
                      'bg-gray-200 text-gray-400'
                    }`}>
                      {idx < stepIndex ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        idx + 1
                      )}
                    </div>
                    <span className={`text-xs font-medium hidden sm:inline ${idx === stepIndex ? 'text-blue-600' : idx < stepIndex ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {step.label}
                    </span>
                  </div>
                  {idx < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 md:mx-4 rounded-full transition-colors ${idx < stepIndex ? 'bg-emerald-300' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Step 1: Select Locations */}
            {currentStep === 'locations' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-5 border-b border-gray-100">
                  <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                    {steps[0].icon}
                    Select Source & Destination
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">Choose where to move inventory from and to</p>
                </div>
                <div className="p-5 space-y-5">
                  {/* From Location */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">From Location</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {/* Warehouse option */}
                      <button
                        onClick={() => { setFromStoreId(currentHub?.id || ''); setToStoreId(''); setSelectedItems([]); }}
                        className={`p-3.5 rounded-xl border-2 transition-all text-left flex items-center gap-3 ${
                          fromStoreId === currentHub?.id ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-gray-200 hover:border-blue-300 bg-white'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${fromStoreId === currentHub?.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{currentHub?.name}</p>
                          <p className="text-[10px] text-gray-400">Warehouse</p>
                        </div>
                        {fromStoreId === currentHub?.id && <svg className="w-5 h-5 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </button>
                      {/* Store options */}
                      {stores.map(s => (
                        <button
                          key={s.id}
                          onClick={() => { setFromStoreId(s.id!); setToStoreId(''); setSelectedItems([]); }}
                          className={`p-3.5 rounded-xl border-2 transition-all text-left flex items-center gap-3 ${
                            fromStoreId === s.id ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-gray-200 hover:border-blue-300 bg-white'
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${fromStoreId === s.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                            <p className="text-[10px] text-gray-400">Store</p>
                          </div>
                          {fromStoreId === s.id && <svg className="w-5 h-5 text-blue-500 ml-auto" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Direction Arrow */}
                  {fromStoreId && (
                    <div className="flex justify-center">
                      <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                      </div>
                    </div>
                  )}

                  {/* To Location */}
                  {fromStoreId && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">To Location</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {currentHub?.id !== fromStoreId && (
                          <button
                            onClick={() => setToStoreId(currentHub?.id || '')}
                            className={`p-3.5 rounded-xl border-2 transition-all text-left flex items-center gap-3 ${
                              toStoreId === currentHub?.id ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : 'border-gray-200 hover:border-emerald-300 bg-white'
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${toStoreId === currentHub?.id ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{currentHub?.name}</p>
                              <p className="text-[10px] text-gray-400">Warehouse</p>
                            </div>
                            {toStoreId === currentHub?.id && <svg className="w-5 h-5 text-emerald-500 ml-auto" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                          </button>
                        )}
                        {stores.filter(s => s.id !== fromStoreId).map(s => (
                          <button
                            key={s.id}
                            onClick={() => setToStoreId(s.id!)}
                            className={`p-3.5 rounded-xl border-2 transition-all text-left flex items-center gap-3 ${
                              toStoreId === s.id ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : 'border-gray-200 hover:border-emerald-300 bg-white'
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${toStoreId === s.id ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                              <p className="text-[10px] text-gray-400">Store</p>
                            </div>
                            {toStoreId === s.id && <svg className="w-5 h-5 text-emerald-500 ml-auto" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Next Button */}
                <div className="p-5 border-t border-gray-100 bg-gray-50/50">
                  <button
                    onClick={() => canProceedToProducts && setCurrentStep('products')}
                    disabled={!canProceedToProducts}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    Continue to Select Products
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </button>
                  {fromStoreId && toStoreId && fromStoreId === toStoreId && (
                    <p className="text-xs text-red-500 text-center mt-2">⚠ Source and destination cannot be the same</p>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Select Products */}
            {currentStep === 'products' && (
              <div className="space-y-4">
                {/* Transfer direction banner */}
                <div className="bg-gradient-to-r from-blue-50 to-emerald-50 rounded-xl p-3.5 border border-blue-100 flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
                    <span className="font-semibold text-blue-700 truncate">{getLocationName(fromStoreId)}</span>
                    <svg className="w-5 h-5 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    <span className="font-semibold text-emerald-700 truncate">{getLocationName(toStoreId)}</span>
                  </div>
                  <button onClick={() => setCurrentStep('locations')} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex-shrink-0">
                    Change
                  </button>
                </div>

                {/* Product search & list */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <div className="relative">
                      <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <input
                        type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
                        placeholder="Search by name, code, or brand..."
                        className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm transition-colors"
                      />
                    </div>
                  </div>
                  {loadingProducts ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                      {filteredProducts.length === 0 ? (
                        <div className="text-center py-8">
                          <svg className="w-10 h-10 text-gray-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                          <p className="text-sm text-gray-400">No products with stock found</p>
                        </div>
                      ) : (
                        filteredProducts.map(product => {
                          const isSelected = selectedItems.some(i => i.productId === product.id);
                          return (
                            <div
                              key={product.id}
                              className={`flex items-center justify-between p-3.5 transition-all cursor-pointer ${isSelected ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}
                              onClick={() => !isSelected && addProductToTransfer(product)}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">{product.name}</p>
                                <p className="text-[11px] text-gray-400">{product.brand} • {product.productCode} • Stock: <span className="font-semibold text-gray-600">{product.quantity}</span></p>
                              </div>
                              {isSelected ? (
                                <span className="text-[10px] bg-blue-600 text-white px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ml-2">✓ Added</span>
                              ) : (
                                <button className="text-xs text-blue-600 font-semibold flex-shrink-0 ml-2 px-2 py-1 hover:bg-blue-100 rounded-lg transition-colors">+ Add</button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Selected items summary */}
                {selectedItems.length > 0 && (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-800">Selected ({selectedItems.length})</h3>
                      <button onClick={() => setSelectedItems([])} className="text-[10px] text-red-500 hover:text-red-600 font-medium">Clear All</button>
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                      {selectedItems.map(item => (
                        <div key={item.productId} className="flex items-center justify-between p-3.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{item.productName}</p>
                            <p className="text-[10px] text-gray-400">{item.brand} • ₹{item.cost}/unit</p>
                          </div>
                          <div className="flex items-center gap-2.5 flex-shrink-0 ml-2">
                            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                              <button onClick={() => updateItemQty(item.productId, item.quantity - 1)}
                                className="w-7 h-7 bg-white rounded-md flex items-center justify-center hover:bg-gray-50 text-gray-600 text-sm font-bold shadow-sm">−</button>
                              <input type="number" value={item.quantity} onChange={e => updateItemQty(item.productId, parseInt(e.target.value) || 1)}
                                className="w-10 text-center bg-transparent text-sm font-semibold" min={1} />
                              <button onClick={() => updateItemQty(item.productId, item.quantity + 1)}
                                className="w-7 h-7 bg-white rounded-md flex items-center justify-center hover:bg-gray-50 text-gray-600 text-sm font-bold shadow-sm">+</button>
                            </div>
                            <button onClick={() => removeItem(item.productId)} className="text-red-400 hover:text-red-600 p-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Navigation */}
                <div className="flex gap-3">
                  <button onClick={() => setCurrentStep('locations')}
                    className="px-5 py-3 bg-white text-gray-700 rounded-xl font-medium border border-gray-200 hover:bg-gray-50 transition-all">
                    ← Back
                  </button>
                  <button
                    onClick={() => canProceedToReview && setCurrentStep('review')}
                    disabled={!canProceedToReview}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    Review Transfer ({totalItemsCount} items)
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Review & Confirm */}
            {currentStep === 'review' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-5 border-b border-gray-100">
                    <h2 className="text-base font-bold text-gray-800">Review Transfer</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Please review the details before confirming</p>
                  </div>

                  {/* Transfer direction */}
                  <div className="p-5 bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 border-b border-gray-100">
                    <div className="flex items-center gap-3 justify-center">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center mx-auto mb-1.5 shadow-lg shadow-blue-200">
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {fromStoreId === currentHub?.id
                              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />}
                          </svg>
                        </div>
                        <p className="text-xs font-semibold text-gray-700">{getLocationName(fromStoreId)}</p>
                        <p className="text-[10px] text-gray-400">Source</p>
                      </div>
                      <div className="flex items-center gap-1 px-4">
                        <div className="w-8 h-px bg-gray-300" />
                        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                          <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                        </div>
                        <div className="w-8 h-px bg-gray-300" />
                      </div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center mx-auto mb-1.5 shadow-lg shadow-emerald-200">
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {toStoreId === currentHub?.id
                              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />}
                          </svg>
                        </div>
                        <p className="text-xs font-semibold text-gray-700">{getLocationName(toStoreId)}</p>
                        <p className="text-[10px] text-gray-400">Destination</p>
                      </div>
                    </div>
                  </div>

                  {/* Items list */}
                  <div className="divide-y divide-gray-50">
                    {selectedItems.map((item, idx) => (
                      <div key={item.productId} className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-500">{idx + 1}</span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{item.productName}</p>
                            <p className="text-[10px] text-gray-400">{item.brand} • {item.productCode}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-800">×{item.quantity}</p>
                          <p className="text-[10px] text-gray-400">₹{(item.cost * item.quantity).toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Notes */}
                  <div className="p-5 border-t border-gray-100 bg-gray-50/50">
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Transfer Notes (optional)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes about this transfer..."
                      className="w-full px-3.5 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm resize-none transition-colors" rows={2} />
                  </div>

                  {/* Summary */}
                  <div className="p-5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-blue-100">Transfer Summary</p>
                        <p className="text-xl font-bold">{totalItemsCount} items • ₹{totalValueCount.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button onClick={() => setCurrentStep('products')}
                    className="px-5 py-3 bg-white text-gray-700 rounded-xl font-medium border border-gray-200 hover:bg-gray-50 transition-all">
                    ← Back
                  </button>
                  <button
                    onClick={() => setShowConfirmDialog(true)}
                    disabled={submitting}
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                  >
                    {submitting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Confirm Transfer
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Transfer History */
          <div>
            {/* Status filter */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {['all', 'completed', 'pending', 'in-transit', 'cancelled'].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all whitespace-nowrap ${
                    statusFilter === s ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200 hover:border-blue-300'
                  }`}>
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                  {s === 'all' && ` (${transfers.length})`}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {loadingTransfers ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : filteredTransfers.length === 0 ? (
                <div className="text-center py-16">
                  <svg className="w-14 h-14 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <p className="text-gray-400 text-sm">No transfers found</p>
                  <button onClick={() => { setActiveTab('create'); setCurrentStep('locations'); }}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-2">
                    Create your first transfer →
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filteredTransfers.map(transfer => (
                    <div
                      key={transfer.id}
                      className="p-4 hover:bg-gray-50/50 transition-colors cursor-pointer"
                      onClick={() => setExpandedTransferId(expandedTransferId === transfer.id ? null : transfer.id!)}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-sm font-semibold text-gray-800 truncate">{transfer.fromStoreName}</span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <div className="w-4 h-px bg-gray-300" />
                            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                            <div className="w-4 h-px bg-gray-300" />
                          </div>
                          <span className="text-sm font-semibold text-gray-800 truncate">{transfer.toStoreName}</span>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ml-2 flex-shrink-0 ${getStatusColor(transfer.status)}`}>
                          {transfer.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400">
                        <span>{transfer.totalQuantity} items</span>
                        <span>•</span>
                        <span>₹{transfer.totalValue?.toLocaleString('en-IN')}</span>
                        <span>•</span>
                        <span>{transfer.createdAt instanceof Date ? transfer.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
                        {transfer.createdByName && <><span>•</span><span>{transfer.createdByName}</span></>}
                      </div>
                      {/* Expanded details */}
                      {expandedTransferId === transfer.id && transfer.items && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="space-y-1.5">
                            {transfer.items.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg">
                                <div>
                                  <span className="text-xs font-medium text-gray-700">{item.productName}</span>
                                  <span className="text-[10px] text-gray-400 ml-2">{item.brand}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-xs font-semibold text-gray-800">×{item.quantity}</span>
                                  <span className="text-[10px] text-gray-400 ml-2">₹{(item.cost * item.quantity).toLocaleString('en-IN')}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {transfer.notes && <p className="text-xs text-gray-400 mt-2 italic">📝 {transfer.notes}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] p-4" onClick={() => setShowConfirmDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">Confirm Transfer</h3>
              <p className="text-sm text-gray-500 mb-4">
                Transfer <strong>{totalItemsCount} items</strong> worth <strong>₹{totalValueCount.toLocaleString('en-IN')}</strong> from <strong>{getLocationName(fromStoreId)}</strong> to <strong>{getLocationName(toStoreId)}</strong>?
              </p>
              <p className="text-xs text-gray-400">This action cannot be undone</p>
            </div>
            <div className="flex border-t border-gray-100">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 py-3.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors border-r border-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitTransfer}
                disabled={submitting}
                className="flex-1 py-3.5 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                {submitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium max-w-sm transition-all animate-in fade-in slide-in-from-bottom-2 ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default StockTransferPage;
