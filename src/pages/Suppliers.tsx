import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import {
  Users,
  TrendingUp,
  TrendingDown,
  Edit2,
  Search,
  LayoutGrid,
  List,
  X,
  ShoppingCart,
  Plus,
  RefreshCw,
  Loader2,
  Phone,
  Building,
  CreditCard,
  ExternalLink,
  Receipt,
  ArrowRight,
  Check,
  Calendar,
  MessageCircle
} from 'lucide-react';
import type { Supplier, SupplierPayment, PaymentMode, PaymentSplit } from '../types';
import {
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  Timestamp,
  increment
} from 'firebase/firestore';

const Suppliers: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore } = useStore();
  const { success, error: showError } = useToastContext();
  const navigate = useNavigate();

  // Primary data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Search, filter, and sort state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'settled'>('all');
  const [sortBy, setSortBy] = useState<'pending_desc' | 'pending_asc' | 'purchase_desc' | 'name_asc' | 'recent'>('pending_desc');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Modal visibility states
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Selected supplier & ledger tab
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [modalTab, setModalTab] = useState<'pay' | 'history' | 'details'>('pay');
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'purchases' | 'payments'>('all');

  // Double-submission protection locks
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingPaymentRef = useRef(false);
  const isSubmittingSupplierRef = useRef(false);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState<'payment_out' | 'payment_in'>('payment_out');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');

  // Add / Edit Supplier Form state
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    gstNumber: ''
  });

  // Load suppliers on initial mount
  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setIsRefreshing(true);
      const suppliersRef = getCollectionRef('suppliers');
      const q = query(suppliersRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const suppliersList = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAtDate = new Date();
        if (data.createdAt?.toDate) {
          createdAtDate = data.createdAt.toDate();
        } else if (data.createdAt instanceof Date) {
          createdAtDate = data.createdAt;
        }

        return {
          id: doc.id,
          ...data,
          totalPurchaseAmount: Number(data.totalPurchaseAmount) || 0,
          totalPaid: Number(data.totalPaid) || 0,
          totalPending: Number(data.totalPending) || 0,
          createdAt: createdAtDate,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : undefined
        };
      }) as Supplier[];

      setSuppliers(suppliersList);

      // Keep selected supplier updated if modal is currently open
      if (selectedSupplier) {
        const updated = suppliersList.find(s => s.id === selectedSupplier.id);
        if (updated) setSelectedSupplier(updated);
      }
    } catch (err: any) {
      console.error('Failed to load suppliers:', err);
      showError('Failed to load suppliers: ' + (err.message || 'Network error'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Fetch full transaction history for a selected supplier
  const fetchSupplierPayments = async (supplierId: string) => {
    setIsLoadingHistory(true);
    try {
      // 1. Fetch payment records
      const paymentsRef = getCollectionRef('supplierPayments');
      const q = query(paymentsRef, where('supplierId', '==', supplierId));
      const paymentsSnapshot = await getDocs(q);

      const payments = paymentsSnapshot.docs.map(doc => {
        const d = doc.data();
        let createdAtDate = new Date();
        if (d.createdAt?.toDate) {
          createdAtDate = d.createdAt.toDate();
        } else if (d.createdAt instanceof Date) {
          createdAtDate = d.createdAt;
        }

        return {
          id: doc.id,
          ...d,
          createdAt: createdAtDate
        };
      }) as SupplierPayment[];

      // 2. Fetch purchase invoices for this supplier
      const purchasesRef = getCollectionRef('purchases');
      const imeiPurchasesRef = getCollectionRef('imeiPurchases');
      const [allPurchasesSnapshot, imeiPurchasesSnapshot] = await Promise.all([
        getDocs(purchasesRef),
        getDocs(imeiPurchasesRef)
      ]);

      const purchasePayments: SupplierPayment[] = [];
      const combinedDocs = [...allPurchasesSnapshot.docs, ...imeiPurchasesSnapshot.docs];
      combinedDocs.forEach(doc => {
        const purchaseData = doc.data();
        let matchesSupplier = false;
        if (typeof purchaseData.supplierId === 'string') {
          matchesSupplier = purchaseData.supplierId === supplierId;
        } else if (purchaseData.supplierId?.id) {
          matchesSupplier = purchaseData.supplierId.id === supplierId;
        }

        if (matchesSupplier) {
          let createdAtDate = new Date();
          if (purchaseData.createdAt?.toDate) {
            createdAtDate = purchaseData.createdAt.toDate();
          } else if (purchaseData.createdAt instanceof Date) {
            createdAtDate = purchaseData.createdAt;
          }

          purchasePayments.push({
            id: doc.id,
            supplierId: supplierId,
            supplierName: purchaseData.supplierName || '',
            amount: Number(purchaseData.totalAmount) || 0,
            type: 'purchase',
            paymentMode: purchaseData.paymentMode || 'cash',
            paymentSplit: purchaseData.paymentSplit,
            notes: purchaseData.notes || `Purchase #${purchaseData.purchaseNumber || doc.id.slice(-6)}`,
            relatedPurchaseId: doc.id,
            createdAt: createdAtDate,
            createdBy: purchaseData.createdBy || '',
            createdByName: purchaseData.createdByName || ''
          } as SupplierPayment);
        }
      });

      // Combine and sort reverse chronological (newest first)
      const allTransactions = [...payments, ...purchasePayments].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );

      setSupplierPayments(allTransactions);
    } catch (err: any) {
      console.error('Error fetching transactions:', err);
      showError('Failed to load transaction history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Filter and Sort Suppliers
  const filteredAndSortedSuppliers = useMemo(() => {
    return suppliers
      .filter(supplier => {
        // Status tab filtering
        if (statusFilter === 'pending' && supplier.totalPending <= 0) return false;
        if (statusFilter === 'settled' && supplier.totalPending > 0) return false;

        // Search term matching
        if (!searchTerm.trim()) return true;
        const term = searchTerm.toLowerCase().trim();
        return (
          supplier.name.toLowerCase().includes(term) ||
          supplier.phone.includes(term) ||
          (supplier.contactPerson && supplier.contactPerson.toLowerCase().includes(term)) ||
          (supplier.gstNumber && supplier.gstNumber.toLowerCase().includes(term)) ||
          (supplier.email && supplier.email.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'pending_desc') return b.totalPending - a.totalPending;
        if (sortBy === 'pending_asc') return a.totalPending - b.totalPending;
        if (sortBy === 'purchase_desc') return b.totalPurchaseAmount - a.totalPurchaseAmount;
        if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
        if (sortBy === 'recent') return b.createdAt.getTime() - a.createdAt.getTime();
        return 0;
      });
  }, [suppliers, searchTerm, statusFilter, sortBy]);

  // Overall metrics
  const metrics = useMemo(() => {
    const totalSuppliers = suppliers.length;
    const totalPendingDues = suppliers.reduce((sum, s) => sum + Math.max(s.totalPending || 0, 0), 0);
    const suppliersWithDuesCount = suppliers.filter(s => (s.totalPending || 0) > 0).length;
    const totalPurchaseAmount = suppliers.reduce((sum, s) => sum + (s.totalPurchaseAmount || 0), 0);
    const totalPaidAmount = suppliers.reduce((sum, s) => sum + (s.totalPaid || 0), 0);
    const settledSuppliersCount = suppliers.filter(s => (s.totalPending || 0) <= 0).length;

    return {
      totalSuppliers,
      totalPendingDues,
      suppliersWithDuesCount,
      totalPurchaseAmount,
      totalPaidAmount,
      settledSuppliersCount
    };
  }, [suppliers]);

  // Form Validation: Payment
  const isPaymentFormValid = useMemo(() => {
    if (!selectedSupplier) return false;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) return false;

    if (paymentMode === 'split') {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;
      return Math.abs(cash + upi + card - amount) < 0.01;
    }
    return true;
  }, [selectedSupplier, paymentAmount, paymentMode, cashAmount, upiAmount, cardAmount]);

  // Live remaining balance calculation
  const calculatedRemainingDue = useMemo(() => {
    if (!selectedSupplier) return 0;
    const amount = parseFloat(paymentAmount);
    const currentDue = selectedSupplier.totalPending || 0;
    if (isNaN(amount) || amount <= 0) return currentDue;

    if (paymentType === 'payment_out') {
      return currentDue - amount;
    } else {
      // Payment in (refund from supplier) increases our pending claim or decrements paid
      return currentDue + amount;
    }
  }, [selectedSupplier, paymentAmount, paymentType]);

  // Handle Recording Payment with double-click immunity
  const handleAddPayment = async () => {
    // 1. Double-click prevention: Synchronous lock
    if (isSubmittingPaymentRef.current) return;
    if (!selectedSupplier) {
      showError('Please select a supplier');
      return;
    }

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      showError('Please enter a valid payment amount');
      return;
    }

    let paymentSplit: PaymentSplit | undefined;
    if (paymentMode === 'split') {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;

      if (Math.abs(cash + upi + card - amount) > 0.01) {
        showError('Split amounts (Cash + UPI + Card) must equal the total payment amount');
        return;
      }
      paymentSplit = { cash, upi, card };
    }

    try {
      isSubmittingPaymentRef.current = true;
      setIsSubmitting(true);

      const paymentData: any = {
        supplierId: selectedSupplier.id!,
        supplierName: selectedSupplier.name,
        amount,
        type: paymentType,
        paymentMode,
        notes: paymentNotes.trim(),
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'User'
      };

      if (paymentSplit) {
        paymentData.paymentSplit = paymentSplit;
      }

      if (referenceNumber.trim()) {
        paymentData.referenceNumber = referenceNumber.trim();
      }

      // If paying out to supplier, distribute across pending purchase records (FIFO)
      if (paymentType === 'payment_out') {
        const purchasesRef = getCollectionRef('purchases');
        const imeiPurchasesRef = getCollectionRef('imeiPurchases');
        const [purchasesSnapshot, imeiPurchasesSnapshot] = await Promise.all([
          getDocs(purchasesRef),
          getDocs(imeiPurchasesRef)
        ]);

        const pendingPurchases: { id: string; collectionName: 'purchases' | 'imeiPurchases'; data: any; createdAtMs: number }[] = [];
        const processPending = (docs: any[], colName: 'purchases' | 'imeiPurchases') => {
          docs.forEach(docSnap => {
            const pData = docSnap.data();
            const matchesSupplier =
              (typeof pData.supplierId === 'string' && pData.supplierId === selectedSupplier.id) ||
              (pData.supplierId?.id === selectedSupplier.id);

            const pending = Number(pData.pendingAmount) || 0;
            if (matchesSupplier && pending > 0) {
              let createdAtMs = 0;
              if (pData.createdAt?.toDate) {
                createdAtMs = pData.createdAt.toDate().getTime();
              } else if (pData.createdAt instanceof Date) {
                createdAtMs = pData.createdAt.getTime();
              } else if (typeof pData.createdAt === 'string') {
                createdAtMs = new Date(pData.createdAt).getTime();
              }
              pendingPurchases.push({ id: docSnap.id, collectionName: colName, data: pData, createdAtMs });
            }
          });
        };
        processPending(purchasesSnapshot.docs, 'purchases');
        processPending(imeiPurchasesSnapshot.docs, 'imeiPurchases');

        // FIFO: Oldest purchase gets paid off first
        pendingPurchases.sort((a, b) => a.createdAtMs - b.createdAtMs);

        let remainingPayment = amount;
        const updatedPurchases: string[] = [];

        for (const item of pendingPurchases) {
          if (remainingPayment <= 0) break;
          const purchasePending = Number(item.data.pendingAmount) || 0;
          const purchaseRef = getDocRef(item.collectionName, item.id);

          const paymentForThisPurchase = Math.min(remainingPayment, purchasePending);
          const newPaidAmount = (Number(item.data.paidAmount) || 0) + paymentForThisPurchase;
          const newPendingAmount = Math.max(0, purchasePending - paymentForThisPurchase);

          let newStatus: 'paid' | 'pending' | 'unpaid' = 'unpaid';
          if (newPendingAmount === 0) {
            newStatus = 'paid';
          } else if (newPaidAmount > 0) {
            newStatus = 'pending';
          }

          await updateDoc(purchaseRef, {
            paidAmount: newPaidAmount,
            pendingAmount: newPendingAmount,
            paymentStatus: newStatus,
            updatedAt: Timestamp.now()
          });

          remainingPayment -= paymentForThisPurchase;
          updatedPurchases.push(item.id);
        }

        if (updatedPurchases.length > 0) {
          paymentData.affectedPurchases = updatedPurchases;
        }
      }

      // Add payment transaction document
      await addDoc(getCollectionRef('supplierPayments'), paymentData);

      // Update supplier totals in Firestore
      const supplierRef = getDocRef('suppliers', selectedSupplier.id!);
      const updateData: any = {
        updatedAt: Timestamp.now()
      };

      if (paymentType === 'payment_out') {
        updateData.totalPaid = increment(amount);
        updateData.totalPending = increment(-amount);
      } else if (paymentType === 'payment_in') {
        updateData.totalPaid = increment(-amount);
        updateData.totalPending = increment(amount);
      }

      await updateDoc(supplierRef, updateData);

      success(`Successfully recorded ₹${amount.toLocaleString('en-IN')} payment for ${selectedSupplier.name}`);
      resetPaymentForm();
      await fetchSuppliers();
      await fetchSupplierPayments(selectedSupplier.id!);
      setModalTab('history'); // Switch to history tab to confirm the recorded transaction
    } catch (err: any) {
      console.error('Error recording payment:', err);
      showError('Failed to record payment: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
      isSubmittingPaymentRef.current = false;
    }
  };

  // Handle Adding New Supplier with double-click protection
  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingSupplierRef.current) return;

    if (!supplierForm.name.trim()) {
      showError('Supplier name is required');
      return;
    }
    if (!supplierForm.phone.trim()) {
      showError('Phone number is required');
      return;
    }

    try {
      isSubmittingSupplierRef.current = true;
      setIsSubmitting(true);

      const newSupplierData = {
        name: supplierForm.name.trim(),
        contactPerson: supplierForm.contactPerson.trim(),
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim(),
        address: supplierForm.address.trim(),
        gstNumber: supplierForm.gstNumber.trim().toUpperCase(),
        totalPurchaseAmount: 0,
        totalPaid: 0,
        totalPending: 0,
        isActive: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'User'
      };

      await addDoc(getCollectionRef('suppliers'), newSupplierData);

      success(`Supplier "${supplierForm.name.trim()}" added successfully!`);
      setShowAddModal(false);
      resetSupplierForm();
      await fetchSuppliers();
    } catch (err: any) {
      console.error('Error adding supplier:', err);
      showError('Failed to add supplier: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
      isSubmittingSupplierRef.current = false;
    }
  };

  // Handle Editing Supplier with double-click protection
  const handleEditSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingSupplierRef.current) return;
    if (!selectedSupplier?.id) return;

    if (!supplierForm.name.trim()) {
      showError('Supplier name is required');
      return;
    }
    if (!supplierForm.phone.trim()) {
      showError('Phone number is required');
      return;
    }

    try {
      isSubmittingSupplierRef.current = true;
      setIsSubmitting(true);

      const supplierRef = getDocRef('suppliers', selectedSupplier.id);
      await updateDoc(supplierRef, {
        name: supplierForm.name.trim(),
        contactPerson: supplierForm.contactPerson.trim(),
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim(),
        address: supplierForm.address.trim(),
        gstNumber: supplierForm.gstNumber.trim().toUpperCase(),
        updatedAt: Timestamp.now()
      });

      success(`Supplier "${supplierForm.name.trim()}" updated successfully!`);
      setShowEditModal(false);
      await fetchSuppliers();
    } catch (err: any) {
      console.error('Error updating supplier:', err);
      showError('Failed to update supplier: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
      isSubmittingSupplierRef.current = false;
    }
  };

  // Open modals
  const openLedgerModal = (supplier: Supplier, defaultTab: 'pay' | 'history' | 'details' = 'pay') => {
    setSelectedSupplier(supplier);
    setModalTab(defaultTab);
    resetPaymentForm();
    // Default to full pending due if paying
    if (supplier.totalPending > 0) {
      setPaymentAmount(String(supplier.totalPending));
    }
    fetchSupplierPayments(supplier.id!);
    setShowLedgerModal(true);
  };

  const openAddModal = () => {
    resetSupplierForm();
    setShowAddModal(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setSupplierForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson || '',
      phone: supplier.phone,
      email: supplier.email || '',
      address: supplier.address || '',
      gstNumber: supplier.gstNumber || ''
    });
    setShowEditModal(true);
  };

  const resetPaymentForm = () => {
    setPaymentAmount('');
    setPaymentType('payment_out');
    setPaymentMode('cash');
    setPaymentNotes('');
    setReferenceNumber('');
    setCashAmount('');
    setUpiAmount('');
    setCardAmount('');
  };

  const resetSupplierForm = () => {
    setSupplierForm({
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      gstNumber: ''
    });
  };

  // Filtered transactions for the ledger history tab
  const filteredTransactions = useMemo(() => {
    if (historyFilter === 'purchases') {
      return supplierPayments.filter(t => t.type === 'purchase');
    }
    if (historyFilter === 'payments') {
      return supplierPayments.filter(t => t.type === 'payment_out' || t.type === 'payment_in');
    }
    return supplierPayments;
  }, [supplierPayments, historyFilter]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)]">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <Users className="w-6 h-6 text-blue-600 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="mt-4 text-slate-600 font-medium">Loading suppliers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8">
        {/* COMPACT HEADER (Clean Project Style matching Products.tsx) */}
        <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Building className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Suppliers & Vendors
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {filteredAndSortedSuppliers.length} supplier{filteredAndSortedSuppliers.length !== 1 ? 's' : ''} listed
              {currentStore?.name && (
                <span className="text-gray-400 hidden md:inline"> • Location: <strong className="text-gray-700 font-medium">{currentStore.name}</strong></span>
              )}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => fetchSuppliers(true)}
              disabled={isRefreshing}
              title="Refresh suppliers list"
              className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={openAddModal}
              className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Supplier</span>
            </button>
          </div>
        </div>

        {/* COMPACT STATS (Matching Products.tsx) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
            <p className="text-xs text-gray-500">Total Suppliers</p>
            <p className="text-lg font-bold text-gray-900">{metrics.totalSuppliers}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
            <p className="text-xs text-gray-500">Total Purchases</p>
            <p className="text-lg font-bold text-blue-600">₹{Math.round(metrics.totalPurchaseAmount).toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
            <p className="text-xs text-gray-500">Total Settled</p>
            <p className="text-lg font-bold text-green-600">₹{Math.round(metrics.totalPaidAmount).toLocaleString()}</p>
          </div>
          <div
            onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
            className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${
              statusFilter === 'pending' ? 'border-red-500 bg-red-50/60' : 'border-gray-200 hover:border-red-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Outstanding Dues</p>
              {statusFilter === 'pending' && <span className="text-[10px] text-red-600 font-bold uppercase">Filtered</span>}
            </div>
            <p className="text-lg font-bold text-red-600">₹{Math.round(metrics.totalPendingDues).toLocaleString()}</p>
          </div>
        </div>

        {/* COMPACT FILTERS & SEARCH (Matching Products.tsx) */}
        <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Status Filter Tags */}
            {[
              { key: 'all', label: `All (${suppliers.length})` },
              { key: 'pending', label: `With Dues (${metrics.suppliersWithDuesCount})` },
              { key: 'settled', label: `Settled (${metrics.settledSuppliersCount})` },
            ].map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(s.key as any)}
                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${
                  statusFilter === (s.key as any)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {s.label}
              </button>
            ))}

            {/* Search Input inline */}
            <div className="relative flex-1 min-w-[200px] sm:min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search supplier, phone, contact, GST..."
                className="w-full pl-9 pr-7 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none"
              >
                <option value="pending_desc">Dues: High → Low</option>
                <option value="pending_asc">Dues: Low → High</option>
                <option value="purchase_desc">Purchases: High → Low</option>
                <option value="name_asc">Name: A → Z</option>
                <option value="recent">Recently Added</option>
              </select>
            </div>

            {/* View switcher */}
            <div className="flex items-center border border-gray-300 rounded-lg p-0.5 bg-gray-50">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'grid' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'table' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Table view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Section: Grid View or Table View */}
        {filteredAndSortedSuppliers.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-10 text-center shadow-sm">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mx-auto mb-3">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900">No suppliers found</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
              {searchTerm
                ? `No suppliers matched "${searchTerm}". Try adjusting your search query.`
                : statusFilter === 'pending'
                ? 'No suppliers currently have outstanding dues!'
                : 'Get started by registering your first supplier.'}
            </p>
            <div className="mt-4">
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  Clear filters
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-medium rounded-lg shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Supplier</span>
                </button>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredAndSortedSuppliers.map(supplier => {
              const hasDues = (supplier.totalPending || 0) > 0;
              const initial = supplier.name.charAt(0).toUpperCase() || 'S';

              return (
                <div
                  key={supplier.id}
                  className={`bg-white rounded-lg border transition-all duration-200 hover:shadow-md flex flex-col overflow-hidden ${
                    hasDues
                      ? 'border-red-200 hover:border-red-300'
                      : 'border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {/* Top card banner */}
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                            hasDues
                              ? 'bg-red-50 text-red-600 border border-red-200'
                              : 'bg-green-50 text-green-700 border border-green-200'
                          }`}
                        >
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-900 text-sm truncate" title={supplier.name}>
                            {supplier.name}
                          </h3>
                          {supplier.contactPerson ? (
                            <p className="text-xs text-gray-500 truncate mt-0.5">
                              {supplier.contactPerson}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-400 mt-0.5">Supplier / Vendor</p>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openEditModal(supplier)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                        title="Edit Supplier"
                        aria-label="Edit Supplier"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Contact & GST Chips */}
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-100">
                        <span className="flex items-center gap-1.5 font-medium text-gray-700">
                          <Phone className="w-3.5 h-3.5 text-gray-400" />
                          <a
                            href={`tel:${supplier.phone}`}
                            className="hover:text-blue-600 hover:underline"
                            onClick={e => e.stopPropagation()}
                          >
                            {supplier.phone}
                          </a>
                        </span>
                        <a
                          href={`https://wa.me/${supplier.phone.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-green-600 hover:text-green-700 font-medium inline-flex items-center gap-1 text-[11px]"
                          onClick={e => e.stopPropagation()}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>WhatsApp</span>
                        </a>
                      </div>

                      {supplier.gstNumber && (
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 px-1">
                          <span className="font-semibold text-gray-400 uppercase">GST:</span>
                          <span className="font-mono text-gray-700">{supplier.gstNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Financial Due Highlight Box */}
                  <div className="px-4 py-2 mt-auto">
                    <div
                      className={`p-3 rounded-lg border flex items-center justify-between ${
                        hasDues
                          ? 'bg-red-50/60 border-red-200'
                          : 'bg-green-50/50 border-green-200'
                      }`}
                    >
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">
                          {hasDues ? 'Outstanding Due' : 'Balance Status'}
                        </p>
                        <p
                          className={`text-lg font-bold ${
                            hasDues ? 'text-red-600' : 'text-green-700'
                          }`}
                        >
                          {hasDues
                            ? `₹${supplier.totalPending.toLocaleString('en-IN', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}`
                            : 'All Cleared ✓'}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-[10px] uppercase font-semibold text-gray-400">Purchases</p>
                        <p className="text-xs font-bold text-gray-700">
                          ₹{supplier.totalPurchaseAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Card Action Buttons */}
                  <div className="p-3 pt-2 border-t border-gray-100 bg-gray-50/50 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openLedgerModal(supplier, hasDues ? 'pay' : 'history')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-xs transition-all shadow-xs ${
                        hasDues
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>{hasDues ? 'Pay' : 'Ledger'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openLedgerModal(supplier, 'history')}
                      className="px-2.5 py-2 bg-white hover:bg-gray-100 text-gray-700 font-semibold text-xs rounded-lg border border-gray-300 transition-colors"
                      title="View Purchases & Payments History"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Table View */
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <th className="py-3 px-4">Supplier</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4 text-right">Total Purchases</th>
                    <th className="py-3 px-4 text-right">Total Paid</th>
                    <th className="py-3 px-4 text-right">Outstanding Dues</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {filteredAndSortedSuppliers.map(supplier => {
                    const hasDues = (supplier.totalPending || 0) > 0;
                    const initial = supplier.name.charAt(0).toUpperCase() || 'S';

                    return (
                      <tr key={supplier.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                                hasDues
                                  ? 'bg-red-50 text-red-600 border border-red-200'
                                  : 'bg-green-50 text-green-700 border border-green-200'
                              }`}
                            >
                              {initial}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">{supplier.name}</div>
                              {supplier.gstNumber && (
                                <div className="text-[11px] font-mono text-gray-400">
                                  GST: {supplier.gstNumber}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-gray-900 font-medium text-xs">{supplier.phone}</div>
                          {supplier.contactPerson && (
                            <div className="text-xs text-gray-500">{supplier.contactPerson}</div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-medium text-gray-900 text-xs">
                          ₹{supplier.totalPurchaseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-medium text-green-600 text-xs">
                          ₹{supplier.totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span
                            className={`font-bold text-sm ${
                              hasDues ? 'text-red-600' : 'text-gray-400'
                            }`}
                          >
                            ₹{supplier.totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {hasDues ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                              Pending
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                              Settled ✓
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openLedgerModal(supplier, hasDues ? 'pay' : 'history')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                hasDues
                                  ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                              }`}
                            >
                              {hasDues ? 'Pay' : 'Ledger'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(supplier)}
                              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                              title="Edit Supplier"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
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

      {/* ========================================================================= */}
      {/* MODAL 1: REDEFINED SUPPLIER LEDGER & PAYMENT MODAL                        */}
      {/* ========================================================================= */}
      {showLedgerModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0 ${
                    selectedSupplier.totalPending > 0
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {selectedSupplier.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-slate-900 truncate">{selectedSupplier.name}</h2>
                    {selectedSupplier.totalPending > 0 ? (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                        Due: ₹{selectedSupplier.totalPending.toLocaleString('en-IN')}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                        Settled ✓
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Phone: {selectedSupplier.phone}</span>
                    {selectedSupplier.contactPerson && <span>• Contact: {selectedSupplier.contactPerson}</span>}
                    {selectedSupplier.gstNumber && <span>• GST: {selectedSupplier.gstNumber}</span>}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowLedgerModal(false)}
                disabled={isSubmitting}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-slate-200 bg-white px-6">
              <button
                onClick={() => setModalTab('pay')}
                className={`py-3 px-4 font-semibold text-sm border-b-2 transition-all flex items-center gap-2 ${
                  modalTab === 'pay'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>Record Payment</span>
              </button>

              <button
                onClick={() => setModalTab('history')}
                className={`py-3 px-4 font-semibold text-sm border-b-2 transition-all flex items-center gap-2 ${
                  modalTab === 'history'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Receipt className="w-4 h-4" />
                <span>Ledger History ({supplierPayments.length})</span>
              </button>

              <button
                onClick={() => setModalTab('details')}
                className={`py-3 px-4 font-semibold text-sm border-b-2 transition-all flex items-center gap-2 ${
                  modalTab === 'details'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Building className="w-4 h-4" />
                <span>Supplier Profile</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
              {/* TAB 1: RECORD PAYMENT */}
              {modalTab === 'pay' && (
                <div className="max-w-2xl mx-auto space-y-5">
                  {/* Payment Type Selector */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                      Payment Direction
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentType('payment_out')}
                        className={`p-3 rounded-xl border font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                          paymentType === 'payment_out'
                            ? 'bg-rose-50 border-rose-300 text-rose-700 ring-2 ring-rose-500/20 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <TrendingDown className="w-4 h-4 text-rose-600" />
                        <div className="text-left">
                          <div className="font-semibold">Pay Supplier</div>
                          <div className="text-[11px] opacity-75">Settle purchase dues</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentType('payment_in')}
                        className={`p-3 rounded-xl border font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                          paymentType === 'payment_in'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-emerald-500/20 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                        <div className="text-left">
                          <div className="font-semibold">Supplier Refund</div>
                          <div className="text-[11px] opacity-75">Receive money back</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Payment Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                        Payment Amount *
                      </label>
                      {selectedSupplier.totalPending > 0 && (
                        <span className="text-xs text-rose-600 font-semibold">
                          Total Due: ₹{selectedSupplier.totalPending.toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">
                        ₹
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={paymentAmount}
                        onChange={e => setPaymentAmount(e.target.value)}
                        disabled={isSubmitting}
                        className="w-full pl-9 pr-4 py-3 text-xl font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>

                    {/* Quick Fill Chips */}
                    <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                      {selectedSupplier.totalPending > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setPaymentAmount(String(selectedSupplier.totalPending))}
                            className="px-2.5 py-1 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200 transition-colors"
                          >
                            Full Due (₹{selectedSupplier.totalPending.toLocaleString('en-IN')})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentAmount(String(Math.round(selectedSupplier.totalPending / 2)))}
                            className="px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-colors"
                          >
                            50% (₹{Math.round(selectedSupplier.totalPending / 2).toLocaleString('en-IN')})
                          </button>
                        </>
                      )}
                      {[1000, 2000, 5000, 10000].map(amt => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setPaymentAmount(String(amt))}
                          className="px-2.5 py-1 text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-colors"
                        >
                          ₹{amt.toLocaleString('en-IN')}
                        </button>
                      ))}
                      {paymentAmount && (
                        <button
                          type="button"
                          onClick={() => setPaymentAmount('')}
                          className="px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg transition-colors ml-auto"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Real-Time Balance Impact Preview Card */}
                  {parseFloat(paymentAmount) > 0 && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Live Balance Impact Preview
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center pt-1">
                        <div>
                          <div className="text-[11px] text-slate-500">Current Due</div>
                          <div className="text-sm font-bold text-slate-800">
                            ₹{selectedSupplier.totalPending.toLocaleString('en-IN')}
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-center">
                          <div className="text-[11px] text-slate-400">
                            {paymentType === 'payment_out' ? '- Paying' : '+ Refund'}
                          </div>
                          <div className="text-xs font-semibold text-blue-600 flex items-center gap-1">
                            <span>₹{parseFloat(paymentAmount || '0').toLocaleString('en-IN')}</span>
                            <ArrowRight className="w-3 h-3" />
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] text-slate-500">New Due Balance</div>
                          <div
                            className={`text-sm font-extrabold ${
                              calculatedRemainingDue <= 0 ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            ₹{Math.max(0, calculatedRemainingDue).toLocaleString('en-IN')}
                            {calculatedRemainingDue <= 0 && ' (Settled)'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Payment Mode */}
                  <div>
                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                      Payment Mode
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {(['cash', 'upi', 'card', 'cheque', 'split'] as PaymentMode[]).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPaymentMode(mode)}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold capitalize transition-all ${
                            paymentMode === mode
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Split Payment inputs if mode is split */}
                  {paymentMode === 'split' && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>Split Breakdown</span>
                        <span className="text-[11px] text-slate-500">
                          Total must equal ₹{parseFloat(paymentAmount || '0').toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] text-slate-500 font-medium mb-1">Cash</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={cashAmount}
                            onChange={e => setCashAmount(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 font-medium mb-1">UPI</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={upiAmount}
                            onChange={e => setUpiAmount(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 font-medium mb-1">Card</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={cardAmount}
                            onChange={e => setCardAmount(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reference Number & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Reference / Transaction ID <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. UTR12345678, Chq #4401"
                        value={referenceNumber}
                        onChange={e => setReferenceNumber(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Notes / Remarks <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Add a remark or memo..."
                        value={paymentNotes}
                        onChange={e => setPaymentNotes(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Submit Button with Rock-Solid Double-Click Protection */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleAddPayment}
                      disabled={isSubmitting || !isPaymentFormValid}
                      className={`w-full py-3.5 px-4 rounded-xl font-bold text-white shadow-sm transition-all transform active:scale-98 flex items-center justify-center gap-2 ${
                        isSubmitting || !isPaymentFormValid
                          ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                          : paymentType === 'payment_out'
                          ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
                          : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                      }`}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Recording Payment...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-5 h-5 stroke-[2.5]" />
                          <span>
                            {paymentType === 'payment_out' ? 'Confirm Payment of ' : 'Record Refund of '}
                            ₹
                            {paymentAmount
                              ? parseFloat(paymentAmount).toLocaleString('en-IN', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2
                                })
                              : '0.00'}
                          </span>
                        </>
                      )}
                    </button>
                    <p className="text-[11px] text-center text-slate-400 mt-2">
                      FIFO applies automatically to settle the oldest pending purchase orders first.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: LEDGER HISTORY */}
              {modalTab === 'history' && (
                <div className="space-y-4">
                  {/* History Filter Chips */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                      <button
                        onClick={() => setHistoryFilter('all')}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                          historyFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        All Transactions ({supplierPayments.length})
                      </button>
                      <button
                        onClick={() => setHistoryFilter('purchases')}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                          historyFilter === 'purchases'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-600 hover:text-blue-600'
                        }`}
                      >
                        Purchases Only
                      </button>
                      <button
                        onClick={() => setHistoryFilter('payments')}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                          historyFilter === 'payments'
                            ? 'bg-white text-emerald-600 shadow-sm'
                            : 'text-slate-600 hover:text-emerald-600'
                        }`}
                      >
                        Payments Only
                      </button>
                    </div>

                    <button
                      onClick={() => fetchSupplierPayments(selectedSupplier.id!)}
                      disabled={isLoadingHistory}
                      className="text-xs text-blue-600 hover:text-blue-700 font-semibold inline-flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {/* Transactions List */}
                  {isLoadingHistory ? (
                    <div className="py-12 text-center text-slate-500">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-2" />
                      <p className="text-sm">Loading transactions...</p>
                    </div>
                  ) : filteredTransactions.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
                      <Receipt className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                      <p className="text-sm font-medium text-slate-600">No transactions recorded yet</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Purchase orders and payments will appear here chronologically.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredTransactions.map(tx => {
                        const isPurchase = tx.type === 'purchase';
                        const isPaymentOut = tx.type === 'payment_out';

                        return (
                          <div
                            key={tx.id}
                            className="bg-white p-4 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors flex items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                  isPurchase
                                    ? 'bg-blue-50 text-blue-600 border border-blue-100'
                                    : isPaymentOut
                                    ? 'bg-rose-50 text-rose-600 border border-rose-100'
                                    : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                }`}
                              >
                                {isPurchase ? (
                                  <ShoppingCart className="w-5 h-5" />
                                ) : isPaymentOut ? (
                                  <TrendingDown className="w-5 h-5" />
                                ) : (
                                  <TrendingUp className="w-5 h-5" />
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900 text-sm">
                                    {isPurchase
                                      ? 'Purchase Order'
                                      : isPaymentOut
                                      ? 'Payment Paid Out'
                                      : 'Refund Received'}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      isPurchase
                                        ? 'bg-blue-100 text-blue-700'
                                        : isPaymentOut
                                        ? 'bg-rose-100 text-rose-700'
                                        : 'bg-emerald-100 text-emerald-700'
                                    }`}
                                  >
                                    {tx.paymentMode}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3 text-slate-400" />
                                    {tx.createdAt.toLocaleDateString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric'
                                    })}
                                  </span>
                                  {tx.notes && <span>• {tx.notes}</span>}
                                  {tx.referenceNumber && <span>• Ref: {tx.referenceNumber}</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 flex-shrink-0 text-right">
                              <div>
                                <div
                                  className={`text-base font-extrabold ${
                                    isPurchase
                                      ? 'text-slate-900'
                                      : isPaymentOut
                                      ? 'text-rose-600'
                                      : 'text-emerald-600'
                                  }`}
                                >
                                  {isPaymentOut ? '-' : isPurchase ? '' : '+'}₹
                                  {tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </div>
                                {tx.createdByName && (
                                  <div className="text-[10px] text-slate-400">By {tx.createdByName}</div>
                                )}
                              </div>

                              {isPurchase && tx.relatedPurchaseId && (
                                <button
                                  onClick={() => {
                                    setShowLedgerModal(false);
                                    navigate(`/purchases/${tx.relatedPurchaseId}`);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="View Purchase Invoice"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: SUPPLIER PROFILE */}
              {modalTab === 'details' && (
                <div className="max-w-xl mx-auto space-y-4">
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                      <div>
                        <h3 className="font-bold text-slate-900 text-lg">{selectedSupplier.name}</h3>
                        <p className="text-xs text-slate-500">Supplier Account ID: {selectedSupplier.id}</p>
                      </div>
                      <button
                        onClick={() => {
                          setShowLedgerModal(false);
                          openEditModal(selectedSupplier);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit Details</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-400 block mb-0.5">Contact Person</span>
                        <span className="font-semibold text-slate-800">
                          {selectedSupplier.contactPerson || 'Not provided'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block mb-0.5">Phone Number</span>
                        <a
                          href={`tel:${selectedSupplier.phone}`}
                          className="font-semibold text-blue-600 hover:underline"
                        >
                          {selectedSupplier.phone}
                        </a>
                      </div>

                      <div>
                        <span className="text-slate-400 block mb-0.5">Email Address</span>
                        <span className="font-semibold text-slate-800">
                          {selectedSupplier.email || 'Not provided'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block mb-0.5">GST Number</span>
                        <span className="font-semibold font-mono text-slate-800">
                          {selectedSupplier.gstNumber || 'Not provided'}
                        </span>
                      </div>

                      <div className="sm:col-span-2">
                        <span className="text-slate-400 block mb-0.5">Address</span>
                        <span className="font-medium text-slate-700">
                          {selectedSupplier.address || 'No address provided'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Summary Stat Box */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-center">
                      <div className="text-[10px] text-blue-600 uppercase font-bold">Total Purchases</div>
                      <div className="text-base font-extrabold text-blue-900 mt-0.5">
                        ₹{selectedSupplier.totalPurchaseAmount.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
                      <div className="text-[10px] text-emerald-600 uppercase font-bold">Total Paid</div>
                      <div className="text-base font-extrabold text-emerald-900 mt-0.5">
                        ₹{selectedSupplier.totalPaid.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-center">
                      <div className="text-[10px] text-rose-600 uppercase font-bold">Pending Due</div>
                      <div className="text-base font-extrabold text-rose-900 mt-0.5">
                        ₹{selectedSupplier.totalPending.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 px-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Created on {selectedSupplier.createdAt.toLocaleDateString('en-IN')}
              </span>
              <button
                type="button"
                onClick={() => setShowLedgerModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200/70 rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADD NEW SUPPLIER MODAL                                           */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Add New Supplier</h2>
                  <p className="text-xs text-slate-500">Register a new vendor or wholesale supplier</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                disabled={isSubmitting}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSupplier} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Supplier / Company Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Electronics Ltd."
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 9876543210"
                    value={supplierForm.phone}
                    onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={supplierForm.contactPerson}
                    onChange={e => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="supplier@example.com"
                    value={supplierForm.email}
                    onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    GST Number
                  </label>
                  <input
                    type="text"
                    placeholder="22AAAAA0000A1Z5"
                    value={supplierForm.gstNumber}
                    onChange={e => setSupplierForm({ ...supplierForm, gstNumber: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm uppercase bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Business Address
                </label>
                <textarea
                  rows={2}
                  placeholder="Street address, City, State..."
                  value={supplierForm.address}
                  onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !supplierForm.name.trim() || !supplierForm.phone.trim()}
                  className="flex-1 py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Add Supplier</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: EDIT SUPPLIER MODAL                                              */}
      {/* ========================================================================= */}
      {showEditModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Edit Supplier</h2>
                  <p className="text-xs text-slate-500">Update supplier contact & business information</p>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                disabled={isSubmitting}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSupplier} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Supplier / Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={supplierForm.phone}
                    onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={supplierForm.contactPerson}
                    onChange={e => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={supplierForm.email}
                    onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    GST Number
                  </label>
                  <input
                    type="text"
                    value={supplierForm.gstNumber}
                    onChange={e => setSupplierForm({ ...supplierForm, gstNumber: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3.5 py-2.5 text-sm uppercase bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Business Address
                </label>
                <textarea
                  rows={2}
                  value={supplierForm.address}
                  onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !supplierForm.name.trim() || !supplierForm.phone.trim()}
                  className="flex-1 py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Suppliers;
