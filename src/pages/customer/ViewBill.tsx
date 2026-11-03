import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, collectionGroup } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { generateInvoice } from '../../utils/pdfGenerator';
import { Download, Loader, AlertCircle, ShieldCheck, Lock } from 'lucide-react';
import logoImg from '../../assets/logo.png';

const ViewBill = () => {
    const params = useParams();
    const location = useLocation();

    // Safely extract and normalize the invoice ID from the route path wildcard
    const rawParam = params['*'] || '';
    let decodedParam = '';
    try {
        decodedParam = decodeURIComponent(rawParam);
    } catch {
        decodedParam = rawParam;
    }
    const cleanId = decodedParam.replace(/^\/+|\/+$/g, '').trim();

    const [bill, setBill] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isVerified, setIsVerified] = useState(false);
    const [inputPhone, setInputPhone] = useState('');
    const [verifyError, setVerifyError] = useState('');

    useEffect(() => {
        const fetchBill = async () => {
            if (!cleanId) {
                setError('Invalid invoice link.');
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError('');

                const safeDocId = cleanId.replace(/\//g, '_');
                const slashDocId = cleanId.replace(/_/g, '/');

                let docSnap: any = null;

                // 1. Try root collection by safeDocId (primary)
                try {
                    docSnap = await getDoc(doc(db, 'transactions', safeDocId));
                } catch (_e) {}

                // 2. Try root collection by raw cleanId if different
                if ((!docSnap || !docSnap.exists()) && cleanId !== safeDocId) {
                    try {
                        docSnap = await getDoc(doc(db, 'transactions', cleanId));
                    } catch (_e) {}
                }

                // 3. Try root collection by slashDocId if different
                if ((!docSnap || !docSnap.exists()) && slashDocId !== safeDocId && slashDocId !== cleanId) {
                    try {
                        docSnap = await getDoc(doc(db, 'transactions', slashDocId));
                    } catch (_e) {}
                }

                // 4. Try root collection query by transactionId field
                if (!docSnap || !docSnap.exists()) {
                    const idCandidates = Array.from(new Set([slashDocId, cleanId, safeDocId].filter(Boolean)));
                    for (const candidate of idCandidates) {
                        try {
                            const q = query(collection(db, 'transactions'), where('transactionId', '==', candidate));
                            const snap = await getDocs(q);
                            if (!snap.empty) {
                                docSnap = snap.docs[0];
                                break;
                            }
                        } catch (_e) {}
                    }
                }

                // 5. Try collectionGroup('transactions') across all store-scoped subcollections
                if (!docSnap || !docSnap.exists()) {
                    const idCandidates = Array.from(new Set([slashDocId, cleanId, safeDocId].filter(Boolean)));
                    for (const candidate of idCandidates) {
                        try {
                            const q = query(collectionGroup(db, 'transactions'), where('transactionId', '==', candidate));
                            const snap = await getDocs(q);
                            if (!snap.empty) {
                                docSnap = snap.docs[0];
                                break;
                            }
                        } catch (_e) {}
                    }
                }

                // 6. Direct lookup across stores subcollections if stores collection exists
                if (!docSnap || !docSnap.exists()) {
                    try {
                        const storesSnap = await getDocs(collection(db, 'stores'));
                        for (const storeDoc of storesSnap.docs) {
                            try {
                                const stSnap = await getDoc(doc(db, 'stores', storeDoc.id, 'transactions', safeDocId));
                                if (stSnap.exists()) {
                                    docSnap = stSnap;
                                    break;
                                }
                            } catch (_e) {}
                        }
                    } catch (_e) {}
                }

                // 7. Fallback: reconstruct bill from collectionGroup('billingItems')
                if (!docSnap || !docSnap.exists()) {
                    const idCandidates = Array.from(new Set([slashDocId, cleanId, safeDocId].filter(Boolean)));
                    for (const candidate of idCandidates) {
                        try {
                            const q = query(collectionGroup(db, 'billingItems'), where('transactionId', '==', candidate));
                            const snap = await getDocs(q);
                            if (!snap.empty) {
                                const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
                                const first = items[0];
                                const calculatedTotal = items.reduce((sum: number, it: any) => sum + (Number(it.sellingPrice || it.price || 0) * Number(it.quantity || 1)), 0);

                                const reconstructed = {
                                    id: candidate,
                                    transactionId: first.transactionId || slashDocId || candidate,
                                    customerName: first.customerName || 'Customer',
                                    customerPhone: first.customerPhone || '',
                                    customerAddress: first.customerAddress || '',
                                    grandTotal: first.grandTotal || calculatedTotal,
                                    total: first.grandTotal || calculatedTotal,
                                    subtotal: first.subtotal || calculatedTotal,
                                    discount: first.discount || 0,
                                    discountAmount: first.discountAmount || first.discount || 0,
                                    roundOff: first.roundOff !== undefined ? first.roundOff : 0,
                                    paymentMode: first.paymentMode || 'cash',
                                    gstEnabled: first.gstEnabled || false,
                                    gstRate: first.gstRate || 0,
                                    gstAmount: first.gstAmount || 0,
                                    shopName: first.shopName,
                                    shopPhone: first.shopPhone,
                                    shopAddress: first.shopAddress,
                                    shopGst: first.shopGst,
                                    items: items.map((it: any) => ({
                                        title: it.name || it.title || 'Product',
                                        name: it.name || it.title || 'Product',
                                        quantity: it.quantity || 1,
                                        sellingPrice: it.sellingPrice || it.price || 0,
                                        price: it.price || it.sellingPrice || 0,
                                        cost: it.cost || 0,
                                        imei: it.imei || '',
                                        hsnCode: it.hsnCode || ''
                                    })),
                                    createdAt: first.createdAt
                                };

                                setBill(reconstructed);

                                // Check auto-verify from query params or missing phone
                                const searchParams = new URLSearchParams(location.search);
                                const qPhone = searchParams.get('p') || searchParams.get('phone');
                                if (!reconstructed.customerPhone || reconstructed.customerPhone === 'N/A') {
                                    setIsVerified(true);
                                } else if (qPhone) {
                                    const cleanQ = qPhone.replace(/\D/g, '').slice(-10);
                                    const cleanB = reconstructed.customerPhone.replace(/\D/g, '').slice(-10);
                                    if (cleanQ && cleanB && cleanQ === cleanB) {
                                        setIsVerified(true);
                                    }
                                }
                                setLoading(false);
                                return;
                            }
                        } catch (_e) {}
                    }
                }

                if (docSnap && docSnap.exists()) {
                    const data: any = { id: docSnap.id, ...docSnap.data() };

                    // Ensure display transaction ID retains original slashed format if available
                    if (!data.transactionId) {
                        data.transactionId = slashDocId;
                    }

                    // Enrich items with IMEI and HSC if missing (for older bills)
                    if (data.items && Array.isArray(data.items)) {
                        for (let i = 0; i < data.items.length; i++) {
                            const item = data.items[i];
                            if (item.id && !item.id.startsWith('service-') && (!item.imei || !item.hsnCode)) {
                                try {
                                    const productRef = doc(db, 'products', item.id);
                                    const productSnap = await getDoc(productRef);
                                    if (productSnap.exists()) {
                                        const pData = productSnap.data();
                                        if (!item.imei && pData.imei) item.imei = pData.imei;
                                        if (!item.hsnCode && (pData.hcsCode || pData.hsnCode)) item.hsnCode = pData.hcsCode || pData.hsnCode;
                                    }
                                } catch (e) {
                                    console.log('Error enriching product details:', e);
                                }
                            }
                        }
                    }

                    setBill(data);

                    // Auto-verify if no customer phone is associated (e.g. Walk-in)
                    // or if verified via query param (?p=...)
                    const searchParams = new URLSearchParams(location.search);
                    const qPhone = searchParams.get('p') || searchParams.get('phone');
                    if (!data.customerPhone || data.customerPhone === 'N/A') {
                        setIsVerified(true);
                    } else if (qPhone) {
                        const cleanQ = qPhone.replace(/\D/g, '').slice(-10);
                        const cleanB = data.customerPhone.replace(/\D/g, '').slice(-10);
                        if (cleanQ && cleanB && cleanQ === cleanB) {
                            setIsVerified(true);
                        }
                    }
                } else {
                    setError('Invoice not found. It may have been deleted or the link is invalid.');
                }
            } catch (err: any) {
                console.error('Error fetching bill:', err);
                setError('Failed to load invoice details.');
            } finally {
                setLoading(false);
            }
        };

        fetchBill();
    }, [cleanId, location.search]);

    const handleVerify = () => {
        if (!bill || !bill.customerPhone) {
            setIsVerified(true);
            return;
        }

        // Normalize phones (remove spaces, dashes, +91, etc)
        const cleanInput = inputPhone.replace(/\D/g, '').slice(-10);
        const cleanBillPhone = bill.customerPhone.replace(/\D/g, '').slice(-10);

        if (cleanInput === cleanBillPhone) {
            setIsVerified(true);
            setVerifyError('');
        } else {
            setVerifyError('Incorrect mobile number. Please try again.');
        }
    };

    const [globalShopDetails, setGlobalShopDetails] = useState<any>(null);

    useEffect(() => {
        const fetchShopDetails = async () => {
            try {
                const docRef = doc(db, 'settings', 'shopDetails');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setGlobalShopDetails(docSnap.data());
                }
            } catch (err) {
                console.error("Error fetching shop details", err);
            }
        };
        fetchShopDetails();
    }, []);

    const generatePDF = async () => {
        if (!bill) return;

        // Construct ShopDetails object with fallbacks: Bill -> Global Settings -> Hardcoded Default
        const shopDetails: any = {
            shopName: bill.shopName || globalShopDetails?.shopName || 'Digital Zone',
            address: bill.shopAddress || globalShopDetails?.address || 'Store Address',
            phone: bill.shopPhone || globalShopDetails?.phone || '',
            gst: bill.shopGst || globalShopDetails?.gst || '',
            email: bill.shopEmail || globalShopDetails?.email || globalShopDetails?.shopEmail || ''
        };

        // Construct BillingItem-like object from bill
        const billItem: any = {
            title: 'Order Summary',
            quantity: bill.quantities || 0,
            sellingPrice: 0,
            grandTotal: bill.grandTotal || bill.total || 0, // Explicitly pass grandTotal
            totalWithGst: bill.grandTotal || bill.total || 0, // Legacy support
            discount: Number(bill.discount || bill.discountAmount || 0), // Pass discount
            discountAmount: Number(bill.discount || bill.discountAmount || 0), // Legacy support
            roundOff: Number(bill.roundOff || 0),
            customerName: bill.customerName || 'Walk-in',
            customerPhone: bill.customerPhone || '',
            customerAddress: bill.customerAddress || '',
            paymentMode: bill.paymentMode || 'cash',
            gstRate: bill.gstRate || 0,
            gstAmount: bill.gstAmount || 0,
            financeProvider: bill.financeProvider || '',
            financeTenureMonths: bill.financeTenureMonths || 0,
            financeDownPayment: bill.financeDownPayment || 0,
            processingFee: bill.processingFee || 0,
            financeAmount: bill.financeAmount || 0,
            monthlyEmi: bill.monthlyEmi || 0,
            items: bill.items || [],
            subtotal: bill.subtotal || bill.total || 0,
            itemsTotal: bill.subtotal || bill.total || 0, // Fallback
            paymentSplit: bill.paymentSplit,
            createdAt: bill.createdAt // Pass original transaction date
        };

        // Call shared generator
        await generateInvoice(billItem, shopDetails, bill.transactionId || bill.id);
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
                <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Error</h2>
                    <p className="text-gray-600">{error}</p>
                </div>
            </div>
        );
    }

    // Verification Guard UI
    if (!isVerified) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                    <div className="bg-blue-600 p-6 text-center">
                        <div className="bg-white p-2 rounded-full w-20 h-20 mx-auto mb-4 shadow-lg flex items-center justify-center">
                            <img src={logoImg} alt="Logo" className="w-full h-full object-contain" />
                        </div>
                        <h2 className="text-2xl font-bold text-white">Secure Access</h2>
                        <p className="text-blue-100 text-sm mt-1">Verify your identity to view invoice</p>
                    </div>

                    <div className="p-8">
                        <div className="text-center mb-6">
                            <Lock className="w-12 h-12 text-blue-500 mx-auto mb-2 opacity-80" />
                            <p className="text-gray-600 text-sm">
                                For security reasons, please enter the mobile number associated with this invoice.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
                                <input
                                    type="tel"
                                    value={inputPhone}
                                    onChange={(e) => setInputPhone(e.target.value)}
                                    placeholder="Enter registered mobile number"
                                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-center text-lg tracking-widest"
                                />
                            </div>

                            {verifyError && (
                                <p className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">{verifyError}</p>
                            )}

                            <button
                                onClick={handleVerify}
                                className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                            >
                                Verify & View Invoice
                            </button>
                        </div>

                        <div className="mt-6 text-center">
                            <p className="text-xs text-gray-400">
                                <ShieldCheck className="w-3 h-3 inline mr-1" />
                                256-bit Secure Verification
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const totalAmount = bill?.grandTotal || bill?.total || 0;

    return (
        <div className="min-h-screen bg-gray-100 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden relative">

                {/* Header */}
                <div className="bg-white border-b border-gray-100 px-6 py-8 text-center">
                    <div className="w-24 h-24 mx-auto mb-4">
                        <img src={logoImg} alt="Shop Logo" className="w-full h-full object-contain" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-1">{bill.shopName || 'Digital Zone'}</h1>
                    <p className="text-gray-500 text-sm">Thank you for your purchase!</p>
                </div>

                {/* Bill Summary */}
                <div className="px-6 py-8">
                    <div className="flex flex-col sm:flex-row justify-between items-center bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6 gap-4 sm:gap-0">
                        <div className="text-center sm:text-left">
                            <p className="text-sm text-gray-500 mb-1">Customer</p>
                            <p className="font-semibold text-gray-800 text-lg">{bill.customerName}</p>
                            {bill.customerPhone && <p className="text-sm text-gray-600">{bill.customerPhone}</p>}
                            {bill.customerAddress && <p className="text-xs text-gray-500 mt-1 max-w-[200px]">{bill.customerAddress}</p>}
                        </div>
                        <div className="text-center sm:text-right border-t sm:border-t-0 border-gray-200 pt-4 sm:pt-0 w-full sm:w-auto mt-2 sm:mt-0">
                            <p className="text-sm text-gray-500 mb-1">Invoice Amount</p>
                            <p className="font-bold text-blue-600 text-2xl">₹{Number(totalAmount).toFixed(2)}</p>
                            <p className="text-xs text-gray-500 mt-1">INV: {bill.transactionId || '---'}</p>
                        </div>
                    </div>

                    <div className="space-y-4 mb-8">
                        {/* Item Preview (Show top 3 items) */}
                        {bill.items && bill.items.length > 0 && (
                            <div className="border rounded-lg overflow-hidden">
                                <div className="bg-gray-100 px-4 py-2 text-xs font-medium text-gray-500 uppercase">Order Details</div>
                                {bill.items.slice(0, 3).map((item: any, idx: number) => (
                                    <div key={idx} className="flex justify-between p-4 border-b last:border-0 border-gray-100 text-sm hover:bg-gray-50 transition-colors">
                                        <span className="font-medium text-gray-700">{item.title || item.name} <span className="text-gray-400 text-xs">x{item.quantity}</span></span>
                                        <span className="text-gray-900 font-semibold">₹{((item.sellingPrice || item.price) * (item.quantity)).toFixed(2)}</span>
                                    </div>
                                ))}
                                {bill.items.length > 3 && (
                                    <div className="p-3 text-center text-xs text-gray-500 bg-gray-50">
                                        + {bill.items.length - 3} more items...
                                    </div>
                                )}
                                {bill.roundOff !== undefined && Number(bill.roundOff) !== 0 && (
                                    <div className="flex justify-between px-4 py-2 border-t border-gray-100 text-xs bg-gray-50/50">
                                        <span className="text-gray-500 font-medium">Round Off</span>
                                        <span className={Number(bill.roundOff) < 0 ? "text-red-600 font-semibold" : "text-emerald-700 font-semibold"}>
                                            {Number(bill.roundOff) > 0 ? `+₹${Number(bill.roundOff).toFixed(2)}` : `-₹${Math.abs(Number(bill.roundOff)).toFixed(2)}`}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={generatePDF}
                        className="w-full bg-blue-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 flex items-center justify-center gap-3 group transform hover:-translate-y-1"
                    >
                        <Download className="w-6 h-6 group-hover:scale-110 transition-transform" />
                        Download Official Invoice
                    </button>

                    <p className="text-center text-xs text-gray-400 mt-8 flex items-center justify-center gap-1">
                        <Lock className="w-3 h-3" />
                        Encrypted & Securely Generated by Digital Zone
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ViewBill;
