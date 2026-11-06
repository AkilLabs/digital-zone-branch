import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { Product, ShopDetails } from '../types';
import { Printer, X, Minus, Plus, QrCode, CheckCircle2 } from 'lucide-react';
import { encodePrice } from '../utils/secretCode';

interface ProductLabelProps {
  product?: Product;
  products?: Product[]; // For printing multiple products
  shopDetails: ShopDetails | null;
  onClose: () => void;
  isNewProduct?: boolean; // Flag to indicate if this is a newly added product
}

// A4 sheet layout: 4 columns × 12 rows of 48mm × 24mm stickers
const LABELS_PER_SHEET = 48;
const MAX_COPIES = 999;

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const clampCopies = (n: number) => Math.min(MAX_COPIES, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));

const Stepper: React.FC<{ value: number; onChange: (n: number) => void; size?: 'sm' | 'lg'; label: string }> = ({
  value,
  onChange,
  size = 'sm',
  label
}) => {
  const btn =
    size === 'lg'
      ? 'w-11 h-11 rounded-xl'
      : 'w-8 h-8 rounded-lg';
  const input =
    size === 'lg'
      ? 'w-20 h-11 text-lg rounded-xl'
      : 'w-12 h-8 text-sm rounded-lg';
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        aria-label={`Fewer copies of ${label}`}
        onClick={() => onChange(value - 1)}
        disabled={value <= 0}
        className={`${btn} flex items-center justify-center border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      >
        <Minus className="w-4 h-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_COPIES}
        value={value}
        aria-label={`Copies of ${label}`}
        onFocus={e => e.target.select()}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
        className={`${input} text-center font-semibold tabular-nums text-slate-900 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <button
        type="button"
        aria-label={`More copies of ${label}`}
        onClick={() => onChange(value + 1)}
        disabled={value >= MAX_COPIES}
        className={`${btn} flex items-center justify-center border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};

const ProductLabel: React.FC<ProductLabelProps> = ({
  product,
  products,
  shopDetails,
  onClose,
  isNewProduct = false
}) => {
  // Normalise to a single list so single + bulk share one UI
  const items = useMemo<Product[]>(
    () => (products && products.length > 0 ? products : product ? [product] : []),
    [product, products]
  );
  const isSingle = items.length === 1;

  const [copies, setCopies] = useState<number[]>(() => items.map(p => Math.max(1, p.quantity || 1)));
  const [previewIndex, setPreviewIndex] = useState(0);
  const [qrCodeDataUrls, setQrCodeDataUrls] = useState<{ [key: string]: string }>({});

  const shopName = shopDetails?.shopName || 'Digital Zone';

  useEffect(() => {
    setCopies(items.map(p => Math.max(1, p.quantity || 1)));
    setPreviewIndex(0);
  }, [items]);

  // Generate QR codes
  useEffect(() => {
    let cancelled = false;

    const generateQRCodes = async () => {
      try {
        const qrUrls: { [key: string]: string } = {};
        for (const prod of items) {
          const code = String(prod.productCode || '');
          if (qrUrls[code]) continue;
          qrUrls[code] = await QRCode.toDataURL(code, {
            width: 200,
            margin: 0,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#FFFFFF' }
          });
        }
        if (!cancelled) setQrCodeDataUrls(qrUrls);
      } catch (error) {
        console.error('Error generating QR codes:', error);
      }
    };

    generateQRCodes();
    return () => {
      cancelled = true;
    };
  }, [items]);

  // Escape closes the dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalLabels = copies.reduce((sum, n) => sum + n, 0);
  const sheets = Math.ceil(totalLabels / LABELS_PER_SHEET);
  const qrReady = items.every(p => qrCodeDataUrls[String(p.productCode || '')]);
  const previewProduct = items[previewIndex] || items[0];

  const stock = (p: Product) => Math.max(0, Number(p.quantity ?? (p as any).stock ?? 0));

  const setCopyAt = (index: number, value: number) =>
    setCopies(prev => prev.map((n, i) => (i === index ? clampCopies(value) : n)));

  const setAll = (mode: 'one' | 'stock') =>
    setCopies(items.map(p => (mode === 'one' ? 1 : Math.max(1, stock(p)))));

  const allOne = copies.length > 0 && copies.every(n => n === 1);
  const allStock = copies.length > 0 && copies.every((n, i) => n === Math.max(1, stock(items[i])));

  const handlePrint = () => {
    if (totalLabels === 0 || !qrReady) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Pop-ups are blocked. Allow pop-ups for this site to print labels.');
      return;
    }

    const labelList: string[] = [];

    items.forEach((prod, index) => {
      const qrDataUrl = qrCodeDataUrls[String(prod.productCode || '')];
      const secret = prod.cost ? escapeHtml(encodePrice(prod.cost)) : '';
      const formattedPrice = Number(prod.mrp || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      const labelHtml = `
        <div class="label">
          <div class="label-inner">
            <div class="qr-col">
              <div class="qr-box">
                <img src="${qrDataUrl}" alt="" class="qr-img" />
              </div>
              <div class="code-text">${escapeHtml(prod.productCode)}</div>
            </div>
            <div class="info-col">
              <div class="meta-row">
                <span class="shop-title">${escapeHtml(shopName)}</span>
                ${secret ? `<span class="secret-tag">${secret}</span>` : ''}
              </div>
              <div class="name-block">
                <div class="prod-title">${escapeHtml(prod.name)}</div>
              </div>
              <div class="price-row">
                <span class="mrp-badge">MRP</span>
                <span class="price-amount">₹${formattedPrice}</span>
              </div>
            </div>
          </div>
        </div>`;
      for (let i = 0; i < copies[index]; i++) labelList.push(labelHtml);
    });

    let allPagesHTML = '';
    for (let i = 0; i < labelList.length; i += LABELS_PER_SHEET) {
      allPagesHTML += `<div class="labels-container">${labelList.slice(i, i + LABELS_PER_SHEET).join('')}</div>`;
    }

    const titleText = isSingle
      ? `Labels - ${escapeHtml(items[0].name)} (${totalLabels})`
      : `Labels - ${items.length} products (${totalLabels})`;

    const labelHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${titleText}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            @page { size: A4; margin: 0.45cm; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: white; -webkit-font-smoothing: antialiased; }
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
            }
            .label {
              width: 4.8cm;
              height: 2.4cm;
              border: 0.1mm solid #e5e5e5;
              display: flex;
              background: white;
              page-break-inside: avoid;
              break-inside: avoid-page;
              overflow: hidden;
            }
            .label-inner {
              width: 100%;
              height: 100%;
              padding: 1.2mm 1.5mm;
              display: flex;
              align-items: stretch;
              gap: 1.8mm;
              overflow: hidden;
            }
            .qr-col {
              width: 14.5mm;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: space-between;
              flex-shrink: 0;
            }
            .qr-box {
              width: 14mm;
              height: 14mm;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .qr-img {
              width: 100%;
              height: 100%;
              object-fit: contain;
              image-rendering: -webkit-optimize-contrast;
            }
            .code-text {
              font-size: 5pt;
              font-family: 'Consolas', 'Courier New', monospace;
              font-weight: 700;
              color: #0f172a;
              letter-spacing: 0.3px;
              text-align: center;
              width: 100%;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              line-height: 1.1;
            }
            .info-col {
              flex: 1;
              min-width: 0;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              overflow: hidden;
              padding: 0.2mm 0;
            }
            .meta-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 1mm;
              border-bottom: 0.2mm solid #e2e8f0;
              padding-bottom: 0.6mm;
              line-height: 1;
            }
            .shop-title {
              font-size: 5.2pt;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.4px;
              color: #334155;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .secret-tag {
              font-size: 4.8pt;
              font-family: 'Consolas', monospace;
              font-weight: 700;
              color: #64748b;
              white-space: nowrap;
            }
            .name-block {
              flex: 1;
              display: flex;
              align-items: center;
              overflow: hidden;
              padding: 0.5mm 0;
            }
            .prod-title {
              font-size: 7.2pt;
              font-weight: 700;
              line-height: 1.22;
              color: #0f172a;
              overflow: hidden;
              word-break: break-word;
              display: -webkit-box;
              -webkit-line-clamp: 3;
              -webkit-box-orient: vertical;
            }
            .price-row {
              display: flex;
              align-items: baseline;
              gap: 1.2mm;
              border-top: 0.2mm solid #e2e8f0;
              padding-top: 0.6mm;
              line-height: 1;
            }
            .mrp-badge {
              font-size: 5pt;
              font-weight: 700;
              color: #64748b;
              letter-spacing: 0.3px;
            }
            .price-amount {
              font-size: 8.5pt;
              font-weight: 900;
              color: #000;
              letter-spacing: -0.2px;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .label { border: 0.1mm solid transparent; }
            }
          </style>
        </head>
        <body>${allPagesHTML}</body>
      </html>`;

    printWindow.document.write(labelHTML);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    };
  };

  if (items.length === 0) return null;

  const renderPreview = (prod: Product) => {
    const qr = qrCodeDataUrls[String(prod.productCode || '')];
    const secret = prod.cost ? encodePrice(prod.cost) : '';
    const formattedPrice = Number(prod.mrp || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    return (
      <div
        className="bg-white rounded-lg shadow-sm ring-1 ring-slate-200/90 flex overflow-hidden select-none"
        style={{ width: 240, height: 120 }}
        aria-label="Label preview"
      >
        <div className="flex w-full h-full p-2.5 gap-2.5">
          {/* Left: QR + Product Code */}
          <div className="flex flex-col items-center justify-between shrink-0" style={{ width: 72 }}>
            <div className="w-[70px] h-[70px] flex items-center justify-center bg-white">
              {qr ? (
                <img src={qr} alt="" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full bg-slate-100 rounded flex items-center justify-center text-slate-300 animate-pulse">
                  <QrCode className="w-6 h-6" />
                </div>
              )}
            </div>
            <span className="font-mono font-bold text-[8px] text-slate-800 tracking-wider truncate max-w-full">
              {prod.productCode || '—'}
            </span>
          </div>

          {/* Right: Info */}
          <div className="flex-1 flex flex-col justify-between min-w-0 py-0.5">
            {/* Header: Shop & Secret */}
            <div className="flex items-center justify-between gap-1 border-b border-slate-100 pb-1">
              <span className="font-bold text-[8px] tracking-wider uppercase text-slate-600 truncate">
                {shopName}
              </span>
              {secret && (
                <span className="font-mono text-[7.5px] font-semibold text-slate-500 shrink-0">
                  {secret}
                </span>
              )}
            </div>

            {/* Product Name */}
            <div className="flex-1 flex items-center py-1">
              <div
                className="font-bold text-[11px] leading-tight text-slate-900 overflow-hidden"
                style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
                title={prod.name}
              >
                {prod.name}
              </div>
            </div>

            {/* Price Footer */}
            <div className="flex items-baseline gap-1 border-t border-slate-100 pt-1">
              <span className="text-[8px] font-bold text-slate-500 uppercase">MRP</span>
              <span className="text-[12px] font-extrabold text-slate-900 font-mono tracking-tight">
                ₹{formattedPrice}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-end sm:items-center justify-center z-[60] sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-labels-title"
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0">
            {isNewProduct && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Product saved
              </p>
            )}
            <h2 id="print-labels-title" className="text-lg font-semibold text-slate-900">
              {isSingle ? 'Print labels' : `Print labels for ${items.length} products`}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Choose how many stickers to print for each product.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 -mr-2 -mt-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* Preview */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 py-5 flex flex-col items-center">
            {renderPreview(previewProduct)}
            <p className="text-xs text-slate-400 mt-3">
              {isSingle ? 'Actual size 48 × 24 mm' : 'Tap a product below to preview its label'}
            </p>
          </div>

          {isSingle ? (
            /* Single product: one big stepper + quick picks */
            <div className="mt-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">Copies</p>
                  <p className="text-xs text-slate-500">{stock(items[0])} in stock</p>
                </div>
                <Stepper size="lg" label={items[0].name} value={copies[0]} onChange={n => setCopyAt(0, n)} />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {[1, 5, 10].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCopyAt(0, n)}
                    className={`h-9 px-4 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      copies[0] === n
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {stock(items[0]) > 0 ? (
                  <button
                    type="button"
                    onClick={() => setCopyAt(0, stock(items[0]))}
                    className={`h-9 px-4 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      copies[0] === stock(items[0])
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Same as stock ({stock(items[0])})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCopyAt(0, 1)}
                    className={`h-9 px-4 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      copies[0] === 1
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Default (1)
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Multiple products: list with per-row steppers */
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-medium text-slate-900">Copies per product</p>
                <div className="inline-flex p-0.5 bg-slate-100 rounded-lg text-xs font-medium" role="group" aria-label="Set copies for all">
                  <button
                    type="button"
                    onClick={() => setAll('one')}
                    aria-pressed={allOne}
                    className={`px-3 py-1.5 rounded-md transition-colors ${allOne ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    1 each
                  </button>
                  <button
                    type="button"
                    onClick={() => setAll('stock')}
                    aria-pressed={allStock && !allOne}
                    className={`px-3 py-1.5 rounded-md transition-colors ${allStock && !allOne ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Same as stock
                  </button>
                </div>
              </div>

              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {items.map((prod, index) => {
                  const active = index === previewIndex;
                  const skipped = copies[index] === 0;
                  return (
                    <li
                      key={prod.id || `${prod.productCode}-${index}`}
                      onClick={() => setPreviewIndex(index)}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        active ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-1 self-stretch rounded-full ${active ? 'bg-blue-500' : 'bg-transparent'}`}
                        aria-hidden="true"
                      />
                      <div className={`min-w-0 flex-1 ${skipped ? 'opacity-50' : ''}`}>
                        <p className="text-sm font-medium text-slate-900 truncate">{prod.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          <span className="font-mono">{prod.productCode}</span>
                          <span className="mx-1.5 text-slate-300">|</span>
                          {stock(prod)} in stock
                        </p>
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        <Stepper label={prod.name} value={copies[index]} onChange={n => setCopyAt(index, n)} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-slate-400 mt-2">Set a product to 0 to skip it.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-4 bg-white">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-slate-500">
              {sheets > 0 ? `Fits on ${sheets} A4 sheet${sheets > 1 ? 's' : ''}` : 'Nothing to print'}
            </span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {totalLabels} label{totalLabels === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-5 rounded-xl text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {isNewProduct ? 'Skip for now' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={totalLabels === 0 || !qrReady}
              className="flex-1 h-11 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
            >
              <Printer className="w-4 h-4" />
              {!qrReady
                ? 'Preparing labels…'
                : totalLabels === 0
                  ? 'Add copies to print'
                  : `Print ${totalLabels} label${totalLabels === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductLabel;
