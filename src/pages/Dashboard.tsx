import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import CustomLoader from '../components/CustomLoader';
import { useBillingItems, useProducts, useCreditSales } from '../hooks/useFirestoreCache';
import { isExpenseItem } from '../types';
import { getItemFinancials } from './OverallSales';
import { getProductAgeInDays, isProductAging, getCachedStockAgingSettings } from '../utils/stockAging';
import {
  TrendingUp,
  ShoppingBag,
  Package,
  Users,
  CreditCard,
  AlertTriangle,
  Hourglass,
  ArrowUpRight,
  Plus,
  Wrench,
  FileText,
  RefreshCw,
  Building2,
  ArrowRight,
  CheckCircle2,
  DollarSign,
  Receipt,
  Truck,
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

const PAYMENT_COLORS: Record<string, string> = {
  cash: '#10B981',
  upi: '#3B82F6',
  card: '#8B5CF6',
  finance: '#F59E0B',
  split: '#EC4899',
  credit: '#EF4444',
  other: '#64748B',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  finance: 'Finance / EMI',
  split: 'Split',
  credit: 'Credit',
  other: 'Other',
};

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentStore } = useStore();
  const navigate = useNavigate();

  // State for date filter
  const [dateFilter, setDateFilter] = useState<'today' | 'last7days' | 'last30days'>('today');

  // Calculate date range based on filter
  const getDateRange = (filter: 'today' | 'last7days' | 'last30days') => {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();
    if (filter === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'last7days') {
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'last30days') {
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
    }

    return { startDate, endDate };
  };

  const { startDate, endDate } = getDateRange(dateFilter);

  // Fetch billing items via cached hook
  const {
    data: billingData,
    isLoading: loadingBilling,
    refetch: refetchBilling,
  } = useBillingItems(startDate, endDate, 300);
  const billingItems = billingData?.items || [];

  // Fetch products for live inventory & low stock
  const {
    data: products,
    isLoading: loadingProducts,
    refetch: refetchProducts,
  } = useProducts(500);

  // Fetch credit sales for outstanding balances
  const {
    data: creditSalesData,
    isLoading: loadingCredits,
    refetch: refetchCredits,
  } = useCreditSales(undefined, undefined, 100);
  const creditSales = creditSalesData?.items || [];

  const loading = loadingBilling || loadingProducts || loadingCredits;

  const handleRefreshAll = () => {
    refetchBilling();
    refetchProducts();
    refetchCredits();
  };

  // ── Financial Calculations ──
  const salesEntries = useMemo(
    () => billingItems.filter((item) => !isExpenseItem(item)),
    [billingItems]
  );

  const expenseEntries = useMemo(
    () => billingItems.filter(isExpenseItem),
    [billingItems]
  );

  const totalSales = useMemo(
    () => salesEntries.reduce((sum, item) => sum + getItemFinancials(item).netTotal, 0),
    [salesEntries]
  );

  const totalUnitsSold = useMemo(
    () => salesEntries.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    [salesEntries]
  );

  const totalExpenses = useMemo(
    () =>
      expenseEntries.reduce(
        (sum, item) => sum + Math.abs((item.cost || item.profit || 0) * (item.quantity || 1)),
        0
      ),
    [expenseEntries]
  );

  const grossProfit = useMemo(
    () => salesEntries.reduce((sum, item) => sum + getItemFinancials(item).totalProfit, 0),
    [salesEntries]
  );

  const netProfit = useMemo(() => grossProfit - totalExpenses, [grossProfit, totalExpenses]);

  const profitMargin = useMemo(
    () => (totalSales > 0 ? (netProfit / totalSales) * 100 : 0),
    [netProfit, totalSales]
  );

  const averageOrderValue = useMemo(() => {
    const validSales = salesEntries.filter((item) => item.sellingPrice > 0);
    return validSales.length > 0 ? totalSales / validSales.length : 0;
  }, [salesEntries, totalSales]);

  // Inventory value & count
  const inventoryStats = useMemo(() => {
    if (!products) return { costValue: 0, retailValue: 0, units: 0, count: 0 };
    const inStock = products.filter((p: any) => (Number(p.quantity) || 0) > 0 && p.isAvailable !== false);
    const costValue = inStock.reduce((s: number, p: any) => s + (Number(p.cost) || 0) * (Number(p.quantity) || 0), 0);
    const retailValue = inStock.reduce((s: number, p: any) => s + (Number(p.mrp || p.sellingPrice) || 0) * (Number(p.quantity) || 0), 0);
    const units = inStock.reduce((s: number, p: any) => s + (Number(p.quantity) || 0), 0);
    return { costValue, retailValue, units, count: inStock.length };
  }, [products]);

  // Pending credit balance
  const pendingCredits = useMemo(() => {
    return creditSales.filter(
      (item: any) => !item.isPaid || (item.remainingAmount && item.remainingAmount > 0)
    );
  }, [creditSales]);

  const totalPendingAmount = useMemo(() => {
    return pendingCredits.reduce((sum: number, item: any) => {
      const remaining = item.remainingAmount || item.sellingPrice * item.quantity;
      return sum + remaining;
    }, 0);
  }, [pendingCredits]);

  // Low stock products (< 5)
  const lowStockProducts = useMemo(() => {
    if (!products) return [];
    return products
      .filter((p: any) => (Number(p.quantity) || 0) > 0 && (Number(p.quantity) || 0) < 5 && p.isAvailable !== false)
      .slice(0, 6);
  }, [products]);

  // Aging stock products
  const agingSettings = useMemo(() => getCachedStockAgingSettings(), []);
  const agingProducts = useMemo(() => {
    if (!products || !agingSettings.enabled) return [];
    return products
      .filter((p: any) => (Number(p.quantity) || 0) > 0 && isProductAging(p, agingSettings.agingDays))
      .slice(0, 6);
  }, [products, agingSettings]);

  // ── Chart 1: Revenue & Profit Trend Over Period ──
  const trendChartData = useMemo(() => {
    const days = dateFilter === 'today' ? 1 : dateFilter === 'last7days' ? 7 : 30;
    const result = [];
    const now = new Date();

    if (dateFilter === 'today') {
      // Group by 4-hour buckets for today
      for (let h = 8; h <= 22; h += 2) {
        const hourLabel = `${h}:00`;
        const nextHour = h + 2;
        const matching = salesEntries.filter((item) => {
          if (!item.createdAt) return false;
          const raw = item.createdAt as any;
          const d = raw instanceof Date ? raw : (raw?.toDate ? raw.toDate() : new Date(raw));
          const itemHour = d.getHours();
          return itemHour >= h && itemHour < nextHour;
        });
        const rev = matching.reduce((s, it) => s + getItemFinancials(it).netTotal, 0);
        const prof = matching.reduce((s, it) => s + getItemFinancials(it).totalProfit, 0);
        result.push({ label: hourLabel, revenue: Math.round(rev), profit: Math.round(prof) });
      }
    } else {
      // Group by day
      for (let i = days - 1; i >= 0; i--) {
        const target = new Date(now);
        target.setDate(now.getDate() - i);
        const targetStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(
          target.getDate()
        ).padStart(2, '0')}`;
        const dayLabel = target.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: days > 7 ? 'numeric' : 'short',
        });

        const matching = salesEntries.filter((item) => {
          if (!item.createdAt) return false;
          const raw = item.createdAt as any;
          const d = raw instanceof Date ? raw : (raw?.toDate ? raw.toDate() : new Date(raw));
          const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate()
          ).padStart(2, '0')}`;
          return dStr === targetStr;
        });

        const rev = matching.reduce((s, it) => s + getItemFinancials(it).netTotal, 0);
        const prof = matching.reduce((s, it) => s + getItemFinancials(it).totalProfit, 0);
        result.push({ label: dayLabel, revenue: Math.round(rev), profit: Math.round(prof) });
      }
    }
    return result;
  }, [salesEntries, dateFilter]);

  // ── Chart 2: Payment Methods Share ──
  const paymentChartData = useMemo(() => {
    const modeTotals: Record<string, number> = {
      cash: 0,
      upi: 0,
      card: 0,
      finance: 0,
      split: 0,
      credit: 0,
    };

    salesEntries.forEach((item) => {
      const mode = (item.paymentMode || 'cash').toLowerCase();
      const val = getItemFinancials(item).netTotal;
      if (mode in modeTotals) {
        modeTotals[mode] += val;
      } else {
        modeTotals.cash += val;
      }
    });

    const total = Object.values(modeTotals).reduce((a, b) => a + b, 0);

    return Object.entries(modeTotals)
      .filter(([_, value]) => value > 0)
      .map(([mode, value]) => ({
        name: PAYMENT_LABELS[mode] || mode,
        key: mode,
        value: Math.round(value),
        percent: total > 0 ? Math.round((value / total) * 100) : 0,
        color: PAYMENT_COLORS[mode] || '#64748B',
      }));
  }, [salesEntries]);

  // ── Chart 3: Top Selling Products by Revenue ──
  const topProductsChartData = useMemo(() => {
    const productMap = new Map<string, { title: string; quantity: number; sales: number }>();
    salesEntries
      .filter((item) => item.sellingPrice > 0 && item.title)
      .forEach((item) => {
        const fin = getItemFinancials(item);
        const existing = productMap.get(item.title) || { title: item.title, quantity: 0, sales: 0 };
        existing.quantity += Number(item.quantity) || 1;
        existing.sales += fin.netTotal;
        productMap.set(item.title, existing);
      });

    return Array.from(productMap.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5)
      .map((p) => ({
        name: p.title.length > 18 ? p.title.substring(0, 16) + '...' : p.title,
        sales: Math.round(p.sales),
        units: p.quantity,
      }));
  }, [salesEntries]);

  // ── Chart 4: Sales Velocity (Hourly / Daily distribution) ──
  const velocityData = useMemo(() => {
    const slots = [
      { slot: 'Morning (9-12)', count: 0, amount: 0 },
      { slot: 'Noon (12-3)', count: 0, amount: 0 },
      { slot: 'Evening (3-7)', count: 0, amount: 0 },
      { slot: 'Night (7-10)', count: 0, amount: 0 },
    ];

    salesEntries.forEach((it) => {
      if (!it.createdAt) return;
      const raw = it.createdAt as any;
      const d = raw instanceof Date ? raw : (raw?.toDate ? raw.toDate() : new Date(raw));
      const h = d.getHours();
      const amt = getItemFinancials(it).netTotal;
      if (h >= 9 && h < 12) {
        slots[0].count++;
        slots[0].amount += amt;
      } else if (h >= 12 && h < 15) {
        slots[1].count++;
        slots[1].amount += amt;
      } else if (h >= 15 && h < 19) {
        slots[2].count++;
        slots[2].amount += amt;
      } else if (h >= 19 && h <= 23) {
        slots[3].count++;
        slots[3].amount += amt;
      }
    });

    return slots.map((s) => ({
      slot: s.slot,
      bills: s.count,
      amount: Math.round(s.amount),
    }));
  }, [salesEntries]);

  // ── Recent Invoices Live Feed ──
  const recentBills = useMemo(() => {
    return salesEntries
      .filter((item) => item.sellingPrice > 0)
      .slice(0, 5);
  }, [salesEntries]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <CustomLoader message="Loading store dashboard..." />
      </div>
    );
  }

  const isOwner = currentUser?.role === 'owner' || currentUser?.role === 'admin';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 space-y-5">
        {/* Top Executive Header & Context Bar */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 sm:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/80">
                  <Building2 className="w-3.5 h-3.5" />
                  {currentStore?.name || 'Main Branch'}
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-slate-500 font-medium">Store Operations</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
                Store Performance Dashboard
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Active user: <span className="font-semibold text-slate-700">{currentUser?.displayName || 'Store Staff'}</span> • Real-time branch sales & inventory tracking
              </p>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Date Filter Pills */}
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
                onClick={handleRefreshAll}
                className="p-2 bg-slate-100 hover:bg-slate-200/80 active:scale-95 text-slate-700 rounded-xl transition cursor-pointer border border-slate-200"
                title="Refresh Live Data"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              {/* Link to HQ Hub for Owner/Admin */}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => navigate('/hub-dashboard')}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                >
                  <Building2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>HQ Control</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Action Grid (8 Clean Action Buttons) */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Quick Actions
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-2.5">
            {[
              { label: 'New Bill (POS)', path: '/billing', icon: Receipt, color: 'text-blue-600', bg: 'hover:border-blue-300' },
              { label: 'Add Product', path: '/add-product', icon: Plus, color: 'text-emerald-600', bg: 'hover:border-emerald-300' },
              { label: 'Stock Purchase', path: '/add-purchase', icon: Package, color: 'text-purple-600', bg: 'hover:border-purple-300' },
              { label: 'Stock Transfer', path: '/stock-transfer', icon: Truck, color: 'text-amber-600', bg: 'hover:border-amber-300' },
              { label: 'Service Entry', path: '/service-job-entry', icon: Wrench, color: 'text-cyan-600', bg: 'hover:border-cyan-300' },
              { label: 'Customer Ledger', path: '/customers', icon: Users, color: 'text-pink-600', bg: 'hover:border-pink-300' },
              { label: 'Overall Sales', path: '/overall-sales', icon: FileText, color: 'text-indigo-600', bg: 'hover:border-indigo-300' },
              { label: 'Req. Stock', path: '/stock-requirement', icon: Hourglass, color: 'text-rose-600', bg: 'hover:border-rose-300' },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.path}
                  type="button"
                  onClick={() => navigate(action.path)}
                  className={`p-3 bg-white hover:bg-slate-50/80 rounded-xl border border-slate-200/90 transition-all flex flex-col items-center gap-1.5 cursor-pointer active:scale-95 text-center shadow-2xs ${action.bg}`}
                >
                  <div className={`p-2 rounded-lg bg-slate-50 border border-slate-100 ${action.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-700 leading-tight">
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 5-Card High-Density KPI Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {/* 1. Total Sales */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Gross Revenue
              </span>
              <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-700 tabular-nums">
              ₹{Math.round(totalSales).toLocaleString('en-IN')}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
              <span className="font-semibold text-slate-700">{salesEntries.length} orders</span>
              <span>•</span>
              <span className="text-emerald-600 font-medium">
                {dateFilter === 'today' ? 'Today' : dateFilter === 'last7days' ? 'Last 7D' : 'Last 30D'}
              </span>
            </div>
          </div>

          {/* 2. Net Profit */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Net Profit
              </span>
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
              ₹{Math.round(netProfit).toLocaleString('en-IN')}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
              <span className="font-semibold text-emerald-600">
                {profitMargin > 0 ? `${profitMargin.toFixed(1)}% margin` : '0%'}
              </span>
              <span>•</span>
              <span>After ₹{Math.round(totalExpenses)} exp</span>
            </div>
          </div>

          {/* 3. Items Sold & AOV */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Units & AOV
              </span>
              <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
                <ShoppingBag className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-purple-700 tabular-nums">
              {totalUnitsSold} <span className="text-xs font-semibold text-slate-500">units</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
              <span>Avg Basket:</span>
              <span className="font-bold text-slate-700">₹{Math.round(averageOrderValue)}</span>
            </div>
          </div>

          {/* 4. Active Inventory */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Stock Valuation
              </span>
              <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                <Package className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-amber-700 tabular-nums">
              ₹{Math.round(inventoryStats.costValue).toLocaleString('en-IN')}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
              <span className="font-bold text-slate-700">{inventoryStats.units} units</span>
              <span>•</span>
              <span>{inventoryStats.count} active SKUs</span>
            </div>
          </div>

          {/* 5. Pending Credit Balance */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Pending Credits
              </span>
              <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-rose-700 tabular-nums">
              ₹{Math.round(totalPendingAmount).toLocaleString('en-IN')}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
              <span className="font-semibold text-rose-600">{pendingCredits.length} customers</span>
              <span>•</span>
              <button
                type="button"
                onClick={() => navigate('/customers')}
                className="underline hover:text-slate-800 cursor-pointer"
              >
                Collect
              </button>
            </div>
          </div>
        </div>

        {/* 4 Compact Graphs in a Perfect 2x2 Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Chart 1: Revenue & Profit Trend (8 Cols) */}
          <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Revenue & Profit Progression</h3>
                <p className="text-[11px] text-slate-500">
                  {dateFilter === 'today' ? 'Hourly sales flow today' : `Daily performance over last ${dateFilter === 'last7days' ? '7 days' : '30 days'}`}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-semibold">
                <span className="flex items-center gap-1 text-blue-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span> Revenue
                </span>
                <span className="flex items-center gap-1 text-emerald-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block"></span> Profit
                </span>
              </div>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorProf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="label" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} tickFormatter={(val) => `₹${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`} />
                  <Tooltip
                    formatter={(value: any, name: any) => [`₹${Number(value).toLocaleString('en-IN')}`, name === 'revenue' ? 'Revenue' : 'Profit']}
                    contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '12px' }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#2563EB" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRev)" />
                  <Area type="monotone" dataKey="profit" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorProf)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Payment Mode Split (4 Cols) */}
          <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">Payment Breakdown</h3>
                <span className="text-[11px] text-slate-400 font-medium">By Revenue</span>
              </div>

              {paymentChartData.length > 0 ? (
                <div className="h-44 w-full relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={paymentChartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={68}
                        paddingAngle={3}
                      >
                        {paymentChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Amount']}
                        contentStyle={{ backgroundColor: '#0F172A', borderRadius: '10px', border: 'none', color: '#fff', fontSize: '11px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Total</span>
                    <span className="text-xs font-bold text-slate-900">₹{(totalSales >= 1000 ? `${(totalSales / 1000).toFixed(1)}k` : totalSales.toFixed(0))}</span>
                  </div>
                </div>
              ) : (
                <div className="h-44 flex items-center justify-center text-xs text-slate-400">
                  No payment data in this period
                </div>
              )}
            </div>

            {/* Payment Mode Pills */}
            <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-100 text-[11px]">
              {paymentChartData.map((p) => (
                <div key={p.key} className="flex items-center justify-between p-1.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="flex items-center gap-1.5 truncate text-slate-600">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }}></span>
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="font-bold text-slate-800 ml-1">{p.percent}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chart 3: Top Products Velocity (6 Cols) */}
          <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Top Velocity Products</h3>
                <p className="text-[11px] text-slate-500">Highest revenue contributors in this period</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/products')}
                className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
              >
                Catalog <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {topProductsChartData.length > 0 ? (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsChartData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
                    <XAxis type="number" stroke="#94A3B8" fontSize={10} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                    <YAxis dataKey="name" type="category" stroke="#64748B" fontSize={11} width={90} tickLine={false} />
                    <Tooltip
                      formatter={(val: any, _: any, p: any) => [`₹${Number(val).toLocaleString('en-IN')} (${p?.payload?.units} units sold)`, 'Sales']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '10px', border: 'none', color: '#fff', fontSize: '11px' }}
                    />
                    <Bar dataKey="sales" fill="#3B82F6" radius={[0, 6, 6, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-xs text-slate-400">
                No product sales recorded in this period
              </div>
            )}
          </div>

          {/* Chart 4: Time Slot Sales Distribution (6 Cols) */}
          <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Peak Store Hours Velocity</h3>
                <p className="text-[11px] text-slate-500">Distribution of sales volume across business hours</p>
              </div>
              <span className="text-[11px] text-slate-400 font-semibold">Store Flow</span>
            </div>

            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={velocityData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="slot" stroke="#94A3B8" fontSize={10} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    formatter={(val: any, _: any, p: any) => [`₹${Number(val).toLocaleString('en-IN')} (${p?.payload?.bills} bills)`, 'Sales']}
                    contentStyle={{ backgroundColor: '#0F172A', borderRadius: '10px', border: 'none', color: '#fff', fontSize: '11px' }}
                  />
                  <Bar dataKey="amount" fill="#8B5CF6" radius={[6, 6, 0, 0]} barSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Operational Hub & Smart Alerts (3 Cards in Grid) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Low Stock Alerts */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">Low Stock Watch</h3>
                </div>
                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/80">
                  {lowStockProducts.length} items
                </span>
              </div>

              {lowStockProducts.length > 0 ? (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {lowStockProducts.map((p: any) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-semibold text-slate-900 truncate">{p.name || p.title}</p>
                        <p className="text-[11px] text-slate-500 font-mono">Cost: ₹{p.cost || 0}</p>
                      </div>
                      <span className="px-2 py-1 bg-amber-100 text-amber-800 font-bold rounded-lg text-xs whitespace-nowrap">
                        {p.quantity} left
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1 opacity-80" />
                  All stock items healthy &gt; 5 units
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate('/stock-requirement')}
              className="w-full mt-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Request Stock Transfer</span>
            </button>
          </div>

          {/* Card 2: Aging Stock Watch */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
                    <Hourglass className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">Aging Stock Alert</h3>
                </div>
                <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200/80">
                  &gt;{agingSettings.agingDays} days
                </span>
              </div>

              {agingProducts.length > 0 ? (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {agingProducts.map((p: any) => {
                    const age = getProductAgeInDays(p);
                    return (
                      <div
                        key={p.id}
                        className="p-2.5 rounded-xl bg-purple-50/50 border border-purple-100 flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-slate-900 truncate">{p.name || p.title}</p>
                          <p className="text-[11px] text-purple-700 font-semibold">{age} days in stock</p>
                        </div>
                        <span className="font-bold text-slate-800 text-xs">
                          ₹{p.sellingPrice || p.mrp || 0}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1 opacity-80" />
                  No old stock exceeding threshold
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate('/products')}
              className="w-full mt-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Promote / Discount Aging Stock</span>
            </button>
          </div>

          {/* Card 3: Pending Credit Collections */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">Pending Collections</h3>
                </div>
                <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/80">
                  ₹{Math.round(totalPendingAmount).toLocaleString('en-IN')}
                </span>
              </div>

              {pendingCredits.length > 0 ? (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {pendingCredits.slice(0, 5).map((c: any, idx: number) => {
                    const due = c.remainingAmount || (Number(c.sellingPrice) || 0) * (Number(c.quantity) || 1);
                    return (
                      <div
                        key={c.id || idx}
                        className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-slate-900 truncate">
                            {c.creditCustomerName || c.customerName || 'Customer'}
                          </p>
                          <p className="text-[11px] text-slate-500">{c.customerPhone || 'No phone'}</p>
                        </div>
                        <span className="font-bold text-rose-700 text-xs">
                          ₹{Math.round(due).toLocaleString('en-IN')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1 opacity-80" />
                  Zero outstanding credit collections!
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => navigate('/customers')}
              className="w-full mt-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>View Customer Ledger</span>
            </button>
          </div>
        </div>

        {/* Live Invoices Feed Table */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Recent Live Invoices</h3>
              <p className="text-[11px] text-slate-500">Real-time store checkouts</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/overall-sales')}
              className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
            >
              All Invoices <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 font-bold">Item / SKU</th>
                  <th className="py-2.5 font-bold">Customer</th>
                  <th className="py-2.5 font-bold">Payment</th>
                  <th className="py-2.5 font-bold text-right">Qty</th>
                  <th className="py-2.5 font-bold text-right">Total (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentBills.map((item: any) => {
                  const fin = getItemFinancials(item);
                  const mode = (item.paymentMode || 'cash').toLowerCase();
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 pr-2">
                        <p className="font-semibold text-slate-900 truncate max-w-[220px]">{item.title}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{item.invoiceNo || item.id?.substring(0, 8)}</p>
                      </td>
                      <td className="py-2.5 pr-2">
                        <span className="font-medium text-slate-700 truncate block max-w-[150px]">
                          {item.customerName || 'Walk In Customer'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-2">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold capitalize"
                          style={{
                            backgroundColor: `${PAYMENT_COLORS[mode] || '#64748B'}15`,
                            color: PAYMENT_COLORS[mode] || '#64748B',
                          }}
                        >
                          {PAYMENT_LABELS[mode] || mode}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-slate-700">
                        {item.quantity || 1}
                      </td>
                      <td className="py-2.5 text-right font-bold text-blue-700 tabular-nums">
                        ₹{Math.round(fin.netTotal).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  );
                })}
                {recentBills.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                      No transactions recorded in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
