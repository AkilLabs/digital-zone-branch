import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Navbar from '../components/Navbar';
import CustomModal from '../components/CustomModal';
import ShareModal from '../components/ShareModal';
import TransactionDetailsModal from '../components/TransactionDetailsModal';
import { useToastContext } from '../context/ToastContext';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { useBillingItems, useCreditSales, useExpenses, useInvalidateCache } from '../hooks/useFirestoreCache';
import {
  isExpenseItem,
  type BillingItem,
  type ShopDetails,
  type Settlement,
  type SettlementExpected,
  type SettlementActual,
  type User as AppUser,
} from '../types';
import { generateOverallSalesPDF, generateInvoice } from '../utils/pdfGenerator';
import {
  generateDailySettlementPDF,
  generateMonthlySettlementPDF,
} from '../utils/settlementPdfGenerator';
import { encodePrice } from '../utils/secretCode';
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  getDocs,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  Edit,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Share2,
  Layers,
  Eye,
  Filter,
  Download,
  Tag,
  Grid3x3,
  Receipt,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Wallet,
  Smartphone,
  Building2,
  Banknote,
  Clock,
  FileText,
  ArrowUpDown,
  BarChart3,
  History,
  FileDown,
  Users,
  Plus,
  Search,
  RefreshCw,
  Printer,
  Award,
  MessageCircle,
  Database,
  ArrowRight,
  Briefcase,
  Gift,
  Lock,
  Unlock,
} from 'lucide-react';

// Declare Android interface for TypeScript
declare global {
  interface Window {
    AndroidInterface?: {
      downloadPDF: (dataUrl: string, filename: string) => void;
      sharePDF?: (dataUrl: string, filename: string, title: string) => void;
    };
  }
}

const isAndroidWebView = (): boolean => {
  return typeof window.AndroidInterface !== 'undefined';
};

// ─── Date & Currency Helpers ────────────────────────────────────────────────

export type DateRangeType = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom' | 'all';
type AuditDuration = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';
type AuditFilterMode = 'gst-only' | 'all-bills';

export interface DateRange {
  start: Date;
  end: Date;
}

const toDateValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const toYYYYMMDD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const toYYYYMM = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const dayStart = (d: Date) => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

const dayEnd = (d: Date) => {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
};

const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

const toFirestoreTimestamp = (d: Date) => Timestamp.fromDate(d);

const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// ─── Financial Calculation Helpers (Exported for Dashboard & other pages) ───

type AuditItem = Partial<Record<string, unknown>> & {
  _id: string;
  _collection: 'billingItems' | 'creditSales';
  paymentSplit?: {
    cash?: unknown;
    upi?: unknown;
    card?: unknown;
  };
};

const toAuditNumber = (value: unknown) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const getPositiveAmount = (...values: unknown[]) => {
  for (const value of values) {
    const amount = toAuditNumber(value);
    if (amount > 0) return amount;
  }
  return 0;
};

const getAuditGstRate = (item: AuditItem) => toAuditNumber(item.taxPercent ?? item.gstRate);

const getAuditLineGross = (item: AuditItem) => {
  const quantity = toAuditNumber(item.quantity);
  const sellingPrice = toAuditNumber(item.sellingPrice ?? item.price);
  const itemSubtotal = toAuditNumber(item.itemSubtotal);
  const itemDiscount = toAuditNumber(item.itemDiscount ?? item.discountAmount);
  const subtotal = toAuditNumber(item.subtotal);
  const discount = toAuditNumber(item.discount ?? item.discountAmount);
  const paymentSplitTotal =
    toAuditNumber(item.paymentSplit?.cash) +
    toAuditNumber(item.paymentSplit?.upi) +
    toAuditNumber(item.paymentSplit?.card);

  return getPositiveAmount(
    item.totalWithGst,
    itemSubtotal > 0 ? itemSubtotal - itemDiscount : 0,
    sellingPrice * quantity,
    subtotal > 0 ? subtotal - discount : 0,
    item.grandTotal,
    paymentSplitTotal
  );
};

const getAuditLineTax = (item: AuditItem) => {
  const gstRate = getAuditGstRate(item);
  const storedGst = toAuditNumber(item.gstAmount);
  let gross = getAuditLineGross(item);

  if (gross <= 0 && storedGst > 0 && gstRate > 0) {
    gross = storedGst;
  }

  if (item.gstEnabled === false || gross <= 0) {
    return { gross, taxableValue: gross, gstAmount: 0, gstRate };
  }

  const derivedGst = gstRate > 0 ? gross - gross / (1 + gstRate / 100) : 0;
  const storedGstLooksLikeLineTax =
    storedGst > 0 &&
    storedGst < gross &&
    (gstRate <= 0 || Math.abs(storedGst - derivedGst) <= Math.max(2, derivedGst * 0.25));

  const gstAmount = storedGstLooksLikeLineTax ? storedGst : derivedGst;
  return {
    gross,
    taxableValue: Math.max(gross - gstAmount, 0),
    gstAmount,
    gstRate,
  };
};

export interface ItemFinancials {
  subtotal: number;
  discount: number;
  netTotal: number;
  unitPrice: number;
  rawUnitPrice: number;
  cost: number;
  unitCost: number;
  profit: number;
  totalProfit: number;
}

export const getItemFinancials = (item: any): ItemFinancials => {
  if (!item) {
    return {
      subtotal: 0,
      discount: 0,
      netTotal: 0,
      unitPrice: 0,
      rawUnitPrice: 0,
      cost: 0,
      unitCost: 0,
      profit: 0,
      totalProfit: 0,
    };
  }

  if (isExpenseItem(item)) {
    const unitCost = Math.abs(toAuditNumber(item.amount ?? item.cost ?? item.profit));
    const qty = toAuditNumber(item.quantity) || 1;
    const cost = Math.abs(unitCost * qty);
    return {
      subtotal: 0,
      discount: 0,
      netTotal: 0,
      unitPrice: 0,
      rawUnitPrice: 0,
      cost,
      unitCost,
      profit: 0,
      totalProfit: 0,
    };
  }

  if (item.items && item.items.length > 0) {
    let subtotal = 0;
    let discount = 0;
    let netTotal = 0;
    let cost = 0;

    for (const sub of item.items) {
      const fin = getItemFinancials(sub);
      subtotal += fin.subtotal;
      discount += fin.discount;
      netTotal += fin.netTotal;
      cost += fin.cost;
    }

    const profit = netTotal - cost;
    return {
      subtotal,
      discount,
      netTotal,
      unitPrice: netTotal,
      rawUnitPrice: subtotal,
      cost,
      unitCost: cost,
      profit,
      totalProfit: profit,
    };
  }

  const qty = toAuditNumber(item.quantity) || 1;
  const rawUnitPrice = toAuditNumber(item.sellingPrice ?? item.price);
  const subtotal =
    item.itemSubtotal !== undefined && item.itemSubtotal !== null
      ? toAuditNumber(item.itemSubtotal)
      : rawUnitPrice * qty;

  let discount = 0;
  if (item.itemDiscount !== undefined && item.itemDiscount !== null) {
    discount = toAuditNumber(item.itemDiscount);
  } else if (
    (!item.totalItems || item.totalItems === 1) &&
    item.discountAmount !== undefined &&
    item.discountAmount !== null
  ) {
    discount = toAuditNumber(item.discountAmount);
  } else if (
    (!item.totalItems || item.totalItems === 1) &&
    item.discount !== undefined &&
    item.discount !== null
  ) {
    discount = toAuditNumber(item.discount);
  }

  let netTotal: number;
  if (discount > 0 && subtotal > 0) {
    netTotal = Math.max(0, subtotal - discount);
  } else if (
    item.totalWithGst !== undefined &&
    item.totalWithGst !== null &&
    !isNaN(Number(item.totalWithGst))
  ) {
    netTotal = toAuditNumber(item.totalWithGst);
  } else {
    netTotal = subtotal;
  }

  if (discount === 0 && subtotal > 0 && netTotal < subtotal) {
    discount = subtotal - netTotal;
  }

  const unitCost = toAuditNumber(item.cost);
  const cost = unitCost * qty;
  const totalProfit = netTotal - cost;
  const profit = qty > 0 ? totalProfit / qty : totalProfit;
  const unitPrice = qty > 0 ? netTotal / qty : netTotal;

  return {
    subtotal,
    discount,
    netTotal,
    unitPrice,
    rawUnitPrice,
    cost,
    unitCost,
    profit,
    totalProfit,
  };
};

// Helper to normalize salesperson name from any item
export const getSalesPersonDisplay = (item: any): { id: string; name: string } => {
  if (!item) return { id: 'unknown', name: 'Staff' };
  const rawName =
    item.salesPersonName ||
    item.createdByName ||
    (typeof item.createdBy === 'string' && item.createdBy.includes('@')
      ? item.createdBy.split('@')[0]
      : item.createdBy) ||
    'Staff';
  const cleanName = String(rawName).trim() || 'Staff';
  const id = item.salesPersonId || cleanName.toLowerCase();
  return { id, name: cleanName };
};

// ─── Unified Main Component ─────────────────────────────────────────────────

type UnifiedTab =
  | 'sales'
  | 'salespersons'
  | 'expenses'
  | 'settlement'
  | 'simple-report'
  | 'analytics';

