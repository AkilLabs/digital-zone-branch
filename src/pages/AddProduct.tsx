import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToastContext } from '../context/ToastContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import ProductLabel from '../components/ProductLabel';
import { Package, DollarSign, Tag, FolderOpen, Hash, Plus } from 'lucide-react';
import type { Product, ShopDetails, Brand, Category } from '../types';
import { collection, addDoc, doc, getDoc, Timestamp, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateProductCode } from '../utils/productCode';
import { upsertLocalProducts } from '../utils/productSyncCache';
import { useInvalidateCache } from '../hooks/useFirestoreCache';

// Autocomplete Input Component
interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder: string;
  label: string;
  icon: React.ReactNode;
  required?: boolean;
}

const AutocompleteInput: React.FC<AutocompleteInputProps> = ({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
  icon,
  required = false,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const filteredSuggestions = suggestions.filter((suggestion) =>
    suggestion.toLowerCase().includes(value.toLowerCase())
  );

  // This is the DEFINITIVE solution - using native input event with inputType
  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const nativeEvent = e.nativeEvent as InputEvent;
    const newValue = (e.target as HTMLInputElement).value;

    onChange(newValue);

    // inputType tells us EXACTLY how the text was entered:
    // - "insertText" = manual typing (SHOW dropdown)
    // - "insertFromPaste" = paste (HIDE dropdown)
    // - "insertReplacementText" = autofill/autocomplete (HIDE dropdown)
    // - "deleteContentBackward" = backspace (SHOW dropdown if already visible)
    // - "deleteContentForward" = delete (SHOW dropdown if already visible)

    if (nativeEvent.inputType === 'insertText') {
      // Only manual typing triggers dropdown
      setShowDropdown(true);
      setHighlightedIndex(-1);
    } else if (nativeEvent.inputType === 'deleteContentBackward' || nativeEvent.inputType === 'deleteContentForward') {
      // Backspace/Delete while typing - keep dropdown if it was already open
      // Don't change dropdown state
      if (showDropdown) {
        setHighlightedIndex(-1);
      }
    } else {
      // ALL other input types (paste, autofill, etc.) - FORCE HIDE
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    onChange(suggestion);
    setShowDropdown(false);
    setHighlightedIndex(-1);
    // Blur the input to prevent dropdown from showing again
    if (inputRef.current) {
      inputRef.current.blur();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle Ctrl+Arrow and other shortcuts - force close dropdown
    const isShortcut = e.ctrlKey || e.altKey || e.metaKey;
    const isNavigationKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);

    if (isShortcut && isNavigationKey) {
      setShowDropdown(false);
      return;
    }

    if (!showDropdown || filteredSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      handleSuggestionClick(filteredSuggestions[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    } else if (e.key === 'Tab') {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  const handleBlur = () => {
    // Use a timeout to allow click events on dropdown items to fire first
    blurTimeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }, 200);
  };

  const handleFocus = () => {
    // Clear any pending blur timeout
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    // Don't automatically show dropdown on focus
    // It will show when user starts typing
  };

  const handleDropdownMouseDown = (e: React.MouseEvent) => {
    // Prevent blur event when clicking on dropdown
    e.preventDefault();
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        <div className="flex items-center gap-2">
          {icon}
          {label}
        </div>
      </label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        required={required}
        autoComplete="off"
      />
      {showDropdown && filteredSuggestions.length > 0 && (
        <div
          ref={dropdownRef}
          onMouseDown={handleDropdownMouseDown}
          className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <div
              key={index}
              onClick={() => handleSuggestionClick(suggestion)}
              className={`px-4 py-3 cursor-pointer transition-colors ${index === highlightedIndex
                ? 'bg-blue-50 text-blue-700'
                : 'hover:bg-gray-50'
                }`}
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AddProduct: React.FC = () => {
  const { currentUser } = useAuth();
  const { success, error: showError } = useToastContext();
  const { getCollectionRef, currentStore } = useStore();
  const { invalidateProducts } = useInvalidateCache();
  const navigate = useNavigate();
  const [model, setModel] = useState('');
  const [cost, setCost] = useState('');
  const [mrp, setMrp] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState('');
  const [quantity, setQuantity] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const computedName = `${brand.trim()} ${model.trim()} ${category.trim()}`.replace(/\s+/g, ' ').trim();
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [selectedProductForLabel, setSelectedProductForLabel] = useState<Product | null>(null);

  // Brand and Category suggestions
  const [brands, setBrands] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    // Redirect if user doesn't have product management access
    const allowedRoles = ['owner', 'hub-admin', 'store-admin', 'admin'];
    if (!currentUser?.role || !allowedRoles.includes(currentUser.role)) {
      navigate('/dashboard');
      return;
    }
    fetchShopDetails();
    fetchBrandsAndCategories();
  }, [currentUser, navigate]);

  const fetchShopDetails = async () => {
    try {
      const docRef = doc(db, 'settings', 'shopDetails');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setShopDetails(docSnap.data() as ShopDetails);
      }
    } catch (error) {
      console.error('Error fetching shop details:', error);
    }
  };

  const fetchBrandsAndCategories = async () => {
    try {
      // Fetch brands (global master data - not hub-scoped)
      const brandsQuery = query(collection(db, 'brands'), orderBy('name', 'asc'));
      const brandsSnapshot = await getDocs(brandsQuery);
      const brandsList = brandsSnapshot.docs.map((doc) => {
        const data = doc.data() as Brand;
        return data.name;
      });
      setBrands(brandsList);

      // Fetch categories (global master data - not hub-scoped)
      const categoriesQuery = query(collection(db, 'categories'), orderBy('name', 'asc'));
      const categoriesSnapshot = await getDocs(categoriesQuery);
      const categoriesList = categoriesSnapshot.docs.map((doc) => {
        const data = doc.data() as Category;
        return data.name;
      });
      setCategories(categoriesList);
    } catch (error) {
      console.error('Error fetching brands and categories:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand.trim() || !model.trim() || !category.trim()) {
      showError('Please fill in brand, model, and category');
      return;
    }
    if (!paymentType) {
      showError('Please select a payment type');
      return;
    }
    const costNum = parseFloat(cost);
    const mrpNum = parseFloat(mrp);
    const quantityNum = parseInt(quantity);
    if (isNaN(costNum) || costNum < 0 || isNaN(mrpNum) || mrpNum < 0) {
      showError('Please enter valid cost and MRP');
      return;
    }
    if (mrpNum < costNum) {
      showError('MRP should be greater than or equal to cost');
      return;
    }
    if (isNaN(quantityNum) || quantityNum < 1) {
      showError('Please enter a valid quantity (minimum 1)');
      return;
    }
    try {
      setIsSubmitting(true);
      const productCode = await generateProductCode(getCollectionRef('products'));
      const nowTs = Timestamp.now();
      const productData: any = {
        productCode, name: computedName, model: model.trim(), cost: costNum, mrp: mrpNum,
        brand: brand.trim(), category: category.trim(), supplier: supplier.trim(),
        quantity: quantityNum, isAvailable: quantityNum > 0, createdAt: nowTs, updatedAt: nowTs,
        createdBy: currentUser?.uid || '', createdByName: currentUser?.displayName || currentUser?.email || 'Unknown',
        paymentType,
      };
      const docRef = await addDoc(getCollectionRef('products'), productData);
      const newProduct: Product = {
        id: docRef.id, productCode, name: computedName, model: model.trim(),
        cost: costNum, mrp: mrpNum, brand: brand.trim(), category: category.trim(), supplier: supplier.trim(),
        quantity: quantityNum, isAvailable: quantityNum > 0,
        createdAt: new Date(), updatedAt: new Date(), createdBy: currentUser?.uid || '',
        createdByName: currentUser?.displayName || currentUser?.email || 'Unknown',
        paymentType,
      };
      await upsertLocalProducts(currentStore?.id, [{ ...newProduct, id: docRef.id }]);
      invalidateProducts();
      setModel(''); setCost(''); setMrp(''); setBrand(''); setCategory(''); setSupplier(''); setQuantity(''); setPaymentType('cash');
      setSelectedProductForLabel(newProduct);
      success('Product added successfully!');
    } catch (error) {
      console.error('Error adding product:', error);
      showError('Failed to add product. Please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateProfit = () => { const costNum = parseFloat(cost) || 0; const mrpNum = parseFloat(mrp) || 0; return mrpNum - costNum; };
  const calculateProfitMargin = () => { const profit = calculateProfit(); const mrpNum = parseFloat(mrp) || 0; if (mrpNum === 0) return 0; return ((profit / mrpNum) * 100).toFixed(2); };
  const handleBackToProducts = () => { navigate('/products'); };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Add New Product</h1>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Product Name (auto-generated)
                </div>
              </label>
              <input
                type="text"
                value={computedName}
                readOnly
                placeholder="Will be generated from Brand, Model and Category"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Cost Price *
                  </div>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    MRP *
                  </div>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={mrp}
                  onChange={(e) => setMrp(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            {cost && mrp && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Profit per unit:</span>
                  <span className="text-lg font-bold text-green-600">{calculateProfit().toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm font-medium text-gray-700">Profit Margin:</span>
                  <span className="text-lg font-bold text-green-600">{calculateProfitMargin()}%</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <AutocompleteInput
                value={brand}
                onChange={setBrand}
                suggestions={brands}
                placeholder="Enter brand name"
                label="Brand *"
                icon={<Tag className="h-4 w-4" />}
                required
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Model *
                  </div>
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Enter model"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <AutocompleteInput
                value={category}
                onChange={setCategory}
                suggestions={categories}
                placeholder="e.g., Electronics"
                label="Category *"
                icon={<FolderOpen className="h-4 w-4" />}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Supplier
                </div>
              </label>
              <input
                type="text"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Enter supplier name (optional)"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Payment Type *
                </div>
              </label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="cash">Cash</option>
                <option value="credit">Credit</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Quantity *
                </div>
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Enter quantity"
                min="1"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 text-white py-4 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base sm:text-lg"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Adding Product...
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  Add Product
                </>
              )}
            </button>
          </form>
        </div>
      </div>
      {selectedProductForLabel && (
        <ProductLabel
          product={selectedProductForLabel}
          shopDetails={shopDetails}
          onClose={() => {
            setSelectedProductForLabel(null);
            handleBackToProducts();
          }}
          isNewProduct={true}
        />
      )}
    </div>
  );
};

export default AddProduct;
