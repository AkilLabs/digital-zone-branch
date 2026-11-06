import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Trash2, Plus, Minus, ExternalLink, UserPlus, ShoppingCart, Wrench, CreditCard, QrCode, X, Printer, Share2, Download, RefreshCw, Calendar, Receipt, Check } from 'lucide-react';
import Navbar from '../components/Navbar';
import ShareModal from '../components/ShareModal';
import QRScannerModal from '../components/QRScannerModal';
import whatsappIcon from '../assets/whatsapp.png';
import gmailIcon from '../assets/gmail.png';
import cashIcon from '../assets/CASH.svg';
import upiIcon from '../assets/upi.svg';
import cardIcon from '../assets/card.svg';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';

import { useAvailableProducts, useInvalidateCache } from '../hooks/useFirestoreCache';
import { updateLocalProductQuantities } from '../utils/productSyncCache';
import { generateInvoice } from '../utils/pdfGenerator';
import { isEmployeeOfBranch } from '../utils/firestore';
import { generateUPIQRCode } from '../utils/qrcode';
import { openRazorpayCheckout } from '../utils/razorpay';
import { resolveShopDetails } from '../utils/shopDetails';
import { encodePrice } from '../utils/secretCode';
import type { BillingItem, ShopDetails } from '../types';
import Lottie from 'lottie-react';
import OrderProcessingAnim from '../assets/Orderprocessing.json';

import logoImg from '../assets/logo.png';
import PaymentAnim from '../assets/PaymentSuccessfulAnimation.json';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

// Extended interface for tracking grouped transactions
interface BillingItemWithTransaction extends BillingItem {
  transactionId?: string; // Links products sold together
  itemNumber?: number; // Position in the transaction (1, 2, 3...)
  totalItems?: number; // Total number of items in this transaction
  itemDiscount?: number; // Discount applied to this item
  itemSubtotal?: number; // Subtotal before discount for this item
  discountType?: 'amount' | 'percent'; // Type of discount applied
  discountValue?: number; // Value of discount (amount or percentage)
  discountAmount?: number; // Calculated discount amount
  gstEnabled?: boolean; // Whether GST is enabled
  gstRate?: number; // GST rate percentage
  baseAmount?: number; // Base amount before GST
  customerDetails?: string; // Full customer details string
  financeProvider?: string;
  financeTenureMonths?: number;
  financeDownPayment?: number;
  financeAmount?: number;
  monthlyEmi?: number;
  salesPersonId?: string;
  salesPersonName?: string;
  invoiceTime?: string;
}
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  query,
  where,
  Timestamp,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  increment,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';

interface Product {
  id: string;
  name: string;
  code: string;
  price: number;
  quantity: number;
  stock: number;
  cost?: number; // Optional cost field for services and products
  imei?: string; // IMEI number for mobile products
  hsnCode?: string; // HSN/SAC code for GST
  mop?: number; // Market Operating Price
  taxPercent?: number; // GST rate for the product
  highestDiscountLimit?: number; // Maximum discount allowed
  gstEnabled?: boolean; // Whether GST is enabled for this product
  brand?: string;
  category?: string;
}

type PaymentMode = 'cash' | 'upi' | 'card' | 'split' | 'finance';

type ExistingBillDoc = {
  id: string;
  collection: 'billingItems' | 'creditSales';
};

