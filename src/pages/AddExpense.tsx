import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import type { User, BillingItem } from '../types';
import { isEmployeeOfBranch } from '../utils/firestore';
import {
  addDoc,
  Timestamp,
  getDocs,
  query,
  deleteDoc,
  where,
  orderBy
} from 'firebase/firestore';
import {
  DollarSign,
  Zap,
  Save,
  Trash2,
  Plus,
  ClipboardList,
  Receipt,
  Search,
  RefreshCw,
  Calendar,
  TrendingDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  X,
  Briefcase,
  Gift,
  Building2,
  Check
} from 'lucide-react';

interface ExpensePreset {
  id: string;
  name: string;
  amount: number | null; // null means variable amount
  description?: string;
  category?: 'general' | 'salary' | 'bonus';
  employeeId?: string;
  employeeName?: string;
  createdAt: Timestamp;
}

type ExpenseCategory = 'general' | 'salary' | 'bonus';
type DatePeriod = 'all' | 'today' | 'week' | 'month';

const AddExpense: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore } = useStore();
  const { success, error: showError } = useToastContext();

  const displayName = currentUser?.displayName || currentUser?.email || 'Staff';

  // Active Tab: 'expense' (New Expense) | 'history' (Expense History) | 'presets' (Presets)
  const [activeTab, setActiveTab] = useState<'expense' | 'history' | 'presets'>('expense');

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    amount: '',
    description: '',
    paymentType: 'cash',
    category: 'general' as ExpenseCategory,
    selectedEmployeeId: '',
    expenseDate: new Date().toISOString().slice(0, 10),
  });

  const [submitting, setSubmitting] = useState(false);

  // Data lists
  const [expenses, setExpenses] = useState<BillingItem[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [presets, setPresets] = useState<ExpensePreset[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [showPresetForm, setShowPresetForm] = useState(false);

  // Preset Form State
  const [presetForm, setPresetForm] = useState({
    name: '',
    amount: '',
    isVariable: false,
    description: '',
    category: 'general' as ExpenseCategory,
    selectedEmployeeId: '',
  });

  // History & Live Ledger Filters
  const [searchHistory, setSearchHistory] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterPayment, setFilterPayment] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<DatePeriod>('month');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Load initial data
  useEffect(() => {
    loadPresets();
    loadEmployees();
    loadExpenses();
  }, [currentStore?.id]);

  const loadEmployees = async () => {
    try {
      const q = query(getCollectionRef('users'));
      const snapshot = await getDocs(q);
      const loaded: User[] = [];
      snapshot.forEach(d => {
        const uData = { uid: d.id, ...d.data() };
        if (isEmployeeOfBranch(uData, currentStore)) {
          loaded.push(uData as User);
        }
      });
      loaded.sort((a, b) => ((a.displayName || a.name || a.email || '').localeCompare(b.displayName || b.name || b.email || '')));
      setEmployees(loaded);
    } catch (err) {
      console.error('Error loading employees:', err);
    }
  };

  const loadPresets = async () => {
    try {
      const presetsQuery = query(getCollectionRef('expensePresets'));
      const snapshot = await getDocs(presetsQuery);
      const loaded: ExpensePreset[] = [];
      snapshot.forEach(d => {
        loaded.push({ id: d.id, ...d.data() } as ExpensePreset);
      });
      loaded.sort((a, b) => {
        const getScore = (cat?: string) => {
          if (cat === 'salary') return 0;
          if (cat === 'bonus') return 1;
          return 2;
        };
        return getScore(a.category) - getScore(b.category);
      });
      setPresets(loaded);
    } catch (err) {
      console.error('Error loading presets:', err);
    }
  };

  const loadExpenses = async () => {
    try {
      setLoadingExpenses(true);
      let expSnapshot;
      try {
        const q = query(
          getCollectionRef('expenses'),
          orderBy('createdAt', 'desc')
        );
        expSnapshot = await getDocs(q);
      } catch (err) {
        console.warn('Fallback to unsorted expenses query:', err);
        expSnapshot = await getDocs(query(getCollectionRef('expenses')));
      }

      let legacySnapshot = null;
      try {
        const legQ = query(
          getCollectionRef('billingItems'),
          where('type', '==', 'expense')
        );
        legacySnapshot = await getDocs(legQ);
      } catch (err) {
        console.warn('Legacy expenses query failed:', err);
      }

      const list: BillingItem[] = [];
      const seenIds = new Set<string>();

      expSnapshot.forEach(d => {
        const data = d.data();
        let createdDate: Date = new Date();
        if (data.createdAt?.toDate) {
          createdDate = data.createdAt.toDate();
        } else if (data.createdAt) {
          createdDate = new Date(data.createdAt);
        }
        const amt = Number(data.amount ?? data.cost ?? 0);
        seenIds.add(d.id);
        list.push({
          id: d.id,
          ...data,
          cost: amt,
          sellingPrice: 0,
          profit: -amt,
          totalProfit: -amt,
          quantity: Number(data.quantity || 1),
          type: 'expense',
          _collection: 'expenses',
          createdAt: createdDate,
        } as BillingItem);
      });

      if (legacySnapshot) {
        legacySnapshot.forEach(d => {
          if (seenIds.has(d.id)) return;
          const data = d.data();
          let createdDate: Date = new Date();
          if (data.createdAt?.toDate) {
            createdDate = data.createdAt.toDate();
          } else if (data.createdAt) {
            createdDate = new Date(data.createdAt);
          }
          seenIds.add(d.id);
          list.push({
            id: d.id,
            ...data,
            type: 'expense',
            _collection: 'billingItems',
            createdAt: createdDate,
          } as BillingItem);
        });
      }

      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExpenses(list);
    } catch (err) {
      console.error('Error loading expenses:', err);
    } finally {
      setLoadingExpenses(false);
    }
  };

  // Preset operations
  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetForm.name.trim()) {
      showError('Please enter preset name');
      return;
    }

    try {
      const selectedEmployee = employees.find(e => e.uid === presetForm.selectedEmployeeId);

      const newPreset = {
        name: presetForm.name.trim(),
        amount: presetForm.isVariable ? null : parseFloat(presetForm.amount || '0'),
        description: presetForm.description.trim() || '',
        category: presetForm.category,
        employeeId: selectedEmployee?.uid || null,
        employeeName: selectedEmployee?.displayName || selectedEmployee?.name || null,
        createdAt: Timestamp.now(),
      };

      await addDoc(getCollectionRef('expensePresets'), newPreset);
      success('Preset template saved');
      setPresetForm({
        name: '',
        amount: '',
        isVariable: false,
        description: '',
        category: 'general',
        selectedEmployeeId: '',
      });
      setShowPresetForm(false);
      loadPresets();
    } catch (err) {
      console.error('Error saving preset:', err);
      showError('Failed to save preset');
    }
  };

  const handleUsePreset = (preset: ExpensePreset) => {
    setFormData(prev => ({
      ...prev,
      title: preset.name,
      amount: preset.amount !== null ? preset.amount.toString() : '',
      description: preset.description || '',
      category: preset.category || 'general',
      selectedEmployeeId: preset.employeeId || '',
    }));
    setActiveTab('expense');
    success(`Loaded preset: ${preset.name}`);
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!window.confirm('Delete this preset?')) return;
    try {
      await deleteDoc(getDocRef('expensePresets', presetId));
      success('Preset deleted');
      loadPresets();
    } catch (err) {
      console.error('Error deleting preset:', err);
      showError('Failed to delete preset');
    }
  };

  // Record Expense
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(formData.amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showError('Please enter a valid amount');
      return;
    }
    if (!formData.title.trim()) {
      showError('Please enter expense title');
      return;
    }
    if ((formData.category === 'salary' || formData.category === 'bonus') && !formData.selectedEmployeeId) {
      showError('Please select employee for payroll entry');
      return;
    }

    try {
      setSubmitting(true);
      const selectedEmployee = employees.find(emp => emp.uid === formData.selectedEmployeeId);

      let expenseTimestamp = Timestamp.now();
      if (formData.expenseDate) {
        const selectedDate = new Date(formData.expenseDate);
        const now = new Date();
        selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
        expenseTimestamp = Timestamp.fromDate(selectedDate);
      }

      const newExpense = {
        title: formData.title.trim(),
        amount: parsedAmount,
        cost: parsedAmount,
        sellingPrice: 0,
        profit: -parsedAmount,
        quantity: 1,
        totalProfit: -parsedAmount,
        description: formData.description.trim() || '',
        type: 'expense',
        expenseCategory: formData.category,
        employeeId: selectedEmployee?.uid || null,
        employeeName: selectedEmployee?.displayName || selectedEmployee?.name || null,
        createdAt: expenseTimestamp,
        createdBy: displayName,
        createdByName: displayName,
        paymentType: formData.paymentType,
        paymentMode: formData.paymentType as any,
        storeId: currentStore?.id || null,
      };

      // Save expense to dedicated `expenses` collection to avoid conflict with sales transactions
      const docRef = await addDoc(getCollectionRef('expenses'), newExpense);

      const addedItem: BillingItem = {
        id: docRef.id,
        ...newExpense,
        _collection: 'expenses',
        createdAt: expenseTimestamp.toDate(),
      } as BillingItem;

      setExpenses(prev => [addedItem, ...prev]);
      success(`Recorded: ₹${parsedAmount.toLocaleString('en-IN')}`);

      setFormData({
        title: '',
        amount: '',
        description: '',
        paymentType: 'cash',
        category: 'general',
        selectedEmployeeId: '',
        expenseDate: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      console.error('Error adding expense:', err);
      showError('Failed to record expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id?: string) => {
    if (!id) return;
    if (!window.confirm('Delete this expense entry?')) return;

    try {
      const targetItem = expenses.find(item => item.id === id);
      const colName = targetItem?._collection || 'expenses';
      await deleteDoc(getDocRef(colName, id));
      if (colName === 'expenses') {
        try { await deleteDoc(getDocRef('billingItems', id)); } catch { /* ignore */ }
      }
      setExpenses(prev => prev.filter(item => item.id !== id));
      success('Expense deleted');
    } catch (err) {
      console.error('Error deleting expense:', err);
      showError('Failed to delete expense');
    }
  };

  const quickTitles = [
    'Office Rent',
    'Electricity Bill',
    'Tea & Snacks',
    'Shop Maintenance',
    'Internet / Wifi',
    'Travel & Fuel',
    'Cleaning',
    'Supplies',
  ];

  const handleAddAmount = (add: number) => {
    const current = parseFloat(formData.amount) || 0;
    setFormData(prev => ({ ...prev, amount: (current + add).toString() }));
  };

  // ── KPI Metrics ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let todayTotal = 0;
    let todayCount = 0;
    let monthTotal = 0;
    let monthCount = 0;
    let payrollTotal = 0;
    let allTotal = 0;

    expenses.forEach(item => {
      const amt = Number(item.cost || 0);
      allTotal += amt;

      const dateObj = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
      const itemDateStr = dateObj.toISOString().slice(0, 10);

      if (itemDateStr === todayStr) {
        todayTotal += amt;
        todayCount++;
      }

      if (dateObj >= monthStart) {
        monthTotal += amt;
        monthCount++;
      }

      if (item.expenseCategory === 'salary' || item.expenseCategory === 'bonus') {
        payrollTotal += amt;
      }
    });

    return {
      todayTotal,
      todayCount,
      monthTotal,
      monthCount,
      payrollTotal,
      allTotal,
      totalCount: expenses.length,
    };
  }, [expenses]);

  // ── Filtered & Sorted Expenses History ────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return expenses
      .filter(item => {
        const d = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
        if (filterPeriod === 'today') {
          if (d.toISOString().slice(0, 10) !== todayStr) return false;
        } else if (filterPeriod === 'week') {
          if (d < oneWeekAgo) return false;
        } else if (filterPeriod === 'month') {
          if (d < monthStart) return false;
        }

        if (filterCategory !== 'all') {
          if ((item.expenseCategory || 'general') !== filterCategory) return false;
        }

        if (filterPayment !== 'all') {
          const p = (item as any).paymentType || item.paymentMode;
          if (p !== filterPayment) return false;
        }

        if (searchHistory.trim()) {
          const q = searchHistory.toLowerCase();
          const matches =
            item.title.toLowerCase().includes(q) ||
            (item.description && item.description.toLowerCase().includes(q)) ||
            (item.employeeName && item.employeeName.toLowerCase().includes(q)) ||
            (item.createdByName && item.createdByName.toLowerCase().includes(q));
          if (!matches) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [expenses, filterPeriod, filterCategory, filterPayment, searchHistory, sortOrder]);

  const filteredTotalAmount = useMemo(() => {
    return filteredExpenses.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
  }, [filteredExpenses]);

  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / itemsPerPage));
  const paginatedExpenses = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredExpenses.slice(start, start + itemsPerPage);
  }, [filteredExpenses, currentPage]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <Navbar />

      {/* FULL WIDTH CONTAINER MATCHING PRODUCTS & CUSTOMER MANAGEMENT */}
      <main className="flex-1 max-w-full w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8 space-y-3.5">
        
        {/* COMPACT PAGE HEADER */}
        <div className="mb-2 sm:mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />
              Expense Management
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              Track store expenditures, payroll payouts, manage presets & view expense history
              {currentStore?.name && (
                <span className="text-gray-400 hidden md:inline"> • Location: <strong className="text-gray-700 font-medium">{currentStore.name}</strong></span>
              )}
            </p>
          </div>

          {/* Action Tabs & Refresh */}
          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <div className="flex bg-gray-200 p-1 rounded-lg border border-gray-200 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setActiveTab('expense')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'expense'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Expense</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'history'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span>History</span>
                <span className="ml-1 bg-gray-300 text-gray-700 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {expenses.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('presets')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'presets'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Presets</span>
                {presets.length > 0 && (
                  <span className="ml-1 bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                    {presets.length}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                loadExpenses();
                loadPresets();
              }}
              disabled={loadingExpenses}
              className="p-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh expenses"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingExpenses ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
            </button>
          </div>
        </div>

        {/* COMPACT KPI CARDS STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Today's Expenses</span>
              <Calendar className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-lg font-bold text-gray-900 tabular-nums font-mono">₹{Math.round(kpis.todayTotal).toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{kpis.todayCount} voucher{kpis.todayCount !== 1 ? 's' : ''} today</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">This Month</span>
              <TrendingDown className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-lg font-bold text-red-600 tabular-nums font-mono">₹{Math.round(kpis.monthTotal).toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{kpis.monthCount} entries in month</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Salaries & Bonus</span>
              <Briefcase className="w-4 h-4 text-purple-600" />
            </div>
            <p className="text-lg font-bold text-purple-600 tabular-nums font-mono">₹{Math.round(kpis.payrollTotal).toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Staff payroll logged</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Total Recorded</span>
              <DollarSign className="w-4 h-4 text-gray-700" />
            </div>
            <p className="text-lg font-bold text-gray-900 tabular-nums font-mono">₹{Math.round(kpis.allTotal).toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{kpis.totalCount} lifetime entries</p>
          </div>
        </div>

        {/* ── TAB 1: ADD EXPENSE (BALANCED 5-COL / 7-COL LAYOUT WITH ZERO BLANK SPACE) ── */}
        {activeTab === 'expense' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            
            {/* Left Column (5 cols): Record Expense Form */}
            <div className="lg:col-span-5 space-y-3">
              <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                  <h2 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <Plus className="w-4 h-4 text-red-600" />
                    Record New Expense
                  </h2>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* Category Selection Tiles */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Category <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, category: 'general', selectedEmployeeId: '' }))}
                        className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          formData.category === 'general'
                            ? 'bg-blue-50/70 border-blue-500 ring-1 ring-blue-500 text-blue-900'
                            : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <Building2 className={`w-3.5 h-3.5 ${formData.category === 'general' ? 'text-blue-600' : 'text-gray-400'}`} />
                          {formData.category === 'general' && <Check className="w-3 h-3 text-blue-600" />}
                        </div>
                        <span className="text-[11px] font-bold block">General</span>
                        <span className="text-[9px] text-gray-400">Bills, tea, rent</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, category: 'salary' }))}
                        className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          formData.category === 'salary'
                            ? 'bg-purple-50/70 border-purple-500 ring-1 ring-purple-500 text-purple-900'
                            : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <Briefcase className={`w-3.5 h-3.5 ${formData.category === 'salary' ? 'text-purple-600' : 'text-gray-400'}`} />
                          {formData.category === 'salary' && <Check className="w-3 h-3 text-purple-600" />}
                        </div>
                        <span className="text-[11px] font-bold block">Salary</span>
                        <span className="text-[9px] text-gray-400">Staff wages</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, category: 'bonus' }))}
                        className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          formData.category === 'bonus'
                            ? 'bg-emerald-50/70 border-emerald-500 ring-1 ring-emerald-500 text-emerald-900'
                            : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <Gift className={`w-3.5 h-3.5 ${formData.category === 'bonus' ? 'text-emerald-600' : 'text-gray-400'}`} />
                          {formData.category === 'bonus' && <Check className="w-3 h-3 text-emerald-600" />}
                        </div>
                        <span className="text-[11px] font-bold block">Bonus</span>
                        <span className="text-[9px] text-gray-400">Incentive</span>
                      </button>
                    </div>
                  </div>

                  {/* Employee Select */}
                  {(formData.category === 'salary' || formData.category === 'bonus') && (
                    <div className="bg-purple-50/50 p-2.5 rounded-lg border border-purple-200 space-y-1">
                      <label className="block text-xs font-semibold text-purple-900">
                        Employee <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.selectedEmployeeId}
                        onChange={e => setFormData(prev => ({ ...prev, selectedEmployeeId: e.target.value }))}
                        required
                        className="w-full px-2.5 py-1.5 text-xs border border-purple-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="">-- Select Staff Member --</option>
                        {employees.map(emp => (
                          <option key={emp.uid} value={emp.uid}>
                            {emp.displayName || emp.name || emp.email} ({emp.role || 'Staff'})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Title & Quick Chips */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Expense Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="e.g. Office Rent, Electricity, Tea"
                      required
                      className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />

                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {quickTitles.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, title: t }))}
                          className="px-2 py-0.5 bg-gray-100 hover:bg-blue-100 hover:text-blue-700 text-gray-600 rounded text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          + {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Amount with Bump Buttons */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Amount (₹) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1.5 text-gray-400 font-bold text-xs">₹</span>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        placeholder="0.00"
                        value={formData.amount}
                        onChange={e => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                        required
                        className="w-full pl-7 pr-3 py-1.5 text-sm font-bold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono tabular-nums"
                      />
                    </div>

                    <div className="flex gap-1 mt-1.5">
                      {[50, 100, 500, 1000, 5000].map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => handleAddAmount(val)}
                          className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-[10px] font-semibold transition-colors cursor-pointer"
                        >
                          +₹{val}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Payment Mode & Date */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Payment Mode</label>
                      <div className="grid grid-cols-3 gap-1">
                        {['cash', 'upi', 'bank'].map(method => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, paymentType: method }))}
                            className={`py-1 text-[11px] font-bold rounded-lg border transition-all cursor-pointer uppercase ${
                              formData.paymentType === method
                                ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {method}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Date</label>
                      <input
                        type="date"
                        value={formData.expenseDate}
                        onChange={e => setFormData(prev => ({ ...prev, expenseDate: e.target.value }))}
                        className="w-full px-2.5 py-1 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Notes <span className="text-gray-400 font-normal text-[10px]">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Voucher # or additional notes..."
                      className="w-full px-2.5 py-1 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs sm:text-sm transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{submitting ? 'Recording...' : 'Record Expense'}</span>
                  </button>
                </form>
              </div>
            </div>

            {/* Right Column (7 cols): Presets Bar + Live Recent Expenses Ledger */}
            <div className="lg:col-span-7 space-y-3">
              
              {/* Presets Horizontal Strip */}
              {presets.length > 0 && (
                <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                      1-Click Presets
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('presets')}
                      className="text-[11px] text-blue-600 hover:underline font-medium cursor-pointer"
                    >
                      Manage Presets →
                    </button>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {presets.slice(0, 8).map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleUsePreset(preset)}
                        className="flex-shrink-0 px-2.5 py-1.5 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg transition-all text-left cursor-pointer group shadow-2xs"
                      >
                        <p className="font-semibold text-gray-900 text-xs truncate max-w-[120px] group-hover:text-blue-700">
                          {preset.name}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] font-bold text-blue-600">
                            {preset.amount !== null ? `₹${preset.amount.toLocaleString('en-IN')}` : 'Variable'}
                          </span>
                          {preset.employeeName && (
                            <span className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0.2 rounded font-medium truncate max-w-[60px]">
                              {preset.employeeName}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Expenses Table (Fills the right column) */}
              <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                      <ClipboardList className="w-4 h-4 text-blue-600" />
                      Recent Recorded Expenses
                    </h3>
                    <p className="text-[10px] text-gray-400">Live ledger of store expenditures</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
                  >
                    View All ({expenses.length}) →
                  </button>
                </div>

                {expenses.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-xs bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                    No expenses recorded yet. Use the form on the left to log your first expenditure.
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-3.5 sm:mx-0">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-700 border-b border-gray-200 font-semibold">
                          <th className="p-2">Date</th>
                          <th className="p-2">Title</th>
                          <th className="p-2">Category</th>
                          <th className="p-2">Mode</th>
                          <th className="p-2 text-right">Amount (₹)</th>
                          <th className="p-2 text-center w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-800">
                        {expenses.slice(0, 9).map(item => {
                          const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-IN') : 'N/A';
                          const cat = item.expenseCategory || 'general';
                          return (
                            <tr key={item.id} className="hover:bg-red-50/30 transition-colors">
                              <td className="p-2 text-gray-600 whitespace-nowrap text-[11px]">{dateStr}</td>
                              <td className="p-2">
                                <p className="font-semibold text-gray-900">{item.title}</p>
                                {item.employeeName && (
                                  <p className="text-[10px] text-purple-600 font-medium">To: {item.employeeName}</p>
                                )}
                              </td>
                              <td className="p-2">
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-semibold capitalize ${
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
                              <td className="p-2 uppercase text-[10px] text-gray-500 font-mono">
                                {(item as any).paymentType || item.paymentMode || 'cash'}
                              </td>
                              <td className="p-2 text-right font-bold text-rose-600 text-xs whitespace-nowrap font-mono tabular-nums">
                                ₹{Number(item.cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteExpense(item.id)}
                                  className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                  title="Delete entry"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
            </div>
          </div>
        )}

        {/* ── TAB 2: FULL EXPENSE HISTORY LEDGER ─────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-gray-200 space-y-3">
            {/* Filter Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-2.5 border-b border-gray-100">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-gray-900">Expense Records & Ledger</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Showing {filteredExpenses.length} entries totaling{' '}
                  <strong className="text-red-600 font-bold font-mono tabular-nums">₹{filteredTotalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search title, staff, notes..."
                    value={searchHistory}
                    onChange={e => {
                      setSearchHistory(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  {searchHistory && (
                    <button
                      type="button"
                      onClick={() => setSearchHistory('')}
                      className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <select
                  value={filterPeriod}
                  onChange={e => {
                    setFilterPeriod(e.target.value as DatePeriod);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none"
                >
                  <option value="month">This Month</option>
                  <option value="today">Today</option>
                  <option value="week">Past 7 Days</option>
                  <option value="all">All Time</option>
                </select>

                <select
                  value={filterCategory}
                  onChange={e => {
                    setFilterCategory(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none"
                >
                  <option value="all">All Categories</option>
                  <option value="general">General</option>
                  <option value="salary">Salary</option>
                  <option value="bonus">Bonus</option>
                </select>

                <select
                  value={filterPayment}
                  onChange={e => {
                    setFilterPayment(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none uppercase"
                >
                  <option value="all">All Modes</option>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank</option>
                </select>

                <button
                  type="button"
                  onClick={() => setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors cursor-pointer"
                  title={`Sort date: ${sortOrder === 'asc' ? 'Oldest first' : 'Newest first'}`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {loadingExpenses ? (
              <div className="py-12 text-center text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                <p className="text-xs">Loading expense records...</p>
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                <Receipt className="w-7 h-7 text-gray-300 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-gray-600">No matching expense entries</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Try adjusting your filters or record a new expense.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto -mx-3.5 sm:mx-0">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-700 border-b border-gray-200 font-semibold">
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5">Expense Details</th>
                        <th className="p-2.5">Category</th>
                        <th className="p-2.5">Employee</th>
                        <th className="p-2.5">Mode</th>
                        <th className="p-2.5 text-right">Amount (₹)</th>
                        <th className="p-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-800">
                      {paginatedExpenses.map(item => {
                        const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-IN') : 'N/A';
                        const timeStr = item.createdAt ? new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
                        const cat = item.expenseCategory || 'general';
                        return (
                          <tr key={item.id} className="hover:bg-red-50/30 transition-colors">
                            <td className="p-2.5 text-gray-600 whitespace-nowrap">
                              <p className="font-semibold text-gray-900">{dateStr}</p>
                              <p className="text-[10px] text-gray-400">{timeStr}</p>
                            </td>

                            <td className="p-2.5">
                              <p className="font-semibold text-gray-900">{item.title}</p>
                              {item.description && (
                                <p className="text-[11px] text-gray-500 line-clamp-1">{item.description}</p>
                              )}
                            </td>

                            <td className="p-2.5">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
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

                            <td className="p-2.5 text-gray-600">
                              {item.employeeName ? (
                                <span className="font-medium text-gray-900">{item.employeeName}</span>
                              ) : (
                                <span className="text-gray-400 text-[10px]">—</span>
                              )}
                            </td>

                            <td className="p-2.5">
                              <span className="uppercase text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono font-medium">
                                {(item as any).paymentType || item.paymentMode || 'cash'}
                              </span>
                            </td>

                            <td className="p-2.5 text-right font-bold text-rose-600 text-sm whitespace-nowrap font-mono tabular-nums">
                              ₹{Number(item.cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>

                            <td className="p-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteExpense(item.id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                title="Delete expense"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2.5 border-t border-gray-100 text-xs">
                    <span className="text-gray-500">
                      Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── TAB 3: MANAGE PRESETS ──────────────────────────────────────────────── */}
        {activeTab === 'presets' && (
          <div className="space-y-3">
            {!showPresetForm ? (
              <button
                type="button"
                onClick={() => setShowPresetForm(true)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs sm:text-sm transition-colors shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Preset Template</span>
              </button>
            ) : (
              <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-blue-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
                  <h3 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-blue-600" />
                    New Preset Template
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowPresetForm(false)}
                    className="text-gray-400 hover:text-gray-600 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSavePreset} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Preset Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={presetForm.name}
                        onChange={e => setPresetForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. Monthly Broadband, Staff Lunch"
                        required
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Category</label>
                      <select
                        value={presetForm.category}
                        onChange={e => setPresetForm(prev => ({ ...prev, category: e.target.value as any }))}
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="general">General Expense</option>
                        <option value="salary">Staff Salary</option>
                        <option value="bonus">Staff Bonus</option>
                      </select>
                    </div>
                  </div>

                  {(presetForm.category === 'salary' || presetForm.category === 'bonus') && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Linked Employee</label>
                      <select
                        value={presetForm.selectedEmployeeId}
                        onChange={e => setPresetForm(prev => ({ ...prev, selectedEmployeeId: e.target.value }))}
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Optional: Link Employee --</option>
                        {employees.map(emp => (
                          <option key={emp.uid} value={emp.uid}>
                            {emp.displayName || emp.name || emp.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center">
                    <div>
                      <label className="flex items-center gap-1.5 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={presetForm.isVariable}
                          onChange={e => setPresetForm(prev => ({ ...prev, isVariable: e.target.checked, amount: '' }))}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-xs font-medium text-gray-700">Variable Amount</span>
                      </label>
                    </div>

                    {!presetForm.isVariable && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Fixed Amount (₹)</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={presetForm.amount}
                          onChange={e => setPresetForm(prev => ({ ...prev, amount: e.target.value }))}
                          placeholder="0.00"
                          required={!presetForm.isVariable}
                          className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Description (Optional)</label>
                    <input
                      type="text"
                      value={presetForm.description}
                      onChange={e => setPresetForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Optional notes or instructions..."
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                      Save Preset
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPresetForm(false)}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Presets Grid */}
            <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-gray-200 space-y-2.5">
              <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
                <h3 className="text-xs sm:text-sm font-bold text-gray-900">
                  Configured Presets ({presets.length})
                </h3>
              </div>

              {presets.length === 0 ? (
                <div className="py-6 text-center text-gray-400 text-xs">
                  No presets created yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {presets.map(preset => (
                    <div
                      key={preset.id}
                      className="p-3 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50/20 transition-all flex flex-col justify-between group"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-1">
                          <h4 className="font-bold text-gray-900 text-xs truncate">{preset.name}</h4>
                          <button
                            type="button"
                            onClick={() => handleDeletePreset(preset.id)}
                            className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                            title="Delete preset"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        <p className="text-sm font-bold text-blue-600 mt-0.5 font-mono">
                          {preset.amount !== null ? `₹${preset.amount.toLocaleString('en-IN')}` : 'Variable Amount'}
                        </p>

                        {preset.description && (
                          <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{preset.description}</p>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 mt-1.5 border-t border-gray-100">
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded-full font-semibold capitalize ${
                            preset.category === 'salary'
                              ? 'bg-purple-100 text-purple-700'
                              : preset.category === 'bonus'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {preset.category || 'General'}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleUsePreset(preset)}
                          className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-semibold transition-colors cursor-pointer"
                        >
                          Use Preset →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AddExpense;
