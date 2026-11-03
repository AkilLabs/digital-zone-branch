import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { BillingItem, ShopDetails, ServiceRequest, Quotation, QuotationItem } from '../types';
import logoImg from '../assets/logo.png';
import { isNonIMEIProductCode } from './productCode';

// Android WebView bridge typing and detection
declare global {
  interface Window {
    AndroidInterface?: {
      downloadPDF: (dataUrl: string, filename: string) => void;
      sharePDF?: (dataUrl: string, filename: string, title: string) => void;
    };
  }
}

const isAndroidWebView = () => typeof window !== 'undefined' && !!window.AndroidInterface;

// Helper function to convert number to words (Indian format)
const numberToWords = (num: number): string => {
  if (num === 0) return 'Zero Rupees Only';

  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertTwoDigits = (n: number): string => {
    if (n < 10) return units[n];
    if (n < 20) return teens[n - 10];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + units[n % 10] : '');
  };

  const convertThreeDigits = (n: number): string => {
    if (n < 100) return convertTwoDigits(n);
    return units[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convertTwoDigits(n % 100) : '');
  };

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let result = '';
  let remaining = rupees;

  if (remaining >= 10000000) {
    result += convertThreeDigits(Math.floor(remaining / 10000000)) + ' Crore ';
    remaining %= 10000000;
  }
  if (remaining >= 100000) {
    result += convertTwoDigits(Math.floor(remaining / 100000)) + ' Lakh ';
    remaining %= 100000;
  }
  if (remaining >= 1000) {
    result += convertTwoDigits(Math.floor(remaining / 1000)) + ' Thousand ';
    remaining %= 1000;
  }
  if (remaining >= 100) {
    result += convertThreeDigits(remaining);
  } else if (remaining > 0) {
    result += convertTwoDigits(remaining);
  }

  result += ' Rupees';

  if (paise > 0) {
    result += ' and ' + convertTwoDigits(paise) + ' Paise';
  }

  return result.trim() + ' Only';
};


import QRCode from 'qrcode';

