import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import {
  ArrowLeft,
  Building,
  Receipt,
  CreditCard,
  Printer,
  TrendingDown,
  TrendingUp,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Phone,
  MessageCircle,
  Edit2,
  Search,
  X,
  Loader2,
  ExternalLink,
  RefreshCw,
  Clock,
  Download
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Supplier, SupplierPayment, PaymentMode, PaymentSplit } from '../types';
import {
  getDoc,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  Timestamp,
  increment
} from 'firebase/firestore';

interface LedgerEntry extends SupplierPayment {
  debit: number;
  credit: number;
  runningBalance: number;
  invoiceNumber?: string;
}

const SupplierLedger: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef } = useStore();
  const { success, error: showError } = useToastContext();

  // Primary data states
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [rawTransactions, setRawTransactions] = useState<SupplierPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState<'all' | 'purchases' | 'payments'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showPayModal, setShowPayModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Auto-open pay modal if URL contains ?tab=pay
  useEffect(() => {
    if (searchParams.get('tab') === 'pay') {
      setShowPayModal(true);
    } else if (searchParams.get('tab') === 'print') {
      setShowPrintModal(true);
    }
  }, [searchParams]);

  // Edit Supplier Form
  const [editForm, setEditForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    gstNumber: ''
  });

  // Payment Form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState<'payment_out' | 'payment_in'>('payment_out');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');

  // Locks
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingPaymentRef = useRef(false);
  const isSubmittingEditRef = useRef(false);

  useEffect(() => {
    if (id) {
      loadSupplierAndLedger(id);
    }
  }, [id]);

  const loadSupplierAndLedger = async (supplierId: string, isManualRefresh = false) => {
    try {
      if (isManualRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      // 1. Fetch Supplier Doc
      const supplierDocRef = getDocRef('suppliers', supplierId);
      const supplierSnap = await getDoc(supplierDocRef);

      if (!supplierSnap.exists()) {
        showError('Supplier not found');
        navigate('/suppliers');
        return;
      }

      const sData = supplierSnap.data();
      let createdAtDate = new Date();
      if (sData.createdAt?.toDate) {
        createdAtDate = sData.createdAt.toDate();
      } else if (sData.createdAt instanceof Date) {
        createdAtDate = sData.createdAt;
      }

      const supplierObj: Supplier = {
        id: supplierSnap.id,
        ...sData,
        name: sData.name || 'Unnamed Supplier',
        phone: sData.phone || '',
        totalPurchaseAmount: Number(sData.totalPurchaseAmount) || 0,
        totalPaid: Number(sData.totalPaid) || 0,
        totalPending: Number(sData.totalPending) || 0,
        createdAt: createdAtDate,
        updatedAt: sData.updatedAt?.toDate ? sData.updatedAt.toDate() : undefined
      } as Supplier;

      setSupplier(supplierObj);
      setEditForm({
        name: supplierObj.name,
        contactPerson: supplierObj.contactPerson || '',
        phone: supplierObj.phone,
        email: supplierObj.email || '',
        address: supplierObj.address || '',
        gstNumber: supplierObj.gstNumber || ''
      });

      if (supplierObj.totalPending > 0 && !paymentAmount) {
        setPaymentAmount(String(supplierObj.totalPending));
      }

      // 2. Fetch Supplier Payments
      const paymentsRef = getCollectionRef('supplierPayments');
      const paymentsQ = query(paymentsRef, where('supplierId', '==', supplierId));
      const paymentsSnap = await getDocs(paymentsQ);

      const payments: SupplierPayment[] = paymentsSnap.docs.map(d => {
        const data = d.data();
        let cDate = new Date();
        if (data.createdAt?.toDate) cDate = data.createdAt.toDate();
        else if (data.createdAt instanceof Date) cDate = data.createdAt;

        return {
          id: d.id,
          ...data,
          createdAt: cDate
        } as SupplierPayment;
      });

      // 3. Fetch Purchases & IMEI Purchases
      const purchasesRef = getCollectionRef('purchases');
      const imeiPurchasesRef = getCollectionRef('imeiPurchases');
      const [purchasesSnap, imeiPurchasesSnap] = await Promise.all([
        getDocs(purchasesRef),
        getDocs(imeiPurchasesRef)
      ]);

      const purchasePayments: SupplierPayment[] = [];
      const combinedDocs = [...purchasesSnap.docs, ...imeiPurchasesSnap.docs];

      combinedDocs.forEach(d => {
        const pData = d.data();
        let matches = false;
        if (typeof pData.supplierId === 'string') {
          matches = pData.supplierId === supplierId;
        } else if (pData.supplierId?.id) {
          matches = pData.supplierId.id === supplierId;
        }

        if (matches) {
          let cDate = new Date();
          if (pData.createdAt?.toDate) cDate = pData.createdAt.toDate();
          else if (pData.createdAt instanceof Date) cDate = pData.createdAt;

          purchasePayments.push({
            id: d.id,
            supplierId: supplierId,
            supplierName: pData.supplierName || supplierObj.name,
            amount: Number(pData.totalAmount) || 0,
            type: 'purchase',
            paymentMode: pData.paymentMode || 'cash',
            paymentSplit: pData.paymentSplit,
            notes: pData.notes || `Purchase Invoice #${pData.purchaseNumber || d.id.slice(-6)}`,
            relatedPurchaseId: d.id,
            createdAt: cDate,
            createdBy: pData.createdBy || '',
            createdByName: pData.createdByName || '',
            referenceNumber: pData.purchaseNumber || pData.invoiceNumber || d.id.slice(-6)
          } as SupplierPayment);
        }
      });

      setRawTransactions([...payments, ...purchasePayments]);
    } catch (err: any) {
      console.error('Error loading supplier ledger:', err);
      showError('Failed to load supplier ledger: ' + (err.message || 'Network error'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // True double-entry running balance ledger
  const computedLedger = useMemo(() => {
    const sortedAsc = [...rawTransactions].sort(
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

    return computedAsc.reverse();
  }, [rawTransactions]);

  // Filtered rows
  const filteredLedger = useMemo(() => {
    return computedLedger.filter(item => {
      if (filterType === 'purchases' && item.type !== 'purchase') return false;
      if (filterType === 'payments' && item.type !== 'payment_out' && item.type !== 'payment_in') return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        (item.referenceNumber && item.referenceNumber.toLowerCase().includes(q)) ||
        (item.notes && item.notes.toLowerCase().includes(q)) ||
        (item.paymentMode && item.paymentMode.toLowerCase().includes(q)) ||
        item.amount.toString().includes(q)
      );
    });
  }, [computedLedger, filterType, searchQuery]);

  // Financial summary
  const summary = useMemo(() => {
    const totalDebits = rawTransactions
      .filter(t => t.type === 'purchase' || t.type === 'payment_in')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalCredits = rawTransactions
      .filter(t => t.type === 'payment_out')
      .reduce((sum, t) => sum + t.amount, 0);

    const netClosingBalance = totalDebits - totalCredits;

    return {
      totalDebits,
      totalCredits,
      netClosingBalance
    };
  }, [rawTransactions]);

  // Payment Form Validation
  const isPaymentFormValid = useMemo(() => {
    if (!supplier) return false;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) return false;

    if (paymentMode === 'split') {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;
      return Math.abs(cash + upi + card - amount) < 0.01;
    }
    return true;
  }, [supplier, paymentAmount, paymentMode, cashAmount, upiAmount, cardAmount]);

  // Projected balance
  const projectedBalance = useMemo(() => {
    if (!supplier) return 0;
    const amount = parseFloat(paymentAmount);
    const currentDue = supplier.totalPending || 0;
    if (isNaN(amount) || amount <= 0) return currentDue;

    if (paymentType === 'payment_out') {
      return currentDue - amount;
    } else {
      return currentDue + amount;
    }
  }, [supplier, paymentAmount, paymentType]);

  // Submit Payment
  const handleAddPayment = async () => {
    if (isSubmittingPaymentRef.current) return;
    if (!supplier || !id) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      showError('Please enter a valid amount');
      return;
    }

    let paymentSplit: PaymentSplit | undefined;
    if (paymentMode === 'split') {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;

      if (Math.abs(cash + upi + card - amount) > 0.01) {
        showError('Split amounts must equal total payment amount');
        return;
      }
      paymentSplit = { cash, upi, card };
    }

    try {
      isSubmittingPaymentRef.current = true;
      setIsSubmitting(true);

      const paymentData: any = {
        supplierId: supplier.id!,
        supplierName: supplier.name,
        amount,
        type: paymentType,
        paymentMode,
        notes: paymentNotes.trim(),
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'HQ Admin'
      };

      if (paymentSplit) paymentData.paymentSplit = paymentSplit;
      if (referenceNumber.trim()) paymentData.referenceNumber = referenceNumber.trim();

      // FIFO distribution across pending purchases
      if (paymentType === 'payment_out') {
        const purchasesRef = getCollectionRef('purchases');
        const imeiPurchasesRef = getCollectionRef('imeiPurchases');
        const [purchasesSnap, imeiPurchasesSnap] = await Promise.all([
          getDocs(purchasesRef),
          getDocs(imeiPurchasesRef)
        ]);

        const pendingPurchases: { id: string; collectionName: 'purchases' | 'imeiPurchases'; data: any; createdAtMs: number }[] = [];
        const processPending = (docs: any[], colName: 'purchases' | 'imeiPurchases') => {
          docs.forEach(docSnap => {
            const pData = docSnap.data();
            const matches =
              (typeof pData.supplierId === 'string' && pData.supplierId === supplier.id) ||
              (pData.supplierId?.id === supplier.id);

            const pending = Number(pData.pendingAmount) || 0;
            if (matches && pending > 0) {
              let createdAtMs = 0;
              if (pData.createdAt?.toDate) createdAtMs = pData.createdAt.toDate().getTime();
              else if (pData.createdAt instanceof Date) createdAtMs = pData.createdAt.getTime();
              else if (typeof pData.createdAt === 'string') createdAtMs = new Date(pData.createdAt).getTime();
              pendingPurchases.push({ id: docSnap.id, collectionName: colName, data: pData, createdAtMs });
            }
          });
        };
        processPending(purchasesSnap.docs, 'purchases');
        processPending(imeiPurchasesSnap.docs, 'imeiPurchases');

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
          if (newPendingAmount === 0) newStatus = 'paid';
          else if (newPaidAmount > 0) newStatus = 'pending';

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

      await addDoc(getCollectionRef('supplierPayments'), paymentData);

      // Update supplier totals in Firestore
      const supplierRef = getDocRef('suppliers', supplier.id!);
      const updateData: any = { updatedAt: Timestamp.now() };

      if (paymentType === 'payment_out') {
        updateData.totalPaid = increment(amount);
        updateData.totalPending = increment(-amount);
      } else if (paymentType === 'payment_in') {
        updateData.totalPaid = increment(-amount);
        updateData.totalPending = increment(amount);
      }

      await updateDoc(supplierRef, updateData);

      success(`Recorded payment of ₹${amount.toLocaleString('en-IN')}`);
      setPaymentAmount('');
      setPaymentNotes('');
      setReferenceNumber('');
      setCashAmount('');
      setUpiAmount('');
      setCardAmount('');
      setShowPayModal(false);

      if (searchParams.get('tab')) {
        setSearchParams({});
      }

      await loadSupplierAndLedger(id);
    } catch (err: any) {
      console.error('Error recording payment:', err);
      showError('Failed to record payment: ' + (err.message || 'Network error'));
    } finally {
      isSubmittingPaymentRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Edit Supplier Info
  const handleEditSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingEditRef.current || !supplier?.id) return;

    if (!editForm.name.trim() || !editForm.phone.trim()) {
      showError('Supplier name and phone are required');
      return;
    }

    try {
      isSubmittingEditRef.current = true;
      setIsSubmitting(true);

      const supplierRef = getDocRef('suppliers', supplier.id);
      await updateDoc(supplierRef, {
        name: editForm.name.trim(),
        contactPerson: editForm.contactPerson.trim() || '',
        phone: editForm.phone.trim(),
        email: editForm.email.trim() || '',
        address: editForm.address.trim() || '',
        gstNumber: editForm.gstNumber.trim().toUpperCase() || '',
        updatedAt: Timestamp.now()
      });

      success(`Supplier details updated`);
      setShowEditModal(false);
      await loadSupplierAndLedger(supplier.id);
    } catch (err: any) {
      console.error('Error updating supplier:', err);
      showError('Failed to update supplier: ' + (err.message || 'Network error'));
    } finally {
      isSubmittingEditRef.current = false;
      setIsSubmitting(false);
    }
  };

  // =========================================================================
  // PERFECT MINIMAL PDF GENERATOR
  // =========================================================================
  const downloadPDF = () => {
    if (!supplier) return;
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Header Brand
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text('DIGITAL ZONE', 14, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text('Central Procurement & HQ Hub', 14, 23);

      // Statement Title & Info (Right side)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(37, 99, 235); // blue-600
      doc.text('STATEMENT OF ACCOUNT', 196, 18, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 196, 23, { align: 'right' });
      doc.text(`Ref: DZ-STMT-${supplier.id?.slice(0, 6).toUpperCase() || 'NA'}`, 196, 27, { align: 'right' });

      // Clean divider
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.4);
      doc.line(14, 31, 196, 31);

      // Left: Vendor Info
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text('STATEMENT ISSUED TO', 14, 37);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(supplier.name, 14, 43);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      let leftY = 48;
      if (supplier.contactPerson) {
        doc.text(`Attn: ${supplier.contactPerson}`, 14, leftY);
        leftY += 4.5;
      }
      doc.text(`Phone: ${supplier.phone}`, 14, leftY);
      leftY += 4.5;
      if (supplier.gstNumber) {
        doc.text(`GSTIN: ${supplier.gstNumber}`, 14, leftY);
        leftY += 4.5;
      }
      if (supplier.address) {
        doc.text(supplier.address.slice(0, 48), 14, leftY);
      }

      // Right: Account Summary Box
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text('ACCOUNT SUMMARY', 196, 37, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Total Purchases: Rs. ${summary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 196, 43, { align: 'right' });
      doc.text(`Total Cleared: Rs. ${summary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 196, 48, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      if (summary.netClosingBalance > 0) {
        doc.setTextColor(225, 29, 72); // rose-600
        doc.text(`Closing Due: Rs. ${summary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 196, 54, { align: 'right' });
      } else {
        doc.setTextColor(16, 149, 93); // emerald-600
        doc.text(`Closing Due: Rs. 0.00 (Settled)`, 196, 54, { align: 'right' });
      }

      // Tabular Statement
      const tableHead = [['DATE', 'PARTICULARS', 'REF / VOUCHER', 'MODE', 'DEBIT (+)', 'CREDIT (-)', 'BALANCE']];
      const tableBody = computedLedger.map(row => [
        row.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        row.type === 'purchase'
          ? `Purchase Invoiced${row.notes ? ` (${row.notes})` : ''}`
          : row.type === 'payment_out'
          ? `Disbursement Payment${row.notes ? ` (${row.notes})` : ''}`
          : `Vendor Refund${row.notes ? ` (${row.notes})` : ''}`,
        row.referenceNumber || '—',
        (row.paymentMode || 'cash').toUpperCase(),
        row.debit > 0 ? row.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—',
        row.credit > 0 ? row.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—',
        row.runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })
      ]);

      const tableFoot = [[
        'CLOSING TOTALS',
        '',
        '',
        '',
        summary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        summary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        summary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })
      ]];

      autoTable(doc, {
        head: tableHead,
        body: tableBody,
        foot: tableFoot,
        startY: Math.max(leftY + 6, 64),
        margin: { left: 14, right: 14 },
        styles: {
          font: 'helvetica',
          fontSize: 7.5,
          textColor: [15, 23, 42],
          cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
          lineWidth: 0.1,
          lineColor: [241, 245, 249]
        },
        headStyles: {
          fillColor: [248, 250, 252],
          textColor: [71, 85, 105],
          fontStyle: 'bold',
          lineWidth: { bottom: 0.3 },
          lineColor: [203, 213, 225]
        },
        footStyles: {
          fillColor: [248, 250, 252],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          lineWidth: { top: 0.3 },
          lineColor: [203, 213, 225]
        },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 26 },
          3: { cellWidth: 16, halign: 'center' },
          4: { cellWidth: 26, halign: 'right' },
          5: { cellWidth: 26, halign: 'right', textColor: [16, 149, 93] },
          6: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }
        },
        alternateRowStyles: {
          fillColor: [255, 255, 255]
        },
        didDrawPage: (data) => {
          const pageSize = doc.internal.pageSize;
          const pageHeight = pageSize.height || pageSize.getHeight();
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184);
          doc.text('This is a computer-generated statement of account.', 14, pageHeight - 8);
          doc.text(`Page ${data.pageNumber}`, 196, pageHeight - 8, { align: 'right' });
        }
      });

      const cleanName = supplier.name.replace(/[^a-zA-Z0-9]/g, '_');
      const dateStr = new Date().toISOString().split('T')[0];
      doc.save(`Statement_${cleanName}_${dateStr}.pdf`);
      success(`Downloaded statement as PDF`);
    } catch (err: any) {
      console.error('Error generating PDF:', err);
      showError('Failed to generate PDF statement');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)]">
          <div className="relative">
            <div className="w-10 h-10 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <Building className="w-4 h-4 text-blue-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="mt-3 text-slate-500 text-xs font-medium">Loading ledger...</p>
        </div>
      </div>
    );
  }

  if (!supplier) return null;

  const hasDues = supplier.totalPending > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="w-full max-w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24">
        {/* ========================================================================= */}
        {/* MINIMAL TOP NAV / BACK BUTTON                                             */}
        {/* ========================================================================= */}
        <div className="mb-3 sm:mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/suppliers')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Suppliers</span>
          </button>

          <button
            type="button"
            onClick={() => id && loadSupplierAndLedger(id, true)}
            disabled={isRefreshing}
            className="text-xs text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* VENDOR SUMMARY CARD (MINIMAL, CLEAN & ELEGANT)                            */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-2xs mb-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Vendor Profile Info */}
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-lg flex-shrink-0">
                {supplier.name.charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold text-slate-900 truncate">
                    {supplier.name}
                  </h1>
                  {supplier.gstNumber && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-600">
                      GST: {supplier.gstNumber}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                    title="Edit Vendor"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 font-medium text-slate-700">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <a href={`tel:${supplier.phone}`} className="hover:text-blue-600 hover:underline">
                      {supplier.phone}
                    </a>
                  </span>

                  <a
                    href={`https://wa.me/${supplier.phone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>WhatsApp</span>
                  </a>

                  {supplier.contactPerson && (
                    <span>• Contact: <strong className="text-slate-700">{supplier.contactPerson}</strong></span>
                  )}
                  {supplier.address && <span className="truncate max-w-xs">• {supplier.address}</span>}
                </div>
              </div>
            </div>

            {/* Financial Status & Action Buttons */}
            <div className="flex items-center gap-3 justify-between md:justify-end flex-wrap sm:flex-nowrap border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
              <div className="text-left md:text-right">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Outstanding Due
                </div>
                <div className={`text-xl sm:text-2xl font-bold font-mono ${hasDues ? 'text-rose-600' : 'text-emerald-600'}`}>
                  ₹{supplier.totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* 1-CLICK PDF DOWNLOAD (PERFECT MINIMAL PDF) */}
                <button
                  type="button"
                  onClick={downloadPDF}
                  className="px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm rounded-xl border border-slate-300 transition-colors inline-flex items-center gap-1.5 shadow-2xs"
                  title="Download Perfect PDF Statement"
                >
                  <Download className="w-4 h-4 text-blue-600" />
                  <span className="hidden sm:inline">PDF</span>
                </button>

                {/* PRINT PREVIEW MODAL */}
                <button
                  type="button"
                  onClick={() => setShowPrintModal(true)}
                  className="px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm rounded-xl border border-slate-300 transition-colors inline-flex items-center gap-1.5 shadow-2xs"
                  title="Print Preview"
                >
                  <Printer className="w-4 h-4 text-slate-500" />
                  <span className="hidden sm:inline">Print</span>
                </button>

                {/* THE BLUE BUTTON: PRIMARY CALL TO ACTION */}
                <button
                  type="button"
                  onClick={() => setShowPayModal(true)}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs sm:text-sm rounded-xl transition-all shadow-xs flex items-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Record Payment</span>
                </button>
              </div>
            </div>
          </div>

          {/* 3 Clean Financial Pills */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-4 mt-4 border-t border-slate-100 text-center">
            <div className="p-2 sm:p-2.5 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 font-medium uppercase block">Total Purchases</span>
              <span className="text-xs sm:text-sm font-bold font-mono text-slate-800">
                ₹{Math.round(summary.totalDebits).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-2 sm:p-2.5 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 font-medium uppercase block">Total Settled</span>
              <span className="text-xs sm:text-sm font-bold font-mono text-emerald-600">
                ₹{Math.round(summary.totalCredits).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-2 sm:p-2.5 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] text-slate-400 font-medium uppercase block">Ledger Records</span>
              <span className="text-xs sm:text-sm font-bold font-mono text-slate-700">
                {computedLedger.length} entries
              </span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SEARCH, FILTER & ROW CONTROLS                                             */}
        {/* ========================================================================= */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3">
          {/* Simple Segmented Filter */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'all'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Entries ({computedLedger.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('purchases')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'purchases'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Purchases
            </button>
            <button
              type="button"
              onClick={() => setFilterType('payments')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                filterType === 'payments'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Payments
            </button>
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[220px] sm:min-w-[280px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search ref #, notes, amount..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* THE CLEAN, SPACIOUS RUNNING BALANCE LEDGER TABLE                          */}
        {/* ========================================================================= */}
        {filteredLedger.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-2xs">
            <Receipt className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <h3 className="text-sm font-bold text-slate-700">No transactions recorded</h3>
            <p className="text-xs text-slate-400 mt-0.5 max-w-sm mx-auto">
              {searchQuery
                ? `No entry matched "${searchQuery}".`
                : 'Purchase bills and disbursement payments will show here with live double-entry running balance.'}
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowPayModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-xs"
              >
                Record First Payment
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 font-semibold text-slate-600 uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4 whitespace-nowrap">Date & Time</th>
                    <th className="py-3 px-4">Transaction / Description</th>
                    <th className="py-3 px-4 whitespace-nowrap">Ref / Voucher #</th>
                    <th className="py-3 px-4 whitespace-nowrap">Mode</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap text-slate-800">Debit (+)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap text-emerald-700">Credit (-)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap text-slate-900">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-normal">
                  {filteredLedger.map(entry => {
                    const isPurchase = entry.type === 'purchase';
                    const isPaymentOut = entry.type === 'payment_out';

                    return (
                      <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Date & Time */}
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                          <div className="font-semibold text-slate-900">
                            {entry.createdAt.toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            <span>
                              {entry.createdAt.toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                        </td>

                        {/* Particulars & Memo */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`p-1.5 rounded-lg flex-shrink-0 ${
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
                              <div className="font-semibold text-slate-900 text-xs sm:text-sm">
                                {isPurchase
                                  ? 'Purchase Invoiced'
                                  : isPaymentOut
                                  ? 'Disbursement Payment'
                                  : 'Vendor Refund'}
                              </div>
                              {entry.notes && (
                                <div className="text-[11px] text-slate-500 truncate max-w-sm mt-0.5">
                                  {entry.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Voucher / Ref */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isPurchase && entry.relatedPurchaseId ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/purchases/${entry.relatedPurchaseId}`)}
                              className="font-mono text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 font-semibold"
                              title="Open Purchase Invoice"
                            >
                              <span>#{entry.referenceNumber || entry.relatedPurchaseId.slice(-6)}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          ) : (
                            <span className="font-mono text-slate-600">
                              {entry.referenceNumber || '—'}
                            </span>
                          )}
                        </td>

                        {/* Payment Mode */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-100 text-slate-700">
                            {entry.paymentMode}
                          </span>
                        </td>

                        {/* Debit */}
                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-medium text-slate-900">
                          {entry.debit > 0 ? `₹${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                        </td>

                        {/* Credit */}
                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-semibold text-emerald-600">
                          {entry.credit > 0 ? `₹${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                        </td>

                        {/* Running Balance */}
                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-bold">
                          <span className={entry.runningBalance > 0 ? 'text-rose-600' : 'text-slate-800'}>
                            ₹{entry.runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Footer Totals */}
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900 text-xs sm:text-sm">
                    <td colSpan={4} className="py-3.5 px-4 text-right uppercase text-xs text-slate-500">
                      Closing Totals
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-900">
                      ₹{summary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-emerald-600">
                      ₹{summary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-rose-600 font-extrabold">
                      ₹{summary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* RECORD PAYMENT MODAL (USER-FRIENDLY & MINIMAL WITH BLUE BUTTON)           */}
        {/* ========================================================================= */}
        {showPayModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
              <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Record Payment</h2>
                    <p className="text-xs text-slate-500">{supplier.name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  disabled={isSubmitting}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 sm:p-6 space-y-4">
                {/* Direction Selector */}
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPaymentType('payment_out')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      paymentType === 'payment_out'
                        ? 'bg-white text-rose-600 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <TrendingDown className="w-3.5 h-3.5" />
                    <span>Pay Supplier</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('payment_in')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      paymentType === 'payment_in'
                        ? 'bg-white text-emerald-600 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Refund (Received)</span>
                  </button>
                </div>

                {/* Amount Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700">Payment Amount (₹) *</label>
                    {supplier.totalPending > 0 && (
                      <span className="text-xs text-rose-600 font-mono font-semibold">
                        Due: ₹{supplier.totalPending.toLocaleString('en-IN')}
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
                      className="w-full pl-8 pr-4 py-2.5 text-lg font-bold font-mono text-slate-900 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {supplier.totalPending > 0 && (
                      <button
                        type="button"
                        onClick={() => setPaymentAmount(String(supplier.totalPending))}
                        className="px-2.5 py-1 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg border border-rose-200 transition-colors"
                      >
                        Full Due (₹{supplier.totalPending.toLocaleString('en-IN')})
                      </button>
                    )}
                    {[1000, 5000, 10000, 25000].map(amt => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setPaymentAmount(String(amt))}
                        className="px-2.5 py-1 text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-colors font-mono"
                      >
                        ₹{amt.toLocaleString('en-IN')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Projected Balance Strip */}
                {parseFloat(paymentAmount) > 0 && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Current Balance</span>
                      <span className="font-mono font-bold text-slate-700">
                        ₹{supplier.totalPending.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                    <div className="text-right">
                      <span className="text-slate-400 block text-[10px]">New Balance</span>
                      <span className={`font-mono font-bold ${projectedBalance <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ₹{Math.max(0, projectedBalance).toLocaleString('en-IN')}
                        {projectedBalance <= 0 && ' (Settled)'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Payment Mode Selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Payment Mode</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(['cash', 'upi', 'card', 'cheque', 'split'] as PaymentMode[]).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPaymentMode(mode)}
                        className={`py-1.5 text-xs font-semibold rounded-lg capitalize border transition-all ${
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

                {/* Split Breakdown */}
                {paymentMode === 'split' && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <span className="text-xs font-semibold text-slate-700 block">Split Breakdown</span>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        placeholder="Cash (₹)"
                        value={cashAmount}
                        onChange={e => setCashAmount(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                      />
                      <input
                        type="number"
                        placeholder="UPI (₹)"
                        value={upiAmount}
                        onChange={e => setUpiAmount(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                      />
                      <input
                        type="number"
                        placeholder="Card (₹)"
                        value={cardAmount}
                        onChange={e => setCardAmount(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Reference ID & Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      UTR / Reference <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. UTR-98765432"
                      value={referenceNumber}
                      onChange={e => setReferenceNumber(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Memo / Notes <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Cleared via Bank"
                      value={paymentNotes}
                      onChange={e => setPaymentNotes(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* THE BLUE BUTTON: CONFIRM PAYMENT */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleAddPayment}
                    disabled={isSubmitting || !isPaymentFormValid}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-xs flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed text-xs sm:text-sm"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Processing...</span>
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
                  <p className="text-[10px] text-center text-slate-400 mt-1.5">
                    FIFO automatically allocates payment to oldest pending invoices first.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PRINTABLE STATEMENT MODAL (WITH PERFECT PDF DOWNLOAD & MINIMAL A4 LOOK)  */}
        {/* ========================================================================= */}
        {showPrintModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-bold text-slate-900">Statement of Account</h3>
                </div>
                <div className="flex items-center gap-2">
                  {/* BLUE BUTTON: DOWNLOAD PDF */}
                  <button
                    type="button"
                    onClick={downloadPDF}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPrintModal(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg ml-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Minimal Paper Look Preview */}
              <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-slate-100/60 flex justify-center">
                <div id="printable-statement" className="bg-white text-slate-900 font-sans w-full max-w-3xl p-8 sm:p-12 rounded-xl shadow-xs border border-slate-200/80">
                  <div className="flex items-start justify-between border-b border-slate-200 pb-4 mb-5">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight uppercase text-slate-900">DIGITAL ZONE</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Central Procurement & HQ Hub</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold uppercase tracking-wider text-blue-600">Statement of Account</div>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono">
                        Date: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Ref: DZ-STMT-{supplier.id?.slice(0, 6).toUpperCase() || 'NA'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 text-xs pb-5 mb-5 border-b border-slate-100">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Statement Issued To</div>
                      <div className="font-bold text-sm text-slate-900">{supplier.name}</div>
                      {supplier.contactPerson && <div className="text-slate-600 mt-0.5">Attn: {supplier.contactPerson}</div>}
                      <div className="text-slate-600 mt-0.5">Phone: {supplier.phone}</div>
                      {supplier.gstNumber && <div className="font-mono text-slate-700 mt-0.5">GSTIN: {supplier.gstNumber}</div>}
                      {supplier.address && <div className="text-slate-500 mt-0.5">{supplier.address}</div>}
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Account Summary</div>
                      <div className="text-xs text-slate-600">
                        Total Invoiced: <span className="font-mono font-semibold text-slate-800">₹{summary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Total Cleared: <span className="font-mono font-semibold text-emerald-600">₹{summary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="text-sm font-bold mt-2">
                        Closing Due:{' '}
                        <span className={`font-mono ${summary.netClosingBalance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                          ₹{summary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <table className="w-full text-left border-collapse text-xs mb-8">
                    <thead>
                      <tr className="border-b border-slate-200 font-bold uppercase text-[10px] text-slate-500 bg-slate-50/50">
                        <th className="py-2.5 px-2">Date</th>
                        <th className="py-2.5 px-2">Particulars</th>
                        <th className="py-2.5 px-2">Voucher #</th>
                        <th className="py-2.5 px-2">Mode</th>
                        <th className="py-2.5 px-2 text-right">Debit (+)</th>
                        <th className="py-2.5 px-2 text-right">Credit (-)</th>
                        <th className="py-2.5 px-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {computedLedger.map((row, idx) => (
                        <tr key={idx}>
                          <td className="py-2.5 px-2 text-slate-600 font-mono">
                            {row.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td className="py-2.5 px-2 font-medium text-slate-900">
                            {row.type === 'purchase'
                              ? 'Purchase Invoiced'
                              : row.type === 'payment_out'
                              ? `Disbursement Payment`
                              : 'Vendor Refund'}
                            {row.notes ? ` (${row.notes})` : ''}
                          </td>
                          <td className="py-2.5 px-2 font-mono text-slate-500">
                            {row.referenceNumber || '—'}
                          </td>
                          <td className="py-2.5 px-2 uppercase text-[10px] font-semibold text-slate-600">
                            {row.paymentMode || 'CASH'}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono">
                            {row.debit > 0 ? `₹${row.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-emerald-700">
                            {row.credit > 0 ? `₹${row.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-900">
                            ₹{row.runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 font-bold text-slate-900 bg-slate-50/50">
                        <td colSpan={4} className="py-2.5 px-2 text-right uppercase text-[10px] text-slate-500">
                          Totals
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono">
                          ₹{summary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-emerald-600">
                          ₹{summary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-rose-600 font-extrabold">
                          ₹{summary.netClosingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  <div className="pt-8 flex items-center justify-between text-xs text-slate-400 border-t border-slate-100">
                    <div>Authorized Signature & Seal</div>
                    <div className="font-mono text-[10px]">Computer-generated vendor statement</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* EDIT SUPPLIER MODAL                                                       */}
        {/* ========================================================================= */}
        {showEditModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
              <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Edit Vendor Information</h2>
                    <p className="text-xs text-slate-500">Update supplier contact & tax credentials</p>
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
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
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
                      value={editForm.phone}
                      onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
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
                      value={editForm.contactPerson}
                      onChange={e => setEditForm({ ...editForm, contactPerson: e.target.value })}
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
                      value={editForm.email}
                      onChange={e => setEditForm({ ...editForm, email: e.target.value })}
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
                      value={editForm.gstNumber}
                      onChange={e => setEditForm({ ...editForm, gstNumber: e.target.value })}
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
                    value={editForm.address}
                    onChange={e => setEditForm({ ...editForm, address: e.target.value })}
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
                    disabled={isSubmitting || !editForm.name.trim() || !editForm.phone.trim()}
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
      </main>

      {/* Media Print Global Style for Crisp Paper Statement */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-statement, #printable-statement * {
            visibility: visible;
          }
          #printable-statement {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0 !important;
            padding: 24px !important;
            border: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default SupplierLedger;
