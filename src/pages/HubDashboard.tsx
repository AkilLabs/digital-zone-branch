import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { syncStoreProducts, updateLocalProductQuantities } from '../utils/productSyncCache';
import type { Store, User, Product, StockTransfer, StockTransferItem } from '../types';
import {
  Building2,
  Warehouse,
  ArrowLeftRight,
  BarChart3,
  Package,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  CheckCircle2,
  Copy,
  Check,
  Users,
  TrendingUp,
  ShoppingBag,
  Wrench,
  AlertTriangle,
  UserPlus,
  X,
  ArrowRight,
  Send,
  KeyRound,
  Trash2,
} from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Branch Admin',
  'store-admin': 'Branch Admin',
  manager: 'Manager',
  sales_person: 'Sales Person',
  technician: 'Technician',
  cashier: 'Cashier',
  employee: 'Staff',
};

const HubDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentHub, stores, setCurrentStore, refreshStores } = useStore();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const isOwner = currentUser?.role === 'owner';

  // Dashboard metrics state
  const [storeStats, setStoreStats] = useState<
    Map<
      string,
      {
        todaySales: number;
        todayBills: number;
        todayItemsSold: number;
        stockCostValue: number;
        stockRetailValue: number;
        stockUnits: number;
      }
    >
  >(new Map());
  const [warehouseStats, setWarehouseStats] = useState({
    skuCount: 0,
    totalUnits: 0,
    costValue: 0,
    retailValue: 0,
  });
  const [allEmployees, setAllEmployees] = useState<User[]>([]);
  const [recentTransfers, setRecentTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchSearch, setBranchSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── 2-Step Branch Creation Modal (Strictly Owner Only) ──
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false);
  const [createBranchStep, setCreateBranchStep] = useState<1 | 2 | 3>(1);
  const [branchForm, setBranchForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    managerName: '',
    managerId: '',
    purchaseEnabled: false,
  });
  const [createdBranchId, setCreatedBranchId] = useState<string>('');
  const [creatingBranch, setCreatingBranch] = useState(false);

  // ── Branch Control Modal (Control Entire Branch from HQ) ──
  const [controllingStore, setControllingStore] = useState<Store | null>(null);
  const [controlTab, setControlTab] = useState<'overview' | 'employees'>('overview');
  const [editBranchForm, setEditBranchForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    managerName: '',
    purchaseEnabled: false,
    isActive: true,
  });
  const [savingBranchControl, setSavingBranchControl] = useState(false);
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [assignEmployeeRole, setAssignEmployeeRole] = useState<string>('sales_person');

  // ── Integrated Stock Dispatch & Branch-to-Branch Transfer Modal ──
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferMode, setTransferMode] = useState<'hq_to_branch' | 'branch_to_branch'>('hq_to_branch');
  const [fromLocationId, setFromLocationId] = useState<string>('hub_warehouse');
  const [toLocationId, setToLocationId] = useState<string>('');
  const [sourceProducts, setSourceProducts] = useState<Product[]>([]);
  const [loadingSourceProducts, setLoadingSourceProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedTransferItems, setSelectedTransferItems] = useState<StockTransferItem[]>([]);
  const [transferNotes, setTransferNotes] = useState('');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  useEffect(() => {
    loadHubData();
  }, [currentHub?.id, stores]);

  const loadHubData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`;

      // 1. Today's sales per branch
      const todaySummaryByStore = new Map<
        string,
        { totalRevenue: number; totalBills: number; totalItemsSold: number }
      >();
      try {
        const overallQ = query(collection(db, 'overallSales'), where('date', '==', todayISO));
        const overallSnap = await getDocs(overallQ);
        overallSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const sId = data.storeId || docSnap.id.split('_')[0];
          if (sId) {
            todaySummaryByStore.set(sId, {
              totalRevenue: Number(data.totalRevenue || 0),
              totalBills: Number(data.totalBills || 0),
              totalItemsSold: Number(data.totalItemsSold || 0),
            });
          }
        });
      } catch (err) {
        console.warn('Could not query overallSales:', err);
      }

      // 2. Per-branch stats + stock valuation (and collect branch product quantities by productCode)
      const branchQtyByCode = new Map<string, number>();
      const statsMap = new Map<
        string,
        {
          todaySales: number;
          todayBills: number;
          todayItemsSold: number;
          stockCostValue: number;
          stockRetailValue: number;
          stockUnits: number;
        }
      >();

      await Promise.all(
        stores.map(async (store) => {
          if (!store.id) return;
          const todaySummary = todaySummaryByStore.get(store.id) || {
            totalRevenue: 0,
            totalBills: 0,
            totalItemsSold: 0,
          };

          let stockCostValue = 0;
          let stockRetailValue = 0;
          let stockUnits = store.totalStockUnits ?? 0;

          try {
            const branchProds = await syncStoreProducts(store.id);
            branchProds.forEach((bp) => {
              const code = bp.productCode || bp.id;
              if (code) {
                branchQtyByCode.set(
                  code,
                  (branchQtyByCode.get(code) || 0) + (Number(bp.quantity) || 0)
                );
              }
            });

            const activeProds = branchProds.filter((p) => (Number(p.quantity) || 0) > 0);
            stockUnits = activeProds.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
            stockCostValue = activeProds.reduce(
              (s, p) => s + (Number(p.cost) || 0) * (Number(p.quantity) || 0),
              0
            );
            stockRetailValue = activeProds.reduce(
              (s, p) => s + (Number(p.mrp) || 0) * (Number(p.quantity) || 0),
              0
            );
          } catch {
            // Fallback to store counter
          }

          statsMap.set(store.id, {
            todaySales: todaySummary.totalRevenue,
            todayBills: todaySummary.totalBills,
            todayItemsSold: todaySummary.totalItemsSold,
            stockCostValue,
            stockRetailValue,
            stockUnits,
          });
        })
      );

      setStoreStats(statsMap);

      // 3. HQ Central Warehouse products & valuation (strictly net of branch quantities)
      try {
        const whProducts = await syncStoreProducts(null);
        const inStockWh = whProducts
          .filter((p) => {
            // Exclude products explicitly assigned to a specific branch store
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
            const inBranchQty = branchQtyByCode.get(code) || 0;
            const netQty = Math.max(0, (Number(p.quantity) || 0) - inBranchQty);
            return {
              ...p,
              quantity: netQty,
            };
          })
          .filter((p) => (Number(p.quantity) || 0) > 0);

        setWarehouseStats({
          skuCount: inStockWh.length,
          totalUnits: inStockWh.reduce((s, p) => s + (Number(p.quantity) || 0), 0),
          costValue: inStockWh.reduce(
            (s, p) => s + (Number(p.cost) || 0) * (Number(p.quantity) || 0),
            0
          ),
          retailValue: inStockWh.reduce(
            (s, p) => s + (Number(p.mrp) || 0) * (Number(p.quantity) || 0),
            0
          ),
        });
      } catch {
        setWarehouseStats({ skuCount: 0, totalUnits: 0, costValue: 0, retailValue: 0 });
      }

      // 4. Load employees for branch assignment & manager selection
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const usersList: User[] = usersSnap.docs.map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            email: data.email || '',
            role: data.role || 'employee',
            displayName: data.name || data.displayName || data.email || 'User',
            name: data.name || data.displayName || '',
            phone: data.phone || '',
            address: data.address || '',
            storeId: data.storeId || '',
            storeName: data.storeName || '',
          } as User;
        });
        setAllEmployees(usersList);
      } catch (err) {
        console.warn('Error loading users:', err);
      }

      // 5. Recent stock dispatches & branch-to-branch transfers
      try {
        const transfersQ = query(
          collection(db, 'stockTransfers'),
          orderBy('createdAt', 'desc'),
          limit(8)
        );
        const transfersSnap = await getDocs(transfersQ);
        setRecentTransfers(
          transfersSnap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate ? d.data().createdAt.toDate() : new Date(),
          })) as StockTransfer[]
        );
      } catch {
        setRecentTransfers([]);
      }
    } catch (error) {
      console.error('Error loading HQ dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── Aggregate Metrics ──
  const totals = useMemo(() => {
    let todaySales = 0;
    let todayBills = 0;
    let branchStockCost = 0;
    let branchStockRetail = 0;
    let branchStockUnits = 0;

    storeStats.forEach((s) => {
      todaySales += s.todaySales;
      todayBills += s.todayBills;
      branchStockCost += s.stockCostValue;
      branchStockRetail += s.stockRetailValue;
      branchStockUnits += s.stockUnits;
    });

    const grandTotalStockCost = warehouseStats.costValue + branchStockCost;
    const grandTotalStockRetail = warehouseStats.retailValue + branchStockRetail;
    const grandTotalUnits = warehouseStats.totalUnits + branchStockUnits;

    return {
      todaySales,
      todayBills,
      branchStockCost,
      branchStockRetail,
      branchStockUnits,
      grandTotalStockCost,
      grandTotalStockRetail,
      grandTotalUnits,
    };
  }, [storeStats, warehouseStats]);

  const filteredStores = useMemo(() => {
    if (!branchSearch.trim()) return stores;
    const q = branchSearch.toLowerCase().trim();
    return stores.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        (s.managerName || '').toLowerCase().includes(q) ||
        (s.id || '').toLowerCase().includes(q)
    );
  }, [stores, branchSearch]);

  const handleCopyBranchId = (id: string, snippet = false) => {
    const text = snippet ? `VITE_BRANCH_ID=${id}` : id;
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    showToast(snippet ? 'Copied .env VITE_BRANCH_ID snippet!' : 'Copied Branch ID!', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── 2-Step Branch Creation Handler (Owner Only) ──
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
      await loadHubData();
      showToast(`Branch "Digital Zone - ${branchForm.name.trim()}" created!`, 'success');
    } catch (error) {
      console.error('Error creating branch:', error);
      showToast('Failed to create branch. Please try again.', 'error');
    } finally {
      setCreatingBranch(false);
    }
  };

  // ── Open Branch Control Drawer ──
  const openBranchControl = (store: Store) => {
    setControllingStore(store);
    setControlTab('overview');
    setEditBranchForm({
      name: store.name || '',
      address: store.address || '',
      phone: store.phone || '',
      email: store.email || '',
      managerName: store.managerName || '',
      purchaseEnabled: Boolean(store.purchaseEnabled),
      isActive: store.isActive !== false,
    });
  };

  const handleSaveBranchControl = async () => {
    if (!controllingStore?.id) return;
    if (!editBranchForm.name.trim() || !editBranchForm.address.trim()) {
      showToast('Branch Area Name and Address are mandatory.', 'error');
      return;
    }

    try {
      setSavingBranchControl(true);
      await updateDoc(doc(db, 'stores', controllingStore.id), {
        shopName: 'Digital Zone',
        name: editBranchForm.name.trim(),
        address: editBranchForm.address.trim(),
        phone: editBranchForm.phone.trim(),
        email: editBranchForm.email.trim(),
        managerName: editBranchForm.managerName.trim(),
        purchaseEnabled: Boolean(editBranchForm.purchaseEnabled),
        isActive: Boolean(editBranchForm.isActive),
        updatedAt: Timestamp.now(),
      });

      await refreshStores();
      setControllingStore((prev) =>
        prev
          ? {
              ...prev,
              name: editBranchForm.name.trim(),
              address: editBranchForm.address.trim(),
              phone: editBranchForm.phone.trim(),
              email: editBranchForm.email.trim(),
              managerName: editBranchForm.managerName.trim(),
              purchaseEnabled: Boolean(editBranchForm.purchaseEnabled),
              isActive: Boolean(editBranchForm.isActive),
            }
          : null
      );
      showToast('Branch settings updated!', 'success');
    } catch (error) {
      console.error('Error updating branch:', error);
      showToast('Failed to update branch settings', 'error');
    } finally {
      setSavingBranchControl(false);
    }
  };

  const handleAssignEmployeeToBranch = async () => {
    if (!controllingStore?.id || !assignEmployeeId) return;
    try {
      await updateDoc(doc(db, 'users', assignEmployeeId), {
        storeId: controllingStore.id,
        storeName: controllingStore.name,
        role: assignEmployeeRole,
        scope: 'store',
      });

      setAllEmployees((prev) =>
        prev.map((u) =>
          u.uid === assignEmployeeId
            ? {
                ...u,
                storeId: controllingStore.id,
                storeName: controllingStore.name,
                role: assignEmployeeRole as any,
              }
            : u
        )
      );
      setAssignEmployeeId('');
      showToast('Employee assigned to branch!', 'success');
    } catch (error) {
      console.error('Error assigning employee:', error);
      showToast('Failed to assign employee', 'error');
    }
  };

  const handleUnassignEmployeeFromBranch = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), {
        storeId: '',
        storeName: '',
      });
      setAllEmployees((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, storeId: '', storeName: '' } : u))
      );
      showToast('Employee unassigned from branch', 'success');
    } catch (error) {
      console.error('Error unassigning employee:', error);
      showToast('Failed to unassign employee', 'error');
    }
  };

  // ── Stock Dispatch (HQ -> Branch) & Branch-to-Branch Transfer Trigger ──
  const openStockTransferModal = async (
    mode: 'hq_to_branch' | 'branch_to_branch',
    defaultFrom?: string,
    defaultTo?: string
  ) => {
    setTransferMode(mode);
    const initialFrom =
      mode === 'hq_to_branch'
        ? 'hub_warehouse'
        : defaultFrom || (stores[0]?.id ?? '');
    const initialTo =
      defaultTo ||
      stores.find((s) => s.id !== initialFrom)?.id ||
      '';

    setFromLocationId(initialFrom);
    setToLocationId(initialTo);
    setSelectedTransferItems([]);
    setTransferNotes('');
    setProductSearch('');
    setShowTransferModal(true);

    if (initialFrom) {
      await loadProductsForSource(initialFrom);
    }
  };

  const loadProductsForSource = async (sourceId: string) => {
    try {
      setLoadingSourceProducts(true);
      const isHqWarehouse = sourceId === 'hub_warehouse';
      const scope = isHqWarehouse ? null : sourceId;
      const prods = await syncStoreProducts(scope);

      if (isHqWarehouse) {
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

        // Filter out branch-tagged products and deduct any stock already distributed to branches
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
        setSourceProducts(
          prods
            .filter((p) => (Number(p.quantity) || 0) > 0)
            .sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0))
        );
      }
    } catch (error) {
      console.error('Error loading source products:', error);
      setSourceProducts([]);
    } finally {
      setLoadingSourceProducts(false);
    }
  };

  const addProductToTransferManifest = (prod: Product) => {
    if (!prod.id) return;
    const cleanCode = (prod.productCode || '').trim();
    setSelectedTransferItems((prev) => {
      const existing = prev.find(
        (i) =>
          i.productId === prod.id ||
          (cleanCode && (i.productCode || '').trim() === cleanCode)
      );
      if (existing) {
        return prev.map((i) =>
          i.productId === prod.id ||
          (cleanCode && (i.productCode || '').trim() === cleanCode)
            ? { ...i, quantity: Math.min(i.quantity + 1, Number(prod.quantity) || 1) }
            : i
        );
      }
      return [
        ...prev,
        {
          productId: prod.id!,
          productCode: cleanCode,
          productName: prod.name || '',
          brand: prod.brand || '',
          category: prod.category || '',
          quantity: 1,
          cost: Number(prod.cost) || 0,
          mrp: Number(prod.mrp) || 0,
          picked: false,
          received: false,
        },
      ];
    });
  };

  const handleSubmitStockDispatchOrTransfer = async () => {
    if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
      showToast('Please select valid source and destination branches.', 'error');
      return;
    }
    if (selectedTransferItems.length === 0) {
      showToast('Please add at least one product.', 'error');
      return;
    }

    try {
      setSubmittingTransfer(true);
      const now = Timestamp.now();
      const batch = writeBatch(db);

      const isHqToBranch = fromLocationId === 'hub_warehouse';
      const fromName = isHqToBranch
        ? 'HQ Central Warehouse'
        : stores.find((s) => s.id === fromLocationId)?.name || 'Source Branch';
      const toName = stores.find((s) => s.id === toLocationId)?.name || 'Destination Branch';

      const totalQuantity = selectedTransferItems.reduce((s, i) => s + i.quantity, 0);
      const totalValue = selectedTransferItems.reduce((s, i) => s + i.cost * i.quantity, 0);

      // If HQ -> Branch: Deduct from HQ Warehouse immediately; Branch will check & receive each single product in /stock-received.
      // If Branch -> Branch: Create transfer with status 'triggered'; Source Branch will mark 'picked', Destination Branch will mark 'received'.
      if (isHqToBranch) {
        const whQtyChanges: { productId: string; quantityDelta: number }[] = [];
        for (const item of selectedTransferItems) {
          const srcProd = sourceProducts.find((p) => p.id === item.productId);
          if (srcProd && srcProd.id) {
            const nextQty = Math.max(0, (Number(srcProd.quantity) || 0) - item.quantity);
            batch.update(doc(db, 'products', srcProd.id), {
              quantity: nextQty,
              isAvailable: nextQty > 0,
              updatedAt: now,
            });
            whQtyChanges.push({ productId: srcProd.id, quantityDelta: -item.quantity });
          }
        }

        const transferRef = doc(collection(db, 'stockTransfers'));
        batch.set(transferRef, {
          hubId: currentHub?.id || 'digital_zone_hq',
          transferType: 'hq_to_branch',
          fromStoreId: currentHub?.id || 'hub_warehouse',
          fromStoreName: fromName,
          toStoreId: toLocationId,
          toStoreName: toName,
          items: selectedTransferItems.map((it) => ({
            ...it,
            picked: true,
            received: false,
          })),
          totalItems: selectedTransferItems.length,
          totalQuantity,
          totalValue,
          status: 'dispatched',
          notes: transferNotes.trim(),
          createdAt: now,
          createdBy: currentUser?.uid || '',
          createdByName: currentUser?.displayName || currentUser?.email || 'HQ',
        });

        await batch.commit();
        await updateLocalProductQuantities(null, whQtyChanges);
        showToast(
          `Dispatched ${totalQuantity} units to ${toName}. Branch can now check & receive each product!`,
          'success'
        );
      } else {
        // Branch-to-Branch Transfer Flow: Triggered -> Picked -> Received
        const transferRef = doc(collection(db, 'stockTransfers'));
        batch.set(transferRef, {
          hubId: currentHub?.id || 'digital_zone_hq',
          transferType: 'branch_to_branch',
          fromStoreId: fromLocationId,
          fromStoreName: fromName,
          toStoreId: toLocationId,
          toStoreName: toName,
          items: selectedTransferItems.map((it) => ({
            ...it,
            picked: false,
            received: false,
          })),
          totalItems: selectedTransferItems.length,
          totalQuantity,
          totalValue,
          status: 'triggered',
          notes: transferNotes.trim(),
          createdAt: now,
          createdBy: currentUser?.uid || '',
          createdByName: currentUser?.displayName || currentUser?.email || 'HQ',
        });

        await batch.commit();
        showToast(
          `Stock transfer triggered (${fromName} → ${toName}). Flow started: Triggered → Picked → Received!`,
          'success'
        );
      }

      setShowTransferModal(false);
      await loadHubData();
    } catch (error) {
      console.error('Error submitting stock transfer:', error);
      showToast('Failed to submit stock transfer', 'error');
    } finally {
      setSubmittingTransfer(false);
    }
  };

  const filteredSourceProducts = useMemo(() => {
    if (!productSearch.trim()) return sourceProducts;
    const q = productSearch.toLowerCase().trim();
    return sourceProducts.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.productCode || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q)
    );
  }, [sourceProducts, productSearch]);

  const branchEmployeesForControlledStore = useMemo(() => {
    if (!controllingStore?.id) return [];
    return allEmployees.filter((u) => u.storeId === controllingStore.id);
  }, [allEmployees, controllingStore?.id]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8">
        {/* Welcome & Command Bar (Matching Branch Dashboard UI Look) */}
        <div className="mb-5 bg-white rounded-xl shadow-xs p-4 md:p-6 border border-blue-100">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold text-gray-800">
                  Digital Zone — Head Office Control
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {stores.length} {stores.length === 1 ? 'Branch' : 'Branches'}
                </span>
              </div>
              <p className="text-xs md:text-sm text-gray-600 mt-1">
                Control all branches, view total & branch stock values, manage employees, and trigger stock dispatches.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={loadHubData}
                disabled={loading}
                className="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
                Refresh
              </button>

              <button
                onClick={() => navigate('/stock-transfer')}
                className="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Stock Transfer
              </button>

              <button
                onClick={() => openStockTransferModal('hq_to_branch')}
                className="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Send HQ Stock
              </button>

              <button
                onClick={() => openStockTransferModal('branch_to_branch')}
                className="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Trigger Branch Transfer
              </button>

              {/* Branch Creation strictly ONLY via Owner (not by Admin) */}
              {isOwner && (
                <button
                  onClick={() => {
                    setBranchForm({
                      name: '',
                      address: '',
                      phone: '',
                      email: '',
                      managerName: '',
                      managerId: '',
                      purchaseEnabled: false,
                    });
                    setCreatedBranchId('');
                    setCreateBranchStep(1);
                    setShowCreateBranchModal(true);
                  }}
                  className="px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4" />
                  Create Branch (Owner)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Overview KPI Cards (Matching Branch Dashboard Style) */}
        <h2 className="text-base md:text-lg font-bold text-gray-800 mb-3 px-1">
          Chain Overview & Total Stock Value
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-4 mb-6">
          <div
            onClick={() => navigate('/overall-sales')}
            className="bg-gradient-to-br from-blue-50 to-white p-3.5 md:p-5 rounded-xl shadow-xs border border-blue-100 cursor-pointer hover:border-blue-300 transition-all"
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs md:text-sm text-gray-600 font-medium">Today's Chain Sales</p>
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-blue-600 tabular-nums">
              ₹{totals.todaySales.toLocaleString('en-IN')}
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">
              {totals.todayBills} bills across {stores.length} branches
            </p>
          </div>

          <div
            onClick={() => navigate('/stock-value')}
            className="bg-gradient-to-br from-emerald-50 to-white p-3.5 md:p-5 rounded-xl shadow-xs border border-emerald-100 cursor-pointer hover:border-emerald-300 transition-all"
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs md:text-sm text-gray-600 font-medium">
                Total Stock Value (Cost)
              </p>
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-emerald-600 tabular-nums">
              ₹{totals.grandTotalStockCost.toLocaleString('en-IN')}
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">
              HQ: ₹{warehouseStats.costValue.toLocaleString('en-IN')} • Branches: ₹
              {totals.branchStockCost.toLocaleString('en-IN')}
            </p>
          </div>

          <div
            onClick={() => navigate('/stock-value')}
            className="bg-gradient-to-br from-purple-50 to-white p-3.5 md:p-5 rounded-xl shadow-xs border border-purple-100 cursor-pointer hover:border-purple-300 transition-all"
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs md:text-sm text-gray-600 font-medium">
                Total Retail Value (MRP)
              </p>
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                <Package className="w-4 h-4 text-purple-600" />
              </div>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-purple-600 tabular-nums">
              ₹{totals.grandTotalStockRetail.toLocaleString('en-IN')}
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">
              {totals.grandTotalUnits.toLocaleString('en-IN')} total units in chain
            </p>
          </div>

          <div
            onClick={() => {
              setCurrentStore('hub_warehouse');
              navigate('/products');
            }}
            className="bg-gradient-to-br from-amber-50 to-white p-3.5 md:p-5 rounded-xl shadow-xs border border-amber-100 cursor-pointer hover:border-amber-300 transition-all"
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs md:text-sm text-gray-600 font-medium">HQ Central Warehouse</p>
              <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                <Warehouse className="w-4 h-4 text-amber-600" />
              </div>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-amber-600 tabular-nums">
              {warehouseStats.totalUnits.toLocaleString('en-IN')} units
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">
              {warehouseStats.skuCount} SKUs ready for branch dispatch
            </p>
          </div>
        </div>

        {/* Quick Actions Grid (Matching Branch UI Look) */}
        <div className="mb-6">
          <h2 className="text-base md:text-lg font-bold text-gray-800 mb-3 px-1">
            HQ Quick Actions
          </h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-9 gap-2 md:gap-3">
            {[
              { label: 'Stock Value', path: '/stock-value', color: 'emerald', icon: TrendingUp },
              { label: 'Products', path: '/products', color: 'teal', icon: Package },
              { label: 'Add Purchase', path: '/add-purchase', color: 'purple', icon: ShoppingBag },
              { label: 'Employees', path: '/employee-management', color: 'indigo', icon: Users },
              { label: 'Add Login User', path: '/add-employee', color: 'sky', icon: UserPlus },
              { label: 'Customers', path: '/customers', color: 'pink', icon: Users },
              { label: 'Sales Report', path: '/overall-sales', color: 'green', icon: BarChart3 },
              { label: 'Services', path: '/service-management', color: 'cyan', icon: Wrench },
              { label: 'Defects', path: '/defect-management', color: 'orange', icon: AlertTriangle },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.path}
                  onClick={() => navigate(action.path)}
                  className="bg-slate-50 hover:bg-blue-50/60 p-2.5 md:p-3.5 rounded-xl transition-all border border-slate-200/80 hover:border-blue-300 flex flex-col items-center gap-1.5 cursor-pointer"
                >
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-blue-600 shadow-2xs">
                    <Icon className="w-4 h-4 md:w-5 md:h-5" />
                  </div>
                  <span className="text-[10px] md:text-xs font-medium text-gray-700 text-center leading-tight">
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Branch Control Directory & Stock Value per Branch */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left 8 Cols: All Branches Control & Per-Branch Stock Value */}
          <div className="xl:col-span-8 bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Branches Control & Stock Value Breakdown
                </h2>
                <p className="text-xs text-slate-500">
                  Shop Name is always <strong>Digital Zone</strong> • Branch Name is the branch area
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    placeholder="Search branch area..."
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                {isOwner && (
                  <button
                    onClick={() => {
                      setBranchForm({
                        name: '',
                        address: '',
                        phone: '',
                        email: '',
                        managerName: '',
                        managerId: '',
                        purchaseEnabled: false,
                      });
                      setCreatedBranchId('');
                      setCreateBranchStep(1);
                      setShowCreateBranchModal(true);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer whitespace-nowrap"
                  >
                    + New Branch
                  </button>
                )}
              </div>
            </div>

            {filteredStores.length === 0 ? (
              <div className="p-12 text-center">
                <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <h3 className="text-sm font-semibold text-slate-800">No Branches Found</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {isOwner
                    ? 'Click "+ New Branch" above to create your first branch via the 2-step wizard.'
                    : 'Only the Owner account can create new branches.'}
                </p>
              </div>
            ) : (
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredStores.map((store) => {
                  const stats = storeStats.get(store.id!) || {
                    todaySales: 0,
                    todayBills: 0,
                    todayItemsSold: 0,
                    stockCostValue: 0,
                    stockRetailValue: 0,
                    stockUnits: store.totalStockUnits || 0,
                  };
                  const branchStaffCount = allEmployees.filter(
                    (u) => u.storeId === store.id
                  ).length;

                  return (
                    <div
                      key={store.id}
                      className="rounded-xl border border-slate-200 p-4 hover:border-blue-300 transition-all flex flex-col justify-between bg-white"
                    >
                      <div>
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2 mb-2.5">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                                Digital Zone
                              </span>
                              <span className="text-slate-300">•</span>
                              <h3 className="text-sm font-bold text-slate-900">{store.name}</h3>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">{store.address}</p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                store.purchaseEnabled
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              Purchase: {store.purchaseEnabled ? 'ON' : 'OFF'}
                            </span>
                          </div>
                        </div>

                        {/* Owner-Only Branch ID for Separate Hosting (.env) */}
                        {isOwner && store.id && (
                          <div className="mb-3 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                                Owner Host Branch ID (.env)
                              </span>
                              <code className="text-[11px] font-mono text-slate-800 truncate block">
                                VITE_BRANCH_ID={store.id}
                              </code>
                            </div>
                            <button
                              onClick={() => handleCopyBranchId(store.id!, true)}
                              className="p-1.5 rounded-md bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-200 cursor-pointer flex-shrink-0"
                              title="Copy VITE_BRANCH_ID for .env"
                            >
                              {copiedId === `VITE_BRANCH_ID=${store.id}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        )}

                        {/* Metrics Grid: Stock Value & Today's Sales */}
                        <div className="grid grid-cols-3 gap-2 py-2.5 px-3 rounded-lg bg-slate-50/70 border border-slate-100 mb-3">
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase block">
                              Stock Value
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-emerald-700 tabular-nums">
                              ₹{stats.stockCostValue.toLocaleString('en-IN')}
                            </span>
                            <span className="text-[10px] text-slate-500 block tabular-nums">
                              {stats.stockUnits} units
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 uppercase block">
                              Today Sales
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-blue-600 tabular-nums">
                              ₹{stats.todaySales.toLocaleString('en-IN')}
                            </span>
                            <span className="text-[10px] text-slate-500 block tabular-nums">
                              {stats.todayBills} bills
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 uppercase block">
                              Staff
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-slate-800 tabular-nums">
                              {branchStaffCount} assigned
                            </span>
                            <span className="text-[10px] text-slate-500 block truncate">
                              {store.managerName || 'No Mgr'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Control Actions */}
                      <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100">
                        <button
                          onClick={() => openBranchControl(store)}
                          className="py-1.5 px-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          Control
                        </button>
                        <button
                          onClick={() =>
                            openStockTransferModal('hq_to_branch', 'hub_warehouse', store.id)
                          }
                          className="py-1.5 px-2 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5 text-blue-600" />
                          Send Stock
                        </button>
                        <button
                          onClick={() =>
                            openStockTransferModal('branch_to_branch', store.id, '')
                          }
                          className="py-1.5 px-2 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5 text-violet-600" />
                          Transfer
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right 4 Cols: Live Stock Transfer Pipeline (Triggered -> Picked -> Received) */}
          <div className="xl:col-span-4 bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Live Stock Dispatches & Transfers
                </h2>
                <p className="text-[11px] text-slate-500">
                  HQ dispatches & branch-to-branch flow status
                </p>
              </div>
              <button
                onClick={() => openStockTransferModal('branch_to_branch')}
                className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                + Trigger
              </button>
            </div>

            {recentTransfers.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No stock dispatches or branch transfers yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentTransfers.map((tr) => {
                  const statusLabel =
                    tr.status === 'triggered'
                      ? '1. Triggered'
                      : tr.status === 'picked'
                      ? '2. Picked'
                      : tr.status === 'received' || tr.status === 'completed'
                      ? '3. Received'
                      : tr.status === 'dispatched'
                      ? 'Dispatched (HQ)'
                      : tr.status;

                  const badgeStyle =
                    tr.status === 'received' || tr.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : tr.status === 'picked'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-blue-50 text-blue-700 border-blue-200';

                  return (
                    <div key={tr.id} className="p-3.5 hover:bg-slate-50/70">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-800 truncate">
                          {tr.fromStoreName} → {tr.toStoreName}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeStyle}`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          {tr.totalItems} SKUs ({tr.totalQuantity} units)
                        </span>
                        <span>
                          {tr.createdAt.toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ═══════════════════════════════════════════════════════════════════════════
          MODAL 1: 2-STEP BRANCH CREATION WIZARD (OWNER ONLY)
         ═══════════════════════════════════════════════════════════════════════════ */}
      {showCreateBranchModal && isOwner && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg overflow-hidden">
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

                <div className="p-3.5 rounded-xl bg-slate-900 text-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1">
                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                      Branch ID (Owner Only)
                    </span>
                    <button
                      onClick={() => handleCopyBranchId(createdBranchId, true)}
                      className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy .env Code
                    </button>
                  </div>
                  <code className="block text-xs font-mono text-emerald-300 bg-slate-950 p-2.5 rounded border border-slate-800">
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

      {/* ═══════════════════════════════════════════════════════════════════════════
          MODAL 2: BRANCH CONTROL PANEL (CONTROL ENTIRE BRANCH & EMPLOYEES FROM HQ)
         ═══════════════════════════════════════════════════════════════════════════ */}
      {controllingStore && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                  HQ Branch Control • Shop Name: Digital Zone
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  Digital Zone — {controllingStore.name}
                </h3>
              </div>
              <button
                onClick={() => setControllingStore(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-5 pt-3 border-b border-slate-100 flex gap-2 bg-white">
              <button
                onClick={() => setControlTab('overview')}
                className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  controlTab === 'overview'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Branch Settings & Purchase Toggle
              </button>
              <button
                onClick={() => setControlTab('employees')}
                className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  controlTab === 'employees'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Assign & Manage Branch Employees ({branchEmployeesForControlledStore.length})
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {controlTab === 'overview' ? (
                <>
                  {isOwner && controllingStore.id && (
                    <div className="p-3.5 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 block">
                          Owner Environment Variable (.env)
                        </span>
                        <code className="text-xs font-mono text-emerald-300 truncate block">
                          VITE_BRANCH_ID={controllingStore.id}
                        </code>
                      </div>
                      <button
                        onClick={() => handleCopyBranchId(controllingStore.id!, true)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold flex items-center gap-1.5 cursor-pointer flex-shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy .env
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Branch Name (Area) *
                      </label>
                      <input
                        type="text"
                        value={editBranchForm.name}
                        onChange={(e) =>
                          setEditBranchForm((p) => ({ ...p, name: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Branch Manager
                      </label>
                      <input
                        type="text"
                        value={editBranchForm.managerName}
                        onChange={(e) =>
                          setEditBranchForm((p) => ({ ...p, managerName: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Branch Address *
                    </label>
                    <input
                      type="text"
                      value={editBranchForm.address}
                      onChange={(e) =>
                        setEditBranchForm((p) => ({ ...p, address: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Phone
                      </label>
                      <input
                        type="text"
                        value={editBranchForm.phone}
                        onChange={(e) =>
                          setEditBranchForm((p) => ({ ...p, phone: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={editBranchForm.email}
                        onChange={(e) =>
                          setEditBranchForm((p) => ({ ...p, email: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  {/* Branch Purchase Toggle */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        Branch Purchase Module
                      </p>
                      <p className="text-xs text-slate-500">
                        Turn ON to enable Purchase, Add Purchase, Add Purchase IMEI, and Master Setting in this branch.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setEditBranchForm((p) => ({
                          ...p,
                          purchaseEnabled: !p.purchaseEnabled,
                        }))
                      }
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        editBranchForm.purchaseEnabled
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {editBranchForm.purchaseEnabled ? 'ON (Enabled)' : 'OFF (Disabled)'}
                    </button>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      onClick={() => setControllingStore(null)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      Close
                    </button>
                    <button
                      onClick={handleSaveBranchControl}
                      disabled={savingBranchControl}
                      className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                    >
                      {savingBranchControl ? 'Saving...' : 'Save Branch Changes'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  {/* Assign Existing Employee to this Branch */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        Assign Employee to {controllingStore.name}
                      </span>
                      <button
                        onClick={() => {
                          setControllingStore(null);
                          navigate('/employee-management');
                        }}
                        className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                      >
                        + Create New Employee (3-Step Flow)
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        value={assignEmployeeId}
                        onChange={(e) => setAssignEmployeeId(e.target.value)}
                        className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">Select employee...</option>
                        {allEmployees
                          .filter((u) => u.role !== 'owner' && u.storeId !== controllingStore.id)
                          .map((u) => (
                            <option key={u.uid} value={u.uid}>
                              {u.displayName} ({u.storeName || 'Unassigned'})
                            </option>
                          ))}
                      </select>

                      <select
                        value={assignEmployeeRole}
                        onChange={(e) => setAssignEmployeeRole(e.target.value)}
                        className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="manager">Manager</option>
                        <option value="sales_person">Sales Person</option>
                        <option value="technician">Technician</option>
                        <option value="cashier">Cashier</option>
                        <option value="admin">Branch Admin</option>
                      </select>

                      <button
                        onClick={handleAssignEmployeeToBranch}
                        disabled={!assignEmployeeId}
                        className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                      >
                        Assign to Branch
                      </button>
                    </div>
                  </div>

                  {/* Assigned Employees List */}
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {branchEmployeesForControlledStore.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No employees assigned to this branch yet.
                      </div>
                    ) : (
                      branchEmployeesForControlledStore.map((emp) => (
                        <div
                          key={emp.uid}
                          className="p-3 flex items-center justify-between gap-2 bg-white"
                        >
                          <div>
                            <p className="text-xs font-bold text-slate-900">{emp.displayName}</p>
                            <p className="text-[11px] text-slate-500">
                              {ROLE_LABELS[emp.role] || emp.role} • {emp.email}{' '}
                              {emp.phone ? `• ${emp.phone}` : ''}
                            </p>
                          </div>
                          <button
                            onClick={() => handleUnassignEmployeeFromBranch(emp.uid)}
                            className="px-2.5 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          MODAL 3: HQ STOCK DISPATCH & BRANCH-TO-BRANCH STOCK TRANSFER TRIGGER
         ═══════════════════════════════════════════════════════════════════════════ */}
      {showTransferModal && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setTransferMode('hq_to_branch');
                      setFromLocationId('hub_warehouse');
                      loadProductsForSource('hub_warehouse');
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      transferMode === 'hq_to_branch'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    Send HQ Stock to Branch
                  </button>
                  <button
                    onClick={() => {
                      setTransferMode('branch_to_branch');
                      const firstId = stores[0]?.id || '';
                      setFromLocationId(firstId);
                      if (firstId) loadProductsForSource(firstId);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      transferMode === 'branch_to_branch'
                        ? 'bg-violet-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    Trigger Branch-to-Branch Transfer (Triggered → Picked → Received)
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowTransferModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Source & Destination Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    From Source
                  </label>
                  {transferMode === 'hq_to_branch' ? (
                    <div className="px-3 py-2 text-xs font-bold bg-white border border-slate-200 rounded-lg text-slate-800">
                      HQ Central Warehouse
                    </div>
                  ) : (
                    <select
                      value={fromLocationId}
                      onChange={(e) => {
                        setFromLocationId(e.target.value);
                        setSelectedTransferItems([]);
                        loadProductsForSource(e.target.value);
                      }}
                      className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">Select Source Branch...</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          Digital Zone — {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    To Destination Branch
                  </label>
                  <select
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Select Destination Branch...</option>
                    {stores
                      .filter((s) => s.id !== fromLocationId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          Digital Zone — {s.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Product Selection & Manifest */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left: Available Products */}
                <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col h-80">
                  <div className="p-2.5 bg-slate-50 border-b border-slate-200">
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Search source products..."
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {loadingSourceProducts ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        Loading source stock...
                      </div>
                    ) : filteredSourceProducts.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        No in-stock products at source.
                      </div>
                    ) : (
                      filteredSourceProducts.map((prod) => (
                        <div
                          key={prod.id}
                          className="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {prod.name}
                            </p>
                            <p className="text-[10px] text-slate-500 font-mono">
                              {prod.productCode} • Qty: {prod.quantity}
                            </p>
                          </div>
                          <button
                            onClick={() => addProductToTransferManifest(prod)}
                            className="px-2.5 py-1 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 cursor-pointer flex-shrink-0"
                          >
                            + Add
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Right: Selected Manifest */}
                <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col h-80">
                  <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Selected Products ({selectedTransferItems.length})
                    </span>
                    {selectedTransferItems.length > 0 && (
                      <button
                        onClick={() => setSelectedTransferItems([])}
                        className="text-[11px] text-red-600 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {selectedTransferItems.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        Add products from the left list.
                      </div>
                    ) : (
                      selectedTransferItems.map((item) => (
                        <div
                          key={item.productId}
                          className="p-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {item.productName}
                            </p>
                            <p className="text-[10px] text-slate-500 font-mono">
                              {item.productCode}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => {
                                const val = Math.max(1, Number(e.target.value) || 1);
                                setSelectedTransferItems((prev) =>
                                  prev.map((i) =>
                                    i.productId === item.productId ? { ...i, quantity: val } : i
                                  )
                                );
                              }}
                              className="w-14 px-2 py-1 text-xs border border-slate-300 rounded text-center"
                            />
                            <button
                              onClick={() =>
                                setSelectedTransferItems((prev) =>
                                  prev.filter((i) => i.productId !== item.productId)
                                )
                              }
                              className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  {transferMode === 'hq_to_branch'
                    ? 'Branch will check & receive each single product in "Stock Received (HQ)".'
                    : 'Starts the 3-step branch transfer flow: Triggered → Picked → Received.'}
                </p>
                <button
                  onClick={handleSubmitStockDispatchOrTransfer}
                  disabled={submittingTransfer || selectedTransferItems.length === 0 || !toLocationId}
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {submittingTransfer
                    ? 'Submitting...'
                    : transferMode === 'hq_to_branch'
                    ? 'Dispatch Stock to Branch'
                    : 'Trigger Branch Stock Transfer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HubDashboard;
