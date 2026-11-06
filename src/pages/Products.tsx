import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import LocationSwitcher from '../components/LocationSwitcher';
import ProductLabel from '../components/ProductLabel';
import SuitableModelsModal from '../components/SuitableModelsModal';
import {
  Package,
  Plus,
  Trash2,
  QrCode,
  Search,
  X,
  ArrowUpDown,
  Download,
  ChevronDown,
  Printer,
  Edit,
  CheckCircle,
  Smartphone,
  Layers,
  Receipt,
  RefreshCw,
  Copy,
  Check,
  Lock,
  Unlock,
  DollarSign,
  Warehouse,
  Building2,
  Hourglass
} from 'lucide-react';
import type { Product, ShopDetails } from '../types';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useInvalidateCache } from '../hooks/useFirestoreCache';
import {
  syncStoreProducts,
  upsertLocalProducts,
  removeLocalProducts,
} from '../utils/productSyncCache';
import {
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';

import { generateProductCode, generateIMEIProductCode } from '../utils/productCode';
import { resolveShopDetails } from '../utils/shopDetails';
import { encodePrice } from '../utils/secretCode';
import {
  getCachedStockAgingSettings,
  isProductAging,
  getProductAgeInDays,
  calculateAgingIncentive,
  type StockAgingSettings
} from '../utils/stockAging';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type ProductTab = 'all' | 'non_imei' | 'non_imei_gst' | 'imei';
type StockStatusFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'aging_stock';

const Products: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore, selectedLocation, stores } = useStore();
  const { invalidateProducts } = useInvalidateCache();

  const isOwnerOrAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin';

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [selectedProductForLabel, setSelectedProductForLabel] = useState<Product | null>(null);
  const [selectedProductForDetails, setSelectedProductForDetails] = useState<Product | null>(null);
  const [showActualCost, setShowActualCost] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<ProductTab>('all');

  // Filter and sort states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [stockStatusFilter, setStockStatusFilter] = useState<StockStatusFilter>('all');
  const [stockAgingSettings, setStockAgingSettings] = useState<StockAgingSettings>(getCachedStockAgingSettings());
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'price' | 'cost' | 'quantity'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Selection states for printing labels
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  // Multiple products sent to the label dialog
  const [productsToPrint, setProductsToPrint] = useState<Product[] | null>(null);

  // Delete confirmation modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');

  // Edit product modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    model: '',
    brand: '',
    category: '',
    cost: '',
    mrp: '',
    quantity: '',
    supplier: '',
    gstEnabled: false,
    taxPercent: '18',
    hcsCode: '',
    mop: ''
  });
  const [editLoading, setEditLoading] = useState(false);

  // Suitable models modal states
  const [showSuitableModelsModal, setShowSuitableModelsModal] = useState(false);
  const [productForSuitableModels, setProductForSuitableModels] = useState<Product | null>(null);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const addDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch products and shop details whenever location scope or stores list changes
  useEffect(() => {
    fetchProducts();
    fetchShopDetails();

    const loadAgingSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'projectSettings', 'default'));
        if (settingsDoc.exists() && settingsDoc.data()?.stockAgingSettings) {
          const s = settingsDoc.data().stockAgingSettings;
          setStockAgingSettings(s);
          localStorage.setItem('dz_stock_aging_settings', JSON.stringify(s));
        }
      } catch (err) {
        console.warn('Could not load aging settings in Products:', err);
      }
    };
    loadAgingSettings();
  }, [currentStore?.id, selectedLocation, stores.length]);

  // Click outside handlers for dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(target)) {
        setShowCategoryDropdown(false);
      }
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setShowExportMenu(false);
      }
      if (addDropdownRef.current && !addDropdownRef.current.contains(target)) {
        setShowAddMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut: '/' to focus search, 'Escape' to dismiss modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInputActive = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'Escape') {
        if (selectedProductForDetails) {
          setSelectedProductForDetails(null);
        } else if (selectedProductForLabel || productsToPrint) {
          // The label dialog handles its own Escape
        } else if (showEditModal) {
          setShowEditModal(false);
        } else if (showDeleteModal) {
          setShowDeleteModal(false);
        } else if (showCategoryDropdown) {
          setShowCategoryDropdown(false);
        } else if (showExportMenu) {
          setShowExportMenu(false);
        } else if (showAddMenu) {
          setShowAddMenu(false);
        } else if (isSelectionMode) {
          setIsSelectionMode(false);
          setSelectedProductIds([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedProductForDetails,
    selectedProductForLabel,
    productsToPrint,
    isSelectionMode,
    showEditModal,
    showDeleteModal,
    showCategoryDropdown,
    showExportMenu,
    showAddMenu
  ]);

  const fetchShopDetails = async () => {
    try {
      const resolved = await resolveShopDetails(currentStore);
      if (resolved) {
        setShopDetails(resolved);
      }
    } catch (error) {
      console.error('Error fetching shop details:', error);
    }
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);

      // 1. Specific Retail Branch View
      if (currentStore?.id && selectedLocation !== 'all_locations' && selectedLocation !== 'hub_warehouse') {
        const syncedProducts = await syncStoreProducts(currentStore.id);
        const productsData: Product[] = [...syncedProducts]
          .map((p) => ({
            ...p,
            _storeId: currentStore.id,
            _locationLabel: currentStore.name,
          } as any))
          .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));

        setProducts(productsData);
        return;
      }

      // 2. Hub Warehouse ('hub_warehouse') OR Complete Stock ('all_locations')
      // Collect active branch products & quantities by productCode
      const branchQtyMap = new Map<string, number>();
      const branchBreakdownMap = new Map<string, Array<{ id: string; name: string; qty: number }>>();
      const branchProductsByStore: Array<{ storeId: string; storeName: string; products: Product[] }> = [];

      await Promise.all(
        stores.map(async (st) => {
          if (!st.id) return;
          try {
            const bProds = await syncStoreProducts(st.id);
            branchProductsByStore.push({ storeId: st.id, storeName: st.name, products: bProds });
            bProds.forEach((bp) => {
              const code = (bp.productCode || bp.id || '').trim();
              const qty = Number(bp.quantity) || 0;
              if (code && qty > 0) {
                branchQtyMap.set(code, (branchQtyMap.get(code) || 0) + qty);
                const list = branchBreakdownMap.get(code) || [];
                const existingIdx = list.findIndex((item) => item.id === st.id);
                if (existingIdx >= 0) {
                  list[existingIdx].qty += qty;
                } else {
                  list.push({ id: st.id || '', name: st.name, qty });
                }
                branchBreakdownMap.set(code, list);
              }
            });
          } catch {
            // ignore branch sync errors
          }
        })
      );

      // Load root Hub Warehouse products
      const syncedRootProducts = await syncStoreProducts(null);
      const rawHubProducts = syncedRootProducts.filter((p) => {
        if (
          p.storeId &&
          p.storeId !== 'hub_warehouse' &&
          p.storeId !== 'digital_zone_hq' &&
          stores.some((s) => s.id === p.storeId)
        ) {
          return false;
        }
        return true;
      });

      const productsData: Product[] = [...rawHubProducts].sort(
        (a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0)
      );

      // Auto-generate missing product codes on root catalog if any
      const productsWithoutCodes: { product: Product; index: number; isIMEI: boolean }[] = [];
      productsData.forEach((product, index) => {
        const isIMEI = Boolean(
          (product.imei && product.imei.trim()) ||
          (product.productCode && parseInt(product.productCode) >= 10000001) ||
          (product as any).isIMEIPurchase === true
        );
        if (!product.productCode && product.id) {
          productsWithoutCodes.push({ product, index, isIMEI });
        }
      });

      if (productsWithoutCodes.length > 0) {
        const BATCH_SIZE = 400;
        let batch = writeBatch(db);
        let batchCounter = 0;
        const updatedForLocalCache: Array<Partial<Product> & { id: string }> = [];

        for (const item of productsWithoutCodes) {
          const generatedCode = item.isIMEI
            ? await generateIMEIProductCode(getCollectionRef('products'))
            : await generateProductCode(getCollectionRef('products'));
          const docRef = getDocRef('products', item.product.id!);
          batch.update(docRef, {
            productCode: generatedCode,
            barcode: generatedCode,
            updatedAt: serverTimestamp()
          });

          productsData[item.index].productCode = generatedCode;
          updatedForLocalCache.push({
            ...productsData[item.index],
            id: item.product.id!,
            productCode: generatedCode,
            updatedAt: new Date(),
          });
          batchCounter++;

          if (batchCounter >= BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            batchCounter = 0;
          }
        }

        if (batchCounter > 0) {
          await batch.commit();
        }
        await upsertLocalProducts(null, updatedForLocalCache);
        invalidateProducts();
      }

      if (selectedLocation === 'all_locations') {
        // COMPLETE STOCK (Hub Warehouse + All Branches Combined)
        const seenCodes = new Set<string>();
        const combinedList: Product[] = productsData.map((p) => {
          const code = (p.productCode || p.id || '').trim();
          if (code) seenCodes.add(code);
          const inBranchQty = branchQtyMap.get(code) || 0;
          const hubNetQty = Math.max(0, (Number(p.quantity) || 0) - inBranchQty);
          const totalChainQty = hubNetQty + inBranchQty;
          const branchItems = branchBreakdownMap.get(code) || [];

          const breakdown = [
            { id: 'hub_warehouse', name: 'Hub Warehouse', qty: hubNetQty, isHub: true },
            ...branchItems,
          ];

          return {
            ...p,
            quantity: totalChainQty,
            _hubQty: hubNetQty,
            _inBranchQty: inBranchQty,
            _rawDocQuantity: Number(p.quantity) || 0,
            _locationLabel: 'Complete Stock',
            _locationBreakdown: breakdown,
          } as any;
        });

        // Include any branch-only products not present in the root Hub catalog
        branchProductsByStore.forEach(({ storeId, storeName, products: bProds }) => {
          bProds.forEach((bp) => {
            const code = (bp.productCode || bp.id || '').trim();
            if (code && !seenCodes.has(code)) {
              seenCodes.add(code);
              const inBranchQty = branchQtyMap.get(code) || Number(bp.quantity) || 0;
              const branchItems = branchBreakdownMap.get(code) || [
                { id: storeId, name: storeName, qty: Number(bp.quantity) || 0 },
              ];
              combinedList.push({
                ...bp,
                quantity: inBranchQty,
                _storeId: storeId,
                _hubQty: 0,
                _inBranchQty: inBranchQty,
                _locationLabel: storeName,
                _locationBreakdown: [
                  { id: 'hub_warehouse', name: 'Hub Warehouse', qty: 0, isHub: true },
                  ...branchItems,
                ],
              } as any);
            }
          });
        });

        setProducts(combinedList);
      } else {
        // HUB WAREHOUSE (Main Office Storage — strictly net of branch quantities)
        const hubWarehouseList: Product[] = productsData.map((p) => {
          const code = (p.productCode || p.id || '').trim();
          const inBranchQty = branchQtyMap.get(code) || 0;
          const hubNetQty = Math.max(0, (Number(p.quantity) || 0) - inBranchQty);
          const branchItems = branchBreakdownMap.get(code) || [];

          return {
            ...p,
            quantity: hubNetQty,
            _hubQty: hubNetQty,
            _inBranchQty: inBranchQty,
            _rawDocQuantity: Number(p.quantity) || 0,
            _locationLabel: 'Hub Warehouse',
            _locationBreakdown: [
              { id: 'hub_warehouse', name: 'Hub Warehouse', qty: hubNetQty, isHub: true },
              ...branchItems,
            ],
          } as any;
        });

        setProducts(hubWarehouseList);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  // Classification helpers
  const isIMEIProduct = (p: Product): boolean => {
    if (p.imei && p.imei.trim()) return true;
    if (p.productCode) {
      const num = parseInt(p.productCode, 10);
      if (!Number.isNaN(num) && num >= 10000001) return true;
    }
    if ((p as any).isIMEIPurchase === true) return true;
    return false;
  };

  const isGSTProduct = (p: Product): boolean => {
    return Boolean(
      p.gstEnabled === true ||
      (p.taxPercent !== undefined && Number(p.taxPercent) > 0) ||
      (p as any).isGstPurchase === true
    );
  };

  // Compute counts for all tabs
  const tabCounts = useMemo(() => {
    let imei = 0;
    let nonImeiGst = 0;
    let nonImeiRegular = 0;
    let aging = 0;

    products.forEach((p) => {
      if (isIMEIProduct(p)) {
        imei++;
      } else if (isGSTProduct(p)) {
        nonImeiGst++;
      } else {
        nonImeiRegular++;
      }
      if (stockAgingSettings.enabled && (p.quantity || 0) > 0 && isProductAging(p, stockAgingSettings)) {
        aging++;
      }
    });

    return {
      all: products.length,
      imei,
      non_imei_gst: nonImeiGst,
      non_imei: nonImeiRegular,
      aging
    };
  }, [products, stockAgingSettings]);

  // Unique brands & categories
  const uniqueBrands = useMemo(() => {
    return Array.from(new Set(products.map(p => p.brand).filter(Boolean))).sort();
  }, [products]);

  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort();
  }, [products]);

  const toggleCategory = (category: string) => {
    setFilterCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    return products
      .filter((product) => {
        const isImei = isIMEIProduct(product);
        const isGst = isGSTProduct(product);

        // Tab Filter
        if (activeTab === 'imei' && !isImei) return false;
        if (activeTab === 'non_imei_gst' && (isImei || !isGst)) return false;
        if (activeTab === 'non_imei' && (isImei || isGst)) return false;

        // Stock status filter
        if (stockStatusFilter === 'in_stock' && product.quantity <= 0) return false;
        if (stockStatusFilter === 'low_stock' && (product.quantity <= 0 || product.quantity > 5)) return false;
        if (stockStatusFilter === 'out_of_stock' && product.quantity > 0) return false;
        if (stockStatusFilter === 'aging_stock' && (product.quantity <= 0 || !isProductAging(product, stockAgingSettings))) return false;

        // Search filter
        if (searchTerm.trim() !== '') {
          const q = searchTerm.toLowerCase();
          const matches =
            (product.name && product.name.toLowerCase().includes(q)) ||
            (product.productCode && String(product.productCode).toLowerCase().includes(q)) ||
            (product.brand && product.brand.toLowerCase().includes(q)) ||
            (product.model && product.model.toLowerCase().includes(q)) ||
            (product.imei && String(product.imei).toLowerCase().includes(q)) ||
            (product.hcsCode && String(product.hcsCode).toLowerCase().includes(q)) ||
            (product.supplier && product.supplier.toLowerCase().includes(q)) ||
            (product.suitableModels && product.suitableModels.some(m => m.toLowerCase().includes(q)));
          if (!matches) return false;
        }

        // Brand filter
        if (filterBrand && product.brand !== filterBrand) {
          return false;
        }

        // Category filter
        if (filterCategories.length > 0 && !filterCategories.includes(product.category)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'name':
            comparison = (a.name || '').localeCompare(b.name || '');
            break;
          case 'price':
            comparison = (a.mrp || 0) - (b.mrp || 0);
            break;
          case 'cost':
            comparison = (a.cost || 0) - (b.cost || 0);
            break;
          case 'quantity':
            comparison = (a.quantity || 0) - (b.quantity || 0);
            break;
          case 'date':
          default:
            comparison = (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
            break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [products, activeTab, stockStatusFilter, searchTerm, filterBrand, filterCategories, sortBy, sortOrder, stockAgingSettings]);

  // Metrics for active tab
  const tabMetrics = useMemo(() => {
    let totalUnits = 0;
    let totalMrpValue = 0;
    let totalCostValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let agingStockCount = 0;

    filteredProducts.forEach((p) => {
      const q = Math.max(0, p.quantity || 0);
      totalUnits += q;
      totalMrpValue += (p.mrp || 0) * q;
      totalCostValue += (p.cost || 0) * q;
      if (q === 0) {
        outOfStockCount++;
      } else if (q <= 5) {
        lowStockCount++;
      }
      if (stockAgingSettings.enabled && q > 0 && isProductAging(p, stockAgingSettings)) {
        agingStockCount++;
      }
    });

    return {
      itemCount: filteredProducts.length,
      totalUnits,
      totalMrpValue,
      totalCostValue,
      lowStockCount,
      outOfStockCount,
      agingStockCount
    };
  }, [filteredProducts, stockAgingSettings]);

  // Pagination logic
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm, filterBrand, filterCategories, stockStatusFilter, sortBy, sortOrder]);

  const copyToClipboard = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 1800);
  };

  // Delete product handlers
  const handleDelete = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    setProductToDelete(product);
    setShowDeleteModal(true);
    setDeleteConfirmationInput('');
  };

  const confirmDelete = async () => {
    if (!productToDelete) return;
    if (deleteConfirmationInput.trim() !== productToDelete.name) return;

    const deletedId = productToDelete.id!;
    const targetStoreId = (productToDelete as any)._storeId || currentStore?.id || null;
    try {
      setDeleteLoading(deletedId);
      const targetRef = targetStoreId
        ? doc(db, 'stores', targetStoreId, 'products', deletedId)
        : getDocRef('products', deletedId);
      await deleteDoc(targetRef);
      await removeLocalProducts(targetStoreId, [deletedId]);
      setProducts(prev => prev.filter(p => p.id !== deletedId));
      invalidateProducts();
      setShowDeleteModal(false);
      setProductToDelete(null);
      setDeleteConfirmationInput('');
    } catch (error) {
      console.error('Error deleting product:', error);
      alert('Failed to delete product: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setDeleteLoading(null);
    }
  };

  // Edit product handlers
  const handleEdit = (product: Product) => {
    setProductToEdit(product);
    setEditFormData({
      name: product.name || '',
      model: product.model || '',
      brand: product.brand || '',
      category: product.category || '',
      cost: product.cost !== undefined ? product.cost.toString() : '0',
      mrp: product.mrp !== undefined ? product.mrp.toString() : '0',
      quantity: product.quantity !== undefined ? product.quantity.toString() : '0',
      supplier: product.supplier || '',
      gstEnabled: Boolean(product.gstEnabled || (product.taxPercent && product.taxPercent > 0)),
      taxPercent: (product.taxPercent ?? (product.gstEnabled ? 18 : 0)).toString(),
      hcsCode: product.hcsCode || (product as any).hsnCode || '',
      mop: product.mop !== undefined ? product.mop.toString() : ''
    });
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    if (!productToEdit) return;

    const cost = parseFloat(editFormData.cost);
    const mrp = parseFloat(editFormData.mrp);
    const quantity = parseInt(editFormData.quantity, 10);
    const taxPercent = editFormData.gstEnabled ? parseFloat(editFormData.taxPercent) || 0 : 0;
    const mop = editFormData.mop ? parseFloat(editFormData.mop) : null;

    if (isNaN(cost) || isNaN(mrp) || isNaN(quantity)) {
      alert('Please enter valid numbers for Cost, MRP, and Quantity');
      return;
    }

    try {
      setEditLoading(true);
      const targetStoreId = (productToEdit as any)._storeId || currentStore?.id || null;
      const inBranchQty = Number((productToEdit as any)._inBranchQty || 0);
      // When editing Hub Warehouse net stock, preserve the branch-allocated portion in root catalog
      const firestoreQuantity =
        !targetStoreId && selectedLocation === 'hub_warehouse'
          ? quantity + inBranchQty
          : quantity;

      const updatedProduct: any = {
        name: editFormData.name.trim(),
        model: editFormData.model.trim() || null,
        brand: editFormData.brand.trim(),
        category: editFormData.category.trim(),
        cost,
        mrp,
        quantity: firestoreQuantity,
        supplier: editFormData.supplier.trim() || null,
        gstEnabled: editFormData.gstEnabled,
        taxPercent,
        hcsCode: editFormData.hcsCode.trim() || null,
        mop,
        updatedAt: serverTimestamp()
      };

      if (firestoreQuantity !== (productToEdit as any)._rawDocQuantity) {
        updatedProduct.isAvailable = firestoreQuantity > 0;
      }

      const editId = productToEdit.id!;
      const targetRef = targetStoreId
        ? doc(db, 'stores', targetStoreId, 'products', editId)
        : getDocRef('products', editId);
      await updateDoc(targetRef, updatedProduct);

      const localCacheCopy: Product = {
        ...productToEdit,
        name: editFormData.name.trim(),
        model: editFormData.model.trim() || '',
        brand: editFormData.brand.trim(),
        category: editFormData.category.trim(),
        cost,
        mrp,
        quantity: firestoreQuantity,
        supplier: editFormData.supplier.trim() || '',
        gstEnabled: editFormData.gstEnabled,
        taxPercent,
        hcsCode: editFormData.hcsCode.trim() || '',
        mop: mop || 0,
        isAvailable: firestoreQuantity > 0,
        updatedAt: new Date(),
      };

      await upsertLocalProducts(targetStoreId, [{ ...localCacheCopy, id: editId }]);
      const localDisplayUpdated: Product = {
        ...localCacheCopy,
        quantity,
      };
      setProducts(prev => prev.map(p => (p.id === editId ? localDisplayUpdated : p)));
      invalidateProducts();
      setShowEditModal(false);
      setProductToEdit(null);
    } catch (error) {
      console.error('Error updating product:', error);
      alert('Failed to update product: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setEditLoading(false);
    }
  };

  // Label print handlers
  // Single product: open the label dialog straight away, keeping original product intact
  const handlePrintLabel = (product: Product) => {
    setSelectedProductForLabel(product);
  };

  // Ticked products: open the label dialog keeping original product data (including actual quantity)
  const handlePrintSelectedLabels = () => {
    const selected = filteredProducts.filter(product => selectedProductIds.includes(product.id!));
    if (selected.length === 0) return;
    setProductsToPrint(selected);
    setIsSelectionMode(false);
    setSelectedProductIds([]);
  };

  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedProductIds([]);
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const selectCurrentPage = () => {
    const pageIds = paginatedProducts.map(p => p.id!).filter(Boolean);
    const allSelected = pageIds.every(id => selectedProductIds.includes(id));

    if (allSelected) {
      setSelectedProductIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      setSelectedProductIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const allFilteredSelected =
    filteredProducts.length > 0 && filteredProducts.every(p => selectedProductIds.includes(p.id!));

  // Exports
  const exportToCSV = () => {
    const headers = ['Name', 'Product Code', 'Brand', 'Model', 'Category', 'Type', 'Cost', 'MRP', 'Stock', 'IMEI', 'HSN'];
    const rows = filteredProducts.map(p => {
      const isImei = isIMEIProduct(p);
      const isGst = isGSTProduct(p);
      const typeLabel = isImei ? 'IMEI' : isGst ? 'Non-IMEI GST' : 'Non-IMEI';
      return [
        `"${(p.name || '').replace(/"/g, '""')}"`,
        `"${p.productCode || ''}"`,
        `"${(p.brand || '').replace(/"/g, '""')}"`,
        `"${(p.model || '').replace(/"/g, '""')}"`,
        `"${(p.category || '').replace(/"/g, '""')}"`,
        `"${typeLabel}"`,
        showActualCost ? p.cost : `"${encodePrice(p.cost)}"`,
        p.mrp,
        p.quantity,
        `"${p.imei || ''}"`,
        `"${p.hcsCode || ''}"`
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `products_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToExcel = () => {
    const data = filteredProducts.map(p => {
      const isImei = isIMEIProduct(p);
      const isGst = isGSTProduct(p);
      return {
        'Product Name': p.name,
        'Code / Barcode': p.productCode,
        'Brand': p.brand,
        'Model': p.model || '',
        'Category': p.category,
        'Type': isImei ? 'IMEI' : isGst ? 'Non-IMEI GST' : 'Non-IMEI',
        'Cost': showActualCost ? p.cost : encodePrice(p.cost),
        'MRP (₹)': p.mrp,
        'Stock Qty': p.quantity,
        'IMEI': p.imei || '',
        'HSN Code': p.hcsCode || '',
        'Tax Slab (%)': isGst ? p.taxPercent || 18 : 0,
        'Date Added': p.createdAt?.toLocaleDateString() || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, `products_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToPDF = () => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(`Products Stock (${activeTab.toUpperCase()})`, 14, 20);
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleDateString()} • Total: ${filteredProducts.length} items`, 14, 26);

      const tableColumn = ['Name', 'Code', 'Brand', 'Category', 'Type', 'Cost', 'MRP', 'Stock'];
      const tableRows = filteredProducts.map(p => {
        const isImei = isIMEIProduct(p);
        const isGst = isGSTProduct(p);
        return [
          p.name,
          p.productCode,
          p.brand,
          p.category,
          isImei ? 'IMEI' : isGst ? 'GST' : 'Regular',
          showActualCost ? `₹${p.cost}` : encodePrice(p.cost),
          `₹${p.mrp}`,
          p.quantity.toString()
        ];
      });

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 32,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] },
      });

      doc.save(`products_${activeTab}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className={`max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 ${isSelectionMode ? 'pb-44 md:pb-28' : 'pb-24 sm:pb-8'}`}>

        {/* COMPACT HEADER (Clean Project Style matching Purchases.tsx) */}
        <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Products
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>
                {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} listed
              </span>
              <span className="text-gray-300">•</span>
              {selectedLocation === 'all_locations' ? (
                <span className="inline-flex items-center gap-1 text-indigo-700 font-medium">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Complete Stock (Hub Warehouse + All Branches)</span>
                </span>
              ) : selectedLocation === 'hub_warehouse' || !currentStore?.id ? (
                <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                  <Warehouse className="w-3.5 h-3.5" />
                  <span>Hub Warehouse (Main Office Storage)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Branch: {currentStore.name}</span>
                </span>
              )}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Location / Branch Switcher */}
            <LocationSwitcher includeAllLocations />

            {/* Secret / Cost Toggle (Owner/Admin) */}
            {isOwnerOrAdmin && (
              <button
                type="button"
                onClick={() => setShowActualCost(!showActualCost)}
                title={showActualCost ? 'Showing Actual Cost (₹)' : 'Showing Encoded Secret Code'}
                className={`px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors ${showActualCost
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
              >
                {showActualCost ? <Unlock className="w-3.5 h-3.5 text-amber-600" /> : <Lock className="w-3.5 h-3.5 text-gray-400" />}
                <span>{showActualCost ? 'Cost: ₹ Actual' : 'Cost: Code'}</span>
              </button>
            )}

            {/* Refresh */}
            <button
              type="button"
              onClick={fetchProducts}
              disabled={loading}
              title="Refresh products list"
              className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Print labels: enters pick mode, the floating bar at the bottom takes it from there */}
            <button
              type="button"
              onClick={toggleSelectionMode}
              aria-pressed={isSelectionMode}
              title={isSelectionMode ? 'Stop picking products' : 'Pick products and print their barcode labels'}
              className={`py-2 px-3 sm:px-4 rounded-lg font-medium flex items-center gap-1.5 text-xs sm:text-sm transition-colors border shadow-sm ${isSelectionMode
                  ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-800'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
            >
              {isSelectionMode ? <X className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
              <span>{isSelectionMode ? 'Done' : 'Print labels'}</span>
            </button>

            {/* Export Menu */}
            <div className="relative" ref={exportDropdownRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="bg-green-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 text-xs">
                  <button
                    onClick={() => { exportToExcel(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    📊 Excel File (.xlsx)
                  </button>
                  <button
                    onClick={() => { exportToCSV(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    📄 CSV File (.csv)
                  </button>
                  <button
                    onClick={() => { exportToPDF(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    📋 PDF File (.pdf)
                  </button>
                </div>
              )}
            </div>

            {/* Add Product Dropdown */}
            <div className="relative z-40" ref={addDropdownRef}>
              <button
                type="button"
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Add Product</span>
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>
              {showAddMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50 overflow-hidden text-xs">
                  <button
                    onClick={() => { navigate('/add-product'); setShowAddMenu(false); }}
                    className="w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium flex items-center gap-2.5"
                  >
                    <Package className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-gray-900">Add Non-IMEI Product</div>
                      <div className="text-[11px] text-gray-500">Regular items & accessories</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { navigate('/add-purchase-imei'); setShowAddMenu(false); }}
                    className="w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium flex items-center gap-2.5 border-t border-gray-100"
                  >
                    <Smartphone className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-gray-900">Add IMEI Phone Purchase</div>
                      <div className="text-[11px] text-gray-500">Handset inventory with serials</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { navigate('/add-purchase'); setShowAddMenu(false); }}
                    className="w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium flex items-center gap-2.5 border-t border-gray-100"
                  >
                    <Receipt className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-gray-900">Add Other / GST Purchase</div>
                      <div className="text-[11px] text-gray-500">Bulk invoice & GST accessories</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* COMPACT STATS - Hide on mobile (Matching Purchases.tsx) */}
        <div className={`hidden sm:grid ${stockAgingSettings.enabled ? 'grid-cols-5' : 'grid-cols-4'} gap-3 mb-4`}>
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
            <p className="text-xs text-gray-500">Total Products</p>
            <p className="text-lg font-bold text-gray-900">{tabCounts.all}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
            <p className="text-xs text-gray-500">Total Stock</p>
            <p className="text-lg font-bold text-blue-600">{tabMetrics.totalUnits.toLocaleString()} units</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
            <p className="text-xs text-gray-500">Stock Value (MRP)</p>
            <p className="text-lg font-bold text-green-600">₹{Math.round(tabMetrics.totalMrpValue).toLocaleString()}</p>
          </div>
          <div
            onClick={() => setStockStatusFilter(stockStatusFilter === 'low_stock' ? 'all' : 'low_stock')}
            className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${stockStatusFilter === 'low_stock' ? 'border-orange-500 bg-orange-50/60' : 'border-gray-200 hover:border-orange-300'
              }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Low Stock (≤5)</p>
              {stockStatusFilter === 'low_stock' && <span className="text-[10px] text-orange-600 font-bold uppercase">Filtered</span>}
            </div>
            <p className="text-lg font-bold text-orange-600">{tabMetrics.lowStockCount}</p>
          </div>
          {stockAgingSettings.enabled && (
            <div
              onClick={() => setStockStatusFilter(stockStatusFilter === 'aging_stock' ? 'all' : 'aging_stock')}
              className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${stockStatusFilter === 'aging_stock' ? 'border-amber-500 bg-amber-50/70 ring-1 ring-amber-400' : 'border-gray-200 hover:border-amber-300'
                }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-amber-700 font-semibold flex items-center gap-1">
                  <Hourglass className="w-3.5 h-3.5 text-amber-600" />
                  Aging Stock ({stockAgingSettings.agingDays}d+)
                </p>
                {stockStatusFilter === 'aging_stock' && <span className="text-[10px] text-amber-800 font-bold uppercase bg-amber-200 px-1 rounded">Filtered</span>}
              </div>
              <div className="flex items-baseline justify-between mt-0.5">
                <p className="text-lg font-bold text-amber-700">{tabCounts.aging}</p>
                {stockAgingSettings.enableIncentive && stockAgingSettings.incentivePercent > 0 && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    +{stockAgingSettings.incentivePercent}% Bonus
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* DESKTOP-LIKE PRODUCT TYPE TABS (Matching Purchases.tsx tab styling) */}
        <div className="flex bg-white rounded-lg p-1 border border-gray-200 mb-3 sm:mb-4 overflow-x-auto hide-scrollbar sm:w-max shadow-sm">
          {[
            { key: 'all', label: 'All Products', icon: Layers, count: tabCounts.all },
            { key: 'non_imei', label: 'Non-IMEI (Regular)', icon: Package, count: tabCounts.non_imei },
            { key: 'non_imei_gst', label: 'Non-IMEI GST', icon: Receipt, count: tabCounts.non_imei_gst },
            { key: 'imei', label: 'IMEI Phones', icon: Smartphone, count: tabCounts.imei }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none flex items-center justify-center gap-2 ${isActive
                    ? 'bg-blue-100 text-blue-700 shadow-sm font-semibold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isActive ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'
                  }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* COMPACT FILTERS & SEARCH (Matching Purchases.tsx filter pattern) */}
        <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">

            {/* Stock Status Filter Tags */}
            {[
              { key: 'all', label: 'All' },
              { key: 'in_stock', label: 'In Stock' },
              { key: 'low_stock', label: 'Low Stock' },
              { key: 'out_of_stock', label: 'Out of Stock' },
              ...(stockAgingSettings.enabled ? [{ key: 'aging_stock', label: `⚡ Aging Stock (${tabCounts.aging})` }] : []),
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setStockStatusFilter(s.key as any)}
                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${stockStatusFilter === (s.key as any)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
              >
                {s.label}
              </button>
            ))}

            {/* Search Input inline */}
            <div className="relative flex-1 min-w-[200px] sm:min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, code, brand, model, IMEI, HSN..."
                className="w-full pl-9 pr-7 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
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

            {/* Brand Filter Dropdown */}
            <div className="relative">
              <select
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                className="px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none"
              >
                <option value="">All Brands</option>
                {uniqueBrands.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Category Dropdown */}
            <div className="relative" ref={categoryDropdownRef}>
              <button
                type="button"
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                className="px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium text-gray-700 hover:border-gray-400 flex items-center gap-1.5"
              >
                <span>{filterCategories.length === 0 ? 'Categories' : `${filterCategories.length} selected`}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`} />
              </button>
              {showCategoryDropdown && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-56 overflow-y-auto p-2 space-y-1 text-xs">
                  {uniqueCategories.map(cat => (
                    <label key={cat} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-gray-700">
                      <input
                        type="checkbox"
                        checked={filterCategories.includes(cat)}
                        onChange={() => toggleCategory(cat)}
                        className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="truncate">{cat}</span>
                    </label>
                  ))}
                  {filterCategories.length > 0 && (
                    <div className="pt-2 border-t border-gray-100 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setFilterCategories([])}
                        className="text-xs text-red-600 hover:underline px-2 py-1 font-semibold"
                      >
                        Clear Selection
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none"
              >
                <option value="date">Recent First</option>
                <option value="name">Name</option>
                <option value="quantity">Stock Qty</option>
                <option value="price">MRP (Price)</option>
                <option value="cost">Cost</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Sort Order Button */}
            <button
              type="button"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-2.5 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1 font-medium"
              title={sortOrder === 'asc' ? 'Ascending Order' : 'Descending Order'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{sortOrder === 'asc' ? '↑' : '↓'}</span>
            </button>
          </div>

          {/* Active Filter Indicators */}
          {(searchTerm || filterBrand || filterCategories.length > 0 || stockStatusFilter !== 'all') && (
            <div className="mt-2.5 pt-2.5 border-t border-gray-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-500">Active filters:</span>
                {searchTerm && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium flex items-center gap-1">
                    "{searchTerm}"
                    <button onClick={() => setSearchTerm('')}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filterBrand && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium flex items-center gap-1">
                    Brand: {filterBrand}
                    <button onClick={() => setFilterBrand('')}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {filterCategories.map(cat => (
                  <span key={cat} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium flex items-center gap-1">
                    {cat}
                    <button onClick={() => toggleCategory(cat)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {stockStatusFilter !== 'all' && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium flex items-center gap-1">
                    Stock: {stockStatusFilter.replace('_', ' ')}
                    <button onClick={() => setStockStatusFilter('all')}><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setFilterBrand('');
                  setFilterCategories([]);
                  setStockStatusFilter('all');
                }}
                className="text-blue-600 hover:text-blue-800 font-medium ml-2 shrink-0"
              >
                Clear All
              </button>
            </div>
          )}

          {/* Pick-mode hint */}
          {isSelectionMode && (
            <div className="mt-2.5 pt-2.5 border-t border-blue-100 bg-blue-50 -mx-2 sm:-mx-3 -mb-2 sm:-mb-3 px-3 py-2.5 rounded-b-lg flex items-center gap-2 text-xs sm:text-sm text-blue-900">
              <Printer className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Tap the products you want labels for, then press <strong className="font-semibold">Print</strong> at the bottom.</span>
            </div>
          )}
        </div>

        {/* PRODUCTS LIST (Responsive: Cards on Mobile, Table on Desktop) */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 text-sm font-medium">Loading products...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
            <Package className="w-14 h-14 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-700 font-semibold text-base">No products found</p>
            <p className="text-gray-500 text-xs mt-1 max-w-sm mx-auto">
              {products.length === 0
                ? 'No products have been added to inventory yet.'
                : 'No products match your active search and filter criteria.'}
            </p>
            {products.length === 0 && (
              <div className="mt-4">
                <button
                  onClick={() => navigate('/add-product')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Add Your First Product
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* MOBILE CARD VIEW (md:hidden) */}
            <div className="md:hidden space-y-3">
              {paginatedProducts.map(product => {
                const isImei = isIMEIProduct(product);
                const isGst = isGSTProduct(product);
                const isSelected = selectedProductIds.includes(product.id!);

                return (
                  <div
                    key={product.id}
                    onClick={() => (isSelectionMode ? toggleProductSelection(product.id!) : setSelectedProductForDetails(product))}
                    className={`bg-white rounded-lg shadow-sm border p-4 transition-shadow cursor-pointer ${isSelected ? 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-400' : 'border-gray-200 hover:shadow-md'
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      {isSelectionMode && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          aria-label={`Select ${product.name}`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleProductSelection(product.id!)}
                          className="mt-0.5 w-5 h-5 accent-blue-600 rounded border-gray-300 cursor-pointer"
                        />
                      )}

                      <div className="flex-1 min-w-0">
                        {/* Title and Badges */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div>
                            <h3 className="font-semibold text-gray-900 text-sm leading-snug">{product.name}</h3>
                            <p className="text-xs text-gray-500">
                              {product.brand} {product.model ? `• ${product.model}` : ''}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={`inline-block px-2 py-0.5 text-xs font-bold rounded-full ${product.quantity <= 0
                                ? 'bg-red-100 text-red-700'
                                : product.quantity <= 5
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                              {product.quantity <= 0 ? 'Out of stock' : `${product.quantity} units`}
                            </span>
                            {selectedLocation === 'all_locations' && ((product as any)._inBranchQty > 0 || (product as any)._hubQty > 0) && (
                              <div className="text-[10px] text-slate-500 font-medium mt-0.5">
                                Hub: {(product as any)._hubQty ?? 0} • Branch: {(product as any)._inBranchQty ?? 0}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Codes & Badges */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-mono font-semibold border border-purple-200">
                            <QrCode className="h-3 w-3" />
                            {product.productCode}
                          </span>

                          {product.imei && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono font-bold border border-blue-200">
                              <Smartphone className="w-3 h-3" />
                              {product.imei}
                            </span>
                          )}

                          {isImei ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-medium border border-indigo-200">
                              IMEI
                            </span>
                          ) : isGst ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-800 rounded text-[11px] font-medium border border-emerald-200">
                              GST {product.taxPercent || 18}%
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[11px] font-medium border border-gray-200">
                              Non-IMEI
                            </span>
                          )}

                          {stockAgingSettings.enabled && (product.quantity || 0) > 0 && isProductAging(product, stockAgingSettings) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800 rounded text-[11px] font-bold border border-amber-300">
                              <Hourglass className="w-3 h-3 text-amber-600" />
                              Aging ({getProductAgeInDays(product)}d)
                              {stockAgingSettings.enableIncentive && stockAgingSettings.incentivePercent > 0 && (
                                <span className="ml-0.5 bg-amber-500 text-white text-[9px] px-1 rounded font-extrabold">
                                  +{stockAgingSettings.incentivePercent}%
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Financial summary row */}
                        <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-2.5 text-xs mb-3">
                          <div>
                            <span className="text-gray-500 block text-[10px] uppercase font-semibold">Cost Price</span>
                            <span className="font-mono font-semibold text-amber-800">
                              {showActualCost ? `₹${Math.round(product.cost)}` : encodePrice(product.cost)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block text-[10px] uppercase font-semibold">Selling Price (MRP)</span>
                            <span className="font-bold text-green-700">
                              ₹{Math.round(product.mrp)}
                            </span>
                          </div>
                        </div>

                        {/* Mobile Card Action Buttons */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setSelectedProductForDetails(product)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            View Details →
                          </button>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handlePrintLabel(product)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Print Label"
                            >
                              <Printer className="w-4 h-4" />
                            </button>

                            {isOwnerOrAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setProductForSuitableModels(product);
                                    setShowSuitableModelsModal(true);
                                  }}
                                  className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                                  title="Suitable Models"
                                >
                                  <Smartphone className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEdit(product)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Edit"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(product.id!)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* DESKTOP TABLE VIEW (hidden md:block) */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium text-xs">
                    <tr>
                      {isSelectionMode && (
                        <th className="px-4 py-3 text-center w-10">
                          <input
                            type="checkbox"
                            aria-label="Select all on this page"
                            checked={paginatedProducts.length > 0 && paginatedProducts.every(p => selectedProductIds.includes(p.id!))}
                            onChange={selectCurrentPage}
                            className="w-4 h-4 accent-blue-600 rounded border-gray-300 cursor-pointer"
                          />
                        </th>
                      )}
                      <th className="px-5 py-3 font-semibold text-gray-600">Product Info</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Code / IMEI</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Brand</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Stock</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Cost</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">MRP</th>
                      <th className="px-5 py-3 font-semibold text-gray-600 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedProducts.map(product => {
                      const isImei = isIMEIProduct(product);
                      const isGst = isGSTProduct(product);
                      const isSelected = selectedProductIds.includes(product.id!);

                      return (
                        <tr
                          key={product.id}
                          onClick={() => (isSelectionMode ? toggleProductSelection(product.id!) : setSelectedProductForDetails(product))}
                          className={`transition-colors cursor-pointer ${isSelected ? 'bg-blue-50 hover:bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                        >
                          {/* Selection Checkbox */}
                          {isSelectionMode && (
                            <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                aria-label={`Select ${product.name}`}
                                onChange={() => toggleProductSelection(product.id!)}
                                className="w-4 h-4 accent-blue-600 rounded border-gray-300 cursor-pointer"
                              />
                            </td>
                          )}

                          {/* Product Info */}
                          <td className="px-5 py-3.5 max-w-xs sm:max-w-sm">
                            <div className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                              {product.name}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                              {product.model && <span>{product.model}</span>}
                              {product.category && (
                                <span className="px-1.5 py-0.2 bg-gray-100 text-gray-600 rounded text-[11px]">
                                  {product.category}
                                </span>
                              )}
                            </div>

                            {/* Compatible Models Tags */}
                            {product.suitableModels && product.suitableModels.length > 0 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {product.suitableModels.slice(0, 2).map((m, i) => (
                                  <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 text-[10px] font-medium border border-indigo-200">
                                    ✓ {m}
                                  </span>
                                ))}
                                {product.suitableModels.length > 2 && (
                                  <span className="text-[10px] text-gray-400 font-medium">
                                    +{product.suitableModels.length - 2}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Code / IMEI */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-mono font-semibold border border-purple-200">
                                <QrCode className="h-3 w-3" />
                                {product.productCode}
                                <button
                                  type="button"
                                  onClick={(e) => copyToClipboard(product.productCode, e)}
                                  title="Copy Code"
                                  className="ml-0.5 text-purple-400 hover:text-purple-800"
                                >
                                  {copiedCode === product.productCode ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </span>

                              {product.imei && (
                                <div>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono font-bold border border-blue-200">
                                    <Smartphone className="w-3 h-3" />
                                    {product.imei}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Brand */}
                          <td className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-900 font-medium">
                            {product.brand}
                          </td>

                          {/* Type */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {isImei ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-semibold border border-indigo-200">
                                <Smartphone className="w-3 h-3" /> IMEI Phone
                              </span>
                            ) : isGst ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded text-xs font-semibold border border-emerald-200">
                                <Receipt className="w-3 h-3" /> GST {product.taxPercent ? `${product.taxPercent}%` : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-semibold border border-gray-200">
                                <Package className="w-3 h-3 text-gray-500" /> Non-IMEI
                              </span>
                            )}
                          </td>

                          {/* Stock */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${product.quantity <= 0
                                    ? 'bg-red-100 text-red-700 border border-red-300'
                                    : product.quantity <= 5
                                      ? 'bg-orange-100 text-orange-700 border border-orange-300'
                                      : 'bg-blue-100 text-blue-700 border border-blue-300'
                                  }`}>
                                  {product.quantity <= 0 ? 'Out of stock' : `${product.quantity} units`}
                                </span>
                                {stockAgingSettings.enabled && (product.quantity || 0) > 0 && isProductAging(product, stockAgingSettings) && (
                                  <span
                                    title={`In stock for ${getProductAgeInDays(product)} days (Aging threshold: ${stockAgingSettings.agingDays} days)`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[11px] font-bold border border-amber-300"
                                  >
                                    <Hourglass className="w-3 h-3 text-amber-600" />
                                    {getProductAgeInDays(product)}d
                                    {stockAgingSettings.enableIncentive && stockAgingSettings.incentivePercent > 0 && (
                                      <span className="bg-amber-600 text-white text-[9px] px-1 rounded font-extrabold">
                                        +{stockAgingSettings.incentivePercent}%
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                              {selectedLocation === 'all_locations' && ((product as any)._inBranchQty > 0 || (product as any)._hubQty > 0) && (
                                <div className="text-[10px] text-slate-500 font-medium mt-1">
                                  Hub: <strong className="text-slate-700">{(product as any)._hubQty ?? 0}</strong> • Branches: <strong className="text-slate-700">{(product as any)._inBranchQty ?? 0}</strong>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Cost */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="text-sm font-mono font-semibold text-amber-700">
                              {showActualCost ? `₹${Math.round(product.cost)}` : encodePrice(product.cost)}
                            </span>
                          </td>

                          {/* MRP */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="text-sm font-semibold text-green-700">
                              ₹{Math.round(product.mrp)}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-3.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handlePrintLabel(product)}
                                title="Print label"
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              >
                                <Printer className="h-4 w-4" />
                              </button>

                              {isOwnerOrAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setProductForSuitableModels(product);
                                      setShowSuitableModelsModal(true);
                                    }}
                                    title="Suitable Models"
                                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                  >
                                    <Smartphone className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(product)}
                                    title="Edit product"
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(product.id!)}
                                    disabled={deleteLoading === product.id}
                                    title="Delete product"
                                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* PAGINATION (Matching Project Style) */}
        {filteredProducts.length > 0 && (
          <div className="mt-4 p-3 sm:p-4 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="text-gray-600 font-medium">
              Showing <span className="text-blue-600 font-bold">{filteredProducts.length === 0 ? 0 : startIndex + 1}</span> to{' '}
              <span className="text-blue-600 font-bold">{Math.min(endIndex, filteredProducts.length)}</span> of{' '}
              <span className="text-blue-600 font-bold">{filteredProducts.length}</span> products
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="px-3 py-1.5 text-xs font-bold text-blue-600 border border-blue-600 rounded-lg bg-blue-50">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

      </div>

      {/* PRODUCT DETAILS SIDE PANEL (Project Style) */}
      {selectedProductForDetails && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fadeIn"
          onClick={() => setSelectedProductForDetails(null)}
        >
          <div
            className="w-full sm:w-[480px] bg-white shadow-2xl overflow-y-auto max-h-screen animate-slideInRight"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 z-10 p-4 sm:p-6 flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">
                  {selectedProductForDetails.name}
                </h3>
                <p className="text-sm text-gray-500">
                  {selectedProductForDetails.brand} {selectedProductForDetails.model ? `• ${selectedProductForDetails.model}` : ''}
                </p>
                <div className="mt-2 inline-flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-1">
                  <QrCode className="h-3.5 w-3.5 text-purple-600" />
                  <span className="font-mono font-bold text-purple-900 text-xs">
                    {selectedProductForDetails.productCode}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProductForDetails(null)}
                className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-6 space-y-5">

              {/* Image if any */}
              {selectedProductForDetails.imageUrl && (
                <div className="rounded-lg overflow-hidden border border-gray-200 max-h-56">
                  <img
                    src={selectedProductForDetails.imageUrl}
                    alt={selectedProductForDetails.name}
                    className="w-full h-56 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Cost</div>
                  <div className="font-bold text-amber-800 text-base font-mono">
                    {showActualCost ? `₹${Math.round(selectedProductForDetails.cost)}` : encodePrice(selectedProductForDetails.cost)}
                  </div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">MRP</div>
                  <div className="font-bold text-green-800 text-base">
                    ₹{Math.round(selectedProductForDetails.mrp)}
                  </div>
                </div>
                <div className={`border rounded-lg p-3 ${selectedProductForDetails.quantity <= 5 ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'
                  }`}>
                  <div className="text-xs text-gray-500 mb-1">Stock</div>
                  <div className={`font-bold text-base ${selectedProductForDetails.quantity <= 5 ? 'text-orange-700' : 'text-blue-700'}`}>
                    {selectedProductForDetails.quantity} units
                  </div>
                </div>
              </div>

              {/* Profit Margin */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-medium text-gray-700">Profit Margin per unit</span>
                </div>
                <span className="text-base font-bold text-blue-700">
                  ₹{Math.round(selectedProductForDetails.mrp - selectedProductForDetails.cost)}
                </span>
              </div>

              {/* Aging Stock Notice */}
              {stockAgingSettings.enabled && (selectedProductForDetails.quantity || 0) > 0 && isProductAging(selectedProductForDetails, stockAgingSettings) && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Hourglass className="h-4 w-4 text-amber-600 animate-pulse" />
                      <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">Slow-Moving / Aging Stock</span>
                    </div>
                    <span className="px-2 py-0.5 bg-amber-200 text-amber-900 font-bold text-xs rounded-full">
                      {getProductAgeInDays(selectedProductForDetails)} Days in Stock
                    </span>
                  </div>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    This product has been in inventory for {getProductAgeInDays(selectedProductForDetails)} days (aging policy: {stockAgingSettings.agingDays}+ days).
                  </p>
                  {stockAgingSettings.enableIncentive && stockAgingSettings.incentivePercent > 0 && (
                    <div className="pt-2 border-t border-amber-200 flex items-center justify-between">
                      <span className="text-xs font-medium text-amber-900">Clearance Incentive:</span>
                      <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                        +{stockAgingSettings.incentivePercent}% ({stockAgingSettings.incentiveBasis === 'profit' ? 'Profit' : 'MRP'}) = ₹
                        {calculateAgingIncentive(
                          selectedProductForDetails.mrp,
                          selectedProductForDetails.mrp - selectedProductForDetails.cost,
                          stockAgingSettings
                        )} / unit
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Location Stock Breakdown (when viewing Hub or Complete Stock) */}
              {Array.isArray((selectedProductForDetails as any)._locationBreakdown) &&
                (selectedProductForDetails as any)._locationBreakdown.length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                      Stock by Location
                    </div>
                    <div className="space-y-1.5">
                      {(selectedProductForDetails as any)._locationBreakdown.map(
                        (loc: { id: string; name: string; qty: number; isHub?: boolean }) => (
                          <div
                            key={loc.id}
                            className="flex items-center justify-between text-xs bg-white px-2.5 py-1.5 rounded border border-slate-200/80"
                          >
                            <span className="font-medium text-slate-700 flex items-center gap-1.5">
                              {loc.isHub ? (
                                <Warehouse className="w-3.5 h-3.5 text-amber-600" />
                              ) : (
                                <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                              )}
                              <span>{loc.isHub ? 'Hub Warehouse (Main Office)' : loc.name}</span>
                            </span>
                            <span className="font-bold text-slate-900 tabular-nums">
                              {loc.qty} {loc.qty === 1 ? 'unit' : 'units'}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

              {/* Specs */}
              <div>
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">Product Specifications</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-600">Brand</span>
                    <span className="font-semibold text-gray-900">{selectedProductForDetails.brand}</span>
                  </div>
                  {selectedProductForDetails.model && (
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-600">Model</span>
                      <span className="font-semibold text-gray-900">{selectedProductForDetails.model}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-600">Category</span>
                    <span className="font-semibold text-gray-900">{selectedProductForDetails.category}</span>
                  </div>
                  {selectedProductForDetails.imei && (
                    <div className="flex items-center justify-between py-2 border-b border-gray-100 bg-blue-50 px-2 rounded">
                      <span className="text-blue-700 font-semibold">IMEI Number</span>
                      <span className="font-mono font-bold text-blue-900">{selectedProductForDetails.imei}</span>
                    </div>
                  )}
                  {isGSTProduct(selectedProductForDetails) && (
                    <>
                      <div className="flex items-center justify-between py-2 border-b border-gray-100 bg-emerald-50 px-2 rounded">
                        <span className="text-emerald-700 font-semibold">GST Invoicing</span>
                        <span className="font-bold text-emerald-900">{selectedProductForDetails.taxPercent || 18}% Tax</span>
                      </div>
                      {selectedProductForDetails.hcsCode && (
                        <div className="flex items-center justify-between py-2 border-b border-gray-100">
                          <span className="text-gray-600">HSN Code</span>
                          <span className="font-mono font-semibold text-gray-900">{selectedProductForDetails.hcsCode}</span>
                        </div>
                      )}
                    </>
                  )}
                  {selectedProductForDetails.supplier && (
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-600">Supplier</span>
                      <span className="font-semibold text-gray-900">{selectedProductForDetails.supplier}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Compatible Models */}
              {selectedProductForDetails.suitableModels && selectedProductForDetails.suitableModels.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 text-indigo-600" />
                    Compatible Models ({selectedProductForDetails.suitableModels.length})
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProductForDetails.suitableModels.map((m, idx) => (
                      <span key={idx} className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded text-xs font-medium">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Audit Meta */}
              <div className="text-xs text-gray-400 pt-3 border-t border-gray-100">
                Added on {selectedProductForDetails.createdAt?.toLocaleDateString()} {selectedProductForDetails.createdByName ? `by ${selectedProductForDetails.createdByName}` : ''}
              </div>

            </div>

            {/* Sticky Footer Actions */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 space-y-2">
              <button
                type="button"
                onClick={() => {
                  const p = selectedProductForDetails;
                  setSelectedProductForDetails(null);
                  handlePrintLabel(p);
                }}
                className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg hover:bg-blue-700 font-semibold flex items-center justify-center gap-2 text-sm shadow-sm"
              >
                <Printer className="h-4 w-4" />
                Print Label
              </button>

              {isOwnerOrAdmin && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const p = selectedProductForDetails;
                      setSelectedProductForDetails(null);
                      setProductForSuitableModels(p);
                      setShowSuitableModelsModal(true);
                    }}
                    className="flex-1 bg-indigo-50 text-indigo-700 py-2 px-3 rounded-lg hover:bg-indigo-100 font-semibold text-xs border border-indigo-200 flex items-center justify-center gap-1.5"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    Models
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const p = selectedProductForDetails;
                      setSelectedProductForDetails(null);
                      handleEdit(p);
                    }}
                    className="flex-1 bg-blue-50 text-blue-700 py-2 px-3 rounded-lg hover:bg-blue-100 font-semibold text-xs border border-blue-200 flex items-center justify-center gap-1.5"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const p = selectedProductForDetails;
                      setSelectedProductForDetails(null);
                      handleDelete(p.id!);
                    }}
                    className="flex-1 bg-red-50 text-red-700 py-2 px-3 rounded-lg hover:bg-red-100 font-semibold text-xs border border-red-200 flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {showEditModal && productToEdit && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center z-50 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setShowEditModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Edit className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Edit Product</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Code: <span className="font-mono font-medium text-slate-700">{productToEdit.productCode}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
              {/* Product Basic Info Section */}
              <div className="space-y-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Product Name *</label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    placeholder="e.g. Samsung 25W Fast Charger"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-slate-900 text-sm placeholder:text-slate-400"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Brand *</label>
                    <input
                      type="text"
                      value={editFormData.brand}
                      onChange={(e) => setEditFormData({ ...editFormData, brand: e.target.value })}
                      placeholder="e.g. Samsung"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 font-medium"
                      required
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Model (Optional)</label>
                    <input
                      type="text"
                      value={editFormData.model}
                      onChange={(e) => setEditFormData({ ...editFormData, model: e.target.value })}
                      placeholder="e.g. EP-TA800"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Category *</label>
                    <input
                      type="text"
                      value={editFormData.category}
                      onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                      placeholder="e.g. Charger"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 font-medium"
                      required
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Supplier (Optional)</label>
                    <input
                      type="text"
                      value={editFormData.supplier}
                      onChange={(e) => setEditFormData({ ...editFormData, supplier: e.target.value })}
                      placeholder="Supplier name"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* Pricing & Stock Card */}
              <div className="bg-slate-50/80 rounded-xl p-3.5 border border-slate-200/80 space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pricing & Inventory
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Cost Price (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editFormData.cost}
                      onChange={(e) => setEditFormData({ ...editFormData, cost: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono font-semibold text-slate-900 tabular-nums"
                      required
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Selling (MRP ₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editFormData.mrp}
                      onChange={(e) => setEditFormData({ ...editFormData, mrp: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono font-bold text-green-700 tabular-nums"
                      required
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Stock Units *</label>
                    <input
                      type="number"
                      min="0"
                      value={editFormData.quantity}
                      onChange={(e) => setEditFormData({ ...editFormData, quantity: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono font-semibold text-slate-900 tabular-nums"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-500 block mb-1">MOP (Optional ₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Market Operating Price"
                    value={editFormData.mop}
                    onChange={(e) => setEditFormData({ ...editFormData, mop: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-slate-700"
                  />
                </div>
              </div>

              {/* GST Section */}
              <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5 text-xs">
                    <Receipt className="w-4 h-4 text-emerald-700" />
                    GST Tax Details
                  </span>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editFormData.gstEnabled}
                      onChange={(e) => setEditFormData({ ...editFormData, gstEnabled: e.target.checked })}
                      className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-emerald-900">
                      {editFormData.gstEnabled ? 'GST Enabled' : 'Non-GST'}
                    </span>
                  </label>
                </div>

                {editFormData.gstEnabled && (
                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-emerald-200/70">
                    <div>
                      <label className="font-semibold text-emerald-900 block mb-1">Tax Slab</label>
                      <select
                        value={editFormData.taxPercent}
                        onChange={(e) => setEditFormData({ ...editFormData, taxPercent: e.target.value })}
                        className="w-full px-3 py-2 border border-emerald-300 rounded-xl bg-white text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="0">0% (Exempt)</option>
                        <option value="5">5% GST</option>
                        <option value="12">12% GST</option>
                        <option value="18">18% GST (Standard)</option>
                        <option value="28">28% GST</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-semibold text-emerald-900 block mb-1">HSN Code</label>
                      <input
                        type="text"
                        value={editFormData.hcsCode}
                        onChange={(e) => setEditFormData({ ...editFormData, hcsCode: e.target.value })}
                        placeholder="e.g. 8517"
                        className="w-full px-3 py-2 border border-emerald-300 rounded-xl bg-white font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Action Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                disabled={editLoading}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={editLoading || !editFormData.name.trim()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-xs"
              >
                {editLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && productToDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-3 text-xs">
            <div className="flex items-center gap-2.5 text-red-600">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-base font-bold text-gray-900">Delete Product</h3>
            </div>

            <p className="text-gray-600">
              Are you sure you want to delete <strong className="text-gray-900">{productToDelete.name}</strong>?
            </p>

            <div className="space-y-1">
              <label className="font-medium text-gray-600 block">Type product name to confirm:</label>
              <input
                type="text"
                value={deleteConfirmationInput}
                onChange={(e) => setDeleteConfirmationInput(e.target.value)}
                placeholder={productToDelete.name}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-red-500 focus:outline-none font-semibold text-gray-900"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteLoading === productToDelete.id || deleteConfirmationInput.trim() !== productToDelete.name}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-40 shadow-sm"
              >
                {deleteLoading === productToDelete.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT LABELS – FLOATING SELECTION BAR */}
      {isSelectionMode && (
        <div className="fixed inset-x-0 bottom-20 md:bottom-6 z-40 flex justify-center px-3 pointer-events-none">
          <div
            role="region"
            aria-label="Print labels selection"
            className="pointer-events-auto w-full max-w-xl bg-gray-900 text-white rounded-2xl shadow-2xl pl-4 pr-2 py-2 flex items-center gap-2 sm:gap-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold tabular-nums" aria-live="polite">
                {selectedProductIds.length === 0
                  ? 'No products picked'
                  : `${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'} picked`}
              </p>
              <div className="flex items-center gap-3 text-xs text-gray-300">
                <button
                  type="button"
                  onClick={() =>
                    allFilteredSelected
                      ? setSelectedProductIds([])
                      : setSelectedProductIds(filteredProducts.map(p => p.id!).filter(Boolean))
                  }
                  className="hover:text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  {allFilteredSelected ? 'Clear all' : `Pick all ${filteredProducts.length}`}
                </button>
                {selectedProductIds.length > 0 && !allFilteredSelected && (
                  <button
                    type="button"
                    onClick={() => setSelectedProductIds([])}
                    className="hover:text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={toggleSelectionMode}
              className="h-10 px-3 rounded-xl text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePrintSelectedLabels}
              disabled={selectedProductIds.length === 0}
              className="h-10 px-4 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              <Printer className="w-4 h-4" />
              <span>Print{selectedProductIds.length > 0 ? ` (${selectedProductIds.length})` : ''}</span>
            </button>
          </div>
        </div>
      )}

      {/* PRODUCT LABELS EMBED */}
      {selectedProductForLabel && (
        <ProductLabel
          product={selectedProductForLabel}
          shopDetails={shopDetails}
          onClose={() => setSelectedProductForLabel(null)}
          isNewProduct={false}
        />
      )}

      {productsToPrint && productsToPrint.length > 0 && (
        <ProductLabel
          products={productsToPrint}
          shopDetails={shopDetails}
          onClose={() => setProductsToPrint(null)}
          isNewProduct={false}
        />
      )}

      {/* SUITABLE MODELS MODAL */}
      {showSuitableModelsModal && productForSuitableModels && (
        <SuitableModelsModal
          product={productForSuitableModels}
          onClose={() => {
            setShowSuitableModelsModal(false);
            setProductForSuitableModels(null);
          }}
          onUpdate={() => {
            fetchProducts();
          }}
        />
      )}

    </div>
  );
};

export default Products;
