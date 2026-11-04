import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp,
  increment,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import { upsertLocalProducts } from '../utils/productSyncCache';
import type { StockTransfer, StockTransferItem } from '../types';
import {
  PackageCheck,
  Package,
  CheckCircle2,
  Clock,
  Search,
  RefreshCw,
  Building2,
  ArrowDownToLine,
  Check,
} from 'lucide-react';

const StockReceived: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentStore, currentHub } = useStore();
  const { showToast } = useToast();

  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'received'>('all');

  useEffect(() => {
    if (currentStore?.id) {
      loadIncomingHqStock();
    } else {
      setLoading(false);
    }
  }, [currentStore?.id]);

  const loadIncomingHqStock = async () => {
    if (!currentStore?.id) return;
    try {
      setLoading(true);
      const q = query(
        collection(db, 'stockTransfers'),
        where('toStoreId', '==', currentStore.id)
      );
      const snapshot = await getDocs(q);

      const list: StockTransfer[] = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            ...data,
            createdAt: data.createdAt?.toDate() || new Date(),
            completedAt: data.completedAt?.toDate(),
            pickedAt: data.pickedAt?.toDate(),
            receivedAt: data.receivedAt?.toDate(),
          } as StockTransfer;
        })
        // Filter to dispatches coming from HQ (not branch-to-branch)
        .filter((t) => {
          if (t.transferType === 'branch_to_branch') return false;
          if (t.transferType === 'hq_to_branch') return true;
          return (
            t.fromStoreId === currentHub?.id ||
            t.fromStoreId === 'hub_warehouse' ||
            t.fromStoreId === 'digital_zone_hq' ||
            (t.fromStoreName || '').toLowerCase().includes('hq') ||
            (t.fromStoreName || '').toLowerCase().includes('warehouse') ||
            (t.fromStoreName || '').toLowerCase().includes('central')
          );
        });

      list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setTransfers(list);
    } catch (error) {
      console.error('Error loading HQ stock dispatches:', error);
      showToast('Failed to load incoming HQ stock', 'error');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Check & receive a single product from an HQ dispatch.
   * If stock was not yet added to the branch (status !== 'completed'),
   * it adds the product quantity to stores/{branchId}/products and increments totalStockUnits.
   */
  const handleReceiveSingleItem = async (transfer: StockTransfer, itemIndex: number) => {
    if (!currentStore?.id || !currentUser) return;
    const targetItem = transfer.items[itemIndex];
    if (!targetItem || targetItem.received) return;

    const actionKey = `${transfer.id}-${itemIndex}`;
    try {
      setProcessingKey(actionKey);
      const batch = writeBatch(db);
      const now = Timestamp.now();

      // Determine whether HQ already credited stock during legacy instant transfer
      const stockAlreadyCreditedByHq = transfer.status === 'completed' && !transfer.transferType;

      let updatedLocalProduct: any = null;

      if (!stockAlreadyCreditedByHq) {
        const destProductsRef = collection(db, 'stores', currentStore.id, 'products');
        const destQuery = query(destProductsRef, where('productCode', '==', targetItem.productCode));
        const destSnap = await getDocs(destQuery);

        if (!destSnap.empty) {
          const existingDoc = destSnap.docs[0];
          const existingData = existingDoc.data();
          const newQty = (Number(existingData.quantity) || 0) + Number(targetItem.quantity);
          batch.update(existingDoc.ref, {
            quantity: newQty,
            isAvailable: newQty > 0,
            updatedAt: now,
          });
          updatedLocalProduct = {
            id: existingDoc.id,
            ...existingData,
            quantity: newQty,
            isAvailable: newQty > 0,
            updatedAt: new Date(),
          };
        } else {
          // Fetch full product details from HQ root catalog if available
          let sourceData: Record<string, any> = {};
          if (targetItem.productId) {
            const rootProdSnap = await getDoc(doc(db, 'products', targetItem.productId));
            if (rootProdSnap.exists()) {
              sourceData = rootProdSnap.data();
            }
          }

          const newProdRef = doc(destProductsRef);
          const newProdPayload = {
            ...sourceData,
            name: targetItem.productName || sourceData.name || '',
            productCode: targetItem.productCode || sourceData.productCode || '',
            brand: targetItem.brand || sourceData.brand || '',
            category: targetItem.category || sourceData.category || '',
            cost: targetItem.cost ?? sourceData.cost ?? 0,
            mrp: targetItem.mrp ?? sourceData.mrp ?? 0,
            mop: sourceData.mop ?? targetItem.mrp ?? 0,
            quantity: Number(targetItem.quantity) || 0,
            isAvailable: (Number(targetItem.quantity) || 0) > 0,
            storeId: currentStore.id,
            hubId: currentStore.hubId || currentHub?.id || '',
            createdAt: now,
            updatedAt: now,
            createdBy: currentUser.uid,
            createdByName: currentUser.displayName || currentUser.email || 'Branch Receiver',
          };
          batch.set(newProdRef, newProdPayload);
          updatedLocalProduct = {
            id: newProdRef.id,
            ...newProdPayload,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }

        // Increment branch totalStockUnits counter
        batch.update(doc(db, 'stores', currentStore.id), {
          totalStockUnits: increment(Number(targetItem.quantity) || 0),
          updatedAt: now,
        });
      }

      const updatedItems: StockTransferItem[] = transfer.items.map((it, idx) =>
        idx === itemIndex
          ? {
              ...it,
              received: true,
              receivedAt: now.toDate(),
              receivedBy: currentUser.uid,
              receivedByName: currentUser.displayName || currentUser.email || 'Staff',
            }
          : it
      );

      const allReceived = updatedItems.every((it) => it.received === true);
      const transferRef = doc(db, 'stockTransfers', transfer.id!);

      batch.update(transferRef, {
        items: updatedItems.map((it) => ({
          ...it,
          receivedAt: it.receivedAt ? Timestamp.fromDate(new Date(it.receivedAt)) : null,
        })),
        ...(allReceived
          ? {
              status: 'received',
              receivedAt: now,
              receivedBy: currentUser.uid,
              receivedByName: currentUser.displayName || currentUser.email || 'Staff',
              completedAt: now,
            }
          : {}),
      });

      await batch.commit();

      if (updatedLocalProduct) {
        await upsertLocalProducts(currentStore.id, [updatedLocalProduct]);
      }

      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transfer.id
            ? {
                ...t,
                items: updatedItems,
                status: allReceived ? 'received' : t.status,
                receivedAt: allReceived ? new Date() : t.receivedAt,
              }
            : t
        )
      );

      showToast(
        `Verified & received ${targetItem.quantity}x ${targetItem.productName}`,
        'success'
      );
    } catch (error) {
      console.error('Error receiving single item:', error);
      showToast('Failed to receive product. Please try again.', 'error');
    } finally {
      setProcessingKey(null);
    }
  };

  /**
   * Receive all remaining unreceived products in a dispatch.
   */
  const handleReceiveAllRemaining = async (transfer: StockTransfer) => {
    const pendingIndices = transfer.items
      .map((it, idx) => (!it.received ? idx : -1))
      .filter((idx) => idx !== -1);

    for (const idx of pendingIndices) {
      // Re-find latest transfer state
      const currentTransfer = transfers.find((t) => t.id === transfer.id) || transfer;
      await handleReceiveSingleItem(currentTransfer, idx);
    }
  };

  const isTransferFullyReceived = (t: StockTransfer) =>
    t.status === 'received' || (t.items.length > 0 && t.items.every((i) => i.received));

  const filteredTransfers = useMemo(() => {
    return transfers.filter((t) => {
      const fullyReceived = isTransferFullyReceived(t);
      if (statusFilter === 'pending' && fullyReceived) return false;
      if (statusFilter === 'received' && !fullyReceived) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        (t.id || '').toLowerCase().includes(q) ||
        t.items.some(
          (it) =>
            it.productName.toLowerCase().includes(q) ||
            it.productCode.toLowerCase().includes(q)
        )
      );
    });
  }, [transfers, statusFilter, searchQuery]);

  const summary = useMemo(() => {
    let totalDispatches = transfers.length;
    let pendingProducts = 0;
    let receivedProducts = 0;

    transfers.forEach((t) => {
      t.items.forEach((it) => {
        if (it.received) {
          receivedProducts += 1;
        } else {
          pendingProducts += 1;
        }
      });
    });

    return { totalDispatches, pendingProducts, receivedProducts };
  }, [transfers]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <ArrowDownToLine className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900">
                  Stock Received from HQ
                </h1>
                <p className="text-xs sm:text-sm text-slate-500">
                  Verify and receive each single product dispatched from Head Office to{' '}
                  <span className="font-semibold text-slate-700">
                    {currentStore?.name || 'this branch'}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={loadIncomingHqStock}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-5">
          <div className="bg-white rounded-xl p-3.5 sm:p-4 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] sm:text-xs font-medium text-slate-500">
                HQ Dispatches
              </span>
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-lg sm:text-2xl font-bold text-slate-900 tabular-nums">
              {summary.totalDispatches}
            </p>
          </div>

          <div className="bg-white rounded-xl p-3.5 sm:p-4 border border-amber-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] sm:text-xs font-medium text-amber-700">
                Pending Check
              </span>
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-lg sm:text-2xl font-bold text-amber-600 tabular-nums">
              {summary.pendingProducts}
            </p>
          </div>

          <div className="bg-white rounded-xl p-3.5 sm:p-4 border border-emerald-200/80 shadow-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] sm:text-xs font-medium text-emerald-700">
                Verified & Received
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-lg sm:text-2xl font-bold text-emerald-600 tabular-nums">
              {summary.receivedProducts}
            </p>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-3 sm:p-4 mb-5 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by product name, product code, or dispatch ID..."
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
            {(['all', 'pending', 'received'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer ${
                  statusFilter === tab
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'pending' ? 'Pending Check' : 'Received'}
              </button>
            ))}
          </div>
        </div>

        {/* Dispatches List */}
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 text-sm">
            Loading incoming HQ stock dispatches...
          </div>
        ) : filteredTransfers.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <PackageCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-800">No HQ Stock Dispatches Found</h3>
            <p className="text-xs text-slate-500 mt-1">
              When Head Office dispatches stock to this branch, each product will appear here for single-item verification.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTransfers.map((transfer) => {
              const receivedCount = transfer.items.filter((i) => i.received).length;
              const totalCount = transfer.items.length;
              const allDone = receivedCount === totalCount && totalCount > 0;

              return (
                <div
                  key={transfer.id}
                  className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden"
                >
                  {/* Dispatch Card Header */}
                  <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          allDone
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {allDone ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" /> All Products Received
                          </>
                        ) : (
                          <>
                            <Clock className="w-3.5 h-3.5" /> {receivedCount}/{totalCount} Checked
                          </>
                        )}
                      </span>
                      <span className="text-xs font-medium text-slate-700">
                        From: <strong className="text-slate-900">{transfer.fromStoreName || 'HQ Central Warehouse'}</strong>
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500">
                        {transfer.createdAt.toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {!allDone && totalCount > 1 && (
                      <button
                        onClick={() => handleReceiveAllRemaining(transfer)}
                        disabled={processingKey !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Receive All Remaining ({totalCount - receivedCount})
                      </button>
                    )}
                  </div>

                  {/* Single Product Checklist Table */}
                  <div className="divide-y divide-slate-100">
                    {transfer.items.map((item, idx) => {
                      const isItemReceived = Boolean(item.received);
                      const isProcessing = processingKey === `${transfer.id}-${idx}`;

                      return (
                        <div
                          key={`${transfer.id}-${item.productCode}-${idx}`}
                          className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                            isItemReceived ? 'bg-emerald-50/20' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                isItemReceived
                                  ? 'bg-emerald-100 text-emerald-600'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {isItemReceived ? (
                                <Check className="w-4 h-4" />
                              ) : (
                                <Package className="w-4 h-4" />
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs sm:text-sm font-semibold text-slate-900">
                                  {item.productName}
                                </p>
                                <span className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 text-slate-700 rounded border border-slate-200">
                                  {item.productCode}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                                {(item.brand || item.category) && (
                                  <span>
                                    {[item.brand, item.category].filter(Boolean).join(' • ')}
                                  </span>
                                )}
                                {item.mrp !== undefined && item.mrp > 0 && (
                                  <span className="tabular-nums">
                                    MRP: ₹{Number(item.mrp).toLocaleString('en-IN')}
                                  </span>
                                )}
                                {isItemReceived && item.receivedByName && (
                                  <span className="text-emerald-600 font-medium">
                                    Checked by {item.receivedByName}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0">
                            <div className="text-left sm:text-right">
                              <span className="text-[11px] text-slate-400 block">Qty Sent</span>
                              <span className="text-sm font-bold text-slate-900 tabular-nums">
                                {item.quantity} {item.quantity === 1 ? 'unit' : 'units'}
                              </span>
                            </div>

                            {isItemReceived ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Received
                              </span>
                            ) : (
                              <button
                                onClick={() => handleReceiveSingleItem(transfer, idx)}
                                disabled={isProcessing || processingKey !== null}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50 shadow-xs"
                              >
                                <PackageCheck className="w-4 h-4" />
                                {isProcessing ? 'Receiving...' : 'Check & Receive'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {transfer.notes && (
                    <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">HQ Note:</span> {transfer.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default StockReceived;
