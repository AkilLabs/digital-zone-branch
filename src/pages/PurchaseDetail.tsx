import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import {
  Calendar,
  User,
  FileText,
  Printer,
  X,
  Edit,
  Trash2,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Smartphone,
  Package,
  Eye,
  EyeOff,
  Copy,
  Check,
  Boxes,
  Receipt,
  CreditCard
} from 'lucide-react';
import type { Purchase, ShopDetails, Product } from '../types';
import { collection, deleteDoc, doc, getDoc, getDocs, increment, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { encodePrice } from '../utils/secretCode';
import ProductLabel from '../components/ProductLabel';
import { useStore } from '../context/StoreContext';

const PurchaseDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { getDocRef } = useStore();

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [purchaseCollection, setPurchaseCollection] = useState<'purchases' | 'imeiPurchases'>('purchases');

  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [productToPrint, setProductToPrint] = useState<Product | null>(null);
  const [printQuantity, setPrintQuantity] = useState(1);
  const [selectedProductForLabel, setSelectedProductForLabel] = useState<Product | null>(null);
  const [productsToPrintBulk, setProductsToPrintBulk] = useState<Product[] | null>(null);

  const [showPrintAllModal, setShowPrintAllModal] = useState(false);
  const [printQuantities, setPrintQuantities] = useState<{ [key: string]: number }>({});
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Secret code reveal toggle
  const [revealCosts, setRevealCosts] = useState(false);
  const [copiedVoucher, setCopiedVoucher] = useState(false);
  const [copiedImei, setCopiedImei] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchPurchaseDetails(id);
    }
    fetchShopDetails();
  }, [id]);

  const fetchShopDetails = async () => {
    try {
      const docRef = doc(db, 'settings', 'shopDetails');
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setShopDetails(docSnap.data() as ShopDetails);
      }
    } catch (error) {
      console.error('Error fetching shop details:', error);
    }
  };

  const fetchPurchaseDetails = async (purchaseId: string) => {
    setIsLoading(true);
    try {
      let targetCollection: 'purchases' | 'imeiPurchases' = 'imeiPurchases';
      let purchaseDoc = await getDoc(getDocRef('imeiPurchases', purchaseId));
      if (!purchaseDoc.exists()) {
        const rootImei = await getDoc(doc(db, 'imeiPurchases', purchaseId));
        if (rootImei.exists()) {
          purchaseDoc = rootImei;
        } else {
          targetCollection = 'purchases';
          const storeReg = await getDoc(getDocRef('purchases', purchaseId));
          if (storeReg.exists()) {
            purchaseDoc = storeReg;
          } else {
            purchaseDoc = await getDoc(doc(db, 'purchases', purchaseId));
          }
        }
      }
      setPurchaseCollection(targetCollection);

      if (purchaseDoc.exists()) {
        const purchaseData = {
          id: purchaseDoc.id,
          ...purchaseDoc.data(),
          createdAt: purchaseDoc.data().createdAt?.toDate() || new Date()
        } as Purchase;
        setPurchase(purchaseData);
      } else {
        showToast('Purchase not found', 'error');
        navigate('/purchases');
      }
    } catch (error) {
      console.error('Error fetching purchase:', error);
      showToast('Failed to load purchase details', 'error');
      navigate('/purchases');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, isVoucher = false) => {
    navigator.clipboard.writeText(text);
    if (isVoucher) {
      setCopiedVoucher(true);
      setTimeout(() => setCopiedVoucher(false), 2000);
    } else {
      setCopiedImei(text);
      setTimeout(() => setCopiedImei(null), 2000);
    }
    showToast('Copied to clipboard', 'info');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Paid in Full
          </span>
        );
      case 'pending':
      case 'partial':
      case 'credit-partial':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Partially Paid
          </span>
        );
      case 'unpaid':
      case 'credit':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Credit Due
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            {status || 'Unknown'}
          </span>
        );
    }
  };

  const handlePrintLabel = (item: any) => {
    const productData = {
      productCode: item.productCode || '',
      name: item.productName,
      cost: item.costPerUnit,
      mrp: item.mrp || 0,
      brand: item.brand,
      category: item.category,
      quantity: item.quantity,
      model: item.model || '',
    } as Product;
    setProductToPrint(productData);
    setPrintQuantity(item.quantity);
    setShowPrintModal(true);
  };

  const confirmPrintLabel = () => {
    if (productToPrint) {
      setSelectedProductForLabel({ ...productToPrint, quantity: printQuantity });
      setShowPrintModal(false);
    }
  };

  const openPrintAllModal = () => {
    if (!purchase) return;
    const initialQuantities: { [key: string]: number } = {};
    purchase.items.forEach((item, index) => {
      initialQuantities[index] = item.quantity;
    });
    setPrintQuantities(initialQuantities);
    setSelectedItems(purchase.items.map((_, idx) => idx));
    setShowPrintAllModal(false);
    setTimeout(() => setShowPrintAllModal(true), 10);
  };

  const updatePrintQuantity = (index: number, quantity: number) => {
    setPrintQuantities(prev => ({
      ...prev,
      [index]: quantity
    }));
  };

  const toggleItemSelection = (index: number) => {
    setSelectedItems(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const toggleAllSelection = () => {
    if (!purchase) return;
    if (selectedItems.length === purchase.items.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(purchase.items.map((_, idx) => idx));
    }
  };

  const confirmPrintAllLabels = () => {
    if (!purchase) return;
    const productsArray = purchase.items
      .map((item, index) => ({
        productCode: item.productCode || '',
        name: item.productName,
        cost: item.costPerUnit,
        mrp: item.mrp || 0,
        brand: item.brand,
        category: item.category,
        quantity: printQuantities[index] || 1,
        model: item.model || '',
      }))
      .filter((_, index) => selectedItems.includes(index)) as Product[];
    setProductsToPrintBulk(productsArray);
    setShowPrintAllModal(false);
  };

  const handleDeletePurchase = async () => {
    if (!purchase || !id || isDeleting) return;

    const confirmed = window.confirm(
      `Delete purchase ${purchase.purchaseNumber}?\n\nThis will permanently delete this purchase voucher, revert supplier ledger balances, and remove newly registered items from inventory.`
    );

    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const supplierRef = doc(db, 'suppliers', purchase.supplierId);
      await updateDoc(supplierRef, {
        totalPurchaseAmount: increment(-purchase.totalAmount),
        totalPaid: increment(-purchase.paidAmount),
        totalPending: increment(-purchase.pendingAmount)
      });

      const paymentsRef = collection(db, 'supplierPayments');
      const paymentSnapshot = await getDocs(query(paymentsRef, where('relatedPurchaseId', '==', id)));
      for (const paymentDoc of paymentSnapshot.docs) {
        await deleteDoc(doc(db, 'supplierPayments', paymentDoc.id));
      }

      const productsRef = collection(db, 'products');
      for (const item of purchase.items) {
        if (!item.productCode) continue;

        const productSnapshot = await getDocs(query(productsRef, where('productCode', '==', item.productCode)));
        if (productSnapshot.empty) continue;

        const productDoc = productSnapshot.docs[0];
        const productData = productDoc.data() as Product & { sourcePurchaseId?: string };

        if (productData.sourcePurchaseId === id) {
          await deleteDoc(doc(db, 'products', productDoc.id));
          continue;
        }

        const currentQuantity = Number(productData.quantity) || 0;
        const purchaseQuantity = Number(item.quantity) || 0;
        const nextQuantity = Math.max(0, currentQuantity - purchaseQuantity);

        await updateDoc(doc(db, 'products', productDoc.id), {
          quantity: nextQuantity,
          isAvailable: nextQuantity > 0,
          updatedAt: new Date()
        });
      }

      try {
        await deleteDoc(getDocRef(purchaseCollection, id));
      } catch {
        await deleteDoc(doc(db, purchaseCollection, id));
      }
      showToast('Purchase deleted successfully', 'success');
      navigate('/purchases');
    } catch (error) {
      console.error('Error deleting purchase:', error);
      showToast('Failed to delete purchase', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const isIMEI = purchase?.isIMEIPurchase || (purchase as any)?._collection === 'imeiPurchases' || purchase?.purchaseNumber?.includes('IMEI');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50/60">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-80px)]">
          <div className="text-center">
            <div className="w-12 h-12 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm font-medium text-slate-600">Loading purchase voucher...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!purchase) {
    return null;
  }

  const pendingAmount = purchase.pendingAmount || 0;

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-800">
      <Navbar />

      <main className="w-full px-3 sm:px-6 lg:px-8 py-5 pb-28 sm:pb-12">
        {/* Back navigation & Actions Toolbar */}
        <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            onClick={() => navigate('/purchases')}
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors group cursor-pointer w-fit"
          >
            <div className="p-1.5 rounded-lg bg-white border border-slate-200 group-hover:border-slate-300 shadow-2xs">
              <ArrowLeft className="w-4 h-4" />
            </div>
            <span>Back to Purchases Directory</span>
          </button>

          {/* Action buttons toolbar */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            {/* Price reveal toggle */}
            <button
              onClick={() => setRevealCosts(!revealCosts)}
              title={revealCosts ? "Hide actual costs (use secret code)" : "Reveal actual costs"}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                revealCosts
                  ? 'bg-amber-50 text-amber-800 border-amber-300 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-2xs'
              }`}
            >
              {revealCosts ? (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                  <span>Hide Actual Cost</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                  <span>Reveal Cost (Code: ON)</span>
                </>
              )}
            </button>

            {/* Print All Labels */}
            <button
              onClick={openPrintAllModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print Barcode Labels</span>
            </button>

            {/* Edit Purchase */}
            <button
              onClick={() => navigate(isIMEI ? `/edit-purchase-imei/${id}` : `/edit-purchase/${id}`)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <Edit className="w-4 h-4" />
              <span>Edit Voucher</span>
            </button>

            {/* Delete Purchase */}
            <button
              onClick={handleDeletePurchase}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-300 rounded-xl text-xs font-bold transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
            </button>
          </div>
        </div>

        {/* Voucher Identity Banner */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 sm:p-6 mb-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
                  <Receipt className="w-5 h-5" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tracking-tight flex items-center gap-2">
                  <span>{purchase.purchaseNumber}</span>
                  <button
                    onClick={() => copyToClipboard(purchase.purchaseNumber, true)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors cursor-pointer"
                    title="Copy Voucher Number"
                  >
                    {copiedVoucher ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </h1>

                {/* Type Badge */}
                {isIMEI ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    <Smartphone className="w-3.5 h-3.5" />
                    IMEI Tracked Manifest
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                    <Package className="w-3.5 h-3.5" />
                    Standard Inventory
                  </span>
                )}

                {/* Status Badge */}
                {getStatusBadge(purchase.paymentStatus)}
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Purchased on: <strong className="text-slate-700 font-semibold">{purchase.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></span>
                </div>
                {purchase.createdByName && (
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Inwarded by: <strong className="text-slate-700 font-semibold">{purchase.createdByName}</strong></span>
                  </div>
                )}
                {purchase.invoiceNumber && (
                  <div className="flex items-center gap-1.5 font-mono">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span>Supplier Invoice: <strong className="text-slate-700 font-semibold">{purchase.invoiceNumber}</strong></span>
                  </div>
                )}
              </div>
            </div>

            {/* Total Valuation Highlight Pill */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 sm:text-right min-w-[200px]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Total Purchase Valuation
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 mt-1">
                {revealCosts ? (
                  <span>₹{(purchase.totalAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                ) : (
                  <span className="text-blue-700 font-black tracking-widest">{encodePrice(purchase.totalAmount)}</span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {revealCosts ? 'Actual Inward Price' : 'Encrypted Cost Code'}
              </div>
            </div>
          </div>
        </div>

        {/* 4 Summary Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          {/* Supplier Info */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Supplier Vendor</span>
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                <User className="w-4 h-4" />
              </div>
            </div>
            <div className="text-base sm:text-lg font-bold text-slate-900 truncate">
              {purchase.supplierName || 'Unknown Supplier'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 truncate">
              {purchase.invoiceNumber ? `Invoice: ${purchase.invoiceNumber}` : 'Direct Inward'}
            </div>
          </div>

          {/* Quantity & Lines */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Intake Volume</span>
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="text-base sm:text-lg font-bold font-mono text-slate-900">
              {purchase.totalQuantity} <span className="text-xs font-normal text-slate-500">units</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {purchase.items.length} line item{purchase.items.length > 1 ? 's' : ''}
            </div>
          </div>

          {/* Settled / Paid */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Amount Paid</span>
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-base sm:text-lg font-bold font-mono text-emerald-600">
              ₹{(purchase.paidAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Mode: <span className="font-semibold uppercase text-slate-700">{purchase.paymentMode}</span>
            </div>
          </div>

          {/* Pending / Due */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-4 hover:border-slate-300 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Balance Pending</span>
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-base sm:text-lg font-bold font-mono ${pendingAmount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
              ₹{pendingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {pendingAmount === 0 ? 'Fully settled voucher' : 'Credit balance due'}
            </div>
          </div>
        </div>

        {/* Item Manifest Table Container */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden mb-6">
          <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-blue-600" />
                <span>Inward Inventory Manifest</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                  {purchase.items.length} Items ({purchase.totalQuantity} units)
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Breakdown of items inwarded under this purchase voucher
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={openPrintAllModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print All Labels</span>
              </button>
            </div>
          </div>

          {/* Desktop Spreadsheet Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-3 text-center w-12">#</th>
                  <th className="py-3 px-4">IMEI / Serial</th>
                  <th className="py-3 px-3">Code</th>
                  <th className="py-3 px-4">Item & Model</th>
                  <th className="py-3 px-4">Brand / Category</th>
                  <th className="py-3 px-3 text-center">Qty</th>
                  <th className="py-3 px-4 text-right">Cost / Unit</th>
                  <th className="py-3 px-4 text-right">MRP</th>
                  <th className="py-3 px-4 text-right">Total Valuation</th>
                  <th className="py-3 px-3 text-center">Barcode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {purchase.items.map((item, index) => (
                  <tr key={index} className="hover:bg-slate-50/80 transition-colors">
                    {/* # Index */}
                    <td className="py-3.5 px-3 text-center font-mono text-slate-400 font-medium">
                      {index + 1}
                    </td>

                    {/* IMEI / Serial */}
                    <td className="py-3.5 px-4 font-mono">
                      {item.imei ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-bold text-xs">
                          <span>{item.imei}</span>
                          <button
                            onClick={() => copyToClipboard(item.imei!)}
                            className="text-blue-400 hover:text-blue-700 p-0.5 cursor-pointer"
                            title="Copy IMEI"
                          >
                            {copiedImei === item.imei ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic font-sans">—</span>
                      )}
                    </td>

                    {/* Code */}
                    <td className="py-3.5 px-3 font-mono text-slate-600 font-medium">
                      {item.productCode || '—'}
                    </td>

                    {/* Product Name & Model */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{item.productName}</div>
                      {item.model && (
                        <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                          Model: {item.model}
                        </div>
                      )}
                    </td>

                    {/* Brand & Category */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {item.brand}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600">
                          {item.category}
                        </span>
                      </div>
                    </td>

                    {/* Quantity */}
                    <td className="py-3.5 px-3 text-center">
                      <span className="inline-block px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono font-bold">
                        {item.quantity}
                      </span>
                    </td>

                    {/* Cost / Unit */}
                    <td className="py-3.5 px-4 text-right font-mono">
                      {revealCosts ? (
                        <span className="font-semibold text-slate-800">
                          ₹{item.costPerUnit?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60 tracking-wider">
                          {encodePrice(item.costPerUnit)}
                        </span>
                      )}
                    </td>

                    {/* MRP */}
                    <td className="py-3.5 px-4 text-right font-mono text-slate-700 font-medium">
                      {item.mrp ? `₹${item.mrp.toFixed(2)}` : '—'}
                    </td>

                    {/* Total Valuation */}
                    <td className="py-3.5 px-4 text-right font-mono">
                      {revealCosts ? (
                        <span className="font-bold text-slate-900">
                          ₹{item.totalCost?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60 tracking-wider">
                          {encodePrice(item.totalCost)}
                        </span>
                      )}
                    </td>

                    {/* Barcode Print Action */}
                    <td className="py-3.5 px-3 text-center">
                      <button
                        onClick={() => handlePrintLabel(item)}
                        title="Print Barcode Label"
                        className="p-1.5 text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Table Footer */}
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-xs">
                  <td colSpan={5} className="py-3.5 px-4 text-right text-slate-700">
                    Grand Totals:
                  </td>
                  <td className="py-3.5 px-3 text-center font-mono font-bold text-slate-900">
                    {purchase.totalQuantity}
                  </td>
                  <td colSpan={2} className="py-3.5 px-4 text-right text-slate-700">
                    Total Inward Cost:
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-bold text-sm text-slate-900">
                    {revealCosts ? (
                      <span>₹{(purchase.totalAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    ) : (
                      <span className="text-blue-700 tracking-wider">{encodePrice(purchase.totalAmount)}</span>
                    )}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile Items Card View */}
          <div className="lg:hidden p-3.5 space-y-3">
            {purchase.items.map((item, index) => (
              <div
                key={index}
                className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-400">#{index + 1}</span>
                      <h3 className="font-bold text-slate-900 text-sm">{item.productName}</h3>
                    </div>
                    {item.model && (
                      <div className="text-xs text-slate-500 mt-0.5">Model: {item.model}</div>
                    )}
                  </div>
                  <button
                    onClick={() => handlePrintLabel(item)}
                    className="p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors cursor-pointer"
                    title="Print label"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                </div>

                {/* IMEI or Product Code badge */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {item.imei && (
                    <span className="font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[11px] font-bold">
                      IMEI: {item.imei}
                    </span>
                  )}
                  {item.productCode && (
                    <span className="font-mono bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[11px]">
                      Code: {item.productCode}
                    </span>
                  )}
                  <span className="text-slate-500">{item.brand} • {item.category}</span>
                </div>

                {/* Financial 3-col strip */}
                <div className="grid grid-cols-3 gap-2 bg-white rounded-lg p-2 border border-slate-100 text-center text-xs">
                  <div>
                    <div className="text-[10px] text-slate-400 font-medium">Qty</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">{item.quantity}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 font-medium">Cost/Unit</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">
                      {revealCosts ? `₹${item.costPerUnit?.toFixed(2)}` : encodePrice(item.costPerUnit)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 font-medium">Total Cost</div>
                    <div className="font-mono font-bold text-blue-700 mt-0.5">
                      {revealCosts ? `₹${item.totalCost?.toFixed(2)}` : encodePrice(item.totalCost)}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Mobile Grand Total card */}
            <div className="bg-slate-100 rounded-xl p-3 flex items-center justify-between font-bold text-sm">
              <span className="text-slate-700">Total Valuation ({purchase.totalQuantity} units):</span>
              <span className="font-mono text-slate-900">
                {revealCosts ? `₹${purchase.totalAmount?.toFixed(2)}` : encodePrice(purchase.totalAmount)}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Details Grid: Payment Details & Notes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          {/* Payment & Settlement Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <span>Payment & Settlement Breakdown</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                {purchase.paymentMode} Mode
              </span>
            </div>

            {/* Split breakdown details if split */}
            {purchase.paymentMode === 'split' && purchase.paymentSplit && (
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 space-y-2 text-xs">
                <div className="font-bold text-slate-700 mb-1">Split Payment Channels:</div>
                {purchase.paymentSplit.cash ? (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Cash Payment:</span>
                    <span className="font-mono font-bold text-slate-900">₹{purchase.paymentSplit.cash.toFixed(2)}</span>
                  </div>
                ) : null}
                {purchase.paymentSplit.upi ? (
                  <div className="flex justify-between">
                    <span className="text-slate-600">UPI / Digital:</span>
                    <span className="font-mono font-bold text-slate-900">₹{purchase.paymentSplit.upi.toFixed(2)}</span>
                  </div>
                ) : null}
                {purchase.paymentSplit.card ? (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Card Terminal:</span>
                    <span className="font-mono font-bold text-slate-900">₹{purchase.paymentSplit.card.toFixed(2)}</span>
                  </div>
                ) : null}
              </div>
            )}

            {/* Financial Ledger Rows */}
            <div className="space-y-2.5 text-xs sm:text-sm">
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-600">Total Purchase Valuation:</span>
                <span className="font-mono font-bold text-slate-900">
                  {revealCosts ? `₹${(purchase.totalAmount || 0).toFixed(2)}` : encodePrice(purchase.totalAmount)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1">
                <span className="text-slate-600">Amount Paid at Inward:</span>
                <span className="font-mono font-bold text-emerald-600">
                  ₹{(purchase.paidAmount || 0).toFixed(2)}
                </span>
              </div>

              {purchase.isCredit && (purchase.creditCleared || 0) > 0 && (
                <div className="flex justify-between items-center py-1 bg-purple-50 -mx-2 px-2 rounded-lg">
                  <span className="font-semibold text-purple-800">Subsequent Credit Cleared:</span>
                  <span className="font-mono font-bold text-purple-800">
                    ₹{(purchase.creditCleared || 0).toFixed(2)}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="font-bold text-slate-900">Outstanding Balance Due:</span>
                <span className={`font-mono font-bold text-base ${pendingAmount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  ₹{pendingAmount.toFixed(2)}
                </span>
              </div>
            </div>

            {pendingAmount > 0 && (
              <div className="pt-2">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-800">
                  <Clock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-bold">Pending Vendor Credit:</span> This voucher has an outstanding balance of ₹{pendingAmount.toFixed(2)}. Payments can be recorded in the Supplier Ledger.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes and Shop Context Card */}
          <div className="space-y-5">
            {purchase.notes ? (
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span>Voucher Notes & Instructions</span>
                </h2>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-700 leading-relaxed">
                  {purchase.notes}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 text-center text-slate-400 text-xs py-8">
                <FileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
                No additional notes logged for this purchase voucher.
              </div>
            )}

            {/* Quick Supplier Contact Card */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-blue-600" />
                <span>Supplier Contact Details</span>
              </h2>
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-900 text-sm">{purchase.supplierName}</div>
                  <div className="text-slate-500 mt-0.5">Supplier ID: {purchase.supplierId}</div>
                </div>
                <button
                  onClick={() => navigate('/suppliers')}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                >
                  View in Suppliers →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Print Single Label Modal */}
        {showPrintModal && productToPrint && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
            onClick={() => setShowPrintModal(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
                    <Printer className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Print Product Labels</h3>
                    <p className="text-xs text-slate-500">Configure sticker quantity</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPrintModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-5 bg-purple-50/70 p-3.5 rounded-xl border border-purple-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Product:</span>
                  <span className="font-bold text-slate-900">{productToPrint.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Purchase Quantity:</span>
                  <span className="font-bold text-purple-700 font-mono">{productToPrint.quantity} units</span>
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Number of Labels to Print
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={printQuantity}
                  onChange={(e) => setPrintQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono font-bold text-lg text-center"
                />
                <div className="mt-2.5 flex gap-2">
                  {[1, 5, 10].map(qty => (
                    <button
                      key={qty}
                      type="button"
                      onClick={() => setPrintQuantity(qty)}
                      className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                    >
                      {qty}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPrintQuantity(productToPrint.quantity)}
                    className="flex-1 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    Match ({productToPrint.quantity})
                  </button>
                </div>
              </div>

              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowPrintModal(false)}
                  className="flex-1 bg-slate-100 text-slate-700 py-2.5 px-4 rounded-xl hover:bg-slate-200 transition-colors text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPrintLabel}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2.5 px-4 rounded-xl transition-all text-xs font-bold shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  Print {printQuantity} Label{printQuantity > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Print Labels Modal */}
        {showPrintAllModal && purchase && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
            onClick={() => setShowPrintAllModal(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col border border-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
                    <Printer className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Bulk Label Printing</h3>
                    <p className="text-xs text-slate-500">
                      Selected items: {selectedItems.length} of {purchase.items.length}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPrintAllModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Quick Actions Bar */}
              <div className="mb-3.5 flex gap-2 flex-wrap text-xs">
                <button
                  onClick={toggleAllSelection}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-colors cursor-pointer"
                >
                  {selectedItems.length === purchase.items.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={() => {
                    const updates: { [key: string]: number } = {};
                    purchase.items.forEach((_, idx) => updates[idx] = 1);
                    setPrintQuantities(updates);
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors cursor-pointer"
                >
                  Set All to 1
                </button>
                <button
                  onClick={() => {
                    const updates: { [key: string]: number } = {};
                    purchase.items.forEach((item, idx) => updates[idx] = item.quantity);
                    setPrintQuantities(updates);
                  }}
                  className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg font-semibold transition-colors cursor-pointer"
                >
                  Match Purchase Quantities
                </button>
              </div>

              {/* Products List Scrollable Area */}
              <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-1">
                {purchase.items.map((item, index) => {
                  const isSelected = selectedItems.includes(index);
                  return (
                    <div
                      key={index}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isSelected ? 'bg-purple-50/60 border-purple-200' : 'bg-slate-50/60 border-slate-200 opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItemSelection(index)}
                        className="w-4 h-4 text-purple-600 rounded cursor-pointer"
                      />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleItemSelection(index)}>
                        <p className="font-bold text-slate-900 truncate text-xs">{item.productName}</p>
                        <div className="flex gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span>Inward Qty: <strong className="text-slate-800">{item.quantity}</strong></span>
                          <span>• {item.brand} {item.model ? `(${item.model})` : ''}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updatePrintQuantity(index, Math.max(1, (printQuantities[index] || 1) - 1))}
                          disabled={!isSelected}
                          className="w-7 h-7 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg font-bold text-xs flex items-center justify-center cursor-pointer"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          value={printQuantities[index] || 1}
                          onChange={(e) => updatePrintQuantity(index, Math.max(1, parseInt(e.target.value) || 1))}
                          disabled={!isSelected}
                          className="w-14 px-1.5 py-1 border border-slate-300 rounded-lg text-center font-mono font-bold text-xs disabled:opacity-40"
                        />
                        <button
                          onClick={() => updatePrintQuantity(index, Math.min(1000, (printQuantities[index] || 1) + 1))}
                          disabled={!isSelected}
                          className="w-7 h-7 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg font-bold text-xs flex items-center justify-center cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2.5 pt-3 border-t border-slate-200">
                <button
                  onClick={() => setShowPrintAllModal(false)}
                  className="flex-1 bg-slate-100 text-slate-700 py-2.5 px-4 rounded-xl hover:bg-slate-200 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPrintAllLabels}
                  disabled={selectedItems.length === 0}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2.5 px-4 rounded-xl text-xs font-bold shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  Print ({selectedItems.reduce((acc, idx) => acc + (printQuantities[idx] || 1), 0)}) Labels
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Product Label Preview Modals */}
        {selectedProductForLabel && (
          <ProductLabel
            product={selectedProductForLabel}
            shopDetails={shopDetails}
            onClose={() => setSelectedProductForLabel(null)}
          />
        )}

        {productsToPrintBulk && productsToPrintBulk.length > 0 && (
          <ProductLabel
            products={productsToPrintBulk}
            shopDetails={shopDetails}
            onClose={() => setProductsToPrintBulk(null)}
          />
        )}
      </main>
    </div>
  );
};

export default PurchaseDetail;
