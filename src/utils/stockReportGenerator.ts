import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { Product, ShopDetails } from '../types';
import logoImg from '../assets/logo.png';

export interface CategoryStockSummary {
  category: string;
  totalCostValue: number;
  totalRetailValue: number;
  totalProfit: number;
  productCount: number;
  quantity: number;
  lowStockCount: number;
  marginPercent: number;
  sharePercent: number;
}

export interface BrandStockSummary {
  brand: string;
  totalCostValue: number;
  totalRetailValue: number;
  totalProfit: number;
  productCount: number;
  quantity: number;
  lowStockCount: number;
  marginPercent: number;
  sharePercent: number;
}

export interface StockValuationTotals {
  totalCostValue: number;
  totalRetailValue: number;
  totalProfit: number;
  marginPercent: number;
  totalProducts: number;
  totalQuantity: number;
  lowStockProducts: number;
  averageUnitCost: number;
}

export interface StockReportParams {
  products: Product[];
  categoryValues: CategoryStockSummary[];
  brandValues: BrandStockSummary[];
  totals: StockValuationTotals;
  shopDetails?: ShopDetails | null;
  storeName: string;
  hubName?: string;
  filterCategory?: string | null;
  filterBrand?: string | null;
}

const formatCurrencyNumber = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(amount || 0));
};

const formatPdfCurrency = (amount: number): string => {
  return `Rs. ${formatCurrencyNumber(amount)}`;
};

