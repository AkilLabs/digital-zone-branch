import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
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
  DollarSign
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
  deleteDoc,
  updateDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../config/firebase';

import { generateProductCode, generateIMEIProductCode } from '../utils/productCode';
import { resolveShopDetails } from '../utils/shopDetails';
import { encodePrice } from '../utils/secretCode';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type ProductTab = 'all' | 'non_imei' | 'non_imei_gst' | 'imei';
type StockStatusFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';

const Products: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore } = useStore();
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
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'price' | 'cost' | 'quantity'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Print single label modal
  const [printQuantity, setPrintQuantity] = useState(1);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [productToPrint, setProductToPrint] = useState<Product | null>(null);

  // Selection states for printing
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  // Print all / multiple labels modal
  const [showPrintAllModal, setShowPrintAllModal] = useState(false);
  const [printQuantities, setPrintQuantities] = useState<{ [key: string]: number }>({});
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

  // Fetch products and shop details
  useEffect(() => {
    fetchProducts();
    fetchShopDetails();
  }, [currentStore?.id]);

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
        } else if (showPrintModal) {
          setShowPrintModal(false);
        } else if (showPrintAllModal) {
          setShowPrintAllModal(false);
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
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedProductForDetails,
    showPrintModal,
    showPrintAllModal,
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
      const syncedProducts = await syncStoreProducts(currentStore?.id);

      const productsData: Product[] = [...syncedProducts].sort(
        (a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0)
      );
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

      // Auto-generate missing product codes if any
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
        await upsertLocalProducts(currentStore?.id, updatedForLocalCache);
        invalidateProducts();
      }

      setProducts(productsData);
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

    products.forEach((p) => {
      if (isIMEIProduct(p)) {
        imei++;
      } else if (isGSTProduct(p)) {
        nonImeiGst++;
      } else {
        nonImeiRegular++;
      }
    });

    return {
      all: products.length,
      imei,
      non_imei_gst: nonImeiGst,
      non_imei: nonImeiRegular
    };
  }, [products]);

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
  }, [products, activeTab, stockStatusFilter, searchTerm, filterBrand, filterCategories, sortBy, sortOrder]);

  // Metrics for active tab
  const tabMetrics = useMemo(() => {
    let totalUnits = 0;
    let totalMrpValue = 0;
    let totalCostValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

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
    });

    return {
      itemCount: filteredProducts.length,
      totalUnits,
      totalMrpValue,
      totalCostValue,
      lowStockCount,
      outOfStockCount
    };
  }, [filteredProducts]);

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
    try {
      setDeleteLoading(deletedId);
      await deleteDoc(getDocRef('products', deletedId));
      await removeLocalProducts(currentStore?.id, [deletedId]);
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
      const updatedProduct: any = {
        name: editFormData.name.trim(),
        model: editFormData.model.trim() || null,
        brand: editFormData.brand.trim(),
        category: editFormData.category.trim(),
        cost,
        mrp,
        quantity,
        supplier: editFormData.supplier.trim() || null,
        gstEnabled: editFormData.gstEnabled,
        taxPercent,
        hcsCode: editFormData.hcsCode.trim() || null,
        mop,
        updatedAt: serverTimestamp()
      };

      if (updatedProduct.quantity !== productToEdit.quantity) {
        updatedProduct.isAvailable = quantity > 0;
      }

      const editId = productToEdit.id!;
      await updateDoc(getDocRef('products', editId), updatedProduct);

      const localUpdated: Product = {
        ...productToEdit,
        name: editFormData.name.trim(),
        model: editFormData.model.trim() || '',
        brand: editFormData.brand.trim(),
        category: editFormData.category.trim(),
        cost,
        mrp,
        quantity,
        supplier: editFormData.supplier.trim() || '',
        gstEnabled: editFormData.gstEnabled,
        taxPercent,
        hcsCode: editFormData.hcsCode.trim() || '',
        mop: mop || 0,
        isAvailable: quantity > 0,
        updatedAt: new Date(),
      };

      await upsertLocalProducts(currentStore?.id, [{ ...localUpdated, id: editId }]);
      setProducts(prev => prev.map(p => (p.id === editId ? localUpdated : p)));
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
  const handlePrintLabel = (product: Product) => {
    setProductToPrint(product);
    setPrintQuantity(Math.max(1, product.quantity || 1));
    setShowPrintModal(true);
  };

  const confirmPrintLabel = () => {
    if (productToPrint) {
      setSelectedProductForLabel({ ...productToPrint, quantity: printQuantity });
      setShowPrintModal(false);
    }
  };

  const handlePrintAllLabels = () => {
    const initialQuantities: { [key: string]: number } = {};
    filteredProducts.forEach(product => {
      initialQuantities[product.id!] = 1;
    });
    setPrintQuantities(initialQuantities);
    setShowPrintAllModal(true);
  };

  const handlePrintSelectedLabels = () => {
    const initialQuantities: { [key: string]: number } = {};
    selectedProductIds.forEach(id => {
      initialQuantities[id] = 1;
    });
    setPrintQuantities(initialQuantities);
    setShowPrintAllModal(true);
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

  const updatePrintQuantity = (productId: string, quantity: number) => {
    setPrintQuantities(prev => ({
      ...prev,
      [productId]: Math.max(1, quantity)
    }));
  };

  const confirmPrintAllLabels = () => {
    const selectedProducts = selectedProductIds.length > 0
      ? filteredProducts.filter(product => selectedProductIds.includes(product.id!))
      : filteredProducts;

    const productsWithQuantities = selectedProducts.map(product => ({
      ...product,
      quantity: printQuantities[product.id!] || 1
    }));

    if (productsWithQuantities.length > 0) {
      setProductsToPrint(productsWithQuantities);
    }

    setShowPrintAllModal(false);
    setIsSelectionMode(false);
    setSelectedProductIds([]);
    setPrintQuantities({});
  };

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

      <div className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8">

        {/* COMPACT HEADER (Clean Project Style matching Purchases.tsx) */}
        <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Products
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} listed
              {isSelectionMode && selectedProductIds.length > 0 && (
                <span className="text-purple-600 font-semibold"> • {selectedProductIds.length} selected</span>
              )}
              {currentStore?.name && (
                <span className="text-gray-400 hidden md:inline"> • Location: <strong className="text-gray-700 font-medium">{currentStore.name}</strong></span>
              )}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">

            {/* Secret / Cost Toggle (Owner/Admin) */}
            {isOwnerOrAdmin && (
              <button
                type="button"
                onClick={() => setShowActualCost(!showActualCost)}
                title={showActualCost ? 'Showing Actual Cost (₹)' : 'Showing Encoded Secret Code'}
                className={`px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                  showActualCost
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

            {/* Selection Mode Toggle */}
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`py-2 px-3 sm:px-4 rounded-lg font-medium flex items-center gap-1.5 text-xs sm:text-sm transition-colors border shadow-sm ${
                isSelectionMode
                  ? 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>{isSelectionMode ? `Cancel (${selectedProductIds.length})` : 'Select'}</span>
            </button>

            {/* Print Labels Button */}
            {isSelectionMode && selectedProductIds.length > 0 ? (
              <button
                type="button"
                onClick={handlePrintSelectedLabels}
                className="bg-purple-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-purple-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span>Print ({selectedProductIds.length})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePrintAllLabels}
                className="bg-purple-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-purple-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Print All</span>
              </button>
            )}

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
        <div className="hidden sm:grid grid-cols-4 gap-3 mb-4">
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
            className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${
              stockStatusFilter === 'low_stock' ? 'border-orange-500 bg-orange-50/60' : 'border-gray-200 hover:border-orange-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Low Stock (≤5)</p>
              {stockStatusFilter === 'low_stock' && <span className="text-[10px] text-orange-600 font-bold uppercase">Filtered</span>}
            </div>
            <p className="text-lg font-bold text-orange-600">{tabMetrics.lowStockCount}</p>
          </div>
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

        {/* COMPACT FILTERS & SEARCH (Matching Purchases.tsx filter pattern) */}
        <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">

            {/* Stock Status Filter Tags */}
            {[
              { key: 'all', label: 'All' },
              { key: 'in_stock', label: 'In Stock' },
              { key: 'low_stock', label: 'Low Stock' },
              { key: 'out_of_stock', label: 'Out of Stock' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setStockStatusFilter(s.key as any)}
                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${
                  stockStatusFilter === (s.key as any)
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

          {/* Selection Action Bar (when isSelectionMode) */}
          {isSelectionMode && (
            <div className="mt-2.5 pt-2.5 border-t border-purple-200 bg-purple-50 -mx-2 sm:-mx-3 -mb-2 sm:-mb-3 p-2.5 rounded-b-lg flex items-center justify-between text-xs">
              <span className="font-bold text-purple-900">
                {selectedProductIds.length} product(s) selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectCurrentPage}
                  className="px-2.5 py-1 bg-white border border-purple-300 text-purple-700 rounded font-semibold hover:bg-purple-100"
                >
                  {paginatedProducts.every(p => selectedProductIds.includes(p.id!)) ? 'Deselect Page' : 'Select Page'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProductIds(filteredProducts.map(p => p.id!).filter(Boolean))}
                  className="px-2.5 py-1 bg-white border border-purple-300 text-purple-700 rounded font-semibold hover:bg-purple-100"
                >
                  Select All ({filteredProducts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProductIds([])}
                  className="text-gray-600 hover:underline px-1"
                >
                  Clear Selection
                </button>
              </div>
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
                    onClick={() => !isSelectionMode && setSelectedProductForDetails(product)}
                    className={`bg-white rounded-lg shadow-sm border p-4 transition-shadow ${
                      isSelected ? 'border-purple-300 bg-purple-50/40 ring-1 ring-purple-300' : 'border-gray-200 hover:shadow-md'
                    } ${!isSelectionMode ? 'cursor-pointer' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {isSelectionMode && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleProductSelection(product.id!);
                          }}
                          className="mt-1 w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
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
                          <span className={`shrink-0 px-2 py-0.5 text-xs font-bold rounded-full ${
                            product.quantity <= 0
                              ? 'bg-red-100 text-red-700'
                              : product.quantity <= 5
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {product.quantity <= 0 ? 'Out of stock' : `${product.quantity} units`}
                          </span>
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
                              className="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition-colors"
                              title="Print Label"
                            >
                              <Printer className="w-4 h-4" />
                            </button>

                            {isOwnerOrAdmin && (
                              <>
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
                            checked={paginatedProducts.length > 0 && paginatedProducts.every(p => selectedProductIds.includes(p.id!))}
                            onChange={selectCurrentPage}
                            className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
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
                          onClick={() => !isSelectionMode && setSelectedProductForDetails(product)}
                          className={`hover:bg-gray-50 transition-colors ${
                            isSelected ? 'bg-purple-50/70' : ''
                          } ${!isSelectionMode ? 'cursor-pointer' : ''}`}
                        >
                          {/* Selection Checkbox */}
                          {isSelectionMode && (
                            <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleProductSelection(product.id!)}
                                className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
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
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              product.quantity <= 0
                                ? 'bg-red-100 text-red-700 border border-red-300'
                                : product.quantity <= 5
                                ? 'bg-orange-100 text-orange-700 border border-orange-300'
                                : 'bg-blue-100 text-blue-700 border border-blue-300'
                            }`}>
                              {product.quantity <= 0 ? 'Out of stock' : `${product.quantity} units`}
                            </span>
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
                                className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
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
                                    <CheckCircle className="h-4 w-4" />
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
                <div className={`border rounded-lg p-3 ${
                  selectedProductForDetails.quantity <= 5 ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'
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
                className="w-full bg-purple-600 text-white py-2.5 px-4 rounded-lg hover:bg-purple-700 font-semibold flex items-center justify-center gap-2 text-sm shadow-sm"
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

      {/* SINGLE PRINT LABEL MODAL */}
      {showPrintModal && productToPrint && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setShowPrintModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Printer className="h-5 w-5 text-purple-600" />
                  Print Product Labels
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Configure print quantity</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="bg-purple-50 p-3.5 rounded-xl border border-purple-200 mb-4 text-xs">
              <div className="font-bold text-gray-900 text-sm mb-1">{productToPrint.name}</div>
              <div className="flex justify-between text-purple-800">
                <span>Code: <strong className="font-mono">{productToPrint.productCode}</strong></span>
                <span>Stock: <strong>{productToPrint.quantity} units</strong></span>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              <label className="text-xs font-bold text-gray-700 block">Number of copies to print:</label>
              <input
                type="number"
                min="1"
                max="1000"
                value={printQuantity}
                onChange={(e) => setPrintQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-3 py-2 text-center font-bold text-base border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 5, 10, productToPrint.quantity || 1].map((v, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPrintQuantity(v)}
                    className="py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-700"
                  >
                    {i === 3 ? 'Match Stock' : v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-semibold text-xs hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPrintLabel}
                className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-1.5"
              >
                <Printer className="h-4 w-4" />
                Print {printQuantity}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK PRINT LABELS MODAL */}
      {showPrintAllModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setShowPrintAllModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Printer className="h-5 w-5 text-purple-600" />
                  Bulk Print Labels
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Configure copies for {selectedProductIds.length > 0 ? selectedProductIds.length : filteredProducts.length} product(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintAllModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-1 text-xs">
              {(selectedProductIds.length > 0
                ? filteredProducts.filter(p => selectedProductIds.includes(p.id!))
                : filteredProducts
              ).map(product => (
                <div key={product.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="min-w-0 pr-2">
                    <div className="font-bold text-gray-900 truncate">{product.name}</div>
                    <div className="text-gray-500 font-mono text-[11px]">Code: {product.productCode} • Stock: {product.quantity}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => updatePrintQuantity(product.id!, (printQuantities[product.id!] || 1) - 1)}
                      className="w-7 h-7 bg-gray-200 hover:bg-gray-300 rounded font-bold"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={printQuantities[product.id!] || 1}
                      onChange={(e) => updatePrintQuantity(product.id!, parseInt(e.target.value, 10) || 1)}
                      className="w-12 text-center py-1 border border-gray-300 rounded font-bold text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => updatePrintQuantity(product.id!, (printQuantities[product.id!] || 1) + 1)}
                      className="w-7 h-7 bg-gray-200 hover:bg-gray-300 rounded font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setShowPrintAllModal(false)}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-semibold text-xs hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPrintAllLabels}
                className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-xs font-bold text-white shadow-sm flex items-center justify-center gap-1.5"
              >
                <Printer className="h-4 w-4" />
                Print All Labels
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {showEditModal && productToEdit && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                  <Edit className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Edit Product</h3>
                  <p className="text-xs text-gray-500">Update catalog pricing and GST details</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="font-semibold text-gray-700 block mb-1">Product Name *</label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none font-semibold text-gray-900 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Brand *</label>
                  <input
                    type="text"
                    value={editFormData.brand}
                    onChange={(e) => setEditFormData({ ...editFormData, brand: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Model</label>
                  <input
                    type="text"
                    value={editFormData.model}
                    onChange={(e) => setEditFormData({ ...editFormData, model: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900"
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Category *</label>
                  <input
                    type="text"
                    value={editFormData.category}
                    onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Supplier</label>
                  <input
                    type="text"
                    value={editFormData.supplier}
                    onChange={(e) => setEditFormData({ ...editFormData, supplier: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900"
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Cost Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editFormData.cost}
                    onChange={(e) => setEditFormData({ ...editFormData, cost: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none font-bold text-gray-900"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Selling Price (MRP ₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editFormData.mrp}
                    onChange={(e) => setEditFormData({ ...editFormData, mrp: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none font-bold text-gray-900"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Stock Quantity *</label>
                  <input
                    type="number"
                    value={editFormData.quantity}
                    onChange={(e) => setEditFormData({ ...editFormData, quantity: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none font-bold text-gray-900"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">MOP (Optional ₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editFormData.mop}
                    onChange={(e) => setEditFormData({ ...editFormData, mop: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-gray-900"
                  />
                </div>
              </div>

              {/* GST Section */}
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                    <Receipt className="w-4 h-4 text-emerald-700" />
                    GST Invoicing Configuration
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editFormData.gstEnabled}
                      onChange={(e) => setEditFormData({ ...editFormData, gstEnabled: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded"
                    />
                    <span className="text-xs font-semibold text-emerald-900">
                      {editFormData.gstEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>

                {editFormData.gstEnabled && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200">
                    <div>
                      <label className="font-semibold text-emerald-900 block mb-1">Tax Slab</label>
                      <select
                        value={editFormData.taxPercent}
                        onChange={(e) => setEditFormData({ ...editFormData, taxPercent: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-emerald-300 rounded bg-white text-gray-900 font-semibold"
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
                        className="w-full px-2.5 py-1.5 border border-emerald-300 rounded bg-white font-mono text-gray-900"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                disabled={editLoading}
                className="flex-1 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={editLoading || !editFormData.name.trim()}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {editLoading ? 'Saving...' : 'Save Changes'}
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
