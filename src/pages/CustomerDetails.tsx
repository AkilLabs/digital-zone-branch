import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Phone,
  Mail,
  ArrowLeft,
  ShoppingBag,
  Search,
  MapPin,
  Calendar,
  Check,
  Copy,
  Receipt,
  ShoppingCart,
  Download,
  Share2,
  Building2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  MessageCircle,
  X,
  Sparkles,
  TrendingUp,
  Wallet,
  Clock,
  ShieldCheck,
  CreditCard
} from 'lucide-react';
import Navbar from '../components/Navbar';
import ShareModal from '../components/ShareModal';
import {
  getDoc,
  doc,
  query,
  where,
  getDocs,
  orderBy
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Customer, BillingItem, ShopDetails } from '../types';
import { generateInvoice } from '../utils/pdfGenerator';
import { useToastContext } from '../context/ToastContext';
import { useStore } from '../context/StoreContext';

function CustomerDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success, error: showError } = useToastContext();
  const { getCollectionRef, getDocRef, currentStore } = useStore();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<BillingItem[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'credit'>('all');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);

  // Bill Download & Share State
  const [itemToShare, setItemToShare] = useState<BillingItem | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
  const [sharingInvoiceId, setSharingInvoiceId] = useState<string | null>(null);

  // Fetch shop details for invoice generation
  useEffect(() => {
    const fetchShopDetails = async () => {
      try {
        const shopDoc = await getDoc(doc(db, 'shopDetails', 'details'));
        if (shopDoc.exists()) {
          setShopDetails(shopDoc.data() as ShopDetails);
        }
      } catch (error) {
        console.error('Error fetching shop details:', error);
      }
    };
    fetchShopDetails();
  }, []);

  const effectiveShopDetails: ShopDetails = useMemo(() => {
    return shopDetails || {
      shopName: currentStore?.name || 'The Legend Mobiles',
      ownerName: 'Owner',
      address: currentStore?.address || 'Main Road',
      phone: currentStore?.phone || '',
      email: currentStore?.email || '',
      gst: currentStore?.gst || '',
    };
  }, [shopDetails, currentStore]);

  // Helper to group multi-item transactions into a single combined order
  const groupPurchasesByTransaction = (rawItems: BillingItem[]): BillingItem[] => {
    const transactionMap = new Map<string, BillingItem>();
    const standaloneItems: BillingItem[] = [];

    for (const raw of rawItems) {
      const item = { ...raw };
      const txId = (item.transactionId || '').trim();

      if (txId) {
        if (transactionMap.has(txId)) {
          const parent = transactionMap.get(txId)!;
          if (!parent.items) {
            parent.items = [{ ...parent }];
          }
          parent.items.push(item);

          if (item.type === 'credit') {
            parent.type = 'credit';
            parent.isPaid = (parent.isPaid !== undefined ? parent.isPaid : true) && (item.isPaid !== undefined ? item.isPaid : false);
            parent.paidAmount = (parent.paidAmount || 0) + (item.paidAmount || 0);
            parent.remainingAmount = (parent.remainingAmount || 0) + (item.remainingAmount || 0);
          }

          parent.quantity = (parent.quantity || 0) + (item.quantity || 1);

          if (item.imei) {
            parent.imei = parent.imei ? `${parent.imei}, ${item.imei}` : item.imei;
          }
        } else {
          const parent = { ...item };
          if (parent.items && Array.isArray(parent.items) && parent.items.length > 0) {
            parent.items = [...parent.items];
          }
          transactionMap.set(txId, parent);
        }
      } else {
        standaloneItems.push(item);
      }
    }

    const grouped: BillingItem[] = [];
    for (const parent of transactionMap.values()) {
      if (parent.items && parent.items.length > 1) {
        if (parent.grandTotal !== undefined && parent.grandTotal > 0) {
          parent.totalWithGst = parent.grandTotal;
        } else {
          parent.totalWithGst = parent.items.reduce((sum, sub) => {
            return sum + (sub.totalWithGst !== undefined ? sub.totalWithGst : (sub.sellingPrice * (sub.quantity || 1)));
          }, 0);
        }

        const titles = parent.items.map(it => it.title).filter(Boolean);
        parent.title = titles.length <= 2 
          ? titles.join(', ') 
          : `${titles.slice(0, 2).join(', ')} + ${titles.length - 2} more`;
      }
      grouped.push(parent);
    }

    return [...grouped, ...standaloneItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };

  useEffect(() => {
    const fetchCustomerAndPurchases = async () => {
      if (!id) return;

      try {
        setLoading(true);
        // 1. Fetch Customer Details
        const customerRef = getDocRef('customers', id);
        const customerSnap = await getDoc(customerRef);

        if (!customerSnap.exists()) {
          showError('Customer not found');
          navigate('/customers');
          return;
        }

        const customerData = {
          id: customerSnap.id,
          ...customerSnap.data(),
          createdAt: customerSnap.data().createdAt?.toDate ? customerSnap.data().createdAt.toDate() : new Date(customerSnap.data().createdAt || Date.now()),
        } as Customer;

        setCustomer(customerData);

        // 2. Fetch Purchases (Billing Items & Credit Sales) based on Phone
        if (customerData.phone) {
          setLoadingPurchases(true);

          // Fetch from billingItems
          const billingRef = getCollectionRef('billingItems');
          const billingQ = query(
            billingRef,
            where('customerPhone', '==', customerData.phone),
            orderBy('createdAt', 'desc')
          );

          // Fetch from creditSales
          const creditRef = getCollectionRef('creditSales');
          const creditQ = query(
            creditRef,
            where('customerPhone', '==', customerData.phone),
            orderBy('createdAt', 'desc')
          );

          const [billingSnap, creditSnapResult] = await Promise.all([
            getDocs(billingQ).catch(err => {
              console.warn("Billing query fallback:", err);
              const fallbackQ = query(billingRef, where('customerPhone', '==', customerData.phone));
              return getDocs(fallbackQ);
            }),
            getDocs(creditQ).catch(err => {
              console.warn("Credit query fallback:", err);
              const fallbackQ = query(creditRef, where('customerPhone', '==', customerData.phone));
              return getDocs(fallbackQ);
            })
          ]);

          const billingList = billingSnap.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data(),
            createdAt: docSnap.data().createdAt?.toDate ? docSnap.data().createdAt.toDate() : new Date(docSnap.data().createdAt || Date.now()),
          })) as BillingItem[];

          const creditList = creditSnapResult.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data(),
            createdAt: docSnap.data().createdAt?.toDate ? docSnap.data().createdAt.toDate() : new Date(docSnap.data().createdAt || Date.now()),
          })) as BillingItem[];

          // Group multi-item transactions into single combined orders
          const allRawPurchases = [...billingList, ...creditList];
          const groupedPurchases = groupPurchasesByTransaction(allRawPurchases);

          setPurchases(groupedPurchases);
        }
      } catch (error) {
        console.error('Error fetching customer details:', error);
        showError('Failed to load customer details');
      } finally {
        setLoading(false);
        setLoadingPurchases(false);
      }
    };

    fetchCustomerAndPurchases();
  }, [id, navigate, showError]);

  // Generic copy helper
  const handleCopy = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1800);
  };

  // Toggle order expansion
  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  // Calculate Metrics
  const totalSpent = useMemo(() => {
    return purchases.reduce((sum, item) => sum + (item.totalWithGst || (item.sellingPrice * (item.quantity || 1))), 0);
  }, [purchases]);

  const totalOrders = purchases.length;

  const outstandingCredit = useMemo(() => {
    return purchases.reduce((sum, item) => {
      if (item.type === 'credit' && !item.isPaid) {
        const rem = item.remainingAmount !== undefined
          ? item.remainingAmount
          : Math.max(0, (item.totalWithGst || (item.sellingPrice * (item.quantity || 1))) - (item.paidAmount || 0));
        return sum + rem;
      }
      return sum;
    }, 0);
  }, [purchases]);

  const paidOrdersCount = useMemo(() => {
    return purchases.filter(p => p.type !== 'credit' || p.isPaid === true).length;
  }, [purchases]);

  const creditOrdersCount = useMemo(() => {
    return purchases.filter(p => p.type === 'credit' && p.isPaid !== true).length;
  }, [purchases]);

  const avgOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;
  const lastPurchaseDate = purchases.length > 0 ? purchases[0].createdAt : null;

  // Filter purchases by search & status
  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      // 1. Status Filter
      if (statusFilter === 'paid') {
        const isFullyPaid = p.type !== 'credit' || p.isPaid === true;
        if (!isFullyPaid) return false;
      } else if (statusFilter === 'credit') {
        const isPendingCredit = p.type === 'credit' && p.isPaid !== true;
        if (!isPendingCredit) return false;
      }

      // 2. Search Term Filter
      if (!searchTerm.trim()) return true;

      const q = searchTerm.toLowerCase().trim();
      const matchTitle = p.title && p.title.toLowerCase().includes(q);
      const matchTx = p.transactionId && p.transactionId.toLowerCase().includes(q);
      const matchInvoice = p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(q);
      const matchImei = p.imei && p.imei.toLowerCase().includes(q);
      const matchSalesperson = p.salesPersonName && p.salesPersonName.toLowerCase().includes(q);
      const matchSub = p.items && p.items.some(sub =>
        (sub.title && sub.title.toLowerCase().includes(q)) ||
        (sub.imei && sub.imei.toLowerCase().includes(q))
      );
      return matchTitle || matchTx || matchInvoice || matchImei || matchSalesperson || matchSub;
    });
  }, [purchases, statusFilter, searchTerm]);

  // Download Bill PDF handler
  const handleDownloadInvoice = async (item: BillingItem) => {
    try {
      setDownloadingInvoiceId(item.id || item.transactionId || 'bill');
      const preparedItem: BillingItem = {
        ...item,
        customerName: item.customerName || customer?.name || 'Customer',
        customerPhone: item.customerPhone || customer?.phone || '',
        customerEmail: item.customerEmail || customer?.email || '',
        customerDetails: item.customerDetails || customer?.address || '',
      };
      await generateInvoice(preparedItem, effectiveShopDetails, item.transactionId, false);
      success('Bill PDF downloaded successfully');
    } catch (error) {
      console.error('Error generating bill PDF:', error);
      showError('Failed to generate bill PDF. Please try again.');
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  // Directly trigger Universal Share
  const handleShareInvoice = async (item: BillingItem) => {
    try {
      setSharingInvoiceId(item.id || item.transactionId || 'share');

      const customerName = (item.customerName || customer?.name || 'Customer').trim();
      const customerPhone = (item.customerPhone || customer?.phone || '').trim();
      const customerEmail = (item.customerEmail || customer?.email || '').trim();
      const customerDetails = (item.customerDetails || customer?.address || '').trim();

      const preparedItem: BillingItem = {
        ...item,
        customerName,
        customerPhone,
        customerEmail,
        customerDetails,
      };

      const billId = item.transactionId || item.id;
      const safeId = (billId || '').replace(/\//g, '_');
      const rawPhoneDigits = customerPhone.replace(/\D/g, '').slice(-10);
      const phoneParam = rawPhoneDigits ? `?p=${encodeURIComponent(rawPhoneDigits)}` : '';
      const billUrl = `https://the-legend-mobiles.vercel.app/view-bill/${encodeURIComponent(safeId)}${phoneParam}`;
      const totalAmount = Math.round(item.totalWithGst || (item.sellingPrice * (item.quantity || 1))).toLocaleString('en-IN');
      const shareTitle = `Invoice - ${item.transactionId || safeId}`;
      const shareText = `Hi ${customerName}! 👋\nThank you for shopping at ${effectiveShopDetails.shopName || 'The Legend Mobiles'}!\nTotal: ₹${totalAmount}\nYou can view & download your bill here:\n${billUrl}`;

      // Generate PDF
      const result = await generateInvoice(preparedItem, effectiveShopDetails, item.transactionId, true) as any;

      // 1. Android WebView bridge
      if (typeof window !== 'undefined' && (window as any).AndroidInterface?.sharePDF && result?.pdfData) {
        (window as any).AndroidInterface.sharePDF(
          result.pdfData,
          result.fileName || `Invoice_${safeId}.pdf`,
          shareTitle
        );
        success('Invoice shared via device!');
        return;
      }

      // 2. Web Share API (Universal Native Device Share)
      if (typeof navigator !== 'undefined' && navigator.share) {
        // Try file sharing if PDF Blob is available
        if (result?.pdfBlob && navigator.canShare) {
          const pdfFile = new File(
            [result.pdfBlob],
            result.fileName || `Invoice_${safeId}.pdf`,
            { type: 'application/pdf' }
          );
          if (navigator.canShare({ files: [pdfFile] })) {
            try {
              await navigator.share({
                title: shareTitle,
                text: shareText,
                files: [pdfFile],
              });
              success('Invoice shared successfully!');
              return;
            } catch (err: any) {
              if (err.name === 'AbortError') return;
              console.warn('Native file share failed, trying URL share:', err);
            }
          }
        }

        // Try text & URL share
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: billUrl,
          });
          success('Invoice shared successfully!');
          return;
        } catch (err: any) {
          if (err.name === 'AbortError') return;
          console.warn('Native text share failed:', err);
        }
      }

      // 3. Fallback for desktop browsers without navigator.share support
      setItemToShare(preparedItem);
      setIsShareModalOpen(true);
    } catch (error: any) {
      console.error('Error during universal share:', error);
      showError('Failed to share bill. Please try again.');
    } finally {
      setSharingInvoiceId(null);
    }
  };

  // Navigate to Billing with customer details pre-filled
  const handleCreateBillForCustomer = (cust: Customer) => {
    navigate(
      `/billing?customerName=${encodeURIComponent(cust.name || '')}&customerPhone=${encodeURIComponent(cust.phone || '')}&customerEmail=${encodeURIComponent(cust.email || '')}&customerAddress=${encodeURIComponent(cust.address || '')}`,
      {
        state: {
          customer: cust,
          customerName: cust.name,
          customerPhone: cust.phone,
          customerEmail: cust.email,
          customerAddress: cust.address,
          customerGstNo: cust.gstNo,
        }
      }
    );
  };

  // Direct WhatsApp customer helper
  const handleOpenWhatsApp = () => {
    if (!customer?.phone) return;
    const cleanDigits = customer.phone.replace(/\D/g, '').slice(-10);
    const text = encodeURIComponent(`Hi ${customer.name}, greetings from ${effectiveShopDetails.shopName || 'The Legend Mobiles'}! How can we assist you today?`);
    window.open(`https://wa.me/91${cleanDigits}?text=${text}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs font-medium text-slate-500">Loading customer profile...</p>
        </div>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20 font-sans text-slate-900">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Top Breadcrumb & Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/customers')}
              className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 text-slate-600 hover:text-slate-900 transition-all shadow-sm"
              title="Back to Customers"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-0.5">
                <Link to="/customers" className="hover:text-blue-600 transition-colors">Customers</Link>
                <span>/</span>
                <span className="text-slate-800 font-semibold">Profile</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Customer Overview
              </h1>
            </div>
          </div>

          {/* Top Quick Actions (Blue Primary) */}
          <div className="flex items-center gap-2 sm:self-center">
            {customer.phone && (
              <>
                <button
                  type="button"
                  onClick={handleOpenWhatsApp}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 rounded-xl text-xs font-semibold transition-all shadow-sm"
                  title="Message on WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>
                <a
                  href={`tel:${customer.phone}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-all shadow-sm"
                  title="Call Customer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Call</span>
                </a>
              </>
            )}

            {/* Primary Blue Button */}
            <button
              type="button"
              onClick={() => handleCreateBillForCustomer(customer)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-sm shadow-blue-500/20 transition-all"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Create New Bill</span>
            </button>
          </div>
        </div>

        {/* Customer Identity Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            
            {/* Identity & Basic Details */}
            <div className="flex items-start gap-4 sm:gap-5">
              <div className="w-16 h-16 sm:w-18 sm:h-18 bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-bold rounded-2xl flex items-center justify-center shrink-0 text-2xl sm:text-3xl shadow-md shadow-blue-500/10">
                {customer.name ? customer.name.charAt(0).toUpperCase() : 'C'}
              </div>

              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
                    {customer.name}
                  </h2>
                  {totalSpent >= 50000 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      VIP Client
                    </span>
                  )}
                  {outstandingCredit > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                      <AlertCircle className="w-3 h-3 text-rose-500" />
                      Pending Dues
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      Account Clear
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Customer since {customer.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                  {customer.createdByName && (
                    <div className="flex items-center gap-1">
                      <span>• Added by {customer.createdByName}</span>
                    </div>
                  )}
                  {customer.homeStoreName && (
                    <div className="flex items-center gap-1">
                      <span>• Store: <strong className="font-medium text-slate-700">{customer.homeStoreName}</strong></span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Contact Badges */}
            <div className="flex flex-wrap md:flex-col lg:flex-row items-stretch md:items-end lg:items-center gap-2 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100">
              {/* Phone Pill */}
              {customer.phone && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                  <Phone className="w-3.5 h-3.5 text-blue-600" />
                  <a href={`tel:${customer.phone}`} className="font-mono font-medium hover:text-blue-600 transition-colors">
                    {customer.phone}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopy(customer.phone, 'phone')}
                    title="Copy phone"
                    className="p-1 hover:bg-slate-200/60 rounded text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {copiedField === 'phone' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              )}

              {/* Email Pill */}
              {customer.email && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  <a href={`mailto:${customer.email}`} className="font-medium hover:text-blue-600 transition-colors truncate max-w-[160px]">
                    {customer.email}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopy(customer.email || '', 'email')}
                    title="Copy email"
                    className="p-1 hover:bg-slate-200/60 rounded text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {copiedField === 'email' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              )}

              {/* GSTIN Pill */}
              {customer.gstNo && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50/60 border border-blue-200/60 rounded-xl text-xs text-blue-900">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span className="font-mono font-medium">GSTIN: {customer.gstNo}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(customer.gstNo || '', 'gst')}
                    title="Copy GSTIN"
                    className="p-1 hover:bg-blue-100 rounded text-blue-500 hover:text-blue-800 transition-colors"
                  >
                    {copiedField === 'gst' ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Address Bar (if available) */}
          {customer.address && (
            <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-start gap-2 text-xs text-slate-600">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{customer.address}</span>
            </div>
          )}
        </div>

        {/* 4 Financial KPI Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          
          {/* 1. Lifetime Spend */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Lifetime Spend
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              ₹{Math.round(totalSpent).toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
              <TrendingUp className="w-3 h-3 text-emerald-600" />
              <span>Gross purchase value</span>
            </p>
          </div>

          {/* 2. Total Orders */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Total Orders
              </span>
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {totalOrders}
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              <span className="text-emerald-600 font-semibold">{paidOrdersCount} Paid</span>
              {creditOrdersCount > 0 && (
                <span className="text-amber-600 font-semibold ml-1.5">• {creditOrdersCount} Credit</span>
              )}
            </p>
          </div>

          {/* 3. Outstanding Balance */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Outstanding Dues
              </span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                outstandingCredit > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-xl sm:text-2xl font-bold tracking-tight ${
              outstandingCredit > 0 ? 'text-amber-600' : 'text-slate-900'
            }`}>
              ₹{Math.round(outstandingCredit).toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] mt-1 font-medium">
              {outstandingCredit > 0 ? (
                <span className="text-amber-600 font-semibold">Payment pending</span>
              ) : (
                <span className="text-emerald-600 font-semibold">Zero balance due</span>
              )}
            </p>
          </div>

          {/* 4. Avg. Order Value */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-sm hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Avg. Order Value
              </span>
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              ₹{avgOrderValue.toLocaleString('en-IN')}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 truncate font-medium">
              {lastPurchaseDate ? (
                <>Last order: {lastPurchaseDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</>
              ) : (
                'No purchases yet'
              )}
            </p>
          </div>

        </div>

        {/* Purchase History Section */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          
          {/* Section Toolbar: Title, Search, and Status Filter */}
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <Receipt className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <span>Billing & Purchase History</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                    {filteredPurchases.length}
                  </span>
                </h3>
                <p className="text-xs text-slate-500">Invoices and purchases associated with {customer.phone}</p>
              </div>
            </div>

            {/* Filter Pills and Search Input */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              
              {/* Status Segmented Tabs */}
              <div className="flex items-center bg-slate-100/90 p-1 rounded-xl text-xs font-medium text-slate-600">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'all'
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'hover:text-slate-900'
                  }`}
                >
                  All ({purchases.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('paid')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'paid'
                      ? 'bg-white text-emerald-700 font-semibold shadow-xs'
                      : 'hover:text-slate-900'
                  }`}
                >
                  Paid ({paidOrdersCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('credit')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'credit'
                      ? 'bg-white text-amber-700 font-semibold shadow-xs'
                      : 'hover:text-slate-900'
                  }`}
                >
                  Credit ({creditOrdersCount})
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search item, bill #, IMEI..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-1.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

            </div>
          </div>

          {/* Table / List Content */}
          {loadingPurchases ? (
            <div className="py-16 text-center text-slate-500">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-xs font-medium text-slate-600">Retrieving customer transaction ledger...</p>
            </div>
          ) : filteredPurchases.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3 text-slate-400">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <p className="text-slate-800 font-semibold text-sm">No transaction records found</p>
              <p className="text-slate-500 text-xs mt-1 max-w-sm mx-auto">
                {searchTerm || statusFilter !== 'all'
                  ? 'No purchases match your selected filters. Try clearing your search query or switching tabs.'
                  : 'This customer has not made any purchases yet. Click "Create New Bill" to generate their first invoice.'}
              </p>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => { setSearchTerm(''); setStatusFilter('all'); }}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-semibold transition-colors"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/80 border-b border-slate-200/80 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3.5">Bill / Transaction</th>
                      <th className="px-4 py-3.5">Date & Time</th>
                      <th className="px-6 py-3.5">Item Summary</th>
                      <th className="px-4 py-3.5 text-center">Payment Mode</th>
                      <th className="px-4 py-3.5 text-right">Amount</th>
                      <th className="px-4 py-3.5 text-center">Status</th>
                      <th className="px-6 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPurchases.map((item) => {
                      const orderId = item.id || item.transactionId || 'order';
                      const isMultiItem = Boolean(item.items && item.items.length > 1);
                      const isExpanded = Boolean(expandedOrders[orderId]);
                      const totalAmt = Math.round(item.totalWithGst || (item.sellingPrice * (item.quantity || 1)));
                      const isCredit = item.type === 'credit';
                      const isPaid = isCredit ? item.isPaid : true;

                      return (
                        <tr key={orderId} className="hover:bg-slate-50/70 transition-colors group">
                          
                          {/* 1. Transaction # / Bill # */}
                          <td className="px-6 py-4 align-top">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs font-bold text-slate-800 tracking-tight">
                                {item.invoiceNumber || item.transactionId || 'INV-DIRECT'}
                              </span>
                              {item.invoiceTime && (
                                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-300" />
                                  {item.invoiceTime}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 2. Date */}
                          <td className="px-4 py-4 align-top text-xs text-slate-600 whitespace-nowrap">
                            <div className="font-medium text-slate-800">
                              {item.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.createdAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </td>

                          {/* 3. Items Summary */}
                          <td className="px-6 py-4 align-top max-w-sm">
                            {isMultiItem ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                                    {item.items!.length} Items
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleOrderExpand(orderId)}
                                    className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-0.5"
                                  >
                                    <span>{isExpanded ? 'Hide items' : 'View all items'}</span>
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  </button>
                                </div>

                                <div className="font-semibold text-slate-900 text-sm leading-snug">
                                  {item.title}
                                </div>

                                {isExpanded && (
                                  <div className="mt-2 bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 space-y-1.5 text-xs text-slate-700">
                                    {item.items!.map((sub, sIdx) => (
                                      <div key={sIdx} className="flex items-start justify-between gap-2 border-b border-slate-200/40 last:border-0 pb-1 last:pb-0">
                                        <div className="truncate">
                                          <div className="font-medium text-slate-800 truncate">{sub.title}</div>
                                          {sub.imei && (
                                            <span className="text-[10px] font-mono text-blue-600 block">
                                              IMEI: {sub.imei}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-right shrink-0">
                                          <span className="text-slate-400 text-[11px]">×{sub.quantity || 1}</span>
                                          <span className="font-semibold text-slate-800 ml-2">
                                            ₹{Math.round(sub.totalWithGst || (sub.sellingPrice * (sub.quantity || 1))).toLocaleString('en-IN')}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div>
                                <div className="font-semibold text-slate-900 text-sm leading-snug">
                                  {item.title}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-slate-500 font-medium">Qty: {item.quantity}</span>
                                  {item.imei && (
                                    <span className="text-[11px] font-mono text-blue-600 bg-blue-50/70 px-1.5 py-0.5 rounded border border-blue-100">
                                      IMEI: {item.imei}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>

                          {/* 4. Payment Mode */}
                          <td className="px-4 py-4 align-top text-center whitespace-nowrap">
                            <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 uppercase">
                              {item.paymentMode || (isCredit ? 'Credit' : 'Cash')}
                            </span>
                          </td>

                          {/* 5. Total Amount */}
                          <td className="px-4 py-4 align-top text-right whitespace-nowrap">
                            <div className="font-bold text-slate-900 text-sm">
                              ₹{totalAmt.toLocaleString('en-IN')}
                            </div>
                            {isCredit && !isPaid && item.remainingAmount !== undefined && (
                              <div className="text-[11px] text-amber-600 font-medium">
                                Bal: ₹{Math.round(item.remainingAmount).toLocaleString('en-IN')}
                              </div>
                            )}
                          </td>

                          {/* 6. Payment Status */}
                          <td className="px-4 py-4 align-top text-center whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                              isCredit && !isPaid
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}>
                              {isCredit && !isPaid ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                  <span>Credit Due</span>
                                </>
                              ) : (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  <span>Paid</span>
                                </>
                              )}
                            </span>
                          </td>

                          {/* 7. Action Buttons (Blue Theme) */}
                          <td className="px-6 py-4 align-top text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Blue Download PDF Button */}
                              <button
                                type="button"
                                onClick={() => handleDownloadInvoice(item)}
                                disabled={downloadingInvoiceId === orderId}
                                title="Download PDF Invoice"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200/80 rounded-xl text-xs font-medium transition-all shadow-2xs disabled:opacity-50"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span className="hidden lg:inline">
                                  {downloadingInvoiceId === orderId ? '...' : 'PDF'}
                                </span>
                              </button>

                              {/* Blue Share Button */}
                              <button
                                type="button"
                                onClick={() => handleShareInvoice(item)}
                                disabled={sharingInvoiceId === orderId}
                                title="Share Bill (WhatsApp / WebShare)"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-medium transition-all shadow-xs disabled:opacity-50"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                <span className="hidden lg:inline">
                                  {sharingInvoiceId === orderId ? '...' : 'Share'}
                                </span>
                              </button>
                            </div>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredPurchases.map((item) => {
                  const orderId = item.id || item.transactionId || 'order';
                  const isMultiItem = Boolean(item.items && item.items.length > 1);
                  const isExpanded = Boolean(expandedOrders[orderId]);
                  const totalAmt = Math.round(item.totalWithGst || (item.sellingPrice * (item.quantity || 1)));
                  const isCredit = item.type === 'credit';
                  const isPaid = isCredit ? item.isPaid : true;

                  return (
                    <div key={orderId} className="p-4 hover:bg-slate-50/60 transition-colors">
                      
                      {/* Top Row: Invoice # & Amount */}
                      <div className="flex justify-between items-start gap-2 mb-1.5">
                        <div>
                          <div className="font-mono text-xs font-bold text-slate-800">
                            {item.invoiceNumber || item.transactionId || 'INV-DIRECT'}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {item.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="font-bold text-slate-900 text-base">
                            ₹{totalAmt.toLocaleString('en-IN')}
                          </div>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold mt-0.5 ${
                            isCredit && !isPaid
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>
                            {isCredit && !isPaid ? 'Credit Due' : 'Paid'}
                          </span>
                        </div>
                      </div>

                      {/* Items */}
                      {isMultiItem ? (
                        <div className="mt-2 mb-2">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                              {item.items!.length} Items
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleOrderExpand(orderId)}
                              className="text-[11px] text-blue-600 font-semibold flex items-center gap-0.5"
                            >
                              <span>{isExpanded ? 'Hide' : 'Show items'}</span>
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          </div>

                          <div className="font-semibold text-slate-900 text-sm leading-snug">
                            {item.title}
                          </div>

                          {isExpanded && (
                            <div className="mt-2 bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 space-y-1.5 text-xs text-slate-700">
                              {item.items!.map((sub, sIdx) => (
                                <div key={sIdx} className="flex justify-between items-start gap-2 border-b border-slate-200/40 last:border-0 pb-1 last:pb-0">
                                  <div className="truncate">
                                    <div className="font-medium text-slate-800 truncate">{sub.title}</div>
                                    {sub.imei && <span className="text-[10px] font-mono text-blue-600 block">IMEI: {sub.imei}</span>}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className="text-slate-400">×{sub.quantity || 1}</span>
                                    <span className="font-semibold text-slate-800 ml-2">
                                      ₹{Math.round(sub.totalWithGst || (sub.sellingPrice * (sub.quantity || 1))).toLocaleString('en-IN')}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1.5 mb-2">
                          <div className="font-semibold text-slate-900 text-sm leading-snug">
                            {item.title}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500">Qty: {item.quantity}</span>
                            {item.imei && (
                              <span className="text-[10px] font-mono text-blue-600 bg-blue-50/70 px-1.5 py-0.5 rounded border border-blue-100">
                                IMEI: {item.imei}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Bottom Action Bar */}
                      <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-100">
                        <span className="text-xs text-slate-500">
                          Mode: <strong className="font-medium text-slate-700 uppercase">{item.paymentMode || 'Cash'}</strong>
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDownloadInvoice(item)}
                            disabled={downloadingInvoiceId === orderId}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200/80 rounded-xl transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{downloadingInvoiceId === orderId ? '...' : 'PDF'}</span>
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => handleShareInvoice(item)}
                            disabled={sharingInvoiceId === orderId}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-xs"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>{sharingInvoiceId === orderId ? '...' : 'Share'}</span>
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            </>
          )}

        </div>

      </main>

      {/* Fallback Share Invoice Modal */}
      {itemToShare && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => {
            setIsShareModalOpen(false);
            setItemToShare(null);
          }}
          item={itemToShare}
          shopDetails={effectiveShopDetails}
        />
      )}
    </div>
  );
}

export default CustomerDetails;