const formatDate = (date?: Date | string | null): string => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatDateTime = (date: Date): string => {
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

// Android WebView bridge detection
const isAndroidWebView = () => typeof window !== 'undefined' && !!(window as any).AndroidInterface;

const triggerDownload = (doc: jsPDF, fileName: string) => {
  if (isAndroidWebView()) {
    try {
      const dataUrl = doc.output('datauristring');
      (window as any).AndroidInterface?.downloadPDF(dataUrl, fileName);
      return;
    } catch (e) {
      console.warn('Failed to invoke AndroidInterface.downloadPDF, falling back to doc.save:', e);
    }
  }
  doc.save(fileName);
};

export const exportStockExcelReport = (params: StockReportParams) => {
  const {
    products,
    categoryValues,
    brandValues,
    totals,
    storeName,
    hubName,
    filterCategory,
    filterBrand,
  } = params;

  if (products.length === 0) {
    alert('No stock products available to export.');
    return;
  }

  const workbook = XLSX.utils.book_new();
  const generatedAt = new Date();
  const scopeLabel = filterCategory
    ? `Category: ${filterCategory}`
    : filterBrand
    ? `Brand: ${filterBrand}`
    : 'Complete Store Inventory';

  // 1. Dashboard / Executive Summary Sheet
  const topCategory = categoryValues[0]?.category || 'N/A';
  const topBrand = brandValues[0]?.brand || 'N/A';

  const summaryRows: (string | number)[][] = [
    ['DIGITAL ZONE - INVENTORY VALUATION REPORT'],
    ['Store', storeName],
    ['Hub', hubName || 'Central Hub'],
    ['Report Scope', scopeLabel],
    ['Generated On', formatDateTime(generatedAt)],
    [],
    ['KEY PERFORMANCE METRICS', ''],
    ['Metric', 'Value'],
    ['Total Stock Cost Value (Investment)', totals.totalCostValue],
    ['Total Stock Retail Value (MRP)', totals.totalRetailValue],
    ['Projected Gross Profit', totals.totalProfit],
    ['Gross Margin %', `${totals.marginPercent.toFixed(2)}%`],
    ['Total In-Stock Units', totals.totalQuantity],
    ['Total Unique SKUs / Products', totals.totalProducts],
    ['Average Cost Per Unit', totals.averageUnitCost],
    ['Low Stock SKUs (<= 2 units)', totals.lowStockProducts],
    ['Top Category by Value', topCategory],
    ['Top Brand by Value', topBrand],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 28 }];
  ['B9', 'B10', 'B11', 'B15'].forEach((cell) => {
    if (summarySheet[cell]) summarySheet[cell].z = '"₹"#,##0';
  });
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Executive Summary');

  // 2. Category Summary Sheet
  const categoryRows = categoryValues.map((cat, idx) => ({
    '#': idx + 1,
    Category: cat.category,
    'Unique SKUs': cat.productCount,
    'Total Units': cat.quantity,
    'Cost Value': cat.totalCostValue,
    'Retail Value (MRP)': cat.totalRetailValue,
    'Potential Profit': cat.totalProfit,
    'Margin %': `${cat.marginPercent.toFixed(1)}%`,
    'Share %': `${cat.sharePercent.toFixed(1)}%`,
    'Low Stock Items': cat.lowStockCount,
  }));
  const categorySheet = XLSX.utils.json_to_sheet(categoryRows);
  categorySheet['!cols'] = [
    { wch: 6 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
  ];
  for (let r = 2; r <= categoryRows.length + 1; r++) {
    ['E', 'F', 'G'].forEach((col) => {
      if (categorySheet[`${col}${r}`]) categorySheet[`${col}${r}`].z = '"₹"#,##0';
    });
  }
  XLSX.utils.book_append_sheet(workbook, categorySheet, 'Category Valuation');

  // 3. Brand Summary Sheet
  const brandRows = brandValues.map((brand, idx) => ({
    '#': idx + 1,
    Brand: brand.brand,
    'Unique SKUs': brand.productCount,
    'Total Units': brand.quantity,
    'Cost Value': brand.totalCostValue,
    'Retail Value (MRP)': brand.totalRetailValue,
    'Potential Profit': brand.totalProfit,
    'Margin %': `${brand.marginPercent.toFixed(1)}%`,
    'Share %': `${brand.sharePercent.toFixed(1)}%`,
    'Low Stock Items': brand.lowStockCount,
  }));
  const brandSheet = XLSX.utils.json_to_sheet(brandRows);
  brandSheet['!cols'] = [
    { wch: 6 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
  ];
  for (let r = 2; r <= brandRows.length + 1; r++) {
    ['E', 'F', 'G'].forEach((col) => {
      if (brandSheet[`${col}${r}`]) brandSheet[`${col}${r}`].z = '"₹"#,##0';
    });
  }
  XLSX.utils.book_append_sheet(workbook, brandSheet, 'Brand Valuation');

  // 4. Detailed Products Inventory Sheet
  const productRows = products.map((product, idx) => {
    const costVal = (product.cost || 0) * (product.quantity || 0);
    const mrpVal = (product.mrp || 0) * (product.quantity || 0);
    const profit = mrpVal - costVal;
    const margin = mrpVal > 0 ? ((profit / mrpVal) * 100).toFixed(1) + '%' : '0.0%';
    const hsn = (product as any).hsnCode || product.hcsCode || '';

    return {
      '#': idx + 1,
      'Product Code': product.productCode || '',
      'Product Name': product.name || '',
      Model: product.model || '',
      Brand: product.brand || '',
      Category: product.category || '',
      Quantity: product.quantity || 0,
      'Cost Price': product.cost || 0,
      MRP: product.mrp || 0,
      'Total Cost Value': costVal,
      'Total Retail Value': mrpVal,
      'Potential Profit': profit,
      'Margin %': margin,
      'Stock Status': (product.quantity || 0) <= 2 ? 'LOW STOCK' : 'IN STOCK',
      Supplier: product.supplier || '',
      IMEI: product.imei || '',
      'HSN Code': hsn,
      'Date Added': formatDate(product.createdAt),
      'Last Updated': formatDate(product.updatedAt),
    };
  });

  const productSheet = XLSX.utils.json_to_sheet(productRows);
  productSheet['!cols'] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 32 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 22 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];
  for (let r = 2; r <= productRows.length + 1; r++) {
    ['H', 'I', 'J', 'K', 'L'].forEach((col) => {
      if (productSheet[`${col}${r}`]) productSheet[`${col}${r}`].z = '"₹"#,##0';
    });
  }
  XLSX.utils.book_append_sheet(workbook, productSheet, 'Itemized Inventory');

  workbook.Props = {
    Title: 'Digital Zone - Stock Valuation Report',
    Subject: 'Inventory Valuation and Stock Audit',
    Author: 'Digital Zone Management',
    CreatedDate: generatedAt,
  };

  const storeSlug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'store';
  const filterSlug = filterCategory
    ? `_cat_${filterCategory.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    : filterBrand
    ? `_brand_${filterBrand.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    : '';
  const dateStr = generatedAt.toISOString().split('T')[0];

  XLSX.writeFile(workbook, `stock_valuation_${storeSlug}${filterSlug}_${dateStr}.xlsx`);
};

export const exportStockPDFReport = (params: StockReportParams) => {
  const {
    products,
    categoryValues,
    totals,
    shopDetails,
    storeName,
    hubName,
    filterCategory,
    filterBrand,
  } = params;

  if (products.length === 0) {
    alert('No stock products available to generate PDF.');
    return;
  }

  // Use landscape A4 for rich tabular reporting
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const generatedAt = new Date();

  // Top header banner
  doc.setFillColor(15, 23, 42); // Slate 900
  doc.rect(0, 0, pageWidth, 26, 'F');

  // Accent line
  doc.setFillColor(37, 99, 235); // Blue 600
  doc.rect(0, 25, pageWidth, 1.5, 'F');

  // Logo attempt
  const logoH = 14;
  const logoW = Math.round(logoH * 2.314);
  try {
    doc.addImage(logoImg, 'PNG', margin, 5, logoW, logoH);
  } catch (_err) {
    // ignore
  }

  // Store & Report Title (Left block)
  const textLeft = margin + logoW + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(shopDetails?.shopName || storeName || 'DIGITAL ZONE', textLeft, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225); // Slate 300
  const subParts = [
    storeName ? `Store: ${storeName}` : '',
    hubName ? `Hub: ${hubName}` : '',
    shopDetails?.phone ? `Ph: ${shopDetails.phone}` : '',
    shopDetails?.gst ? `GST: ${shopDetails.gst}` : '',
  ].filter(Boolean);
  doc.text(subParts.join('  |  '), textLeft, 17);

  // Right block: Report Type & Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('INVENTORY VALUATION REPORT', pageWidth - margin, 11, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  const scopeText = filterCategory
    ? `Category: ${filterCategory}`
    : filterBrand
    ? `Brand: ${filterBrand}`
    : 'All Categories & Brands';
  doc.text(`${scopeText}  •  ${formatDateTime(generatedAt)}`, pageWidth - margin, 17, { align: 'right' });

  let y = 32;

  // ── KEY METRICS CARDS (5 boxes across landscape) ──
  const cardCount = 5;
  const gap = 3;
  const cardWidth = (contentWidth - gap * (cardCount - 1)) / cardCount;
  const cardHeight = 17;

  const kpis = [
    { label: 'STOCK COST VALUE', value: formatPdfCurrency(totals.totalCostValue), color: [22, 163, 74], sub: 'Capital Tied' },
    { label: 'RETAIL VALUE (MRP)', value: formatPdfCurrency(totals.totalRetailValue), color: [37, 99, 235], sub: 'Potential Sales' },
    { label: 'EST. GROSS PROFIT', value: formatPdfCurrency(totals.totalProfit), color: [147, 51, 234], sub: `${totals.marginPercent.toFixed(1)}% Margin` },
    { label: 'TOTAL UNITS', value: totals.totalQuantity.toLocaleString('en-IN'), color: [217, 119, 6], sub: `${totals.totalProducts} Unique SKUs` },
    { label: 'LOW STOCK ALERT', value: `${totals.lowStockProducts} SKUs`, color: totals.lowStockProducts > 0 ? [220, 38, 38] : [100, 116, 139], sub: 'Units <= 2' },
  ];

  kpis.forEach((kpi, idx) => {
    const x = margin + idx * (cardWidth + gap);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5, 'F');
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.rect(x, y, cardWidth, 1.2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 3, y + 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, x + 3, y + 10.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.sub, x + 3, y + 14.5);
  });

  y += cardHeight + 5;

  // ── CATEGORY VALUATION TABLE (Summary) ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Category Valuation Breakdown', margin, y);
  y += 2;

  const categoryHeaders = [
    '#',
    'Category',
    'SKUs',
    'Units',
    'Cost Value',
    'Retail Value (MRP)',
    'Est. Profit',
    'Margin %',
    'Share %',
    'Low Stock',
  ];

  const categoryRows = categoryValues.map((cat, i) => [
    (i + 1).toString(),
    cat.category,
    cat.productCount.toString(),
    cat.quantity.toLocaleString('en-IN'),
    formatPdfCurrency(cat.totalCostValue),
    formatPdfCurrency(cat.totalRetailValue),
    formatPdfCurrency(cat.totalProfit),
    `${cat.marginPercent.toFixed(1)}%`,
    `${cat.sharePercent.toFixed(1)}%`,
    cat.lowStockCount.toString(),
  ]);

  const categoryFooters = [
    '',
    'TOTAL',
    totals.totalProducts.toString(),
    totals.totalQuantity.toLocaleString('en-IN'),
    formatPdfCurrency(totals.totalCostValue),
    formatPdfCurrency(totals.totalRetailValue),
    formatPdfCurrency(totals.totalProfit),
    `${totals.marginPercent.toFixed(1)}%`,
    '100.0%',
    totals.lowStockProducts.toString(),
  ];

  autoTable(doc, {
    startY: y,
    head: [categoryHeaders],
    body: categoryRows,
    foot: [categoryFooters],
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 1.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 48, fontStyle: 'bold' },
      2: { cellWidth: 16, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 38, halign: 'right', textColor: [22, 163, 74], fontStyle: 'bold' },
      5: { cellWidth: 38, halign: 'right' },
      6: { cellWidth: 36, halign: 'right', textColor: [147, 51, 234] },
      7: { cellWidth: 24, halign: 'right' },
      8: { cellWidth: 24, halign: 'right' },
      9: { cellWidth: 25, halign: 'center' },
    },
    margin: { left: margin, right: margin },
  });

  // ── ITEMIZED STOCK INVENTORY TABLE ──
  doc.addPage('landscape');

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('ITEMIZED INVENTORY AUDIT & STOCK VALUE DETAILS', margin, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`${storeName || 'Digital Zone'} • ${scopeText}`, pageWidth - margin, 8, { align: 'right' });

  const productHeaders = [
    '#',
    'Code',
    'Product Name & Model',
    'Brand',
    'Category',
    'Qty',
    'Cost Price',
    'MRP',
    'Total Cost Value',
    'Total MRP Value',
    'Margin',
    'Status',
  ];

  const productBody = products.map((p, idx) => {
    const costVal = (p.cost || 0) * (p.quantity || 0);
    const mrpVal = (p.mrp || 0) * (p.quantity || 0);
    const profit = mrpVal - costVal;
    const marginPct = mrpVal > 0 ? ((profit / mrpVal) * 100).toFixed(0) + '%' : '0%';
    const displayName = p.model ? `${p.name} (${p.model})` : p.name;
    const isLow = (p.quantity || 0) <= 2;

    return [
      (idx + 1).toString(),
      p.productCode || '-',
      displayName,
      p.brand || '-',
      p.category || '-',
      p.quantity.toString(),
      formatPdfCurrency(p.cost || 0),
      formatPdfCurrency(p.mrp || 0),
      formatPdfCurrency(costVal),
      formatPdfCurrency(mrpVal),
      marginPct,
      isLow ? 'LOW' : 'OK',
    ];
  });

  autoTable(doc, {
    startY: 16,
    head: [productHeaders],
    body: productBody,
    theme: 'grid',
    styles: {
      fontSize: 6.8,
      cellPadding: 1.4,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 20, fontStyle: 'bold' },
      2: { cellWidth: 52 },
      3: { cellWidth: 24 },
      4: { cellWidth: 24 },
      5: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
      6: { cellWidth: 24, halign: 'right' },
      7: { cellWidth: 24, halign: 'right' },
      8: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: [22, 163, 74] },
      9: { cellWidth: 28, halign: 'right' },
      10: { cellWidth: 16, halign: 'right' },
      11: { cellWidth: 15, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.column.index === 11 && data.section === 'body') {
        if (data.cell.raw === 'LOW') {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
    },
    margin: { left: margin, right: margin, bottom: 12 },
  });

  const totalPages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 6, pageWidth - margin, pageHeight - 6);

    doc.text(
      `Digital Zone • Stock Valuation Report • Generated on ${formatDateTime(generatedAt)}`,
      margin,
      pageHeight - 2.5
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 2.5, { align: 'right' });
  }

  const storeSlug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'store';
  const filterSlug = filterCategory
    ? `_cat_${filterCategory.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    : filterBrand
    ? `_brand_${filterBrand.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    : '';
  const dateStr = generatedAt.toISOString().split('T')[0];

  triggerDownload(doc, `stock_valuation_${storeSlug}${filterSlug}_${dateStr}.pdf`);
};