const OverallSales: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore } = useStore();
  const { error: showError, success: showSuccess } = useToastContext();
  const { invalidateExpenses, invalidateBillingItems } = useInvalidateCache();

  const currentUserDisplayName =
    currentUser?.displayName || currentUser?.name || currentUser?.email || 'Staff';

  // Default tab: if user navigated via /settlement, open settlement tab first; otherwise sales
  const [activeTab, setActiveTab] = useState<UnifiedTab>(() =>
    location.pathname.includes('settlement') ? 'settlement' : 'sales'
  );

  // ── Unified Filter State ─────────────────────────────────────────────────
  const [dateRangeType, setDateRangeType] = useState<DateRangeType>('today');
  const [selectedDayDate, setSelectedDayDate] = useState<Date>(new Date());
  const [selectedMonthDate, setSelectedMonthDate] = useState<Date>(new Date());
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return { start: dayStart(now), end: dayEnd(now) };
  });

  // Advanced Multi-Dimension Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSalesPerson, setSelectedSalesPerson] = useState<string>('');
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<string>('');
  const [selectedEntryType, setSelectedEntryType] = useState<string>('');
  const [salesGstFilter, setSalesGstFilter] = useState<'all' | 'regular' | 'gst'>('all');
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [showCostCode, setShowCostCode] = useState<boolean>(true);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'quantity'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Shop details & Reference maps
  const [shopDetails, setShopDetails] = useState<ShopDetails>({
    shopName: 'Digital Zone',
    ownerName: 'Owner',
    address: '',
    phone: '',
    email: '',
    gst: '',
  });
  const [productsMap, setProductsMap] = useState<Map<string, { brand: string; category: string }>>(new Map());
  const [employeesList, setEmployeesList] = useState<AppUser[]>([]);

  // ── Modals & Action States ───────────────────────────────────────────────
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedShareTransaction, setSelectedShareTransaction] = useState<BillingItem | null>(null);
  const [isTransactionShareModalOpen, setIsTransactionShareModalOpen] = useState(false);
  const [selectedViewTransaction, setSelectedViewTransaction] = useState<BillingItem | null>(null);
  const [isViewTransactionModalOpen, setIsViewTransactionModalOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<BillingItem | null>(null);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BillingItem | null>(null);
  const [editQuantity, setEditQuantity] = useState<number>(1);
  const [editSellingPrice, setEditSellingPrice] = useState<number>(0);
  const [editCost, setEditCost] = useState<number>(0);
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');
  const [editPaymentMode, setEditPaymentMode] = useState<string>('');
  const [editCreatedAt, setEditCreatedAt] = useState<string>('');

  // Audit Export State
  const [auditFilterMode, setAuditFilterMode] = useState<AuditFilterMode>('gst-only');
  const [auditDuration, setAuditDuration] = useState<AuditDuration>('month');
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');
  const [isExportingAudit, setIsExportingAudit] = useState(false);

  // ── Quick Add Expense State (Saves directly to `expenses` collection) ────
  const [showAddExpenseDrawer, setShowAddExpenseDrawer] = useState(false);
  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCategory, setExpCategory] = useState<'general' | 'salary' | 'bonus'>('general');
  const [expPaymentMode, setExpPaymentMode] = useState<'cash' | 'upi' | 'card' | 'bank'>('cash');
  const [expEmployeeId, setExpEmployeeId] = useState('');
  const [expDescription, setExpDescription] = useState('');
  const [expDate, setExpDate] = useState(() => toYYYYMMDD(new Date()));
  const [savingExpense, setSavingExpense] = useState(false);
  const [migratingExpenses, setMigratingExpenses] = useState(false);
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>('all');

  // ── Salesperson Follow-Up State ──────────────────────────────────────────
  const [focusedSalesPerson, setFocusedSalesPerson] = useState<string | null>(null);
  const [salesPersonTargets, setSalesPersonTargets] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('dz_salesperson_targets');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [editingTargetFor, setEditingTargetFor] = useState<string | null>(null);
  const [targetInputVal, setTargetInputVal] = useState<string>('');

  // ── Settlement & Simple Report State ─────────────────────────────────────
  const [settlementMode, setSettlementMode] = useState<'daily' | 'monthly' | 'history'>('daily');
  const [reportPeriodMode, setReportPeriodMode] = useState<'daily' | 'monthly'>('daily');
  const [existingSettlement, setExistingSettlement] = useState<Settlement | null>(null);
  const [monthlySettlements, setMonthlySettlements] = useState<Settlement[]>([]);
  const [allSettlements, setAllSettlements] = useState<Settlement[]>([]);
  const [loadingSettlement, setLoadingSettlement] = useState(false);
  const [savingSettlement, setSavingSettlement] = useState(false);
  const [detailSettlement, setDetailSettlement] = useState<Settlement | null>(null);

  // Settlement Actual Inputs
  const [actualCash, setActualCash] = useState('');
  const [actualUpi, setActualUpi] = useState('');
  const [actualCard, setActualCard] = useState('');
  const [actualFinance, setActualFinance] = useState('');
  const [actualCredit, setActualCredit] = useState('');
  const [actualCheque, setActualCheque] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');

  // ── Update Date Range when filter type / dates change ────────────────────
  useEffect(() => {
    const now = new Date();
    let start = dayStart(now);
    let end = dayEnd(now);

    switch (dateRangeType) {
      case 'today':
        start = dayStart(selectedDayDate);
        end = dayEnd(selectedDayDate);
        break;
      case 'yesterday': {
        const yest = new Date();
        yest.setDate(now.getDate() - 1);
        start = dayStart(yest);
        end = dayEnd(yest);
        break;
      }
      case 'week':
        start = new Date();
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        end = dayEnd(now);
        break;
      case 'month':
        start = monthStart(selectedMonthDate);
        end = monthEnd(selectedMonthDate);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        end = dayEnd(now);
        break;
      case 'custom':
        if (customStartDate && customEndDate) {
          start = dayStart(new Date(customStartDate + 'T00:00:00'));
          end = dayEnd(new Date(customEndDate + 'T00:00:00'));
        }
        break;
      case 'all':
        start = new Date(0);
        end = dayEnd(now);
        break;
    }

    setDateRange({ start, end });
    setCurrentPage(1);
  }, [dateRangeType, selectedDayDate, selectedMonthDate, customStartDate, customEndDate]);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keep reportPeriodMode & settlementMode synced with dateRangeType when switching
  const handleSelectDatePreset = (preset: DateRangeType) => {
    setDateRangeType(preset);
    if (preset === 'today') {
      setSelectedDayDate(new Date());
      setReportPeriodMode('daily');
      if (settlementMode === 'monthly') setSettlementMode('daily');
    } else if (preset === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      setSelectedDayDate(y);
      setReportPeriodMode('daily');
      if (settlementMode === 'monthly') setSettlementMode('daily');
    } else if (preset === 'month') {
      setReportPeriodMode('monthly');
      if (settlementMode === 'daily') setSettlementMode('monthly');
    }
  };

  const navigateSingleDay = (offset: number) => {
    const next = new Date(selectedDayDate);
    next.setDate(next.getDate() + offset);
    setSelectedDayDate(next);
    setDateRangeType('today');
  };

  const navigateSingleMonth = (offset: number) => {
    const next = new Date(selectedMonthDate);
    next.setMonth(next.getMonth() + offset);
    setSelectedMonthDate(next);
    setDateRangeType('month');
  };

  // ── Fetch Initial Store Metadata (Products, Employees, ShopDetails) ──────
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const productsSnap = await getDocs(getCollectionRef('products'));
        const pMap = new Map<string, { brand: string; category: string }>();
        productsSnap.forEach((d) => {
          const data = d.data();
          if (data.name) {
            pMap.set(data.name.toLowerCase().trim(), {
              brand: data.brand || 'Other',
              category: data.category || 'Other',
            });
          }
        });
        setProductsMap(pMap);
      } catch (err) {
        console.error('Error loading products map:', err);
      }

      try {
        const usersSnap = await getDocs(query(getCollectionRef('users')));
        const users: AppUser[] = [];
        usersSnap.forEach((d) => {
          users.push({ uid: d.id, ...d.data() } as AppUser);
        });
        setEmployeesList(users);
      } catch (err) {
        console.error('Error loading employees:', err);
      }

      try {
        const storeShopSnap = await getDoc(getDocRef('settings', 'shopDetails'));
        if (storeShopSnap.exists()) {
          setShopDetails(storeShopSnap.data() as ShopDetails);
          return;
        }
        const rootShopSnap = await getDoc(doc(db, 'settings', 'shopDetails'));
        if (rootShopSnap.exists()) {
          setShopDetails(rootShopSnap.data() as ShopDetails);
        }
      } catch (err) {
        console.warn('Error loading shopDetails:', err);
      }
    };

    fetchMetadata();
  }, [currentStore?.id, getCollectionRef, getDocRef]);

  // ── Fetch Sales, Credit Sales, and Dedicated Expenses via React Query ────
  const shouldFetchAll = dateRangeType === 'all';
  const {
    data: billingData,
    isLoading: loadingBilling,
    refetch: refetchBilling,
  } = useBillingItems(
    shouldFetchAll ? undefined : dateRange.start,
    shouldFetchAll ? undefined : dateRange.end,
    2500
  );

  const {
    data: creditData,
    isLoading: loadingCredit,
    refetch: refetchCredit,
  } = useCreditSales(
    shouldFetchAll ? undefined : dateRange.start,
    shouldFetchAll ? undefined : dateRange.end,
    2500
  );

  const {
    data: expensesData,
    isLoading: loadingExpensesHook,
    refetch: refetchExpenses,
  } = useExpenses(
    shouldFetchAll ? undefined : dateRange.start,
    shouldFetchAll ? undefined : dateRange.end,
    2500
  );

  const loading = loadingBilling || loadingCredit || loadingExpensesHook;

  const handleRefreshAll = () => {
    refetchBilling();
    refetchCredit();
    refetchExpenses();
    if (activeTab === 'settlement' || activeTab === 'simple-report') {
      loadSettlementRecords();
    }
    showSuccess('Data refreshed');
  };

  // ── Separate Pure Sales vs Dedicated + Legacy Expenses ───────────────────
  // Sales items strictly exclude expenses so expenses NEVER pollute sales transactions!
  const rawSalesItems = useMemo(() => {
    const billing = (billingData?.items || []).filter((item) => !isExpenseItem(item));
    const credit = (creditData?.items || []).filter((item) => !isExpenseItem(item));
    const seen = new Set<string>();
    const combined: BillingItem[] = [];
    for (const item of [...billing, ...credit]) {
      const key = `${item._collection || 'billing'}-${item.id}`;
      if (item.id && seen.has(key)) continue;
      if (item.id) seen.add(key);
      combined.push(item);
    }
    return combined;
  }, [billingData, creditData]);

  // Expenses come from `useExpenses` (which merges dedicated `expenses` collection + any legacy `billingItems` with type === 'expense')
  const rawExpenseItems = useMemo(() => {
    const fromHook = expensesData?.items || [];
    const fromBilling = (billingData?.items || []).filter(isExpenseItem);
    const seen = new Set<string>();
    const merged: BillingItem[] = [];
    for (const exp of [...fromHook, ...fromBilling]) {
      if (exp.id && seen.has(exp.id)) continue;
      if (exp.id) seen.add(exp.id);
      merged.push(exp);
    }
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return merged;
  }, [expensesData, billingData]);

  // Count how many expenses are still in legacy `billingItems` collection
  const legacyExpenseCount = useMemo(
    () => rawExpenseItems.filter((e) => e._collection === 'billingItems').length,
    [rawExpenseItems]
  );

  // ── Helper to resolve brand and category ─────────────────────────────────
  const resolveItemBrandAndCategory = useCallback(
    (rawItem: any) => {
      if (isExpenseItem(rawItem)) {
        return {
          brand: 'Expense',
          category: rawItem.expenseCategory || 'general',
        };
      }
      if (rawItem.type === 'service') {
        return {
          brand: 'Service',
          category: 'Service',
        };
      }
      let brand = rawItem.brand;
      let category = rawItem.category;
      if (!brand || !category) {
        const lookup = productsMap.get((rawItem.title || '').toLowerCase().trim());
        if (lookup) {
          brand = brand || lookup.brand;
          category = category || lookup.category;
        }
      }
      return {
        brand: brand || 'Other',
        category: category || 'Other',
      };
    },
    [productsMap]
  );

  // ── Available Filter Options (Salespersons, Brands, Categories) ──────────
  const availableSalesPersons = useMemo(() => {
    const map = new Map<string, string>();
    employeesList.forEach((emp) => {
      const name = emp.displayName || emp.name || emp.email || '';
      if (name) map.set(name.toLowerCase(), name);
    });
    rawSalesItems.forEach((item) => {
      const sp = getSalesPersonDisplay(item);
      if (sp.name && !map.has(sp.name.toLowerCase())) {
        map.set(sp.name.toLowerCase(), sp.name);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [employeesList, rawSalesItems]);

  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    productsMap.forEach((p) => {
      if (p.brand) set.add(p.brand);
    });
    rawSalesItems.forEach((item) => {
      if (item.brand) set.add(item.brand);
      if (item.type === 'service') set.add('Service');
    });
    return Array.from(set).sort();
  }, [productsMap, rawSalesItems]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    productsMap.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    rawSalesItems.forEach((item) => {
      if (item.category) set.add(item.category);
      if (item.type === 'service') set.add('Service');
    });
    return Array.from(set).sort();
  }, [productsMap, rawSalesItems]);

  // ── Filter Raw Sales Items (Before Grouping into Bills) ──────────────────
  const filteredRawSalesItems = useMemo(() => {
    return rawSalesItems.filter((rawItem) => {
      const resolved = resolveItemBrandAndCategory(rawItem);
      if (selectedBrand && resolved.brand !== selectedBrand) return false;
      if (selectedCategory && resolved.category !== selectedCategory) return false;

      if (selectedSalesPerson) {
        const sp = getSalesPersonDisplay(rawItem);
        if (sp.name.toLowerCase() !== selectedSalesPerson.toLowerCase()) return false;
      }

      if (selectedPaymentMode) {
        if (rawItem.paymentMode !== selectedPaymentMode) return false;
      }

      if (selectedEntryType) {
        const itemType = rawItem.type || 'product';
        if (itemType !== selectedEntryType) return false;
      }

      if (salesGstFilter === 'gst' && !rawItem.gstEnabled) return false;
      if (salesGstFilter === 'regular' && Boolean(rawItem.gstEnabled)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const sp = getSalesPersonDisplay(rawItem);
        const matches =
          (rawItem.title && rawItem.title.toLowerCase().includes(q)) ||
          (rawItem.customerName && rawItem.customerName.toLowerCase().includes(q)) ||
          (rawItem.customerPhone && rawItem.customerPhone.toLowerCase().includes(q)) ||
          (rawItem.imei && String(rawItem.imei).toLowerCase().includes(q)) ||
          (rawItem.transactionId && rawItem.transactionId.toLowerCase().includes(q)) ||
          (rawItem.invoiceNumber && rawItem.invoiceNumber.toLowerCase().includes(q)) ||
          (resolved.brand && resolved.brand.toLowerCase().includes(q)) ||
          (resolved.category && resolved.category.toLowerCase().includes(q)) ||
          sp.name.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [
    rawSalesItems,
    resolveItemBrandAndCategory,
    selectedBrand,
    selectedCategory,
    selectedSalesPerson,
    selectedPaymentMode,
    selectedEntryType,
    salesGstFilter,
    searchQuery,
  ]);

  // ── Group Sales Items by transactionId for the Sales Transactions Table ──
  const groupedSalesTransactions = useMemo(() => {
    const grouped: BillingItem[] = [];
    const transactionMap = new Map<string, BillingItem>();

    for (const rawItem of filteredRawSalesItems) {
      const item = { ...rawItem };
      const resolved = resolveItemBrandAndCategory(item);
      item.brand = resolved.brand;
      item.category = resolved.category;

      if (item.transactionId) {
        if (transactionMap.has(item.transactionId)) {
          const parent = transactionMap.get(item.transactionId)!;
          if (!parent.items) {
            const firstItemCopy = { ...parent };
            parent.items = [firstItemCopy];
            parent.quantity = 1;
          }
          parent.items.push(item);

          if (item.type === 'credit') {
            parent.type = 'credit';
            parent.isPaid =
              (parent.isPaid !== undefined ? parent.isPaid : true) &&
              (item.isPaid !== undefined ? item.isPaid : false);
            parent.paidAmount = (parent.paidAmount || 0) + (item.paidAmount || 0);
            parent.remainingAmount = (parent.remainingAmount || 0) + (item.remainingAmount || 0);
            parent.paymentMode = item.paymentMode;
            if (item.customerName && (!parent.customerName || parent.customerName === 'Walk-in Customer')) {
              parent.customerName = item.customerName;
            }
          }

          const parentFin = getItemFinancials(parent);
          parent.sellingPrice = parentFin.netTotal;
          parent.cost = parentFin.cost;
          parent.totalProfit = parentFin.totalProfit;
          parent.profit = parentFin.totalProfit;
          (parent as any).discount = parentFin.discount;
          (parent as any).subtotal = parentFin.subtotal;
          (parent as any).originalSellingPrice = parentFin.rawUnitPrice;
        } else {
          transactionMap.set(item.transactionId, item);
          grouped.push(item);
        }
      } else {
        grouped.push(item);
      }
    }

    for (const item of grouped) {
      const fin = getItemFinancials(item);
      if (item.items && item.items.length > 1) {
        item.sellingPrice = fin.netTotal;
        item.quantity = 1;
        item.cost = fin.cost;
        item.totalProfit = fin.totalProfit;
        item.profit = fin.totalProfit;
        (item as any).discount = fin.discount;
        (item as any).subtotal = fin.subtotal;
        (item as any).originalSellingPrice = fin.rawUnitPrice;
      } else {
        (item as any).originalSellingPrice = fin.rawUnitPrice;
        item.sellingPrice = fin.unitPrice;
        item.totalWithGst = fin.netTotal;
        item.totalProfit = fin.totalProfit;
        item.profit = fin.profit;
        item.itemDiscount = fin.discount;
        item.itemSubtotal = fin.subtotal;
        (item as any).discount = fin.discount;
        (item as any).subtotal = fin.subtotal;
      }
    }

    return [...grouped].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') {
        cmp = (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      } else if (sortBy === 'amount') {
        cmp = (a.sellingPrice || 0) * (a.quantity || 1) - (b.sellingPrice || 0) * (b.quantity || 1);
      } else if (sortBy === 'quantity') {
        const qA = a.items ? a.items.reduce((s, i) => s + (i.quantity || 1), 0) : a.quantity || 1;
        const qB = b.items ? b.items.reduce((s, i) => s + (i.quantity || 1), 0) : b.quantity || 1;
        cmp = qA - qB;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [filteredRawSalesItems, resolveItemBrandAndCategory, sortBy, sortOrder]);

  // ── Filter Expense Items ─────────────────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    return rawExpenseItems.filter((exp) => {
      if (expenseCategoryFilter !== 'all') {
        const cat = exp.expenseCategory || 'general';
        if (cat !== expenseCategoryFilter) return false;
      }
      if (selectedPaymentMode) {
        const pm = (exp as any).paymentType || exp.paymentMode || 'cash';
        if (pm !== selectedPaymentMode) return false;
      }
      if (selectedSalesPerson) {
        const spName = exp.employeeName || exp.createdByName || exp.createdBy || '';
        if (spName.toLowerCase() !== selectedSalesPerson.toLowerCase()) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          (exp.title && exp.title.toLowerCase().includes(q)) ||
          (exp.description && exp.description.toLowerCase().includes(q)) ||
          (exp.employeeName && exp.employeeName.toLowerCase().includes(q)) ||
          (exp.customerName && exp.customerName.toLowerCase().includes(q)) ||
          (exp.createdByName && exp.createdByName.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }, [rawExpenseItems, expenseCategoryFilter, selectedPaymentMode, selectedSalesPerson, searchQuery]);

  // ── Comprehensive Financial Summary Metrics ──────────────────────────────
  const financialStats = useMemo(() => {
    let totalRevenue = 0;
    let totalGrossSales = 0;
    let totalProfit = 0;
    let totalDiscount = 0;
    let totalItemsSold = 0;
    let cashSales = 0;
    let upiSales = 0;
    let cardSales = 0;
    let financeSales = 0;
    let creditSalesAmount = 0;
    let chequeSales = 0;
    let gstInvoices = 0;
    let regularInvoices = 0;
    let gstTaxAmount = 0;
    let gstTaxableValue = 0;

    for (const tx of groupedSalesTransactions) {
      const txAmount = (tx.sellingPrice || 0) * (tx.quantity || 1);
      const txDisc = Number((tx as any).discount || tx.itemDiscount || 0);
      const txProfit = Number(tx.totalProfit || 0);
      const txItemsCount = tx.items
        ? tx.items.reduce((s, i) => s + Number(i.quantity || 1), 0)
        : Number(tx.quantity || 1);

      totalRevenue += txAmount;
      totalGrossSales += txAmount + txDisc;
      totalProfit += txProfit;
      totalDiscount += txDisc;
      totalItemsSold += txItemsCount;

      if (tx.gstEnabled) {
        gstInvoices++;
        const taxInfo = getAuditLineTax(tx as unknown as AuditItem);
        gstTaxAmount += taxInfo.gstAmount;
        gstTaxableValue += taxInfo.taxableValue;
      } else {
        regularInvoices++;
      }

      const pm = tx.paymentMode;
      if (pm === 'cash') cashSales += txAmount;
      else if (pm === 'upi') upiSales += txAmount;
      else if (pm === 'card') cardSales += txAmount;
      else if (pm === 'finance') financeSales += txAmount;
      else if (pm === 'cheque') chequeSales += txAmount;
      else if (pm === 'credit' || tx.type === 'credit') creditSalesAmount += txAmount;
      else if (pm === 'split' && tx.paymentSplit) {
        cashSales += Number(tx.paymentSplit.cash || 0);
        upiSales += Number(tx.paymentSplit.upi || 0);
        cardSales += Number(tx.paymentSplit.card || 0);
      }
    }

    let totalExpenses = 0;
    let cashExpenses = 0;
    let upiExpenses = 0;
    let bankExpenses = 0;
    let generalExpenses = 0;
    let salaryExpenses = 0;
    let bonusExpenses = 0;

    for (const exp of filteredExpenses) {
      const amt = Math.abs(Number((exp as any).amount ?? exp.cost ?? exp.profit ?? 0)) * Number(exp.quantity || 1);
      totalExpenses += amt;

      const pm = ((exp as any).paymentType || exp.paymentMode || 'cash').toLowerCase();
      if (pm === 'cash') cashExpenses += amt;
      else if (pm === 'upi') upiExpenses += amt;
      else bankExpenses += amt;

      const cat = exp.expenseCategory || 'general';
      if (cat === 'salary') salaryExpenses += amt;
      else if (cat === 'bonus') bonusExpenses += amt;
      else generalExpenses += amt;
    }

    const netProfit = totalProfit - totalExpenses;
    const netCashInDrawer = cashSales - cashExpenses;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return {
      totalRevenue,
      totalGrossSales,
      totalProfit,
      totalDiscount,
      totalItemsSold,
      totalExpenses,
      netProfit,
      netCashInDrawer,
      profitMargin,
      cashSales,
      upiSales,
      cardSales,
      financeSales,
      creditSalesAmount,
      chequeSales,
      cashExpenses,
      upiExpenses,
      bankExpenses,
      generalExpenses,
      salaryExpenses,
      bonusExpenses,
      gstInvoices,
      regularInvoices,
      gstTaxAmount,
      gstTaxableValue,
      billCount: groupedSalesTransactions.length,
      expenseCount: filteredExpenses.length,
    };
  }, [groupedSalesTransactions, filteredExpenses]);

  // ── Salesperson Performance & Follow-Up Analytics ────────────────────────
  const salespersonAnalytics = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        email?: string;
        phone?: string;
        role?: string;
        billsCount: number;
        itemsSold: number;
        revenue: number;
        profit: number;
        discountGiven: number;
        cashCollected: number;
        upiCollected: number;
        cardCollected: number;
        financeCollected: number;
        creditIssued: number;
        creditPending: number;
        lastSaleAt: Date | null;
        transactions: BillingItem[];
        topItems: Map<string, { qty: number; rev: number }>;
      }
    >();

    // Pre-populate known active staff so you can follow up even if they have 0 sales today
    employeesList
      .filter((emp) => emp.isActive !== false && emp.role !== 'qr')
      .forEach((emp) => {
        const name = emp.displayName || emp.name || emp.email?.split('@')[0] || 'Staff';
        const key = name.toLowerCase().trim();
        if (!map.has(key)) {
          map.set(key, {
            name,
            email: emp.email,
            role: emp.role,
            billsCount: 0,
            itemsSold: 0,
            revenue: 0,
            profit: 0,
            discountGiven: 0,
            cashCollected: 0,
            upiCollected: 0,
            cardCollected: 0,
            financeCollected: 0,
            creditIssued: 0,
            creditPending: 0,
            lastSaleAt: null,
            transactions: [],
            topItems: new Map(),
          });
        }
      });

    for (const tx of groupedSalesTransactions) {
      const sp = getSalesPersonDisplay(tx);
      const key = sp.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, {
          name: sp.name,
          billsCount: 0,
          itemsSold: 0,
          revenue: 0,
          profit: 0,
          discountGiven: 0,
          cashCollected: 0,
          upiCollected: 0,
          cardCollected: 0,
          financeCollected: 0,
          creditIssued: 0,
          creditPending: 0,
          lastSaleAt: null,
          transactions: [],
          topItems: new Map(),
        });
      }

      const entry = map.get(key)!;
      const amt = (tx.sellingPrice || 0) * (tx.quantity || 1);
      const disc = Number((tx as any).discount || tx.itemDiscount || 0);
      const prof = Number(tx.totalProfit || 0);
      const qty = tx.items
        ? tx.items.reduce((s, i) => s + Number(i.quantity || 1), 0)
        : Number(tx.quantity || 1);

      entry.billsCount += 1;
      entry.itemsSold += qty;
      entry.revenue += amt;
      entry.profit += prof;
      entry.discountGiven += disc;
      entry.transactions.push(tx);

      const txDate = toDateValue(tx.createdAt);
      if (txDate && (!entry.lastSaleAt || txDate > entry.lastSaleAt)) {
        entry.lastSaleAt = txDate;
      }

      if (tx.paymentMode === 'cash') entry.cashCollected += amt;
      else if (tx.paymentMode === 'upi') entry.upiCollected += amt;
      else if (tx.paymentMode === 'card') entry.cardCollected += amt;
      else if (tx.paymentMode === 'finance') entry.financeCollected += amt;
      else if (tx.paymentMode === 'split' && tx.paymentSplit) {
        entry.cashCollected += Number(tx.paymentSplit.cash || 0);
        entry.upiCollected += Number(tx.paymentSplit.upi || 0);
        entry.cardCollected += Number(tx.paymentSplit.card || 0);
      }

      if (tx.type === 'credit' || tx.paymentMode === 'credit') {
        entry.creditIssued += amt;
        if (!tx.isPaid) {
          entry.creditPending += Number(tx.remainingAmount ?? amt);
        }
      }

      const subList = tx.items && tx.items.length > 0 ? tx.items : [tx];
      for (const sub of subList) {
        const t = sub.title || 'Item';
        const subFin = getItemFinancials(sub);
        const cur = entry.topItems.get(t) || { qty: 0, rev: 0 };
        cur.qty += Number(sub.quantity || 1);
        cur.rev += subFin.netTotal;
        entry.topItems.set(t, cur);
      }
    }

    return Array.from(map.values())
      .filter((s) => s.billsCount > 0 || employeesList.length <= 15)
      .sort((a, b) => b.revenue - a.revenue);
  }, [groupedSalesTransactions, employeesList]);

  // ── Brand & Category Breakdown ───────────────────────────────────────────
  const brandBreakdown = useMemo(() => {
    const map = new Map<string, { brand: string; quantity: number; revenue: number; profit: number }>();
    for (const rawItem of filteredRawSalesItems) {
      const resolved = resolveItemBrandAndCategory(rawItem);
      const brand = resolved.brand;
      const qty = rawItem.quantity || 0;
      const fin = getItemFinancials(rawItem);
      const existing = map.get(brand) || { brand, quantity: 0, revenue: 0, profit: 0 };
      existing.quantity += qty;
      existing.revenue += fin.netTotal;
      existing.profit += fin.totalProfit;
      map.set(brand, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredRawSalesItems, resolveItemBrandAndCategory]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { category: string; quantity: number; revenue: number; profit: number }>();
    for (const rawItem of filteredRawSalesItems) {
      const resolved = resolveItemBrandAndCategory(rawItem);
      const category = resolved.category;
      const qty = rawItem.quantity || 0;
      const fin = getItemFinancials(rawItem);
      const existing = map.get(category) || { category, quantity: 0, revenue: 0, profit: 0 };
      existing.quantity += qty;
      existing.revenue += fin.netTotal;
      existing.profit += fin.totalProfit;
      map.set(category, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredRawSalesItems, resolveItemBrandAndCategory]);

  // ── Settlement Computation & Firestore Sync ──────────────────────────────
  const computeExpectedForItems = useCallback(
    (salesList: BillingItem[], expensesList: BillingItem[]): SettlementExpected => {
      let totalSales = 0;
      let totalExpenses = 0;
      let totalProfit = 0;
      let totalDiscount = 0;
      let cash = 0;
      let upi = 0;
      let card = 0;
      let finance = 0;
      let credit = 0;
      let cheque = 0;
      let splitCash = 0;
      let splitUpi = 0;
      let splitCard = 0;

      for (const item of salesList) {
        const fin = getItemFinancials(item);
        const netAmount = fin.netTotal;
        totalSales += netAmount;
        totalProfit += fin.totalProfit;
        totalDiscount += fin.discount;

        const pm = item.paymentMode;
        if (pm === 'cash') cash += netAmount;
        else if (pm === 'upi') upi += netAmount;
        else if (pm === 'card') card += netAmount;
        else if (pm === 'finance') finance += netAmount;
        else if (pm === 'credit' || item.type === 'credit') credit += netAmount;
        else if (pm === 'cheque') cheque += netAmount;
        else if (pm === 'split') {
          const sc = Number(item.paymentSplit?.cash || 0);
          const su = Number(item.paymentSplit?.upi || 0);
          const sca = Number(item.paymentSplit?.card || 0);
          splitCash += sc;
          splitUpi += su;
          splitCard += sca;
          cash += sc;
          upi += su;
          card += sca;
        }
      }

      for (const exp of expensesList) {
        const amt = Math.abs(Number((exp as any).amount ?? exp.cost ?? exp.profit ?? 0)) * Number(exp.quantity || 1);
        totalExpenses += amt;
      }

      return {
        totalSales: Math.round(totalSales),
        totalExpenses: Math.round(totalExpenses),
        totalRevenue: Math.round(totalSales - totalExpenses),
        totalProfit: Math.round(totalProfit),
        totalDiscount: Math.round(totalDiscount),
        cash: Math.round(cash),
        upi: Math.round(upi),
        card: Math.round(card),
        finance: Math.round(finance),
        credit: Math.round(credit),
        cheque: Math.round(cheque),
        split: Math.round(splitCash + splitUpi + splitCard),
        splitCash: Math.round(splitCash),
        splitUpi: Math.round(splitUpi),
        splitCard: Math.round(splitCard),
        transactionCount: salesList.length + expensesList.length,
        salesCount: salesList.length,
        expenseCount: expensesList.length,
      };
    },
    []
  );

  const currentExpected = useMemo(
    () => computeExpectedForItems(rawSalesItems, rawExpenseItems),
    [rawSalesItems, rawExpenseItems, computeExpectedForItems]
  );

  // Day-by-Day breakdown for Monthly view / Monthly Simple Report
  const dailyBreakdown = useMemo(() => {
    const dayMap = new Map<string, { sales: BillingItem[]; expenses: BillingItem[] }>();

    for (const s of rawSalesItems) {
      const d = toDateValue(s.createdAt);
      if (!d) continue;
      const key = toYYYYMMDD(d);
      if (!dayMap.has(key)) dayMap.set(key, { sales: [], expenses: [] });
      dayMap.get(key)!.sales.push(s);
    }

    for (const e of rawExpenseItems) {
      const d = toDateValue(e.createdAt);
      if (!d) continue;
      const key = toYYYYMMDD(d);
      if (!dayMap.has(key)) dayMap.set(key, { sales: [], expenses: [] });
      dayMap.get(key)!.expenses.push(e);
    }

    const days = Array.from(dayMap.entries()).map(([dateStr, group]) => {
      const expected = computeExpectedForItems(group.sales, group.expenses);
      const settlement = monthlySettlements.find((s) => s.date === dateStr);
      return {
        dateStr,
        expected,
        settlement,
        count: group.sales.length + group.expenses.length,
      };
    });

    days.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    return days;
  }, [rawSalesItems, rawExpenseItems, monthlySettlements, computeExpectedForItems]);

  // Load settlement records from Firestore
  const loadSettlementRecords = useCallback(async () => {
    setLoadingSettlement(true);
    try {
      const dateStr = toYYYYMMDD(selectedDayDate);
      const monthStr = toYYYYMM(selectedMonthDate);

      // 1. Load daily settlement for selectedDayDate
      const dailyQ = query(
        getCollectionRef('settlements'),
        where('type', '==', 'daily'),
        where('date', '==', dateStr)
      );
      const dailySnap = await getDocs(dailyQ);
      if (!dailySnap.empty) {
        const sDoc = dailySnap.docs[0];
        const sData = sDoc.data();
        const sObj: Settlement = {
          id: sDoc.id,
          ...sData,
          createdAt: sData.createdAt?.toDate ? sData.createdAt.toDate() : new Date(),
          updatedAt: sData.updatedAt?.toDate ? sData.updatedAt.toDate() : undefined,
          period: {
            start: sData.period?.start?.toDate ? sData.period.start.toDate() : dayStart(selectedDayDate),
            end: sData.period?.end?.toDate ? sData.period.end.toDate() : dayEnd(selectedDayDate),
          },
        } as Settlement;
        setExistingSettlement(sObj);
        setActualCash(String(sObj.actual.cash ?? 0));
        setActualUpi(String(sObj.actual.upi ?? 0));
        setActualCard(String(sObj.actual.card ?? 0));
        setActualFinance(String(sObj.actual.finance ?? 0));
        setActualCredit(String(sObj.actual.credit ?? 0));
        setActualCheque(String(sObj.actual.cheque ?? 0));
        setSettlementNotes(sObj.notes || '');
      } else {
        setExistingSettlement(null);
        setActualCash('');
        setActualUpi('');
        setActualCard('');
        setActualFinance('');
        setActualCredit('');
        setActualCheque('');
        setSettlementNotes('');
      }

      // 2. Load monthly settlements
      const monthQ = query(
        getCollectionRef('settlements'),
        where('type', '==', 'daily'),
        where('date', '>=', `${monthStr}-01`),
        where('date', '<=', `${monthStr}-31`)
      );
      const monthSnap = await getDocs(monthQ).catch(() => null);
      if (monthSnap) {
        const mList: Settlement[] = monthSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : undefined,
            period: {
              start: data.period?.start?.toDate ? data.period.start.toDate() : monthStart(selectedMonthDate),
              end: data.period?.end?.toDate ? data.period.end.toDate() : monthEnd(selectedMonthDate),
            },
          } as Settlement;
        });
        setMonthlySettlements(mList);
      }

      // 3. Load history
      const histQ = query(getCollectionRef('settlements'), orderBy('createdAt', 'desc'));
      const histSnap = await getDocs(histQ).catch(() => null);
      if (histSnap) {
        const hList: Settlement[] = histSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : undefined,
            period: {
              start: data.period?.start?.toDate ? data.period.start.toDate() : new Date(),
              end: data.period?.end?.toDate ? data.period.end.toDate() : new Date(),
            },
          } as Settlement;
        });
        setAllSettlements(hList);
      }
    } catch (err) {
      console.error('Error loading settlements:', err);
    } finally {
      setLoadingSettlement(false);
    }
  }, [getCollectionRef, selectedDayDate, selectedMonthDate]);

  useEffect(() => {
    loadSettlementRecords();
  }, [loadSettlementRecords]);

  const actualValues: SettlementActual = useMemo(
    () => ({
      cash: parseFloat(actualCash) || 0,
      upi: parseFloat(actualUpi) || 0,
      card: parseFloat(actualCard) || 0,
      finance: parseFloat(actualFinance) || 0,
      credit: parseFloat(actualCredit) || 0,
      cheque: parseFloat(actualCheque) || 0,
      notes: settlementNotes,
    }),
    [actualCash, actualUpi, actualCard, actualFinance, actualCredit, actualCheque, settlementNotes]
  );

  const settlementDifference = useMemo(() => {
    const cashDiff = actualValues.cash - currentExpected.cash;
    const upiDiff = actualValues.upi - currentExpected.upi;
    const cardDiff = actualValues.card - currentExpected.card;
    return {
      cash: Math.round(cashDiff),
      upi: Math.round(upiDiff),
      card: Math.round(cardDiff),
      total: Math.round(cashDiff + upiDiff + cardDiff),
    };
  }, [actualValues, currentExpected]);

  const prefillActualWithExpected = () => {
    setActualCash(String(currentExpected.cash));
    setActualUpi(String(currentExpected.upi));
    setActualCard(String(currentExpected.card));
    setActualFinance(String(currentExpected.finance));
    setActualCredit(String(currentExpected.credit));
    setActualCheque(String(currentExpected.cheque));
  };

  const handleSaveSettlement = async (typeToSave: 'daily' | 'monthly' = 'daily') => {
    setSavingSettlement(true);
    try {
      const isDaily = typeToSave === 'daily';
      const dateStr = isDaily ? toYYYYMMDD(selectedDayDate) : toYYYYMM(selectedMonthDate);
      const start = isDaily ? dayStart(selectedDayDate) : monthStart(selectedMonthDate);
      const end = isDaily ? dayEnd(selectedDayDate) : monthEnd(selectedMonthDate);

      const settlementPayload = {
        type: typeToSave,
        date: dateStr,
        period: {
          start: toFirestoreTimestamp(start),
          end: toFirestoreTimestamp(end),
        },
        expected: currentExpected,
        actual: isDaily
          ? actualValues
          : {
              cash: currentExpected.cash,
              upi: currentExpected.upi,
              card: currentExpected.card,
              finance: currentExpected.finance,
              credit: currentExpected.credit,
              cheque: currentExpected.cheque,
              notes: settlementNotes || 'Monthly Settlement Sign-off',
            },
        difference: isDaily
          ? settlementDifference
          : { cash: 0, upi: 0, card: 0, total: 0 },
        status: 'settled' as const,
        settledBy: currentUser?.uid || '',
        settledByName: currentUserDisplayName,
        notes: settlementNotes,
        storeId: currentStore?.id || '',
        updatedAt: toFirestoreTimestamp(new Date()),
      };

      if (isDaily && existingSettlement?.id) {
        await updateDoc(getDocRef('settlements', existingSettlement.id), settlementPayload);
        showSuccess(`Updated settlement for ${dateStr}`);
      } else {
        await addDoc(getCollectionRef('settlements'), {
          ...settlementPayload,
          createdAt: toFirestoreTimestamp(new Date()),
        });
        showSuccess(`${isDaily ? 'Daily' : 'Monthly'} settlement saved for ${dateStr}!`);
      }

      await loadSettlementRecords();
    } catch (err) {
      console.error('Error saving settlement:', err);
      showError('Failed to save settlement');
    } finally {
      setSavingSettlement(false);
    }
  };

  // ── Quick Add Expense Handler (Dedicated `expenses` Collection) ──────────
  const handleAddQuickExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmt = parseFloat(expAmount);
    if (isNaN(parsedAmt) || parsedAmt <= 0) {
      showError('Please enter a valid expense amount');
      return;
    }
    if (!expTitle.trim()) {
      showError('Please enter an expense title');
      return;
    }
    if ((expCategory === 'salary' || expCategory === 'bonus') && !expEmployeeId) {
      showError('Please select an employee for salary/bonus payout');
      return;
    }

    setSavingExpense(true);
    try {
      const selectedEmp = employeesList.find((emp) => emp.uid === expEmployeeId);
      let expenseTimestamp = Timestamp.now();
      if (expDate) {
        const d = new Date(expDate + 'T00:00:00');
        const now = new Date();
        d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
        expenseTimestamp = Timestamp.fromDate(d);
      }

      const newExpenseDoc = {
        title: expTitle.trim(),
        amount: parsedAmt,
        cost: parsedAmt,
        sellingPrice: 0,
        profit: -parsedAmt,
        totalProfit: -parsedAmt,
        quantity: 1,
        description: expDescription.trim() || '',
        type: 'expense' as const,
        expenseCategory: expCategory,
        employeeId: selectedEmp?.uid || null,
        employeeName: selectedEmp?.displayName || selectedEmp?.name || null,
        paymentType: expPaymentMode,
        paymentMode: expPaymentMode,
        createdAt: expenseTimestamp,
        createdBy: currentUserDisplayName,
        createdByName: currentUserDisplayName,
        storeId: currentStore?.id || null,
      };

      // Save strictly to dedicated `expenses` collection!
      await addDoc(getCollectionRef('expenses'), newExpenseDoc);

      showSuccess(`Expense ₹${parsedAmt.toLocaleString('en-IN')} saved to Expenses collection`);
      setExpTitle('');
      setExpAmount('');
      setExpDescription('');
      setExpCategory('general');
      setExpEmployeeId('');
      setShowAddExpenseDrawer(false);
      invalidateExpenses();
      refetchExpenses();
    } catch (err) {
      console.error('Error recording expense:', err);
      showError('Failed to record expense');
    } finally {
      setSavingExpense(false);
    }
  };

  // Migrate any legacy expenses sitting in `billingItems` over to `expenses` collection
  const handleMigrateLegacyExpenses = async () => {
    const legacyItems = rawExpenseItems.filter((e) => e._collection === 'billingItems' && e.id);
    if (legacyItems.length === 0) {
      showSuccess('All expenses are already in the separate expenses collection!');
      return;
    }
    if (
      !window.confirm(
        `Move ${legacyItems.length} legacy expense(s) from Sales (billingItems) into the dedicated Expenses collection?`
      )
    ) {
      return;
    }

    setMigratingExpenses(true);
    try {
      let moved = 0;
      for (const item of legacyItems) {
        if (!item.id) continue;
        const amt = Math.abs(Number((item as any).amount ?? item.cost ?? item.profit ?? 0));
        const createdDate = toDateValue(item.createdAt) || new Date();
        const payload = {
          title: item.title || 'Store Expense',
          amount: amt,
          cost: amt,
          sellingPrice: 0,
          profit: -amt,
          totalProfit: -amt,
          quantity: Number(item.quantity || 1),
          description: item.description || '',
          type: 'expense',
          expenseCategory: item.expenseCategory || 'general',
          employeeId: item.employeeId || null,
          employeeName: item.employeeName || null,
          paymentType: (item as any).paymentType || item.paymentMode || 'cash',
          paymentMode: item.paymentMode || 'cash',
          createdAt: Timestamp.fromDate(createdDate),
          createdBy: item.createdBy || currentUserDisplayName,
          createdByName: item.createdByName || item.createdBy || currentUserDisplayName,
          storeId: item.storeId || currentStore?.id || null,
        };

        await addDoc(getCollectionRef('expenses'), payload);
        await deleteDoc(getDocRef('billingItems', item.id));
        moved++;
      }

      showSuccess(`Migrated ${moved} expense(s) to separate Expenses collection!`);
      invalidateBillingItems();
      invalidateExpenses();
      refetchBilling();
      refetchExpenses();
    } catch (err) {
      console.error('Error migrating expenses:', err);
      showError('Failed to migrate some expenses');
    } finally {
      setMigratingExpenses(false);
    }
  };

  // ── Save Salesperson Target ──────────────────────────────────────────────
  const handleSaveTarget = (spName: string) => {
    const num = parseFloat(targetInputVal) || 0;
    const updated = { ...salesPersonTargets, [spName.toLowerCase()]: num };
    setSalesPersonTargets(updated);
    try {
      localStorage.setItem('dz_salesperson_targets', JSON.stringify(updated));
    } catch {
      // ignore
    }
    setEditingTargetFor(null);
    showSuccess(`Updated target for ${spName}`);
  };

  // ── Share Salesperson Summary via WhatsApp ───────────────────────────────
  const handleWhatsAppSalesPersonFollowUp = (sp: (typeof salespersonAnalytics)[0]) => {
    const periodLabel = getRangeName();
    const text =
      `*${shopDetails.shopName || 'Digital Zone'} - Sales Follow-Up*\n` +
      `👤 Salesperson: *${sp.name}*\n` +
      `📅 Period: ${periodLabel}\n` +
      `🧾 Bills Generated: *${sp.billsCount}* (${sp.itemsSold} items)\n` +
      `💰 Total Sales: *₹${Math.round(sp.revenue).toLocaleString('en-IN')}*\n` +
      `💵 Cash: ₹${Math.round(sp.cashCollected).toLocaleString('en-IN')} | 📱 UPI: ₹${Math.round(sp.upiCollected).toLocaleString('en-IN')} | 💳 Card: ₹${Math.round(sp.cardCollected).toLocaleString('en-IN')}\n` +
      (sp.creditPending > 0
        ? `⚠️ Pending Credit Collection: *₹${Math.round(sp.creditPending).toLocaleString('en-IN')}*\n`
        : '') +
      `\nKeep up the great work!`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // ── Inventory Restore & Delete / Edit Handlers ───────────────────────────
  const restoreProductQuantity = async (item: BillingItem) => {
    try {
      if (item.type !== 'product' && item.type !== 'credit') return;
      const productsRef = getCollectionRef('products');
      const productQuery = item.imei?.trim()
        ? query(productsRef, where('imei', '==', item.imei.trim()))
        : query(productsRef, where('name', '==', item.title));
      const productSnap = await getDocs(productQuery);

      if (!productSnap.empty) {
        const productDoc = productSnap.docs[0];
        const currentQuantity = Number(productDoc.data().quantity || 0);
        const newQuantity = currentQuantity + (item.quantity || 0);

        await updateDoc(getDocRef('products', productDoc.id), {
          quantity: newQuantity,
          isAvailable: newQuantity > 0,
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      console.error('Error restoring product quantity:', error);
    }
  };

  const handleDeleteItem = (item: BillingItem) => {
    setItemToDelete(item);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;
    setShowDeleteModal(false);
    const item = itemToDelete;

    const hasMultipleItems = item.items && item.items.length > 1;
    const itemsToDelete = hasMultipleItems ? item.items! : [item];

    if (!itemsToDelete[0]?.id) return;

    try {
      let deletedCount = 0;

      const deletePromises = itemsToDelete.map(async (subItem: BillingItem) => {
        if (!subItem.id) return;

        if (isExpenseItem(subItem)) {
          const expCol = subItem._collection || 'expenses';
          await deleteDoc(getDocRef(expCol, subItem.id));
          if (expCol === 'expenses') {
            try {
              await deleteDoc(getDocRef('billingItems', subItem.id));
            } catch {
              // ignore
            }
          }
          deletedCount++;
          return;
        }

        const type = subItem.type || item.type;
        const targetCollection =
          subItem._collection || (type === 'credit' ? 'creditSales' : 'billingItems');

        await restoreProductQuantity(subItem);
        await deleteDoc(getDocRef(targetCollection, subItem.id));
        deletedCount++;
      });

      await Promise.all(deletePromises);
      showSuccess(`Successfully deleted ${deletedCount} entry(s).`);
      setItemToDelete(null);
      refetchBilling();
      refetchCredit();
      refetchExpenses();
    } catch (error) {
      console.error('Error deleting item(s):', error);
      showError(`Failed to delete item(s): ${error}`);
    }
  };

  const handleEditItem = (item: BillingItem) => {
    if (!isExpenseItem(item)) {
      const editId = item.transactionId || item.id;
      if (!editId) {
        showError('Unable to edit this bill because it has no valid transaction id.');
        return;
      }
      navigate(`/billing/edit/${encodeURIComponent(editId)}`);
      return;
    }

    setEditingItem(item);
    setEditCustomerName(item.customerName || '');
    setEditCustomerPhone(item.customerPhone || '');
    setEditPaymentMode(item.paymentMode || 'cash');

    if (item.createdAt) {
      try {
        const d = toDateValue(item.createdAt) || new Date();
        const tzOffset = d.getTimezoneOffset() * 60000;
        const localISOTime = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
        setEditCreatedAt(localISOTime);
      } catch {
        setEditCreatedAt('');
      }
    } else {
      setEditCreatedAt('');
    }

    setEditQuantity(item.quantity || 1);
    setEditSellingPrice(item.sellingPrice || 0);
    setEditCost(Math.abs(Number((item as any).amount ?? item.cost ?? 0)));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingItem || !editingItem.id) return;

    try {
      if (isExpenseItem(editingItem)) {
        const expCol = editingItem._collection || 'expenses';
        const updates = {
          amount: editCost,
          cost: editCost,
          profit: -editCost,
          totalProfit: -editCost,
          customerName: editCustomerName,
          paymentMode: editPaymentMode,
          paymentType: editPaymentMode,
          createdAt: editCreatedAt ? Timestamp.fromDate(new Date(editCreatedAt)) : editingItem.createdAt,
          updatedAt: Timestamp.now(),
        };
        await updateDoc(getDocRef(expCol, editingItem.id), updates);
        showSuccess(`Updated expense "${editingItem.title}"`);
        refetchExpenses();
        refetchBilling();
      } else {
        const targetCollection = editingItem.type === 'credit' ? 'creditSales' : 'billingItems';
        const newProfit = (editSellingPrice - (editingItem.cost || 0)) * editQuantity;
        const newTotal = editSellingPrice * editQuantity;
        await updateDoc(getDocRef(targetCollection, editingItem.id), {
          quantity: editQuantity,
          sellingPrice: editSellingPrice,
          totalProfit: newProfit,
          profit: editSellingPrice - (editingItem.cost || 0),
          totalWithGst: newTotal,
          customerName: editCustomerName,
          customerPhone: editCustomerPhone,
          paymentMode: editPaymentMode,
          createdAt: editCreatedAt ? new Date(editCreatedAt) : editingItem.createdAt,
          updatedAt: new Date(),
        });
        showSuccess(`Updated "${editingItem.title}"`);
        refetchBilling();
        refetchCredit();
      }

      setIsEditModalOpen(false);
      setEditingItem(null);
    } catch (err) {
      console.error('Error updating item:', err);
      showError(`Failed to update: ${err}`);
    }
  };

  // ── PDF, Excel, Print & Share Handlers ───────────────────────────────────
  const getRangeName = () => {
    switch (dateRangeType) {
      case 'today':
        return toYYYYMMDD(selectedDayDate) === toYYYYMMDD(new Date())
          ? `Today (${selectedDayDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})`
          : selectedDayDate.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
      case 'yesterday':
        return 'Yesterday';
      case 'week':
        return 'Last 7 Days';
      case 'month':
        return selectedMonthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      case 'year':
        return `Year ${new Date().getFullYear()}`;
      case 'all':
        return 'All Time';
      case 'custom':
        return `${dateRange.start.toLocaleDateString('en-IN')} - ${dateRange.end.toLocaleDateString('en-IN')}`;
      default:
        return '';
    }
  };

  const handleDownloadDailySettlementPDF = useCallback(() => {
    try {
      generateDailySettlementPDF({
        date: dateRangeType === 'today' ? selectedDayDate : dateRange.start,
        shopDetails,
        billingItems: rawSalesItems.filter((i) => i.type !== 'credit'),
        creditItems: rawSalesItems.filter((i) => i.type === 'credit'),
        expenseItems: rawExpenseItems,
        expected: currentExpected,
        settlement: existingSettlement,
        actual: actualValues,
        settledByName: existingSettlement?.settledByName || currentUserDisplayName,
      });
      showSuccess('Daily Report & Settlement PDF downloaded');
    } catch (err) {
      console.error('Error generating daily PDF:', err);
      showError('Failed to generate Daily PDF report');
    }
  }, [
    dateRangeType,
    selectedDayDate,
    dateRange.start,
    shopDetails,
    rawSalesItems,
    rawExpenseItems,
    currentExpected,
    existingSettlement,
    actualValues,
    currentUserDisplayName,
    showSuccess,
    showError,
  ]);

  const handleDownloadMonthlySettlementPDF = useCallback(() => {
    try {
      generateMonthlySettlementPDF({
        monthDate: selectedMonthDate,
        shopDetails,
        monthlyExpected: currentExpected,
        monthlyItems: rawSalesItems.filter((i) => i.type !== 'credit'),
        monthlyCreditItems: rawSalesItems.filter((i) => i.type === 'credit'),
        monthlyExpenseItems: rawExpenseItems,
        dailyBreakdown,
        monthlySettlements,
      });
      showSuccess('Monthly Report & Settlement PDF downloaded');
    } catch (err) {
      console.error('Error generating monthly PDF:', err);
      showError('Failed to generate Monthly PDF report');
    }
  }, [
    selectedMonthDate,
    shopDetails,
    currentExpected,
    rawSalesItems,
    rawExpenseItems,
    dailyBreakdown,
    monthlySettlements,
    showSuccess,
    showError,
  ]);

  const handleDownloadOverallPDF = () => {
    const combinedItems = [...groupedSalesTransactions, ...filteredExpenses];
    if (combinedItems.length === 0) {
      showError('No transactions to download for the selected filters.');
      return;
    }
    generateOverallSalesPDF(combinedItems, shopDetails, getRangeName(), false, 'all');
  };

  const handleShareOverallPDF = async () => {
    const combinedItems = [...groupedSalesTransactions, ...filteredExpenses];
    if (combinedItems.length === 0) {
      showError('No data to share.');
      return;
    }

    const result = generateOverallSalesPDF(combinedItems, shopDetails, getRangeName(), false, 'all', true);
    if (!result) return;
    const { pdfBlob, fileName } = result;

    try {
      if (isAndroidWebView() && window.AndroidInterface) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          window.AndroidInterface?.sharePDF?.(dataUrl, fileName, `Sales Report - ${getRangeName()}`);
        };
        reader.readAsDataURL(pdfBlob);
        return;
      }
      if (navigator.share) {
        const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
        const shareData = { title: `Sales Report - ${getRangeName()}`, text: 'Sales & Settlement Report', files: [file] };
        if (navigator.canShare && navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      }
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch {
      showError('Could not share PDF');
    }
  };

  const handleExportExcel = () => {
    if (groupedSalesTransactions.length === 0 && filteredExpenses.length === 0) {
      showError('No data to export for the selected filters.');
      return;
    }

    try {
      const salesRows: any[] = [];
      let slNo = 1;

      for (const item of groupedSalesTransactions) {
        const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-IN') : 'N/A';
        const sp = getSalesPersonDisplay(item);
        const customer = item.customerName || 'Walk-in';
        const payment = item.paymentMode ? item.paymentMode.toUpperCase() : 'CASH';
        const txId = item.transactionId || item.invoiceNumber || item.id || 'N/A';

        if (item.items && item.items.length > 0) {
          for (const subItem of item.items) {
            const resolved = resolveItemBrandAndCategory(subItem);
            const fin = getItemFinancials(subItem);
            salesRows.push([
              slNo++,
              dateStr,
              txId,
              subItem.title || 'N/A',
              resolved.brand,
              resolved.category,
              customer,
              subItem.quantity || 1,
              subItem.cost || 0,
              fin.rawUnitPrice || subItem.sellingPrice || 0,
              fin.discount,
              fin.netTotal,
              fin.totalProfit,
              payment,
              sp.name,
            ]);
          }
        } else {
          const resolved = resolveItemBrandAndCategory(item);
          const fin = getItemFinancials(item);
          salesRows.push([
            slNo++,
            dateStr,
            txId,
            item.title || 'N/A',
            resolved.brand,
            resolved.category,
            customer,
            item.quantity || 1,
            item.cost || 0,
            fin.rawUnitPrice || (item as any).originalSellingPrice || item.sellingPrice || 0,
            fin.discount,
            fin.netTotal,
            fin.totalProfit,
            payment,
            sp.name,
          ]);
        }
      }

      const expenseRows = filteredExpenses.map((item, index) => {
        const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-IN') : 'N/A';
        const qty = item.quantity || 1;
        const cost = Math.abs(Number((item as any).amount ?? item.cost ?? item.profit ?? 0));
        return [
          index + 1,
          dateStr,
          item.title || 'N/A',
          (item.expenseCategory || 'general').toUpperCase(),
          item.employeeName || item.customerName || 'Store',
          ((item as any).paymentType || item.paymentMode || 'cash').toUpperCase(),
          qty,
          cost,
          cost * qty,
          item.createdByName || 'Staff',
          item._collection || 'expenses',
        ];
      });

      const spSheetRows = salespersonAnalytics.map((sp, idx) => [
        idx + 1,
        sp.name,
        sp.billsCount,
        sp.itemsSold,
        sp.revenue,
        sp.profit,
        sp.discountGiven,
        sp.cashCollected,
        sp.upiCollected,
        sp.cardCollected,
        sp.financeCollected,
        sp.creditPending,
      ]);

      const workbook = XLSX.utils.book_new();

      const dashboardWS = XLSX.utils.aoa_to_sheet([
        ['Unified Sales, Expense & Settlement Report'],
        [`Store: ${currentStore?.name || shopDetails.shopName || 'Digital Zone'}`],
        [`Period: ${getRangeName()}`],
        [],
        ['Metric', 'Value (Rs)'],
        ['Gross Sales', financialStats.totalGrossSales],
        ['Discounts Given', financialStats.totalDiscount],
        ['Net Sales Revenue', financialStats.totalRevenue],
        ['Gross Profit', financialStats.totalProfit],
        ['Total Store Expenses', financialStats.totalExpenses],
        ['Net Operating Profit', financialStats.netProfit],
        ['Net Cash in Drawer (Cash Sales - Cash Expenses)', financialStats.netCashInDrawer],
        [],
        ['Collection Mode', 'Amount (Rs)'],
        ['Cash Sales', financialStats.cashSales],
        ['UPI Sales', financialStats.upiSales],
        ['Card Sales', financialStats.cardSales],
        ['Finance / EMI Sales', financialStats.financeSales],
        ['Customer Credit Sales', financialStats.creditSalesAmount],
      ]);
      XLSX.utils.book_append_sheet(workbook, dashboardWS, 'Summary');

      const salesWS = XLSX.utils.aoa_to_sheet([
        [
          'Sl No',
          'Date',
          'Bill / Invoice No',
          'Product / Service',
          'Brand',
          'Category',
          'Customer',
          'Qty',
          'Cost Price',
          'Selling Price',
          'Discount',
          'Net Revenue',
          'Profit',
          'Payment Mode',
          'Salesperson',
        ],
        ...salesRows,
      ]);
      XLSX.utils.book_append_sheet(workbook, salesWS, 'Sales Transactions');

      const spWS = XLSX.utils.aoa_to_sheet([
        [
          'Rank',
          'Salesperson',
          'Bills',
          'Items Sold',
          'Revenue',
          'Profit',
          'Discounts',
          'Cash',
          'UPI',
          'Card',
          'Finance',
          'Pending Credit',
        ],
        ...spSheetRows,
      ]);
      XLSX.utils.book_append_sheet(workbook, spWS, 'Salesperson Wise');

      const expensesWS = XLSX.utils.aoa_to_sheet([
        [
          'Sl No',
          'Date',
          'Expense Title',
          'Category',
          'Staff / Vendor',
          'Payment Mode',
          'Qty',
          'Unit Amount',
          'Total Amount',
          'Recorded By',
          'Collection',
        ],
        ...expenseRows,
      ]);
      XLSX.utils.book_append_sheet(workbook, expensesWS, 'Expenses');

      const fileDate = toYYYYMMDD(new Date());
      XLSX.writeFile(workbook, `Unified_Sales_Settlement_${fileDate}.xlsx`);
      showSuccess('Complete Excel report exported!');
    } catch (err) {
      console.error('Excel export error:', err);
      showError('Failed to export Excel');
    }
  };

  // GST Audit Export
  const exportAuditExcel = async () => {
    if (isExportingAudit) return;
    setIsExportingAudit(true);
    try {
      const now = new Date();
      let start = new Date(0);
      const end = dayEnd(now);
      if (auditDuration === 'today') start = dayStart(now);
      else if (auditDuration === 'week') {
        start = new Date();
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
      } else if (auditDuration === 'month') {
        start = new Date();
        start.setMonth(now.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
      } else if (auditDuration === 'year') {
        start = new Date();
        start.setFullYear(now.getFullYear() - 1);
        start.setHours(0, 0, 0, 0);
      } else if (auditDuration === 'custom') {
        if (!auditStartDate || !auditEndDate) {
          showError('Select both start and end dates for custom audit export');
          setIsExportingAudit(false);
          return;
        }
        start = dayStart(new Date(auditStartDate));
        end.setTime(dayEnd(new Date(auditEndDate)).getTime());
      }

      const [billingSnap, creditSnap] = await Promise.all([
        getDocs(getCollectionRef('billingItems')),
        getDocs(getCollectionRef('creditSales')),
      ]);

      const allItems: AuditItem[] = [
        ...billingSnap.docs
          .filter((d) => !isExpenseItem(d.data()))
          .map((d): AuditItem => ({ ...d.data(), _id: d.id, _collection: 'billingItems' })),
        ...creditSnap.docs.map((d): AuditItem => ({ ...d.data(), _id: d.id, _collection: 'creditSales' })),
      ];

      const bills = new Map<string, AuditItem[]>();
      for (const item of allItems) {
        const createdAt = toDateValue(item.createdAt);
        if (!createdAt || createdAt < start || createdAt > end) continue;
        const { gstAmount, gstRate } = getAuditLineTax(item);
        const isGstEnabled = item.gstEnabled !== false && (gstRate > 0 || gstAmount > 0);
        if (auditFilterMode === 'gst-only' && !isGstEnabled) continue;
        const key = String(item.transactionId || item.invoiceNumber || item._id);
        if (!bills.has(key)) bills.set(key, []);
        bills.get(key)!.push(item);
      }

      if (bills.size === 0) {
        showError('No matching bills found for audit export.');
        setIsExportingAudit(false);
        return;
      }

      const rows = Array.from(bills.entries())
        .map(([txKey, items]) => {
          const first = items[0];
          const createdAt = toDateValue(first.createdAt) || new Date();
          const lineTaxes = items.map(getAuditLineTax);
          const qty = items.reduce((s, i) => s + toAuditNumber(i.quantity), 0);
          const taxable = lineTaxes.reduce((s, l) => s + l.taxableValue, 0);
          const totalGst = lineTaxes.reduce((s, l) => s + l.gstAmount, 0);
          const cgst = roundToTwo(totalGst / 2);
          const sgst = roundToTwo(totalGst - cgst);
          const total = roundToTwo(lineTaxes.reduce((s, l) => s + l.gross, 0));
          const hsn = Array.from(new Set(items.map((i) => String(i.hsnCode || i.hcsCode || '').trim()).filter(Boolean)));
          return {
            sortTime: createdAt.getTime(),
            cells: [
              0,
              first.customerName || first.creditCustomerName || 'Walk In Customer',
              first.invoiceNumber || first.transactionId || txKey,
              createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
              first.customerGstNo || '',
              hsn.join(', '),
              qty,
              roundToTwo(taxable),
              0,
              cgst,
              sgst,
              total,
            ],
          };
        })
        .sort((a, b) => a.sortTime - b.sortTime);

      rows.forEach((r, idx) => {
        r.cells[0] = idx + 1;
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        [`${shopDetails.shopName || 'Digital Zone'} - GST Audit Export`],
        ['Sl no', 'Customer Name', 'Invoice No', 'Date', 'GST No', 'HSN Code', 'Qty', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total'],
        ...rows.map((r) => r.cells),
      ]);
      XLSX.utils.book_append_sheet(wb, ws, 'GST Audit');
      XLSX.writeFile(wb, `GST_Audit_${toYYYYMMDD(new Date())}.xlsx`);
      showSuccess('GST Audit Excel downloaded');
    } catch (err) {
      console.error('Error exporting GST audit:', err);
      showError('Failed to export GST Audit');
    } finally {
      setIsExportingAudit(false);
    }
  };

  // ── Formatting Helpers ───────────────────────────────────────────────────
  const fmtRs = (amount: number) =>
    '₹' + Math.round(amount || 0).toLocaleString('en-IN');

  const fmtRsExact = (amount: number) =>
    '₹' + (amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtSecretOrCurrency = (amount: number) =>
    showCostCode ? encodePrice(amount) : fmtRs(amount);

  const getPaymentBadge = (mode?: string) => {
    const m = (mode || 'cash').toLowerCase();
    if (m === 'cash') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (m === 'upi') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (m === 'card') return 'bg-purple-50 text-purple-700 border-purple-200';
    if (m === 'finance') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (m === 'split') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    if (m === 'credit') return 'bg-orange-50 text-orange-700 border-orange-200';
    return 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedSalesPerson('');
    setSelectedPaymentMode('');
    setSelectedEntryType('');
    setSalesGstFilter('all');
    setSelectedBrand('');
    setSelectedCategory('');
    setExpenseCategoryFilter('all');
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      selectedSalesPerson ||
      selectedPaymentMode ||
      selectedEntryType ||
      salesGstFilter !== 'all' ||
      selectedBrand ||
      selectedCategory ||
      expenseCategoryFilter !== 'all'
  );

  const totalSalesPages = Math.max(1, Math.ceil(groupedSalesTransactions.length / itemsPerPage));
  const paginatedSales = useMemo(
    () => groupedSalesTransactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [groupedSalesTransactions, currentPage]
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans print:bg-white">
      <div className="print:hidden">
        <Navbar />
      </div>

      <div className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8">
        {/* ═══ COMPACT HEADER (Clean Project Style matching Products.tsx) ═══ */}
        <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Overall Sales
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {groupedSalesTransactions.length} bills recorded • {fmtRs(financialStats.totalRevenue)} net sales
              {currentStore?.name && (
                <span className="text-gray-400 hidden md:inline">
                  {' '}• Location: <strong className="text-gray-700 font-medium">{currentStore.name}</strong>
                </span>
              )}
              {existingSettlement?.status === 'settled' && dateRangeType === 'today' && (
                <span className="text-emerald-600 font-semibold"> • Day Settled</span>
              )}
            </p>
          </div>

          {/* Action Toolbar matching Products.tsx */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Secret / Cost Toggle */}
            <button
              type="button"
              onClick={() => setShowCostCode((prev) => !prev)}
              title={!showCostCode ? 'Showing Actual Cost (₹)' : 'Showing Encoded Secret Code'}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                !showCostCode
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {!showCostCode ? <Unlock className="w-3.5 h-3.5 text-amber-600" /> : <Lock className="w-3.5 h-3.5 text-gray-400" />}
              <span>{!showCostCode ? 'Cost: ₹ Actual' : 'Cost: Code'}</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={loading}
              title="Refresh sales data"
              className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Share */}
            <button
              type="button"
              onClick={handleShareOverallPDF}
              title="Share Report"
              className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5 text-gray-500" />
              <span className="hidden sm:inline">Share</span>
            </button>

            {/* Export Dropdown */}
            <div className="relative" ref={exportDropdownRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="bg-green-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 text-xs">
                  <button
                    onClick={() => {
                      handleExportExcel();
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    📊 Excel Workbook (.xlsx)
                  </button>
                  <button
                    onClick={() => {
                      handleDownloadOverallPDF();
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    📋 Sales Register PDF
                  </button>
                  <button
                    onClick={() => {
                      if (dateRangeType === 'month') {
                        handleDownloadMonthlySettlementPDF();
                      } else {
                        handleDownloadDailySettlementPDF();
                      }
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    📑 {dateRangeType === 'month' ? 'Monthly Settlement PDF' : 'Daily Settlement PDF'}
                  </button>
                  <button
                    onClick={() => {
                      setShowFilterModal(true);
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2 border-t border-gray-100"
                  >
                    ⚖️ CA / GST Audit Export
                  </button>
                </div>
              )}
            </div>

            {/* Add Expense Button */}
            <button
              type="button"
              onClick={() => setShowAddExpenseDrawer(true)}
              className="bg-rose-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-rose-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Expense</span>
              <span className="sm:hidden">Expense</span>
            </button>

            {/* New Bill Button */}
            <button
              type="button"
              onClick={() => navigate('/billing')}
              className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm whitespace-nowrap cursor-pointer"
            >
              <Receipt className="w-4 h-4" />
              <span>New Bill</span>
            </button>
          </div>
        </div>

        {/* ═══ COMPACT STATS (Matching Products.tsx) ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4 print:hidden">
          {/* 1. Net Sales Revenue */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Net Sales</span>
              <span className="p-1 rounded bg-blue-50 text-blue-600">
                <TrendingUp className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="mt-1">
              <p className="text-lg font-bold text-gray-900 font-mono tabular-nums">
                {fmtRs(financialStats.totalRevenue)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                {financialStats.billCount} bills • {financialStats.totalItemsSold} items
              </p>
            </div>
          </div>

          {/* 2. Cash Sales */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Cash Sales</span>
              <span className="p-1 rounded bg-emerald-50 text-emerald-600">
                <Wallet className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="mt-1">
              <p className="text-lg font-bold text-emerald-600 font-mono tabular-nums">
                {fmtRs(financialStats.cashSales)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                Drawer: <strong className="text-gray-700">{fmtRs(financialStats.netCashInDrawer)}</strong>
              </p>
            </div>
          </div>

          {/* 3. UPI & Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">UPI & Card</span>
              <span className="p-1 rounded bg-indigo-50 text-indigo-600">
                <Smartphone className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="mt-1">
              <p className="text-lg font-bold text-indigo-600 font-mono tabular-nums">
                {fmtRs(financialStats.upiSales + financialStats.cardSales)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                UPI {fmtRs(financialStats.upiSales)} • Card {fmtRs(financialStats.cardSales)}
              </p>
            </div>
          </div>

          {/* 4. Expenses */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Expenses</span>
              <span className="p-1 rounded bg-rose-50 text-rose-600">
                <TrendingDown className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="mt-1">
              <p className="text-lg font-bold text-rose-600 font-mono tabular-nums">
                {fmtRs(financialStats.totalExpenses)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                {financialStats.expenseCount} vouchers
              </p>
            </div>
          </div>

          {/* 5. Gross Profit */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Sales Profit</span>
              <span className="p-1 rounded bg-teal-50 text-teal-600">
                <BarChart3 className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="mt-1">
              <p className="text-lg font-bold text-teal-600 font-mono tabular-nums">
                {fmtSecretOrCurrency(financialStats.totalProfit)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                Margin: {financialStats.profitMargin.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* 6. Net Profit */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Net Profit</span>
              <span
                className={`p-1 rounded ${
                  financialStats.netProfit >= 0 ? 'bg-violet-50 text-violet-600' : 'bg-orange-50 text-orange-600'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="mt-1">
              <p
                className={`text-lg font-bold font-mono tabular-nums ${
                  financialStats.netProfit >= 0 ? 'text-violet-600' : 'text-orange-600'
                }`}
              >
                {fmtSecretOrCurrency(financialStats.netProfit)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                After all expenses
              </p>
            </div>
          </div>
        </div>

        {/* ═══ WORKSPACE NAVIGATION TABS (Matching Products.tsx tab styling) ═══ */}
        <div className="flex bg-white rounded-lg p-1 border border-gray-200 mb-3 sm:mb-4 overflow-x-auto hide-scrollbar sm:w-max shadow-sm print:hidden">
          {(
            [
              {
                id: 'sales' as UnifiedTab,
                label: 'Sales Transactions',
                badge: groupedSalesTransactions.length,
                icon: Receipt,
              },
              {
                id: 'salespersons' as UnifiedTab,
                label: 'Salesperson Tracker',
                badge: salespersonAnalytics.filter((s) => s.billsCount > 0).length,
                icon: Users,
              },
              {
                id: 'expenses' as UnifiedTab,
                label: 'Expense Tracker',
                badge: filteredExpenses.length,
                icon: TrendingDown,
              },
              {
                id: 'settlement' as UnifiedTab,
                label: 'Daily & Monthly Settlement',
                badge: existingSettlement?.status === 'settled' ? '✓' : 'Open',
                icon: CheckCircle2,
              },
              {
                id: 'simple-report' as UnifiedTab,
                label: 'Simple Day / Month Report',
                icon: FileText,
              },
              {
                id: 'analytics' as UnifiedTab,
                label: 'Brand & Category Mix',
                badge: brandBreakdown.length,
                icon: Tag,
              },
            ]
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none flex items-center justify-center gap-2 cursor-pointer ${
                  isActive
                    ? 'bg-blue-100 text-blue-700 shadow-sm font-semibold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      isActive ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ═══ COMPACT FILTERS & SEARCH (Matching Products.tsx filter pattern) ═══ */}
        <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm print:hidden">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Period Presets: All, Today, Yesterday, 7 Days, Monthly, Custom */}
            {(
              [
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'week', label: '7 Days' },
                { id: 'month', label: 'Monthly' },
                { id: 'custom', label: 'Custom' },
                { id: 'all', label: 'All Time' },
              ] as { id: DateRangeType; label: string }[]
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectDatePreset(p.id)}
                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all cursor-pointer ${
                  dateRangeType === p.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}

            {/* Inline Day Stepper when in Daily mode */}
            {dateRangeType === 'today' && (
              <div className="inline-flex items-center bg-blue-50 border border-blue-200 rounded-lg px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => navigateSingleDay(-1)}
                  className="p-1 hover:bg-blue-100 rounded text-blue-700 cursor-pointer"
                  title="Previous Day"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <input
                  type="date"
                  value={toYYYYMMDD(selectedDayDate)}
                  onChange={(e) => {
                    const d = new Date(e.target.value + 'T00:00:00');
                    if (!isNaN(d.getTime())) setSelectedDayDate(d);
                  }}
                  className="text-xs font-bold text-blue-900 bg-transparent border-none px-1.5 py-0.5 focus:outline-none cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => navigateSingleDay(1)}
                  disabled={toYYYYMMDD(selectedDayDate) >= toYYYYMMDD(new Date())}
                  className="p-1 hover:bg-blue-100 rounded text-blue-700 disabled:opacity-30 cursor-pointer"
                  title="Next Day"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Inline Month Stepper when in Monthly mode */}
            {dateRangeType === 'month' && (
              <div className="inline-flex items-center bg-indigo-50 border border-indigo-200 rounded-lg px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => navigateSingleMonth(-1)}
                  className="p-1 hover:bg-indigo-100 rounded text-indigo-700 cursor-pointer"
                  title="Previous Month"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-bold text-indigo-900 px-2">
                  {selectedMonthDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  onClick={() => navigateSingleMonth(1)}
                  disabled={toYYYYMM(selectedMonthDate) >= toYYYYMM(new Date())}
                  className="p-1 hover:bg-indigo-100 rounded text-indigo-700 disabled:opacity-30 cursor-pointer"
                  title="Next Month"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Custom Date Range Pickers */}
            {dateRangeType === 'custom' && (
              <div className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="text-xs bg-white border border-gray-300 rounded px-2 py-0.5"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="text-xs bg-white border border-gray-300 rounded px-2 py-0.5"
                />
              </div>
            )}

            {/* Search Input inline matching Products.tsx */}
            <div className="relative flex-1 min-w-[200px] sm:min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search bill #, customer, IMEI, item..."
                className="w-full pl-9 pr-7 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Salesperson Filter Dropdown */}
            <div className="relative">
              <select
                value={selectedSalesPerson}
                onChange={(e) => {
                  setSelectedSalesPerson(e.target.value);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none ${
                  selectedSalesPerson ? 'text-blue-700 font-bold border-blue-400' : 'text-gray-700'
                }`}
              >
                <option value="">All Salespersons</option>
                {availableSalesPersons.map((sp) => (
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Payment Mode Filter */}
            <div className="relative">
              <select
                value={selectedPaymentMode}
                onChange={(e) => {
                  setSelectedPaymentMode(e.target.value);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none ${
                  selectedPaymentMode ? 'text-blue-700 font-bold border-blue-400' : 'text-gray-700'
                }`}
              >
                <option value="">All Payment Modes</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI / QR</option>
                <option value="card">Card</option>
                <option value="finance">Finance / EMI</option>
                <option value="split">Split Payment</option>
                <option value="credit">Credit Due</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* GST / Bill Type Filter */}
            <div className="relative">
              <select
                value={salesGstFilter}
                onChange={(e) => {
                  setSalesGstFilter(e.target.value as 'all' | 'regular' | 'gst');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none ${
                  salesGstFilter !== 'all' ? 'text-emerald-700 font-bold border-emerald-400' : 'text-gray-700'
                }`}
              >
                <option value="all">All Bills ({financialStats.billCount})</option>
                <option value="gst">GST Bills ({financialStats.gstInvoices})</option>
                <option value="regular">Regular Bills ({financialStats.regularInvoices})</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* More Filters Modal Trigger */}
            <button
              type="button"
              onClick={() => setShowFilterModal(true)}
              className={`px-3 py-1.5 sm:py-2 border rounded-lg text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                selectedBrand || selectedCategory || selectedEntryType
                  ? 'bg-blue-50 border-blue-400 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>More Filters</span>
              {(selectedBrand || selectedCategory || selectedEntryType) && (
                <span className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
              )}
            </button>

            {/* Reset Filters */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Active Filter Pills Strip */}
          {hasActiveFilters && (
            <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-gray-400 font-medium">Active filters:</span>
              {selectedSalesPerson && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                  Salesperson: {selectedSalesPerson}
                  <button onClick={() => setSelectedSalesPerson('')} className="hover:text-blue-900 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {selectedPaymentMode && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-semibold border border-purple-200 uppercase">
                  Mode: {selectedPaymentMode}
                  <button onClick={() => setSelectedPaymentMode('')} className="hover:text-purple-900 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {selectedBrand && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
                  Brand: {selectedBrand}
                  <button onClick={() => setSelectedBrand('')} className="hover:text-indigo-900 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {selectedCategory && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                  Category: {selectedCategory}
                  <button onClick={() => setSelectedCategory('')} className="hover:text-amber-900 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {salesGstFilter !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 uppercase">
                  {salesGstFilter} Bills
                  <button onClick={() => setSalesGstFilter('all')} className="hover:text-emerald-900 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* ═══ TAB 1: SALES TRANSACTIONS REGISTER ═══════════════════════════ */}
        {activeTab === 'sales' && (
          <div className="space-y-4">
            {/* Compact Payment Mode Breakdown Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {[
                { label: 'Cash Counter', val: financialStats.cashSales, color: 'text-emerald-700', bg: 'bg-emerald-50/70', border: 'border-emerald-200', mode: 'cash' },
                { label: 'UPI / QR', val: financialStats.upiSales, color: 'text-blue-700', bg: 'bg-blue-50/70', border: 'border-blue-200', mode: 'upi' },
                { label: 'Card POS', val: financialStats.cardSales, color: 'text-purple-700', bg: 'bg-purple-50/70', border: 'border-purple-200', mode: 'card' },
                { label: 'Finance / EMI', val: financialStats.financeSales, color: 'text-amber-700', bg: 'bg-amber-50/70', border: 'border-amber-200', mode: 'finance' },
                { label: 'Credit Sales', val: financialStats.creditSalesAmount, color: 'text-orange-700', bg: 'bg-orange-50/70', border: 'border-orange-200', mode: 'credit' },
              ].map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  onClick={() =>
                    setSelectedPaymentMode((prev) => (prev === m.mode ? '' : m.mode))
                  }
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between ${
                    selectedPaymentMode === m.mode
                      ? `${m.bg} ${m.border} ring-2 ring-blue-500 shadow-sm`
                      : 'bg-white border-gray-200 hover:bg-gray-50 shadow-sm'
                  }`}
                >
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500">{m.label}</p>
                    <p className={`text-sm sm:text-base font-extrabold font-mono tabular-nums mt-0.5 ${m.color}`}>
                      {fmtRs(m.val)}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400">
                    {financialStats.totalRevenue > 0
                      ? `${((m.val / financialStats.totalRevenue) * 100).toFixed(0)}%`
                      : '0%'}
                  </span>
                </button>
              ))}
            </div>

            {/* Salesperson Quick Filter Chips */}
            {salespersonAnalytics.some((s) => s.billsCount > 0) && (
              <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center gap-2 overflow-x-auto shadow-sm">
                <span className="text-xs font-medium text-gray-500 flex items-center gap-1 whitespace-nowrap">
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  Staff Filter:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSalesPerson('')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    !selectedSalesPerson
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All Staff ({financialStats.billCount})
                </button>
                {salespersonAnalytics
                  .filter((sp) => sp.billsCount > 0)
                  .map((sp) => {
                    const isSelected =
                      selectedSalesPerson.toLowerCase() === sp.name.toLowerCase();
                    return (
                      <button
                        key={sp.name}
                        type="button"
                        onClick={() =>
                          setSelectedSalesPerson(isSelected ? '' : sp.name)
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                        }`}
                      >
                        <span>{sp.name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-white text-gray-600'
                          }`}
                        >
                          {sp.billsCount} • {fmtRs(sp.revenue)}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}

            {/* Sales Transactions Table Card */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gray-50/50">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-blue-600" />
                    <span>Sales Bills & Invoice Register</span>
                    <span className="text-xs font-normal text-gray-500">
                      ({groupedSalesTransactions.length} bills)
                    </span>
                  </h2>
                  <p className="text-[11px] text-gray-500">
                    Pure sales register — store expenses are isolated in the separate Expenses collection
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadOverallPDF}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-600" />
                    <span>Sales PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/billing')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Bill</span>
                  </button>
                </div>
              </div>

              {groupedSalesTransactions.length === 0 ? (
                <div className="py-14 text-center px-4">
                  <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-bold text-gray-600">
                    No sales transactions found for {getRangeName()}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Try selecting a different date range or clearing active filters.
                  </p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider font-semibold text-[11px]">
                          <th
                            className="py-3 px-4 cursor-pointer hover:text-gray-900"
                            onClick={() => {
                              setSortBy('date');
                              setSortOrder((p) => (p === 'asc' ? 'desc' : 'asc'));
                            }}
                          >
                            <div className="flex items-center gap-1">
                              <span>Date / Bill #</span>
                              {sortBy === 'date' &&
                                (sortOrder === 'asc' ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ))}
                            </div>
                          </th>
                          <th className="py-3 px-4">Product / Service Details</th>
                          <th className="py-3 px-4">Customer</th>
                          <th className="py-3 px-4">Salesperson</th>
                          <th
                            className="py-3 px-3 text-center cursor-pointer hover:text-gray-900"
                            onClick={() => {
                              setSortBy('quantity');
                              setSortOrder((p) => (p === 'asc' ? 'desc' : 'asc'));
                            }}
                          >
                            Qty
                          </th>
                          <th className="py-3 px-3 text-right">Cost</th>
                          <th
                            className="py-3 px-4 text-right cursor-pointer hover:text-gray-900"
                            onClick={() => {
                              setSortBy('amount');
                              setSortOrder((p) => (p === 'asc' ? 'desc' : 'asc'));
                            }}
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span>Net Amount</span>
                              {sortBy === 'amount' &&
                                (sortOrder === 'asc' ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ))}
                            </div>
                          </th>
                          <th className="py-3 px-3 text-right">Profit</th>
                          <th className="py-3 px-3 text-center">Payment</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 text-gray-800">
                        {paginatedSales.map((item, idx) => {
                          const sp = getSalesPersonDisplay(item);
                          const isMulti = item.items && item.items.length > 1;
                          const netAmt = (item.sellingPrice || 0) * (item.quantity || 1);
                          const discAmt = Number((item as any).discount || item.itemDiscount || 0);
                          const dObj = toDateValue(item.createdAt);

                          return (
                            <tr
                              key={item.transactionId || item.id || idx}
                              onClick={() => {
                                setSelectedViewTransaction(item);
                                setIsViewTransactionModalOpen(true);
                              }}
                              className="hover:bg-blue-50/30 transition-colors cursor-pointer"
                            >
                              <td className="py-3 px-4 whitespace-nowrap align-top">
                                <div className="font-bold text-gray-900">
                                  {dObj ? dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'N/A'}
                                  <span className="text-gray-400 font-normal ml-1.5">
                                    {item.invoiceTime ||
                                      (dObj
                                        ? dObj.toLocaleTimeString('en-IN', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })
                                        : '')}
                                  </span>
                                </div>
                                <div className="text-[11px] font-mono text-blue-600 font-semibold mt-0.5">
                                  {item.invoiceNumber || item.transactionId || item.id?.slice(0, 8)}
                                </div>
                              </td>

                              <td className="py-3 px-4 align-top max-w-xs">
                                {isMulti ? (
                                  <div>
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 mb-1">
                                      <Layers className="w-3 h-3" />
                                      Combined Bill ({item.items!.length} items)
                                    </span>
                                    <ul className="space-y-0.5 text-[11px] text-gray-600 pl-2 border-l-2 border-gray-200">
                                      {item.items!.map((sub, sIdx) => (
                                        <li key={sIdx} className="truncate">
                                          <span className="font-medium text-gray-800">{sub.title}</span>{' '}
                                          <span className="text-gray-400">×{sub.quantity}</span>
                                          {sub.imei && (
                                            <span className="text-[10px] font-mono text-blue-600 ml-1">
                                              [{sub.imei}]
                                            </span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="font-semibold text-gray-900 flex items-center gap-1.5 flex-wrap">
                                      <span>{item.title || 'N/A'}</span>
                                      {item.gstEnabled && (
                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                          GST {item.gstRate ? `${item.gstRate}%` : ''}
                                        </span>
                                      )}
                                      {item.type === 'service' && (
                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                                          SERVICE
                                        </span>
                                      )}
                                    </div>
                                    {item.imei && (
                                      <div className="text-[10px] font-mono text-blue-600 font-semibold mt-0.5">
                                        IMEI: {item.imei}
                                      </div>
                                    )}
                                    {item.brand && item.brand !== 'Other' && (
                                      <div className="text-[10px] text-gray-400 mt-0.5">
                                        {item.brand} • {item.category}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-4 whitespace-nowrap align-top">
                                <div className="font-medium text-gray-900">
                                  {item.customerName || 'Walk-in Customer'}
                                </div>
                                {item.customerPhone && item.customerPhone !== 'N/A' && (
                                  <div className="text-[11px] text-gray-500 font-mono">
                                    {item.customerPhone}
                                  </div>
                                )}
                                {item.customerGstNo && (
                                  <div className="text-[10px] font-mono text-emerald-700 font-semibold">
                                    GST: {item.customerGstNo}
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-4 whitespace-nowrap align-top">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedSalesPerson((prev) =>
                                      prev.toLowerCase() === sp.name.toLowerCase() ? '' : sp.name
                                    );
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-blue-100 text-gray-700 hover:text-blue-800 font-semibold text-xs transition-colors cursor-pointer"
                                  title="Click to filter by this salesperson"
                                >
                                  <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                                    {sp.name.charAt(0).toUpperCase()}
                                  </span>
                                  <span>{sp.name}</span>
                                </button>
                              </td>

                              <td className="py-3 px-3 text-center whitespace-nowrap align-top font-semibold text-gray-700">
                                {isMulti
                                  ? item.items!.reduce((s, i) => s + (i.quantity || 1), 0)
                                  : item.quantity || 1}
                              </td>

                              <td className="py-3 px-3 text-right whitespace-nowrap align-top font-mono text-gray-600">
                                {fmtSecretOrCurrency(item.cost || 0)}
                              </td>

                              <td className="py-3 px-4 text-right whitespace-nowrap align-top">
                                <div className="font-extrabold text-gray-900 font-mono text-sm">
                                  {fmtRs(netAmt)}
                                </div>
                                {discAmt > 0 && (
                                  <div className="text-[10px] text-rose-600 font-semibold">
                                    Disc: -{fmtRs(discAmt)}
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-3 text-right whitespace-nowrap align-top font-bold text-emerald-600 font-mono">
                                {fmtSecretOrCurrency(item.totalProfit || 0)}
                              </td>

                              <td className="py-3 px-3 text-center whitespace-nowrap align-top">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${getPaymentBadge(
                                    item.paymentMode
                                  )}`}
                                >
                                  {item.paymentMode || 'CASH'}
                                </span>
                                {item.paymentMode === 'split' && item.paymentSplit && (
                                  <div className="text-[10px] text-gray-500 mt-0.5">
                                    {item.paymentSplit.cash ? `C:${item.paymentSplit.cash} ` : ''}
                                    {item.paymentSplit.upi ? `U:${item.paymentSplit.upi} ` : ''}
                                    {item.paymentSplit.card ? `Card:${item.paymentSplit.card}` : ''}
                                  </div>
                                )}
                              </td>

                              <td
                                className="py-3 px-4 text-right whitespace-nowrap align-top"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="inline-flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      generateInvoice(item, shopDetails, undefined, false);
                                    }}
                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                    title="Download Invoice"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedShareTransaction(item);
                                      setIsTransactionShareModalOpen(true);
                                    }}
                                    className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer"
                                    title="Share Invoice"
                                  >
                                    <Share2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleEditItem(item)}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                    title="Edit Bill"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteItem(item)}
                                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete Bill"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden divide-y divide-gray-200">
                    {paginatedSales.map((item, idx) => {
                      const sp = getSalesPersonDisplay(item);
                      const isMulti = item.items && item.items.length > 1;
                      const netAmt = (item.sellingPrice || 0) * (item.quantity || 1);
                      const dObj = toDateValue(item.createdAt);

                      return (
                        <div
                          key={item.transactionId || item.id || idx}
                          onClick={() => {
                            setSelectedViewTransaction(item);
                            setIsViewTransactionModalOpen(true);
                          }}
                          className="p-3.5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 text-sm truncate">
                                {isMulti ? `Combined Bill (${item.items!.length} items)` : item.title}
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                <span className="text-[11px] font-mono text-blue-600 font-semibold">
                                  {item.invoiceNumber || item.transactionId || ''}
                                </span>
                                <span className="text-[11px] text-gray-400">
                                  • {dObj ? dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                                </span>
                                <span
                                  className={`px-2 py-0.2 rounded-full text-[10px] font-bold border uppercase ${getPaymentBadge(
                                    item.paymentMode
                                  )}`}
                                >
                                  {item.paymentMode || 'CASH'}
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-base font-extrabold text-gray-900 font-mono">
                                {fmtRs(netAmt)}
                              </p>
                              <p className="text-[11px] font-semibold text-emerald-600 font-mono">
                                P: {fmtSecretOrCurrency(item.totalProfit || 0)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                            <span>Customer: <strong className="text-gray-700">{item.customerName || 'Walk-in'}</strong></span>
                            <span>Sold by: <strong className="text-blue-700">{sp.name}</strong></span>
                          </div>

                          <div
                            className="mt-2.5 pt-2 border-t border-gray-100 flex items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => generateInvoice(item, shopDetails, undefined, false)}
                              className="flex-1 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1"
                            >
                              <Download className="w-3.5 h-3.5" /> Bill
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedShareTransaction(item);
                                setIsTransactionShareModalOpen(true);
                              }}
                              className="flex-1 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1"
                            >
                              <Share2 className="w-3.5 h-3.5" /> Share
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditItem(item)}
                              className="p-1.5 bg-blue-50 text-blue-700 rounded-lg"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(item)}
                              className="p-1.5 bg-rose-50 text-rose-700 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pagination Footer */}
                  {totalSalesPages > 1 && (
                    <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-xs">
                      <span className="text-gray-500 font-medium">
                        Showing page <strong>{currentPage}</strong> of <strong>{totalSalesPages}</strong> ({groupedSalesTransactions.length} total bills)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="px-2.5 py-1 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 cursor-pointer"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          onClick={() => setCurrentPage((p) => Math.min(totalSalesPages, p + 1))}
                          disabled={currentPage === totalSalesPages}
                          className="px-2.5 py-1 bg-white border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 cursor-pointer"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB 2: SALESPERSON SALES & FOLLOW-UP TRACKER ═════════════════ */}
        {activeTab === 'salespersons' && (
          <div className="space-y-4">
            {/* Salesperson Overview Header */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Award className="w-5 h-5 text-blue-600" />
                  <span>Salesperson Performance & Follow-Up Tracker</span>
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Monitor staff sales, cash/UPI collection responsibility, target achievement, and pending credit follow-ups for{' '}
                  <strong className="text-gray-700">{getRangeName()}</strong>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {focusedSalesPerson && (
                  <button
                    type="button"
                    onClick={() => setFocusedSalesPerson(null)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Show All Staff
                  </button>
                )}
              </div>
            </div>

            {/* Salesperson Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {salespersonAnalytics.map((sp, index) => {
                const sharePct =
                  financialStats.totalRevenue > 0
                    ? (sp.revenue / financialStats.totalRevenue) * 100
                    : 0;
                const avgBill = sp.billsCount > 0 ? sp.revenue / sp.billsCount : 0;
                const targetAmt = salesPersonTargets[sp.name.toLowerCase()] || 0;
                const targetPct =
                  targetAmt > 0 ? Math.min(100, (sp.revenue / targetAmt) * 100) : 0;
                const isFocused =
                  focusedSalesPerson?.toLowerCase() === sp.name.toLowerCase();

                return (
                  <div
                    key={sp.name}
                    className={`bg-white rounded-lg border transition-all p-4 flex flex-col justify-between shadow-sm ${
                      isFocused
                        ? 'border-blue-500 ring-2 ring-blue-500/30'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div>
                      {/* Card Top: Rank + Name + Action Buttons */}
                      <div className="flex items-start justify-between gap-2 pb-3 border-b border-gray-100">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center font-extrabold text-sm ${
                              index === 0 && sp.revenue > 0
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : index === 1 && sp.revenue > 0
                                ? 'bg-gray-200 text-gray-800'
                                : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            #{index + 1}
                          </div>
                          <div>
                            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                              <span>{sp.name}</span>
                              {sp.billsCount === 0 && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  No Sales Yet
                                </span>
                              )}
                            </h3>
                            <p className="text-[11px] text-gray-400">
                              {sp.lastSaleAt
                                ? `Last bill: ${sp.lastSaleAt.toLocaleTimeString('en-IN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}`
                                : 'No bills in selected period'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleWhatsAppSalesPersonFollowUp(sp)}
                            className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors cursor-pointer"
                            title="Send WhatsApp Follow-Up Summary"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTargetFor(sp.name);
                              setTargetInputVal(String(targetAmt || ''));
                            }}
                            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[10px] font-semibold cursor-pointer"
                            title="Set Sales Target"
                          >
                            Target
                          </button>
                        </div>
                      </div>

                      {/* Target Input Box (if editing) */}
                      {editingTargetFor === sp.name && (
                        <div className="mt-2.5 p-2.5 bg-blue-50 rounded-lg border border-blue-200 flex items-center gap-2">
                          <input
                            type="number"
                            placeholder="Target ₹..."
                            value={targetInputVal}
                            onChange={(e) => setTargetInputVal(e.target.value)}
                            className="flex-1 px-2.5 py-1 text-xs bg-white border border-blue-300 rounded-lg focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveTarget(sp.name)}
                            className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTargetFor(null)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Primary Metrics */}
                      <div className="grid grid-cols-3 gap-2 my-3">
                        <div className="bg-gray-50 rounded-lg p-2.5">
                          <span className="text-[10px] text-gray-500 font-semibold block">
                            Revenue
                          </span>
                          <span className="text-sm font-extrabold text-blue-700 font-mono">
                            {fmtRs(sp.revenue)}
                          </span>
                          <span className="text-[10px] text-gray-400 block mt-0.5">
                            {sharePct.toFixed(1)}% of store
                          </span>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-2.5">
                          <span className="text-[10px] text-gray-500 font-semibold block">
                            Bills / Qty
                          </span>
                          <span className="text-sm font-extrabold text-gray-900 font-mono">
                            {sp.billsCount} <span className="text-xs font-normal text-gray-500">({sp.itemsSold})</span>
                          </span>
                          <span className="text-[10px] text-gray-400 block mt-0.5">
                            Avg: {fmtRs(avgBill)}
                          </span>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-2.5">
                          <span className="text-[10px] text-gray-500 font-semibold block">
                            Profit
                          </span>
                          <span className="text-sm font-extrabold text-emerald-700 font-mono">
                            {fmtSecretOrCurrency(sp.profit)}
                          </span>
                          <span className="text-[10px] text-gray-400 block mt-0.5">
                            Disc: {fmtRs(sp.discountGiven)}
                          </span>
                        </div>
                      </div>

                      {/* Target Progress Bar if target is set */}
                      {targetAmt > 0 && (
                        <div className="mb-3">
                          <div className="flex justify-between text-[11px] font-semibold mb-1">
                            <span className="text-gray-600">Target: {fmtRs(targetAmt)}</span>
                            <span className="text-blue-700">{targetPct.toFixed(0)}% Achieved</span>
                          </div>
                          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 rounded-full transition-all"
                              style={{ width: `${targetPct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Collection Handover Breakdown (Critical for following up cash with salesperson) */}
                      <div className="bg-gray-50/80 rounded-lg p-2.5 border border-gray-100 space-y-1.5 text-xs">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          Collection Responsibility (To Hand Over)
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <div>
                            <span className="text-[10px] text-gray-500 block">Cash Collected</span>
                            <span className="font-bold text-emerald-700 font-mono">
                              {fmtRs(sp.cashCollected)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-gray-500 block">UPI / QR</span>
                            <span className="font-bold text-blue-700 font-mono">
                              {fmtRs(sp.upiCollected)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-gray-500 block">Card / EMI</span>
                            <span className="font-bold text-purple-700 font-mono">
                              {fmtRs(sp.cardCollected + sp.financeCollected)}
                            </span>
                          </div>
                        </div>
                        {sp.creditPending > 0 && (
                          <div className="pt-1.5 border-t border-gray-200 flex items-center justify-between text-[11px] text-orange-700 font-semibold">
                            <span>⚠️ Pending Credit to Follow Up:</span>
                            <span className="font-mono font-bold">{fmtRs(sp.creditPending)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Footer Buttons */}
                    <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setFocusedSalesPerson(isFocused ? null : sp.name)
                        }
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                          isFocused
                            ? 'bg-blue-600 text-white'
                            : 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{isFocused ? 'Viewing Ledger Below' : `Inspect ${sp.billsCount} Bills`}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSalesPerson(sp.name);
                          setActiveTab('sales');
                        }}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1"
                        title="Filter main sales table by this salesperson"
                      >
                        <span>Filter</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Focused Salesperson Drill-Down Ledger */}
            {focusedSalesPerson && (
              <div className="bg-white rounded-lg border border-blue-500 shadow-sm overflow-hidden">
                <div className="px-4 py-3.5 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-blue-950">
                      📋 Detailed Sales & Follow-Up Ledger: {focusedSalesPerson}
                    </h3>
                    <p className="text-xs text-blue-700">
                      Every bill generated by {focusedSalesPerson} during {getRangeName()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFocusedSalesPerson(null)}
                    className="p-1.5 bg-white hover:bg-blue-100 text-blue-700 rounded-lg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-bold text-[11px]">
                        <th className="py-2.5 px-4">Time & Bill #</th>
                        <th className="py-2.5 px-4">Customer</th>
                        <th className="py-2.5 px-4">Items Sold</th>
                        <th className="py-2.5 px-4 text-center">Payment Mode</th>
                        <th className="py-2.5 px-4 text-right">Discount</th>
                        <th className="py-2.5 px-4 text-right">Net Sale</th>
                        <th className="py-2.5 px-4 text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {salespersonAnalytics
                        .find((s) => s.name.toLowerCase() === focusedSalesPerson.toLowerCase())
                        ?.transactions.map((tx, idx) => {
                          const dObj = toDateValue(tx.createdAt);
                          const amt = (tx.sellingPrice || 0) * (tx.quantity || 1);
                          const disc = Number((tx as any).discount || tx.itemDiscount || 0);
                          return (
                            <tr
                              key={tx.transactionId || tx.id || idx}
                              onClick={() => {
                                setSelectedViewTransaction(tx);
                                setIsViewTransactionModalOpen(true);
                              }}
                              className="hover:bg-blue-50/40 cursor-pointer"
                            >
                              <td className="py-2.5 px-4 font-mono">
                                <span className="font-bold text-blue-600">
                                  {tx.invoiceNumber || tx.transactionId || tx.id?.slice(0, 8)}
                                </span>
                                <span className="block text-[10px] text-gray-400">
                                  {dObj ? dObj.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="font-semibold text-gray-900">
                                  {tx.customerName || 'Walk-in'}
                                </div>
                                {tx.customerPhone && tx.customerPhone !== 'N/A' && (
                                  <div className="text-[10px] text-gray-500">{tx.customerPhone}</div>
                                )}
                              </td>
                              <td className="py-2.5 px-4">
                                {tx.items && tx.items.length > 1
                                  ? tx.items.map((i) => `${i.title} (×${i.quantity})`).join(', ')
                                  : `${tx.title} (×${tx.quantity || 1})`}
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${getPaymentBadge(
                                    tx.paymentMode
                                  )}`}
                                >
                                  {tx.paymentMode}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-rose-600">
                                {disc > 0 ? `-${fmtRs(disc)}` : '—'}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono font-bold text-gray-900">
                                {fmtRs(amt)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-600">
                                {fmtSecretOrCurrency(tx.totalProfit || 0)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB 3: EXPENSE TRACKER & TRANSACTIONS (Separate Collection) ══ */}
        {activeTab === 'expenses' && (
          <div className="space-y-4">
            {/* Collection Separation Banner & Summary */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Database className="w-5 h-5 text-rose-600" />
                    <span>Dedicated Store Expense Tracker</span>
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Saved in Separate &quot;expenses&quot; Collection
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  All store expenses, salaries, and bonuses are saved in the dedicated Firestore <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">expenses</code> collection so they never conflict with sales invoices.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {legacyExpenseCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMigrateLegacyExpenses}
                    disabled={migratingExpenses}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>
                      {migratingExpenses
                        ? 'Migrating...'
                        : `Move ${legacyExpenseCount} Legacy Expense(s) to Separate Collection`}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowAddExpenseDrawer((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{showAddExpenseDrawer ? 'Hide Expense Form' : 'Record New Expense'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/add-expense')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <span>Presets & Full Manager</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Expense Category Breakdown Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { key: 'all', label: 'Total Expenses', val: financialStats.totalExpenses, sub: `${filteredExpenses.length} entries`, color: 'text-rose-600', bg: 'bg-rose-50/60', border: 'border-rose-200' },
                { key: 'general', label: 'General & Bills', val: financialStats.generalExpenses, sub: 'Rent, tea, maintenance', color: 'text-blue-700', bg: 'bg-blue-50/60', border: 'border-blue-200' },
                { key: 'salary', label: 'Staff Salaries', val: financialStats.salaryExpenses, sub: 'Payroll payouts', color: 'text-purple-700', bg: 'bg-purple-50/60', border: 'border-purple-200' },
                { key: 'bonus', label: 'Staff Bonuses', val: financialStats.bonusExpenses, sub: 'Incentives', color: 'text-emerald-700', bg: 'bg-emerald-50/60', border: 'border-emerald-200' },
              ].map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setExpenseCategoryFilter(c.key)}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
                    expenseCategoryFilter === c.key
                      ? `${c.bg} ${c.border} ring-2 ring-rose-500`
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-xs font-semibold text-gray-500">{c.label}</p>
                  <p className={`text-lg font-extrabold font-mono tabular-nums mt-1 ${c.color}`}>
                    {fmtRs(c.val)}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{c.sub}</p>
                </button>
              ))}
            </div>

            {/* Expense Table */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-gray-900">
                    Expense Voucher Transactions ({filteredExpenses.length})
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Cash Expenses: <strong>{fmtRs(financialStats.cashExpenses)}</strong> • UPI Expenses: <strong>{fmtRs(financialStats.upiExpenses)}</strong> • Bank: <strong>{fmtRs(financialStats.bankExpenses)}</strong>
                  </p>
                </div>
              </div>

              {filteredExpenses.length === 0 ? (
                <div className="py-12 text-center px-4">
                  <TrendingDown className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-bold text-gray-600">
                    No expenses recorded for {getRangeName()}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Click &quot;Record New Expense&quot; above to log a store expenditure into the dedicated expenses collection.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-bold text-[11px]">
                        <th className="py-3 px-4">Date & Time</th>
                        <th className="py-3 px-4">Expense Title & Notes</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4">Staff / Paid To</th>
                        <th className="py-3 px-4 text-center">Payment Mode</th>
                        <th className="py-3 px-4 text-center">Collection</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-800">
                      {filteredExpenses.map((exp, idx) => {
                        const dObj = toDateValue(exp.createdAt);
                        const amt =
                          Math.abs(Number((exp as any).amount ?? exp.cost ?? exp.profit ?? 0)) *
                          Number(exp.quantity || 1);
                        const cat = exp.expenseCategory || 'general';
                        const pMode = (exp as any).paymentType || exp.paymentMode || 'cash';

                        return (
                          <tr key={exp.id || idx} className="hover:bg-rose-50/20 transition-colors">
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="font-bold text-gray-900">
                                {dObj ? dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}
                              </div>
                              <div className="text-[10px] text-gray-400">
                                {dObj ? dObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                              </div>
                            </td>

                            <td className="py-3 px-4">
                              <div className="font-bold text-gray-900">{exp.title}</div>
                              {exp.description && (
                                <div className="text-[11px] text-gray-500">{exp.description}</div>
                              )}
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                                  cat === 'salary'
                                    ? 'bg-purple-100 text-purple-700'
                                    : cat === 'bonus'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-blue-100 text-blue-700'
                                }`}
                              >
                                {cat}
                              </span>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              {exp.employeeName ? (
                                <span className="font-semibold text-purple-700">{exp.employeeName}</span>
                              ) : exp.customerName ? (
                                <span className="text-gray-700">{exp.customerName}</span>
                              ) : (
                                <span className="text-gray-400 text-[11px]">By {exp.createdByName || 'Staff'}</span>
                              )}
                            </td>

                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${getPaymentBadge(
                                  pMode
                                )}`}
                              >
                                {pMode}
                              </span>
                            </td>

                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                  exp._collection === 'expenses'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {exp._collection || 'expenses'}
                              </span>
                            </td>

                            <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-extrabold text-rose-600 text-sm">
                              {fmtRsExact(amt)}
                            </td>

                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleEditItem(exp)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                                  title="Edit Expense"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteItem(exp)}
                                  className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                                  title="Delete Expense"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ TAB 4: INTEGRATED DAILY & MONTHLY SETTLEMENT ═════════════════ */}
        {activeTab === 'settlement' && (
          <div className="space-y-4">
            {/* Sub-navigation for Daily / Monthly / History */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center bg-gray-100 p-1 rounded-lg w-full sm:w-auto">
                {(
                  [
                    { id: 'daily', label: 'Daily Settlement', icon: <Calendar className="w-4 h-4" /> },
                    { id: 'monthly', label: 'Monthly Settlement', icon: <BarChart3 className="w-4 h-4" /> },
                    { id: 'history', label: `Audit History (${allSettlements.length})`, icon: <History className="w-4 h-4" /> },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSettlementMode(m.id);
                      if (m.id === 'daily' && dateRangeType !== 'today') {
                        setDateRangeType('today');
                      } else if (m.id === 'monthly' && dateRangeType !== 'month') {
                        setDateRangeType('month');
                      }
                    }}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                      settlementMode === m.id
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {m.icon}
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {settlementMode === 'daily' && (
                  <button
                    type="button"
                    onClick={handleDownloadDailySettlementPDF}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold cursor-pointer"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Download Daily Settlement PDF</span>
                  </button>
                )}
                {settlementMode === 'monthly' && (
                  <button
                    type="button"
                    onClick={handleDownloadMonthlySettlementPDF}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold cursor-pointer"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Download Monthly Settlement PDF</span>
                  </button>
                )}
              </div>
            </div>

            {/* ── DAILY SETTLEMENT VIEW ─────────────────────────────────────── */}
            {settlementMode === 'daily' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left 7 Cols: Expected System Collection & Drawer Math */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <div>
                        <h3 className="text-base font-bold text-gray-900">
                          System Expected Collection ({selectedDayDate.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })})
                        </h3>
                        <p className="text-xs text-gray-500">
                          Auto-calculated from {currentExpected.salesCount} sales items and {currentExpected.expenseCount} expense vouchers
                        </p>
                      </div>
                      {existingSettlement ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Settled by {existingSettlement.settledByName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          <Clock className="w-3.5 h-3.5" />
                          Pending Reconciliation
                        </span>
                      )}
                    </div>

                    {/* Expected Payment Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Cash Sales', val: currentExpected.cash, sub: `Net Drawer: ${fmtRs(currentExpected.cash - financialStats.cashExpenses)}`, color: 'text-emerald-700', bg: 'bg-emerald-50/70', border: 'border-emerald-200' },
                        { label: 'UPI / QR', val: currentExpected.upi, sub: 'Digital wallet / Bank', color: 'text-blue-700', bg: 'bg-blue-50/70', border: 'border-blue-200' },
                        { label: 'POS Card', val: currentExpected.card, sub: 'Card terminal', color: 'text-purple-700', bg: 'bg-purple-50/70', border: 'border-purple-200' },
                        { label: 'Finance / EMI', val: currentExpected.finance, sub: 'Provider disbursal', color: 'text-amber-700', bg: 'bg-amber-50/70', border: 'border-amber-200' },
                        { label: 'Customer Credit', val: currentExpected.credit, sub: 'Credit receivable', color: 'text-orange-700', bg: 'bg-orange-50/70', border: 'border-orange-200' },
                        { label: 'Cheque / Bank', val: currentExpected.cheque, sub: 'Cheque clearance', color: 'text-teal-700', bg: 'bg-teal-50/70', border: 'border-teal-200' },
                      ].map((pm) => (
                        <div key={pm.label} className={`p-3 rounded-lg border ${pm.border} ${pm.bg}`}>
                          <p className="text-xs font-bold text-gray-600">{pm.label}</p>
                          <p className={`text-lg font-extrabold font-mono mt-1 ${pm.color}`}>
                            {fmtRs(pm.val)}
                          </p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{pm.sub}</p>
                        </div>
                      ))}
                    </div>

                    {/* Cash Drawer Reconciliation Formula Box */}
                    <div className="bg-gradient-to-r from-blue-50/70 via-indigo-50/60 to-emerald-50/70 border border-blue-200 text-gray-900 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs shadow-sm">
                      <div>
                        <span className="text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Total Cash Sales</span>
                        <span className="font-mono font-bold text-base text-emerald-700">
                          {fmtRs(currentExpected.cash)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Less: Cash Expenses</span>
                        <span className="font-mono font-bold text-base text-rose-600">
                          -{fmtRs(financialStats.cashExpenses)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Net Cash in Drawer</span>
                        <span className="font-mono font-extrabold text-base text-amber-800">
                          {fmtRs(currentExpected.cash - financialStats.cashExpenses)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Net Day Revenue</span>
                        <span className="font-mono font-extrabold text-base text-blue-800">
                          {fmtRs(currentExpected.totalRevenue)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right 5 Cols: Physical Drawer Count & Sign-Off */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <div>
                        <h3 className="text-base font-bold text-gray-900">
                          Actual Counted Collection
                        </h3>
                        <p className="text-xs text-gray-500">
                          Enter physical cash & verified bank settlements
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={prefillActualWithExpected}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                      >
                        <ArrowUpDown className="w-3.5 h-3.5" />
                        <span>Auto-Fill Expected</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Actual Cash (₹)', val: actualCash, set: setActualCash, exp: currentExpected.cash },
                        { label: 'Actual UPI (₹)', val: actualUpi, set: setActualUpi, exp: currentExpected.upi },
                        { label: 'Actual Card (₹)', val: actualCard, set: setActualCard, exp: currentExpected.card },
                        { label: 'Actual Finance (₹)', val: actualFinance, set: setActualFinance, exp: currentExpected.finance },
                        { label: 'Actual Credit (₹)', val: actualCredit, set: setActualCredit, exp: currentExpected.credit },
                        { label: 'Actual Cheque (₹)', val: actualCheque, set: setActualCheque, exp: currentExpected.cheque },
                      ].map((f) => {
                        const diff = (parseFloat(f.val) || 0) - f.exp;
                        return (
                          <div key={f.label}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-semibold text-gray-700">{f.label}</span>
                              {f.val !== '' && (
                                <span
                                  className={`text-[10px] font-mono font-bold ${
                                    diff === 0
                                      ? 'text-emerald-600'
                                      : diff > 0
                                      ? 'text-blue-600'
                                      : 'text-rose-600'
                                  }`}
                                >
                                  {diff === 0 ? '✓ Match' : diff > 0 ? `+${fmtRs(diff)}` : fmtRs(diff)}
                                </span>
                              )}
                            </div>
                            <input
                              type="number"
                              value={f.val}
                              onChange={(e) => f.set(e.target.value)}
                              placeholder={String(f.exp)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-bold font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Variance Banner */}
                    {(actualCash !== '' || actualUpi !== '' || actualCard !== '') && (
                      <div
                        className={`p-3 rounded-lg border flex items-center justify-between ${
                          settlementDifference.total === 0
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : settlementDifference.total > 0
                            ? 'bg-blue-50 border-blue-200 text-blue-900'
                            : 'bg-rose-50 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {settlementDifference.total === 0 ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-rose-600" />
                          )}
                          <div>
                            <p className="text-xs font-bold">
                              {settlementDifference.total === 0
                                ? 'All Accounts Balanced!'
                                : settlementDifference.total > 0
                                ? 'Surplus Collection'
                                : 'Shortage Detected'}
                            </p>
                            <p className="text-[10px] opacity-80">
                              Cash: {settlementDifference.cash >= 0 ? '+' : ''}
                              {fmtRs(settlementDifference.cash)} • UPI: {settlementDifference.upi >= 0 ? '+' : ''}
                              {fmtRs(settlementDifference.upi)} • Card: {settlementDifference.card >= 0 ? '+' : ''}
                              {fmtRs(settlementDifference.card)}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-extrabold font-mono">
                          {settlementDifference.total >= 0 ? '+' : ''}
                          {fmtRs(settlementDifference.total)}
                        </span>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Settlement Handover Notes (Optional)
                      </label>
                      <textarea
                        rows={2}
                        value={settlementNotes}
                        onChange={(e) => setSettlementNotes(e.target.value)}
                        placeholder="Cash handover remarks, denomination notes, or discrepancy explanation..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveSettlement('daily')}
                      disabled={savingSettlement}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 text-sm cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {savingSettlement
                          ? 'Saving Settlement...'
                          : existingSettlement
                          ? 'Update Daily Settlement'
                          : 'Confirm & Settle Day'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── MONTHLY SETTLEMENT VIEW ───────────────────────────────────── */}
            {settlementMode === 'monthly' && (
              <div className="space-y-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-gray-900">
                      Monthly Financial & Settlement Register —{' '}
                      {selectedMonthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {monthlySettlements.length} of {dailyBreakdown.length} active trading days settled
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveSettlement('monthly')}
                      disabled={savingSettlement}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                    >
                      Sign Off Month Settlement
                    </button>
                  </div>
                </div>

                {/* Day-by-Day Table */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-bold text-[11px]">
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-3 text-center">Entries</th>
                          <th className="py-3 px-4 text-right">Net Sales</th>
                          <th className="py-3 px-4 text-right">Cash</th>
                          <th className="py-3 px-4 text-right">UPI & Card</th>
                          <th className="py-3 px-4 text-right">Expenses</th>
                          <th className="py-3 px-4 text-right">Net Profit</th>
                          <th className="py-3 px-4 text-center">Settlement Status</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dailyBreakdown.map((day) => {
                          const dObj = new Date(day.dateStr + 'T00:00:00');
                          const dayNetProfit = day.expected.totalProfit - day.expected.totalExpenses;
                          return (
                            <tr key={day.dateStr} className="hover:bg-gray-50 transition-colors">
                              <td className="py-3 px-4 font-bold text-gray-900">
                                {dObj.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
                              </td>
                              <td className="py-3 px-3 text-center text-gray-600">{day.count}</td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-blue-700">
                                {fmtRs(day.expected.totalSales)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-emerald-700">
                                {fmtRs(day.expected.cash)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-indigo-700">
                                {fmtRs(day.expected.upi + day.expected.card)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-rose-600">
                                {fmtRs(day.expected.totalExpenses)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-teal-700">
                                {fmtSecretOrCurrency(dayNetProfit)}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {day.settlement ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    <CheckCircle2 className="w-3 h-3" /> Settled
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                    <Clock className="w-3 h-3" /> Open
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedDayDate(dObj);
                                    setDateRangeType('today');
                                    setSettlementMode('daily');
                                  }}
                                  className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold cursor-pointer"
                                >
                                  Open Day →
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {dailyBreakdown.length === 0 && (
                          <tr>
                            <td colSpan={9} className="py-10 text-center text-gray-400">
                              No transactions recorded in this month
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── SETTLEMENT HISTORY VIEW ───────────────────────────────────── */}
            {settlementMode === 'history' && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3.5 border-b border-gray-200 bg-gray-50/50">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900">
                    Past Settlement Audit Log ({allSettlements.length})
                  </h3>
                </div>
                {loadingSettlement ? (
                  <div className="py-12 text-center text-gray-500 text-xs">Loading settlements...</div>
                ) : allSettlements.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-xs">
                    No settlement records saved yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-bold text-[11px]">
                          <th className="py-3 px-4">Date / Period</th>
                          <th className="py-3 px-3 text-center">Type</th>
                          <th className="py-3 px-4 text-right">Expected (Cash+UPI+Card)</th>
                          <th className="py-3 px-4 text-right">Actual Counted</th>
                          <th className="py-3 px-4 text-right">Variance</th>
                          <th className="py-3 px-4">Settled By</th>
                          <th className="py-3 px-4 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {allSettlements.map((s) => {
                          const expTotal = s.expected.cash + s.expected.upi + s.expected.card;
                          const actTotal = s.actual.cash + s.actual.upi + s.actual.card;
                          const diff = s.difference.total;
                          return (
                            <tr key={s.id} className="hover:bg-gray-50">
                              <td className="py-3 px-4 font-bold text-gray-900">{s.date}</td>
                              <td className="py-3 px-3 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                    s.type === 'daily'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-violet-100 text-violet-700'
                                  }`}
                                >
                                  {s.type}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-semibold">
                                {fmtRs(expTotal)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold">
                                {fmtRs(actTotal)}
                              </td>
                              <td
                                className={`py-3 px-4 text-right font-mono font-bold ${
                                  diff === 0
                                    ? 'text-emerald-600'
                                    : diff > 0
                                    ? 'text-blue-600'
                                    : 'text-rose-600'
                                }`}
                              >
                                {diff >= 0 ? '+' : ''}
                                {fmtRs(diff)}
                              </td>
                              <td className="py-3 px-4 text-gray-600">{s.settledByName}</td>
                              <td className="py-3 px-4 text-center">
                                <button
                                  type="button"
                                  onClick={() => setDetailSettlement(s)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                                  title="View Audit Details"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB 5: SIMPLE DAILY / MONTHLY REPORT SHEET (Everything in 1 View) ═ */}
        {activeTab === 'simple-report' && (
          <div className="space-y-4">
            {/* Report Control Bar */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
              <div className="flex items-center gap-2">
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setReportPeriodMode('daily');
                      setDateRangeType('today');
                    }}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      reportPeriodMode === 'daily'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Simple Daily Report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReportPeriodMode('monthly');
                      setDateRangeType('month');
                    }}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      reportPeriodMode === 'monthly'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Simple Monthly Report
                  </button>
                </div>
                <span className="text-xs text-gray-500 hidden md:inline">
                  Complete one-sheet financial statement for{' '}
                  <strong className="text-gray-800">{getRangeName()}</strong>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Sheet</span>
                </button>
                <button
                  type="button"
                  onClick={
                    reportPeriodMode === 'monthly'
                      ? handleDownloadMonthlySettlementPDF
                      : handleDownloadDailySettlementPDF
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Download Official PDF</span>
                </button>
              </div>
            </div>

            {/* Printable Professional Report Sheet */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 sm:p-8 max-w-5xl mx-auto space-y-6 print:border-none print:shadow-none print:p-0">
              {/* Sheet Header */}
              <div className="border-b-2 border-blue-600 pb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-gray-900 uppercase tracking-tight">
                    {currentStore?.name || shopDetails.shopName || 'DIGITAL ZONE'}
                  </h2>
                  {shopDetails.address && (
                    <p className="text-xs text-gray-600 mt-0.5">{shopDetails.address}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-0.5">
                    {shopDetails.phone && `Ph: ${shopDetails.phone}`}
                    {shopDetails.gst && ` • GSTIN: ${shopDetails.gst}`}
                  </p>
                </div>

                <div className="sm:text-right">
                  <span className="inline-block px-3 py-1 bg-blue-600 text-white text-xs font-bold uppercase tracking-wider rounded-md">
                    {reportPeriodMode === 'monthly'
                      ? 'COMPLETE MONTHLY REPORT'
                      : 'COMPLETE DAILY REPORT'}
                  </span>
                  <p className="text-sm font-extrabold text-gray-900 mt-1.5">
                    Period: {getRangeName()}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Generated: {new Date().toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              {/* Section 1: Complete Financial Statement */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 mb-2.5">
                  1. Executive Financial Summary
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">
                      Gross Sales ({financialStats.billCount} Bills)
                    </span>
                    <span className="text-base sm:text-lg font-extrabold font-mono text-gray-900 mt-0.5 block">
                      {fmtRs(financialStats.totalGrossSales)}
                    </span>
                    <span className="text-[10px] text-rose-600 font-semibold">
                      Discounts: -{fmtRs(financialStats.totalDiscount)}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/40">
                    <span className="text-[10px] font-bold text-blue-700 uppercase block">
                      Net Sales Revenue
                    </span>
                    <span className="text-base sm:text-lg font-extrabold font-mono text-blue-800 mt-0.5 block">
                      {fmtRs(financialStats.totalRevenue)}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {financialStats.totalItemsSold} units sold
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-rose-200 bg-rose-50/40">
                    <span className="text-[10px] font-bold text-rose-700 uppercase block">
                      Total Store Expenses
                    </span>
                    <span className="text-base sm:text-lg font-extrabold font-mono text-rose-700 mt-0.5 block">
                      {fmtRs(financialStats.totalExpenses)}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {financialStats.expenseCount} expense vouchers
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/40">
                    <span className="text-[10px] font-bold text-emerald-800 uppercase block">
                      Net Operating Profit
                    </span>
                    <span className="text-base sm:text-lg font-extrabold font-mono text-emerald-800 mt-0.5 block">
                      {fmtSecretOrCurrency(financialStats.netProfit)}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      Gross Profit: {fmtSecretOrCurrency(financialStats.totalProfit)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: Payment Collection & Cash Drawer Balance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-100 px-3.5 py-2 font-bold text-xs text-gray-800 uppercase">
                    2A. Payment Mode Collections
                  </div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">Cash Sales</td>
                        <td className="py-2 px-3.5 text-right font-mono font-bold text-gray-900">
                          {fmtRs(financialStats.cashSales)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">UPI / QR Collections</td>
                        <td className="py-2 px-3.5 text-right font-mono font-bold text-gray-900">
                          {fmtRs(financialStats.upiSales)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">Card (POS) Collections</td>
                        <td className="py-2 px-3.5 text-right font-mono font-bold text-gray-900">
                          {fmtRs(financialStats.cardSales)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">Finance / EMI Sales</td>
                        <td className="py-2 px-3.5 text-right font-mono font-bold text-gray-900">
                          {fmtRs(financialStats.financeSales)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">Credit Sales (Due)</td>
                        <td className="py-2 px-3.5 text-right font-mono font-bold text-orange-700">
                          {fmtRs(financialStats.creditSalesAmount)}
                        </td>
                      </tr>
                      <tr className="bg-gray-50 font-extrabold">
                        <td className="py-2 px-3.5 text-gray-900">Total Sales Revenue</td>
                        <td className="py-2 px-3.5 text-right font-mono text-blue-700">
                          {fmtRs(financialStats.totalRevenue)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-100 px-3.5 py-2 font-bold text-xs text-gray-800 uppercase">
                    2B. Cash Drawer & Expense Summary
                  </div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">Opening / System Cash Sales</td>
                        <td className="py-2 px-3.5 text-right font-mono font-bold text-emerald-700">
                          +{fmtRs(financialStats.cashSales)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">Less: Cash Expenses Paid</td>
                        <td className="py-2 px-3.5 text-right font-mono font-bold text-rose-600">
                          -{fmtRs(financialStats.cashExpenses)}
                        </td>
                      </tr>
                      <tr className="bg-amber-50/60 font-extrabold">
                        <td className="py-2 px-3.5 text-gray-900">Net Expected Cash in Drawer</td>
                        <td className="py-2 px-3.5 text-right font-mono text-gray-900">
                          {fmtRs(financialStats.netCashInDrawer)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">General Store Expenses</td>
                        <td className="py-2 px-3.5 text-right font-mono text-gray-700">
                          {fmtRs(financialStats.generalExpenses)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3.5 text-gray-600">Staff Salaries & Bonuses</td>
                        <td className="py-2 px-3.5 text-right font-mono text-gray-700">
                          {fmtRs(financialStats.salaryExpenses + financialStats.bonusExpenses)}
                        </td>
                      </tr>
                      <tr className="bg-gray-50 font-extrabold">
                        <td className="py-2 px-3.5 text-gray-900">Settlement Status</td>
                        <td className="py-2 px-3.5 text-right">
                          {existingSettlement?.status === 'settled' ? (
                            <span className="text-emerald-700">
                              SETTLED (Diff: {fmtRs(existingSettlement.difference.total)})
                            </span>
                          ) : (
                            <span className="text-amber-700">OPEN / UNSETTLED</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 3: Salesperson-Wise Summary */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 mb-2">
                  3. Salesperson-Wise Sales & Collection Summary
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 font-bold">
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Salesperson Name</th>
                        <th className="py-2 px-3 text-center">Bills</th>
                        <th className="py-2 px-3 text-center">Qty Sold</th>
                        <th className="py-2 px-3 text-right">Cash</th>
                        <th className="py-2 px-3 text-right">UPI / Card</th>
                        <th className="py-2 px-3 text-right">Total Sales</th>
                        <th className="py-2 px-3 text-right">Share %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {salespersonAnalytics.filter((s) => s.billsCount > 0).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-4 text-center text-gray-400">
                            No salesperson sales in this period
                          </td>
                        </tr>
                      ) : (
                        salespersonAnalytics
                          .filter((s) => s.billsCount > 0)
                          .map((sp, i) => (
                            <tr key={sp.name}>
                              <td className="py-2 px-3 text-gray-500">{i + 1}</td>
                              <td className="py-2 px-3 font-bold text-gray-900">{sp.name}</td>
                              <td className="py-2 px-3 text-center">{sp.billsCount}</td>
                              <td className="py-2 px-3 text-center">{sp.itemsSold}</td>
                              <td className="py-2 px-3 text-right font-mono">{fmtRs(sp.cashCollected)}</td>
                              <td className="py-2 px-3 text-right font-mono">
                                {fmtRs(sp.upiCollected + sp.cardCollected + sp.financeCollected)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-gray-900">
                                {fmtRs(sp.revenue)}
                              </td>
                              <td className="py-2 px-3 text-right text-gray-600">
                                {financialStats.totalRevenue > 0
                                  ? `${((sp.revenue / financialStats.totalRevenue) * 100).toFixed(1)}%`
                                  : '0%'}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 4: Itemized Sales Register (or Day-by-Day if Monthly) */}
              {reportPeriodMode === 'monthly' ? (
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 mb-2">
                    4. Monthly Day-by-Day Summary ({dailyBreakdown.length} Active Days)
                  </h3>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 font-bold">
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3 text-center">Entries</th>
                          <th className="py-2 px-3 text-right">Net Sales</th>
                          <th className="py-2 px-3 text-right">Cash</th>
                          <th className="py-2 px-3 text-right">UPI + Card</th>
                          <th className="py-2 px-3 text-right">Expenses</th>
                          <th className="py-2 px-3 text-right">Net Profit</th>
                          <th className="py-2 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dailyBreakdown.map((d) => (
                          <tr key={d.dateStr}>
                            <td className="py-2 px-3 font-semibold text-gray-900">{d.dateStr}</td>
                            <td className="py-2 px-3 text-center">{d.count}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold">
                              {fmtRs(d.expected.totalSales)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{fmtRs(d.expected.cash)}</td>
                            <td className="py-2 px-3 text-right font-mono">
                              {fmtRs(d.expected.upi + d.expected.card)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-rose-600">
                              {fmtRs(d.expected.totalExpenses)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700">
                              {fmtSecretOrCurrency(d.expected.totalProfit - d.expected.totalExpenses)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {d.settlement ? 'Settled' : 'Open'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 mb-2">
                    4. Itemized Sales Bills ({groupedSalesTransactions.length} Bills)
                  </h3>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 font-bold">
                          <th className="py-2 px-3">#</th>
                          <th className="py-2 px-3">Time / Bill #</th>
                          <th className="py-2 px-3">Customer</th>
                          <th className="py-2 px-3">Product / Service</th>
                          <th className="py-2 px-3">Sold By</th>
                          <th className="py-2 px-3 text-center">Mode</th>
                          <th className="py-2 px-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {groupedSalesTransactions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-4 text-center text-gray-400">
                              No sales bills recorded
                            </td>
                          </tr>
                        ) : (
                          groupedSalesTransactions.map((tx, idx) => {
                            const sp = getSalesPersonDisplay(tx);
                            const amt = (tx.sellingPrice || 0) * (tx.quantity || 1);
                            const dObj = toDateValue(tx.createdAt);
                            return (
                              <tr key={tx.transactionId || tx.id || idx}>
                                <td className="py-1.5 px-3 text-gray-500">{idx + 1}</td>
                                <td className="py-1.5 px-3 font-mono text-[11px]">
                                  <span className="font-bold text-gray-900">
                                    {tx.invoiceNumber || tx.transactionId || tx.id?.slice(0, 8)}
                                  </span>
                                  <span className="text-gray-400 ml-1">
                                    {dObj
                                      ? dObj.toLocaleTimeString('en-IN', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : ''}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3">{tx.customerName || 'Walk-in'}</td>
                                <td className="py-1.5 px-3">
                                  {tx.items && tx.items.length > 1
                                    ? tx.items.map((i) => `${i.title} (×${i.quantity})`).join(', ')
                                    : `${tx.title} (×${tx.quantity || 1})`}
                                </td>
                                <td className="py-1.5 px-3 font-medium">{sp.name}</td>
                                <td className="py-1.5 px-3 text-center uppercase text-[10px] font-bold">
                                  {tx.paymentMode}
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono font-bold">
                                  {fmtRs(amt)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Section 5: Itemized Expenses */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 mb-2">
                  5. Itemized Store Expenses ({filteredExpenses.length} Entries)
                </h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 font-bold">
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Date / Time</th>
                        <th className="py-2 px-3">Expense Description</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3">Staff / Paid To</th>
                        <th className="py-2 px-3 text-center">Mode</th>
                        <th className="py-2 px-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredExpenses.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-4 text-center text-gray-400">
                            No expenses recorded for this period
                          </td>
                        </tr>
                      ) : (
                        filteredExpenses.map((exp, idx) => {
                          const dObj = toDateValue(exp.createdAt);
                          const amt =
                            Math.abs(Number((exp as any).amount ?? exp.cost ?? exp.profit ?? 0)) *
                            Number(exp.quantity || 1);
                          return (
                            <tr key={exp.id || idx}>
                              <td className="py-1.5 px-3 text-gray-500">{idx + 1}</td>
                              <td className="py-1.5 px-3 text-[11px]">
                                {dObj ? dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}{' '}
                                {dObj ? dObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                              </td>
                              <td className="py-1.5 px-3 font-semibold text-gray-900">{exp.title}</td>
                              <td className="py-1.5 px-3 uppercase text-[10px]">
                                {exp.expenseCategory || 'general'}
                              </td>
                              <td className="py-1.5 px-3">
                                {exp.employeeName || exp.customerName || exp.createdByName || 'Store'}
                              </td>
                              <td className="py-1.5 px-3 text-center uppercase text-[10px]">
                                {(exp as any).paymentType || exp.paymentMode || 'cash'}
                              </td>
                              <td className="py-1.5 px-3 text-right font-mono font-bold text-rose-600">
                                {fmtRs(amt)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Signatures Footer */}
              <div className="pt-6 border-t border-gray-200 grid grid-cols-2 gap-8 text-xs text-gray-600">
                <div>
                  <p className="font-bold text-gray-800">Prepared & Reconciled By:</p>
                  <p className="mt-8 border-t border-gray-300 pt-1 w-48">
                    {existingSettlement?.settledByName || currentUserDisplayName} (Cashier / Staff)
                  </p>
                </div>
                <div className="text-right flex flex-col items-end">
                  <p className="font-bold text-gray-800">Verified & Approved By:</p>
                  <p className="mt-8 border-t border-gray-300 pt-1 w-48">
                    Authorized Signatory ({shopDetails.shopName || 'Digital Zone'})
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ TAB 6: BRAND & CATEGORY ANALYTICS ════════════════════════════ */}
        {activeTab === 'analytics' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Brand Breakdown */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
                <h3 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-blue-600" />
                  <span>Brand-Wise Performance ({brandBreakdown.length})</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-bold text-[11px]">
                      <th className="py-2.5 px-4">#</th>
                      <th className="py-2.5 px-4">Brand</th>
                      <th className="py-2.5 px-3 text-right">Qty Sold</th>
                      <th className="py-2.5 px-4 text-right">Revenue</th>
                      <th className="py-2.5 px-4 text-right">Profit</th>
                      <th className="py-2.5 px-3 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {brandBreakdown.map((item, idx) => {
                      const margin = item.revenue > 0 ? (item.profit / item.revenue) * 100 : 0;
                      return (
                        <tr
                          key={item.brand}
                          onClick={() => {
                            setSelectedBrand(item.brand);
                            setActiveTab('sales');
                          }}
                          className="hover:bg-blue-50/30 cursor-pointer"
                        >
                          <td className="py-2.5 px-4 text-gray-400">{idx + 1}</td>
                          <td className="py-2.5 px-4 font-bold text-gray-900">{item.brand}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{item.quantity}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-gray-900">
                            {fmtRs(item.revenue)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-600">
                            {fmtSecretOrCurrency(item.profit)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-blue-600 font-semibold">
                            {margin.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                    {brandBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-gray-400">
                          No brand data for selected period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-200 flex items-center justify-between bg-gray-50/50">
                <h3 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                  <Grid3x3 className="w-4 h-4 text-indigo-600" />
                  <span>Category-Wise Performance ({categoryBreakdown.length})</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-bold text-[11px]">
                      <th className="py-2.5 px-4">#</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-3 text-right">Qty Sold</th>
                      <th className="py-2.5 px-4 text-right">Revenue</th>
                      <th className="py-2.5 px-4 text-right">Profit</th>
                      <th className="py-2.5 px-3 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {categoryBreakdown.map((item, idx) => {
                      const margin = item.revenue > 0 ? (item.profit / item.revenue) * 100 : 0;
                      return (
                        <tr
                          key={item.category}
                          onClick={() => {
                            setSelectedCategory(item.category);
                            setActiveTab('sales');
                          }}
                          className="hover:bg-indigo-50/30 cursor-pointer"
                        >
                          <td className="py-2.5 px-4 text-gray-400">{idx + 1}</td>
                          <td className="py-2.5 px-4 font-bold text-gray-900">{item.category}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{item.quantity}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-gray-900">
                            {fmtRs(item.revenue)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-600">
                            {fmtSecretOrCurrency(item.profit)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-indigo-600 font-semibold">
                            {margin.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                    {categoryBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-gray-400">
                          No category data for selected period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ QUICK RECORD EXPENSE MODAL (Saves to `expenses` Collection) ═══ */}
      {showAddExpenseDrawer && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowAddExpenseDrawer(false)}
        >
          <div
            className="bg-white rounded-lg border border-gray-200 shadow-xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-rose-50/50">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-rose-600" />
                  <span>Record Store Expense</span>
                </h3>
                <p className="text-[11px] text-gray-500">
                  Saved directly to the separate <code className="bg-white px-1 rounded">expenses</code> collection
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddExpenseDrawer(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddQuickExpense} className="p-5 space-y-3.5">
              {/* Category Selector */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Expense Category
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'general' as const, label: 'General', icon: <Building2 className="w-3.5 h-3.5" /> },
                    { id: 'salary' as const, label: 'Salary', icon: <Briefcase className="w-3.5 h-3.5" /> },
                    { id: 'bonus' as const, label: 'Bonus', icon: <Gift className="w-3.5 h-3.5" /> },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setExpCategory(c.id)}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                        expCategory === c.id
                          ? 'bg-rose-50 border-rose-500 text-rose-800 ring-1 ring-rose-500'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {c.icon}
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {(expCategory === 'salary' || expCategory === 'bonus') && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Select Staff Member <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={expEmployeeId}
                    onChange={(e) => setExpEmployeeId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  >
                    <option value="">-- Choose Employee --</option>
                    {employeesList.map((emp) => (
                      <option key={emp.uid} value={emp.uid}>
                        {emp.displayName || emp.name || emp.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Expense Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  placeholder="e.g. Tea & Snacks, Shop Rent, Electricity, Courier..."
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {['Tea & Snacks', 'Electricity Bill', 'Shop Maintenance', 'Travel & Fuel', 'Courier', 'Cleaning'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setExpTitle(preset)}
                        className="px-2 py-0.5 bg-gray-100 hover:bg-rose-50 hover:text-rose-700 text-gray-600 rounded text-[10px] font-medium cursor-pointer"
                      >
                        + {preset}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Amount (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="any"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm font-bold font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Payment Mode
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['cash', 'upi', 'card', 'bank'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExpPaymentMode(m)}
                      className={`py-1.5 rounded-lg text-xs font-bold uppercase border cursor-pointer ${
                        expPaymentMode === m
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Notes / Voucher Ref (Optional)
                </label>
                <input
                  type="text"
                  value={expDescription}
                  onChange={(e) => setExpDescription(e.target.value)}
                  placeholder="Optional voucher # or remarks..."
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddExpenseDrawer(false)}
                  className="flex-1 py-2.5 border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingExpense}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {savingExpense ? 'Saving...' : 'Save to Expenses'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ ADVANCED FILTER & GST AUDIT EXPORT MODAL ══════════════════════ */}
      {showFilterModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowFilterModal(false)}
        >
          <div
            className="bg-white rounded-lg border border-gray-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-blue-600" />
                <h2 className="text-base font-bold text-gray-900">
                  Advanced Filters & GST Audit Export
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowFilterModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Brand, Category & Entry Type Filters */}
              <div className="space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
                  Product & Entry Filters
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Brand
                    </label>
                    <select
                      value={selectedBrand}
                      onChange={(e) => setSelectedBrand(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">All Brands</option>
                      {availableBrands.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">All Categories</option>
                      {availableCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Sale Type
                    </label>
                    <select
                      value={selectedEntryType}
                      onChange={(e) => setSelectedEntryType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">All Types</option>
                      <option value="product">Product Sales</option>
                      <option value="service">Service Jobs</option>
                      <option value="credit">Credit Sales</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* GST Audit Export Section */}
              <div className="pt-4 border-t border-gray-200 space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
                  CA / GST Audit Excel Export
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Invoice Scope
                    </label>
                    <select
                      value={auditFilterMode}
                      onChange={(e) => setAuditFilterMode(e.target.value as AuditFilterMode)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="gst-only">GST Tax Invoices Only</option>
                      <option value="all-bills">All Sales Invoices</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Audit Duration
                    </label>
                    <select
                      value={auditDuration}
                      onChange={(e) => setAuditDuration(e.target.value as AuditDuration)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="today">Today</option>
                      <option value="week">Last 7 Days</option>
                      <option value="month">Last 30 Days</option>
                      <option value="year">Last 1 Year</option>
                      <option value="all">All Time</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>
                </div>

                {auditDuration === 'custom' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={auditStartDate}
                        onChange={(e) => setAuditStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={auditEndDate}
                        onChange={(e) => setAuditEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={exportAuditExcel}
                  disabled={isExportingAudit}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isExportingAudit ? 'Generating Audit Sheet...' : 'Download CA / GST Audit Excel'}
                </button>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <button
                type="button"
                onClick={resetAllFilters}
                className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
              >
                Reset All Filters
              </button>
              <button
                type="button"
                onClick={() => setShowFilterModal(false)}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ SETTLEMENT DETAIL AUDIT MODAL ═════════════════════════════════ */}
      {detailSettlement && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDetailSettlement(null)}
        >
          <div
            className="bg-white rounded-lg border border-gray-200 shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="text-base font-bold text-gray-900">
                Settlement Audit Details ({detailSettlement.date})
              </h3>
              <button
                type="button"
                onClick={() => setDetailSettlement(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-emerald-50 rounded-lg">
                  <span className="text-emerald-700 font-semibold block">Total Sales</span>
                  <span className="text-base font-extrabold text-emerald-900 font-mono">
                    {fmtRs(detailSettlement.expected.totalSales)}
                  </span>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg">
                  <span className="text-rose-700 font-semibold block">Total Expenses</span>
                  <span className="text-base font-extrabold text-rose-900 font-mono">
                    {fmtRs(detailSettlement.expected.totalExpenses)}
                  </span>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-2 px-3">Mode</th>
                      <th className="text-right py-2 px-3">Expected</th>
                      <th className="text-right py-2 px-3">Actual</th>
                      <th className="text-right py-2 px-3">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[
                      { label: 'Cash', exp: detailSettlement.expected.cash, act: detailSettlement.actual.cash },
                      { label: 'UPI', exp: detailSettlement.expected.upi, act: detailSettlement.actual.upi },
                      { label: 'Card', exp: detailSettlement.expected.card, act: detailSettlement.actual.card },
                      { label: 'Finance', exp: detailSettlement.expected.finance, act: detailSettlement.actual.finance },
                      { label: 'Credit', exp: detailSettlement.expected.credit, act: detailSettlement.actual.credit },
                      { label: 'Cheque', exp: detailSettlement.expected.cheque, act: detailSettlement.actual.cheque },
                    ].map((r) => {
                      const d = r.act - r.exp;
                      return (
                        <tr key={r.label}>
                          <td className="py-2 px-3 font-semibold">{r.label}</td>
                          <td className="py-2 px-3 text-right font-mono">{fmtRs(r.exp)}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold">{fmtRs(r.act)}</td>
                          <td
                            className={`py-2 px-3 text-right font-mono font-bold ${
                              d === 0 ? 'text-emerald-600' : d > 0 ? 'text-blue-600' : 'text-rose-600'
                            }`}
                          >
                            {d >= 0 ? '+' : ''}
                            {fmtRs(d)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {detailSettlement.notes && (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="font-bold text-gray-700 block mb-0.5">Settlement Notes:</span>
                  <p className="text-gray-600">{detailSettlement.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ EDIT ITEM / EXPENSE MODAL ═════════════════════════════════════ */}
      {isEditModalOpen && editingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-gray-200 shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">
                {isExpenseItem(editingItem) ? 'Edit Expense Entry' : 'Edit Billing Entry'}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={editingItem.title}
                  disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  {isExpenseItem(editingItem) ? 'Vendor / Staff Name' : 'Customer Name'}
                </label>
                <input
                  type="text"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              {isExpenseItem(editingItem) ? (
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    Expense Amount (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editCost}
                    onChange={(e) => setEditCost(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono font-bold"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={editQuantity}
                      onChange={(e) => setEditQuantity(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">
                      Selling Price (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editSellingPrice}
                      onChange={(e) => setEditSellingPrice(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono font-bold"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-gray-700 mb-1">Date & Time</label>
                <input
                  type="datetime-local"
                  value={editCreatedAt}
                  onChange={(e) => setEditCreatedAt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DELETE CONFIRMATION MODAL ═════════════════════════════════════ */}
      {itemToDelete && (
        <CustomModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleConfirmDelete}
          title={isExpenseItem(itemToDelete) ? 'Delete Expense Voucher' : 'Delete Sales Transaction'}
          message={
            isExpenseItem(itemToDelete)
              ? `Are you sure you want to delete expense "${itemToDelete.title}" of ${fmtRs(
                  Math.abs(Number((itemToDelete as any).amount ?? itemToDelete.cost ?? 0))
                )}?`
              : itemToDelete.items && itemToDelete.items.length > 1
              ? `Are you sure you want to delete this Combined Bill (${
                  itemToDelete.items.length
                } items) totaling ${fmtRs(
                  itemToDelete.sellingPrice
                )}? Product stock will be restored automatically.`
              : `Are you sure you want to delete "${itemToDelete.title}" (${fmtRs(
                  (itemToDelete.sellingPrice || 0) * (itemToDelete.quantity || 1)
                )})? Product stock will be restored automatically.`
          }
          type="delete"
          confirmText="Delete"
          cancelText="Cancel"
        />
      )}

      {/* ═══ SHARE TRANSACTION MODAL ═══════════════════════════════════════ */}
      {selectedShareTransaction && shopDetails && (
        <ShareModal
          isOpen={isTransactionShareModalOpen}
          onClose={() => {
            setIsTransactionShareModalOpen(false);
            setSelectedShareTransaction(null);
          }}
          item={selectedShareTransaction}
          shopDetails={shopDetails}
          initialCustomerName={selectedShareTransaction.customerName}
          initialCustomerPhone={selectedShareTransaction.customerPhone}
        />
      )}

      {/* ═══ VIEW TRANSACTION DETAILS MODAL ════════════════════════════════ */}
      {selectedViewTransaction && (
        <TransactionDetailsModal
          isOpen={isViewTransactionModalOpen}
          onClose={() => {
            setIsViewTransactionModalOpen(false);
            setSelectedViewTransaction(null);
          }}
          transaction={selectedViewTransaction}
        />
      )}
    </div>
  );
};

export default OverallSales;
