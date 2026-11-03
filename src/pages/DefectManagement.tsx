import React, { useState, useEffect, useMemo, useRef } from 'react';
import Navbar from '../components/Navbar';
import {
    AlertTriangle,
    Plus,
    Search,
    X,
    Package,
    Edit2,
    Trash2,
    RefreshCw,
    DollarSign,
    Clock,
    Truck,
    CheckCircle2,
    Info
} from 'lucide-react';
import type { DefectProduct } from '../types';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import { useAvailableProducts } from '../hooks/useFirestoreCache';
import {
    query,
    where,
    orderBy,
    getDocs,
    getDoc,
    addDoc,
    deleteDoc,
    updateDoc,
    Timestamp
} from 'firebase/firestore';

const DefectManagement: React.FC = () => {
    const { currentUser } = useAuth();
    const { getCollectionRef, getDocRef, currentStore, currentHub } = useStore();
    const { success, error: showError } = useToastContext();

    // Primary State
    const [defectProducts, setDefectProducts] = useState<DefectProduct[]>([]);
    const [loading, setLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Modal States
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<DefectProduct | null>(null);

    // Filter & Search States
    const [searchTerm, setSearchTerm] = useState('');
    const [filterDefectType, setFilterDefectType] = useState<string>('all');
    const [filterActionTaken, setFilterActionTaken] = useState<string>('all');
    const [filterBrand, setFilterBrand] = useState<string>('all');

    // Product search for modal
    const { data: availableProducts = [] } = useAvailableProducts();
    const [productSearchText, setProductSearchText] = useState('');
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [selectedProductIndex, setSelectedProductIndex] = useState(-1);
    const isSubmittingRef = useRef(false);

    // Form state
    const [formData, setFormData] = useState({
        productCode: '',
        productName: '',
        brand: '',
        model: '',
        category: '',
        quantity: '',
        cost: '',
        defectType: 'damaged' as 'damaged' | 'defective' | 'expired' | 'other',
        defectReason: '',
        supplier: '',
        actionTaken: 'pending' as 'pending' | 'returned' | 'discarded' | 'repaired' | 'sold-at-loss',
        actionNotes: '',
        recoverableAmount: '',
        lossAmount: ''
    });

    useEffect(() => {
        fetchDefectProducts();
    }, [currentStore?.id, currentHub?.id]);

    const fetchDefectProducts = async (isManual = false) => {
        try {
            if (isManual) setIsRefreshing(true);
            else setLoading(true);

            const defectsQuery = query(
                getCollectionRef('defectProducts'),
                orderBy('createdAt', 'desc')
            );
            const querySnapshot = await getDocs(defectsQuery);

            const fetchedDefects = querySnapshot.docs.map((docSnapshot) => {
                const data = docSnapshot.data();
                let createdDate: Date | undefined = undefined;
                if (data.createdAt?.toDate) {
                    createdDate = data.createdAt.toDate();
                } else if (data.createdAt instanceof Date) {
                    createdDate = data.createdAt;
                } else if (data.createdAt) {
                    createdDate = new Date(data.createdAt);
                }

                let updatedDate: Date | undefined = undefined;
                if (data.updatedAt?.toDate) {
                    updatedDate = data.updatedAt.toDate();
                } else if (data.updatedAt instanceof Date) {
                    updatedDate = data.updatedAt;
                } else if (data.updatedAt) {
                    updatedDate = new Date(data.updatedAt);
                }

                return {
                    id: docSnapshot.id,
                    ...data,
                    quantity: Number(data.quantity) || 0,
                    cost: Number(data.cost) || 0,
                    totalCost: Number(data.totalCost) || 0,
                    lossAmount: Number(data.lossAmount) || 0,
                    recoverableAmount: Number(data.recoverableAmount) || 0,
                    createdAt: createdDate || new Date(),
                    updatedAt: updatedDate,
                } as DefectProduct;
            });

            setDefectProducts(fetchedDefects);
        } catch (error: any) {
            console.error('Error fetching defect products:', error);
            showError('Failed to fetch defect records: ' + (error.message || 'Network error'));
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };

    const handleFormChange = (field: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const resetForm = () => {
        setFormData({
            productCode: '',
            productName: '',
            brand: '',
            model: '',
            category: '',
            quantity: '',
            cost: '',
            defectType: 'damaged',
            defectReason: '',
            supplier: '',
            actionTaken: 'pending',
            actionNotes: '',
            recoverableAmount: '',
            lossAmount: ''
        });
        setProductSearchText('');
        setShowProductDropdown(false);
        setSelectedProductIndex(-1);
    };

    // Filtered available products for autocomplete
    const filteredAvailableProducts = useMemo(() => {
        if (!productSearchText.trim()) return [];
        const q = productSearchText.toLowerCase().trim();
        return availableProducts.filter((product: any) => {
            return (
                product.name?.toLowerCase().includes(q) ||
                (product.productCode && String(product.productCode).toLowerCase().includes(q)) ||
                product.brand?.toLowerCase().includes(q) ||
                (product.model && typeof product.model === 'string' && product.model.toLowerCase().includes(q))
            );
        });
    }, [availableProducts, productSearchText]);

    const selectProductFromSearch = (product: any) => {
        setFormData(prev => ({
            ...prev,
            productCode: product.productCode || '',
            productName: product.name || '',
            brand: product.brand || '',
            model: product.model || '',
            category: product.category || '',
            cost: product.cost?.toString() || '0',
            supplier: product.supplier || ''
        }));
        setProductSearchText(product.name || '');
        setShowProductDropdown(false);
        setSelectedProductIndex(-1);
    };

    const handleProductSearchKeyDown = (e: React.KeyboardEvent) => {
        if (!showProductDropdown) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedProductIndex(prev =>
                prev < filteredAvailableProducts.length - 1 ? prev + 1 : prev
            );
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedProductIndex(prev => prev > 0 ? prev - 1 : prev);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedProductIndex >= 0 && selectedProductIndex < filteredAvailableProducts.length) {
                selectProductFromSearch(filteredAvailableProducts[selectedProductIndex]);
            }
        } else if (e.key === 'Escape') {
            setShowProductDropdown(false);
            setSelectedProductIndex(-1);
        }
    };

    // Click outside to dismiss product dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.defect-product-search-container')) {
                setShowProductDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Add Defect Product
    const handleAddDefectProduct = async () => {
        if (isSubmittingRef.current) return;

        if (!formData.productName.trim() || !formData.cost) {
            showError('Please search and select a product from store inventory first.');
            return;
        }

        const quantity = parseInt(formData.quantity);
        const cost = parseFloat(formData.cost);
        const recoverableAmount = formData.recoverableAmount ? parseFloat(formData.recoverableAmount) : 0;

        if (isNaN(quantity) || quantity <= 0) {
            showError('Please enter a valid defective quantity (1 or more).');
            return;
        }

        if (isNaN(cost) || cost < 0) {
            showError('Please enter a valid cost per unit.');
            return;
        }

        const totalCost = quantity * cost;
        const lossAmount = formData.lossAmount ? parseFloat(formData.lossAmount) : Math.max(0, totalCost - recoverableAmount);

        try {
            isSubmittingRef.current = true;
            setLoading(true);

            // Locate product in products collection to deduct live stock
            let productId: string | null = null;
            if (formData.productCode) {
                const productByCodeQuery = query(
                    getCollectionRef('products'),
                    where('productCode', '==', formData.productCode)
                );
                const productByCodeSnap = await getDocs(productByCodeQuery);
                if (!productByCodeSnap.empty) {
                    productId = productByCodeSnap.docs[0].id;
                }
            }

            if (!productId) {
                const productByNameQuery = query(
                    getCollectionRef('products'),
                    where('name', '==', formData.productName)
                );
                const productByNameSnap = await getDocs(productByNameQuery);
                if (!productByNameSnap.empty) {
                    productId = productByNameSnap.docs[0].id;
                }
            }

            // Deduct stock if product found
            if (productId) {
                const productDoc = await getDoc(getDocRef('products', productId));
                if (productDoc.exists()) {
                    const currentQty = Number(productDoc.data().quantity || 0);
                    if (currentQty < quantity) {
                        showError(`Insufficient stock! Current stock: ${currentQty}, Requested defect deduction: ${quantity}`);
                        setLoading(false);
                        isSubmittingRef.current = false;
                        return;
                    }

                    const newQty = Math.max(0, currentQty - quantity);
                    await updateDoc(getDocRef('products', productId), {
                        quantity: newQty,
                        isAvailable: newQty > 0,
                        updatedAt: Timestamp.now()
                    });
                }
            }

            const newDefectProduct: any = {
                productName: formData.productName.trim(),
                brand: formData.brand.trim() || 'Generic',
                category: formData.category.trim() || 'General',
                quantity,
                cost,
                totalCost,
                defectType: formData.defectType,
                defectReason: formData.defectReason.trim() || 'Defect/Damage logged',
                actionTaken: formData.actionTaken,
                lossAmount,
                createdAt: Timestamp.now(),
                createdBy: currentUser?.uid || '',
                createdByName: currentUser?.displayName || currentUser?.email || 'Staff'
            };

            if (formData.productCode) newDefectProduct.productCode = formData.productCode;
            if (formData.model) newDefectProduct.model = formData.model;
            if (formData.supplier) newDefectProduct.supplier = formData.supplier;
            if (formData.actionNotes) newDefectProduct.actionNotes = formData.actionNotes;
            if (recoverableAmount > 0) newDefectProduct.recoverableAmount = recoverableAmount;
            if (productId) newDefectProduct.productId = productId;

            await addDoc(getCollectionRef('defectProducts'), newDefectProduct);

            success(`Defect logged for "${formData.productName}" and stock deducted by ${quantity} units.`);
            setShowAddModal(false);
            resetForm();
            await fetchDefectProducts();
        } catch (error: any) {
            console.error('Error adding defect product:', error);
            showError('Failed to record defect: ' + (error.message || 'Unknown error'));
        } finally {
            setLoading(false);
            isSubmittingRef.current = false;
        }
    };

    // Edit Defect Product
    const handleEditDefectProduct = async () => {
        if (!selectedProduct?.id || isSubmittingRef.current) return;

        const quantity = parseInt(formData.quantity);
        const cost = parseFloat(formData.cost);
        const recoverableAmount = formData.recoverableAmount ? parseFloat(formData.recoverableAmount) : 0;

        if (isNaN(quantity) || quantity <= 0) {
            showError('Please enter a valid quantity.');
            return;
        }

        const totalCost = quantity * cost;
        const lossAmount = formData.lossAmount ? parseFloat(formData.lossAmount) : Math.max(0, totalCost - recoverableAmount);

        try {
            isSubmittingRef.current = true;
            setLoading(true);

            const updatedData: any = {
                productName: formData.productName.trim(),
                brand: formData.brand.trim() || 'Generic',
                category: formData.category.trim() || 'General',
                quantity,
                cost,
                totalCost,
                defectType: formData.defectType,
                defectReason: formData.defectReason.trim() || '',
                actionTaken: formData.actionTaken,
                lossAmount,
                updatedAt: Timestamp.now(),
                updatedBy: currentUser?.uid || '',
                updatedByName: currentUser?.displayName || currentUser?.email || 'Staff'
            };

            if (formData.productCode) updatedData.productCode = formData.productCode;
            if (formData.model) updatedData.model = formData.model;
            if (formData.supplier) updatedData.supplier = formData.supplier;
            if (formData.actionNotes) updatedData.actionNotes = formData.actionNotes;
            if (recoverableAmount >= 0) updatedData.recoverableAmount = recoverableAmount;

            await updateDoc(getDocRef('defectProducts', selectedProduct.id), updatedData);

            success(`Defect record for "${formData.productName}" updated successfully.`);
            setShowEditModal(false);
            setSelectedProduct(null);
            resetForm();
            await fetchDefectProducts();
        } catch (error: any) {
            console.error('Error updating defect product:', error);
            showError('Failed to update defect record: ' + (error.message || 'Unknown error'));
        } finally {
            setLoading(false);
            isSubmittingRef.current = false;
        }
    };

    // Quick Action Lifecycle Status Update
    const handleQuickStatusUpdate = async (product: DefectProduct, newStatus: DefectProduct['actionTaken']) => {
        if (!product.id) return;
        try {
            await updateDoc(getDocRef('defectProducts', product.id), {
                actionTaken: newStatus,
                updatedAt: Timestamp.now(),
                updatedBy: currentUser?.uid || '',
                updatedByName: currentUser?.displayName || currentUser?.email || 'Staff'
            });
            success(`Status updated to "${newStatus.replace('-', ' ').toUpperCase()}"`);
            await fetchDefectProducts();
        } catch (err: any) {
            showError('Failed to update status: ' + (err.message || 'Error'));
        }
    };

    // Delete Record
    const handleDelete = async () => {
        if (!selectedProduct?.id || isSubmittingRef.current) return;

        try {
            isSubmittingRef.current = true;
            setLoading(true);
            await deleteDoc(getDocRef('defectProducts', selectedProduct.id));
            success(`Deleted defect record for "${selectedProduct.productName}".`);
            setShowDeleteModal(false);
            setSelectedProduct(null);
            await fetchDefectProducts();
        } catch (error: any) {
            console.error('Error deleting defect product:', error);
            showError('Failed to delete defect record: ' + (error.message || 'Unknown error'));
        } finally {
            setLoading(false);
            isSubmittingRef.current = false;
        }
    };

    const openEditModal = (product: DefectProduct) => {
        setSelectedProduct(product);
        setFormData({
            productCode: product.productCode || '',
            productName: product.productName,
            brand: product.brand,
            model: product.model || '',
            category: product.category,
            quantity: product.quantity.toString(),
            cost: product.cost.toString(),
            defectType: product.defectType,
            defectReason: product.defectReason || '',
            supplier: product.supplier || '',
            actionTaken: product.actionTaken,
            actionNotes: product.actionNotes || '',
            recoverableAmount: product.recoverableAmount?.toString() || '',
            lossAmount: product.lossAmount?.toString() || ''
        });
        setShowEditModal(true);
    };

    const openDeleteModal = (product: DefectProduct) => {
        setSelectedProduct(product);
        setShowDeleteModal(true);
    };

    // Filter Logic
    const filteredProducts = useMemo(() => {
        return defectProducts.filter(product => {
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase().trim();
                const matches = (
                    product.productName.toLowerCase().includes(term) ||
                    product.brand.toLowerCase().includes(term) ||
                    (product.productCode && product.productCode.toLowerCase().includes(term)) ||
                    (product.model && product.model.toLowerCase().includes(term)) ||
                    (product.supplier && product.supplier.toLowerCase().includes(term))
                );
                if (!matches) return false;
            }

            if (filterDefectType !== 'all' && product.defectType !== filterDefectType) {
                return false;
            }

            if (filterActionTaken !== 'all' && product.actionTaken !== filterActionTaken) {
                return false;
            }

            if (filterBrand !== 'all' && product.brand !== filterBrand) {
                return false;
            }

            return true;
        });
    }, [defectProducts, searchTerm, filterDefectType, filterActionTaken, filterBrand]);

    // Unique Brands for Filter
    const uniqueBrands = useMemo(() => {
        return Array.from(new Set(defectProducts.map(p => p.brand).filter(Boolean))).sort();
    }, [defectProducts]);

    // Statistics Calculation
    const stats = useMemo(() => {
        const totalDefects = defectProducts.length;
        const totalQuantity = defectProducts.reduce((sum, p) => sum + (p.quantity || 0), 0);
        const totalCostValue = defectProducts.reduce((sum, p) => sum + (p.totalCost || 0), 0);
        const totalLoss = defectProducts.reduce((sum, p) => sum + (p.lossAmount || 0), 0);
        const totalRecovered = defectProducts.reduce((sum, p) => sum + (p.recoverableAmount || 0), 0);
        const pendingActions = defectProducts.filter(p => p.actionTaken === 'pending').length;
        const returnedCount = defectProducts.filter(p => p.actionTaken === 'returned').length;
        const repairedCount = defectProducts.filter(p => p.actionTaken === 'repaired').length;

        return {
            totalDefects,
            totalQuantity,
            totalCostValue,
            totalLoss,
            totalRecovered,
            pendingActions,
            returnedCount,
            repairedCount
        };
    }, [defectProducts]);

    // Defect Type Visual Styling
    const getDefectTypeBadge = (type: string) => {
        switch (type) {
            case 'damaged':
                return 'bg-rose-50 text-rose-700 border-rose-200';
            case 'defective':
                return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'expired':
                return 'bg-purple-50 text-purple-700 border-purple-200';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-200';
        }
    };

    // Action Taken Visual Styling
    const getActionBadge = (action: string) => {
        switch (action) {
            case 'pending':
                return {
                    label: 'Pending RMA / Action',
                    cls: 'bg-amber-50 text-amber-700 border-amber-200',
                    icon: <Clock className="w-3 h-3 text-amber-600" />
                };
            case 'returned':
                return {
                    label: 'Returned to Supplier',
                    cls: 'bg-blue-50 text-blue-700 border-blue-200',
                    icon: <Truck className="w-3 h-3 text-blue-600" />
                };
            case 'repaired':
                return {
                    label: 'Repaired & Restocked',
                    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                };
            case 'sold-at-loss':
                return {
                    label: 'Sold at Loss / Scrap',
                    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                    icon: <DollarSign className="w-3 h-3 text-indigo-600" />
                };
            case 'discarded':
            default:
                return {
                    label: 'Discarded / Written Off',
                    cls: 'bg-slate-100 text-slate-700 border-slate-200',
                    icon: <Trash2 className="w-3 h-3 text-slate-500" />
                };
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />

            <div className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8">
                {/* ── COMPACT HEADER (Clean Project Style matching Products.tsx) ── */}
                <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />
                            Defect & Damage
                        </h1>
                        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                            {filteredProducts.length} item{filteredProducts.length !== 1 ? 's' : ''} listed
                            {currentStore?.name && (
                                <span className="text-gray-400 hidden md:inline"> • Location: <strong className="text-gray-700 font-medium">{currentStore.name}</strong></span>
                            )}
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <button
                            type="button"
                            onClick={() => fetchDefectProducts(true)}
                            disabled={isRefreshing}
                            title="Refresh defect list"
                            className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-red-600' : 'text-gray-500'}`} />
                            <span className="hidden sm:inline">Refresh</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                resetForm();
                                setShowAddModal(true);
                            }}
                            className="bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm whitespace-nowrap"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Log Defect Item</span>
                        </button>
                    </div>
                </div>

                {/* ── COMPACT STATS (Matching Products.tsx) ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                        <p className="text-xs text-gray-500">Total Defect Units</p>
                        <p className="text-lg font-bold text-gray-900">{stats.totalQuantity.toLocaleString()} units</p>
                    </div>

                    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                        <p className="text-xs text-gray-500">Net Financial Loss</p>
                        <p className="text-lg font-bold text-red-600">
                            ₹{Math.round(stats.totalLoss).toLocaleString()}
                        </p>
                    </div>

                    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                        <p className="text-xs text-gray-500">Pending Resolution</p>
                        <p className="text-lg font-bold text-blue-600">{stats.pendingActions} items</p>
                    </div>

                    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                        <p className="text-xs text-gray-500">Recovered Value</p>
                        <p className="text-lg font-bold text-green-600">
                            ₹{Math.round(stats.totalRecovered).toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* ── COMPACT FILTERS & SEARCH (Matching Products.tsx) ── */}
                <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        {/* Defect Type Pill Filter Tags */}
                        {[
                            { id: 'all', label: 'All' },
                            { id: 'damaged', label: 'Damaged' },
                            { id: 'defective', label: 'Defective' },
                            { id: 'expired', label: 'Expired' },
                            { id: 'other', label: 'Other' },
                        ].map(t => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setFilterDefectType(t.id)}
                                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${
                                    filterDefectType === t.id
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}

                        {/* Search Input inline */}
                        <div className="relative flex-1 min-w-[200px] sm:min-w-[260px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search product, code, brand, model, supplier..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
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

                        {/* Action Taken Filter Dropdown */}
                        <div className="relative">
                            <select
                                value={filterActionTaken}
                                onChange={e => setFilterActionTaken(e.target.value)}
                                className="px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none"
                            >
                                <option value="all">All Action Statuses</option>
                                <option value="pending">Pending</option>
                                <option value="returned">Returned to Supplier</option>
                                <option value="repaired">Repaired</option>
                                <option value="discarded">Discarded</option>
                                <option value="sold-at-loss">Sold at Loss</option>
                            </select>
                        </div>

                        {/* Brand Filter Dropdown */}
                        {uniqueBrands.length > 0 && (
                            <div className="relative">
                                <select
                                    value={filterBrand}
                                    onChange={e => setFilterBrand(e.target.value)}
                                    className="px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none"
                                >
                                    <option value="all">All Brands</option>
                                    {uniqueBrands.map(b => (
                                        <option key={b} value={b}>{b}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── DEFECT RECORDS TABLE & CARDS ── */}
                {loading ? (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                        <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="text-gray-600 text-sm font-medium">Loading defect records...</p>
                    </div>
                ) : filteredProducts.length === 0 ? (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
                        <AlertTriangle className="w-14 h-14 text-gray-300 mx-auto mb-3" />
                        <h3 className="text-gray-700 font-semibold text-base">No defect records found</h3>
                        <p className="text-gray-500 text-xs mt-1 max-w-sm mx-auto">
                            {searchTerm || filterDefectType !== 'all' || filterActionTaken !== 'all'
                                ? 'No defect entries match your active search filters.'
                                : 'No defective or damaged items have been logged yet.'}
                        </p>
                        <div className="mt-4">
                            <button
                                type="button"
                                onClick={() => {
                                    resetForm();
                                    setShowAddModal(true);
                                }}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors inline-flex items-center gap-1.5"
                            >
                                <Plus className="w-4 h-4" />
                                <span>Log New Defect</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                        {/* Table View */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                        <th className="py-3 px-4">Item Details</th>
                                        <th className="py-3 px-4">Defect Classification</th>
                                        <th className="py-3 px-4 text-center">Qty</th>
                                        <th className="py-3 px-4 text-right">Cost Value</th>
                                        <th className="py-3 px-4 text-right">Realized Loss</th>
                                        <th className="py-3 px-4 text-center">Action Status</th>
                                        <th className="py-3 px-4 text-left">Logged Date</th>
                                        <th className="py-3 px-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-sm">
                                    {filteredProducts.map(product => {
                                        const actionObj = getActionBadge(product.actionTaken);
                                        const dateStr = product.createdAt ? new Date(product.createdAt).toLocaleDateString('en-IN', {
                                            day: '2-digit',
                                            month: 'short',
                                            year: 'numeric'
                                        }) : '-';

                                        return (
                                            <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                                                {/* Item Details */}
                                                <td className="py-3 px-4">
                                                    <div>
                                                        <div className="font-semibold text-gray-900 leading-tight">
                                                            {product.productName}
                                                        </div>
                                                        <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                                            <span>{product.brand}</span>
                                                            {product.model && <span>• {product.model}</span>}
                                                            {product.category && <span className="text-gray-400">• {product.category}</span>}
                                                        </div>
                                                        {product.productCode && (
                                                            <div className="text-[11px] font-mono text-gray-400 mt-0.5">
                                                                Code: {product.productCode}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Defect Classification */}
                                                <td className="py-3 px-4">
                                                    <span className={`inline-block px-2.5 py-0.5 text-xs font-medium rounded-full border capitalize ${getDefectTypeBadge(product.defectType)}`}>
                                                        {product.defectType}
                                                    </span>
                                                    {product.defectReason && (
                                                        <p className="text-xs text-gray-600 mt-1 max-w-xs line-clamp-2" title={product.defectReason}>
                                                            {product.defectReason}
                                                        </p>
                                                    )}
                                                </td>

                                                {/* Quantity */}
                                                <td className="py-3 px-4 text-center font-bold text-gray-900">
                                                    <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 bg-gray-100 rounded text-xs font-bold text-gray-800">
                                                        {product.quantity}
                                                    </span>
                                                </td>

                                                {/* Cost Value */}
                                                <td className="py-3 px-4 text-right">
                                                    <div className="font-semibold text-gray-800 text-xs">
                                                        ₹{(product.totalCost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                    </div>
                                                    <div className="text-[11px] text-gray-400">
                                                        @ ₹{(product.cost || 0).toFixed(2)} / unit
                                                    </div>
                                                </td>

                                                {/* Realized Loss */}
                                                <td className="py-3 px-4 text-right">
                                                    <div className="font-bold text-red-600 text-xs">
                                                        ₹{(product.lossAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                    </div>
                                                    {product.recoverableAmount && product.recoverableAmount > 0 ? (
                                                        <div className="text-[11px] font-medium text-green-600">
                                                            Recv: ₹{product.recoverableAmount.toLocaleString('en-IN')}
                                                        </div>
                                                    ) : null}
                                                </td>

                                                {/* Action Status with Quick Selector */}
                                                <td className="py-3 px-4 text-center">
                                                    <div className="inline-flex items-center gap-1.5 relative">
                                                        <select
                                                            value={product.actionTaken}
                                                            onChange={e => handleQuickStatusUpdate(product, e.target.value as any)}
                                                            className={`appearance-none pl-2.5 pr-6 py-1 rounded-full text-xs font-semibold border cursor-pointer outline-none transition-all ${actionObj.cls}`}
                                                            title="Click to update status"
                                                        >
                                                            <option value="pending">Pending</option>
                                                            <option value="returned">Returned</option>
                                                            <option value="repaired">Repaired</option>
                                                            <option value="sold-at-loss">Sold at Loss</option>
                                                            <option value="discarded">Discarded</option>
                                                        </select>
                                                        <div className="pointer-events-none absolute right-2 text-gray-400 text-[10px]">
                                                            ▼
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Logged Date */}
                                                <td className="py-3 px-4 text-xs text-gray-600 whitespace-nowrap">
                                                    <div className="font-medium text-gray-900">{dateStr}</div>
                                                    <div className="text-[11px] text-gray-400">{product.createdByName || 'Staff'}</div>
                                                </td>

                                                {/* Actions */}
                                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => openEditModal(product)}
                                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                            title="Edit Defect Details"
                                                            aria-label="Edit"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => openDeleteModal(product)}
                                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                                            title="Delete Record"
                                                            aria-label="Delete"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
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

            {/* ── MODAL: ADD / EDIT DEFECT PRODUCT ── */}
            {(showAddModal || showEditModal) && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 bg-rose-100 text-rose-700 rounded-xl">
                                    <AlertTriangle className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">
                                        {showEditModal ? 'Edit Defect Record' : 'Log Defect / Damaged Inventory'}
                                    </h2>
                                    <p className="text-xs text-slate-500">
                                        {showEditModal
                                            ? 'Update defect status, reason, or recovery notes'
                                            : 'Select product from inventory and deduct defective quantity'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowAddModal(false);
                                    setShowEditModal(false);
                                    setSelectedProduct(null);
                                    resetForm();
                                }}
                                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
                                aria-label="Close"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                            {/* Product Autocomplete Search (Shown in Add Mode) */}
                            {!showEditModal && (
                                <div className="defect-product-search-container relative">
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Search Store Product *
                                    </label>
                                    <div className="relative">
                                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input
                                            type="text"
                                            value={productSearchText}
                                            onChange={e => {
                                                setProductSearchText(e.target.value);
                                                setShowProductDropdown(true);
                                            }}
                                            onKeyDown={handleProductSearchKeyDown}
                                            onFocus={() => productSearchText && setShowProductDropdown(true)}
                                            placeholder="Type product name, brand, barcode, or code..."
                                            className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-transparent outline-none transition-all"
                                        />
                                    </div>

                                    {/* Dropdown Results */}
                                    {showProductDropdown && filteredAvailableProducts.length > 0 && (
                                        <div className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
                                            {filteredAvailableProducts.slice(0, 15).map((prod: any, idx: number) => (
                                                <button
                                                    key={prod.id}
                                                    type="button"
                                                    onClick={() => selectProductFromSearch(prod)}
                                                    className={`w-full text-left p-3 transition-colors flex items-center justify-between gap-3 ${
                                                        idx === selectedProductIndex ? 'bg-rose-50/80' : 'hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <div>
                                                        <div className="text-sm font-bold text-slate-900">{prod.name}</div>
                                                        <div className="text-xs text-slate-500">
                                                            {prod.brand} {prod.model && `• ${prod.model}`} • {prod.category || 'General'}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-xs font-bold text-slate-800">
                                                            Stock: <span className="text-rose-600">{prod.quantity || 0}</span>
                                                        </div>
                                                        <div className="text-[11px] text-slate-400">
                                                            Cost: ₹{Number(prod.cost || 0).toFixed(0)}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Selected Product Card Banner */}
                            {formData.productName && (
                                <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                                            <Package className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-900 text-sm">{formData.productName}</div>
                                            <div className="text-xs text-blue-700">
                                                {formData.brand} {formData.model && `• ${formData.model}`} • {formData.category}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-slate-700">Unit Cost: ₹{Number(formData.cost).toFixed(2)}</div>
                                        {formData.productCode && (
                                            <div className="text-[11px] font-mono text-slate-500">Code: {formData.productCode}</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Notice about Stock Deduction */}
                            {!showEditModal && (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 text-xs">
                                    <Info className="w-4 h-4 flex-shrink-0 text-amber-600" />
                                    <span>
                                        Submitting this form will automatically deduct the defective quantity from the live store inventory.
                                    </span>
                                </div>
                            )}

                            {/* Form Input Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Quantity */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Defective Quantity *
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.quantity}
                                        onChange={e => handleFormChange('quantity', e.target.value)}
                                        placeholder="Enter count (e.g. 1)"
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
                                        required
                                    />
                                </div>

                                {/* Cost Per Unit */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Unit Cost (₹) *
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={formData.cost}
                                        onChange={e => handleFormChange('cost', e.target.value)}
                                        placeholder="Cost per item"
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
                                        required
                                    />
                                </div>

                                {/* Defect Type */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Defect Type *
                                    </label>
                                    <select
                                        value={formData.defectType}
                                        onChange={e => handleFormChange('defectType', e.target.value)}
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none cursor-pointer"
                                    >
                                        <option value="damaged">Damaged in Transit / Display</option>
                                        <option value="defective">Manufacturing Fault / Dead</option>
                                        <option value="expired">Expired / Battery Swollen</option>
                                        <option value="other">Other Issue</option>
                                    </select>
                                </div>

                                {/* Action Taken */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Resolution Action *
                                    </label>
                                    <select
                                        value={formData.actionTaken}
                                        onChange={e => handleFormChange('actionTaken', e.target.value)}
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none cursor-pointer"
                                    >
                                        <option value="pending">Pending (Awaiting RMA / Claim)</option>
                                        <option value="returned">Returned to Supplier (Warranty)</option>
                                        <option value="repaired">Repaired & Restocked</option>
                                        <option value="sold-at-loss">Sold at Loss / Clearance</option>
                                        <option value="discarded">Discarded / Scrapped</option>
                                    </select>
                                </div>

                                {/* Supplier Name */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Supplier / Vendor Name
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.supplier}
                                        onChange={e => handleFormChange('supplier', e.target.value)}
                                        placeholder="e.g. Unique Distributors"
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
                                    />
                                </div>

                                {/* Recoverable Amount */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Recovered / Scrap Amount (₹)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={formData.recoverableAmount}
                                        onChange={e => handleFormChange('recoverableAmount', e.target.value)}
                                        placeholder="0.00"
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
                                    />
                                </div>

                                {/* Defect Reason */}
                                <div className="sm:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Defect Reason & Symptoms
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={formData.defectReason}
                                        onChange={e => handleFormChange('defectReason', e.target.value)}
                                        placeholder="Describe what is damaged or defective..."
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none resize-none"
                                    />
                                </div>

                                {/* Action Notes */}
                                <div className="sm:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                        Resolution Notes / RMA Docket No
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.actionNotes}
                                        onChange={e => handleFormChange('actionNotes', e.target.value)}
                                        placeholder="e.g. Courier tracking #12345 or technician remarks"
                                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
                                    />
                                </div>
                            </div>

                            {/* Live Financial Impact Summary Banner */}
                            {Number(formData.quantity) > 0 && Number(formData.cost) > 0 && (
                                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                                    <div>
                                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gross Cost</div>
                                        <div className="text-base font-bold text-slate-900">
                                            ₹{(Number(formData.quantity) * Number(formData.cost)).toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Recovered</div>
                                        <div className="text-base font-bold text-emerald-600">
                                            ₹{Number(formData.recoverableAmount || 0).toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Net Realized Loss</div>
                                        <div className="text-lg font-extrabold text-rose-600">
                                            ₹{Math.max(0, (Number(formData.quantity) * Number(formData.cost)) - Number(formData.recoverableAmount || 0)).toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 sm:p-5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowAddModal(false);
                                    setShowEditModal(false);
                                    setSelectedProduct(null);
                                    resetForm();
                                }}
                                className="px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-200/70 rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={showEditModal ? handleEditDefectProduct : handleAddDefectProduct}
                                disabled={loading}
                                className="px-5 py-2.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs transition-all disabled:opacity-50"
                            >
                                {loading ? 'Saving...' : showEditModal ? 'Update Record' : 'Save & Deduct Stock'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── MODAL: DELETE CONFIRMATION ── */}
            {showDeleteModal && selectedProduct && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-3 bg-rose-100 text-rose-600 rounded-xl">
                                <AlertTriangle className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Delete Defect Record</h3>
                                <p className="text-xs text-slate-500">This action will remove the defect entry.</p>
                            </div>
                        </div>

                        <p className="text-sm text-slate-600 mb-6">
                            Are you sure you want to delete the defect entry for <strong>{selectedProduct.productName}</strong> (Qty: {selectedProduct.quantity})?
                        </p>

                        <div className="flex items-center justify-end gap-2.5">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowDeleteModal(false);
                                    setSelectedProduct(null);
                                }}
                                className="px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={loading}
                                className="px-4 py-2.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all disabled:opacity-50"
                            >
                                {loading ? 'Deleting...' : 'Confirm Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DefectManagement;
