import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Product, ShopDetails } from '../types';
import { Printer, X } from 'lucide-react';
import logo from '../assets/logo.png';
import { encodePrice } from '../utils/secretCode';

interface ProductLabelProps {
  product?: Product;
  products?: Product[]; // For printing multiple products
  shopDetails: ShopDetails | null;
  onClose: () => void;
  isNewProduct?: boolean; // Flag to indicate if this is a newly added product
}

const ProductLabel: React.FC<ProductLabelProps> = ({ product, products, shopDetails, onClose, isNewProduct = false }) => {
  const [qrCodeDataUrls, setQrCodeDataUrls] = useState<{ [key: string]: string }>({});
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');

  // Determine if we're working with single or multiple products
  const singleProduct = product || (products && products.length === 1 ? products[0] : null);

  // Generate QR Codes and convert logo to base64
  useEffect(() => {
    const generateQRCodes = async () => {
      try {
        const qrUrls: { [key: string]: string } = {};

        if (products && products.length > 0) {
          // Generate QR codes for all products
          for (const prod of products) {
            const qrData = String(prod.productCode || '');
            const qrDataUrl = await QRCode.toDataURL(qrData, {
              width: 200,
              margin: 1,
              errorCorrectionLevel: 'L',
              color: {
                dark: '#000000',
                light: '#FFFFFF'
              }
            });
            qrUrls[prod.productCode!] = qrDataUrl;
          }
        } else if (product) {
          // Generate QR code for single product
          const qrData = String(product.productCode || '');
          const qrDataUrl = await QRCode.toDataURL(qrData, {
            width: 200,
            margin: 1,
            errorCorrectionLevel: 'L',
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          qrUrls[product.productCode!] = qrDataUrl;
        }

        setQrCodeDataUrls(qrUrls);
      } catch (error) {
        console.error('Error generating QR codes:', error);
      }
    };

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

    generateQRCodes();
    convertLogoToBase64();
  }, [product, products]);

  const handlePrint = () => {
    // Create a new window for printing
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow pop-ups to print labels');
      return;
    }

    // Generate labels based on whether we have single or multiple products
    const labelList: string[] = [];
    let totalLabels = 0;
    let titleText = '';

    if (products && products.length > 0) {
      // Multiple products - generate labels for each
      products.forEach((prod) => {
        const qrDataUrl = qrCodeDataUrls[prod.productCode!];
        for (let i = 0; i < prod.quantity; i++) {
          labelList.push(`
            <div class="label">
              <div class="label-content">
                <div class="label-header">
                  <div class="header-left">
                    <img src="${logoDataUrl || logo}" alt="Logo" class="label-logo" />
                    <div class="shop-name">${shopDetails?.shopName || 'Digital Zone'}</div>
                  </div>
                  <div class="secret-cost">${encodePrice(prod.cost)}</div>
                </div>
                
                <div class="label-body">
                  <img src="${qrDataUrl}" alt="QR" class="body-qr-code" />
                  <div class="product-name">
                    ${prod.name}
                  </div>
                </div>
                
                <div class="label-footer">
                  <span class="product-code">${prod.productCode}</span>
                  <span class="product-mrp">MRP: ₹${prod.mrp.toFixed(2)}</span>
                </div>
              </div>
            </div>
          `);
        }
        totalLabels += prod.quantity;
      });
      titleText = `Product Labels - ${products.length} products (${totalLabels} labels)`;
    } else if (product) {
      // Single product
      const qrDataUrl = qrCodeDataUrls[product.productCode!];
      for (let i = 0; i < product.quantity; i++) {
        labelList.push(`
          <div class="label">
            <div class="label-content">
              <div class="label-header">
                <div class="header-left">
                  <img src="${logoDataUrl || logo}" alt="Logo" class="label-logo" />
                  <div class="shop-name">${shopDetails?.shopName || 'Digital Zone'}</div>
                </div>
                <div class="secret-cost">${encodePrice(product.cost)}</div>
              </div>
              
              <div class="label-body">
                <img src="${qrDataUrl}" alt="QR" class="body-qr-code" />
                <div class="product-name">
                  ${product.name}
                </div>
              </div>
              
              <div class="label-footer">
                <span class="product-code">${product.productCode}</span>
                <span class="product-mrp">MRP: ₹${product.mrp.toFixed(2)}</span>
              </div>
            </div>
          </div>
        `);
      }
      titleText = `Product Labels - ${product.name} (${product.quantity} labels)`;
      totalLabels = product.quantity;
    }

    // Group labels into pages of 48 labels each (12 rows of 4 columns)
    const labelsPerPage = 48;
    let allPagesHTML = '';
    for (let i = 0; i < labelList.length; i += labelsPerPage) {
      const pageLabels = labelList.slice(i, i + labelsPerPage).join('');
      allPagesHTML += `
        <div class="labels-container">
          ${pageLabels}
        </div>
      `;
    }

    const labelHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${titleText}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            @page {
              size: A4;
              margin: 0.45cm;
            }
            
            body {
              font-family: 'Segoe UI', Arial, sans-serif;
              background: white;
              padding: 0;
              margin: 0;
            }
            
            .labels-container {
              display: grid;
              grid-template-columns: repeat(4, 4.8cm);
              column-gap: 0.3cm;
              row-gap: 0;
              justify-content: space-between;
              align-content: flex-start;
              width: 20.1cm;
              height: 28.8cm;
              page-break-after: always;
              break-after: page;
              box-sizing: border-box;
            }
            
            .label {
              width: 4.8cm;
              height: 2.4cm;
              border: 0.1mm solid #eee;
              display: flex;
              background: white;
              page-break-inside: avoid;
              break-inside: avoid-page;
              overflow: hidden;
              box-sizing: border-box;
            }
            
            .label-content {
              width: 100%;
              height: 100%;
              padding: 0.8mm 1.2mm;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            
            .label-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding-bottom: 0.5mm;
              border-bottom: 0.2px solid #eee;
              height: 3.8mm;
            }
            
            .header-left {
              display: flex;
              align-items: center;
              gap: 1mm;
              overflow: hidden;
            }
            
            .secret-cost {
              font-size: 4.5pt;
              font-family: monospace;
              color: #777;
              white-space: nowrap;
            }
            
            .label-logo {
              width: 3.2mm;
              height: 3.2mm;
              object-fit: contain;
            }
            
            .shop-name {
              font-size: 4.5pt;
              font-weight: 600;
              text-transform: uppercase;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              color: #444;
            }
            
            .label-body {
              flex: 1;
              display: flex;
              align-items: center;
              gap: 1.2mm;
              overflow: hidden;
              padding: 0.5mm 0;
            }
            
            .body-qr-code {
              width: 9.5mm;
              height: 9.5mm;
              object-fit: contain;
              flex-shrink: 0;
            }
            
            .product-name {
              flex: 1;
              font-size: 6.5pt;
              font-weight: 500;
              line-height: 1.2;
              overflow: hidden;
              word-break: break-word;
              display: -webkit-box;
              -webkit-line-clamp: 3;
              -webkit-box-orient: vertical;
              color: #222;
            }
            
            .label-footer {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding-top: 0.5mm;
              border-top: 0.2px solid #eee;
              height: 3.5mm;
            }
            
            .product-code {
              font-size: 5pt;
              font-family: monospace;
              font-weight: normal;
              color: #666;
            }
            
            .product-mrp {
              font-size: 6pt;
              font-weight: bold;
              color: #000;
            }
            
            @media print {
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .label {
                border: 0.1mm solid transparent;
              }
              .labels-container {
                page-break-after: always;
              }
            }
          </style>
        </head>
        <body>
          ${allPagesHTML}
        </body>
      </html>
    `;

    printWindow.document.write(labelHTML);
    printWindow.document.close();

    // Wait for content to load, then print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    };
  };

  return (
    <div className="fixed inset-0 bg-transparent backdrop-blur-xl bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {isNewProduct ? '✅ Product Added Successfully!' :
                products && products.length > 1 ? 'Print Multiple Product Labels' :
                  'Product Label Preview'}
            </h2>
            {isNewProduct && (
              <p className="text-sm text-gray-600 mt-1">Print the QR code label now or skip to print later</p>
            )}
            {products && products.length > 1 && (
              <p className="text-sm text-gray-600 mt-1">
                Printing {products.length} products with {products.reduce((sum, p) => sum + p.quantity, 0)} total labels
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {products && products.length > 1 ? (
            /* Multiple Products Summary */
            <>
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Products to Print</h3>
                <div className="max-h-96 overflow-y-auto space-y-2 bg-gray-50 rounded-lg p-4">
                  {products.map((prod, index) => (
                    <div key={prod.id || index} className="bg-white p-3 rounded-lg border border-gray-200 flex justify-between items-center">
                      <div className="flex-1">
                        <div className="font-medium text-sm">{prod.name}</div>
                        <div className="text-xs text-gray-500">Code: {prod.productCode} | Brand: {prod.brand}</div>
                      </div>
                      <div className="text-sm font-semibold text-blue-600 ml-4">
                        {prod.quantity} label{prod.quantity > 1 ? 's' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : singleProduct ? (
            /* Single Product Preview and Details */
            <>
              {/* Label Preview */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 text-center">Label Preview (Actual: 4.8cm × 2.4cm)</h3>
                <div className="rounded-xl p-6 bg-gray-100 flex justify-center">
                  {/* Scaled preview - Using 6x scale for clarity */}
                  <div
                    className="bg-white shadow-lg border border-gray-300 flex overflow-hidden"
                    style={{
                      width: '288px', // 48mm × 6
                      height: '144px', // 24mm × 6
                    }}
                  >
                    <div className="flex flex-col justify-between w-full h-full p-[5px]">
                      {/* Header */}
                      <div className="flex items-center justify-between border-b border-gray-100 pb-[3px] h-[23px]">
                        <div className="flex items-center gap-[4px] overflow-hidden">
                          <img
                            src={logoDataUrl || logo}
                            alt="Logo"
                            className="object-contain w-auto max-w-[28px] h-[19px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                          />
                          <div className="font-semibold text-[7.5px] uppercase truncate text-gray-700">
                            {shopDetails?.shopName || 'Digital Zone'}
                          </div>
                        </div>
                        <div className="font-mono text-[7px] text-gray-500">
                          {encodePrice(singleProduct.cost)}
                        </div>
                      </div>

                      {/* Body - QR + Product Name */}
                      <div className="flex-1 flex items-center gap-[6px] overflow-hidden py-[3px]">
                        <img
                          src={qrCodeDataUrls[singleProduct.productCode!]}
                          alt="QR"
                          className="w-[57px] h-[57px] object-contain flex-shrink-0"
                        />
                        <div className="font-semibold text-[11px] leading-[1.2] text-gray-800 overflow-hidden"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                          }}>
                          {singleProduct.name}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex justify-between items-center border-t border-gray-100 pt-[3px] h-[21px]">
                        <span className="font-mono text-[7px] text-gray-500">{singleProduct.productCode}</span>
                        <span className="font-bold text-[9px] text-gray-900">MRP: ₹{singleProduct.mrp.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Product Details */}
              <div className="mb-6 bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Product Details</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600">Product Code:</span>
                    <span className="ml-2 font-mono font-bold">{singleProduct.productCode}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Brand:</span>
                    <span className="ml-2 font-medium">{singleProduct.brand}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Model:</span>
                    <span className="ml-2 font-medium">{singleProduct.model || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Category:</span>
                    <span className="ml-2 font-medium">{singleProduct.category}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Supplier:</span>
                    <span className="ml-2 font-medium">{singleProduct.supplier || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Quantity:</span>
                    <span className="ml-2 font-medium">{singleProduct.quantity}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Availability:</span>
                    <span className={`ml-2 font-semibold ${singleProduct.isAvailable !== false ? 'text-green-600' : 'text-red-600'
                      }`}>
                      {singleProduct.isAvailable !== false ? '✓ Available' : '✗ Unavailable'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handlePrint}
              className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
            >
              <Printer className="h-5 w-5" />
              {products && products.length > 1
                ? `Print ${products.reduce((sum, p) => sum + p.quantity, 0)} Labels`
                : singleProduct
                  ? `Print ${singleProduct.quantity} Label${singleProduct.quantity > 1 ? 's' : ''}`
                  : 'Print Labels'
              }
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              {isNewProduct ? 'Skip / Print Later' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductLabel;