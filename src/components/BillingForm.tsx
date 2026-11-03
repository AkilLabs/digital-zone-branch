import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, CreditCard, Smartphone, Banknote, Split, Check, Search, QrCode, X, Camera, FileText } from 'lucide-react';
import type { BillingItem, PaymentMode, Product } from '../types';
import jsQR from "jsqr";
import logo from '../assets/logo.png';
import { useAvailableProducts } from '../hooks/useFirestoreCache';

interface BillingFormProps {
  onSubmit: (item: Omit<BillingItem, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>) => void;
  initialData?: BillingItem;
  isEdit?: boolean;
}

const BillingForm: React.FC<BillingFormProps> = ({ onSubmit, initialData, isEdit = false }) => {
  // Entry type state (product, service, or credit)
  const [entryType, setEntryType] = useState<'product' | 'service' | 'credit'>('product');

  // Product selection states - using React Query cache
  const { data: products = [], isLoading: loadingProducts } = useAvailableProducts();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // QR Scanner states
  const [showScanner, setShowScanner] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerLoading, setScannerLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Tooltip and notification states
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [title, setTitle] = useState(initialData?.title || '');
  const [cost, setCost] = useState(initialData?.cost.toString() || '');
  const [mrpPrice, setMrpPrice] = useState(initialData?.sellingPrice.toString() || '');
  const [sellingPrice, setSellingPrice] = useState(initialData?.sellingPrice.toString() || '');
  const [quantity, setQuantity] = useState(initialData?.quantity.toString() || '1');
  const [profit, setProfit] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);

  // Discount states
  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>('percentage');
  const [discountValue, setDiscountValue] = useState('');

  // Customer details states
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  // Secret code digit mapping
  const digitToSecret: Record<string, string> = {
    '1': 'K',
    '2': 'A',
    '3': 'M',
    '4': 'S',
    '5': 'R',
    '6': 'N',
    '7': 'V',
    '8': 'H',
    '9': 'T',
    '0': 'X',
  };

  const encodeSecret = (value: number | string | undefined | null) => {
    if (value === undefined || value === null) return '';
    // Convert to number then round to nearest rupee (no paisa)
    const asNum = typeof value === 'number' ? value : parseFloat(String(value).replace(/[₹,\s]/g, ''));
    if (Number.isNaN(asNum)) return '';
    const rounded = Math.round(asNum);
    const sign = rounded < 0 ? '-' : '';
    const str = String(Math.abs(rounded));
    return sign + str.split('').map(ch => (/[0-9]/.test(ch) ? digitToSecret[ch] ?? ch : ch)).join('');
  };
  const gstRate = 18; // Fixed 18% GST
  const [gstAmount, setGstAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initialData?.paymentMode || 'cash');
  const [cashAmount, setCashAmount] = useState(initialData?.paymentSplit?.cash?.toString() || '');
  const [upiAmount, setUpiAmount] = useState(initialData?.paymentSplit?.upi?.toString() || '');
  const [cardAmount, setCardAmount] = useState(initialData?.paymentSplit?.card?.toString() || '');

  // Credit sale fields
  const [creditCustomerName, setCreditCustomerName] = useState(initialData?.creditCustomerName || 'Talk and Walk');
  const [isCustomCustomerName, setIsCustomCustomerName] = useState(false);
  const [customCustomerInput, setCustomCustomerInput] = useState('');

  // Products are now fetched and cached via React Query hook

  // Handle product selection
  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    setTitle(product.name);
    setCost(product.cost.toString());
    setMrpPrice(product.mrp.toString());
    setSellingPrice(product.mrp.toString());
    setProductSearch(product.name);
    setShowProductDropdown(false);
  };

  // QR Scanner Functions
  const startScanner = async () => {
    try {
      setScannerError(null);
      setScannerLoading(true);
      setShowScanner(true);

      console.log('📱 Starting QR Scanner...');
      console.log('🔍 User Agent:', navigator.userAgent);

      // Detect mobile device
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      console.log('📱 Mobile Device:', isMobile);

      // Wait for modal to render
      await new Promise(resolve => setTimeout(resolve, 100));

      // Mobile-optimized camera settings
      // We use a lower resolution (640x480) which is:
      // 1. Faster to process for jsQR (less CPU/lag)
      // 2. actually BETTER for scanning because pixels are larger and less noisy
      const constraints: any = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        }
      };

      // Add mobile-specific camera features if available
      if (isMobile) {
        constraints.video.focusMode = 'continuous';
        constraints.video.exposureMode = 'continuous';
        constraints.video.whiteBalanceMode = 'continuous';
      }

      console.log('📷 Requesting camera...');

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log('✅ Camera stream obtained');
      const videoTrack = stream.getVideoTracks()[0];
      console.log('📹 Camera settings:', videoTrack.getSettings());
      console.log('📹 Camera capabilities:', videoTrack.getCapabilities());

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;

        // Critical for iOS/mobile
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        videoRef.current.setAttribute('muted', 'true');

        // Wait for video to be ready and start scanning
        videoRef.current.onloadedmetadata = () => {
          if (!videoRef.current) return;

          console.log('📹 Video metadata loaded');
          console.log('📏 Video size:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);

          videoRef.current.play().then(() => {
            setScannerLoading(false);
            console.log('✅ Video playing');
            console.log('📦 Products in database:', products.length);
            console.log('🔢 Product codes:', products.slice(0, 10).map(p => `${p.productCode} (${p.name})`).join(', '));

            // Start scanning
            setTimeout(() => {
              console.log('🔍 Starting QR detection loop...');
              scanQRCode();
            }, 300);
          }).catch(err => {
            console.error('❌ Error playing video:', err);
            setScannerError('Unable to start camera preview: ' + err.message);
            setScannerLoading(false);
          });
        };

        videoRef.current.onerror = (err) => {
          console.error('❌ Video element error:', err);
          setScannerError('Video playback error');
        };
      }
    } catch (error: any) {
      console.error('❌ Camera error:', error);
      console.error('Error type:', error.name);
      setScannerLoading(false);

      if (error.name === 'NotAllowedError') {
        setScannerError('Camera access denied. Please allow camera permissions in browser settings.');
      } else if (error.name === 'NotFoundError') {
        setScannerError('No camera found on this device.');
      } else if (error.name === 'NotReadableError') {
        setScannerError('Camera is already in use by another application.');
      } else {
        setScannerError('Unable to access camera: ' + error.message);
      }
    }
  };

  const stopScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowScanner(false);
    setScannerError(null);
  };

  const scanQRCode = () => {
    if (!videoRef.current || !canvasRef.current || !showScanner) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context || video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(scanQRCode);
      return;
    }

    // Set canvas dimensions to match video, but cap the processing size
    // jsQR works best with images < 1000px width
    const processingScale = Math.min(1, 640 / video.videoWidth);
    const procWidth = Math.floor(video.videoWidth * processingScale);
    const procHeight = Math.floor(video.videoHeight * processingScale);

    if (canvas.width !== procWidth || canvas.height !== procHeight) {
      canvas.width = procWidth;
      canvas.height = procHeight;
      console.log('========================================');
      console.log('📷 Scanner Canvas Ready');
      console.log('📏 Input Video:', video.videoWidth, 'x', video.videoHeight);
      console.log('📏 Processing Size:', canvas.width, 'x', canvas.height);
      console.log('========================================');
    }

    // Draw the current video frame to canvas (scaled if necessary)
    context.imageSmoothingEnabled = false; // Nearest neighbor is better for QR edges
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Try full frame scan first
    const fullImageData = context.getImageData(0, 0, canvas.width, canvas.height);
    let code = jsQR(fullImageData.data, fullImageData.width, fullImageData.height, {
      inversionAttempts: 'attemptBoth',
    });

    // If not found, try center 70% region (where users typically hold QR codes)
    if (!code) {
      const centerX = Math.floor(canvas.width * 0.15);
      const centerY = Math.floor(canvas.height * 0.15);
      const centerWidth = Math.floor(canvas.width * 0.7);
      const centerHeight = Math.floor(canvas.height * 0.7);

      const centerData = context.getImageData(centerX, centerY, centerWidth, centerHeight);
      code = jsQR(centerData.data, centerWidth, centerHeight, {
        inversionAttempts: 'attemptBoth',
      });
    }

    if (code && code.data) {
      console.log('========================================');
      console.log('🎯 QR CODE DETECTED!');
      console.log('� Raw Data:', code.data);
      console.log('📏 Data Length:', code.data.length);
      console.log('📍 Position:', {
        topLeft: code.location.topLeftCorner,
        bottomRight: code.location.bottomRightCorner
      });
      console.log('========================================');
      handleQRCodeDetected(code.data);
      return; // Stop scanning after detection
    }

    // Continue scanning
    requestAnimationFrame(scanQRCode);
  };

  const handleQRCodeDetected = (code: string) => {
    console.log('========================================');
    console.log('📷 RAW QR CODE DETECTED:', code);
    console.log('📏 QR Code Length:', code.length);
    console.log('🔤 QR Code Type:', typeof code);
    console.log('========================================');
    console.log('📦 Total Products in Database:', products.length);

    if (products.length > 0) {
      console.log('🔍 First 10 Product Codes in Database:');
      products.slice(0, 10).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.name} -> Code: "${p.productCode}" (${p.productCode.length} chars)`);
      });
    }
    console.log('========================================');

    // Vibration feedback (like GPay)
    if (navigator.vibrate) {
      navigator.vibrate(50); // Short vibration
    }

    stopScanner();

    // Clean up the code (remove whitespace)
    const cleanCode = code.trim();
    console.log('🧹 Cleaned QR Code:', cleanCode);

    // Try different matching strategies with detailed logging
    console.log('🔍 Trying Exact Match...');
    let product = products.find(p => p.productCode === cleanCode);
    if (product) console.log('✅ EXACT MATCH FOUND!', product.name);

    if (!product) {
      console.log('🔍 Trying Case-Insensitive Match...');
      product = products.find(p => typeof p.productCode === 'string' && p.productCode.toLowerCase() === cleanCode.toLowerCase());
      if (product) console.log('✅ CASE-INSENSITIVE MATCH FOUND!', product.name);
    }

    if (!product) {
      console.log('🔍 Trying Contains Match (QR contains Product Code)...');
      product = products.find(p => typeof p.productCode === 'string' && cleanCode.includes(p.productCode));
      if (product) console.log('✅ CONTAINS MATCH FOUND!', product.name);
    }

    if (!product) {
      console.log('🔍 Trying Contains Match (Product Code contains QR)...');
      product = products.find(p => typeof p.productCode === 'string' && p.productCode.includes(cleanCode));
      if (product) console.log('✅ REVERSE CONTAINS MATCH FOUND!', product.name);
    }

    if (!product) {
      console.log('🔍 Trying Name Match...');
      product = products.find(p => p.name.toLowerCase() === cleanCode.toLowerCase());
      if (product) console.log('✅ NAME MATCH FOUND!', product.name);
    }

    if (product) {
      console.log('========================================');
      console.log('✅✅✅ SUCCESS! Product Selected ✅✅✅');
      console.log('Product Name:', product.name);
      console.log('Product Code:', product.productCode);
      console.log('MRP:', product.mrp);
      console.log('Stock:', product.quantity);
      console.log('========================================');

      // Success sound (browser beep)
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
      } catch (error) {
        console.log('Audio feedback failed:', error);
      }

      handleProductSelect(product);
    } else {
      console.log('========================================');
      console.log('❌❌❌ PRODUCT NOT FOUND ❌❌❌');
      console.log('Scanned QR Code:', cleanCode);
      console.log('❌ No match in database!');
      console.log('========================================');

      // Error vibration
      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]); // Error pattern
      }

      setNotification({
        type: 'error',
        message: `Product not found! Scanned: "${cleanCode}". Make sure the QR code contains your product code.`
      });

      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Manual code input for testing (when scanner not available)
  const handleManualCodeInput = () => {
    const code = prompt('Enter product code:');
    if (code) {
      handleQRCodeDetected(code);
    }
  };

  // Cleanup on unmount and when scanner closes
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Stop scanner when showScanner becomes false
  useEffect(() => {
    if (!showScanner && streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, [showScanner]);

  // Filter products based on search
  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (product.productCode && String(product.productCode).toLowerCase().includes(productSearch.toLowerCase())) ||
    product.brand.toLowerCase().includes(productSearch.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('#product') && !target.closest('.product-dropdown')) {
        setShowProductDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate discount and update selling price
  useEffect(() => {
    const mrpNum = parseFloat(mrpPrice) || 0;
    const discountVal = parseFloat(discountValue) || 0;

    if (mrpNum > 0 && discountVal > 0) {
      let calculatedDiscount = 0;
      if (discountType === 'percentage') {
        calculatedDiscount = (mrpNum * discountVal) / 100;
      } else {
        calculatedDiscount = discountVal;
      }
      setSellingPrice((mrpNum - calculatedDiscount).toString());
    } else {
      setSellingPrice(mrpPrice);
    }
  }, [mrpPrice, discountValue, discountType]);

  useEffect(() => {
    const costNum = parseFloat(cost) || 0;
    const sellingPriceNum = parseFloat(sellingPrice) || 0;
    const quantityNum = parseInt(quantity) || 0;

    const calculatedProfit = sellingPriceNum - costNum;
    const calculatedTotalProfit = calculatedProfit * quantityNum;

    // Calculate GST (inclusive in selling price)
    // Selling price includes 18% GST
    // Formula: Price before GST = Selling Price / (1 + GST Rate/100)
    const subtotal = sellingPriceNum * quantityNum;
    const priceWithoutGst = subtotal / (1 + gstRate / 100);
    const calculatedGstAmount = subtotal - priceWithoutGst;

    setProfit(calculatedProfit);
    setTotalProfit(calculatedTotalProfit);
    setGstAmount(calculatedGstAmount);
  }, [cost, sellingPrice, quantity, gstRate]);

  // Encoded values to use in UI
  // Encoded values to use in UI (hide numeric display)
  const encodedCost = encodeSecret(cost ?? '');
  const encodedTotalProfit = encodeSecret(totalProfit);

  // Auto-calculate split amounts
  useEffect(() => {
    if (paymentMode === 'split') {
      const total = parseFloat(sellingPrice) * parseInt(quantity || '1');
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;

      // Auto-fill remaining amount if only one field is filled
      const filledFields = [cash > 0, upi > 0, card > 0].filter(Boolean).length;
      if (filledFields === 1 && total > 0) {
        if (cash > 0 && cash < total) {
          setUpiAmount(Math.round(total - cash).toFixed(0));
        } else if (upi > 0 && upi < total) {
          setCashAmount(Math.round(total - upi).toFixed(0));
        } else if (card > 0 && card < total) {
          setCashAmount(Math.round(total - card).toFixed(0));
        }
      }
    }
  }, [cashAmount, upiAmount, cardAmount, paymentMode, sellingPrice, quantity]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setNotification({
        type: 'error',
        message: 'Please select a product from inventory'
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const costNum = parseFloat(cost);
    const sellingPriceNum = parseFloat(sellingPrice);
    const quantityNum = parseInt(quantity);

    if (isNaN(costNum) || costNum < 0) {
      setNotification({
        type: 'error',
        message: 'Please enter a valid cost'
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (isNaN(sellingPriceNum) || sellingPriceNum < 0) {
      setNotification({
        type: 'error',
        message: 'Please enter a valid selling price'
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (isNaN(quantityNum) || quantityNum < 1) {
      setNotification({
        type: 'error',
        message: 'Please enter a valid quantity'
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Validate stock availability
    if (selectedProduct && quantityNum > selectedProduct.quantity) {
      setNotification({
        type: 'error',
        message: `Insufficient stock! Only ${selectedProduct.quantity} units available.`
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Validate split payment
    const rawTotalAmount = sellingPriceNum * quantityNum;
    const roundedTotalAmount = Math.round(rawTotalAmount);
    const roundOff = Number((roundedTotalAmount - rawTotalAmount).toFixed(2));
    const totalAmount = roundedTotalAmount;

    if (paymentMode === 'split') {
      const total = totalAmount;
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;
      const card = parseFloat(cardAmount) || 0;
      const splitTotal = cash + upi + card;

      if (Math.abs(splitTotal - total) > 0.01) {
        setNotification({
          type: 'error',
          message: `Split payment total (₹${splitTotal.toFixed(2)}) must equal the total amount (₹${total.toFixed(2)})`
        });
        setTimeout(() => setNotification(null), 4000);
        return;
      }

      if (cash < 0 || upi < 0 || card < 0) {
        setNotification({
          type: 'error',
          message: 'Payment amounts cannot be negative'
        });
        setTimeout(() => setNotification(null), 3000);
        return;
      }
    }

    const paymentSplit = paymentMode === 'split' ? {
      cash: parseFloat(cashAmount) || 0,
      upi: parseFloat(upiAmount) || 0,
      card: parseFloat(cardAmount) || 0,
    } : undefined;

    const submissionData: any = {
      title: title.trim(),
      cost: costNum,
      sellingPrice: sellingPriceNum,
      profit,
      quantity: quantityNum,
      totalProfit,
      ...(selectedProduct?.imei ? { imei: selectedProduct.imei } : {}),
      ...((selectedProduct as any)?.hsnCode || selectedProduct?.hcsCode ? { hsnCode: (selectedProduct as any)?.hsnCode || selectedProduct?.hcsCode } : {}),
      paymentMode,
      gstRate: gstRate,
      gstAmount: isNaN(gstAmount) ? 0 : gstAmount,
      totalWithGst: isNaN(totalAmount) ? 0 : totalAmount,
      grandTotal: totalAmount,
      roundOff: roundOff,
      subtotal: rawTotalAmount,
      type: entryType, // Add entry type (product, service, or credit)
      brand: entryType === 'service' ? 'Service' : (selectedProduct?.brand || ''),
      category: entryType === 'service' ? 'Service' : (selectedProduct?.category || ''),
    };

    // Add credit-specific fields if entry type is credit
    if (entryType === 'credit') {
      submissionData.creditCustomerName = creditCustomerName.trim();
      submissionData.isPaid = false;
      submissionData.paidAmount = 0;
      submissionData.remainingAmount = totalAmount;
    }

    // Only add paymentSplit if it exists (not undefined)
    if (paymentSplit) {
      submissionData.paymentSplit = paymentSplit;
    }

    onSubmit(submissionData);

    if (!isEdit) {
      // Reset form after submission
      setEntryType('product');
      setSelectedProduct(null);
      setProductSearch('');
      setTitle('');
      setCost('');
      setMrpPrice('');
      setSellingPrice('');
      setQuantity('1');
      setDiscountType('percentage');
      setDiscountValue('');
      setCustomerName('');
      setCustomerMobile('');
      setCustomerEmail('');
      setPaymentMode('cash');
      setCashAmount('');
      setUpiAmount('');
      setCardAmount('');
      setCreditCustomerName('Talk and Walk');
      setIsCustomCustomerName(false);
      setCustomCustomerInput('');
    }
  };

  const totalAmount = parseFloat(sellingPrice) * parseInt(quantity || '1');

  return (
    <form className="w-full max-w-7xl mx-auto px-2 py-3 md:px-6 md:py-6 bg-white rounded-xl shadow-lg" onSubmit={handleSubmit}>
      {/* Header */}
      <div className="mb-3 md:mb-6 pb-2 md:pb-4 border-b-2 border-gray-200">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="p-1.5 md:p-2.5 bg-red-100 rounded-lg">
            <ShoppingCart className="w-4 h-4 md:w-6 md:h-6 text-red-600" />
          </div>
          <h3 className="text-sm md:text-xl font-bold text-gray-900">
            {isEdit ? 'Edit Billing Item' : 'Add New Billing Item'}
          </h3>
        </div>
      </div>

      {/* Main Layout: Form + Customer Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6">
        {/* Left & Center: Form Fields (2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Top Row: Product Search + Scan + Service + Credit in Single Row */}
          <div className="grid grid-cols-1 gap-3">
            {/* Single Row Layout */}
            <div className="relative">
              <label htmlFor="product" className="flex items-center gap-2 mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                Search product
              </label>
              <div className="flex gap-2">
                {/* Product Search Input */}
                <div className="relative flex-1">
                  <input
                    id="product"
                    type="text"
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setShowProductDropdown(true);
                    }}
                    onFocus={() => setShowProductDropdown(true)}
                    placeholder="Search product by name, code, or brand..."
                    required={entryType === 'product' || entryType === 'credit'}
                    disabled={entryType === 'service'}
                    className="w-full px-3 py-2.5 md:py-3.5 pr-10 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                </div>

                {/* QR Scanner Button */}
                <div className="relative group">
                  <button
                    type="button"
                    onClick={startScanner}
                    disabled={entryType === 'service'}
                    className="px-3 md:px-4 py-2.5 md:py-3.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-all flex items-center justify-center gap-2 font-semibold shadow-sm disabled:bg-gray-400 disabled:cursor-not-allowed text-sm whitespace-nowrap"
                  >
                    <QrCode className="w-4 h-4 md:w-5 md:h-5" />
                    <span className="hidden sm:inline">Scan</span>
                  </button>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50">
                    Scan QR Code to Auto-Fill
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>

                {/* Service Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (entryType === 'service') {
                      setEntryType('product');
                      setTitle('');
                    } else {
                      setEntryType('service');
                      setSelectedProduct(null);
                      setProductSearch('');
                      setShowProductDropdown(false);
                      setTitle('');
                    }
                  }}
                  className={`px-3 md:px-6 py-2.5 md:py-3.5 rounded-xl text-sm md:text-base font-semibold transition-all duration-200 whitespace-nowrap ${entryType === 'service'
                    ? 'bg-red-600 text-white shadow-lg'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                  Service
                </button>

                {/* Credit Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (entryType === 'credit') {
                      setEntryType('product');
                      setTitle('');
                    } else {
                      setEntryType('credit');
                      setSelectedProduct(null);
                      setProductSearch('');
                      setShowProductDropdown(false);
                      setTitle('');
                    }
                  }}
                  className={`px-3 md:px-6 py-2.5 md:py-3.5 rounded-xl text-sm md:text-base font-semibold transition-all duration-200 whitespace-nowrap ${entryType === 'credit'
                    ? 'bg-red-600 text-white shadow-lg'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                  Credit
                </button>
              </div>
            </div>
          </div>

          {/* Product Dropdown */}
          {showProductDropdown && (
            <div className="product-dropdown absolute z-10 w-full mt-2 bg-white border-2 border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {loadingProducts ? (
                <div className="p-4 text-center text-gray-500">
                  Loading products...
                </div>
              ) : filteredProducts.length > 0 ? (
                <div className="py-2">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleProductSelect(product)}
                      className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900 text-sm">{product.name}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{product.productCode}</span>
                            <span className="mx-2">•</span>
                            <span>{product.brand}</span>
                            <span className="mx-2">•</span>
                            <span className={product.quantity <= 5 ? 'text-orange-600 font-semibold' : 'text-green-600'}>
                              Stock: {product.quantity}
                            </span>
                          </div>
                        </div>
                        <div className="text-right ml-4">
                          <div className="font-bold text-green-600">₹{product.mrp}</div>
                          <div className="text-xs text-gray-500">Cost: <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{encodeSecret(product.cost)}</span></div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500">
                  No products found. Make sure products are in stock.
                </div>
              )}
            </div>
          )}

          {/* Selected Product Info */}
          {selectedProduct && (
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-green-900">{selectedProduct.name}</div>
                  <div className="text-xs text-green-700 mt-1">
                    Available Stock: <span className="font-bold">{selectedProduct.quantity}</span> units
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProduct(null);
                    setProductSearch('');
                    setTitle('');
                    setCost('');
                    setSellingPrice('');
                  }}
                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Service Title Input - Only show when in service mode */}
          {entryType === 'service' && (
            <div>
              <label htmlFor="serviceTitle" className="flex items-center gap-2 mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Service Name <span className="text-red-500">*</span>
              </label>
              <input
                id="serviceTitle"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter service name (e.g., Screen Replacement, Battery Change)"
                required
                className="w-full px-4 py-3 md:py-3.5 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
              />
            </div>
          )}

          {/* Credit Customer Details - Only show when in credit mode */}
          {entryType === 'credit' && (
            <div>
              <label htmlFor="creditCustomerName" className="flex items-center gap-2 mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Customer Name <span className="text-red-500">*</span>
              </label>

              {!isCustomCustomerName ? (
                <div className="flex gap-2">
                  <select
                    id="creditCustomerName"
                    value={creditCustomerName}
                    onChange={(e) => setCreditCustomerName(e.target.value)}
                    required
                    className="flex-1 px-4 py-3 md:py-3.5 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                  >
                    <option value="Talk and Walk">Talk and Walk</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomCustomerName(true);
                      setCustomCustomerInput('');
                    }}
                    className="px-4 py-3 md:py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 font-semibold shadow-sm whitespace-nowrap"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="hidden md:inline">Custom</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customCustomerInput}
                      onChange={(e) => setCustomCustomerInput(e.target.value)}
                      placeholder="Enter custom customer name"
                      required
                      className="flex-1 px-4 py-3 md:py-3.5 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customCustomerInput.trim()) {
                          setCreditCustomerName(customCustomerInput.trim());
                          setIsCustomCustomerName(false);
                        }
                      }}
                      disabled={!customCustomerInput.trim()}
                      className="px-4 py-3 md:py-3.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all flex items-center gap-2 font-semibold shadow-sm disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomCustomerName(false);
                        setCustomCustomerInput('');
                      }}
                      className="px-4 py-3 md:py-3.5 bg-gray-500 text-white rounded-xl hover:bg-gray-600 transition-all flex items-center gap-2 font-semibold shadow-sm"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {customCustomerInput.trim() && (
                    <p className="text-xs text-gray-600 ml-1">
                      Custom name: <span className="font-semibold text-gray-900">{customCustomerInput.trim()}</span>
                    </p>
                  )}
                </div>
              )}

              {!isCustomCustomerName && creditCustomerName && creditCustomerName !== 'Talk and Walk' && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                  <p className="text-xs text-blue-800">
                    Selected: <span className="font-semibold">{creditCustomerName}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setCreditCustomerName('Talk and Walk')}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Pricing Row: Cost + MRP + Selling Price + Quantity */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Cost Price */}
            <div>
              <label htmlFor="cost" className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                Cost
              </label>
              {entryType === 'service' ? (
                <input
                  id="cost"
                  type="number"
                  step="1"
                  min="0"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0"
                  required
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                />
              ) : (
                <div className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base bg-gray-100 text-gray-900 font-mono flex items-center">
                  {encodedCost || '—'}
                </div>
              )}
            </div>

            {/* MRP Price */}
            <div>
              <label htmlFor="mrpPrice" className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                MRP Price
              </label>
              <input
                id="mrpPrice"
                type="number"
                step="1"
                min="0"
                value={mrpPrice}
                onChange={(e) => setMrpPrice(e.target.value)}
                placeholder="0"
                required
                disabled
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-gray-100 text-gray-500 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed"
              />
            </div>

            {/* Selling Price */}
            <div>
              <label htmlFor="sellingPrice" className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                Selling Price
              </label>
              <input
                id="sellingPrice"
                type="number"
                step="1"
                min="0"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="0"
                required
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
              />
            </div>

            {/* Quantity */}
            <div>
              <label htmlFor="quantity" className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                Quantity
              </label>
              <input
                id="quantity"
                type="number"
                min="1"
                max={selectedProduct ? selectedProduct.quantity : undefined}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
                required
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
              />
            </div>
          </div>

          {/* Discount Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                Discount
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDiscountType('percentage')}
                  className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${discountType === 'percentage'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('amount')}
                  className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${discountType === 'amount'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                  ₹
                </button>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                Enter Percentage
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block mb-3 text-xs md:text-sm text-gray-700 font-semibold">
              Payment method
            </label>
            <div className="grid grid-cols-2 gap-2 md:gap-3">
              {(['cash', 'upi', 'card', 'split'] as PaymentMode[]).map((mode) => {
                const icons: Record<PaymentMode, React.ReactElement> = {
                  cash: <Banknote className="w-4 h-4 md:w-5 md:h-5" />,
                  upi: <Smartphone className="w-4 h-4 md:w-5 md:h-5" />,
                  card: <CreditCard className="w-4 h-4 md:w-5 md:h-5" />,
                  split: <Split className="w-4 h-4 md:w-5 md:h-5" />,
                  credit: <CreditCard className="w-4 h-4 md:w-5 md:h-5" />,
                  cheque: <FileText className="w-4 h-4 md:w-5 md:h-5" />,
                  finance: <Banknote className="w-4 h-4 md:w-5 md:h-5" />
                };

                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMode(mode)}
                    className={`flex items-center justify-center gap-2 px-3 py-3 md:px-4 md:py-3.5 rounded-xl font-medium text-xs md:text-sm transition-all duration-200 border-2 ${paymentMode === mode
                      ? 'bg-blue-500 text-white border-blue-500 shadow-md scale-105'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                  >
                    {icons[mode]}
                    <span className="capitalize">
                      {mode === 'upi' ? mode.toUpperCase() : mode}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Profit Display */}
          <div>
            <div className="bg-linear-to-br from-red-50 to-blue-50 px-4 py-4 md:px-6 md:py-5 rounded-xl border-2 border-red-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] md:text-xs text-gray-700 font-bold uppercase tracking-wide">
                  Total Profit
                </span>
              </div>
              <span className={`text-2xl md:text-3xl lg:text-4xl font-bold block ${totalProfit >= 0 ? 'text-red-600' : 'text-red-600'}`}>
                {encodedTotalProfit}
              </span>
              <span className="text-[10px] md:text-xs text-gray-500 mt-1 block font-medium">for {quantity || 1} item{parseInt(quantity || '1') !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        {/* Right Column - Customer Details & Export */}
        <div className="lg:col-span-1 space-y-4">
          {/* Customer Details Panel */}
          <div className="p-4 bg-gray-50 rounded-xl border-2 border-gray-200">
            <h4 className="text-sm md:text-base font-bold text-gray-900 mb-4">Customer Details</h4>

            <div className="space-y-3">
              <div>
                <label htmlFor="customerName" className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                  Names
                </label>
                <input
                  id="customerName"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder=""
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                />
              </div>

              <div>
                <label htmlFor="customerMobile" className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                  Mobile No
                </label>
                <input
                  id="customerMobile"
                  type="tel"
                  value={customerMobile}
                  onChange={(e) => setCustomerMobile(e.target.value)}
                  placeholder=""
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                />
              </div>

              <div>
                <label htmlFor="customerEmail" className="block mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                  Email (Optional)
                </label>
                <input
                  id="customerEmail"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder=""
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm md:text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                />
              </div>
            </div>
          </div>

          {/* Export Section */}
          <div>
            <h4 className="text-sm md:text-base font-bold text-gray-900 mb-3">Export</h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-300 transition-all"
              >
                Save
              </button>
              <button
                type="button"
                className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-300 transition-all"
              >
                Print
              </button>
              <button
                type="button"
                className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-300 transition-all"
              >
                Download
              </button>
              <button
                type="button"
                className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-300 transition-all"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Split Payment Fields - Full Width Below */}
      {paymentMode === 'split' && (
        <div className="p-4 md:p-5 bg-linear-to-br from-red-50 to-blue-50 rounded-xl border-2 border-red-200">
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <Split className="w-5 h-5 text-red-600" />
            </div>
            <h4 className="text-sm md:text-base text-gray-900 font-bold">
              Split Payment Details
            </h4>
          </div>
          <div className="mb-4 p-3 bg-white rounded-lg shadow-sm border border-blue-100">
            <div className="flex items-center justify-between">
              <span className="text-xs md:text-sm text-gray-600 font-medium">Total Amount</span>
              <span className="text-lg md:text-xl font-bold text-red-600">₹{Math.round(totalAmount).toFixed(0)}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <div className="flex flex-col">
              <label htmlFor="cashAmount" className="flex items-center gap-2 mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                <Banknote className="w-4 h-4 text-green-600" />
                Cash Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-sm">₹</span>
                <input
                  id="cashAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-10 pr-3 py-3 border-2 border-gray-200 rounded-xl text-sm transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                />
              </div>
            </div>

            <div className="flex flex-col">
              <label htmlFor="upiAmount" className="flex items-center gap-2 mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                <Smartphone className="w-4 h-4 text-purple-600" />
                UPI Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-sm">₹</span>
                <input
                  id="upiAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={upiAmount}
                  onChange={(e) => setUpiAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-10 pr-3 py-3 border-2 border-gray-200 rounded-xl text-sm transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </div>
            </div>

            <div className="flex flex-col">
              <label htmlFor="cardAmount" className="flex items-center gap-2 mb-2 text-xs md:text-sm text-gray-700 font-semibold">
                <CreditCard className="w-4 h-4 text-blue-600" />
                Card Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-sm">₹</span>
                <input
                  id="cardAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={cardAmount}
                  onChange={(e) => setCardAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-10 pr-3 py-3 border-2 border-gray-200 rounded-xl text-sm transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-50"
                />
              </div>
            </div>
          </div>
          {/* Split Payment Summary */}
          <div className="mt-4 p-4 bg-white rounded-xl border-2 border-gray-200 shadow-sm">
            <div className="flex justify-between items-center">
              <span className="text-xs md:text-sm text-gray-600 font-medium">Split Total:</span>
              <div className="flex items-center gap-2">
                {Math.abs((parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(cardAmount) || 0) - totalAmount) < 0.01 && (
                  <Check className="w-5 h-5 text-green-600" />
                )}
                <span className={`font-bold text-lg md:text-2xl ${Math.abs((parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(cardAmount) || 0) - totalAmount) < 0.01
                  ? 'text-green-600'
                  : 'text-red-500'
                  }`}>
                  ₹{Math.round((parseFloat(cashAmount) || 0) + (parseFloat(upiAmount) || 0) + (parseFloat(cardAmount) || 0)).toFixed(0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit Button - Full Width */}
      <div className="mt-6 md:mt-8">
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 px-5 py-3.5 md:py-4 bg-red-600 text-white border-none rounded-xl text-sm md:text-base font-bold cursor-pointer transition-all duration-200 shadow-lg hover:bg-red-700 hover:shadow-xl active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Check className="w-5 h-5" />
          <span>{isEdit ? 'Update Item' : 'Save Item'}</span>
        </button>
      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <div className="fixed inset-0 bg-transparent backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            {/* Header */}
            <div className="bg-red-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Camera className="w-6 h-6" />
                <h3 className="text-lg font-bold">Scan Product QR Code</h3>
              </div>
              <button
                onClick={stopScanner}
                className="p-2 hover:bg-red-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scanner Content */}
            <div className="p-6">
              {scannerError ? (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                    <X className="w-8 h-8 text-red-600" />
                  </div>
                  <p className="text-red-600 font-semibold mb-2">Camera Error</p>
                  <p className="text-sm text-gray-600 mb-4">{scannerError}</p>
                  <button
                    onClick={stopScanner}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Video Preview */}
                  <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video">
                    {scannerLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-linear-to-br from-purple-900 via-gray-900 to-blue-900 z-10">
                        <div className="text-center">
                          <div className="relative inline-block mb-4">
                            <img
                              src={logo}
                              alt="Loading"
                              className="w-20 h-20 object-contain animate-pulse"
                            />
                            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500 border-r-blue-500 animate-spin"></div>
                          </div>
                          <p className="text-white font-semibold text-lg">Starting Camera...</p>
                          <p className="text-purple-300 text-sm mt-1">Please allow camera access</p>
                        </div>
                      </div>
                    )}
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* GPay-style Scanning Overlay - Full Screen */}
                    {!scannerLoading && (
                      <div className="absolute inset-0">
                        {/* Darkened corners overlay */}
                        <div className="absolute inset-0 bg-linear-to-r from-black/40 via-transparent to-black/40"></div>
                        <div className="absolute inset-0 bg-linear-to-b from-black/40 via-transparent to-black/40"></div>

                        {/* Large scanning area - flexible frame */}
                        <div className="absolute inset-0 flex items-center justify-center p-8">
                          <div className="relative w-full max-w-sm aspect-square">
                            {/* Corner Markers - Larger and more visible */}
                            <div className="absolute -top-2 -left-2 w-16 h-16 border-t-4 border-l-4 border-white rounded-tl-2xl shadow-lg"></div>
                            <div className="absolute -top-2 -right-2 w-16 h-16 border-t-4 border-r-4 border-white rounded-tr-2xl shadow-lg"></div>
                            <div className="absolute -bottom-2 -left-2 w-16 h-16 border-b-4 border-l-4 border-white rounded-bl-2xl shadow-lg"></div>
                            <div className="absolute -bottom-2 -right-2 w-16 h-16 border-b-4 border-r-4 border-white rounded-br-2xl shadow-lg"></div>

                            {/* Subtle guide box */}
                            <div className="absolute inset-0 border-2 border-white/30 rounded-2xl"></div>

                            {/* Fast scanning line */}
                            <div className="absolute inset-0 overflow-hidden rounded-2xl">
                              <div className="absolute w-full h-1 bg-linear-to-r from-transparent via-white to-transparent shadow-lg animate-scan-fast"></div>
                            </div>
                          </div>
                        </div>

                        {/* Center focus indicator */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full opacity-50"></div>
                      </div>
                    )}
                  </div>

                  {/* Instructions - GPay Style */}
                  <div className="bg-linear-to-r from-red-50 to-blue-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <p className="text-sm text-gray-900 font-bold">
                        Point camera at QR code
                      </p>
                    </div>
                    <p className="text-xs text-gray-600 text-center">
                      Auto-detects instantly • No need to fit perfectly
                    </p>
                    <p className="text-xs text-purple-600 text-center mt-1 font-semibold">
                      ⚡ Fast scan enabled
                    </p>
                  </div>

                  {/* Help Section */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs text-blue-900 font-semibold mb-1.5">💡 Quick Tips:</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-blue-700">
                      <div>✓ Any angle works</div>
                      <div>✓ Good lighting</div>
                      <div>✓ Partial QR OK</div>
                      <div>✓ Auto-detects</div>
                    </div>
                  </div>

                  {/* Alternative: Manual Entry */}
                  <button
                    type="button"
                    onClick={() => {
                      stopScanner();
                      handleManualCodeInput();
                    }}
                    className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-semibold text-sm"
                  >
                    Enter Code Manually Instead
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div className="fixed top-20 right-4 z-9999 animate-in slide-in-from-right duration-300">
          <div className={`
            max-w-md rounded-lg shadow-2xl border-l-4 p-4 flex items-start gap-3
            ${notification.type === 'error' ? 'bg-red-50 border-red-500' : ''}
            ${notification.type === 'success' ? 'bg-green-50 border-green-500' : ''}
            ${notification.type === 'info' ? 'bg-red-50 border-red-500' : ''}
          `}>
            <div className="shrink-0">
              {notification.type === 'error' && (
                <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                  <X className="w-4 h-4 text-red-600" />
                </div>
              )}
              {notification.type === 'success' && (
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-600" />
                </div>
              )}
              {notification.type === 'info' && (
                <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                  <QrCode className="w-4 h-4 text-red-600" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`
                text-sm font-semibold
                ${notification.type === 'error' ? 'text-red-900' : ''}
                ${notification.type === 'success' ? 'text-green-900' : ''}
                ${notification.type === 'info' ? 'text-red-900' : ''}
              `}>
                {notification.message}
              </p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className={`
                shrink-0 p-1 rounded-full hover:bg-white/50 transition-colors
                ${notification.type === 'error' ? 'text-red-600' : ''}
                ${notification.type === 'success' ? 'text-green-600' : ''}
                ${notification.type === 'info' ? 'text-red-600' : ''}
              `}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </form>
  );
};

export default BillingForm;
