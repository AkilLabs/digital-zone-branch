import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import { 
  Search,
  Filter,
  Smartphone,
  DollarSign, Plus, Trash2, Save, 
  Check, ArrowRight, ArrowLeft, Clipboard, AlertCircle, X,
  CreditCard, Banknote, QrCode, Split, Calendar, FileText, UserPlus, Phone, Hash, Truck,
  ChevronLeft, ChevronRight, CheckCircle2, ShieldCheck, Package, Receipt, Eye, EyeOff
} from 'lucide-react';
import type { Purchase, PurchaseItem, Supplier, PaymentMode, PaymentSplit, Product, Brand, Category } from '../types';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, increment, Timestamp, orderBy, limit, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateIMEIProductCode } from '../utils/productCode';
import { syncStoreProducts } from '../utils/productSyncCache';
import { encodePrice, decodePrice } from '../utils/secretCode';
import { MultiStepLoader } from '../components/ui/multi-step-loader';
import SearchableSelect from '../components/SearchableSelect';
import * as XLSX from 'xlsx';

const getInitialItem = (defaultTax = 18): PurchaseItem => ({
  productName: '',
  brand: '',
  model: '',
  category: '',
  quantity: 1,
  costPerUnit: 0,
  totalCost: 0,
  mrp: 0,
  imei: '',
  hcsCode: '',
  mop: 0,
  taxPercent: defaultTax,
  highestDiscountLimit: 0
});

