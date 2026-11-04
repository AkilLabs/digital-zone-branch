import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Navbar from '../components/Navbar';
import {
    DollarSign,
    Tag,
    Grid3x3,
    Search,
    AlertTriangle,
    ChevronRight,
    Eye,
    FileText,
    FileSpreadsheet,
    RefreshCw,
    X,
    Package,
    ArrowUpRight,
    LayoutGrid,
    List,
} from 'lucide-react';
import type { Product, ShopDetails } from '../types';
import { useStore } from '../context/StoreContext';
import { syncStoreProducts } from '../utils/productSyncCache';
import {
    doc,
    getDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
    exportStockExcelReport,
    exportStockPDFReport,
    type CategoryStockSummary,
    type BrandStockSummary,
    type StockValuationTotals,
} from '../utils/stockReportGenerator';

const toNumber = (value: unknown): number => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
};

const formatCurrencyNumber = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    }).format(Math.round(amount || 0));
};

const formatCurrency = (amount: number): string => {
    return `₹${formatCurrencyNumber(amount)}`;
};

const formatDate = (date?: Date | string | null): string => {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
};

const StockValue: React.FC = () => {
    const { currentStore, currentHub } = useStore();

    // Data states
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);

    // Active views & filters
    const [activeTab, setActiveTab] = useState<'category' | 'brand' | 'inventory'>('category');
    const [categoryViewMode, setCategoryViewMode] = useState<'grid' | 'table'>('grid');
    const [brandViewMode, setBrandViewMode] = useState<'grid' | 'table'>('grid');

    const [searchQuery, setSearchQuery] = useState('');
    const [categorySearch, setCategorySearch] = useState('');
    const [brandSearch, setBrandSearch] = useState('');

    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | 'low_stock' | 'healthy' | 'high_value'>('all');
    const [sortBy, setSortBy] = useState<'value_desc' | 'value_asc' | 'qty_desc' | 'cost_desc' | 'mrp_desc' | 'name_asc' | 'profit_desc'>('value_desc');
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

    // Pagination for inventory list
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    // Modals
    const [productForDetails, setProductForDetails] = useState<Product | null>(null);

    // Fetch Shop Details for report headers
    const fetchShopDetails = useCallback(async () => {
        try {
            const docRef = doc(db, 'settings', 'shopDetails');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setShopDetails(docSnap.data() as ShopDetails);
            }
        } catch (error) {
            console.error('Error fetching shop details:', error);
        }
    }, []);

    // Fetch in-stock products using local Delta-Sync product cache (0-5 reads instead of 2,000+)
    const fetchProducts = useCallback(async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const syncedProducts = await syncStoreProducts(currentStore?.id);

            const availableProducts: Product[] = syncedProducts
                .map((data) => ({
                    ...data,
                    cost: toNumber(data.cost),
                    mrp: toNumber(data.mrp),
                    quantity: toNumber(data.quantity),
                }))
                .filter((p) => (p.quantity || 0) > 0)
                .sort((a, b) => (b.quantity || 0) - (a.quantity || 0));

            setProducts(availableProducts);
        } catch (error) {
            console.error('Error fetching stock products:', error);
            alert('Failed to load stock data. Please check your connection.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [currentStore?.id]);

    useEffect(() => {
        fetchProducts();
        fetchShopDetails();
    }, [fetchProducts, fetchShopDetails, currentStore?.id, currentHub?.id]);

    // ── FINANCIAL & VALUATION TOTALS ──
    const totals: StockValuationTotals = useMemo(() => {
        const totalCostValue = products.reduce((sum, p) => sum + (p.cost || 0) * (p.quantity || 0), 0);
        const totalRetailValue = products.reduce((sum, p) => sum + (p.mrp || 0) * (p.quantity || 0), 0);
        const totalProfit = totalRetailValue - totalCostValue;
        const totalQuantity = products.reduce((sum, p) => sum + (p.quantity || 0), 0);
        const totalProducts = products.length;
        const lowStockProducts = products.filter((p) => (p.quantity || 0) <= 2).length;
        const marginPercent = totalRetailValue > 0 ? (totalProfit / totalRetailValue) * 100 : 0;
        const averageUnitCost = totalQuantity > 0 ? Math.round(totalCostValue / totalQuantity) : 0;

        return {
            totalCostValue,
            totalRetailValue,
            totalProfit,
            marginPercent,
            totalProducts,
            totalQuantity,
            lowStockProducts,
            averageUnitCost,
        };
    }, [products]);

    // ── CATEGORY VALUATION BREAKDOWN ──
    const categoryValues: CategoryStockSummary[] = useMemo(() => {
        const map = new Map<string, {
            totalCostValue: number;
            totalRetailValue: number;
            productCount: number;
            quantity: number;
            lowStockCount: number;
        }>();

        products.forEach((p) => {
            const cat = (p.category || 'Uncategorized').trim() || 'Uncategorized';
            const costVal = (p.cost || 0) * (p.quantity || 0);
            const retailVal = (p.mrp || 0) * (p.quantity || 0);
            const isLow = (p.quantity || 0) <= 2;

            const curr = map.get(cat) || {
                totalCostValue: 0,
                totalRetailValue: 0,
                productCount: 0,
                quantity: 0,
                lowStockCount: 0,
            };

            curr.totalCostValue += costVal;
            curr.totalRetailValue += retailVal;
            curr.productCount += 1;
            curr.quantity += p.quantity || 0;
            if (isLow) curr.lowStockCount += 1;

            map.set(cat, curr);
        });

        return Array.from(map.entries())
            .map(([category, stats]) => {
                const totalProfit = stats.totalRetailValue - stats.totalCostValue;
                const marginPercent = stats.totalRetailValue > 0 ? (totalProfit / stats.totalRetailValue) * 100 : 0;
                const sharePercent = totals.totalCostValue > 0 ? (stats.totalCostValue / totals.totalCostValue) * 100 : 0;

                return {
                    category,
                    totalCostValue: stats.totalCostValue,
                    totalRetailValue: stats.totalRetailValue,
                    totalProfit,
                    productCount: stats.productCount,
                    quantity: stats.quantity,
                    lowStockCount: stats.lowStockCount,
                    marginPercent,
                    sharePercent,
                };
            })
            .sort((a, b) => b.totalCostValue - a.totalCostValue);
    }, [products, totals.totalCostValue]);

    // Filtered categories for category search
    const filteredCategoryValues = useMemo(() => {
        if (!categorySearch.trim()) return categoryValues;
        const q = categorySearch.toLowerCase().trim();
        return categoryValues.filter((c) => c.category.toLowerCase().includes(q));
    }, [categoryValues, categorySearch]);

    // ── BRAND VALUATION BREAKDOWN ──
    const brandValues: BrandStockSummary[] = useMemo(() => {
        const map = new Map<string, {
            totalCostValue: number;
            totalRetailValue: number;
            productCount: number;
            quantity: number;
            lowStockCount: number;
        }>();

        products.forEach((p) => {
            const brand = (p.brand || 'Unbranded').trim() || 'Unbranded';
            const costVal = (p.cost || 0) * (p.quantity || 0);
            const retailVal = (p.mrp || 0) * (p.quantity || 0);
            const isLow = (p.quantity || 0) <= 2;

            const curr = map.get(brand) || {
                totalCostValue: 0,
                totalRetailValue: 0,
                productCount: 0,
                quantity: 0,
                lowStockCount: 0,
            };

            curr.totalCostValue += costVal;
            curr.totalRetailValue += retailVal;
            curr.productCount += 1;
            curr.quantity += p.quantity || 0;
            if (isLow) curr.lowStockCount += 1;

            map.set(brand, curr);
        });

        return Array.from(map.entries())
            .map(([brand, stats]) => {
                const totalProfit = stats.totalRetailValue - stats.totalCostValue;
                const marginPercent = stats.totalRetailValue > 0 ? (totalProfit / stats.totalRetailValue) * 100 : 0;
                const sharePercent = totals.totalCostValue > 0 ? (stats.totalCostValue / totals.totalCostValue) * 100 : 0;

                return {
                    brand,
                    totalCostValue: stats.totalCostValue,
                    totalRetailValue: stats.totalRetailValue,
                    totalProfit,
                    productCount: stats.productCount,
                    quantity: stats.quantity,
                    lowStockCount: stats.lowStockCount,
                    marginPercent,
                    sharePercent,
                };
            })
            .sort((a, b) => b.totalCostValue - a.totalCostValue);
    }, [products, totals.totalCostValue]);

    // Filtered brands for brand search
    const filteredBrandValues = useMemo(() => {
        if (!brandSearch.trim()) return brandValues;
        const q = brandSearch.toLowerCase().trim();
        return brandValues.filter((b) => b.brand.toLowerCase().includes(q));
    }, [brandValues, brandSearch]);

    // Unique category names
    const uniqueCategories = useMemo(() => {
        return Array.from(new Set(products.map((p) => (p.category || 'Uncategorized').trim()))).sort();
    }, [products]);

    // Unique brand names
    const uniqueBrands = useMemo(() => {
        return Array.from(new Set(products.map((p) => (p.brand || 'Unbranded').trim()))).sort();
    }, [products]);

    // ── FILTERED & SORTED PRODUCTS ──
    const filteredProducts = useMemo(() => {
        let list = [...products];

        if (selectedCategory) {
            list = list.filter((p) => (p.category || 'Uncategorized').trim().toLowerCase() === selectedCategory.toLowerCase());
        }

        if (selectedBrand) {
            list = list.filter((p) => (p.brand || 'Unbranded').trim().toLowerCase() === selectedBrand.toLowerCase());
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter((p) => {
                const name = (p.name || '').toLowerCase();
                const code = (p.productCode || '').toLowerCase();
                const model = (p.model || '').toLowerCase();
                const brand = (p.brand || '').toLowerCase();
                const category = (p.category || '').toLowerCase();
                const supplier = (p.supplier || '').toLowerCase();
                const imei = (p.imei || '').toLowerCase();
                return (
                    name.includes(q) ||
                    code.includes(q) ||
                    model.includes(q) ||
                    brand.includes(q) ||
                    category.includes(q) ||
                    supplier.includes(q) ||
                    imei.includes(q)
                );
            });
        }

        if (statusFilter === 'low_stock') {
            list = list.filter((p) => (p.quantity || 0) <= 2);
        } else if (statusFilter === 'healthy') {
            list = list.filter((p) => (p.quantity || 0) > 2);
        } else if (statusFilter === 'high_value') {
            list = list.filter((p) => (p.cost || 0) * (p.quantity || 0) >= 10000);
        }

        list.sort((a, b) => {
            const aCostVal = (a.cost || 0) * (a.quantity || 0);
            const bCostVal = (b.cost || 0) * (b.quantity || 0);
            const aMrpVal = (a.mrp || 0) * (a.quantity || 0);
            const bMrpVal = (b.mrp || 0) * (b.quantity || 0);
            const aProfit = aMrpVal - aCostVal;
            const bProfit = bMrpVal - bCostVal;

            switch (sortBy) {
                case 'value_desc':
                    return bCostVal - aCostVal;
                case 'value_asc':
                    return aCostVal - bCostVal;
                case 'qty_desc':
                    return (b.quantity || 0) - (a.quantity || 0);
                case 'cost_desc':
                    return (b.cost || 0) - (a.cost || 0);
                case 'mrp_desc':
                    return (b.mrp || 0) - (a.mrp || 0);
                case 'name_asc':
                    return (a.name || '').localeCompare(b.name || '');
                case 'profit_desc':
                    return bProfit - aProfit;
                default:
                    return bCostVal - aCostVal;
            }
        });

        return list;
    }, [products, selectedCategory, selectedBrand, searchQuery, statusFilter, sortBy]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, selectedCategory, selectedBrand, statusFilter, sortBy]);

    const paginatedProducts = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredProducts.slice(start, start + itemsPerPage);
    }, [filteredProducts, currentPage]);

    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage) || 1;

    const filteredSelectionTotals = useMemo(() => {
        const costVal = filteredProducts.reduce((sum, p) => sum + (p.cost || 0) * (p.quantity || 0), 0);
        const retailVal = filteredProducts.reduce((sum, p) => sum + (p.mrp || 0) * (p.quantity || 0), 0);
        const qty = filteredProducts.reduce((sum, p) => sum + (p.quantity || 0), 0);
        return {
            costVal,
            retailVal,
            profit: retailVal - costVal,
            qty,
            count: filteredProducts.length,
        };
    }, [filteredProducts]);

    const handleCategoryDrilldown = (catName: string) => {
        setSelectedCategory(catName);
        setSelectedBrand(null);
        setActiveTab('inventory');
    };

    const handleBrandDrilldown = (brandName: string) => {
        setSelectedBrand(brandName);
        setSelectedCategory(null);
        setActiveTab('inventory');
    };

    const clearActiveFilters = () => {
        setSelectedCategory(null);
        setSelectedBrand(null);
        setSearchQuery('');
        setStatusFilter('all');
    };

    // ── REPORT EXPORTS ──
    const storeName = currentStore?.name || shopDetails?.shopName || 'Store Stock';
    const hubName = currentHub?.name || 'Central Hub';

    const handleExportExcel = (catFilter?: string | null, brandFilter?: string | null) => {
        const exportTargetProducts = catFilter
            ? products.filter((p) => (p.category || 'Uncategorized').trim().toLowerCase() === catFilter.toLowerCase())
            : brandFilter
            ? products.filter((p) => (p.brand || 'Unbranded').trim().toLowerCase() === brandFilter.toLowerCase())
            : products;

        exportStockExcelReport({
            products: exportTargetProducts,
            categoryValues,
            brandValues,
            totals,
            shopDetails,
            storeName,
            hubName,
            filterCategory: catFilter,
            filterBrand: brandFilter,
        });
    };

    const handleExportPDF = (catFilter?: string | null, brandFilter?: string | null) => {
        const exportTargetProducts = catFilter
            ? products.filter((p) => (p.category || 'Uncategorized').trim().toLowerCase() === catFilter.toLowerCase())
            : brandFilter
            ? products.filter((p) => (p.brand || 'Unbranded').trim().toLowerCase() === brandFilter.toLowerCase())
            : products;

        exportStockPDFReport({
            products: exportTargetProducts,
            categoryValues,
            brandValues,
            totals,
            shopDetails,
            storeName,
            hubName,
            filterCategory: catFilter,
            filterBrand: brandFilter,
        });
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />

            <main className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8">
                {/* ── COMPACT HEADER (Clean Project Style matching Products.tsx) ── */}
                <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />
                            Stock Value & Inventory Valuation
                        </h1>
                        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                            {products.length} products in stock • Total Units: <strong className="text-gray-700 font-medium">{totals.totalQuantity.toLocaleString()}</strong>
                            {storeName && (
                                <span className="text-gray-400 hidden md:inline"> • Location: <strong className="text-gray-700 font-medium">{storeName}</strong></span>
                            )}
                        </p>
                    </div>

                    {/* Top Actions: Refresh, Export Excel, Export PDF */}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <button
                            type="button"
                            onClick={() => fetchProducts(true)}
                            disabled={loading || refreshing}
                            className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                            title="Refresh stock data"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
                            <span className="hidden sm:inline">Refresh</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleExportExcel(selectedCategory, selectedBrand)}
                            disabled={loading || products.length === 0}
                            className="bg-green-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
                            title="Export complete stock report to Excel"
                        >
                            <FileSpreadsheet className="w-4 h-4" />
                            <span>Export Excel</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleExportPDF(selectedCategory, selectedBrand)}
                            disabled={loading || products.length === 0}
                            className="bg-red-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
                            title="Export complete stock audit report to PDF"
                        >
                            <FileText className="w-4 h-4" />
                            <span>Export PDF</span>
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-20 bg-white rounded-lg shadow-sm border border-gray-200">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
                        <h3 className="text-sm font-semibold text-gray-800">Calculating Inventory Valuations...</h3>
                        <p className="text-xs text-gray-500 mt-1">Aggregating costs, retail MRPs, categories, and stock quantities</p>
                    </div>
                ) : (
                    <>
                        {/* ── 1. COMPACT KPI CARDS (Matching Products.tsx) ── */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                            {/* Card 1: Stock Value (Cost) */}
                            <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                                <p className="text-xs text-gray-500">Stock Value (Cost)</p>
                                <p className="text-lg font-bold text-green-700 truncate">{formatCurrency(totals.totalCostValue)}</p>
                            </div>

                            {/* Card 2: Retail Value (MRP) */}
                            <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                                <p className="text-xs text-gray-500">Retail Value (MRP)</p>
                                <p className="text-lg font-bold text-blue-600 truncate">{formatCurrency(totals.totalRetailValue)}</p>
                            </div>

                            {/* Card 3: Estimated Profit */}
                            <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                                <p className="text-xs text-gray-500">Estimated Profit</p>
                                <p className="text-lg font-bold text-purple-700 truncate">
                                    {formatCurrency(totals.totalProfit)}{' '}
                                    <span className="text-xs font-semibold text-purple-600">({totals.marginPercent.toFixed(1)}%)</span>
                                </p>
                            </div>

                            {/* Card 4: Inventory Units & Health */}
                            <div
                                onClick={() => {
                                    setStatusFilter(statusFilter === 'low_stock' ? 'all' : 'low_stock');
                                    setActiveTab('inventory');
                                }}
                                className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${
                                    statusFilter === 'low_stock' ? 'border-orange-500 bg-orange-50/60' : 'border-gray-200 hover:border-orange-300'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <p className="text-xs text-gray-500">Total Products / Low Stock</p>
                                    {totals.lowStockProducts > 0 && (
                                        <span className="text-[10px] text-orange-600 font-bold uppercase">{totals.lowStockProducts} Low</span>
                                    )}
                                </div>
                                <p className="text-lg font-bold text-gray-900 truncate">
                                    {totals.totalProducts} <span className="text-xs font-normal text-gray-500">SKUs ({totals.totalQuantity} units)</span>
                                </p>
                            </div>
                        </div>

                        {/* ── ACTIVE DRILL-DOWN BANNER ── */}
                        {(selectedCategory || selectedBrand || statusFilter !== 'all') && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-blue-900 uppercase tracking-wide">Filter:</span>
                                    {selectedCategory && (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white">
                                            Category: {selectedCategory}
                                            <X
                                                className="w-3.5 h-3.5 cursor-pointer hover:opacity-80"
                                                onClick={() => setSelectedCategory(null)}
                                            />
                                        </span>
                                    )}
                                    {selectedBrand && (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-600 text-white">
                                            Brand: {selectedBrand}
                                            <X
                                                className="w-3.5 h-3.5 cursor-pointer hover:opacity-80"
                                                onClick={() => setSelectedBrand(null)}
                                            />
                                        </span>
                                    )}
                                    {statusFilter !== 'all' && (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-800 text-white">
                                            Status: {statusFilter.replace('_', ' ').toUpperCase()}
                                            <X
                                                className="w-3.5 h-3.5 cursor-pointer hover:opacity-80"
                                                onClick={() => setStatusFilter('all')}
                                            />
                                        </span>
                                    )}
                                    <span className="text-xs text-blue-800 font-medium ml-1">
                                        ({filteredSelectionTotals.count} items • {filteredSelectionTotals.qty} units • Value: {formatCurrency(filteredSelectionTotals.costVal)})
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleExportPDF(selectedCategory, selectedBrand)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold shadow-2xs transition-colors"
                                    >
                                        <FileText className="w-3.5 h-3.5 text-red-500" />
                                        PDF
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleExportExcel(selectedCategory, selectedBrand)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold shadow-2xs transition-colors"
                                    >
                                        <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" />
                                        Excel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearActiveFilters}
                                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition-colors"
                                    >
                                        Clear Filter
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── 2. MAIN TABS (Matching Products.tsx) ── */}
                        <div className="flex bg-white rounded-lg p-1 border border-gray-200 mb-3 sm:mb-4 overflow-x-auto hide-scrollbar sm:w-max shadow-sm">
                            {[
                                { key: 'category', label: 'Value by Category', icon: Grid3x3, count: categoryValues.length },
                                { key: 'brand', label: 'Value by Brand', icon: Tag, count: brandValues.length },
                                { key: 'inventory', label: 'Manage All Stock', icon: Package, count: products.length }
                            ].map(tab => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.key;
                                return (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={() => setActiveTab(tab.key as any)}
                                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none flex items-center justify-center gap-2 ${
                                            isActive
                                                ? 'bg-blue-100 text-blue-700 shadow-sm font-semibold'
                                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                        }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        <span>{tab.label}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                            isActive ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'
                                        }`}>
                                            {tab.count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* ── TAB CONTENT CONTAINER ── */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
                            {/* ── TAB 1: VALUE BY CATEGORY ── */}
                            {activeTab === 'category' && (
                                <div className="p-4 sm:p-6">
                                    {/* Sub-toolbar */}
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                                        <div className="relative max-w-sm w-full">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                            <input
                                                type="text"
                                                value={categorySearch}
                                                onChange={(e) => setCategorySearch(e.target.value)}
                                                placeholder="Search category name..."
                                                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                            />
                                            {categorySearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setCategorySearch('')}
                                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>

                                        {/* View Mode Toggle: Cards Grid vs Table */}
                                        <div className="flex items-center gap-2">
                                            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setCategoryViewMode('grid')}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                                        categoryViewMode === 'grid'
                                                            ? 'bg-white text-indigo-700 shadow-xs'
                                                            : 'text-gray-600 hover:text-gray-900'
                                                    }`}
                                                >
                                                    <LayoutGrid className="w-3.5 h-3.5" />
                                                    <span>Cards</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setCategoryViewMode('table')}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                                        categoryViewMode === 'table'
                                                            ? 'bg-white text-indigo-700 shadow-xs'
                                                            : 'text-gray-600 hover:text-gray-900'
                                                    }`}
                                                >
                                                    <List className="w-3.5 h-3.5" />
                                                    <span>Table</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {filteredCategoryValues.length === 0 ? (
                                        <p className="text-center text-gray-500 py-12">No matching category data available</p>
                                    ) : categoryViewMode === 'grid' ? (
                                        /* ── CARDS GRID VIEW ── */
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                            {filteredCategoryValues.map((cat) => (
                                                <div
                                                    key={cat.category}
                                                    className="bg-white rounded-xl border border-gray-200 p-4 shadow-2xs hover:shadow-md hover:border-indigo-300 transition-all duration-200 flex flex-col justify-between"
                                                >
                                                    <div>
                                                        <div className="flex items-start justify-between gap-2 mb-2">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                                                                    <Grid3x3 className="w-4 h-4" />
                                                                </div>
                                                                <div>
                                                                    <h4 className="font-bold text-gray-900 text-sm leading-tight line-clamp-1">{cat.category}</h4>
                                                                    <p className="text-xs text-gray-500">
                                                                        {cat.productCount} {cat.productCount === 1 ? 'product' : 'products'} • {cat.quantity} units
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            {cat.lowStockCount > 0 && (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">
                                                                    <AlertTriangle className="w-3 h-3" />
                                                                    {cat.lowStockCount} low
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Values Box */}
                                                        <div className="bg-gray-50 rounded-lg p-3 my-3 border border-gray-100 space-y-1.5">
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-gray-500 font-medium">Stock Value (Cost):</span>
                                                                <span className="font-bold text-green-700 text-sm">{formatCurrency(cat.totalCostValue)}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-gray-500 font-medium">Retail Value (MRP):</span>
                                                                <span className="font-semibold text-gray-800">{formatCurrency(cat.totalRetailValue)}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-gray-500 font-medium">Potential Profit:</span>
                                                                <span className="font-semibold text-purple-700">
                                                                    {formatCurrency(cat.totalProfit)}{' '}
                                                                    <span className="text-[10px] text-purple-600">({cat.marginPercent.toFixed(1)}%)</span>
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Share Bar */}
                                                        <div className="mb-3">
                                                            <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                                                                <span>Share of Total Stock</span>
                                                                <span className="font-bold text-gray-700">{cat.sharePercent.toFixed(1)}%</span>
                                                            </div>
                                                            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                                                <div
                                                                    className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                                                                    style={{ width: `${Math.min(100, Math.max(0, cat.sharePercent))}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Card Actions */}
                                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCategoryDrilldown(cat.category)}
                                                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors"
                                                        >
                                                            <span>Manage Items ({cat.productCount})</span>
                                                            <ArrowUpRight className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleExportPDF(cat.category)}
                                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                            title="Download Category PDF"
                                                        >
                                                            <FileText className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleExportExcel(cat.category)}
                                                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                            title="Download Category Excel"
                                                        >
                                                            <FileSpreadsheet className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        /* ── TABLE VIEW ── */
                                        <div className="overflow-x-auto -mx-4 sm:mx-0">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">#</th>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Category</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Products</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Units</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Stock Value</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider hidden md:table-cell">Retail MRP</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider hidden lg:table-cell">Profit</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Share %</th>
                                                        <th className="px-3 sm:px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-100 text-sm">
                                                    {filteredCategoryValues.map((cat, index) => {
                                                        const isExpanded = expandedCategory === cat.category;
                                                        const categoryProducts = products.filter(
                                                            (p) => (p.category || 'Uncategorized').trim().toLowerCase() === cat.category.toLowerCase()
                                                        );

                                                        return (
                                                            <React.Fragment key={cat.category}>
                                                                <tr className="hover:bg-gray-50 transition-colors">
                                                                    <td className="px-3 sm:px-4 py-3 text-gray-500 text-xs font-mono">{index + 1}</td>
                                                                    <td className="px-3 sm:px-4 py-3 font-semibold text-gray-900">
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setExpandedCategory(isExpanded ? null : cat.category)}
                                                                                className="text-gray-400 hover:text-indigo-600"
                                                                                title="Preview items"
                                                                            >
                                                                                <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-indigo-600' : ''}`} />
                                                                            </button>
                                                                            <span
                                                                                onClick={() => handleCategoryDrilldown(cat.category)}
                                                                                className="cursor-pointer hover:text-indigo-600 hover:underline flex items-center gap-1"
                                                                            >
                                                                                {cat.category}
                                                                                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 text-indigo-600" />
                                                                            </span>
                                                                            {cat.lowStockCount > 0 && (
                                                                                <span className="ml-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-red-100 text-red-700">
                                                                                    {cat.lowStockCount} low
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-3 sm:px-4 py-3 text-right text-gray-700">{cat.productCount}</td>
                                                                    <td className="px-3 sm:px-4 py-3 text-right text-gray-900 font-medium">{cat.quantity.toLocaleString('en-IN')}</td>
                                                                    <td className="px-3 sm:px-4 py-3 text-right font-bold text-green-600">{formatCurrency(cat.totalCostValue)}</td>
                                                                    <td className="px-3 sm:px-4 py-3 text-right text-gray-700 hidden md:table-cell">{formatCurrency(cat.totalRetailValue)}</td>
                                                                    <td className="px-3 sm:px-4 py-3 text-right font-medium text-purple-700 hidden lg:table-cell">
                                                                        {formatCurrency(cat.totalProfit)}
                                                                    </td>
                                                                    <td className="px-3 sm:px-4 py-3 text-right text-gray-600 font-mono text-xs">{cat.sharePercent.toFixed(1)}%</td>
                                                                    <td className="px-3 sm:px-4 py-3 text-center">
                                                                        <div className="flex items-center justify-center gap-1">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleCategoryDrilldown(cat.category)}
                                                                                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-semibold transition-colors"
                                                                            >
                                                                                Manage Items
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleExportPDF(cat.category)}
                                                                                className="p-1 text-gray-400 hover:text-red-600"
                                                                                title="Export PDF"
                                                                            >
                                                                                <FileText className="w-4 h-4" />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleExportExcel(cat.category)}
                                                                                className="p-1 text-gray-400 hover:text-green-600"
                                                                                title="Export Excel"
                                                                            >
                                                                                <FileSpreadsheet className="w-4 h-4" />
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>

                                                                {/* Accordion Preview */}
                                                                {isExpanded && (
                                                                    <tr className="bg-gray-50/80">
                                                                        <td colSpan={9} className="px-4 py-3 border-y border-gray-200">
                                                                            <div className="bg-white rounded-lg border border-gray-200 p-3">
                                                                                <div className="flex items-center justify-between mb-2">
                                                                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                                                                                        Items in {cat.category} ({categoryProducts.length} items)
                                                                                    </span>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => handleCategoryDrilldown(cat.category)}
                                                                                        className="text-xs text-indigo-600 font-bold hover:underline"
                                                                                    >
                                                                                        Open all in Stock Manager →
                                                                                    </button>
                                                                                </div>
                                                                                <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                                                                                    {categoryProducts.slice(0, 10).map((p) => (
                                                                                        <div key={p.id} className="py-1.5 flex items-center justify-between text-xs">
                                                                                            <div className="flex items-center gap-2">
                                                                                                <span className="font-mono text-gray-400">{p.productCode}</span>
                                                                                                <span className="font-semibold text-gray-800">{p.name}</span>
                                                                                                {p.model && <span className="text-gray-400">({p.model})</span>}
                                                                                            </div>
                                                                                            <div className="flex items-center gap-3">
                                                                                                <span className="text-gray-500">Qty: <strong>{p.quantity}</strong></span>
                                                                                                <span className="text-gray-500">Cost: <strong className="text-green-600">{formatCurrency(p.cost)}</strong></span>
                                                                                                <span className="text-gray-500">Total: <strong className="text-gray-900">{formatCurrency(p.cost * p.quantity)}</strong></span>
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                                <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-300">
                                                    <tr>
                                                        <td colSpan={2} className="px-3 sm:px-4 py-3 text-gray-900">TOTAL</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900">{totals.totalProducts}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900">{totals.totalQuantity.toLocaleString()}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-green-600">{formatCurrency(totals.totalCostValue)}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900 hidden md:table-cell">{formatCurrency(totals.totalRetailValue)}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-purple-700 hidden lg:table-cell">{formatCurrency(totals.totalProfit)}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900">100%</td>
                                                        <td className="px-3 sm:px-4 py-3 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleExportPDF()}
                                                                className="text-xs text-blue-600 font-bold hover:underline"
                                                            >
                                                                PDF
                                                            </button>
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── TAB 2: VALUE BY BRAND ── */}
                            {activeTab === 'brand' && (
                                <div className="p-4 sm:p-6">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                                        <div className="relative max-w-sm w-full">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                            <input
                                                type="text"
                                                value={brandSearch}
                                                onChange={(e) => setBrandSearch(e.target.value)}
                                                placeholder="Search brand name..."
                                                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all"
                                            />
                                            {brandSearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setBrandSearch('')}
                                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setBrandViewMode('grid')}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                                        brandViewMode === 'grid'
                                                            ? 'bg-white text-orange-700 shadow-xs'
                                                            : 'text-gray-600 hover:text-gray-900'
                                                    }`}
                                                >
                                                    <LayoutGrid className="w-3.5 h-3.5" />
                                                    <span>Cards</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setBrandViewMode('table')}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                                        brandViewMode === 'table'
                                                            ? 'bg-white text-orange-700 shadow-xs'
                                                            : 'text-gray-600 hover:text-gray-900'
                                                    }`}
                                                >
                                                    <List className="w-3.5 h-3.5" />
                                                    <span>Table</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {filteredBrandValues.length === 0 ? (
                                        <p className="text-center text-gray-500 py-12">No matching brand data available</p>
                                    ) : brandViewMode === 'grid' ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                            {filteredBrandValues.map((brand) => (
                                                <div
                                                    key={brand.brand}
                                                    className="bg-white rounded-xl border border-gray-200 p-4 shadow-2xs hover:shadow-md hover:border-orange-300 transition-all duration-200 flex flex-col justify-between"
                                                >
                                                    <div>
                                                        <div className="flex items-start justify-between gap-2 mb-2">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-xs">
                                                                    <Tag className="w-4 h-4" />
                                                                </div>
                                                                <div>
                                                                    <h4 className="font-bold text-gray-900 text-sm leading-tight line-clamp-1">{brand.brand}</h4>
                                                                    <p className="text-xs text-gray-500">
                                                                        {brand.productCount} {brand.productCount === 1 ? 'product' : 'products'} • {brand.quantity} units
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            {brand.lowStockCount > 0 && (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">
                                                                    <AlertTriangle className="w-3 h-3" />
                                                                    {brand.lowStockCount} low
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div className="bg-gray-50 rounded-lg p-3 my-3 border border-gray-100 space-y-1.5">
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-gray-500 font-medium">Stock Value (Cost):</span>
                                                                <span className="font-bold text-green-700 text-sm">{formatCurrency(brand.totalCostValue)}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-gray-500 font-medium">Retail Value (MRP):</span>
                                                                <span className="font-semibold text-gray-800">{formatCurrency(brand.totalRetailValue)}</span>
                                                            </div>
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-gray-500 font-medium">Potential Profit:</span>
                                                                <span className="font-semibold text-purple-700">
                                                                    {formatCurrency(brand.totalProfit)}{' '}
                                                                    <span className="text-[10px] text-purple-600">({brand.marginPercent.toFixed(1)}%)</span>
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="mb-3">
                                                            <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                                                                <span>Share of Total Stock</span>
                                                                <span className="font-bold text-gray-700">{brand.sharePercent.toFixed(1)}%</span>
                                                            </div>
                                                            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                                                <div
                                                                    className="bg-orange-500 h-full rounded-full transition-all duration-500"
                                                                    style={{ width: `${Math.min(100, Math.max(0, brand.sharePercent))}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleBrandDrilldown(brand.brand)}
                                                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-lg text-xs font-bold transition-colors"
                                                        >
                                                            <span>Manage Items ({brand.productCount})</span>
                                                            <ArrowUpRight className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleExportPDF(null, brand.brand)}
                                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                            title="Download Brand PDF"
                                                        >
                                                            <FileText className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleExportExcel(null, brand.brand)}
                                                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                            title="Download Brand Excel"
                                                        >
                                                            <FileSpreadsheet className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto -mx-4 sm:mx-0">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">#</th>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Brand</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Products</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Units</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Stock Value</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider hidden md:table-cell">Retail MRP</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider hidden lg:table-cell">Profit</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Share %</th>
                                                        <th className="px-3 sm:px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-100 text-sm">
                                                    {filteredBrandValues.map((brand, index) => (
                                                        <tr key={brand.brand} className="hover:bg-gray-50 transition-colors">
                                                            <td className="px-3 sm:px-4 py-3 text-gray-500 text-xs font-mono">{index + 1}</td>
                                                            <td className="px-3 sm:px-4 py-3 font-semibold text-gray-900">
                                                                <span
                                                                    onClick={() => handleBrandDrilldown(brand.brand)}
                                                                    className="cursor-pointer hover:text-orange-600 hover:underline flex items-center gap-1"
                                                                >
                                                                    {brand.brand}
                                                                    <ArrowUpRight className="w-3.5 h-3.5 opacity-60 text-orange-600" />
                                                                </span>
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-3 text-right text-gray-700">{brand.productCount}</td>
                                                            <td className="px-3 sm:px-4 py-3 text-right text-gray-900 font-medium">{brand.quantity.toLocaleString('en-IN')}</td>
                                                            <td className="px-3 sm:px-4 py-3 text-right font-bold text-green-600">{formatCurrency(brand.totalCostValue)}</td>
                                                            <td className="px-3 sm:px-4 py-3 text-right text-gray-700 hidden md:table-cell">{formatCurrency(brand.totalRetailValue)}</td>
                                                            <td className="px-3 sm:px-4 py-3 text-right font-medium text-purple-700 hidden lg:table-cell">{formatCurrency(brand.totalProfit)}</td>
                                                            <td className="px-3 sm:px-4 py-3 text-right text-gray-600 font-mono text-xs">{brand.sharePercent.toFixed(1)}%</td>
                                                            <td className="px-3 sm:px-4 py-3 text-center">
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleBrandDrilldown(brand.brand)}
                                                                        className="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded text-xs font-semibold transition-colors"
                                                                    >
                                                                        Manage Items
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleExportPDF(null, brand.brand)}
                                                                        className="p-1 text-gray-400 hover:text-red-600"
                                                                        title="Export PDF"
                                                                    >
                                                                        <FileText className="w-4 h-4" />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleExportExcel(null, brand.brand)}
                                                                        className="p-1 text-gray-400 hover:text-green-600"
                                                                        title="Export Excel"
                                                                    >
                                                                        <FileSpreadsheet className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-300">
                                                    <tr>
                                                        <td colSpan={2} className="px-3 sm:px-4 py-3 text-gray-900">TOTAL</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900">{totals.totalProducts}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900">{totals.totalQuantity.toLocaleString()}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-green-600">{formatCurrency(totals.totalCostValue)}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900 hidden md:table-cell">{formatCurrency(totals.totalRetailValue)}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-purple-700 hidden lg:table-cell">{formatCurrency(totals.totalProfit)}</td>
                                                        <td className="px-3 sm:px-4 py-3 text-right text-gray-900">100%</td>
                                                        <td className="px-3 sm:px-4 py-3 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleExportPDF()}
                                                                className="text-xs text-blue-600 font-bold hover:underline"
                                                            >
                                                                PDF
                                                            </button>
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── TAB 3: MANAGE ALL STOCK (Itemized Inventory & In-Place Management) ── */}
                            {activeTab === 'inventory' && (
                                <div className="p-4 sm:p-6">
                                    {/* Horizontal Category Filter Pills (Project-friendly fast filter) */}
                                    <div className="mb-4">
                                        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedCategory(null)}
                                                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                                                    selectedCategory === null
                                                        ? 'bg-blue-600 text-white shadow-xs'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                }`}
                                            >
                                                All Categories ({uniqueCategories.length})
                                            </button>
                                            {uniqueCategories.map((cat) => (
                                                <button
                                                    key={cat}
                                                    type="button"
                                                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                                                        selectedCategory === cat
                                                            ? 'bg-indigo-600 text-white shadow-xs'
                                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                                >
                                                    {cat}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Search & Filter Toolbar */}
                                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4 border border-gray-200 mb-5">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                                            {/* Search input */}
                                            <div className="lg:col-span-4 relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                                <input
                                                    type="text"
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    placeholder="Search product code, name, model, IMEI..."
                                                    className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                                {searchQuery && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSearchQuery('')}
                                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>

                                            {/* Brand Filter */}
                                            <div className="lg:col-span-3">
                                                <select
                                                    value={selectedBrand || ''}
                                                    onChange={(e) => setSelectedBrand(e.target.value || null)}
                                                    className="w-full py-2 px-3 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-700"
                                                >
                                                    <option value="">All Brands ({uniqueBrands.length})</option>
                                                    {uniqueBrands.map((b) => (
                                                        <option key={b} value={b}>{b}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Stock Status Filter */}
                                            <div className="lg:col-span-3">
                                                <select
                                                    value={statusFilter}
                                                    onChange={(e) => setStatusFilter(e.target.value as any)}
                                                    className="w-full py-2 px-3 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-700"
                                                >
                                                    <option value="all">All Stock Status</option>
                                                    <option value="low_stock">⚠️ Low Stock (≤ 2 units)</option>
                                                    <option value="healthy">✓ Healthy Stock (&gt; 2 units)</option>
                                                    <option value="high_value">💎 High Value Items (≥ ₹10,000)</option>
                                                </select>
                                            </div>

                                            {/* Sort dropdown */}
                                            <div className="lg:col-span-2">
                                                <select
                                                    value={sortBy}
                                                    onChange={(e) => setSortBy(e.target.value as any)}
                                                    className="w-full py-2 px-3 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-700"
                                                >
                                                    <option value="value_desc">Value (High-Low)</option>
                                                    <option value="value_asc">Value (Low-High)</option>
                                                    <option value="qty_desc">Quantity (High)</option>
                                                    <option value="cost_desc">Cost (High)</option>
                                                    <option value="mrp_desc">MRP (High)</option>
                                                    <option value="profit_desc">Profit Margin</option>
                                                    <option value="name_asc">Name (A-Z)</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* Filter summary strip */}
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600">
                                            <div>
                                                Showing <strong>{filteredProducts.length}</strong> items •{' '}
                                                <strong>{filteredSelectionTotals.qty.toLocaleString()}</strong> units in stock
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span>Cost Value: <strong className="text-green-700">{formatCurrency(filteredSelectionTotals.costVal)}</strong></span>
                                                <span>Retail MRP: <strong className="text-blue-700">{formatCurrency(filteredSelectionTotals.retailVal)}</strong></span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Products Table */}
                                    {filteredProducts.length === 0 ? (
                                        <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                                            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                            <h4 className="text-sm font-bold text-gray-700">No matching stock items found</h4>
                                            <p className="text-xs text-gray-500 mt-1">Try clearing filters or searching for another model or code.</p>
                                            <button
                                                type="button"
                                                onClick={clearActiveFilters}
                                                className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                                            >
                                                Clear Filters
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto -mx-4 sm:mx-0">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">#</th>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Code</th>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Product Name & Model</th>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Category</th>
                                                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Brand</th>
                                                        <th className="px-3 sm:px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Stock Qty</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Cost</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">MRP</th>
                                                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Stock Value</th>
                                                        <th className="px-3 sm:px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-100 text-sm">
                                                    {paginatedProducts.map((p, idx) => {
                                                        const globalIndex = (currentPage - 1) * itemsPerPage + idx + 1;
                                                        const costVal = (p.cost || 0) * (p.quantity || 0);
                                                        const isLow = (p.quantity || 0) <= 2;

                                                        return (
                                                            <tr key={p.id} className="hover:bg-blue-50/40 transition-colors">
                                                                <td className="px-3 sm:px-4 py-3 text-gray-400 font-mono text-xs">{globalIndex}</td>
                                                                <td className="px-3 sm:px-4 py-3 font-mono text-xs font-bold text-gray-700">
                                                                    <span className="px-2 py-0.5 rounded bg-gray-100 border border-gray-200">
                                                                        {p.productCode || '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3">
                                                                    <div className="font-semibold text-gray-900 line-clamp-1">{p.name}</div>
                                                                    {p.model && (
                                                                        <div className="text-xs text-gray-500">Model: {p.model}</div>
                                                                    )}
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3">
                                                                    <span
                                                                        onClick={() => setSelectedCategory(p.category || null)}
                                                                        className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 cursor-pointer hover:bg-indigo-100"
                                                                    >
                                                                        {p.category || '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3">
                                                                    <span
                                                                        onClick={() => setSelectedBrand(p.brand || null)}
                                                                        className="px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700 border border-orange-100 cursor-pointer hover:bg-orange-100"
                                                                    >
                                                                        {p.brand || '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3 text-center">
                                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                                                        isLow
                                                                            ? 'bg-red-100 text-red-800 border border-red-200'
                                                                            : 'bg-green-100 text-green-800 border border-green-200'
                                                                    }`}>
                                                                        {p.quantity} units
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3 text-right font-medium text-gray-700">
                                                                    {formatCurrency(p.cost)}
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3 text-right font-semibold text-gray-900">
                                                                    {formatCurrency(p.mrp)}
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3 text-right font-bold text-green-700">
                                                                    {formatCurrency(costVal)}
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-3 text-center">
                                                                    <div className="flex items-center justify-center">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setProductForDetails(p)}
                                                                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                                            title="View Product Specs & Details"
                                                                        >
                                                                            <Eye className="w-4 h-4" />
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>

                                            {/* Pagination */}
                                            {totalPages > 1 && (
                                                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                                                    <p className="text-xs text-gray-600">
                                                        Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
                                                        {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of{' '}
                                                        <strong>{filteredProducts.length}</strong> items
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={currentPage === 1}
                                                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                                            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                                                        >
                                                            Previous
                                                        </button>
                                                        <span className="text-xs font-bold text-gray-700 px-2">
                                                            Page {currentPage} of {totalPages}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            disabled={currentPage >= totalPages}
                                                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                                            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                                                        >
                                                            Next
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>

            {/* ── DETAILS VIEW MODAL ── */}
            {productForDetails && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
                    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-gray-200">
                        <div className="bg-blue-600 text-white px-6 py-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <Eye className="h-5 w-5" />
                                    Product Stock Details
                                </h2>
                                <p className="text-xs text-blue-100 mt-0.5">Code: {productForDetails.productCode}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setProductForDetails(null)}
                                className="text-blue-200 hover:text-white transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 text-sm">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">{productForDetails.name}</h3>
                                {productForDetails.model && (
                                    <p className="text-xs text-gray-500 font-medium mt-0.5">Model: {productForDetails.model}</p>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <span className="text-gray-500 block mb-0.5">Category</span>
                                    <span className="font-bold text-gray-900 text-sm">{productForDetails.category || '—'}</span>
                                </div>
                                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <span className="text-gray-500 block mb-0.5">Brand</span>
                                    <span className="font-bold text-gray-900 text-sm">{productForDetails.brand || '—'}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center">
                                    <span className="text-xs text-green-700 block font-medium">Cost Price</span>
                                    <span className="text-base font-bold text-green-800">{formatCurrency(productForDetails.cost)}</span>
                                </div>
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-center">
                                    <span className="text-xs text-blue-700 block font-medium">MRP</span>
                                    <span className="text-base font-bold text-blue-800">{formatCurrency(productForDetails.mrp)}</span>
                                </div>
                                <div className="p-3 bg-purple-50 rounded-lg border border-purple-200 text-center">
                                    <span className="text-xs text-purple-700 block font-medium">In Stock</span>
                                    <span className="text-base font-bold text-purple-800">{productForDetails.quantity} units</span>
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 space-y-2 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Total Stock Value:</span>
                                    <span className="font-bold text-green-700">{formatCurrency(productForDetails.cost * productForDetails.quantity)}</span>
                                </div>
                                {productForDetails.supplier && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Supplier:</span>
                                        <span className="font-medium text-gray-800">{productForDetails.supplier}</span>
                                    </div>
                                )}
                                {productForDetails.imei && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">IMEI:</span>
                                        <span className="font-mono text-gray-800">{productForDetails.imei}</span>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Date Added:</span>
                                    <span className="text-gray-800">{formatDate(productForDetails.createdAt)}</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-end pt-2">
                                <button
                                    type="button"
                                    onClick={() => setProductForDetails(null)}
                                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold text-xs transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StockValue;
