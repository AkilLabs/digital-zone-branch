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
  MessageCircle,
  Printer,
  ArrowDownLeft,
  ArrowUpRight
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

interface LedgerEntry extends SupplierPayment {
  debit: number; // Purchase / bill amount
  credit: number; // Payment / refund cleared
  runningBalance: number; // Live cumulative balance after this row
  invoiceNumber?: string;
}

const Suppliers: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef } = useStore();
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
  const [modalTab, setModalTab] = useState<'statement' | 'pay' | 'details' | 'print'>('statement');
  const [rawSupplierPayments, setRawSupplierPayments] = useState<SupplierPayment[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'purchases' | 'payments'>('all');

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
            notes: purchaseData.notes || `Purchase Invoice #${purchaseData.purchaseNumber || doc.id.slice(-6)}`,
            relatedPurchaseId: doc.id,
            createdAt: createdAtDate,
            createdBy: purchaseData.createdBy || '',
            createdByName: purchaseData.createdByName || '',
            referenceNumber: purchaseData.purchaseNumber || purchaseData.invoiceNumber || doc.id.slice(-6)
          } as SupplierPayment);
        }
      });

      // Combine all raw transactions
      setRawSupplierPayments([...payments, ...purchasePayments]);
    } catch (err: any) {
      console.error('Error fetching transactions:', err);
      showError('Failed to load transaction history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Build true double-entry running balance ledger
  const computedLedger = useMemo(() => {
    // Sort oldest first to calculate accurate running balance
    const sortedAsc = [...rawSupplierPayments].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    let running = 0;
    const computedAsc: LedgerEntry[] = sortedAsc.map(tx => {
      let debit = 0;
      let credit = 0;

      if (tx.type === 'purchase') {
        debit = tx.amount;
        running += tx.amount;
      } else if (tx.type === 'payment_out') {
        credit = tx.amount;
        running -= tx.amount;
      } else if (tx.type === 'payment_in') {
        debit = tx.amount;
        running += tx.amount;
      }

      return {
        ...tx,
        debit,
        credit,
        runningBalance: running,
        invoiceNumber: tx.referenceNumber
      };
    });

    // Return descending (newest first) for primary display
    return computedAsc.reverse();
  }, [rawSupplierPayments]);

  // Filtered ledger rows
  const filteredLedger = useMemo(() => {
    if (ledgerFilter === 'purchases') {
      return computedLedger.filter(t => t.type === 'purchase');
    }
    if (ledgerFilter === 'payments') {
      return computedLedger.filter(t => t.type === 'payment_out' || t.type === 'payment_in');
    }
    return computedLedger;
  }, [computedLedger, ledgerFilter]);

  // Ledger summary totals
  const ledgerSummary = useMemo(() => {
    const totalDebits = rawSupplierPayments
      .filter(t => t.type === 'purchase' || t.type === 'payment_in')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalCredits = rawSupplierPayments
      .filter(t => t.type === 'payment_out')
      .reduce((sum, t) => sum + t.amount, 0);

    const netClosingBalance = totalDebits - totalCredits;

    return {
      totalDebits,
      totalCredits,
      netClosingBalance
    };
  }, [rawSupplierPayments]);

  // Filter and Sort Suppliers Directory
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
      return currentDue + amount;
    }
  }, [selectedSupplier, paymentAmount, paymentType]);

  // Handle Recording Payment with double-click immunity
  const handleAddPayment = async () => {
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
        createdByName: currentUser?.displayName || currentUser?.email || 'HQ Admin'
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
      setModalTab('statement');
    } catch (err: any) {
      console.error('Error recording payment:', err);
      showError('Failed to record payment: ' + (err.message || 'Network error'));
    } finally {
      isSubmittingPaymentRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Add Supplier with duplicate and lock protection
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
        contactPerson: supplierForm.contactPerson.trim() || undefined,
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim() || undefined,
        address: supplierForm.address.trim() || undefined,
        gstNumber: supplierForm.gstNumber.trim().toUpperCase() || undefined,
        totalPurchaseAmount: 0,
        totalPaid: 0,
        totalPending: 0,
        isActive: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'HQ Admin'
      };

      const docRef = await addDoc(getCollectionRef('suppliers'), newSupplierData);
      success(`Supplier "${supplierForm.name}" registered successfully`);
      setShowAddModal(false);
      resetSupplierForm();
      await fetchSuppliers();

      // Open ledger directly for new supplier
      openLedgerModal({
        id: docRef.id,
        ...newSupplierData,
        createdAt: new Date()
      } as Supplier, 'statement');
    } catch (err: any) {
      console.error('Error adding supplier:', err);
      showError('Failed to add supplier: ' + (err.message || 'Network error'));
    } finally {
      isSubmittingSupplierRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Edit Supplier
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
        contactPerson: supplierForm.contactPerson.trim() || '',
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim() || '',
        address: supplierForm.address.trim() || '',
        gstNumber: supplierForm.gstNumber.trim().toUpperCase() || '',
        updatedAt: Timestamp.now()
      });

      success(`Updated details for ${supplierForm.name}`);
      setShowEditModal(false);
      resetSupplierForm();
      await fetchSuppliers();
    } catch (err: any) {
      console.error('Error updating supplier:', err);
      showError('Failed to update supplier: ' + (err.message || 'Network error'));
    } finally {
      isSubmittingSupplierRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Open modals
  const openLedgerModal = (supplier: Supplier, defaultTab: 'statement' | 'pay' | 'details' | 'print' = 'statement') => {
    setSelectedSupplier(supplier);
    setModalTab(defaultTab);
    resetPaymentForm();
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

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)]">
          <div className="relative">
            <div className="w-12 h-12 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <Building className="w-5 h-5 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="mt-4 text-slate-600 text-sm font-medium">Loading supplier registry...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="w-full max-w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-28 sm:pb-12">
        {/* ========================================================================= */}
        {/* HEADER & TOP CONTROLS                                                     */}
        {/* ========================================================================= */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                <Building className="w-5 h-5" />
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Supplier Management & Ledger
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              {filteredAndSortedSuppliers.length} vendor{filteredAndSortedSuppliers.length !== 1 ? 's' : ''} • Central HQ Procurement & Double-Entry Account Ledgers
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => fetchSuppliers(true)}
              disabled={isRefreshing}
              className="px-3 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
              title="Refresh suppliers list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={openAddModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center gap-1.5 shadow-sm whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Supplier</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 4 PROFESSIONAL KPI METRIC CARDS                                            */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Total Suppliers</span>
              <Users className="w-4 h-4 text-slate-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900">
              {metrics.totalSuppliers}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {metrics.settledSuppliersCount} accounts settled
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Total Purchases Billed</span>
              <ShoppingCart className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
              ₹{Math.round(metrics.totalPurchaseAmount).toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Lifetime procurement invoices
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Total Cleared / Paid</span>
              <Check className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-600 font-mono">
              ₹{Math.round(metrics.totalPaidAmount).toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Disbursed vendor payments
            </div>
          </div>

          <div
            onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
            className={`rounded-xl border p-4 shadow-2xs cursor-pointer transition-all ${
              statusFilter === 'pending'
                ? 'bg-rose-50/70 border-rose-300 ring-2 ring-rose-500/20'
                : 'bg-white border-slate-200/90 hover:border-rose-300'
            }`}
          >
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium text-rose-700">Outstanding Balance Due</span>
              <TrendingDown className="w-4 h-4 text-rose-500" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-rose-600 font-mono">
              ₹{Math.round(metrics.totalPendingDues).toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-rose-600/80 mt-0.5 flex items-center justify-between">
              <span>{metrics.suppliersWithDuesCount} suppliers with balance</span>
              {statusFilter === 'pending' && <span className="font-bold text-[10px] uppercase">Active Filter</span>}
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SEARCH, STATUS FILTER CHIPS & SORT CONTROLS                               */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-xl border border-slate-200 p-2.5 sm:p-3 mb-4 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
          {/* Status Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { key: 'all', label: `All Vendors (${suppliers.length})` },
              { key: 'pending', label: `Dues Pending (${metrics.suppliersWithDuesCount})` },
              { key: 'settled', label: `Settled (${metrics.settledSuppliersCount})` }
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Bar + Sort & View Mode */}
          <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-[240px] sm:min-w-[340px]">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search vendor, phone, GST, contact..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="py-1.5 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            >
              <option value="pending_desc">Due: High to Low</option>
              <option value="pending_asc">Due: Low to High</option>
              <option value="purchase_desc">Purchases: High to Low</option>
              <option value="name_asc">Name: A to Z</option>
              <option value="recent">Recently Added</option>
            </select>

            <div className="flex items-center border border-slate-200 rounded-lg p-0.5 bg-slate-50">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'grid' ? 'bg-white text-blue-600 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Grid cards"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded text-xs transition-colors ${
                  viewMode === 'table' ? 'bg-white text-blue-600 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Table view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SUPPLIERS CONTENT (GRID OR DIRECTORY TABLE)                              */}
        {/* ========================================================================= */}
        {filteredAndSortedSuppliers.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-2xs">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3 border border-blue-100">
              <Building className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No suppliers found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              {searchTerm
                ? `No supplier matched "${searchTerm}". Try checking your spelling or filters.`
                : statusFilter === 'pending'
                ? 'All supplier accounts are completely settled with ₹0 pending balance.'
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
                  className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  Clear filters
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Register First Supplier</span>
                </button>
              )}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* GRID VIEW */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {filteredAndSortedSuppliers.map(supplier => {
              const hasDues = (supplier.totalPending || 0) > 0;
              const initial = supplier.name.charAt(0).toUpperCase() || 'S';

              return (
                <div
                  key={supplier.id}
                  className="bg-white rounded-xl border border-slate-200/90 hover:border-slate-300 transition-all duration-150 hover:shadow-xs flex flex-col justify-between overflow-hidden"
                >
                  {/* Top vendor info */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-slate-900 text-sm truncate" title={supplier.name}>
                            {supplier.name}
                          </h3>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {supplier.contactPerson || 'Vendor / Distributor'}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openEditModal(supplier)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
                        title="Edit vendor"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Contact details */}
                    <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                      <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-100">
                        <span className="flex items-center gap-1.5 font-medium text-slate-700">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          <a href={`tel:${supplier.phone}`} className="hover:text-blue-600 hover:underline">
                            {supplier.phone}
                          </a>
                        </span>
                        <a
                          href={`https://wa.me/${supplier.phone.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 hover:text-emerald-700 font-semibold inline-flex items-center gap-1 text-[11px]"
                        >
                          <MessageCircle className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </a>
                      </div>

                      {supplier.gstNumber && (
                        <div className="flex items-center gap-1.5 text-[11px] px-1 text-slate-500">
                          <span className="text-slate-400 font-semibold uppercase">GSTIN:</span>
                          <span className="font-mono text-slate-700">{supplier.gstNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Financial Due Summary */}
                  <div className="px-4 pb-3">
                    <div className="p-3 bg-slate-50/80 rounded-lg border border-slate-200/80">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-500 font-medium">Balance Status</span>
                        {hasDues ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            Due Pending
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Settled ✓
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between mt-1">
                        <div>
                          <div className={`text-base font-bold font-mono ${hasDues ? 'text-rose-600' : 'text-slate-900'}`}>
                            ₹{supplier.totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-[10px] text-slate-400">Current Balance</div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs font-semibold text-slate-700 font-mono">
                            ₹{Math.round(supplier.totalPurchaseAmount).toLocaleString('en-IN')}
                          </div>
                          <div className="text-[10px] text-slate-400">Invoiced</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openLedgerModal(supplier, 'statement')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors shadow-2xs"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>Ledger Statement</span>
                    </button>

                    {hasDues && (
                      <button
                        type="button"
                        onClick={() => openLedgerModal(supplier, 'pay')}
                        className="px-3 py-2 bg-white hover:bg-rose-50 text-rose-700 font-semibold text-xs rounded-lg border border-rose-200 transition-colors inline-flex items-center gap-1"
                        title="Record Payment"
                      >
                        <CreditCard className="w-3.5 h-3.5 text-rose-600" />
                        <span>Pay</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* TABLE DIRECTORY VIEW */
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Vendor / Supplier</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4 text-right">Invoiced (Purchases)</th>
                    <th className="py-3 px-4 text-right">Disbursed (Paid)</th>
                    <th className="py-3 px-4 text-right">Balance Due</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredAndSortedSuppliers.map(supplier => {
                    const hasDues = (supplier.totalPending || 0) > 0;
                    const initial = supplier.name.charAt(0).toUpperCase() || 'S';

                    return (
                      <tr key={supplier.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center font-bold text-xs flex-shrink-0">
                              {initial}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 text-xs sm:text-sm">{supplier.name}</div>
                              {supplier.gstNumber && (
                                <div className="text-[11px] font-mono text-slate-400">
                                  GST: {supplier.gstNumber}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-slate-900 font-medium text-xs">{supplier.phone}</div>
                          {supplier.contactPerson && (
                            <div className="text-[11px] text-slate-500">{supplier.contactPerson}</div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-xs text-slate-800">
                          ₹{supplier.totalPurchaseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono text-xs text-emerald-600">
                          ₹{supplier.totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span className={`font-mono font-bold text-xs sm:text-sm ${hasDues ? 'text-rose-600' : 'text-slate-400'}`}>
                            ₹{supplier.totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {hasDues ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              Due Pending
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Settled ✓
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openLedgerModal(supplier, 'statement')}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              Ledger
                            </button>
                            {hasDues && (
                              <button
                                type="button"
                                onClick={() => openLedgerModal(supplier, 'pay')}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                              >
                                Pay
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditModal(supplier)}
                              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Edit vendor"
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
      </main>

      {/* ========================================================================= */}
      {/* THE PROFESSIONAL SUPPLIER LEDGER MODAL                                    */}
      {/* ========================================================================= */}
      {showLedgerModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden border border-slate-200">
            {/* Ledger Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-base flex-shrink-0 shadow-2xs">
                  {selectedSupplier.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                      {selectedSupplier.name}
                    </h2>
                    {selectedSupplier.gstNumber && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-200/80 text-slate-700">
                        GST: {selectedSupplier.gstNumber}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Phone: {selectedSupplier.phone}</span>
                    {selectedSupplier.contactPerson && <span>• Contact: {selectedSupplier.contactPerson}</span>}
                    {selectedSupplier.address && <span className="truncate max-w-[200px]">• {selectedSupplier.address}</span>}
                  </p>
                </div>
              </div>

              {/* Header Balance Badge & Action Bar */}
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between sm:justify-end">
                <div className="bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-2xs text-right">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Net Balance Due</div>
                  <div className={`text-sm sm:text-base font-bold font-mono ${selectedSupplier.totalPending > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    ₹{selectedSupplier.totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setModalTab('pay')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    modalTab === 'pay' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                  <span>Record Payment</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowLedgerModal(false)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setModalTab('statement')}
                  className={`py-3 px-3 sm:px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-1.5 ${
                    modalTab === 'statement'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Receipt className="w-4 h-4" />
                  <span>Account Ledger</span>
                  <span className="ml-1 text-[11px] px-1.5 py-0.2 bg-slate-100 rounded-full font-mono text-slate-600">
                    {computedLedger.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalTab('pay')}
                  className={`py-3 px-3 sm:px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-1.5 ${
                    modalTab === 'pay'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Record Payment</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalTab('details')}
                  className={`py-3 px-3 sm:px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-1.5 ${
                    modalTab === 'details'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Building className="w-4 h-4" />
                  <span>Profile & Tax</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalTab('print')}
                  className={`py-3 px-3 sm:px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-1.5 ${
                    modalTab === 'print'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Statement</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => fetchSupplierPayments(selectedSupplier.id!)}
                disabled={isLoadingHistory}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1 py-1"
                title="Refresh transactions"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
              {/* ================================================================= */}
              {/* TAB 1: RUNNING BALANCE ACCOUNT LEDGER STATEMENT                   */}
              {/* ================================================================= */}
              {modalTab === 'statement' && (
                <div className="space-y-4">
                  {/* Ledger Summary Ribbon */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs">
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Debited (Purchases)</div>
                      <div className="text-base sm:text-lg font-bold text-slate-900 font-mono mt-0.5">
                        ₹{ledgerSummary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Credited (Paid Out)</div>
                      <div className="text-base sm:text-lg font-bold text-emerald-600 font-mono mt-0.5">
                        ₹{ledgerSummary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase font-semibold">Current Outstanding Balance</div>
                      <div className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${ledgerSummary.netClosingBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        ₹{ledgerSummary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  {/* Filter Chips for Statement */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setLedgerFilter('all')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                          ledgerFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        All Entries ({computedLedger.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setLedgerFilter('purchases')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                          ledgerFilter === 'purchases' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600 hover:text-blue-600'
                        }`}
                      >
                        Purchases Only
                      </button>
                      <button
                        type="button"
                        onClick={() => setLedgerFilter('payments')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                          ledgerFilter === 'payments' ? 'bg-white text-emerald-600 shadow-2xs' : 'text-slate-600 hover:text-emerald-600'
                        }`}
                      >
                        Disbursements Only
                      </button>
                    </div>

                    <span className="text-[11px] text-slate-400 hidden sm:inline">
                      Chronological double-entry running balance
                    </span>
                  </div>

                  {/* The Ledger Table */}
                  {isLoadingHistory ? (
                    <div className="py-16 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
                      <Loader2 className="w-7 h-7 animate-spin mx-auto text-blue-600 mb-2" />
                      <p className="text-xs sm:text-sm font-medium">Computing account ledger entries...</p>
                    </div>
                  ) : filteredLedger.length === 0 ? (
                    <div className="py-14 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
                      <Receipt className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                      <p className="text-sm font-bold text-slate-700">No transactions recorded yet</p>
                      <p className="text-xs text-slate-400 mt-0.5 max-w-sm mx-auto">
                        Invoices created in Purchases or recorded payments will automatically appear in this ledger.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase tracking-wider">
                              <th className="py-2.5 px-3 whitespace-nowrap">Date & Time</th>
                              <th className="py-2.5 px-3">Particulars / Description</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">Voucher / Ref #</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">Mode</th>
                              <th className="py-2.5 px-3 text-right whitespace-nowrap text-slate-800">Debit (+)</th>
                              <th className="py-2.5 px-3 text-right whitespace-nowrap text-emerald-700">Credit (-)</th>
                              <th className="py-2.5 px-3 text-right whitespace-nowrap text-slate-900">Running Balance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-normal">
                            {filteredLedger.map(entry => {
                              const isPurchase = entry.type === 'purchase';
                              const isPaymentOut = entry.type === 'payment_out';

                              return (
                                <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600">
                                    <div className="font-medium text-slate-800">
                                      {entry.createdAt.toLocaleDateString('en-IN', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric'
                                      })}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      {entry.createdAt.toLocaleTimeString('en-IN', {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </div>
                                  </td>

                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`p-1 rounded flex-shrink-0 ${
                                          isPurchase
                                            ? 'bg-blue-50 text-blue-600'
                                            : isPaymentOut
                                            ? 'bg-rose-50 text-rose-600'
                                            : 'bg-emerald-50 text-emerald-600'
                                        }`}
                                      >
                                        {isPurchase ? (
                                          <ArrowDownLeft className="w-3.5 h-3.5" />
                                        ) : isPaymentOut ? (
                                          <ArrowUpRight className="w-3.5 h-3.5" />
                                        ) : (
                                          <Check className="w-3.5 h-3.5" />
                                        )}
                                      </span>
                                      <div>
                                        <div className="font-semibold text-slate-800">
                                          {isPurchase
                                            ? 'Purchase Invoice'
                                            : isPaymentOut
                                            ? 'Disbursement Payment'
                                            : 'Vendor Refund'}
                                        </div>
                                        {entry.notes && (
                                          <div className="text-[11px] text-slate-500 truncate max-w-xs">
                                            {entry.notes}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    {isPurchase && entry.relatedPurchaseId ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setShowLedgerModal(false);
                                          navigate(`/purchases/${entry.relatedPurchaseId}`);
                                        }}
                                        className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1 font-medium"
                                        title="View purchase invoice"
                                      >
                                        <span>#{entry.referenceNumber || entry.relatedPurchaseId.slice(-6)}</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </button>
                                    ) : (
                                      <span className="font-mono text-slate-500">
                                        {entry.referenceNumber || '—'}
                                      </span>
                                    )}
                                  </td>

                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-100 text-slate-700">
                                      {entry.paymentMode}
                                    </span>
                                  </td>

                                  <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono font-medium text-slate-900">
                                    {entry.debit > 0 ? `₹${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                                  </td>

                                  <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono font-semibold text-emerald-600">
                                    {entry.credit > 0 ? `₹${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                                  </td>

                                  <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono font-bold">
                                    <span className={entry.runningBalance > 0 ? 'text-rose-600' : 'text-slate-800'}>
                                      ₹{entry.runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                              <td colSpan={4} className="py-3 px-3 text-right uppercase text-[11px] text-slate-500">
                                Statement Totals
                              </td>
                              <td className="py-3 px-3 text-right font-mono text-slate-900">
                                ₹{ledgerSummary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-3 px-3 text-right font-mono text-emerald-600">
                                ₹{ledgerSummary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-3 px-3 text-right font-mono text-rose-600">
                                ₹{ledgerSummary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ================================================================= */}
              {/* TAB 2: RECORD PAYMENT / DISBURSEMENT                              */}
              {/* ================================================================= */}
              {modalTab === 'pay' && (
                <div className="max-w-2xl mx-auto bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Record Transaction</h3>
                    <p className="text-xs text-slate-500">Settle pending purchase dues or record vendor refunds</p>
                  </div>

                  {/* Direction Selector */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentType('payment_out')}
                      className={`p-3 rounded-xl border font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all ${
                        paymentType === 'payment_out'
                          ? 'bg-rose-50 border-rose-300 text-rose-700 ring-2 ring-rose-500/20'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <TrendingDown className="w-4 h-4 text-rose-600" />
                      <span>Pay Supplier (Disbursement)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentType('payment_in')}
                      className={`p-3 rounded-xl border font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all ${
                        paymentType === 'payment_in'
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-emerald-500/20'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      <span>Supplier Refund (Received)</span>
                    </button>
                  </div>

                  {/* Amount Input */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-700">
                        Payment Amount (₹) *
                      </label>
                      {selectedSupplier.totalPending > 0 && (
                        <span className="text-xs text-rose-600 font-semibold font-mono">
                          Outstanding Due: ₹{selectedSupplier.totalPending.toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
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
                        className="w-full pl-9 pr-4 py-2.5 text-lg font-bold font-mono text-slate-900 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>

                    {/* Quick Smart Chips */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
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
                      {[1000, 5000, 10000, 25000].map(amt => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setPaymentAmount(String(amt))}
                          className="px-2 py-1 text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-colors"
                        >
                          ₹{amt.toLocaleString('en-IN')}
                        </button>
                      ))}
                      {paymentAmount && (
                        <button
                          type="button"
                          onClick={() => setPaymentAmount('')}
                          className="px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors ml-auto"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Real-Time Balance Projection Strip */}
                  {parseFloat(paymentAmount) > 0 && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">Current Balance</div>
                        <div className="text-xs sm:text-sm font-bold text-slate-800 font-mono mt-0.5">
                          ₹{selectedSupplier.totalPending.toLocaleString('en-IN')}
                        </div>
                      </div>
                      <div className="flex flex-col items-center justify-center">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">
                          {paymentType === 'payment_out' ? '- Paying' : '+ Refund'}
                        </div>
                        <div className="text-xs font-bold text-blue-600 font-mono mt-0.5 flex items-center gap-1">
                          <span>₹{parseFloat(paymentAmount || '0').toLocaleString('en-IN')}</span>
                          <ArrowRight className="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">Projected Due</div>
                        <div
                          className={`text-xs sm:text-sm font-bold font-mono mt-0.5 ${
                            calculatedRemainingDue <= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          ₹{Math.max(0, calculatedRemainingDue).toLocaleString('en-IN')}
                          {calculatedRemainingDue <= 0 && ' (Settled)'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Payment Mode */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Payment Mode
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {(['cash', 'upi', 'card', 'cheque', 'split'] as PaymentMode[]).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPaymentMode(mode)}
                          className={`py-2 px-3 rounded-lg border text-xs font-semibold capitalize transition-all ${
                            paymentMode === mode
                              ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Split Inputs */}
                  {paymentMode === 'split' && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>Split Breakdown</span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          Total must equal ₹{parseFloat(paymentAmount || '0').toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Cash (₹)</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={cashAmount}
                            onChange={e => setCashAmount(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">UPI (₹)</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={upiAmount}
                            onChange={e => setUpiAmount(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Card (₹)</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={cardAmount}
                            onChange={e => setCardAmount(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reference & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        UTR / Transaction Reference <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. UTR-987654321, Chq #402"
                        value={referenceNumber}
                        onChange={e => setReferenceNumber(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Notes / Memo <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Cleared via Bank Transfer"
                        value={paymentNotes}
                        onChange={e => setPaymentNotes(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleAddPayment}
                      disabled={isSubmitting || !isPaymentFormValid}
                      className="w-full py-3 px-4 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Processing Disbursement...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>
                            Confirm Payment of ₹
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

              {/* ================================================================= */}
              {/* TAB 3: VENDOR PROFILE & TAX DETAILS                               */}
              {/* ================================================================= */}
              {modalTab === 'details' && (
                <div className="max-w-2xl mx-auto bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">{selectedSupplier.name}</h3>
                      <p className="text-xs text-slate-400 font-mono">Supplier Account ID: {selectedSupplier.id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLedgerModal(false);
                        openEditModal(selectedSupplier);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Information</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 block mb-0.5">Contact Person</span>
                      <span className="font-semibold text-slate-800 text-sm">
                        {selectedSupplier.contactPerson || 'Not provided'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block mb-0.5">Phone Number</span>
                      <a href={`tel:${selectedSupplier.phone}`} className="font-semibold text-blue-600 hover:underline text-sm font-mono">
                        {selectedSupplier.phone}
                      </a>
                    </div>

                    <div>
                      <span className="text-slate-400 block mb-0.5">Email Address</span>
                      <span className="font-medium text-slate-800">
                        {selectedSupplier.email || 'Not provided'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block mb-0.5">GST Identification Number (GSTIN)</span>
                      <span className="font-mono font-semibold text-slate-800 text-sm">
                        {selectedSupplier.gstNumber || 'Unregistered / Not provided'}
                      </span>
                    </div>

                    <div className="sm:col-span-2">
                      <span className="text-slate-400 block mb-0.5">Business Address</span>
                      <span className="font-medium text-slate-700">
                        {selectedSupplier.address || 'No registered address'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Total Purchases</div>
                      <div className="text-sm sm:text-base font-bold font-mono text-slate-900 mt-0.5">
                        ₹{selectedSupplier.totalPurchaseAmount.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 text-center">
                      <div className="text-[10px] text-emerald-600 uppercase font-semibold">Total Cleared</div>
                      <div className="text-sm sm:text-base font-bold font-mono text-emerald-700 mt-0.5">
                        ₹{selectedSupplier.totalPaid.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-100 text-center">
                      <div className="text-[10px] text-rose-600 uppercase font-semibold">Balance Due</div>
                      <div className="text-sm sm:text-base font-bold font-mono text-rose-700 mt-0.5">
                        ₹{selectedSupplier.totalPending.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* TAB 4: PRINTABLE FORMAL STATEMENT VIEW                            */}
              {/* ================================================================= */}
              {modalTab === 'print' && (
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
                    <span className="text-xs text-slate-500">
                      Standard vendor account statement preview for printing or PDF export.
                    </span>
                    <button
                      type="button"
                      onClick={handlePrint}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Print / Export PDF</span>
                    </button>
                  </div>

                  {/* Printable Statement Sheet */}
                  <div id="printable-statement" className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-300 shadow-sm text-slate-900 font-sans">
                    {/* Statement Header */}
                    <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4 mb-4">
                      <div>
                        <h2 className="text-xl font-bold tracking-tight uppercase">DIGITAL ZONE</h2>
                        <p className="text-xs text-slate-600">Central Procurement & Head Office Hub</p>
                        <p className="text-xs text-slate-500">Statement of Vendor Account</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold uppercase text-slate-500">Generated On</div>
                        <div className="text-xs font-mono font-semibold">
                          {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                    </div>

                    {/* Vendor and Statement Summary */}
                    <div className="grid grid-cols-2 gap-4 text-xs pb-4 mb-4 border-b border-slate-200">
                      <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Vendor Details</div>
                        <div className="font-bold text-sm text-slate-900">{selectedSupplier.name}</div>
                        {selectedSupplier.contactPerson && <div>Attn: {selectedSupplier.contactPerson}</div>}
                        <div>Phone: {selectedSupplier.phone}</div>
                        {selectedSupplier.gstNumber && <div className="font-mono">GSTIN: {selectedSupplier.gstNumber}</div>}
                        {selectedSupplier.address && <div className="text-slate-600 mt-0.5">{selectedSupplier.address}</div>}
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Account Status</div>
                        <div className="text-xs">
                          Total Purchases: <span className="font-mono font-semibold">₹{ledgerSummary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="text-xs">
                          Total Cleared: <span className="font-mono font-semibold text-emerald-600">₹{ledgerSummary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="text-sm font-bold mt-1">
                          Closing Balance:{' '}
                          <span className={`font-mono ${ledgerSummary.netClosingBalance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                            ₹{ledgerSummary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Tabular Statement */}
                    <table className="w-full text-left border-collapse text-xs mb-6">
                      <thead>
                        <tr className="border-b border-slate-300 font-bold uppercase text-[10px] text-slate-600">
                          <th className="py-2">Date</th>
                          <th className="py-2">Particulars</th>
                          <th className="py-2">Ref / Voucher</th>
                          <th className="py-2 text-right">Debit (+)</th>
                          <th className="py-2 text-right">Credit (-)</th>
                          <th className="py-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {computedLedger.map((row, idx) => (
                          <tr key={idx}>
                            <td className="py-2 text-slate-600 font-mono">
                              {row.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="py-2 font-medium">
                              {row.type === 'purchase'
                                ? 'Purchase Invoiced'
                                : row.type === 'payment_out'
                                ? `Disbursement (${row.paymentMode})`
                                : 'Refund Credit'}
                              {row.notes ? ` — ${row.notes}` : ''}
                            </td>
                            <td className="py-2 font-mono text-slate-500">
                              {row.referenceNumber || '—'}
                            </td>
                            <td className="py-2 text-right font-mono">
                              {row.debit > 0 ? `₹${row.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                            </td>
                            <td className="py-2 text-right font-mono text-emerald-700">
                              {row.credit > 0 ? `₹${row.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                            </td>
                            <td className="py-2 text-right font-mono font-bold">
                              ₹{row.runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Signature block */}
                    <div className="pt-8 flex items-center justify-between text-xs text-slate-500 border-t border-slate-200">
                      <div>Authorized Seal & Signature</div>
                      <div className="font-mono text-[10px]">Page 1 of 1 • System Generated Ledger Statement</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 px-6 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-400">
              <span>Account Registered {selectedSupplier.createdAt.toLocaleDateString('en-IN')}</span>
              <button
                type="button"
                onClick={() => setShowLedgerModal(false)}
                className="px-4 py-2 font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Close Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADD NEW SUPPLIER MODAL                                           */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Add New Supplier</h2>
                  <p className="text-xs text-slate-500">Register vendor or wholesale supplier account</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                disabled={isSubmitting}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSupplier} className="p-5 sm:p-6 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier / Company Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Electronics Ltd."
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 9876543210"
                    value={supplierForm.phone}
                    onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={supplierForm.contactPerson}
                    onChange={e => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="supplier@example.com"
                    value={supplierForm.email}
                    onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GSTIN Number
                  </label>
                  <input
                    type="text"
                    placeholder="22AAAAA0000A1Z5"
                    value={supplierForm.gstNumber}
                    onChange={e => setSupplierForm({ ...supplierForm, gstNumber: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs uppercase bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Address
                </label>
                <textarea
                  rows={2}
                  placeholder="Street address, City, State..."
                  value={supplierForm.address}
                  onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !supplierForm.name.trim() || !supplierForm.phone.trim()}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Register Supplier</span>
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Edit Supplier</h2>
                  <p className="text-xs text-slate-500">Update supplier contact & business information</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                disabled={isSubmitting}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSupplier} className="p-5 sm:p-6 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier / Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={supplierForm.phone}
                    onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={supplierForm.contactPerson}
                    onChange={e => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={supplierForm.email}
                    onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GSTIN Number
                  </label>
                  <input
                    type="text"
                    value={supplierForm.gstNumber}
                    onChange={e => setSupplierForm({ ...supplierForm, gstNumber: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 text-xs uppercase bg-white border border-slate-300 rounded-lg outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business Address
                </label>
                <textarea
                  rows={2}
                  value={supplierForm.address}
                  onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  disabled={isSubmitting}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !supplierForm.name.trim() || !supplierForm.phone.trim()}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
