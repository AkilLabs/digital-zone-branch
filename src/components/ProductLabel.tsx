import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Product, ShopDetails } from '../types';
import { Printer, X, QrCode, Tag } from 'lucide-react';
import logo from '../assets/logo.png';
import { encodePrice } from '../utils/secretCode';

interface ProductLabelProps {
  product?: Product;
  products?: Product[]; // For printing multiple products
  shopDetails: ShopDetails | null;
  onClose: () => void;
  isNewProduct?: boolean; // Flag to indicate if this is a newly added product
}

const ProductLabel: React.FC<ProductLabelProps> = ({
  product,
  products,
  shopDetails,
  onClose,
  isNewProduct = false
}) => {
  const [qrCodeDataUrls, setQrCodeDataUrls] = useState<{ [key: string]: string }>({});
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');

  // Determine if we're working with single or multiple products
  const singleProduct = product || (products && products.length === 1 ? products[0] : null);
  const isMultiple = Boolean(products && products.length > 1);

  // Generate QR Codes and convert logo to base64
  useEffect(() => {
    const generateQRCodes = async () => {
      try {
        const qrUrls: { [key: string]: string } = {};

        if (products && products.length > 0) {
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
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow pop-ups to print barcode labels');
      return;
    }

    const labelList: string[] = [];
    let totalLabels = 0;
    let titleText = '';

    if (products && products.length > 0) {
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

    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    };
  };

  const totalLabelCount = isMultiple && products
    ? products.reduce((sum, p) => sum + (p.quantity || 1), 0)
    : (singleProduct?.quantity || 1);

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200/90 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimal Modern Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isNewProduct ? 'Product Added • Print Barcode' :
                  isMultiple ? 'Batch Barcode Labels' :
                    'Barcode Sticker'}
              </h2>
              <p className="text-xs text-slate-500">
                Standard thermal sheet preview • 48mm × 24mm
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-5">
          {isMultiple && products ? (
            /* Multiple Products Manifest */
            <div className="space-y-3 mb-5">
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>Selected {products.length} Products</span>
                <span className="font-semibold text-blue-600 font-mono">{totalLabelCount} stickers total</span>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1.5 bg-slate-50/80 rounded-xl p-2.5 border border-slate-200/70">
                {products.map((prod, index) => (
                  <div
                    key={prod.id || index}
                    className="bg-white p-2.5 rounded-lg border border-slate-200 flex justify-between items-center text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-slate-900 truncate">{prod.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Code: {prod.productCode} • MRP: ₹{prod.mrp?.toFixed(2)}
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 font-mono font-bold text-xs shrink-0">
                      {prod.quantity} {prod.quantity > 1 ? 'copies' : 'copy'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : singleProduct ? (
            /* Single Product Minimal Sticker Preview */
            <div className="space-y-4 mb-5">
              {/* Sticker Preview Container */}
              <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border border-slate-200/80 flex flex-col items-center justify-center">
                <div
                  className="bg-white shadow-md rounded-md border border-slate-200 flex overflow-hidden select-none transition-transform hover:scale-[1.02]"
                  style={{
                    width: '264px',
                    height: '132px',
                  }}
                >
                  <div className="flex flex-col justify-between w-full h-full p-2">
                    {/* Sticker Header: Logo + Shop Name + Secret Code */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-1 h-5">
                      <div className="flex items-center gap-1 overflow-hidden">
                        <img
                          src={logoDataUrl || logo}
                          alt="Logo"
                          className="object-contain w-auto max-w-[22px] h-[16px]"
                        />
                        <span className="font-bold text-[8px] uppercase tracking-wider truncate text-slate-700">
                          {shopDetails?.shopName || 'Digital Zone'}
                        </span>
                      </div>
                      <span className="font-mono text-[7.5px] font-bold text-slate-500 tracking-wider">
                        {encodePrice(singleProduct.cost)}
                      </span>
                    </div>

                    {/* Sticker Body: QR Code + Product Name */}
                    <div className="flex-1 flex items-center gap-2 overflow-hidden py-1">
                      {qrCodeDataUrls[singleProduct.productCode!] ? (
                        <img
                          src={qrCodeDataUrls[singleProduct.productCode!]}
                          alt="QR"
                          className="w-[52px] h-[52px] object-contain shrink-0"
                        />
                      ) : (
                        <div className="w-[52px] h-[52px] bg-slate-100 rounded flex items-center justify-center text-slate-400">
                          <QrCode className="w-6 h-6" />
                        </div>
                      )}
                      <div
                        className="font-bold text-[10px] leading-tight text-slate-900 overflow-hidden"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {singleProduct.name}
                      </div>
                    </div>

                    {/* Sticker Footer: Product Code + MRP */}
                    <div className="flex justify-between items-center border-t border-slate-100 pt-1 h-5 text-[8px]">
                      <span className="font-mono font-medium text-slate-600">
                        {singleProduct.productCode}
                      </span>
                      <span className="font-bold text-slate-900 font-mono">
                        MRP: ₹{singleProduct.mrp?.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-medium mt-3 flex items-center gap-1.5">
                  <Tag className="w-3 h-3" />
                  <span>Actual print output: 4.8 cm × 2.4 cm standard sticker</span>
                </div>
              </div>

              {/* Minimal Product Meta Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-900">{singleProduct.productCode}</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-600 font-medium">{singleProduct.brand}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Sticker copies:</span>
                  <span className="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                    {singleProduct.quantity}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Action Buttons: Modern Blue CTA */}
          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              {isNewProduct ? 'Skip / Later' : 'Cancel'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print {totalLabelCount} Barcode Sticker{totalLabelCount > 1 ? 's' : ''}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductLabel;