export const generateInvoice = async (item: BillingItem, shopDetails: ShopDetails, invoiceNumber?: string, returnBlob: boolean = false) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // ── Background Watermark ──────────────────────────────────────────────────
  try {
    const wmSize = 80;
    const wmX = (pageWidth - wmSize) / 2;
    const wmY = (pageHeight - wmSize) / 2;
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
    doc.addImage(logoImg, 'PNG', wmX, wmY, wmSize, wmSize);
    doc.restoreGraphicsState();
  } catch (_e) { /* ignore watermark error */ }

  let yPos = 10;

  // ── Page-level constants ──────────────────────────────────────────────────
  const marginLeft = 15;
  const marginRight = 15;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const centerX = pageWidth / 2;

  // ── Resolve invoice number early ──────────────────────────────────────────
  const invoiceNo = invoiceNumber || (item as any).transactionId || (item as any).id || String(Date.now());

  // ── Logo ──────────────────────────────────────────────────────────────────
  const logoW = 18;
  const logoH = 18;
  const logoX = marginLeft;
  const logoY = yPos + 1;
  try {
    doc.addImage(logoImg, 'PNG', logoX, logoY, logoW, logoH);
  } catch (_e) { /* no logo */ }

  // ── Shop details (right of logo, left-aligned) ───────────────────────────
  const textX = logoX + logoW + 4;
  const maxTextW = pageWidth - marginRight - textX;

  // Shop name
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  let hY = yPos + 6;
  doc.text(shopDetails.shopName || 'SHOP NAME', textX, hY);

  // Address (auto-wraps if too long)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  hY += 5;
  if (shopDetails.address) {
    const addrLines: string[] = doc.splitTextToSize(shopDetails.address, maxTextW);
    doc.text(addrLines, textX, hY);
    hY += addrLines.length * 3.5;
  }

  // Phone | Email on one line
  const contactLine = [
    shopDetails.phone ? `Ph: ${shopDetails.phone}` : '',
    shopDetails.email ? `Email: ${shopDetails.email}` : '',
  ].filter(Boolean).join('  |  ');
  if (contactLine) {
    doc.text(contactLine, textX, hY);
    hY += 3.5;
  }

  // GSTIN on its own line (bold)
  if (shopDetails.gst) {
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${shopDetails.gst}`, textX, hY);
    doc.setFont('helvetica', 'normal');
    hY += 3.5;
  }

  // Advance yPos below whichever is taller — logo or text block
  yPos = Math.max(hY + 2, logoY + logoH + 2);

  // ── Divider ───────────────────────────────────────────────────────────────
  doc.setLineWidth(0.5);
  doc.setDrawColor(0, 0, 0);
  doc.line(marginLeft, yPos, pageWidth - marginRight, yPos);

  // ── TAX INVOICE banner ────────────────────────────────────────────────────
  yPos += 6;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('TAX INVOICE', centerX, yPos, { align: 'center' });
  yPos += 4;
  doc.setLineWidth(0.3);
  doc.line(marginLeft, yPos, pageWidth - marginRight, yPos);

  // ── Resolve dates & invoice number ────────────────────────────────────────
  const createdDate = item.createdAt
    ? (typeof (item.createdAt as any).toDate === 'function'
      ? (item.createdAt as any).toDate()
      : new Date(item.createdAt))
    : new Date();

  // If createdDate was saved without time (00:00:00 midnight), fallback to updatedAt or current real time
  let timeSource = createdDate;
  if (timeSource.getHours() === 0 && timeSource.getMinutes() === 0 && timeSource.getSeconds() === 0) {
    if ((item as any).updatedAt) {
      const uDate = typeof (item as any).updatedAt.toDate === 'function'
        ? (item as any).updatedAt.toDate()
        : new Date((item as any).updatedAt);
      if (!Number.isNaN(uDate.getTime()) && (uDate.getHours() !== 0 || uDate.getMinutes() !== 0)) {
        timeSource = uDate;
      } else {
        timeSource = new Date();
      }
    } else {
      timeSource = new Date();
    }
  }

  const invoiceDate = createdDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const invoiceTime = (item as any).invoiceTime || (item as any).time || timeSource.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const salesPerson = (item as any).salesPersonName || (item as any).createdByName || (item as any).createdBy || 'Staff';

  // ── Two-column section: Bill To | Invoice Info ────────────────────────────
  yPos += 2;
  const sectionTop = yPos;
  const colMid = marginLeft + contentWidth / 2;
  const sectionH = 28;
  const cellPadX = 4;
  const cellPadTop = 6;
  const lineH = 5;

  // LEFT: Bill To
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO:', marginLeft + cellPadX, sectionTop + cellPadTop);
  doc.setFont('helvetica', 'normal');
  let currentY = sectionTop + cellPadTop + lineH;
  doc.text(item.customerName || 'Walk-In Customer', marginLeft + cellPadX, currentY);
  if (item.customerPhone && item.customerPhone !== 'N/A') {
    currentY += lineH;
    doc.text(`Phone: ${item.customerPhone}`, marginLeft + cellPadX, currentY);
  }
  if ((item as any).customerAddress) {
    currentY += lineH;
    const addr = (item as any).customerAddress;
    const truncatedAddr = addr.length > 45 ? addr.substring(0, 42) + '...' : addr;
    doc.text(`Address: ${truncatedAddr}`, marginLeft + cellPadX, currentY);
  }
  if ((item as any).customerGstNo) {
    currentY += lineH;
    doc.text(`GST No: ${(item as any).customerGstNo}`, marginLeft + cellPadX, currentY);
  }

  // RIGHT: Invoice Info
  const rX = colMid + cellPadX;
  const vX = colMid + cellPadX + 28;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Invoice No  :', rX, sectionTop + cellPadTop);
  doc.text('Date        :', rX, sectionTop + cellPadTop + lineH);
  doc.text('Time        :', rX, sectionTop + cellPadTop + lineH * 2);
  doc.text('Sales Person:', rX, sectionTop + cellPadTop + lineH * 3);
  doc.setFont('helvetica', 'normal');
  doc.text(invoiceNo, vX, sectionTop + cellPadTop);
  doc.text(invoiceDate, vX, sectionTop + cellPadTop + lineH);
  doc.text(invoiceTime, vX, sectionTop + cellPadTop + lineH * 2);
  doc.text(salesPerson, vX, sectionTop + cellPadTop + lineH * 3);

  yPos = sectionTop + sectionH;

  // Border around bill-to / invoice-info section
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.rect(marginLeft, sectionTop, contentWidth, sectionH);
  doc.setLineWidth(0.2);
  doc.line(colMid, sectionTop, colMid, sectionTop + sectionH);

  // ── Cart items & financials ────────────────────────────────────────────────
  const cartItems: any[] = (item as any).items || [item];
  const itemsTotal = cartItems.reduce((s: number, i: any) => s + (Number(i.sellingPrice || i.price || 0) * Number(i.quantity || 1)), 0);
  const discountAmount = Number((item as any).discount || (item as any).discountAmount || 0);

  const resolveGstRate = (i: any) => {
    const candidates = [i?.taxPercent, i?.gstRate, (item as any)?.taxPercent, (item as any)?.gstRate];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return gstRate > 0 ? gstRate : 0;
  };

  // Compute GST per item (respecting item.taxPercent / gstEnabled) to avoid relying on possibly stale top-level totals
  const gstRate = item.gstRate || 0;
  const gstEnabled = gstRate > 0;
  let computedTotalGst = 0;
  cartItems.forEach(i => {
    const itemTaxPercent = resolveGstRate(i);
    const itemGstEnabled = i.gstEnabled !== undefined ? i.gstEnabled : gstEnabled;
    if (itemTaxPercent > 0 && itemGstEnabled) {
      const rate = Number(i.sellingPrice || i.price || 0);
      const qty = Number(i.quantity || 1);
      const itemSubtotal = rate * qty;
      const subTotalWithoutDiscount = itemsTotal;
      const itemDiscount = subTotalWithoutDiscount > 0 ? (itemSubtotal / subTotalWithoutDiscount) * discountAmount : 0;
      const itemTotalAfterDiscount = itemSubtotal - itemDiscount;
      const itemGst = Math.round(itemTotalAfterDiscount - (itemTotalAfterDiscount / (1 + itemTaxPercent / 100)));
      computedTotalGst += itemGst;
    }
  });

  // Determine round off and grand total
  const netBeforeRoundOff = itemsTotal - discountAmount;
  let roundOffAmount = 0;
  if ((item as any).roundOff !== undefined && (item as any).roundOff !== null) {
    roundOffAmount = Number((item as any).roundOff);
  } else if ((item as any).grandTotal !== undefined && (item as any).grandTotal !== null) {
    const diff = Number((Number((item as any).grandTotal) - netBeforeRoundOff).toFixed(2));
    if (Math.abs(diff) < 10) {
      roundOffAmount = diff;
    }
  }

  let finalGrandTotal: number;
  if ((item as any).grandTotal !== undefined && (item as any).grandTotal !== null) {
    finalGrandTotal = Number((item as any).grandTotal);
  } else if (cartItems && cartItems.length > 0) {
    finalGrandTotal = Number((netBeforeRoundOff + roundOffAmount).toFixed(2));
  } else if ((item as any).totalWithGst !== undefined) {
    finalGrandTotal = Number((item as any).totalWithGst);
  } else if ((item as any).subtotal !== undefined) {
    finalGrandTotal = Number((item as any).subtotal);
  } else {
    finalGrandTotal = Number((netBeforeRoundOff + roundOffAmount).toFixed(2));
  }

  const totalGstAmt = computedTotalGst > 0
    ? computedTotalGst
    : ((item as any).gstAmount !== undefined && (item as any).gstAmount !== null ? Number((item as any).gstAmount) : 0);
  const cgstAmt = Math.round(totalGstAmt / 2);
  const sgstAmt = totalGstAmt - cgstAmt;
  const taxableValue = Math.max(0, netBeforeRoundOff - Number(totalGstAmt));

  const formatRs = (amt: number) => `Rs.${Number(amt).toFixed(2)}`;

  const isNonImeiItem = (i: any): boolean => {
    // Explicitly non-IMEI purchase or product
    if (i.isIMEI === false || i.isIMEIPurchase === false || i.isNonIMEI === true) {
      return true;
    }
    const code = String(i.code || i.productCode || '').trim();
    if (code && (isNonIMEIProductCode(code) || (code.length === 8 && code.startsWith('0')))) {
      return true;
    }
    const num = parseInt(code, 10);
    if (!Number.isNaN(num) && num > 0 && num < 10000001) {
      return true;
    }
    return false;
  };

  const getImeiValue = (i: any): string => {
    // Non-IMEI products must never display an IMEI
    if (isNonImeiItem(i)) {
      return '';
    }

    const rawImei = String(i.imei || '').trim();
    if (!rawImei) return '';

    const lower = rawImei.toLowerCase();
    if (
      lower === '-' ||
      lower === '0' ||
      lower === 'n/a' ||
      lower === 'na' ||
      lower === 'none' ||
      lower === 'null' ||
      lower === 'undefined' ||
      lower === 'no imei' ||
      lower === 'non-imei' ||
      lower === 'non imei' ||
      lower === 'not applicable'
    ) {
      return '';
    }

    const code = String(i.code || i.productCode || '').trim();
    if (code && rawImei === code) {
      return '';
    }

    // Reject non-IMEI 8-digit product code formats
    if (isNonIMEIProductCode(rawImei) || (rawImei.length === 8 && rawImei.startsWith('0')) || /^\d{8}$/.test(rawImei)) {
      return '';
    }

    return rawImei;
  };

  const getHsnValue = (i: any) => {
    if (i.hsnCode && String(i.hsnCode).trim() !== '') return String(i.hsnCode).trim();
    if (i.hcsCode && String(i.hcsCode).trim() !== '') return String(i.hcsCode).trim();
    return '';
  };

  const hasExtendedInfo = cartItems.some(
    (i: any) =>
      getImeiValue(i) !== '' ||
      getHsnValue(i) !== '' ||
      gstEnabled ||
      Boolean(i.gstEnabled) ||
      resolveGstRate(i) > 0
  );

  const tableHead = hasExtendedInfo
    ? [['S.No', 'Description of Goods', 'HSN', 'Qty', 'Unit', 'Rate', 'GST%', 'Amount']]
    : [['S.No', 'Description of Goods', 'Qty', 'Unit', 'Rate', 'GST%', 'Amount']];

  const tableData = cartItems.map((i: any, idx: number) => {
    const itemTaxPercent = resolveGstRate(i);
    const itemGstRate = (i.gstEnabled !== undefined ? i.gstEnabled : gstEnabled) ? itemTaxPercent : 0;
    const qty = Number(i.quantity || 1);
    const grossRate = Number(i.sellingPrice || i.price || 0);
    const amt = grossRate * qty;
    const displayRate = itemGstRate > 0 ? grossRate / (1 + itemGstRate / 100) : grossRate;

    let desc = i.title || i.name || 'Item';
    const imeiVal = getImeiValue(i);
    if (imeiVal) {
      desc += `\nIMEI: ${imeiVal}`;
    }

    if (hasExtendedInfo) {
      return [(idx + 1).toString(), desc, getHsnValue(i) || '-', qty.toString(), 'Nos', formatRs(displayRate), `${itemGstRate}%`, formatRs(amt)];
    } else {
      return [(idx + 1).toString(), desc, qty.toString(), 'Nos', formatRs(displayRate), `${itemGstRate}%`, formatRs(amt)];
    }
  });

  const colStyles: Record<number, any> = hasExtendedInfo
    ? {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 70, halign: 'left' },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 10, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 12, halign: 'center' },
      7: { cellWidth: 29, halign: 'right' },
    }
    : {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 85, halign: 'left' },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 29, halign: 'right' },
    };

  autoTable(doc, {
    startY: yPos + 5,
    head: tableHead,
    body: tableData,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, lineColor: [80, 80, 80], lineWidth: 0.1 },
    headStyles: { fillColor: [240, 242, 245], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineWidth: 0.1, fontSize: 7.5 },
    bodyStyles: { textColor: [20, 20, 20], valign: 'middle' },
    columnStyles: colStyles,
    margin: { left: 15, right: 15 },
  });

  const tableEndY: number = (doc as any).lastAutoTable?.finalY || yPos + 35;

  // ── Pre-calculate Summary & Tax Breakdown sizes to pin to bottom ───────────
  const rowH = 6;
  interface SRow { label: string; value: string; bold: boolean; }
  const summaryRows: SRow[] = [];
  summaryRows.push({ label: 'Sub Total', value: formatRs(itemsTotal), bold: false });
  if (discountAmount > 0) summaryRows.push({ label: 'Discount', value: `- ${formatRs(discountAmount)}`, bold: false });
  if (gstEnabled) {
    summaryRows.push({ label: 'Taxable Amount', value: formatRs(taxableValue), bold: false });
    summaryRows.push({ label: `CGST @ ${gstRate / 2}%`, value: formatRs(cgstAmt), bold: false });
    summaryRows.push({ label: `SGST @ ${gstRate / 2}%`, value: formatRs(sgstAmt), bold: false });
    summaryRows.push({ label: `Total Tax (${gstRate}%)`, value: formatRs(totalGstAmt), bold: false });
  }
  if (roundOffAmount !== 0) {
    const roundSign = roundOffAmount > 0 ? '+ ' : '- ';
    summaryRows.push({
      label: 'Round Off',
      value: `${roundSign}${formatRs(Math.abs(roundOffAmount))}`,
      bold: false,
    });
  }
  summaryRows.push({ label: 'GRAND TOTAL', value: formatRs(finalGrandTotal), bold: true });

  const summaryBoxH = summaryRows.length * rowH + 4;

  let taxBody: any[][] = [];
  if (gstEnabled) {
    const taxGroups: { [key: string]: { taxableValue: number, cgst: number, sgst: number, totalTax: number, hsn: string, rate: number } } = {};
    cartItems.forEach(i => {
      const itemTaxPercent = resolveGstRate(i);
      const itemGstEnabled = i.gstEnabled !== undefined ? i.gstEnabled : gstEnabled;
      if (itemTaxPercent > 0 && itemGstEnabled) {
        const rate = i.sellingPrice || i.price || 0;
        const qty = i.quantity || 1;
        const itemSubtotal = rate * qty;
        const subTotalWithoutDiscount = itemsTotal;
        const itemDiscount = subTotalWithoutDiscount > 0 ? (itemSubtotal / subTotalWithoutDiscount) * discountAmount : 0;
        const itemTotalAfterDiscount = itemSubtotal - itemDiscount;
        const itemGst = Math.round(itemTotalAfterDiscount - (itemTotalAfterDiscount / (1 + itemTaxPercent / 100)));
        const itemTaxable = itemTotalAfterDiscount - itemGst;
        const hsn = getHsnValue(i) || '8517';

        const key = `${hsn}-${itemTaxPercent}`;
        if (!taxGroups[key]) {
          taxGroups[key] = { taxableValue: 0, cgst: 0, sgst: 0, totalTax: 0, hsn, rate: itemTaxPercent };
        }
        taxGroups[key].taxableValue += itemTaxable;
        taxGroups[key].totalTax += itemGst;
      }
    });

    taxBody = Object.values(taxGroups).map(group => {
      const cgst = Math.round(group.totalTax / 2);
      const sgst = group.totalTax - cgst;
      return [
        group.hsn,
        formatRs(group.taxableValue),
        `${group.rate / 2}%`,
        formatRs(cgst),
        `${group.rate / 2}%`,
        formatRs(sgst),
        formatRs(group.totalTax)
      ];
    });

    if (taxBody.length === 0) {
      taxBody.push(['8517', formatRs(taxableValue), `${gstRate / 2}%`, formatRs(cgstAmt), `${gstRate / 2}%`, formatRs(sgstAmt), formatRs(totalGstAmt)]);
    }
  }

  // Calculate required height for bottom sections to pin them to the bottom
  const estGstHeight = gstEnabled ? (3 + 5 + 7 + taxBody.length * 7 + 8) : 0;
  const footerHeight = 52;
  const financeHeight = item.paymentMode === 'finance' ? 46 : 0;
  const totalBottomHeight = summaryBoxH + 4 + estGstHeight + footerHeight + financeHeight;

  // Start drawing the summary (and the rest of the bottom components) either exactly below the table, 
  // OR at the bottom of the page if the table is short.
  const summaryStartY = Math.max(tableEndY + 5, pageHeight - totalBottomHeight);

  // ── Amount Summary Box (right side) ────────────────────────────────────────
  const boxW = 80;
  const boxX = pageWidth - 15 - boxW;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(boxX, summaryStartY, boxW, summaryBoxH);

  let sRowY = summaryStartY + rowH;
  for (let ri = 0; ri < summaryRows.length; ri++) {
    const { label, value, bold } = summaryRows[ri];
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9 : 8);
    doc.text(label + ':', boxX + 2, sRowY);
    doc.text(value, boxX + boxW - 2, sRowY, { align: 'right' });
    sRowY += rowH;
    if (ri < summaryRows.length - 1) {
      doc.setLineWidth(0.1);
      doc.line(boxX, sRowY - rowH + 2, boxX + boxW, sRowY - rowH + 2);
    }
  }

  // ── Payment & Amount in Words (left of summary) ────────────────────────────
  let payY = summaryStartY + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  doc.text('Payment Mode:', 15, payY);
  doc.setFont('helvetica', 'normal');
  doc.text((item.paymentMode || 'CASH').toUpperCase(), 48, payY);
  payY += 7;

  if (item.paymentMode === 'split' && item.paymentSplit) {
    const split = item.paymentSplit;
    doc.setFontSize(8);
    if ((split.cash || 0) > 0) { doc.text(`  Cash : ${formatRs(split.cash!)}`, 15, payY); payY += 5; }
    if ((split.upi || 0) > 0) { doc.text(`  UPI  : ${formatRs(split.upi!)}`, 15, payY); payY += 5; }
    if ((split.card || 0) > 0) { doc.text(`  Card : ${formatRs(split.card!)}`, 15, payY); payY += 5; }
  }

  if (item.paymentMode === 'finance') {
    const financeProvider = (item as any).financeProvider || 'N/A';
    const tenureMonths = Number((item as any).financeTenureMonths || 0);
    const downPayment = Number((item as any).financeDownPayment || 0);
    const financedAmount = Number((item as any).financeAmount || Math.max(0, finalGrandTotal - downPayment));
    const monthlyEmiValue = Number((item as any).monthlyEmi || 0);
    const processingFee = Number((item as any).processingFee || 0);

    const financeBoxX = 15;
    const financeBoxW = boxX - financeBoxX - 4;
    const financeRows = [
      ['Provider', financeProvider],
      ['Tenure', `${tenureMonths} months`],
      ['Down Payment', formatRs(downPayment)],
      ['Financed Amount', formatRs(financedAmount)],
      ['Monthly EMI', formatRs(monthlyEmiValue)],
      ['Processing Fee', formatRs(processingFee)],
    ];
    const financeRowH = 5.2;
    const financeBoxH = financeRows.length * financeRowH + 8;

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(financeBoxX, payY - 3, financeBoxW, financeBoxH, 2, 2);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text('Finance Details', financeBoxX + 3, payY + 1);

    doc.setTextColor(0, 0, 0);
    const financeLabelX = financeBoxX + 3;
    const financeValueX = financeBoxX + 43;
    let financeRowY = payY + 7;
    doc.setFontSize(8);
    financeRows.forEach(([label, value], index) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, financeLabelX, financeRowY);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(String(value), financeBoxW - 34);
      doc.text(lines, financeValueX, financeRowY);
      if (index < financeRows.length - 1) {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.1);
        doc.line(financeBoxX + 2, financeRowY + 2.1, financeBoxX + financeBoxW - 2, financeRowY + 2.1);
      }
      financeRowY += Math.max(lines.length * financeRowH, financeRowH);
    });

    payY += financeBoxH + 3;
  }

  const amountInWords = numberToWords(finalGrandTotal);
  payY += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Amount in Words:', 15, payY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const wordLines = doc.splitTextToSize(amountInWords, boxX - 17);
  doc.text(wordLines, 15, payY + 5);
  payY += 5 + (wordLines.length * 4.2) + 2;

  const afterSummaryY = Math.max(summaryStartY + summaryBoxH + 4, payY + 2);

  // ── GST Breakdown Table ────────────────────────────────────────────────────
  let afterTaxBreakY = afterSummaryY;
  if (gstEnabled) {
    const taxLabelY = afterSummaryY + 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('GST Tax Breakdown:', 15, taxLabelY);

    autoTable(doc, {
      startY: taxLabelY + 2,
      head: [['HSN/SAC', 'Taxable Value', 'CGST Rate', 'CGST Amt', 'SGST Rate', 'SGST Amt', 'Total Tax']],
      body: taxBody,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2, lineColor: [80, 80, 80], lineWidth: 0.1 },
      headStyles: { fillColor: [240, 242, 245], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineWidth: 0.1 },
      bodyStyles: { textColor: [20, 20, 20], halign: 'center', valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 18 }, 1: { cellWidth: 33, halign: 'right' },
        2: { cellWidth: 18 }, 3: { cellWidth: 26, halign: 'right' },
        4: { cellWidth: 18 }, 5: { cellWidth: 26, halign: 'right' },
        6: { cellWidth: 41, halign: 'right' },
      },
      margin: { left: 15, right: 15 },
    });

    afterTaxBreakY = (doc as any).lastAutoTable?.finalY || taxLabelY + 20;
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerTop = Math.max(afterTaxBreakY + 5, pageHeight - 52);

  doc.setLineWidth(0.4);
  doc.setDrawColor(0, 0, 0);
  doc.line(15, footerTop, pageWidth - 15, footerTop);

  // Terms & Conditions (left ~60%)
  let tY = footerTop + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Terms & Conditions:', 15, tY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  tY += 5;
  doc.text('1. Goods once sold will not be taken back or exchanged.', 15, tY); tY += 4;
  doc.text('2. Warranty as per manufacturer terms and conditions.', 15, tY); tY += 4;
  doc.text('3. All disputes are subject to local jurisdiction only.', 15, tY); tY += 4;
  doc.text('4. This is a computer generated invoice. E. & O.E.', 15, tY);

  // Vertical separator
  const footerMid = pageWidth - 68;
  doc.setLineWidth(0.2);
  doc.line(footerMid, footerTop, footerMid, footerTop + 38);

  // Authorized Signature (right side)
  const authX = pageWidth - 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('For ' + (shopDetails.shopName || 'Shop'), authX, footerTop + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setLineWidth(0.3);
  doc.line(footerMid + 2, footerTop + 30, authX, footerTop + 30);
  doc.setFontSize(7.5);
  doc.text('Authorized Signature', authX, footerTop + 35, { align: 'right' });

  // Bottom line & thank you
  doc.setLineWidth(0.5);
  doc.line(15, pageHeight - 12, pageWidth - 15, pageHeight - 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(40, 40, 40);
  doc.text('Thank you for your purchase! Visit Again.', pageWidth / 2, pageHeight - 6, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  // ── Save / Return ──────────────────────────────────────────────────────────
  const fileName = `invoice-${invoiceNo}-${new Date().toISOString().split('T')[0]}.pdf`;

  if (returnBlob) {
    return {
      fileName,
      pdfData: doc.output('datauristring'),
      pdfBlob: doc.output('blob'),
    };
  }

  if (isAndroidWebView()) {
    try {
      const dataUrl = doc.output('datauristring');
      window.AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (_e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};
export const generateInvoiceForWhatsApp = async (item: BillingItem, shopDetails: ShopDetails, invoiceNumber?: string) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let yPos = 15;

  // ── Resolve invoice number early ──────────────────────────────────────────
  const invoiceNo = invoiceNumber || (item as any).transactionId || (item as any).id || String(Date.now());

  // Add Logo (Left aligned)
  try {
    const logoSize = 20;
    doc.addImage(logoImg, 'PNG', 15, yPos, logoSize, logoSize);
  } catch (error) {
    console.log('Logo not available');
  }

  // Shop Name (Large and Bold) - Centered
  yPos += 10;
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(shopDetails.shopName || 'SHOP NAME', pageWidth / 2, yPos, { align: 'center' });

  // Shop Details - Centered
  yPos += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(shopDetails.address || 'Shop Address', pageWidth / 2, yPos, { align: 'center' });

  yPos += 4;
  doc.text(`Phone: ${shopDetails.phone || 'N/A'} | Email: ${shopDetails.email || 'N/A'}`, pageWidth / 2, yPos, { align: 'center' });

  if (shopDetails.gst) {
    yPos += 4;
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${shopDetails.gst}`, pageWidth / 2, yPos, { align: 'center' });
  }

  // Horizontal line
  yPos += 6;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(15, yPos, pageWidth - 15, yPos);

  // TAX INVOICE Title - Centered
  yPos += 8;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('TAX INVOICE', pageWidth / 2, yPos, { align: 'center' });

  // Invoice Details
  yPos += 8;
  const createdDate = item.createdAt
    ? (typeof (item.createdAt as any).toDate === 'function'
      ? (item.createdAt as any).toDate()
      : new Date(item.createdAt))
    : new Date();

  // If createdDate was saved without time (00:00:00 midnight), fallback to updatedAt or current real time
  let timeSource = createdDate;
  if (timeSource.getHours() === 0 && timeSource.getMinutes() === 0 && timeSource.getSeconds() === 0) {
    if ((item as any).updatedAt) {
      const uDate = typeof (item as any).updatedAt.toDate === 'function'
        ? (item as any).updatedAt.toDate()
        : new Date((item as any).updatedAt);
      if (!Number.isNaN(uDate.getTime()) && (uDate.getHours() !== 0 || uDate.getMinutes() !== 0)) {
        timeSource = uDate;
      } else {
        timeSource = new Date();
      }
    } else {
      timeSource = new Date();
    }
  }

  const invoiceDate = createdDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const invoiceTime = (item as any).invoiceTime || (item as any).time || timeSource.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  doc.setFontSize(9);

  // Left: Invoice No
  doc.setFont('helvetica', 'bold');
  doc.text('Invoice No:', 15, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(invoiceNo, 40, yPos);

  // Right: Date
  doc.setFont('helvetica', 'bold');
  const dateLabel = 'Date:';
  const dateLabelWidth = doc.getTextWidth(dateLabel);
  doc.text(dateLabel, pageWidth - 15 - doc.getTextWidth(invoiceDate) - dateLabelWidth - 2, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(invoiceDate, pageWidth - 15, yPos, { align: 'right' });

  // Right: Time
  yPos += 4;
  doc.setFont('helvetica', 'bold');
  const timeLabel = 'Time:';
  const timeLabelWidth = doc.getTextWidth(timeLabel);
  doc.text(timeLabel, pageWidth - 15 - doc.getTextWidth(invoiceTime) - timeLabelWidth - 2, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(invoiceTime, pageWidth - 15, yPos, { align: 'right' });

  // Horizontal line
  yPos += 6;
  doc.setLineWidth(0.3);
  doc.line(15, yPos, pageWidth - 15, yPos);

  // Bill To
  yPos += 7;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Bill To:', 15, yPos);
  yPos += 4;
  doc.setFont('helvetica', 'normal');
  doc.text(item.customerName || 'Walk-in Customer', 15, yPos);
  if (item.customerPhone) {
    yPos += 4;
    doc.text(`Phone: ${item.customerPhone}`, 15, yPos);
  }
  if ((item as any).customerAddress) {
    yPos += 4;
    doc.text(`Address: ${(item as any).customerAddress}`, 15, yPos);
  }
  if ((item as any).customerGstNo) {
    yPos += 4;
    doc.text(`GST No: ${(item as any).customerGstNo}`, 15, yPos);
  }

  // Items Table
  yPos += 8;

  const cartItems: any[] = (item as any).items || [item];
  const itemsTotal = cartItems.reduce((s: number, i: any) => s + (Number(i.sellingPrice || i.price || 0) * Number(i.quantity || 1)), 0);
  const discountAmount = Number((item as any).discount || (item as any).discountAmount || 0);

  const gstRate = item.gstRate || 0;
  const gstEnabled = gstRate > 0;
  let computedTotalGst = 0;
  cartItems.forEach(i => {
    const itemTaxPercent = i.taxPercent !== undefined && i.taxPercent !== null ? i.taxPercent : gstRate;
    const itemGstEnabled = i.gstEnabled !== undefined ? i.gstEnabled : gstEnabled;
    if (itemTaxPercent > 0 && itemGstEnabled) {
      const rate = Number(i.sellingPrice || i.price || 0);
      const qty = Number(i.quantity || 1);
      const itemSubtotal = rate * qty;
      const subTotalWithoutDiscount = itemsTotal;
      const itemDiscount = subTotalWithoutDiscount > 0 ? (itemSubtotal / subTotalWithoutDiscount) * discountAmount : 0;
      const itemTotalAfterDiscount = itemSubtotal - itemDiscount;
      const itemGst = Math.round(itemTotalAfterDiscount - (itemTotalAfterDiscount / (1 + itemTaxPercent / 100)));
      computedTotalGst += itemGst;
    }
  });

  // Determine round off and grand total
  const netBeforeRoundOff = itemsTotal - discountAmount;
  let roundOffAmount = 0;
  if ((item as any).roundOff !== undefined && (item as any).roundOff !== null) {
    roundOffAmount = Number((item as any).roundOff);
  } else if ((item as any).grandTotal !== undefined && (item as any).grandTotal !== null) {
    const diff = Number((Number((item as any).grandTotal) - netBeforeRoundOff).toFixed(2));
    if (Math.abs(diff) < 10) {
      roundOffAmount = diff;
    }
  }

  let finalGrandTotal: number;
  if ((item as any).grandTotal !== undefined && (item as any).grandTotal !== null) {
    finalGrandTotal = Number((item as any).grandTotal);
  } else if (cartItems && cartItems.length > 0) {
    finalGrandTotal = Number((netBeforeRoundOff + roundOffAmount).toFixed(2));
  } else if ((item as any).totalWithGst !== undefined) {
    finalGrandTotal = Number((item as any).totalWithGst);
  } else if ((item as any).subtotal !== undefined) {
    finalGrandTotal = Number((item as any).subtotal);
  } else {
    finalGrandTotal = Number((netBeforeRoundOff + roundOffAmount).toFixed(2));
  }

  const totalGstAmt = (item as any).gstAmount !== undefined && (item as any).gstAmount !== null
    ? Number((item as any).gstAmount)
    : computedTotalGst;

  // Format amounts with Rs.
  const formatRs = (amt: number) => `Rs. ${Number(amt).toFixed(2)}`;

  // Table data (support multiple items)
  const tableData = cartItems.map((i: any, idx: number) => {
    const qty = Number(i.quantity || 1);
    const grossRate = Number(i.sellingPrice || i.price || 0);
    const itemTaxPercent = i.taxPercent !== undefined && i.taxPercent !== null ? i.taxPercent : gstRate;
    const itemGstRate = (i.gstEnabled !== undefined ? i.gstEnabled : gstEnabled) ? itemTaxPercent : 0;
    const rowAmt = grossRate * qty;
    const displayRate = itemGstRate > 0 ? grossRate / (1 + itemGstRate / 100) : grossRate;
    return [
      (idx + 1).toString(),
      i.title || i.name || 'Item',
      qty.toString(),
      formatRs(displayRate),
      formatRs(rowAmt)
    ];
  });

  autoTable(doc, {
    startY: yPos,
    head: [['S.No', 'Description', 'Qty', 'Rate', 'Amount']],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center',
      lineWidth: 0.3,
    },
    bodyStyles: {
      textColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 15, halign: 'center' },
      1: { cellWidth: 90, halign: 'left' },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 35, halign: 'right' }
    },
    margin: { left: 15, right: 15 },
  });

  // Get final Y position after table
  const finalY = (doc as any).lastAutoTable.finalY || yPos + 30;

  // Totals Box - Right Side
  const boxX = pageWidth - 80;
  const boxW = 65;
  let boxY = finalY + 5;

  const hasGST = item.gstRate && item.gstRate > 0;
  interface WRow { label: string; value: string; bold: boolean; }
  const wRows: WRow[] = [];
  if (hasGST) {
    const beforeGST = Math.max(0, netBeforeRoundOff - totalGstAmt);
    wRows.push({ label: 'Amount (Before GST):', value: formatRs(beforeGST), bold: false });
    wRows.push({ label: `GST @ ${item.gstRate}%:`, value: formatRs(totalGstAmt), bold: false });
  } else if (discountAmount > 0) {
    wRows.push({ label: 'Sub Total:', value: formatRs(itemsTotal), bold: false });
    wRows.push({ label: 'Discount:', value: `- ${formatRs(discountAmount)}`, bold: false });
  }
  if (roundOffAmount !== 0) {
    const roundSign = roundOffAmount > 0 ? '+ ' : '- ';
    wRows.push({ label: 'Round Off:', value: `${roundSign}${formatRs(Math.abs(roundOffAmount))}`, bold: false });
  }
  wRows.push({ label: 'Total Amount:', value: formatRs(finalGrandTotal), bold: true });

  const wRowH = 6;
  const boxH = wRows.length * wRowH + 2;

  // Draw totals box
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(boxX, boxY, boxW, boxH);

  doc.setTextColor(0, 0, 0);
  let curY = boxY + 5;
  for (let wi = 0; wi < wRows.length; wi++) {
    const r = wRows[wi];
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
    doc.setFontSize(r.bold ? 9.5 : 8.5);
    doc.text(r.label, boxX + 2, curY);
    doc.text(r.value, boxX + boxW - 2, curY, { align: 'right' });
    curY += wRowH;
    if (wi < wRows.length - 1) {
      doc.setLineWidth(0.15);
      doc.line(boxX, curY - wRowH + 1.5, boxX + boxW, curY - wRowH + 1.5);
    }
  }

  // Payment Mode
  let nextY = boxY + boxH + 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Mode:', 15, nextY);
  doc.setFont('helvetica', 'normal');
  doc.text(item.paymentMode.toUpperCase(), 50, nextY);

  // Payment Split Details
  if (item.paymentMode === 'split' && item.paymentSplit) {
    nextY += 5;
    doc.setFontSize(8);
    const split = item.paymentSplit;
    if (split.cash && split.cash > 0) {
      doc.text(`- Cash: ${formatRs(split.cash)}`, 17, nextY);
      nextY += 4;
    }
    if (split.upi && split.upi > 0) {
      doc.text(`- UPI: ${formatRs(split.upi)}`, 17, nextY);
      nextY += 4;
    }
    if (split.card && split.card > 0) {
      doc.text(`- Card: ${formatRs(split.card)}`, 17, nextY);
      nextY += 4;
    }
  }

  if (item.paymentMode === 'finance') {
    const financeProvider = (item as any).financeProvider || 'N/A';
    const tenureMonths = Number((item as any).financeTenureMonths || 0);
    const downPayment = Number((item as any).financeDownPayment || 0);
    const financedAmount = Number((item as any).financeAmount || Math.max(0, finalGrandTotal - downPayment));
    const monthlyEmiValue = Number((item as any).monthlyEmi || 0);
    const processingFee = Number((item as any).processingFee || 0);

    const financeBoxX = 15;
    const financeBoxW = pageWidth - 30;
    const financeRows = [
      ['Provider', financeProvider],
      ['Tenure', `${tenureMonths} months`],
      ['Down Payment', formatRs(downPayment)],
      ['Financed Amount', formatRs(financedAmount)],
      ['Monthly EMI', formatRs(monthlyEmiValue)],
      ['Processing Fee', formatRs(processingFee)],
    ];
    const financeRowH = 4.8;
    const financeBoxH = financeRows.length * financeRowH + 10;

    nextY += 5;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(financeBoxX, nextY, financeBoxW, financeBoxH, 2, 2);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text('Finance Details', financeBoxX + 3, nextY + 4);

    doc.setTextColor(0, 0, 0);
    const financeLabelX = financeBoxX + 3;
    const financeValueX = financeBoxX + 43;
    let financeRowY = nextY + 9;
    doc.setFontSize(8);
    financeRows.forEach(([label, value], index) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, financeLabelX, financeRowY);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(String(value), financeBoxW - 46);
      doc.text(lines, financeValueX, financeRowY);
      if (index < financeRows.length - 1) {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.1);
        doc.line(financeBoxX + 2, financeRowY + 2, financeBoxX + financeBoxW - 2, financeRowY + 2);
      }
      financeRowY += Math.max(lines.length * financeRowH, financeRowH);
    });

    nextY += financeBoxH;
  }

  // Amount in Words
  const amountInWords = numberToWords(finalGrandTotal);
  nextY += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Amount in Words:', 15, nextY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const maxWidth = pageWidth - 30;
  const words = doc.splitTextToSize(amountInWords, maxWidth);
  doc.text(words, 15, nextY + 5);
  nextY += 5 + (words.length * 4) + 2;

  // Terms & Conditions
  const termsY = pageHeight - 45;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Terms & Conditions:', 15, termsY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('- Goods once sold will not be taken back or exchanged.', 15, termsY + 4);
  doc.text('- All disputes are subject to local jurisdiction only.', 15, termsY + 8);
  doc.text('- Payment due within 7 days of invoice date.', 15, termsY + 12);

  // Signature
  const signY = pageHeight - 20;
  doc.setLineWidth(0.3);
  doc.line(pageWidth - 60, signY, pageWidth - 15, signY);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Authorized Signature', pageWidth - 37, signY + 5);

  // Footer
  doc.setLineWidth(0.5);
  doc.line(15, pageHeight - 12, pageWidth - 15, pageHeight - 12);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(60, 60, 60);
  doc.text('Thank you for your business!', pageWidth / 2, pageHeight - 6, { align: 'center' });

  // Return PDF as base64 for sharing
  const fileName = `invoice-${invoiceNo}-${new Date().toISOString().split('T')[0]}.pdf`;
  return {
    fileName,
    pdfData: doc.output('datauristring'),
    pdfBlob: doc.output('blob'),
    pdfArrayBuffer: doc.output('arraybuffer')
  };
};

