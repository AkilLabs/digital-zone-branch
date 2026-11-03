import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { collection, query, getDocs, doc, getDoc, where, orderBy } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Product, ShopDetails, Category } from '../types';
import Navbar from '../components/Navbar';
import { encodePrice } from '../utils/secretCode';
import logo from '../assets/logo.png';
import { 
  Printer, 
  Search, 
  Sparkles, 
  Sliders, 
  Eye, 
  ArrowLeft,
  Info,
  Trash2,
  X
} from 'lucide-react';


interface ProductCustomization {
  customName: string;
  customCode: string;
  customModels: string;
  customMrp: number;
  customCost: number;
  overrideNameFont: boolean;
  nameFontSize: number;
  overrideModelsFont: boolean;
  modelsFontSize: number;
  textAlignment: 'left' | 'center' | 'right';
  showShopName: boolean;
  customShopText: string;
  showMrp: boolean;
  showSecretCode: boolean;
  showQrCode: boolean;
  qrContent: string;
  qrCodeDataUrl: string;
  verticalPadding: number;
  horizontalPadding: number;
  qrSize: number;
}

const TamperLabel: React.FC = () => {
  const navigate = useNavigate();

  // Categories & Products Data
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [productSearch, setProductSearch] = useState('');
  
  // Loading states
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Selected Quantities for Print List
  // key: productId, value: quantity to print
  const [selectedQuantities, setSelectedQuantities] = useState<{ [productId: string]: number }>({});
  
  // Per-Product Customizations
  // key: productId, value: Customizations
  const [customizations, setCustomizations] = useState<{ [productId: string]: ProductCustomization }>({});

  // Global Defaults (used if no per-product override exists)
  const [globalShopText, setGlobalShopText] = useState('Max Mobiles');
  const [globalShowShopName, setGlobalShowShopName] = useState(true);
  const [globalShowMrp, setGlobalShowMrp] = useState(true);
  const [globalShowSecretCode, setGlobalShowSecretCode] = useState(true);
  const [globalShowQrCode, setGlobalShowQrCode] = useState(true);
  const [globalShowCompatible, setGlobalShowCompatible] = useState(true);
  const [globalShowCategory, setGlobalShowCategory] = useState(true);
  const [globalNameColor, setGlobalNameColor] = useState('#000000');
  
  const globalVerticalPadding = 1.5;
  const globalHorizontalPadding = 2.0;
  const globalQrSize = 16;


  // Printing Configurations
  const [printMode, setPrintMode] = useState<'roll' | 'a4_26' | 'a4_13'>('a4_26');
  const [startPosition, setStartPosition] = useState<number>(1);

  // Active Tweak Modal State
  const [tweakProduct, setTweakProduct] = useState<Product | null>(null);
  const [modalCustomName, setModalCustomName] = useState('');
  const [modalCustomCode, setModalCustomCode] = useState('');
  const [modalCustomModels, setModalCustomModels] = useState('');
  const [modalCustomMrp, setModalCustomMrp] = useState<number>(0);
  const [modalCustomCost, setModalCustomCost] = useState<number>(0);
  
  const [modalOverrideNameFont, setModalOverrideNameFont] = useState(false);
  const [modalNameFontSize, setModalNameFontSize] = useState(8.5);
  const [modalOverrideModelsFont, setModalOverrideModelsFont] = useState(false);
  const [modalModelsFontSize, setModalModelsFontSize] = useState(7.5);
  const [modalTextAlignment, setModalTextAlignment] = useState<'left' | 'center' | 'right'>('left');
  
  const [modalShowShopName, setModalShowShopName] = useState(true);
  const [modalCustomShopText, setModalCustomShopText] = useState('');
  const [modalShowMrp, setModalShowMrp] = useState(true);
  const [modalShowSecretCode, setModalShowSecretCode] = useState(true);
  const [modalShowQrCode, setModalShowQrCode] = useState(true);
  const [modalQrContent, setModalQrContent] = useState('');
  const [modalQrCodeDataUrl, setModalQrCodeDataUrl] = useState('');
  
  const [modalVerticalPadding, setModalVerticalPadding] = useState(1.5);
  const [modalHorizontalPadding, setModalHorizontalPadding] = useState(2.0);
  const [modalQrSize, setModalQrSize] = useState(16);

  const [previewScale, setPreviewScale] = useState(6); // Zoom factor (6px = 1mm)
  
  // Keep track of which product is currently highlighted/focused for preview
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);

  // Fetch shop details and categories on mount
  useEffect(() => {
    const initData = async () => {
      setLoadingCategories(true);
      try {
        // Fetch Shop Details
        const shopSnap = await getDoc(doc(db, 'settings', 'shopDetails'));
        if (shopSnap.exists()) {
          const data = shopSnap.data() as ShopDetails;
          setGlobalShopText(data.shopName || 'Max Mobiles');
        }

        // Fetch Categories
        const catQuery = query(collection(db, 'categories'), orderBy('name', 'asc'));
        const catSnap = await getDocs(catQuery);
        const catList = catSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        setCategories(catList);
        
        // Auto-select first category if available
        if (catList.length > 0) {
          setSelectedCategory(catList[0].name);
        }
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoadingCategories(false);
      }
    };
    initData();

    // Convert logo to base64
    const convertLogoToBase64 = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          setLogoDataUrl(dataUrl);
        }
      };
      img.src = logo;
    };
    convertLogoToBase64();
  }, []);

  // Fetch products when selected category changes
  useEffect(() => {
    if (!selectedCategory) {
      setProducts([]);
      return;
    }

    const fetchProducts = async () => {
      setLoadingProducts(true);
      try {
        const prodQuery = query(
          collection(db, 'products'),
          where('category', '==', selectedCategory)
        );
        const prodSnap = await getDocs(prodQuery);
        const prodList = prodSnap.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate(),
          updatedAt: doc.data().updatedAt?.toDate()
        } as Product));
        
        prodList.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(prodList);
        
        // Reset highlighted preview product to the first product
        if (prodList.length > 0) {
          setPreviewProductId(prodList[0].id || null);
        } else {
          setPreviewProductId(null);
        }
      } catch (err) {
        console.error('Error loading products:', err);
      } finally {
        setLoadingProducts(false);
      }
    };
    fetchProducts();
  }, [selectedCategory]);

  // Generate QR Code data URL when modal QR content changes
  useEffect(() => {
    const generateQR = async () => {
      if (!modalQrContent) {
        setModalQrCodeDataUrl('');
        return;
      }
      try {
        const url = await QRCode.toDataURL(modalQrContent, {
          width: 150,
          margin: 0,
          errorCorrectionLevel: 'L',
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
        setModalQrCodeDataUrl(url);
      } catch (err) {
        console.error('QR code generation error:', err);
      }
    };
    generateQR();
  }, [modalQrContent]);

  // Auto-calculated Font Sizes based on string length
  const getAutoNameFontSize = (text: string) => {
    const len = text.length;
    if (len < 25) return 9.5;
    if (len < 50) return 8.5;
    return 7.5;
  };

  const getAutoModelsFontSize = (text: string) => {
    const len = text.length;
    if (len < 20) return 9.5;
    if (len < 50) return 8.5;
    if (len < 100) return 7.5;
    if (len < 160) return 6.5;
    return 5.8;
  };

  // Helper to resolve absolute customizations for a product (combines product, custom, and global values)
  const getResolvedCustomization = (product: Product): ProductCustomization => {
    const custom = customizations[product.id!];
    
    // Joint list of compatible models default
    let defaultModels = '';
    if (product.suitableModels && product.suitableModels.length > 0) {
      defaultModels = product.suitableModels.join(', ');
    } else if (product.model) {
      defaultModels = product.model;
    }

    // Default base resolution
    const resolved: ProductCustomization = {
      customName: String(custom?.customName ?? product.name ?? ''),
      customCode: String(custom?.customCode ?? product.productCode ?? ''),
      customModels: String(custom?.customModels ?? defaultModels ?? ''),
      customMrp: custom?.customMrp ?? product.mrp,
      customCost: custom?.customCost ?? (product.cost || 0),
      
      overrideNameFont: custom?.overrideNameFont ?? false,
      nameFontSize: custom?.nameFontSize ?? getAutoNameFontSize(String(custom?.customName ?? product.name ?? '')),
      overrideModelsFont: custom?.overrideModelsFont ?? false,
      modelsFontSize: custom?.modelsFontSize ?? getAutoModelsFontSize(String(custom?.customModels ?? defaultModels ?? '')),
      textAlignment: custom?.textAlignment ?? 'left',
      
      showShopName: custom?.showShopName ?? globalShowShopName,
      customShopText: String(custom?.customShopText ?? globalShopText ?? ''),
      showMrp: custom?.showMrp ?? globalShowMrp,
      showSecretCode: custom?.showSecretCode ?? globalShowSecretCode,
      showQrCode: custom?.showQrCode ?? globalShowQrCode,
      qrContent: String(custom?.qrContent ?? product.productCode ?? ''),
      qrCodeDataUrl: String(custom?.qrCodeDataUrl ?? ''),
      
      verticalPadding: custom?.verticalPadding ?? globalVerticalPadding,
      horizontalPadding: custom?.horizontalPadding ?? globalHorizontalPadding,
      qrSize: custom?.qrSize ?? globalQrSize
    };

    return resolved;
  };

  // Resolve QR code data URL on-demand for previewing if not already in customization cache
  const [resolvedPreviewQr, setResolvedPreviewQr] = useState<string>('');
  const activePreviewProduct = products.find(p => p.id === previewProductId);
  const activeCustomization = activePreviewProduct ? getResolvedCustomization(activePreviewProduct) : null;

  useEffect(() => {
    const fetchPreviewQR = async () => {
      if (!activeCustomization?.qrContent) {
        setResolvedPreviewQr('');
        return;
      }
      // If customization already has the URL, use it
      if (activeCustomization.qrCodeDataUrl) {
        setResolvedPreviewQr(activeCustomization.qrCodeDataUrl);
        return;
      }
      try {
        const url = await QRCode.toDataURL(activeCustomization.qrContent, {
          width: 150,
          margin: 0,
          errorCorrectionLevel: 'L'
        });
        setResolvedPreviewQr(url);
      } catch (err) {
        console.error(err);
      }
    };
    fetchPreviewQR();
  }, [activePreviewProduct, activeCustomization?.qrContent, activeCustomization?.qrCodeDataUrl]);

  // Open Customize/Tweak Modal
  const handleOpenCustomizeModal = (product: Product) => {
    setTweakProduct(product);
    const resolved = getResolvedCustomization(product);
    
    setModalCustomName(resolved.customName);
    setModalCustomCode(resolved.customCode);
    setModalCustomModels(resolved.customModels);
    setModalCustomMrp(resolved.customMrp);
    setModalCustomCost(resolved.customCost);
    
    setModalOverrideNameFont(resolved.overrideNameFont);
    setModalNameFontSize(resolved.nameFontSize);
    setModalOverrideModelsFont(resolved.overrideModelsFont);
    setModalModelsFontSize(resolved.modelsFontSize);
    setModalTextAlignment(resolved.textAlignment);
    
    setModalShowShopName(resolved.showShopName);
    setModalCustomShopText(resolved.customShopText);
    setModalShowMrp(resolved.showMrp);
    setModalShowSecretCode(resolved.showSecretCode);
    setModalShowQrCode(resolved.showQrCode);
    setModalQrContent(resolved.qrContent);
    setModalQrCodeDataUrl(resolved.qrCodeDataUrl);
    
    setModalVerticalPadding(resolved.verticalPadding);
    setModalHorizontalPadding(resolved.horizontalPadding);
    setModalQrSize(resolved.qrSize);
  };

  // Close & Save Modal Details
  const handleSaveCustomization = () => {
    if (!tweakProduct) return;
    
    setCustomizations(prev => ({
      ...prev,
      [tweakProduct.id!]: {
        customName: modalCustomName,
        customCode: modalCustomCode,
        customModels: modalCustomModels,
        customMrp: modalCustomMrp,
        customCost: modalCustomCost,
        overrideNameFont: modalOverrideNameFont,
        nameFontSize: modalNameFontSize,
        overrideModelsFont: modalOverrideModelsFont,
        modelsFontSize: modalModelsFontSize,
        textAlignment: modalTextAlignment,
        showShopName: modalShowShopName,
        customShopText: modalCustomShopText,
        showMrp: modalShowMrp,
        showSecretCode: modalShowSecretCode,
        showQrCode: modalShowQrCode,
        qrContent: modalQrContent,
        qrCodeDataUrl: modalQrCodeDataUrl,
        verticalPadding: modalVerticalPadding,
        horizontalPadding: modalHorizontalPadding,
        qrSize: modalQrSize
      }
    }));

    // Auto-update qty to 1 if it was 0, so they don't lose their customized label
    const currentQty = selectedQuantities[tweakProduct.id!] || 0;
    if (currentQty === 0) {
      setSelectedQuantities(prev => ({ ...prev, [tweakProduct.id!]: 1 }));
    }

    setPreviewProductId(tweakProduct.id || null);
    setTweakProduct(null);
  };

  const handleResetModalToDefaults = () => {
    if (!tweakProduct) return;
    // Remove customizations from cache entirely, reverting to defaults
    setCustomizations(prev => {
      const copy = { ...prev };
      delete copy[tweakProduct.id!];
      return copy;
    });

    // Re-populate modal fields
    const defaultModels = tweakProduct.suitableModels && tweakProduct.suitableModels.length > 0
      ? tweakProduct.suitableModels.join(', ')
      : (tweakProduct.model || '');

    setModalCustomName(tweakProduct.name);
    setModalCustomCode(tweakProduct.productCode);
    setModalCustomModels(defaultModels);
    setModalCustomMrp(tweakProduct.mrp);
    setModalCustomCost(tweakProduct.cost || 0);
    setModalOverrideNameFont(false);
    setModalNameFontSize(getAutoNameFontSize(tweakProduct.name));
    setModalOverrideModelsFont(false);
    setModalModelsFontSize(getAutoModelsFontSize(defaultModels));
    setModalTextAlignment('left');
    setModalShowShopName(globalShowShopName);
    setModalCustomShopText(globalShopText);
    setModalShowMrp(globalShowMrp);
    setModalShowSecretCode(globalShowSecretCode);
    setModalShowQrCode(globalShowQrCode);
    setModalQrContent(String(tweakProduct.productCode ?? ''));
    setModalVerticalPadding(globalVerticalPadding);
    setModalHorizontalPadding(globalHorizontalPadding);
    setModalQrSize(globalQrSize);
  };

  // Manage direct quantities change
  const handleUpdateQty = (productId: string, newQty: number) => {
    const qty = Math.max(0, newQty);
    setSelectedQuantities(prev => ({
      ...prev,
      [productId]: qty
    }));
    
    if (qty > 0) {
      setPreviewProductId(productId);
    }
  };

  const handleClearAllQuantities = () => {
    setSelectedQuantities({});
  };

  const handleSelectAll = () => {
    setSelectedQuantities(prev => {
      const updated = { ...prev };
      filteredProducts.forEach(prod => {
        if (prod.id) {
          updated[prod.id] = 1;
        }
      });
      return updated;
    });
  };

  const handleDeselectAll = () => {
    setSelectedQuantities(prev => {
      const updated = { ...prev };
      filteredProducts.forEach(prod => {
        if (prod.id) {
          updated[prod.id] = 0;
        }
      });
      return updated;
    });
  };


  // Calculate totals
  const totalPrintCopies = Object.values(selectedQuantities).reduce((sum, q) => sum + q, 0);

  // Filtered products inside selected category
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.productCode.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.model && p.model.toLowerCase().includes(productSearch.toLowerCase()))
  );

  // Handle Print Action
  const handlePrint = async () => {
    if (totalPrintCopies === 0) {
      alert('Please set print quantity (at least 1 copy) for one or more products.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow pop-ups to print label templates.');
      return;
    }

    const labelItems: string[] = [];

    // Resolve print elements sequentially
    for (const prod of products) {
      const qty = selectedQuantities[prod.id!];
      if (!qty || qty <= 0) continue;

      const resolved = getResolvedCustomization(prod);
      const costCode = resolved.customCost > 0 ? encodePrice(resolved.customCost) : '';
      
      // Ensure we have a valid QR code url
      let qrUrl = resolved.qrCodeDataUrl;
      if (!qrUrl && resolved.showQrCode) {
        try {
          qrUrl = await QRCode.toDataURL(resolved.qrContent, {
            width: 150,
            margin: 0,
            errorCorrectionLevel: 'L'
          });
        } catch (err) {
          console.error(err);
        }
      }

      const isWide = printMode === 'a4_13';
      const labelWidth = isWide ? 160 : 80;

      const singleLabelHTML = `
        <div class="label-wrapper" style="
          width: ${labelWidth}mm;
          height: 20mm;
          padding: ${resolved.verticalPadding}mm ${resolved.horizontalPadding}mm;
          display: flex;
          align-items: center;
          box-sizing: border-box;
          overflow: hidden;
          background: #fff;
        ">
          <!-- Left Side: QR Code -->
          ${resolved.showQrCode && qrUrl ? `
            <div class="qr-box" style="
              width: ${resolved.qrSize}mm;
              height: ${resolved.qrSize}mm;
              flex-shrink: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            ">
              <img src="${qrUrl}" alt="QR" style="width: 100%; height: 100%; object-fit: contain;" />
            </div>
          ` : ''}

          <!-- Right Side: Details -->
          <div class="details-box" style="
            flex: 1;
            margin-left: ${resolved.showQrCode ? '2mm' : '0mm'};
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: ${20 - 2 * resolved.verticalPadding}mm;
            overflow: hidden;
          ">
            <!-- Top Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; line-height: 1;">
              ${resolved.showShopName && resolved.customShopText ? `
                <div style="display: flex; align-items: center; gap: 0.8mm; max-width: 45%; overflow: hidden;">
                  ${logoDataUrl ? `
                    <img src="${logoDataUrl}" alt="L" style="height: 3mm; width: auto; object-fit: contain; flex-shrink: 0;" />
                  ` : ''}
                  <div style="font-size: 6.5pt; font-weight: bold; text-transform: uppercase; color: #000; letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${resolved.customShopText}
                  </div>
                </div>
              ` : '<div></div>'}
              
              ${isWide ? `
                <div style="font-size: 8.5pt; font-weight: bold; color: ${globalNameColor}; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right;">
                  ${resolved.customName}
                </div>
              ` : (resolved.showSecretCode && costCode ? `
                <div style="font-size: 5.5pt; font-family: monospace; font-weight: bold; color: #444; border: 0.5px solid #ccc; padding: 0.1mm 0.5mm; border-radius: 0.2mm;">
                  ${costCode}
                </div>
              ` : '')}
            </div>

            <!-- Middle text content -->
            <div style="display: flex; flex-direction: column; justify-content: center; flex: 1; min-height: 0; padding: 0.3mm 0;">
              ${!isWide ? `
                <div style="
                  font-size: ${resolved.nameFontSize}pt;
                  font-weight: bold;
                  color: ${globalNameColor};
                  line-height: 1.1;
                  text-align: ${resolved.textAlignment};
                  word-break: break-word;
                  display: -webkit-box;
                  -webkit-line-clamp: 2;
                  -webkit-box-orient: vertical;
                  overflow: hidden;
                ">
                  ${resolved.customName}
                </div>
              ` : ''}
              
              <div style="display: flex; flex-direction: column; gap: 0.2mm; margin-top: 0.2mm;">
                ${globalShowCategory && prod.category ? `
                  <div style="font-size: 6.5pt; font-weight: bold; color: #666; text-transform: uppercase;">
                    Category: ${prod.category}
                  </div>
                ` : ''}
                
                ${globalShowCompatible && resolved.customModels ? `
                  <div style="
                    font-size: ${resolved.modelsFontSize}pt;
                    color: #222;
                    line-height: 1.1;
                    text-align: ${resolved.textAlignment};
                    font-style: italic;
                    word-break: break-word;
                    display: -webkit-box;
                    -webkit-line-clamp: 4;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                  ">
                    Compatible: ${resolved.customModels}
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- Bottom footer -->
            <div style="display: flex; justify-content: space-between; align-items: end; line-height: 1; font-size: 7.5pt;">
              <div style="font-family: monospace; font-weight: bold; color: #000; letter-spacing: 0.2px;">
                ${resolved.customCode}
              </div>

              ${isWide && resolved.showSecretCode && costCode ? `
                <div style="font-size: 6pt; font-family: monospace; font-weight: bold; color: #444; border: 0.5px solid #ccc; padding: 0.1mm 0.5mm; border-radius: 0.2mm;">
                  ${costCode}
                </div>
              ` : ''}
              
              ${resolved.showMrp && resolved.customMrp > 0 ? `
                <div style="font-weight: 800; color: #000;">
                  MRP: ₹${resolved.customMrp.toFixed(2)}
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;

      // Repeat according to Qty
      for (let q = 0; q < qty; q++) {
        labelItems.push(singleLabelHTML);
      }
    }

    let printHTML = '';

    if (printMode === 'roll') {
      const pages = labelItems.map(label => `
        <div class="roll-page">
          ${label}
        </div>
      `).join('');

      printHTML = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Print Labels - Roll</title>
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              @page {
                size: 80mm 20mm;
                margin: 0;
              }
              body {
                background: #ffffff;
                width: 80mm;
              }
              .roll-page {
                width: 80mm;
                height: 20mm;
                page-break-after: always;
                page-break-inside: avoid;
                break-after: page;
                overflow: hidden;
              }
              .roll-page:last-child {
                page-break-after: avoid;
                break-after: avoid;
              }
              @media print {
                body {
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
              }
            </style>
          </head>
          <body>
            ${pages}
          </body>
        </html>
      `;
    } else {
      // A4 Grid: 26 (Standard) or 13 (Wide) labels per page
      const isWide = printMode === 'a4_13';
      const labelsPerPage = isWide ? 13 : 26;
      const labelWidth = isWide ? 160 : 80;
      
      const sheetLabels: string[] = [];

      // Prepend empty labels for startPosition offset
      const emptySpacersCount = startPosition - 1;
      for (let i = 0; i < emptySpacersCount; i++) {
        sheetLabels.push(`
          <div class="label" style="visibility: hidden; border: none !important;"></div>
        `);
      }

      // Add actual labels
      labelItems.forEach(label => {
        sheetLabels.push(`
          <div class="label">
            ${label}
          </div>
        `);
      });

      // Pad remaining space to complete the last page
      const remainder = sheetLabels.length % labelsPerPage;
      if (remainder > 0) {
        const padCount = labelsPerPage - remainder;
        for (let i = 0; i < padCount; i++) {
          sheetLabels.push(`
            <div class="label" style="visibility: hidden; border: none !important;"></div>
          `);
        }
      }

      // Chunk into A4 pages
      let pagesHTML = '';
      for (let i = 0; i < sheetLabels.length; i += labelsPerPage) {
        const pageChunk = sheetLabels.slice(i, i + labelsPerPage).join('');
        pagesHTML += `
          <div class="a4-page">
            <div class="a4-labels-container">
              ${pageChunk}
            </div>
          </div>
        `;
      }

      printHTML = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Print Labels - A4 Sheet</title>
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              @page {
                size: A4;
                margin: 0;
              }
              html, body {
                width: 210mm;
                height: 297mm;
                margin: 0;
                padding: 0;
              }
              body {
                background: white;
              }
              .a4-page {
                width: 210mm;
                height: 297mm;
                page-break-after: always;
                page-break-inside: avoid;
                break-after: page;
                overflow: hidden;
              }
              .a4-page:last-child {
                page-break-after: avoid;
                break-after: avoid;
              }
              .a4-labels-container {
                display: grid;
                grid-template-columns: ${isWide ? 'repeat(1, 160mm)' : 'repeat(2, 80mm)'};
                grid-auto-rows: 20mm;
                column-gap: ${isWide ? '0mm' : '6mm'};
                row-gap: 2mm;
                justify-content: center;
                padding: 6.5mm ${isWide ? '25mm' : '22mm'};
                width: 100%;
                height: 100%;
              }
              .label {
                width: ${labelWidth}mm;
                height: 20mm;
                border: 0.2mm dashed #bbb;
                page-break-inside: avoid;
                break-inside: avoid;
                overflow: hidden;
                display: block;
                background: white;
              }
              @media print {
                body {
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .label {
                  border: 0.2mm dashed #bbb !important;
                }
              }
            </style>
          </head>
          <body>
            ${pagesHTML}
          </body>
        </html>
      `;
    }

    printWindow.document.write(printHTML);
    printWindow.document.close();

    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 350);
    };
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full flex flex-col">
        
        {/* Back Link & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate('/products')}
              className="p-2 bg-white rounded-xl shadow-sm hover:shadow border border-gray-200 transition-all duration-200 group text-gray-600 hover:text-blue-600 cursor-pointer"
              title="Back to Products"
            >
              <ArrowLeft className="h-5 w-5 transition-transform duration-200 group-hover:-translate-x-1" />
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Printer className="h-6 w-6 text-blue-600" />
                Tamper Box Label Printer
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Quickly select products by category, set print quantity, and print 8cm × 2cm labels
              </p>
            </div>
          </div>

          {totalPrintCopies > 0 && (
            <button
              onClick={handleClearAllQuantities}
              className="text-xs font-semibold text-red-600 hover:text-red-700 bg-white hover:bg-red-50 border border-gray-200 rounded-xl px-4 py-2 flex items-center gap-1.5 transition-all cursor-pointer self-start sm:self-auto"
            >
              <Trash2 className="h-4 w-4" />
              Clear Quantities
            </button>
          )}
        </div>

        {/* Categories horizontal pill view */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm mb-6">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            Filter by Category
          </div>
          {loadingCategories ? (
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-8 w-24 bg-gray-150 animate-pulse rounded-full"></div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const isActive = selectedCategory === cat.name;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.name)}
                      className={`px-4 py-2 rounded-full text-xs font-bold transition-all border cursor-pointer ${
                        isActive
                          ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
              
              {selectedCategory && filteredProducts.length > 0 && (
                <div className="flex gap-2.5 pt-2 border-t border-gray-100/60 animate-fadeIn">
                  <button
                    onClick={handleSelectAll}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50/50 hover:bg-blue-50 border border-blue-200/50 hover:border-blue-300 rounded-xl px-3 py-1.5 transition-all cursor-pointer"
                  >
                    Select All in Category (Sets Qty = 1)
                  </button>
                  <button
                    onClick={handleDeselectAll}
                    className="text-[11px] font-bold text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-250 rounded-xl px-3 py-1.5 transition-all cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              )}
            </div>

          )}
        </div>

        {/* Main Grid: Left Products List (7/12) & Right Settings/Preview (5/12) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start flex-1">
          
          {/* Left Column: Product Cards & Search */}
          <div className="lg:col-span-7 space-y-4 flex flex-col h-full">
            
            {/* Search Input Bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search products by name, code, brand..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full h-11 pl-10 pr-4 bg-white border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all shadow-sm"
              />
            </div>

            {/* Products grid */}
            {selectedCategory ? (
              loadingProducts ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-36 bg-white animate-pulse border border-gray-200 rounded-2xl"></div>
                  ))}
                </div>
              ) : filteredProducts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[620px] overflow-y-auto pr-1">
                  {filteredProducts.map((prod) => {
                    const qty = selectedQuantities[prod.id!] || 0;
                    const isCustomized = !!customizations[prod.id!];
                    const isFocused = previewProductId === prod.id;
                    
                    return (
                      <div 
                        key={prod.id}
                        onClick={() => setPreviewProductId(prod.id || null)}
                        className={`p-4 bg-white rounded-2xl border transition-all duration-200 flex flex-col justify-between gap-3 cursor-pointer ${
                          isFocused 
                            ? 'ring-2 ring-blue-500 border-blue-500 shadow-md' 
                            : qty > 0 
                              ? 'border-blue-300 bg-blue-50/10 shadow-sm' 
                              : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start gap-2">
                            <h3 className="font-bold text-gray-900 text-sm line-clamp-1 flex-1">{prod.name}</h3>
                            <span className="font-mono bg-gray-150 text-gray-600 px-1.5 py-0.5 rounded text-[10px] font-bold">
                              {prod.productCode}
                            </span>
                          </div>
                          
                          <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 min-h-[2rem] leading-relaxed">
                            {prod.suitableModels && prod.suitableModels.length > 0
                              ? `Fits: ${prod.suitableModels.join(', ')}`
                              : prod.model ? `Fits: ${prod.model}` : 'No compatible models specified'}
                          </p>

                          <div className="flex justify-between items-center text-xs text-gray-400 mt-2">
                            <span>Stock: <strong className="text-gray-600">{prod.quantity}</strong> units</span>
                            <span className="font-bold text-gray-800 text-sm">₹{prod.mrp.toFixed(0)}</span>
                          </div>
                        </div>

                        {/* Card controls row */}
                        <div className="flex justify-between items-center border-t border-gray-100 pt-3">
                          {/* Customize "Tweak" button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation(); // prevent highlighted state change
                              handleOpenCustomizeModal(prod);
                            }}
                            className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
                              isCustomized 
                                ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            <Sliders className="h-3.5 w-3.5" />
                            {isCustomized ? 'Customized' : 'Tweak Design'}
                          </button>

                          {/* Print Qty counter */}
                          <div 
                            className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50"
                            onClick={(e) => e.stopPropagation()} // prevent highlighted state change
                          >
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(prod.id!, qty - 1)}
                              className="px-3 py-1 hover:bg-white text-gray-600 transition-colors border-r border-gray-200 text-sm font-bold cursor-pointer"
                            >
                              -
                            </button>
                            <span className="px-3 text-xs font-bold text-gray-800 min-w-8 text-center bg-white">{qty}</span>
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(prod.id!, qty + 1)}
                              className="px-3 py-1 hover:bg-white text-gray-600 transition-colors border-l border-gray-200 text-sm font-bold cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500 bg-white border border-gray-200 rounded-2xl flex flex-col items-center justify-center p-6 gap-2">
                  <Info className="h-6 w-6 text-gray-300" />
                  No products found in this category.
                </div>
              )
            ) : (
              <div className="text-center py-20 text-gray-400 bg-white border border-gray-200 rounded-2xl flex flex-col items-center justify-center p-6 gap-2">
                <Info className="h-8 w-8 text-gray-300" />
                <span>Please select a category pill above to display products.</span>
              </div>
            )}

          </div>

          {/* Right Column: Live Layout Preview & Print Trigger Options */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-24">
            
            {/* 1. Label preview box */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-gray-400" />
                  <h2 className="text-base font-bold text-gray-800">Sticker Preview</h2>
                </div>
                
                {/* Zoom control */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-400">Zoom:</span>
                  <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50 px-1 py-0.5">
                    <button 
                      onClick={() => setPreviewScale(prev => Math.max(3, prev - 1))}
                      className="p-1 hover:bg-white rounded transition-colors text-gray-600 border-0"
                      disabled={previewScale <= 3}
                    >
                      -
                    </button>
                    <span className="px-2 text-xs font-mono font-bold text-gray-700 w-12 text-center">
                      {(previewScale / 6 * 100).toFixed(0)}%
                    </span>
                    <button 
                      onClick={() => setPreviewScale(prev => Math.min(10, prev + 1))}
                      className="p-1 hover:bg-white rounded transition-colors text-gray-600 border-0"
                      disabled={previewScale >= 10}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {activePreviewProduct && activeCustomization ? (
                <div className="flex flex-col items-center justify-center py-6 bg-gray-100/50 rounded-2xl border border-gray-200/50 p-4">
                  <div className="text-center text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 bg-white border border-gray-200/60 rounded-full px-3 py-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                    {(printMode === 'a4_13') ? '16cm × 2cm' : '8cm × 2cm'} Sticker Layout
                  </div>
                  
                  {/* Scaled Sticker Element */}
                  <div 
                    className="bg-white shadow-md border border-gray-300 relative overflow-hidden transition-all flex items-center justify-between"
                    style={{
                      width: `${(printMode === 'a4_13' ? 160 : 80) * previewScale}px`,
                      height: `${20 * previewScale}px`,
                      padding: `${activeCustomization.verticalPadding * previewScale}px ${activeCustomization.horizontalPadding * previewScale}px`,
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* QR Code */}
                    {activeCustomization.showQrCode && resolvedPreviewQr ? (
                      <div 
                        className="bg-white flex items-center justify-center flex-shrink-0"
                        style={{
                          width: `${activeCustomization.qrSize * previewScale}px`,
                          height: `${activeCustomization.qrSize * previewScale}px`,
                        }}
                      >
                        <img 
                          src={resolvedPreviewQr} 
                          alt="Preview QR" 
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : null}

                    {/* Right text box */}
                    <div 
                      className="flex-1 flex flex-col justify-between h-full overflow-hidden"
                      style={{
                        marginLeft: activeCustomization.showQrCode ? `${2 * previewScale}px` : '0px',
                      }}
                    >
                      {/* Shop header */}
                      <div className="flex justify-between items-center leading-none">
                        {activeCustomization.showShopName && activeCustomization.customShopText ? (
                          <div 
                            className="flex items-center text-left"
                            style={{ gap: `${0.8 * previewScale}px`, maxWidth: printMode === 'a4_13' ? '45%' : '70%' }}
                          >
                            {logoDataUrl && (
                              <img 
                                src={logoDataUrl} 
                                alt="L" 
                                className="object-contain flex-shrink-0"
                                style={{ height: `${3 * previewScale}px`, width: 'auto' }}
                              />
                            )}
                            <div 
                              className="font-bold uppercase text-gray-900 truncate tracking-wide"
                              style={{ 
                                fontSize: `${6.5 * (previewScale / 6)}pt`,
                                lineHeight: '1'
                              }}
                            >
                              {activeCustomization.customShopText}
                            </div>
                          </div>
                        ) : <div></div>}
                        
                        {printMode === 'a4_13' ? (
                          <div 
                            className="font-bold truncate text-right text-black"
                            style={{ 
                              fontSize: `${8.5 * (previewScale / 6)}pt`,
                              color: globalNameColor,
                              maxWidth: '50%',
                              lineHeight: '1'
                            }}
                          >
                            {activeCustomization.customName}
                          </div>
                        ) : (
                          activeCustomization.showSecretCode && activeCustomization.customCost > 0 ? (
                            <span 
                              className="font-mono font-bold text-gray-400 border border-gray-300 rounded leading-none text-right"
                              style={{ 
                                fontSize: `${5.5 * (previewScale / 6)}pt`,
                                padding: `${0.1 * previewScale}px ${0.5 * previewScale}px`
                              }}
                            >
                              {encodePrice(activeCustomization.customCost)}
                            </span>
                          ) : null
                        )}
                      </div>

                      {/* Titles */}
                      <div className="flex-1 flex flex-col justify-center min-h-0 py-0.5">
                        {printMode !== 'a4_13' && (
                          <div 
                            className="font-bold leading-tight overflow-hidden text-ellipsis line-clamp-2"
                            style={{
                              fontSize: `${activeCustomization.nameFontSize * (previewScale / 6)}pt`,
                              textAlign: activeCustomization.textAlignment,
                              color: globalNameColor,
                            }}
                          >
                            {activeCustomization.customName}
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          {globalShowCategory && activePreviewProduct.category && (
                            <div 
                              className="font-bold text-gray-500 uppercase tracking-wide"
                              style={{ fontSize: `${6.5 * (previewScale / 6)}pt` }}
                            >
                              Category: {activePreviewProduct.category}
                            </div>
                          )}
                          {globalShowCompatible && activeCustomization.customModels && (
                            <div 
                              className="text-gray-700 leading-tight italic overflow-hidden text-ellipsis line-clamp-4 animate-fadeIn"
                              style={{
                                fontSize: `${activeCustomization.modelsFontSize * (previewScale / 6)}pt`,
                                textAlign: activeCustomization.textAlignment,
                              }}
                            >
                              Compatible: {activeCustomization.customModels}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex justify-between items-end leading-none">
                        <span 
                          className="font-mono font-bold text-black"
                          style={{ fontSize: `${7.5 * (previewScale / 6)}pt`, letterSpacing: '0.2px' }}
                        >
                          {activeCustomization.customCode}
                        </span>

                        {printMode === 'a4_13' && activeCustomization.showSecretCode && activeCustomization.customCost > 0 ? (
                          <span 
                            className="font-mono font-bold text-gray-400 border border-gray-300 rounded leading-none text-center"
                            style={{ 
                              fontSize: `${5.5 * (previewScale / 6)}pt`,
                              padding: `${0.1 * previewScale}px ${0.5 * previewScale}px`
                            }}
                          >
                            {encodePrice(activeCustomization.customCost)}
                          </span>
                        ) : null}
                        
                        {activeCustomization.showMrp && activeCustomization.customMrp > 0 ? (
                          <span 
                            className="font-extrabold text-black"
                            style={{ fontSize: `${7.5 * (previewScale / 6)}pt` }}
                          >
                            MRP: ₹{activeCustomization.customMrp.toFixed(2)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                  </div>

                  <div className="mt-2 text-[10px] text-gray-500 text-center font-medium">
                    Previewing: <span className="font-semibold text-gray-700">{activePreviewProduct.name}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  Select a category and select/tweak a product to preview its label.
                </div>
              )}
            </div>

            {/* 2. Print options & trigger */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wider border-b border-gray-150 pb-2 flex justify-between items-center">
                <span>Layout & Printer Settings</span>
                {totalPrintCopies > 0 && (
                  <span className="bg-blue-600 text-white font-extrabold px-2 py-0.5 rounded-full text-[10px]">
                    {totalPrintCopies} Label{totalPrintCopies > 1 ? 's' : ''} queued
                  </span>
                )}
              </div>

              {/* Printer Mode Toggle */}
              <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                <span className="text-sm font-bold text-gray-700">Printer Layout</span>
                <div className="flex flex-wrap border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm w-full">
                  <button
                    type="button"
                    onClick={() => setPrintMode('a4_26')}
                    className={`flex-1 min-w-[80px] px-3 py-2 text-center text-xs font-bold transition-all cursor-pointer border-0 ${
                      printMode === 'a4_26' 
                        ? 'bg-blue-600 text-white' 
                        : 'hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    A4 (8x2cm, 26/p)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrintMode('a4_13');
                      if (startPosition > 13) {
                        setStartPosition(1);
                      }
                    }}
                    className={`flex-1 min-w-[80px] px-3 py-2 text-center text-xs font-bold transition-all cursor-pointer border-0 ${
                      printMode === 'a4_13' 
                        ? 'bg-blue-600 text-white' 
                        : 'hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    A4 (16x2cm, 13/p)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintMode('roll')}
                    className={`flex-1 min-w-[80px] px-3 py-2 text-center text-xs font-bold transition-all cursor-pointer border-0 ${
                      printMode === 'roll' 
                        ? 'bg-blue-600 text-white' 
                        : 'hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    Roll
                  </button>
                </div>
              </div>

              {/* Starting slot for A4 */}
              {(printMode === 'a4_26' || printMode === 'a4_13') && (
                <div className="space-y-3 pt-2 border-t border-gray-100 animate-fadeIn">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div>
                      <h4 className="font-bold text-gray-800">Starting Position</h4>
                      <p className="text-gray-400">Select first empty sticker slot.</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max={printMode === 'a4_26' ? 26 : 13}
                      value={startPosition}
                      onChange={(e) => {
                        const maxVal = printMode === 'a4_26' ? 26 : 13;
                        setStartPosition(Math.max(1, Math.min(maxVal, parseInt(e.target.value) || 1)));
                      }}
                      className="w-14 px-2 py-1 border border-gray-250 rounded-lg text-center font-bold text-gray-700 bg-white"
                    />
                  </div>

                  {/* A4 visual slots layout */}
                  <div className={`grid gap-1 p-2 bg-gray-50 border border-gray-200 rounded-xl mx-auto ${
                    printMode === 'a4_26' ? 'grid-cols-4 max-w-[280px]' : 'grid-cols-2 max-w-[140px]'
                  }`}>
                    {Array.from({ length: printMode === 'a4_26' ? 26 : 13 }, (_, i) => {
                      const pos = i + 1;
                      const isSkipped = pos < startPosition;
                      const isPrinting = pos >= startPosition && pos < startPosition + totalPrintCopies;

                      let cellClass = "h-5 text-[9px] rounded font-bold border flex items-center justify-center transition-all cursor-pointer ";
                      if (isSkipped) {
                        cellClass += "bg-gray-200 border-gray-300 text-gray-400";
                      } else if (isPrinting) {
                        cellClass += "bg-blue-600 border-blue-700 text-white shadow-sm";
                      } else {
                        cellClass += "bg-white border-gray-200 text-gray-500 hover:bg-blue-50";
                      }

                      return (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => setStartPosition(pos)}
                          className={cellClass}
                          title={`Starting slot #${pos}`}
                        >
                          {pos}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Global Design Tweaks */}
              <div className="space-y-3 pt-3 border-t border-gray-100 animate-fadeIn text-xs">
                <h4 className="font-bold text-gray-800 uppercase tracking-wider text-[10px] text-gray-500">
                  Global Design Tweaks (Whole Print)
                </h4>

                {/* Color Selector */}
                <div className="space-y-1">
                  <span className="font-bold text-gray-700">Product Name Color:</span>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {[
                      { name: 'Black', hex: '#000000' },
                      { name: 'Blue', hex: '#2563EB' },
                      { name: 'Green', hex: '#059669' },
                      { name: 'Red', hex: '#EF4444' },
                      { name: 'Orange', hex: '#F97316' },
                      { name: 'Purple', hex: '#8B5CF6' },
                      { name: 'Pink', hex: '#EC4899' },
                      { name: 'Teal', hex: '#0D9488' },
                      { name: 'Amber', hex: '#D97706' }
                    ].map((col) => (
                      <button
                        key={col.hex}
                        type="button"
                        onClick={() => setGlobalNameColor(col.hex)}
                        className={`h-5 w-5 rounded-full border cursor-pointer transition-all ${
                          globalNameColor === col.hex 
                            ? 'ring-2 ring-blue-500 ring-offset-1 border-transparent scale-110 shadow-sm' 
                            : 'border-gray-300 hover:scale-105'
                        }`}
                        style={{ backgroundColor: col.hex }}
                        title={col.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Toggles Grid */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-gray-600">
                    <input 
                      type="checkbox" 
                      checked={globalShowShopName} 
                      onChange={(e) => setGlobalShowShopName(e.target.checked)}
                      className="rounded text-blue-600 h-3.5 w-3.5"
                    />
                    <span>Shop Name</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-gray-600">
                    <input 
                      type="checkbox" 
                      checked={globalShowQrCode} 
                      onChange={(e) => setGlobalShowQrCode(e.target.checked)}
                      className="rounded text-blue-600 h-3.5 w-3.5"
                    />
                    <span>QR Code</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-gray-600">
                    <input 
                      type="checkbox" 
                      checked={globalShowMrp} 
                      onChange={(e) => setGlobalShowMrp(e.target.checked)}
                      className="rounded text-blue-600 h-3.5 w-3.5"
                    />
                    <span>MRP Price</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-gray-600">
                    <input 
                      type="checkbox" 
                      checked={globalShowSecretCode} 
                      onChange={(e) => setGlobalShowSecretCode(e.target.checked)}
                      className="rounded text-blue-600 h-3.5 w-3.5"
                    />
                    <span>Secret Code</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-gray-600">
                    <input 
                      type="checkbox" 
                      checked={globalShowCategory} 
                      onChange={(e) => setGlobalShowCategory(e.target.checked)}
                      className="rounded text-blue-600 h-3.5 w-3.5"
                    />
                    <span>Category</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-gray-600">
                    <input 
                      type="checkbox" 
                      checked={globalShowCompatible} 
                      onChange={(e) => setGlobalShowCompatible(e.target.checked)}
                      className="rounded text-blue-600 h-3.5 w-3.5"
                    />
                    <span>Fits Models</span>
                  </label>
                </div>
              </div>

              {/* Big Print Button */}
              <button
                onClick={handlePrint}
                disabled={totalPrintCopies <= 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-2xl transition-all shadow flex items-center justify-center gap-2 text-base group cursor-pointer mt-2"
              >
                <Printer className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
                Print {totalPrintCopies} Label{totalPrintCopies > 1 ? 's' : ''}
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* 3. TWEAK DESIGN MODAL (Slide-in / Pop-up) */}
      {tweakProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto flex flex-col border border-gray-100">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-150">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Sliders className="h-5 w-5 text-orange-600" />
                  Tweak Design: <span className="text-blue-600 font-extrabold">{tweakProduct.name}</span>
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Customize fields and font scaling specifically for this box label</p>
              </div>
              <button 
                onClick={() => setTweakProduct(null)}
                className="p-2 hover:bg-gray-100 rounded-xl transition-all text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Left Column: Form Settings */}
              <div className="space-y-4">
                
                {/* Product Name */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                    Label Name Title
                  </label>
                  <input
                    type="text"
                    value={modalCustomName}
                    onChange={(e) => setModalCustomName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-250 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Compatible Models */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                      Compatible Models (Fits)
                    </label>
                    {!modalOverrideModelsFont && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Auto-Scaled: {modalOverrideModelsFont ? modalModelsFontSize : getAutoModelsFontSize(modalCustomModels)}pt
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={modalCustomModels}
                    onChange={(e) => setModalCustomModels(e.target.value)}
                    placeholder="List compatible phones/models..."
                    className="w-full px-3 py-2 border border-gray-250 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Overridable Details */}
                <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-150">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Product Code</label>
                    <input
                      type="text"
                      value={modalCustomCode}
                      onChange={(e) => setModalCustomCode(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">Custom MRP (₹)</label>
                    <input
                      type="number"
                      value={modalCustomMrp || ''}
                      onChange={(e) => setModalCustomMrp(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                    />
                  </div>
                </div>

                {/* Typography overrides */}
                <div className="space-y-3 bg-gray-50 p-3 rounded-xl border border-gray-150">
                  
                  {/* Name Font Size Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-600">Name Font Size</span>
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-gray-500 flex items-center gap-1 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={modalOverrideNameFont} 
                            onChange={(e) => setModalOverrideNameFont(e.target.checked)}
                            className="rounded text-blue-600 h-3.5 w-3.5"
                          />
                          <span>Override</span>
                        </label>
                        <span className="font-mono text-xs font-bold text-blue-600">
                          {(modalOverrideNameFont ? modalNameFontSize : getAutoNameFontSize(modalCustomName)).toFixed(1)}pt
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="14"
                      step="0.5"
                      value={modalNameFontSize}
                      onChange={(e) => {
                        setModalNameFontSize(parseFloat(e.target.value));
                        setModalOverrideNameFont(true);
                      }}
                      className="w-full accent-blue-600 bg-gray-250 h-1 rounded"
                    />
                  </div>

                  {/* Models Font Size Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-600">Models Font Size</span>
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-gray-500 flex items-center gap-1 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={modalOverrideModelsFont} 
                            onChange={(e) => setModalOverrideModelsFont(e.target.checked)}
                            className="rounded text-blue-600 h-3.5 w-3.5"
                          />
                          <span>Override</span>
                        </label>
                        <span className="font-mono text-xs font-bold text-blue-600">
                          {(modalOverrideModelsFont ? modalModelsFontSize : getAutoModelsFontSize(modalCustomModels)).toFixed(1)}pt
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="3.5"
                      max="12"
                      step="0.1"
                      value={modalModelsFontSize}
                      onChange={(e) => {
                        setModalModelsFontSize(parseFloat(e.target.value));
                        setModalOverrideModelsFont(true);
                      }}
                      className="w-full accent-blue-600 bg-gray-250 h-1 rounded"
                    />
                  </div>

                  {/* Text alignment buttons */}
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-600">Align Text</span>
                    <div className="flex border border-gray-250 rounded-lg overflow-hidden bg-white shadow-sm">
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          type="button"
                          onClick={() => setModalTextAlignment(align)}
                          className={`px-2.5 py-1 text-[10px] font-bold uppercase transition-all border-0 cursor-pointer ${
                            modalTextAlignment === align 
                              ? 'bg-blue-600 text-white' 
                              : 'hover:bg-gray-100 text-gray-600'
                          }`}
                        >
                          {align}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Padding / Margin Fine-tune */}
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-150 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] font-bold text-gray-500">Vert. Padding: {modalVerticalPadding}mm</span>
                      <input
                        type="range"
                        min="0.5"
                        max="4.0"
                        step="0.1"
                        value={modalVerticalPadding}
                        onChange={(e) => setModalVerticalPadding(parseFloat(e.target.value))}
                        className="w-full accent-blue-600 bg-gray-250 h-1 rounded"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-500">Horiz. Padding: {modalHorizontalPadding}mm</span>
                      <input
                        type="range"
                        min="0.5"
                        max="6.0"
                        step="0.1"
                        value={modalHorizontalPadding}
                        onChange={(e) => setModalHorizontalPadding(parseFloat(e.target.value))}
                        className="w-full accent-blue-600 bg-gray-250 h-1 rounded"
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* Right Column: Live Modal Preview & Toggles */}
              <div className="space-y-4">
                
                {/* The visual preview */}
                <div className="flex flex-col items-center justify-center p-4 bg-gray-100/70 border border-gray-200 rounded-2xl shadow-inner min-h-[160px]">
                  <div 
                    className="bg-white shadow border border-gray-300 relative overflow-hidden flex items-center justify-between transition-all"
                    style={{
                      width: `${(printMode === 'a4_13' ? 160 : 80) * 5.5}px`, // scaled for modal
                      height: `${20 * 5.5}px`,
                      padding: `${modalVerticalPadding * 5.5}px ${modalHorizontalPadding * 5.5}px`,
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* QR Code */}
                    {modalShowQrCode && modalQrCodeDataUrl ? (
                      <div 
                        className="bg-white flex items-center justify-center flex-shrink-0"
                        style={{
                          width: `${modalQrSize * 5.5}px`,
                          height: `${modalQrSize * 5.5}px`,
                        }}
                      >
                        <img 
                          src={modalQrCodeDataUrl} 
                          alt="Modal QR" 
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : null}

                    {/* Text block */}
                    <div 
                      className="flex-1 flex flex-col justify-between h-full overflow-hidden"
                      style={{
                        marginLeft: modalShowQrCode ? `${2 * 5.5}px` : '0px',
                      }}
                    >
                      <div className="flex justify-between items-center leading-none">
                        {modalShowShopName && modalCustomShopText ? (
                          <div 
                            className="flex items-center text-left"
                            style={{ gap: `${0.8 * 5.5}px`, maxWidth: printMode === 'a4_13' ? '45%' : '70%' }}
                          >
                            {logoDataUrl && (
                              <img 
                                src={logoDataUrl} 
                                alt="L" 
                                className="object-contain flex-shrink-0"
                                style={{ height: `${3 * 5.5}px`, width: 'auto' }}
                              />
                            )}
                            <div 
                              className="font-bold uppercase text-gray-900 truncate tracking-wide"
                              style={{ 
                                fontSize: `${6.5 * (5.5 / 6)}pt`,
                                lineHeight: '1'
                              }}
                            >
                              {modalCustomShopText}
                            </div>
                          </div>
                        ) : <div></div>}
                        
                        {printMode === 'a4_13' ? (
                          <div 
                            className="font-bold truncate text-right text-black"
                            style={{ 
                              fontSize: `${8.5 * (5.5 / 6)}pt`,
                              color: globalNameColor,
                              maxWidth: '50%',
                              lineHeight: '1'
                            }}
                          >
                            {modalCustomName}
                          </div>
                        ) : (
                          modalShowSecretCode && modalCustomCost > 0 ? (
                            <span 
                              className="font-mono font-bold text-gray-400 border border-gray-300 rounded leading-none text-right"
                              style={{ 
                                fontSize: `${5.5 * (5.5 / 6)}pt`,
                                padding: `${0.1 * 5.5}px ${0.5 * 5.5}px`
                              }}
                            >
                              {encodePrice(modalCustomCost)}
                            </span>
                          ) : null
                        )}
                      </div>

                      {/* Main titles */}
                      <div className="flex-1 flex flex-col justify-center min-h-0 py-0.5">
                        {printMode !== 'a4_13' && (
                          <div 
                            className="font-bold leading-tight overflow-hidden text-ellipsis line-clamp-2"
                            style={{
                              fontSize: `${(modalOverrideNameFont ? modalNameFontSize : getAutoNameFontSize(modalCustomName)) * (5.5 / 6)}pt`,
                              textAlign: modalTextAlignment,
                              color: globalNameColor,
                            }}
                          >
                            {modalCustomName}
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          {globalShowCategory && tweakProduct?.category && (
                            <div 
                              className="font-bold text-gray-500 uppercase tracking-wide"
                              style={{ fontSize: `${6.5 * (5.5 / 6)}pt` }}
                            >
                              Category: {tweakProduct.category}
                            </div>
                          )}
                          {globalShowCompatible && modalCustomModels && (
                            <div 
                              className="text-gray-700 leading-tight italic overflow-hidden text-ellipsis line-clamp-4 mt-0.5"
                              style={{
                                fontSize: `${(modalOverrideModelsFont ? modalModelsFontSize : getAutoModelsFontSize(modalCustomModels)) * (5.5 / 6)}pt`,
                                textAlign: modalTextAlignment,
                              }}
                            >
                              Compatible: {modalCustomModels}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex justify-between items-end leading-none">
                        <span 
                          className="font-mono font-bold text-black"
                          style={{ fontSize: `${7.5 * (5.5 / 6)}pt` }}
                        >
                          {modalCustomCode}
                        </span>

                        {printMode === 'a4_13' && modalShowSecretCode && modalCustomCost > 0 ? (
                          <span 
                            className="font-mono font-bold text-gray-400 border border-gray-300 rounded leading-none text-center"
                            style={{ 
                              fontSize: `${5.5 * (5.5 / 6)}pt`,
                              padding: `${0.1 * 5.5}px ${0.5 * 5.5}px`
                            }}
                          >
                            {encodePrice(modalCustomCost)}
                          </span>
                        ) : null}
                        
                        {modalShowMrp && modalCustomMrp > 0 ? (
                          <span 
                            className="font-extrabold text-black"
                            style={{ fontSize: `${7.5 * (5.5 / 6)}pt` }}
                          >
                            MRP: ₹{modalCustomMrp.toFixed(2)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                  </div>
                </div>

                {/* Toggles */}
                <div className="space-y-2 bg-gray-50 p-4 rounded-xl border border-gray-150 text-xs">
                  <div className="text-xs font-bold text-gray-600 uppercase tracking-wide border-b border-gray-200 pb-1 mb-2">
                    Visibility Toggles
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 cursor-pointer py-1 font-medium text-gray-700 hover:text-gray-900">
                      <input
                        type="checkbox"
                        checked={modalShowShopName}
                        onChange={(e) => setModalShowShopName(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <span>Print Shop Name</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer py-1 font-medium text-gray-700 hover:text-gray-900">
                      <input
                        type="checkbox"
                        checked={modalShowQrCode}
                        onChange={(e) => setModalShowQrCode(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <span>Print QR Code</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer py-1 font-medium text-gray-700 hover:text-gray-900">
                      <input
                        type="checkbox"
                        checked={modalShowMrp}
                        onChange={(e) => setModalShowMrp(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <span>Print MRP Price</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer py-1 font-medium text-gray-700 hover:text-gray-900">
                      <input
                        type="checkbox"
                        checked={modalShowSecretCode}
                        onChange={(e) => setModalShowSecretCode(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <span>Print Cost Code</span>
                    </label>
                  </div>

                  {modalShowShopName && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <span className="text-[10px] font-bold text-gray-500">Custom Shop Text:</span>
                      <input
                        type="text"
                        value={modalCustomShopText}
                        onChange={(e) => setModalCustomShopText(e.target.value)}
                        placeholder="e.g. Max Mobiles"
                        className="w-full px-2 py-1.5 border border-gray-250 rounded-lg text-xs font-semibold mt-1 bg-white"
                      />
                    </div>
                  )}

                  {modalShowQrCode && (
                    <div className="mt-2 pt-2 border-t border-gray-200 flex gap-3">
                      <div className="flex-1">
                        <span className="text-[10px] font-bold text-gray-500">QR Data Content:</span>
                        <input
                          type="text"
                          value={modalQrContent}
                          onChange={(e) => setModalQrContent(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-250 rounded-lg text-xs font-mono mt-1 bg-white"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-gray-500">QR Size: {modalQrSize}mm</span>
                        <input
                          type="range"
                          min="10"
                          max="19"
                          step="0.5"
                          value={modalQrSize}
                          onChange={(e) => setModalQrSize(parseFloat(e.target.value))}
                          className="w-full accent-blue-600 bg-gray-255 h-1 rounded mt-3"
                        />
                      </div>
                    </div>
                  )}
                </div>

              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-150 bg-gray-50 rounded-b-3xl flex justify-between gap-3">
              <button
                onClick={handleResetModalToDefaults}
                className="text-xs font-semibold text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-250 rounded-xl px-4 py-2.5 transition-all cursor-pointer bg-white"
              >
                Reset Default Design
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setTweakProduct(null)}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded-xl px-5 py-2.5 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCustomization}
                  className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl px-6 py-2.5 transition-all cursor-pointer shadow-sm shadow-blue-200"
                >
                  Save & Apply Tweak
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default TamperLabel;
