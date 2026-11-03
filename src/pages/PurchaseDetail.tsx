import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import { ShoppingCart, Calendar, User, FileText, Printer, X, Edit, Trash2 } from 'lucide-react';
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

    const getStatusBadge = (status: string) => {
        const badges = {
            paid: 'bg-green-100 text-green-700',
            pending: 'bg-yellow-100 text-yellow-700',
            unpaid: 'bg-red-100 text-red-700',
            partial: 'bg-yellow-100 text-yellow-700',
            credit: 'bg-red-100 text-red-700',
            'credit-partial': 'bg-yellow-100 text-yellow-700'
        };
        return badges[status as keyof typeof badges] || 'bg-gray-100 text-gray-700';
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
        setShowPrintAllModal(false); // first close it
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
            `Delete purchase ${purchase.purchaseNumber}? This will remove the purchase, reverse supplier totals, and remove products that were created by this purchase.`
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

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex items-center justify-center h-screen">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading purchase details...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!purchase) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />
            <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-8">
                {/* Header */}
                <div className="mb-6">

                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <ShoppingCart className="w-8 h-8 text-blue-600" />
                                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                                    {purchase.purchaseNumber}
                                </h1>
                                <span className={`px-3 py-1 text-sm font-semibold rounded-full ${getStatusBadge(purchase.paymentStatus)}`}>
                                    {purchase.paymentStatus.toUpperCase()}
                                </span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-gray-600 mt-2">
                                <div className="flex items-center gap-1">
                                    <Calendar className="w-4 h-4" />
                                    <span>{purchase.createdAt.toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <User className="w-4 h-4" />
                                    <span>By: {purchase.createdByName}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => navigate(purchase.isIMEIPurchase ? `/edit-purchase-imei/${id}` : `/edit-purchase/${id}`)}
                                className="bg-blue-600 text-white py-2.5 px-4 sm:px-6 rounded-lg hover:bg-blue-700 transition-all shadow-sm hover:shadow-md font-medium flex items-center gap-2"
                            >
                                <Edit className="h-5 w-5" />
                                <span className="hidden sm:inline">Edit Purchase</span>
                            </button>
                            <button
                                onClick={handleDeletePurchase}
                                disabled={isDeleting}
                                className="bg-red-600 text-white py-2.5 px-4 sm:px-6 rounded-lg hover:bg-red-700 transition-all shadow-sm hover:shadow-md font-medium flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <Trash2 className="h-5 w-5" />
                                <span className="hidden sm:inline">{isDeleting ? 'Deleting...' : 'Delete Purchase'}</span>
                            </button>
                            <button
                                onClick={openPrintAllModal}
                                className="bg-purple-600 text-white py-2.5 px-4 sm:px-6 rounded-lg hover:bg-purple-700 transition-all shadow-sm hover:shadow-md font-medium flex items-center gap-2"
                            >
                                <Printer className="h-5 w-5" />
                                <span className="hidden sm:inline">Print All Labels</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Supplier Info */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-600" />
                        Supplier Information
                    </h2>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-600">Supplier Name:</span>
                            <span className="font-medium text-gray-900">{purchase.supplierName || 'Unknown Supplier'}</span>
                        </div>
                        {purchase.invoiceNumber && (
                            <div className="flex items-center justify-between">
                                <span className="text-gray-600">Invoice Number:</span>
                                <span className="font-medium text-gray-900">{purchase.invoiceNumber}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Items - Table View */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">
                        Items ({purchase.items.length})
                    </h2>

                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full border-collapse border border-gray-300">
                            <thead>
                                <tr className="bg-gradient-to-r from-blue-50 to-indigo-50">
                                    <th className="border border-gray-300 px-4 py-3 text-left text-xs font-semibold text-gray-700">#</th>
                                    <th className="border border-gray-300 px-4 py-3 text-left text-xs font-semibold text-gray-700">IMEI</th>
                                    <th className="border border-gray-300 px-4 py-3 text-left text-xs font-semibold text-gray-700">Product Code</th>
                                    <th className="border border-gray-300 px-4 py-3 text-left text-xs font-semibold text-gray-700">Product Name</th>
                                    <th className="border border-gray-300 px-4 py-3 text-left text-xs font-semibold text-gray-700">Brand</th>
                                    <th className="border border-gray-300 px-4 py-3 text-left text-xs font-semibold text-gray-700">Model</th>
                                    <th className="border border-gray-300 px-4 py-3 text-left text-xs font-semibold text-gray-700">Category</th>
                                    <th className="border border-gray-300 px-4 py-3 text-right text-xs font-semibold text-gray-700">Quantity</th>
                                    <th className="border border-gray-300 px-4 py-3 text-right text-xs font-semibold text-gray-700">Cost/Unit</th>
                                    <th className="border border-gray-300 px-4 py-3 text-right text-xs font-semibold text-gray-700">MRP (₹)</th>
                                    <th className="border border-gray-300 px-4 py-3 text-right text-xs font-semibold text-gray-700">Total Cost</th>
                                    <th className="border border-gray-300 px-4 py-3 text-center text-xs font-semibold text-gray-700">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {purchase.items.map((item, index) => (
                                    <tr key={index} className="hover:bg-blue-50 transition-colors">
                                        <td className="border border-gray-300 px-4 py-3 text-center text-sm font-medium text-gray-600 bg-gray-50">
                                            {index + 1}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm font-mono text-blue-600 bg-blue-50 font-semibold">
                                            {item.imei || '—'}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm font-mono text-gray-600">
                                            {item.productCode || 'N/A'}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm font-medium text-gray-900">
                                            {item.productName}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm text-gray-700">
                                            {item.brand}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm text-gray-700">
                                            {item.model || '-'}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm text-gray-700">
                                            {item.category}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm text-right font-semibold text-gray-900">
                                            {item.quantity}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm text-right text-gray-900">
                                            {encodePrice(item.costPerUnit)}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm text-right text-gray-700">
                                            {item.mrp ? `₹${item.mrp.toFixed(2)}` : '-'}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-sm text-right font-bold text-blue-600 bg-blue-50">
                                            {encodePrice(item.totalCost)}
                                        </td>
                                        <td className="border border-gray-300 px-4 py-3 text-center">
                                            <button
                                                onClick={() => handlePrintLabel(item)}
                                                className="p-1.5 text-purple-600 hover:bg-purple-100 rounded transition-colors inline-block"
                                                title="Print label"
                                            >
                                                <Printer className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gradient-to-r from-blue-100 to-indigo-100 font-semibold">
                                    <td colSpan={7} className="border border-gray-300 px-4 py-3 text-sm text-gray-900 text-right">
                                        Total:
                                    </td>
                                    <td className="border border-gray-300 px-4 py-3 text-sm text-gray-900 text-right font-bold">
                                        {purchase.totalQuantity}
                                    </td>
                                    <td colSpan={2} className="border border-gray-300 px-4 py-3 text-sm text-gray-900 text-right">
                                        Grand Total:
                                    </td>
                                    <td className="border border-gray-300 px-4 py-3 text-sm text-blue-600 font-bold text-right">
                                        {encodePrice(purchase.totalAmount)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-3">
                        {purchase.items.map((item, index) => (
                            <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition-colors">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-bold text-gray-500">#{index + 1}</span>
                                            <h3 className="font-semibold text-gray-900 text-base">{item.productName}</h3>
                                        </div>
                                        <p className="text-sm text-gray-600 mt-1">
                                            {item.imei && <span className="font-mono text-blue-600 font-bold">IMEI: {item.imei} • </span>}
                                            {item.productCode && <span className="font-mono text-gray-600">Code: {item.productCode} • </span>}
                                            <span>{item.brand}</span>
                                            {item.model && <span> - {item.model}</span>}
                                            <span> • {item.category}</span>
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handlePrintLabel(item)}
                                        className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors flex-shrink-0"
                                        title="Print label"
                                    >
                                        <Printer className="h-5 w-5" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-white rounded-lg p-2">
                                        <p className="text-xs text-gray-500 mb-1">Quantity</p>
                                        <p className="text-base font-bold text-gray-900">{item.quantity}</p>
                                    </div>
                                    <div className="bg-white rounded-lg p-2">
                                        <p className="text-xs text-gray-500 mb-1">Cost/Unit</p>
                                        <p className="text-base font-bold text-gray-900">{encodePrice(item.costPerUnit)}</p>
                                    </div>
                                    <div className="bg-blue-50 rounded-lg p-2">
                                        <p className="text-xs text-blue-600 mb-1">Total</p>
                                        <p className="text-base font-bold text-blue-600">{encodePrice(item.totalCost)}</p>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Mobile Total */}
                        <div className="bg-gradient-to-r from-blue-100 to-indigo-100 rounded-lg p-4 mt-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold text-gray-700">Total Quantity:</span>
                                <span className="text-base font-bold text-gray-900">{purchase.totalQuantity}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm font-semibold text-gray-700">Grand Total:</span>
                                <span className="text-lg font-bold text-blue-600">{encodePrice(purchase.totalAmount)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Payment Info */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-sm border border-blue-200 p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Information</h2>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2">
                            <span className="text-gray-700 font-medium">Payment Mode:</span>
                            <span className="font-semibold uppercase bg-white px-3 py-1 rounded-full text-sm">
                                {purchase.paymentMode}
                            </span>
                        </div>

                        {purchase.paymentMode === 'split' && purchase.paymentSplit && (
                            <div className="bg-white rounded-lg p-4 space-y-2">
                                <p className="text-sm font-semibold text-gray-700 mb-2">Split Details:</p>
                                {purchase.paymentSplit.cash && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Cash:</span>
                                        <span className="font-medium">₹{purchase.paymentSplit.cash.toFixed(2)}</span>
                                    </div>
                                )}
                                {purchase.paymentSplit.upi && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">UPI:</span>
                                        <span className="font-medium">₹{purchase.paymentSplit.upi.toFixed(2)}</span>
                                    </div>
                                )}
                                {purchase.paymentSplit.card && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Card:</span>
                                        <span className="font-medium">₹{purchase.paymentSplit.card.toFixed(2)}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="border-t border-blue-200 pt-3 mt-3 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-700 font-medium">Total Quantity:</span>
                                <span className="font-bold text-gray-900">{purchase.totalQuantity} units</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-700 font-medium">Total Amount:</span>
                                <span className="font-bold text-xl text-gray-900">{encodePrice(purchase.totalAmount)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-gray-700 font-medium">Paid Amount:</span>
                                <span className="font-bold text-xl text-green-600">₹{purchase.paidAmount.toFixed(2)}</span>
                            </div>
                            {purchase.isCredit && purchase.creditCleared > 0 && (
                                <div className="flex justify-between items-center bg-purple-100 -mx-4 px-4 py-2 rounded">
                                    <span className="font-medium text-purple-700">Credit Cleared:</span>
                                    <span className="font-bold text-purple-700">₹{purchase.creditCleared.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center">
                                <span className="text-gray-700 font-medium">Pending Amount:</span>
                                <span className="font-bold text-xl text-red-600">₹{purchase.pendingAmount.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Notes */}
                {purchase.notes && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-3">
                            <FileText className="w-5 h-5 inline mr-2 text-blue-600" />
                            Notes
                        </h2>
                        <p className="text-gray-700 bg-gray-50 rounded-lg p-4">{purchase.notes}</p>
                    </div>
                )}
            </div>

            {/* Print Label Modal */}
            {showPrintModal && productToPrint && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-sm p-4"
                    onClick={() => setShowPrintModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-5">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    <Printer className="h-6 w-6 text-purple-600" />
                                    Print Labels
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">Configure print settings</p>
                            </div>
                            <button
                                onClick={() => setShowPrintModal(false)}
                                className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="mb-6 bg-purple-50 p-4 rounded-xl border border-purple-200">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-600 font-medium">Product:</span>
                                    <span className="font-bold text-gray-900">{productToPrint.name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-600 font-medium">Current Quantity:</span>
                                    <span className="font-bold text-purple-700">{productToPrint.quantity} units</span>
                                </div>
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="flex items-center gap-2 text-sm font-bold text-gray-900 mb-3">
                                <Printer className="h-4 w-4" />
                                Number of Labels to Print
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min="1"
                                    max="1000"
                                    value={printQuantity}
                                    onChange={(e) => setPrintQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-bold text-lg text-center transition-all"
                                    placeholder="Enter quantity"
                                />
                            </div>
                            <div className="mt-3 flex gap-2">
                                <button
                                    onClick={() => setPrintQuantity(1)}
                                    className="flex-1 py-2 px-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                                >
                                    1
                                </button>
                                <button
                                    onClick={() => setPrintQuantity(5)}
                                    className="flex-1 py-2 px-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                                >
                                    5
                                </button>
                                <button
                                    onClick={() => setPrintQuantity(10)}
                                    className="flex-1 py-2 px-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                                >
                                    10
                                </button>
                                <button
                                    onClick={() => setPrintQuantity(productToPrint.quantity)}
                                    className="flex-1 py-2 px-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                                >
                                    All
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-3 text-center">Enter any value between 1 and 1000</p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowPrintModal(false)}
                                className="flex-1 bg-gray-100 text-gray-700 py-3 px-4 rounded-lg hover:bg-gray-200 transition-colors font-bold"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmPrintLabel}
                                className="flex-1 bg-purple-600 text-white py-3 px-4 rounded-lg hover:bg-purple-700 transition-all font-bold shadow-sm flex items-center justify-center gap-2"
                            >
                                <Printer className="h-5 w-5" />
                                Print {printQuantity}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Print Labels Modal */}
            {showPrintAllModal && purchase && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-sm p-4"
                    onClick={() => setShowPrintAllModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-5">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                    <Printer className="h-6 w-6 text-purple-600" />
                                    Customize Label Printing
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    Select products and configure print quantities. Selected: {selectedItems.length}/{purchase.items.length}
                                </p>
                            </div>
                            <button
                                onClick={() => setShowPrintAllModal(false)}
                                className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Quick Actions */}
                        <div className="mb-4 flex gap-2 flex-wrap">
                            <button
                                onClick={toggleAllSelection}
                                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors"
                            >
                                {selectedItems.length === purchase.items.length ? 'Deselect All' : 'Select All'}
                            </button>
                            <button
                                onClick={() => {
                                    const updates: { [key: string]: number } = {};
                                    purchase.items.forEach((_, idx) => updates[idx] = 1);
                                    setPrintQuantities(updates);
                                }}
                                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium transition-colors"
                            >
                                Set All to 1
                            </button>
                            <button
                                onClick={() => {
                                    const updates: { [key: string]: number } = {};
                                    purchase.items.forEach((_, idx) => updates[idx] = 5);
                                    setPrintQuantities(updates);
                                }}
                                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium transition-colors"
                            >
                                Set All to 5
                            </button>
                            <button
                                onClick={() => {
                                    const updates: { [key: string]: number } = {};
                                    purchase.items.forEach((item, idx) => updates[idx] = item.quantity);
                                    setPrintQuantities(updates);
                                }}
                                className="px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg text-xs font-medium transition-colors"
                            >
                                Match Purchase Quantities
                            </button>
                        </div>

                        {/* Products List */}
                        <div className="flex-1 overflow-y-auto space-y-2 mb-6 pr-2">
                            {purchase.items.map((item, index) => {
                                const isSelected = selectedItems.includes(index);
                                return (
                                    <div 
                                        key={index} 
                                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                            isSelected ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200 opacity-70'
                                        }`}
                                    >
                                        <div className="flex items-center h-5">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleItemSelection(index)}
                                                className="w-4 h-4 text-purple-600 bg-white border-gray-300 rounded focus:ring-purple-500 cursor-pointer"
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0" onClick={() => toggleItemSelection(index)}>
                                            <p className="font-bold text-gray-900 truncate text-sm cursor-pointer">{item.productName}</p>
                                            <div className="flex gap-3 mt-1">
                                                <span className="text-xs text-gray-600">Purchase Qty: <span className="font-bold">{item.quantity}</span></span>
                                                <span className="text-xs text-gray-600 truncate">{item.brand} {item.model ? `- ${item.model}` : ''}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => updatePrintQuantity(index, Math.max(1, (printQuantities[index] || 1) - 1))}
                                                disabled={!isSelected}
                                                className="w-8 h-8 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold flex items-center justify-center transition-colors"
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
                                                className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg text-center font-bold focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:bg-gray-100 transition-all text-sm"
                                            />
                                            <button
                                                onClick={() => updatePrintQuantity(index, Math.min(1000, (printQuantities[index] || 1) + 1))}
                                                disabled={!isSelected}
                                                className="w-8 h-8 bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold flex items-center justify-center transition-colors"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-4 border-t border-gray-200">
                            <button
                                onClick={() => setShowPrintAllModal(false)}
                                className="flex-1 bg-gray-100 text-gray-700 py-3 px-4 rounded-lg hover:bg-gray-200 transition-colors font-bold"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmPrintAllLabels}
                                disabled={selectedItems.length === 0}
                                className="flex-1 bg-purple-600 text-white py-3 px-4 rounded-lg hover:bg-purple-700 transition-all font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Printer className="h-5 w-5" />
                                {selectedItems.length === 0 ? 'Select Products' : `Print ${selectedItems.reduce((acc, idx) => acc + (printQuantities[idx] || 1), 0)} Selected Labels`}
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
        </div>
    );
};

export default PurchaseDetail;