export const generatePDFReport = (items: BillingItem[], shopName: string = 'My Shop') => {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(shopName, 14, 20);

  doc.setFontSize(16);
  doc.text('Billing Report', 14, 30);

  // Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 14, 38);

  // Calculate totals
  const totalRevenue = items.reduce((sum, item) => sum + (item.sellingPrice * item.quantity), 0);
  const totalCost = items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);
  const totalProfit = items.reduce((sum, item) => sum + item.totalProfit, 0);
  const totalItems = items.length;
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  // Summary section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary', 14, 48);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const summaryY = 55;
  doc.text(`Total Items: ${totalItems}`, 14, summaryY);
  doc.text(`Total Quantity: ${totalQuantity}`, 14, summaryY + 6);
  doc.text(`Total Revenue: ₹${totalRevenue.toFixed(2)}`, 14, summaryY + 12);
  doc.text(`Total Cost: ₹${totalCost.toFixed(2)}`, 14, summaryY + 18);
  doc.text(`Total Profit: ₹${totalProfit.toFixed(2)}`, 14, summaryY + 24);
  doc.text(`Profit Margin: ${totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(2) : 0}%`, 14, summaryY + 30);

  // Table data
  const tableData = items.map((item, index) => [
    index + 1,
    item.title,
    item.quantity,
    `₹${item.cost.toFixed(2)}`,
    `₹${item.sellingPrice.toFixed(2)}`,
    `₹${item.profit.toFixed(2)}`,
    `₹${item.totalProfit.toFixed(2)}`,
    new Date(item.createdAt).toLocaleDateString()
  ]);

  // Add table
  autoTable(doc, {
    startY: summaryY + 40,
    head: [['#', 'Item', 'Qty', 'Cost', 'Selling', 'Unit Profit', 'Total Profit', 'Date']],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: [102, 126, 234],
      fontStyle: 'bold',
      fontSize: 9
    },
    bodyStyles: {
      fontSize: 8
    },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 40 },
      2: { cellWidth: 15 },
      3: { cellWidth: 25 },
      4: { cellWidth: 25 },
      5: { cellWidth: 25 },
      6: { cellWidth: 25 },
      7: { cellWidth: 25 }
    },
    margin: { left: 14, right: 14 }
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Save the PDF
  const fileName = `billing-report-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
};

// Generate comprehensive sales report with charts
export const generateSalesReportPDF = (reportData: any, shopDetails: ShopDetails) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let yPos = 15;

  // Add Logo (if available)
  try {
    const logoSize = 20;
    doc.addImage(logoImg, 'PNG', 15, yPos, logoSize, logoSize);
  } catch (error) {
    console.log('Logo not available');
  }

  // Shop Header
  yPos += 10;
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(shopDetails.shopName || 'SHOP NAME', pageWidth / 2, yPos, { align: 'center' });

  yPos += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(shopDetails.address || 'Shop Address', pageWidth / 2, yPos, { align: 'center' });

  yPos += 4;
  doc.text(`Phone: ${shopDetails.phone || 'N/A'} | Email: ${shopDetails.email || 'N/A'}`, pageWidth / 2, yPos, { align: 'center' });

  if (shopDetails.gst) {
    yPos += 4;
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${shopDetails.gst}`, pageWidth / 2, yPos, { align: 'center' });
  }

  // Title
  yPos += 10;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 139);
  doc.text('SALES REPORT', pageWidth / 2, yPos, { align: 'center' });

  // Date Range
  yPos += 8;
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  const dateRangeName = reportData.dateRange.type === 'today' ? 'Today' :
    reportData.dateRange.type === 'week' ? 'Last 7 Days' :
      reportData.dateRange.type === 'month' ? 'Last 30 Days' :
        reportData.dateRange.type === 'year' ? 'Last Year' :
          `${reportData.dateRange.start.toLocaleDateString()} - ${reportData.dateRange.end.toLocaleDateString()}`;
  doc.text(`Period: ${dateRangeName}`, pageWidth / 2, yPos, { align: 'center' });

  yPos += 4;
  doc.setFontSize(8);
  doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}`, pageWidth / 2, yPos, { align: 'center' });

  // Horizontal line
  yPos += 6;
  doc.setLineWidth(0.5);
  doc.setDrawColor(0, 0, 0);
  doc.line(15, yPos, pageWidth - 15, yPos);

  // Summary Section
  yPos += 10;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', 15, yPos);

  yPos += 8;

  // Summary boxes
  const boxWidth = (pageWidth - 40) / 2;
  const boxHeight = 50;

  // Left box - Revenue & Profit
  doc.setLineWidth(0.3);
  doc.setDrawColor(59, 130, 246);
  doc.rect(15, yPos, boxWidth, boxHeight);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(59, 130, 246);
  doc.text('REVENUE & PROFIT', 20, yPos + 7);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text('Total Revenue:', 20, yPos + 15);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${reportData.summary.totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 20, yPos + 20);

  doc.setFont('helvetica', 'normal');
  doc.text('Total Profit:', 20, yPos + 28);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(34, 197, 94);
  doc.text(`Rs ${reportData.summary.totalProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 20, yPos + 33);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text('Profit Margin:', 20, yPos + 41);
  doc.setFont('helvetica', 'bold');
  doc.text(`${reportData.summary.profitMargin.toFixed(2)}%`, 20, yPos + 46);

  // Right box - Transactions & Expenses
  doc.setLineWidth(0.3);
  doc.setDrawColor(168, 85, 247);
  doc.rect(20 + boxWidth, yPos, boxWidth, boxHeight);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(168, 85, 247);
  doc.text('TRANSACTIONS & EXPENSES', 25 + boxWidth, yPos + 7);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text('Total Transactions:', 25 + boxWidth, yPos + 15);
  doc.setFont('helvetica', 'bold');
  doc.text(`${reportData.summary.totalTransactions}`, 25 + boxWidth, yPos + 20);

  doc.setFont('helvetica', 'normal');
  doc.text('Total Expenses:', 25 + boxWidth, yPos + 28);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(239, 68, 68);
  doc.text(`Rs ${reportData.summary.totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 25 + boxWidth, yPos + 33);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text('Net Profit:', 25 + boxWidth, yPos + 41);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(reportData.summary.netProfit >= 0 ? 34 : 239, reportData.summary.netProfit >= 0 ? 197 : 68, reportData.summary.netProfit >= 0 ? 94 : 68);
  doc.text(`Rs ${reportData.summary.netProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 25 + boxWidth, yPos + 46);

  yPos += boxHeight + 10;

  // Payment Breakdown Section
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Mode Breakdown', 15, yPos);

  yPos += 8;

  const paymentTotal = reportData.paymentBreakdown.cash + reportData.paymentBreakdown.upi + reportData.paymentBreakdown.card;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  // Cash
  doc.text('Cash:', 20, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${reportData.paymentBreakdown.cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 50, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`(${paymentTotal > 0 ? ((reportData.paymentBreakdown.cash / paymentTotal) * 100).toFixed(1) : 0}%)`, 90, yPos);

  yPos += 6;

  // UPI
  doc.text('UPI:', 20, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${reportData.paymentBreakdown.upi.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 50, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`(${paymentTotal > 0 ? ((reportData.paymentBreakdown.upi / paymentTotal) * 100).toFixed(1) : 0}%)`, 90, yPos);

  yPos += 6;

  // Card
  doc.text('Card:', 20, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${reportData.paymentBreakdown.card.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 50, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`(${paymentTotal > 0 ? ((reportData.paymentBreakdown.card / paymentTotal) * 100).toFixed(1) : 0}%)`, 90, yPos);

  yPos += 12;

  // Top Products Section
  if (reportData.topProducts && reportData.topProducts.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Top 5 Products', 15, yPos);

    yPos += 6;

    const topProductsTable = reportData.topProducts.map((product: any, index: number) => [
      (index + 1).toString(),
      product.name,
      product.quantity.toString(),
      `Rs ${product.revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['Rank', 'Product Name', 'Qty Sold', 'Revenue']],
      body: topProductsTable,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 15, halign: 'center' },
        1: { cellWidth: 80, halign: 'left' },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 40, halign: 'right' }
      },
      margin: { left: 15, right: 15 },
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Check if we need a new page
  if (yPos > pageHeight - 60) {
    doc.addPage();
    yPos = 20;
  }

  // Daily Sales Trend
  if (reportData.dailySales && reportData.dailySales.dates.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Daily Sales Trend', 15, yPos);

    yPos += 6;

    const dailySalesTable = reportData.dailySales.dates.map((date: string, index: number) => [
      date,
      `Rs ${reportData.dailySales.values[index].toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['Date', 'Sales']],
      body: dailySalesTable,
      theme: 'striped',
      styles: {
        fontSize: 8,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [34, 197, 94],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 60, halign: 'left' },
        1: { cellWidth: 60, halign: 'right' }
      },
      margin: { left: 15, right: 15 },
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Check if we need a new page for transaction details
  if (yPos > pageHeight - 80) {
    doc.addPage();
    yPos = 20;
  }

  // Transaction Details
  if (reportData.items && reportData.items.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Transaction Details', 15, yPos);

    yPos += 6;

    const transactionsTable = reportData.items.slice(0, 50).map((item: any) => [
      new Date(item.createdAt).toLocaleDateString('en-IN'),
      item.title,
      item.quantity.toString(),
      `Rs ${(item.sellingPrice * item.quantity).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      item.paymentMode.toUpperCase(),
      item.sellingPrice > 0 ? 'SALE' : 'EXPENSE'
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['Date', 'Item', 'Qty', 'Amount', 'Payment', 'Type']],
      body: transactionsTable,
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [100, 100, 100],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 25, halign: 'left' },
        1: { cellWidth: 55, halign: 'left' },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 35, halign: 'right' },
        4: { cellWidth: 20, halign: 'center' },
        5: { cellWidth: 20, halign: 'center' }
      },
      margin: { left: 15, right: 15 },
    });

    if (reportData.items.length > 50) {
      yPos = (doc as any).lastAutoTable.finalY + 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.text(`Showing 50 of ${reportData.items.length} transactions`, 15, yPos);
    }
  }

  // Footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    // Footer line
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);

    // Page number
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });

    // Generated by
    doc.setFont('helvetica', 'italic');
    doc.text('Generated by Billing System', 15, pageHeight - 10);

    // Thank you message
    doc.text('Thank you for your business!', pageWidth - 15, pageHeight - 10, { align: 'right' });
  }

  // Save the PDF
  const fileName = `sales-report-${reportData.dateRange.type}-${new Date().toISOString().split('T')[0]}.pdf`;
  if (isAndroidWebView()) {
    try {
      const dataUrl = doc.output('datauristring');
      window.AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};

// Generate Credit Sales Report PDF
export const generateCreditSalesPDF = (
  items: BillingItem[],
  shopDetails: ShopDetails,
  dateRange: string,
  paymentFilter: 'all' | 'paid' | 'unpaid',
  returnBlob: boolean = false
) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let yPos = 15;

  // Header: Logo (left) and shop name/details centered
  try {
    const logoSize = 18;
    doc.addImage(logoImg, 'PNG', 15, yPos, logoSize, logoSize);
  } catch (error) {
    // Logo optional
  }

  // Shop Name - Centered
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(shopDetails.shopName || 'SHOP NAME', pageWidth / 2, yPos + 8, { align: 'center' });

  // Shop Details - Centered
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(shopDetails.address || 'Shop Address', pageWidth / 2, yPos + 14, { align: 'center' });
  doc.text(
    `Phone: ${shopDetails.phone || 'N/A'} | Email: ${shopDetails.email || 'N/A'}`,
    pageWidth / 2,
    yPos + 18,
    { align: 'center' }
  );

  // Separator line
  yPos += 24;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(15, yPos, pageWidth - 15, yPos);

  // Title and meta
  yPos += 8;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  const filterText = paymentFilter === 'paid' ? 'PAID ' : paymentFilter === 'unpaid' ? 'UNPAID ' : '';
  doc.text(`${filterText}CREDIT SALES REPORT`, pageWidth / 2, yPos, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${dateRange}`, pageWidth / 2, yPos + 6, { align: 'center' });
  // Duration based on first and last transaction dates
  const formatDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const minDate = new Date(Math.min(...items.map(i => (i.createdAt instanceof Date ? i.createdAt : new Date(i.createdAt as any)).getTime())));
  const maxDate = new Date(Math.max(...items.map(i => (i.createdAt instanceof Date ? i.createdAt : new Date(i.createdAt as any)).getTime())));
  doc.text(`Duration: ${formatDate(minDate)} - ${formatDate(maxDate)}`, pageWidth / 2, yPos + 11, { align: 'center' });

  // Single customer display at top
  const customerNames = Array.from(new Set(items.map(i => i.creditCustomerName || i.customerName).filter(Boolean))) as string[];
  const customerLabel = customerNames.length === 1 ? customerNames[0] : 'Multiple Customers';
  doc.setFont('helvetica', 'bold');
  doc.text('Customer:', 15, yPos + 21);
  doc.setFont('helvetica', 'normal');
  doc.text(customerLabel, 40, yPos + 21);

  // Second separator
  yPos += 26;
  doc.setLineWidth(0.3);
  doc.line(15, yPos, pageWidth - 15, yPos);

  // Transactions table - Simplified
  yPos += 6;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Transactions', 15, yPos);
  yPos += 4;

  // Prepare table data
  const tableData = items.map((item) => {
    // Determine the amount to show based on filter
    // If filtering by 'unpaid', showing the remaining amount makes sense?
    // Or just show the Total Transaction amount?
    // The user said "only show the amount...". Usually implies the Transaction Value.
    // If it's unpaid filter, the transaction value IS the unpaid amount (mostly).
    // Let's settle on showing the Total Transaction Value (Selling Price * Qty).
    const totalAmount = (item.sellingPrice || 0) * (item.quantity || 0);

    return [
      new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      item.title,
      (item.quantity || 0).toString(),
      `Rs ${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    ];
  });

  // Calculate generic total
  const totalCredit = items.reduce((sum, it) => sum + ((it.sellingPrice || 0) * (it.quantity || 0)), 0);

  autoTable(doc, {
    startY: yPos,
    head: [['Date', 'Item', 'Qty', 'Amount (Rs)']],
    body: tableData,
    foot: [[
      '',
      'Total',
      '',
      `Rs ${totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    ]],
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3,
      font: 'helvetica',
      fontStyle: 'normal'
    },
    headStyles: {
      fillColor: [255, 140, 0],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 10,
      halign: 'center'
    },
    footStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'right'
    },
    columnStyles: {
      0: { cellWidth: 30, halign: 'center' },
      1: { cellWidth: 90, halign: 'left' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 40, halign: 'right' }
    },
    margin: { left: 15, right: 15 }
  });

  // Footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    doc.setFont('helvetica', 'italic');
    doc.text('Credit Sales Report', 15, pageHeight - 10);
    doc.text('Confidential Document', pageWidth - 15, pageHeight - 10, { align: 'right' });
  }

  const filterSuffix = paymentFilter === 'paid' ? '-paid' : paymentFilter === 'unpaid' ? '-unpaid' : '';
  const fileName = `credit-sales${filterSuffix}-${new Date().toISOString().split('T')[0]}.pdf`;

  if (returnBlob) {
    return {
      fileName,
      pdfBlob: doc.output('blob'),
      pdfData: doc.output('datauristring')
    };
  }
  // Default save path
  if (isAndroidWebView()) {
    try {
      const dataUrl = doc.output('datauristring');
      window.AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};

// Generate Overall Sales Report PDF
export const generateOverallSalesPDF = (
  items: BillingItem[],
  shopDetails: ShopDetails,
  dateRange: string,
  showCreditOnly: boolean,
  creditPaymentFilter: 'all' | 'paid' | 'unpaid',
  returnBlob: boolean = false
) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let yPos = 15;

  // Header: Logo and shop details
  try {
    const logoSize = 18;
    doc.addImage(logoImg, 'PNG', 15, yPos, logoSize, logoSize);
  } catch (error) {
    // Logo optional
  }

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(shopDetails.shopName || 'SHOP NAME', pageWidth / 2, yPos + 8, { align: 'center' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(shopDetails.address || 'Shop Address', pageWidth / 2, yPos + 14, { align: 'center' });
  doc.text(
    `Phone: ${shopDetails.phone || 'N/A'} | Email: ${shopDetails.email || 'N/A'}`,
    pageWidth / 2,
    yPos + 18,
    { align: 'center' }
  );

  // Separator
  yPos += 24;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(15, yPos, pageWidth - 15, yPos);

  // Title
  yPos += 8;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  let titleText = 'OVERALL SALES REPORT';
  if (showCreditOnly) {
    const filterPrefix = creditPaymentFilter === 'paid' ? 'PAID ' : creditPaymentFilter === 'unpaid' ? 'UNPAID ' : '';
    titleText = `${filterPrefix}CREDIT SALES REPORT`;
  }
  doc.text(titleText, pageWidth / 2, yPos, { align: 'center' });

  // Date range
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${dateRange}`, pageWidth / 2, yPos + 6, { align: 'center' });
  doc.setFontSize(8);
  doc.text(
    `Generated on: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}`,
    pageWidth / 2,
    yPos + 11,
    { align: 'center' }
  );

  // Separator
  yPos += 16;
  doc.setLineWidth(0.3);
  doc.line(15, yPos, pageWidth - 15, yPos);

  // Separate sales and expenses
  const salesEntries = items.filter(item => (item.sellingPrice || 0) > 0);
  const expenseEntries = items.filter(item => (item.sellingPrice || 0) === 0 || (item.profit || 0) < 0);

  // Calculate financial metrics
  const totalRevenue = salesEntries.reduce((sum, item) => sum + ((item.sellingPrice || 0) * (item.quantity || 0)), 0);
  const totalProfit = salesEntries.reduce((sum, item) => sum + (item.totalProfit || 0), 0);
  const totalExpenses = expenseEntries.reduce((sum, item) => sum + Math.abs((item.cost || 0) * (item.quantity || 0)), 0);
  const netProfit = totalProfit - totalExpenses;
  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // Payment mode breakdown
  const cashSales = items.reduce((sum, item) => {
    if (item.paymentMode === 'cash') return sum + ((item.sellingPrice || 0) * (item.quantity || 0));
    if (item.paymentMode === 'split' && item.paymentSplit?.cash) return sum + item.paymentSplit.cash;
    return sum;
  }, 0);

  const upiSales = items.reduce((sum, item) => {
    if (item.paymentMode === 'upi') return sum + ((item.sellingPrice || 0) * (item.quantity || 0));
    if (item.paymentMode === 'split' && item.paymentSplit?.upi) return sum + item.paymentSplit.upi;
    return sum;
  }, 0);

  const cardSales = items.reduce((sum, item) => {
    if (item.paymentMode === 'card') return sum + ((item.sellingPrice || 0) * (item.quantity || 0));
    if (item.paymentMode === 'split' && item.paymentSplit?.card) return sum + item.paymentSplit.card;
    return sum;
  }, 0);

  // Financial Summary section
  yPos += 8;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Financial Summary', 15, yPos);
  yPos += 6;

  // Financial metrics boxes
  const boxWidth = (pageWidth - 45) / 4;
  const boxHeight = 25;

  // Total Sales Revenue
  doc.setLineWidth(0.3);
  doc.setDrawColor(59, 130, 246);
  doc.rect(15, yPos, boxWidth, boxHeight);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(59, 130, 246);
  doc.text('TOTAL SALES', 20, yPos + 5);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 20, yPos + 15);

  // Gross Profit
  doc.setDrawColor(34, 197, 94);
  doc.rect(20 + boxWidth, yPos, boxWidth, boxHeight);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(34, 197, 94);
  doc.text('GROSS PROFIT', 25 + boxWidth, yPos + 5);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${totalProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 25 + boxWidth, yPos + 10);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(`${profitMargin.toFixed(2)}% margin`, 25 + boxWidth, yPos + 18);

  // Total Expenses
  doc.setDrawColor(239, 68, 68);
  doc.rect(25 + 2 * boxWidth, yPos, boxWidth, boxHeight);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(239, 68, 68);
  doc.text('TOTAL EXPENSES', 30 + 2 * boxWidth, yPos + 5);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 30 + 2 * boxWidth, yPos + 15);

  // Net Profit
  const netProfitColor = netProfit >= 0 ? [34, 197, 94] : [239, 68, 68];
  doc.setDrawColor(netProfitColor[0], netProfitColor[1], netProfitColor[2]);
  doc.rect(30 + 3 * boxWidth, yPos, boxWidth, boxHeight);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(netProfitColor[0], netProfitColor[1], netProfitColor[2]);
  doc.text('NET PROFIT', 35 + 3 * boxWidth, yPos + 5);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${netProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 35 + 3 * boxWidth, yPos + 10);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('After expenses', 35 + 3 * boxWidth, yPos + 18);

  yPos += boxHeight + 10;

  // Payment Mode Summary
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Mode Summary', 15, yPos);
  yPos += 6;

  const paymentBoxWidth = (pageWidth - 45) / 3;
  const paymentBoxHeight = 30;

  // Cash Sales
  doc.setDrawColor(34, 197, 94);
  doc.rect(15, yPos, paymentBoxWidth, paymentBoxHeight);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(34, 197, 94);
  doc.text('CASH SALES', 20, yPos + 5);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${cashSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 20, yPos + 15);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const cashPercentage = totalRevenue > 0 ? ((cashSales / totalRevenue) * 100).toFixed(1) : '0';
  doc.text(`${cashPercentage}% of total`, 20, yPos + 22);

  // UPI Sales
  doc.setDrawColor(59, 130, 246);
  doc.rect(20 + paymentBoxWidth, yPos, paymentBoxWidth, paymentBoxHeight);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(59, 130, 246);
  doc.text('UPI SALES', 25 + paymentBoxWidth, yPos + 5);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${upiSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 25 + paymentBoxWidth, yPos + 15);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const upiPercentage = totalRevenue > 0 ? ((upiSales / totalRevenue) * 100).toFixed(1) : '0';
  doc.text(`${upiPercentage}% of total`, 25 + paymentBoxWidth, yPos + 22);

  // Card Sales
  doc.setDrawColor(147, 51, 234);
  doc.rect(25 + 2 * paymentBoxWidth, yPos, paymentBoxWidth, paymentBoxHeight);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(147, 51, 234);
  doc.text('CARD SALES', 30 + 2 * paymentBoxWidth, yPos + 5);

  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs ${cardSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 30 + 2 * paymentBoxWidth, yPos + 15);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const cardPercentage = totalRevenue > 0 ? ((cardSales / totalRevenue) * 100).toFixed(1) : '0';
  doc.text(`${cardPercentage}% of total`, 30 + 2 * paymentBoxWidth, yPos + 22);

  yPos += paymentBoxHeight + 10;

  // Sales Transactions Table
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`Sales Transactions (${salesEntries.length})`, 15, yPos);
  yPos += 4;

  if (salesEntries.length > 0) {
    const salesTableData = salesEntries.map((item) => [
      new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      item.customerName || 'Walk-in',
      item.title,
      (item.quantity || 0).toString(),
      `Rs ${((item.sellingPrice || 0) * (item.quantity || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      `Rs ${(item.totalProfit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      item.paymentMode?.toUpperCase() || 'N/A'
    ]);

    const salesHeaders = ['Date', 'Customer', 'Product', 'Qty', 'Total', 'Profit', 'Payment'];
    const salesColumnStyles = {
      0: { cellWidth: 22, halign: 'center' as const },
      1: { cellWidth: 28, halign: 'left' as const },
      2: { cellWidth: 45, halign: 'left' as const },
      3: { cellWidth: 10, halign: 'right' as const },
      4: { cellWidth: 25, halign: 'right' as const },
      5: { cellWidth: 25, halign: 'right' as const },
      6: { cellWidth: 15, halign: 'center' as const }
    };

    autoTable(doc, {
      startY: yPos,
      head: [salesHeaders],
      body: salesTableData,
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 2,
        font: 'helvetica',
        fontStyle: 'normal'
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center'
      },
      columnStyles: salesColumnStyles,
      margin: { left: 15, right: 15 }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  } else {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('No sales transactions found for the selected period.', 15, yPos);
    yPos += 8;
  }

  // Expenses Transactions Table
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`Expense Transactions (${expenseEntries.length})`, 15, yPos);
  yPos += 4;

  if (expenseEntries.length > 0) {
    const expenseTableData = expenseEntries.map((item) => [
      new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      item.customerName || 'N/A',
      item.title,
      (item.quantity || 0).toString(),
      `Rs ${((item.cost || 0) * (item.quantity || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    ]);

    const expenseHeaders = ['Date', 'Vendor', 'Description', 'Qty', 'Total Cost'];
    const expenseColumnStyles = {
      0: { cellWidth: 22, halign: 'center' as const },
      1: { cellWidth: 30, halign: 'left' as const },
      2: { cellWidth: 55, halign: 'left' as const },
      3: { cellWidth: 10, halign: 'right' as const },
      4: { cellWidth: 25, halign: 'right' as const }
    };

    autoTable(doc, {
      startY: yPos,
      head: [expenseHeaders],
      body: expenseTableData,
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 2,
        font: 'helvetica',
        fontStyle: 'normal'
      },
      headStyles: {
        fillColor: [239, 68, 68],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center'
      },
      columnStyles: expenseColumnStyles,
      margin: { left: 15, right: 15 }
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  } else {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('No expense transactions found for the selected period.', 15, yPos);
    yPos += 8;
  }

  // Footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    doc.setFont('helvetica', 'italic');
    doc.text('Overall Sales Report', 15, pageHeight - 10);
    doc.text('Confidential Document', pageWidth - 15, pageHeight - 10, { align: 'right' });
  }

  const filePrefix = showCreditOnly ? 'credit-sales' : 'overall-sales';
  const filterSuffix = showCreditOnly && creditPaymentFilter !== 'all' ? `-${creditPaymentFilter}` : '';
  const fileName = `${filePrefix}${filterSuffix}-${new Date().toISOString().split('T')[0]}.pdf`;

  if (returnBlob) {
    return {
      fileName,
      pdfBlob: doc.output('blob'),
      pdfData: doc.output('datauristring')
    };
  }
  if (isAndroidWebView()) {
    try {
      const dataUrl = doc.output('datauristring');
      window.AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};

export const generateServiceJobPDF = async (job: ServiceRequest, shopDetails: ShopDetails, returnBlob: boolean = false) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const marginLeft = 12;
  const marginRight = 12;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const centerX = pageWidth / 2;

  // ── Background Watermark ──────────────────────────────────────────────────
  try {
    const wmSize = 75;
    const wmX = (pageWidth - wmSize) / 2;
    const wmY = 90;
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.08 }));
    doc.addImage(logoImg, 'PNG', wmX, wmY, wmSize, wmSize);
    doc.restoreGraphicsState();
  } catch (_e) { /* ignore watermark error */ }

  // ── Helper Formatter Functions ────────────────────────────────────────────
  const resolveDate = (dateVal: any) => {
    if (!dateVal) return '-';
    let d: Date;
    if (typeof dateVal === 'string') {
      d = new Date(dateVal);
    } else if (dateVal.toDate && typeof dateVal.toDate === 'function') {
      d = dateVal.toDate();
    } else if (dateVal instanceof Date) {
      d = dateVal;
    } else {
      d = new Date(dateVal);
    }
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const jobDateStr = job.createdAt ? resolveDate(job.createdAt) : `${job.jobDate || '-'} ${job.jobTime || ''}`.trim();
  const jobSheetId = job.jobSheetNumber || job.qrCodeValue || job.id || 'JOB-UNKNOWN';
  const shopNameStr = (shopDetails.shopName || 'DIGITAL ZONE').toUpperCase();

  const estimatedCost = Number(job.cost || job.approvedCost || 0);
  const advancePaid = Number(job.advancePaid || 0);
  const balanceDue = job.balanceAmount !== undefined ? Number(job.balanceAmount) : Math.max(0, estimatedCost - advancePaid);

  let unlockDisplay = job.unlockCode || job.password || '';
  if (!unlockDisplay && job.pattern && job.pattern.length > 0) {
    unlockDisplay = `Pattern: ${job.pattern.join('-')}`;
  }
  if (!unlockDisplay) {
    unlockDisplay = 'None / Unlocked';
  }
  const lockTypeDisplay = (job.screenLockType || job.lockType || (unlockDisplay !== 'None / Unlocked' ? 'Protected' : 'None')).toUpperCase();

  const accessoriesDisplay = Array.isArray(job.accessoriesReceived) && job.accessoriesReceived.length > 0
    ? job.accessoriesReceived.join(', ')
    : 'Device Only (No accessories)';

  const issuesDisplay = Array.isArray(job.issues) && job.issues.length > 0
    ? job.issues.join(', ')
    : (job.issueNotes || 'Inspection & Diagnosis');

  // ── 1. HEADER SECTION (Brand Left, Job Sheet Badge Right) ─────────────────
  let yPos = 8;
  const logoW = 16;
  const logoH = 16;
  try {
    doc.addImage(logoImg, 'PNG', marginLeft, yPos + 1, logoW, logoH);
  } catch (_e) { /* no logo */ }

  const headerLeftX = marginLeft + logoW + 3;
  const headerLeftMaxW = 100;

  // Shop Name
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42); // Slate-900
  doc.text(shopNameStr, headerLeftX, yPos + 4.5);

  // Address
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105); // Slate-600
  let shopMetaY = yPos + 8.5;

  if (shopDetails.address) {
    const addrLines: string[] = doc.splitTextToSize(shopDetails.address, headerLeftMaxW);
    doc.text(addrLines.slice(0, 2), headerLeftX, shopMetaY);
    shopMetaY += Math.min(addrLines.length, 2) * 3.3;
  }

  // Contact line & GSTIN
  const contactParts = [
    shopDetails.phone ? `Ph: ${shopDetails.phone}` : '',
    shopDetails.email ? `Email: ${shopDetails.email}` : '',
  ].filter(Boolean).join('  |  ');
  if (contactParts) {
    doc.text(contactParts, headerLeftX, shopMetaY);
    shopMetaY += 3.3;
  }
  if (shopDetails.gst) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(`GSTIN: ${shopDetails.gst}`, headerLeftX, shopMetaY);
    doc.setFont('helvetica', 'normal');
  }

  // Right Header Info Card (Job ID & Date badge)
  const headerCardW = 64;
  const headerCardH = 20;
  const headerCardX = pageWidth - marginRight - headerCardW;
  const headerCardY = yPos;

  doc.setFillColor(248, 250, 252); // Slate-50
  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.4);
  doc.roundedRect(headerCardX, headerCardY, headerCardW, headerCardH, 2, 2, 'FD');

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139); // Slate-500
  doc.text('SERVICE JOB SHEET REF', headerCardX + 4, headerCardY + 4.5);

  // Job ID Large
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(29, 78, 216); // Blue-700
  doc.text(jobSheetId, headerCardX + 4, headerCardY + 9.5);

  // Intake Date
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`Intake: ${jobDateStr}`, headerCardX + 4, headerCardY + 14);

  // Priority Pill Badge
  const isUrgent = job.priority === 'urgent';
  const pillW = 22;
  const pillH = 4.5;
  const pillX = headerCardX + headerCardW - pillW - 3;
  const pillY = headerCardY + 3;

  if (isUrgent) {
    doc.setFillColor(254, 226, 226); // Red-100
    doc.setDrawColor(239, 68, 68); // Red-500
    doc.roundedRect(pillX, pillY, pillW, pillH, 1, 1, 'FD');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28); // Red-700
    doc.text('URGENT', pillX + pillW / 2, pillY + 3.2, { align: 'center' });
  } else {
    doc.setFillColor(241, 245, 249); // Slate-100
    doc.setDrawColor(203, 213, 225); // Slate-300
    doc.roundedRect(pillX, pillY, pillW, pillH, 1, 1, 'FD');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('STANDARD', pillX + pillW / 2, pillY + 3.2, { align: 'center' });
  }

  yPos = 31;

  // ── 2. SERVICE BANNER RIBBON ──────────────────────────────────────────────
  doc.setFillColor(30, 41, 59); // Slate-800
  doc.roundedRect(marginLeft, yPos, contentWidth, 6.5, 1.5, 1.5, 'F');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('CUSTOMER SERVICE JOB SHEET & REPAIR ACKNOWLEDGEMENT', marginLeft + 4, yPos + 4.5);

  const statusStr = `STATUS: ${(job.status || 'RECEIVED').toUpperCase()}`;
  doc.setFontSize(7.5);
  doc.text(statusStr, pageWidth - marginRight - 4, yPos + 4.5, { align: 'right' });

  yPos += 9.5;

  // ── HELPER: Section Card Box Drawer ───────────────────────────────────────
  const drawCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    rows: { label: string; value: string; bold?: boolean; color?: [number, number, number] }[]
  ) => {
    // Card Background & Border
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240); // Slate-200
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');

    // Title Bar
    doc.setFillColor(248, 250, 252); // Slate-50
    doc.rect(x + 0.3, y + 0.3, w - 0.6, 5.5, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.line(x, y + 5.8, x + w, y + 5.8);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235); // Blue-600
    doc.text(title, x + 3, y + 4.2);

    // Rows
    let rY = y + 9.5;
    const labelW = 28;
    const valW = w - labelW - 5;
    const valX = x + labelW + 2;

    rows.forEach(r => {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139); // Slate-500
      doc.text(r.label, x + 3, rY);

      doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
      if (r.color) {
        doc.setTextColor(r.color[0], r.color[1], r.color[2]);
      } else {
        doc.setTextColor(15, 23, 42); // Slate-900
      }

      const lines = doc.splitTextToSize(r.value || '-', valW);
      doc.text(lines, valX, rY);
      rY += Math.max(lines.length * 3.1, 4.0);
    });
  };

  const colWidth = (contentWidth - 6) / 2;
  const col2X = marginLeft + colWidth + 6;

  // ── 3. ROW 1: CUSTOMER INFO & JOB SPECIFICATIONS ──────────────────────────
  const row1Y = yPos;
  const row1H = 33;

  const customerRows = [
    { label: 'Customer Name:', value: job.customerName || 'Walk-In Customer', bold: true },
    { label: 'Mobile Phone:', value: job.mobile || '-', bold: true },
    { label: 'Alternate Ph:', value: job.alternateNumber || '-' },
    { label: 'Email Address:', value: job.email || '-' },
    { label: 'Address / City:', value: job.address || '-' },
    { label: 'GST Number:', value: job.gstNumber || '-' },
  ];

  const orderRows = [
    { label: 'Job Sheet No:', value: jobSheetId, bold: true, color: [29, 78, 216] as [number, number, number] },
    { label: 'Service Type:', value: (job.serviceType || 'walk-in').toUpperCase() },
    { label: 'Received By:', value: job.createdByName || shopNameStr },
    { label: 'Current Status:', value: (job.status || 'received').toUpperCase(), bold: true },
    { label: 'Est. Delivery:', value: job.estimatedRepairTime || 'To be communicated after diagnosis' },
    { label: 'Warranty Base:', value: (job.warrantyStatus || 'out-of-warranty').replace('-', ' ').toUpperCase() },
  ];

  drawCard(marginLeft, row1Y, colWidth, row1H, 'CUSTOMER INFORMATION', customerRows);
  drawCard(col2X, row1Y, colWidth, row1H, 'SERVICE ORDER SPECIFICATIONS', orderRows);

  yPos += row1H + 4;

  // ── 4. ROW 2: DEVICE HARDWARE & SECURITY / ACCESS CREDENTIALS ────────────
  const row2Y = yPos;
  const row2H = 33;

  const deviceRows = [
    { label: 'Brand & Model:', value: `${job.brand || ''} ${job.modelName || ''}`.trim() || '-', bold: true },
    { label: 'IMEI 1 / Serial:', value: job.imei1 || job.serialNumber || '-', bold: true },
    { label: 'IMEI 2:', value: job.imei2 || '-' },
    { label: 'Color / Variant:', value: [job.color, job.storageVariant].filter(Boolean).join(' / ') || '-' },
    { label: 'Purchase Date:', value: job.purchaseDate || '-' },
    { label: 'Accessories Recv:', value: accessoriesDisplay },
  ];

  const securityRows = [
    { label: 'Screen Lock:', value: lockTypeDisplay, bold: true },
    { label: 'Passcode / PIN:', value: unlockDisplay, bold: true, color: [194, 65, 12] as [number, number, number] },
    { label: 'Google Account:', value: job.googleAccountRemoved ? 'Removed' : 'Logged In / Unverified' },
    { label: 'Apple ID:', value: job.appleIdRemoved ? 'Removed' : 'Active / Unverified' },
    { label: 'SIM / Memory Card:', value: [job.simRemoved ? 'SIM Removed' : 'SIM Inside', job.memoryCardRemoved ? 'SD Card Removed' : 'SD Card Inside'].join(', ') },
    { label: 'Physical State:', value: job.preliminaryInspection || 'Standard workshop intake' },
  ];

  drawCard(marginLeft, row2Y, colWidth, row2H, 'DEVICE HARDWARE DETAILS', deviceRows);
  drawCard(col2X, row2Y, colWidth, row2H, 'SECURITY CREDENTIALS & ACCESS', securityRows);

  yPos += row2H + 4;

  // ── 5. ROW 3: COMPLAINT DETAILS & COMMERCIALS BREAKDOWN ───────────────────
  const row3Y = yPos;
  const row3H = 34;

  const complaintW = contentWidth - 76;
  const commercialsW = 72;
  const commercialsX = marginLeft + complaintW + 4;

  // Complaint Card
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginLeft, row3Y, complaintW, row3H, 1.5, 1.5, 'FD');

  // Header
  doc.setFillColor(248, 250, 252);
  doc.rect(marginLeft + 0.3, row3Y + 0.3, complaintW - 0.6, 5.5, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.line(marginLeft, row3Y + 5.8, marginLeft + complaintW, row3Y + 5.8);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(37, 99, 235);
  doc.text('REPORTED COMPLAINTS & WORKSHOP REMARKS', marginLeft + 3, row3Y + 4.2);

  // Issues text
  let cY = row3Y + 9.5;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Reported Faults:', marginLeft + 3, cY);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(185, 28, 28); // Red-700 for prominent faults
  const wrappedFaults = doc.splitTextToSize(issuesDisplay, complaintW - 32);
  doc.text(wrappedFaults, marginLeft + 28, cY);
  cY += Math.max(wrappedFaults.length * 3.1, 4.2) + 1;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Problem Notes:', marginLeft + 3, cY);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  const wrappedNotes = doc.splitTextToSize(job.issueNotes || 'No additional fault description provided.', complaintW - 32);
  doc.text(wrappedNotes.slice(0, 3), marginLeft + 28, cY);
  cY += Math.min(wrappedNotes.length, 3) * 3.1 + 1;

  if (job.partsRequired || job.workPerformed) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('Work / Parts:', marginLeft + 3, cY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    const workNotes = [job.partsRequired ? `Parts: ${job.partsRequired}` : '', job.workPerformed ? `Action: ${job.workPerformed}` : ''].filter(Boolean).join(' | ');
    doc.text(doc.splitTextToSize(workNotes, complaintW - 32).slice(0, 2), marginLeft + 28, cY);
  }

  // Commercials Card (Right)
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(commercialsX, row3Y, commercialsW, row3H, 1.5, 1.5, 'FD');

  doc.setFillColor(248, 250, 252);
  doc.rect(commercialsX + 0.3, row3Y + 0.3, commercialsW - 0.6, 5.5, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.line(commercialsX, row3Y + 5.8, commercialsX + commercialsW, row3Y + 5.8);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(37, 99, 235);
  doc.text('COMMERCIAL & PAYMENT SUMMARY', commercialsX + 3, row3Y + 4.2);

  let commY = row3Y + 9.5;
  const drawCommRow = (label: string, value: string, boldVal: boolean = false, isHighlight: boolean = false) => {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text(label, commercialsX + 3, commY);

    doc.setFont('helvetica', boldVal ? 'bold' : 'normal');
    if (isHighlight) {
      doc.setTextColor(29, 78, 216); // Blue-700
    } else {
      doc.setTextColor(15, 23, 42);
    }
    doc.text(value, commercialsX + commercialsW - 3, commY, { align: 'right' });
    commY += 4.2;
  };

  drawCommRow('Estimated Repair Cost:', `Rs. ${estimatedCost.toFixed(2)}`, true);
  drawCommRow('Advance Amount Paid:', `Rs. ${advancePaid.toFixed(2)}`, advancePaid > 0);
  drawCommRow('Payment Mode:', (job.paymentMethod || 'Cash').toUpperCase());

  // Balance Due Banner Box inside Commercials
  const balBoxY = row3Y + 22;
  const balBoxH = 9.5;
  doc.setFillColor(239, 246, 255); // Blue-50
  doc.setDrawColor(191, 219, 254); // Blue-200
  doc.roundedRect(commercialsX + 2, balBoxY, commercialsW - 4, balBoxH, 1, 1, 'FD');

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 64, 175); // Blue-800
  doc.text('BALANCE DUE ON DELIVERY', commercialsX + 4, balBoxY + 4);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(29, 78, 216); // Blue-700
  doc.text(`Rs. ${balanceDue.toFixed(2)}`, commercialsX + commercialsW - 5, balBoxY + 6.8, { align: 'right' });

  yPos += row3H + 4;

  // ── 6. ROW 4: WORKSHOP TERMS & DUAL SIGNATURES ────────────────────────────
  const row4Y = yPos;
  const row4H = 30;

  const termsW = contentWidth - 76;
  const sigsW = 72;
  const sigsX = marginLeft + termsW + 4;

  // Terms Box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginLeft, row4Y, termsW, row4H, 1.5, 1.5, 'FD');

  doc.setFillColor(248, 250, 252);
  doc.rect(marginLeft + 0.3, row4Y + 0.3, termsW - 0.6, 5.0, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.line(marginLeft, row4Y + 5.3, marginLeft + termsW, row4Y + 5.3);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(37, 99, 235);
  doc.text('WORKSHOP CONDITIONS & SERVICE POLICY', marginLeft + 3, row4Y + 3.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(71, 85, 105);
  let tY = row4Y + 8.5;
  const terms = [
    '1. Original job sheet or verified Job Sheet ID is strictly mandatory for collecting the device.',
    '2. Water-damaged, dead board, or heavily dropped phones are serviced strictly at customer risk.',
    '3. Shop is not liable for data loss; customers are requested to maintain personal data backup.',
    '4. Estimated turnaround times and costs are provisional and subject to internal board inspection.',
    '5. Devices unclaimed after 30 days of completion notification will be disposed to recover workshop costs.'
  ];
  terms.forEach(t => {
    doc.text(t, marginLeft + 3, tY);
    tY += 3.8;
  });

  // Dual Signatures Box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(sigsX, row4Y, sigsW, row4H, 1.5, 1.5, 'FD');

  const halfSigW = (sigsW - 6) / 2;
  const sigLeftX = sigsX + 3;
  const sigRightX = sigsX + halfSigW + 3;

  // Left Sign: Customer
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Customer Acceptance', sigLeftX, row4Y + 5);

  doc.setLineWidth(0.3);
  doc.setDrawColor(203, 213, 225);
  doc.line(sigLeftX, row4Y + 22, sigLeftX + halfSigW - 2, row4Y + 22);

  doc.setFontSize(5.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('Signature & Date', sigLeftX, row4Y + 25.5);

  // Right Sign: Technician / Workshop
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Workshop Authorized', sigRightX, row4Y + 5);

  doc.line(sigRightX, row4Y + 22, sigRightX + halfSigW - 2, row4Y + 22);

  doc.setFontSize(5.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(`For ${shopNameStr}`, sigRightX, row4Y + 25.5);

  // ── 7. TEAR-OFF DEVICE TAG (ATTACH TO MOBILE / TRAY) ───────────────────────
  const tagY = 188;

  // Dashed Cut Line with Scissors Indicator
  doc.setDrawColor(148, 163, 184); // Slate-400
  doc.setLineWidth(0.35);
  doc.setLineDashPattern([2.5, 2.0], 0);
  doc.line(marginLeft, tagY, pageWidth - marginRight, tagY);
  doc.setLineDashPattern([], 0); // Reset solid

  // Scissors cutting header
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('------------------- [ CUT HERE ]  TEAR-OFF DEVICE TAG (ATTACH TO MOBILE / TRAY) -------------------', centerX, tagY + 3.8, { align: 'center' });

  // Tag Container
  const tagBoxY = tagY + 6;
  const tagBoxH = 46;
  doc.setFillColor(248, 250, 252); // Slate-50
  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.4);
  doc.roundedRect(marginLeft, tagBoxY, contentWidth, tagBoxH, 2, 2, 'FD');

  // Generate QR code for the tear-off tag containing ONLY the Job Sheet ID
  let tagQrDataUrl = '';
  try {
    tagQrDataUrl = await QRCode.toDataURL(jobSheetId, {
      margin: 1,
      width: 140,
      errorCorrectionLevel: 'M'
    });
  } catch (err) {
    console.error('Failed to generate QR code for job tag', err);
  }

  // Tag Details Left Layout
  const tagLeftX = marginLeft + 4;
  const tagCol1W = 140;

  // Top Line of Tag: Shop Brand & Badge
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(shopNameStr, tagLeftX, tagBoxY + 5.5);

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text(`Intake: ${jobDateStr}`, tagLeftX + 58, tagBoxY + 5.5);

  // Large Job ID Monospace & Lock Type Badge
  doc.setFillColor(238, 242, 255); // Indigo-50
  doc.setDrawColor(199, 210, 254); // Indigo-200
  doc.roundedRect(tagLeftX, tagBoxY + 8, 48, 7, 1, 1, 'FD');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 64, 175); // Indigo-800
  doc.text(jobSheetId, tagLeftX + 24, tagBoxY + 12.8, { align: 'center' });

  // Security Lock Badge right next to Job ID (Vital for repair bench technician!)
  doc.setFillColor(254, 243, 199); // Amber-100
  doc.setDrawColor(245, 158, 11); // Amber-500
  doc.roundedRect(tagLeftX + 51, tagBoxY + 8, 86, 7, 1, 1, 'FD');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 83, 9); // Amber-700
  doc.text(`LOCK: ${lockTypeDisplay}  |  CODE: ${unlockDisplay}`, tagLeftX + 54, tagBoxY + 12.8);

  // Tag metadata rows
  let tagMetaY = tagBoxY + 19;
  const drawTagRow = (label: string, value: string, boldVal: boolean = false) => {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text(label, tagLeftX, tagMetaY);

    doc.setFont('helvetica', boldVal ? 'bold' : 'normal');
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(value, tagCol1W - 24);
    doc.text(lines, tagLeftX + 22, tagMetaY);
    tagMetaY += Math.max(lines.length * 3.2, 4.0);
  };

  drawTagRow('Customer:', `${job.customerName || 'Walk-In'} (Ph: ${job.mobile || '-'})`, true);
  drawTagRow('Device:', `${job.brand || ''} ${job.modelName || ''} | ${job.color || 'Standard'} | IMEI: ${job.imei1 || job.serialNumber || '-'}`, true);
  drawTagRow('Reported Fault:', issuesDisplay);
  drawTagRow('Billing:', `Est: Rs. ${estimatedCost.toFixed(2)} | Adv: Rs. ${advancePaid.toFixed(2)} | Balance Due: Rs. ${balanceDue.toFixed(2)}`, true);

  // Tag QR Code (Right Side)
  const tagQrSize = 28;
  const tagQrX = pageWidth - marginRight - tagQrSize - 5;
  const tagQrY = tagBoxY + 4;

  if (tagQrDataUrl) {
    try {
      doc.addImage(tagQrDataUrl, 'PNG', tagQrX, tagQrY, tagQrSize, tagQrSize);
    } catch (_e) { /* ignore */ }
  }

  // Label under Tag QR
  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('SCAN TO VIEW DETAILS', tagQrX + tagQrSize / 2, tagQrY + tagQrSize + 3.2, { align: 'center' });

  doc.setFontSize(5.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(`ID: ${jobSheetId}`, tagQrX + tagQrSize / 2, tagQrY + tagQrSize + 6.2, { align: 'center' });

  // ── 8. FOOTER ─────────────────────────────────────────────────────────────
  doc.setLineWidth(0.3);
  doc.setDrawColor(226, 232, 240);
  doc.line(marginLeft, pageHeight - 12, pageWidth - marginRight, pageHeight - 12);

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Thank you for trusting ${shopNameStr}! For service inquiries, call ${shopDetails.phone || '-'} or email ${shopDetails.email || '-'}.`,
    centerX,
    pageHeight - 7,
    { align: 'center' }
  );

  // ── Save / Return ──────────────────────────────────────────────────────────
  const fileName = `job-sheet-${job.jobSheetNumber || 'sheet'}-${new Date().toISOString().split('T')[0]}.pdf`;

  if (returnBlob) {
    doc.autoPrint();
    return {
      fileName,
      pdfData: doc.output('datauristring'),
      pdfBlob: doc.output('blob'),
    };
  }

  if (isAndroidWebView()) {
    try {
      const dataUrl = doc.output('datauristring');
      window.AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (_e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};

export const generateQuotationPDF = async (
  quotation: Quotation,
  shopDetails: ShopDetails,
  returnBlob: boolean = false
) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const marginLeft = 15;
  const marginRight = 15;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const centerX = pageWidth / 2;

  const quotationNo = quotation.quotationNumber || `QT-${Date.now()}`;

  // ── Background Watermark ──────────────────────────────────────────────────
  try {
    const wmSize = 80;
    const wmX = (pageWidth - wmSize) / 2;
    const wmY = (pageHeight - wmSize) / 2;
    doc.saveGraphicsState();
    doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
    doc.addImage(logoImg, 'PNG', wmX, wmY, wmSize, wmSize);
    doc.restoreGraphicsState();
  } catch (_e) { /* ignore watermark error */ }

  let yPos = 10;

  // ── Logo ──────────────────────────────────────────────────────────────────
  const logoW = 18;
  const logoH = 18;
  const logoX = marginLeft;
  const logoY = yPos + 1;
  try {
    doc.addImage(logoImg, 'PNG', logoX, logoY, logoW, logoH);
  } catch (_e) { /* no logo */ }

  // ── Shop / Company Profile Header (Full Width, No QR Code) ───────────────
  const textX = logoX + logoW + 4;
  const maxTextW = contentWidth - logoW - 4;

  // Shop Name
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  let hY = yPos + 5;
  doc.text(shopDetails.shopName || 'DIGITAL ZONE', textX, hY);

  // Address
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  hY += 5;
  if (shopDetails.address) {
    const addrLines: string[] = doc.splitTextToSize(shopDetails.address, maxTextW);
    doc.text(addrLines, textX, hY);
    hY += addrLines.length * 3.5;
  }

  // Contact Info Line: Phone | Email | Owner
  const contactParts = [];
  if (shopDetails.phone) contactParts.push(`Ph: ${shopDetails.phone}`);
  if (shopDetails.email) contactParts.push(`Email: ${shopDetails.email}`);
  if (shopDetails.ownerName) contactParts.push(`Prop: ${shopDetails.ownerName}`);
  const contactLine = contactParts.join('  |  ');
  if (contactLine) {
    doc.text(contactLine, textX, hY);
    hY += 3.5;
  }

  // GSTIN Line
  if (shopDetails.gst) {
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${shopDetails.gst}`, textX, hY);
    doc.setFont('helvetica', 'normal');
    hY += 3.5;
  }

  // Shop Description (if available)
  if (shopDetails.description) {
    doc.setFont('helvetica', 'italic');
    doc.text(shopDetails.description, textX, hY);
    doc.setFont('helvetica', 'normal');
    hY += 3.5;
  }

  yPos = Math.max(hY + 2, logoY + logoH + 2);

  // ── Top Divider ───────────────────────────────────────────────────────────
  doc.setLineWidth(0.5);
  doc.setDrawColor(0, 0, 0);
  doc.line(marginLeft, yPos, pageWidth - marginRight, yPos);

  // ── PRICE QUOTATION Banner ────────────────────────────────────────────────
  yPos += 6;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('PRICE QUOTATION', centerX, yPos, { align: 'center' });
  yPos += 4;
  doc.setLineWidth(0.3);
  doc.line(marginLeft, yPos, pageWidth - marginRight, yPos);

  // ── Dates & Ref Info ──────────────────────────────────────────────────────
  const createdDate = quotation.createdAt
    ? (typeof (quotation.createdAt as any).toDate === 'function'
      ? (quotation.createdAt as any).toDate()
      : new Date(quotation.createdAt))
    : new Date();
  const qDate = createdDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  let validDateStr = '30 Days';
  if (quotation.validUntil) {
    const vDate = typeof (quotation.validUntil as any).toDate === 'function'
      ? (quotation.validUntil as any).toDate()
      : new Date(quotation.validUntil);
    validDateStr = vDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  const salesPerson = quotation.createdByName || quotation.createdBy || 'Staff';

  // ── Two-Column Info Box: Quotation To | Quotation Details ─────────────────
  yPos += 2;
  const sectionTop = yPos;
  const colMid = marginLeft + contentWidth / 2;
  const sectionH = 28;
  const cellPadX = 4;
  const cellPadTop = 6;
  const lineH = 5;

  // LEFT: Quotation To
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('QUOTATION TO:', marginLeft + cellPadX, sectionTop + cellPadTop);
  doc.setFont('helvetica', 'normal');
  let currentY = sectionTop + cellPadTop + lineH;
  doc.text(quotation.customerName || 'Valued Customer', marginLeft + cellPadX, currentY);
  if (quotation.customerPhone && quotation.customerPhone !== 'N/A') {
    currentY += lineH;
    doc.text(`Phone: ${quotation.customerPhone}`, marginLeft + cellPadX, currentY);
  }
  if (quotation.customerAddress) {
    currentY += lineH;
    const addr = quotation.customerAddress;
    const truncatedAddr = addr.length > 45 ? addr.substring(0, 42) + '...' : addr;
    doc.text(`Address: ${truncatedAddr}`, marginLeft + cellPadX, currentY);
  }
  if (quotation.customerGstNo) {
    currentY += lineH;
    doc.text(`GST No: ${quotation.customerGstNo}`, marginLeft + cellPadX, currentY);
  }

  // RIGHT: Quotation Details
  const rX = colMid + cellPadX;
  const vX = colMid + cellPadX + 28;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Quotation No :', rX, sectionTop + cellPadTop);
  doc.text('Date         :', rX, sectionTop + cellPadTop + lineH);
  doc.text('Valid Until  :', rX, sectionTop + cellPadTop + lineH * 2);
  doc.text('Prepared By  :', rX, sectionTop + cellPadTop + lineH * 3);
  doc.setFont('helvetica', 'normal');
  doc.text(quotationNo, vX, sectionTop + cellPadTop);
  doc.text(qDate, vX, sectionTop + cellPadTop + lineH);
  doc.text(validDateStr, vX, sectionTop + cellPadTop + lineH * 2);
  doc.text(salesPerson, vX, sectionTop + cellPadTop + lineH * 3);

  yPos = sectionTop + sectionH;

  // Border around box
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.rect(marginLeft, sectionTop, contentWidth, sectionH);
  doc.setLineWidth(0.2);
  doc.line(colMid, sectionTop, colMid, sectionTop + sectionH);

  // ── Items Table ───────────────────────────────────────────────────────────
  const items: QuotationItem[] = quotation.items || [];
  const formatRs = (amt: number) => `Rs.${Number(amt).toFixed(2)}`;

  let subtotal = 0;
  let totalDiscounts = 0;
  let totalGstAmount = 0;

  const tableHead = [['S.No', 'Description of Goods / Services', 'Qty', 'Unit', 'Rate', 'Disc%', 'GST%', 'Amount']];

  const tableData = items.map((item, idx) => {
    const qty = Number(item.quantity || 1);
    const rate = Number(item.rate || 0);
    const lineGross = rate * qty;
    subtotal += lineGross;

    let itemDiscAmount = 0;
    let discPctNum = 0;
    if (item.discountType === 'percent') {
      discPctNum = Number(item.discount || 0);
      itemDiscAmount = (lineGross * discPctNum) / 100;
    } else {
      itemDiscAmount = Number(item.discount || 0);
      discPctNum = lineGross > 0 ? (itemDiscAmount / lineGross) * 100 : 0;
    }
    totalDiscounts += itemDiscAmount;

    const lineAfterDisc = lineGross - itemDiscAmount;
    const netUnitPrice = qty > 0 ? lineAfterDisc / qty : rate;
    const taxPercent = Number(item.taxPercent || quotation.gstRate || 0);

    let lineGst = 0;
    if (taxPercent > 0 && item.gstEnabled !== false) {
      lineGst = lineAfterDisc - (lineAfterDisc / (1 + taxPercent / 100));
      totalGstAmount += lineGst;
    }

    const finalLineAmt = item.amount !== undefined ? item.amount : lineAfterDisc;

    let desc = item.title || 'Item';
    if (itemDiscAmount > 0) {
      desc += `\nReal Price: ${formatRs(rate)}  |  Disc: ${formatRs(itemDiscAmount / qty)}  |  Disc Price: ${formatRs(netUnitPrice)}`;
    } else {
      desc += `\nReal Price: ${formatRs(rate)}`;
    }

    if (item.description) {
      desc += `\nNote: ${item.description}`;
    }

    const discPctDisplay = discPctNum > 0 ? `${discPctNum % 1 === 0 ? discPctNum.toFixed(0) : discPctNum.toFixed(1)}%` : '0%';

    return [
      (idx + 1).toString(),
      desc,
      qty.toString(),
      item.unit || 'Nos',
      formatRs(rate),
      discPctDisplay,
      taxPercent > 0 ? `${taxPercent}%` : '0%',
      formatRs(finalLineAmt)
    ];
  });

  autoTable(doc, {
    startY: yPos + 5,
    head: tableHead,
    body: tableData,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, lineColor: [80, 80, 80], lineWidth: 0.1 },
    headStyles: { fillColor: [240, 242, 245], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineWidth: 0.1, fontSize: 7.5 },
    bodyStyles: { textColor: [20, 20, 20], valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 76, halign: 'left' },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 11, halign: 'center' },
      7: { cellWidth: 25, halign: 'right' },
    },
    margin: { left: 15, right: 15 },
  });

  const tableEndY: number = (doc as any).lastAutoTable?.finalY || yPos + 35;

  // ── Financial Summary Calculations ────────────────────────────────────────
  const finalGrandTotal = quotation.grandTotal !== undefined ? quotation.grandTotal : Math.max(0, subtotal - totalDiscounts);
  const taxableValue = finalGrandTotal - totalGstAmount;

  const rowH = 6;
  interface SRow { label: string; value: string; bold: boolean; }
  const summaryRows: SRow[] = [];
  summaryRows.push({ label: 'Sub Total', value: formatRs(subtotal), bold: false });
  if (totalDiscounts > 0) {
    summaryRows.push({ label: 'Total Discounts', value: `- ${formatRs(totalDiscounts)}`, bold: false });
  }
  if (totalGstAmount > 0) {
    summaryRows.push({ label: 'Taxable Amount', value: formatRs(taxableValue), bold: false });
    summaryRows.push({ label: 'Total GST', value: formatRs(totalGstAmount), bold: false });
  }
  summaryRows.push({ label: 'GRAND TOTAL', value: formatRs(finalGrandTotal), bold: true });

  const summaryBoxH = summaryRows.length * rowH + 4;
  const footerHeight = 42;
  const totalBottomHeight = summaryBoxH + 6 + footerHeight;

  // Pin summary & bottom section neatly
  const summaryStartY = Math.max(tableEndY + 6, pageHeight - totalBottomHeight);

  // ── Amount Summary Box (Right Aligned) ────────────────────────────────────
  const boxW = 80;
  const boxX = pageWidth - 15 - boxW;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(boxX, summaryStartY, boxW, summaryBoxH);

  let sRowY = summaryStartY + rowH;
  for (let ri = 0; ri < summaryRows.length; ri++) {
    const { label, value, bold } = summaryRows[ri];
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9 : 8);
    doc.text(label + ':', boxX + 3, sRowY);
    doc.text(value, boxX + boxW - 3, sRowY, { align: 'right' });
    sRowY += rowH;
    if (ri < summaryRows.length - 1) {
      doc.setLineWidth(0.1);
      doc.line(boxX, sRowY - rowH + 2, boxX + boxW, sRowY - rowH + 2);
    }
  }

  // ── Left Side Details: Amount in Words & Notes ────────────────────────────
  let payY = summaryStartY + 4;
  const amountInWords = numberToWords(finalGrandTotal);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Amount in Words:', marginLeft, payY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const wordLines = doc.splitTextToSize(amountInWords, boxX - marginLeft - 6);
  doc.text(wordLines, marginLeft, payY + 5);
  payY += 5 + (wordLines.length * 4) + 3;

  if (quotation.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Notes / Remarks:', marginLeft, payY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const noteLines = doc.splitTextToSize(quotation.notes, boxX - marginLeft - 6);
    doc.text(noteLines, marginLeft, payY + 4);
  }

  // ── Bottom Footer Section ─────────────────────────────────────────────────
  const footerTop = Math.max(summaryStartY + summaryBoxH + 6, pageHeight - 42);

  doc.setLineWidth(0.4);
  doc.setDrawColor(0, 0, 0);
  doc.line(marginLeft, footerTop, pageWidth - marginRight, footerTop);

  // Left Side: Terms & Conditions
  let tY = footerTop + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Terms & Conditions:', marginLeft, tY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const terms = [
    '1. Prices quoted are valid for the duration specified in the quotation.',
    '2. Taxes are applicable as per government norms at the time of final billing.',
    '3. This quotation is an estimate and not a tax invoice.',
  ];
  terms.forEach(t => {
    tY += 3.8;
    doc.text(t, marginLeft, tY);
  });

  // Right Side: Authorized Signatory Block
  const sigX = pageWidth - marginRight - 55;
  const sigY = footerTop + 22;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`For ${shopDetails.shopName || 'Digital Zone'}`, sigX, sigY - 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Authorized Signatory', sigX, sigY);

  // ── Save / Download / WebView ─────────────────────────────────────────────
  const fileName = `Quotation_${quotationNo.replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`;

  if (returnBlob) {
    return {
      fileName,
      pdfData: doc.output('datauristring'),
      pdfBlob: doc.output('blob'),
    };
  }

  if (isAndroidWebView()) {
    try {
      const dataUrl = doc.output('datauristring');
      window.AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (_e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};

export {
  generateDailySettlementPDF,
  generateMonthlySettlementPDF,
} from './settlementPdfGenerator';
export type {
  GenerateDailySettlementParams,
  GenerateMonthlySettlementParams,
} from './settlementPdfGenerator';
