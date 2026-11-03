import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToastContext } from '../context/ToastContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import {
  Trash2,
  Filter,
  Package,
  AlertTriangle,
  CheckSquare,
  Square,
  Search,
  RefreshCw,
  X,
  ShieldAlert,
  ArrowLeft,
  PackageMinus
} from 'lucide-react';
import type { Product, Brand, Category } from '../types';
import { query, getDocs, writeBatch, collection, orderBy, serverTimestamp, doc } from 'firebase/firestore';
import { db } from '../config/firebase';

type ModalMode = 'zero' | 'delete' | null;

const DeleteProductsByBrandCategory: React.FC = () => {
  const { currentUser } = useAuth();
  const { success, error: showError } = useToastContext();
  const { getCollectionRef } = useStore();
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [dbBrands, setDbBrands] = useState<string[]>([]);
  const [dbCategories, setDbCategories] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Restrict access to owner / admins
    if (
      currentUser?.role !== 'owner' &&
      currentUser?.role !== 'admin' &&
      currentUser?.role !== 'store-admin' &&
      currentUser?.role !== 'hub-admin'
    ) {
      navigate('/dashboard');
      return;
    }

    fetchInitialData();
  }, [currentUser, navigate]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      await Promise.all([fetchMasterLists(), fetchProducts()]);
    } catch (err) {
      console.error('Error initializing data:', err);
      showError('Failed to load products and categories');
    } finally {
      setLoading(false);
    }
  };

  const fetchMasterLists = async () => {
    try {
      // Fetch Brands from master collection
      const brandsQuery = query(collection(db, 'brands'), orderBy('name', 'asc'));
      const brandsSnap = await getDocs(brandsQuery);
      const fetchedBrands = brandsSnap.docs.map(doc => (doc.data() as Brand).name).filter(Boolean);

      // Fetch Categories from master collection
      const categoriesQuery = query(collection(db, 'categories'), orderBy('name', 'asc'));
      const categoriesSnap = await getDocs(categoriesQuery);
      const fetchedCategories = categoriesSnap.docs.map(doc => (doc.data() as Category).name).filter(Boolean);

      setDbBrands(fetchedBrands);
      setDbCategories(fetchedCategories);
    } catch (err) {
      console.error('Error fetching master lists:', err);
    }
  };

  const fetchProducts = async () => {
    try {
      const productsQuery = query(getCollectionRef('products'));
      const snapshot = await getDocs(productsQuery);
      const productsData = snapshot.docs.map(docSnap => ({
        ...docSnap.data(),
        id: docSnap.id,
        createdAt: docSnap.data().createdAt?.toDate?.() || new Date(),
        updatedAt: docSnap.data().updatedAt?.toDate?.() || new Date(),
      })) as Product[];

      // Sort by newest first
      productsData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setProducts(productsData);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Error fetching products:', err);
      showError('Failed to load products');
    }
  };

  // Combine Brands/Categories from DB with existing product attributes
  const allBrands = Array.from(
    new Set([...dbBrands, ...products.map(p => p.brand).filter(Boolean)])
  ).sort();

  const allCategories = Array.from(
    new Set([...dbCategories, ...products.map(p => p.category).filter(Boolean)])
  ).sort();

  // Filter products based on selected Brand, Category & Search query
  const filteredProducts = products.filter(product => {
    const matchesBrand = selectedBrand === 'all' || product.brand === selectedBrand;
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;

    const sLower = searchQuery.toLowerCase().trim();
    const matchesSearch = !sLower || (
      product.name?.toLowerCase().includes(sLower) ||
      product.productCode?.toLowerCase().includes(sLower) ||
      product.brand?.toLowerCase().includes(sLower) ||
      product.category?.toLowerCase().includes(sLower) ||
      product.model?.toLowerCase().includes(sLower)
    );

    return matchesBrand && matchesCategory && matchesSearch;
  });

  // When filters change, auto-select all currently matching products for convenience
  useEffect(() => {
    const newSet = new Set(filteredProducts.map(p => p.id!).filter(Boolean));
    setSelectedIds(newSet);
  }, [selectedBrand, selectedCategory, searchQuery, products]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProducts.length && filteredProducts.length > 0) {
      setSelectedIds(new Set());
    } else {
      const allIds = new Set(filteredProducts.map(p => p.id!).filter(Boolean));
      setSelectedIds(allIds);
    }
  };

  const toggleProductSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openActionConfirmation = (mode: ModalMode) => {
    if (selectedIds.size === 0) {
      showError(`Please select at least one product.`);
      return;
    }
    setConfirmText('');
    setModalMode(mode);
  };

  const handleExecuteAction = async () => {
    if (!modalMode) return;

    const expectedConfirm = modalMode === 'zero' ? 'ZERO' : 'DELETE';
    if (confirmText.trim().toUpperCase() !== expectedConfirm) {
      showError(`Please type ${expectedConfirm} to confirm execution.`);
      return;
    }

    try {
      setIsProcessing(true);
      const targetIds = Array.from(selectedIds);
      const BATCH_SIZE = 400; // Firestore limit is 500 ops per batch

      if (modalMode === 'zero') {
        // Set quantity to 0
        for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
          const batch = writeBatch(db);
          const chunk = targetIds.slice(i, i + BATCH_SIZE);
          const ref = getCollectionRef('products');

          for (const docId of chunk) {
            const dRef = doc(ref, docId);
            batch.update(dRef, {
              quantity: 0,
              updatedAt: serverTimestamp()
            });
          }

          await batch.commit();
        }
        success(`Successfully updated stock quantity to 0 for ${targetIds.length} product(s).`);
      } else if (modalMode === 'delete') {
        // Delete documents
        for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
          const batch = writeBatch(db);
          const chunk = targetIds.slice(i, i + BATCH_SIZE);
          const ref = getCollectionRef('products');

          for (const docId of chunk) {
            const dRef = doc(ref, docId);
            batch.delete(dRef);
          }

          await batch.commit();
        }
        success(`Successfully deleted ${targetIds.length} product(s).`);
      }

      setModalMode(null);
      setConfirmText('');

      // Refresh product list
      await fetchProducts();
    } catch (err) {
      console.error(`Error during ${modalMode} action:`, err);
      showError(`Failed to complete operation. Please try again.`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Page Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/products')}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to Products"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <PackageMinus className="h-6 w-6 text-amber-600" />
                  Manage Products by Brand & Category
                </h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  Select Brand & Category to set quantity to 0 or delete products in bulk.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={fetchInitialData}
                disabled={loading || isProcessing}
                className="px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 shadow-sm"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>

              <button
                onClick={() => openActionConfirmation('zero')}
                disabled={selectedIds.size === 0 || isProcessing || loading}
                className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-all shadow-sm flex items-center gap-2"
                title="Set Stock Quantity to 0 for selected products"
              >
                <PackageMinus className="h-4 w-4" />
                Make Quantity 0 ({selectedIds.size})
              </button>

              <button
                onClick={() => openActionConfirmation('delete')}
                disabled={selectedIds.size === 0 || isProcessing || loading}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-all shadow-sm flex items-center gap-2"
                title="Permanently Delete selected products"
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>

        {/* Warning Alert Banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3 text-amber-900">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold">Notice:</span> You can either set product stock quantity to <span className="font-bold">0</span> (keeping product details for billing history) or <span className="font-bold">permanently delete</span> products from the catalog.
          </div>
        </div>

        {/* Filters Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          <div className="flex items-center gap-2 mb-4 text-gray-800 font-semibold text-sm">
            <Filter className="h-4 w-4 text-blue-600" />
            Filter Products
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Brand Filter */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1.5">
                Select Brand
              </label>
              <select
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-medium"
              >
                <option value="all">All Brands ({allBrands.length})</option>
                {allBrands.map(brand => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1.5">
                Select Category
              </label>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-medium"
              >
                <option value="all">All Categories ({allCategories.length})</option>
                {allCategories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Input */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1.5">
                Search Product Name / Code
              </label>
              <div className="relative">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search code or model..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Active Filter Chips & Clear */}
          {(selectedBrand !== 'all' || selectedCategory !== 'all' || searchQuery !== '') && (
            <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-500 font-medium">Active filters:</span>
                {selectedBrand !== 'all' && (
                  <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                    Brand: {selectedBrand}
                  </span>
                )}
                {selectedCategory !== 'all' && (
                  <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                    Category: {selectedCategory}
                  </span>
                )}
                {searchQuery && (
                  <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                    Query: "{searchQuery}"
                  </span>
                )}
              </div>

              <button
                onClick={() => {
                  setSelectedBrand('all');
                  setSelectedCategory('all');
                  setSearchQuery('');
                }}
                className="text-xs text-amber-700 hover:text-amber-900 font-medium underline"
              >
                Reset All Filters
              </button>
            </div>
          )}
        </div>

        {/* Products Table Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Table Header Bar */}
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                disabled={filteredProducts.length === 0}
                className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
              >
                {selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? (
                  <CheckSquare className="h-5 w-5 text-amber-600" />
                ) : (
                  <Square className="h-5 w-5 text-gray-400" />
                )}
                <span>Select All ({filteredProducts.length})</span>
              </button>

              <span className="text-xs text-gray-400">|</span>

              <span className="text-xs font-semibold text-gray-600">
                {selectedIds.size} of {filteredProducts.length} selected
              </span>
            </div>

            <div className="text-xs text-gray-500">
              Showing {filteredProducts.length} product(s) matching filter
            </div>
          </div>

          {/* Table Content */}
          {loading ? (
            <div className="p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="h-8 w-8 animate-spin text-amber-600" />
              <p className="text-sm font-medium">Loading products catalog...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
              <Package className="h-10 w-10 text-gray-300 mb-1" />
              <p className="font-semibold text-gray-700">No matching products found</p>
              <p className="text-xs text-gray-500">
                Try selecting a different Brand or Category filter above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100/70 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    <th className="p-3.5 w-10 text-center">
                      <button onClick={toggleSelectAll}>
                        {selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? (
                          <CheckSquare className="h-4 w-4 text-amber-600" />
                        ) : (
                          <Square className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </th>
                    <th className="p-3.5">Code</th>
                    <th className="p-3.5">Product Name</th>
                    <th className="p-3.5">Brand</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5">MRP</th>
                    <th className="p-3.5">Cost</th>
                    <th className="p-3.5 text-center">Stock Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-sm">
                  {filteredProducts.map(product => {
                    const isSelected = selectedIds.has(product.id!);
                    return (
                      <tr
                        key={product.id}
                        onClick={() => toggleProductSelect(product.id!)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="p-3.5 text-center" onClick={e => e.stopPropagation()}>
                          <button onClick={() => toggleProductSelect(product.id!)}>
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-amber-600" />
                            ) : (
                              <Square className="h-4 w-4 text-gray-300" />
                            )}
                          </button>
                        </td>
                        <td className="p-3.5 font-mono text-xs text-gray-600 font-semibold">
                          {product.productCode || '—'}
                        </td>
                        <td className="p-3.5 font-medium text-gray-900">
                          {product.name}
                          {product.model && (
                            <span className="text-xs text-gray-500 block">Model: {product.model}</span>
                          )}
                        </td>
                        <td className="p-3.5 text-gray-700 font-medium">
                          <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-0.5 rounded font-semibold">
                            {product.brand}
                          </span>
                        </td>
                        <td className="p-3.5 text-gray-700">
                          <span className="inline-block bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-semibold">
                            {product.category}
                          </span>
                        </td>
                        <td className="p-3.5 font-semibold text-gray-900">₹{product.mrp}</td>
                        <td className="p-3.5 text-gray-600">₹{product.cost}</td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              product.quantity > 0
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {product.quantity}
                          </span>
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

      {/* Confirmation Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div
                className={`flex items-center gap-3 font-bold text-lg ${
                  modalMode === 'zero' ? 'text-amber-600' : 'text-red-600'
                }`}
              >
                <AlertTriangle className="h-6 w-6" />
                {modalMode === 'zero' ? 'Set Stock Quantity to 0' : 'Confirm Permanent Deletion'}
              </div>
              <button
                onClick={() => !isProcessing && setModalMode(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-sm text-gray-700">
              <p>
                {modalMode === 'zero' ? (
                  <>
                    You are about to update stock quantity to <span className="font-bold text-amber-600 text-base">0</span> for{' '}
                    <span className="font-bold text-gray-900 text-base">{selectedIds.size}</span> product(s).
                  </>
                ) : (
                  <>
                    You are about to permanently delete{' '}
                    <span className="font-bold text-red-600 text-base">{selectedIds.size}</span> product(s) from database.
                  </>
                )}
              </p>

              {(selectedBrand !== 'all' || selectedCategory !== 'all') && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs space-y-1">
                  <div className="font-semibold text-gray-800">Target Selection:</div>
                  {selectedBrand !== 'all' && <div>• Brand: <span className="font-bold">{selectedBrand}</span></div>}
                  {selectedCategory !== 'all' && <div>• Category: <span className="font-bold">{selectedCategory}</span></div>}
                </div>
              )}

              <p className="text-xs text-gray-500">
                To confirm this operation, please type{' '}
                <span className="font-bold text-gray-900">
                  {modalMode === 'zero' ? 'ZERO' : 'DELETE'}
                </span>{' '}
                in the box below:
              </p>

              <input
                type="text"
                placeholder={`Type ${modalMode === 'zero' ? 'ZERO' : 'DELETE'} to confirm`}
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                disabled={isProcessing}
                className={`w-full px-3.5 py-2.5 border-2 rounded-lg font-bold uppercase text-center tracking-wider text-sm ${
                  modalMode === 'zero'
                    ? 'border-amber-200 focus:border-amber-600 focus:ring-amber-500/20'
                    : 'border-red-200 focus:border-red-600 focus:ring-red-500/20'
                }`}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setModalMode(null)}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteAction}
                disabled={
                  confirmText.trim().toUpperCase() !== (modalMode === 'zero' ? 'ZERO' : 'DELETE') ||
                  isProcessing
                }
                className={`px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all flex items-center gap-2 shadow-md ${
                  modalMode === 'zero'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : modalMode === 'zero' ? (
                  <>
                    <PackageMinus className="h-4 w-4" />
                    Confirm & Set to 0
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Confirm & Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeleteProductsByBrandCategory;
