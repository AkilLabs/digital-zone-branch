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
import { updateLocalProductQuantities, upsertLocalProducts } from '../utils/productSyncCache';
import type { StockTransfer } from '../types';
import {
  ArrowLeftRight,
  Package,
  CheckCircle2,
  Clock,
  Truck,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
} from 'lucide-react';

const BranchStockTransfer: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentStore, currentHub } = useStore();
  const { showToast } = useToast();

  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [directionTab, setDirectionTab] = useState<'all' | 'outgoing' | 'incoming'>('all');

  useEffect(() => {
    if (currentStore?.id) {
      loadBranchTransfers();
    } else {
      setLoading(false);
    }
  }, [currentStore?.id]);

  const loadBranchTransfers = async () => {
    if (!currentStore?.id) return;
    try {
      setLoading(true);
      const outQuery = query(
        collection(db, 'stockTransfers'),
        where('fromStoreId', '==', currentStore.id)
      );
      const inQuery = query(
        collection(db, 'stockTransfers'),
        where('toStoreId', '==', currentStore.id)
      );

      const [outSnap, inSnap] = await Promise.all([getDocs(outQuery), getDocs(inQuery)]);
      const map = new Map<string, StockTransfer>();

      [...outSnap.docs, ...inSnap.docs].forEach((docSnap) => {
        const data = docSnap.data();
        const record: StockTransfer = {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          completedAt: data.completedAt?.toDate(),
          pickedAt: data.pickedAt?.toDate(),
          receivedAt: data.receivedAt?.toDate(),
        } as StockTransfer;

        // Include branch-to-branch transfers (or any transfer where source is a branch)
        const isHqSource =
          record.transferType === 'hq_to_branch' ||
          record.fromStoreId === currentHub?.id ||
          record.fromStoreId === 'hub_warehouse' ||
          record.fromStoreId === 'digital_zone_hq';

        if (!isHqSource || record.transferType === 'branch_to_branch') {
          map.set(record.id || docSnap.id, record);
        }
      });

      const list = Array.from(map.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      setTransfers(list);
    } catch (error) {
      console.error('Error loading branch stock transfers:', error);
      showToast('Failed to load branch stock transfers', 'error');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 2 of Flow: Source branch marks an HQ-triggered transfer as "Picked".
   * Deducts stock from source branch (stores/{fromStoreId}/products) and transitions status: 'triggered' -> 'picked'.
   */
  const handleMarkPicked = async (transfer: StockTransfer) => {
    if (!currentStore?.id || !currentUser) return;
    if (transfer.fromStoreId !== currentStore.id) {
      showToast('Only the source branch can mark this transfer as Picked.', 'error');
      return;
    }

    try {
      setProcessingId(transfer.id || null);
      const batch = writeBatch(db);
      const now = Timestamp.now();
      const sourceProductsRef = collection(db, 'stores', currentStore.id, 'products');
      const localQtyDeltas: { productId: string; quantityDelta: number }[] = [];

      let totalUnitsPicked = 0;

      for (const item of transfer.items) {
        const qty = Number(item.quantity) || 0;
        totalUnitsPicked += qty;

        // Locate product in source branch by productId or productCode
        let sourceDocSnap = null;
        if (item.productId) {
          const directSnap = await getDoc(doc(sourceProductsRef, item.productId));
          if (directSnap.exists()) {
            sourceDocSnap = directSnap;
          }
        }
        if (!sourceDocSnap && item.productCode) {
          const codeQuery = query(sourceProductsRef, where('productCode', '==', item.productCode));
          const codeSnap = await getDocs(codeQuery);
          if (!codeSnap.empty) {
            sourceDocSnap = codeSnap.docs[0];
          }
        }

        if (!sourceDocSnap) {
          showToast(`Product "${item.productName}" not found in branch inventory.`, 'error');
          setProcessingId(null);
          return;
        }

        const currentQty = Number(sourceDocSnap.data().quantity) || 0;
        if (currentQty < qty) {
          showToast(
            `Insufficient stock for "${item.productName}" (Available: ${currentQty}, Needed: ${qty})`,
            'error'
          );
          setProcessingId(null);
          return;
        }

        const nextQty = currentQty - qty;
        batch.update(sourceDocSnap.ref, {
          quantity: nextQty,
          isAvailable: nextQty > 0,
          updatedAt: now,
        });
        localQtyDeltas.push({ productId: sourceDocSnap.id, quantityDelta: -qty });
      }

      batch.update(doc(db, 'stores', currentStore.id), {
        totalStockUnits: increment(-totalUnitsPicked),
        updatedAt: now,
      });

      const updatedItems = transfer.items.map((it) => ({
        ...it,
        picked: true,
        pickedAt: now,
      }));

      batch.update(doc(db, 'stockTransfers', transfer.id!), {
        status: 'picked',
        items: updatedItems,
        pickedAt: now,
        pickedBy: currentUser.uid,
        pickedByName: currentUser.displayName || currentUser.email || 'Source Branch',
      });

      await batch.commit();
      await updateLocalProductQuantities(currentStore.id, localQtyDeltas);

      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transfer.id
            ? {
                ...t,
                status: 'picked',
                pickedAt: new Date(),
                pickedByName: currentUser.displayName || currentUser.email || 'Source Branch',
              }
            : t
        )
      );

      showToast('Stock marked as Picked and ready for receiving branch!', 'success');
    } catch (error) {
      console.error('Error marking transfer as picked:', error);
      showToast('Failed to mark transfer as picked', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  /**
   * Step 3 of Flow: Destination branch marks a "Picked" transfer as "Received".
   * Adds stock to destination branch (stores/{toStoreId}/products) and transitions status: 'picked' -> 'received'.
   */
  const handleMarkReceived = async (transfer: StockTransfer) => {
    if (!currentStore?.id || !currentUser) return;
    if (transfer.toStoreId !== currentStore.id) {
      showToast('Only the destination branch can receive this transfer.', 'error');
      return;
    }

    try {
      setProcessingId(transfer.id || null);
      const batch = writeBatch(db);
      const now = Timestamp.now();
      const destProductsRef = collection(db, 'stores', currentStore.id, 'products');
      const upsertedProducts: any[] = [];
      let totalUnitsReceived = 0;

      for (const item of transfer.items) {
        const qty = Number(item.quantity) || 0;
        totalUnitsReceived += qty;

        const destQuery = query(destProductsRef, where('productCode', '==', item.productCode));
        const destSnap = await getDocs(destQuery);

        if (!destSnap.empty) {
          const existingDoc = destSnap.docs[0];
          const existingData = existingDoc.data();
          const nextQty = (Number(existingData.quantity) || 0) + qty;
          batch.update(existingDoc.ref, {
            quantity: nextQty,
            isAvailable: nextQty > 0,
            updatedAt: now,
          });
          upsertedProducts.push({
            id: existingDoc.id,
            ...existingData,
            quantity: nextQty,
            isAvailable: nextQty > 0,
            updatedAt: new Date(),
          });
        } else {
          // Read source branch product doc if available for metadata
          let sourceMeta: Record<string, any> = {};
          if (item.productId && transfer.fromStoreId) {
            const srcProdSnap = await getDoc(
              doc(db, 'stores', transfer.fromStoreId, 'products', item.productId)
            );
            if (srcProdSnap.exists()) {
              sourceMeta = srcProdSnap.data();
            }
          }

          const newDocRef = doc(destProductsRef);
          const payload = {
            ...sourceMeta,
            name: item.productName || sourceMeta.name || '',
            productCode: item.productCode || sourceMeta.productCode || '',
            brand: item.brand || sourceMeta.brand || '',
            category: item.category || sourceMeta.category || '',
            cost: item.cost ?? sourceMeta.cost ?? 0,
            mrp: item.mrp ?? sourceMeta.mrp ?? 0,
            mop: sourceMeta.mop ?? item.mrp ?? 0,
            quantity: qty,
            isAvailable: qty > 0,
            storeId: currentStore.id,
            hubId: currentStore.hubId || currentHub?.id || '',
            createdAt: now,
            updatedAt: now,
            createdBy: currentUser.uid,
            createdByName: currentUser.displayName || currentUser.email || 'Receiving Branch',
          };
          batch.set(newDocRef, payload);
          upsertedProducts.push({
            id: newDocRef.id,
            ...payload,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      batch.update(doc(db, 'stores', currentStore.id), {
        totalStockUnits: increment(totalUnitsReceived),
        updatedAt: now,
      });

      const updatedItems = transfer.items.map((it) => ({
        ...it,
        received: true,
        receivedAt: now,
        receivedBy: currentUser.uid,
        receivedByName: currentUser.displayName || currentUser.email || 'Receiving Branch',
      }));

      batch.update(doc(db, 'stockTransfers', transfer.id!), {
        status: 'received',
        items: updatedItems,
        receivedAt: now,
        receivedBy: currentUser.uid,
        receivedByName: currentUser.displayName || currentUser.email || 'Receiving Branch',
        completedAt: now,
      });

      await batch.commit();
      await upsertLocalProducts(currentStore.id, upsertedProducts);

      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transfer.id
            ? {
                ...t,
                status: 'received',
                receivedAt: new Date(),
                receivedByName: currentUser.displayName || currentUser.email || 'Receiving Branch',
              }
            : t
        )
      );

      showToast('Stock received into branch inventory!', 'success');
    } catch (error) {
      console.error('Error receiving transfer:', error);
      showToast('Failed to receive stock transfer', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const getStepIndex = (status: string): number => {
    if (status === 'received' || status === 'completed') return 3;
    if (status === 'picked' || status === 'in_transit') return 2;
    return 1; // 'triggered' | 'pending'
  };

  const filteredTransfers = useMemo(() => {
    return transfers.filter((t) => {
      if (directionTab === 'outgoing') return t.fromStoreId === currentStore?.id;
      if (directionTab === 'incoming') return t.toStoreId === currentStore?.id;
      return true;
    });
  }, [transfers, directionTab, currentStore?.id]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900">
                Branch Stock Transfers
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                HQ-triggered inter-branch transfers follow{' '}
                <span className="font-semibold text-slate-700">
                  Triggered → Picked → Received
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={loadBranchTransfers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Direction Tabs */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-2 mb-5 inline-flex gap-1">
          {[
            { id: 'all', label: 'All Transfers' },
            { id: 'outgoing', label: 'Outgoing (Pick & Send)' },
            { id: 'incoming', label: 'Incoming (Receive)' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDirectionTab(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                directionTab === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Transfer Cards */}
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 text-sm">
            Loading branch stock transfers...
          </div>
        ) : filteredTransfers.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <ArrowLeftRight className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-800">No Branch Stock Transfers</h3>
            <p className="text-xs text-slate-500 mt-1">
              When HQ triggers a stock transfer between this branch and another branch, it will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTransfers.map((transfer) => {
              const isOutgoing = transfer.fromStoreId === currentStore?.id;
              const step = getStepIndex(transfer.status);
              const isProcessing = processingId === transfer.id;

              return (
                <div
                  key={transfer.id}
                  className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden"
                >
                  {/* Top Bar */}
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isOutgoing
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {isOutgoing ? (
                          <>
                            <ArrowUpRight className="w-3.5 h-3.5" /> Outgoing from this Branch
                          </>
                        ) : (
                          <>
                            <ArrowDownLeft className="w-3.5 h-3.5" /> Incoming to this Branch
                          </>
                        )}
                      </span>

                      <span className="text-xs sm:text-sm font-semibold text-slate-800">
                        {transfer.fromStoreName} → {transfer.toStoreName}
                      </span>
                    </div>

                    <span className="text-xs text-slate-500">
                      Triggered:{' '}
                      {transfer.createdAt.toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* 3-Step Visual Pipeline: Triggered -> Picked -> Received */}
                  <div className="px-4 py-3.5 bg-white border-b border-slate-100">
                    <div className="grid grid-cols-3 gap-2 max-w-xl">
                      {/* Step 1: Triggered */}
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            step >= 1
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          1
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-900">Triggered</p>
                          <p className="text-[10px] text-slate-500">By HQ</p>
                        </div>
                      </div>

                      {/* Step 2: Picked */}
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            step >= 2
                              ? 'bg-amber-500 text-white'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          2
                        </div>
                        <div>
                          <p
                            className={`text-xs font-semibold ${
                              step >= 2 ? 'text-slate-900' : 'text-slate-400'
                            }`}
                          >
                            Picked
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {transfer.pickedByName || transfer.fromStoreName}
                          </p>
                        </div>
                      </div>

                      {/* Step 3: Received */}
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            step >= 3
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          3
                        </div>
                        <div>
                          <p
                            className={`text-xs font-semibold ${
                              step >= 3 ? 'text-slate-900' : 'text-slate-400'
                            }`}
                          >
                            Received
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {transfer.receivedByName || transfer.toStoreName}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="p-4">
                    <div className="space-y-2 mb-4">
                      {transfer.items.map((item, idx) => (
                        <div
                          key={`${transfer.id}-${item.productCode}-${idx}`}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Package className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">
                                {item.productName}
                              </p>
                              <p className="text-[11px] text-slate-500 font-mono">
                                Code: {item.productCode}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                            {item.quantity} {item.quantity === 1 ? 'unit' : 'units'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Action Footer depending on stage & branch role */}
                    <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-100">
                      <div className="text-xs text-slate-500">
                        {step === 1 && isOutgoing && (
                          <span className="text-amber-700 font-medium">
                            Action Required: Pick these products from your branch shelf to dispatch to{' '}
                            {transfer.toStoreName}.
                          </span>
                        )}
                        {step === 1 && !isOutgoing && (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <Clock className="w-3.5 h-3.5 text-amber-500" />
                            Waiting for <strong>{transfer.fromStoreName}</strong> to pick and dispatch.
                          </span>
                        )}
                        {step === 2 && isOutgoing && (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <Truck className="w-3.5 h-3.5" />
                            Picked & Dispatched — waiting for <strong>{transfer.toStoreName}</strong> to receive.
                          </span>
                        )}
                        {step === 2 && !isOutgoing && (
                          <span className="text-blue-700 font-medium">
                            Action Required: Products have been picked by {transfer.fromStoreName}. Verify and mark as Received.
                          </span>
                        )}
                        {step === 3 && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-4 h-4" />
                            Transfer completed and stock received at {transfer.toStoreName}.
                          </span>
                        )}
                      </div>

                      {step === 1 && isOutgoing && (
                        <button
                          onClick={() => handleMarkPicked(transfer)}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Truck className="w-4 h-4" />
                          {isProcessing ? 'Marking Picked...' : 'Mark as Picked'}
                        </button>
                      )}

                      {step === 2 && !isOutgoing && (
                        <button
                          onClick={() => handleMarkReceived(transfer)}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {isProcessing ? 'Receiving Stock...' : 'Mark as Received'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default BranchStockTransfer;