const AddPurchaseIMEI: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentHub } = useStore();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [originalPurchase, setOriginalPurchase] = useState<any>(null);
  const { showToast } = useToast();

  // 2-Step Flow INSIDE Product Units Container:
  // Step 1 = Product specifications & quantities (NO IMEI & NO HSN)
  // Step 2 = IMEI & HSN assignment for each unit (Non-editable product details)
  const [pageStep, setPageStep] = useState<1 | 2 | 3>(1);
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);

  // Global Tax Dropdown state (Default 18%)
  const [globalTaxPercent, setGlobalTaxPercent] = useState<number>(18);

  const handleGlobalTaxChange = (rate: number) => {
    setGlobalTaxPercent(rate);
    setItems(prev => prev.map(item => ({
      ...item,
      taxPercent: rate
    })));
  };

  // Toggle visibility of Product Name column (persisted in localStorage)
  const [showProductName, setShowProductName] = useState<boolean>(() => {
    const saved = localStorage.getItem('purchase_show_product_name');
    return saved !== null ? saved === 'true' : true;
  });

  const toggleProductName = () => {
    setShowProductName(prev => {
      const next = !prev;
      localStorage.setItem('purchase_show_product_name', String(next));
      return next;
    });
  };

  // Catalog Search Modal State (IMEI Products Only + Filters)
  const [isCatalogSearchOpen, setIsCatalogSearchOpen] = useState(false);
  const [catalogSearchText, setCatalogSearchText] = useState('');
  const [catalogSelectedBrand, setCatalogSelectedBrand] = useState<string>('all');
  const [catalogSelectedCategory, setCatalogSelectedCategory] = useState<string>('all');
  const [catalogProductsList, setCatalogProductsList] = useState<Product[]>([]);
  const [filteredCatalogProducts, setFilteredCatalogProducts] = useState<Product[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);

  const isIMEIProduct = (p: Product) => {
    if (p.imei && p.imei.trim().length > 0) return true;
    if (p.productCode) {
      const num = parseInt(p.productCode, 10);
      if (!isNaN(num) && num >= 10000001) return true;
    }
    if ((p as any).isIMEIPurchase === true) return true;
    return false;
  };

  const handleOpenCatalogSearch = async () => {
    setIsCatalogSearchOpen(true);
    setCatalogSearchText('');
    setCatalogSelectedBrand('all');
    setCatalogSelectedCategory('all');
    setCatalogSearching(true);
    try {
      const allProds = await syncStoreProducts(null);
      // Filter ONLY IMEI products
      const imeiOnly = allProds.filter(isIMEIProduct);
      setCatalogProductsList(imeiOnly);
      setFilteredCatalogProducts(imeiOnly.slice(0, 30));
    } catch (err) {
      console.error('Error fetching catalog products:', err);
    } finally {
      setCatalogSearching(false);
    }
  };

  const filterCatalogList = (
    text: string,
    brandFilter: string,
    catFilter: string,
    baseList: Product[] = catalogProductsList
  ) => {
    let list = baseList;
    if (brandFilter !== 'all') {
      list = list.filter(p => (p.brand || '').toLowerCase() === brandFilter.toLowerCase());
    }
    if (catFilter !== 'all') {
      list = list.filter(p => (p.category || '').toLowerCase() === catFilter.toLowerCase());
    }
    if (text.trim()) {
      const qLower = text.toLowerCase();
      list = list.filter(p => {
        const name = (p.name || '').toLowerCase();
        const b = (p.brand || '').toLowerCase();
        const m = (p.model || '').toLowerCase();
        const cat = (p.category || '').toLowerCase();
        const code = (p.productCode || '').toLowerCase();
        const imei = (p.imei || '').toLowerCase();
        return name.includes(qLower) || b.includes(qLower) || m.includes(qLower) || cat.includes(qLower) || code.includes(qLower) || imei.includes(qLower);
      });
    }
    setFilteredCatalogProducts(list.slice(0, 50));
  };

  const handleCatalogSearchChange = (text: string) => {
    setCatalogSearchText(text);
    filterCatalogList(text, catalogSelectedBrand, catalogSelectedCategory);
  };

  const handleCatalogBrandFilterChange = (brand: string) => {
    setCatalogSelectedBrand(brand);
    filterCatalogList(catalogSearchText, brand, catalogSelectedCategory);
  };

  const handleCatalogCategoryFilterChange = (cat: string) => {
    setCatalogSelectedCategory(cat);
    filterCatalogList(catalogSearchText, catalogSelectedBrand, cat);
  };

  const handleSelectProductIntoRow = (product: Product) => {
    setItems(prev => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const lastItem = updated[lastIdx];
      const isLastEmpty = !lastItem.brand && !lastItem.model && !lastItem.productName && (!lastItem.costPerUnit || lastItem.costPerUnit === 0);

      const pName = product.name || `${product.brand || ''} ${product.model || ''} ${product.category || ''}`.trim();
      const unitCost = Number(product.cost) || 0;
      const unitMrp = Number(product.mrp) || unitCost;

      const filledItem: PurchaseItem = {
        ...getInitialItem(),
        productName: pName,
        brand: product.brand || '',
        model: product.model || '',
        category: product.category || '',
        quantity: 1,
        costPerUnit: unitCost,
        totalCost: unitCost,
        mrp: unitMrp,
        mop: Number(product.mop) || 0,
        taxPercent: globalTaxPercent !== undefined ? globalTaxPercent : (Number(product.taxPercent) || 18),
        highestDiscountLimit: Number(product.highestDiscountLimit) || 0,
        hcsCode: (product as any).hcsCode || ''
      };

      let targetIdx = lastIdx;
      if (isLastEmpty && lastIdx >= 0) {
        updated[lastIdx] = filledItem;
      } else {
        updated.push(filledItem);
        targetIdx = updated.length - 1;
      }

      setTimeout(() => {
        // Focus quantity cell of the filled row
        document.getElementById(`cell-${targetIdx}-4`)?.focus();
      }, 70);

      return updated;
    });

    setIsCatalogSearchOpen(false);
    showToast(`Selected ${product.name || product.brand}`, 'success');
  };

  // Keyboard Navigation: Arrow Keys & Enter Key Row Creation
  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    rowIndex: number,
    colIndex: number
  ) => {
    const totalEditableCols = 8; // 0:Brand, 1:Model, 2:Category, 3:Product(skip), 4:Qty, 5:Cost, 6:MOP, 7:MRP

    if (e.key === 'ArrowUp') {
      if (rowIndex > 0) {
        e.preventDefault();
        const target = document.getElementById(`cell-${rowIndex - 1}-${colIndex}`);
        target?.focus();
      }
    } else if (e.key === 'ArrowDown') {
      if (rowIndex < items.length - 1) {
        e.preventDefault();
        const target = document.getElementById(`cell-${rowIndex + 1}-${colIndex}`);
        target?.focus();
      }
    } else if (e.key === 'ArrowLeft') {
      const input = e.target as HTMLInputElement;
      if (!input || (input.selectionStart === 0 && input.selectionEnd === 0)) {
        if (colIndex > 0) {
          e.preventDefault();
          const prevCol = (colIndex === 4) ? 2 : colIndex - 1; // skip non-editable productName (col 3)
          const target = document.getElementById(`cell-${rowIndex}-${prevCol}`);
          target?.focus();
        }
      }
    } else if (e.key === 'ArrowRight') {
      const input = e.target as HTMLInputElement;
      if (!input || (input.selectionStart === input.value.length)) {
        if (colIndex < totalEditableCols - 1) {
          e.preventDefault();
          const nextCol = (colIndex === 2) ? 4 : colIndex + 1; // skip non-editable productName (col 3)
          const target = document.getElementById(`cell-${rowIndex}-${nextCol}`);
          target?.focus();
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      const isShiftEnter = e.shiftKey;

      // Shift + Enter: Duplicate row data into a new row
      if (isShiftEnter) {
        const currentRow = items[rowIndex];
        const defaultTax = globalTaxPercent !== undefined ? globalTaxPercent : 18;
        const duplicatedRow: PurchaseItem = {
          ...getInitialItem(defaultTax),
          productName: currentRow?.productName || '',
          brand: currentRow?.brand || '',
          model: currentRow?.model || '',
          category: currentRow?.category || '',
          costPerUnit: Number(currentRow?.costPerUnit) || 0,
          totalCost: Number(currentRow?.costPerUnit) || 0,
          mrp: Number(currentRow?.mrp) || 0,
          hcsCode: currentRow?.hcsCode || '',
          mop: Number(currentRow?.mop) || 0,
          taxPercent: Number(currentRow?.taxPercent) || defaultTax,
          highestDiscountLimit: Number(currentRow?.highestDiscountLimit) || 0,
          quantity: 1
        };

        const newRowIndex = items.length;
        setItems(prev => [...prev, duplicatedRow]);
        setTimeout(() => {
          const nextTarget = document.getElementById(`cell-${newRowIndex}-0`);
          nextTarget?.focus();
        }, 70);
        return;
      }

      // Normal Enter:
      // If at the end of the row (MRP - col 7):
      if (colIndex === totalEditableCols - 1 || colIndex === 7) {
        if (rowIndex === items.length - 1) {
          // Add a brand new clean row WITHOUT DATA
          addItem(false);
          setTimeout(() => {
            const nextTarget = document.getElementById(`cell-${rowIndex + 1}-0`);
            nextTarget?.focus();
          }, 70);
        } else {
          // Jump to first field (Brand) of the next existing row
          const nextTarget = document.getElementById(`cell-${rowIndex + 1}-0`);
          nextTarget?.focus();
        }
      } else {
        // Move to next editable field in this row, skipping non-editable productName (col 3)
        const nextCol = (colIndex === 2) ? 4 : colIndex + 1;
        const nextCell = document.getElementById(`cell-${rowIndex}-${nextCol}`);
        nextCell?.focus();
      }
    }
  };


  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedSupplierName, setSelectedSupplierName] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseDate, setPurchaseDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    gstNumber: '',
    address: ''
  });

  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paidAmount, setPaidAmount] = useState('');

  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');

  const [items, setItems] = useState<PurchaseItem[]>([getInitialItem()]);

  // Step 2 IMEI and HSN mapping: productIndex -> array of units [{ imei, hcsCode }]
  const [imeiData, setImeiData] = useState<{ [productIndex: number]: Array<{ imei: string; hcsCode: string }> }>({});
  const [bulkPasteModal, setBulkPasteModal] = useState<{ productIndex: number; text: string } | null>(null);
  const [globalHcsCode, setGlobalHcsCode] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [multiStepLoading, setMultiStepLoading] = useState(false);
  const [loadingStates, setLoadingStates] = useState<Array<{ text: string }>>([]);

  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const importFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; field: string; value: string } | null>(null);
  const [, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchDebounceRef = useRef<number | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; top: number; width: number } | null>(null);

  const resetForm = () => {
    setSelectedSupplierId('');
    setSelectedSupplierName('');

    setInvoiceNumber('');
    setNotes('');
    setPaymentMode('cash');
    setPaidAmount('');
    setCashAmount('');
    setUpiAmount('');
    setCardAmount('');
    setItems([getInitialItem()]);
    setImeiData({});
    setPageStep(1);
    setCurrentStep(1);
  };

  const getEnsuredImeiData = (
    currentItems: PurchaseItem[],
    prevData?: { [pIndex: number]: Array<{ imei: string; hcsCode: string }> }
  ) => {
    const nextData: { [pIndex: number]: Array<{ imei: string; hcsCode: string }> } = {};

    currentItems.forEach((item, pIndex) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const existingUnits = (prevData && prevData[pIndex]) || [];
      const units: Array<{ imei: string; hcsCode: string }> = [];

      for (let u = 0; u < qty; u++) {
        if (existingUnits[u]) {
          units.push({
            imei: existingUnits[u].imei || '',
            hcsCode: existingUnits[u].hcsCode || item.hcsCode || ''
          });
        } else {
          units.push({
            imei: (u === 0 && item.imei) ? item.imei : '',
            hcsCode: item.hcsCode || ''
          });
        }
      }
      nextData[pIndex] = units;
    });

    return nextData;
  };

  // Immediate switch to Step 2 without pre-blocking
  const handleProceedToStep2 = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setImeiData(prev => getEnsuredImeiData(items, prev));
    setCurrentStep(2);
  };

  const handleUnitImeiChange = (productIndex: number, unitIndex: number, value: string) => {
    const clean = value.toUpperCase();
    setImeiData(prev => {
      const currentUnits = [...(prev[productIndex] || [])];
      currentUnits[unitIndex] = {
        ...(currentUnits[unitIndex] || { imei: '', hcsCode: '' }),
        imei: clean
      };
      return {
        ...prev,
        [productIndex]: currentUnits
      };
    });
  };

  const handleUnitHcsChange = (productIndex: number, unitIndex: number, value: string) => {
    const clean = value.toUpperCase();
    setImeiData(prev => {
      const currentUnits = [...(prev[productIndex] || [])];
      currentUnits[unitIndex] = {
        ...(currentUnits[unitIndex] || { imei: '', hcsCode: '' }),
        hcsCode: clean
      };
      return {
        ...prev,
        [productIndex]: currentUnits
      };
    });
  };

  const applyHcsToProductUnits = (productIndex: number, code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) {
      showToast('Enter an HSN/HCS code first', 'error');
      return;
    }
    setImeiData(prev => {
      const currentUnits = (prev[productIndex] || []).map(u => ({
        ...u,
        hcsCode: clean
      }));
      return {
        ...prev,
        [productIndex]: currentUnits
      };
    });
    showToast('Applied HSN code to product units', 'success');
  };

  const applyHcsToAllUnits = (code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) {
      showToast('Enter an HSN/HCS code first', 'error');
      return;
    }
    setImeiData(prev => {
      const nextData: { [pIndex: number]: Array<{ imei: string; hcsCode: string }> } = {};
      Object.keys(prev).forEach(key => {
        const pIdx = Number(key);
        nextData[pIdx] = (prev[pIdx] || []).map(u => ({
          ...u,
          hcsCode: clean
        }));
      });
      return nextData;
    });
    showToast('Applied HSN code to all units across all products', 'success');
  };

  const handleBulkPasteApply = () => {
    if (!bulkPasteModal) return;
    const { productIndex, text } = bulkPasteModal;
    const rawImeis = text
      .split(/[\r\n,;\t\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (rawImeis.length === 0) {
      showToast('No IMEIs detected in pasted text', 'error');
      return;
    }

    setImeiData(prev => {
      const currentUnits = [...(prev[productIndex] || [])];
      rawImeis.forEach((imei, idx) => {
        if (idx < currentUnits.length) {
          currentUnits[idx] = {
            ...(currentUnits[idx] || { imei: '', hcsCode: '' }),
            imei
          };
        }
      });
      return {
        ...prev,
        [productIndex]: currentUnits
      };
    });

    showToast(`Applied ${Math.min(rawImeis.length, (imeiData[productIndex] || []).length)} IMEI(s)`, 'success');
    setBulkPasteModal(null);
  };

  const getDuplicateImeiInfo = () => {
    const imeiCounts = new Map<string, number>();

    items.forEach((_, pIndex) => {
      const units = imeiData[pIndex] || [];
      units.forEach(u => {
        const val = u.imei?.trim();
        if (!val) return;
        imeiCounts.set(val, (imeiCounts.get(val) || 0) + 1);
      });
    });

    const duplicates = new Set<string>();
    imeiCounts.forEach((count, val) => {
      if (count > 1) {
        duplicates.add(val);
      }
    });

    return { duplicates };
  };

  const getOverallUnitIndex = (targetPIndex: number, targetUIndex: number) => {
    let index = 0;
    for (let p = 0; p < targetPIndex; p++) {
      index += Math.max(1, Number(items[p]?.quantity) || 1);
    }
    return index + targetUIndex;
  };

  const handleStep2ImeiKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, pIndex: number, uIndex: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const currentOverall = getOverallUnitIndex(pIndex, uIndex);
      const nextInput = document.querySelector(`[data-overall-idx="${currentOverall + 1}"]`) as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      } else {
        const saveBtn = document.getElementById('verify-save-btn');
        saveBtn?.focus();
      }
    }
  };

  useEffect(() => {
    fetchBrandsAndCategories();
    fetchSuppliers();

    if (isEditMode) {
      fetchPurchaseForEdit();
    } else {
      const savedDraft = localStorage.getItem('addPurchaseIMEIDraft');
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft);
          if (draft.selectedSupplierId && draft.selectedSupplierId !== 'hq-hub') setSelectedSupplierId(draft.selectedSupplierId);
          if (draft.selectedSupplierName && draft.selectedSupplierName !== 'HQ Central Hub') setSelectedSupplierName(draft.selectedSupplierName);
          if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber);
          if (draft.notes) setNotes(draft.notes);
          if (draft.paymentMode) setPaymentMode(draft.paymentMode);
          if (draft.paidAmount) setPaidAmount(draft.paidAmount);
          if (draft.cashAmount) setCashAmount(draft.cashAmount);
          if (draft.upiAmount) setUpiAmount(draft.upiAmount);
          if (draft.cardAmount) setCardAmount(draft.cardAmount);
          if (draft.pageStep) setPageStep(draft.pageStep);
          if (draft.currentStep) setCurrentStep(draft.currentStep);
          if (draft.imeiData) setImeiData(draft.imeiData);
          if (draft.items && draft.items.length > 0) {
            setItems(
              (draft.items as PurchaseItem[]).map((item) => ({
                ...getInitialItem(),
                ...item,
                quantity: Math.max(1, Number(item.quantity) || 1),
                costPerUnit: Number(item.costPerUnit) || 0,
                totalCost: Number(item.totalCost) || Number(item.costPerUnit) || 0,
                mrp: Number(item.mrp) || 0,
                imei: item.imei || '',
                hcsCode: item.hcsCode || '',
                mop: Number(item.mop) || 0,
                taxPercent: Number(item.taxPercent) || 0,
                highestDiscountLimit: Number(item.highestDiscountLimit) || 0
              }))
            );
          }
        } catch (e) {
          console.error('Failed to parse draft from localStorage', e);
        }
      }
    }
  }, []);

  const fetchPurchaseForEdit = async () => {
    if (!id) return;
    try {
      let docRef = getDocRef('imeiPurchases', id);
      let docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        const rootImei = doc(db, 'imeiPurchases', id);
        const rootImeiSnap = await getDoc(rootImei);
        if (rootImeiSnap.exists()) {
          docRef = rootImei;
          docSnap = rootImeiSnap;
        } else {
          docRef = getDocRef('purchases', id);
          const legacyStoreSnap = await getDoc(docRef);
          if (legacyStoreSnap.exists()) {
            docSnap = legacyStoreSnap;
          } else {
            docRef = doc(db, 'purchases', id);
            docSnap = await getDoc(docRef);
          }
        }
      }

      if (docSnap.exists()) {
        const data = docSnap.data();
        setOriginalPurchase({ id: docSnap.id, ...data });
        setSelectedSupplierId(data.supplierId || 'hq-hub');
        setSelectedSupplierName(data.supplierName || 'HQ Central Hub');
        setInvoiceNumber(data.invoiceNumber || '');
        setNotes(data.notes || '');
        setPaymentMode(data.paymentMode || 'cash');
        setPaidAmount(data.paidAmount ? String(data.paidAmount) : '');
        
        if (data.paymentSplit) {
          setCashAmount(data.paymentSplit.cash ? String(data.paymentSplit.cash) : '');
          setUpiAmount(data.paymentSplit.upi ? String(data.paymentSplit.upi) : '');
          setCardAmount(data.paymentSplit.card ? String(data.paymentSplit.card) : '');
        }

        if (data.items && data.items.length > 0) {
          const rawItems: any[] = data.items;
          const groupMap = new Map<string, { item: PurchaseItem; units: Array<{ imei: string; hcsCode: string }> }>();

          rawItems.forEach(it => {
            const key = `${it.productName || ''}_${it.brand || ''}_${it.model || ''}_${it.category || ''}_${it.costPerUnit || it.baseCost || 0}_${it.mrp || 0}_${it.taxPercent || 0}`;
            const unitCost = Number(it.baseCost || it.costPerUnit) || 0;
            if (!groupMap.has(key)) {
              groupMap.set(key, {
                item: {
                  ...getInitialItem(),
                  productName: it.productName || '',
                  brand: it.brand || '',
                  model: it.model || '',
                  category: it.category || '',
                  quantity: Number(it.quantity) || 1,
                  costPerUnit: unitCost,
                  totalCost: unitCost * (Number(it.quantity) || 1),
                  mrp: Number(it.mrp) || 0,
                  mop: Number(it.mop) || 0,
                  taxPercent: Number(it.taxPercent) || 0,
                  highestDiscountLimit: Number(it.highestDiscountLimit) || 0,
                  hcsCode: it.hcsCode || ''
                },
                units: [{ imei: it.imei || '', hcsCode: it.hcsCode || '' }]
              });
            } else {
              const g = groupMap.get(key)!;
              g.item.quantity += (Number(it.quantity) || 1);
              g.item.totalCost = unitCost * g.item.quantity;
              g.units.push({ imei: it.imei || '', hcsCode: it.hcsCode || '' });
            }
          });

          const newItems: PurchaseItem[] = [];
          const newImeiData: { [pIndex: number]: Array<{ imei: string; hcsCode: string }> } = {};

          Array.from(groupMap.values()).forEach((g, idx) => {
            newItems.push(g.item);
            newImeiData[idx] = g.units;
          });

          setItems(newItems.length > 0 ? newItems : [getInitialItem()]);
          setImeiData(newImeiData);
        }
      }
    } catch (error) {
      console.error('Error fetching purchase:', error);
      showToast('Failed to load purchase for editing', 'error');
    }
  };

  useEffect(() => {
    if (isEditMode) return;
    const draftData = {
      selectedSupplierId,
      selectedSupplierName,
      invoiceNumber,
      notes,
      paymentMode,
      paidAmount,
      cashAmount,
      upiAmount,
      cardAmount,
      items,
      imeiData,
      pageStep,
      currentStep,
      savedAt: new Date().toISOString()
    };

    if (items.some((item) => item.productName || item.brand || item.model)) {
      localStorage.setItem('addPurchaseIMEIDraft', JSON.stringify(draftData));
      setLastSaved(new Date().toLocaleTimeString());
    }
  }, [
    selectedSupplierId,
    selectedSupplierName,
    invoiceNumber,
    notes,
    paymentMode,
    paidAmount,
    cashAmount,
    upiAmount,
    cardAmount,
    items,
    imeiData,
    currentStep
  ]);

  const clearDraft = () => {
    localStorage.removeItem('addPurchaseIMEIDraft');
    setLastSaved(null);
    resetForm();
    showToast('Draft cleared', 'info');
  };

  const fetchBrandsAndCategories = async () => {
    try {
      const brandsSnapshot = await getDocs(query(collection(db, 'brands'), orderBy('name', 'asc')));
      setBrands(brandsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand)));

      const categoriesSnapshot = await getDocs(query(collection(db, 'categories'), orderBy('name', 'asc')));
      setCategories(categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    } catch (error) {
      console.error('Error fetching brands/categories:', error);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const suppliersSnapshot = await getDocs(query(collection(db, 'suppliers'), orderBy('name', 'asc')));
      const list = suppliersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
      setSuppliers(list);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  const handleAddNewSupplier = async () => {
    if (!supplierForm.name.trim()) {
      showToast('Please enter supplier name', 'error');
      return;
    }
    try {
      const ref = await addDoc(collection(db, 'suppliers'), {
        name: supplierForm.name.trim(),
        contactPerson: supplierForm.contactPerson.trim(),
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim(),
        gstNumber: supplierForm.gstNumber.trim().toUpperCase(),
        address: supplierForm.address.trim(),
        totalPurchaseAmount: 0,
        totalPaid: 0,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || ''
      });
      const newSup: Supplier = {
        id: ref.id,
        name: supplierForm.name.trim(),
        contactPerson: supplierForm.contactPerson.trim(),
        phone: supplierForm.phone.trim(),
        email: supplierForm.email.trim(),
        gstNumber: supplierForm.gstNumber.trim().toUpperCase(),
        address: supplierForm.address.trim(),
        totalPurchaseAmount: 0,
        totalPaid: 0,
        totalPending: 0,
        isActive: true,
        createdAt: new Date(),
        createdBy: currentUser?.uid || ''
      };
      setSuppliers(prev => [...prev, newSup].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSupplierId(ref.id);
      setSelectedSupplierName(newSup.name);
      setShowSupplierModal(false);
      setSupplierForm({ name: '', contactPerson: '', phone: '', email: '', gstNumber: '', address: '' });
      showToast(`Supplier "${newSup.name}" added successfully`, 'success');
    } catch (err) {
      console.error('Error adding supplier:', err);
      showToast('Failed to create supplier', 'error');
    }
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: any) => {
    const newItems = [...items];
    let processedValue = value;
    if (typeof value === 'string' && ['brand', 'model', 'category', 'hcsCode'].includes(field)) {
      processedValue = value.toUpperCase();
    }
    if (field === 'taxPercent') {
      processedValue = Number(value) || 0;
    }
    newItems[index] = {
      ...newItems[index],
      [field]: processedValue
    };

    if (field === 'costPerUnit' || field === 'quantity') {
      const cost = Number(newItems[index].costPerUnit) || 0;
      const qty = Math.max(1, Number(newItems[index].quantity) || 1);
      newItems[index].totalCost = cost * qty;
    }

    if (field === 'brand' || field === 'model' || field === 'category') {
      const b = newItems[index].brand || '';
      const m = newItems[index].model || '';
      const cat = newItems[index].category || '';
      newItems[index].productName = `${b} ${m} ${cat}`.trim();
    }
    setItems(newItems);
  };

  const searchProducts = async (queryText: string) => {
    if (!queryText.trim()) {
      setSearchResults([]);
      setIsDropdownOpen(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const products = await syncStoreProducts(null);
      const qLower = queryText.toLowerCase();

      const filtered = products.filter(product => {
        const name = (product.name || '').toLowerCase();
        const brand = (product.brand || '').toLowerCase();
        const model = (product.model || '').toLowerCase();
        const category = (product.category || '').toLowerCase();
        const code = (product.productCode || '').toLowerCase();
        const imei = (product.imei || '').toLowerCase();

        return name.includes(qLower) || brand.includes(qLower) || model.includes(qLower) || category.includes(qLower) || code.includes(qLower) || imei.includes(qLower);
      }).slice(0, 10);

      setSearchResults(filtered);
      setIsDropdownOpen(filtered.length > 0);
    } catch (error) {
      console.error('Error searching products:', error);
      showToast('Failed to search products', 'error');
    } finally {
      setSearching(false);
    }
  };
  void searchProducts;

  const selectProduct = (product: Product, rowIndex: number) => {
    const currentItem = items[rowIndex];
    const qty = Math.max(1, Number(currentItem.quantity) || 1);

    const selectedRow: PurchaseItem = {
      ...currentItem,
      productName: product.name || '',
      brand: product.brand || '',
      model: product.model || '',
      category: product.category || '',
      costPerUnit: Number(product.cost) || 0,
      mrp: Number(product.mrp) || Number(product.cost) || 0,
      mop: Number(product.mop) || 0,
      taxPercent: Number(product.taxPercent) || 0,
      highestDiscountLimit: Number(product.highestDiscountLimit) || 0,
      quantity: qty,
      totalCost: (Number(product.cost) || 0) * qty,
      hcsCode: (product as any).hcsCode || currentItem.hcsCode || ''
    };

    const newItems = [...items];
    newItems[rowIndex] = selectedRow;
    setItems(newItems);
    setSelectedRowIndex(rowIndex);
    setSearchQuery(product.name || '');
    setIsDropdownOpen(false);
    setSearchResults([]);
  };

  const computeDropdownPosition = () => {
    const anchor = searchContainerRef.current;
    if (!anchor) {
      setDropdownPosition(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 16;
    const desiredWidth = Math.max(rect.width, 520);
    const maxAllowedWidth = Math.max(320, window.innerWidth - viewportPadding * 2);
    const width = Math.min(desiredWidth, maxAllowedWidth);
    const left = Math.min(Math.max(viewportPadding, rect.left), Math.max(viewportPadding, window.innerWidth - width - viewportPadding));

    setDropdownPosition({
      left,
      top: rect.bottom + 4,
      width
    });
  };

  useEffect(() => {
    if (!isDropdownOpen) return;

    computeDropdownPosition();

    const handler = (event: MouseEvent) => {
      const container = searchContainerRef.current;
      const dropdown = dropdownRef.current;
      if (container && container.contains(event.target as Node)) return;
      if (dropdown && dropdown.contains(event.target as Node)) return;
      setIsDropdownOpen(false);
      setSelectedRowIndex(null);
      setDropdownPosition(null);
    };

    const updatePosition = () => computeDropdownPosition();

    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isDropdownOpen]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const addItem = (duplicateLast = false) => {
    const defaultTax = globalTaxPercent !== undefined ? globalTaxPercent : 18;
    if (duplicateLast && items.length > 0) {
      const lastItem = items[items.length - 1];
      setItems(prev => [
        ...prev,
        {
          ...getInitialItem(defaultTax),
          productName: lastItem?.productName || '',
          brand: lastItem?.brand || '',
          model: lastItem?.model || '',
          category: lastItem?.category || '',
          costPerUnit: Number(lastItem?.costPerUnit) || 0,
          totalCost: Number(lastItem?.costPerUnit) || 0,
          mrp: Number(lastItem?.mrp) || 0,
          hcsCode: lastItem?.hcsCode || '',
          mop: Number(lastItem?.mop) || 0,
          taxPercent: Number(lastItem?.taxPercent) || defaultTax,
          highestDiscountLimit: Number(lastItem?.highestDiscountLimit) || 0,
          quantity: 1
        }
      ]);
    } else {
      // Clean empty new row without data
      setItems(prev => [
        ...prev,
        getInitialItem(defaultTax)
      ]);
    }
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
    setImeiData(prev => {
      const nextData: { [pIndex: number]: Array<{ imei: string; hcsCode: string }> } = {};
      let nextIdx = 0;
      for (let i = 0; i < items.length; i++) {
        if (i !== index) {
          nextData[nextIdx] = prev[i] || [];
          nextIdx++;
        }
      }
      return nextData;
    });
  };

  const calculateTotals = () => {
    const totalQuantity = items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
    const baseAmount = items.reduce((sum, item) => {
      const cost = Number(item.costPerUnit) || 0;
      const qty = Math.max(1, Number(item.quantity) || 1);
      return sum + (cost * qty);
    }, 0);
    const totalAmount = items.reduce((sum, item) => {
      const cost = Number(item.costPerUnit) || 0;
      const qty = Math.max(1, Number(item.quantity) || 1);
      const baseCost = cost * qty;
      const tax = Number(item.taxPercent) || 0;
      return sum + baseCost + (baseCost * tax / 100);
    }, 0);
    const totalGstAmount = Math.max(0, totalAmount - baseAmount);
    return { totalQuantity, totalAmount, baseAmount, totalGstAmount };
  };

  const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase();

  const getCellValue = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of Object.keys(row)) {
      if (keys.includes(normalizeHeader(key))) {
        return row[key];
      }
    }
    return undefined;
  };

  const toText = (value: unknown) => String(value ?? '').trim();

  const toNumber = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = parseFloat(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const exportToExcel = () => {
    try {
      const { totalQuantity, totalAmount } = calculateTotals();
      const paid = paymentMode === 'credit' ? 0 : (parseFloat(paidAmount) || 0);
      const pending = totalAmount - paid;

      const summaryRows = [
        { Field: 'Supplier/Origin', Value: selectedSupplierName || '' },
        { Field: 'Supplier ID', Value: selectedSupplierId || '' },
        { Field: 'Invoice Number', Value: invoiceNumber || '' },
        { Field: 'Notes', Value: notes || '' },
        { Field: 'Payment Mode', Value: paymentMode },
        { Field: 'Paid Amount', Value: paid },
        { Field: 'Pending Amount', Value: pending },
        { Field: 'Total Quantity', Value: totalQuantity },
        { Field: 'Total Amount', Value: totalAmount }
      ];

      const ensuredImei = getEnsuredImeiData(items, imeiData);
      const itemRows: any[] = [];
      let overallUnit = 1;

      items.forEach((item, pIndex) => {
        const qty = Math.max(1, Number(item.quantity) || 1);
        const units = ensuredImei[pIndex] || [];
        const cost = Number(item.costPerUnit) || 0;
        const tax = Number(item.taxPercent) || 0;
        const costWithGst = cost + (cost * tax / 100);

        for (let u = 0; u < qty; u++) {
          const unit = units[u] || { imei: '', hcsCode: '' };
          itemRows.push({
            '#': overallUnit++,
            'Product Name': item.productName || `${item.brand} ${item.model} ${item.category}`.trim(),
            'Brand': item.brand,
            'Model': item.model,
            'Category': item.category,
            'IMEI': unit.imei || '',
            'HCS Code': unit.hcsCode || item.hcsCode || '',
            'Quantity': 1,
            'Cost/Unit': cost,
            'Tax %': tax,
            'Cost+GST/Unit': costWithGst,
            'MRP': item.mrp || 0,
            'MOP': item.mop || 0
          });
        }
      });

      const wb = XLSX.utils.book_new();
      const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
      const itemsWs = XLSX.utils.json_to_sheet(itemRows);

      XLSX.utils.book_append_sheet(wb, summaryWs, 'Purchase Summary');
      XLSX.utils.book_append_sheet(wb, itemsWs, 'Units with IMEI');

      const datePart = new Date().toISOString().split('T')[0];
      const supplierPart = (selectedSupplierName || 'imei_purchase').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      XLSX.writeFile(wb, `imei_purchase_${supplierPart}_${datePart}.xlsx`);
      showToast('Exported purchase Excel successfully', 'success');
    } catch (error) {
      console.error('Error exporting IMEI purchase to Excel:', error);
      showToast('Failed to export Excel file', 'error');
    }
  };

  const importFromExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const summarySheetName = workbook.SheetNames.find(name => normalizeHeader(name) === 'purchase summary');
      const itemsSheetName = workbook.SheetNames.find(name => normalizeHeader(name).includes('item') || normalizeHeader(name).includes('unit')) || workbook.SheetNames[0];

      if (!itemsSheetName) {
        showToast('No items sheet found in the Excel file', 'error');
        return;
      }

      if (summarySheetName) {
        const summaryRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[summarySheetName], { defval: '' });
        const summaryMap = new Map(summaryRows.map(row => [normalizeHeader(row.Field), row.Value]));

        const invoice = toText(summaryMap.get('invoice number'));
        const noteValue = toText(summaryMap.get('notes'));
        const payment = toText(summaryMap.get('payment mode')).toLowerCase() as PaymentMode;
        const paid = toText(summaryMap.get('paid amount'));
        const cash = toText(summaryMap.get('cash amount'));
        const upi = toText(summaryMap.get('upi amount'));
        const card = toText(summaryMap.get('card amount'));

        if (invoice) setInvoiceNumber(invoice);
        if (noteValue) setNotes(noteValue);
        if (payment) setPaymentMode(payment);
        if (paid) setPaidAmount(paid);
        if (cash) setCashAmount(cash);
        if (upi) setUpiAmount(upi);
        if (card) setCardAmount(card);
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[itemsSheetName], { defval: '' });
      if (rows.length === 0) {
        showToast('No purchase items found in the Excel file', 'error');
        return;
      }

      const groupMap = new Map<string, { item: PurchaseItem; units: Array<{ imei: string; hcsCode: string }> }>();

      rows.forEach(row => {
        const brand = toText(getCellValue(row, ['brand'])).toUpperCase();
        const model = toText(getCellValue(row, ['model'])).toUpperCase();
        const category = toText(getCellValue(row, ['category'])).toUpperCase();
        const imei = toText(getCellValue(row, ['imei'])).toUpperCase();
        const hcsCode = toText(getCellValue(row, ['hcs code', 'hcscode', 'hsn code', 'hsn'])).toUpperCase();
        const productName = toText(getCellValue(row, ['product name', 'name'])) || `${brand} ${model} ${category}`.trim() || 'IMPORTED ITEM';
        const costPerUnit = toNumber(getCellValue(row, ['cost/unit', 'cost per unit', 'cost']));
        const mrp = toNumber(getCellValue(row, ['mrp']));
        const mop = toNumber(getCellValue(row, ['mop']));
        const taxPercent = toNumber(getCellValue(row, ['tax %', 'tax', 'tax percent']));
        const highestDiscountLimit = toNumber(getCellValue(row, ['highest discount limit', 'discount limit']));
        const rowQty = Math.max(1, toNumber(getCellValue(row, ['qty', 'quantity'])) || 1);

        const key = `${productName}_${brand}_${model}_${category}_${costPerUnit}_${mrp}_${taxPercent}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            item: {
              ...getInitialItem(),
              productName,
              brand,
              model,
              category,
              quantity: rowQty,
              costPerUnit,
              totalCost: costPerUnit * rowQty,
              mrp: mrp > 0 ? mrp : costPerUnit,
              mop,
              taxPercent,
              highestDiscountLimit,
              hcsCode
            },
            units: imei ? [{ imei, hcsCode }] : []
          });
        } else {
          const g = groupMap.get(key)!;
          g.item.quantity += rowQty;
          g.item.totalCost = costPerUnit * g.item.quantity;
          if (imei) {
            g.units.push({ imei, hcsCode });
          }
        }
      });

      const importedItems: PurchaseItem[] = [];
      const newImeiData: { [pIndex: number]: Array<{ imei: string; hcsCode: string }> } = {};

      Array.from(groupMap.values()).forEach((g, idx) => {
        importedItems.push(g.item);
        newImeiData[idx] = g.units;
      });

      setItems(importedItems.length > 0 ? importedItems : [getInitialItem()]);
      setImeiData(newImeiData);
      showToast(`Imported ${rows.length} row(s) from Excel`, 'success');
    } catch (error) {
      console.error('Error importing IMEI Excel file:', error);
      showToast('Failed to import Excel file', 'error');
    }
  };

  const generatePurchaseNumber = async () => {
    try {
      const imeiPurchasesRef = getCollectionRef('imeiPurchases');
      const purchasesRef = getCollectionRef('purchases');
      
      let snapshot = await getDocs(query(imeiPurchasesRef, orderBy('createdAt', 'desc'), limit(20)));
      if (snapshot.empty) {
        snapshot = await getDocs(query(purchasesRef, orderBy('createdAt', 'desc'), limit(50)));
      }

      let nextNumber = 1;
      if (!snapshot.empty) {
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data() as Purchase;
          const purchaseNum = data.purchaseNumber || '';
          const match = purchaseNum.match(/\d+$/);
          if (match) {
            const lastNum = parseInt(match[0], 10);
            if (!isNaN(lastNum)) {
              nextNumber = lastNum + 1;
              break;
            }
          }
        }
      }

      let candidateNumber = nextNumber;
      let isUsed = true;
      while (isUsed) {
        const candidateId = `PUR-IMEI-${String(candidateNumber).padStart(4, '0')}`;
        const checkQ = query(imeiPurchasesRef, where('purchaseNumber', '==', candidateId));
        const checkSnap = await getDocs(checkQ);

        if (!checkSnap.empty) {
          candidateNumber++;
          continue;
        }
        const checkLegacySnap = await getDocs(query(purchasesRef, where('purchaseNumber', '==', candidateId)));
        if (!checkLegacySnap.empty) {
          candidateNumber++;
          continue;
        }
        isUsed = false;
        return candidateId;
      }

      return `PUR-IMEI-${String(candidateNumber).padStart(4, '0')}`;
    } catch (error) {
      console.error('Error generating purchase number:', error);
      return `PUR-IMEI-${Date.now()}`;
    }
  };

  // Comprehensive validation when submitting/saving the purchase
  const validateForSave = () => {
    

    if (items.length === 0) {
      showToast('Please add at least one product unit', 'error');
      setCurrentStep(1);
      return false;
    }

    // Check basic product details
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.brand?.trim()) {
        showToast(`Product #${i + 1}: Please select a Brand`, 'error');
        setPageStep(2);
        setCurrentStep(1);
        return false;
      }
      if (!item.category?.trim()) {
        showToast(`Product #${i + 1}: Please select a Category`, 'error');
        setPageStep(2);
        setCurrentStep(1);
        return false;
      }
      if (Number(item.costPerUnit) <= 0) {
        showToast(`Product #${i + 1}: Cost per unit must be greater than 0`, 'error');
        setPageStep(2);
        setCurrentStep(1);
        return false;
      }
    }

    // Check IMEIs for every unit
    const ensuredImei = getEnsuredImeiData(items, imeiData);
    for (let pIdx = 0; pIdx < items.length; pIdx++) {
      const item = items[pIdx];
      const qty = Math.max(1, Number(item.quantity) || 1);
      const units = ensuredImei[pIdx] || [];

      for (let uIdx = 0; uIdx < qty; uIdx++) {
        const imeiVal = units[uIdx]?.imei?.trim();
        if (!imeiVal) {
          showToast(`Unit #${uIdx + 1} of "${item.productName || item.brand}" is missing an IMEI`, 'error');
          setPageStep(2);
          setCurrentStep(2);
          setTimeout(() => {
            const inputEl = document.querySelector(`[data-overall-idx="${getOverallUnitIndex(pIdx, uIdx)}"]`) as HTMLInputElement | null;
            inputEl?.focus();
          }, 100);
          return false;
        }
      }
    }

    const { duplicates } = getDuplicateImeiInfo();
    if (duplicates.size > 0) {
      const dup = Array.from(duplicates)[0];
      showToast(`Duplicate IMEI "${dup}" found in this purchase! Each unit must have a unique IMEI.`, 'error');
      setPageStep(2);
      setCurrentStep(2);
      return false;
    }

    if (paymentMode === 'split') {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;
      const paid = parseFloat(paidAmount) || 0;

      if (Math.abs((cash + upi + card) - paid) > 0.009) {
        showToast('Payment split amounts must equal paid amount', 'error');
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // If currently in Step 2 sub-step 1, clicking Save prompts them to enter IMEIs in Step 2
    if (pageStep === 2 && currentStep === 1) {
      setImeiData(prev => getEnsuredImeiData(items, prev));
      setCurrentStep(2);
      showToast('Please assign IMEIs in Step 2 to verify and complete purchase', 'info');
      return;
    }

    if (!validateForSave()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const { totalQuantity, totalAmount, baseAmount, totalGstAmount } = calculateTotals();
      const paid = paymentMode === 'credit' ? 0 : (parseFloat(paidAmount) || 0);
      const pending = totalAmount - paid;

      let paymentStatus: 'paid' | 'pending' | 'unpaid' = 'unpaid';
      if (paid >= totalAmount && totalAmount > 0) {
        paymentStatus = 'paid';
      } else if (paid > 0) {
        paymentStatus = 'pending';
      }

      let paymentSplit: PaymentSplit | undefined;
      if (paymentMode === 'split') {
        const cash = parseFloat(cashAmount) || 0;
        const upi = parseFloat(upiAmount) || 0;
        const card = parseFloat(cardAmount) || 0;
        paymentSplit = { cash, upi, card };
      }

      const purchaseNumber = await generatePurchaseNumber();

      const flattenedUnits: Array<PurchaseItem & { imei: string; hcsCode: string }> = [];

      items.forEach((item, pIdx) => {
        const qty = Math.max(1, Number(item.quantity) || 1);
        const units = imeiData[pIdx] || [];
        const cost = Number(item.costPerUnit) || 0;
        const tax = Number(item.taxPercent) || 0;
        const costWithGst = cost + (cost * tax / 100);

        for (let uIdx = 0; uIdx < qty; uIdx++) {
          const u = units[uIdx] || { imei: '', hcsCode: '' };
          flattenedUnits.push({
            ...item,
            quantity: 1,
            costPerUnit: costWithGst,
            baseCost: cost,
            totalCost: costWithGst,
            mrp: Number(item.mrp) || costWithGst,
            mop: Number(item.mop) || 0,
            taxPercent: tax,
            gstEnabled: tax > 0,
            highestDiscountLimit: Number(item.highestDiscountLimit) || 0,
            imei: u.imei.trim(),
            hcsCode: u.hcsCode.trim() || item.hcsCode || ''
          });
        }
      });

      let nextProductCodeNumber: number | null = null;
      const generatedProductCodes: string[] = [];
      for (let index = 0; index < flattenedUnits.length; index++) {
        const origItem = (isEditMode && originalPurchase?.items && originalPurchase.items[index]) ? originalPurchase.items[index] : null;
        if (origItem && origItem.productCode) {
          generatedProductCodes.push(origItem.productCode);
        } else {
          if (nextProductCodeNumber === null) {
            const nextCode = await generateIMEIProductCode(collection(db, 'products'));
            nextProductCodeNumber = parseInt(nextCode, 10);
          }
          generatedProductCodes.push(String(nextProductCodeNumber).padStart(8, '0'));
          nextProductCodeNumber += 1;
        }
      }

      if (isEditMode && originalPurchase) {
        setLoadingStates([{ text: 'Reverting previous purchase data...' }]);
        setMultiStepLoading(true);

        for (const origItem of originalPurchase.items) {
          if (!origItem.productCode) continue;
          const productsRef = getCollectionRef('products');
          const q = query(productsRef, where('productCode', '==', origItem.productCode));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const productDoc = snapshot.docs[0];
            await updateDoc(getDocRef('products', productDoc.id), {
              quantity: increment(-Number(origItem.quantity))
            });
          }
        }
      }

      setLoadingStates([
        { text: 'Validating IMEIs and payment...' },
        ...flattenedUnits.map((item, index) => ({ text: `Saving unit ${index + 1} (${item.imei})...` })),
        { text: 'Updating central warehouse...' },
        { text: 'Finalizing purchase...' },
        { text: '✓ Purchase saved successfully!' }
      ]);
      setMultiStepLoading(true);

      const finalItems = flattenedUnits.map((unit, index) => ({
        ...unit,
        productCode: generatedProductCodes[index] || ''
      }));

      const purchaseData: any = {
        purchaseNumber,
        supplierId: selectedSupplierId,
        supplierName: selectedSupplierName,
        items: finalItems,
        totalQuantity,
        totalAmount,
        baseAmount,
        totalGstAmount,
        paidAmount: paid,
        pendingAmount: pending,
        paymentMode,
        paymentStatus,
        isCredit: paymentMode === 'credit',
        creditCleared: 0,
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || '',
        isIMEIPurchase: true,
        hubId: currentHub?.id || 'digital_zone_hq'
      };

      if (paymentSplit) purchaseData.paymentSplit = paymentSplit;
      if (invoiceNumber.trim()) purchaseData.invoiceNumber = invoiceNumber.trim();
      if (notes.trim()) purchaseData.notes = notes.trim();

      let purchaseRefId = '';
      if (isEditMode && id) {
        let purchaseRef = doc(db, 'imeiPurchases', id);
        const checkSnap = await getDoc(purchaseRef);
        if (!checkSnap.exists()) {
          const rootCheck = doc(db, 'purchases', id);
          if ((await getDoc(rootCheck)).exists()) {
            purchaseRef = rootCheck;
          }
        }
        purchaseData.updatedAt = new Date();
        purchaseData.createdAt = originalPurchase.createdAt;
        purchaseData.createdBy = originalPurchase.createdBy;
        purchaseData.createdByName = originalPurchase.createdByName;
        purchaseData.purchaseNumber = originalPurchase.purchaseNumber;
        await updateDoc(purchaseRef, purchaseData);
        purchaseRefId = id;
      } else {
        const purchaseRef = await addDoc(collection(db, 'imeiPurchases'), purchaseData);
        purchaseRefId = purchaseRef.id;
      }

      if (selectedSupplierId && selectedSupplierId !== 'hq-hub') {
        try {
          const supplierRef = doc(db, 'suppliers', selectedSupplierId);
          const supplierSnap = await getDoc(supplierRef);
          if (supplierSnap.exists()) {
            await updateDoc(supplierRef, {
              totalPurchaseAmount: increment(totalAmount),
              totalPaid: increment(paid),
              updatedAt: Timestamp.now()
            });
          }
        } catch (supErr) {
          console.warn('Could not update supplier balance:', supErr);
        }
      }

      const rootProductsRef = collection(db, 'products');

      for (let i = 0; i < finalItems.length; i++) {
        const item = finalItems[i];
        const productCode = item.productCode || '';
        const pName = item.productName?.trim() || `${item.brand} ${item.model} ${item.category}`.trim() || item.imei || 'UNNAMED PRODUCT';
        const costWithGst = item.costPerUnit;

        const productData = {
          productCode,
          hcsCode: item.hcsCode || '',
          imei: item.imei,
          name: pName,
          brand: item.brand,
          model: item.model,
          category: item.category,
          cost: costWithGst,
          baseCost: item.baseCost || 0,
          mrp: Number(item.mrp) || Number(costWithGst) || 0,
          mop: Number(item.mop) || 0,
          taxPercent: Number(item.taxPercent) || 0,
          gstEnabled: (Number(item.taxPercent) || 0) > 0,
          highestDiscountLimit: Number(item.highestDiscountLimit) || 0,
          isAvailable: true,
          supplier: selectedSupplierName,
          paymentType: 'cash'
        };

        const q = item.imei?.trim()
          ? query(rootProductsRef, where('productCode', '==', productCode), where('imei', '==', item.imei.trim()))
          : query(rootProductsRef, where('productCode', '==', productCode));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const productDoc = snapshot.docs[0];
          await updateDoc(doc(db, 'products', productDoc.id), {
            ...productData,
            quantity: increment(1),
            updatedAt: Timestamp.now(),
            updatedBy: currentUser?.uid || ''
          });
        } else {
          await addDoc(rootProductsRef, {
            ...productData,
            quantity: 1,
            sourcePurchaseId: purchaseRefId,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            createdBy: currentUser?.uid || '',
            createdByName: currentUser?.displayName || ''
          });
        }
      }

      showToast(`IMEI Purchase ${purchaseNumber} ${isEditMode ? 'updated' : 'added'} to HQ Central Warehouse successfully!`, 'success');
      setTimeout(() => {
        setMultiStepLoading(false);
        localStorage.removeItem('addPurchaseIMEIDraft');
        setLastSaved(null);
        resetForm();
        navigate('/purchases');
      }, 1500);

    } catch (error) {
      console.error('Error saving IMEI purchase:', error);
      showToast('Failed to save purchase', 'error');
      setMultiStepLoading(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { totalQuantity, totalAmount, baseAmount, totalGstAmount } = calculateTotals();
  const effectivePaidAmount = paymentMode === 'credit' ? 0 : (parseFloat(paidAmount) || 0);
  const pendingAmount = totalAmount - effectivePaidAmount;

  const { duplicates } = getDuplicateImeiInfo();

  let filledImeisCount = 0;
  items.forEach((item, pIdx) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const units = imeiData[pIdx] || [];
    for (let u = 0; u < qty; u++) {
      if (units[u]?.imei?.trim()) {
        filledImeisCount++;
      }
    }
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <style>{`
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
      `}</style>

      <div className="w-full px-3 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-12">
        {/* Minimal Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 mb-6">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">
                Add Purchase
              </h1>
              <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600 border border-slate-200/80">
                IMEI Tracking
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              {isEditMode ? 'Edit purchase lines and assigned physical serial units.' : 'Log inventory arrival and record unique IMEI serials.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isEditMode && lastSaved && (
              <span className="text-xs text-slate-400 hidden sm:inline mr-1">
                Draft auto-saved {lastSaved}
              </span>
            )}
            {!isEditMode && lastSaved && (
              <button
                type="button"
                onClick={clearDraft}
                className="text-xs text-rose-600 hover:text-rose-700 font-semibold px-2 py-1 rounded hover:bg-rose-50 transition-colors"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => importFileInputRef.current?.click()}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors"
            >
              Import Excel
            </button>
            <button
              type="button"
              onClick={exportToExcel}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors"
            >
              Export Excel
            </button>
          </div>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={importFromExcel}
          />
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col lg:flex-row items-start gap-6">

          {/* ================= MINIMAL COLLAPSIBLE LEFT-SIDE STEPPER ================= */}
          <aside className={`w-full ${isSidebarCollapsed ? 'lg:w-14' : 'lg:w-48 xl:w-52'} shrink-0 lg:sticky lg:top-20 z-10 transition-all duration-200`}>
            <nav aria-label="Purchase steps" className={`bg-white rounded-xl border border-slate-200/90 shadow-xs ${isSidebarCollapsed ? 'p-2' : 'p-3'}`}>
              
              {/* Header with Collapse/Expand Toggle */}
              <div className="flex items-center justify-between mb-2 px-1">
                {!isSidebarCollapsed && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hidden lg:block">
                    Steps
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setIsSidebarCollapsed(prev => !prev)}
                  className="hidden lg:flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors ml-auto cursor-pointer"
                  title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar to maximize table width"}
                  aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {isSidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Steps: horizontal on mobile, vertical on desktop */}
              <div className="flex flex-row lg:flex-col gap-1.5">
                {/* Step 1 */}
                <button
                  type="button"
                  onClick={() => setPageStep(1)}
                  title="Step 1: Supplier"
                  className={`flex-1 lg:flex-initial flex items-center ${isSidebarCollapsed ? 'lg:justify-center px-1.5 py-2' : 'gap-2.5 px-2.5 py-2'} rounded-lg text-left transition-all cursor-pointer ${
                    pageStep === 1
                      ? 'bg-blue-50/80 text-blue-700 font-semibold border border-blue-200/70'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                    pageStep === 1
                      ? 'bg-blue-600 text-white'
                      : selectedSupplierId
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    {pageStep > 1 && selectedSupplierId ? <Check className="w-3 h-3" /> : '1'}
                  </span>
                  {!isSidebarCollapsed && (
                    <div className="min-w-0 flex-1 hidden sm:block lg:block">
                      <div className="text-xs truncate">Supplier</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {selectedSupplierName || 'Select supplier'}
                      </div>
                    </div>
                  )}
                </button>

                {/* Connector line (desktop only) */}
                <div className={`hidden lg:block w-px h-2 bg-slate-200 ${isSidebarCollapsed ? 'mx-auto' : 'ml-5'} -my-1`} />

                {/* Step 2 */}
                <button
                  type="button"
                  onClick={() => setPageStep(2)}
                  title="Step 2: Products & IMEIs"
                  className={`flex-1 lg:flex-initial flex items-center ${isSidebarCollapsed ? 'lg:justify-center px-1.5 py-2' : 'gap-2.5 px-2.5 py-2'} rounded-lg text-left transition-all cursor-pointer ${
                    pageStep === 2
                      ? 'bg-blue-50/80 text-blue-700 font-semibold border border-blue-200/70'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                    pageStep === 2
                      ? 'bg-blue-600 text-white'
                      : filledImeisCount === totalQuantity && totalQuantity > 0
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    {pageStep > 2 && filledImeisCount === totalQuantity && totalQuantity > 0 ? <Check className="w-3 h-3" /> : '2'}
                  </span>
                  {!isSidebarCollapsed && (
                    <div className="min-w-0 flex-1 hidden sm:block lg:block">
                      <div className="text-xs truncate">Products & IMEIs</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {totalQuantity} unit{totalQuantity === 1 ? '' : 's'}
                      </div>
                    </div>
                  )}
                </button>

                {/* Connector line (desktop only) */}
                <div className={`hidden lg:block w-px h-2 bg-slate-200 ${isSidebarCollapsed ? 'mx-auto' : 'ml-5'} -my-1`} />

                {/* Step 3 */}
                <button
                  type="button"
                  onClick={() => setPageStep(3)}
                  title="Step 3: Payment & Save"
                  className={`flex-1 lg:flex-initial flex items-center ${isSidebarCollapsed ? 'lg:justify-center px-1.5 py-2' : 'gap-2.5 px-2.5 py-2'} rounded-lg text-left transition-all cursor-pointer ${
                    pageStep === 3
                      ? 'bg-blue-50/80 text-blue-700 font-semibold border border-blue-200/70'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                    pageStep === 3
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    3
                  </span>
                  {!isSidebarCollapsed && (
                    <div className="min-w-0 flex-1 hidden sm:block lg:block">
                      <div className="text-xs truncate">Payment & Save</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {totalAmount > 0 ? `₹${totalAmount.toFixed(0)}` : 'Review & save'}
                      </div>
                    </div>
                  )}
                </button>
              </div>

              {/* Minimal summary footer in rail (when expanded) */}
              {!isSidebarCollapsed && selectedSupplierName && (
                <div className="mt-3 pt-2.5 border-t border-slate-100 hidden lg:block text-[11px] space-y-1">
                  <div className="text-slate-400 text-[10px] uppercase font-bold">Supplier</div>
                  <div className="font-semibold text-slate-800 truncate" title={selectedSupplierName}>
                    {selectedSupplierName}
                  </div>
                  {invoiceNumber && (
                    <div className="text-slate-500 font-mono text-[10px] truncate">
                      Ref: {invoiceNumber}
                    </div>
                  )}
                </div>
              )}
            </nav>
          </aside>

          {/* ================= MAIN CONTENT (Steps 1, 2, 3) ================= */}
          <div className="flex-1 min-w-0 w-full space-y-6">

            {/* ================= STEP 1: SELECT THE SUPPLIER ================= */}
            {pageStep === 1 && (
              <div className="space-y-5 w-full">
                {/* Supplier Selection Card */}
                <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
                  <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                        <Truck className="w-4 h-4 text-blue-600" />
                        <span>Supplier Details</span>
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Select the supplier providing these products and serialized units.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSupplierModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>+ Add New Supplier</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Supplier *
                      </label>
                      <select
                        value={selectedSupplierId}
                        onChange={(e) => {
                          const supId = e.target.value;
                          setSelectedSupplierId(supId);
                          const match = suppliers.find(s => s.id === supId);
                          setSelectedSupplierName(match?.name || '');
                        }}
                        className="w-full px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors"
                      >
                        <option value="">-- Choose a Supplier --</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.phone ? `(${s.phone})` : ''} {s.gstNumber ? `• GST: ${s.gstNumber}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Selected Supplier Information Preview */}
                    {selectedSupplierId && (() => {
                      const sup = suppliers.find(s => s.id === selectedSupplierId);
                      if (!sup) return null;
                      return (
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-700">
                          <div className="font-semibold text-slate-900">
                            {sup.name}
                          </div>
                          {sup.contactPerson && (
                            <span className="text-slate-500">
                              Contact: <strong>{sup.contactPerson}</strong>
                            </span>
                          )}
                          {sup.phone && (
                            <span className="flex items-center gap-1 text-slate-600">
                              <Phone className="w-3 h-3 text-slate-400" />
                              <span>{sup.phone}</span>
                            </span>
                          )}
                          {sup.gstNumber && (
                            <span className="flex items-center gap-1 font-mono text-slate-600">
                              <Hash className="w-3 h-3 text-slate-400" />
                              <span>GSTIN: {sup.gstNumber}</span>
                            </span>
                          )}
                          {sup.address && (
                            <span className="text-slate-500 truncate max-w-sm">
                              {sup.address}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Invoice & Purchase Information Card */}
                <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
                  <div className="pb-3.5 mb-4 border-b border-slate-100">
                    <h2 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      <span>Invoice & Documentation</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Invoice reference number and purchase date for records and ledger tracking.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                        <Hash className="w-3.5 h-3.5 text-slate-400" />
                        <span>Invoice / Challan Reference</span>
                      </label>
                      <input
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors font-mono"
                        placeholder="e.g. INV-2024-9021 or CH-001"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>Purchase Date</span>
                      </label>
                      <input
                        type="date"
                        value={purchaseDate}
                        onChange={(e) => setPurchaseDate(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Purchase Notes / Memo (Optional)
                      </label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors"
                        placeholder="Optional remarks about shipment condition, warranty, or delivery batch..."
                      />
                    </div>
                  </div>
                </div>

                {/* Step 1 Bottom Nav */}
                <div className="bg-white rounded-xl border border-slate-200/90 px-5 py-4 flex items-center justify-between shadow-xs">
                  <button
                    type="button"
                    onClick={() => navigate('/purchases')}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedSupplierId) {
                        showToast('Note: Remember to select a supplier before saving', 'info');
                      }
                      setPageStep(2);
                    }}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-all cursor-pointer"
                  >
                    <span>Proceed to Step 2: Products & IMEIs</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

          {/* ================= STEP 2: PRODUCT THINGS (PRODUCTS & IMEIS) ================= */}
          {pageStep === 2 && (
            <div className="space-y-6">
              {/* ================= PRODUCT UNITS & QUANTITIES CONTAINER (WITH 2 STEPS INSIDE) ================= */}
          <div className="bg-white rounded-xl border border-slate-200/90 overflow-hidden shadow-2xs">
            {/* Minimal Internal Container Header with Segmented Switch */}
            <div className="p-4 sm:p-5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">
                    Product Units & Quantities
                  </h2>
                  <span className="text-xs font-mono text-slate-500">
                    ({totalQuantity} {totalQuantity === 1 ? 'unit' : 'units'})
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {currentStep === 1 
                    ? 'Step 1: Set products, prices & quantities. Serial IMEIs are assigned in Step 2.' 
                    : `Step 2: Assign IMEI & HSN codes for ${totalQuantity} unit${totalQuantity === 1 ? '' : 's'}.`}
                </p>
              </div>

              {/* Minimal Segmented Tab Switch INSIDE Container */}
              <div className="inline-flex p-1 bg-slate-200/60 rounded-lg text-xs font-medium self-start sm:self-auto">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCurrentStep(1);
                  }}
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer ${
                    currentStep === 1
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                    currentStep === 1 ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-700'
                  }`}>
                    1
                  </span>
                  <span>Products & Qty</span>
                  <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-normal">
                    {items.length} line{items.length === 1 ? '' : 's'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setImeiData(prev => getEnsuredImeiData(items, prev));
                    setCurrentStep(2);
                  }}
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 cursor-pointer ${
                    currentStep === 2
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                    currentStep === 2 
                      ? 'bg-blue-600 text-white' 
                      : filledImeisCount === totalQuantity && totalQuantity > 0
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-300 text-slate-700'
                  }`}>
                    2
                  </span>
                  <span>Assign IMEIs</span>
                  <span className={`text-[11px] px-1.5 py-0.2 rounded font-mono ${
                    filledImeisCount === totalQuantity && totalQuantity > 0
                      ? 'bg-emerald-50 text-emerald-700 font-medium'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {filledImeisCount}/{totalQuantity}
                  </span>
                </button>
              </div>
            </div>

            {/* ----------------- STEP 1 VIEW (INSIDE CONTAINER) ----------------- */}
            {currentStep === 1 && (
              <div>
                {/* Step 1 Top Bar with Add and Search buttons on top */}
                <div className="p-3.5 sm:px-5 sm:py-3 border-b border-slate-200/80 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => addItem(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg text-xs font-medium border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5 text-blue-600" />
                      <span>Add Product Line</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenCatalogSearch}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg text-xs font-medium border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Search className="w-3.5 h-3.5 text-blue-600" />
                      <span>Search Catalog</span>
                    </button>

                    {/* Dedicated GST Rate Dropdown (Default 18%) */}
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs shadow-2xs">
                      <span className="text-slate-500 font-medium">GST Rate:</span>
                      <select
                        value={globalTaxPercent}
                        onChange={(e) => handleGlobalTaxChange(Number(e.target.value))}
                        className="bg-transparent font-bold text-blue-700 outline-none cursor-pointer text-xs"
                      >
                        <option value={0}>0% GST</option>
                        <option value={5}>5% GST</option>
                        <option value={12}>12% GST</option>
                        <option value={18}>18% GST (Default)</option>
                        <option value={28}>28% GST</option>
                      </select>
                    </div>

                    {/* Product Name Column Toggle Button */}
                    <button
                      type="button"
                      onClick={toggleProductName}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer shadow-2xs ${
                        showProductName
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                      title={showProductName ? "Click to turn OFF Product Name column" : "Click to turn ON Product Name column"}
                    >
                      {showProductName ? (
                        <Eye className="w-3.5 h-3.5 text-blue-600" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>Product Name: <strong className={showProductName ? 'text-blue-700 font-semibold' : 'text-slate-500 font-medium'}>{showProductName ? 'ON' : 'OFF'}</strong></span>
                    </button>
                  </div>

                  <div className="text-xs text-slate-500 hidden sm:flex items-center gap-2">
                    <span><strong>Enter</strong>: New empty row • <strong>Shift + Enter</strong>: Duplicate row data • <strong>Arrow Keys</strong>: Navigate</span>
                  </div>
                </div>

                {/* Mobile View Cards (Step 1) */}
                <div className="block sm:hidden p-3 space-y-3">
                  {items.map((item, rowIndex) => {
                    const cost = Number(item.costPerUnit) || 0;
                    const qty = Math.max(1, Number(item.quantity) || 1);
                    const tax = Number(item.taxPercent) || 0;
                    const costWithGstPerUnit = cost + (cost * tax / 100);
                    const totalCostWithGst = costWithGstPerUnit * qty;
                    const mrpVal = Number(item.mrp) || 0;
                    const profitMargin = mrpVal - costWithGstPerUnit;

                    return (
                      <div key={rowIndex} className="bg-slate-50/70 rounded-lg p-3 border border-slate-200 text-xs space-y-2.5">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-slate-700">Row #{rowIndex + 1}</span>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItem(rowIndex)}
                              className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">Brand *</label>
                            <SearchableSelect
                              options={brands.map(b => ({ id: b.id || '', name: b.name }))}
                              value={item.brand}
                              onChange={(value) => handleItemChange(rowIndex, 'brand', value)}
                              placeholder="Select Brand"
                              className="border-0! bg-transparent! py-1! text-xs!"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">Model</label>
                            <input
                              type="text"
                              value={item.model}
                              onChange={(e) => handleItemChange(rowIndex, 'model', e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white uppercase"
                              placeholder="e.g. 15 PRO"
                            />
                          </div>
                        </div>

                        <div className={showProductName ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">Category *</label>
                            <SearchableSelect
                              options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                              value={item.category}
                              onChange={(value) => handleItemChange(rowIndex, 'category', value)}
                              placeholder="Select Category"
                              className="border-0! bg-transparent! py-1! text-xs!"
                            />
                          </div>
                          {showProductName && (
                            <div>
                              <label className="text-[11px] text-slate-500 block mb-1">Product Name (Auto)</label>
                              <input
                                type="text"
                                readOnly
                                tabIndex={-1}
                                value={item.productName || `${item.brand} ${item.model} ${item.category}`.trim()}
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-slate-100 text-slate-600 font-medium cursor-not-allowed select-none outline-none"
                                placeholder="Auto-generated"
                              />
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] font-medium text-slate-900 block mb-1">Quantity *</label>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleItemChange(rowIndex, 'quantity', val === '' ? '' : parseInt(val, 10) || 1);
                              }}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md font-semibold text-center bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">Cost/Unit *</label>
                            <input
                              type="text"
                              value={activeCell?.rowIndex === rowIndex && activeCell?.field === 'costPerUnit' 
                                ? activeCell.value 
                                : (item.costPerUnit === 0 ? '' : encodePrice(item.costPerUnit))}
                              onChange={(e) => {
                                const rawValue = e.target.value.toUpperCase();
                                setActiveCell({ rowIndex, field: 'costPerUnit', value: rawValue });
                                const val = decodePrice(rawValue);
                                handleItemChange(rowIndex, 'costPerUnit', isNaN(val) ? 0 : val);
                              }}
                              onFocus={() => setActiveCell({ rowIndex, field: 'costPerUnit', value: item.costPerUnit === 0 ? '' : encodePrice(item.costPerUnit) })}
                              onBlur={() => setActiveCell(null)}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md text-center bg-white"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">MOP (₹)</label>
                            <input
                              type="number"
                              value={item.mop || ''}
                              onChange={(e) => handleItemChange(rowIndex, 'mop', parseFloat(e.target.value) || 0)}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md text-center bg-white"
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500 block mb-1">MRP (₹)</label>
                            <input
                              type="number"
                              value={item.mrp || ''}
                              onChange={(e) => handleItemChange(rowIndex, 'mrp', parseFloat(e.target.value) || 0)}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md text-center bg-white"
                              placeholder="0.00"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 bg-white p-2 rounded border border-slate-200 text-center text-[11px]">
                          <div>
                            <span className="text-slate-400 block text-[10px]">Cost+GST</span>
                            <span className="font-medium text-slate-800">₹{costWithGstPerUnit.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Total Cost</span>
                            <span className="font-medium text-slate-800">₹{totalCostWithGst.toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Margin</span>
                            <span className={profitMargin >= 0 ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}>
                              ₹{profitMargin.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Spreadsheet Table: BRAND, MODEL, CATEGORY, PRODUCTNAME, QTY, COST, COST+GST, MOP, MRP, TOTAL COST, MARGIN */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-medium">
                        <th className="px-3 py-2.5 w-10 text-center">#</th>
                        <th className="px-3 py-2.5 min-w-[130px]">Brand *</th>
                        <th className="px-3 py-2.5 min-w-[110px]">Model</th>
                        <th className="px-3 py-2.5 min-w-[130px]">Category *</th>
                        {showProductName && <th className="px-3 py-2.5 min-w-[190px]">Product Name</th>}
                        <th className="px-3 py-2.5 w-20 text-center font-semibold text-slate-900 bg-slate-100/70">Qty *</th>
                        <th className="px-3 py-2.5 min-w-[130px] w-32 text-right">Cost *</th>
                        <th className="px-3 py-2.5 min-w-[130px] w-32 text-right">MOP (₹)</th>
                        <th className="px-3 py-2.5 min-w-[130px] w-32 text-right">MRP (₹)</th>
                        <th className="px-2 py-2.5 w-24 text-right text-slate-600 font-medium bg-slate-100/40">Cost+GST</th>
                        <th className="px-2 py-2.5 w-24 text-right font-medium text-slate-900">Total Cost</th>
                        <th className="px-2 py-2.5 w-20 text-right text-slate-500">Margin</th>
                        <th className="px-3 py-2.5 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item, rowIndex) => {
                        const cost = Number(item.costPerUnit) || 0;
                        const qty = Math.max(1, Number(item.quantity) || 1);
                        const tax = Number(item.taxPercent) || 0;
                        const costWithGstPerUnit = cost + (cost * tax / 100);
                        const totalCostWithGst = costWithGstPerUnit * qty;
                        const mrpVal = Number(item.mrp) || 0;
                        const profitMargin = mrpVal - costWithGstPerUnit;

                        return (
                          <tr key={rowIndex} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-3 py-2 text-center text-slate-400 font-mono text-[11px]">
                              {rowIndex + 1}
                            </td>

                            {/* 1. BRAND (Col 0) */}
                            <td className="px-2 py-1.5">
                              <SearchableSelect
                                id={`cell-${rowIndex}-0`}
                                options={brands.map(b => ({ id: b.id || '', name: b.name }))}
                                value={item.brand}
                                onChange={(value) => handleItemChange(rowIndex, 'brand', value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 0)}
                                placeholder="Select Brand"
                                className="border-0! bg-transparent! py-1! text-xs!"
                              />
                            </td>

                            {/* 2. MODEL (Col 1) */}
                            <td className="px-2 py-1.5">
                              <input
                                id={`cell-${rowIndex}-1`}
                                type="text"
                                value={item.model}
                                onChange={(e) => handleItemChange(rowIndex, 'model', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 1)}
                                className="w-full px-2 py-1 text-xs border border-slate-200 rounded uppercase bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                placeholder="e.g. 15 PRO"
                              />
                            </td>

                            {/* 3. CATEGORY (Col 2) */}
                            <td className="px-2 py-1.5">
                              <SearchableSelect
                                id={`cell-${rowIndex}-2`}
                                options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                                value={item.category}
                                onChange={(value) => handleItemChange(rowIndex, 'category', value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 2)}
                                placeholder="Select Category"
                                className="border-0! bg-transparent! py-1! text-xs!"
                              />
                            </td>

                            {/* 4. PRODUCT NAME (Col 3 - Non-Editable) */}
                            {showProductName && (
                              <td className="px-2 py-1.5">
                                <input
                                  id={`cell-${rowIndex}-3`}
                                  type="text"
                                  readOnly
                                  tabIndex={-1}
                                  value={item.productName || `${item.brand} ${item.model} ${item.category}`.trim()}
                                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-slate-100 text-slate-600 font-medium cursor-not-allowed select-none truncate outline-none"
                                  placeholder="Auto-generated"
                                  title="Auto-generated from Brand, Model & Category"
                                />
                              </td>
                            )}

                            {/* 5. QTY (Col 4) */}
                            <td className="px-2 py-1.5 bg-slate-50/60">
                              <input
                                id={`cell-${rowIndex}-4`}
                                type="number"
                                min="1"
                                value={item.quantity || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  handleItemChange(rowIndex, 'quantity', val === '' ? '' : parseInt(val, 10) || 1);
                                }}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 4)}
                                onBlur={() => {
                                  if (!item.quantity || Number(item.quantity) < 1) {
                                    handleItemChange(rowIndex, 'quantity', 1);
                                  }
                                }}
                                className="w-full px-2 py-1 text-xs border border-slate-300 rounded text-center font-semibold text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                              />
                            </td>

                            {/* 6. COST (Col 5) */}
                            <td className="px-2 py-1.5 min-w-[130px]">
                              <input
                                id={`cell-${rowIndex}-5`}
                                type="text"
                                value={activeCell?.rowIndex === rowIndex && activeCell?.field === 'costPerUnit' 
                                  ? activeCell.value 
                                  : (item.costPerUnit === 0 ? '' : encodePrice(item.costPerUnit))}
                                onChange={(e) => {
                                  const rawValue = e.target.value.toUpperCase();
                                  setActiveCell({ rowIndex, field: 'costPerUnit', value: rawValue });
                                  const val = decodePrice(rawValue);
                                  handleItemChange(rowIndex, 'costPerUnit', isNaN(val) ? 0 : val);
                                }}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 5)}
                                onFocus={() => setActiveCell({ rowIndex, field: 'costPerUnit', value: item.costPerUnit === 0 ? '' : encodePrice(item.costPerUnit) })}
                                onBlur={() => setActiveCell(null)}
                                className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded text-right font-mono font-medium bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                placeholder="Cost"
                              />
                            </td>

                            {/* 7. MOP (Col 6) */}
                            <td className="px-2 py-1.5 min-w-[130px]">
                              <input
                                id={`cell-${rowIndex}-6`}
                                type="number"
                                value={item.mop || ''}
                                onChange={(e) => handleItemChange(rowIndex, 'mop', parseFloat(e.target.value) || 0)}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 6)}
                                className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded text-right font-mono font-medium bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                placeholder="0.00"
                              />
                            </td>

                            {/* 8. MRP (Col 7) */}
                            <td className="px-2 py-1.5 min-w-[130px]">
                              <input
                                id={`cell-${rowIndex}-7`}
                                type="number"
                                value={item.mrp || ''}
                                onChange={(e) => handleItemChange(rowIndex, 'mrp', parseFloat(e.target.value) || 0)}
                                onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 7)}
                                className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded text-right font-mono font-medium bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                placeholder="0.00"
                              />
                            </td>

                            {/* 9. COST+GST (Display - after MRP) */}
                            <td className="px-2 py-2 text-xs text-right text-slate-700 font-mono font-medium bg-slate-50/60 w-24">
                              {cost > 0 ? `₹${costWithGstPerUnit.toFixed(2)}` : '—'}
                            </td>

                            {/* 10. TOTAL COST (Display) */}
                            <td className="px-2 py-2 text-xs text-right font-semibold text-slate-900 font-mono w-24">
                              {cost > 0 ? `₹${totalCostWithGst.toFixed(2)}` : '—'}
                            </td>

                            {/* 11. MARGIN (Display) */}
                            <td className="px-2 py-2 text-xs text-right font-mono w-20">
                              <span className={profitMargin >= 0 ? 'text-emerald-700 font-medium' : 'text-rose-600 font-medium'}>
                                {mrpVal > 0 ? `₹${profitMargin.toFixed(2)}` : '—'}
                              </span>
                            </td>

                            {/* 13. ACTIONS */}
                            <td className="px-2 py-1.5 text-center">
                              {items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeItem(rowIndex)}
                                  className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                                  title="Delete line"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Step 1 Actions Toolbar inside container */}
                <div className="p-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/30">
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                    <span><strong className="text-slate-800">{items.length}</strong> product line{items.length === 1 ? '' : 's'}</span>
                    <span className="text-slate-300">•</span>
                    <span><strong className="text-slate-800">{totalQuantity}</strong> unit{totalQuantity === 1 ? '' : 's'}</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-400">Press <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono">Enter</kbd> for new row, <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono">Shift+Enter</kbd> to duplicate</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleProceedToStep2}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                  >
                    <span>Proceed to Assign IMEIs ({totalQuantity} Units)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ----------------- STEP 2 VIEW (TABLE FORMAT: BRAND, MODEL, CATEGORY, PRODUCTNAME, QTY, COST, COST+GST, MOP, MRP, TOTAL COST, MARGIN) ----------------- */}
            {currentStep === 2 && (
              <div>
                {/* Step 2 Header Strip */}
                <div className="p-4 sm:p-5 bg-slate-50/70 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
                      Step 2: Assign Unit IMEIs & HSN Codes
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Products are shown below as read-only. Assign or scan serial IMEIs for each physical unit. Press Enter to advance units.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* Compact progress tracker */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs">
                      <span className="text-slate-500 font-medium">Assigned:</span>
                      <span className="font-semibold text-slate-900 font-mono">{filledImeisCount} / {totalQuantity}</span>
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden ml-1">
                        <div 
                          className={`h-full transition-all duration-300 ${filledImeisCount === totalQuantity ? 'bg-emerald-500' : 'bg-blue-600'}`}
                          style={{ width: `${Math.min(100, Math.round((filledImeisCount / (totalQuantity || 1)) * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* Compact Global HSN applicator */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={globalHcsCode}
                        onChange={(e) => setGlobalHcsCode(e.target.value.toUpperCase())}
                        placeholder="HSN for all"
                        className="w-28 px-2.5 py-1.5 text-xs font-mono uppercase bg-white border border-slate-200 rounded-lg text-slate-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => applyHcsToAllUnits(globalHcsCode)}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        Apply HSN
                      </button>
                    </div>

                    {/* Product Name Column Toggle */}
                    <button
                      type="button"
                      onClick={toggleProductName}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        showProductName
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      title={showProductName ? "Click to turn OFF Product Name column" : "Click to turn ON Product Name column"}
                    >
                      {showProductName ? <Eye className="w-3.5 h-3.5 text-blue-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                      <span>Product Name: <strong className={showProductName ? 'text-blue-700 font-semibold' : 'text-slate-500 font-medium'}>{showProductName ? 'ON' : 'OFF'}</strong></span>
                    </button>
                  </div>
                </div>

                {/* Duplicate Alert */}
                {duplicates.size > 0 && (
                  <div className="m-4 p-3 bg-rose-50/80 border border-rose-200 rounded-lg flex items-center gap-2.5 text-rose-800 text-xs">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      Duplicate IMEI detected: <strong>{Array.from(duplicates).join(', ')}</strong>. Every unit requires a unique IMEI.
                    </span>
                  </div>
                )}

                {/* Grouped Product Units with Specifications Table */}
                <div className="p-4 space-y-4">
                  {items.map((item, pIndex) => {
                    const qty = Math.max(1, Number(item.quantity) || 1);
                    const units = imeiData[pIndex] || [];
                    const cost = Number(item.costPerUnit) || 0;
                    const tax = Number(item.taxPercent) || 0;
                    const costWithGst = cost + (cost * tax / 100);
                    const totalCostWithGst = costWithGst * qty;
                    const mrpVal = Number(item.mrp) || 0;
                    const profitMargin = mrpVal - costWithGst;
                    const productName = item.productName || `${item.brand} ${item.model} ${item.category}`.trim() || `Product #${pIndex + 1}`;

                    return (
                      <div key={pIndex} className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
                        {/* Non-Editable Product Specification Table: BRAND, MODEL, CATEGORY, PRODUCTNAME, QTY, COST, COST+GST, MOP, MRP, TOTAL COST, MARGIN */}
                        <div className="overflow-x-auto border-b border-slate-200 bg-slate-50/60">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-500 font-medium">
                                <th className="px-3 py-2 w-10 text-center">#</th>
                                <th className="px-3 py-2 min-w-[110px]">Brand</th>
                                <th className="px-3 py-2 min-w-[100px]">Model</th>
                                <th className="px-3 py-2 min-w-[110px]">Category</th>
                                {showProductName && <th className="px-3 py-2 min-w-[160px]">Product Name</th>}
                                <th className="px-3 py-2 w-16 text-center font-bold text-slate-900 bg-slate-100/70">Qty</th>
                                <th className="px-3 py-2 min-w-[130px] w-32 text-right">Cost</th>
                                <th className="px-3 py-2 min-w-[130px] w-32 text-right">MOP</th>
                                <th className="px-3 py-2 min-w-[130px] w-32 text-right">MRP</th>
                                <th className="px-2 py-2 w-24 text-right text-slate-600 font-medium bg-slate-100/50">Cost+GST</th>
                                <th className="px-2 py-2 w-24 text-right font-medium text-slate-900">Total Cost</th>
                                <th className="px-2 py-2 w-20 text-right text-slate-500">Margin</th>
                                <th className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setBulkPasteModal({ productIndex: pIndex, text: '' })}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
                                  >
                                    <Clipboard className="w-3 h-3 text-slate-500" />
                                    Bulk Paste ({qty})
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="bg-white font-medium text-slate-800">
                                <td className="px-3 py-2 text-center text-slate-400 font-mono text-[11px]">{pIndex + 1}</td>
                                <td className="px-3 py-2 font-semibold text-blue-700">{item.brand}</td>
                                <td className="px-3 py-2">{item.model || '—'}</td>
                                <td className="px-3 py-2">{item.category}</td>
                                {showProductName && <td className="px-3 py-2 text-slate-900 font-semibold">{productName}</td>}
                                <td className="px-3 py-2 text-center font-bold text-slate-900 bg-slate-50">{qty}</td>
                                <td className="px-3 py-2 text-right font-mono min-w-[130px]">₹{cost.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono min-w-[130px]">{Number(item.mop) > 0 ? `₹${Number(item.mop).toFixed(2)}` : '—'}</td>
                                <td className="px-3 py-2 text-right font-mono min-w-[130px]">{Number(item.mrp) > 0 ? `₹${Number(item.mrp).toFixed(2)}` : '—'}</td>
                                <td className="px-2 py-2 text-right font-mono text-slate-700 font-medium bg-slate-50 w-24">₹{costWithGst.toFixed(2)}</td>
                                <td className="px-2 py-2 text-right font-mono font-bold text-slate-900 w-24">₹{totalCostWithGst.toFixed(2)}</td>
                                <td className="px-2 py-2 text-right font-mono w-20">
                                  <span className={profitMargin >= 0 ? 'text-emerald-700 font-medium' : 'text-rose-600 font-medium'}>
                                    {mrpVal > 0 ? `₹${profitMargin.toFixed(2)}` : '—'}
                                  </span>
                                </td>
                                <td></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Physical Unit IMEI & HSN Entry Rows */}
                        <div className="divide-y divide-slate-100 p-2 sm:p-3 bg-white">
                          <div className="text-[11px] font-semibold text-slate-500 px-3 py-1 mb-1">
                            Assign IMEI & HSN for {qty} Physical Unit{qty === 1 ? '' : 's'}:
                          </div>
                          {Array.from({ length: qty }).map((_, uIndex) => {
                            const u = units[uIndex] || { imei: '', hcsCode: '' };
                            const isDuplicate = u.imei && duplicates.has(u.imei.trim());
                            const overallUnitIndex = getOverallUnitIndex(pIndex, uIndex);

                            return (
                              <div 
                                key={uIndex} 
                                className={`px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-3 transition-colors rounded-md ${
                                  isDuplicate ? 'bg-rose-50/50' : u.imei ? 'bg-slate-50/20' : ''
                                }`}
                              >
                                <div className="w-24 shrink-0 flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-mono font-medium flex items-center justify-center">
                                    {uIndex + 1}
                                  </span>
                                  <span className="text-xs text-slate-600 font-medium">Unit {uIndex + 1}</span>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <input
                                    type="text"
                                    value={u.imei}
                                    onChange={(e) => handleUnitImeiChange(pIndex, uIndex, e.target.value)}
                                    onKeyDown={(e) => handleStep2ImeiKeyDown(e, pIndex, uIndex)}
                                    data-overall-idx={overallUnitIndex}
                                    placeholder={`Enter or scan IMEI for Unit #${uIndex + 1}`}
                                    className={`w-full px-3 py-1.5 text-xs font-mono uppercase rounded-lg border transition-colors outline-none ${
                                      isDuplicate
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-900 focus:ring-1 focus:ring-rose-500'
                                        : u.imei
                                        ? 'border-emerald-300 bg-white text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600'
                                        : 'border-slate-200 bg-white text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600'
                                    }`}
                                  />
                                  {isDuplicate && (
                                    <span className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                                      Duplicate IMEI found!
                                    </span>
                                  )}
                                </div>

                                <div className="w-48 shrink-0 flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={u.hcsCode}
                                    onChange={(e) => handleUnitHcsChange(pIndex, uIndex, e.target.value)}
                                    placeholder="HSN Code"
                                    className="w-full px-3 py-1.5 text-xs font-mono uppercase rounded-lg border border-slate-200 bg-white text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                  />
                                  {uIndex === 0 && qty > 1 && (
                                    <button
                                      type="button"
                                      title="Copy this HSN to all units of this product"
                                      onClick={() => applyHcsToProductUnits(pIndex, u.hcsCode)}
                                      className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                                    >
                                      All
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Step 2 Actions Toolbar inside container */}
                <div className="p-4 bg-slate-50/50 border-t border-slate-200 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCurrentStep(1);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Step 1 (Products & Qty)
                  </button>

                  <div className="text-xs font-medium">
                    {filledImeisCount === totalQuantity ? (
                      <span className="text-emerald-700 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> All {totalQuantity} IMEIs assigned
                      </span>
                    ) : (
                      <span className="text-slate-500 font-mono">
                        {totalQuantity - filledImeisCount} unit{totalQuantity - filledImeisCount === 1 ? '' : 's'} pending
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

              {/* Step 2 Bottom Nav */}
              <div className="bg-white rounded-xl border border-slate-200/90 px-5 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>Lines: <strong className="text-slate-900 font-mono">{items.length}</strong></span>
                  <span className="text-slate-300">•</span>
                  <span>Units: <strong className="text-slate-900 font-mono">{totalQuantity}</strong></span>
                  <span className="text-slate-300">•</span>
                  <span>Total: <strong className="text-slate-900 font-mono font-semibold">{encodePrice(totalAmount)}</strong></span>
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => setPageStep(1)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back: Supplier</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPageStep(3)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-2xs transition-all cursor-pointer"
                  >
                    <span>Next: Payment Details ({totalQuantity} Units)</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 3: PAYMENT DETAILS & SAVE PURCHASE ================= */}
          {pageStep === 3 && (
            <div className="w-full space-y-6">
              
              {/* Top KPI Metrics Strip (Full Width) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
                {/* 1. Supplier & Invoice */}
                <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">Supplier & Invoice</span>
                      <Truck className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="text-sm font-bold text-slate-900 truncate" title={selectedSupplierName || 'HQ Central Hub'}>
                      {selectedSupplierName || 'HQ Central Hub'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 text-xs text-slate-500 font-mono">
                    <span>Inv: <strong className="text-slate-800">{invoiceNumber || '—'}</strong></span>
                    <span className="text-slate-300">•</span>
                    <span>{purchaseDate || 'Today'}</span>
                  </div>
                </div>

                {/* 2. Inventory Scope & Scanned IMEIs */}
                <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">Inventory Scope</span>
                      <Package className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold text-slate-900 font-mono">{totalQuantity}</span>
                      <span className="text-xs text-slate-500">Units</span>
                      <span className="text-slate-300">•</span>
                      <span className="text-xs font-semibold text-slate-700">{items.length} Product Line{items.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                      filledImeisCount === totalQuantity && totalQuantity > 0
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      <Smartphone className="w-3 h-3" />
                      {filledImeisCount} / {totalQuantity} IMEIs Scanned
                    </span>
                  </div>
                </div>

                {/* 3. Base & GST Breakdown */}
                <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">Valuation & Tax</span>
                      <Receipt className="w-4 h-4 text-slate-600" />
                    </div>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-500">Base Cost:</span>
                      <span className="font-mono font-semibold text-slate-800">₹{baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between text-xs mt-3 pt-2 border-t border-slate-100">
                    <span className="text-slate-500">GST ({globalTaxPercent}%):</span>
                    <span className="font-mono font-semibold text-blue-600">+₹{totalGstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* 4. Grand Total & Settlement */}
                <div className="bg-gradient-to-br from-blue-50/80 via-slate-50 to-indigo-50/50 rounded-xl border border-blue-200 p-4 shadow-2xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-blue-700 mb-1">
                      <span className="font-bold uppercase tracking-wider text-[11px]">Gross Payable</span>
                      <DollarSign className="w-4 h-4 text-blue-700" />
                    </div>
                    <div className="text-xl font-bold font-mono text-blue-950">
                      ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 text-xs">
                    <span className="text-slate-500">Paid:</span>
                    <span className="font-mono font-semibold text-emerald-700">₹{effectivePaidAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-slate-500">Due:</span>
                    <span className={`font-mono font-semibold ${pendingAmount > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                      ₹{Math.max(0, pendingAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Full-Width 2-Column Responsive Workspace */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 w-full">
                
                {/* Left Column: Settlement Controls & Procurement Manifest (7 cols) */}
                <div className="xl:col-span-7 space-y-6">
                  
                  {/* Payment Settlement Card */}
                  <div className="bg-white rounded-xl border border-slate-200/90 p-5 sm:p-6 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-100">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-blue-600" />
                          <span>Payment Settlement</span>
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Choose payment method and record immediate or credit transaction values.
                        </p>
                      </div>

                      {paymentMode !== 'credit' && totalAmount > 0 && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPaidAmount(totalAmount.toString());
                              if (paymentMode === 'split') {
                                setCashAmount(totalAmount.toString());
                                setUpiAmount('0');
                                setCardAmount('0');
                              }
                            }}
                            className="text-xs text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer"
                          >
                            Fill Full Total (₹{totalAmount.toFixed(2)})
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Payment Mode Selector Grid */}
                    <div className="mb-5">
                      <label className="block text-xs font-semibold text-slate-700 mb-2">
                        Select Settlement Mode *
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                        {[
                          { mode: 'cash' as PaymentMode, label: 'Cash', desc: 'Liquid Cash', icon: Banknote },
                          { mode: 'upi' as PaymentMode, label: 'UPI / QR', desc: 'Instant Transfer', icon: QrCode },
                          { mode: 'card' as PaymentMode, label: 'Card', desc: 'POS Terminal', icon: CreditCard },
                          { mode: 'split' as PaymentMode, label: 'Split', desc: 'Multi-tender', icon: Split },
                          { mode: 'credit' as PaymentMode, label: 'Credit', desc: 'Supplier Ledger', icon: FileText }
                        ].map(({ mode, label, desc, icon: Icon }) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => {
                              setPaymentMode(mode);
                              if (mode === 'credit') {
                                setPaidAmount('0');
                                setCashAmount('');
                                setUpiAmount('');
                                setCardAmount('');
                              } else if (mode === 'split') {
                                const initialPaid = parseFloat(paidAmount) || totalAmount;
                                setPaidAmount(initialPaid.toString());
                                setCashAmount(initialPaid.toString());
                                setUpiAmount('0');
                                setCardAmount('0');
                              }
                            }}
                            className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer ${
                              paymentMode === mode
                                ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-600/20'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1.5">
                              <Icon className={`w-4 h-4 ${paymentMode === mode ? 'text-white' : 'text-slate-600'}`} />
                              {paymentMode === mode && <Check className="w-3.5 h-3.5 text-white" />}
                            </div>
                            <span className="font-semibold text-xs leading-none">{label}</span>
                            <span className={`text-[10px] mt-1 ${paymentMode === mode ? 'text-blue-100' : 'text-slate-400'}`}>
                              {desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mode Specific Inputs */}
                    {paymentMode !== 'credit' && paymentMode !== 'split' && (
                      <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200/90 mb-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-700">
                            Paid Amount (₹)
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPaidAmount(totalAmount.toString())}
                              className="text-[11px] font-medium text-slate-600 hover:text-blue-700 bg-white border border-slate-200 px-2 py-0.5 rounded cursor-pointer transition-colors"
                            >
                              100% Full Total
                            </button>
                            <button
                              type="button"
                              onClick={() => setPaidAmount((Math.round(totalAmount / 2)).toString())}
                              className="text-[11px] font-medium text-slate-600 hover:text-blue-700 bg-white border border-slate-200 px-2 py-0.5 rounded cursor-pointer transition-colors"
                            >
                              50% Advance
                            </button>
                            <button
                              type="button"
                              onClick={() => setPaidAmount('0')}
                              className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 px-2 py-0.5 rounded cursor-pointer transition-colors"
                            >
                              Clear (₹0)
                            </button>
                          </div>
                        </div>
                        <div className="relative">
                          <span className="absolute left-3.5 top-2.5 text-slate-400 font-semibold text-sm">₹</span>
                          <input
                            type="number"
                            value={paidAmount}
                            onChange={(e) => setPaidAmount(e.target.value)}
                            className="w-full pl-8 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors font-mono font-bold text-base"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    )}

                    {paymentMode === 'split' && (
                      <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200/90 mb-5 space-y-3.5">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-800">Split Multi-Tender Breakdown</div>
                          <div className="text-xs font-mono font-semibold">
                            Split Total: <span className="text-blue-600">₹{(
                              (parseFloat(cashAmount) || 0) +
                              (parseFloat(upiAmount) || 0) +
                              (parseFloat(cardAmount) || 0)
                            ).toFixed(2)}</span> / ₹{totalAmount.toFixed(2)}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="bg-white p-3 rounded-lg border border-slate-200">
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
                              <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Cash Tender (₹)</span>
                            </label>
                            <input
                              type="number"
                              value={cashAmount}
                              onChange={(e) => {
                                const newCash = e.target.value;
                                setCashAmount(newCash);
                                const c = parseFloat(newCash) || 0;
                                const u = parseFloat(upiAmount) || 0;
                                const d = parseFloat(cardAmount) || 0;
                                setPaidAmount((c + u + d).toString());
                              }}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-xs font-mono font-bold bg-white focus:border-blue-600 outline-none"
                              placeholder="0.00"
                            />
                          </div>

                          <div className="bg-white p-3 rounded-lg border border-slate-200">
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
                              <QrCode className="w-3.5 h-3.5 text-blue-600" />
                              <span>UPI / QR (₹)</span>
                            </label>
                            <input
                              type="number"
                              value={upiAmount}
                              onChange={(e) => {
                                const newUpi = e.target.value;
                                setUpiAmount(newUpi);
                                const c = parseFloat(cashAmount) || 0;
                                const u = parseFloat(newUpi) || 0;
                                const d = parseFloat(cardAmount) || 0;
                                setPaidAmount((c + u + d).toString());
                              }}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-xs font-mono font-bold bg-white focus:border-blue-600 outline-none"
                              placeholder="0.00"
                            />
                          </div>

                          <div className="bg-white p-3 rounded-lg border border-slate-200">
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
                              <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Card (₹)</span>
                            </label>
                            <input
                              type="number"
                              value={cardAmount}
                              onChange={(e) => {
                                const newCard = e.target.value;
                                setCardAmount(newCard);
                                const c = parseFloat(cashAmount) || 0;
                                const u = parseFloat(upiAmount) || 0;
                                const d = parseFloat(newCard) || 0;
                                setPaidAmount((c + u + d).toString());
                              }}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-xs font-mono font-bold bg-white focus:border-blue-600 outline-none"
                              placeholder="0.00"
                            />
                          </div>
                        </div>

                        {/* Split helper buttons */}
                        <div className="flex items-center gap-2 pt-1 text-[11px]">
                          <span className="text-slate-500">Quick fill balance:</span>
                          <button
                            type="button"
                            onClick={() => {
                              const u = parseFloat(upiAmount) || 0;
                              const d = parseFloat(cardAmount) || 0;
                              const rem = Math.max(0, totalAmount - (u + d));
                              setCashAmount(rem.toString());
                              setPaidAmount((rem + u + d).toString());
                            }}
                            className="text-blue-700 hover:underline cursor-pointer"
                          >
                            Remaining to Cash
                          </button>
                          <span className="text-slate-300">•</span>
                          <button
                            type="button"
                            onClick={() => {
                              const c = parseFloat(cashAmount) || 0;
                              const d = parseFloat(cardAmount) || 0;
                              const rem = Math.max(0, totalAmount - (c + d));
                              setUpiAmount(rem.toString());
                              setPaidAmount((c + rem + d).toString());
                            }}
                            className="text-blue-700 hover:underline cursor-pointer"
                          >
                            Remaining to UPI
                          </button>
                        </div>
                      </div>
                    )}

                    {paymentMode === 'credit' && (
                      <div className="p-4 bg-amber-50/80 rounded-xl border border-amber-200 text-xs text-amber-900 mb-5 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <strong className="font-semibold block text-amber-950 text-sm">Credit Purchase Recorded</strong>
                          <span className="text-amber-800 leading-relaxed mt-0.5 block">
                            The full purchase value of <strong>₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> will be credited directly to <strong>{selectedSupplierName || 'the supplier'}</strong>'s outstanding payable balance. You can disburse payments later from the Suppliers ledger.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Internal Transaction Notes */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>Internal Transaction Remarks / Payment Notes</span>
                      </label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors"
                        placeholder="Optional remarks, cheque reference number, RTGS/NEFT transaction UTR, or payment terms..."
                      />
                    </div>
                  </div>

                  {/* Itemized Order Manifest / Verification Table (Full Width) */}
                  <div className="bg-white rounded-xl border border-slate-200/90 overflow-hidden shadow-xs">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                          <Package className="w-4 h-4 text-blue-600" />
                          <span>Order Line Items ({items.length} Products, {totalQuantity} Units)</span>
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Review product details and IMEI allocation before finalizing purchase.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setPageStep(2)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2.5 py-1 rounded-md border border-blue-100 hover:bg-blue-50 transition-colors cursor-pointer"
                      >
                        Edit in Step 2
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                          <tr>
                            <th className="py-2.5 px-3.5 w-10">#</th>
                            <th className="py-2.5 px-3">Product Description</th>
                            <th className="py-2.5 px-3 text-center">Category</th>
                            <th className="py-2.5 px-3 text-right">Qty</th>
                            <th className="py-2.5 px-3 text-right">Unit Cost</th>
                            <th className="py-2.5 px-3 text-right">GST</th>
                            <th className="py-2.5 px-3 text-right">Total Cost</th>
                            <th className="py-2.5 px-3.5 text-center">IMEI Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {items.map((item, idx) => {
                            const qty = Math.max(1, Number(item.quantity) || 1);
                            const units = imeiData[idx] || [];
                            const assignedInRow = units.filter((u: any) => u?.imei?.trim()).length;
                            const isRowImeiComplete = assignedInRow === qty;

                            return (
                              <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                <td className="py-2.5 px-3.5 font-mono text-slate-400 text-[11px]">{idx + 1}</td>
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-900">
                                    {item.brand} {item.model}
                                  </div>
                                  {item.productName && item.productName !== `${item.brand} ${item.model}` && (
                                    <div className="text-[11px] text-slate-500 truncate max-w-xs">{item.productName}</div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700">
                                    {item.category || 'Standard'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                                  {qty}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                                  ₹{Number(item.costPerUnit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-blue-600 text-[11px]">
                                  {item.taxPercent || globalTaxPercent}%
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                  ₹{Number(item.totalCost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-2.5 px-3.5 text-center">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono ${
                                    isRowImeiComplete
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                                  }`}>
                                    {isRowImeiComplete ? (
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    ) : (
                                      <AlertCircle className="w-3 h-3 text-amber-600" />
                                    )}
                                    {assignedInRow}/{qty}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>

                {/* Right Column: Commercial Ledger & Pre-flight Checklist (5 cols) */}
                <div className="xl:col-span-5 space-y-6">
                  
                  {/* Commercial Ledger Card */}
                  <div className="bg-white rounded-xl border border-slate-200/90 p-5 sm:p-6 shadow-xs">
                    <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
                      <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-blue-600" />
                        <span>Commercial Invoice Ledger</span>
                      </h3>
                      <span className="text-[11px] font-mono text-slate-500">
                        {globalTaxPercent}% GST Tier
                      </span>
                    </div>

                    <div className="space-y-2.5 text-xs pb-4 border-b border-slate-100">
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Items Base Total</span>
                        <span className="font-mono font-medium text-slate-900">₹{baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Applicable GST ({globalTaxPercent}%)</span>
                        <span className="font-mono font-medium text-blue-600">+₹{totalGstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Invoice Reference</span>
                        <span className="font-mono text-slate-900">{invoiceNumber || 'Auto-generated'}</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Supplier Account</span>
                        <span className="text-slate-900 font-semibold truncate max-w-[200px]" title={selectedSupplierName || 'HQ Central Hub'}>
                          {selectedSupplierName || 'HQ Central Hub'}
                        </span>
                      </div>
                    </div>

                    {/* Net Grand Total Highlight */}
                    <div className="py-4 border-b border-slate-100">
                      <div className="flex justify-between items-baseline">
                        <span className="font-bold text-slate-900 text-sm">Grand Total (Net)</span>
                        <span className="font-mono font-bold text-slate-900 text-xl tracking-tight">
                          ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Inclusive of all line items, quantities, and GST duties.
                      </p>
                    </div>

                    {/* Settlement Breakdown */}
                    <div className="pt-4 space-y-2.5 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">Payment Mode</span>
                        <span className="font-semibold uppercase tracking-wider text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                          {paymentMode}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">Immediate Paid</span>
                        <span className="font-mono font-bold text-emerald-600 text-sm">
                          ₹{effectivePaidAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">Outstanding Balance</span>
                        <span className={`font-mono font-bold text-sm ${pendingAmount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                          ₹{Math.max(0, pendingAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      
                      {/* Status Badge */}
                      <div className="pt-2">
                        {pendingAmount <= 0 && totalAmount > 0 ? (
                          <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Fully Settled (100% Paid)</span>
                          </div>
                        ) : paymentMode === 'credit' ? (
                          <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-2">
                            <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>100% Credit Purchase (Ledger Recorded)</span>
                          </div>
                        ) : (
                          <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>Partial Settlement (₹{Math.max(0, pendingAmount).toFixed(2)} Due)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Pre-Flight Quality & Safety Audit Card */}
                  <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs space-y-3">
                    <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Pre-Flight Verification</span>
                    </h3>

                    <div className="space-y-2 text-xs">
                      {/* Supplier check */}
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50/60 border border-slate-100">
                        <span className="text-slate-600">Supplier Verified</span>
                        <span className="flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {selectedSupplierName || 'HQ Central Hub'}
                        </span>
                      </div>

                      {/* Products check */}
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50/60 border border-slate-100">
                        <span className="text-slate-600">Line Items & Valuation</span>
                        <span className="flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {items.length} Lines ({totalQuantity} Pcs)
                        </span>
                      </div>

                      {/* IMEI check */}
                      <div className={`flex items-center justify-between p-2 rounded-lg border ${
                        filledImeisCount === totalQuantity && totalQuantity > 0
                          ? 'bg-emerald-50/50 border-emerald-100 text-emerald-800'
                          : 'bg-amber-50/50 border-amber-100 text-amber-800'
                      }`}>
                        <span>Serial IMEI Completeness</span>
                        <span className="flex items-center gap-1 font-semibold text-[11px] font-mono">
                          {filledImeisCount === totalQuantity && totalQuantity > 0 ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{filledImeisCount}/{totalQuantity} Complete</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                              <span>{filledImeisCount}/{totalQuantity} Assigned</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    {filledImeisCount < totalQuantity && (
                      <button
                        type="button"
                        onClick={() => {
                          setPageStep(2);
                          setCurrentStep(2);
                        }}
                        className="w-full text-center text-[11px] text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 py-2 rounded-lg font-semibold transition-colors cursor-pointer"
                      >
                        ⚠️ Click here to jump to Step 2 and scan missing IMEIs
                      </button>
                    )}
                  </div>

                  {/* Primary Call to Action Box */}
                  <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        <Save className="w-4 h-4 text-blue-600" />
                        <span>Ready to Finalize Purchase</span>
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Stock inventory will be credited and serialized barcodes generated automatically.
                      </p>
                    </div>

                    <button
                      id="verify-save-btn"
                      type="submit"
                      disabled={isSubmitting}
                      className={`w-full inline-flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-lg text-xs font-semibold text-white shadow-xs transition-all ${
                        filledImeisCount === totalQuantity && totalQuantity > 0 && duplicates.size === 0
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-blue-600 hover:bg-blue-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
                    >
                      <Save className="w-4 h-4" />
                      <span>
                        {isSubmitting
                          ? 'Saving Purchase...'
                          : isEditMode
                          ? `Verify & Update Purchase (₹${totalAmount.toFixed(2)})`
                          : `Verify & Save Purchase (${totalQuantity} Units • ₹${totalAmount.toFixed(2)})`}
                      </span>
                    </button>
                  </div>

                </div>

              </div>

              {/* Step 3 Full-Width Bottom Bar */}
              <div className="bg-white rounded-xl border border-slate-200/90 px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
                <button
                  type="button"
                  onClick={() => setPageStep(2)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back: Products & IMEIs</span>
                </button>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <span className="text-xs text-slate-500 hidden sm:inline">
                    Total: <strong className="font-mono text-slate-900">₹{totalAmount.toFixed(2)}</strong> ({totalQuantity} units)
                  </span>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSubmitting ? 'Saving...' : 'Save Purchase'}</span>
                  </button>
                </div>
              </div>

            </div>
          )}
          </div>
        
        </form>
      </div>

      {/* New Supplier Modal */}
      {showSupplierModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">Add New Supplier</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSupplierModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Supplier / Vendor Name *
                </label>
                <input
                  type="text"
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  placeholder="e.g. Apex Electronics Ltd"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contact Person
                </label>
                <input
                  type="text"
                  value={supplierForm.contactPerson}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })}
                  placeholder="e.g. Rajesh Kumar"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    GST Number
                  </label>
                  <input
                    type="text"
                    value={supplierForm.gstNumber}
                    onChange={(e) => setSupplierForm({ ...supplierForm, gstNumber: e.target.value })}
                    placeholder="e.g. 33AAAAA0000A1Z5"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 font-mono uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Address
                </label>
                <textarea
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  rows={2}
                  placeholder="e.g. Plot 42, Tech Park, Chennai"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSupplierModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddNewSupplier}
                className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                Save Supplier
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Product Catalog Search Modal (IMEI Products Only + Filters) */}
      {isCatalogSearchOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-5 border border-slate-200 flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">Search IMEI Product Catalog</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  IMEI Only
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsCatalogSearchOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input & Dropdown Filters Bar */}
            <div className="space-y-2.5 mb-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={catalogSearchText}
                  onChange={(e) => handleCatalogSearchChange(e.target.value)}
                  placeholder="Search by IMEI, product name, model, code..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 font-medium bg-slate-50/50"
                  autoFocus
                />
              </div>

              {/* Filter controls row: Brand & Category filters */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-500">
                  <Filter className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-medium">Filters:</span>
                </div>

                {/* Brand Filter */}
                <select
                  value={catalogSelectedBrand}
                  onChange={(e) => handleCatalogBrandFilterChange(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 outline-none focus:border-blue-600 cursor-pointer"
                >
                  <option value="all">All Brands</option>
                  {Array.from(new Set(catalogProductsList.map(p => p.brand).filter(Boolean))).sort().map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>

                {/* Category Filter */}
                <select
                  value={catalogSelectedCategory}
                  onChange={(e) => handleCatalogCategoryFilterChange(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 outline-none focus:border-blue-600 cursor-pointer"
                >
                  <option value="all">All Categories</option>
                  {Array.from(new Set(catalogProductsList.map(p => p.category).filter(Boolean))).sort().map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                {/* Clear filters shortcut */}
                {(catalogSelectedBrand !== 'all' || catalogSelectedCategory !== 'all' || catalogSearchText) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCatalogSearchText('');
                      setCatalogSelectedBrand('all');
                      setCatalogSelectedCategory('all');
                      setFilteredCatalogProducts(catalogProductsList.slice(0, 30));
                    }}
                    className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline px-1 py-0.5 cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}

                <span className="ml-auto text-[11px] text-slate-400 font-mono">
                  {filteredCatalogProducts.length} matching IMEI item{filteredCatalogProducts.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 min-h-[240px] pr-1">
              {catalogSearching ? (
                <div className="py-12 text-center text-xs text-slate-400">Loading IMEI products catalog...</div>
              ) : filteredCatalogProducts.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  {catalogSearchText || catalogSelectedBrand !== 'all' || catalogSelectedCategory !== 'all'
                    ? 'No IMEI products match the selected filters.'
                    : 'No IMEI products found in catalog.'}
                </div>
              ) : (
                filteredCatalogProducts.map((p, idx) => (
                  <div
                    key={p.id || idx}
                    onClick={() => handleSelectProductIntoRow(p)}
                    className="p-2.5 hover:bg-blue-50/70 rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-3 text-xs group"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 group-hover:text-blue-700 truncate flex items-center gap-2">
                        <span>{p.name || `${p.brand} ${p.model}`}</span>
                        {p.imei && (
                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-blue-100/70 text-blue-800 font-bold border border-blue-200">
                            IMEI: {p.imei}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        <span>Brand: <strong>{p.brand}</strong></span>
                        {p.model && <span>• Model: <strong>{p.model}</strong></span>}
                        <span>• Category: <strong>{p.category}</strong></span>
                        {p.productCode && <span className="font-mono text-slate-400">({p.productCode})</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold font-mono text-slate-900">
                        ₹{Number(p.cost || 0).toFixed(2)}
                      </div>
                      {Number(p.mrp) > 0 && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          MRP: ₹{Number(p.mrp).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Click an IMEI product to insert into the last editable line</span>
              <button
                type="button"
                onClick={() => setIsCatalogSearchOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      

      {/* Bulk Paste Modal */}
      {bulkPasteModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Clipboard className="w-4 h-4 text-slate-500" />
                Bulk Paste IMEIs ({items[bulkPasteModal.productIndex]?.quantity || 1} units)
              </h3>
              <button
                type="button"
                onClick={() => setBulkPasteModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Paste IMEIs separated by newlines, commas, or spaces.
            </p>
            <textarea
              value={bulkPasteModal.text}
              onChange={(e) => setBulkPasteModal({ ...bulkPasteModal, text: e.target.value })}
              rows={7}
              placeholder="354892091234567&#10;354892091234568&#10;354892091234569"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono uppercase focus:border-slate-900 focus:ring-1 focus:ring-slate-900 outline-none"
              autoFocus
            />
            <div className="mt-2 text-xs text-slate-500 flex justify-between items-center">
              <span>
                Detected: <strong className="font-mono text-slate-900">{bulkPasteModal.text.split(/[\r\n,;\t\s]+/).filter(Boolean).length}</strong> / {items[bulkPasteModal.productIndex]?.quantity || 1} units
              </span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkPasteModal(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkPasteApply}
                className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-2xs transition-colors"
              >
                Apply IMEIs
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Product Search Dropdown Portal */}
      {isDropdownOpen && selectedRowIndex !== null && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', left: dropdownPosition.left, top: dropdownPosition.top, width: dropdownPosition.width, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-lg shadow-2xl max-h-80 overflow-y-auto"
          role="listbox"
          aria-label="Product search results"
        >
          {searching ? (
            <div className="p-4 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-sm text-gray-600 mt-2">Searching...</p>
            </div>
          ) : searchResults.length > 0 ? (
            <div>
              {searchResults.map((product) => (
                <div
                  key={product.id}
                  role="option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectProduct(product, selectedRowIndex);
                  }}
                  className="px-3 py-2 border-b border-gray-100 cursor-pointer hover:bg-blue-50"
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{product.name}</span>
                    <span className="text-xs font-mono text-blue-600 whitespace-nowrap">{product.productCode}</span>
                  </div>
                  <div className="flex justify-between items-center mt-1 text-xs text-gray-500 gap-2">
                    <span className="truncate max-w-[55%]">{product.brand} {product.model}</span>
                    <span className="font-mono text-blue-600 truncate max-w-[30%]">{product.imei}</span>
                    <span className="font-semibold text-gray-900 whitespace-nowrap">₹{product.cost}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-gray-600">No products found</div>
          )}
        </div>,
        document.body
      )}

      {/* Multi-Step Loader */}
      <MultiStepLoader
        loadingStates={loadingStates}
        loading={multiStepLoading}
        duration={500}
        loop={false}
      />
    </div>
  );
};

export default AddPurchaseIMEI;
