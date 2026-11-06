import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import {
  Package, DollarSign, Plus, Trash2, Save,
  Check, ArrowRight, ArrowLeft, AlertCircle, X,
  CreditCard, Banknote, QrCode, Split, Calendar, FileText, UserPlus, Phone, Hash, Truck,
  ChevronLeft, ChevronRight, CheckCircle2, Receipt, Eye, EyeOff,
  AlertTriangle, Upload, Download, Search
} from 'lucide-react';
import type { Purchase, PurchaseItem, Supplier, PaymentMode, PaymentSplit, Product, Brand, Category } from '../types';
import {
  collection, addDoc, getDocs, query, where, updateDoc, doc, increment,
  Timestamp, orderBy, limit, getDoc, deleteDoc
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateProductCode } from '../utils/productCode';
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
  mop: 0,
  hcsCode: '',
  taxPercent: defaultTax,
  highestDiscountLimit: 0
});

const AddPurchase: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentHub } = useStore();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [originalPurchase, setOriginalPurchase] = useState<any>(null);
  const { showToast } = useToast();

  // Navigation / Stepper State: 1: Supplier, 2: Products & Inventory, 3: Payment & Summary
  const [pageStep, setPageStep] = useState<1 | 2 | 3>(1);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showProductName, setShowProductName] = useState(false);
  const [showHsnCode, setShowHsnCode] = useState(false);

  // Supplier state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedSupplierName, setSelectedSupplierName] = useState('');

  // Master Data
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Invoice & Documentation
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  // Payment Settlement
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');

  const [searchParams] = useSearchParams();

  // GST Configuration
  const [isGstPurchase, setIsGstPurchase] = useState<boolean>(() => {
    return searchParams.get('gst') === 'true';
  });
  const [defaultTaxPercent, setDefaultTaxPercent] = useState<number>(18);

  // Products Table State
  const [items, setItems] = useState<PurchaseItem[]>([getInitialItem(18)]);
  const [itemIsExistingProduct, setItemIsExistingProduct] = useState<boolean[]>([false]);
  const [itemProductCodes, setItemProductCodes] = useState<string[]>(['']);
  const [itemExistingStock, setItemExistingStock] = useState<number[]>([0]);
  const [nextProductCodeNumber, setNextProductCodeNumber] = useState<number | null>(null);

  // Submission & Loader State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [multiStepLoading, setMultiStepLoading] = useState(false);
  const [loadingStates, setLoadingStates] = useState<Array<{ text: string }>>([]);

  // Product catalog modal state
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // Cell editing for encoded prices
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; field: string; value: string } | null>(null);

  // New supplier form
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    gstNumber: ''
  });

  // Draft auto-save timestamp
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    fetchSuppliers();
    fetchBrandsAndCategories();

    if (isEditMode) {
      fetchPurchaseForEdit();
    } else {
      const savedDraft = localStorage.getItem('addPurchaseDraft');
      let hasRestoredCodes = false;
      let restoredItemsLength = 1;

      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft);
          if (draft.selectedSupplierId) setSelectedSupplierId(draft.selectedSupplierId);
          if (draft.selectedSupplierName) setSelectedSupplierName(draft.selectedSupplierName);
          if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber);
          if (draft.purchaseDate) setPurchaseDate(draft.purchaseDate);
          if (draft.notes) setNotes(draft.notes);
          if (draft.paymentMode) setPaymentMode(draft.paymentMode);
          if (draft.paidAmount) setPaidAmount(draft.paidAmount);
          if (draft.cashAmount) setCashAmount(draft.cashAmount);
          if (draft.upiAmount) setUpiAmount(draft.upiAmount);
          if (draft.cardAmount) setCardAmount(draft.cardAmount);
          const urlGstParam = searchParams.get('gst');
          let effectiveGst: boolean;
          if (urlGstParam !== null) {
            effectiveGst = urlGstParam === 'true';
          } else {
            effectiveGst = draft.isGstPurchase !== undefined ? Boolean(draft.isGstPurchase) : false;
          }
          setIsGstPurchase(effectiveGst);
          if (draft.defaultTaxPercent !== undefined) setDefaultTaxPercent(Number(draft.defaultTaxPercent) || 18);
          if (draft.showProductName !== undefined) setShowProductName(Boolean(draft.showProductName));
          if (effectiveGst) {
            if (draft.showHsnCode !== undefined) {
              setShowHsnCode(Boolean(draft.showHsnCode));
            } else if (draft.items?.some((it: any) => it.hcsCode)) {
              setShowHsnCode(true);
            }
          } else {
            setShowHsnCode(false);
          }

          if (draft.items && draft.items.length > 0) {
            setItems(draft.items);
            restoredItemsLength = draft.items.length;
          }

          if (draft.itemProductCodes && draft.itemProductCodes.length === restoredItemsLength) {
            setItemProductCodes(draft.itemProductCodes);
            hasRestoredCodes = true;
          }

          if (draft.itemIsExistingProduct) {
            const isExisting = [...draft.itemIsExistingProduct];
            while (isExisting.length < restoredItemsLength) isExisting.push(false);
            setItemIsExistingProduct(isExisting);
          }

          if (draft.itemExistingStock) {
            const stock = [...draft.itemExistingStock];
            while (stock.length < restoredItemsLength) stock.push(0);
            setItemExistingStock(stock);
          }

          showToast('Purchase draft restored', 'info');
        } catch (error) {
          console.error('Error restoring purchase draft:', error);
        }
      }

      initializeProductCode(!hasRestoredCodes, restoredItemsLength);
    }
  }, [id, isEditMode]);

  // Sync GST state from URL query parameter (?gst=true/false)
  useEffect(() => {
    if (isEditMode) return;
    const gstParam = searchParams.get('gst');
    if (gstParam !== null) {
      const isGst = gstParam === 'true';
      setIsGstPurchase(isGst);
      if (!isGst) {
        setShowHsnCode(false);
      }
    }
  }, [searchParams, isEditMode]);

  const fetchPurchaseForEdit = async () => {
    if (!id) return;
    try {
      const docRef = doc(db, 'purchases', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setOriginalPurchase({ id: docSnap.id, ...data });
        setSelectedSupplierId(data.supplierId || '');
        setSelectedSupplierName(data.supplierName || '');
        setInvoiceNumber(data.invoiceNumber || '');
        if (data.purchaseDate) setPurchaseDate(data.purchaseDate);
        setNotes(data.notes || '');
        setPaymentMode(data.paymentMode || 'cash');
        setPaidAmount(data.paidAmount ? String(data.paidAmount) : '');

        if (data.paymentSplit) {
          setCashAmount(data.paymentSplit.cash ? String(data.paymentSplit.cash) : '');
          setUpiAmount(data.paymentSplit.upi ? String(data.paymentSplit.upi) : '');
          setCardAmount(data.paymentSplit.card ? String(data.paymentSplit.card) : '');
        }

        if (data.gstEnabled !== undefined) setIsGstPurchase(Boolean(data.gstEnabled));
        if (data.items && data.items.length > 0) {
          setItems(data.items.map((it: any) => ({
            ...it,
            taxPercent: Number(it.taxPercent) || (data.gstEnabled ? 18 : 0),
            costWithGst: it.costWithGst || (Number(it.costPerUnit || 0) * (1 + (Number(it.taxPercent || 0) / 100)))
          })));
          setItemProductCodes(data.items.map((i: any) => i.productCode || ''));
          setItemIsExistingProduct(data.items.map(() => true));
          setItemExistingStock(data.items.map(() => 0));
          if (data.gstEnabled && data.items.some((i: any) => i.hcsCode)) {
            setShowHsnCode(true);
          } else {
            setShowHsnCode(false);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching purchase:', error);
      showToast('Failed to load purchase for editing', 'error');
    }
  };

  // Auto-save draft
  useEffect(() => {
    if (isEditMode) return;
    const draftData = {
      selectedSupplierId,
      selectedSupplierName,
      invoiceNumber,
      purchaseDate,
      notes,
      paymentMode,
      paidAmount,
      cashAmount,
      upiAmount,
      cardAmount,
      isGstPurchase,
      defaultTaxPercent,
      showProductName,
      showHsnCode,
      items,
      itemProductCodes,
      itemIsExistingProduct,
      itemExistingStock,
      savedAt: new Date().toISOString()
    };

    if (selectedSupplierId || items.some(item => item.productName || item.brand || item.model)) {
      localStorage.setItem('addPurchaseDraft', JSON.stringify(draftData));
      setLastSaved(new Date().toLocaleTimeString());
    }
  }, [
    selectedSupplierId,
    selectedSupplierName,
    invoiceNumber,
    purchaseDate,
    notes,
    paymentMode,
    paidAmount,
    cashAmount,
    upiAmount,
    cardAmount,
    isGstPurchase,
    defaultTaxPercent,
    showProductName,
    showHsnCode,
    items,
    itemProductCodes,
    itemIsExistingProduct,
    itemExistingStock
  ]);

  const clearDraft = () => {
    localStorage.removeItem('addPurchaseDraft');
    setLastSaved(null);
    setSelectedSupplierId('');
    setSelectedSupplierName('');
    setInvoiceNumber('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setPaymentMode('cash');
    setPaidAmount('');
    setCashAmount('');
    setUpiAmount('');
    setCardAmount('');
    setIsGstPurchase(false);
    setDefaultTaxPercent(18);
    setShowProductName(false);
    setShowHsnCode(false);
    setItems([getInitialItem(18)]);
    setItemIsExistingProduct([false]);
    setItemExistingStock([0]);
    initializeProductCode(true, 1);
    setShowClearModal(false);
    setPageStep(1);
    showToast('Purchase draft cleared', 'info');
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

  const initializeProductCode = async (setInitialCode = true, itemsCount = 1) => {
    try {
      const nextCode = await generateProductCode(collection(db, 'products'));
      const codeNumber = parseInt(nextCode, 10);

      if (Number.isNaN(codeNumber)) {
        throw new Error('Invalid product code format');
      }

      setNextProductCodeNumber(codeNumber);
      if (setInitialCode) {
        const newCodes = [];
        for (let i = 0; i < itemsCount; i++) {
          newCodes.push(String(codeNumber + i).padStart(8, '0'));
        }
        setItemProductCodes(newCodes);
      }
    } catch (error) {
      console.error('Error initializing product code:', error);
      setNextProductCodeNumber(1);
      if (setInitialCode) {
        const newCodes = [];
        for (let i = 0; i < itemsCount; i++) {
          newCodes.push(String(1 + i).padStart(8, '0'));
        }
        setItemProductCodes(newCodes);
      }
    }
  };

  const getNextProductCodeForItem = (index: number) => {
    if (nextProductCodeNumber === null) return '00000001';
    const codeNumber = nextProductCodeNumber + index;
    return String(codeNumber).padStart(8, '0');
  };

  const fetchSuppliers = async () => {
    try {
      const suppliersRef = collection(db, 'suppliers');
      const q = query(suppliersRef, where('isActive', '==', true));
      const snapshot = await getDocs(q);
      const suppliersList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Supplier[];
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

  const addNewSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplier.name.trim() || !newSupplier.phone.trim()) {
      showToast('Supplier name and phone are required', 'error');
      return;
    }

    try {
      const supplierData: Omit<Supplier, 'id'> = {
        name: newSupplier.name.trim(),
        contactPerson: newSupplier.contactPerson.trim(),
        phone: newSupplier.phone.trim(),
        email: newSupplier.email.trim(),
        address: newSupplier.address.trim(),
        gstNumber: newSupplier.gstNumber.trim().toUpperCase(),
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
      setShowSupplierModal(false);
      setNewSupplier({
        name: '',
        contactPerson: '',
        phone: '',
        email: '',
        address: '',
        gstNumber: ''
      });

      await fetchSuppliers();
      setSelectedSupplierId(docRef.id);
      setSelectedSupplierName(supplierData.name);
    } catch (error) {
      console.error('Error adding supplier:', error);
      showToast('Failed to add supplier', 'error');
    }
  };

  const applyHcsCodeToAllRows = (sourceRowIndex: number) => {
    const sourceCode = String(items[sourceRowIndex]?.hcsCode || '').trim().toUpperCase();
    if (!sourceCode) {
      showToast('Enter an HSN/HCS code first', 'error');
      return;
    }
    setItems(prev => prev.map(item => ({
      ...item,
      hcsCode: sourceCode
    })));
    showToast('Applied HSN code to all rows', 'success');
  };

  const toggleGstPurchase = (enable: boolean) => {
    setIsGstPurchase(enable);
    if (!enable) {
      setShowHsnCode(false);
    }
    setItems(prevItems => prevItems.map(item => {
      const cost = Number(item.costPerUnit) || 0;
      const qty = Number(item.quantity) || 0;
      const tax = enable ? (Number(item.taxPercent) > 0 ? Number(item.taxPercent) : (defaultTaxPercent || 18)) : 0;
      const costWithGst = cost + (cost * tax / 100);
      return {
        ...item,
        taxPercent: enable ? tax : (Number(item.taxPercent) || (defaultTaxPercent || 18)),
        totalCost: enable ? (qty * costWithGst) : (qty * cost)
      };
    }));
    showToast(enable ? 'GST enabled (18% default applied)' : 'GST disabled for this purchase', 'info');
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: any) => {
    const newItems = [...items];
    let processedValue = value;
    if (typeof value === 'string' && ['productName', 'brand', 'model', 'category', 'hcsCode'].includes(field)) {
      processedValue = value.toUpperCase();
    }

    newItems[index] = { ...newItems[index], [field]: processedValue };

    if (field === 'quantity' || field === 'costPerUnit' || field === 'taxPercent') {
      const valQ = field === 'quantity' ? value : newItems[index].quantity;
      const valC = field === 'costPerUnit' ? value : newItems[index].costPerUnit;
      const valT = field === 'taxPercent' ? value : (newItems[index].taxPercent ?? (isGstPurchase ? defaultTaxPercent : 0));

      const quantity = (valQ === '' || valQ === undefined) ? 0 : (Number(valQ) || 0);
      const costPerUnit = (valC === '' || valC === undefined) ? 0 : (Number(valC) || 0);
      const taxPercent = isGstPurchase ? ((valT === '' || valT === undefined) ? 0 : (Number(valT) || 0)) : 0;

      const costWithGst = costPerUnit + (costPerUnit * taxPercent / 100);
      newItems[index].totalCost = isGstPurchase ? (quantity * costWithGst) : (quantity * costPerUnit);
    }

    if (field === 'brand' || field === 'model' || field === 'category') {
      const brand = newItems[index].brand || '';
      const model = newItems[index].model || '';
      const category = newItems[index].category || '';
      newItems[index].productName = `${brand} ${model} ${category}`.trim();
    }

    setItems(newItems);
  };

  const addItem = (duplicatePrevious = false) => {
    const newIndex = items.length;
    const newCode = getNextProductCodeForItem(newIndex);
    const tax = isGstPurchase ? (defaultTaxPercent || 18) : 18;
    const lastItem = items[items.length - 1];

    if (duplicatePrevious && lastItem) {
      setItems([...items, {
        ...lastItem,
        quantity: 1,
        taxPercent: Number(lastItem.taxPercent) || 18,
        totalCost: isGstPurchase
          ? (Number(lastItem.costPerUnit) * (1 + (Number(lastItem.taxPercent || tax) / 100)))
          : Number(lastItem.costPerUnit)
      }]);
    } else {
      setItems([...items, {
        productName: '',
        brand: '',
        model: '',
        category: '',
        quantity: 1,
        costPerUnit: 0,
        totalCost: 0,
        mrp: 0,
        mop: 0,
        taxPercent: 18,
        hcsCode: lastItem?.hcsCode || ''
      }]);
    }

    setItemProductCodes([...itemProductCodes, newCode]);
    setItemIsExistingProduct([...itemIsExistingProduct, false]);
    setItemExistingStock([...itemExistingStock, 0]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
      setItemProductCodes(itemProductCodes.filter((_, i) => i !== index));
      setItemIsExistingProduct(itemIsExistingProduct.filter((_, i) => i !== index));
      setItemExistingStock(itemExistingStock.filter((_, i) => i !== index));
    } else {
      showToast('At least one product line is required', 'error');
    }
  };

  // Dynamic Editable Table Columns for keyboard navigation
  const getEditableColumnFields = () => {
    const cols = ['brand', 'model', 'category', 'quantity', 'costPerUnit'];
    if (isGstPurchase && showHsnCode) {
      cols.push('hcsCode');
    }
    cols.push('mop', 'mrp');
    return cols;
  };

  // Keyboard Navigation across Table
  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    rowIndex: number,
    field: string
  ) => {
    const cols = getEditableColumnFields();
    const colIndex = cols.indexOf(field);

    if (e.key === 'ArrowUp') {
      if (rowIndex > 0) {
        e.preventDefault();
        const target = document.getElementById(`cell-${rowIndex - 1}-${field}`);
        target?.focus();
      }
    } else if (e.key === 'ArrowDown') {
      if (rowIndex < items.length - 1) {
        e.preventDefault();
        const target = document.getElementById(`cell-${rowIndex + 1}-${field}`);
        target?.focus();
      }
    } else if (e.key === 'ArrowLeft') {
      const input = e.target as HTMLInputElement;
      if (!input || (input.selectionStart === 0 && input.selectionEnd === 0)) {
        if (colIndex > 0) {
          e.preventDefault();
          const prevField = cols[colIndex - 1];
          const target = document.getElementById(`cell-${rowIndex}-${prevField}`);
          target?.focus();
        }
      }
    } else if (e.key === 'ArrowRight') {
      const input = e.target as HTMLInputElement;
      if (!input || (input.selectionStart === input.value?.length)) {
        if (colIndex < cols.length - 1) {
          e.preventDefault();
          const nextField = cols[colIndex + 1];
          const target = document.getElementById(`cell-${rowIndex}-${nextField}`);
          target?.focus();
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      const isShiftEnter = e.shiftKey;
      if (isShiftEnter) {
        addItem(true);
        setTimeout(() => {
          const nextTarget = document.getElementById(`cell-${items.length}-brand`);
          nextTarget?.focus();
        }, 70);
        return;
      }

      // If at last col:
      if (colIndex >= cols.length - 1) {
        if (rowIndex === items.length - 1) {
          addItem(false);
          setTimeout(() => {
            const nextTarget = document.getElementById(`cell-${rowIndex + 1}-brand`);
            nextTarget?.focus();
          }, 70);
        } else {
          const nextTarget = document.getElementById(`cell-${rowIndex + 1}-brand`);
          nextTarget?.focus();
        }
      } else {
        const nextField = cols[colIndex + 1];
        const target = document.getElementById(`cell-${rowIndex}-${nextField}`);
        target?.focus();
      }
    }
  };

  // Product Search / Selection
  // Product Catalog Search & Selection
  const searchProducts = async (queryStr: string) => {
    if (!queryStr.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const products = await syncStoreProducts(null);
      const qLower = queryStr.toLowerCase();
      const filtered = products.filter(product => {
        const name = typeof product.name === 'string' ? product.name.toLowerCase() : '';
        const brand = typeof product.brand === 'string' ? product.brand.toLowerCase() : '';
        const model = typeof product.model === 'string' ? product.model.toLowerCase() : '';
        const category = typeof product.category === 'string' ? product.category.toLowerCase() : '';
        const code = product.productCode ? String(product.productCode).toLowerCase() : '';

        return (
          name.includes(qLower) ||
          brand.includes(qLower) ||
          model.includes(qLower) ||
          category.includes(qLower) ||
          code.includes(qLower)
        );
      });

      setSearchResults(filtered.slice(0, 15));
    } catch (error) {
      console.error('Error searching products:', error);
      showToast('Failed to search products', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectCatalogProduct = (product: Product) => {
    const pBaseCost = (product.baseCost !== undefined && product.baseCost > 0)
      ? Number(product.baseCost)
      : (product.cost ? Number(product.cost) : 0);
    const itemTax = product.taxPercent !== undefined && Number(product.taxPercent) > 0
      ? Number(product.taxPercent)
      : (defaultTaxPercent || 18);
    const itemCostWithGst = pBaseCost + (pBaseCost * itemTax / 100);

    const newItem: PurchaseItem = {
      productName: product.name,
      brand: product.brand || '',
      model: product.model || '',
      category: product.category || '',
      costPerUnit: pBaseCost,
      mrp: product.mrp ? Number(product.mrp) : pBaseCost,
      mop: product.mop ? Number(product.mop) : pBaseCost,
      taxPercent: itemTax,
      hcsCode: product.hcsCode || '',
      quantity: 1,
      totalCost: isGstPurchase ? itemCostWithGst : pBaseCost
    };

    if (items.length === 1 && !items[0].brand && !items[0].model && !items[0].costPerUnit) {
      setItems([newItem]);
      setItemProductCodes([product.productCode || getNextProductCodeForItem(0)]);
      setItemIsExistingProduct([true]);
      setItemExistingStock([product.quantity || 0]);
    } else {
      setItems(prev => [...prev, newItem]);
      setItemProductCodes(prev => [...prev, product.productCode || getNextProductCodeForItem(prev.length)]);
      setItemIsExistingProduct(prev => [...prev, true]);
      setItemExistingStock(prev => [...prev, product.quantity || 0]);
    }

    setIsCatalogModalOpen(false);
    showToast(`Added "${product.name}" to purchase items`, 'success');
  };

  // Totals calculation
  const calculateTotals = () => {
    const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.totalCost) || 0), 0);
    const baseAmount = items.reduce((sum, item) => {
      const q = Number(item.quantity) || 0;
      const c = Number(item.costPerUnit) || 0;
      return sum + (q * c);
    }, 0);
    const totalGstAmount = isGstPurchase ? Math.max(0, totalAmount - baseAmount) : 0;
    return { totalQuantity, totalAmount, baseAmount, totalGstAmount };
  };

  const { totalQuantity, totalAmount, baseAmount, totalGstAmount } = calculateTotals();
  const effectivePaidAmount = paymentMode === 'credit' ? 0 : (parseFloat(paidAmount) || 0);
  const pendingAmount = Math.max(0, totalAmount - effectivePaidAmount);

  // Excel Import / Export
  const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase();
  const getCellValue = (row: Record<string, unknown>, keys: string[]) => {
    for (const key of Object.keys(row)) {
      if (keys.includes(normalizeHeader(key))) return row[key];
    }
    return undefined;
  };
  const toText = (value: unknown) => String(value ?? '').trim();
  const toNumber = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = parseFloat(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
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

        if (supplierName) setSelectedSupplierName(supplierName);
        if (supplierId) setSelectedSupplierId(supplierId);
        if (invoice) setInvoiceNumber(invoice);
        if (noteValue) setNotes(noteValue);
        if (payment) setPaymentMode(payment);
        if (paid) setPaidAmount(paid);
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
        const productName = toText(getCellValue(row, ['product name', 'name'])) || `${brand} ${model} ${category}`.trim();
        const quantity = Math.max(1, Math.round(toNumber(getCellValue(row, ['quantity', 'qty'])) || 1));
        const costPerUnit = toNumber(getCellValue(row, ['cost/unit', 'cost per unit', 'cost']));
        const mrp = toNumber(getCellValue(row, ['mrp']));
        const mop = toNumber(getCellValue(row, ['mop']));
        const totalCost = toNumber(getCellValue(row, ['total cost', 'total']));
        const hcsCode = toText(getCellValue(row, ['hcs code', 'hcscode', 'hsn code', 'hsncode', 'hsn']));
        const taxPercent = toNumber(getCellValue(row, ['tax %', 'tax', 'tax percent']));

        const normalizedItem: PurchaseItem = {
          productName: productName || `${brand} ${model} ${category}`.trim() || 'IMPORTED ITEM',
          brand,
          model,
          category,
          quantity,
          costPerUnit,
          totalCost: totalCost > 0 ? totalCost : quantity * costPerUnit,
          mrp: mrp > 0 ? mrp : costPerUnit,
          mop: mop > 0 ? mop : costPerUnit,
          hcsCode,
          taxPercent
        };
        return normalizedItem;
      });

      const importedCodes = rows.map((row, index) => {
        const rawCode = toText(getCellValue(row, ['product code', 'code']));
        if (/^\d{8}$/.test(rawCode)) return rawCode;
        return getNextProductCodeForItem(index);
      });

      const hasTax = importedItems.some(it => (it.taxPercent || 0) > 0);
      if (hasTax) setIsGstPurchase(true);

      setItems(importedItems);
      setItemProductCodes(importedCodes);
      setItemIsExistingProduct(importedItems.map(() => false));
      setItemExistingStock(importedItems.map(() => 0));

      showToast(`Imported ${importedItems.length} items from Excel`, 'success');
    } catch (error) {
      console.error('Error importing Excel file:', error);
      showToast('Failed to import Excel file', 'error');
    }
  };

  const exportToExcel = () => {
    try {
      const summaryData = [
        { Field: 'Supplier', Value: selectedSupplierName || '' },
        { Field: 'Supplier ID', Value: selectedSupplierId || '' },
        { Field: 'Invoice Number', Value: invoiceNumber || '' },
        { Field: 'Purchase Date', Value: purchaseDate || '' },
        { Field: 'Notes', Value: notes || '' },
        { Field: 'Payment Mode', Value: paymentMode },
        { Field: 'Paid Amount', Value: effectivePaidAmount },
        { Field: 'Pending Amount', Value: pendingAmount },
        { Field: 'Total Quantity', Value: totalQuantity },
        { Field: 'Total Amount', Value: totalAmount },
        ...(isGstPurchase ? [
          { Field: 'Base Amount', Value: baseAmount },
          { Field: 'Total GST Amount', Value: totalGstAmount }
        ] : [])
      ];

      const itemRows = items.map((item, index) => ({
        '#': index + 1,
        'Product Code': itemProductCodes[index] || '',
        'Brand': item.brand,
        'Model': item.model || '',
        'Category': item.category,
        'Product Name': item.productName || `${item.brand} ${item.model} ${item.category}`.trim(),
        'Quantity': Number(item.quantity) || 0,
        'Cost/Unit': Number(item.costPerUnit) || 0,
        'MOP': Number(item.mop) || 0,
        'MRP': Number(item.mrp) || 0,
        'HSN Code': item.hcsCode || '',
        'Tax %': Number(item.taxPercent) || 0,
        'Total Cost': Number(item.totalCost) || 0
      }));

      const wb = XLSX.utils.book_new();
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      const itemsWs = XLSX.utils.json_to_sheet(itemRows);

      XLSX.utils.book_append_sheet(wb, summaryWs, 'Purchase Summary');
      XLSX.utils.book_append_sheet(wb, itemsWs, 'Purchase Items');

      const datePart = purchaseDate || new Date().toISOString().split('T')[0];
      const supplierPart = (selectedSupplierName || 'purchase').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      XLSX.writeFile(wb, `purchase_non_imei_${supplierPart}_${datePart}.xlsx`);
    } catch (error) {
      console.error('Error exporting purchase to Excel:', error);
      showToast('Failed to export Excel file', 'error');
    }
  };

  // Validation routines
  const validateStep1 = () => {
    if (!selectedSupplierId?.trim()) {
      showToast('Supplier Required: Please select a supplier to proceed', 'error');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (items.length === 0) {
      showToast('Please add at least one product line', 'error');
      return false;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.brand?.trim()) {
        showToast(`Line #${i + 1}: Brand is required`, 'error');
        setTimeout(() => document.getElementById(`cell-${i}-brand`)?.focus(), 70);
        return false;
      }
      if (!item.model?.trim()) {
        showToast(`Line #${i + 1} (${item.brand}): Model is required`, 'error');
        setTimeout(() => document.getElementById(`cell-${i}-model`)?.focus(), 70);
        return false;
      }
      if (!item.category?.trim()) {
        showToast(`Line #${i + 1} (${item.brand} ${item.model}): Category is required`, 'error');
        setTimeout(() => document.getElementById(`cell-${i}-category`)?.focus(), 70);
        return false;
      }
      if (!item.quantity || Number(item.quantity) < 1) {
        showToast(`Line #${i + 1} (${item.brand} ${item.model}): Quantity must be at least 1 unit`, 'error');
        setTimeout(() => document.getElementById(`cell-${i}-quantity`)?.focus(), 70);
        return false;
      }
      if (Number(item.costPerUnit) <= 0) {
        showToast(`Line #${i + 1} (${item.brand} ${item.model}): Cost per unit must be greater than 0`, 'error');
        setTimeout(() => document.getElementById(`cell-${i}-costPerUnit`)?.focus(), 70);
        return false;
      }
      if (!item.mop || Number(item.mop) <= 0) {
        showToast(`Line #${i + 1} (${item.brand} ${item.model}): MOP is required and must be greater than 0`, 'error');
        setTimeout(() => document.getElementById(`cell-${i}-mop`)?.focus(), 70);
        return false;
      }
      if (!item.mrp || Number(item.mrp) <= 0) {
        showToast(`Line #${i + 1} (${item.brand} ${item.model}): MRP is required and must be greater than 0`, 'error');
        setTimeout(() => document.getElementById(`cell-${i}-mrp`)?.focus(), 70);
        return false;
      }
    }

    return true;
  };

  const validateForSave = () => {
    if (!validateStep1()) {
      setPageStep(1);
      return false;
    }
    if (!validateStep2()) {
      setPageStep(2);
      return false;
    }

    if (paymentMode === 'split') {
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;
      const totalSplit = cash + upi + card;
      const paid = parseFloat(paidAmount) || 0;

      if (totalSplit !== paid) {
        showToast(`Split Mismatch: Cash (₹${cash}) + UPI (₹${upi}) + Card (₹${card}) = ₹${totalSplit}, but Paid Amount is ₹${paid}`, 'error');
        setPageStep(3);
        return false;
      }
    }

    return true;
  };

  const handleStepNavigation = (targetStep: 1 | 2 | 3) => {
    if (targetStep === pageStep) return;
    if (targetStep === 1) {
      setPageStep(1);
      return;
    }
    if (targetStep === 2) {
      if (!validateStep1()) return;
      setPageStep(2);
      return;
    }
    if (targetStep === 3) {
      if (!validateStep1()) {
        setPageStep(1);
        return;
      }
      if (!validateStep2()) {
        setPageStep(2);
        return;
      }
      setPageStep(3);
      return;
    }
  };

  const generatePurchaseNumber = async () => {
    try {
      const purchasesRef = getCollectionRef('purchases');
      const qLatest = query(purchasesRef, orderBy('createdAt', 'desc'), limit(20));
      const snapshot = await getDocs(qLatest);

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
        const candidateId = `PUR-${String(candidateNumber).padStart(4, '0')}`;
        const checkQ = query(purchasesRef, where('purchaseNumber', '==', candidateId));
        const checkSnap = await getDocs(checkQ);
        if (!checkSnap.empty) {
          candidateNumber++;
        } else {
          isUsed = false;
          return candidateId;
        }
      }

      return `PUR-${String(candidateNumber).padStart(4, '0')}`;
    } catch (error) {
      console.error('Error generating purchase number:', error);
      return `PUR-${Date.now()}`;
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!validateForSave()) return;

    setIsSubmitting(true);

    try {
      const paid = effectivePaidAmount;
      const isCredit = paymentMode === 'credit';
      const pending = pendingAmount;

      let paymentStatus: 'paid' | 'pending' | 'unpaid' = 'unpaid';
      if (paid >= totalAmount) {
        paymentStatus = 'paid';
      } else if (paid > 0) {
        paymentStatus = 'pending';
      } else {
        paymentStatus = 'unpaid';
      }

      let paymentSplit: PaymentSplit | undefined;
      if (paymentMode === 'split') {
        const cash = parseFloat(cashAmount) || 0;
        const upi = parseFloat(upiAmount) || 0;
        const card = parseFloat(cardAmount) || 0;
        paymentSplit = { cash, upi, card };
      }

      const states: Array<{ text: string }> = [];
      states.push({ text: 'Validating procurement details and supplier...' });
      items.forEach((item) => {
        const pName = `${item.brand} ${item.model} ${item.category}`.trim();
        states.push({ text: `Adding ${pName} (${item.quantity} units) to Central Warehouse...` });
      });
      states.push({ text: 'Posting supplier ledger transactions...' });
      states.push({ text: 'Finalizing purchase voucher...' });
      states.push({ text: '✓ Non-IMEI Purchase recorded successfully!' });

      setLoadingStates(states);
      setMultiStepLoading(true);

      if (isEditMode && originalPurchase) {
        // Revert supplier totals
        const supplierRef = doc(db, 'suppliers', originalPurchase.supplierId);
        await updateDoc(supplierRef, {
          totalPurchaseAmount: increment(-originalPurchase.totalAmount),
          totalPaid: increment(-originalPurchase.paidAmount),
          totalPending: increment(-originalPurchase.pendingAmount)
        });

        // Revert inventory
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

      const finalProductCodes: string[] = [];
      const rootProductsRef = collection(db, 'products');
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const productName = `${item.brand} ${item.model} ${item.category}`.trim();
        const q = query(rootProductsRef, where('name', '==', productName));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const productDoc = snapshot.docs[0];
          finalProductCodes.push(productDoc.data().productCode);
        } else {
          finalProductCodes.push(itemProductCodes[index] || getNextProductCodeForItem(index));
        }
      }

      const purchaseNumber = isEditMode && originalPurchase?.purchaseNumber
        ? originalPurchase.purchaseNumber
        : await generatePurchaseNumber();

      const purchaseData: any = {
        purchaseNumber,
        supplierId: selectedSupplierId,
        supplierName: selectedSupplierName,
        hubId: currentHub?.id || 'digital_zone_hq',
        items: items.map((item, index) => {
          const cost = Number(item.costPerUnit) || 0;
          const tax = isGstPurchase ? (Number(item.taxPercent) || 0) : 0;
          const costWithGst = cost + (cost * tax / 100);
          return {
            productCode: finalProductCodes[index],
            productName: `${item.brand} ${item.model} ${item.category}`.trim(),
            brand: item.brand,
            model: item.model,
            category: item.category,
            quantity: Number(item.quantity) || 0,
            costPerUnit: cost,
            costWithGst: isGstPurchase ? costWithGst : cost,
            taxPercent: tax,
            totalCost: Number(item.totalCost) || 0,
            mrp: Number(item.mrp) || 0,
            mop: Number(item.mop) || 0,
            hcsCode: item.hcsCode || '',
            gstEnabled: isGstPurchase
          };
        }),
        totalQuantity,
        totalAmount,
        baseAmount,
        totalGstAmount: isGstPurchase ? totalGstAmount : 0,
        gstEnabled: isGstPurchase,
        paidAmount: paid,
        pendingAmount: pending,
        paymentMode,
        paymentStatus,
        isCredit,
        creditCleared: 0,
        isIMEIPurchase: false,
        purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || ''
      };

      if (paymentSplit) purchaseData.paymentSplit = paymentSplit;
      if (invoiceNumber.trim()) purchaseData.invoiceNumber = invoiceNumber.trim();
      if (notes.trim()) purchaseData.notes = notes.trim();

      let purchaseRefId = '';
      if (isEditMode && id) {
        const purchaseRef = doc(db, 'purchases', id);
        purchaseData.updatedAt = new Date();
        purchaseData.createdAt = originalPurchase.createdAt;
        purchaseData.createdBy = originalPurchase.createdBy;
        purchaseData.createdByName = originalPurchase.createdByName;
        await updateDoc(purchaseRef, purchaseData);
        purchaseRefId = id;
      } else {
        const purchaseRef = await addDoc(collection(db, 'purchases'), purchaseData);
        purchaseRefId = purchaseRef.id;
      }

      // Record purchase transaction
      await addDoc(collection(db, 'supplierPayments'), {
        supplierId: selectedSupplierId,
        supplierName: selectedSupplierName,
        amount: totalAmount,
        type: 'purchase',
        paymentMode: paymentMode,
        notes: `Purchase #${purchaseNumber}${notes.trim() ? ' - ' + notes : ''}`,
        relatedPurchaseId: purchaseRefId,
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || ''
      });

      // Record immediate payment out if paid > 0
      if (paid > 0) {
        const paymentRecord: any = {
          supplierId: selectedSupplierId,
          supplierName: selectedSupplierName,
          amount: paid,
          type: 'payment_out',
          paymentMode: paymentMode,
          notes: `Payment for Purchase #${purchaseNumber}`,
          relatedPurchaseId: purchaseRefId,
          createdAt: new Date(),
          createdBy: currentUser?.uid || '',
          createdByName: currentUser?.displayName || ''
        };
        if (paymentSplit) paymentRecord.paymentSplit = paymentSplit;
        await addDoc(collection(db, 'supplierPayments'), paymentRecord);
      }

      // Update supplier balance
      const supplierRef = doc(db, 'suppliers', selectedSupplierId);
      await updateDoc(supplierRef, {
        totalPurchaseAmount: increment(totalAmount),
        totalPaid: increment(paid),
        totalPending: increment(pending),
        updatedAt: Timestamp.now()
      });

      // Update HQ Central Warehouse Catalog & Stock
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const productName = `${item.brand} ${item.model} ${item.category}`.trim();
        const baseCost = Number(item.costPerUnit) || 0;
        const tax = isGstPurchase ? (Number(item.taxPercent) || 0) : 0;
        const costWithGst = baseCost + (baseCost * tax / 100);
        const effectiveCost = isGstPurchase && tax > 0 ? costWithGst : baseCost;

        const q = query(rootProductsRef, where('name', '==', productName));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const productDoc = snapshot.docs[0];
          const existingData: any = productDoc.data();

          const updateData: any = {
            quantity: increment(item.quantity),
            cost: effectiveCost,
            baseCost: baseCost,
            mrp: item.mrp || effectiveCost,
            mop: item.mop || 0,
            taxPercent: tax,
            gstEnabled: isGstPurchase,
            supplier: selectedSupplierName,
            updatedAt: Timestamp.now()
          };

          if (item.hcsCode) updateData.hcsCode = item.hcsCode;
          if (!existingData.brand && item.brand) updateData.brand = item.brand;
          if (!existingData.model && item.model) updateData.model = item.model;
          if (!existingData.category && item.category) updateData.category = item.category;
          if (!existingData.productCode && finalProductCodes[index]) updateData.productCode = finalProductCodes[index];

          await updateDoc(doc(db, 'products', productDoc.id), updateData);
        } else {
          const brand = item.brand && item.brand.trim() ? item.brand : 'Unknown Brand';
          const model = item.model && item.model.trim() ? item.model : 'N/A';
          const category = item.category && item.category.trim() ? item.category : 'General';
          const code = finalProductCodes[index] || getNextProductCodeForItem(index);

          await addDoc(rootProductsRef, {
            productCode: code,
            name: productName || `${brand} ${model} ${category}`.trim(),
            model,
            cost: effectiveCost,
            baseCost: baseCost,
            mrp: item.mrp || effectiveCost,
            mop: item.mop || 0,
            taxPercent: tax,
            gstEnabled: isGstPurchase,
            hcsCode: item.hcsCode || '',
            highestDiscountLimit: item.highestDiscountLimit || 0,
            brand,
            category,
            paymentType: 'cash',
            supplier: selectedSupplierName,
            quantity: item.quantity,
            isAvailable: true,
            sourcePurchaseId: purchaseRefId,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            createdBy: currentUser?.uid || '',
            createdByName: currentUser?.displayName || ''
          });
        }
      }

      showToast(`Purchase ${purchaseNumber} saved to Central Warehouse successfully!`, 'success');

      setTimeout(async () => {
        setMultiStepLoading(false);
        localStorage.removeItem('addPurchaseDraft');
        navigate('/purchases');
      }, 1400);

    } catch (error) {
      console.error('Error saving purchase:', error);
      showToast('Failed to save purchase. Please review fields and try again.', 'error');
      setMultiStepLoading(false);
      setIsSubmitting(false);
    }
  };

  const stepsMeta = [
    { number: 1, title: 'Supplier & Source', subtitle: 'Vendor info & document details' },
    { number: 2, title: 'Products & Inventory', subtitle: `${items.length} lines • ${totalQuantity} units` },
    { number: 3, title: 'Payment & Summary', subtitle: `₹${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} settlement` }
  ];

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16">
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

        <main className="w-full px-3 sm:px-6 lg:px-8 py-6 pb-24 sm:pb-12">

          {/* ================= PAGE TITLE / HEADER ================= */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200/80 mb-6">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  {isEditMode ? 'Edit Non-IMEI Purchase' : 'New Non-IMEI Purchase'}
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                  General Inventory
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Procure non-serialized inventory, manage warehouse stock levels, and settle supplier balances.
              </p>
            </div>

            <div className="flex items-center gap-2 self-start md:self-auto">
              {lastSaved && (
                <span className="text-[11px] text-slate-400 font-mono hidden sm:inline-block mr-1">
                  Draft auto-saved: {lastSaved}
                </span>
              )}

              <button
                type="button"
                onClick={() => setShowClearModal(true)}
                className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200/80 rounded-lg transition-colors cursor-pointer"
              >
                Clear Draft
              </button>

              <button
                type="button"
                onClick={() => navigate('/purchases')}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                View Purchases
              </button>
            </div>
          </div>

          {/* ================= MOBILE STEPPER BAR ================= */}
          <div className="md:hidden mb-5 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
            <div className="grid grid-cols-3 gap-1 text-center">
              {stepsMeta.map((s) => {
                const isCurrent = pageStep === s.number;
                const isDone = pageStep > s.number;
                return (
                  <button
                    key={s.number}
                    type="button"
                    onClick={() => handleStepNavigation(s.number as 1 | 2 | 3)}
                    className={`py-2 px-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${isCurrent
                      ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                      : isDone
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'text-slate-500 hover:bg-slate-50'
                      }`}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      {isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <span className="text-[11px]">{s.number}.</span>
                      )}
                      <span className="truncate">{s.title.split(' ')[0]}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ================= 2-COLUMN WORKSPACE: LEFT RAIL + MAIN VIEW ================= */}
          <div className="flex flex-col lg:flex-row items-start gap-6 w-full">

            {/* ================= DESKTOP STEPPER RAIL (COLLAPSIBLE) ================= */}
            <aside className={`hidden md:block transition-all duration-200 shrink-0 ${isSidebarCollapsed ? 'w-14' : 'w-64'
              }`}>
              <nav className="sticky top-20 bg-white rounded-xl border border-slate-200/90 p-3 shadow-2xs space-y-2">
                <div className="flex items-center justify-between pb-2 mb-1 border-b border-slate-100">
                  {!isSidebarCollapsed && (
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Procurement Steps
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-auto cursor-pointer"
                    title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar for more workspace'}
                  >
                    {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  </button>
                </div>

                {stepsMeta.map((s) => {
                  const isCurrent = pageStep === s.number;
                  const isDone = pageStep > s.number;

                  return (
                    <button
                      key={s.number}
                      type="button"
                      onClick={() => handleStepNavigation(s.number as 1 | 2 | 3)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${isCurrent
                        ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200/80 shadow-2xs'
                        : isDone
                          ? 'text-slate-700 hover:bg-slate-50'
                          : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50/60'
                        }`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono shrink-0 transition-colors ${isCurrent
                        ? 'bg-blue-600 text-white font-bold'
                        : isDone
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-500'
                        }`}>
                        {isDone ? <Check className="w-4 h-4 text-emerald-700" /> : s.number}
                      </div>

                      {!isSidebarCollapsed && (
                        <div className="min-w-0 flex-1">
                          <div className="text-xs truncate">{s.title}</div>
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">{s.subtitle}</div>
                        </div>
                      )}
                    </button>
                  );
                })}

                {!isSidebarCollapsed && selectedSupplierName && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] space-y-1">
                    <div className="text-slate-400 text-[10px] uppercase font-bold">Selected Vendor</div>
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

              {/* ================= STEP 1: SUPPLIER & DOCUMENTATION ================= */}
              {pageStep === 1 && (
                <div className="space-y-5 w-full">

                  {/* Supplier Selection Card */}
                  <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
                    <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                          <Truck className="w-4 h-4 text-blue-600" />
                          <span>Supplier & Source Vendor</span>
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          The supplier is the sole product origin for this procurement batch.
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
                          Select Supplier *
                        </label>
                        <select
                          value={selectedSupplierId}
                          onChange={(e) => handleSupplierChange(e.target.value)}
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

                      {!selectedSupplierId && (
                        <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <strong className="font-semibold block">Supplier Selection Required</strong>
                            <span>Please select a supplier from the list above or click "+ Add New Supplier" to unlock Step 2 (Products & Inventory).</span>
                          </div>
                        </div>
                      )}

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

                  {/* Invoice, Date & GST Card */}
                  <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
                    <div className="pb-3.5 mb-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                          <FileText className="w-4 h-4 text-blue-600" />
                          <span>Invoice & Tax Configuration</span>
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Specify vendor invoice reference, date, and tax application.
                        </p>
                      </div>

                      {/* GST Purchase Toggle */}
                      <div className="flex items-center gap-2">
                        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() => toggleGstPurchase(false)}
                            className={`px-3 py-1 rounded-md transition-all cursor-pointer ${!isGstPurchase
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                              }`}
                          >
                            Non-GST
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleGstPurchase(true)}
                            className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${isGstPurchase
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'text-slate-500 hover:text-emerald-700'
                              }`}
                          >
                            <Receipt className="w-3.5 h-3.5" />
                            <span>GST Purchase</span>
                          </button>
                        </div>

                        {isGstPurchase && (
                          <div className="flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 text-xs">
                            <span className="text-emerald-800 font-semibold">Default Tax:</span>
                            <select
                              value={defaultTaxPercent}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setDefaultTaxPercent(val);
                                setItems(prev => prev.map(it => {
                                  const cost = Number(it.costPerUnit) || 0;
                                  const qty = Number(it.quantity) || 0;
                                  const tax = val;
                                  const costWithGst = cost + (cost * tax / 100);
                                  return {
                                    ...it,
                                    taxPercent: tax,
                                    totalCost: qty * costWithGst
                                  };
                                }));
                              }}
                              className="bg-white border border-emerald-300 text-emerald-900 rounded font-bold px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value={0}>0%</option>
                              <option value={5}>5%</option>
                              <option value={12}>12%</option>
                              <option value={18}>18%</option>
                              <option value={28}>28%</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                          <Hash className="w-3.5 h-3.5 text-slate-400" />
                          <span>Supplier Invoice / Challan Number</span>
                        </label>
                        <input
                          type="text"
                          value={invoiceNumber}
                          onChange={(e) => setInvoiceNumber(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors font-mono"
                          placeholder="e.g. INV-9021 or CH-881"
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
                          Purchase Notes / Internal Remarks (Optional)
                        </label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-colors"
                          placeholder="Remarks about shipment batch, warranty, damage inspection, or courier tracking..."
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
                        if (validateStep1()) {
                          setPageStep(2);
                        }
                      }}
                      className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-semibold text-white shadow-xs transition-all cursor-pointer ${selectedSupplierId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-400 hover:bg-slate-500'
                        }`}
                    >
                      <span>Proceed to Step 2: Products & Inventory</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* ================= STEP 2: PRODUCTS & INVENTORY PRICING ================= */}
              {pageStep === 2 && (
                <div className="space-y-5 w-full">
                  <div className="bg-white rounded-xl border border-slate-200/90 overflow-hidden shadow-2xs">

                    {/* Top Action Toolbar */}
                    <div className="p-3.5 sm:px-5 sm:py-3 border-b border-slate-200/80 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => addItem(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg text-xs font-semibold border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                        >
                          <Plus className="w-3.5 h-3.5 text-blue-600" />
                          <span>Add Product Line</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setSearchResults([]);
                            setIsCatalogModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg text-xs font-semibold border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                        >
                          <Search className="w-3.5 h-3.5 text-blue-600" />
                          <span>Search Catalog</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowProductName(!showProductName)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${showProductName
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          title="Toggle Product Name column visibility"
                        >
                          {showProductName ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>Product Name</span>
                        </button>

                        {/* HSN Code and GST controls - ONLY shown when GST is selected in Step 1 */}
                        {isGstPurchase && (
                          <>
                            <button
                              type="button"
                              onClick={() => setShowHsnCode(!showHsnCode)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${showHsnCode
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-2xs'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                }`}
                              title="Toggle HSN Code column visibility"
                            >
                              {showHsnCode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              <span>HSN Code</span>
                            </button>

                            <div className="inline-flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white shadow-2xs">
                                <Receipt className="w-3.5 h-3.5 text-white" />
                                <span>GST Active ({defaultTaxPercent}%)</span>
                              </span>

                              <div className="inline-flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200 text-xs">
                                <span className="text-emerald-800 font-semibold text-[11px]">Tax:</span>
                                <select
                                  value={defaultTaxPercent}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setDefaultTaxPercent(val);
                                    setItems(prev => prev.map(it => {
                                      const cost = Number(it.costPerUnit) || 0;
                                      const qty = Number(it.quantity) || 0;
                                      const tax = val;
                                      const costWithGst = cost + (cost * tax / 100);
                                      return {
                                        ...it,
                                        taxPercent: tax,
                                        totalCost: qty * costWithGst
                                      };
                                    }));
                                  }}
                                  className="bg-white border border-emerald-300 text-emerald-900 rounded font-bold px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                                >
                                  <option value={0}>0%</option>
                                  <option value={5}>5%</option>
                                  <option value={12}>12%</option>
                                  <option value={18}>18%</option>
                                  <option value={28}>28%</option>
                                </select>
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          ref={importFileInputRef}
                          type="file"
                          accept=".xlsx, .xls"
                          onChange={importFromExcel}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => importFileInputRef.current?.click()}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium border border-slate-200 transition-colors cursor-pointer"
                          title="Import items from Excel spreadsheet"
                        >
                          <Upload className="w-3.5 h-3.5 text-slate-500" />
                          <span className="hidden sm:inline">Import Excel</span>
                        </button>

                        <button
                          type="button"
                          onClick={exportToExcel}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium border border-slate-200 transition-colors cursor-pointer"
                          title="Export current draft to Excel"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-500" />
                          <span className="hidden sm:inline">Export Excel</span>
                        </button>

                        <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                          {items.length} lines • {totalQuantity} units
                        </span>
                      </div>
                    </div>

                    {/* Mobile View: Item Cards */}
                    <div className="block sm:hidden divide-y divide-slate-100 p-3 space-y-4">
                      {items.map((item, rowIndex) => {
                        const cost = Number(item.costPerUnit) || 0;
                        const qty = Math.max(1, Number(item.quantity) || 1);
                        const tax = isGstPurchase ? (Number(item.taxPercent) || defaultTaxPercent) : 0;
                        const costWithGstPerUnit = cost + (cost * tax / 100);
                        const totalCostWithGst = isGstPurchase ? (costWithGstPerUnit * qty) : (cost * qty);
                        const mrpVal = Number(item.mrp) || 0;
                        const profitMargin = mrpVal - (isGstPurchase ? costWithGstPerUnit : cost);

                        return (
                          <div key={rowIndex} className="bg-slate-50/60 rounded-xl p-3 border border-slate-200 space-y-3">
                            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[11px] font-mono font-bold flex items-center justify-center">
                                  {rowIndex + 1}
                                </span>
                                <span className="text-xs font-mono text-blue-700 font-semibold">
                                  {itemProductCodes[rowIndex] || '—'}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => removeItem(rowIndex)}
                                className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="space-y-2">
                              <div>
                                <label className="text-[11px] text-slate-500 block mb-1">Brand *</label>
                                <SearchableSelect
                                  id={`cell-${rowIndex}-0-m`}
                                  options={brands.map(b => ({ id: b.id || '', name: b.name }))}
                                  value={item.brand}
                                  onChange={(value) => handleItemChange(rowIndex, 'brand', value)}
                                  placeholder="Select Brand"
                                  className="w-full"
                                />
                              </div>

                              <div>
                                <label className="text-[11px] text-slate-500 block mb-1">Model *</label>
                                <input
                                  id={`cell-${rowIndex}-1-m`}
                                  type="text"
                                  value={item.model}
                                  onChange={(e) => handleItemChange(rowIndex, 'model', e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white uppercase"
                                  placeholder="e.g. 15 PRO"
                                />
                              </div>

                              <div>
                                <label className="text-[11px] text-slate-500 block mb-1">Category *</label>
                                <SearchableSelect
                                  id={`cell-${rowIndex}-2-m`}
                                  options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                                  value={item.category}
                                  onChange={(value) => handleItemChange(rowIndex, 'category', value)}
                                  placeholder="Select Category"
                                  className="w-full"
                                />
                              </div>

                              {showProductName && (
                                <div>
                                  <label className="text-[11px] text-slate-500 block mb-1">Product Name</label>
                                  <input
                                    type="text"
                                    readOnly
                                    value={item.productName || `${item.brand} ${item.model} ${item.category}`.trim()}
                                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-slate-100 text-slate-600 font-medium"
                                  />
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[11px] font-semibold text-slate-900 block mb-1">Qty *</label>
                                  <input
                                    id={`cell-${rowIndex}-4-m`}
                                    type="number"
                                    min="1"
                                    value={item.quantity || ''}
                                    onChange={(e) => handleItemChange(rowIndex, 'quantity', parseInt(e.target.value, 10) || 1)}
                                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md text-center font-bold bg-white"
                                  />
                                </div>

                                <div>
                                  <label className="text-[11px] text-slate-700 block mb-1">Cost *</label>
                                  <input
                                    id={`cell-${rowIndex}-5-m`}
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
                                    placeholder="0.00"
                                  />
                                </div>
                              </div>

                              {isGstPurchase && showHsnCode && (
                                <div>
                                  <label className="text-[11px] font-semibold text-emerald-800 block mb-1">HSN Code (Optional)</label>
                                  <input
                                    type="text"
                                    value={item.hcsCode || ''}
                                    onChange={(e) => handleItemChange(rowIndex, 'hcsCode', e.target.value)}
                                    placeholder="HSN (Optional)"
                                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white font-mono uppercase"
                                  />
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[11px] text-slate-500 block mb-1">MOP (₹) *</label>
                                  <input
                                    type="number"
                                    value={item.mop || ''}
                                    onChange={(e) => handleItemChange(rowIndex, 'mop', parseFloat(e.target.value) || 0)}
                                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md text-center bg-white"
                                    placeholder="0.00"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-slate-500 block mb-1">MRP (₹) *</label>
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
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop Spreadsheet Table */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-medium">
                              <th className="px-3 py-2.5 w-10 text-center">#</th>
                              <th className="px-2 py-2.5 w-24">Code</th>
                              <th className="px-3 py-2.5 min-w-[130px]">Brand *</th>
                              <th className="px-3 py-2.5 min-w-[110px]">Model *</th>
                              <th className="px-3 py-2.5 min-w-[130px]">Category *</th>
                              {showProductName && <th className="px-3 py-2.5 min-w-[190px]">Product Name</th>}
                              <th className="px-2 py-2.5 w-16 text-center text-slate-400">Stock</th>
                              <th className="px-3 py-2.5 w-20 text-center font-semibold text-slate-900 bg-slate-100/70">Qty *</th>
                              <th className="px-3 py-2.5 min-w-[130px] w-32 text-right">Cost *</th>
                              {isGstPurchase && showHsnCode && (
                                <th className="px-2 py-2.5 min-w-[110px] bg-emerald-50/40 text-emerald-900">
                                  <div className="flex items-center justify-between gap-1">
                                    <span>HSN (Optional)</span>
                                    {items.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => applyHcsCodeToAllRows(0)}
                                        className="text-[10px] text-blue-600 hover:text-blue-800 underline font-normal normal-case cursor-pointer"
                                        title="Copy line 1 HSN to all rows"
                                      >
                                        All
                                      </button>
                                    )}
                                  </div>
                                </th>
                              )}
                              {isGstPurchase && (
                                <th className="px-2 py-2.5 w-24 text-right text-slate-600 font-medium bg-slate-100/40">Cost+GST</th>
                              )}
                              <th className="px-3 py-2.5 min-w-[130px] w-32 text-right">MOP (₹) *</th>
                              <th className="px-3 py-2.5 min-w-[130px] w-32 text-right">MRP (₹) *</th>
                              <th className="px-2 py-2.5 w-24 text-right font-medium text-slate-900">Total Cost</th>
                              <th className="px-2 py-2.5 w-20 text-right text-slate-500">Margin</th>
                              <th className="px-3 py-2.5 w-10 text-center"></th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-100">
                            {items.map((item, rowIndex) => {
                              const cost = Number(item.costPerUnit) || 0;
                              const qty = Math.max(1, Number(item.quantity) || 1);
                              const tax = isGstPurchase ? (Number(item.taxPercent) || defaultTaxPercent) : 0;
                              const costWithGstPerUnit = cost + (cost * tax / 100);
                              const totalCostWithGst = isGstPurchase ? (costWithGstPerUnit * qty) : (cost * qty);
                              const mrpVal = Number(item.mrp) || 0;
                              const profitMargin = mrpVal - (isGstPurchase ? costWithGstPerUnit : cost);

                              return (
                                <tr key={rowIndex} className="hover:bg-slate-50/70 transition-colors">
                                  {/* # Row Index */}
                                  <td className="px-3 py-2 text-center text-slate-400 font-mono text-[11px]">
                                    {rowIndex + 1}
                                  </td>

                                  {/* Product Code */}
                                  <td className="px-2 py-2 font-mono text-[11px] text-blue-600 font-semibold truncate">
                                    {itemProductCodes[rowIndex] || '—'}
                                  </td>

                                  {/* Brand (Col 0) */}
                                  <td className="px-2 py-1.5">
                                    <SearchableSelect
                                      id={`cell-${rowIndex}-brand`}
                                      options={brands.map(b => ({ id: b.id || '', name: b.name }))}
                                      value={item.brand}
                                      onChange={(value) => handleItemChange(rowIndex, 'brand', value)}
                                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'brand')}
                                      placeholder="Select Brand"
                                      className="border-0! bg-transparent! py-1! text-xs!"
                                    />
                                  </td>

                                  {/* Model (Col 1) */}
                                  <td className="px-2 py-1.5">
                                    <input
                                      id={`cell-${rowIndex}-model`}
                                      type="text"
                                      value={item.model}
                                      onChange={(e) => handleItemChange(rowIndex, 'model', e.target.value)}
                                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'model')}
                                      className="w-full px-2 py-1 text-xs border border-slate-200 rounded uppercase bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                      placeholder="Model *"
                                    />
                                  </td>

                                  {/* Category (Col 2) */}
                                  <td className="px-2 py-1.5">
                                    <SearchableSelect
                                      id={`cell-${rowIndex}-category`}
                                      options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                                      value={item.category}
                                      onChange={(value) => handleItemChange(rowIndex, 'category', value)}
                                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'category')}
                                      placeholder="Select Category"
                                      className="border-0! bg-transparent! py-1! text-xs!"
                                    />
                                  </td>

                                  {/* Product Name (Col 3 - Non-Editable) */}
                                  {showProductName && (
                                    <td className="px-2 py-1.5">
                                      <input
                                        id={`cell-${rowIndex}-productName`}
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

                                  {/* In Stock count */}
                                  <td className="px-2 py-2 text-center font-mono text-slate-400 text-[11px]">
                                    {itemExistingStock[rowIndex] ?? 0}
                                  </td>

                                  {/* Qty (Col 4) */}
                                  <td className="px-2 py-1.5 bg-slate-50/60">
                                    <input
                                      id={`cell-${rowIndex}-quantity`}
                                      type="number"
                                      min="1"
                                      value={item.quantity || ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        handleItemChange(rowIndex, 'quantity', val === '' ? '' : parseInt(val, 10) || 1);
                                      }}
                                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'quantity')}
                                      onBlur={() => {
                                        if (!item.quantity || Number(item.quantity) < 1) {
                                          handleItemChange(rowIndex, 'quantity', 1);
                                        }
                                      }}
                                      className="w-full px-2 py-1 text-xs border border-slate-300 rounded text-center font-semibold text-slate-900 bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                    />
                                  </td>

                                  {/* Cost (Col 5) */}
                                  <td className="px-2 py-1.5 min-w-[130px]">
                                    <input
                                      id={`cell-${rowIndex}-costPerUnit`}
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
                                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'costPerUnit')}
                                      onFocus={() => setActiveCell({ rowIndex, field: 'costPerUnit', value: item.costPerUnit === 0 ? '' : encodePrice(item.costPerUnit) })}
                                      onBlur={() => setActiveCell(null)}
                                      className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded text-right font-mono font-medium bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                      placeholder="Cost *"
                                    />
                                  </td>

                                  {/* HSN (When GST is active and showHsnCode is enabled) */}
                                  {isGstPurchase && showHsnCode && (
                                    <td className="px-2 py-1.5 min-w-[110px]">
                                      <input
                                        id={`cell-${rowIndex}-hcsCode`}
                                        type="text"
                                        value={item.hcsCode || ''}
                                        onChange={(e) => handleItemChange(rowIndex, 'hcsCode', e.target.value)}
                                        onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'hcsCode')}
                                        className="w-full px-2 py-1 text-xs border border-slate-200 rounded uppercase font-mono bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                        placeholder="HSN (Optional)"
                                      />
                                    </td>
                                  )}

                                  {/* Cost+GST (When GST is enabled) */}
                                  {isGstPurchase && (
                                    <td className="px-2 py-2 text-xs text-right text-slate-700 font-mono font-medium bg-slate-50/60 w-24">
                                      {cost > 0 ? `₹${costWithGstPerUnit.toFixed(2)}` : '—'}
                                    </td>
                                  )}

                                  {/* MOP */}
                                  <td className="px-2 py-1.5 min-w-[130px]">
                                    <input
                                      id={`cell-${rowIndex}-mop`}
                                      type="number"
                                      value={item.mop || ''}
                                      onChange={(e) => handleItemChange(rowIndex, 'mop', parseFloat(e.target.value) || 0)}
                                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'mop')}
                                      className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded text-right font-mono font-medium bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                      placeholder="0.00"
                                    />
                                  </td>

                                  {/* MRP */}
                                  <td className="px-2 py-1.5 min-w-[130px]">
                                    <input
                                      id={`cell-${rowIndex}-mrp`}
                                      type="number"
                                      value={item.mrp || ''}
                                      onChange={(e) => handleItemChange(rowIndex, 'mrp', parseFloat(e.target.value) || 0)}
                                      onKeyDown={(e) => handleCellKeyDown(e, rowIndex, 'mrp')}
                                      className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded text-right font-mono font-medium bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                      placeholder="0.00"
                                    />
                                  </td>

                                  {/* Total Cost Display */}
                                  <td className="px-2 py-2 text-xs text-right font-mono font-semibold text-slate-900 w-24">
                                    ₹{totalCostWithGst.toFixed(2)}
                                  </td>

                                  {/* Margin Display */}
                                  <td className="px-2 py-2 text-xs text-right font-mono w-20">
                                    <span className={profitMargin >= 0 ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}>
                                      {mrpVal > 0 ? `₹${profitMargin.toFixed(2)}` : '—'}
                                    </span>
                                  </td>

                                  {/* Actions */}
                                  <td className="px-3 py-2 text-center w-10">
                                    <button
                                      type="button"
                                      onClick={() => removeItem(rowIndex)}
                                      className={`text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer ${items.length <= 1 ? 'opacity-30 cursor-not-allowed' : ''
                                        }`}
                                      disabled={items.length <= 1}
                                      title="Delete product line"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Step 2 Bottom Action Bar */}
                      <div className="p-4 bg-slate-50/70 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setPageStep(1)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>Back to Supplier</span>
                        </button>

                        <div className="flex items-center gap-4">
                          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-600">
                            <span>Total Items: <strong className="text-slate-900">{items.length}</strong></span>
                            <span className="text-slate-300">•</span>
                            <span>Quantity: <strong className="text-slate-900">{totalQuantity}</strong></span>
                            <span className="text-slate-300">•</span>
                            <span>Subtotal: <strong className="text-blue-700 font-mono">₹{totalAmount.toFixed(2)}</strong></span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              if (validateStep2()) {
                                setPageStep(3);
                              }
                            }}
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-all cursor-pointer"
                          >
                            <span>Proceed to Step 3: Payment & Summary</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
            )}

                  {/* ================= STEP 3: PAYMENT SETTLEMENT & SUMMARY ================= */}
                  {pageStep === 3 && (
                    <div className="space-y-6 w-full">

                      {/* Metrics Banner */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
                        {/* Supplier Card */}
                        <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                              <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">Supplier</span>
                              <Truck className="w-4 h-4 text-slate-600" />
                            </div>
                            <div className="text-sm font-bold text-slate-900 truncate" title={selectedSupplierName}>
                              {selectedSupplierName || 'No Supplier'}
                            </div>
                            {invoiceNumber && (
                              <div className="text-xs font-mono text-slate-500 truncate mt-0.5">
                                Inv #{invoiceNumber}
                              </div>
                            )}
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                            <span>Date:</span>
                            <span className="font-mono">{purchaseDate}</span>
                          </div>
                        </div>

                        {/* Quantity & Items */}
                        <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                              <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">Inventory Items</span>
                              <Package className="w-4 h-4 text-slate-600" />
                            </div>
                            <div className="text-xl font-bold font-mono text-slate-900">
                              {totalQuantity} <span className="text-xs font-sans font-normal text-slate-500">Total Units</span>
                            </div>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                            <span>Product Lines:</span>
                            <span className="font-bold text-slate-800">{items.length} Lines</span>
                          </div>
                        </div>

                        {/* Valuation & Tax */}
                        <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                              <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">Tax Valuation</span>
                              <Receipt className="w-4 h-4 text-slate-600" />
                            </div>
                            <div className="flex items-baseline justify-between text-xs">
                              <span className="text-slate-500">Base Cost:</span>
                              <span className="font-mono font-semibold text-slate-800">₹{baseAmount.toFixed(2)}</span>
                            </div>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-baseline justify-between text-xs">
                            <span className="text-slate-500">GST ({isGstPurchase ? `${defaultTaxPercent}%` : '0%'}):</span>
                            <span className="font-mono font-semibold text-blue-600">+₹{totalGstAmount.toFixed(2)}</span>
                          </div>
                        </div>

                        {/* Grand Total */}
                        <div className="bg-gradient-to-br from-blue-50/80 via-slate-50 to-indigo-50/50 rounded-xl border border-blue-200 p-4 shadow-2xs flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between text-xs text-blue-700 mb-1">
                              <span className="font-bold uppercase tracking-wider text-[11px]">Gross Payable</span>
                              <DollarSign className="w-4 h-4 text-blue-700" />
                            </div>
                            <div className="text-xl font-bold font-mono text-blue-950">
                              ₹{totalAmount.toFixed(2)}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-3 text-xs">
                            <span className="text-slate-500">Paid:</span>
                            <span className="font-mono font-semibold text-emerald-700">₹{effectivePaidAmount.toFixed(2)}</span>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-500">Due:</span>
                            <span className={`font-mono font-semibold ${pendingAmount > 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                              ₹{pendingAmount.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 2-Column Responsive Workspace */}
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 w-full">

                        {/* Left Column: Settlement Controls (7 cols) */}
                        <div className="xl:col-span-7 space-y-6">
                          <div className="bg-white rounded-xl border border-slate-200/90 p-5 sm:p-6 shadow-xs">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-100">
                              <div>
                                <h2 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2">
                                  <DollarSign className="w-4 h-4 text-blue-600" />
                                  <span>Payment Settlement</span>
                                </h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  Choose payment method and record immediate or ledger transaction values.
                                </p>
                              </div>

                              {paymentMode !== 'credit' && totalAmount > 0 && (
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
                              )}
                            </div>

                            {/* Payment Mode Selector */}
                            <div className="mb-5">
                              <label className="block text-xs font-semibold text-slate-700 mb-2">
                                Select Settlement Mode *
                              </label>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                                {[
                                  { mode: 'cash' as PaymentMode, label: 'Cash', desc: 'Cash Drawer', icon: Banknote },
                                  { mode: 'upi' as PaymentMode, label: 'UPI / QR', desc: 'Bank Transfer', icon: QrCode },
                                  { mode: 'card' as PaymentMode, label: 'Card', desc: 'POS Terminal', icon: CreditCard },
                                  { mode: 'split' as PaymentMode, label: 'Split', desc: 'Multi-tender', icon: Split },
                                  { mode: 'credit' as PaymentMode, label: 'Credit', desc: 'Vendor Ledger', icon: FileText }
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
                                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer ${paymentMode === mode
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

                            {/* Single Mode Paid Amount */}
                            {paymentMode !== 'credit' && paymentMode !== 'split' && (
                              <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200/90 mb-5 space-y-3">
                                <div className="flex items-center justify-between">
                                  <label className="text-xs font-semibold text-slate-700">
                                    Paid Amount (₹) *
                                  </label>
                                  <span className="text-[11px] text-slate-400">
                                    Outstanding will reflect on vendor ledger
                                  </span>
                                </div>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold font-mono">₹</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={paidAmount}
                                    onChange={(e) => setPaidAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full pl-8 pr-3 py-2 text-sm font-mono font-semibold rounded-lg border border-slate-200 bg-white text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Split Tender Inputs */}
                            {paymentMode === 'split' && (
                              <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200/90 mb-5 space-y-4">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                                  <span className="text-xs font-semibold text-slate-700">Split Payment Distribution</span>
                                  <span className="text-xs font-mono font-semibold text-blue-700">
                                    Total Paid: ₹{parseFloat(paidAmount) || 0}
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                      Cash Tender (₹)
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={cashAmount}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setCashAmount(val);
                                        const total = (parseFloat(val) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(cardAmount) || 0);
                                        setPaidAmount(total.toString());
                                      }}
                                      className="w-full px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg border border-slate-200 bg-white"
                                      placeholder="0.00"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                      UPI / QR Tender (₹)
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={upiAmount}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setUpiAmount(val);
                                        const total = (parseFloat(cashAmount) || 0) + (parseFloat(val) || 0) + (parseFloat(cardAmount) || 0);
                                        setPaidAmount(total.toString());
                                      }}
                                      className="w-full px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg border border-slate-200 bg-white"
                                      placeholder="0.00"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                      Card Tender (₹)
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={cardAmount}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setCardAmount(val);
                                        const total = (parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(val) || 0);
                                        setPaidAmount(total.toString());
                                      }}
                                      className="w-full px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg border border-slate-200 bg-white"
                                      placeholder="0.00"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Credit Notice */}
                            {paymentMode === 'credit' && (
                              <div className="p-4 bg-amber-50/80 rounded-xl border border-amber-200 mb-5">
                                <div className="flex items-start gap-3">
                                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                  <div className="text-xs text-amber-900 space-y-1">
                                    <strong className="block font-semibold">Credit Purchase Mode Active</strong>
                                    <p>
                                      The full invoice value of <strong>₹{totalAmount.toFixed(2)}</strong> will be credited to {selectedSupplierName || 'the supplier'}'s account balance.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right Column: Ledger Summary (5 cols) */}
                        <div className="xl:col-span-5 space-y-6">
                          <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs sticky top-20 space-y-4">
                            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                Procurement Summary
                              </span>
                              <span className="text-xs font-mono text-blue-700 font-semibold">
                                Non-IMEI Inventory
                              </span>
                            </div>

                            <div className="space-y-2.5 text-xs">
                              <div className="flex items-center justify-between text-slate-600">
                                <span>Total Items:</span>
                                <span className="font-semibold text-slate-800">{items.length} lines</span>
                              </div>

                              <div className="flex items-center justify-between text-slate-600">
                                <span>Total Units:</span>
                                <span className="font-semibold text-slate-800">{totalQuantity} units</span>
                              </div>

                              <div className="flex items-center justify-between text-slate-600">
                                <span>Base Cost (Subtotal):</span>
                                <span className="font-mono font-medium text-slate-800">₹{baseAmount.toFixed(2)}</span>
                              </div>

                              {isGstPurchase && (
                                <div className="flex items-center justify-between text-slate-600">
                                  <span>GST Amount:</span>
                                  <span className="font-mono font-medium text-blue-600">+₹{totalGstAmount.toFixed(2)}</span>
                                </div>
                              )}

                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-sm font-bold">
                                <span className="text-slate-900">Total Purchase Value:</span>
                                <span className="font-mono text-blue-700">₹{totalAmount.toFixed(2)}</span>
                              </div>

                              <div className="flex items-center justify-between text-xs text-slate-600">
                                <span>Paid Amount:</span>
                                <span className="font-mono font-semibold text-emerald-700">₹{effectivePaidAmount.toFixed(2)}</span>
                              </div>

                              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                                <span className="font-medium text-slate-700">Balance Pending:</span>
                                <span className={`font-mono font-bold ${pendingAmount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                  ₹{pendingAmount.toFixed(2)}
                                </span>
                              </div>
                            </div>

                            {/* Bottom Action Buttons */}
                            <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => handleSubmit()}
                                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-semibold text-xs rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-400 disabled:cursor-not-allowed"
                              >
                                <Save className="w-4 h-4" />
                                <span>{isSubmitting ? 'Saving to Warehouse...' : 'Save Purchase'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setPageStep(2)}
                                className="w-full py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 font-medium text-xs rounded-lg border border-slate-200 transition-colors cursor-pointer"
                              >
                                Back to Products & Inventory
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
        </div>
        </main>

        {/* ================= CONFIRMATION MODAL: CLEAR DRAFT ================= */}
        {showClearModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100 space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>

              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Clear Purchase Draft?
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Are you sure you want to discard this purchase draft? All entered supplier details, product lines, and pricing will be permanently cleared.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowClearModal(false)}
                  className="flex-1 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                >
                  No, Keep Editing
                </button>
                <button
                  type="button"
                  onClick={clearDraft}
                  className="flex-1 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-[0.98] rounded-lg transition-colors cursor-pointer"
                >
                  Yes, Clear Draft
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL: ADD NEW SUPPLIER ================= */}
        {showSupplierModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-100 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900">Add New Supplier</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={addNewSupplier} className="space-y-3 text-xs">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Supplier / Company Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newSupplier.name}
                    onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                    placeholder="e.g. Apex Electronics Ltd"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-600 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      required
                      value={newSupplier.phone}
                      onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-600 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Contact Person
                    </label>
                    <input
                      type="text"
                      value={newSupplier.contactPerson}
                      onChange={(e) => setNewSupplier({ ...newSupplier, contactPerson: e.target.value })}
                      placeholder="e.g. Rajesh Kumar"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-600 outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      GSTIN / Tax ID
                    </label>
                    <input
                      type="text"
                      value={newSupplier.gstNumber}
                      onChange={(e) => setNewSupplier({ ...newSupplier, gstNumber: e.target.value.toUpperCase() })}
                      placeholder="22AAAAA0000A1Z5"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-600 outline-none font-mono uppercase"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={newSupplier.email}
                      onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
                      placeholder="supplier@example.com"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-600 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Billing Address
                  </label>
                  <textarea
                    rows={2}
                    value={newSupplier.address}
                    onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                    placeholder="Street, City, State, PIN..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-600 outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowSupplierModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm cursor-pointer"
                  >
                    Save Supplier
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================= MODAL: SEARCH CATALOG ================= */}
        {isCatalogModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-100 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Search className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900">Search Warehouse Catalog</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCatalogModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchQuery(val);
                    searchProducts(val);
                  }}
                  placeholder="Search by brand, model, category, product name, or product code..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                />
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {searching ? (
                  <div className="p-8 text-center text-xs text-slate-500">Searching catalog...</div>
                ) : searchResults.length > 0 ? (
                  searchResults.map(prod => (
                    <div
                      key={prod.id}
                      onClick={() => handleSelectCatalogProduct(prod)}
                      className="p-3 hover:bg-blue-50/70 transition-colors flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <div className="text-xs font-semibold text-slate-900">{prod.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{prod.brand} • {prod.model}</span>
                          <span>•</span>
                          <span className="font-mono text-blue-600">{prod.productCode}</span>
                          <span>•</span>
                          <span>In stock: <strong>{prod.quantity || 0}</strong></span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-mono font-bold text-slate-900">₹{prod.cost || 0}</div>
                        <div className="text-[10px] text-slate-400">MRP: ₹{prod.mrp || 0}</div>
                      </div>
                    </div>
                  ))
                ) : searchQuery.trim() ? (
                  <div className="p-8 text-center text-xs text-slate-500">No products matching "{searchQuery}"</div>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">Type above to search existing warehouse inventory items</div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsCatalogModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= MULTI-STEP LOADER ================= */}
        <MultiStepLoader
          loadingStates={loadingStates}
          loading={multiStepLoading}
          duration={450}
          loop={false}
        />
    </div>
  );
};

export default AddPurchase;
