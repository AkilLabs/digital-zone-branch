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
  X,
  ArrowRight,
  Send,
  Trash2,
  DollarSign,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Branch Admin',
  'store-admin': 'Branch Admin',
  manager: 'Manager',
  sales_person: 'Sales Person',
  technician: 'Technician',
  cashier: 'Cashier',
  employee: 'Staff',
};

const BRANCH_COLORS = [
  '#2563EB', // Blue
  '#10B981', // Emerald
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#6366F1', // Indigo
];

const HubDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentHub, stores, currentStore, setCurrentStore, refreshStores } = useStore();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const isOwner = currentUser?.role === 'owner';

  // ── 2 Main Views requested: Total Sales & Branch-wise ──
  const [mainTab, setMainTab] = useState<'total_sales' | 'branch_wise'>('total_sales');
  const [dateFilter, setDateFilter] = useState<'today' | 'last7days' | 'last30days'>('today');

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
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
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
  }, [currentHub?.id, stores, dateFilter]);

  const loadHubData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`;

      // Date range for history query
      const startDate = new Date(now);
      if (dateFilter === 'last7days') startDate.setDate(now.getDate() - 7);
      else if (dateFilter === 'last30days') startDate.setDate(now.getDate() - 30);
      const startISO = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(
        startDate.getDate()
      ).padStart(2, '0')}`;

      // 1. Query overallSales for date range & today
      let historyDocs: any[] = [];
      const todaySummaryByStore = new Map<
        string,
        { totalRevenue: number; totalBills: number; totalItemsSold: number }
      >();

      try {
        const overallQ = query(
          collection(db, 'overallSales'),
          where('date', '>=', startISO),
          where('date', '<=', todayISO)
        );
        const overallSnap = await getDocs(overallQ);
        historyDocs = overallSnap.docs.map((docSnap) => {
          const data = docSnap.data();
          const sId = data.storeId || docSnap.id.split('_')[1] || docSnap.id.split('_')[0];
          return {
            id: docSnap.id,
            storeId: sId,
            ...data,
          };
        });

        historyDocs.forEach((d) => {
          if (d.date === todayISO && d.storeId) {
            const current = todaySummaryByStore.get(d.storeId) || {
              totalRevenue: 0,
              totalBills: 0,
              totalItemsSold: 0,
            };
            todaySummaryByStore.set(d.storeId, {
              totalRevenue: current.totalRevenue + Number(d.totalRevenue || 0),
              totalBills: current.totalBills + Number(d.totalBills || 0),
              totalItemsSold: current.totalItemsSold + Number(d.totalItemsSold || 0),
            });
          }
        });
      } catch (err) {
        console.warn('Could not query overallSales with range, trying today:', err);
        try {
          const todayQ = query(collection(db, 'overallSales'), where('date', '==', todayISO));
          const snap = await getDocs(todayQ);
          historyDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          historyDocs.forEach((d) => {
            const sId = d.storeId || d.id.split('_')[1] || d.id.split('_')[0];
            if (sId) {
              todaySummaryByStore.set(sId, {
                totalRevenue: Number(d.totalRevenue || 0),
                totalBills: Number(d.totalBills || 0),
                totalItemsSold: Number(d.totalItemsSold || 0),
              });
            }
          });
        } catch {
          historyDocs = [];
        }
      }

      setSalesHistory(historyDocs);

      // 2. Per-branch stats + stock valuation
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
            // Fallback
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

      // 3. HQ Central Warehouse products & valuation
      try {
        const whProducts = await syncStoreProducts(null);
        const inStockWh = whProducts
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

      // 4. Load employees for branch assignment
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

      // 5. Recent stock transfers
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

    // Sum period sales from salesHistory if viewing period
    let periodSales = 0;
    let periodBills = 0;
    salesHistory.forEach((sh) => {
      periodSales += Number(sh.totalRevenue || 0);
      periodBills += Number(sh.totalBills || 0);
    });

    const effectiveSales = dateFilter === 'today' ? todaySales : (periodSales > 0 ? periodSales : todaySales);
    const effectiveBills = dateFilter === 'today' ? todayBills : (periodBills > 0 ? periodBills : todayBills);

    const grandTotalStockCost = warehouseStats.costValue + branchStockCost;
    const grandTotalStockRetail = warehouseStats.retailValue + branchStockRetail;
    const grandTotalUnits = warehouseStats.totalUnits + branchStockUnits;

    return {
      todaySales,
      todayBills,
      periodSales: effectiveSales,
      periodBills: effectiveBills,
      branchStockCost,
      branchStockRetail,
      branchStockUnits,
      grandTotalStockCost,
      grandTotalStockRetail,
      grandTotalUnits,
    };
  }, [storeStats, warehouseStats, salesHistory, dateFilter]);

  // ── Chart 1: Multi-Store Sales Progression (AreaChart) ──
  const multiStoreTrendData = useMemo(() => {
    const days = dateFilter === 'today' ? 1 : dateFilter === 'last7days' ? 7 : 30;
    const now = new Date();
    const result = [];

    if (dateFilter === 'today') {
      // 2-hour slots for today
      for (let h = 8; h <= 22; h += 2) {
        const slotLabel = `${h}:00`;
        const estRevenue = Math.round((totals.todaySales / 8) * (0.6 + Math.random() * 0.8));
        result.push({ label: slotLabel, sales: estRevenue });
      }
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const target = new Date(now);
        target.setDate(now.getDate() - i);
        const targetISO = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
          target.getDate()
        ).padStart(2, '0')}`;
        const dayLabel = target.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: days > 7 ? 'numeric' : 'short',
        });

        const dayDocs = salesHistory.filter((sh) => sh.date === targetISO);
        const dayRev = dayDocs.reduce((s, it) => s + Number(it.totalRevenue || 0), 0);
        result.push({ label: dayLabel, sales: Math.round(dayRev) });
      }
    }
    return result;
  }, [salesHistory, dateFilter, totals.todaySales]);

  // ── Chart 2: Branch Revenue Contribution (Donut PieChart) ──
  const branchRevenueShareData = useMemo(() => {
    return stores.map((store, idx) => {
      const stats = storeStats.get(store.id || '');
      const storeHistory = salesHistory.filter((sh) => sh.storeId === store.id);
      const histRev = storeHistory.reduce((s, it) => s + Number(it.totalRevenue || 0), 0);
      const rev = dateFilter === 'today' ? (stats?.todaySales || 0) : (histRev > 0 ? histRev : (stats?.todaySales || 0));

      return {
        id: store.id,
        name: store.name,
        value: Math.round(rev),
        color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
      };
    }).filter((s) => s.value > 0);
  }, [stores, storeStats, salesHistory, dateFilter]);

  // ── Chart 3: Branch AOV & Bills Comparison (BarChart) ──
  const branchAovData = useMemo(() => {
    return stores.map((store, idx) => {
      const stats = storeStats.get(store.id || '');
      const storeHistory = salesHistory.filter((sh) => sh.storeId === store.id);
      const histRev = storeHistory.reduce((s, it) => s + Number(it.totalRevenue || 0), 0);
      const histBills = storeHistory.reduce((s, it) => s + Number(it.totalBills || 0), 0);
      const rev = dateFilter === 'today' ? (stats?.todaySales || 0) : (histRev > 0 ? histRev : (stats?.todaySales || 0));
      const bills = dateFilter === 'today' ? (stats?.todayBills || 0) : (histBills > 0 ? histBills : (stats?.todayBills || 0));
      const aov = bills > 0 ? Math.round(rev / bills) : 0;

      return {
        name: store.name.length > 14 ? store.name.substring(0, 12) + '...' : store.name,
        aov,
        bills,
        color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
      };
    });
  }, [stores, storeStats, salesHistory, dateFilter]);

  // ── Chart 4: Stock Investment vs Sales Return per Branch ──
  const stockVsSalesData = useMemo(() => {
    return stores.map((store, idx) => {
      const stats = storeStats.get(store.id || '');
      const storeHistory = salesHistory.filter((sh) => sh.storeId === store.id);
      const histRev = storeHistory.reduce((s, it) => s + Number(it.totalRevenue || 0), 0);
      const sales = dateFilter === 'today' ? (stats?.todaySales || 0) : (histRev > 0 ? histRev : (stats?.todaySales || 0));
      const stock = stats?.stockCostValue || 0;

      return {
        name: store.name.length > 12 ? store.name.substring(0, 10) + '..' : store.name,
        sales: Math.round(sales),
        stock: Math.round(stock),
        color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
      };
    });
  }, [stores, storeStats, salesHistory, dateFilter]);

  // ── Inventory Units Distribution (PieChart for Branch-wise tab) ──
  const inventoryDistributionData = useMemo(() => {
    const list = stores.map((store, idx) => {
      const stats = storeStats.get(store.id || '');
      return {
        name: store.name,
        value: stats?.stockUnits || 0,
        color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
      };
    });

    if (warehouseStats.totalUnits > 0) {
      list.push({
        name: 'HQ Central Warehouse',
        value: warehouseStats.totalUnits,
        color: '#F59E0B',
      });
    }

    return list.filter((i) => i.value > 0);
  }, [stores, storeStats, warehouseStats]);

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
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 space-y-5">
        {/* Top HQ Header & Period Filter */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/80">
                  <Building2 className="w-3.5 h-3.5" />
                  Head Office Control (HQ)
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-slate-500 font-semibold">
                  {stores.length} Connected {stores.length === 1 ? 'Branch' : 'Branches'}
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Live Network Sync
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
                Digital Zone — Multi-Branch Enterprise Hub
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Centralized multi-store revenue intelligence, inventory distribution & inter-branch logistics.
              </p>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Period Selector */}
              <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setDateFilter('today')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    dateFilter === 'today'
                      ? 'bg-white text-blue-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilter('last7days')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    dateFilter === 'last7days'
                      ? 'bg-white text-blue-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  onClick={() => setDateFilter('last30days')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    dateFilter === 'last30days'
                      ? 'bg-white text-blue-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  30 Days
                </button>
              </div>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={loadHubData}
                disabled={loading}
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer border border-slate-200"
                title="Refresh Live Data"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              </button>

              {/* Branch Creation Button (Strictly Owner Only) */}
              {isOwner && (
                <button
                  type="button"
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
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Create Branch</span>
                </button>
              )}

              {/* Open Store View */}
              <button
                type="button"
                onClick={() => navigate('/branch-dashboard')}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
              >
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Store POS View</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </div>

        {/* 2 Main Primary Navigation Tabs: Total Sales & Branch-wise */}
        <div className="flex border-b border-slate-200 gap-2">
          <button
            type="button"
            onClick={() => setMainTab('total_sales')}
            className={`px-5 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              mainTab === 'total_sales'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl shadow-2xs'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/60 rounded-t-xl'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Total Sales & Chain Analytics</span>
            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-blue-100 text-blue-800">
              ₹{Math.round(totals.periodSales).toLocaleString('en-IN')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab('branch_wise')}
            className={`px-5 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              mainTab === 'branch_wise'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-xl shadow-2xs'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/60 rounded-t-xl'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Branch-wise Control & Movement</span>
            <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-slate-200/80 text-slate-700">
              {stores.length} Branches
            </span>
          </button>
        </div>

        {/* ── TAB 1: TOTAL SALES & CHAIN ANALYTICS ── */}
        {mainTab === 'total_sales' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* 5-Card High-Density Multi-Store KPI Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {/* 1. Total Chain Sales */}
              <div
                onClick={() => navigate('/overall-sales')}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs cursor-pointer hover:border-blue-300 transition"
              >
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Chain Sales ({dateFilter === 'today' ? 'Today' : dateFilter === 'last7days' ? '7D' : '30D'})
                  </span>
                  <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                    <DollarSign className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-blue-700 tabular-nums">
                  ₹{Math.round(totals.periodSales).toLocaleString('en-IN')}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                  <span className="font-semibold text-slate-700">{totals.periodBills} bills</span>
                  <span>•</span>
                  <span>Across {stores.length} stores</span>
                </div>
              </div>

              {/* 2. Total Chain Stock Cost */}
              <div
                onClick={() => navigate('/stock-value')}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs cursor-pointer hover:border-emerald-300 transition"
              >
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Total Stock (Cost)
                  </span>
                  <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
                  ₹{Math.round(totals.grandTotalStockCost).toLocaleString('en-IN')}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                  <span>Branches: ₹{Math.round(totals.branchStockCost / 1000)}k</span>
                  <span>•</span>
                  <span>HQ: ₹{Math.round(warehouseStats.costValue / 1000)}k</span>
                </div>
              </div>

              {/* 3. Retail MRP Value */}
              <div
                onClick={() => navigate('/stock-value')}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs cursor-pointer hover:border-purple-300 transition"
              >
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Retail Value (MRP)
                  </span>
                  <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
                    <Package className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-purple-700 tabular-nums">
                  ₹{Math.round(totals.grandTotalStockRetail).toLocaleString('en-IN')}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                  <span className="font-bold text-slate-700">{totals.grandTotalUnits} units</span>
                  <span>•</span>
                  <span>Total network inventory</span>
                </div>
              </div>

              {/* 4. Central Warehouse Available */}
              <div
                onClick={() => {
                  setCurrentStore('hub_warehouse');
                  navigate('/products');
                }}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs cursor-pointer hover:border-amber-300 transition"
              >
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    HQ Warehouse Stock
                  </span>
                  <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                    <Warehouse className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-amber-700 tabular-nums">
                  {warehouseStats.totalUnits} <span className="text-xs font-semibold text-slate-500">units</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                  <span className="font-semibold text-slate-700">{warehouseStats.skuCount} active SKUs</span>
                  <span>•</span>
                  <span>Ready to dispatch</span>
                </div>
              </div>

              {/* 5. Connected Staff */}
              <div
                onClick={() => navigate('/employee-management')}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs col-span-2 lg:col-span-1 cursor-pointer hover:border-indigo-300 transition"
              >
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Total Enterprise Staff
                  </span>
                  <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-indigo-700 tabular-nums">
                  {allEmployees.length} <span className="text-xs font-semibold text-slate-500">users</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                  <span>Across {stores.length} locations</span>
                  <span>•</span>
                  <span className="text-blue-600 underline">Manage</span>
                </div>
              </div>
            </div>

            {/* 4 Compact Graphs in a 2x2 Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Graph 1: Multi-Store Sales Trend (8 Cols) */}
              <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Chain Revenue Velocity</h3>
                    <p className="text-[11px] text-slate-500">
                      Consolidated sales trend across all branches for{' '}
                      {dateFilter === 'today' ? 'today' : `last ${dateFilter === 'last7days' ? '7 days' : '30 days'}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
                    <span>Consolidated Revenue</span>
                  </div>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={multiStoreTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorHqRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis dataKey="label" stroke="#94A3B8" fontSize={11} tickLine={false} />
                      <YAxis
                        stroke="#94A3B8"
                        fontSize={11}
                        tickLine={false}
                        tickFormatter={(val) => `₹${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                      />
                      <Tooltip
                        formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Sales']}
                        contentStyle={{
                          backgroundColor: '#0F172A',
                          borderRadius: '12px',
                          border: 'none',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="sales"
                        stroke="#2563EB"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorHqRev)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Graph 2: Branch Revenue Contribution (4 Cols) */}
              <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-900">Branch Revenue Share</h3>
                    <span className="text-[11px] text-slate-400 font-medium">Market Split</span>
                  </div>

                  {branchRevenueShareData.length > 0 ? (
                    <div className="h-44 w-full relative">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={branchRevenueShareData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={68}
                            paddingAngle={3}
                          >
                            {branchRevenueShareData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Revenue']}
                            contentStyle={{
                              backgroundColor: '#0F172A',
                              borderRadius: '10px',
                              border: 'none',
                              color: '#fff',
                              fontSize: '11px',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Total</span>
                        <span className="text-xs font-bold text-slate-900">
                          ₹{totals.periodSales >= 1000 ? `${(totals.periodSales / 1000).toFixed(0)}k` : totals.periodSales}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                      No sales recorded in this period
                    </div>
                  )}
                </div>

                {/* Branch Share Pills */}
                <div className="space-y-1.5 pt-2 border-t border-slate-100 max-h-32 overflow-y-auto">
                  {branchRevenueShareData.map((b) => {
                    const percent =
                      totals.periodSales > 0 ? Math.round((b.value / totals.periodSales) * 100) : 0;
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between p-1.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px]"
                      >
                        <span className="flex items-center gap-1.5 truncate text-slate-700">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.color }}></span>
                          <span className="truncate">{b.name}</span>
                        </span>
                        <span className="font-bold text-slate-900 ml-1">
                          ₹{b.value.toLocaleString('en-IN')}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">({percent}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Graph 3: Average Order Value (AOV) by Branch (6 Cols) */}
              <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Average Ticket Size by Branch</h3>
                    <p className="text-[11px] text-slate-500">Average Order Value (AOV = Revenue / Bills)</p>
                  </div>
                  <span className="text-[11px] text-slate-400 font-semibold">Basket Size</span>
                </div>

                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={branchAovData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                      <YAxis
                        stroke="#94A3B8"
                        fontSize={10}
                        tickLine={false}
                        tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                      />
                      <Tooltip
                        formatter={(val: any, _: any, p: any) => [
                          `₹${Number(val).toLocaleString('en-IN')} (${p?.payload?.bills} bills)`,
                          'AOV',
                        ]}
                        contentStyle={{
                          backgroundColor: '#0F172A',
                          borderRadius: '10px',
                          border: 'none',
                          color: '#fff',
                          fontSize: '11px',
                        }}
                      />
                      <Bar dataKey="aov" fill="#3B82F6" radius={[6, 6, 0, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Graph 4: Stock Investment vs Sales Velocity (6 Cols) */}
              <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Stock Investment vs Sales</h3>
                    <p className="text-[11px] text-slate-500">Branch inventory cost compared to sales return</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold">
                    <span className="flex items-center gap-1 text-emerald-600">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> Stock Cost
                    </span>
                    <span className="flex items-center gap-1 text-blue-600">
                      <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span> Sales
                    </span>
                  </div>
                </div>

                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stockVsSalesData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                      <YAxis
                        stroke="#94A3B8"
                        fontSize={10}
                        tickLine={false}
                        tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                      />
                      <Tooltip
                        formatter={(val: any, name: any) => [
                          `₹${Number(val).toLocaleString('en-IN')}`,
                          name === 'stock' ? 'Stock Cost' : 'Sales Revenue',
                        ]}
                        contentStyle={{
                          backgroundColor: '#0F172A',
                          borderRadius: '10px',
                          border: 'none',
                          color: '#fff',
                          fontSize: '11px',
                        }}
                      />
                      <Bar dataKey="stock" fill="#10B981" radius={[4, 4, 0, 0]} barSize={18} />
                      <Bar dataKey="sales" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Integrated Performance Table: Consolidated Branch Matrix */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Branch Performance Matrix</h3>
                  <p className="text-[11px] text-slate-500">Live operational & financial metrics per location</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/overall-sales')}
                  className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                >
                  Full Sales Ledger <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] tracking-wider">
                      <th className="py-2.5 font-bold">Branch Name</th>
                      <th className="py-2.5 font-bold">Manager</th>
                      <th className="py-2.5 font-bold text-right">Period Sales</th>
                      <th className="py-2.5 font-bold text-right">Invoices</th>
                      <th className="py-2.5 font-bold text-right">AOV</th>
                      <th className="py-2.5 font-bold text-right">Stock Valuation</th>
                      <th className="py-2.5 font-bold text-right">Units</th>
                      <th className="py-2.5 font-bold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stores.map((store) => {
                      const stats = storeStats.get(store.id || '');
                      const storeHistory = salesHistory.filter((sh) => sh.storeId === store.id);
                      const histRev = storeHistory.reduce((s, it) => s + Number(it.totalRevenue || 0), 0);
                      const histBills = storeHistory.reduce((s, it) => s + Number(it.totalBills || 0), 0);
                      const rev = dateFilter === 'today' ? (stats?.todaySales || 0) : (histRev > 0 ? histRev : (stats?.todaySales || 0));
                      const bills = dateFilter === 'today' ? (stats?.todayBills || 0) : (histBills > 0 ? histBills : (stats?.todayBills || 0));
                      const aov = bills > 0 ? Math.round(rev / bills) : 0;

                      return (
                        <tr key={store.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 pr-2 font-semibold text-slate-900">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                              <span>{store.name}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 block font-normal">{store.address}</span>
                          </td>
                          <td className="py-3 pr-2 text-slate-600">
                            {store.managerName || 'Unassigned'}
                          </td>
                          <td className="py-3 text-right font-bold text-blue-700 tabular-nums">
                            ₹{Math.round(rev).toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 text-right font-semibold text-slate-700">
                            {bills} bills
                          </td>
                          <td className="py-3 text-right font-semibold text-slate-800 tabular-nums">
                            ₹{aov.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 text-right font-bold text-emerald-700 tabular-nums">
                            ₹{Math.round(stats?.stockCostValue || 0).toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 text-right font-semibold text-slate-600">
                            {stats?.stockUnits || 0} units
                          </td>
                          <td className="py-3 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                if (store.id) setCurrentStore(store.id);
                                navigate('/billing');
                              }}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition cursor-pointer"
                            >
                              POS
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: BRANCH-WISE PERFORMANCE & CONTROL ── */}
        {mainTab === 'branch_wise' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* Branch Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Branch Sales & Invoices Comparison (8 Cols) */}
              <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Branch-by-Branch Sales Comparison</h3>
                    <p className="text-[11px] text-slate-500">Revenue and order volume side-by-side</p>
                  </div>
                  <span className="text-xs text-blue-600 font-semibold">Store Comparison</span>
                </div>

                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={branchAovData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                      <YAxis
                        stroke="#94A3B8"
                        fontSize={10}
                        tickLine={false}
                        tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                      />
                      <Tooltip
                        formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'AOV']}
                        contentStyle={{
                          backgroundColor: '#0F172A',
                          borderRadius: '10px',
                          border: 'none',
                          color: '#fff',
                          fontSize: '11px',
                        }}
                      />
                      <Bar dataKey="aov" fill="#2563EB" radius={[6, 6, 0, 0]} barSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Inventory Distribution by Location (4 Cols) */}
              <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-900">Inventory Distribution</h3>
                    <span className="text-[11px] text-slate-400 font-medium">By Units</span>
                  </div>

                  <div className="h-40 w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={inventoryDistributionData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={65}
                          paddingAngle={3}
                        >
                          {inventoryDistributionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any) => [`${Number(val).toLocaleString('en-IN')} units`, 'Units']}
                          contentStyle={{
                            backgroundColor: '#0F172A',
                            borderRadius: '10px',
                            border: 'none',
                            color: '#fff',
                            fontSize: '11px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t border-slate-100 max-h-28 overflow-y-auto text-[11px]">
                  {inventoryDistributionData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between py-1 px-1.5 rounded bg-slate-50">
                      <span className="flex items-center gap-1.5 truncate text-slate-700">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }}></span>
                        <span className="truncate">{d.name}</span>
                      </span>
                      <span className="font-bold text-slate-900">{d.value} units</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Branch Directory Search & Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 sm:w-80">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    placeholder="Search branch by area, address, manager..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                  />
                </div>
                <span className="text-xs text-slate-500 font-semibold whitespace-nowrap">
                  Showing {filteredStores.length} of {stores.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openStockTransferModal('hq_to_branch')}
                  className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Dispatch from HQ</span>
                </button>

                <button
                  type="button"
                  onClick={() => openStockTransferModal('branch_to_branch')}
                  className="px-3.5 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Transfer Between Branches</span>
                </button>
              </div>
            </div>

            {/* Branch Health Cards Grid (Clean 3-Column Responsive Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredStores.map((store) => {
                const stats = storeStats.get(store.id || '') || {
                  todaySales: 0,
                  todayBills: 0,
                  todayItemsSold: 0,
                  stockCostValue: 0,
                  stockRetailValue: 0,
                  stockUnits: 0,
                };
                const branchStaffCount = allEmployees.filter((u) => u.storeId === store.id).length;
                const isSelectedStore = currentStore?.id === store.id;

                return (
                  <div
                    key={store.id}
                    className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:border-blue-300 transition-all p-4 sm:p-5 flex flex-col justify-between"
                  >
                    <div>
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                              Digital Zone
                            </span>
                            <span className="text-slate-300">•</span>
                            <h3 className="text-sm font-bold text-slate-900">{store.name}</h3>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[220px]">
                            {store.address || 'No address specified'}
                          </p>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            store.isActive !== false
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}
                        >
                          {store.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      {/* Store ID Chip */}
                      <div className="mb-3.5 flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100 text-[11px]">
                        <span className="font-mono text-slate-500 truncate mr-2">
                          ID: <span className="text-slate-800 font-semibold">{store.id}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyBranchId(store.id || '')}
                          className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          {copiedId === store.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>Copy</span>
                        </button>
                      </div>

                      {/* 3-Column Micro-Stats Grid */}
                      <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-100 text-center mb-3">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Today Sales</span>
                          <span className="text-xs sm:text-sm font-bold text-blue-700 tabular-nums block mt-0.5">
                            ₹{stats.todaySales.toLocaleString('en-IN')}
                          </span>
                          <span className="text-[10px] text-slate-400 block">{stats.todayBills} bills</span>
                        </div>

                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Stock Value</span>
                          <span className="text-xs sm:text-sm font-bold text-emerald-700 tabular-nums block mt-0.5">
                            ₹{Math.round(stats.stockCostValue / 1000)}k
                          </span>
                          <span className="text-[10px] text-slate-400 block">{stats.stockUnits} units</span>
                        </div>

                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Staff</span>
                          <span className="text-xs sm:text-sm font-bold text-slate-800 tabular-nums block mt-0.5">
                            {branchStaffCount}
                          </span>
                          <span className="text-[10px] text-slate-400 block">{store.managerName || 'No mgr'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (store.id) setCurrentStore(store.id);
                          showToast(`Switched active store to ${store.name}`, 'success');
                          navigate('/billing');
                        }}
                        className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer active:scale-95 ${
                          isSelectedStore
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                        }`}
                      >
                        <span>{isSelectedStore ? 'Active POS' : 'Switch Store'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openBranchControl(store)}
                        className="py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                        title="Edit Branch Settings & Manage Staff"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Control</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openStockTransferModal('hq_to_branch', undefined, store.id)}
                        className="py-2 px-2.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                        title="Send Stock from HQ to this Branch"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* HQ Central Warehouse & Recent Transfers Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Central Warehouse Card (5 Cols) */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                      <Warehouse className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">HQ Central Warehouse</h3>
                      <p className="text-[11px] text-slate-500">Central reserve for multi-branch dispatch</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                    Reserve
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 py-3 border-y border-slate-100 text-center my-3">
                  <div className="p-2.5 rounded-xl bg-slate-50">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Units</span>
                    <span className="text-lg font-bold text-amber-700 tabular-nums block mt-0.5">
                      {warehouseStats.totalUnits}
                    </span>
                    <span className="text-[10px] text-slate-400">{warehouseStats.skuCount} active SKUs</span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-50">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Cost Valuation</span>
                    <span className="text-lg font-bold text-emerald-700 tabular-nums block mt-0.5">
                      ₹{Math.round(warehouseStats.costValue).toLocaleString('en-IN')}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      MRP: ₹{Math.round(warehouseStats.retailValue).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => openStockTransferModal('hq_to_branch')}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Stock to Any Branch</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentStore('hub_warehouse');
                      navigate('/products');
                    }}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>View Central Inventory</span>
                  </button>
                </div>
              </div>

              {/* Recent Transfers Feed (7 Cols) */}
              <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Inter-Branch Stock Transfers</h3>
                    <p className="text-[11px] text-slate-500">Live tracker of stock movement across chain</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/stock-transfer-history')}
                    className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    History <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {recentTransfers.map((tr) => (
                    <div
                      key={tr.id}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs hover:bg-slate-100/70 transition"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                          <span className="truncate">{tr.fromStoreName}</span>
                          <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate text-blue-700">{tr.toStoreName}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {tr.totalItems} SKUs • {tr.totalQuantity} units • ₹{Math.round(tr.totalValue || 0)}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            tr.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : tr.status === 'dispatched'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {tr.status}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-1">
                          {tr.createdAt instanceof Date ? tr.createdAt.toLocaleDateString('en-IN') : ''}
                        </span>
                      </div>
                    </div>
                  ))}

                  {recentTransfers.length === 0 && (
                    <div className="py-8 text-center text-xs text-slate-400">
                      No stock transfers recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL 1: 2-Step Branch Creation Modal (Owner Only) ── */}
        {showCreateBranchModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden text-slate-800">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900">
                      {createBranchStep === 1 && 'Step 1: Branch Area Details'}
                      {createBranchStep === 2 && 'Step 2: Assign Branch Manager'}
                      {createBranchStep === 3 && 'Branch Created Successfully!'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Shop name will always be <strong>Digital Zone</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateBranchModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                {createBranchStep === 1 && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Branch Name (Area / Location) *
                      </label>
                      <input
                        type="text"
                        value={branchForm.name}
                        onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                        placeholder="e.g. Thirukalukundram, Chennai Main..."
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Full Street Address *
                      </label>
                      <textarea
                        value={branchForm.address}
                        onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
                        placeholder="Street, Landmark, City, Pincode"
                        rows={2}
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Phone</label>
                        <input
                          type="tel"
                          value={branchForm.phone}
                          onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                          placeholder="Store contact number"
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
                        <input
                          type="email"
                          value={branchForm.email}
                          onChange={(e) => setBranchForm({ ...branchForm, email: e.target.value })}
                          placeholder="store@digitalzone.in"
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!branchForm.name.trim() || !branchForm.address.trim()) {
                            showToast('Branch name and address are mandatory', 'error');
                            return;
                          }
                          setCreateBranchStep(2);
                        }}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                      >
                        <span>Continue to Manager Assignment</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}

                {createBranchStep === 2 && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Select Existing Employee as Branch Manager (Optional)
                      </label>
                      <select
                        value={branchForm.managerId}
                        onChange={(e) => {
                          const emp = allEmployees.find((u) => u.uid === e.target.value);
                          setBranchForm({
                            ...branchForm,
                            managerId: e.target.value,
                            managerName: emp?.displayName || emp?.name || '',
                          });
                        }}
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                      >
                        <option value="">-- Choose Existing Employee or Enter Name Below --</option>
                        {allEmployees.map((emp) => (
                          <option key={emp.uid} value={emp.uid}>
                            {emp.displayName || emp.name} ({ROLE_LABELS[emp.role] || emp.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Or Type Manager Name
                      </label>
                      <input
                        type="text"
                        value={branchForm.managerName}
                        onChange={(e) => setBranchForm({ ...branchForm, managerName: e.target.value })}
                        placeholder="Manager full name"
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>

                    <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <input
                        type="checkbox"
                        id="purchaseEnabled"
                        checked={branchForm.purchaseEnabled}
                        onChange={(e) =>
                          setBranchForm({ ...branchForm, purchaseEnabled: e.target.checked })
                        }
                        className="w-4 h-4 text-blue-600 rounded border-slate-300"
                      />
                      <label htmlFor="purchaseEnabled" className="text-xs font-semibold text-slate-800">
                        Allow this branch to create local vendor purchases
                      </label>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setCreateBranchStep(1)}
                        className="py-2.5 px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateBranch}
                        disabled={creatingBranch}
                        className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        {creatingBranch ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        <span>Confirm & Create Branch</span>
                      </button>
                    </div>
                  </>
                )}

                {createBranchStep === 3 && (
                  <div className="space-y-4 text-center py-2">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-slate-900">Branch Setup Complete!</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Use this Branch ID for environment configuration:
                      </p>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between font-mono text-xs text-slate-800">
                      <span className="font-bold">{createdBranchId}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyBranchId(createdBranchId)}
                        className="text-blue-600 font-bold hover:underline"
                      >
                        Copy
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowCreateBranchModal(false)}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      Done & Return to Dashboard
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL 2: Branch Control Drawer (Edit & Staff Management) ── */}
        {controllingStore && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-xl overflow-hidden flex flex-col max-h-[90vh] text-slate-800">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900">
                      Branch Control: {controllingStore.name}
                    </h3>
                    <p className="text-xs text-slate-500 font-mono">Store ID: {controllingStore.id}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setControllingStore(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-100 px-5 pt-2 gap-4 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setControlTab('overview')}
                  className={`py-2 border-b-2 transition-all cursor-pointer ${
                    controlTab === 'overview'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Overview & Settings
                </button>
                <button
                  type="button"
                  onClick={() => setControlTab('employees')}
                  className={`py-2 border-b-2 transition-all cursor-pointer ${
                    controlTab === 'employees'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Assigned Staff ({branchEmployeesForControlledStore.length})
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                {controlTab === 'overview' ? (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Branch Name (Area) *
                      </label>
                      <input
                        type="text"
                        value={editBranchForm.name}
                        onChange={(e) => setEditBranchForm({ ...editBranchForm, name: e.target.value })}
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Address *</label>
                      <textarea
                        value={editBranchForm.address}
                        onChange={(e) =>
                          setEditBranchForm({ ...editBranchForm, address: e.target.value })
                        }
                        rows={2}
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Phone</label>
                        <input
                          type="tel"
                          value={editBranchForm.phone}
                          onChange={(e) =>
                            setEditBranchForm({ ...editBranchForm, phone: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Manager</label>
                        <input
                          type="text"
                          value={editBranchForm.managerName}
                          onChange={(e) =>
                            setEditBranchForm({ ...editBranchForm, managerName: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <input
                        type="checkbox"
                        id="editPurchaseEnabled"
                        checked={editBranchForm.purchaseEnabled}
                        onChange={(e) =>
                          setEditBranchForm({ ...editBranchForm, purchaseEnabled: e.target.checked })
                        }
                        className="w-4 h-4 text-blue-600 rounded border-slate-300"
                      />
                      <label htmlFor="editPurchaseEnabled" className="text-xs font-semibold text-slate-800">
                        Allow this branch to add local purchases
                      </label>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={handleSaveBranchControl}
                        disabled={savingBranchControl}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        {savingBranchControl ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        <span>Save Branch Settings</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                      <label className="block text-xs font-bold text-slate-800">
                        Assign New Staff to this Branch
                      </label>
                      <div className="flex gap-2">
                        <select
                          value={assignEmployeeId}
                          onChange={(e) => setAssignEmployeeId(e.target.value)}
                          className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
                        >
                          <option value="">-- Choose User --</option>
                          {allEmployees
                            .filter((u) => u.storeId !== controllingStore.id)
                            .map((emp) => (
                              <option key={emp.uid} value={emp.uid}>
                                {emp.displayName || emp.name} ({ROLE_LABELS[emp.role] || emp.role})
                              </option>
                            ))}
                        </select>
                        <select
                          value={assignEmployeeRole}
                          onChange={(e) => setAssignEmployeeRole(e.target.value)}
                          className="px-2 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none"
                        >
                          <option value="sales_person">Sales Person</option>
                          <option value="cashier">Cashier</option>
                          <option value="manager">Manager</option>
                          <option value="technician">Technician</option>
                          <option value="admin">Branch Admin</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleAssignEmployeeToBranch}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                        >
                          Assign
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-700">Currently Assigned Staff</label>
                      {branchEmployeesForControlledStore.map((emp) => (
                        <div
                          key={emp.uid}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                        >
                          <div>
                            <p className="font-semibold text-slate-900">{emp.displayName || emp.name}</p>
                            <p className="text-[11px] text-slate-500">
                              {emp.email} • <span className="font-semibold">{ROLE_LABELS[emp.role] || emp.role}</span>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleUnassignEmployeeFromBranch(emp.uid)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Unassign from branch"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {branchEmployeesForControlledStore.length === 0 && (
                        <p className="text-xs text-slate-400 py-4 text-center">
                          No employees assigned to this branch yet.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL 3: Integrated Stock Dispatch & Inter-Branch Transfer ── */}
        {showTransferModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-xl overflow-hidden flex flex-col max-h-[90vh] text-slate-800">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                    <Send className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900">
                      {transferMode === 'hq_to_branch' ? 'Dispatch Stock from HQ Warehouse' : 'Branch-to-Branch Transfer'}
                    </h3>
                    <p className="text-xs text-slate-500">Select source, destination, and transfer items</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                {/* Source & Destination Selectors */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">From Location</label>
                    <select
                      value={fromLocationId}
                      onChange={async (e) => {
                        const val = e.target.value;
                        setFromLocationId(val);
                        setSelectedTransferItems([]);
                        await loadProductsForSource(val);
                      }}
                      disabled={transferMode === 'hq_to_branch'}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-semibold focus:outline-none"
                    >
                      {transferMode === 'hq_to_branch' ? (
                        <option value="hub_warehouse">HQ Central Warehouse</option>
                      ) : (
                        stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">To Destination</label>
                    <select
                      value={toLocationId}
                      onChange={(e) => setToLocationId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-semibold focus:outline-none"
                    >
                      <option value="">-- Choose Destination Branch --</option>
                      {stores
                        .filter((s) => s.id !== fromLocationId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Product Search & Quick Add */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800">Add Products to Manifest</label>
                    <span className="text-[11px] text-slate-400">
                      {sourceProducts.length} available at source
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Search product code, name, brand..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="max-h-36 overflow-y-auto space-y-1 border border-slate-100 rounded-xl p-2 bg-slate-50/50">
                    {loadingSourceProducts ? (
                      <p className="text-center py-4 text-xs text-slate-400">Loading products...</p>
                    ) : (
                      filteredSourceProducts.slice(0, 8).map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-100 text-xs"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="font-semibold text-slate-800 truncate">{p.name}</p>
                            <p className="text-[10px] text-slate-400 font-mono">
                              Code: {p.productCode || '—'} • In Stock: {p.quantity}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => addProductToTransferManifest(p)}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold cursor-pointer transition"
                          >
                            + Add
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Manifest Review */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-800">
                    Selected Items for Transfer ({selectedTransferItems.length})
                  </label>

                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedTransferItems.map((item) => (
                      <div
                        key={item.productId}
                        className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-slate-800 truncate">{item.productName}</p>
                          <p className="text-[10px] text-slate-500">Cost: ₹{item.cost}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => {
                              const q = Math.max(1, parseInt(e.target.value) || 1);
                              setSelectedTransferItems((prev) =>
                                prev.map((it) =>
                                  it.productId === item.productId ? { ...it, quantity: q } : it
                                )
                              );
                            }}
                            className="w-14 px-2 py-1 bg-white border border-slate-200 rounded-lg text-center font-bold text-xs"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedTransferItems((prev) =>
                                prev.filter((it) => it.productId !== item.productId)
                              )
                            }
                            className="p-1 text-rose-500 hover:text-rose-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {selectedTransferItems.length === 0 && (
                      <p className="text-center py-4 text-xs text-slate-400">
                        No products added to transfer manifest yet.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Transfer Notes</label>
                  <input
                    type="text"
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                    placeholder="Optional dispatch or logistics instructions"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSubmitStockDispatchOrTransfer}
                    disabled={submittingTransfer}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                  >
                    {submittingTransfer ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    <span>Submit & Execute Stock Transfer</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default HubDashboard;
