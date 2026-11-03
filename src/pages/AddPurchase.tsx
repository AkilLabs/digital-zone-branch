import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import { Package, DollarSign, Plus, Trash2, ShoppingCart, User, Receipt, Save } from 'lucide-react';
import type { Purchase, PurchaseItem, Supplier, PaymentMode, PaymentSplit, Product, Brand, Category } from '../types';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, increment, Timestamp, orderBy, limit, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateProductCode } from '../utils/productCode';
import { encodePrice, decodePrice } from '../utils/secretCode';
import { MultiStepLoader } from '../components/ui/multi-step-loader';
import SearchableSelect from '../components/SearchableSelect';
import * as XLSX from 'xlsx';

const AddPurchase: React.FC = () => {
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

  // Payment split fields
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');

  const [isGstPurchase, setIsGstPurchase] = useState<boolean>(false);
  const [defaultTaxPercent, setDefaultTaxPercent] = useState<number>(18);

  const [items, setItems] = useState<PurchaseItem[]>([{
    productName: '',
    brand: '',
    model: '',
    category: '',
    quantity: 1,
    costPerUnit: 0,
    totalCost: 0,
    mrp: 0,
    taxPercent: 0,
    hcsCode: ''
  }]);
  // Track whether each item row corresponds to an existing product
  const [itemIsExistingProduct, setItemIsExistingProduct] = useState<boolean[]>([false]);

  const [itemProductCodes, setItemProductCodes] = useState<string[]>(['']);
  const [itemExistingStock, setItemExistingStock] = useState<number[]>([0]);
  const [nextProductCodeNumber, setNextProductCodeNumber] = useState<number | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);

  // Multi-step loader state
  const [multiStepLoading, setMultiStepLoading] = useState(false);
  const [loadingStates, setLoadingStates] = useState<Array<{ text: string }>>([]);

  // Product search modal
  // popup is removed; using inline dropdown instead
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const [dropdownFocusedIndex, setDropdownFocusedIndex] = useState<number | null>(null);
  const searchDebounceRef = useRef<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // New supplier form
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    gstNumber: ''
  });

  // Draft auto-save state
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; field: string; value: string } | null>(null);


  useEffect(() => {
    fetchSuppliers();
    fetchBrandsAndCategories();

    if (isEditMode) {
      fetchPurchaseForEdit();
    } else {
      // Restore draft data from localStorage

    const savedDraft = localStorage.getItem('addPurchaseDraft');
    let hasRestoredCodes = false;
    let restoredItemsLength = 1;

    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        // Restore all form fields
        if (draft.selectedSupplierId) setSelectedSupplierId(draft.selectedSupplierId);
        if (draft.selectedSupplierName) setSelectedSupplierName(draft.selectedSupplierName);
        if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber);
        if (draft.notes) setNotes(draft.notes);
        if (draft.paymentMode) setPaymentMode(draft.paymentMode);
        if (draft.paidAmount) setPaidAmount(draft.paidAmount);
        if (draft.cashAmount) setCashAmount(draft.cashAmount);
        if (draft.upiAmount) setUpiAmount(draft.upiAmount);
        if (draft.cardAmount) setCardAmount(draft.cardAmount);
        if (draft.isGstPurchase !== undefined) setIsGstPurchase(Boolean(draft.isGstPurchase));
        if (draft.defaultTaxPercent !== undefined) setDefaultTaxPercent(Number(draft.defaultTaxPercent) || 18);
        
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

        showToast('Draft restored', 'info');
      } catch (error) {
        console.error('Error restoring draft:', error);
      }
    }

      initializeProductCode(!hasRestoredCodes, restoredItemsLength);
    }
  }, [id, isEditMode]);

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
          setItemExistingStock(data.items.map(() => 0)); // Not critical for edit
        }
      }
    } catch (error) {
      console.error('Error fetching purchase:', error);
      showToast('Failed to load purchase for editing', 'error');
    }
  };

  // Auto-save draft to localStorage whenever form data changes
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
      isGstPurchase,
      defaultTaxPercent,
      items,
      itemProductCodes,
      itemIsExistingProduct,
      itemExistingStock,
      savedAt: new Date().toISOString()
    };

    // Only save if there's meaningful data
    if (selectedSupplierId || items.some(item => item.productName || item.brand || item.model)) {
      localStorage.setItem('addPurchaseDraft', JSON.stringify(draftData));
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
    isGstPurchase,
    defaultTaxPercent,
    items,
    itemProductCodes,
    itemIsExistingProduct,
    itemExistingStock
  ]);

  const clearDraft = () => {
    localStorage.removeItem('addPurchaseDraft');
    setLastSaved(null);

    // Reset form to initial state
    setSelectedSupplierId('');
    setSelectedSupplierName('');
    setInvoiceNumber('');
    setNotes('');
    setPaymentMode('cash');
    setPaidAmount('');
    setCashAmount('');
    setUpiAmount('');
    setCardAmount('');
    setIsGstPurchase(false);
    setItems([{
      productName: '',
      brand: '',
      model: '',
      category: '',
      quantity: 1,
      costPerUnit: 0,
      totalCost: 0,
      mrp: 0,
      taxPercent: 0
    }]);

    setItemIsExistingProduct([false]);
    setItemExistingStock([0]);
    initializeProductCode(true, 1);

    showToast('Draft cleared', 'info');
  };


  const fetchBrandsAndCategories = async () => {
    try {
      // Brands are global master data (root-level), not hub-scoped
      const brandsSnapshot = await getDocs(query(collection(db, 'brands'), orderBy('name', 'asc')));
      setBrands(brandsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand)));

      // Categories are global master data (root-level), not hub-scoped
      const categoriesSnapshot = await getDocs(query(collection(db, 'categories'), orderBy('name', 'asc')));
      setCategories(categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    } catch (error) {
      console.error('Error fetching brands/categories:', error);
    }
  };

  const initializeProductCode = async (setInitialCode = true, itemsCount = 1) => {
    try {
      // generateProductCode() returns the next available code from database
      const nextCode = await generateProductCode(getCollectionRef('products'));
      const codeNumber = parseInt(nextCode, 10);

      if (Number.isNaN(codeNumber)) {
        throw new Error('Invalid product code format');
      }

      // Store the base number for generating subsequent codes
      setNextProductCodeNumber(codeNumber);
      // Set the first item's code
      if (setInitialCode) {
        const newCodes = [];
        for (let i = 0; i < itemsCount; i++) {
          newCodes.push(String(codeNumber + i).padStart(8, '0'));
        }
        setItemProductCodes(newCodes);
      }
    } catch (error) {
      console.error('Error initializing product code:', error);
      // Fallback to default
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
      // Sort by name in JavaScript to avoid needing composite index
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
    showToast('HSN code applied to all rows', 'success');
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, value: any) => {
    const newItems = [...items];

    // Convert to uppercase if it's a text field
    let processedValue = value;
    if (typeof value === 'string' && ['productName', 'brand', 'model', 'category', 'hcsCode'].includes(field)) {
      processedValue = value.toUpperCase();
    }

    newItems[index] = { ...newItems[index], [field]: processedValue };

    // Calculate total cost for the item
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

    // Update product name when brand, model, or category changes
    if (field === 'brand' || field === 'model' || field === 'category') {
      const brand = newItems[index].brand || '';
      const model = newItems[index].model || '';
      const category = newItems[index].category || '';
      newItems[index].productName = `${brand} ${model} ${category}`.trim();
    }

    setItems(newItems);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, rowIndex: number, colIndex: number) => {
    // Block invalid number characters for numeric inputs (quantity: 4, cost: 5, mrp: 6)
    // We allow navigation keys etc, but block e, E, +, - which are valid in type="number" but unwanted here
    if ([4, 5, 6].includes(colIndex) && ['e', 'E', '+', '-'].includes(e.key)) {
      e.preventDefault();
      return;
    }

    // COPY FROM ABOVE SHORTCUT (Ctrl + Right Arrow)
    if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (rowIndex > 0) {
        const prevItem = items[rowIndex - 1];
        let field: keyof PurchaseItem | null = null;
        // Map colIndex to field based on render order
        // 0: product, 1: brand, 2: model, 3: category, 4: quantity, 5: cost, 6: mrp
        switch (colIndex) {
          case 0: field = 'productName'; break;
          case 1: field = 'brand'; break;
          case 2: field = 'model'; break;
          case 3: field = 'category'; break;
          case 4: field = 'quantity'; break;
          case 5: field = 'costPerUnit'; break;
          case 6: field = 'mrp'; break;
        }

        if (field) {
          const value = prevItem[field];
          handleItemChange(rowIndex, field, value);

          // Automatically move to next cell
          const nextColIndex = colIndex + 1;
          const totalCols = 7;

          // Use setTimeout ensures focus happens after any potential re-renders
          setTimeout(() => {
            if (nextColIndex < totalCols) {
              const nextInput = document.querySelector(
                `[data-row="${rowIndex}"][data-col="${nextColIndex}"]`
              ) as HTMLElement;
              if (nextInput) nextInput.focus();
            }
          }, 0);
        }
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();

      const totalCols = 7; // productName, brand, model, category, quantity, costPerUnit, mrp
      const nextColIndex = colIndex + 1;

      if (nextColIndex < totalCols) {
        // Move to next column in same row
        const nextInput = document.querySelector(
          `[data-row="${rowIndex}"][data-col="${nextColIndex}"]`
        ) as HTMLElement;
        if (nextInput) nextInput.focus();
      } else {
        // Move to first column of next row
        if (rowIndex === items.length - 1) {
          // Add new row if at last row
          addItem();
          setTimeout(() => {
            const nextInput = document.querySelector(
              `[data-row="${rowIndex + 1}"][data-col="0"]`
            ) as HTMLElement;
            if (nextInput) nextInput.focus();
          }, 50);
        } else {
          // Move to next existing row
          const nextInput = document.querySelector(
            `[data-row="${rowIndex + 1}"][data-col="0"]`
          ) as HTMLElement;
          if (nextInput) nextInput.focus();
        }
      }
      return;
    }

    // ARROW KEY NAVIGATION
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const input = e.currentTarget;
      // Detailed check for number inputs which don't support selectionStart
      const isNumber = input instanceof HTMLInputElement && input.type === 'number';
      const isSelect = input instanceof HTMLSelectElement;

      let shouldMove = false;

      if (e.key === 'ArrowUp') {
        shouldMove = true;
      } else if (e.key === 'ArrowDown') {
        shouldMove = true;
      } else if (e.key === 'ArrowLeft') {
        if (isSelect) {
          // For select, only move if modifier key is pressed or special handling? 
          // Actually, left/right changes options in select. Let's ONLY move if valid.
          // But user might want to move to previous cell.
          // Let's rely on Shift+Tab or just simple Tab for Selects. 
          // OR allow moving if it was ALREADY handled (bubbles?) No.
          // For now, let's disable Left/Right nav out of Select to avoid annoyance 
          // unless we detect we are at start/end options which is hard.
          // Disabling Left/Right cell nav for Selects is safest.
          shouldMove = false;
        } else if (isNumber) {
          shouldMove = true;
        } else {
          // Move only if cursor is at the beginning
          if ((input as HTMLInputElement).selectionStart === 0 && (input as HTMLInputElement).selectionEnd === 0) {
            shouldMove = true;
          }
        }
      } else if (e.key === 'ArrowRight') {
        if (isSelect) {
          shouldMove = false;
        } else if (isNumber) {
          shouldMove = true;
        } else {
          // Move only if cursor is at the end
          if ((input as HTMLInputElement).selectionStart === (input as HTMLInputElement).value.length && (input as HTMLInputElement).selectionEnd === (input as HTMLInputElement).value.length) {
            shouldMove = true;
          }
        }
      }

      if (shouldMove) {
        let targetRow = rowIndex;
        let targetCol = colIndex;

        if (e.key === 'ArrowUp') targetRow--;
        if (e.key === 'ArrowDown') targetRow++;
        if (e.key === 'ArrowLeft') targetCol--;
        if (e.key === 'ArrowRight') targetCol++;

        // Boundary checks
        if (targetRow >= 0 && targetRow < items.length && targetCol >= 0 && targetCol < 7) {
          e.preventDefault();
          const targetInput = document.querySelector(
            `[data-row="${targetRow}"][data-col="${targetCol}"]`
          ) as HTMLElement;
          if (targetInput) {
            targetInput.focus();
          }
        }
      }
    }
  };

  const toggleGstPurchase = (enable: boolean) => {
    setIsGstPurchase(enable);
    setItems(prevItems => prevItems.map(item => {
      const cost = Number(item.costPerUnit) || 0;
      const qty = Number(item.quantity) || 0;
      const tax = enable ? (Number(item.taxPercent) || defaultTaxPercent) : 0;
      const costWithGst = cost + (cost * tax / 100);
      return {
        ...item,
        taxPercent: tax,
        totalCost: enable ? (qty * costWithGst) : (qty * cost)
      };
    }));
  };

  const addItem = () => {
    const newIndex = items.length;
    const newCode = getNextProductCodeForItem(newIndex);
    const tax = isGstPurchase ? defaultTaxPercent : 0;
    const lastHcsCode = items[items.length - 1]?.hcsCode || '';
    setItems([...items, {
      productName: '',
      brand: '',
      model: '',
      category: '',
      quantity: 1,
      costPerUnit: 0,
      totalCost: 0,
      mrp: 0,
      taxPercent: tax,
      hcsCode: isGstPurchase ? lastHcsCode : ''
    }]);

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
    }
  };

  const searchProducts = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsDropdownOpen(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const productsRef = getCollectionRef('products');
      // Search across all products (including out-of-stock) to ensure results are found
      const snapshot = await getDocs(productsRef);
      const products: Product[] = [];

      for (const docSnap of snapshot.docs) {
        const data: any = docSnap.data();
        const quantity = data.quantity || 0;
        // Debug log for diagnosis
        if (data.productCode === '20102187') {
          console.log('DEBUG: Product 20102187 Firestore data:', data);
          console.log('DEBUG: Parsed quantity for 20102187:', quantity);
        }
        products.push({
          id: docSnap.id,
          productCode: data.productCode,
          name: data.name,
          brand: data.brand,
          model: data.model,
          category: data.category,
          cost: data.cost,
          mrp: data.mrp,
          quantity,
          supplier: data.supplier,
          isAvailable: data.isAvailable
        } as Product);
      }

      // Filter products that match the search query in name, brand, model, or category
      const qLower = searchQuery.toLowerCase();
      const filtered = products.filter(product => {
        const name = typeof product.name === 'string' ? product.name.toLowerCase() : '';
        const brand = typeof product.brand === 'string' ? product.brand.toLowerCase() : '';
        const model = typeof product.model === 'string' ? product.model.toLowerCase() : '';
        const category = typeof product.category === 'string' ? product.category.toLowerCase() : '';

        return (
          name.includes(qLower) ||
          brand.includes(qLower) ||
          model.includes(qLower) ||
          category.includes(qLower) ||
          (product.productCode && String(product.productCode).toLowerCase().includes(qLower))
        );
      });

      const topResults = filtered.slice(0, 10);
      setSearchResults(topResults);
      setIsDropdownOpen(topResults.length > 0);
    } catch (error) {
      console.error('Error searching products:', error);
      showToast('Failed to search products', 'error');
    } finally {
      setSearching(false);
    }
  };

  const selectProduct = (product: Product, rowIndex: number) => {
    const code = product.productCode || '';
    // Check if the product already exists in another row
    const existingIndex = itemProductCodes.findIndex((c, i) => c && c === code && i !== rowIndex);

    if (existingIndex !== -1) {
      // Merge current row into existing row: sum quantities and update pricing
      const mergedItems = [...items];
      const src = mergedItems[rowIndex];
      const dest = mergedItems[existingIndex];

      const srcQty = src.quantity || 0;
      const destQty = dest.quantity || 0;
      const newQty = destQty + srcQty;

      // Prefer the selected product's cost/mrp (rounded) for the merged row
      const pBaseCost = (product.baseCost !== undefined && product.baseCost > 0) ? Number(product.baseCost) : (product.cost ? Math.round(product.cost) : dest.costPerUnit);
      dest.costPerUnit = pBaseCost;
      dest.mrp = product.mrp ? Math.round(product.mrp) : dest.mrp;
      dest.quantity = newQty;
      const tax = isGstPurchase ? (product.taxPercent !== undefined ? Number(product.taxPercent) : defaultTaxPercent) : 0;
      dest.taxPercent = tax;
      const costWithGst = dest.costPerUnit + (dest.costPerUnit * tax / 100);
      dest.totalCost = isGstPurchase ? (dest.quantity * costWithGst) : (dest.quantity * dest.costPerUnit);

      // Update existing stock for destination (keep inventory value)
      const mergedExistingStock = [...itemExistingStock];
      mergedExistingStock[existingIndex] = product.quantity || mergedExistingStock[existingIndex] || 0;

      // Remove the source row
      mergedItems.splice(rowIndex, 1);

      // Update product codes and existing flags accordingly
      const mergedCodes = [...itemProductCodes];
      mergedCodes.splice(rowIndex, 1);

      const mergedIsExisting = [...itemIsExistingProduct];
      mergedIsExisting.splice(rowIndex, 1);

      setItems(mergedItems);
      setItemProductCodes(mergedCodes);
      setItemIsExistingProduct(mergedIsExisting);
      setItemExistingStock(mergedExistingStock);

      // Keep dropdown closed and clear search
      setIsDropdownOpen(false);
      setSearchQuery('');
      setSearchResults([]);

      // Focus the merged row
      setSelectedRowIndex(existingIndex > rowIndex ? existingIndex - 1 : existingIndex);
      return;
    }

    const newItems = [...items];
    const pBaseCost = (product.baseCost !== undefined && product.baseCost > 0) ? Number(product.baseCost) : (product.cost ? Number(product.cost) : 0);
    const itemTax = isGstPurchase ? (product.taxPercent !== undefined ? Number(product.taxPercent) : defaultTaxPercent) : 0;
    const itemQty = newItems[rowIndex].quantity && newItems[rowIndex].quantity > 0 ? newItems[rowIndex].quantity : 1;
    const itemCostWithGst = pBaseCost + (pBaseCost * itemTax / 100);

    newItems[rowIndex] = {
      ...newItems[rowIndex],
      productName: product.name,
      brand: product.brand,
      model: product.model || '',
      category: product.category,
      costPerUnit: pBaseCost,
      mrp: product.mrp ? Number(product.mrp) : 0,
      taxPercent: itemTax,
      hcsCode: product.hcsCode || '',
      quantity: itemQty,
      totalCost: isGstPurchase ? (itemQty * itemCostWithGst) : (itemQty * pBaseCost)
    };
    setItems(newItems);
    // Update selected product code for this row
    const newCodes = [...itemProductCodes];
    newCodes[rowIndex] = code || newCodes[rowIndex] || '';
    setItemProductCodes(newCodes);
    // set existing stock for this row
    const newExisting = [...itemExistingStock];
    while (newExisting.length <= rowIndex) newExisting.push(0);
    newExisting[rowIndex] = product.quantity || 0;
    setItemExistingStock(newExisting);
    // Mark this row as an existing product so brand/model/category become read-only
    const newIsExisting = [...itemIsExistingProduct];
    // Ensure array is large enough
    while (newIsExisting.length <= rowIndex) newIsExisting.push(false);
    newIsExisting[rowIndex] = true;
    setItemIsExistingProduct(newIsExisting);
    // Clear search state and close dropdown
    setIsDropdownOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const openProductSearch = (rowIndex: number) => {
    setSelectedRowIndex(rowIndex);
    setIsDropdownOpen(true);
    const currentName = items[rowIndex]?.productName || '';
    setSearchQuery(currentName);
    searchProducts(currentName);
    setDropdownFocusedIndex(0);
  };

  const computeDropdownPosition = () => {
    const el = searchContainerRef.current;
    if (!el) {
      setDropdownPosition(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    // Use fixed positioning relative to viewport to avoid transformed/overflow parents
    // Expand width to match the table wrapper if available and visible
    const tableEl = tableWrapperRef.current;
    if (tableEl) {
      const tableRect = tableEl.getBoundingClientRect();
      // Only use table width if it's visible (width > 0)
      if (tableRect.width > 0) {
        setDropdownPosition({ left: tableRect.left, top: rect.bottom, width: tableRect.width });
        return;
      }
    }
    // Mobile: Return null to disable Portal and use inline absolute dropdown
    setDropdownPosition(null);
  };

  const handleDropdownKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen) return;
    if (!searchResults || searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDropdownFocusedIndex(prev => {
        if (prev === null) return 0;
        return Math.min(searchResults.length - 1, prev + 1);
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDropdownFocusedIndex(prev => {
        if (prev === null) return searchResults.length - 1;
        return Math.max(0, prev - 1);
      });
    } else if (e.key === 'Enter') {
      if (dropdownFocusedIndex !== null) {
        e.preventDefault();
        const idx = dropdownFocusedIndex;
        const product = searchResults[idx];
        if (product) {
          selectProduct(product, selectedRowIndex ?? 0);
          setDropdownFocusedIndex(null);
        }
      }
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
      setDropdownFocusedIndex(null);
      setSelectedRowIndex(null);
    }
  };

  // Close dropdown when clicking outside the active search container
  useEffect(() => {
    if (!isDropdownOpen) return;

    // compute initial position
    computeDropdownPosition();

    const handler = (e: MouseEvent) => {
      const el = searchContainerRef.current;
      const drop = dropdownRef.current;
      if (el && el.contains(e.target as Node)) return;
      if (drop && drop.contains(e.target as Node)) return;
      setIsDropdownOpen(false);
      setSelectedRowIndex(null);
      setDropdownPosition(null);
    };

    const onScrollOrResize = () => computeDropdownPosition();

    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    const wrapperEl = tableWrapperRef.current;
    if (wrapperEl) wrapperEl.addEventListener('scroll', onScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      if (wrapperEl) wrapperEl.removeEventListener('scroll', onScrollOrResize);
    };
  }, [isDropdownOpen]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

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
        const summaryMap = new Map(
          summaryRows.map(row => [normalizeHeader(row.Field), row.Value])
        );

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
        const productName = toText(getCellValue(row, ['product name', 'name'])) || `${toText(getCellValue(row, ['brand']))} ${toText(getCellValue(row, ['model']))} ${toText(getCellValue(row, ['category']))}`.trim();
        const brand = toText(getCellValue(row, ['brand']));
        const model = toText(getCellValue(row, ['model']));
        const category = toText(getCellValue(row, ['category']));
        const imei = toText(getCellValue(row, ['imei']));
        const hcsCode = toText(getCellValue(row, ['hcs code', 'hcscode', 'hsn code', 'hsncode', 'hsn']));
        const quantity = Math.max(1, Math.round(toNumber(getCellValue(row, ['quantity', 'qty'])) || 1));
        const costPerUnit = toNumber(getCellValue(row, ['cost/unit', 'cost per unit', 'cost']));
        const mrp = toNumber(getCellValue(row, ['mrp']));
        const totalCost = toNumber(getCellValue(row, ['total cost', 'total']));
        const mop = toNumber(getCellValue(row, ['mop']));
        const taxPercent = toNumber(getCellValue(row, ['tax %', 'tax', 'tax percent']));
        const highestDiscountLimit = toNumber(getCellValue(row, ['highest discount limit', 'discount limit']));

        const normalizedItem: PurchaseItem = {
          productName: productName || `${brand} ${model} ${category}`.trim() || imei || 'IMPORTED ITEM',
          brand,
          model,
          category,
          quantity,
          costPerUnit,
          totalCost: totalCost > 0 ? totalCost : quantity * costPerUnit,
          mrp: mrp > 0 ? mrp : costPerUnit,
          imei,
          hcsCode,
          mop,
          taxPercent,
          highestDiscountLimit
        };

        return normalizedItem;
      });

      const importedCodes = rows.map((row, index) => {
        const rawCode = toText(getCellValue(row, ['product code', 'code']));
        if (/^\d{8}$/.test(rawCode)) return rawCode;
        return getNextProductCodeForItem(index);
      });

      const hasTax = importedItems.some(it => (it.taxPercent || 0) > 0);
      if (hasTax) {
        setIsGstPurchase(true);
      }

      setItems(importedItems);
      setItemProductCodes(importedCodes);
      setItemIsExistingProduct(importedItems.map(() => false));
      setItemExistingStock(importedItems.map(() => 0));

      showToast(`Imported ${importedItems.length} item${importedItems.length === 1 ? '' : 's'} from Excel`, 'success');
    } catch (error) {
      console.error('Error importing Excel file:', error);
      showToast('Failed to import Excel file', 'error');
    }
  };

  const exportToExcel = () => {
    try {
      const { totalQuantity, totalAmount, baseAmount, totalGstAmount } = calculateTotals();
      const paid = parseFloat(paidAmount) || 0;
      const pending = totalAmount - paid;

      const summaryData = [
        { Field: 'Supplier', Value: selectedSupplierName || '' },
        { Field: 'Supplier ID', Value: selectedSupplierId || '' },
        { Field: 'Invoice Number', Value: invoiceNumber || '' },
        { Field: 'Notes', Value: notes || '' },
        { Field: 'Payment Mode', Value: paymentMode },
        { Field: 'Paid Amount', Value: paid },
        { Field: 'Pending Amount', Value: pending },
        { Field: 'Total Quantity', Value: totalQuantity },
        { Field: 'Total Amount', Value: totalAmount },
        ...(isGstPurchase ? [
          { Field: 'Base Amount', Value: baseAmount },
          { Field: 'Total GST Amount', Value: totalGstAmount }
        ] : [])
      ];

      const itemRows = items.map((item, index) => ({
        '#': index + 1,
        'Product Name': item.productName || `${item.brand} ${item.model} ${item.category}`.trim(),
        'Brand': item.brand,
        'Model': item.model || '',
        'Category': item.category,
        'Quantity': Number(item.quantity) || 0,
        'Cost/Unit': Number(item.costPerUnit) || 0,
        'MRP': Number(item.mrp) || 0,
        'Total Cost': Number(item.totalCost) || 0,
        'IMEI': item.imei || '',
        'HSN Code': item.hcsCode || '',
        'MOP': Number(item.mop) || 0,
        'Tax %': Number(item.taxPercent) || 0,
        'Highest Discount Limit': Number(item.highestDiscountLimit) || 0
      }));

      const wb = XLSX.utils.book_new();
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      const itemsWs = XLSX.utils.json_to_sheet(itemRows);

      XLSX.utils.book_append_sheet(wb, summaryWs, 'Purchase Summary');
      XLSX.utils.book_append_sheet(wb, itemsWs, 'Purchase Items');

      const datePart = new Date().toISOString().split('T')[0];
      const supplierPart = (selectedSupplierName || 'purchase').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      XLSX.writeFile(wb, `purchase_draft_${supplierPart}_${datePart}.xlsx`);
    } catch (error) {
      console.error('Error exporting purchase draft to Excel:', error);
      showToast('Failed to export Excel file', 'error');
    }
  };

  const generatePurchaseNumber = async () => {
    try {
      const purchasesRef = getCollectionRef('purchases');
      
      // Query the latest purchases to determine the next sequential number
      const qLatest = query(purchasesRef, orderBy('createdAt', 'desc'), limit(20));
      const snapshot = await getDocs(qLatest);

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
      // Absolute fallback using timestamp to ensure uniqueness and prevent failure
      return `PUR-${Date.now()}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedSupplierId) {
      showToast('Please select a supplier', 'error');
      return;
    }

    if (items.some(item => !item.brand.trim() || !item.category.trim() || item.quantity <= 0 || item.costPerUnit <= 0)) {
      showToast('Please fill in all item details correctly', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const { totalQuantity, totalAmount, baseAmount, totalGstAmount } = calculateTotals();
      const paid = parseFloat(paidAmount) || 0;
      const isCredit = paymentMode === 'credit';
      const pending = totalAmount - paid;

      let paymentStatus: 'paid' | 'pending' | 'unpaid' = 'unpaid';

      if (paid >= totalAmount) {
        paymentStatus = 'paid';
      } else if (paid > 0) {
        paymentStatus = 'pending';
      } else {
        paymentStatus = 'unpaid';
      }

      // Handle payment split
      let paymentSplit: PaymentSplit | undefined;
      if (paymentMode === 'split') {
        const cash = parseFloat(cashAmount) || 0;
        const upi = parseFloat(upiAmount) || 0;
        const card = parseFloat(cardAmount) || 0;

        if (cash + upi + card !== paid) {
          showToast('Payment split amounts must equal paid amount', 'error');
          setIsSubmitting(false);
          return;
        }

        paymentSplit = { cash, upi, card };
      }

      // Build loading states with product names
      const states: Array<{ text: string }> = [];
      states.push({ text: 'Validating supplier and payment...' });
      items.forEach((item) => {
        const productName = `${item.brand} ${item.model} ${item.category}`.trim();
        states.push({ text: `Saving ${productName}...` });
      });
      states.push({ text: 'Updating supplier totals...' });
      states.push({ text: 'Finalizing purchase...' });
      states.push({ text: `✓ Purchase saved successfully!` });

      setLoadingStates(states);
      setMultiStepLoading(true);

      if (isEditMode && originalPurchase) {
        states.push({ text: 'Reverting previous purchase data...' });
        setLoadingStates([...states]);
        
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

      // Check if products already exist and get their codes
      const finalProductCodes: string[] = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const productName = `${item.brand} ${item.model} ${item.category}`.trim();
        const productsRef = getCollectionRef('products');
        const q = query(productsRef, where('name', '==', productName));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const productDoc = snapshot.docs[0];
          finalProductCodes.push(productDoc.data().productCode);
        } else {
          finalProductCodes.push(itemProductCodes[index]);
        }
      }

      const purchaseNumber = await generatePurchaseNumber();

      const purchaseData: any = {
        purchaseNumber,
        supplierId: selectedSupplierId,
        supplierName: selectedSupplierName,
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
        creditCleared: 0, // No clearances yet
        isIMEIPurchase: false,
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || ''
      };

      if (paymentSplit) purchaseData.paymentSplit = paymentSplit;
      if (invoiceNumber.trim()) purchaseData.invoiceNumber = invoiceNumber;
      if (notes.trim()) purchaseData.notes = notes;

      let purchaseRefId = '';
      if (isEditMode && id) {
        // Update purchase in Firestore
        const purchaseRef = doc(db, 'purchases', id);
        purchaseData.updatedAt = new Date();
        // keep original createdAt and createdBy
        purchaseData.createdAt = originalPurchase.createdAt;
        purchaseData.createdBy = originalPurchase.createdBy;
        purchaseData.createdByName = originalPurchase.createdByName;
        
        // ensure purchaseNumber stays the same
        purchaseData.purchaseNumber = originalPurchase.purchaseNumber;
        
        await updateDoc(purchaseRef, purchaseData);
        purchaseRefId = id;
      } else {
        // Add purchase to Firestore
        const purchaseRef = await addDoc(getCollectionRef('purchases'), purchaseData);
        purchaseRefId = purchaseRef.id;
      }

      // Record purchase transaction in supplier history
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

      // If a payment was made during purchase, record it as a payment transaction
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

      // Update supplier totals
      const supplierRef = doc(db, 'suppliers', selectedSupplierId);
      const updateData: any = {
        totalPurchaseAmount: increment(totalAmount),
        totalPaid: increment(paid),
        totalPending: increment(pending),
        updatedAt: Timestamp.now()
      };

      await updateDoc(supplierRef, updateData);

      // Add products to inventory
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const productName = `${item.brand} ${item.model} ${item.category}`.trim();
        const baseCost = Number(item.costPerUnit) || 0;
        const tax = isGstPurchase ? (Number(item.taxPercent) || 0) : 0;
        const costWithGst = baseCost + (baseCost * tax / 100);
        const effectiveCost = isGstPurchase && tax > 0 ? costWithGst : baseCost;

        // Check if product already exists by name
        const productsRef = getCollectionRef('products');
        const q = query(productsRef, where('name', '==', productName));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          // Update existing product: increment quantity and update price fields
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
          // If existing product lacks brand/model/category, fill from the item
          if (!existingData.brand && item.brand) updateData.brand = item.brand;
          if (!existingData.model && item.model) updateData.model = item.model;
          if (!existingData.category && item.category) updateData.category = item.category;

          // If productCode is missing in existing doc but we generated one, set it
          if (!existingData.productCode && finalProductCodes[index]) updateData.productCode = finalProductCodes[index];

          await updateDoc(getDocRef('products', productDoc.id), updateData);
        } else {
          // Create new product with sensible defaults for missing fields
          const brand = item.brand && item.brand.trim() ? item.brand : 'Unknown Brand';
          const model = item.model && item.model.trim() ? item.model : 'N/A';
          const category = item.category && item.category.trim() ? item.category : 'General';
          const code = finalProductCodes[index] || getNextProductCodeForItem(index);

          await addDoc(getCollectionRef('products'), {
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
            createdBy: currentUser?.uid || '',
            createdByName: currentUser?.displayName || ''
          });
        }
      }

      showToast(`Purchase ${purchaseNumber} ${isEditMode ? 'updated' : 'added'} successfully!`, 'success');

      // Keep loader visible for a moment to show final success message
      setTimeout(async () => {
        setMultiStepLoading(false);

        // Clear the draft from localStorage
        localStorage.removeItem('addPurchaseDraft');

        // Reset form
        setSelectedSupplierId('');
        setSelectedSupplierName('');
        setInvoiceNumber('');
        setNotes('');
        setPaymentMode('cash');
        setPaidAmount('');
        setCashAmount('');
        setUpiAmount('');
        setCardAmount('');
        setIsGstPurchase(false);
        setItems([{
          productName: '',
          brand: '',
          model: '',
          category: '',
          quantity: 1,
          costPerUnit: 0,
          totalCost: 0,
          mrp: 0,
          taxPercent: 0
        }]);

        await initializeProductCode();
        navigate('/purchases');

      }, 1500);
    } catch (error) {
      console.error('Error adding purchase:', error);
      showToast('Failed to add purchase', 'error');
      setMultiStepLoading(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { totalQuantity, totalAmount, baseAmount, totalGstAmount } = calculateTotals();
  const pendingAmount = totalAmount - (parseFloat(paidAmount) || 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      {/* Hide number input spinners for quantity/cost/mrp */}
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
                Add Purchase
              </h1>
              <p className="text-gray-600 mt-1">{isEditMode ? 'Edit an existing purchase' : 'Add bulk product purchases from suppliers'}</p>
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
                  {!isEditMode && lastSaved && (
                    <button
                      type="button"
                      onClick={clearDraft}
                      className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-md transition-colors font-medium"
                    >
                      Clear Draft
                    </button>
                  )}
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
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-600" />
                Product Items
              </h2>

              {/* GST Purchase Toggle */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-100">
                  <button
                    type="button"
                    onClick={() => toggleGstPurchase(false)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      !isGstPurchase
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Non-GST
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleGstPurchase(true)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                      isGstPurchase
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-gray-500 hover:text-emerald-700'
                    }`}
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    GST Purchase
                  </button>
                </div>

                {isGstPurchase && (
                  <div className="flex items-center gap-1.5 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 text-xs">
                    <span className="text-emerald-800 font-semibold">Default Tax:</span>
                    <select
                      value={defaultTaxPercent}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDefaultTaxPercent(val);
                        setItems(prev => prev.map(it => {
                          const cost = Number(it.costPerUnit) || 0;
                          const qty = Number(it.quantity) || 0;
                          const tax = (it.taxPercent && it.taxPercent !== defaultTaxPercent) ? it.taxPercent : val;
                          const costWithGst = cost + (cost * tax / 100);
                          return {
                            ...it,
                            taxPercent: tax,
                            totalCost: qty * costWithGst
                          };
                        }));
                      }}
                      className="bg-white border border-emerald-300 text-emerald-900 rounded font-bold px-2 py-0.5 text-xs focus:ring-1 focus:ring-emerald-500"
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

            {/* Mobile View: Item Cards */}
            <div className="block sm:hidden space-y-4 mb-4">
              {items.map((item, rowIndex) => (
                <div key={rowIndex} className={`bg-gray-50 rounded-lg p-3 border border-gray-200 relative shadow-sm ${selectedRowIndex === rowIndex ? 'z-10 ring-1 ring-blue-300' : 'z-0'}`}>
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
                      <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 mt-1 inline-block">
                        {itemProductCodes[rowIndex] || '—'}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-gray-400 uppercase font-medium">Total</span>
                      <span className="text-sm font-bold text-green-600">{encodePrice(item.totalCost)}</span>
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
                            onFocus={() => { setSelectedRowIndex(rowIndex); if (searchQuery.trim()) setIsDropdownOpen(true); }}
                            className="w-full pl-3 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                            placeholder="Search product..."
                          />
                          <button
                            type="button"
                            onClick={() => openProductSearch(rowIndex)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600"
                          >
                            <Package size={16} />
                          </button>

                          {/* Mobile Inline Dropdown (Absolute) */}
                          {selectedRowIndex === rowIndex && isDropdownOpen && !dropdownPosition && (
                            <div className="absolute top-full left-0 w-full z-50 bg-white shadow-xl border border-gray-200 rounded-lg max-h-60 overflow-y-auto mt-1">
                              {searching ? (
                                <div className="p-3 text-center">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mx-auto"></div>
                                </div>
                              ) : searchResults.length > 0 ? (
                                <div>
                                  {searchResults.map((product) => (
                                    <div
                                      key={product.id}
                                      onMouseDown={(e) => {
                                        // Use onMouseDown to trigger before blur events
                                        e.preventDefault();
                                        e.stopPropagation();
                                        selectProduct(product, rowIndex);
                                      }}
                                      className="px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-blue-50 active:bg-blue-100 cursor-pointer"
                                    >
                                      <div className="flex flex-col">
                                        <div className="flex justify-between items-start">
                                          <span className="text-sm font-medium text-gray-900 truncate pr-2">{product.name}</span>
                                          <span className="text-xs font-mono text-blue-600 whitespace-nowrap">{product.productCode}</span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1 text-xs text-gray-500">
                                          <span className="truncate max-w-[60%]">{product.brand} {product.model}</span>
                                          <div className="flex gap-3">
                                            <span>Qty: {product.quantity}</span>
                                            <span className="font-semibold text-gray-900">₹{product.cost}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="p-3 text-center text-xs text-gray-500">No products found</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
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
                            disabled={itemIsExistingProduct[rowIndex]}
                            className="!border-0 !bg-transparent !py-2"
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
                          disabled={itemIsExistingProduct[rowIndex]}
                        />
                      </div>
                    </div>

                    {/* Category & Stock */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Category</label>
                        <div className="relative border border-gray-300 rounded-lg bg-white overflow-hidden">
                          <SearchableSelect
                            options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                            value={item.category}
                            onChange={(value) => handleItemChange(rowIndex, 'category', value)}
                            placeholder="Select"
                            disabled={itemIsExistingProduct[rowIndex]}
                            className="!border-0 !bg-transparent !py-2"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">In Stock</label>
                        <div className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-100 rounded-lg text-gray-600">
                          {itemExistingStock[rowIndex] ?? 0}
                        </div>
                      </div>
                    </div>

                    {/* HSN Code if GST enabled */}
                    {isGstPurchase && (
                      <div className="bg-emerald-50/60 p-2.5 rounded-lg border border-emerald-200">
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] font-bold text-emerald-800 uppercase flex items-center gap-1">
                            <span>HSN Code</span>
                            <span className="text-emerald-600 font-normal text-[9px]">(Non-IMEI GST)</span>
                          </label>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => applyHcsCodeToAllRows(rowIndex)}
                              className="text-[10px] text-blue-600 font-semibold hover:text-blue-700 hover:underline"
                            >
                              Apply to all rows
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={item.hcsCode || ''}
                          onChange={(e) => handleItemChange(rowIndex, 'hcsCode', e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-emerald-300 rounded-md focus:ring-2 focus:ring-emerald-500 bg-white font-mono uppercase"
                          placeholder="ENTER HSN CODE"
                        />
                      </div>
                    )}

                    {/* Qty, Cost, MRP, and Tax % if GST enabled */}
                    <div className={`grid ${isGstPurchase ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2`}>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block text-blue-700">Qty *</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(rowIndex, 'quantity', e.target.value === '' ? '' : parseInt(e.target.value))}
                          className="w-full px-1 py-2 text-sm border-2 border-blue-100 rounded-lg focus:ring-2 focus:ring-blue-500 text-center bg-white font-bold text-gray-900"
                          min="0"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cost {isGstPurchase ? '(Base)' : ''}</label>
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
                      {isGstPurchase && (
                        <div>
                          <label className="text-[10px] font-bold text-emerald-700 uppercase mb-1 block">Tax %</label>
                          <select
                            value={item.taxPercent ?? defaultTaxPercent}
                            onChange={(e) => handleItemChange(rowIndex, 'taxPercent', parseInt(e.target.value))}
                            className="w-full px-1 py-2 text-sm border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-center bg-emerald-50/50 font-bold text-emerald-800"
                          >
                            <option value={0}>0%</option>
                            <option value={5}>5%</option>
                            <option value={12}>12%</option>
                            <option value={18}>18%</option>
                            <option value={28}>28%</option>
                          </select>
                        </div>
                      )}
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
                    </div>
                    {isGstPurchase && (
                      <div className="flex justify-between items-center text-xs px-2.5 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100 text-emerald-800">
                        <span className="font-medium">Cost + GST / Unit:</span>
                        <span className="font-bold text-emerald-900">
                          ₹{((Number(item.costPerUnit) || 0) * (1 + (Number(item.taxPercent ?? defaultTaxPercent) / 100))).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div ref={tableWrapperRef} className="hidden sm:block overflow-x-auto overflow-y-visible">
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gradient-to-r from-blue-50 to-indigo-50">
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-8">#</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[120px]">Product Code</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[180px]">Product Name</th>
                    {isGstPurchase && (
                      <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-emerald-800 min-w-[120px] bg-emerald-50/50">
                        <div className="flex items-center justify-between gap-1">
                          <span>HSN Code</span>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => applyHcsCodeToAllRows(0)}
                              className="text-[10px] text-emerald-700 hover:text-emerald-900 underline font-normal normal-case"
                              title="Apply row 1 HSN to all rows"
                            >
                              All
                            </button>
                          )}
                        </div>
                      </th>
                    )}
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[120px]">Brand *</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[120px]">Model</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 min-w-[120px]">Category *</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-24">In Stock</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-24">Add Qty *</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32">{isGstPurchase ? 'Base Cost/Unit' : 'Cost/Unit'}</th>
                    {isGstPurchase && (
                      <>
                        <th className="border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-emerald-800 w-24 bg-emerald-50/50">Tax %</th>
                        <th className="border border-gray-300 px-3 py-2 text-right text-xs font-semibold text-blue-700 w-32 bg-blue-50/50">Cost+GST/Unit</th>
                      </>
                    )}
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32">MRP (₹)</th>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 w-32">Total Cost</th>
                    <th className="border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-gray-700 w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-blue-50 transition-colors">
                      <td className="border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-600 bg-gray-50">
                        {rowIndex + 1}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-sm font-mono text-blue-600 bg-blue-50 font-semibold">
                        {itemProductCodes[rowIndex] || ''}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 bg-gray-50">
                        <div className="flex items-center gap-2">
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
                              onFocus={() => { setSelectedRowIndex(rowIndex); if (searchQuery.trim()) setIsDropdownOpen(true); }}
                              onKeyDown={(e) => {
                                if (isDropdownOpen && selectedRowIndex === rowIndex) {
                                  handleDropdownKeyDown(e as React.KeyboardEvent<HTMLInputElement>);
                                } else {
                                  handleKeyDown(e, rowIndex, 0);
                                }
                              }}
                              data-row={rowIndex}
                              data-col={0}
                              className="flex-1 px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent"
                              placeholder="Product name or search..."
                            />

                          </div>
                          <button
                            type="button"
                            onClick={() => openProductSearch(rowIndex)}
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 p-1 rounded transition-colors"
                            title="Search existing product"
                          >
                            <Package className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      {isGstPurchase && (
                        <td className="border border-gray-300 p-0 bg-emerald-50/20">
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              value={item.hcsCode || ''}
                              onChange={(e) => handleItemChange(rowIndex, 'hcsCode', e.target.value)}
                              className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-transparent uppercase font-mono"
                              placeholder="HSN CODE"
                            />
                            {items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => applyHcsCodeToAllRows(rowIndex)}
                                className="mr-1 px-1.5 py-0.5 text-[9px] bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded font-semibold whitespace-nowrap"
                                title="Apply this HSN code to all rows"
                              >
                                All
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                      <td className="border border-gray-300 p-0">
                        <SearchableSelect
                          options={brands.map(b => ({ id: b.id || '', name: b.name }))}
                          value={item.brand}
                          onChange={(value) => handleItemChange(rowIndex, 'brand', value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 1)}
                          data-row={rowIndex}
                          data-col={1}
                          placeholder="Select Brand"
                          disabled={itemIsExistingProduct[rowIndex]}
                        />
                      </td>
                      <td className="border border-gray-300 p-0">
                        <input
                          type="text"
                          value={item.model}
                          onChange={(e) => handleItemChange(rowIndex, 'model', e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 2)}
                          data-row={rowIndex}
                          data-col={2}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent"
                          placeholder="Model"
                          disabled={itemIsExistingProduct[rowIndex]}
                        />
                      </td>
                      <td className="border border-gray-300 p-0">
                        <SearchableSelect
                          options={categories.map(c => ({ id: c.id || '', name: c.name }))}
                          value={item.category}
                          onChange={(value) => handleItemChange(rowIndex, 'category', value)}

                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 3)}
                          data-row={rowIndex}
                          data-col={3}
                          placeholder="Select Category"
                          disabled={itemIsExistingProduct[rowIndex]}
                        />
                      </td>
                      <td className="border border-gray-300 p-0 text-right px-3 py-2 text-sm text-gray-700">
                        {itemExistingStock[rowIndex] ?? 0}
                      </td>
                      <td className="border border-gray-300 p-0">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(rowIndex, 'quantity', e.target.value === '' ? '' : parseInt(e.target.value))}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => {
                            if ((item.quantity as any) === '' || item.quantity === undefined) {
                              handleItemChange(rowIndex, 'quantity', 0);
                            }
                          }}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 4)}
                          data-row={rowIndex}
                          data-col={4}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent text-right"
                          min="0"
                          step="1"
                          required
                        />
                      </td>
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
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, 5)}
                          data-row={rowIndex}
                          data-col={5}
                          className="w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent text-right"
                          required
                        />
                      </td>
                      {isGstPurchase && (
                        <>
                          <td className="border border-gray-300 p-0 bg-emerald-50/20">
                            <select
                              value={item.taxPercent ?? defaultTaxPercent}
                              onChange={(e) => handleItemChange(rowIndex, 'taxPercent', parseInt(e.target.value))}
                              className="w-full px-2 py-2 text-sm border-0 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-transparent text-center font-semibold text-emerald-800 cursor-pointer"
                            >
                              <option value={0}>0%</option>
                              <option value={5}>5%</option>
                              <option value={12}>12%</option>
                              <option value={18}>18%</option>
                              <option value={28}>28%</option>
                            </select>
                          </td>
                          <td className="border border-gray-300 px-3 py-2 text-sm text-right font-medium text-blue-700 bg-blue-50/30">
                            {(Number(item.costPerUnit) || 0) > 0 ? `₹${((Number(item.costPerUnit) || 0) * (1 + (Number(item.taxPercent ?? defaultTaxPercent) / 100))).toFixed(2)}` : '—'}
                          </td>
                        </>
                      )}
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
                      <td className="border border-gray-300 px-3 py-2 text-sm font-semibold text-right text-blue-600 bg-blue-50">
                        {encodePrice(item.totalCost)}
                      </td>
                      <td className="border border-gray-300 px-2 py-2 text-center space-x-1">
                        {/* Search moved to Product Name column; keep delete button only */}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {isGstPurchase && (
                    <>
                      <tr className="bg-gray-50 text-xs font-semibold">
                        <td colSpan={8} className="border border-gray-300 px-3 py-1.5 text-gray-600 text-right">
                          Base Amount (before GST):
                        </td>
                        <td className="border border-gray-300 px-3 py-1.5 text-gray-900 text-right">
                          {totalQuantity}
                        </td>
                        <td colSpan={3} className="border border-gray-300 px-3 py-1.5 text-gray-700 text-right font-semibold">
                          ₹{baseAmount.toFixed(2)}
                        </td>
                        <td colSpan={3} className="border border-gray-300"></td>
                      </tr>
                      <tr className="bg-emerald-50 text-xs font-semibold">
                        <td colSpan={9} className="border border-gray-300 px-3 py-1.5 text-emerald-800 text-right">
                          Total GST:
                        </td>
                        <td colSpan={3} className="border border-gray-300 px-3 py-1.5 text-emerald-700 font-bold text-right">
                          +₹{totalGstAmount.toFixed(2)}
                        </td>
                        <td colSpan={3} className="border border-gray-300"></td>
                      </tr>
                    </>
                  )}
                  <tr className="bg-gradient-to-r from-blue-100 to-indigo-100 font-semibold">
                    <td colSpan={isGstPurchase ? 8 : 7} className="border border-gray-300 px-3 py-2 text-sm text-gray-900 text-right">
                      Total Quantity:
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-sm text-gray-900 text-right">
                      {totalQuantity}
                    </td>
                    <td colSpan={isGstPurchase ? 4 : 2} className="border border-gray-300 px-3 py-2 text-sm text-gray-900 text-right">
                      Grand Total:
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-sm text-blue-600 font-bold text-right">
                      ₹{totalAmount.toFixed(2)}
                    </td>
                    <td className="border border-gray-300"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-4 flex justify-center">
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
                    // Clear paid amount when switching to credit
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
                    <div className="flex-shrink-0">
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
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-sm border border-blue-200 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Purchase Summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Total Items:</span>
                <span className="font-semibold text-gray-900">{items.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Total Quantity:</span>
                <span className="font-semibold text-gray-900">{totalQuantity}</span>
              </div>
              <div className="flex justify-between items-center text-lg">
                <span className="font-medium text-gray-900">Total Amount:</span>
                <span className="font-bold text-blue-600">{encodePrice(totalAmount)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Paid Amount:</span>
                <span className="font-semibold text-green-600">₹{(parseFloat(paidAmount) || 0).toFixed(2)}</span>
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
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-6">
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
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] rounded-lg shadow-sm hover:shadow transition-all disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                <span>{isSubmitting ? 'Saving...' : 'Save Purchase'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Product Search Dropdown (rendered in portal to avoid clipping) */}
        {isDropdownOpen && dropdownPosition && createPortal(
          <div
            ref={dropdownRef}
            style={{ position: 'fixed', left: dropdownPosition.left, top: dropdownPosition.top, width: dropdownPosition.width, zIndex: 9999 }}
            className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
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
                {/* Header row */}
                <div className="hidden sm:flex items-center px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                  <div className="flex-1">Product</div>
                  <div className="w-32 text-right">Code</div>
                  <div className="w-20 text-right">Stock</div>
                  <div className="w-28 text-right">Price</div>
                </div>

                {searchResults.map((product, idx) => (
                  <div
                    key={product.id}
                    role="option"
                    aria-selected={dropdownFocusedIndex === idx}
                    onMouseEnter={() => setDropdownFocusedIndex(idx)}
                    onClick={() => { selectProduct(product, selectedRowIndex ?? 0); setDropdownFocusedIndex(null); }}
                    className={`px-3 py-2 border-b border-gray-100 cursor-pointer ${dropdownFocusedIndex === idx ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center w-full">
                      <div className="flex-1 min-w-0 mb-1 sm:mb-0">
                        <div className="text-sm text-gray-900 truncate font-medium">{product.name}</div>
                        <div className="text-xs text-gray-500 truncate">{product.brand ? product.brand + (product.model ? ' • ' + product.model : '') : ''}</div>
                      </div>

                      {/* Desktop Columns */}
                      <div className="hidden sm:flex items-center text-right">
                        <div className="w-32 font-mono text-xs text-blue-600 truncate ml-4">{product.productCode}</div>
                        <div className="w-20 text-sm text-gray-700">{product.quantity}</div>
                        <div className="w-28 text-sm font-semibold text-gray-900">₹{product.cost}</div>
                      </div>

                      {/* Mobile Details Row */}
                      <div className="flex sm:hidden items-center justify-between text-xs text-gray-500 mt-1 w-full border-t border-gray-100 pt-1">
                        <span className="font-mono text-blue-600">{product.productCode}</span>
                        <span>Qty: {product.quantity}</span>
                        <span className="font-semibold text-gray-900">₹{product.cost}</span>
                      </div>
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
      </div>

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

export default AddPurchase;
