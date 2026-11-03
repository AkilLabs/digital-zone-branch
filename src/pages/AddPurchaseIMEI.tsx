import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import { Package, DollarSign, Plus, Trash2, ShoppingCart, User, Save } from 'lucide-react';
import type { Purchase, PurchaseItem, Supplier, PaymentMode, PaymentSplit, Product, Brand, Category } from '../types';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, increment, Timestamp, orderBy, limit, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateIMEIProductCode } from '../utils/productCode';
import { encodePrice, decodePrice } from '../utils/secretCode';
import { MultiStepLoader } from '../components/ui/multi-step-loader';
import SearchableSelect from '../components/SearchableSelect';
import * as XLSX from 'xlsx';

const getInitialItem = (): PurchaseItem => ({
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
  taxPercent: 0,
  highestDiscountLimit: 0
});

const getInitialSupplierForm = () => ({
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  gstNumber: ''
});

const AddPurchaseIMEI: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef } = useStore();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [originalPurchase, setOriginalPurchase] = useState<any>(null);
  const { showToast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedSupplierName, setSelectedSupplierName] = useState('');

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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);

  const [multiStepLoading, setMultiStepLoading] = useState(false);
  const [loadingStates, setLoadingStates] = useState<Array<{ text: string }>>([]);

  const [newSupplier, setNewSupplier] = useState(getInitialSupplierForm());
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const importFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; field: string; value: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
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
    setShowSupplierForm(false);
  };


  useEffect(() => {
    fetchSuppliers();
    fetchBrandsAndCategories();

    if (isEditMode) {
      fetchPurchaseForEdit();
    } else {
      const savedDraft = localStorage.getItem('addPurchaseIMEIDraft');

    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        if (draft.selectedSupplierId) setSelectedSupplierId(draft.selectedSupplierId);
        if (draft.selectedSupplierName) setSelectedSupplierName(draft.selectedSupplierName);
        if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber);
        if (draft.notes) setNotes(draft.notes);
        if (draft.paymentMode) setPaymentMode(draft.paymentMode);
        if (draft.paidAmount) setPaidAmount(draft.paidAmount);
        if (draft.cashAmount) setCashAmount(draft.cashAmount);
        if (draft.upiAmount) setUpiAmount(draft.upiAmount);
        if (draft.cardAmount) setCardAmount(draft.cardAmount);
        if (draft.items && draft.items.length > 0) {
          setItems(
            (draft.items as PurchaseItem[]).map((item) => ({
              ...getInitialItem(),
              ...item,
              quantity: 1,
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

        showToast('Draft restored', 'info');
      } catch (error) {
        console.error('Error restoring draft:', error);
      }
    }
    }
  }, [id, isEditMode]);

  const fetchPurchaseForEdit = async () => {
    if (!id) return;
    try {
      // Check imeiPurchases first, fallback to purchases
      let docRef = getDocRef('imeiPurchases', id);
      let docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        const rootImei = doc(db, 'imeiPurchases', id);
        const rootSnap = await getDoc(rootImei);
        if (rootSnap.exists()) {
          docRef = rootImei;
          docSnap = rootSnap;
        } else {
          const legacyStore = getDocRef('purchases', id);
          const legacyStoreSnap = await getDoc(legacyStore);
          if (legacyStoreSnap.exists()) {
            docRef = legacyStore;
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
        setSelectedSupplierId(data.supplierId || '');
        setSelectedSupplierName(data.supplierName || '');
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
          setItems(data.items);
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
      savedAt: new Date().toISOString()
    };

    if (selectedSupplierId || items.some((item) => item.productName || item.brand || item.model || item.imei)) {
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
    items
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
      const suppliersRef = collection(db, 'suppliers');
      const q = query(suppliersRef, where('isActive', '==', true));
      const snapshot = await getDocs(q);
      const suppliersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
      suppliersList.sort((a, b) => a.name.localeCompare(b.name));
      setSuppliers(suppliersList);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      showToast('Failed to load suppliers', 'error');
    }
  };

  const handleSupplierChange = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    const supplier = suppliers.find(s => s.id === supplierId);
    setSelectedSupplierName(supplier?.name || '');
  };

  const addNewSupplier = async (e: React.FormEvent | React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!newSupplier.name.trim() || !newSupplier.phone.trim()) {
      showToast('Supplier name and phone are required', 'error');
      return;
    }
    try {
      const supplierData: Omit<Supplier, 'id'> = {
        name: newSupplier.name,
        contactPerson: newSupplier.contactPerson,
        phone: newSupplier.phone,
        email: newSupplier.email,
        address: newSupplier.address,
        gstNumber: newSupplier.gstNumber,
        totalPurchaseAmount: 0,
        totalPaid: 0,
        totalPending: 0,
        isActive: true,
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || ''
      };
      const docRef = await addDoc(collection(db, 'suppliers'), supplierData);
      showToast('Supplier added successfully!', 'success');
      setShowSupplierForm(false);
      setNewSupplier(getInitialSupplierForm());
      await fetchSuppliers();
      setSelectedSupplierId(docRef.id);
      setSelectedSupplierName(supplierData.name);
    } catch (error) {
      console.error('Error adding supplier:', error);
      showToast('Failed to add supplier', 'error');
    }
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: string | number) => {
    const newItems = [...items];
    let processedValue = value;
    if (typeof value === 'string' && ['brand', 'model', 'category', 'imei', 'hcsCode'].includes(field)) {
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
      const qty = Number(newItems[index].quantity) || 1;
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
      const snapshot = await getDocs(getCollectionRef('products'));
      const qLower = queryText.toLowerCase();

      const products = snapshot.docs.map(docSnap => {
        const data: any = docSnap.data();
        return {
          id: docSnap.id,
          productCode: data.productCode || '',
          hcsCode: data.hcsCode,
          name: data.name || '',
          model: data.model || '',
          cost: Number(data.cost) || 0,
          mrp: Number(data.mrp) || 0,
          brand: data.brand || '',
          category: data.category || '',
          paymentType: data.paymentType || 'cash',
          supplier: data.supplier,
          quantity: Number(data.quantity) || 0,
          isAvailable: data.isAvailable,
          imageUrl: data.imageUrl,
          createdAt: data.createdAt?.toDate?.() || new Date(),
          createdBy: data.createdBy || '',
          createdByName: data.createdByName,
          updatedAt: data.updatedAt?.toDate?.() || undefined,
          imei: data.imei,
          sourcePurchaseId: data.sourcePurchaseId,
          storeId: data.storeId,
          mop: data.mop,
          taxPercent: data.taxPercent,
          highestDiscountLimit: data.highestDiscountLimit,
          gstEnabled: data.gstEnabled
        } as Product;
      });

      const filtered = products.filter(product => {
        if (!product.imei || !String(product.imei).trim()) return false;

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

  const selectProduct = (product: Product, rowIndex: number) => {
    const currentItem = items[rowIndex];
    const qty = Number(currentItem.quantity) || 1;

    const selectedRow = {
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
      totalCost: (Number(product.cost) || 0) * qty
    };

    if (qty > 1) {
      bulkSplitItem(rowIndex, selectedRow, 0);
    } else {
      const newItems = [...items];
      newItems[rowIndex] = selectedRow;
      setItems(newItems);
    }
    setSelectedRowIndex(rowIndex);
    setSearchQuery(product.name || '');
    setIsDropdownOpen(false);
    setSearchResults([]);

    if (qty <= 1) {
      window.setTimeout(() => {
        (document.querySelector(`[data-row="${rowIndex}"][data-col="0"]`) as HTMLElement | null)?.focus();
      }, 50);
    }
  };

  const openProductSearch = (rowIndex: number) => {
    const currentName = items[rowIndex]?.productName || '';
    setSelectedRowIndex(rowIndex);
    setSearchQuery(currentName);
    setIsDropdownOpen(true);
    searchProducts(currentName);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen) return;

    if (e.key === 'Escape') {
      setIsDropdownOpen(false);
      setSelectedRowIndex(null);
    }
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

  const addItem = () => {
    const lastItem = items[items.length - 1];
    setItems([
      ...items,
      {
        ...getInitialItem(),
        productName: lastItem.productName || '',
        brand: lastItem.brand || '',
        model: lastItem.model || '',
        category: lastItem.category || '',
        costPerUnit: Number(lastItem.costPerUnit) || 0,
        totalCost: Number(lastItem.costPerUnit) || 0,
        mrp: Number(lastItem.mrp) || 0,
        hcsCode: '',
        mop: Number(lastItem.mop) || 0,
        taxPercent: Number(lastItem.taxPercent) || 0,
        highestDiscountLimit: Number(lastItem.highestDiscountLimit) || 0
      }
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;

    setItems(items.filter((_, i) => i !== index));
  };

  const bulkSplitItem = (rowIndex: number, baseItem: PurchaseItem, focusCol = 0) => {
    const qty = Math.max(1, Number(baseItem.quantity) || 1);
    const hasProductDetails = Boolean(
      baseItem.productName?.trim() ||
      baseItem.brand?.trim() ||
      baseItem.model?.trim() ||
      baseItem.category?.trim() ||
      baseItem.imei?.trim() ||
      baseItem.hcsCode?.trim() ||
      Number(baseItem.costPerUnit) > 0
    );

    if (qty <= 1) {
      showToast('Set quantity greater than 1 first', 'error');
      return false;
    }

    if (!hasProductDetails) {
      showToast('Fill the product details first', 'error');
      return false;
    }

    const bulkRows = Array.from({ length: qty }, () => ({
      ...baseItem,
      quantity: 1,
      totalCost: Number(baseItem.costPerUnit) || 0,
      imei: ''
    }));

    const nextItems = [...items];
    nextItems.splice(rowIndex, 1, ...bulkRows);
    setItems(nextItems);

    window.setTimeout(() => {
      (document.querySelector(`[data-row="${rowIndex}"][data-col="${focusCol}"]`) as HTMLElement | null)?.focus();
    }, 50);

    return true;
  };

  const getPurchaseValidationError = () => {
    if (!selectedSupplierId) {
      return 'Please select a supplier';
    }

    const incompleteRows = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.imei?.trim() || !item.brand?.trim() || Number(item.costPerUnit) <= 0);

    if (incompleteRows.length > 0) {
      const firstMissing = incompleteRows[0];
      return `Row ${firstMissing.index + 1} is missing IMEI, Brand or Cost`;
    }

    const imeiRows = new Map<string, number[]>();
    items.forEach((item, index) => {
      const imei = item.imei?.trim();
      if (!imei) return;
      const rows = imeiRows.get(imei) || [];
      rows.push(index + 1);
      imeiRows.set(imei, rows);
    });

    const duplicateEntry = Array.from(imeiRows.entries()).find(([, rows]) => rows.length > 1);
    if (duplicateEntry) {
      const [duplicateImei, rows] = duplicateEntry;
      return `Duplicate IMEI ${duplicateImei} found in rows ${rows.join(', ')}`;
    }

    return null;
  };

  const getDuplicateImeiRows = () => {
    const imeiRows = new Map<string, number[]>();

    items.forEach((item, index) => {
      const imei = item.imei?.trim();
      if (!imei) return;

      const rows = imeiRows.get(imei) || [];
      rows.push(index + 1);
      imeiRows.set(imei, rows);
    });

    return imeiRows;
  };

  const duplicateImeiRows = getDuplicateImeiRows();

  const getDuplicateImeiMessage = (rowIndex: number) => {
    const imei = items[rowIndex]?.imei?.trim();
    if (!imei) return '';

    const rows = duplicateImeiRows.get(imei) || [];
    if (rows.length <= 1) return '';

    return `Duplicate IMEI in rows ${rows.join(', ')}`;
  };

  const preflightPurchaseSave = () => {
    const validationError = getPurchaseValidationError();
    if (validationError) {
      showToast(validationError, 'error');
      return false;
    }

    return true;
  };

  const applyHcsCodeToAllRows = (sourceRowIndex: number) => {
    const sourceCode = String(items[sourceRowIndex]?.hcsCode || '').trim();
    if (!sourceCode) {
      showToast('Enter an HSN/HCS code first', 'error');
      return;
    }

    setItems(prev => prev.map(item => ({
      ...item,
      hcsCode: sourceCode
    })));
    showToast('HSN/HCS code applied to all rows', 'success');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    if ([6, 7, 8, 11, 13].includes(colIndex) && ['e', 'E', '+', '-'].includes(e.key)) {
      e.preventDefault();
      return;
    }

    if (colIndex === 1 && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') {
      e.preventDefault();
      applyHcsCodeToAllRows(rowIndex);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      if (colIndex === 0) {
        if (rowIndex === items.length - 1) {
          addItem();
          setTimeout(() => {
            (document.querySelector(`[data-row="${rowIndex + 1}"][data-col="0"]`) as HTMLElement | null)?.focus();
          }, 50);
        } else {
          (document.querySelector(`[data-row="${rowIndex + 1}"][data-col="0"]`) as HTMLElement | null)?.focus();
        }
        return;
      }

      if (colIndex === 1) {
        if (rowIndex === items.length - 1) {
          addItem();
          setTimeout(() => {
            (document.querySelector(`[data-row="${rowIndex + 1}"][data-col="1"]`) as HTMLElement | null)?.focus();
          }, 50);
        } else {
          (document.querySelector(`[data-row="${rowIndex + 1}"][data-col="1"]`) as HTMLElement | null)?.focus();
        }
        return;
      }

      const totalCols = 14;
      // Skip non-editable cols: 9 (Cost+GST/Unit), 10 (Total Cost), 11 (Profit Margin)
      const nonEditable = new Set([9, 10, 11]);
      let nextCol = colIndex === 0 ? 2 : colIndex + 1;
      while (nextCol < totalCols && nonEditable.has(nextCol)) {
        nextCol++;
      }
      if (nextCol < totalCols) {
        (document.querySelector(`[data-row="${rowIndex}"][data-col="${nextCol}"]`) as HTMLElement | null)?.focus();
      } else if (rowIndex === items.length - 1) {
        addItem();
        setTimeout(() => {
          (document.querySelector(`[data-row="${rowIndex + 1}"][data-col="0"]`) as HTMLElement | null)?.focus();
        }, 50);
      } else {
        (document.querySelector(`[data-row="${rowIndex + 1}"][data-col="0"]`) as HTMLElement | null)?.focus();
      }
    }
  };

  const calculateTotals = () => {
    const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    const totalAmount = items.reduce((sum, item) => {
      const cost = Number(item.costPerUnit) || 0;
      const qty = Number(item.quantity) || 1;
      const baseCost = cost * qty;
      const tax = Number(item.taxPercent) || 0;
      return sum + baseCost + (baseCost * tax / 100);
    }, 0);
    return { totalQuantity, totalAmount };
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
        { Field: 'Supplier', Value: selectedSupplierName || '' },
        { Field: 'Supplier ID', Value: selectedSupplierId || '' },
        { Field: 'Invoice Number', Value: invoiceNumber || '' },
        { Field: 'Notes', Value: notes || '' },
        { Field: 'Payment Mode', Value: paymentMode },
        { Field: 'Paid Amount', Value: paid },
        { Field: 'Pending Amount', Value: pending },
        { Field: 'Total Quantity', Value: totalQuantity },
        { Field: 'Total Amount', Value: totalAmount }
      ];

      const itemRows = items.map((item, index) => ({
        '#': index + 1,
        'Product Name': item.productName?.trim() || `${item.brand} ${item.model} ${item.category}`.trim() || '',
        'Brand': item.brand,
        'Model': item.model || '',
        'Category': item.category,
        'IMEI': item.imei || '',
        'Quantity': 1,
        'Cost/Unit': Number(item.costPerUnit) || 0,
        'MRP': Number(item.mrp) || Number(item.costPerUnit) || 0,
        'Total Cost': Number(item.totalCost) || Number(item.costPerUnit) || 0,
        'HCS Code': item.hcsCode || '',
        'MOP': Number(item.mop) || 0,
        'Tax %': Number(item.taxPercent) || 0,
        'Highest Discount Limit': Number(item.highestDiscountLimit) || 0
      }));

      const wb = XLSX.utils.book_new();
      const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
      const itemsWs = XLSX.utils.json_to_sheet(itemRows);

      XLSX.utils.book_append_sheet(wb, summaryWs, 'Purchase Summary');
      XLSX.utils.book_append_sheet(wb, itemsWs, 'Purchase Items');

      const datePart = new Date().toISOString().split('T')[0];
      const supplierPart = (selectedSupplierName || 'imei_purchase').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      XLSX.writeFile(wb, `imei_purchase_${supplierPart}_${datePart}.xlsx`);
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
      const itemsSheetName = workbook.SheetNames.find(name => normalizeHeader(name) === 'purchase items') || workbook.SheetNames[0];

      if (!itemsSheetName) {
        showToast('No items sheet found in the Excel file', 'error');
        return;
      }

      if (summarySheetName) {
        const summaryRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[summarySheetName], { defval: '' });
        const summaryMap = new Map(summaryRows.map(row => [normalizeHeader(row.Field), row.Value]));

        const supplierName = toText(summaryMap.get('supplier'));
        const supplierId = toText(summaryMap.get('supplier id'));
        const invoice = toText(summaryMap.get('invoice number'));
        const noteValue = toText(summaryMap.get('notes'));
        const payment = toText(summaryMap.get('payment mode')).toLowerCase() as PaymentMode;
        const paid = toText(summaryMap.get('paid amount'));
        const cash = toText(summaryMap.get('cash amount'));
        const upi = toText(summaryMap.get('upi amount'));
        const card = toText(summaryMap.get('card amount'));

        if (supplierName) setSelectedSupplierName(supplierName);
        if (supplierId) setSelectedSupplierId(supplierId);
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

      const importedItems = rows.map((row) => {
        const brand = toText(getCellValue(row, ['brand']));
        const model = toText(getCellValue(row, ['model']));
        const category = toText(getCellValue(row, ['category']));
        const imei = toText(getCellValue(row, ['imei']));
        const hcsCode = toText(getCellValue(row, ['hcs code', 'hcscode']));
        const productName = toText(getCellValue(row, ['product name', 'name'])) || `${brand} ${model} ${category}`.trim() || imei || 'IMPORTED ITEM';
        // quantity is always 1 for IMEI purchases
        const costPerUnit = toNumber(getCellValue(row, ['cost/unit', 'cost per unit', 'cost']));
        const mrp = toNumber(getCellValue(row, ['mrp']));
        const totalCost = toNumber(getCellValue(row, ['total cost', 'total']));
        const mop = toNumber(getCellValue(row, ['mop']));
        const taxPercent = toNumber(getCellValue(row, ['tax %', 'tax', 'tax percent']));
        const highestDiscountLimit = toNumber(getCellValue(row, ['highest discount limit', 'discount limit']));

        return {
          ...getInitialItem(),
          productName,
          brand,
          model,
          category,
          imei,
          hcsCode,
          quantity: 1,
          costPerUnit,
          totalCost: totalCost > 0 ? totalCost : costPerUnit,
          mrp: mrp > 0 ? mrp : costPerUnit,
          mop,
          taxPercent,
          highestDiscountLimit
        } as PurchaseItem;
      });

      setItems(importedItems);
      showToast(`Imported ${importedItems.length} item${importedItems.length === 1 ? '' : 's'} from Excel`, 'success');
    } catch (error) {
      console.error('Error importing IMEI Excel file:', error);
      showToast('Failed to import Excel file', 'error');
    }
  };

  const generatePurchaseNumber = async () => {
    try {
      const imeiPurchasesRef = getCollectionRef('imeiPurchases');
      const purchasesRef = getCollectionRef('purchases');
      
      // Query the latest purchases to determine the next sequential number
      // Query the latest imei purchases first, fallback to legacy purchases
      let snapshot = await getDocs(query(imeiPurchasesRef, orderBy('createdAt', 'desc'), limit(20)));
      if (snapshot.empty) {
        snapshot = await getDocs(query(purchasesRef, orderBy('createdAt', 'desc'), limit(50)));
      }


      let nextNumber = 1;
      if (!snapshot.empty) {
        // Find the latest document that has a valid purchaseNumber containing digits
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data() as Purchase;
          const purchaseNum = data.purchaseNumber || '';
          // Extract the numeric part at the end
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

      // Collision/concurrency guard: check if the candidate number is already used in the database
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
      // Absolute fallback using timestamp to ensure uniqueness and prevent failure
      return `PUR-IMEI-${Date.now()}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preflightPurchaseSave()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const { totalQuantity, totalAmount } = calculateTotals();
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

        if (Math.abs((cash + upi + card) - paid) > 0.009) {
          showToast('Payment split amounts must equal paid amount', 'error');
          setIsSubmitting(false);
          return;
        }

        paymentSplit = { cash, upi, card };
      }

      const purchaseNumber = await generatePurchaseNumber();

      let nextProductCodeNumber: number | null = null;
      const generatedProductCodes: string[] = [];
      for (let index = 0; index < items.length; index++) {
        const origItem = (isEditMode && originalPurchase?.items && originalPurchase.items[index]) ? originalPurchase.items[index] : null;
        if (origItem && origItem.productCode) {
           generatedProductCodes.push(origItem.productCode);
        } else {
           if (nextProductCodeNumber === null) {
             const nextCode = await generateIMEIProductCode(getCollectionRef('products'));
             nextProductCodeNumber = parseInt(nextCode, 10);
           }
           generatedProductCodes.push(String(nextProductCodeNumber).padStart(8, '0'));
           nextProductCodeNumber += 1;
        }
      }

      if (isEditMode && originalPurchase) {
        setLoadingStates([{ text: 'Reverting previous purchase data...' }]);
        setMultiStepLoading(true);
        
        // Revert supplier totals
        const supplierRef = doc(db, 'suppliers', originalPurchase.supplierId);
        await updateDoc(supplierRef, {
          totalPurchaseAmount: increment(-originalPurchase.totalAmount),
          totalPaid: increment(-originalPurchase.paidAmount),
          totalPending: increment(-originalPurchase.pendingAmount)
        });

        // Revert inventory quantities
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

        // Delete previous payment records
        const paymentsRef = collection(db, 'supplierPayments');
        const qPayments = query(paymentsRef, where('relatedPurchaseId', '==', id));
        const paymentSnap = await getDocs(qPayments);
        for (const pDoc of paymentSnap.docs) {
          await deleteDoc(doc(db, 'supplierPayments', pDoc.id));
        }
      }

      setLoadingStates([
        { text: 'Validating IMEIs and payment...' },
        ...items.map((item, index) => ({ text: `Saving unit ${index + 1} (${item.imei || 'pending IMEI'})...` })),
        { text: 'Updating supplier totals...' },
        { text: 'Finalizing purchase...' },
        { text: '✓ Purchase saved successfully!' }
      ]);
      setMultiStepLoading(true);

      const purchaseData: any = {
        purchaseNumber,
        supplierId: selectedSupplierId,
        supplierName: selectedSupplierName,
        items: items.map((it, index) => {
          const qty = Number(it.quantity) || 1;
          const baseCost = (Number(it.costPerUnit) || 0) * qty;
          const taxPct = Number(it.taxPercent) || 0;
          const costWithGst = baseCost + (baseCost * taxPct / 100);
          return {
          ...it,
          quantity: qty,
          baseCost,
          totalCost: costWithGst,
          costPerUnit: costWithGst,
          mrp: Number(it.mrp) || costWithGst,
          productCode: generatedProductCodes[index] || '',
          hcsCode: it.hcsCode || '',
          mop: Number(it.mop) || 0,
          taxPercent: taxPct,
          gstEnabled: taxPct > 0,
          highestDiscountLimit: Number(it.highestDiscountLimit) || 0
        };}),
        totalQuantity,
        totalAmount,
        paidAmount: paid,
        pendingAmount: pending,
        paymentMode,
        paymentStatus,
        isCredit: paymentMode === 'credit',
        creditCleared: 0,
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || '',
        isIMEIPurchase: true
      };

      if (paymentSplit) purchaseData.paymentSplit = paymentSplit;
      if (invoiceNumber.trim()) purchaseData.invoiceNumber = invoiceNumber.trim();
      if (notes.trim()) purchaseData.notes = notes.trim();

      let purchaseRefId = '';
      if (isEditMode && id) {
        let purchaseRef = getDocRef('imeiPurchases', id);
        const checkSnap = await getDoc(purchaseRef);
        if (!checkSnap.exists()) {
          const rootCheck = doc(db, 'imeiPurchases', id);
          if ((await getDoc(rootCheck)).exists()) {
            purchaseRef = rootCheck;
          } else {
            const legacyStore = getDocRef('purchases', id);
            if ((await getDoc(legacyStore)).exists()) {
              purchaseRef = legacyStore;
            } else {
              purchaseRef = doc(db, 'purchases', id);
            }
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
        const purchaseRef = await addDoc(getCollectionRef('imeiPurchases'), purchaseData);
        purchaseRefId = purchaseRef.id;
      }

      await addDoc(collection(db, 'supplierPayments'), {
        supplierId: selectedSupplierId,
        supplierName: selectedSupplierName,
        amount: totalAmount,
        type: 'purchase',
        paymentMode,
        notes: `Purchase #${purchaseNumber}${notes.trim() ? ` - ${notes.trim()}` : ''}`,
        relatedPurchaseId: purchaseRefId,
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || ''
      });

      if (paid > 0) {
        const paymentRecord: any = {
          supplierId: selectedSupplierId,
          supplierName: selectedSupplierName,
          amount: paid,
          type: 'payment_out',
          paymentMode,
          notes: `Payment for Purchase #${purchaseNumber}`,
          relatedPurchaseId: purchaseRefId,
          createdAt: new Date(),
          createdBy: currentUser?.uid || '',
          createdByName: currentUser?.displayName || ''
        };

        if (paymentSplit) paymentRecord.paymentSplit = paymentSplit;

        await addDoc(collection(db, 'supplierPayments'), paymentRecord);
      }

      // Update supplier totals
      await updateDoc(doc(db, 'suppliers', selectedSupplierId), {
        totalPurchaseAmount: increment(totalAmount),
        totalPaid: increment(paid),
        totalPending: increment(pending),
        updatedAt: Timestamp.now()
      });

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const productCode = generatedProductCodes[i] || '';
        const pName =
          item.productName?.trim() ||
          `${item.brand} ${item.model} ${item.category}`.trim() ||
          item.imei?.trim() ||
          'UNNAMED PRODUCT';
          
        const costWithGst = (() => { const bc = Number(item.costPerUnit) || 0; const tp = Number(item.taxPercent) || 0; return bc + (bc * tp / 100); })();
        const productData = {
          productCode,
          hcsCode: item.hcsCode || '',
          imei: item.imei,
          name: pName,
          brand: item.brand,
          model: item.model,
          category: item.category,
          cost: costWithGst,
          baseCost: Number(item.costPerUnit) || 0,
          mrp: Number(item.mrp) || Number(item.costPerUnit) || 0,
          mop: Number(item.mop) || 0,
          taxPercent: Number(item.taxPercent) || 0,
          gstEnabled: (Number(item.taxPercent) || 0) > 0,
          highestDiscountLimit: Number(item.highestDiscountLimit) || 0,
          isAvailable: true,
          supplier: selectedSupplierName,
          paymentType: 'cash'
        };

        const productsRef = getCollectionRef('products');
        // Check by both productCode and IMEI if the item has an IMEI, to prevent merging separate physical devices
        const q = item.imei?.trim()
          ? query(productsRef, where('productCode', '==', productCode), where('imei', '==', item.imei.trim()))
          : query(productsRef, where('productCode', '==', productCode));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const productDoc = snapshot.docs[0];
          await updateDoc(doc(db, 'products', productDoc.id), {
            ...productData,
            quantity: increment(Number(item.quantity) || 1),
            updatedAt: Timestamp.now(),
            updatedBy: currentUser?.uid || ''
          });
        } else {
          await addDoc(getCollectionRef('products'), {
            ...productData,
            quantity: Number(item.quantity) || 1,
            sourcePurchaseId: purchaseRefId,
            createdAt: Timestamp.now(),
            createdBy: currentUser?.uid || '',
            createdByName: currentUser?.displayName || ''
          });
        }
      }

      showToast(`Purchase ${purchaseNumber} ${isEditMode ? 'updated' : 'added'} successfully!`, 'success');
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

  const handleSaveButtonClick = () => {
    if (isSubmitting) return;
    if (!preflightPurchaseSave()) return;
    void handleSubmit({ preventDefault: () => undefined } as React.FormEvent);
  };

  const purchaseValidationError = getPurchaseValidationError();

  const { totalQuantity, totalAmount } = calculateTotals();
  const effectivePaidAmount = paymentMode === 'credit' ? 0 : (parseFloat(paidAmount) || 0);
  const pendingAmount = totalAmount - effectivePaidAmount;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <style>{`
        /* Hide number input spinners (Chrome, Edge, Safari) */
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        /* Hide number input spinners in Firefox */
        input[type=number] {
          -moz-appearance: textfield;
        }
      `}</style>
      <div className="max-w-full mx-auto px-2 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 sm:pb-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                <ShoppingCart className="w-7 h-7 sm:w-8 sm:h-8 text-blue-600" />
                Add Purchase (IMEI Entry)
              </h1>
              <p className="text-gray-600 mt-1">{isEditMode ? 'Edit an existing IMEI purchase' : 'Enter each mobile unit with its unique IMEI'}</p>
            </div>

            {/* Auto-save Status & Clear Draft */}
            <div className="flex flex-col items-end gap-2">
              {!isEditMode && lastSaved && (
                <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Draft saved at {lastSaved}
                </div>
              )}
              {!isEditMode && lastSaved && (
                <button
                  type="button"
                  onClick={clearDraft}
                  className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-md transition-colors font-medium"
                >
                  Clear Draft
                </button>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => importFileInputRef.current?.click()}
                  className="text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 px-2 py-1 rounded-md transition-colors font-medium border border-emerald-200"
                >
                  Import Excel
                </button>
                <button
                  type="button"
                  onClick={exportToExcel}
                  className="text-xs text-blue-700 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded-md transition-colors font-medium border border-blue-200"
                >
                  Export Excel
                </button>
              </div>
            </div>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={importFromExcel}
            />
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Supplier Selection */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" />
                Supplier Information
              </h2>
              <button
                type="button"
                onClick={() => setShowSupplierForm(!showSupplierForm)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                {showSupplierForm ? 'Cancel' : 'New Supplier'}
              </button>
            </div>

            {showSupplierForm ? (
              <div className="space-y-4 border-t pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Supplier Name *
                    </label>
                    <input
                      type="text"
                      value={newSupplier.name}
                      onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contact Person
                    </label>
                    <input
                      type="text"
                      value={newSupplier.contactPerson}
                      onChange={(e) => setNewSupplier({ ...newSupplier, contactPerson: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      value={newSupplier.phone}
                      onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={newSupplier.email}
                      onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      GST Number
                    </label>
                    <input
                      type="text"
                      value={newSupplier.gstNumber}
                      onChange={(e) => setNewSupplier({ ...newSupplier, gstNumber: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Address
                    </label>
                    <input
                      type="text"
                      value={newSupplier.address}
                      onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addNewSupplier}
                  className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Add Supplier
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Supplier *
                  </label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => handleSupplierChange(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="">Choose a supplier</option>
                    {suppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name} - {supplier.phone}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Invoice Number
                  </label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Supplier's invoice number"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Product Items - Excel-like Table */}
          <div className="bg-white shadow-sm border-y border-gray-200 p-3 sm:p-6 w-screen ml-[calc(50%-50vw)]">
            <div className="flex items-center justify-between mb-4 max-w-full mx-auto px-2 sm:px-6 lg:px-8">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-600" />
                Product Units
              </h2>
            </div>

            {/* Mobile View: Item Cards */}
            <div className="block sm:hidden space-y-4 mb-4 px-2 sm:px-6 lg:px-8">
              {items.map((item, rowIndex) => {
                const cost = Number(item.costPerUnit) || 0;
                const qty = Number(item.quantity) || 1;
                const tax = Number(item.taxPercent) || 0;
                const costWithGstPerUnit = cost + (cost * tax / 100);
                const totalCostWithGst = costWithGstPerUnit * qty;
                const mrpVal = Number(item.mrp) || 0;
                const profitMargin = mrpVal - costWithGstPerUnit;
                return (
                <div key={rowIndex} className="bg-gray-50 rounded-lg p-3 border border-gray-200 relative shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500">#{rowIndex + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeItem(rowIndex)}
                          className={`text-red-500 bg-white p-1 rounded-full border border-gray-200 ${items.length <= 1 ? 'hidden' : ''}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-gray-400 uppercase font-medium">Total</span>
                      <span className="text-sm font-bold text-green-600">{encodePrice(Number(item.costPerUnit) || 0)}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Product Name Search */}
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Product Name</label>
                      <div className="relative w-full" ref={selectedRowIndex === rowIndex ? searchContainerRef : undefined}>
                        <div className="relative">
                          <input
                            type="text"
                            value={item.productName || `${item.brand} ${item.model} ${item.category}`.trim()}
                            onChange={(e) => {
                              const value = e.target.value;
                              handleItemChange(rowIndex, 'productName', value);
                              setSelectedRowIndex(rowIndex);
                              setSearchQuery(value);
                              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                              searchDebounceRef.current = window.setTimeout(() => {
                                searchProducts(value);
                              }, 250);
                            }}
                            onFocus={() => {
                              setSelectedRowIndex(rowIndex);
                              if (searchQuery.trim()) setIsDropdownOpen(true);
                            }}
                            onKeyDown={handleSearchKeyDown}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                            placeholder="Search product..."
                          />
                          <button
                            type="button"
                            onClick={() => openProductSearch(rowIndex)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600"
                          >
                            <Package size={16} />
                          </button>

                        </div>
                      </div>
                    </div>

                    {/* IMEI Field */}
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">IMEI *</label>
                      <input
                        type="text"
                        value={item.imei || ''}
                        onChange={(e) => handleItemChange(rowIndex, 'imei', e.target.value)}
                        className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-mono uppercase ${getDuplicateImeiMessage(rowIndex) ? 'border-red-400 focus:ring-red-500' : 'border-gray-300'}`}
                        placeholder="SCAN IMEI"
                      />
                      {getDuplicateImeiMessage(rowIndex) && (
                        <p className="mt-1 text-[10px] font-semibold text-red-600">
                          {getDuplicateImeiMessage(rowIndex)}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">HCS Code</label>
                      <input
                        type="text"
                        value={item.hcsCode || ''}
                        onChange={(e) => handleItemChange(rowIndex, 'hcsCode', e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, rowIndex, 1)}
                        data-row={rowIndex}
                        data-col={1}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-mono uppercase"
                        placeholder="HCS CODE"
                      />
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                        <span>Enter = next row</span>
                        <button
                          type="button"
                          onClick={() => applyHcsCodeToAllRows(rowIndex)}
                          className="text-blue-600 font-semibold hover:text-blue-700"
                        >
                          Apply to all
                        </button>
                      </div>
                    </div>

                    {/* Product Name */}
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Product Name</label>
                      <input
                        type="text"
                        value={item.productName || `${item.brand} ${item.model} ${item.category}`.trim()}
                        disabled
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-100 text-gray-600 font-medium"
                        placeholder="Product name"
                      />
                    </div>

                    {/* Brand & Model */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Brand</label>
                        <div className="relative border border-gray-300 rounded-lg bg-white overflow-hidden">
                          <SearchableSelect
                            options={brands.map(b => ({ id: b.id || '', name: b.name }))}
                            value={item.brand}
                            onChange={(value) => handleItemChange(rowIndex, 'brand', value)}
                            placeholder="Select"
                            className="border-0! bg-transparent! py-2!"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Model</label>
                        <input
                          type="text"
                          value={item.model}
                          onChange={(e) => handleItemChange(rowIndex, 'model', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                          placeholder="mx-100"
                        />
                      </div>
                    </div>

                    {/* Category */}
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Category</label>
                      <div className="relative border border-gray-300 rounded-lg bg-white overflow-hidden">
                        <SearchableSelect
                          options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                          value={item.category}
                          onChange={(value) => handleItemChange(rowIndex, 'category', value)}
                          placeholder="Select"
                          className="border-0! bg-transparent! py-2!"
                        />
                      </div>
                    </div>

                    {/* MRP, Cost */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">MRP</label>
                        <input
                          type="number"
                          value={activeCell?.rowIndex === rowIndex && activeCell?.field === 'mrp' ? activeCell.value : (item.mrp || '')}
                          onChange={(e) => {
                            const valStr = e.target.value;
                            setActiveCell({ rowIndex, field: 'mrp', value: valStr });
                            handleItemChange(rowIndex, 'mrp', valStr === '' ? '' : parseFloat(valStr));
                          }}
                          onFocus={() => setActiveCell({ rowIndex, field: 'mrp', value: String(item.mrp || '') })}
                          onBlur={() => setActiveCell(null)}
                          className="w-full px-1 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-center bg-white"
                          step="0.01"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cost/Unit *</label>
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
                          className="w-full px-1 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-center bg-white"
                        />
                      </div>
                    </div>

                    {/* Cost+GST/Unit, Total Cost, Profit Margin (auto-computed) */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-blue-600 uppercase mb-1 block">Cost+GST/Unit</label>
                        <div className="w-full px-1 py-2 text-sm border border-blue-200 rounded-lg bg-blue-50 text-center font-medium text-blue-700">
                          {cost > 0 ? `₹${costWithGstPerUnit.toFixed(2)}` : '—'}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-amber-600 uppercase mb-1 block">Total Cost</label>
                        <div className="w-full px-1 py-2 text-sm border border-amber-200 rounded-lg bg-amber-50 text-center font-bold text-amber-700">
                          {cost > 0 ? `₹${totalCostWithGst.toFixed(2)}` : '—'}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-green-600 uppercase mb-1 block">Profit</label>
                        <div className={`w-full px-1 py-2 text-sm border rounded-lg text-center font-semibold ${profitMargin > 0 ? 'border-green-200 bg-green-50 text-green-700' : profitMargin < 0 ? 'border-red-200 bg-red-50 text-red-600' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                          {mrpVal > 0 && cost > 0 ? `₹${profitMargin.toFixed(2)}` : '—'}
                        </div>
                      </div>
                    </div>

                    {/* MOP, Tax% */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">MOP (₹)</label>
                        <input
                          type="number"
                          value={item.mop || ''}
                          onChange={(e) => handleItemChange(rowIndex, 'mop', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-center bg-white"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Tax %</label>
                        <select
                          value={item.taxPercent || 0}
                          onChange={(e) => handleItemChange(rowIndex, 'taxPercent', parseInt(e.target.value))}
                          className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          <option value={0}>0%</option>
                          <option value={9}>9%</option>
                          <option value={18}>18%</option>
                          <option value={27}>27%</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            {/* Desktop View: Table */}
            <div className="hidden sm:block overflow-x-auto overflow-y-visible">
              <table className="w-full border-collapse border-y border-gray-300">
                <thead>
                  <tr className="bg-linear-to-r from-blue-50 to-indigo-50">
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-8">#</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[150px]">IMEI *</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[150px]">HCS Code</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[180px]">Product Name</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[120px]">Brand *</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[120px]">Model</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[120px]">Category *</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32">MRP (₹)</th>
                    <th className="border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-gray-700 w-16">Qty</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32">Cost/Unit *</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32 bg-blue-50/50">Cost+GST/Unit</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-36 bg-amber-50/50">Total Cost</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32 bg-green-50/50">Profit Margin</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32">MOP (₹)</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-28">Tax %</th>
                    <th className="border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-gray-700 w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, rowIndex) => {
                    const cost = Number(item.costPerUnit) || 0;
                    const qty = Number(item.quantity) || 1;
                    const tax = Number(item.taxPercent) || 0;
                    const costWithGstPerUnit = cost + (cost * tax / 100);
                    const totalCostWithGst = costWithGstPerUnit * qty;
                    const mrpVal = Number(item.mrp) || 0;
                    const profitMargin = mrpVal - costWithGstPerUnit;
                    return (
                    <tr key={rowIndex} className="hover:bg-blue-50 transition-colors">
                      <td className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-600 bg-gray-50">
                        {rowIndex + 1}
                      </td>
                      <td className="border border-gray-300 p-0">
                        <div className="flex flex-col">
                        <input 
                          value={item.imei} 
                          onChange={e => handleItemChange(rowIndex, 'imei', e.target.value)}
                          onKeyDown={e => handleKeyDown(e, rowIndex, 0)}
                          data-row={rowIndex} data-col={0}
                          className={`w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:outline-none bg-transparent uppercase font-mono ${getDuplicateImeiMessage(rowIndex) ? 'ring-2 ring-red-500' : 'focus:ring-blue-500'}`}
                          placeholder="SCAN IMEI"
                        />
                        {getDuplicateImeiMessage(rowIndex) && (
                          <div className="px-3 pb-1 text-[10px] font-semibold text-red-600">
                            {getDuplicateImeiMessage(rowIndex)}
                          </div>
                        )}
                        </div>
                      </td>
                      <td className="border border-gray-300 p-0">
                        <input
                          value={item.hcsCode || ''}
                          onChange={e => handleItemChange(rowIndex, 'hcsCode', e.target.value)}
                          onKeyDown={e => handleKeyDown(e, rowIndex, 1)}
                          data-row={rowIndex} data-col={1}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent uppercase font-mono"
                          placeholder="HCS CODE"
                        />
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 bg-gray-50">
                        <div className="relative w-full" ref={selectedRowIndex === rowIndex ? searchContainerRef : undefined}>
                          <input
                            type="text"
                            value={item.productName || `${item.brand} ${item.model} ${item.category}`.trim()}
                            onChange={(e) => {
                              const value = e.target.value;
                              handleItemChange(rowIndex, 'productName', value);
                              setSelectedRowIndex(rowIndex);
                              setSearchQuery(value);
                              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                              searchDebounceRef.current = window.setTimeout(() => {
                                searchProducts(value);
                              }, 250);
                            }}
                            onFocus={() => {
                              setSelectedRowIndex(rowIndex);
                              if (searchQuery.trim()) setIsDropdownOpen(true);
                            }}
                            onKeyDown={handleSearchKeyDown}
                            data-row={rowIndex}
                            data-col={2}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 font-medium"
                            placeholder="Search product..."
                          />
                          <button
                            type="button"
                            onClick={() => openProductSearch(rowIndex)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600"
                            title="Search existing product"
                          >
                            <Package className="w-4 h-4" />
                          </button>

                        </div>
                      </td>
                      <td className="border border-gray-300 p-0">
                        <SearchableSelect
                          options={brands.map(b => ({ id: b.id || '', name: b.name }))}
                          value={item.brand}
                          onChange={(value) => handleItemChange(rowIndex, 'brand', value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 3)}
                          data-row={rowIndex}
                          data-col={3}
                          placeholder="Select Brand"
                        />
                      </td>
                      <td className="border border-gray-300 p-0">
                        <input
                          type="text"
                          value={item.model}
                          onChange={(e) => handleItemChange(rowIndex, 'model', e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 4)}
                          data-row={rowIndex}
                          data-col={4}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent"
                          placeholder="Model"
                        />
                      </td>
                      <td className="border border-gray-300 p-0">
                        <SearchableSelect
                          options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                          value={item.category}
                          onChange={(value) => handleItemChange(rowIndex, 'category', value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 5)}
                          data-row={rowIndex}
                          data-col={5}
                          placeholder="Select Category"
                        />
                      </td>
                      {/* MRP */}
                      <td className="border border-gray-300 p-0">
                        <input
                          type="number"
                          value={activeCell?.rowIndex === rowIndex && activeCell?.field === 'mrp' ? activeCell.value : (item.mrp || '')}
                          onChange={(e) => {
                            const valStr = e.target.value;
                            setActiveCell({ rowIndex, field: 'mrp', value: valStr });
                            handleItemChange(rowIndex, 'mrp', valStr === '' ? '' : parseFloat(valStr));
                          }}
                          onFocus={(e) => {
                            e.target.select();
                            setActiveCell({ rowIndex, field: 'mrp', value: String(item.mrp || '') });
                          }}
                          onBlur={() => {
                            setActiveCell(null);
                            if ((item.mrp as any) === '' || item.mrp === undefined) {
                              handleItemChange(rowIndex, 'mrp', 0);
                            }
                          }}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 6)}
                          data-row={rowIndex}
                          data-col={6}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent text-right"
                          step="0.01"
                          min="0"
                        />
                      </td>
                      {/* Qty */}
                      <td className="border border-gray-300 p-0">
                        <input
                          type="number"
                          value={item.quantity || 1}
                          onChange={(e) => handleItemChange(rowIndex, 'quantity', e.target.value === '' ? 1 : parseInt(e.target.value) || 1)}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 7)}
                          data-row={rowIndex}
                          data-col={7}
                          className="w-full px-2 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent text-center"
                          step="1"
                          min="1"
                        />
                      </td>
                      {/* Cost/Unit */}
                      <td className="border border-gray-300 p-0">
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
                          onFocus={(e) => {
                            e.target.select();
                            setActiveCell({ rowIndex, field: 'costPerUnit', value: item.costPerUnit === 0 ? '' : encodePrice(item.costPerUnit) });
                          }}
                          onBlur={() => {
                            setActiveCell(null);
                            if ((item.costPerUnit as any) === '' || item.costPerUnit === undefined) {
                              handleItemChange(rowIndex, 'costPerUnit', 0);
                            }
                          }}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 8)}
                          data-row={rowIndex}
                          data-col={8}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent text-right"
                          required
                        />
                      </td>
                      {/* Cost+GST per unit (auto-computed) */}
                      <td className="border border-gray-300 px-3 py-2 text-sm text-right font-medium text-blue-700 bg-blue-50/30">
                        {cost > 0 ? `₹${costWithGstPerUnit.toFixed(2)}` : '—'}
                      </td>
                      {/* Total Cost = Cost+GST × Qty (auto-computed) */}
                      <td className="border border-gray-300 px-3 py-2 text-sm text-right font-bold text-amber-700 bg-amber-50/30">
                        {cost > 0 ? `₹${totalCostWithGst.toFixed(2)}` : '—'}
                      </td>
                      {/* Profit Margin (auto-computed) */}
                      <td className={`border border-gray-300 px-3 py-2 text-sm text-right font-semibold ${profitMargin > 0 ? 'text-green-700 bg-green-50/30' : profitMargin < 0 ? 'text-red-600 bg-red-50/30' : 'text-gray-500 bg-gray-50/30'}`}>
                        {mrpVal > 0 && cost > 0 ? `₹${profitMargin.toFixed(2)}` : '—'}
                      </td>
                      {/* MOP */}
                      <td className="border border-gray-300 p-0">
                        <input
                          type="number"
                          value={item.mop || ''}
                          onChange={(e) => handleItemChange(rowIndex, 'mop', e.target.value === '' ? '' : parseFloat(e.target.value))}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => {
                            if ((item.mop as any) === '' || item.mop === undefined) {
                              handleItemChange(rowIndex, 'mop', 0);
                            }
                          }}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 12)}
                          data-row={rowIndex}
                          data-col={12}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent text-right"
                          step="1"
                          min="0"
                        />
                      </td>
                      {/* Tax % */}
                      <td className="border border-gray-300 p-0">
                        <select
                          value={item.taxPercent || 0}
                          onChange={(e) => handleItemChange(rowIndex, 'taxPercent', parseInt(e.target.value))}
                          onKeyDown={(e) => handleKeyDown(e as any, rowIndex, 13)}
                          data-row={rowIndex}
                          data-col={13}
                          className="w-full px-2 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent text-center cursor-pointer"
                        >
                          <option value={0}>0%</option>
                          <option value={9}>9%</option>
                          <option value={18}>18%</option>
                          <option value={27}>27%</option>
                        </select>
                      </td>
                      <td className="border border-gray-300 px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {Number(item.quantity) > 1 && (
                            <button
                              type="button"
                              onClick={() => bulkSplitItem(rowIndex, item, 0)}
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition-colors text-[10px] font-semibold uppercase"
                              title="Split this row into single-IMEI rows"
                            >
                              Split
                            </button>
                          )}
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItem(rowIndex)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1 rounded transition-colors"
                              title="Delete row"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end px-2 sm:px-6 lg:px-8">
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium border border-blue-200"
              >
                <Plus className="w-5 h-5" />
                Add New Item
              </button>
            </div>
          </div>

          {/* Payment Details */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-blue-600" />
                Payment Details
              </h2>

              {/* Quick Actions */}
              {paymentMode !== 'credit' && totalAmount > 0 && (
                <button
                  type="button"
                  onClick={() => setPaidAmount(totalAmount.toString())}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-100 transition-colors border border-blue-200"
                  title="Auto-fill with total amount"
                >
                  Fill Total
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Mode *
                </label>
                <select
                  value={paymentMode}
                  onChange={(e) => {
                    const mode = e.target.value as PaymentMode;
                    setPaymentMode(mode);
                    if (mode === 'credit') {
                      setPaidAmount('0');
                    }
                  }}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="split">Split Payment</option>
                  <option value="credit">Credit</option>
                </select>
              </div>

              {/* Show Paid Amount field only when payment mode is NOT credit */}
              {paymentMode !== 'credit' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Paid Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>
              )}

              {paymentMode === 'split' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Cash Amount (₹)
                    </label>
                    <input
                      type="number"
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      UPI Amount (₹)
                    </label>
                    <input
                      type="number"
                      value={upiAmount}
                      onChange={(e) => setUpiAmount(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Card Amount (₹)
                    </label>
                    <input
                      type="number"
                      value={cardAmount}
                      onChange={(e) => setCardAmount(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                </>
              )}

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="Additional notes about this purchase..."
                />
              </div>

              {/* Credit Payment Information */}
              {paymentMode === 'credit' && (
                <div className="sm:col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0">
                      <svg className="w-5 h-5 text-amber-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-amber-900 mb-1">Credit Purchase</h4>
                      {selectedSupplierId ? (
                        <>
                          <p className="text-sm text-amber-800 mb-2">
                            This purchase will be recorded as credit. The full amount of <strong>₹{totalAmount.toFixed(2)}</strong> will be added to the supplier's outstanding balance.
                          </p>
                          <p className="text-sm text-amber-900 font-medium mb-3">
                            💡 To make a payment for this credit purchase, go to the <strong>Suppliers page</strong> and update the paid amount there.
                          </p>
                          <button
                            type="button"
                            onClick={() => navigate('/suppliers')}
                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 transition-colors"
                          >
                            <User className="w-4 h-4" />
                            Go to Suppliers Page
                          </button>
                        </>
                      ) : (
                        <p className="text-sm text-amber-800">
                          This purchase will be recorded as credit. <strong>Please select a supplier first</strong> to proceed with credit purchase. You can manage payments later from the Suppliers page.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Summary */}
          <div className="bg-linear-to-br from-blue-50 to-indigo-50 rounded-xl shadow-sm border border-blue-200 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Purchase Summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Total Units:</span>
                <span className="font-semibold text-gray-900">{totalQuantity}</span>
              </div>
              <div className="flex justify-between items-center text-lg">
                <span className="font-medium text-gray-900">Total Amount:</span>
                <span className="font-bold text-blue-600">{encodePrice(totalAmount)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Paid Amount:</span>
                <span className="font-semibold text-green-600">₹{(effectivePaidAmount || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-blue-300">
                <span className="font-medium text-gray-900">Pending Amount:</span>
                <span className={`font-bold text-lg ${pendingAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  ₹{pendingAmount.toFixed(2)}
                </span>
              </div>

              {/* Pending Payment Helper */}
              {pendingAmount > 0 && paymentMode !== 'credit' && selectedSupplierId && (
                <div className="pt-3 mt-2 border-t border-blue-200">
                  <div className="flex items-start gap-2 text-sm text-blue-800 bg-blue-100 p-3 rounded-lg">
                    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="flex-1">
                      You can manage the remaining payment of <strong>₹{pendingAmount.toFixed(2)}</strong> from the <button type="button" onClick={() => navigate('/suppliers')} className="underline font-semibold hover:text-blue-900">Suppliers page</button> after saving this purchase.
                    </p>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Action Bar */}
          <div className="space-y-3 mt-6">
            {purchaseValidationError && !isSubmitting && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {purchaseValidationError}
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="hidden sm:flex items-center gap-4 text-sm text-gray-500">
                <span>Total Items: <strong className="text-gray-900">{items.length}</strong></span>
                <span className="text-gray-300">|</span>
                <span>Total Quantity: <strong className="text-gray-900">{totalQuantity}</strong></span>
                <span className="text-gray-300">|</span>
                <span>Grand Total: <strong className="text-blue-600 font-semibold">{encodePrice(totalAmount)}</strong></span>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => navigate('/purchases')}
                  className="w-full sm:w-auto px-5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 active:scale-[0.98] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveButtonClick}
                  disabled={isSubmitting}
                  className={`w-full sm:w-auto px-6 py-2 text-sm font-semibold text-white rounded-lg shadow-sm hover:shadow active:scale-[0.98] transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 whitespace-nowrap ${
                    isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  <Save className="w-4 h-4" />
                  <span>{isSubmitting ? 'Saving...' : 'Save Purchase'}</span>
                </button>
              </div>
            </div>
          </div>
        </form>

      </div>

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

      {/* Multi-Step Loader for Purchase Saving */}
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
