import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Share2
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
  const [copiedPhone, setCopiedPhone] = useState(false);
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

  // Copy phone number
  const copyPhone = () => {
    if (!customer?.phone) return;
    navigator.clipboard.writeText(customer.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 1800);
  };

  // Calculate Purchase Stats
  const totalSpent = purchases.reduce((sum, item) => sum + (item.totalWithGst || (item.sellingPrice * item.quantity)), 0);
  const totalOrders = purchases.length;
  const lastPurchaseDate = purchases.length > 0 ? purchases[0].createdAt : null;

  // Filter purchases
  const filteredPurchases = purchases.filter(p => {
    const q = searchTerm.toLowerCase();
    const matchTitle = p.title && p.title.toLowerCase().includes(q);
    const matchTx = p.transactionId && p.transactionId.toLowerCase().includes(q);
    const matchImei = p.imei && p.imei.toLowerCase().includes(q);
    const matchSub = p.items && p.items.some(sub =>
      (sub.title && sub.title.toLowerCase().includes(q)) ||
      (sub.imei && sub.imei.toLowerCase().includes(q))
    );
    return matchTitle || matchTx || matchImei || matchSub;
  });

  // Download Bill PDF handler
  const handleDownloadInvoice = async (item: BillingItem) => {
    try {
      setDownloadingInvoiceId(item.id || 'bill');
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
      setSharingInvoiceId(item.id || 'share');

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
      const totalAmount = Math.round(item.totalWithGst || (item.sellingPrice * item.quantity)).toLocaleString('en-IN');
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm font-medium text-gray-600">Loading customer profile...</p>
        </div>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Navbar />

      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-5">
        
        {/* Top Header with Back Navigation */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/customers')}
              className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-gray-700 shadow-sm"
              title="Back to Customers List"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Customer Profile</h1>
              <p className="text-xs text-gray-500">Transaction history, receipts, and contact details</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleCreateBillForCustomer(customer)}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-xs sm:text-sm shadow-sm transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Create New Bill</span>
          </button>
        </div>

        {/* Customer Profile Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 font-bold rounded-2xl flex items-center justify-center shrink-0 text-2xl border border-blue-100 shadow-sm">
                {customer.name.charAt(0).toUpperCase()}
              </div>

              <div>
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{customer.name}</h2>
                <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span>Joined {customer.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  {customer.createdByName && (
                    <span className="text-gray-400">• Added by {customer.createdByName}</span>
                  )}
                </p>

                <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs sm:text-sm">
                  {customer.phone && (
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <Phone className="w-4 h-4 text-blue-500 shrink-0" />
                      <a href={`tel:${customer.phone}`} className="font-mono font-medium hover:text-blue-600 hover:underline">
                        {customer.phone}
                      </a>
                      <button
                        type="button"
                        onClick={copyPhone}
                        title="Copy phone"
                        className="ml-1 text-gray-400 hover:text-gray-700"
                      >
                        {copiedPhone ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}

                  {customer.email && (
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                      <a href={`mailto:${customer.email}`} className="hover:text-blue-600 hover:underline">
                        {customer.email}
                      </a>
                    </div>
                  )}

                  {customer.address && (
                    <div className="flex items-center gap-1.5 text-gray-700 w-full sm:w-auto">
                      <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="text-gray-600">{customer.address}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Financial KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Total Purchases</p>
            <p className="text-lg sm:text-2xl font-bold text-green-600 mt-1">
              ₹{Math.round(totalSpent).toLocaleString('en-IN')}
            </p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Total Orders</p>
            <p className="text-lg sm:text-2xl font-bold text-blue-600 mt-1">{totalOrders}</p>
          </div>

          <div className="col-span-2 sm:col-span-1 bg-white rounded-lg border border-gray-200 p-3 sm:p-4 shadow-sm">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Last Activity</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1">
              {lastPurchaseDate
                ? lastPurchaseDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                : 'No Orders Yet'}
            </p>
          </div>
        </div>

        {/* Purchase History Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          
          {/* Card Header with Search */}
          <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                <Receipt className="w-5 h-5 text-blue-600" />
                Purchase & Job History ({filteredPurchases.length})
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Records linked by phone number ({customer.phone})</p>
            </div>

            <div className="relative min-w-[200px] sm:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search history by item, transaction..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Table / List */}
          {loadingPurchases ? (
            <div className="py-12 text-center text-gray-500">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p className="text-xs font-medium">Loading purchase records...</p>
            </div>
          ) : filteredPurchases.length === 0 ? (
            <div className="text-center py-12 px-4">
              <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-700 font-semibold text-sm">No purchase records found</p>
              <p className="text-gray-500 text-xs mt-0.5">
                {searchTerm ? 'No items match your search term' : 'This customer has no past billing or credit transactions yet.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium text-xs">
                    <tr>
                      <th className="px-5 py-3">Product / Service</th>
                      <th className="px-4 py-3">Transaction #</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Date</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPurchases.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3.5 max-w-sm">
                          {item.items && item.items.length > 1 ? (
                            <div>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                                  Combined Order ({item.items.length} items)
                                </span>
                              </div>
                              <div className="font-semibold text-gray-900 text-sm leading-snug">
                                {item.title}
                              </div>
                              <div className="space-y-0.5 mt-1.5">
                                {item.items.map((sub, sIdx) => (
                                  <div key={sIdx} className="text-xs text-gray-700 flex items-center gap-1.5">
                                    <span className="text-gray-400 text-[10px]">#{sIdx + 1}</span>
                                    <span className="font-medium text-gray-800 truncate">{sub.title}</span>
                                    <span className="text-gray-400 text-[11px]">(×{sub.quantity})</span>
                                    {sub.imei && <span className="text-[10px] font-mono text-blue-600">[{sub.imei}]</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold text-gray-900 text-sm">{item.title}</div>
                              {item.imei && (
                                <span className="text-[11px] font-mono text-blue-600">IMEI: {item.imei}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-gray-500">
                          {item.transactionId || '—'}
                        </td>
                        <td className="px-4 py-3.5 text-center text-gray-700 font-medium">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold text-gray-900">
                          ₹{Math.round(item.totalWithGst || (item.sellingPrice * item.quantity)).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            item.type === 'credit'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {item.type === 'credit' ? 'Credit' : 'Paid'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs text-gray-500 whitespace-nowrap">
                          {item.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDownloadInvoice(item)}
                              disabled={downloadingInvoiceId === (item.id || 'bill')}
                              title="Download Bill PDF"
                              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleShareInvoice(item)}
                              disabled={sharingInvoiceId === (item.id || 'share')}
                              title="Universal Share (Direct)"
                              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200 disabled:opacity-50"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="md:hidden divide-y divide-gray-100">
                {filteredPurchases.map((item) => (
                  <div key={item.id} className="p-3.5 hover:bg-gray-50 transition-colors">
                    {item.items && item.items.length > 1 ? (
                      <div className="mb-2">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                            Combined Order ({item.items.length} items)
                          </span>
                          <div className="font-bold text-gray-900 text-sm shrink-0">
                            ₹{Math.round(item.totalWithGst || (item.sellingPrice * item.quantity)).toLocaleString('en-IN')}
                          </div>
                        </div>
                        <div className="font-semibold text-gray-900 text-sm leading-snug mb-1.5">
                          {item.title}
                        </div>
                        <div className="space-y-1 bg-gray-50/80 p-2 rounded-lg border border-gray-100 mb-1">
                          {item.items.map((sub, sIdx) => (
                            <div key={sIdx} className="flex justify-between items-center text-xs text-gray-700">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="text-gray-400 font-mono text-[10px]">#{sIdx + 1}</span>
                                <span className="font-medium text-gray-800 truncate">{sub.title}</span>
                                {sub.imei && <span className="text-[10px] text-blue-600 font-mono">({sub.imei})</span>}
                              </div>
                              <span className="text-gray-500 font-medium shrink-0 ml-2">×{sub.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <div className="font-semibold text-gray-900 text-sm leading-snug">{item.title}</div>
                          <div className="font-bold text-gray-900 text-sm shrink-0">
                            ₹{Math.round(item.totalWithGst || (item.sellingPrice * item.quantity)).toLocaleString('en-IN')}
                          </div>
                        </div>

                        {item.imei && (
                          <div className="text-[11px] font-mono text-blue-600 mb-1">
                            IMEI: {item.imei}
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
                      <div className="flex items-center gap-1.5">
                        <span>{item.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                        <span>•</span>
                        <span>Qty: {item.quantity}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        item.type === 'credit' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {item.type === 'credit' ? 'Credit' : 'Paid'}
                      </span>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2.5 mt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => handleDownloadInvoice(item)}
                        disabled={downloadingInvoiceId === (item.id || 'bill')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-gray-500" />
                        Download Bill
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShareInvoice(item)}
                        disabled={sharingInvoiceId === (item.id || 'share')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-50"
                      >
                        <Share2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>{sharingInvoiceId === (item.id || 'share') ? 'Sharing...' : 'Share'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>

      </div>

      {/* Share Invoice Modal */}
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
