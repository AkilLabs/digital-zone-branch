import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText,
  User,
  Plus,
  Trash2,
  Download,
  Save,
  Search,
  Package,
  Clock,
  RefreshCw,
  Share2,
  DollarSign,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  X,
  FileCheck,
  TrendingUp,
  Tag
} from 'lucide-react';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import { db } from '../config/firebase';
import {
  getDocs,
  getDoc,
  doc,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import type { Customer, Product, Quotation, QuotationItem, ShopDetails } from '../types';
import { generateQuotationPDF } from '../utils/pdfGenerator';
import { syncStoreProducts } from '../utils/productSyncCache';

const QuotationManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentStore, getCollectionRef, getDocRef } = useStore();
  const { success, error: showError, info } = useToastContext();

  const displayName = currentUser?.displayName || currentUser?.email || 'Staff';

  // Active Tab: 'create' (Builder) | 'saved' (Saved Quotations)
  const [activeTab, setActiveTab] = useState<'create' | 'saved'>('create');

  // ── Shop Details ──────────────────────────────────────────────────────────
  const [shopDetails, setShopDetails] = useState<ShopDetails>({
    shopName: 'Digital Zone',
    ownerName: '',
    address: '',
    phone: '',
    email: '',
    gst: '',
  });

  // ── Customer State ────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [customerAddress, setCustomerAddress] = useState<string>('');
  const [customerGstNo, setCustomerGstNo] = useState<string>('');
  const [saveNewCustomer, setSaveNewCustomer] = useState<boolean>(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState<boolean>(false);

  // ── Product Selection State ───────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [showProductDropdown, setShowProductDropdown] = useState<boolean>(false);

  // Custom / Current Item Form State
  const [itemMode, setItemMode] = useState<'catalog' | 'custom'>('custom');
  const [itemTitle, setItemTitle] = useState<string>('');
  const [itemDescription, setItemDescription] = useState<string>('');
  const [itemHsn, setItemHsn] = useState<string>('');
  const [itemUnit, setItemUnit] = useState<string>('Nos');
  const [itemQuantity, setItemQuantity] = useState<number>(1);
  const [itemRate, setItemRate] = useState<number>(0);
  const [itemDiscount, setItemDiscount] = useState<number>(0);
  const [itemDiscountType, setItemDiscountType] = useState<'amount' | 'percent'>('amount');
  const [itemTaxPercent, setItemTaxPercent] = useState<number>(0);

  // ── Quotation Items List & Summary ─────────────────────────────────────────
  const generateNewQuotationNumber = () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `QT-${today}-${randomSuffix}`;
  };

  const [quotationItems, setQuotationItems] = useState<QuotationItem[]>([]);
  const [quotationNumber, setQuotationNumber] = useState<string>(generateNewQuotationNumber);
  const [validUntilDate, setValidUntilDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [quotationNotes, setQuotationNotes] = useState<string>(
    'Thank you for your inquiry. Prices are subject to stock availability and valid for 30 days.'
  );

  // ── Saved Quotations List State ───────────────────────────────────────────
  const [savedQuotations, setSavedQuotations] = useState<Quotation[]>([]);
  const [loadingQuotations, setLoadingQuotations] = useState<boolean>(false);
  const [savingQuotation, setSavingQuotation] = useState<boolean>(false);
  const [sharingQuoteId, setSharingQuoteId] = useState<string | null>(null);
  const [searchSavedTerm, setSearchSavedTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // Click outside listener for dropdowns
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const productDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target as Node)) {
        setShowCustomerDropdown(false);
      }
      if (productDropdownRef.current && !productDropdownRef.current.contains(event.target as Node)) {
        setShowProductDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Fetch Initial Data ─────────────────────────────────────────────────────
  useEffect(() => {
    fetchShopDetails();
    fetchCustomers();
    fetchProducts();
    fetchSavedQuotations();
  }, [currentStore?.id]);

  const fetchShopDetails = async () => {
    try {
      const shopDetailsSnap = await getDoc(getDocRef('settings', 'shopDetails'));
      if (shopDetailsSnap.exists()) {
        setShopDetails(shopDetailsSnap.data() as ShopDetails);
        return;
      }
      const globalSnap = await getDoc(doc(db, 'settings', 'shopDetails'));
      if (globalSnap.exists()) {
        setShopDetails(globalSnap.data() as ShopDetails);
        return;
      }
      const shopSnap = await getDocs(getCollectionRef('shopDetails'));
      if (!shopSnap.empty) {
        setShopDetails(shopSnap.docs[0].data() as ShopDetails);
      }
    } catch (e) {
      console.error('Error loading shop details:', e);
    }
  };

  const fetchCustomers = async () => {
    try {
      const q = query(getCollectionRef('customers'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Customer[];
      setCustomers(list);
    } catch (e) {
      console.error('Error fetching customers:', e);
    }
  };

  const fetchProducts = async () => {
    try {
      const list = await syncStoreProducts(currentStore?.id);
      setProducts(list);
    } catch (e) {
      console.error('Error fetching products:', e);
    }
  };

  const fetchSavedQuotations = async () => {
    try {
      setLoadingQuotations(true);
      let snap;
      try {
        const q = query(getCollectionRef('quotations'), orderBy('createdAt', 'desc'));
        snap = await getDocs(q);
      } catch (err) {
        console.warn('OrderBy query failed, falling back to unsorted getDocs:', err);
        snap = await getDocs(getCollectionRef('quotations'));
      }

      const list = snap.docs.map(d => {
        const data = d.data();
        let createdDate: Date = new Date();
        if (data.createdAt?.toDate) {
          createdDate = data.createdAt.toDate();
        } else if (data.createdAt) {
          createdDate = new Date(data.createdAt);
        }
        return {
          id: d.id,
          ...data,
          createdAt: createdDate,
        } as Quotation;
      });

      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSavedQuotations(list);
    } catch (e) {
      console.error('Error fetching saved quotations:', e);
    } finally {
      setLoadingQuotations(false);
    }
  };

  // ── Customer Select Handler ───────────────────────────────────────────────
  const handleSelectCustomer = (cust: Customer) => {
    setSelectedCustomerId(cust.id || '');
    setCustomerName(cust.name || '');
    setCustomerPhone(cust.phone || '');
    setCustomerEmail(cust.email || '');
    setCustomerAddress(cust.address || '');
    setCustomerGstNo(cust.gstNo || '');
    setCustomerSearchQuery(cust.name || '');
    setShowCustomerDropdown(false);
  };

  const handleClearCustomer = () => {
    setSelectedCustomerId('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
    setCustomerGstNo('');
    setCustomerSearchQuery('');
    setSaveNewCustomer(false);
  };

  const filteredCustomers = useMemo(() => {
    if (!customerSearchQuery.trim()) return customers.slice(0, 10);
    const q = customerSearchQuery.toLowerCase();
    return customers.filter(
      c => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))
    ).slice(0, 10);
  }, [customers, customerSearchQuery]);

  // ── Product Select Handler ───────────────────────────────────────────────
  const handleSelectProductFromCatalog = (prod: Product) => {
    setItemTitle(prod.name);
    setItemRate(prod.mrp || prod.cost || 0);
    setItemHsn(prod.hcsCode || '');
    setItemTaxPercent(prod.taxPercent || 0);
    setItemUnit('Nos');
    setItemDiscount(0);
    setProductSearchQuery(prod.name);
    setShowProductDropdown(false);
  };

  const filteredProducts = useMemo(() => {
    if (!productSearchQuery.trim()) return products.slice(0, 10);
    const q = productSearchQuery.toLowerCase();
    return products.filter(
      p => p.name.toLowerCase().includes(q) || (p.productCode && p.productCode.toLowerCase().includes(q))
    ).slice(0, 10);
  }, [products, productSearchQuery]);

  // ── Add Item to Quotation ──────────────────────────────────────────────────
  const handleAddItem = () => {
    if (!itemTitle.trim()) {
      showError('Please enter product/item name');
      return;
    }
    if (itemQuantity <= 0) {
      showError('Quantity must be at least 1');
      return;
    }
    if (itemRate < 0) {
      showError('Rate cannot be negative');
      return;
    }

    const gross = itemRate * itemQuantity;
    let discAmt = 0;
    if (itemDiscountType === 'percent') {
      discAmt = (gross * Math.min(100, Math.max(0, itemDiscount))) / 100;
    } else {
      discAmt = Math.min(gross, Math.max(0, itemDiscount));
    }

    const lineAfterDisc = gross - discAmt;
    const finalAmount = lineAfterDisc;

    const newItem: QuotationItem = {
      id: String(Date.now() + Math.random()),
      title: itemTitle.trim(),
      description: itemDescription.trim() || '',
      hsnCode: itemHsn.trim() || '',
      unit: itemUnit.trim() || 'Nos',
      quantity: Number(itemQuantity || 1),
      rate: Number(itemRate || 0),
      discount: Number(itemDiscount || 0),
      discountType: itemDiscountType,
      taxPercent: Number(itemTaxPercent || 0),
      amount: finalAmount,
    };

    setQuotationItems(prev => [...prev, newItem]);

    // Reset item form
    setItemTitle('');
    setItemDescription('');
    setItemHsn('');
    setItemRate(0);
    setItemDiscount(0);
    setItemQuantity(1);
    setProductSearchQuery('');
    success('Added to quotation');
  };

  const handleRemoveItem = (id?: string) => {
    setQuotationItems(prev => prev.filter(i => i.id !== id));
  };

  const handleUpdateItem = (id: string, field: keyof QuotationItem, value: any) => {
    setQuotationItems(prev =>
      prev.map(i => {
        if (i.id !== id) return i;
        const updated = { ...i, [field]: value };

        const qty = Number(updated.quantity || 1);
        const rate = Number(updated.rate || 0);
        const gross = qty * rate;
        let disc = 0;
        if (updated.discountType === 'percent') {
          disc = (gross * Number(updated.discount || 0)) / 100;
        } else {
          disc = Number(updated.discount || 0);
        }
        updated.amount = Math.max(0, gross - disc);
        return updated;
      })
    );
  };

  // ── Financial Calculations ────────────────────────────────────────────────
  const totals = useMemo(() => {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalGstAmount = 0;

    quotationItems.forEach(item => {
      const gross = (item.rate || 0) * (item.quantity || 1);
      subtotal += gross;

      let disc = 0;
      if (item.discountType === 'percent') {
        disc = (gross * (item.discount || 0)) / 100;
      } else {
        disc = item.discount || 0;
      }
      totalDiscount += disc;

      const afterDisc = gross - disc;
      const taxRate = item.taxPercent || 0;
      if (taxRate > 0) {
        const gst = afterDisc - (afterDisc / (1 + taxRate / 100));
        totalGstAmount += gst;
      }
    });

    const grandTotal = Math.max(0, subtotal - totalDiscount);
    const taxableAmount = grandTotal - totalGstAmount;

    return {
      subtotal,
      totalDiscount,
      totalGstAmount,
      taxableAmount,
      grandTotal,
    };
  }, [quotationItems]);

  const getCurrentQuotationObject = (): Quotation => {
    return {
      quotationNumber,
      customerId: selectedCustomerId || undefined,
      customerName: customerName.trim() || 'Valued Customer',
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      customerGstNo: customerGstNo.trim() || undefined,
      items: quotationItems,
      subtotal: totals.subtotal,
      totalDiscount: totals.totalDiscount,
      taxableAmount: totals.taxableAmount,
      totalGstAmount: totals.totalGstAmount,
      grandTotal: totals.grandTotal,
      notes: quotationNotes,
      validUntil: validUntilDate,
      status: 'sent',
      createdAt: new Date(),
      createdBy: currentUser?.uid || '',
      createdByName: displayName,
      storeId: currentStore?.id || undefined,
    };
  };

  // ── PDF & Sharing ──────────────────────────────────────────────────────────
  const handleDownloadPDF = async (quoteToDownload?: Quotation) => {
    const targetQuote = quoteToDownload || getCurrentQuotationObject();
    if (targetQuote.items.length === 0) {
      showError('Please add at least one item to generate quotation PDF');
      return;
    }
    try {
      await generateQuotationPDF(targetQuote, shopDetails, false);
      success('Quotation PDF downloaded');
    } catch (e) {
      console.error('PDF error:', e);
      showError('Failed to generate PDF');
    }
  };

  const handleShareQuotation = async (quoteToShare?: Quotation) => {
    const targetQuote = quoteToShare || getCurrentQuotationObject();
    if (targetQuote.items.length === 0) {
      showError('Please add at least one item to share quotation');
      return;
    }

    try {
      setSharingQuoteId(targetQuote.id || targetQuote.quotationNumber);
      const quoteNo = targetQuote.quotationNumber;
      const custName = targetQuote.customerName || 'Customer';
      const grandTotalStr = Math.round(targetQuote.grandTotal).toLocaleString('en-IN');
      const shareTitle = `Quotation ${quoteNo} - ${shopDetails.shopName || 'The Legend Mobiles'}`;
      const shareText = `Hi ${custName}! 👋\nHere is your quotation (${quoteNo}) from ${shopDetails.shopName || 'The Legend Mobiles'}.\nQuoted Total: ₹${grandTotalStr}\nValid until: ${targetQuote.validUntil ? new Date(targetQuote.validUntil).toLocaleDateString('en-IN') : '30 days'}.\nThank you!`;

      const result = await generateQuotationPDF(targetQuote, shopDetails, true) as any;

      if (typeof window !== 'undefined' && (window as any).AndroidInterface?.sharePDF && result?.pdfData) {
        (window as any).AndroidInterface.sharePDF(
          result.pdfData,
          result.fileName || `Quotation_${quoteNo}.pdf`,
          shareTitle
        );
        success('Quotation shared via device!');
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.share) {
        if (result?.pdfBlob && navigator.canShare) {
          const pdfFile = new File(
            [result.pdfBlob],
            result.fileName || `Quotation_${quoteNo}.pdf`,
            { type: 'application/pdf' }
          );
          if (navigator.canShare({ files: [pdfFile] })) {
            try {
              await navigator.share({
                title: shareTitle,
                text: shareText,
                files: [pdfFile],
              });
              success('Quotation shared!');
              return;
            } catch (err: any) {
              if (err.name === 'AbortError') return;
            }
          }
        }

        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
          });
          success('Quotation shared!');
          return;
        } catch (err: any) {
          if (err.name === 'AbortError') return;
        }
      }

      await generateQuotationPDF(targetQuote, shopDetails, false);
      success('Quotation PDF downloaded');
    } catch (err) {
      console.error('Error sharing quotation:', err);
      showError('Failed to share quotation');
    } finally {
      setSharingQuoteId(null);
    }
  };

  const handleSaveQuotation = async () => {
    if (quotationItems.length === 0) {
      showError('Please add at least one line item to save quotation');
      return;
    }

    const resolvedCustomerName = customerName.trim() || 'Valued Customer';

    try {
      setSavingQuotation(true);

      if (saveNewCustomer && !selectedCustomerId && customerName.trim() && customerPhone.trim()) {
        try {
          await addDoc(getCollectionRef('customers'), {
            name: customerName.trim(),
            phone: customerPhone.trim(),
            email: customerEmail.trim() || '',
            address: customerAddress.trim() || '',
            gstNo: customerGstNo.trim() || '',
            createdAt: Timestamp.now(),
            createdBy: currentUser?.uid || '',
            createdByName: displayName,
          });
          fetchCustomers();
        } catch (e) {
          console.error('Failed to save customer', e);
        }
      }

      const sanitizedItems = quotationItems.map(item => ({
        id: item.id || String(Date.now() + Math.random()),
        title: item.title || '',
        description: item.description || '',
        hsnCode: item.hsnCode || '',
        unit: item.unit || 'Nos',
        quantity: Number(item.quantity || 1),
        rate: Number(item.rate || 0),
        discount: Number(item.discount || 0),
        discountType: item.discountType || 'amount',
        taxPercent: Number(item.taxPercent || 0),
        amount: Number(item.amount || 0),
        ...(item.productId ? { productId: item.productId } : {}),
        ...(item.productCode ? { productCode: item.productCode } : {}),
      }));

      const quotationData = {
        quotationNumber: quotationNumber || generateNewQuotationNumber(),
        customerId: selectedCustomerId || null,
        customerName: resolvedCustomerName,
        customerPhone: customerPhone.trim() || null,
        customerEmail: customerEmail.trim() || null,
        customerAddress: customerAddress.trim() || null,
        customerGstNo: customerGstNo.trim() || null,
        items: sanitizedItems,
        subtotal: Number(totals.subtotal || 0),
        totalDiscount: Number(totals.totalDiscount || 0),
        taxableAmount: Number(totals.taxableAmount || 0),
        totalGstAmount: Number(totals.totalGstAmount || 0),
        grandTotal: Number(totals.grandTotal || 0),
        notes: quotationNotes || '',
        validUntil: validUntilDate || '',
        status: 'sent',
        storeId: currentStore?.id || null,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || 'staff',
        createdByName: displayName || 'Staff',
      };

      await addDoc(getCollectionRef('quotations'), quotationData);
      success('Quotation saved successfully!');
      await fetchSavedQuotations();

      setQuotationItems([]);
      setQuotationNumber(generateNewQuotationNumber());
      handleClearCustomer();
      setActiveTab('saved');
    } catch (e) {
      console.error('Error saving quotation:', e);
      showError('Failed to save quotation');
    } finally {
      setSavingQuotation(false);
    }
  };

  const handleLoadQuotation = (q: Quotation) => {
    setSelectedCustomerId(q.customerId || '');
    setCustomerName(q.customerName || '');
    setCustomerPhone(q.customerPhone || '');
    setCustomerEmail(q.customerEmail || '');
    setCustomerAddress(q.customerAddress || '');
    setCustomerGstNo(q.customerGstNo || '');
    setQuotationNumber(q.quotationNumber || generateNewQuotationNumber());
    setQuotationItems(q.items || []);
    setQuotationNotes(q.notes || '');
    if (typeof q.validUntil === 'string') {
      setValidUntilDate(q.validUntil);
    }
    setActiveTab('create');
    info(`Loaded quotation ${q.quotationNumber}`);
  };

  const handleDeleteQuotation = async (id?: string) => {
    if (!id) return;
    if (!window.confirm('Delete this quotation permanently?')) return;

    try {
      await deleteDoc(getDocRef('quotations', id));
      setSavedQuotations(prev => prev.filter(q => q.id !== id));
      success('Quotation deleted successfully');
    } catch (e) {
      console.error('Error deleting quotation:', e);
      showError('Failed to delete quotation');
    }
  };

  const handleResetBuilder = () => {
    if (quotationItems.length > 0 && !window.confirm('Clear all items and start a fresh quotation?')) {
      return;
    }
    setQuotationItems([]);
    setQuotationNumber(generateNewQuotationNumber());
    handleClearCustomer();
    success('Builder reset');
  };

  // ── KPI Metrics ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalQuotes = savedQuotations.length;
    const totalValue = savedQuotations.reduce((sum, q) => sum + (Number(q.grandTotal) || 0), 0);
    const avgValue = totalQuotes > 0 ? totalValue / totalQuotes : 0;

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthQuotes = savedQuotations.filter(q => q.createdAt && new Date(q.createdAt) >= currentMonthStart);
    const thisMonthValue = thisMonthQuotes.reduce((sum, q) => sum + (Number(q.grandTotal) || 0), 0);

    return {
      totalQuotes,
      totalValue,
      avgValue,
      thisMonthQuotesCount: thisMonthQuotes.length,
      thisMonthValue,
    };
  }, [savedQuotations]);

  // ── Saved Quotations Filter ───────────────────────────────────────────────
  const filteredSavedQuotations = useMemo(() => {
    let result = savedQuotations;

    if (searchSavedTerm.trim()) {
      const term = searchSavedTerm.toLowerCase();
      result = result.filter(
        q =>
          q.quotationNumber.toLowerCase().includes(term) ||
          q.customerName.toLowerCase().includes(term) ||
          (q.customerPhone && q.customerPhone.includes(term)) ||
          (q.customerEmail && q.customerEmail.toLowerCase().includes(term))
      );
    }

    result = [...result].sort((a, b) => {
      let comp = 0;
      if (sortBy === 'amount') {
        comp = (Number(a.grandTotal) || 0) - (Number(b.grandTotal) || 0);
      } else if (sortBy === 'name') {
        comp = (a.customerName || '').localeCompare(b.customerName || '');
      } else {
        comp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return sortOrder === 'asc' ? -comp : comp;
      }
      return sortOrder === 'asc' ? comp : -comp;
    });

    return result;
  }, [savedQuotations, searchSavedTerm, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredSavedQuotations.length / itemsPerPage));
  const paginatedSavedQuotations = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSavedQuotations.slice(start, start + itemsPerPage);
  }, [filteredSavedQuotations, currentPage]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <Navbar />

      {/* FULL WIDTH CONTAINER MATCHING PRODUCTS & CUSTOMER MANAGEMENT */}
      <main className="flex-1 max-w-full w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8 space-y-3.5">
        
        {/* COMPACT PAGE HEADER */}
        <div className="mb-2 sm:mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Quotations
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              Create professional price estimates, manage saved records & download branded PDFs
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
                onClick={() => setActiveTab('create')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'create'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Quotation Builder</span>
                {quotationItems.length > 0 && (
                  <span className="ml-1 bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                    {quotationItems.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('saved')}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'saved'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Saved Quotations</span>
                <span className="ml-1 bg-gray-300 text-gray-700 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {savedQuotations.length}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={fetchSavedQuotations}
              disabled={loadingQuotations}
              className="p-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh quotations"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingQuotations ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
            </button>
          </div>
        </div>

        {/* COMPACT KPI CARDS STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Total Quotations</span>
              <FileCheck className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{kpis.totalQuotes}</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Total Quoted Value</span>
              <DollarSign className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-lg font-bold text-emerald-600 tabular-nums font-mono">₹{Math.round(kpis.totalValue).toLocaleString('en-IN')}</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">This Month</span>
              <TrendingUp className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-lg font-bold text-indigo-600 tabular-nums font-mono">₹{Math.round(kpis.thisMonthValue).toLocaleString('en-IN')}</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs">
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Average Quote</span>
              <Tag className="w-4 h-4 text-purple-600" />
            </div>
            <p className="text-lg font-bold text-gray-900 tabular-nums font-mono">₹{Math.round(kpis.avgValue).toLocaleString('en-IN')}</p>
          </div>
        </div>

        {/* ── TAB 1: QUOTATION BUILDER ────────────────────────────────────────── */}
        {activeTab === 'create' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            
            {/* Left Column (8 cols): Customer Bar + Line Items Entry + Table */}
            <div className="lg:col-span-8 space-y-3">
              
              {/* 1. Customer Information Bar */}
              <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-gray-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <User className="w-4 h-4 text-blue-600" />
                    <h2 className="text-xs sm:text-sm font-bold text-gray-900">Customer Details</h2>
                  </div>
                  {selectedCustomerId ? (
                    <button
                      type="button"
                      onClick={handleClearCustomer}
                      className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      Clear Customer
                    </button>
                  ) : (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveNewCustomer}
                        onChange={e => setSaveNewCustomer(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>Auto-save customer</span>
                    </label>
                  )}
                </div>

                {/* Auto-complete Search Bar & Input Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-4 relative" ref={customerDropdownRef}>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search existing customer..."
                        value={customerSearchQuery}
                        onChange={e => {
                          setCustomerSearchQuery(e.target.value);
                          setShowCustomerDropdown(true);
                        }}
                        onFocus={() => setShowCustomerDropdown(true)}
                        className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                      {customerSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerSearchQuery('');
                            setShowCustomerDropdown(false);
                          }}
                          className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {showCustomerDropdown && filteredCustomers.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-gray-100">
                        {filteredCustomers.map(cust => (
                          <div
                            key={cust.id}
                            onClick={() => handleSelectCustomer(cust)}
                            className="p-2.5 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors"
                          >
                            <div>
                              <p className="text-xs font-semibold text-gray-900">{cust.name}</p>
                              <p className="text-[10px] text-gray-500">{cust.phone || 'No phone'}</p>
                            </div>
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded font-medium">
                              Select
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="sm:col-span-3">
                    <input
                      type="text"
                      placeholder="Customer Name *"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <input
                      type="tel"
                      placeholder="Phone"
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <input
                      type="text"
                      placeholder="Billing Address / City"
                      value={customerAddress}
                      onChange={e => setCustomerAddress(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Compact Add Line Item Bar */}
              <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-gray-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-indigo-600" />
                    <h2 className="text-xs sm:text-sm font-bold text-gray-900">Add Line Item</h2>
                  </div>

                  <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setItemMode('catalog')}
                      className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer font-medium ${
                        itemMode === 'catalog'
                          ? 'bg-white text-indigo-600 shadow-xs font-semibold'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      From Catalog
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemMode('custom')}
                      className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer font-medium ${
                        itemMode === 'custom'
                          ? 'bg-white text-indigo-600 shadow-xs font-semibold'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Custom Item
                    </button>
                  </div>
                </div>

                {itemMode === 'catalog' && (
                  <div className="relative" ref={productDropdownRef}>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search product from store catalog..."
                        value={productSearchQuery}
                        onChange={e => {
                          setProductSearchQuery(e.target.value);
                          setShowProductDropdown(true);
                        }}
                        onFocus={() => setShowProductDropdown(true)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>

                    {showProductDropdown && filteredProducts.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-gray-100">
                        {filteredProducts.map(prod => (
                          <div
                            key={prod.id}
                            onClick={() => handleSelectProductFromCatalog(prod)}
                            className="p-2.5 hover:bg-indigo-50 cursor-pointer flex justify-between items-center transition-colors"
                          >
                            <div>
                              <p className="text-xs font-semibold text-gray-900">{prod.name}</p>
                              <p className="text-[10px] text-gray-500">
                                MRP: ₹{(prod.mrp || prod.cost || 0).toLocaleString('en-IN')} {prod.productCode ? `• ${prod.productCode}` : ''}
                              </p>
                            </div>
                            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded font-medium">
                              Select
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Form Row */}
                <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center">
                  <div className="col-span-2 sm:col-span-5">
                    <input
                      type="text"
                      placeholder="Item Title / Description *"
                      value={itemTitle}
                      onChange={e => setItemTitle(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-2">
                    <div className="relative">
                      <span className="absolute left-2 top-1.5 text-gray-400 text-xs">₹</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="Rate *"
                        value={itemRate || ''}
                        onChange={e => setItemRate(Number(e.target.value))}
                        className="w-full pl-5 pr-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="col-span-1 sm:col-span-1">
                    <input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      value={itemQuantity}
                      onChange={e => setItemQuantity(Math.max(1, Number(e.target.value)))}
                      className="w-full px-2 py-1.5 text-xs text-center border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-2">
                    <div className="flex gap-1">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="Disc"
                        value={itemDiscount || ''}
                        onChange={e => setItemDiscount(Number(e.target.value))}
                        className="w-full px-2 py-1.5 text-xs border border-indigo-200 bg-indigo-50/30 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-indigo-900 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setItemDiscountType(t => (t === 'amount' ? 'percent' : 'amount'))}
                        className="px-2 py-1 text-xs border border-indigo-200 rounded-lg bg-white font-bold text-indigo-700 hover:bg-indigo-50"
                        title="Toggle ₹ / %"
                      >
                        {itemDiscountType === 'percent' ? '%' : '₹'}
                      </button>
                    </div>
                  </div>

                  <div className="col-span-1 sm:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs transition-colors shadow-xs flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Item</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. Items List Table */}
              <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-gray-200 space-y-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
                  <h2 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <span>Quotation Line Items</span>
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded-full font-bold">
                      {quotationItems.length}
                    </span>
                  </h2>
                  {quotationItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setQuotationItems([])}
                      className="text-xs text-red-600 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {quotationItems.length === 0 ? (
                  <div className="py-6 text-center text-gray-400 text-xs bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                    No items in quotation yet. Use the entry bar above to add products.
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-3.5 sm:mx-0">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-700 border-b border-gray-200 font-semibold">
                          <th className="p-2 text-center w-8">#</th>
                          <th className="p-2">Item Description</th>
                          <th className="p-2 text-center w-16">Qty</th>
                          <th className="p-2 text-right w-24">Rate (₹)</th>
                          <th className="p-2 text-center w-24">Discount</th>
                          <th className="p-2 text-center w-14">GST</th>
                          <th className="p-2 text-right w-24">Total (₹)</th>
                          <th className="p-2 text-center w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-800">
                        {quotationItems.map((item, idx) => {
                          const qty = item.quantity || 1;
                          const gross = (item.rate || 0) * qty;
                          const discAmt = item.discountType === 'percent' ? (gross * (item.discount || 0)) / 100 : (item.discount || 0);
                          return (
                            <tr key={item.id} className="hover:bg-blue-50/30 transition-colors">
                              <td className="p-2 text-center font-medium text-gray-400">{idx + 1}</td>
                              <td className="p-2">
                                <p className="font-semibold text-gray-900">{item.title}</p>
                                {discAmt > 0 && (
                                  <p className="text-[10px] text-emerald-600 font-medium">
                                    Disc: -₹{discAmt.toFixed(2)} ({item.discountType === 'percent' ? `${item.discount}%` : `₹${item.discount}`})
                                  </p>
                                )}
                              </td>
                              <td className="p-2 text-center">
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={e =>
                                    handleUpdateItem(item.id!, 'quantity', Math.max(1, Number(e.target.value)))
                                  }
                                  className="w-12 px-1 py-0.5 text-center border border-gray-300 rounded text-xs"
                                />
                              </td>
                              <td className="p-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  value={item.rate}
                                  onChange={e =>
                                    handleUpdateItem(item.id!, 'rate', Math.max(0, Number(e.target.value)))
                                  }
                                  className="w-20 px-1 py-0.5 text-right border border-gray-300 rounded text-xs font-mono tabular-nums"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    value={item.discount}
                                    onChange={e =>
                                      handleUpdateItem(item.id!, 'discount', Math.max(0, Number(e.target.value)))
                                    }
                                    className="w-12 px-1 py-0.5 text-center border border-indigo-200 bg-indigo-50/30 rounded text-xs font-semibold text-indigo-700 font-mono tabular-nums"
                                  />
                                  <span className="text-[10px] font-bold text-indigo-600">
                                    {item.discountType === 'percent' ? '%' : '₹'}
                                  </span>
                                </div>
                              </td>
                              <td className="p-2 text-center text-gray-600">
                                {item.taxPercent ? `${item.taxPercent}%` : '0%'}
                              </td>
                              <td className="p-2 text-right font-bold text-gray-900 font-mono tabular-nums">
                                ₹{item.amount.toFixed(2)}
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(item.id)}
                                  className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                  title="Remove line item"
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

            {/* Right Column (4 cols): Sticky Summary Slip */}
            <div className="lg:col-span-4 space-y-3">
              <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-gray-200 space-y-3 lg:sticky lg:top-16">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                  <h2 className="text-xs sm:text-sm font-bold text-gray-900">Quotation Summary</h2>
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-mono font-bold">
                    {quotationNumber}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <label className="text-gray-600">Reference No.</label>
                      <button
                        type="button"
                        onClick={() => setQuotationNumber(generateNewQuotationNumber())}
                        className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        Regenerate
                      </button>
                    </div>
                    <input
                      type="text"
                      value={quotationNumber}
                      onChange={e => setQuotationNumber(e.target.value)}
                      className="w-full px-2.5 py-1 font-mono text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-gray-600 mb-0.5">Valid Until Date</label>
                    <input
                      type="date"
                      value={validUntilDate}
                      onChange={e => setValidUntilDate(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Calculation Breakdown */}
                <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 border border-slate-200 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal Gross</span>
                    <span className="font-semibold text-slate-900 tabular-nums font-mono">₹{totals.subtotal.toFixed(2)}</span>
                  </div>

                  {totals.totalDiscount > 0 && (
                    <div className="flex justify-between text-emerald-600 font-medium">
                      <span>Total Discounts</span>
                      <span className="tabular-nums font-mono">- ₹{totals.totalDiscount.toFixed(2)}</span>
                    </div>
                  )}

                  {totals.totalGstAmount > 0 && (
                    <>
                      <div className="flex justify-between text-slate-600">
                        <span>Taxable Value</span>
                        <span className="tabular-nums font-mono">₹{totals.taxableAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Total GST</span>
                        <span className="tabular-nums font-mono">₹{totals.totalGstAmount.toFixed(2)}</span>
                      </div>
                    </>
                  )}

                  <div className="border-t border-slate-200 pt-1.5 flex justify-between items-center text-sm font-bold text-slate-900">
                    <span>Grand Total</span>
                    <span className="text-base text-blue-600 tabular-nums font-mono font-bold">₹{totals.grandTotal.toFixed(2)}</span>
                  </div>
                </div>

                {/* Terms / Notes */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Notes / Terms</label>
                  <textarea
                    rows={2}
                    value={quotationNotes}
                    onChange={e => setQuotationNotes(e.target.value)}
                    className="w-full p-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Action Buttons */}
                <div className="space-y-1.5 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveQuotation}
                    disabled={savingQuotation || quotationItems.length === 0}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs sm:text-sm transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingQuotation ? 'Saving...' : 'Save Quotation to Records'}</span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadPDF()}
                      disabled={quotationItems.length === 0}
                      className="py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs sm:text-sm transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleShareQuotation()}
                      disabled={quotationItems.length === 0 || !!sharingQuoteId}
                      className="py-2 bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-lg font-semibold text-xs sm:text-sm transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Share2 className="w-3.5 h-3.5 text-blue-600" />
                      <span>{sharingQuoteId ? 'Sharing...' : 'Share'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleResetBuilder}
                    className="w-full py-1 text-xs text-gray-500 hover:text-gray-700 hover:underline cursor-pointer"
                  >
                    Start Fresh Quotation
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── TAB 2: SAVED QUOTATIONS LIST ───────────────────────────────────────── */
          <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-gray-200 space-y-3">
            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 border-b border-gray-100">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-gray-900">Saved Quotation Records</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Showing {filteredSavedQuotations.length} of {savedQuotations.length} records
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search quote #, customer, phone..."
                    value={searchSavedTerm}
                    onChange={e => {
                      setSearchSavedTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  {searchSavedTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchSavedTerm('')}
                      className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none"
                >
                  <option value="date">Sort: Date</option>
                  <option value="amount">Sort: Amount</option>
                  <option value="name">Sort: Customer</option>
                </select>

                <button
                  type="button"
                  onClick={() => setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors cursor-pointer"
                  title={`Order: ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {loadingQuotations ? (
              <div className="py-12 text-center text-gray-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                <p className="text-xs">Loading saved quotation records...</p>
              </div>
            ) : filteredSavedQuotations.length === 0 ? (
              <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                <FileText className="w-7 h-7 text-gray-300 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-gray-600">No saved quotations found</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {searchSavedTerm ? 'Try adjusting your search criteria' : 'Create and save your first price quotation above'}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto -mx-3.5 sm:mx-0">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-700 border-b border-gray-200 font-semibold">
                        <th className="p-2.5">Quotation No.</th>
                        <th className="p-2.5">Customer</th>
                        <th className="p-2.5">Date Created</th>
                        <th className="p-2.5">Validity</th>
                        <th className="p-2.5 text-center">Items</th>
                        <th className="p-2.5 text-right">Grand Total (₹)</th>
                        <th className="p-2.5 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-800">
                      {paginatedSavedQuotations.map(q => {
                        const createdStr = q.createdAt ? new Date(q.createdAt).toLocaleDateString('en-IN') : 'N/A';
                        const isExpired = q.validUntil && new Date(q.validUntil) < new Date();
                        return (
                          <tr key={q.id} className="hover:bg-blue-50/30 transition-colors">
                            <td className="p-2.5 font-mono font-bold text-blue-600">
                              {q.quotationNumber}
                            </td>
                            <td className="p-2.5">
                              <p className="font-semibold text-gray-900">{q.customerName}</p>
                              {q.customerPhone && <p className="text-[10px] text-gray-500">{q.customerPhone}</p>}
                            </td>
                            <td className="p-2.5 text-gray-600">{createdStr}</td>
                            <td className="p-2.5">
                              {q.validUntil ? (
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                    isExpired
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-emerald-100 text-emerald-700'
                                  }`}
                                >
                                  {isExpired ? 'Expired' : `Valid to ${new Date(q.validUntil).toLocaleDateString('en-IN')}`}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-[10px]">No expiry</span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-medium">{q.items?.length || 0}</td>
                            <td className="p-2.5 text-right font-bold text-gray-900 font-mono tabular-nums">
                              ₹{Number(q.grandTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleLoadQuotation(q)}
                                  className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Load into builder to edit"
                                >
                                  <FileText className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDownloadPDF(q)}
                                  className="px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Download branded PDF"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>PDF</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleShareQuotation(q)}
                                  disabled={sharingQuoteId === q.id}
                                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors cursor-pointer"
                                  title="Share quotation"
                                >
                                  <Share2 className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteQuotation(q.id)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                  title="Delete quotation"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
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
      </main>
    </div>
  );
};

export default QuotationManagement;