function Billing() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const routeTransactionId = params['*'] ? decodeURIComponent(params['*']) : undefined;
  const isEditMode = Boolean(routeTransactionId);
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore } = useStore();
  const { success, error: showError } = useToastContext();
  const canSelectSalesPerson =
    currentUser?.role === 'owner' ||
    currentUser?.role === 'hub-admin' ||
    currentUser?.role === 'store-admin' ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'manager';
  const fallbackSalesPersonName = currentUser?.displayName || currentUser?.name || currentUser?.email || 'Unknown User';
  // Billing date state – defaults to today (YYYY-MM-DD)
  const todayISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const [billingDate, setBillingDate] = useState<string>(todayISO);

  const formattedDate = useMemo(() => {
    // Parse the YYYY-MM-DD string in local time
    const parts = billingDate.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
  }, [billingDate]);
  // Entry type: product (sales), service, or credit
  const [entryType, setEntryType] = useState<'product' | 'service' | 'credit'>('product');
  const [isSaving, setIsSaving] = useState(false);

  const [savedSuccessMsg, setSavedSuccessMsg] = useState('');
  const [showBillSavedModal, setShowBillSavedModal] = useState(false);
  const [isLoadingEditBill, setIsLoadingEditBill] = useState(false);
  const [existingBillDocs, setExistingBillDocs] = useState<ExistingBillDoc[]>([]);
  const [editTransactionId, setEditTransactionId] = useState('');


  // Secret code digit mapping
  const encodeSecret = (value: number | string | undefined | null) => {
    return encodePrice(value);
  };

  const [orderItems, setOrderItems] = useState<Product[]>([]);
  // Refs for keyboard navigation
  const costRef = useRef<HTMLInputElement>(null);
  const sellingRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [searchText, setSearchText] = useState('');
  const { data: products = [], isLoading: loadingProducts } = useAvailableProducts();
  const { invalidateProducts, invalidateBillingItems, invalidateCreditSales } = useInvalidateCache();
  const [selectedProductInfo, setSelectedProductInfo] = useState<{ id: string; name: string; productCode?: string; brand?: string; category?: string; mrp?: number; cost?: number; baseCost?: number; price: number; quantity: number; imei?: string; hcsCode?: string; hsnCode?: string; mop?: number; taxPercent?: number; highestDiscountLimit?: number; gstEnabled?: boolean } | null>(null);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [showProductSearchModal, setShowProductSearchModal] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [selectedCost, setSelectedCost] = useState<number | ''>('');
  const [selectedSelling, setSelectedSelling] = useState<number | ''>('');
  const [selectedUnitDiscount, setSelectedUnitDiscount] = useState<number | ''>('');
  const [selectedQty, setSelectedQty] = useState<number | ''>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [selectedGstEnabled, setSelectedGstEnabled] = useState<boolean>(false);
  const [selectedTaxRate, setSelectedTaxRate] = useState<number>(18);

  // Reset selection when search text changes
  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchText]);

  // Auto-set selling price to cost when switching to credit mode
  useEffect(() => {
    if (entryType === 'credit' && selectedProductInfo) {
      setSelectedSelling(typeof selectedCost === 'number' ? selectedCost : 0);
    }
  }, [entryType]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && showSearchDropdown) {
      const dropdown = document.querySelector('.billing-search-dropdown');
      if (dropdown) {
        const list = dropdown.querySelector('tbody');
        if (list && list.children[selectedIndex]) {
          (list.children[selectedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
        }
      }
    }
  }, [selectedIndex, showSearchDropdown]);

  const [selectedPayment, setSelectedPayment] = useState<PaymentMode>('cash');
  const [cashAmount, setCashAmount] = useState<string>('');
  const [upiAmount, setUpiAmount] = useState<string>('');
  const [cardAmount, setCardAmount] = useState<string>('');
  const [financeProvider, setFinanceProvider] = useState('');
  const [financeProviders, setFinanceProviders] = useState<any[]>([]);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [financeTenureMonths, setFinanceTenureMonths] = useState<number | ''>('');
  const [financeDownPayment, setFinanceDownPayment] = useState<string>('');
  const [financeProcessingFee, setFinanceProcessingFee] = useState<string>('');
  const [showFinanceModal, setShowFinanceModal] = useState(false);
  const [financeProviderDraft, setFinanceProviderDraft] = useState('');
  const [financeTenureDraft, setFinanceTenureDraft] = useState<number | ''>('');
  const [financeDownPaymentDraft, setFinanceDownPaymentDraft] = useState('');
  const [financeProcessingFeeDraft, setFinanceProcessingFeeDraft] = useState('');
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearchPage, setCustomerSearchPage] = useState(1);
  const customerSearchInputRef = useRef<HTMLInputElement>(null);
  const CUSTOMERS_PER_PAGE = 10;
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerGstNo, setCustomerGstNo] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerError, setCustomerError] = useState('');

  const [customerDisplay, setCustomerDisplay] = useState('Walk In Customer');

  const [customerQuery, setCustomerQuery] = useState('');
  // Discount state
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState<number>(0);
  // Round off state
  const [roundOffEnabled, setRoundOffEnabled] = useState<boolean>(true);
  const [isAutoRoundOff, setIsAutoRoundOff] = useState<boolean>(true);
  const [manualRoundOff, setManualRoundOff] = useState<string>('');
  // GST state
  const [gstEnabled, setGstEnabled] = useState<boolean>(false);
  const [gstRate, setGstRate] = useState<number>(18);
  // Service-specific inputs
  const [serviceTitle, setServiceTitle] = useState('');
  // Credit-specific inputs and state
  const [creditCustomerDisplay, setCreditCustomerDisplay] = useState<string>('Talk and Walk');
  const [creditCustomers, setCreditCustomers] = useState<Array<{ id: string; name: string; phone: string; email: string }>>([]);
  const [loadingCreditCustomers, setLoadingCreditCustomers] = useState(false);
  const [creditCustomerModalOpen, setCreditCustomerModalOpen] = useState(false);
  const [creditCustomerSearchOpen, setCreditCustomerSearchOpen] = useState(false);
  const [creditCustomerQuery, setCreditCustomerQuery] = useState('');
  const [creditCustomerName, setCreditCustomerName] = useState('');
  const [creditCustomerPhone, setCreditCustomerPhone] = useState('');
  const [creditCustomerEmail, setCreditCustomerEmail] = useState('');
  const [creditCustomerError, setCreditCustomerError] = useState('');

  // Shop details and sharing
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareType, setShareType] = useState<'whatsapp' | 'email'>('whatsapp');
  const [lastBillingItem, setLastBillingItem] = useState<BillingItem | null>(null);

  // Customer data from Firebase
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; phone: string; email: string; gstNo: string; address: string }>>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [salesEmployees, setSalesEmployees] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [loadingSalesEmployees, setLoadingSalesEmployees] = useState(false);
  const [selectedSalesPersonId, setSelectedSalesPersonId] = useState('');
  const [selectedSalesPersonName, setSelectedSalesPersonName] = useState(fallbackSalesPersonName);

  // Mobile order details panel visibility
  const [showMobileOrderPanel, setShowMobileOrderPanel] = useState(false);

  // QR Code state for UPI payments
  const [upiQrCode, setUpiQrCode] = useState<string>('');
  const [showQrModal, setShowQrModal] = useState(false);

  // Razorpay payment processing state
  const [, setIsProcessingPayment] = useState(false);

  // Ref for scroll container to prevent pull-to-refresh
  const scrollContainerRef = useRef<HTMLElement>(null);
  const lastProcessedKeyRef = useRef('');
  const editCreatedAtRef = useRef<Date | null>(null);

  const resetBillingState = useCallback((keepLastBillingItem = false) => {
    // Clear edit-specific state
    setEditTransactionId('');
    setExistingBillDocs([]);
    editCreatedAtRef.current = null;

    // Reset billing date to today
    setBillingDate(todayISO);

    // Reset all billing state
    setOrderItems([]);
    setSearchText('');
    setSelectedProductInfo(null);
    setSelectedCost('');
    setSelectedSelling('');
    setSelectedUnitDiscount('');
    setSelectedQty('');
    setDiscountValue(0);
    setDiscountType('amount');
    setRoundOffEnabled(true);
    setIsAutoRoundOff(true);
    setManualRoundOff('');
    setGstEnabled(false);
    setSelectedGstEnabled(false);
    setSelectedTaxRate(18);
    setGstRate(18);
    setSelectedPayment('cash');
    setCashAmount('');
    setUpiAmount('');
    setCardAmount('');
    setFinanceProvider('');
    setFinanceTenureMonths('');
    setFinanceDownPayment('');
    setFinanceProcessingFee('');
    setShowFinanceModal(false);
    setFinanceProviderDraft('');
    setFinanceTenureDraft('');
    setFinanceDownPaymentDraft('');
    setFinanceProcessingFeeDraft('');
    setCustomerDisplay('Walk In Customer');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerGstNo('');
    setCustomerAddress('');
    setServiceTitle('');
    setCreditCustomerDisplay('Talk and Walk');

    if (canSelectSalesPerson && salesEmployees.length > 0) {
      const currentEmp = salesEmployees.find(emp => emp.id === currentUser?.uid);
      if (currentEmp) {
        setSelectedSalesPersonId(currentEmp.id);
        setSelectedSalesPersonName(currentEmp.name);
      } else {
        setSelectedSalesPersonId(salesEmployees[0].id);
        setSelectedSalesPersonName(salesEmployees[0].name);
      }
    } else {
      setSelectedSalesPersonId(currentUser?.uid || '');
      setSelectedSalesPersonName(fallbackSalesPersonName);
    }

    if (!keepLastBillingItem) {
      setLastBillingItem(null);
    }
  }, [canSelectSalesPerson, salesEmployees, currentUser, fallbackSalesPersonName]);
  const filteredCustomers = customers.filter(c => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  });

  const parseCustomerDisplay = (display: string) => {
    const parts = display.split(' • ').map(part => part.trim()).filter(Boolean);
    const name = parts[0] || display;
    const phone = parts[1] || '';
    let email = '';
    let gstNo = '';
    let address = '';

    for (const part of parts.slice(2)) {
      if (/^GST\s*No\s*:/i.test(part)) {
        gstNo = part.replace(/^GST\s*No\s*:\s*/i, '').trim();
      } else if (/^Address\s*:/i.test(part)) {
        address = part.replace(/^Address\s*:\s*/i, '').trim();
      } else if (!email) {
        email = part;
      }
    }

    return { name, phone, email, address, gstNo };
  };

  useEffect(() => {
    if (!isEditMode || !routeTransactionId) return;

    const loadBillForEdit = async () => {
      setIsLoadingEditBill(true);
      try {
        const foundDocs: Array<{ id: string; data: any; collection: 'billingItems' | 'creditSales' }> = [];

        const billingByTransaction = await getDocs(query(getCollectionRef('billingItems'), where('transactionId', '==', routeTransactionId)));
        billingByTransaction.docs.forEach((docSnap) => {
          foundDocs.push({ id: docSnap.id, data: docSnap.data(), collection: 'billingItems' });
        });

        const creditByTransaction = await getDocs(query(getCollectionRef('creditSales'), where('transactionId', '==', routeTransactionId)));
        creditByTransaction.docs.forEach((docSnap) => {
          foundDocs.push({ id: docSnap.id, data: docSnap.data(), collection: 'creditSales' });
        });

        // Backward compatibility for older entries edited by document id.
        if (foundDocs.length === 0) {
          // Try safe doc ID format (/ replaced with _) first
          const safeRouteId = routeTransactionId.replace(/\//g, '_');
          const billingDoc = await getDoc(getDocRef('billingItems', safeRouteId));
          if (billingDoc.exists()) {
            foundDocs.push({ id: billingDoc.id, data: billingDoc.data(), collection: 'billingItems' });
          }
          const creditDoc = await getDoc(getDocRef('creditSales', safeRouteId));
          if (creditDoc.exists()) {
            foundDocs.push({ id: creditDoc.id, data: creditDoc.data(), collection: 'creditSales' });
          }
          // Also try original ID for backward compatibility
          if (foundDocs.length === 0 && safeRouteId !== routeTransactionId) {
            try {
              const billingDocOld = await getDoc(getDocRef('billingItems', routeTransactionId));
              if (billingDocOld.exists()) {
                foundDocs.push({ id: billingDocOld.id, data: billingDocOld.data(), collection: 'billingItems' });
              }
              const creditDocOld = await getDoc(getDocRef('creditSales', routeTransactionId));
              if (creditDocOld.exists()) {
                foundDocs.push({ id: creditDocOld.id, data: creditDocOld.data(), collection: 'creditSales' });
              }
            } catch {
              // Original ID with / may fail in Firestore, that's expected
            }
          }
        }

        if (foundDocs.length === 0) {
          showError('Bill not found or it may have been deleted.');
          navigate('/overall-sales');
          return;
        }

        const primaryDoc = foundDocs[0].data;
        const resolvedEditTransactionId = primaryDoc.transactionId || routeTransactionId;

        setEditTransactionId(resolvedEditTransactionId);
        setExistingBillDocs(foundDocs.map((docItem) => ({ id: docItem.id, collection: docItem.collection })));

        const resolvedEntryType = primaryDoc.type === 'credit'
          ? 'credit'
          : primaryDoc.type === 'service'
            ? 'service'
            : 'product';
        setEntryType(resolvedEntryType);

        const customerDisplayText = primaryDoc.customerDetails
          || [
            primaryDoc.customerName,
            primaryDoc.customerPhone && primaryDoc.customerPhone !== 'N/A' ? primaryDoc.customerPhone : '',
            primaryDoc.customerEmail || '',
            primaryDoc.customerAddress || '',
            primaryDoc.customerGstNo ? `GST No: ${primaryDoc.customerGstNo}` : '',
          ].filter(Boolean).join(' • ')
          || 'Walk In Customer';

        setCustomerDisplay(customerDisplayText);
        setCustomerAddress(primaryDoc.customerAddress || '');

        if (resolvedEntryType === 'credit') {
          setCreditCustomerDisplay(primaryDoc.creditCustomerName || primaryDoc.customerName || 'Talk and Walk');
        }

        setSelectedPayment((primaryDoc.paymentMode as PaymentMode) || 'cash');
        setDiscountType(primaryDoc.discountType === 'percent' ? 'percent' : 'amount');
        setDiscountValue(Number(primaryDoc.discountValue || 0));
        if (primaryDoc.roundOff !== undefined && primaryDoc.roundOff !== null) {
          setRoundOffEnabled(true);
          setIsAutoRoundOff(false);
          setManualRoundOff(String(primaryDoc.roundOff));
        } else {
          setRoundOffEnabled(true);
          setIsAutoRoundOff(true);
          setManualRoundOff('');
        }
        setGstEnabled(Boolean(primaryDoc.gstEnabled));
        setGstRate(Number(primaryDoc.gstRate || 18));

        if (primaryDoc.paymentMode === 'split' && primaryDoc.paymentSplit) {
          setCashAmount(String(primaryDoc.paymentSplit.cash || ''));
          setUpiAmount(String(primaryDoc.paymentSplit.upi || ''));
          setCardAmount(String(primaryDoc.paymentSplit.card || ''));
        } else {
          setCashAmount('');
          setUpiAmount('');
          setCardAmount('');
        }

        if (primaryDoc.paymentMode === 'finance') {
          setFinanceProvider(primaryDoc.financeProvider || '');
          setFinanceTenureMonths(typeof primaryDoc.financeTenureMonths === 'number' ? primaryDoc.financeTenureMonths : '');
          setFinanceDownPayment(String(primaryDoc.financeDownPayment || ''));
          setFinanceProcessingFee(String(primaryDoc.processingFee || ''));
        } else {
          setFinanceProvider('');
          setFinanceTenureMonths('');
          setFinanceDownPayment('');
          setFinanceProcessingFee('');
        }

        if (primaryDoc.salesPersonId) {
          setSelectedSalesPersonId(primaryDoc.salesPersonId);
        }
        if (primaryDoc.salesPersonName) {
          setSelectedSalesPersonName(primaryDoc.salesPersonName);
        }

        if (primaryDoc.createdAt) {
          const cDate = typeof (primaryDoc.createdAt as any).toDate === 'function'
            ? (primaryDoc.createdAt as any).toDate()
            : new Date(primaryDoc.createdAt);
          if (!Number.isNaN(cDate.getTime())) {
            editCreatedAtRef.current = cDate;
            const yyyy = cDate.getFullYear();
            const mm = String(cDate.getMonth() + 1).padStart(2, '0');
            const dd = String(cDate.getDate()).padStart(2, '0');
            setBillingDate(`${yyyy}-${mm}-${dd}`);
          }
        }

        const mappedItems: Product[] = foundDocs.map((docItem, idx) => {
          const data = docItem.data;
          const defaultName = data.title || `Item ${idx + 1}`;
          const price = Number(data.sellingPrice || 0);
          const quantity = Number(data.quantity || 1);

          return {
            id: docItem.id,
            name: defaultName,
            code: data.type === 'service' ? 'SERVICE' : (data.productCode || data.code || ''),
            price,
            quantity,
            stock: 999999,
            cost: Number(data.cost || 0),
            imei: data.imei,
            hsnCode: data.hsnCode,
            taxPercent: Number(data.gstRate || 0),
            gstEnabled: data.gstEnabled !== false,
            brand: data.brand || '',
            category: data.category || '',
          };
        });

        setOrderItems(mappedItems);
      } catch (loadError) {
        console.error('Failed to load bill for edit:', loadError);
        showError('Failed to load bill for editing.');
        navigate('/overall-sales');
      } finally {
        setIsLoadingEditBill(false);
      }
    };

    loadBillForEdit();
  }, [getCollectionRef, getDocRef, isEditMode, navigate, routeTransactionId, showError]);

  // Reset billing page states on navigation to /billing or route changes
  useEffect(() => {
    if (location.pathname === '/billing') {
      if (location.key !== lastProcessedKeyRef.current) {
        lastProcessedKeyRef.current = location.key || 'default';
        resetBillingState(false);

        // Pre-populate customer details if navigated with customer state or query parameters
        const state = location.state as {
          customer?: any;
          customerName?: string;
          customerPhone?: string;
          customerEmail?: string;
          customerAddress?: string;
          customerGstNo?: string;
          name?: string;
          phone?: string;
          email?: string;
          address?: string;
          gstNo?: string;
        } | null;

        const searchParams = new URLSearchParams(location.search);
        const paramName = searchParams.get('customerName') || searchParams.get('name');
        const paramPhone = searchParams.get('customerPhone') || searchParams.get('phone');
        const paramEmail = searchParams.get('customerEmail') || searchParams.get('email');
        const paramAddress = searchParams.get('customerAddress') || searchParams.get('address');
        const paramGst = searchParams.get('customerGstNo') || searchParams.get('gstNo');

        const customerObj = state?.customer;
        const name = (customerObj?.name || state?.customerName || state?.name || paramName || '').trim();
        const phone = (customerObj?.phone || state?.customerPhone || state?.phone || paramPhone || '').trim();
        const email = (customerObj?.email || state?.customerEmail || state?.email || paramEmail || '').trim();
        const address = (customerObj?.address || state?.customerAddress || state?.address || paramAddress || '').trim();
        const gstNo = (customerObj?.gstNo || state?.customerGstNo || state?.gstNo || paramGst || '').trim();

        if (name) {
          const parts = [
            name,
            phone,
            email ? email : null,
            address ? `Address: ${address}` : null,
            gstNo ? `GST No: ${gstNo}` : null,
          ].filter(Boolean);

          const formattedDisplay = parts.join(' • ');
          setCustomerDisplay(formattedDisplay);
          setCustomerAddress(address);
          setCustomerName(name);
          setCustomerPhone(phone);
          setCustomerEmail(email);
          setCustomerGstNo(gstNo);

          const creditParts = [name, phone, email].filter(Boolean);
          setCreditCustomerDisplay(creditParts.join(' • '));
        }
      }
    } else if (!isEditMode && (editTransactionId !== '' || existingBillDocs.length > 0)) {
      resetBillingState(false);
    }
  }, [location.pathname, location.key, location.search, location.state, isEditMode, editTransactionId, existingBillDocs, resetBillingState]);

  // Clear previous sale receipt/PDF buttons when new items are added to the order
  useEffect(() => {
    if (orderItems.length > 0 && lastBillingItem !== null) {
      setLastBillingItem(null);
    }
  }, [orderItems.length, lastBillingItem]);

  const assignedStoreId = currentStore?.id || currentUser?.storeId || '';
  const selectedSalesPerson = salesEmployees.find(emp => emp.id === selectedSalesPersonId);
  const resolvedSalesPersonId = canSelectSalesPerson
    ? (selectedSalesPerson?.id || selectedSalesPersonId || currentUser?.uid || '')
    : (currentUser?.uid || '');
  const resolvedSalesPersonName = canSelectSalesPerson
    ? (selectedSalesPerson?.name || selectedSalesPersonName || fallbackSalesPersonName)
    : fallbackSalesPersonName;


  const updateQuantity = (id: string, delta: number) => {
    setOrderItems(items =>
      items.map(item =>
        item.id === id
          ? { ...item, quantity: Math.max(1, item.quantity + delta) }
          : item
      )
    );
  };

  const removeItem = (id: string) => {
    setOrderItems(items => items.filter(item => item.id !== id));
  };

  // Calculate subtotal: use service form values if in service mode with filled fields, otherwise use orderItems
  let subTotal = 0;
  if (entryType === 'service' && serviceTitle.trim() && typeof selectedSelling === 'number' && selectedSelling > 0) {
    // Service mode with form filled: calculate from service form values
    const serviceQty = typeof selectedQty === 'number' && selectedQty > 0 ? selectedQty : 1;
    subTotal = selectedSelling * serviceQty;
  } else {
    // Product/Credit mode or service already added to order: calculate from orderItems
    subTotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  const discount = discountType === 'percent'
    ? Math.min(subTotal, Math.max(0, Math.round((subTotal * discountValue) / 100)))
    : Math.min(subTotal, Math.max(0, Math.round(discountValue)));
  const totalAfterDiscount = subTotal - discount;

  // Round Off calculation
  const autoRoundOffAmount = Number((Math.round(totalAfterDiscount) - totalAfterDiscount).toFixed(2));
  const roundOffAmount = roundOffEnabled
    ? (isAutoRoundOff ? autoRoundOffAmount : (parseFloat(manualRoundOff) || 0))
    : 0;
  const grandTotal = Math.max(0, Number((totalAfterDiscount + roundOffAmount).toFixed(2)));

  // GST calculation: if enabled, calculate proportional GST per item for mixed-tax support
  let computedGstAmount = 0;
  const hasGstActive = gstEnabled || orderItems.some(item => item.gstEnabled === true);
  if (hasGstActive) {
    if (entryType === 'service') {
      computedGstAmount = Math.round(totalAfterDiscount - (totalAfterDiscount / (1 + gstRate / 100)));
    } else {
      orderItems.forEach(item => {
        const itemGstOn = item.gstEnabled !== undefined ? item.gstEnabled : gstEnabled;
        if (!itemGstOn) return; // Skip items where GST is explicitly disabled

        const itemSubtotal = item.price * item.quantity;
        const itemDiscount = subTotal > 0 ? (itemSubtotal / subTotal) * discount : 0;
        const itemTotalAfterDiscount = itemSubtotal - itemDiscount;
        const itemTaxRate = (item.taxPercent !== undefined && item.taxPercent !== null && item.taxPercent > 0)
          ? item.taxPercent
          : gstRate;
        computedGstAmount += Math.round(itemTotalAfterDiscount - (itemTotalAfterDiscount / (1 + itemTaxRate / 100)));
      });
    }
  }
  const gstAmount = computedGstAmount;
  const baseAmount = totalAfterDiscount - gstAmount;
  const financeDownPaymentAmount = parseFloat(financeDownPayment) || 0;
  const financeProcessingFeeAmount = parseFloat(financeProcessingFee) || 0;
  const financeAmount = Math.max(0, (Number(grandTotal) || 0) - financeDownPaymentAmount);
  const monthlyEmi = typeof financeTenureMonths === 'number' && financeTenureMonths > 0
    ? Math.round(financeAmount / financeTenureMonths)
    : 0;

  const openFinanceModal = () => {
    setFinanceProviderDraft(financeProvider || financeProviders[0]?.name || '');
    setFinanceTenureDraft(financeTenureMonths);
    setFinanceDownPaymentDraft(financeDownPayment);
    setFinanceProcessingFeeDraft(financeProcessingFee);
    setShowFinanceModal(true);
  };

  const closeFinanceModal = () => {
    setShowFinanceModal(false);
  };

  const confirmFinanceModal = () => {
    const draftDownPayment = parseFloat(financeDownPaymentDraft) || 0;
    const draftProcessingFee = parseFloat(financeProcessingFeeDraft) || 0;
    const total = Number(grandTotal) || 0;

    if (!financeProviderDraft.trim()) {
      showError('Please enter finance provider name');
      return;
    }

    if (typeof financeTenureDraft !== 'number' || !Number.isInteger(financeTenureDraft) || financeTenureDraft <= 0) {
      showError('Please enter a valid tenure in months');
      return;
    }

    if (draftDownPayment < 0) {
      showError('Down payment cannot be negative');
      return;
    }

    if (draftDownPayment >= total) {
      showError('Down payment must be less than grand total for EMI payment');
      return;
    }

    if (draftProcessingFee < 0) {
      showError('Processing fee cannot be negative');
      return;
    }

    setFinanceProvider(financeProviderDraft.trim());
    setFinanceTenureMonths(financeTenureDraft);
    setFinanceDownPayment(String(draftDownPayment));
    setFinanceProcessingFee(String(draftProcessingFee));
    setSelectedPayment('finance');
    setShowFinanceModal(false);
  };

  // Auto-calculate split remaining similar to BillingForm
  useEffect(() => {
    if (selectedPayment === 'split') {
      const total = Number(grandTotal) || 0;
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;

      const filledFields = [cash > 0, upi > 0, card > 0].filter(Boolean).length;
      if (filledFields === 1 && total > 0) {
        if (cash > 0 && cash < total) {
          setUpiAmount(Math.round(total - cash).toFixed(0));
        } else if (upi > 0 && upi < total) {
          setCashAmount(Math.round(total - upi).toFixed(0));
        } else if (card > 0 && card < total) {
          setCashAmount(Math.round(total - card).toFixed(0));
        }
      }
    }
  }, [cashAmount, upiAmount, cardAmount, selectedPayment, grandTotal]);

  // Helper to determine if a product is a GST product
  const isGstProduct = useCallback((product: any) => {
    return Boolean(
      product?.gstEnabled === true ||
      (product?.taxPercent !== undefined && Number(product?.taxPercent) > 0)
    );
  }, []);

  // Client-side filter products based on search and sales mode (Regular Sales vs GST Sales)
  const filteredProducts = useMemo(() => {
    const q = searchText.toLowerCase().trim();
    return products.filter((product: any) => {
      // In GST Sales mode (gstEnabled is true): show only GST products
      // In Regular Sales mode (gstEnabled is false): show only Non-GST products
      if (entryType === 'product') {
        const isGst = isGstProduct(product);
        if (gstEnabled && !isGst) return false;
        if (!gstEnabled && isGst) return false;
      }

      if (!q) return true;

      return (
        product.name?.toLowerCase().includes(q) ||
        (product.productCode && String(product.productCode).toLowerCase().includes(q)) ||
        product.brand?.toLowerCase().includes(q) ||
        (product.imei && String(product.imei).toLowerCase().includes(q))
      );
    });
  }, [products, searchText, entryType, gstEnabled, isGstProduct]);



  const selectProductForDetails = (p: { id: string; name: string; productCode?: string; brand?: string; category?: string; mrp?: number; cost?: number; baseCost?: number; price: number; quantity: number; imei?: string; hcsCode?: string; hsnCode?: string; mop?: number; taxPercent?: number; highestDiscountLimit?: number; gstEnabled?: boolean }) => {
    const productIsGst = isGstProduct(p);
    if (entryType === 'product') {
      if (!gstEnabled && productIsGst) {
        showError(`"${p.name}" is a GST product. Please switch to GST Sales to bill this product.`);
        return;
      }
      if (gstEnabled && !productIsGst) {
        showError(`"${p.name}" is a non-GST product. Please switch to regular Sales to bill this product.`);
        return;
      }
    }

    setSelectedProductInfo({ id: p.id, name: p.name, productCode: p.productCode, brand: p.brand, category: p.category, mrp: p.mrp, cost: p.cost, baseCost: p.baseCost, price: p.price, quantity: p.quantity, imei: p.imei, hsnCode: p.hcsCode || p.hsnCode, mop: p.mop, taxPercent: p.taxPercent, highestDiscountLimit: p.highestDiscountLimit, gstEnabled: p.gstEnabled });

    const effectiveRate = (p.taxPercent && p.taxPercent > 0) ? p.taxPercent : (gstRate || 18);
    setSelectedTaxRate(effectiveRate);

    // Auto tax logic: enable GST if user is in GST mode
    if (gstEnabled) {
      setSelectedGstEnabled(true);
      if (p.taxPercent && p.taxPercent > 0) {
        setGstRate(p.taxPercent);
      }
    } else {
      setSelectedGstEnabled(false);
    }

    // Use cost as selling price for credit entries, otherwise default to MOP or price
    const initialSelling = entryType === 'credit' && typeof p.cost === 'number'
      ? p.cost
      : (p.mop && p.mop > 0 ? p.mop : (p.mrp && p.mrp > 0 ? p.mrp : p.price));
    setSelectedSelling(initialSelling);
    const baseP = p.mop && p.mop > 0 ? p.mop : (p.mrp && p.mrp > 0 ? p.mrp : p.price);
    setSelectedUnitDiscount(baseP > 0 ? parseFloat((Math.max(0, baseP - initialSelling) / baseP * 100).toFixed(2)) : 0);
    setSelectedCost(typeof p.cost === 'number' ? p.cost : '');
    setSelectedQty(1);
    setShowSearchDropdown(false);
    // Focus Selling Price field after short delay to allow render
    setTimeout(() => {
      sellingRef.current?.focus();
    }, 100);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent, field: 'cost' | 'mrp' | 'selling' | 'qty') => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (field === 'selling') qtyRef.current?.focus();
      if (field === 'qty') addBtnRef.current?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (field === 'qty') sellingRef.current?.focus();
      // Logic for cost/mrp navigation removed as they are disabled
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'selling') {
        qtyRef.current?.focus();
      } else if (field === 'qty') {
        addBtnRef.current?.focus();
      }
    }
  };

  // Fetch shop details and customers on mount
  useEffect(() => {
    const fetchShopDetails = async () => {
      try {
        const resolved = await resolveShopDetails(currentStore);
        if (resolved && resolved.shopName) {
          setShopDetails(resolved);
          return;
        }
        const shopDetailsRef = getDocRef('settings', 'shopDetails');
        const shopDetailsSnap = await getDoc(shopDetailsRef);

        if (shopDetailsSnap.exists()) {
          setShopDetails(shopDetailsSnap.data() as ShopDetails);
        }
      } catch (error) {
        console.error('Error fetching shop details:', error);
      }
    };

    const fetchCustomers = async () => {
      try {
        setLoadingCustomers(true);
        const customersRef = getCollectionRef('customers');
        const q = query(customersRef, orderBy('createdAt', 'desc'), limit(100));
        const querySnapshot = await getDocs(q);

        const customersList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name || '',
          phone: doc.data().phone || '',
          email: doc.data().email || '',
          gstNo: doc.data().gstNo || '',
          address: doc.data().address || '',
        }));

        setCustomers(customersList);
      } catch (error) {
        console.error('Error fetching customers:', error);
        // If collection doesn't exist yet, silently continue
      } finally {
        setLoadingCustomers(false);
      }
    }

    const fetchCreditCustomers = async () => {
      try {
        setLoadingCreditCustomers(true);
        const creditCustomersRef = getCollectionRef('creditCustomers');
        const q = query(creditCustomersRef, orderBy('createdAt', 'desc'), limit(100));
        const querySnapshot = await getDocs(q);

        const creditCustomersList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name || '',
          phone: doc.data().phone || '',
          email: doc.data().email || '',
        }));

        setCreditCustomers(creditCustomersList);
      } catch (error) {
        console.error('Error fetching credit customers:', error);
        // If collection doesn't exist yet, silently continue
      } finally {
        setLoadingCreditCustomers(false);
      }
    };

    const fetchSalesEmployees = async () => {
      if (!canSelectSalesPerson) {
        setSalesEmployees([]);
        setSelectedSalesPersonId(currentUser?.uid || '');
        setSelectedSalesPersonName(fallbackSalesPersonName);
        return;
      }

      try {
        setLoadingSalesEmployees(true);
        const usersRef = getCollectionRef('users');
        // Fetch all users and filter client-side so we include any user who can be a salesperson
        const usersQuery = query(usersRef);
        const usersSnapshot = await getDocs(usersQuery);

        const activeEmployees = usersSnapshot.docs
          .map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              name: data.name || data.displayName || data.email || 'Employee',
              email: data.email || '',
              role: data.role || 'employee',
              isActive: data.isActive,
              storeId: data.storeId || '',
              branchId: data.branchId || '',
              storeName: data.storeName || '',
            };
          })
          // Only show employees assigned strictly to the current branch
          .filter(emp => isEmployeeOfBranch(emp, currentStore))
          .map(({ id, name, email }) => ({ id, name, email }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setSalesEmployees(activeEmployees);

        setSelectedSalesPersonId(prevId => {
          // If a salesperson is already selected and exists in the active employees list, preserve it
          if (prevId) {
            const selected = activeEmployees.find(emp => emp.id === prevId);
            if (selected) {
              setSelectedSalesPersonName(selected.name);
            }
            return prevId;
          }

          // Otherwise default to the logged-in user if they are in the active sales employees list
          const currentEmp = activeEmployees.find(emp => emp.id === currentUser?.uid);
          if (currentEmp) {
            setSelectedSalesPersonName(currentEmp.name);
            return currentEmp.id;
          }

          // Otherwise default to the first employee
          if (activeEmployees.length > 0) {
            setSelectedSalesPersonName(activeEmployees[0].name);
            return activeEmployees[0].id;
          }

          setSelectedSalesPersonName(fallbackSalesPersonName);
          return currentUser?.uid || '';
        });
      } catch (error) {
        console.error('Error fetching sales employees:', error);
        setSelectedSalesPersonId(prevId => prevId || currentUser?.uid || '');
        setSelectedSalesPersonName(prevName => prevName || fallbackSalesPersonName);
      } finally {
        setLoadingSalesEmployees(false);
      }
    };

    const fetchFinanceProviders = async () => {
      try {
        setLoadingFinance(true);
        const q = query(collection(db, 'financeProviders'), orderBy('name', 'asc'));
        const snapshot = await getDocs(q);
        setFinanceProviders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error('Error fetching finance providers:', error);
      } finally {
        setLoadingFinance(false);
      }
    };

    fetchShopDetails();
    fetchCustomers();
    fetchCreditCustomers();
    fetchSalesEmployees();
    fetchFinanceProviders();
  }, [currentStore?.id, assignedStoreId, canSelectSalesPerson, currentUser?.uid, fallbackSalesPersonName, getCollectionRef, getDocRef]);

  // Generate QR code when UPI payment is selected
  useEffect(() => {
    const generateQR = async () => {
      if (selectedPayment === 'upi' && grandTotal > 0 && shopDetails?.upiId) {
        try {
          const qrCode = await generateUPIQRCode({
            upiId: shopDetails.upiId,
            merchantName: shopDetails.merchantName || shopDetails.shopName,
            amount: grandTotal,
            transactionNote: `Payment to ${shopDetails.shopName}`
          });
          setUpiQrCode(qrCode);
        } catch (error) {
          console.error('Error generating UPI QR code:', error);
        }
      } else {
        setUpiQrCode('');
      }
    };

    generateQR();
  }, [selectedPayment, grandTotal, shopDetails]);

  // Automatically send to display when UPI is selected
  useEffect(() => {
    const sendToDisplay = async () => {
      if (isEditMode) return;
      if (selectedPayment === 'upi' && grandTotal > 0 && orderItems.length > 0) {
        try {
          // Mark existing active requests as completed
          const q = query(
            getCollectionRef('paymentRequests'),
            orderBy('createdAt', 'desc'),
            limit(20)
          );
          const snapshot = await getDocs(q);
          const activeRequests = snapshot.docs.filter(doc => doc.data().status === 'active');
          const updatePromises = activeRequests.map(doc =>
            updateDoc(doc.ref, { status: 'completed' })
          );
          await Promise.all(updatePromises);

          // Create new payment request with product details
          const expiryTime = new Date();
          expiryTime.setSeconds(expiryTime.getSeconds() + 60);

          await addDoc(getCollectionRef('paymentRequests'), {
            amount: grandTotal,
            status: 'active',
            createdAt: Timestamp.now(),
            expiresAt: expiryTime,
            createdBy: currentUser?.uid,
            createdByName: currentUser?.displayName || currentUser?.name || currentUser?.email,
            products: orderItems.map(item => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
              total: item.price * item.quantity
            }))
          });

          console.log('Payment request sent to display');
        } catch (error) {
          console.error('Error sending to display:', error);
        }
      }
    };

    sendToDisplay();
  }, [selectedPayment, grandTotal, orderItems, currentUser, isEditMode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('#billing-search-input') && !target.closest('.billing-search-dropdown')) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-focus customer search input when dialog opens and reset pagination
  useEffect(() => {
    if (customerSearchOpen) {
      setCustomerSearchPage(1);
      setCustomerQuery('');
      // Delay focus to ensure the input is rendered
      setTimeout(() => {
        customerSearchInputRef.current?.focus();
      }, 100);
    }
  }, [customerSearchOpen]);



  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSearchDropdown) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev =>
        prev < filteredProducts.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredProducts.length) {
        const p = filteredProducts[selectedIndex] as any;
        selectProductForDetails({
          id: p.id,
          name: p.name,
          productCode: p.productCode,
          brand: p.brand,
          category: p.category,
          mrp: Number(p.mrp ?? 0),
          cost: Number(p.cost ?? 0),
          baseCost: Number(p.baseCost ?? p.cost ?? 0),
          price: Number(p.sellingPrice ?? p.mrp ?? p.price ?? 0),
          quantity: Number(p.quantity ?? 0),
          imei: p.imei || undefined,
          hsnCode: p.hsnCode || p.hcsCode || undefined,
          mop: p.mop,
          taxPercent: p.taxPercent,
          gstEnabled: p.gstEnabled,
          highestDiscountLimit: p.highestDiscountLimit
        });
      }
    }
  };


  // Save current order as billing item, with inventory updates similar to AddEntry
  const saveOrder = async () => {
    if (isSaving) return;
    try {
      // Validate based on entry type
      if (entryType === 'product') {
        if (orderItems.length === 0) {
          showError('No items in order to save!');
          return;
        }
      }
      if (entryType === 'service') {
        // Service can be saved either via form OR via orderItems
        const hasServiceForm = serviceTitle.trim() && typeof selectedSelling === 'number' && selectedSelling > 0;
        const hasOrderItems = orderItems.length > 0;

        if (!hasServiceForm && !hasOrderItems) {
          showError('Please enter service details or add items to order!');
          return;
        }
      }
      if (entryType === 'credit') {
        // Fixed customer: Talk and Walk for credit sales as requested
        if (orderItems.length === 0) {
          showError('Add at least one item to credit sale');
          return;
        }
      }

      // Validate split payment when selected (applies to product, service, and credit like BillingForm)
      if (selectedPayment === 'split') {
        const total = Number(grandTotal) || 0;
        const cash = parseFloat(cashAmount) || 0;
        const upi = parseFloat(upiAmount) || 0;
        const card = parseFloat(cardAmount) || 0;
        const splitTotal = cash + upi + card;

        if (Math.abs(splitTotal - total) > 0.01) {
          showError(`Split payment total (₹${splitTotal.toFixed(2)}) must equal the total amount (₹${total.toFixed(2)})`);
          return;
        }
        if (cash < 0 || upi < 0 || card < 0) {
          showError('Payment amounts cannot be negative');
          return;
        }
      }

      if (selectedPayment === 'finance') {
        const total = Number(grandTotal) || 0;
        const downPayment = parseFloat(financeDownPayment) || 0;
        const processingFee = financeProcessingFeeAmount;

        if (!financeProvider.trim()) {
          showError('Please enter finance provider name');
          return;
        }

        if (typeof financeTenureMonths !== 'number' || !Number.isInteger(financeTenureMonths) || financeTenureMonths <= 0) {
          showError('Please enter a valid tenure in months');
          return;
        }

        if (downPayment < 0) {
          showError('Down payment cannot be negative');
          return;
        }

        if (downPayment >= total) {
          showError('Down payment must be less than grand total for EMI payment');
          return;
        }

        if (processingFee < 0) {
          showError('Processing fee cannot be negative');
          return;
        }
      }
      setIsSaving(true);
      const displayName = currentUser?.displayName || currentUser?.email || 'Unknown User';
      const salesPersonData = {
        salesPersonId: resolvedSalesPersonId,
        salesPersonName: resolvedSalesPersonName,
      };

      // Generate transaction id for new bills, preserve id for edit mode.
      // Use the selected billing date for the date code and preserve real time
      const now = new Date();
      const billingParts = billingDate.split('-');
      let hours = now.getHours();
      let minutes = now.getMinutes();
      let seconds = now.getSeconds();
      let ms = now.getMilliseconds();

      if (isEditMode && editCreatedAtRef.current) {
        const orig = editCreatedAtRef.current;
        const origDateStr = `${orig.getFullYear()}-${String(orig.getMonth() + 1).padStart(2, '0')}-${String(orig.getDate()).padStart(2, '0')}`;
        if (origDateStr === billingDate && (orig.getHours() !== 0 || orig.getMinutes() !== 0)) {
          hours = orig.getHours();
          minutes = orig.getMinutes();
          seconds = orig.getSeconds();
          ms = orig.getMilliseconds();
        }
      }

      const date = new Date(
        Number(billingParts[0]),
        Number(billingParts[1]) - 1,
        Number(billingParts[2]),
        hours,
        minutes,
        seconds,
        ms
      );
      const invoiceTimeString = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      // Build 6-digit date code: DDMMYY
      const dd = String(date.getDate()).padStart(2, '0');
      const mmCode = String(date.getMonth() + 1).padStart(2, '0');
      const yyCode = String(date.getFullYear() % 100).padStart(2, '0');
      const dateCode = `${dd}${mmCode}${yyCode}`;

      // Build fiscal label for GST invoice format (e.g. 2026-2027)
      // Indian Financial Year runs from April 1 to March 31
      const invoiceMonth = date.getMonth(); // 0 = Jan, 1 = Feb, 2 = Mar, 3 = Apr, ...
      const fiscalStartYear = invoiceMonth >= 3 ? date.getFullYear() : date.getFullYear() - 1;
      const fiscalEndYear = fiscalStartYear + 1;
      const gstFiscalYear = `${fiscalStartYear}-${fiscalEndYear}`; // e.g. "2026-2027"

      let generatedTransactionId = '';

      // Use atomic Firestore transaction to guarantee unique sequential invoice numbers.
      // Counter document lives at: stores/{storeId}/counters/invoiceCounter
      if (!isEditMode) {
        const counterDocRef = getDocRef('counters', 'invoiceCounter');

        // Bootstrap: if counter doc doesn't exist yet or is missing a counter, initialize from existing data
        const counterCheck = await getDoc(counterDocRef);
        const counterDataSnapshot = counterCheck.exists() ? counterCheck.data() : null;

        if (!counterCheck.exists() || counterDataSnapshot?.nextGstInvoiceNumber === undefined || counterDataSnapshot?.nextInvoiceNumber === undefined) {
          try {
            const allTxSnap = await getDocs(getCollectionRef('transactions'));
            let maxNormal = counterDataSnapshot?.nextInvoiceNumber ? (counterDataSnapshot.nextInvoiceNumber - 1) : 0;
            let maxGst = counterDataSnapshot?.nextGstInvoiceNumber ? (counterDataSnapshot.nextGstInvoiceNumber - 1) : 0;

            allTxSnap.forEach(txDoc => {
              const data = txDoc.data();
              const txId = (data.transactionId as string) || '';
              const isGst = Boolean(data.gstEnabled || (data.gstRate !== undefined && data.gstRate > 0) || (data.gstAmount !== undefined && data.gstAmount > 0));

              if (!txId) return;
              const slashIdx = txId.indexOf('/');
              if (slashIdx > 0) {
                const beforeSlash = txId.substring(0, slashIdx).trim();
                const afterSlash = txId.substring(slashIdx + 1).trim();

                // Pattern A: New GST format "2026-2027/0001" (YYYY-YYYY/NNNN)
                if (/^\d{4}-\d{4}$/.test(beforeSlash)) {
                  const num = parseInt(afterSlash, 10);
                  if (!isNaN(num)) maxGst = Math.max(maxGst, num);
                }
                // Pattern B: Old GST format "0010/26-27" (NNNN/YY-YY)
                else if (/^\d{2}-\d{2}$/.test(afterSlash)) {
                  const num = parseInt(beforeSlash, 10);
                  if (!isNaN(num)) maxGst = Math.max(maxGst, num);
                }
                // Pattern C: Non-GST format "DDMMYY/NNNN" (6 digits / NNNN)
                else if (/^\d{6}$/.test(beforeSlash)) {
                  const num = parseInt(afterSlash, 10);
                  if (!isNaN(num)) {
                    if (isGst) maxGst = Math.max(maxGst, num);
                    else maxNormal = Math.max(maxNormal, num);
                  }
                } else {
                  // Fallback
                  const num = parseInt(beforeSlash, 10);
                  if (!isNaN(num)) {
                    if (isGst) maxGst = Math.max(maxGst, num);
                    else maxNormal = Math.max(maxNormal, num);
                  }
                }
              }
            });

            await setDoc(counterDocRef, {
              nextInvoiceNumber: maxNormal + 1,
              nextGstInvoiceNumber: maxGst + 1,
              gstFiscalYear: gstFiscalYear,
              lastUpdated: Timestamp.now(),
              bootstrappedAt: Timestamp.now(),
            }, { merge: true });
          } catch (bootstrapErr) {
            console.error('Counter bootstrap failed, starting from 1:', bootstrapErr);
            await setDoc(counterDocRef, {
              nextInvoiceNumber: 1,
              nextGstInvoiceNumber: 1,
              gstFiscalYear: gstFiscalYear,
              lastUpdated: Timestamp.now(),
            }, { merge: true });
          }
        }

        // Atomically read-increment-write the counter inside a Firestore transaction
        generatedTransactionId = await runTransaction(db, async (transaction) => {
          const counterDoc = await transaction.get(counterDocRef);
          const counterData = counterDoc.exists() ? counterDoc.data() : { nextInvoiceNumber: 1, nextGstInvoiceNumber: 1 };

          if (gstEnabled) {
            // Check fiscal year rollover: if a new financial year starts, reset GST sequence to 1
            const storedFiscal = counterData.gstFiscalYear;
            let currentNumber = counterData.nextGstInvoiceNumber || 1;
            if (storedFiscal && storedFiscal !== gstFiscalYear) {
              currentNumber = 1;
            }
            const paddedOrder = String(currentNumber).padStart(4, '0');
            const newTransactionId = `${gstFiscalYear}/${paddedOrder}`;

            transaction.set(counterDocRef, {
              nextGstInvoiceNumber: currentNumber + 1,
              gstFiscalYear: gstFiscalYear,
              lastUpdated: Timestamp.now(),
            }, { merge: true });

            return newTransactionId;
          } else {
            const currentNumber = counterData.nextInvoiceNumber || 1;
            const paddedOrder = String(currentNumber).padStart(4, '0');
            const newTransactionId = `${dateCode}/${paddedOrder}`;

            transaction.set(counterDocRef, {
              nextInvoiceNumber: currentNumber + 1,
              lastUpdated: Timestamp.now(),
            }, { merge: true });

            return newTransactionId;
          }
        });
      }

      const transactionId = isEditMode
        ? (editTransactionId || routeTransactionId || generatedTransactionId)
        : generatedTransactionId;
      const targetCollection = entryType === 'credit' ? 'creditSales' : 'billingItems';

      // For product and credit entries, validate inventory using local Delta-Sync cache first (0 extra reads)
      const productsWithCost: Array<{ item: Product; productCost: number; matchedDocId: string; currentQty: number }> = [];

      if (!isEditMode && (entryType === 'product' || entryType === 'credit')) {
        for (const item of orderItems) {
          // Skip service items (they don't have inventory)
          if (item.code === 'SERVICE') {
            continue;
          }

          let matchedDocId: string | null = null;
          let currentQty = 0;
          let productCost = 0;

          const applyMatchedProduct = (id: string, data: { quantity?: unknown; cost?: unknown }) => {
            matchedDocId = id;
            currentQty = Number(data.quantity || 0);
            productCost = Number(data.cost || 0);
          };

          // 1. Check local Delta-Synced products array first (0 Firestore reads!)
          const localMatch =
            (item.id ? products.find((p: any) => p.id === item.id) : undefined) ||
            (item.imei ? products.find((p: any) => p.imei === item.imei) : undefined) ||
            (item.code ? products.find((p: any) => p.productCode === item.code) : undefined) ||
            products.find((p: any) => p.name === item.name && Number(p.quantity || 0) >= item.quantity) ||
            products.find((p: any) => p.name === item.name);

          if (localMatch && localMatch.id) {
            applyMatchedProduct(localMatch.id, localMatch);
          }

          // 2. Fallback to Firestore only if not found in local catalog
          if (!matchedDocId && item.id) {
            const selectedProductDoc = await getDoc(getDocRef('products', item.id));
            if (selectedProductDoc?.exists()) {
              applyMatchedProduct(selectedProductDoc.id, selectedProductDoc.data());
            }
          }

          if (!matchedDocId && item.imei) {
            const productByImei = query(getCollectionRef('products'), where('imei', '==', item.imei));
            const byImeiSnap = await getDocs(productByImei);
            if (!byImeiSnap.empty) {
              const d = byImeiSnap.docs[0];
              applyMatchedProduct(d.id, d.data());
            }
          }

          if (!matchedDocId && item.code) {
            const productByCode = query(getCollectionRef('products'), where('productCode', '==', item.code));
            const byCodeSnap = await getDocs(productByCode);
            if (!byCodeSnap.empty) {
              const d = byCodeSnap.docs[0];
              applyMatchedProduct(d.id, d.data());
            }
          }

          if (!matchedDocId) {
            const productByName = query(getCollectionRef('products'), where('name', '==', item.name));
            const byNameSnap = await getDocs(productByName);
            const inStockMatch = byNameSnap.docs.find(d => Number(d.data().quantity || 0) >= item.quantity);
            const d = inStockMatch || byNameSnap.docs[0];
            if (d) {
              applyMatchedProduct(d.id, d.data());
            }
          }

          if (matchedDocId) {
            if (currentQty < item.quantity) {
              const productRef = item.code ? ` (${item.code}${item.imei ? ` / ${item.imei}` : ''})` : item.imei ? ` (${item.imei})` : '';
              showError(`Insufficient stock for ${item.name}${productRef}. Available: ${currentQty}`);
              return;
            }
            productsWithCost.push({ item, productCost, matchedDocId, currentQty });
          }
        }
      }

      // Build common payment data
      const paymentSplit = selectedPayment === 'split'
        ? {
          cash: parseFloat(cashAmount) || 0,
          upi: parseFloat(upiAmount) || 0,
          card: parseFloat(cardAmount) || 0,
        }
        : undefined;
      const paymentFinance = selectedPayment === 'finance'
        ? {
          financeProvider: financeProvider.trim(),
          financeTenureMonths: Number(financeTenureMonths) || 0,
          financeDownPayment: parseFloat(financeDownPayment) || 0,
          processingFee: financeProcessingFeeAmount,
          financeAmount: Math.max(0, (Number(grandTotal) || 0) - (parseFloat(financeDownPayment) || 0)),
          monthlyEmi: (Number(financeTenureMonths) || 0) > 0
            ? Math.round(Math.max(0, (Number(grandTotal) || 0) - (parseFloat(financeDownPayment) || 0)) / (Number(financeTenureMonths) || 1))
            : 0,
        }
        : undefined;

      // Build customer data to store
      // Extract customer details from the display string
      let dbCustomerName = customerDisplay;
      let dbCustomerPhone = '';
      let dbCustomerEmail = '';
      let dbCustomerGstNo = '';
      let dbCustomerAddress = '';

      if (customerDisplay !== 'Walk In Customer') {
        const parsedCustomer = parseCustomerDisplay(customerDisplay);
        dbCustomerName = parsedCustomer.name;
        dbCustomerPhone = parsedCustomer.phone;
        dbCustomerEmail = parsedCustomer.email;
        dbCustomerGstNo = parsedCustomer.gstNo;
        dbCustomerAddress = parsedCustomer.address || '';
      }

      const customerData = customerDisplay !== 'Walk In Customer'
        ? {
          customerName: dbCustomerName,
          customerPhone: dbCustomerPhone,
          customerEmail: dbCustomerEmail,
          customerGstNo: dbCustomerGstNo,
          customerAddress: dbCustomerAddress,
          customerDetails: customerDisplay // Store full customer info
        }
        : {
          customerName: 'Walk In Customer',
          customerPhone: 'N/A'
        };

      // Build discount data to store
      const discountData = discountValue > 0
        ? {
          discountType: discountType,
          discountValue: discountValue,
          discountAmount: discount,
        }
        : {};

      // Build GST data to store
      const isAnyGst = gstEnabled || gstAmount > 0;
      const gstData = isAnyGst
        ? {
          gstEnabled: true,
          gstRate: gstRate,
          gstAmount: gstAmount,
          baseAmount: baseAmount,
        }
        : {
          gstEnabled: false,
        };

      // Build transaction summary data
      // Note: Must be built AFTER potentially adding service to orderItems above
      const transactionSummary = {
        transactionId,
        subtotal: subTotal,
        discount: discount,
        totalAfterDiscount: totalAfterDiscount,
        roundOff: roundOffAmount,
        grandTotal: grandTotal,
        itemsCount: orderItems.length, // Now accurate for all types since service is added to orderItems
        createdAt: Timestamp.fromDate(date),
        invoiceTime: invoiceTimeString,
        createdBy: displayName,
        createdByName: displayName,
        paymentMode: selectedPayment,
        shopName: shopDetails?.shopName,
        shopAddress: shopDetails?.address,
        shopPhone: shopDetails?.phone,
        shopEmail: shopDetails?.email,
        shopGst: shopDetails?.gst,
        ...salesPersonData,
        ...customerData,
        ...discountData,
        ...gstData,
        ...(paymentSplit ? { paymentSplit } : {}),
        ...(paymentFinance ? paymentFinance : {}),
        ...(selectedPayment === 'finance' ? { processingFee: financeProcessingFeeAmount } : {}),
        ...(entryType === 'credit' ? {
          creditCustomerName: creditCustomerDisplay,

          isCreditSale: true
        } : {}),
        items: orderItems, // Save detailed items list for invoice generation
      };

      const batch = writeBatch(db);
      const todayKey = billingDate || new Date().toISOString().split('T')[0];

      if (isEditMode && existingBillDocs.length > 0) {
        existingBillDocs.forEach((docInfo) => {
          batch.delete(getDocRef(docInfo.collection, docInfo.id));
        });
      }

      const savedItems: BillingItem[] = [];

      // If in service mode with form filled but orderItems empty, add service to orderItems
      if (entryType === 'service' && serviceTitle.trim() && typeof selectedSelling === 'number' && selectedSelling > 0 && orderItems.length === 0) {
        const serviceQty = typeof selectedQty === 'number' && selectedQty > 0 ? selectedQty : 1;
        const serviceItem: Product = {
          id: `service-${Date.now()}`,
          name: serviceTitle.trim(),
          code: 'SERVICE',
          price: selectedSelling,
          quantity: serviceQty,
          stock: 999999,
          cost: typeof selectedCost === 'number' ? selectedCost : 0, // Include service cost
        };
        orderItems.push(serviceItem);
      }

      // Product, Service, or Credit: save each item separately with shared transaction info
      const totalItems = orderItems.length;

      // Calculate proportional discount and payment for each item
      for (let i = 0; i < orderItems.length; i++) {
        const item = orderItems[i];
        const productCostData = productsWithCost.find(p => p.item.id === item.id);
        // Use item.cost if available (for services), otherwise use cost from inventory lookup
        const productCost = item.cost !== undefined ? item.cost : (productCostData?.productCost || 0);

        const itemSubtotal = item.price * item.quantity;
        const itemProportion = subTotal > 0 ? itemSubtotal / subTotal : 1 / totalItems;
        const itemDiscount = Math.round(discount * itemProportion);
        const itemTotalAfterDiscount = itemSubtotal - itemDiscount;

        const itemGstOn = item.gstEnabled !== undefined ? item.gstEnabled : gstEnabled;
        const itemTaxRate = (item.taxPercent !== undefined && item.taxPercent !== null && item.taxPercent > 0)
          ? item.taxPercent
          : gstRate;
        const itemGstAmount = itemGstOn
          ? Math.round(itemTotalAfterDiscount - (itemTotalAfterDiscount / (1 + itemTaxRate / 100)))
          : 0;
        const itemProfit = itemTotalAfterDiscount - (productCost * item.quantity);

        // Proportional split payment amounts
        const itemPaymentSplit = selectedPayment === 'split' && paymentSplit
          ? {
            cash: Math.round(paymentSplit.cash * itemProportion),
            upi: Math.round(paymentSplit.upi * itemProportion),
            card: Math.round(paymentSplit.card * itemProportion),
          }
          : undefined;
        const itemPaymentFinance = selectedPayment === 'finance' && paymentFinance
          ? {
            financeProvider: paymentFinance.financeProvider,
            financeTenureMonths: paymentFinance.financeTenureMonths,
            financeDownPayment: Math.round(paymentFinance.financeDownPayment * itemProportion),
            processingFee: Math.round((paymentFinance.processingFee || 0) * itemProportion),
            financeAmount: Math.round(paymentFinance.financeAmount * itemProportion),
            monthlyEmi: paymentFinance.financeTenureMonths > 0
              ? Math.round((paymentFinance.financeAmount * itemProportion) / paymentFinance.financeTenureMonths)
              : 0,
          }
          : undefined;

        const billingItemData: Omit<BillingItemWithTransaction, 'id'> = {
          title: item.name,
          cost: productCost,
          sellingPrice: item.price,
          profit: itemProfit / item.quantity,
          quantity: item.quantity,
          totalProfit: itemProfit,
          ...(item.imei ? { imei: item.imei } : {}),
          ...(item.hsnCode ? { hsnCode: item.hsnCode } : {}),
          paymentMode: selectedPayment as any,
          gstRate: itemGstOn ? itemTaxRate : 0,
          gstAmount: itemGstAmount,
          gstEnabled: itemGstOn,
          totalWithGst: itemTotalAfterDiscount,
          type: entryType,
          createdAt: date,
          invoiceTime: invoiceTimeString,
          createdBy: displayName,
          createdByName: displayName,
          transactionId,
          itemNumber: i + 1,
          totalItems,
          itemDiscount: itemDiscount,
          itemSubtotal: itemSubtotal,
          brand: item.brand || '',
          category: item.category || '',
          roundOff: roundOffAmount,
          grandTotal: grandTotal,
          subtotal: subTotal,
          ...(currentStore?.id ? { storeId: currentStore.id } : {}),
          ...salesPersonData,
          ...customerData,
          ...discountData,
          ...(itemPaymentSplit ? { paymentSplit: itemPaymentSplit } : {}),
          ...(itemPaymentFinance ? itemPaymentFinance : {}),
          ...(selectedPayment === 'finance' ? { processingFee: financeProcessingFeeAmount } : {}),
          ...(entryType === 'credit'
            ? {
              creditCustomerName: creditCustomerDisplay,
              isPaid: false,
              paidAmount: 0,
              remainingAmount: totalItems === 1
                ? grandTotal
                : (i === totalItems - 1
                  ? Math.max(0, Number((grandTotal - (orderItems.slice(0, i).reduce((sum, it) => sum + (it.price * it.quantity - Math.round(discount * (subTotal > 0 ? (it.price * it.quantity) / subTotal : 1 / totalItems))), 0))).toFixed(2)))
                  : itemTotalAfterDiscount),
              customerName: creditCustomerDisplay,
            }
            : {}),
        };

        const billRef = doc(getCollectionRef(targetCollection));
        batch.set(billRef, {
          ...billingItemData,
          ...(currentStore?.name ? { storeName: currentStore.name } : {}),
          createdAt: Timestamp.fromDate(date),
          updatedAt: serverTimestamp(),
        });

        savedItems.push({ ...billingItemData, id: billRef.id });
      }

      // 2. Decrement product quantities & update 'updatedAt' for delta sync
      let totalItemsSold = 0;
      if (!isEditMode && productsWithCost.length > 0) {
        for (const { item, matchedDocId, currentQty } of productsWithCost) {
          const newQty = currentQty - item.quantity;
          const productRef = getDocRef('products', matchedDocId);
          batch.update(productRef, {
            quantity: increment(-item.quantity),
            isAvailable: newQty > 0,
            updatedAt: serverTimestamp(),
          });
          totalItemsSold += Number(item.quantity);
        }
      }

      const totalOrderUnits =
        totalItemsSold > 0
          ? totalItemsSold
          : orderItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

      if (!isEditMode && currentStore?.id) {
        // 3. Update Head Office Daily Summary document (1 document per branch per day)
        const hoDailyRef = doc(db, 'overallSales', `${todayKey}_${currentStore.id}`);
        batch.set(
          hoDailyRef,
          {
            storeId: currentStore.id,
            storeName: currentStore.name,
            date: todayKey,
            totalRevenue: increment(Number(grandTotal) || 0),
            totalBills: increment(1),
            totalItemsSold: increment(totalOrderUnits),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        // 4. Update cumulative store counters on stores/{storeId}
        const storeRef = doc(db, 'stores', currentStore.id);
        batch.set(
          storeRef,
          {
            lifetimeRevenue: increment(Number(grandTotal) || 0),
            lifetimeBills: increment(1),
            ...(totalItemsSold > 0 ? { totalStockUnits: increment(-totalItemsSold) } : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // Save transaction summary to root collection (for public customer view-bill)
      // and to store-scoped collection (for multi-store reporting)
      const safeDocId = transactionId.replace(/\//g, '_');
      batch.set(doc(db, 'transactions', safeDocId), transactionSummary);
      if (currentStore?.id) {
        batch.set(getDocRef('transactions', safeDocId), transactionSummary);
      }

      await batch.commit();

      // 5. Update local IndexedDB cache immediately (0 Firestore reads!)
      if (!isEditMode && productsWithCost.length > 0) {
        await updateLocalProductQuantities(
          currentStore?.id,
          productsWithCost.map(({ item, matchedDocId }) => ({
            productId: matchedDocId,
            quantityDelta: -item.quantity,
          }))
        );
        invalidateProducts();
      }
      if (entryType === 'credit') {
        invalidateCreditSales();
      } else {
        invalidateBillingItems();
      }

      // Store comprehensive item for download/print/share
      // We create a virtual billing item that acts as a container for the whole transaction
      const savedItem: BillingItem = {
        id: transactionId,
        title: `Transactions`, // Generic title, items array will be used
        cost: 0,
        sellingPrice: grandTotal, // Final total
        profit: 0,
        quantity: orderItems.length,
        totalProfit: 0,
        paymentMode: selectedPayment as any,
        gstRate: isAnyGst ? gstRate : 0,
        gstAmount: gstAmount,
        totalWithGst: grandTotal,
        type: entryType,
        createdAt: date,
        invoiceTime: invoiceTimeString,
        createdBy: displayName,
        createdByName: displayName,
        // Pass summary fields for PDF generator
        ...(transactionSummary as any),
        ...(salesPersonData as any),
        ...(selectedPayment === 'finance' ? { processingFee: financeProcessingFeeAmount } : {}),
        customerName: customerData.customerName || 'Walk In Customer',
        customerPhone: customerData.customerPhone || '',
        items: orderItems.map(item => {
          const itemGstOn = item.gstEnabled !== undefined ? item.gstEnabled : gstEnabled;
          const itemTaxRate = (item.taxPercent !== undefined && item.taxPercent !== null && item.taxPercent > 0)
            ? item.taxPercent
            : gstRate;
          const itemGstAmount = itemGstOn
            ? Math.round((item.price * item.quantity) - ((item.price * item.quantity) / (1 + itemTaxRate / 100)))
            : 0;
          return {
            ...item,
            title: item.name,
            sellingPrice: item.price,
            totalWithGst: item.price * item.quantity, // Subtotal for line item
            gstEnabled: itemGstOn,
            taxPercent: itemGstOn ? itemTaxRate : 0,
            gstAmount: itemGstAmount,
          };
        })
      };
      setLastBillingItem(savedItem);



      const itemCount = savedItems.length;
      setSavedSuccessMsg(
        isEditMode
          ? 'Bill updated successfully!'
          : `${itemCount} item${itemCount > 1 ? 's' : ''} saved successfully!`
      );
      setShowBillSavedModal(true);

      if (!isEditMode) {
        // Clear state after successful save, but keep lastBillingItem for print/share/modal
        resetBillingState(true);
      }
    } catch (err) {
      console.error('Failed saving order', err);
      showError(`Failed to save order: ${err} `);
    } finally {
      setIsSaving(false);
    }
  };

  // Download invoice as PDF
  const handleDownloadInvoice = async () => {
    if (!lastBillingItem) {
      showError('Please save the order first!');
      return;
    }

    const defaultShopDetails: ShopDetails = {
      shopName: 'Your Shop Name',
      ownerName: 'Owner',
      address: 'Shop Address',
      phone: '1234567890',
      email: 'shop@example.com',
      gst: ''
    };

    await generateInvoice(lastBillingItem, shopDetails || defaultShopDetails);
  };

  // Print invoice
  const handlePrintInvoice = async () => {
    if (!lastBillingItem) {
      showError('Please save the order first!');
      return;
    }

    const defaultShopDetails: ShopDetails = {
      shopName: 'Your Shop Name',
      ownerName: 'Owner',
      address: 'Shop Address',
      phone: '1234567890',
      email: 'shop@example.com',
      gst: ''
    };

    try {
      // Generate PDF for printing - returnBlob true returns an object with pdfBlob
      const result = await generateInvoice(lastBillingItem, shopDetails || defaultShopDetails, undefined, true) as any;
      if (!result || !result.pdfBlob) {
        showError('Failed to generate invoice for printing');
        return;
      }

      // Create blob URL from the returned pdfBlob
      const pdfUrl = URL.createObjectURL(result.pdfBlob);

      // Create iframe for printing (better cross-browser support)
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      iframe.onload = () => {
        try {
          // Trigger print dialog
          iframe.contentWindow?.print();

          // Cleanup after a delay
          setTimeout(() => {
            document.body.removeChild(iframe);
            URL.revokeObjectURL(pdfUrl);
          }, 1000);
        } catch (error) {
          console.error('Print error:', error);
          showError('Failed to open print dialog');
          document.body.removeChild(iframe);
          URL.revokeObjectURL(pdfUrl);
        }
      };

      iframe.src = pdfUrl;
    } catch (error) {
      console.error('Error generating invoice for print:', error);
      showError('Failed to generate invoice for printing');
    }
  };


  // Quick WhatsApp share - bypass modal if customer info exists
  const handleQuickWhatsApp = () => {
    if (!lastBillingItem) {
      showError('Please save the order first!');
      return;
    }

    // Check if we have valid customer detailed in the item
    const hasPhone = lastBillingItem.customerPhone &&
      lastBillingItem.customerPhone.trim() !== '' &&
      lastBillingItem.customerPhone !== 'N/A';

    if (hasPhone) {
      // Direct WhatsApp Share
      const customerName = lastBillingItem.customerName || 'Customer';
      const customerPhone = lastBillingItem.customerPhone as string;
      const billId = lastBillingItem.transactionId || lastBillingItem.id || '';
      const safeId = billId.replace(/\//g, '_');
      const rawPhoneDigits = customerPhone.replace(/\D/g, '').slice(-10);
      const phoneParam = rawPhoneDigits ? `?p=${encodeURIComponent(rawPhoneDigits)}` : '';

      // Always use production URL for WhatsApp links
      const baseUrl = 'https://the-legend-mobiles.vercel.app';
      const billUrl = `${baseUrl}/view-bill/${encodeURIComponent(safeId)}${phoneParam}`;

      const messageText =
        `Hi ${customerName}! 👋\n\n` +
        `Thank you for shopping at ${shopDetails?.shopName || 'Digital Zone'}! 🛍️\n\n` +
        `You can download your invoice here:\n` +
        `${billUrl}\n\n` +
        `Thank you for your business! 🙏`;

      // Format phone number
      let formattedPhone = customerPhone.replace(/\D/g, '');
      if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;
      else if (formattedPhone.startsWith('0')) formattedPhone = '91' + formattedPhone.substring(1);

      const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(messageText)}`;

      // Open WhatsApp
      const isAndroidWebView = typeof window !== 'undefined' && (window as any).AndroidInterface;

      if (isAndroidWebView) {
        window.location.href = whatsappUrl;
      } else {
        window.open(whatsappUrl, '_blank');
      }

      success('WhatsApp opened with invoice link!');
    } else {
      // Fallback to modal to ask for details
      setShareType('whatsapp');
      setIsShareModalOpen(true);
    }
  };



  // Open share modal or native share
  const handleShareInvoice = async () => {
    if (!lastBillingItem) {
      showError('Please save the order first!');
      return;
    }

    try {
      const defaultShopDetails: ShopDetails = {
        shopName: 'Your Shop Name',
        ownerName: 'Owner',
        address: 'Shop Address',
        phone: '1234567890',
        email: 'shop@example.com',
        gst: ''
      };

      // Generate PDF Blob
      const result = await generateInvoice(lastBillingItem, shopDetails || defaultShopDetails, undefined, true) as any;

      if (result && result.pdfBlob) {
        const file = new File([result.pdfBlob], result.fileName, { type: 'application/pdf' });

        // Check for native share support with files
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'Invoice',
              text: `Invoice from ${shopDetails?.shopName || 'Shop'}`,
            });
            success('Invoice shared successfully!');
            return; // Exit if successful
          } catch (shareError) {
            // User might have cancelled the share, or other error.
            if ((shareError as Error).name !== 'AbortError') {
              console.error('Error during native share:', shareError);
              // Proceed to fallback
            } else {
              return; // User cancelled, do nothing
            }
          }
        }
      }

      // Fallback to modal if native share not supported or failed (non-cancellation)
      setIsShareModalOpen(true);

    } catch (error) {
      console.error('Error preparing share:', error);
      setIsShareModalOpen(true);
    }
  };

  // Open Razorpay Checkout for Card/Netbanking Payment
  // @ts-ignore
  const handleRazorpayPayment = async () => {
    try {
      setIsProcessingPayment(true);
      const total = Number(grandTotal) || 0;
      if (total <= 0) {
        showError('Please add items to the order first');
        return;
      }

      // Extract customer name and phone from display
      const customerInfo = customerDisplay !== 'Walk In Customer'
        ? parseCustomerDisplay(customerDisplay)
        : { name: '', phone: '', email: '', gstNo: '' };
      const customerName = customerInfo.name || '';
      const customerPhone = customerInfo.phone || '';

      await openRazorpayCheckout({
        amount: total,
        name: shopDetails?.shopName || 'Digital Zone',
        description: `Payment for ${orderItems.length || 0} items`,
        customerName,
        customerContact: customerPhone,
        notes: {
          orderItems: orderItems.length,
          totalAmount: total,
        },
        onSuccess: async (response) => {
          console.log('Payment successful:', response);
          success('Payment completed successfully! Saving order...');

          // Set payment mode to card
          setSelectedPayment('card');

          // Auto-save the order after successful payment
          try {
            await saveOrder();
            success('Order saved successfully with Razorpay payment!');
          } catch (saveError) {
            console.error('Failed to save order:', saveError);
            showError('Payment successful but failed to save order. Please save manually.');
          }
        },
        onFailure: (error) => {
          console.error('Payment failed:', error);
          showError(error.error || 'Payment failed. Please try again.');
        },
      });
    } catch (err) {
      console.error('Failed to open Razorpay checkout:', err);
      showError(`Failed to process payment: ${err} `);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F1: Focus Search
      if (e.key === 'F1') {
        e.preventDefault();
        const searchInput = document.getElementById('billing-search-input');
        if (searchInput) {
          searchInput.focus();
        }
      }

      // Ctrl+Enter: Save
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        saveOrder();
      }

      // Esc: Clear / Close
      if (e.key === 'Escape') {
        if (showSearchDropdown) {
          setShowSearchDropdown(false);
          return;
        }
        setShowSearchDropdown(false);
        setCustomerSearchOpen(false);
        setCustomerModalOpen(false);
        setCreditCustomerSearchOpen(false);
        setCreditCustomerModalOpen(false);
        setIsShareModalOpen(false);
        setSelectedCost('');
        setSelectedSelling('');
        setSelectedUnitDiscount('');
        setSelectedQty('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveOrder, showSearchDropdown]);

  if (isEditMode && isLoadingEditBill) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-gray-200 rounded-lg px-6 py-5 shadow-sm text-center">
          <p className="text-sm font-medium text-gray-900">Loading bill details...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile-optimized styles */}
      <style>{`
        @media (max-width: 768px) {
          /* Compact spacing for mobile */
          .mobile-compact {
            padding: 0.5rem !important;
          }
          .mobile-compact-section {
            margin-bottom: 0.5rem !important;
          }
          .mobile-compact-card {
            padding: 0.75rem !important;
            margin-bottom: 0.5rem !important;
          }
          .mobile-compact-input {
            padding-top: 0.5rem !important;
            padding-bottom: 0.5rem !important;
            font-size: 0.875rem !important;
          }
          .mobile-compact-heading {
            font-size: 0.875rem !important;
            margin-bottom: 0.5rem !important;
          }
        }
      `}</style>
      <div className="min-h-screen md:h-screen bg-gray-50 flex flex-col overflow-x-hidden">
        <Navbar />
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Fixed Left Sidebar - Sales / GST Billing / Service */}
          <aside className="w-full md:w-24 bg-white border-b md:border-b-0 md:border-r border-gray-200 flex flex-row md:flex-col items-center justify-center md:justify-start py-2 md:py-6 px-2 md:px-0 gap-2 md:gap-4 md:flex-shrink-0">
            <button
              className={`w-full md:w-16 flex-1 md:flex-none h-12 md:h-16 rounded-lg border-2 flex flex-col items-center justify-center transition-all active:scale-95 ${entryType === 'product' && !gstEnabled ? 'border-blue-500 text-blue-600 bg-blue-50 shadow-sm' : 'border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'}`}
              onClick={() => {
                if (entryType === 'product' && !gstEnabled) return;
                if (orderItems.length > 0 && gstEnabled) {
                  const hasGst = orderItems.some(item => isGstProduct(item));
                  if (hasGst) {
                    const ok = window.confirm('Current cart contains GST items. Switching to regular Sales will clear your cart. Continue?');
                    if (!ok) return;
                    setOrderItems([]);
                  }
                }
                setEntryType('product');
                setGstEnabled(false);
                setSelectedProductInfo(null);
                setSearchText('');
              }}
              title="Regular Non-GST Sales"
            >
              <ShoppingCart className="w-4 h-4 md:w-6 md:h-6 mb-0.5 md:mb-1" />
              <span className="text-[9px] md:text-xs font-medium">Sales</span>
            </button>
            <button
              className={`w-full md:w-16 flex-1 md:flex-none h-12 md:h-16 rounded-lg border-2 flex flex-col items-center justify-center transition-all active:scale-95 ${entryType === 'product' && gstEnabled ? 'border-emerald-500 text-emerald-700 bg-emerald-50 shadow-sm' : 'border-gray-200 text-gray-700 hover:bg-emerald-50/50 hover:border-emerald-300'}`}
              onClick={() => {
                if (entryType === 'product' && gstEnabled) return;
                if (orderItems.length > 0 && !gstEnabled) {
                  const hasNonGst = orderItems.some(item => !isGstProduct(item));
                  if (hasNonGst) {
                    const ok = window.confirm('Current cart contains non-GST items. Switching to GST Sales will clear your cart. Continue?');
                    if (!ok) return;
                    setOrderItems([]);
                  }
                }
                setEntryType('product');
                setGstEnabled(true);
                setSelectedProductInfo(null);
                setSearchText('');
              }}
              title="GST Billing (Tax Invoice)"
            >
              <Receipt className="w-4 h-4 md:w-6 md:h-6 mb-0.5 md:mb-1 text-emerald-600" />
              <span className="text-[9px] md:text-xs font-medium text-emerald-800">GST Sales</span>
            </button>
            <button
              className={`w-full md:w-16 flex-1 md:flex-none h-12 md:h-16 rounded-lg border-2 flex flex-col items-center justify-center transition-all active:scale-95 ${entryType === 'service' ? 'border-blue-500 text-blue-600 bg-blue-50 shadow-sm' : 'border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'}`}
              onClick={() => {
                setEntryType('service');
                setGstEnabled(false);
              }}
              title="Service & Repair Jobs"
            >
              <Wrench className="w-4 h-4 md:w-6 md:h-6 mb-0.5 md:mb-1" />
              <span className="text-[9px] md:text-xs font-medium">Service</span>
            </button>
            {/* <button
              className={`w-full md:w-16 flex-1 md:flex-none h-12 md:h-16 rounded-lg border-2 flex flex-col items-center justify-center transition-all active:scale-95 ${entryType === 'credit' ? 'border-blue-500 text-blue-600 bg-blue-50 shadow-sm' : 'border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'}`}
              onClick={() => setEntryType('credit')}
            >
              <CreditCard className="w-4 h-4 md:w-6 md:h-6 mb-0.5 md:mb-1" />
              <span className="text-[9px] md:text-xs font-medium">Credit</span>
            </button> */}
          </aside>

          <main className="flex-1 flex flex-col md:flex-row md:overflow-hidden">
            {/* Scrollable Center Section */}
            <section ref={scrollContainerRef} className="flex-1 mobile-compact p-3 md:p-6 pb-24 md:pb-6 md:overflow-y-auto md:h-full" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <style>{`
    section::-webkit-scrollbar {
      display: none;
    }
    `}</style>
              <div className="mb-2 md:mb-6 mobile-compact-section">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-sm sm:text-base md:text-xl lg:text-2xl font-semibold text-gray-900 truncate">
                      {isEditMode ? 'Edit Bill' : `Welcome, ${currentUser?.displayName || currentUser?.email || 'Guest'}`}
                    </h1>
                    {/* Mobile: plain text date */}
                    <p className="md:hidden text-[10px] sm:text-xs text-gray-500 mt-0.5">{formattedDate}</p>
                    {/* Desktop: editable date picker */}
                    <div className="hidden md:flex items-center gap-2 mt-1">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <input
                        type="date"
                        value={billingDate}
                        onChange={(e) => setBillingDate(e.target.value)}
                        className="text-sm text-gray-600 bg-transparent border border-gray-300 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer hover:border-blue-400 transition-colors"
                      />
                      {billingDate !== todayISO && (
                        <button
                          onClick={() => setBillingDate(todayISO)}
                          className="text-xs text-blue-600 hover:text-blue-800 underline transition-colors"
                        >
                          Reset to Today
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {entryType !== 'service' && (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 text-gray-400 pointer-events-none" />
                        {/* Desktop search input */}
                        <input
                          type="text"
                          placeholder={gstEnabled ? "Search GST Product / IMEI (F1)" : "Search Non-GST Product / IMEI (F1)"}
                          value={searchText}
                          onKeyDown={handleSearchKeyDown}
                          onChange={(e) => { setSearchText(e.target.value); setShowSearchDropdown(true); }}
                          id="billing-search-input"
                          className="hidden md:block w-48 md:w-64 pl-9 md:pl-10 pr-3 md:pr-4 py-1.5 md:py-2 mobile-compact-input bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow shadow-sm text-sm md:text-sm"
                        />
                        {/* Mobile search button */}
                        <button
                          onClick={() => setShowProductSearchModal(true)}
                          className="md:hidden w-48 pl-9 pr-3 py-1.5 mobile-compact-input bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow shadow-sm text-sm text-left text-gray-400"
                        >
                          {gstEnabled ? "Search GST / IMEI (F1)" : "Search Product / IMEI (F1)"}
                        </button>
                      </div>
                    )}
                    {entryType !== 'service' && (
                      <button
                        onClick={() => setShowQRScanner(true)}
                        className="md:hidden flex-shrink-0 p-1.5 md:p-2.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-all active:scale-95 shadow-sm group"
                        title="Scan QR Code"
                      >
                        <QrCode className="w-4 h-4 md:w-5 md:h-5 text-gray-600 group-hover:text-blue-600 transition-colors" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        navigate('/billing');
                        resetBillingState(false);
                        success('Billing page refreshed!');
                      }}
                      className="flex-shrink-0 p-1.5 md:p-2.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-all active:scale-95 shadow-sm group"
                      title="Refresh billing page"
                    >
                      <RefreshCw className="w-4 h-4 md:w-5 md:h-5 text-gray-600 group-hover:text-blue-600 transition-colors" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mb-2 md:mb-6 relative mobile-compact-section">
                {entryType !== 'service' && searchText && showSearchDropdown && (
                  <div className="billing-search-dropdown hidden md:block absolute z-20 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 md:max-h-80 overflow-auto">
                    {loadingProducts ? (
                      <div className="p-4 text-sm text-gray-500 text-center">Loading products…</div>
                    ) : filteredProducts.length === 0 ? (
                      <div className="p-4 text-sm text-gray-500 text-center">
                        {gstEnabled ? 'No GST products found' : 'No non-GST products found'}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-xs md:text-sm text-gray-600">
                          <thead className="bg-gray-50 text-[10px] md:text-xs font-semibold text-gray-700 uppercase sticky top-0 z-10 shadow-sm">
                            <tr>
                              <th className="px-2 md:px-4 py-2 md:py-3 whitespace-nowrap">Product Name</th>
                              <th className="px-2 md:px-4 py-2 md:py-3 whitespace-nowrap">IMEI</th>
                              <th className="px-2 md:px-4 py-2 md:py-3 whitespace-nowrap">Code</th>
                              <th className="px-2 md:px-4 py-2 md:py-3 whitespace-nowrap">Brand</th>
                              <th className="px-2 md:px-4 py-2 md:py-3 text-center whitespace-nowrap">Stock</th>
                              <th className="px-2 md:px-4 py-2 md:py-3 text-right whitespace-nowrap">Cost</th>
                              <th className="px-2 md:px-4 py-2 md:py-3 text-right whitespace-nowrap">MRP</th>
                              <th className="px-2 md:px-4 py-2 md:py-3 text-right whitespace-nowrap">Selling</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredProducts.map((p: any, index: number) => (
                              <tr
                                key={p.id}
                                className={`cursor-pointer transition-colors ${index === selectedIndex ? 'bg-blue-100' : 'hover:bg-gray-50'}`}
                                onClick={() => selectProductForDetails({ id: p.id, name: p.name, productCode: p.productCode, brand: p.brand, category: p.category, mrp: Number(p.mrp ?? 0), cost: Number(p.cost ?? 0), baseCost: Number(p.baseCost ?? p.cost ?? 0), price: Number(p.sellingPrice ?? p.mrp ?? p.price ?? 0), quantity: Number(p.quantity ?? 0), imei: p.imei || undefined, hsnCode: p.hsnCode || p.hcsCode || undefined, mop: p.mop, taxPercent: p.taxPercent, gstEnabled: p.gstEnabled, highestDiscountLimit: p.highestDiscountLimit })}
                              >
                                <td className="px-2 md:px-4 py-1.5 md:py-2 font-medium text-gray-900 whitespace-nowrap">
                                  {p.name}
                                  {(p.gstEnabled || (p.taxPercent && p.taxPercent > 0)) && (
                                    <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold inline-block">
                                      GST {p.taxPercent || 18}%
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 md:px-4 py-1.5 md:py-2 font-mono text-blue-600 whitespace-nowrap">{p.imei || '—'}</td>
                                <td className="px-2 md:px-4 py-1.5 md:py-2 whitespace-nowrap">{p.productCode || '—'}</td>
                                <td className="px-2 md:px-4 py-1.5 md:py-2 whitespace-nowrap">{p.brand || '—'}</td>
                                <td className={`px-2 md:px-4 py-1.5 md:py-2 text-center font-medium whitespace-nowrap ${p.quantity > 0 ? 'text-green-600' : 'text-red-500'}`}>{p.quantity}</td>
                                <td className="px-2 md:px-4 py-1.5 md:py-2 text-right font-mono text-gray-500 whitespace-nowrap">
                                  {typeof p.cost === 'number' ? <span className="bg-gray-100 px-1 rounded text-[10px] md:text-xs">{encodeSecret(p.cost)}</span> : '—'}
                                </td>
                                <td className="px-2 md:px-4 py-1.5 md:py-2 text-right whitespace-nowrap">
                                  {p.mrp ? `₹${p.mrp} ` : '—'}
                                </td>
                                <td className="px-2 md:px-4 py-1.5 md:py-2 text-right font-bold text-gray-900 whitespace-nowrap">
                                  ₹{Number(p.sellingPrice ?? p.mrp ?? p.price ?? 0)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-1 xl:grid-cols-2 gap-2 md:gap-6 mb-2 md:mb-6 mobile-compact-section">
                <div className="bg-white mobile-compact-card p-3 md:p-6 rounded-lg border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-2 md:mb-4">
                    <h3 className="text-sm md:text-base font-semibold text-gray-900 flex items-center gap-2 mobile-compact-heading">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      {entryType === 'service' ? 'Service Details' : 'Product Details'}
                    </h3>
                  </div>

                  {entryType !== 'service' && selectedProductInfo && (
                    <div className="space-y-3 md:space-y-4">
                      {/* Product Info Card */}
                      <div className="p-3 md:p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg">
                        <div className="flex items-start justify-between mb-2 md:mb-3">
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm md:text-base font-bold text-gray-900 truncate mb-1">{selectedProductInfo.name}</h4>
                            <div className="flex flex-wrap gap-1.5 md:gap-2 text-xs">
                              <span className="inline-flex items-center px-2 py-0.5 md:py-1 bg-white rounded-md border border-gray-200">
                                <span className="text-gray-500 font-medium text-[10px] md:text-xs">Code:</span>
                                <span className="ml-1 text-gray-900 font-semibold text-[10px] md:text-xs">{selectedProductInfo.productCode || '—'}</span>
                              </span>
                              {selectedProductInfo.imei && (
                                <span className="inline-flex items-center px-2 py-0.5 md:py-1 bg-blue-50 rounded-md border border-blue-200">
                                  <span className="text-blue-500 font-medium text-[10px] md:text-xs">IMEI:</span>
                                  <span className="ml-1 text-blue-900 font-semibold text-[10px] md:text-xs">{selectedProductInfo.imei}</span>
                                </span>
                              )}
                              <span className="inline-flex items-center px-2 py-0.5 md:py-1 bg-white rounded-md border border-gray-200">
                                <span className="text-gray-500 font-medium text-[10px] md:text-xs">Brand:</span>
                                <span className="ml-1 text-gray-900 font-semibold text-[10px] md:text-xs">{selectedProductInfo.brand || '—'}</span>
                              </span>
                            </div>
                          </div>
                          <button
                            className="ml-2 p-1.5 md:p-2 rounded-lg border border-red-300 bg-white hover:bg-red-50 transition-colors"
                            title="Clear Selection"
                            onClick={() => { setSelectedProductInfo(null); setSelectedCost(''); setSelectedSelling(''); setSelectedUnitDiscount(''); setSelectedQty(''); }}
                          >
                            <svg className="w-3.5 h-3.5 md:w-4 md:h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        {/* Stock and MRP Info */}
                        <div className={`grid ${gstEnabled ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-1.5 md:gap-2 mb-2 md:mb-4`}>
                          <div className="p-2 bg-white rounded-md border border-gray-200">
                            <p className="text-[10px] text-gray-500 font-medium uppercase">MRP</p>
                            <p className="text-xs md:text-sm font-bold text-gray-900">{selectedProductInfo.mrp ? `₹${selectedProductInfo.mrp}` : '—'}</p>
                          </div>
                          <div className="p-2 bg-white rounded-md border border-gray-200">
                            <p className="text-[10px] text-gray-500 font-medium uppercase">MOP</p>
                            <p className="text-xs md:text-sm font-bold text-gray-900">{selectedProductInfo.mop !== undefined && selectedProductInfo.mop !== null && selectedProductInfo.mop > 0 ? `₹${selectedProductInfo.mop}` : (selectedProductInfo.mrp ? `₹${selectedProductInfo.mrp}` : '—')}</p>
                          </div>
                          <div className="p-2 bg-white rounded-md border border-gray-200">
                            <p className="text-[10px] text-gray-500 font-medium uppercase">Stock</p>
                            <p className="text-xs md:text-sm font-bold text-blue-600">{selectedProductInfo.quantity} units</p>
                          </div>
                          {gstEnabled && (
                            <div className="p-2 bg-emerald-50/50 rounded-md border border-emerald-200 flex flex-col justify-between">
                              <p className="text-[10px] text-emerald-700 font-medium uppercase">GST Tax</p>
                              <p className="text-xs md:text-sm font-bold text-emerald-800">
                                {selectedProductInfo.taxPercent ? `${selectedProductInfo.taxPercent}%` : `${gstRate}%`}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Input Fields - 4 fields: Cost, Unit Disc, Selling Price, Quantity */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 md:gap-3 mb-2 md:mb-3">
                          <div className="md:col-span-1">
                            <label className="block text-[10px] md:text-xs font-semibold text-gray-700 mb-1 md:mb-1.5">Cost</label>
                            <div className="relative">
                              <span className="absolute left-2 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-[10px] md:text-xs font-semibold"></span>
                              <input
                                ref={costRef}
                                type="text"
                                value={encodeSecret(selectedCost)}
                                onChange={() => { }}
                                onKeyDown={(e) => handleInputKeyDown(e, 'cost')}
                                placeholder=""
                                disabled
                                className="w-full pl-5 md:pl-6 pr-1 md:pr-2 py-1.5 md:py-2 border-2 border-gray-300 rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-100 text-gray-500 cursor-not-allowed font-mono"
                              />
                            </div>
                          </div>
                          <div className="md:col-span-1">
                            <label className="block text-[10px] md:text-xs font-semibold text-gray-700 mb-1 md:mb-1.5">Unit Disc %</label>
                            <div className="relative">
                              <span className="absolute left-2 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-[10px] md:text-xs font-semibold">%</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.1"
                                value={selectedUnitDiscount as number | undefined}
                                onChange={(e) => {
                                  const discPercent = Number(e.target.value);
                                  setSelectedUnitDiscount(discPercent);
                                  if (selectedProductInfo) {
                                    const basePrice = selectedProductInfo.mop && selectedProductInfo.mop > 0 ? selectedProductInfo.mop : (selectedProductInfo.mrp && selectedProductInfo.mrp > 0 ? selectedProductInfo.mrp : selectedProductInfo.price);
                                    setSelectedSelling(Math.round(basePrice * (1 - discPercent / 100)));
                                  }
                                }}
                                disabled={entryType === 'credit'}
                                className={`w-full pl-5 md:pl-6 pr-1 md:pr-2 py-1.5 md:py-2 border-2 border-gray-300 rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${entryType === 'credit' ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                              />
                            </div>
                          </div>
                          <div className="md:col-span-1">
                            <label className="block text-[10px] md:text-xs font-semibold text-gray-700 mb-1 md:mb-1.5">Selling</label>
                            <div className="relative">
                              <span className="absolute left-2 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-[10px] md:text-xs font-semibold">₹</span>
                              <input
                                ref={sellingRef}
                                type="number"
                                min={0}
                                value={selectedSelling as number | undefined}
                                onChange={(e) => {
                                  const selling = Number(e.target.value);
                                  setSelectedSelling(selling);
                                  if (selectedProductInfo) {
                                    const basePrice = selectedProductInfo.mop && selectedProductInfo.mop > 0 ? selectedProductInfo.mop : (selectedProductInfo.mrp && selectedProductInfo.mrp > 0 ? selectedProductInfo.mrp : selectedProductInfo.price);
                                    setSelectedUnitDiscount(basePrice > 0 ? parseFloat((Math.max(0, basePrice - selling) / basePrice * 100).toFixed(2)) : 0);
                                  }
                                }}
                                onKeyDown={(e) => handleInputKeyDown(e, 'selling')}
                                placeholder="0"
                                disabled={entryType === 'credit'}
                                className={`w-full pl-5 md:pl-6 pr-1 md:pr-2 py-1.5 md:py-2 border-2 border-gray-300 rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${entryType === 'credit' ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                              />
                            </div>
                          </div>
                          <div className="md:col-span-1">
                            <label className="block text-[10px] md:text-xs font-semibold text-gray-700 mb-1 md:mb-1.5">Qty</label>
                            <input
                              ref={qtyRef}
                              type="number"
                              min={1}
                              max={selectedProductInfo.quantity}
                              value={selectedQty as number | undefined}
                              onChange={(e) => setSelectedQty(Number(e.target.value))}
                              onKeyDown={(e) => handleInputKeyDown(e, 'qty')}
                              placeholder="1"
                              className="w-full px-2 py-1.5 md:py-2 border-2 border-gray-300 rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                        </div>

                        {/* GST Controls for Selected Product */}
                        <div className={`p-2.5 rounded-lg border mb-2 transition-all ${
                          selectedGstEnabled 
                            ? 'bg-emerald-50/70 border-emerald-200' 
                            : 'bg-gray-50 border-gray-200'
                        }`}>
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={selectedGstEnabled}
                                onChange={(e) => setSelectedGstEnabled(e.target.checked)}
                                className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
                              />
                              <span className="text-xs font-semibold text-gray-800 flex items-center gap-1">
                                <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                                Apply GST
                                {(selectedProductInfo.taxPercent && selectedProductInfo.taxPercent > 0) ? (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-200 text-emerald-900 rounded font-bold">
                                    Product Tax: {selectedProductInfo.taxPercent}%
                                  </span>
                                ) : null}
                              </span>
                            </label>

                            {selectedGstEnabled && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-gray-500 font-medium">Rate:</span>
                                <select
                                  value={selectedTaxRate}
                                  onChange={(e) => setSelectedTaxRate(Number(e.target.value))}
                                  className="text-xs bg-white border border-emerald-300 rounded px-1.5 py-0.5 font-bold text-emerald-800 focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                                >
                                  <option value={0}>0%</option>
                                  <option value={5}>5%</option>
                                  <option value={12}>12%</option>
                                  <option value={18}>18%</option>
                                  <option value={28}>28%</option>
                                </select>
                              </div>
                            )}
                          </div>

                          {selectedGstEnabled && typeof selectedSelling === 'number' && selectedSelling > 0 && (
                            <div className="mt-2 pt-2 border-t border-emerald-100 flex justify-between items-center text-xs">
                              <span className="text-emerald-800 font-medium">
                                Base: ₹{(selectedSelling / (1 + (selectedTaxRate || 0) / 100)).toFixed(2)}
                              </span>
                              <span className="text-emerald-800 font-bold">
                                GST ({selectedTaxRate}%): ₹{(selectedSelling - (selectedSelling / (1 + (selectedTaxRate || 0) / 100))).toFixed(2)} / unit
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Profit Indicator */}
                        {typeof selectedCost === 'number' && typeof selectedSelling === 'number' && selectedCost > 0 && (
                          <div className={`p-2 rounded-md mb-3 ${selectedSelling > selectedCost ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-medium text-gray-700">Expected Profit:</span>
                              <span className={`text-sm font-bold ${selectedSelling > selectedCost ? 'text-green-600' : 'text-red-600'}`}>
                                {selectedSelling > selectedCost ? '+' : ''}₹{(selectedSelling - selectedCost).toFixed(2)} per unit
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Add to Order Button */}
                        <button
                          className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                          ref={addBtnRef}
                          onClick={() => {
                            if (!selectedProductInfo) return;

                            if (entryType === 'product') {
                              const isGst = isGstProduct(selectedProductInfo);
                              if (!gstEnabled && isGst) {
                                showError(`"${selectedProductInfo.name}" is a GST product. Please switch to GST Sales to bill this product.`);
                                return;
                              }
                              if (gstEnabled && !isGst) {
                                showError(`"${selectedProductInfo.name}" is a non-GST product. Please switch to regular Sales to bill this product.`);
                                return;
                              }
                            }

                            const price = typeof selectedSelling === 'number' ? selectedSelling : selectedProductInfo.price;

                            // Ensure selling price does not exceed MRP, allowing any amount under MRP
                            const ceilingPrice = selectedProductInfo.mrp && selectedProductInfo.mrp > 0
                              ? selectedProductInfo.mrp
                              : (selectedProductInfo.mop && selectedProductInfo.mop > 0 ? selectedProductInfo.mop : selectedProductInfo.price);
                            if (ceilingPrice > 0 && price > ceilingPrice) {
                              showError(`Selling price cannot exceed MRP (₹${ceilingPrice.toFixed(2)}).`);
                              return;
                            }
                            if (price < 0) {
                              showError('Selling price cannot be negative.');
                              return;
                            }

                            const qty = typeof selectedQty === 'number' && selectedQty > 0 ? selectedQty : 1;

                            // Add product to order with the specified quantity
                            setOrderItems(items => {
                              const idx = items.findIndex(i => i.id === selectedProductInfo.id);
                              if (idx >= 0) {
                                const updated = [...items];
                                updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + qty };
                                return updated;
                              }
                              return [
                                ...items,
                                {
                                  id: selectedProductInfo.id,
                                  name: selectedProductInfo.name,
                                  code: selectedProductInfo.productCode || '',
                                  price: price,
                                  quantity: qty,
                                  stock: selectedProductInfo.quantity || 0,
                                  brand: selectedProductInfo.brand || '',
                                  category: selectedProductInfo.category || '',
                                  ...(selectedProductInfo.imei ? { imei: selectedProductInfo.imei } : {}),
                                  ...(selectedProductInfo.hsnCode ? { hsnCode: selectedProductInfo.hsnCode } : {}),
                                  mop: selectedProductInfo.mop,
                                  taxPercent: selectedGstEnabled ? selectedTaxRate : 0,
                                  highestDiscountLimit: selectedProductInfo.highestDiscountLimit,
                                  gstEnabled: selectedGstEnabled,
                                },
                              ];
                            });

                            // Clear product details after adding
                            setSelectedProductInfo(null);
                            setSelectedSelling('');
                            setSelectedUnitDiscount('');
                            setSelectedCost('');
                            setSelectedQty('');
                          }}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          Add to Order
                        </button>
                      </div>
                    </div>
                  )}

                  {entryType !== 'service' && !selectedProductInfo && (
                    <div className="flex flex-col items-center justify-center py-4 px-4">
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-600 text-center">Search for a product above</p>
                      <p className="text-xs text-gray-500 text-center mt-1">Select a product to view and edit details</p>
                    </div>
                  )}

                  {entryType === 'service' && (
                    <div className="space-y-2 md:space-y-4">
                      {/* Service Name */}
                      <div>
                        <label className="block text-[10px] md:text-xs font-semibold text-gray-700 mb-1 md:mb-2 flex items-center gap-1">
                          <svg className="w-3 h-3 md:w-4 md:h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Service Name
                        </label>
                        <input
                          type="text"
                          value={serviceTitle}
                          onChange={(e) => setServiceTitle(e.target.value)}
                          placeholder="e.g., Screen Replacement, Battery Change"
                          className="w-full px-2 md:px-4 py-1.5 md:py-2.5 border-2 border-gray-300 rounded-md md:rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>

                      {/* Service Pricing */}
                      <div className="p-2 md:p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-md md:rounded-lg">
                        <h4 className="text-[10px] md:text-xs font-bold text-gray-700 mb-2 md:mb-3 uppercase">Pricing Details</h4>
                        <div className="grid grid-cols-3 md:grid-cols-3 gap-1.5 md:gap-3">
                          <div>
                            <label className="block text-[9px] md:text-xs font-semibold text-gray-700 mb-0.5 md:mb-1.5">Cost</label>
                            <div className="relative">
                              <span className="absolute left-1.5 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-[9px] md:text-xs font-semibold">₹</span>
                              <input
                                type="number"
                                min={0}
                                value={typeof selectedCost === 'number' ? selectedCost : 0}
                                onChange={(e) => setSelectedCost(Number(e.target.value))}
                                placeholder="0"
                                className="w-full pl-4 md:pl-6 pr-1 md:pr-2 py-1.5 md:py-2.5 border-2 border-gray-300 rounded-md md:rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[9px] md:text-xs font-semibold text-gray-700 mb-0.5 md:mb-1.5">Selling</label>
                            <div className="relative">
                              <span className="absolute left-1.5 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-[9px] md:text-xs font-semibold">₹</span>
                              <input
                                type="number"
                                min={0}
                                value={typeof selectedSelling === 'number' ? selectedSelling : 0}
                                onChange={(e) => setSelectedSelling(Number(e.target.value))}
                                placeholder="0"
                                className="w-full pl-4 md:pl-6 pr-1 md:pr-2 py-1.5 md:py-2.5 border-2 border-gray-300 rounded-md md:rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[9px] md:text-xs font-semibold text-gray-700 mb-0.5 md:mb-1.5">Qty</label>
                            <input
                              type="number"
                              min={1}
                              value={typeof selectedQty === 'number' ? selectedQty : 1}
                              onChange={(e) => setSelectedQty(Number(e.target.value))}
                              placeholder="1"
                              className="w-full px-1 md:px-2 py-1.5 md:py-2.5 border-2 border-gray-300 rounded-md md:rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                        </div>

                        {/* GST Indicator */}
                        {gstEnabled && typeof selectedSelling === 'number' && selectedSelling > 0 && (
                          <div className="mt-2 p-1.5 md:p-2 bg-blue-50 border border-blue-100 rounded-md">
                            <div className="flex justify-between items-center">
                              <span className="text-[9px] md:text-xs font-medium text-blue-800">GST ({gstRate}% Included):</span>
                              <span className="text-[10px] md:text-xs font-bold text-blue-700">
                                ₹{(selectedSelling - (selectedSelling / (1 + (gstRate || 0) / 100))).toFixed(2)} per unit
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Service Profit Indicator */}
                        {typeof selectedCost === 'number' && typeof selectedSelling === 'number' && selectedCost > 0 && (
                          <div className={`mt-2 md:mt-3 p-1.5 md:p-2 rounded-md ${selectedSelling > selectedCost ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                            <div className="flex justify-between items-center">
                              <span className="text-[9px] md:text-xs font-medium text-gray-700">Expected Profit:</span>
                              <span className={`text-xs md:text-sm font-bold ${selectedSelling > selectedCost ? 'text-green-600' : 'text-red-600'}`}>
                                {selectedSelling > selectedCost ? '+' : ''}₹{((selectedSelling - selectedCost) * (typeof selectedQty === 'number' ? selectedQty : 1)).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Add to Order Button for Service */}
                      <button
                        className="w-full py-2 md:py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-md md:rounded-lg text-xs md:text-sm font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 md:gap-2 mt-2 md:mt-4"
                        onClick={() => {
                          // Validate service inputs
                          if (!serviceTitle.trim()) {
                            alert('Please enter a service name');
                            return;
                          }
                          if (typeof selectedSelling !== 'number' || selectedSelling <= 0) {
                            alert('Please enter a valid selling price');
                            return;
                          }

                          // Add service to order
                          const serviceItem: Product = {
                            id: `service - ${Date.now()} `,
                            name: serviceTitle.trim(),
                            code: 'SERVICE',
                            price: selectedSelling,
                            quantity: typeof selectedQty === 'number' && selectedQty > 0 ? selectedQty : 1,
                            stock: 999999, // Services don't have stock limitations
                            cost: typeof selectedCost === 'number' ? selectedCost : 0, // Include service cost
                            taxPercent: gstEnabled ? gstRate : 0,
                            gstEnabled: gstEnabled,
                            brand: 'Service',
                            category: 'Service',
                          };

                          setOrderItems(prev => [...prev, serviceItem]);

                          // Reset service form
                          setServiceTitle('');
                          setSelectedCost('');
                          setSelectedSelling('');
                          setSelectedUnitDiscount('');
                          setSelectedQty('');

                          // Show success feedback
                          success('Service added to order!');
                        }}
                      >
                        <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        Add to Order
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white mobile-compact-card p-3 md:p-6 rounded-lg border border-gray-200 shadow-sm">
                  {/* 2-column layout on mobile (Customer + Discount), stacked on desktop */}
                  <div className="space-y-3 md:space-y-6">

                    {/* Customer and Discount Row - 2 columns on mobile */}
                    <div className="grid grid-cols-2 md:grid-cols-1 gap-3 md:gap-6">

                      {/* Customer Section - Regular (Product/Service) */}
                      {entryType !== 'credit' && (
                        <div className="md:mb-0">
                          <div className="flex items-center justify-between mb-2 md:mb-3 min-h-[32px]">
                            <h3 className="text-sm md:text-base font-semibold text-gray-900 flex items-center gap-1 md:gap-2">
                              <svg className="w-4 h-4 md:w-5 md:h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              Customer
                            </h3>
                            <div className="flex items-center gap-1">
                              <button
                                className="p-1 md:p-2 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Search Customer"
                                onClick={() => setCustomerSearchOpen(true)}
                              >
                                <Search className="w-3.5 h-3.5 md:w-4 md:h-4 text-blue-600" />
                              </button>
                              <button
                                className="p-1 md:p-2 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Add New Customer"
                                onClick={() => setCustomerModalOpen(true)}
                              >
                                <UserPlus className="w-3.5 h-3.5 md:w-4 md:h-4 text-blue-600" />
                              </button>
                            </div>
                          </div>
                          <div className="relative">
                            <input
                              type="text"
                              value={customerDisplay}
                              readOnly
                              className="w-full px-3 md:px-4 py-2.5 md:py-3 bg-gradient-to-r from-blue-50 to-blue-100 border-2 border-blue-200 rounded-lg text-sm md:text-base font-medium text-gray-800 cursor-pointer hover:border-blue-300 transition-all shadow-sm"
                              onClick={() => setCustomerSearchOpen(true)}
                              title={customerDisplay}
                            />
                          </div>
                        </div>
                      )}

                      {/* Credit Customer Section - Credit Sales Only */}
                      {entryType === 'credit' && (
                        <div className="md:mb-0">
                          <div className="flex items-center justify-between mb-2 md:mb-3 min-h-[32px]">
                            <h3 className="text-sm md:text-base font-semibold text-gray-900 flex items-center gap-1 md:gap-2">
                              <CreditCard className="w-4 h-4 md:w-5 md:h-5 text-orange-600" />
                              <span className="hidden md:inline">Credit Customer</span>
                              <span className="md:hidden">Credit</span>
                            </h3>
                            <div className="flex items-center gap-1">
                              <button
                                className="p-1 md:p-2 hover:bg-orange-50 rounded-lg transition-colors"
                                title="Search Credit Customer"
                                onClick={() => setCreditCustomerSearchOpen(true)}
                              >
                                <Search className="w-3.5 h-3.5 md:w-4 md:h-4 text-orange-600" />
                              </button>
                              <button
                                className="p-1 md:p-2 hover:bg-orange-50 rounded-lg transition-colors"
                                title="Add New Credit Customer"
                                onClick={() => setCreditCustomerModalOpen(true)}
                              >
                                <UserPlus className="w-3.5 h-3.5 md:w-4 md:h-4 text-orange-600" />
                              </button>
                            </div>
                          </div>
                          <div className="relative">
                            <input
                              type="text"
                              value={creditCustomerDisplay}
                              readOnly
                              className="w-full px-3 md:px-4 py-2.5 md:py-3 bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-300 rounded-lg text-sm md:text-base font-medium text-gray-800 cursor-pointer hover:border-orange-400 transition-all shadow-sm"
                              onClick={() => setCreditCustomerSearchOpen(true)}
                              title={creditCustomerDisplay}
                            />
                          </div>
                        </div>
                      )}

                      {/* Discount Section */}
                      <div className="md:mb-0">
                        <div className="flex items-center justify-between mb-2 md:mb-3 min-h-[32px]">
                          <h3 className="text-sm md:text-base font-semibold text-gray-900 flex items-center gap-1 md:gap-2">
                            <svg className="w-4 h-4 md:w-5 md:h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                            </svg>
                            Discount
                          </h3>
                          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm">
                            <button
                              className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-semibold rounded-md transition-all ${discountType === 'amount'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-50'
                                }`}
                              onClick={() => setDiscountType('amount')}
                            >
                              ₹
                            </button>
                            <button
                              className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-semibold rounded-md transition-all ${discountType === 'percent'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-50'
                                }`}
                              onClick={() => setDiscountType('percent')}
                            >
                              %
                            </button>
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            max={discountType === 'percent' ? 100 : undefined}
                            value={discountValue}
                            onChange={(e) => setDiscountValue(Number(e.target.value))}
                            placeholder="0"
                            className="w-full px-3 md:px-4 py-2.5 md:py-3 pr-10 md:pr-12 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-lg text-sm md:text-base font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent transition-all shadow-sm hover:border-red-300"
                          />
                          <span className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-base md:text-lg pointer-events-none">
                            {discountType === 'percent' ? '%' : '₹'}
                          </span>
                        </div>
                        {discountValue > 0 && (
                          <div className="mt-2 pt-2 border-t border-red-200 hidden md:block">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-medium text-gray-600">
                                {discountType === 'percent' ? 'Discount Value:' : 'Applied:'}
                              </span>
                              <span className="text-sm font-bold text-red-600">
                                - ₹{discountType === 'percent' ? Math.round((subTotal * (discountValue || 0)) / 100) : discountValue}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* GST Section - Only shown when in GST Sales mode */}
                    {gstEnabled && (
                      <div className="md:mb-0">
                        <div className="flex items-center justify-between mb-2 md:mb-3">
                          <h3 className="text-sm md:text-base font-semibold text-emerald-800 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <svg className="w-4 h-4 md:w-5 md:h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            GST Tax Invoice
                          </h3>
                          <span className="text-[10px] md:text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                            GST Mode Active
                          </span>
                        </div>
                        <div className="bg-gradient-to-r from-emerald-50 to-green-50 p-3 md:p-4 rounded-lg border border-emerald-200">
                          <label className="block text-xs md:text-xs font-semibold text-emerald-900 mb-2">
                            Select Default GST Rate
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {[0, 5, 12, 18, 28].map((rate) => (
                              <button
                                key={rate}
                                type="button"
                                onClick={() => setGstRate(rate)}
                                className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold transition-all ${gstRate === rate
                                  ? 'bg-emerald-600 text-white shadow-md'
                                  : 'bg-white border-2 border-emerald-200 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-50'
                                  }`}
                              >
                                {rate}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {canSelectSalesPerson && (
                      <div className="md:mb-0">
                        <div className="flex items-center justify-between mb-2 md:mb-3 min-h-8">
                          <h3 className="text-sm md:text-base font-semibold text-gray-900 flex items-center gap-1 md:gap-2">
                            <svg className="w-4 h-4 md:w-5 md:h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m10 0v-2a3 3 0 00-3-3H10a3 3 0 00-3 3v2m10 0H7m8-10a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Sales Person
                          </h3>
                          {loadingSalesEmployees && (
                            <span className="text-xs text-gray-500">Loading...</span>
                          )}
                        </div>

                        <div className="relative">
                          <select
                            value={selectedSalesPersonId}
                            onChange={(e) => {
                              const id = e.target.value;
                              const selected = salesEmployees.find(emp => emp.id === id);
                              setSelectedSalesPersonId(id);
                              setSelectedSalesPersonName(selected?.name || fallbackSalesPersonName);
                            }}
                            className="w-full appearance-none px-3 md:px-4 py-2.5 md:py-3 pr-10 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-lg text-sm md:text-base font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all shadow-sm"
                          >
                            {salesEmployees.length === 0 ? (
                              <option value={currentUser?.uid || ''}>{fallbackSalesPersonName}</option>
                            ) : (
                              <>
                                {selectedSalesPersonId && !salesEmployees.some(emp => emp.id === selectedSalesPersonId) && (
                                  <option value={selectedSalesPersonId}>
                                    {selectedSalesPersonName || 'Selected Person'}
                                  </option>
                                )}
                                {salesEmployees.map(emp => (
                                  <option key={emp.id} value={emp.id}>
                                    {emp.name}{emp.email ? ` (${emp.email})` : ''}
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>

                  {customerSearchOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-xl p-4">
                      <div className="w-full max-w-lg bg-white rounded-lg shadow-lg max-h-[90vh] flex flex-col">
                        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                          <h4 className="text-sm md:text-base font-semibold text-gray-900">Search Customer</h4>
                          <button
                            className="p-2 rounded hover:bg-gray-100 active:scale-95 transition"
                            onClick={() => setCustomerSearchOpen(false)}
                            aria-label="Close"
                          >
                            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 space-y-3 flex-1 overflow-hidden flex flex-col">
                          <div className="relative flex-shrink-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              ref={customerSearchInputRef}
                              type="text"
                              value={customerQuery}
                              onChange={(e) => {
                                setCustomerQuery(e.target.value);
                                setCustomerSearchPage(1); // Reset to first page on search
                              }}
                              placeholder="Search by name, phone, or email"
                              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                          </div>
                          <div className="flex-1 overflow-auto border border-gray-200 rounded-md">
                            {loadingCustomers ? (
                              <div className="p-4 text-sm text-gray-500 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-2"></div>
                                Loading customers...
                              </div>
                            ) : filteredCustomers.length === 0 ? (
                              <div className="p-4 text-xs md:text-sm text-gray-500">{customerQuery ? 'No customers found matching your search.' : 'No customers yet. Add your first customer!'}</div>
                            ) : (
                              <ul className="divide-y divide-gray-200">
                                {filteredCustomers
                                  .slice((customerSearchPage - 1) * CUSTOMERS_PER_PAGE, customerSearchPage * CUSTOMERS_PER_PAGE)
                                  .map((c) => (
                                    <li key={c.id} className="p-3 hover:bg-gray-50 cursor-pointer active:bg-gray-100 transition" onClick={() => {
                                      const display = `${c.name} • ${c.phone}${c.email ? ` • ${c.email}` : ''}${c.address ? ` • Address: ${c.address}` : ''}${c.gstNo ? ` • GST No: ${c.gstNo}` : ''} `;
                                      setCustomerDisplay(display);
                                      setCustomerSearchOpen(false);
                                      setCustomerQuery('');
                                    }}>
                                      <div className="text-xs md:text-sm font-medium text-gray-900">{c.name}</div>
                                      <div className="text-[10px] md:text-xs text-gray-600">{c.phone}{c.email ? ` • ${c.email}` : ''}{c.address ? ` • Address: ${c.address}` : ''}{c.gstNo ? ` • GST No: ${c.gstNo}` : ''}</div>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>
                          {/* Pagination Controls */}
                          {filteredCustomers.length > CUSTOMERS_PER_PAGE && (
                            <div className="flex items-center justify-between pt-2 border-t border-gray-200 flex-shrink-0">
                              <button
                                onClick={() => setCustomerSearchPage(prev => Math.max(1, prev - 1))}
                                disabled={customerSearchPage === 1}
                                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
                              >
                                Previous
                              </button>
                              <span className="text-xs text-gray-600">
                                Page {customerSearchPage} of {Math.ceil(filteredCustomers.length / CUSTOMERS_PER_PAGE)} ({filteredCustomers.length} customers)
                              </span>
                              <button
                                onClick={() => setCustomerSearchPage(prev => Math.min(Math.ceil(filteredCustomers.length / CUSTOMERS_PER_PAGE), prev + 1))}
                                disabled={customerSearchPage >= Math.ceil(filteredCustomers.length / CUSTOMERS_PER_PAGE)}
                                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
                              >
                                Next
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {customerModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-xl p-4">
                      <div className="w-full max-w-md bg-white rounded-lg shadow-lg max-h-[90vh] overflow-auto">
                        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 flex items-center justify-between">
                          <h4 className="text-sm md:text-base font-semibold text-gray-900">Add Customer</h4>
                          <button
                            className="p-2 rounded hover:bg-gray-100 active:scale-95 transition"
                            onClick={() => {
                              setCustomerModalOpen(false);
                              setCustomerError('');
                            }}
                            aria-label="Close"
                          >
                            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 space-y-3 md:space-y-4">
                          {customerError && (
                            <div className="text-xs md:text-sm text-red-600">{customerError}</div>
                          )}
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">Name *</label>
                            <input
                              type="text"
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                              placeholder="Customer name"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">Phone *</label>
                            <input
                              type="tel"
                              value={customerPhone}
                              onChange={(e) => setCustomerPhone(e.target.value)}
                              placeholder="Phone number"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">Email (optional)</label>
                            <input
                              type="email"
                              value={customerEmail}
                              onChange={(e) => setCustomerEmail(e.target.value)}
                              placeholder="Email address"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">GST No (optional)</label>
                            <input
                              type="text"
                              value={customerGstNo}
                              onChange={(e) => setCustomerGstNo(e.target.value)}
                              placeholder="GST number"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">Address (optional)</label>
                            <input
                              type="text"
                              value={customerAddress}
                              onChange={(e) => setCustomerAddress(e.target.value)}
                              placeholder="Customer address"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                          </div>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 border-t border-gray-200 flex justify-end gap-2 md:gap-3">
                          <button
                            className="px-4 py-2.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 active:scale-95 transition text-sm"
                            onClick={() => {
                              setCustomerModalOpen(false);
                              setCustomerError('');
                              setCustomerName('');
                              setCustomerPhone('');
                              setCustomerEmail('');
                              setCustomerGstNo('');
                              setCustomerAddress('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="px-4 py-2.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition text-sm"
                            onClick={async () => {
                              // Validate required fields: name and phone
                              if (!customerName.trim()) {
                                setCustomerError('Name is required.');
                                  return;
                                }
                                if (!customerPhone.trim()) {
                                  setCustomerError('Phone is required.');
                                  return;
                                }

                                try {
                                  // Check if customer already exists
                                  const customersRef = getCollectionRef('customers');
                                  const q = query(customersRef, where('phone', '==', customerPhone.trim()));
                                  const existingCustomers = await getDocs(q);

                                  if (!existingCustomers.empty) {
                                    setCustomerError('Customer with this phone number already exists.');
                                    return;
                                  }

                                  // Create new customer
                                  const customerData = {
                                    name: customerName.trim(),
                                    phone: customerPhone.trim(),
                                    email: customerEmail.trim(),
                                    gstNo: customerGstNo.trim(),
                                    address: customerAddress.trim(),
                                    homeStoreId: currentStore?.id || '',
                                    homeStoreName: currentStore?.name || '',
                                    createdAt: Timestamp.now(),
                                    updatedAt: serverTimestamp(),
                                    createdBy: currentUser?.displayName || currentUser?.email || 'Unknown User',
                                  };

                                  const docRef = await addDoc(getCollectionRef('customers'), customerData);

                                  // Add to local state
                                  setCustomers(prev => [{
                                    id: docRef.id,
                                    name: customerData.name,
                                    phone: customerData.phone,
                                    email: customerData.email,
                                    gstNo: customerData.gstNo,
                                    address: customerData.address,
                                  }, ...prev]);

                                  setCustomerError('');
                                  const display = `${customerName.trim()} • ${customerPhone.trim()}${customerEmail.trim() ? ` • ${customerEmail.trim()}` : ''}${customerAddress.trim() ? ` • Address: ${customerAddress.trim()}` : ''}${customerGstNo.trim() ? ` • GST No: ${customerGstNo.trim()}` : ''} `;
                                  setCustomerDisplay(display);
                                  setCustomerModalOpen(false);

                                  // Clear form
                                  setCustomerName('');
                                  setCustomerPhone('');
                                  setCustomerEmail('');
                                  setCustomerGstNo('');
                                  setCustomerAddress('');

                                  success('Customer saved successfully!');
                                } catch (error) {
                                  console.error('Error saving customer:', error);
                                  setCustomerError('Failed to save customer. Please try again.');
                                }
                              }}
                            >
                              Save Customer
                            </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Credit Customer Search Modal */}
                  {creditCustomerSearchOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-xl p-4">
                      <div className="w-full max-w-lg bg-white rounded-lg shadow-lg max-h-[90vh] flex flex-col">
                        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                          <h4 className="text-sm md:text-base font-semibold text-gray-900">Search Credit Customer</h4>
                          <button
                            className="p-2 rounded hover:bg-gray-100 active:scale-95 transition"
                            onClick={() => setCreditCustomerSearchOpen(false)}
                            aria-label="Close"
                          >
                            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 space-y-3 flex-1 overflow-hidden flex flex-col">
                          <div className="relative flex-shrink-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={creditCustomerQuery}
                              onChange={(e) => setCreditCustomerQuery(e.target.value)}
                              placeholder="Search by name, phone, or email"
                              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
                            />
                          </div>
                          <div className="flex-1 overflow-auto border border-gray-200 rounded-md">
                            {loadingCreditCustomers ? (
                              <div className="p-4 text-sm text-gray-500 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-600 mr-2"></div>
                                Loading credit customers...
                              </div>
                            ) : creditCustomers.filter(c => {
                              const q = creditCustomerQuery.trim().toLowerCase();
                              if (!q) return true;
                              return (
                                c.name.toLowerCase().includes(q) ||
                                c.phone.toLowerCase().includes(q) ||
                                (c.email && c.email.toLowerCase().includes(q))
                              );
                            }).length === 0 ? (
                              <div className="p-4 text-xs md:text-sm text-gray-500">{creditCustomerQuery ? 'No credit customers found matching your search.' : 'No credit customers yet. Add your first credit customer!'}</div>
                            ) : (
                              <ul className="divide-y divide-gray-200">
                                {creditCustomers.filter(c => {
                                  const q = creditCustomerQuery.trim().toLowerCase();
                                  if (!q) return true;
                                  return (
                                    c.name.toLowerCase().includes(q) ||
                                    c.phone.toLowerCase().includes(q) ||
                                    (c.email && c.email.toLowerCase().includes(q))
                                  );
                                }).map((c) => (
                                  <li key={c.id} className="p-3 hover:bg-orange-50 cursor-pointer active:bg-orange-100 transition" onClick={() => {
                                    const display = `${c.name} • ${c.phone}${c.email ? ` • ${c.email}` : ''} `;
                                    setCreditCustomerDisplay(display);
                                    setCreditCustomerSearchOpen(false);
                                    setCreditCustomerQuery('');
                                  }}>
                                    <div className="text-xs md:text-sm font-medium text-gray-900">{c.name}</div>
                                    <div className="text-[10px] md:text-xs text-gray-600">{c.phone}{c.email ? ` • ${c.email} ` : ''}</div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 border-t border-gray-200 flex justify-end flex-shrink-0">
                          <button
                            className="px-4 py-2.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 active:scale-95 transition text-sm"
                            onClick={() => setCreditCustomerSearchOpen(false)}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Credit Customer Add Modal */}
                  {creditCustomerModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-xl p-4">
                      <div className="w-full max-w-md bg-white rounded-lg shadow-lg max-h-[90vh] overflow-auto">
                        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 flex items-center justify-between">
                          <h4 className="text-sm md:text-base font-semibold text-gray-900">Add Credit Customer</h4>
                          <button
                            className="p-2 rounded hover:bg-gray-100 active:scale-95 transition"
                            onClick={() => {
                              setCreditCustomerModalOpen(false);
                              setCreditCustomerError('');
                            }}
                            aria-label="Close"
                          >
                            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 space-y-3 md:space-y-4">
                          {creditCustomerError && (
                            <div className="text-xs md:text-sm text-red-600">{creditCustomerError}</div>
                          )}
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">Name *</label>
                            <input
                              type="text"
                              value={creditCustomerName}
                              onChange={(e) => setCreditCustomerName(e.target.value)}
                              placeholder="Credit customer name"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">Phone *</label>
                            <input
                              type="tel"
                              value={creditCustomerPhone}
                              onChange={(e) => setCreditCustomerPhone(e.target.value)}
                              placeholder="Phone number"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1.5">Email (optional)</label>
                            <input
                              type="email"
                              value={creditCustomerEmail}
                              onChange={(e) => setCreditCustomerEmail(e.target.value)}
                              placeholder="Email address"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
                            />
                          </div>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 border-t border-gray-200 flex justify-end gap-2 md:gap-3">
                          <button
                            className="px-4 py-2.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 active:scale-95 transition text-sm"
                            onClick={() => {
                              setCreditCustomerModalOpen(false);
                              setCreditCustomerError('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="px-4 py-2.5 rounded-md bg-orange-600 text-white hover:bg-orange-700 active:scale-95 transition text-sm"
                            onClick={async () => {
                              // Validate required fields: name and phone
                              if (!creditCustomerName.trim()) {
                                setCreditCustomerError('Name is required.');
                                return;
                              }
                              if (!creditCustomerPhone.trim()) {
                                setCreditCustomerError('Phone is required.');
                                return;
                              }

                              try {
                                // Check if credit customer already exists
                                const creditCustomersRef = getCollectionRef('creditCustomers');
                                const q = query(creditCustomersRef, where('phone', '==', creditCustomerPhone.trim()));
                                const existingCreditCustomers = await getDocs(q);

                                if (!existingCreditCustomers.empty) {
                                  setCreditCustomerError('Credit customer with this phone number already exists.');
                                  return;
                                }

                                // Create new credit customer
                                const creditCustomerData = {
                                  name: creditCustomerName.trim(),
                                  phone: creditCustomerPhone.trim(),
                                  email: creditCustomerEmail.trim(),
                                  homeStoreId: currentStore?.id || '',
                                  homeStoreName: currentStore?.name || '',
                                  createdAt: Timestamp.now(),
                                  updatedAt: serverTimestamp(),
                                  createdBy: currentUser?.displayName || currentUser?.email || 'Unknown User',
                                };

                                const docRef = await addDoc(getCollectionRef('creditCustomers'), creditCustomerData);

                                // Add to local state
                                setCreditCustomers(prev => [{
                                  id: docRef.id,
                                  name: creditCustomerData.name,
                                  phone: creditCustomerData.phone,
                                  email: creditCustomerData.email,
                                }, ...prev]);

                                setCreditCustomerError('');
                                const display = `${creditCustomerName.trim()} • ${creditCustomerPhone.trim()}${creditCustomerEmail.trim() ? ` • ${creditCustomerEmail.trim()}` : ''} `;
                                setCreditCustomerDisplay(display);
                                setCreditCustomerModalOpen(false);

                                // Clear form
                                setCreditCustomerName('');
                                setCreditCustomerPhone('');
                                setCreditCustomerEmail('');

                                success('Credit customer saved successfully!');
                              } catch (error) {
                                console.error('Error saving credit customer:', error);
                                setCreditCustomerError('Failed to save credit customer. Please try again.');
                              }
                            }}
                          >
                            Save Credit Customer
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Product Search Modal - Mobile Only */}
                  {showProductSearchModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-xl p-4">
                      <div className="w-full max-w-lg bg-white rounded-lg shadow-lg max-h-[90vh] flex flex-col">
                        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                          <h4 className="text-sm md:text-base font-semibold text-gray-900 flex items-center gap-2">
                            <span>Search Product</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              gstEnabled
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-blue-100 text-blue-800 border border-blue-300'
                            }`}>
                              {gstEnabled ? 'GST Products' : 'Non-GST Products'}
                            </span>
                          </h4>
                          <button
                            className="p-2 rounded hover:bg-gray-100 active:scale-95 transition"
                            onClick={() => {
                              setShowProductSearchModal(false);
                              setSearchText('');
                            }}
                            aria-label="Close"
                          >
                            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 space-y-3 flex-1 overflow-hidden flex flex-col">
                          <div className="relative flex-shrink-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={searchText}
                              onChange={(e) => setSearchText(e.target.value)}
                              placeholder={
                                gstEnabled
                                  ? "Search GST products by name, code, brand, or IMEI"
                                  : "Search non-GST products by name, code, brand, or IMEI"
                              }
                              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
                              autoFocus
                            />
                          </div>
                          <div className="flex-1 overflow-auto border border-gray-200 rounded-md">
                            {loadingProducts ? (
                              <div className="p-4 text-sm text-gray-500 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-600 mr-2"></div>
                                Loading products...
                              </div>
                            ) : filteredProducts.length === 0 ? (
                              <div className="p-4 text-xs md:text-sm text-gray-500">
                                {searchText
                                  ? (gstEnabled ? 'No GST products found matching your search.' : 'No non-GST products found matching your search.')
                                  : (gstEnabled ? 'Start typing to search GST products.' : 'Start typing to search non-GST products.')
                                }
                              </div>
                            ) : (
                              <ul className="divide-y divide-gray-200">
                                {filteredProducts.map((p: any) => (
                                  <li
                                    key={p.id}
                                    className="p-3 hover:bg-orange-50 cursor-pointer active:bg-orange-100 transition"
                                    onClick={() => {
                                      selectProductForDetails({
                                        id: p.id,
                                        name: p.name,
                                        productCode: p.productCode,
                                        brand: p.brand,
                                        category: p.category,
                                        mrp: Number(p.mrp ?? 0),
                                        cost: Number(p.cost ?? 0),
                                        baseCost: Number(p.baseCost ?? p.cost ?? 0),
                                        price: Number(p.sellingPrice ?? p.mrp ?? p.price ?? 0),
                                        quantity: Number(p.quantity ?? 0),
                                        imei: p.imei || undefined,
                                        hsnCode: p.hsnCode || p.hcsCode || undefined,
                                        mop: p.mop,
                                        taxPercent: p.taxPercent,
                                        gstEnabled: p.gstEnabled,
                                        highestDiscountLimit: p.highestDiscountLimit
                                      });
                                      setShowProductSearchModal(false);
                                      setSearchText('');
                                    }}
                                  >
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs md:text-sm font-medium text-gray-900 truncate">{p.name}</div>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                          {p.productCode && (
                                            <span className="inline-flex items-center px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-600 font-mono">
                                              {p.productCode}
                                            </span>
                                          )}
                                          {p.imei && (
                                            <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-100 rounded text-[10px] text-blue-700 font-mono">
                                              {p.imei}
                                            </span>
                                          )}
                                          {p.brand && (
                                            <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-50 rounded text-[10px] text-blue-700">
                                              {p.brand}
                                            </span>
                                          )}
                                          {(p.gstEnabled || (p.taxPercent && p.taxPercent > 0)) && (
                                            <span className="inline-flex items-center px-1.5 py-0.5 bg-emerald-50 rounded text-[10px] text-emerald-700 font-medium">
                                              GST {p.taxPercent || 18}%
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-right ml-2">
                                        <div className="text-sm font-bold text-gray-900">₹{Number(p.sellingPrice ?? p.mrp ?? p.price ?? 0)}</div>
                                        {p.mrp && p.mrp !== Number(p.sellingPrice ?? p.price ?? 0) && (
                                          <div className="text-[10px] text-gray-500">MRP: ₹{p.mrp}</div>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] text-gray-500">
                                      <span className={`font-medium ${p.quantity > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                        Stock: {p.quantity}
                                      </span>
                                      {typeof p.cost === 'number' && (
                                        <span className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                                          Cost: {encodeSecret(p.cost)}
                                        </span>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        <div className="px-4 md:px-6 py-3 md:py-4 border-t border-gray-200 flex justify-end flex-shrink-0">
                          <button
                            className="px-4 py-2.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 active:scale-95 transition text-sm"
                            onClick={() => {
                              setShowProductSearchModal(false);
                              setSearchText('');
                            }}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Fixed Right Sidebar - Order Details */}
            <aside className={`
              fixed md:relative inset-x-0 bottom-0 md:inset-auto
              w-full md:w-[380px] lg:w-[420px] xl:w-[480px]
              bg-white border-t md:border-t-0 md:border-l border-gray-200
              flex flex-col flex-shrink-0
              max-h-[85vh] md:max-h-full md:h-full
              transition-transform duration-300 ease-in-out
              ${showMobileOrderPanel ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}
              z-40 md:z-auto
              rounded-t-2xl md:rounded-none
              shadow-2xl md:shadow-none
      `}>
              {/* Mobile Header with Close Button */}
              <div className="md:hidden flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl flex-shrink-0">
                <h3 className="text-base font-semibold text-gray-900">Order Details ({orderItems.length} items)</h3>
                <button
                  onClick={() => setShowMobileOrderPanel(false)}
                  className="p-2 hover:bg-gray-200 rounded-lg transition active:scale-95"
                  aria-label="Close order details"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Scrollable Order Items Section */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-4 md:p-6 pb-6 md:pb-6">
                  <div className="hidden md:flex items-center justify-between mb-3 md:mb-4">
                    <h3 className="text-base md:text-lg font-semibold text-gray-900">Order Details</h3>
                    <span className="text-xs md:text-sm text-gray-500">Items: {orderItems.length}</span>
                  </div>

                  <div className="mb-4">
                    <div className="overflow-x-auto hidden md:block">
                      <table className="min-w-full table-fixed">
                        <colgroup>
                          <col style={{ width: hasGstActive ? '36%' : '44%' }} />
                          <col style={{ width: hasGstActive ? '20%' : '22%' }} />
                          <col style={{ width: hasGstActive ? '12%' : '14%' }} />
                          <col style={{ width: hasGstActive ? '12%' : '14%' }} />
                          {hasGstActive && <col style={{ width: '12%' }} />}
                          <col style={{ width: hasGstActive ? '12%' : '14%' }} />
                          <col style={{ width: '2%' }} />
                        </colgroup>
                        <thead>
                          <tr className="text-xs text-gray-600">
                            <th className="text-left font-medium py-2">Product</th>
                            <th className="text-left font-medium py-2">Product Code</th>
                            <th className="text-right font-medium py-2 pr-2">Price</th>
                            <th className="text-center font-medium py-2">QTY</th>
                            {hasGstActive && <th className="text-right font-medium py-2 pr-2">GST</th>}
                            <th className="text-right font-medium py-2 pr-2">Sub total</th>
                            <th className="py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="align-middle">
                          {orderItems.map(item => (
                            <tr key={item.id} className="text-sm border-t border-gray-200">
                              <td className="py-2 max-w-0 overflow-hidden">
                                <div className="w-full">
                                  <p className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</p>
                                  {item.imei && <p className="text-[10px] text-blue-600 font-mono">IMEI: {item.imei}</p>}
                                  <p className="text-[10px] text-gray-500">In Stock: {item.stock}</p>
                                </div>
                              </td>
                              <td className="py-2 text-gray-700 whitespace-nowrap font-mono">{item.code}</td>
                              <td className="py-2 text-right text-gray-900 pr-2 whitespace-nowrap">₹{item.price}</td>
                              <td className="py-2">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => updateQuantity(item.id, 1)}
                                    className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                  <span className="w-6 text-center">{item.quantity}</span>
                                  <button
                                    onClick={() => updateQuantity(item.id, -1)}
                                    className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                              {hasGstActive && (
                                <td className="py-2 text-right text-emerald-600 pr-2 whitespace-nowrap">
                                  {(item.gstEnabled !== false && (item.gstEnabled || gstEnabled)) ? (
                                    <>
                                      <p className="text-[10px] text-gray-400 leading-none">{item.taxPercent || gstRate}%</p>
                                      ₹{(item.price * item.quantity - ((item.price * item.quantity) / (1 + (item.taxPercent || gstRate) / 100))).toFixed(2)}
                                    </>
                                  ) : (
                                    <span className="text-xs text-gray-400">0%</span>
                                  )}
                                </td>
                              )}
                              <td className="py-2 text-right text-gray-900 pr-2 whitespace-nowrap">₹{item.price * item.quantity}</td>
                              <td className="py-2">
                                <div className="flex justify-end">
                                  <button
                                    onClick={() => removeItem(item.id)}
                                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Order List (Card View) */}
                    <div className="md:hidden space-y-3">
                      {orderItems.length === 0 ? (
                        <div className="text-center py-4 text-gray-500 text-sm">No items added</div>
                      ) : (
                        orderItems.map(item => (
                          <div key={item.id} className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1 min-w-0 pr-2">
                                <p className="font-medium text-gray-900 truncate" title={item.name}>{item.name}</p>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <span className="px-1.5 py-0.5 bg-white border border-gray-200 text-[10px] rounded text-gray-500 font-mono">
                                    {item.code || 'N/A'}
                                  </span>
                                  {item.imei && (
                                    <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-[10px] rounded text-blue-600 font-mono font-bold">
                                      IMEI: {item.imei}
                                    </span>
                                  )}
                                  <span className="text-xs text-gray-500">Stock: {item.stock}</span>
                                  {hasGstActive && (
                                    <span className="text-xs text-emerald-600 font-medium px-1.5 py-0.5 bg-emerald-50 rounded border border-emerald-100">
                                      GST ({item.gstEnabled !== false && (item.gstEnabled || gstEnabled) ? `${item.taxPercent || gstRate}%` : '0%'}): ₹{((item.gstEnabled !== false && (item.gstEnabled || gstEnabled)) ? (item.price * item.quantity - ((item.price * item.quantity) / (1 + (item.taxPercent || gstRate) / 100))) : 0).toFixed(2)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-gray-900">₹{item.price * item.quantity}</p>
                                <p className="text-xs text-gray-500">₹{item.price}/unit</p>
                              </div>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => updateQuantity(item.id, -1)}
                                  className="w-7 h-7 rounded-lg border border-gray-300 bg-white flex items-center justify-center hover:bg-gray-50 active:scale-95 transition"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="w-6 text-center font-medium">{item.quantity}</span>
                                <button
                                  onClick={() => updateQuantity(item.id, 1)}
                                  className="w-7 h-7 rounded-lg border border-gray-300 bg-white flex items-center justify-center hover:bg-gray-50 active:scale-95 transition"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              <button
                                onClick={() => removeItem(item.id)}
                                className="w-7 h-7 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-lg transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* Fixed Bottom Section - Total, Payment, Export */}
              <div className="p-4 pb-24 md:pb-4 lg:p-5 border-t border-gray-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] flex-shrink-0 max-h-[70vh] md:max-h-none overflow-y-auto">
                {/* Total Summary */}
                <div className="space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Sub Total</span>
                    <span className="font-medium text-gray-900">₹{subTotal}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-red-500 flex items-center text-xs sm:text-sm">
                      Discount <ExternalLink className="w-3 h-3 ml-1" />
                    </span>
                    <span className="font-medium text-red-500">-₹{discount}</span>
                  </div>
                  {(hasGstActive || gstAmount > 0) && (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Base Amount</span>
                        <span className="font-medium text-gray-900">₹{baseAmount}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">{gstEnabled ? `GST (${gstRate}%)` : 'Total GST'}</span>
                        <span className="font-medium text-emerald-600">₹{gstAmount}</span>
                      </div>
                    </>
                  )}
                  {/* Round Off */}
                  <div className="flex justify-between items-center pt-1.5 border-t border-dashed border-gray-200">
                    <div className="flex items-center gap-1.5">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={roundOffEnabled}
                          onChange={(e) => setRoundOffEnabled(e.target.checked)}
                          className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-gray-600 font-medium">Round Off</span>
                      </label>
                      {roundOffEnabled && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isAutoRoundOff) {
                              setManualRoundOff(String(roundOffAmount));
                            }
                            setIsAutoRoundOff(!isAutoRoundOff);
                          }}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                            isAutoRoundOff
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          }`}
                          title={isAutoRoundOff ? 'Click for manual round off' : 'Click for auto round off'}
                        >
                          {isAutoRoundOff ? 'Auto' : 'Manual'}
                        </button>
                      )}
                    </div>
                    {roundOffEnabled ? (
                      isAutoRoundOff ? (
                        <span className={`font-medium ${roundOffAmount < 0 ? 'text-red-500' : roundOffAmount > 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
                          {roundOffAmount > 0 ? `+₹${roundOffAmount.toFixed(2)}` : roundOffAmount < 0 ? `-₹${Math.abs(roundOffAmount).toFixed(2)}` : '₹0.00'}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            value={manualRoundOff}
                            onChange={(e) => setManualRoundOff(e.target.value)}
                            placeholder="0.00"
                            className="w-20 px-1.5 py-0.5 text-right font-medium text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none"
                          />
                        </div>
                      )
                    ) : (
                      <span className="text-gray-400 font-medium">₹0.00</span>
                    )}
                  </div>
                  <div className="flex justify-between items-center pt-2.5 mt-2.5 border-t border-gray-200">
                    <span className="text-gray-900 font-semibold text-sm sm:text-base">Grand Total</span>
                    <span className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">
                      ₹{grandTotal % 1 !== 0 ? grandTotal.toFixed(2) : grandTotal}
                    </span>
                  </div>
                </div>

                {/* Payment Selection */}
                <div className="mt-3 md:mt-5 mobile-compact-section" id="billing-payment-section">
                  <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-1.5 md:mb-2.5 mobile-compact-heading">Select Payment</h4>
                  <div className="grid grid-cols-5 md:grid-cols-5 lg:grid-cols-5 gap-1.5 md:gap-2">
                    {[
                      { id: 'cash', label: 'Cash', icon: cashIcon },
                      { id: 'upi', label: 'UPI', icon: upiIcon },
                      { id: 'card', label: 'Card', icon: cardIcon },
                      { id: 'split', label: 'Split', icon: null },
                      { id: 'finance', label: 'EMI', icon: null },
                    ].map(payment => (
                      <div key={payment.id} className="relative">
                        <button
                          onClick={() => {
                            if (payment.id === 'finance') {
                              openFinanceModal();
                              return;
                            }
                            setSelectedPayment(payment.id as PaymentMode);
                          }}
                          className={`w-full p-1.5 md:p-2.5 sm:p-3 rounded-md md:rounded-lg border-2 transition flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 min-h-[40px] md:min-h-[44px] sm:min-h-[48px] ${selectedPayment === payment.id
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                            }`}
                        >
                          {payment.icon ? (
                            <img src={payment.icon} alt={payment.label} className="w-4 h-4 md:w-5 md:h-5 sm:w-6 sm:h-6 object-contain" />
                          ) : payment.id === 'split' ? (
                            <svg className="w-4 h-4 md:w-5 md:h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                          ) : payment.id === 'finance' ? (
                            <svg className="w-4 h-4 md:w-5 md:h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-2.2 0-4 .9-4 2s1.8 2 4 2 4 .9 4 2-1.8 2-4 2m0-8V6m0 10v2m9-6a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          ) : null}
                          <span className="text-[10px] md:text-xs sm:text-sm font-medium">{payment.label}</span>
                        </button>
                        {/* Show QR button for UPI when QR code is generated */}
                        {payment.id === 'upi' && upiQrCode && (
                          <button
                            onClick={() => setShowQrModal(true)}
                            className="absolute -top-1 -right-1 p-1 md:p-1.5 sm:p-2 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all active:scale-95 z-10"
                            title="Show QR Code"
                          >
                            <QrCode className="w-3 h-3 md:w-3.5 md:h-3.5 sm:w-4 sm:h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Split payment inputs */}
                {selectedPayment === 'split' && (
                  <div className="mt-2 md:mt-3 p-2 md:p-3 sm:p-4 bg-gray-50 rounded-md md:rounded-lg border border-gray-200 mobile-compact-section">
                    <div className="flex items-center justify-between mb-1.5 md:mb-2.5">
                      <span className="text-[10px] md:text-xs sm:text-sm text-gray-600 font-medium">Total Amount</span>
                      <span className="text-sm md:text-base sm:text-lg font-bold text-teal-700">₹{Math.round(grandTotal).toFixed(0)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 md:gap-2.5 sm:gap-3">
                      <div className="flex flex-col">
                        <label className="mb-1 text-[10px] md:text-xs sm:text-sm text-gray-700 font-semibold">Cash</label>
                        <div className="relative">
                          <span className="absolute left-1.5 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-[10px] md:text-xs sm:text-sm">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cashAmount}
                            onChange={(e) => setCashAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-5 md:pl-7 pr-1.5 md:pr-2.5 py-1.5 md:py-2 border-2 border-gray-200 rounded-md md:rounded-lg text-xs md:text-sm mobile-compact-input focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1 text-[10px] md:text-xs sm:text-sm text-gray-700 font-semibold">UPI</label>
                        <div className="relative">
                          <span className="absolute left-1.5 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-[10px] md:text-xs sm:text-sm">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={upiAmount}
                            onChange={(e) => setUpiAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-5 md:pl-7 pr-1.5 md:pr-2.5 py-1.5 md:py-2 border-2 border-gray-200 rounded-md md:rounded-lg text-xs md:text-sm mobile-compact-input focus:outline-none focus:ring-2 focus:ring-orange-400"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <label className="mb-1 text-[10px] md:text-xs sm:text-sm text-gray-700 font-semibold">Card</label>
                        <div className="relative">
                          <span className="absolute left-1.5 md:left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-[10px] md:text-xs sm:text-sm">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cardAmount}
                            onChange={(e) => setCardAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-5 md:pl-7 pr-1.5 md:pr-2.5 py-1.5 md:py-2 border-2 border-gray-200 rounded-md md:rounded-lg text-xs md:text-sm mobile-compact-input focus:outline-none focus:ring-2 focus:ring-orange-400"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="mt-1.5 md:mt-2.5 p-1.5 md:p-2.5 bg-white rounded-md md:rounded-lg border border-gray-200 flex justify-between items-center">
                      <span className="text-[10px] md:text-xs sm:text-sm text-gray-600 font-medium">Split Total</span>
                      <span className={`font-bold text-sm md:text-base sm:text-lg ${Math.abs((parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(cardAmount) || 0) - (Number(grandTotal) || 0)) < 0.01
                        ? 'text-green-600'
                        : 'text-red-600'
                        }`}>
                        ₹{Math.round((parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(cardAmount) || 0)).toFixed(0)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Finance / EMI summary */}
                {selectedPayment === 'finance' && (
                  <div className="mt-2 md:mt-3 p-2 md:p-3 sm:p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-md md:rounded-lg border border-blue-200 mobile-compact-section shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <p className="text-[10px] md:text-xs uppercase tracking-wide text-blue-700 font-semibold">Finance Details Saved</p>
                        <p className="text-xs text-gray-600">Processing fee is shown separately and not added to the bill total.</p>
                      </div>
                      <button
                        type="button"
                        onClick={openFinanceModal}
                        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition shadow-sm"
                      >
                        Edit
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 text-xs md:text-sm">
                      <div className="flex justify-between items-center bg-white rounded-md border border-blue-100 px-2.5 py-2 shadow-sm">
                        <span className="text-gray-600 font-medium">Finance Name</span>
                        <span className="font-semibold text-gray-900">{financeProvider || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white rounded-md border border-blue-100 px-2.5 py-2 shadow-sm">
                        <span className="text-gray-600 font-medium">Tenure</span>
                        <span className="font-semibold text-gray-900">{financeTenureMonths || 0} months</span>
                      </div>
                      <div className="flex justify-between items-center bg-white rounded-md border border-blue-100 px-2.5 py-2 shadow-sm">
                        <span className="text-gray-600 font-medium">Down Payment</span>
                        <span className="font-semibold text-gray-900">₹{Math.round(parseFloat(financeDownPayment) || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white rounded-md border border-blue-100 px-2.5 py-2 shadow-sm">
                        <span className="text-gray-600 font-medium">Processing Fee</span>
                        <span className="font-semibold text-gray-900">₹{Math.round(parseFloat(financeProcessingFee) || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white rounded-md border border-blue-100 px-2.5 py-2 sm:col-span-2 shadow-sm">
                        <span className="text-gray-600 font-medium">Financed Amount</span>
                        <span className="font-semibold text-gray-900">₹{Math.round(financeAmount)}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white rounded-md border border-blue-100 px-2.5 py-2 sm:col-span-2 shadow-sm">
                        <span className="text-gray-600 font-medium">Approx. Monthly EMI</span>
                        <span className="font-semibold text-blue-700">₹{monthlyEmi}</span>
                      </div>
                    </div>
                  </div>
                )}

                {showFinanceModal && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-6">
                    <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-blue-100 overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                        <div>
                          <h4 className="text-lg font-bold">Finance Details</h4>
                          <p className="text-xs text-blue-100">Processing fee stays separate from the bill total.</p>
                        </div>
                        <button
                          type="button"
                          onClick={closeFinanceModal}
                          className="p-2 rounded-full hover:bg-white/15 transition"
                          aria-label="Close finance modal"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="p-5 space-y-4">
                        <div>
                          <label className="block mb-1.5 text-sm font-semibold text-gray-700">Finance Name</label>
                          <select
                            value={financeProviderDraft}
                            onChange={(e) => setFinanceProviderDraft(e.target.value)}
                            className="w-full px-3 py-2.5 border-2 border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                          >
                            <option value="">Select Provider</option>
                            {financeProviders.map(fp => (
                              <option key={fp.id} value={fp.name}>{fp.name}</option>
                            ))}
                            {financeProviders.length === 0 && !loadingFinance && (
                              <option value="BAJAJ">BAJAJ (Default)</option>
                            )}
                          </select>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block mb-1.5 text-sm font-semibold text-gray-700">Tenure (Months)</label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={financeTenureDraft}
                              onChange={(e) => setFinanceTenureDraft(e.target.value === '' ? '' : Number(e.target.value))}
                              placeholder="6"
                              className="w-full px-3 py-2.5 border-2 border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                            />
                          </div>
                          <div>
                            <label className="block mb-1.5 text-sm font-semibold text-gray-700">Down Payment</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={financeDownPaymentDraft}
                                onChange={(e) => setFinanceDownPaymentDraft(e.target.value)}
                                placeholder="0"
                                className="w-full pl-7 pr-3 py-2.5 border-2 border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block mb-1.5 text-sm font-semibold text-gray-700">Processing Fee</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={financeProcessingFeeDraft}
                              onChange={(e) => setFinanceProcessingFeeDraft(e.target.value)}
                              placeholder="0"
                              className="w-full pl-7 pr-3 py-2.5 border-2 border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                            />
                          </div>
                          <p className="mt-1 text-xs text-gray-500">This amount is shown separately and is not part of the grand total.</p>
                        </div>

                        <div className="rounded-md border border-blue-100 bg-blue-50 p-4 space-y-2 text-sm shadow-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600 font-medium">Financed Amount</span>
                            <span className="font-semibold text-gray-900">₹{Math.round(Math.max(0, (Number(grandTotal) || 0) - (parseFloat(financeDownPaymentDraft) || 0)))}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600 font-medium">Approx. Monthly EMI</span>
                            <span className="font-semibold text-blue-700">₹{typeof financeTenureDraft === 'number' && financeTenureDraft > 0 ? Math.round(Math.max(0, (Number(grandTotal) || 0) - (parseFloat(financeDownPaymentDraft) || 0)) / financeTenureDraft) : 0}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600 font-medium">Processing Fee</span>
                            <span className="font-semibold text-gray-900">₹{Math.round(parseFloat(financeProcessingFeeDraft) || 0)}</span>
                          </div>
                        </div>

                        <div className="flex gap-3 pt-1">
                          <button
                            type="button"
                            onClick={closeFinanceModal}
                            className="flex-1 rounded-md border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition shadow-sm"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={confirmFinanceModal}
                            className="flex-1 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:from-blue-700 hover:to-indigo-700 transition shadow-sm"
                          >
                            Save Finance Details
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Export Buttons */}
                <div className="mt-5">
                  <h4 className="text-xs sm:text-sm font-semibold text-gray-900 mb-2.5">Export</h4>
                  <div className="grid grid-cols-2 gap-2 sm:gap-2.5 mb-2 sm:mb-2.5">
                    <button className="py-2.5 sm:py-3 bg-blue-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-blue-700 transition flex items-center justify-center gap-1.5 sm:gap-2" onClick={saveOrder}>
                      <span>{isEditMode ? 'Update' : 'Save'}</span>
                      <span className="hidden sm:inline text-[10px] bg-blue-500 px-1.5 py-0.5 rounded text-white/90">Ctrl+Enter</span>
                    </button>
                    <button className="py-2.5 sm:py-3 bg-white border-2 border-blue-600 text-blue-600 rounded-lg text-xs sm:text-sm font-medium hover:bg-blue-50 transition flex items-center justify-center gap-1.5" onClick={handleDownloadInvoice}>
                      <Download className="w-4 h-4" />
                      <span>Download</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1 sm:gap-2 lg:gap-2.5">
                    <button className="py-2 sm:py-3 bg-white border border-gray-200 text-gray-700 rounded-lg text-[10px] sm:text-xs md:text-[10px] lg:text-xs xl:text-sm font-medium hover:bg-gray-50 transition flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 md:gap-1" onClick={handlePrintInvoice}>
                      <Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-3 md:h-3 lg:w-4 lg:h-4" />
                      <span>Print</span>
                    </button>
                    <button disabled className="py-2 sm:py-3 bg-white border border-gray-200 text-gray-700 rounded-lg text-[10px] sm:text-xs md:text-[10px] lg:text-xs xl:text-sm font-medium hover:bg-gray-50 transition flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 md:gap-1 opacity-50 cursor-not-allowed" onClick={handleQuickWhatsApp}>
                      <img src={whatsappIcon} alt="WhatsApp" className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-3 md:h-3 lg:w-4 lg:h-4" />
                      <span>WhatsApp</span>
                    </button>
                    <button disabled className="py-2 sm:py-3 bg-white border border-gray-200 text-gray-700 rounded-lg text-[10px] sm:text-xs md:text-[10px] lg:text-xs xl:text-sm font-medium hover:bg-gray-50 transition flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 md:gap-1 opacity-50 cursor-not-allowed">
                      <img src={gmailIcon} alt="Gmail" className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-3 md:h-3 lg:w-4 lg:h-4" />
                      <span>Email</span>
                    </button>
                    <button className="py-2 sm:py-3 bg-white border border-gray-200 text-gray-700 rounded-lg text-[10px] sm:text-xs md:text-[10px] lg:text-xs xl:text-sm font-medium hover:bg-gray-50 transition flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 md:gap-1" onClick={handleShareInvoice}>
                      <Share2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-3 md:h-3 lg:w-4 lg:h-4" />
                      <span>Share</span>
                    </button>
                  </div>
                </div>
              </div>

            </aside>
          </main>

          {/* Mobile Backdrop Overlay */}
          {showMobileOrderPanel && (
            <div
              className="md:hidden fixed inset-0 bg-transparent backdrop-blur-xl z-30 transition-opacity"
              onClick={() => setShowMobileOrderPanel(false)}
            />
          )}
        </div>

        {/* Share Modal */}
        {lastBillingItem && shopDetails && (
          <ShareModal
            isOpen={isShareModalOpen}
            onClose={() => setIsShareModalOpen(false)}
            item={lastBillingItem}
            shopDetails={shopDetails}
          />
        )}
        {/* Mobile Sticky Footer */}
        <div className="md:hidden fixed bottom-20 left-3 right-3 bg-white border border-gray-200 rounded-xl shadow-2xl z-30 p-3 transition-transform duration-300">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-gray-500 mb-0.5">{orderItems.length} Items • Total</p>
              <p className="text-lg font-bold text-gray-900 leading-none">₹{Math.round(grandTotal)}</p>
            </div>
            <button
              onClick={() => setShowMobileOrderPanel(true)}
              className="relative flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-semibold shadow-md active:scale-95 transition text-sm whitespace-nowrap"
            >
              {orderItems.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {orderItems.length}
                </span>
              )}
              <span>View Order</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* QR Code Modal - Minimal & Professional */}
      {showQrModal && upiQrCode && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="bg-white rounded-xl overflow-hidden w-full max-w-sm lg:max-w-3xl relative shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-gray-100 transition-colors z-10"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>

            {/* Main Content - 2 Column Layout for Desktop */}
            <div className="flex flex-col lg:flex-row">
              {/* Left Column - QR Code & Info */}
              <div className="p-6 lg:p-8 w-full lg:w-[320px] flex flex-col items-center lg:border-r border-gray-100 flex-shrink-0">
                {/* Shop Header */}
                {shopDetails && (
                  <div className="flex items-center gap-3 mb-6 w-full">
                    <img src={logoImg} alt="Logo" className="w-10 h-10 object-contain" />
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-gray-900 truncate">{shopDetails.shopName}</h2>
                      <p className="text-xs text-gray-500">{shopDetails.phone}</p>
                    </div>
                  </div>
                )}

                {/* QR Code */}
                <div className="bg-white p-2 rounded-lg border border-gray-200 mb-4">
                  <img src={upiQrCode} alt="UPI QR Code" className="w-48 h-48" />
                </div>

                {/* Amount */}
                <p className="text-3xl font-bold text-gray-900 mb-1">₹{grandTotal.toLocaleString('en-IN')}</p>
                <p className="text-xs text-gray-500 mb-4">Amount to Pay</p>

                {/* UPI ID */}
                {shopDetails?.upiId && (
                  <div className="w-full text-center pt-4 border-t border-gray-100">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">UPI ID</p>
                    <p className="text-sm font-medium text-gray-700">{shopDetails.upiId}</p>
                  </div>
                )}

                {/* Scan instruction - Mobile only */}
                <p className="lg:hidden text-xs text-gray-400 mt-4">Scan with any UPI app</p>
              </div>

              {/* Right Column - Animation & Products (Desktop Only) */}
              <div className="hidden lg:flex lg:flex-col flex-1 p-6 bg-gray-50/50">
                {/* Animation */}
                <div className="flex items-center justify-center flex-1">
                  <Lottie animationData={PaymentAnim} loop={true} className="w-52 h-52" />
                </div>

                {/* Order Items */}
                {orderItems.length > 0 && (
                  <div className="mt-4 bg-white rounded-lg p-4 border border-gray-100">
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-sm font-medium text-gray-700">Order Items</p>
                      <span className="text-xs text-gray-400">{orderItems.length} items</span>
                    </div>
                    <div className="space-y-2 max-h-28 overflow-y-auto">
                      {orderItems.map((item, index) => (
                        <div key={index} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate pr-3">{item.name} <span className="text-gray-400">×{item.quantity}</span></span>
                          <span className="text-gray-900 font-medium whitespace-nowrap">₹{(item.quantity * item.price).toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center pt-3 mt-3 border-t border-gray-100">
                      <span className="text-sm font-medium text-gray-700">Total</span>
                      <span className="text-base font-semibold text-gray-900">₹{grandTotal.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                )}

                {/* Scan instruction - Desktop */}
                <p className="text-xs text-gray-400 text-center mt-4">Scan with any UPI app to pay</p>
              </div>

              {/* Mobile: Show products */}
              {orderItems.length > 0 && (
                <div className="lg:hidden border-t border-gray-100 px-5 py-4">
                  <div className="flex justify-between items-center text-sm mb-2">
                    <span className="text-gray-600">{orderItems.length} items</span>
                    <span className="font-semibold text-gray-900">₹{grandTotal.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Share Modal - WhatsApp/Email Invoice Sharing */}
      {isShareModalOpen && lastBillingItem && shopDetails && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          item={lastBillingItem}
          shopDetails={shopDetails}
          shareType={shareType}
          initialCustomerName={
            lastBillingItem.customerName && lastBillingItem.customerName !== 'Walk In Customer'
              ? lastBillingItem.customerName
              : (customerDisplay !== 'Walk In Customer' ? customerDisplay.split(' • ')[0] || '' : '')
          }
          initialCustomerPhone={
            lastBillingItem.customerPhone || (customerDisplay !== 'Walk In Customer' && customerDisplay.includes(' • ') ? customerDisplay.split(' • ')[1] || '' : '')
          }
          initialCustomerEmail={
            lastBillingItem.customerEmail || (customerDisplay !== 'Walk In Customer' && customerDisplay.split(' • ').length > 2 ? customerDisplay.split(' • ')[2] || '' : '')
          }
        />
      )}

      {/* Bill Saved Action Modal - Minimal, Modern & Clean */}
      {showBillSavedModal && lastBillingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-[390px] bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 relative flex flex-col animate-in zoom-in-95 duration-200">
            {/* Close Button */}
            <button
              onClick={() => {
                setShowBillSavedModal(false);
                if (isEditMode) navigate('/overall-sales');
              }}
              className="absolute right-4 top-4 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 active:scale-95 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header: Minimal Check & Status */}
            <div className="text-center pt-1">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mb-3 shadow-xs">
                <Check className="w-6 h-6 stroke-[2.5]" />
              </div>

              <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                {savedSuccessMsg || (isEditMode ? 'Bill Updated Successfully!' : 'Bill Saved Successfully!')}
              </h3>

              <div className="mt-1.5 flex justify-center">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-slate-100 text-slate-600 border border-slate-200/60">
                  Invoice #{lastBillingItem.transactionId || lastBillingItem.id || 'N/A'}
                </span>
              </div>
            </div>

            {/* Hero Amount */}
            <div className="text-center my-4 py-3 border-y border-slate-100">
              <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                ₹{(lastBillingItem.sellingPrice || lastBillingItem.totalWithGst || 0).toLocaleString('en-IN')}
              </div>
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-0.5">Grand Total</p>
            </div>

            {/* Bill Summary Breakdown */}
            <div className="bg-slate-50/80 rounded-2xl p-3.5 border border-slate-100 space-y-2 text-xs mb-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Customer</span>
                <span className="font-semibold text-slate-900 truncate max-w-[190px]">
                  {lastBillingItem.customerName || 'Walk In Customer'}
                </span>
              </div>
              {lastBillingItem.customerPhone && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Phone</span>
                  <span className="font-mono text-slate-800 font-medium">{lastBillingItem.customerPhone}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Payment Mode</span>
                <span className="font-semibold uppercase px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-700 text-[10px] tracking-wide">
                  {lastBillingItem.paymentMode || 'cash'}
                </span>
              </div>
              {lastBillingItem.roundOff !== undefined && lastBillingItem.roundOff !== 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Round Off</span>
                  <span className={`font-semibold ${lastBillingItem.roundOff < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {lastBillingItem.roundOff > 0 ? `+₹${lastBillingItem.roundOff.toFixed(2)}` : `-₹${Math.abs(lastBillingItem.roundOff).toFixed(2)}`}
                  </span>
                </div>
              )}
              {lastBillingItem.gstRate !== undefined && lastBillingItem.gstRate > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">GST Applied</span>
                  <span className="font-semibold text-emerald-700">
                    {lastBillingItem.gstRate}% (₹{(lastBillingItem.gstAmount || 0).toFixed(2)})
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons: 2x2 Grid + Done */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {/* Print Bill (Primary action) */}
                <button
                  type="button"
                  onClick={handlePrintInvoice}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-xs"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Bill</span>
                </button>

                {/* Download PDF */}
                <button
                  type="button"
                  onClick={handleDownloadInvoice}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 bg-white hover:bg-slate-50 active:scale-[0.98] border border-slate-200 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-2xs"
                >
                  <Download className="w-4 h-4 text-slate-500" />
                  <span>Download PDF</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* WhatsApp (Disabled) */}
                <button
                  type="button"
                  disabled
                  title="WhatsApp sharing disabled"
                  className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-50 border border-slate-200 text-slate-400 rounded-xl text-xs sm:text-sm font-semibold cursor-not-allowed opacity-60"
                >
                  <img src={whatsappIcon} alt="WhatsApp" className="w-4 h-4 grayscale opacity-60" />
                  <span>WhatsApp</span>
                </button>

                {/* Share / Email */}
                <button
                  type="button"
                  onClick={handleShareInvoice}
                  className="flex items-center justify-center gap-2 py-2.5 px-3 bg-white hover:bg-slate-50 active:scale-[0.98] border border-slate-200 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-2xs"
                >
                  <Share2 className="w-4 h-4 text-slate-500" />
                  <span>Share / Email</span>
                </button>
              </div>

              {/* Start New Bill / Done */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowBillSavedModal(false);
                    if (isEditMode) {
                      navigate('/overall-sales');
                    } else {
                      resetBillingState(false);
                    }
                  }}
                  className="w-full py-2.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/70 active:scale-[0.98] rounded-xl transition-all"
                >
                  {isEditMode ? 'Done & Return to Sales' : '+ Start New Bill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Loading Animation Overlay */}
      {isSaving && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/5 backdrop-blur-sm">
          <div className="w-64 h-64 md:w-80 md:h-80 bg-transparent flex flex-col items-center justify-center p-6">
            <Lottie animationData={OrderProcessingAnim} loop={true} className="w-48 h-48" />
            <p className="mt-4 text-lg font-semibold text-gray-700 animate-pulse">{isEditMode ? 'Updating Bill...' : 'Processing Order...'}</p>
          </div>
        </div>
      )}

      {showQRScanner && (
        <QRScannerModal
          isOpen={showQRScanner}
          onClose={() => setShowQRScanner(false)}
          onScanSuccess={(scannedResult: any) => {
            const raw = typeof scannedResult === 'string'
              ? scannedResult.trim().toLowerCase()
              : String(scannedResult?.productCode || scannedResult?.imei || scannedResult?.id || '').trim().toLowerCase();

            const matched = products.find((p: any) =>
              (p.id && String(p.id).toLowerCase() === raw) ||
              (p.productCode && String(p.productCode).toLowerCase() === raw) ||
              (p.imei && String(p.imei).toLowerCase() === raw)
            ) || (typeof scannedResult === 'object' && scannedResult?.id ? scannedResult : null);

            if (!matched) {
              showError(`No product found matching "${typeof scannedResult === 'string' ? scannedResult : 'scanned item'}".`);
              return;
            }

            const isGst = isGstProduct(matched);
            if (!gstEnabled && isGst) {
              showError(`"${matched.name}" is a GST product. Please switch to GST Sales to add it.`);
              return;
            }
            if (gstEnabled && !isGst) {
              showError(`"${matched.name}" is a non-GST product. Please switch to regular Sales to add it.`);
              return;
            }

            selectProductForDetails({
              id: matched.id,
              name: matched.name,
              productCode: matched.productCode,
              brand: matched.brand,
              category: matched.category,
              mrp: Number(matched.mrp ?? 0),
              cost: Number(matched.cost ?? 0),
              baseCost: Number(matched.baseCost ?? matched.cost ?? 0),
              price: Number(matched.sellingPrice ?? matched.mrp ?? matched.price ?? 0),
              quantity: Number(matched.quantity ?? 0),
              imei: matched.imei || undefined,
              hsnCode: matched.hsnCode || matched.hcsCode || undefined,
              mop: matched.mop,
              taxPercent: matched.taxPercent,
              gstEnabled: matched.gstEnabled,
              highestDiscountLimit: matched.highestDiscountLimit,
            });
            setShowQRScanner(false);
          }}
        />
      )}
    </>
  );
}

export default Billing;
