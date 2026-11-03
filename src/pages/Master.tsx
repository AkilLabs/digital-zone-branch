import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import Navbar from '../components/Navbar';
import {
    collection,
    addDoc,
    getDocs,
    doc,
    deleteDoc,
    updateDoc,
    query,
    orderBy,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Brand, Category } from '../types';
import {
    Plus,
    Trash2,
    Edit2,
    Tag,
    Layers,
    CreditCard,
    Search,
    X,
    ChevronLeft,
    ChevronRight,
    RefreshCw,
    LayoutGrid,
    List,
    ArrowUpDown,
    Check,
    FolderTree,
    Sparkles
} from 'lucide-react';
import CustomModal from '../components/CustomModal';

type MasterTab = 'brands' | 'categories' | 'finance';
type SortOption = 'name_asc' | 'name_desc' | 'recent' | 'oldest';

interface MasterRecord {
    id?: string;
    name: string;
    createdAt?: any;
    createdBy?: string;
    createdByName?: string;
    [key: string]: any;
}

const Master: React.FC = () => {
    const { currentUser } = useAuth();
    const { currentStore } = useStore();
    const { success, error: showError } = useToastContext();

    // Active tab & Data states
    const [activeTab, setActiveTab] = useState<MasterTab>('brands');
    const [brands, setBrands] = useState<Brand[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [financeProviders, setFinanceProviders] = useState<MasterRecord[]>([]);
    const [loading, setLoading] = useState(true);

    // Search, sort, view mode & pagination
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<SortOption>('name_asc');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 24;

    // Add / Edit Modal states
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<MasterRecord | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isSubmittingRef = useRef(false);

    // Delete Modal states
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);

    // Fetch initial data
    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            await Promise.all([fetchBrands(), fetchCategories(), fetchFinanceProviders()]);
        } catch (error) {
            console.error('Error fetching master records:', error);
            showError('Failed to load master records');
        } finally {
            setLoading(false);
        }
    };

    const fetchBrands = async () => {
        const q = query(collection(db, 'brands'), orderBy('name', 'asc'));
        const snapshot = await getDocs(q);
        setBrands(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand)));
    };

    const fetchCategories = async () => {
        const q = query(collection(db, 'categories'), orderBy('name', 'asc'));
        const snapshot = await getDocs(q);
        setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    };

    const fetchFinanceProviders = async () => {
        const q = query(collection(db, 'financeProviders'), orderBy('name', 'asc'));
        const snapshot = await getDocs(q);
        setFinanceProviders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MasterRecord)));
    };

    // Modal open / close handlers
    const handleOpenModal = (item?: MasterRecord) => {
        if (item) {
            setEditingItem(item);
            setInputValue(item.name || '');
        } else {
            setEditingItem(null);
            setInputValue('');
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingItem(null);
        setInputValue('');
        setIsSubmitting(false);
        isSubmittingRef.current = false;
    };

    // Save handler with double-click protection & duplicate check
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmittingRef.current) return;

        const trimmed = inputValue.trim().toUpperCase();
        if (!trimmed) {
            showError('Name is required');
            return;
        }

        const entityLabel = activeTab === 'brands' ? 'Brand' : activeTab === 'categories' ? 'Category' : 'Finance Provider';
        const collectionName = activeTab === 'brands' ? 'brands' : activeTab === 'categories' ? 'categories' : 'financeProviders';
        const currentList = activeTab === 'brands' ? brands : activeTab === 'categories' ? categories : financeProviders;

        // Duplicate check
        const isDuplicate = currentList.some(
            item => (item.name || '').trim().toUpperCase() === trimmed && item.id !== editingItem?.id
        );

        if (isDuplicate) {
            showError(`${entityLabel} "${trimmed}" already exists`);
            return;
        }

        try {
            isSubmittingRef.current = true;
            setIsSubmitting(true);

            if (editingItem && editingItem.id) {
                // Update record
                const docRef = doc(db, collectionName, editingItem.id);
                await updateDoc(docRef, {
                    name: trimmed,
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser?.uid || '',
                    updatedByName: currentUser?.displayName || 'Unknown'
                });
                success(`${entityLabel} updated successfully`);
            } else {
                // Create new record
                await addDoc(collection(db, collectionName), {
                    name: trimmed,
                    createdAt: serverTimestamp(),
                    createdBy: currentUser?.uid || '',
                    createdByName: currentUser?.displayName || 'Unknown'
                });
                success(`${entityLabel} added successfully`);
            }

            handleCloseModal();
            if (activeTab === 'brands') fetchBrands();
            else if (activeTab === 'categories') fetchCategories();
            else fetchFinanceProviders();
        } catch (error) {
            console.error('Error saving master record:', error);
            showError('Failed to save master record');
        } finally {
            setIsSubmitting(false);
            isSubmittingRef.current = false;
        }
    };

    // Delete handlers
    const handleDeleteClick = (id: string, name: string) => {
        setItemToDelete({ id, name });
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        const entityLabel = activeTab === 'brands' ? 'Brand' : activeTab === 'categories' ? 'Category' : 'Finance Provider';
        const collectionName = activeTab === 'brands' ? 'brands' : activeTab === 'categories' ? 'categories' : 'financeProviders';

        try {
            await deleteDoc(doc(db, collectionName, itemToDelete.id));
            success(`${entityLabel} "${itemToDelete.name}" deleted successfully`);
            if (activeTab === 'brands') fetchBrands();
            else if (activeTab === 'categories') fetchCategories();
            else fetchFinanceProviders();
        } catch (error) {
            console.error('Error deleting master record:', error);
            showError('Failed to delete master record');
        } finally {
            setDeleteConfirmOpen(false);
            setItemToDelete(null);
        }
    };

    // Filter & Sort
    const activeList = activeTab === 'brands' ? brands : activeTab === 'categories' ? categories : financeProviders;

    const filteredAndSortedItems = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        let list = activeList.filter(item => (item.name || '').toLowerCase().includes(term));

        return list.sort((a, b) => {
            const nameA = a.name || '';
            const nameB = b.name || '';

            switch (sortBy) {
                case 'name_desc':
                    return nameB.localeCompare(nameA);
                case 'recent': {
                    const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return timeB - timeA;
                }
                case 'oldest': {
                    const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return timeA - timeB;
                }
                case 'name_asc':
                default:
                    return nameA.localeCompare(nameB);
            }
        });
    }, [activeList, searchTerm, sortBy]);

    // Reset pagination when tab, search, or sort changes
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, searchTerm, sortBy]);

    // Pagination calculations
    const totalPages = Math.max(1, Math.ceil(filteredAndSortedItems.length / itemsPerPage));
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filteredAndSortedItems.slice(startIndex, startIndex + itemsPerPage);

    const getEntitySingular = () => {
        switch (activeTab) {
            case 'brands':
                return 'Brand';
            case 'categories':
                return 'Category';
            case 'finance':
                return 'Finance Provider';
        }
    };

    const getEntityIcon = (tab: MasterTab, size: string = 'w-4 h-4') => {
        switch (tab) {
            case 'brands':
                return <Tag className={size} />;
            case 'categories':
                return <Layers className={size} />;
            case 'finance':
                return <CreditCard className={size} />;
        }
    };

    const formatDate = (val: any) => {
        if (!val) return '—';
        try {
            const d = val.toDate ? val.toDate() : new Date(val);
            if (Number.isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
            return '—';
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <Navbar />

            <div className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8 flex-1 w-full">
                {/* ── COMPACT HEADER (Clean Project Style matching Products.tsx) ── */}
                <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <FolderTree className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
                            Master Management
                        </h1>
                        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                            {filteredAndSortedItems.length} {getEntitySingular().toLowerCase()}{filteredAndSortedItems.length !== 1 ? (activeTab === 'categories' ? 'ies' : 's') : (activeTab === 'categories' ? 'y' : '')} listed
                            {searchTerm && <span className="text-blue-600 font-semibold"> • Filtered</span>}
                            {currentStore?.name && (
                                <span className="text-gray-400 hidden md:inline">
                                    {' '}• Location: <strong className="text-gray-700 font-medium">{currentStore.name}</strong>
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        {/* Refresh */}
                        <button
                            type="button"
                            onClick={fetchData}
                            disabled={loading}
                            title="Refresh master data"
                            className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
                            <span className="hidden sm:inline">Refresh</span>
                        </button>

                        {/* Add Record */}
                        <button
                            type="button"
                            onClick={() => handleOpenModal()}
                            className="bg-blue-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm whitespace-nowrap"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Add {getEntitySingular()}</span>
                        </button>
                    </div>
                </div>

                {/* ── COMPACT STATS GRID (Matching Products.tsx) ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {/* Brands Card */}
                    <div
                        onClick={() => { setActiveTab('brands'); setSearchTerm(''); }}
                        className={`rounded-lg border p-3 shadow-sm cursor-pointer transition-all ${
                            activeTab === 'brands'
                                ? 'bg-blue-50/60 border-blue-500 ring-1 ring-blue-500'
                                : 'bg-white border-gray-200 hover:border-blue-300'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Tag className="w-3.5 h-3.5 text-blue-600" /> Brands
                            </p>
                            {activeTab === 'brands' && (
                                <span className="text-[10px] text-blue-700 font-bold uppercase">Active</span>
                            )}
                        </div>
                        <p className="text-lg font-bold text-gray-900 mt-1">{brands.length}</p>
                    </div>

                    {/* Categories Card */}
                    <div
                        onClick={() => { setActiveTab('categories'); setSearchTerm(''); }}
                        className={`rounded-lg border p-3 shadow-sm cursor-pointer transition-all ${
                            activeTab === 'categories'
                                ? 'bg-indigo-50/60 border-indigo-500 ring-1 ring-indigo-500'
                                : 'bg-white border-gray-200 hover:border-indigo-300'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Layers className="w-3.5 h-3.5 text-indigo-600" /> Categories
                            </p>
                            {activeTab === 'categories' && (
                                <span className="text-[10px] text-indigo-700 font-bold uppercase">Active</span>
                            )}
                        </div>
                        <p className="text-lg font-bold text-gray-900 mt-1">{categories.length}</p>
                    </div>

                    {/* Finance Providers Card */}
                    <div
                        onClick={() => { setActiveTab('finance'); setSearchTerm(''); }}
                        className={`rounded-lg border p-3 shadow-sm cursor-pointer transition-all ${
                            activeTab === 'finance'
                                ? 'bg-purple-50/60 border-purple-500 ring-1 ring-purple-500'
                                : 'bg-white border-gray-200 hover:border-purple-300'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                                <CreditCard className="w-3.5 h-3.5 text-purple-600" /> Finance Providers
                            </p>
                            {activeTab === 'finance' && (
                                <span className="text-[10px] text-purple-700 font-bold uppercase">Active</span>
                            )}
                        </div>
                        <p className="text-lg font-bold text-gray-900 mt-1">{financeProviders.length}</p>
                    </div>

                    {/* Filtered / View Counter */}
                    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500">Total Master Records</p>
                            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        </div>
                        <p className="text-lg font-bold text-blue-600 mt-1">
                            {brands.length + categories.length + financeProviders.length}
                        </p>
                    </div>
                </div>

                {/* ── SEGMENTED TABS BAR (Matching Products.tsx) ── */}
                <div className="flex bg-white rounded-lg p-1 border border-gray-200 mb-3 sm:mb-4 overflow-x-auto hide-scrollbar sm:w-max shadow-sm">
                    <button
                        type="button"
                        onClick={() => { setActiveTab('brands'); setSearchTerm(''); }}
                        className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                            activeTab === 'brands'
                                ? 'bg-blue-100 text-blue-700 shadow-sm font-semibold'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                    >
                        <Tag className="w-3.5 h-3.5" />
                        <span>Brands</span>
                        <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-bold ${
                            activeTab === 'brands' ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                            {brands.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => { setActiveTab('categories'); setSearchTerm(''); }}
                        className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                            activeTab === 'categories'
                                ? 'bg-blue-100 text-blue-700 shadow-sm font-semibold'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                    >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Categories</span>
                        <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-bold ${
                            activeTab === 'categories' ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                            {categories.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => { setActiveTab('finance'); setSearchTerm(''); }}
                        className={`px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                            activeTab === 'finance'
                                ? 'bg-blue-100 text-blue-700 shadow-sm font-semibold'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                    >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Finance Providers</span>
                        <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-bold ${
                            activeTab === 'finance' ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                            {financeProviders.length}
                        </span>
                    </button>
                </div>

                {/* ── COMPACT FILTER & SEARCH BAR ── */}
                <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    {/* Search */}
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder={`Search ${getEntitySingular().toLowerCase()}...`}
                            className="w-full pl-9 pr-8 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Sort & View Mode Toggle */}
                    <div className="flex items-center gap-2 self-end sm:self-auto w-full sm:w-auto justify-between sm:justify-end">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortOption)}
                                className="border border-gray-300 rounded-lg py-1.5 px-2 text-xs text-gray-700 bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            >
                                <option value="name_asc">Name (A → Z)</option>
                                <option value="name_desc">Name (Z → A)</option>
                                <option value="recent">Recently Added</option>
                                <option value="oldest">Oldest First</option>
                            </select>
                        </div>

                        {/* Grid / Table Toggle */}
                        <div className="flex items-center border border-gray-300 rounded-lg p-0.5 bg-gray-50">
                            <button
                                type="button"
                                onClick={() => setViewMode('grid')}
                                className={`p-1.5 rounded-md transition-colors ${
                                    viewMode === 'grid'
                                        ? 'bg-white text-blue-600 shadow-xs'
                                        : 'text-gray-500 hover:text-gray-800'
                                }`}
                                title="Grid View"
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('table')}
                                className={`p-1.5 rounded-md transition-colors ${
                                    viewMode === 'table'
                                        ? 'bg-white text-blue-600 shadow-xs'
                                        : 'text-gray-500 hover:text-gray-800'
                                }`}
                                title="Table View"
                            >
                                <List className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── CONTENT AREA ── */}
                {loading ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-12 text-center shadow-sm">
                        <div className="w-10 h-10 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-sm font-medium text-gray-600">Loading master records...</p>
                    </div>
                ) : paginatedItems.length === 0 ? (
                    <div className="bg-white rounded-lg border border-dashed border-gray-300 p-12 text-center shadow-sm">
                        <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
                            {getEntityIcon(activeTab, 'w-6 h-6')}
                        </div>
                        <h3 className="text-sm font-bold text-gray-900 mb-1">
                            No {getEntitySingular().toLowerCase()}s found
                        </h3>
                        <p className="text-xs text-gray-500 mb-4">
                            {searchTerm
                                ? `No results match your search "${searchTerm}".`
                                : `You haven't added any ${getEntitySingular().toLowerCase()}s yet.`}
                        </p>
                        <button
                            type="button"
                            onClick={() => handleOpenModal()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 shadow-sm"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add New {getEntitySingular()}</span>
                        </button>
                    </div>
                ) : viewMode === 'grid' ? (
                    /* ── GRID VIEW ── */
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3">
                        {paginatedItems.map((item) => (
                            <div
                                key={item.id}
                                className="bg-white rounded-lg border border-gray-200 p-3 shadow-xs hover:border-blue-300 hover:shadow-sm transition-all group flex flex-col justify-between"
                            >
                                <div className="flex items-start gap-2.5 mb-2">
                                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0 border border-blue-100">
                                        {(item.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h3
                                            className="text-xs sm:text-sm font-bold text-gray-900 truncate"
                                            title={item.name}
                                        >
                                            {item.name}
                                        </h3>
                                        <p className="text-[11px] text-gray-400 truncate mt-0.5">
                                            {item.createdByName ? `By ${item.createdByName}` : formatDate(item.createdAt)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-end gap-1 pt-2 border-t border-gray-100">
                                    <button
                                        type="button"
                                        onClick={() => handleOpenModal(item)}
                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                        title="Edit"
                                    >
                                        <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteClick(item.id!, item.name)}
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* ── TABLE VIEW ── */
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                                    <tr>
                                        <th className="py-2.5 px-3 w-12 text-center">#</th>
                                        <th className="py-2.5 px-4">{getEntitySingular()} Name</th>
                                        <th className="py-2.5 px-4">Type</th>
                                        <th className="py-2.5 px-4">Created Date</th>
                                        <th className="py-2.5 px-4">Created By</th>
                                        <th className="py-2.5 px-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 text-xs text-gray-700">
                                    {paginatedItems.map((item, index) => (
                                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="py-2.5 px-3 text-center text-gray-400 font-mono text-[11px]">
                                                {startIndex + index + 1}
                                            </td>
                                            <td className="py-2.5 px-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded-md bg-blue-50 text-blue-700 font-bold text-[11px] flex items-center justify-center border border-blue-100 shrink-0">
                                                        {(item.name || '?').charAt(0).toUpperCase()}
                                                    </span>
                                                    <span className="font-semibold text-gray-900">{item.name}</span>
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-4 text-gray-500">
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                                                    {getEntitySingular()}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-4 text-gray-500 text-[11px] font-mono">
                                                {formatDate(item.createdAt)}
                                            </td>
                                            <td className="py-2.5 px-4 text-gray-600">
                                                {item.createdByName || '—'}
                                            </td>
                                            <td className="py-2.5 px-4 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenModal(item)}
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                                        title="Edit"
                                                    >
                                                        <Edit2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteClick(item.id!, item.name)}
                                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── PAGINATION (Matching Products.tsx) ── */}
                {filteredAndSortedItems.length > itemsPerPage && (
                    <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                        <div>
                            Showing <strong className="text-gray-900">{startIndex + 1}</strong> to{' '}
                            <strong className="text-gray-900">
                                {Math.min(startIndex + itemsPerPage, filteredAndSortedItems.length)}
                            </strong>{' '}
                            of <strong className="text-gray-900">{filteredAndSortedItems.length}</strong> {getEntitySingular().toLowerCase()}s
                        </div>

                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors flex items-center gap-1 text-gray-700"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                                <span>Prev</span>
                            </button>

                            <span className="px-3 py-1 font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded-lg">
                                {currentPage} / {totalPages}
                            </span>

                            <button
                                type="button"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors flex items-center gap-1 text-gray-700"
                            >
                                <span>Next</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── ADD / EDIT MODAL ── */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="px-4 py-3.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-blue-100 text-blue-700 rounded-md">
                                    {getEntityIcon(activeTab, 'w-4 h-4')}
                                </div>
                                <h2 className="text-sm sm:text-base font-bold text-gray-900">
                                    {editingItem ? 'Edit' : 'Add New'} {getEntitySingular()}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={handleCloseModal}
                                className="text-gray-400 hover:text-gray-600 p-1 rounded-md transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Modal Form */}
                        <form onSubmit={handleSave} className="p-4 sm:p-5">
                            <div className="mb-4">
                                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                                    {getEntitySingular()} Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder={`e.g. ${activeTab === 'brands' ? 'SAMSUNG / APPLE' : activeTab === 'categories' ? 'SMARTPHONES / ACCESSORIES' : 'BAJAJ FINSERV'}`}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none uppercase font-medium placeholder:normal-case placeholder:text-gray-400"
                                    autoFocus
                                />
                                <p className="text-[11px] text-gray-400 mt-1">
                                    Names are automatically stored in uppercase for consistent searching and reporting.
                                </p>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    disabled={isSubmitting}
                                    className="px-3.5 py-2 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !inputValue.trim()}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                                >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>{isSubmitting ? 'Saving...' : editingItem ? 'Save Changes' : `Add ${getEntitySingular()}`}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── DELETE CONFIRMATION MODAL ── */}
            <CustomModal
                isOpen={deleteConfirmOpen}
                onClose={() => setDeleteConfirmOpen(false)}
                onConfirm={confirmDelete}
                title={`Delete ${getEntitySingular()}`}
                message={`Are you sure you want to delete "${itemToDelete?.name}"? Any products assigned to this ${getEntitySingular().toLowerCase()} will retain their existing data, but it will no longer be available in dropdown selections.`}
                type="delete"
                confirmText="Delete Record"
            />
        </div>
    );
};

export default Master;
