import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowRight,
  History,
  Search,
  Calendar,
  Download,
  Printer,
  Eye,
  RefreshCw,
  Building2,
  Warehouse,
  Package,
  CheckCircle2,
  Clock,
  Truck,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  RotateCcw,
  Boxes,
  Bookmark,
  Edit3,
  Trash2
} from 'lucide-react';
import { collection, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useStore } from '../context/StoreContext';
import type { StockTransfer } from '../types';
import Navbar from '../components/Navbar';
import { printStockTransferInvoice } from '../utils/printStockTransferInvoice';

export const StockTransferHistory: React.FC = () => {
  const navigate = useNavigate();
  const { stores, currentHub } = useStore();

  // Data states
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [fromStoreFilter, setFromStoreFilter] = useState<string>('all');
  const [toStoreFilter, setToStoreFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Modal / Detail state
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);

  // Load transfers from Firestore
  const loadTransfers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'stockTransfers'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const data: StockTransfer[] = snap.docs.map((d) => {
        const raw = d.data();
        let createdAtDate = new Date();
        if (raw.createdAt) {
          if (typeof raw.createdAt.toDate === 'function') {
            createdAtDate = raw.createdAt.toDate();
          } else if (raw.createdAt instanceof Date) {
            createdAtDate = raw.createdAt;
          } else if (typeof raw.createdAt === 'string' || typeof raw.createdAt === 'number') {
            createdAtDate = new Date(raw.createdAt);
          }
        }

        return {
          id: d.id,
          ...raw,
          createdAt: createdAtDate,
          items: raw.items || [],
          totalItems: raw.totalItems || raw.items?.length || 0,
          totalQuantity: raw.totalQuantity || raw.items?.reduce((s: number, i: any) => s + (i.quantity || 0), 0) || 0,
          totalValue: raw.totalValue || raw.items?.reduce((s: number, i: any) => s + ((i.cost || 0) * (i.quantity || 0)), 0) || 0,
        } as StockTransfer;
      });

      data.sort((a, b) => {
        const tA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const tB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return tB - tA;
      });

      setTransfers(data);
    } catch (err: any) {
      console.error('Error loading stock transfers:', err);
      setError('Failed to load stock transfer history. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  // Helper to format currency
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(val || 0);
  };

  // Helper to format date
  const formatDate = (date: any) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatDateTime = (date: any) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Filtered transfers
  const filteredTransfers = useMemo(() => {
    return transfers.filter((t) => {
      // 1. Status Filter
      if (statusFilter !== 'all') {
        const rawStatus = (t.status || '').toLowerCase();
        if (statusFilter === 'completed') {
          if (rawStatus !== 'completed' && rawStatus !== 'received') return false;
        } else if (statusFilter === 'in-transit') {
          if (rawStatus !== 'dispatched' && rawStatus !== 'in-transit' && rawStatus !== 'picked') return false;
        } else if (statusFilter === 'pending') {
          if (rawStatus !== 'pending' && rawStatus !== 'triggered') return false;
        } else if (statusFilter === 'draft') {
          if (rawStatus !== 'draft') return false;
        } else if (rawStatus !== statusFilter) {
          return false;
        }
      }

      // 2. From Store Filter
      if (fromStoreFilter !== 'all') {
        if (t.fromStoreId !== fromStoreFilter) return false;
      }

      // 3. To Store Filter
      if (toStoreFilter !== 'all') {
        if (t.toStoreId !== toStoreFilter) return false;
      }

      // 4. Date Range Filter
      if (dateFilter !== 'all') {
        const transferDate = t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (dateFilter === 'today') {
          if (transferDate < startOfToday) return false;
        } else if (dateFilter === '7days') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(now.getDate() - 7);
          sevenDaysAgo.setHours(0, 0, 0, 0);
          if (transferDate < sevenDaysAgo) return false;
        } else if (dateFilter === '30days') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(now.getDate() - 30);
          thirtyDaysAgo.setHours(0, 0, 0, 0);
          if (transferDate < thirtyDaysAgo) return false;
        } else if (dateFilter === 'this_month') {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          if (transferDate < startOfMonth) return false;
        } else if (dateFilter === 'custom') {
          if (customStartDate) {
            const start = new Date(customStartDate);
            start.setHours(0, 0, 0, 0);
            if (transferDate < start) return false;
          }
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            if (transferDate > end) return false;
          }
        }
      }

      // 5. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const idMatch = (t.id || '').toLowerCase().includes(q);
        const fromMatch = (t.fromStoreName || '').toLowerCase().includes(q);
        const toMatch = (t.toStoreName || '').toLowerCase().includes(q);
        const notesMatch = (t.notes || '').toLowerCase().includes(q);
        const creatorMatch = (t.createdByName || t.createdBy || '').toLowerCase().includes(q);

        const itemsMatch = (t.items || []).some((item) => {
          return (
            (item.productName || '').toLowerCase().includes(q) ||
            (item.productCode || '').toLowerCase().includes(q) ||
            (item.brand || '').toLowerCase().includes(q) ||
            (item.category || '').toLowerCase().includes(q) ||
            (item.imei || '').toLowerCase().includes(q)
          );
        });

        if (!idMatch && !fromMatch && !toMatch && !notesMatch && !creatorMatch && !itemsMatch) {
          return false;
        }
      }

      return true;
    });
  }, [
    transfers,
    statusFilter,
    fromStoreFilter,
    toStoreFilter,
    dateFilter,
    customStartDate,
    customEndDate,
    searchQuery,
  ]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, fromStoreFilter, toStoreFilter, dateFilter, customStartDate, customEndDate, pageSize]);

  // Pagination calculation
  const totalItems = filteredTransfers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const currentTransfers = useMemo(() => {
    return filteredTransfers.slice(startIndex, endIndex);
  }, [filteredTransfers, startIndex, endIndex]);

  // High-level KPI metrics
  const stats = useMemo(() => {
    const totalCount = transfers.length;
    const totalValuation = transfers.reduce((acc, t) => acc + (t.totalValue || 0), 0);
    const totalUnits = transfers.reduce((acc, t) => acc + (t.totalQuantity || 0), 0);

    const completedCount = transfers.filter(
      (t) => (t.status || '').toLowerCase() === 'completed' || (t.status || '').toLowerCase() === 'received'
    ).length;

    const inTransitCount = transfers.filter((t) => {
      const s = (t.status || '').toLowerCase();
      return s === 'dispatched' || s === 'in-transit' || s === 'picked' || s === 'triggered' || s === 'pending';
    }).length;

    return {
      totalCount,
      totalValuation,
      totalUnits,
      completedCount,
      inTransitCount,
    };
  }, [transfers]);

  // Print stock transfer invoice & gate pass with company logo
  const handlePrintDeliveryChallan = (transfer: StockTransfer) => {
    const toStore = stores.find((s) => s.id === transfer.toStoreId);
    const fromStore = stores.find((s) => s.id === transfer.fromStoreId);
    printStockTransferInvoice({
      transfer,
      hubName: currentHub?.name || 'DIGITAL ZONE',
      hubAddress: currentHub?.address || 'Head Office & Central Warehouse',
      hubPhone: currentHub?.phone || '+91 98765 43210',
      hubEmail: currentHub?.email || 'support@digitalzone.com',
      hubGst: (currentHub as any)?.gst || '33AAAAA0000A1Z5',
      consignorAddress: fromStore?.address,
      consigneeAddress: toStore?.address,
    });
  };

  // Export filtered list to CSV
  const handleExportCSV = () => {
    if (filteredTransfers.length === 0) {
      alert('No transfers to export with current filters.');
      return;
    }

    const headers = [
      'Transfer ID',
      'Date',
      'From Location',
      'To Location',
      'Status',
      'Total SKUs',
      'Total Quantity',
      'Total Value (INR)',
      'Dispatched By',
      'Notes',
    ];

    const rows = filteredTransfers.map((t) => [
      `"${t.id || ''}"`,
      `"${formatDateTime(t.createdAt)}"`,
      `"${t.fromStoreName || ''}"`,
      `"${t.toStoreName || ''}"`,
      `"${t.status || ''}"`,
      t.totalItems || 0,
      t.totalQuantity || 0,
      (t.totalValue || 0).toFixed(2),
      `"${t.createdByName || t.createdBy || ''}"`,
      `"${(t.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `stock_transfers_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteDraft = async (draftId?: string) => {
    if (!draftId) return;
    if (!window.confirm(`Are you sure you want to delete draft transfer ${draftId}?`)) return;
    try {
      await deleteDoc(doc(db, 'stockTransfers', draftId));
      setTransfers((prev) => prev.filter((t) => t.id !== draftId));
    } catch (err) {
      console.error('Error deleting draft transfer:', err);
    }
  };

  // Status badge renderer
  const renderStatusBadge = (status: string | undefined) => {
    const s = (status || 'completed').toLowerCase();
    if (s === 'draft') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/80">
          <Bookmark className="w-3 h-3 text-amber-600" />
          <span>Draft</span>
        </span>
      );
    }
    if (s === 'completed' || s === 'received') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>Received</span>
        </span>
      );
    }
    if (s === 'dispatched' || s === 'in-transit') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/80">
          <Truck className="w-3 h-3 text-blue-600 animate-pulse" />
          <span>In Transit</span>
        </span>
      );
    }
    if (s === 'picked') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
          <Package className="w-3 h-3 text-indigo-600" />
          <span>Picked</span>
        </span>
      );
    }
    if (s === 'pending' || s === 'triggered') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/80">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Pending</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        <span>{status}</span>
      </span>
    );
  };

  // Reset all filters
  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setFromStoreFilter('all');
    setToStoreFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    fromStoreFilter !== 'all' ||
    toStoreFilter !== 'all' ||
    dateFilter !== 'all';

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 w-full">
      <Navbar />

      {/* Full-width container */}
      <main className="w-full max-w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-5">
        {/* Top Header & Quick Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 flex-shrink-0 shadow-2xs">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Stock Transfer History
                </h1>
                <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold rounded-full">
                  {transfers.length} records
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Audit trail, delivery challans, inter-store shipments, and warehouse dispatches.
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            <button
              type="button"
              onClick={loadTransfers}
              disabled={loading}
              title="Refresh transfers"
              className="p-2 sm:px-3 sm:py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              disabled={filteredTransfers.length === 0}
              title="Export current view to CSV"
              className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>

            {/* Primary Blue Action Button */}
            <Link
              to="/stock-transfer"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-semibold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Stock Transfer</span>
            </Link>
          </div>
        </div>

        {/* 4 Executive KPI Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Total Transfers */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Dispatches</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <History className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">{stats.totalCount}</span>
              <span className="text-xs text-slate-400 font-medium">transfers logged</span>
            </div>
            <div className="mt-2 text-xs font-medium text-slate-600">
              Valuation: <span className="font-semibold text-slate-900">{formatCurrency(stats.totalValuation)}</span>
            </div>
          </div>

          {/* Card 2: Units Transferred */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Units Moved</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-indigo-950">{stats.totalUnits.toLocaleString('en-IN')}</span>
              <span className="text-xs text-slate-400 font-medium">items</span>
            </div>
            <div className="mt-2 text-xs font-medium text-slate-500 truncate">
              Across Central Warehouse & branches
            </div>
          </div>

          {/* Card 3: In Transit / Pending */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">In Transit / Pending</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Truck className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-amber-950">{stats.inTransitCount}</span>
              <span className="text-xs text-slate-400 font-medium">active shipments</span>
            </div>
            <div className="mt-2 text-xs font-medium text-amber-600">
              Awaiting destination receiving
            </div>
          </div>

          {/* Card 4: Completed & Received */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Delivered & Verified</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-950">{stats.completedCount}</span>
              <span className="text-xs text-slate-400 font-medium">completed</span>
            </div>
            <div className="mt-2 text-xs font-medium text-emerald-600">
              Stock synced to branch ledger
            </div>
          </div>
        </div>

        {/* Filter Toolbar & Controls */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 sm:p-5 space-y-3.5">
          {/* Row 1: Search & Status Pills */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by Transfer ID, branch name, product name, SKU / IMEI, notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status Segmented Buttons */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
              {[
                { id: 'all', label: 'All Transfers' },
                { id: 'completed', label: 'Received' },
                { id: 'in-transit', label: 'In Transit' },
                { id: 'pending', label: 'Pending' },
                { id: 'draft', label: 'Drafts' },
              ].map((pill) => {
                const isActive = statusFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setStatusFilter(pill.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 2: Secondary Dropdown Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
            {/* Origin Branch Filter */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Warehouse className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <div className="flex-1">
                <span className="block text-[10px] uppercase font-bold text-slate-400 leading-tight">From Origin</span>
                <select
                  aria-label="Filter by Source Branch"
                  value={fromStoreFilter}
                  onChange={(e) => setFromStoreFilter(e.target.value)}
                  className="w-full text-xs font-semibold text-slate-800 bg-transparent outline-none cursor-pointer"
                >
                  <option value="all">All Origins</option>
                  {currentHub?.id && (
                    <option value={currentHub.id}>{currentHub.name || 'Head Office'} (Central)</option>
                  )}
                  {stores.map((s) => (
                    <option key={`from-${s.id}`} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Destination Branch Filter */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <div className="flex-1">
                <span className="block text-[10px] uppercase font-bold text-slate-400 leading-tight">To Destination</span>
                <select
                  aria-label="Filter by Destination Branch"
                  value={toStoreFilter}
                  onChange={(e) => setToStoreFilter(e.target.value)}
                  className="w-full text-xs font-semibold text-slate-800 bg-transparent outline-none cursor-pointer"
                >
                  <option value="all">All Destinations</option>
                  {currentHub?.id && (
                    <option value={currentHub.id}>{currentHub.name || 'Head Office'} (Central)</option>
                  )}
                  {stores.map((s) => (
                    <option key={`to-${s.id}`} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date Range Selector */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <div className="flex-1">
                <span className="block text-[10px] uppercase font-bold text-slate-400 leading-tight">Time Period</span>
                <select
                  aria-label="Filter by Date Period"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full text-xs font-semibold text-slate-800 bg-transparent outline-none cursor-pointer"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="7days">Last 7 Days</option>
                  <option value="30days">Last 30 Days</option>
                  <option value="this_month">This Month</option>
                  <option value="custom">Custom Date Range</option>
                </select>
              </div>
            </div>

            {/* Clear Filters / Result Count */}
            <div className="flex items-center justify-between sm:justify-end gap-2 px-1">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-2.5 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Filters</span>
                </button>
              )}
              <span className="text-xs text-slate-500 font-medium">
                Found <strong className="text-slate-900 font-bold">{filteredTransfers.length}</strong> matches
              </span>
            </div>
          </div>

          {/* Optional Custom Date Range Inputs */}
          {dateFilter === 'custom' && (
            <div className="pt-2 flex flex-wrap items-center gap-3 bg-blue-50/60 p-3 rounded-xl border border-blue-100 text-xs">
              <span className="font-semibold text-blue-900">Custom Date Range:</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-[11px]">Start:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-[11px]">End:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Transfers Data Table & Pagination Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-7 h-7 text-blue-600 animate-spin" />
              <p className="text-sm font-semibold text-slate-600">Loading stock transfer audit trail...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-800">{error}</p>
              <button
                type="button"
                onClick={loadTransfers}
                className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                Try Again
              </button>
            </div>
          ) : filteredTransfers.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <Boxes className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-800">No stock transfers found</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                {hasActiveFilters
                  ? 'No transfer records matched your filter criteria. Try adjusting or clearing filters.'
                  : 'No stock transfers have been logged yet. Create your first transfer between branches.'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Clear All Filters
                  </button>
                ) : (
                  <Link
                    to="/stock-transfer"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Create Stock Transfer
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Responsive Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">Transfer ID</th>
                      <th className="py-3 px-4">Date & Operator</th>
                      <th className="py-3 px-4">Transfer Route</th>
                      <th className="py-3 px-4">Manifest SKUs</th>
                      <th className="py-3 px-4 text-right">Units</th>
                      <th className="py-3 px-4 text-right">Total Value</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {currentTransfers.map((t) => (
                      <tr
                        key={t.id}
                        className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                        onClick={() => setSelectedTransfer(t)}
                      >
                        {/* Transfer ID */}
                        <td className="py-3.5 px-4 font-mono font-bold text-blue-600 group-hover:underline">
                          #{t.id ? t.id.slice(0, 10) : '—'}
                        </td>

                        {/* Date & Operator */}
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{formatDate(t.createdAt)}</div>
                          <div className="text-[11px] text-slate-400">
                            {formatDateTime(t.createdAt).split(',')[1] || ''}
                            {t.createdByName && ` • by ${t.createdByName}`}
                          </div>
                        </td>

                        {/* Route (From -> To) */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md text-[11px]">
                              {t.fromStoreName || 'Central WH'}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="font-semibold text-blue-700 bg-blue-50 border border-blue-200/60 px-2 py-0.5 rounded-md text-[11px]">
                              {t.toStoreName || 'Branch Store'}
                            </span>
                          </div>
                          {t.notes && (
                            <p className="text-[10px] text-slate-400 truncate max-w-[200px] mt-0.5">
                              {t.notes}
                            </p>
                          )}
                        </td>

                        {/* Manifest preview */}
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">
                            {t.totalItems || t.items?.length || 0} SKU{(t.totalItems || t.items?.length || 0) > 1 ? 's' : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[220px]">
                            {t.items && t.items.length > 0
                              ? t.items.map((i) => i.productName).join(', ')
                              : 'No item preview'}
                          </div>
                        </td>

                        {/* Units */}
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                          {t.totalQuantity || 0}{' '}
                          <span className="text-[10px] font-normal text-slate-400">pcs</span>
                        </td>

                        {/* Value */}
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                          {formatCurrency(t.totalValue || 0)}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4 text-center">
                          {renderStatusBadge(t.status)}
                        </td>

                        {/* Actions */}
                        <td
                          className="py-3.5 px-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            {t.status === 'draft' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/stock-transfer?resumeDraft=${t.id}`)}
                                  title="Resume / Complete Draft"
                                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 border border-amber-200"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>Resume</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDraft(t.id)}
                                  title="Delete Draft"
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setSelectedTransfer(t)}
                                  title="View itemized manifest"
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePrintDeliveryChallan(t)}
                                  title="Print Gate Pass Challan"
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                >
                                  <Printer className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-t border-slate-200/80 bg-slate-50/50">
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>
                    Showing <strong className="font-semibold text-slate-900">{totalItems > 0 ? startIndex + 1 : 0}</strong> to{' '}
                    <strong className="font-semibold text-slate-900">{endIndex}</strong> of{' '}
                    <strong className="font-semibold text-slate-900">{totalItems}</strong> transfers
                  </span>

                  {/* Rows per page selector */}
                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-slate-400">Per page:</span>
                    <select
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="bg-white border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-xs font-semibold outline-none cursor-pointer"
                    >
                      <option value={10}>10</option>
                      <option value={15}>15</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>

                {/* Page Navigation Buttons */}
                <div className="flex items-center gap-1">
                  {/* First Page */}
                  <button
                    type="button"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    title="First page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>

                  {/* Previous Page */}
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    title="Previous page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  {/* Page Numbers Indicator */}
                  <div className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800">
                    Page <span className="text-blue-600">{currentPage}</span> of {totalPages}
                  </div>

                  {/* Next Page */}
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    title="Next page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  {/* Last Page */}
                  <button
                    type="button"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    title="Last page"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Itemized Transfer Manifest Modal / Drawer */}
      {selectedTransfer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedTransfer(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 w-full max-w-3xl max-h-[90vh] flex flex-col border border-slate-200 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    Stock Consignment Manifest
                  </span>
                  {renderStatusBadge(selectedTransfer.status)}
                </div>
                <h3 className="text-lg font-bold text-slate-900 font-mono mt-0.5">
                  #{selectedTransfer.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTransfer(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Route Card */}
            <div className="my-4 bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Origin Location</span>
                <span className="font-bold text-slate-900 text-sm">
                  {selectedTransfer.fromStoreName || 'Central Warehouse'}
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  Dispatched: {formatDateTime(selectedTransfer.createdAt)}
                </span>
              </div>

              <div className="hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex-shrink-0">
                <ArrowRight className="w-4 h-4" />
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Destination Branch</span>
                <span className="font-bold text-slate-900 text-sm">
                  {selectedTransfer.toStoreName || 'Branch Store'}
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  Handler: {selectedTransfer.createdByName || selectedTransfer.createdBy || 'HQ Admin'}
                </span>
              </div>
            </div>

            {/* Notes if present */}
            {selectedTransfer.notes && (
              <div className="mb-3 p-2.5 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900">
                <strong>Waybill / Driver Notes:</strong> {selectedTransfer.notes}
              </div>
            )}

            {/* Manifest Items Table */}
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl mb-4">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Product Name</th>
                    <th className="py-2.5 px-3">Code / SKU</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Unit Cost</th>
                    <th className="py-2.5 px-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedTransfer.items || []).map((it, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 text-slate-400">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{it.productName}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">{it.productCode || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {it.brand} {it.category ? `• ${it.category}` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">{it.quantity}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{formatCurrency(it.cost || 0)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                        {formatCurrency((it.cost || 0) * (it.quantity || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary Bar */}
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80 flex items-center justify-between text-xs mb-4">
              <div className="flex items-center gap-4 text-slate-600">
                <span>
                  Total SKUs: <strong className="text-slate-900 font-bold">{selectedTransfer.totalItems || selectedTransfer.items?.length || 0}</strong>
                </span>
                <span>
                  Total Units: <strong className="text-slate-900 font-bold">{selectedTransfer.totalQuantity || 0} pcs</strong>
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-500 text-[11px] mr-1">Consignment Valuation:</span>
                <span className="font-extrabold text-blue-700 text-sm">
                  {formatCurrency(selectedTransfer.totalValue || 0)}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedTransfer(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Close
              </button>

              {selectedTransfer.status === 'draft' ? (
                <button
                  type="button"
                  onClick={() => navigate(`/stock-transfer?resumeDraft=${selectedTransfer.id}`)}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 active:scale-[0.99] text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs transition-all"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>Resume & Dispatch Transfer</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handlePrintDeliveryChallan(selectedTransfer)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs transition-all"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Gate Pass Challan</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockTransferHistory;
