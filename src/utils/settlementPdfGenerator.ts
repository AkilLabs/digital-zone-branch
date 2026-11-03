import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  isExpenseItem,
  type BillingItem,
  type ShopDetails,
  type Settlement,
  type SettlementExpected,
  type SettlementActual,
} from '../types';
import logoImg from '../assets/logo.png';

// Android WebView bridge detection
const isAndroidWebView = () => typeof window !== 'undefined' && !!(window as any).AndroidInterface;

const resolveSalesPersonName = (item: BillingItem): string => {
  const raw = (item as any).salesPersonName || item.createdByName || item.createdBy || 'Staff';
  if (typeof raw === 'string' && raw.includes('@')) {
    return raw.split('@')[0];
  }
  return String(raw || 'Staff');
};

// ══════════════════════════════════════════════════════════════════════════════
// ── DAILY SETTLEMENT & MASTER FINANCIAL REPORT PDF ───────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

export interface GenerateDailySettlementParams {
  date: Date | string;
  shopDetails: ShopDetails;
  billingItems: BillingItem[];
  creditItems?: BillingItem[];
  expenseItems?: BillingItem[];
  expected: SettlementExpected;
  settlement?: Settlement | null;
  actual?: SettlementActual | null;
  settledByName?: string;
  returnBlob?: boolean;
}

export const generateDailySettlementPDF = (params: GenerateDailySettlementParams) => {
  const {
    date,
    shopDetails,
    billingItems,
    creditItems = [],
    expected,
    settlement,
    actual,
    settledByName,
    returnBlob = false,
  } = params;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  // Helpers
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const dateStr = dateObj.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const fileDateStr = dateObj.toISOString().slice(0, 10);

  const fmtCurrency = (amt: number): string => {
    const isNeg = amt < 0;
    const formatted = Math.abs(amt).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return isNeg ? `-Rs ${formatted}` : `Rs ${formatted}`;
  };

  const fmtTime = (d?: Date | any): string => {
    if (!d) return '--';
    const dateVal = d instanceof Date ? d : d.toDate ? d.toDate() : new Date(d);
    return isNaN(dateVal.getTime())
      ? '--'
      : dateVal.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // Separate sales & expenses (supporting both dedicated expenses collection and legacy billingItems)
  const salesItems = [...billingItems.filter(i => !isExpenseItem(i)), ...creditItems.filter(i => !isExpenseItem(i))];
  const rawExpenses = params.expenseItems
    ? [...params.expenseItems, ...billingItems.filter(isExpenseItem)]
    : billingItems.filter(isExpenseItem);
  const seenExpIds = new Set<string>();
  const expenseItems = rawExpenses.filter(item => {
    if (item.id && seenExpIds.has(item.id)) return false;
    if (item.id) seenExpIds.add(item.id);
    return true;
  });

  // Determine actuals and differences
  const currentActual: SettlementActual = actual || settlement?.actual || {
    cash: expected.cash,
    upi: expected.upi,
    card: expected.card,
    finance: expected.finance,
    credit: expected.credit,
    cheque: expected.cheque,
  };

  const cashDiff = (currentActual.cash ?? 0) - expected.cash;
  const upiDiff = (currentActual.upi ?? 0) - expected.upi;
  const cardDiff = (currentActual.card ?? 0) - expected.card;
  const financeDiff = (currentActual.finance ?? 0) - expected.finance;
  const creditDiff = (currentActual.credit ?? 0) - expected.credit;
  const chequeDiff = (currentActual.cheque ?? 0) - expected.cheque;
  const totalDiff = cashDiff + upiDiff + cardDiff + financeDiff + creditDiff + chequeDiff;

  const isSettled = settlement && settlement.status === 'settled';
  let statusBadgeText = 'DRAFT / UNSETTLED';
  let statusBadgeBg = [217, 119, 6]; // Amber
  if (isSettled || actual) {
    if (Math.abs(totalDiff) < 1) {
      statusBadgeText = 'SETTLED - BALANCED';
      statusBadgeBg = [22, 163, 74]; // Green
    } else if (totalDiff < 0) {
      statusBadgeText = `SETTLED - SHORTAGE (${fmtCurrency(totalDiff)})`;
      statusBadgeBg = [220, 38, 38]; // Red
    } else {
      statusBadgeText = `SETTLED - SURPLUS (${fmtCurrency(totalDiff)})`;
      statusBadgeBg = [37, 99, 235]; // Blue
    }
  }

  let yPos = 12;

  // ── HEADER SECTION ────────────────────────────────────────────────────────
  // Top decorative bar
  doc.setFillColor(30, 58, 138); // Deep Navy
  doc.rect(0, 0, pageWidth, 4, 'F');

  // Shop Logo
  const logoH = 12;
  const logoW = Math.round(logoH * 2.314);
  try {
    doc.addImage(logoImg, 'PNG', margin, yPos, logoW, logoH);
  } catch (_e) {
    // Graceful fallback if logo missing
  }

  // Shop Info (Left block)
  const shopX = margin + logoW + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42); // Slate 900
  doc.text(shopDetails.shopName || 'DIGITAL ZONE', shopX, yPos + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105); // Slate 600
  let infoY = yPos + 8.5;
  if (shopDetails.address) {
    const addr = doc.splitTextToSize(shopDetails.address, 95);
    doc.text(addr, shopX, infoY);
    infoY += addr.length * 3.5;
  }
  const contactText = [
    shopDetails.phone ? `Ph: ${shopDetails.phone}` : '',
    shopDetails.email ? `Email: ${shopDetails.email}` : '',
  ].filter(Boolean).join(' | ');
  if (contactText) {
    doc.text(contactText, shopX, infoY);
    infoY += 3.5;
  }
  if (shopDetails.gst) {
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${shopDetails.gst}`, shopX, infoY);
  }

  // Report Title & Badge (Right block)
  const rightX = pageWidth - margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 58, 138);
  doc.text('DAILY SETTLEMENT REPORT', rightX, yPos + 4, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(dateStr, rightX, yPos + 9, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
    rightX,
    yPos + 13,
    { align: 'right' }
  );

  // Status Badge Pill
  const badgeWidth = 62;
  const badgeHeight = 6.5;
  const badgeX = rightX - badgeWidth;
  const badgeY = yPos + 15;
  doc.setFillColor(statusBadgeBg[0], statusBadgeBg[1], statusBadgeBg[2]);
  doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(statusBadgeText, badgeX + badgeWidth / 2, badgeY + 4.5, { align: 'center' });

  yPos = Math.max(infoY + 4, badgeY + badgeHeight + 5);

  // Thin separator
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;

  // ── SECTION 1: FINANCIAL OVERVIEW KPI TILES ───────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Daily Financial Summary', margin, yPos);
  yPos += 3.5;

  const cardCols = 4;
  const cardGap = 3;
  const cardW = (contentWidth - cardGap * (cardCols - 1)) / cardCols;
  const cardH = 15;

  const grossSales = expected.totalSales + expected.totalDiscount;
  const netSales = expected.totalSales;
  const discounts = expected.totalDiscount;
  const expenses = expected.totalExpenses;
  const netDayProfit = expected.totalProfit - expected.totalExpenses;

  const kpis = [
    { label: 'GROSS SALES', val: fmtCurrency(grossSales), sub: `${expected.salesCount} Bills Sold`, color: [37, 99, 235] },
    { label: 'TOTAL DISCOUNT', val: fmtCurrency(discounts), sub: discounts > 0 ? 'Deducted from sales' : 'No discount', color: [168, 85, 247] },
    { label: 'NET SALES REVENUE', val: fmtCurrency(netSales), sub: 'After item discounts', color: [16, 185, 129] },
    { label: 'TOTAL EXPENSES', val: fmtCurrency(expenses), sub: `${expected.expenseCount} Recorded items`, color: [239, 68, 68] },
  ];

  kpis.forEach((kpi, idx) => {
    const cx = margin + idx * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, yPos, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.roundedRect(cx, yPos, 1.5, cardH, 0.5, 0.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + 4, yPos + 4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.val, cx + 4, yPos + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(kpi.sub, cx + 4, yPos + 13);
  });

  yPos += cardH + 3.5;

  // Second row of KPIs (Net Profit, Expected Cash, Transactions, Audit)
  const kpisRow2 = [
    {
      label: 'NET OPERATING PROFIT',
      val: fmtCurrency(netDayProfit),
      sub: 'Gross Margin - Expenses',
      color: netDayProfit >= 0 ? [16, 185, 129] : [239, 68, 68],
    },
    {
      label: 'EXPECTED CASH IN HAND',
      val: fmtCurrency(expected.cash),
      sub: 'System Cash Sales',
      color: [245, 158, 11],
    },
    {
      label: 'TOTAL TRANSACTIONS',
      val: `${expected.transactionCount} Entries`,
      sub: `${expected.salesCount} Sales • ${expected.expenseCount} Expenses`,
      color: [14, 165, 233],
    },
    {
      label: 'SETTLEMENT AUDIT',
      val: isSettled ? 'SETTLED' : 'OPEN / PENDING',
      sub: settledByName ? `By ${settledByName}` : (settlement?.settledByName ? `By ${settlement.settledByName}` : 'Awaiting Sign-off'),
      color: isSettled ? [16, 185, 129] : [217, 119, 6],
    },
  ];

  kpisRow2.forEach((kpi, idx) => {
    const cx = margin + idx * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, yPos, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.roundedRect(cx, yPos, 1.5, cardH, 0.5, 0.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + 4, yPos + 4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.val, cx + 4, yPos + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(kpi.sub, cx + 4, yPos + 13);
  });

  yPos += cardH + 6;

  // ── SECTION 2: PAYMENT MODES & RECONCILIATION TABLE ───────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Payment Reconciliation & Settlement Audit', margin, yPos);
  yPos += 2.5;

  const reconRows = [
    [
      'Cash Counter',
      fmtCurrency(expected.cash),
      fmtCurrency(currentActual.cash ?? 0),
      fmtCurrency(cashDiff),
      Math.abs(cashDiff) < 1 ? 'Balanced' : cashDiff < 0 ? `Shortage (${fmtCurrency(cashDiff)})` : `Surplus (${fmtCurrency(cashDiff)})`,
    ],
    [
      'UPI / QR Payment',
      fmtCurrency(expected.upi),
      fmtCurrency(currentActual.upi ?? 0),
      fmtCurrency(upiDiff),
      Math.abs(upiDiff) < 1 ? 'Balanced' : upiDiff < 0 ? `Shortage (${fmtCurrency(upiDiff)})` : `Surplus (${fmtCurrency(upiDiff)})`,
    ],
    [
      'Card (POS Machine)',
      fmtCurrency(expected.card),
      fmtCurrency(currentActual.card ?? 0),
      fmtCurrency(cardDiff),
      Math.abs(cardDiff) < 1 ? 'Balanced' : cardDiff < 0 ? `Shortage (${fmtCurrency(cardDiff)})` : `Surplus (${fmtCurrency(cardDiff)})`,
    ],
    [
      'Finance / EMI',
      fmtCurrency(expected.finance),
      fmtCurrency(currentActual.finance ?? 0),
      fmtCurrency(financeDiff),
      Math.abs(financeDiff) < 1 ? 'Balanced' : financeDiff < 0 ? `Shortage (${fmtCurrency(financeDiff)})` : `Surplus (${fmtCurrency(financeDiff)})`,
    ],
    [
      'Customer Credit (Due)',
      fmtCurrency(expected.credit),
      fmtCurrency(currentActual.credit ?? 0),
      fmtCurrency(creditDiff),
      Math.abs(creditDiff) < 1 ? 'Balanced' : 'Pending Verification',
    ],
    [
      'Cheque / Bank Transfer',
      fmtCurrency(expected.cheque),
      fmtCurrency(currentActual.cheque ?? 0),
      fmtCurrency(chequeDiff),
      Math.abs(chequeDiff) < 1 ? 'Balanced' : 'Pending Clearance',
    ],
  ];

  const totalExpectedSales = expected.cash + expected.upi + expected.card + expected.finance + expected.credit + expected.cheque;
  const totalActualCounted = (currentActual.cash ?? 0) + (currentActual.upi ?? 0) + (currentActual.card ?? 0) + (currentActual.finance ?? 0) + (currentActual.credit ?? 0) + (currentActual.cheque ?? 0);

  autoTable(doc, {
    startY: yPos,
    head: [['Payment Method', 'Expected (System)', 'Actual Counted', 'Difference', 'Reconciliation Status']],
    body: reconRows,
    foot: [[
      'TOTAL RECONCILIATION',
      fmtCurrency(totalExpectedSales),
      fmtCurrency(totalActualCounted),
      fmtCurrency(totalDiff),
      Math.abs(totalDiff) < 1 ? 'ALL ACCOUNTS BALANCED' : totalDiff < 0 ? `NET SHORTAGE: ${fmtCurrency(totalDiff)}` : `NET SURPLUS: ${fmtCurrency(totalDiff)}`,
    ]],
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      font: 'helvetica',
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 45, fontStyle: 'bold' },
      1: { cellWidth: 32, halign: 'right' },
      2: { cellWidth: 32, halign: 'right' },
      3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 45, halign: 'center' },
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 8,
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        const text = String(data.cell.raw);
        if (text.startsWith('-')) {
          data.cell.styles.textColor = [220, 38, 38];
        } else if (text !== 'Rs 0.00' && !text.includes('0.00')) {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
      if (data.section === 'body' && data.column.index === 4) {
        const status = String(data.cell.raw);
        if (status.includes('Shortage')) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else if (status.includes('Balanced')) {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
    },
  });

  yPos = (doc as any).lastAutoTable.finalY + 4;

  // Notes Box (if any)
  const notesText = settlement?.notes || actual?.notes;
  if (notesText) {
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, yPos, contentWidth, 8, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(146, 64, 14);
    doc.text('Settlement Notes & Discrepancy Reason:', margin + 3, yPos + 5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 53, 15);
    doc.text(doc.splitTextToSize(notesText, contentWidth - 65), margin + 62, yPos + 5);
    yPos += 11;
  }

  // ── SECTION 3: ITEMIZED DAILY EXPENSES ────────────────────────────────────
  if (yPos > pageHeight - 55) {
    doc.addPage();
    yPos = 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`3. Itemized Daily Expenses (${expenseItems.length} Entries)`, margin, yPos);
  yPos += 2.5;

  const expenseTableData = expenseItems.length > 0
    ? expenseItems.map((item, idx) => {
        const qty = Number(item.quantity || 1);
        const cost = Number(item.cost || item.sellingPrice || 0);
        const total = cost * qty;
        const cat = item.expenseCategory || (item as any).category || item.type || 'General';
        return [
          String(idx + 1),
          fmtTime(item.createdAt),
          item.title || item.description || 'Expense',
          cat.toUpperCase(),
          (item.paymentMode || 'CASH').toUpperCase(),
          fmtCurrency(total),
        ];
      })
    : [['-', '--', 'No store expenses recorded for this day', '--', '--', fmtCurrency(0)]];

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Time', 'Expense Description / Paid To', 'Category', 'Payment Mode', 'Amount']],
    body: expenseTableData,
    foot: expenseItems.length > 0 ? [[
      '',
      '',
      'TOTAL STORE EXPENSES',
      '',
      '',
      fmtCurrency(expected.totalExpenses),
    ]] : undefined,
    theme: 'grid',
    styles: {
      fontSize: 7,
      cellPadding: 1.8,
      font: 'helvetica',
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [220, 38, 38],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 70 },
      3: { cellWidth: 30, halign: 'center' },
      4: { cellWidth: 26, halign: 'center' },
      5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
    },
    footStyles: {
      fillColor: [254, 242, 242],
      textColor: [185, 28, 28],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 6;

  // ── SECTION 4: SALESPERSON PERFORMANCE SUMMARY ────────────────────────────
  if (yPos > pageHeight - 55) {
    doc.addPage();
    yPos = 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('4. Salesperson Performance Summary', margin, yPos);
  yPos += 2.5;

  const spMap = new Map<string, { bills: Set<string>; items: number; qty: number; revenue: number; profit: number; cash: number; digital: number }>();
  salesItems.forEach((item, idx) => {
    const spName = resolveSalesPersonName(item);
    const qty = Number(item.quantity || 1);
    const sellingPrice = Number(item.sellingPrice || 0);
    const totalWithGst = Number(item.totalWithGst || 0);
    const disc = Number(item.itemDiscount || item.discountAmount || 0);
    const netTotal = totalWithGst > 0 ? totalWithGst : Math.max(0, sellingPrice * qty - disc);
    const cost = Number(item.cost || 0) * qty;
    const profit = Number(item.totalProfit || 0) || (netTotal - cost);
    const txKey = item.transactionId || item.invoiceNumber || item.id || `tx-${idx}`;

    if (!spMap.has(spName)) {
      spMap.set(spName, { bills: new Set(), items: 0, qty: 0, revenue: 0, profit: 0, cash: 0, digital: 0 });
    }
    const entry = spMap.get(spName)!;
    entry.bills.add(txKey);
    entry.items += 1;
    entry.qty += qty;
    entry.revenue += netTotal;
    entry.profit += profit;
    if (item.paymentMode === 'cash') entry.cash += netTotal;
    else if (item.paymentMode === 'split') {
      entry.cash += Number(item.paymentSplit?.cash || 0);
      entry.digital += Number(item.paymentSplit?.upi || 0) + Number(item.paymentSplit?.card || 0);
    } else {
      entry.digital += netTotal;
    }
  });

  const spRows = spMap.size > 0
    ? Array.from(spMap.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([name, st], i) => [
          String(i + 1),
          name,
          String(st.bills.size),
          String(st.qty),
          fmtCurrency(st.cash),
          fmtCurrency(st.digital),
          fmtCurrency(st.revenue),
          expected.totalSales > 0 ? `${((st.revenue / expected.totalSales) * 100).toFixed(1)}%` : '0%',
        ])
    : [['-', 'No salesperson sales recorded', '0', '0', fmtCurrency(0), fmtCurrency(0), fmtCurrency(0), '0%']];

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Salesperson Name', 'Bills', 'Qty Sold', 'Cash Sales', 'UPI/Card/Other', 'Total Revenue', 'Share %']],
    body: spRows,
    theme: 'grid',
    styles: {
      fontSize: 7,
      cellPadding: 1.8,
      font: 'helvetica',
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 46, fontStyle: 'bold' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      7: { cellWidth: 18, halign: 'center' },
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 6;

  // ── SECTION 5: DAILY SALES TRANSACTIONS ───────────────────────────────────
  if (yPos > pageHeight - 55) {
    doc.addPage();
    yPos = 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`5. Daily Sales Transactions (${salesItems.length} Items)`, margin, yPos);
  yPos += 2.5;

  const salesTableData = salesItems.length > 0
    ? salesItems.map((item, idx) => {
        const qty = Number(item.quantity || 1);
        const sellingPrice = Number(item.sellingPrice || 0);
        const totalWithGst = Number(item.totalWithGst || 0);
        const disc = Number(item.itemDiscount || item.discountAmount || 0);
        const netTotal = totalWithGst > 0 ? totalWithGst : Math.max(0, sellingPrice * qty - disc);
        const invNo = item.invoiceNumber || (item.transactionId ? item.transactionId.slice(0, 10) : item.id?.slice(0, 8) || 'N/A');
        const cust = item.customerName || (item.type === 'credit' ? (item as any).creditCustomerName || 'Credit Walk-in' : 'Walk-in');
        const spName = resolveSalesPersonName(item);
        const mode = item.paymentMode === 'split' ? 'SPLIT' : (item.paymentMode || 'CASH').toUpperCase();

        return [
          String(idx + 1),
          fmtTime(item.createdAt),
          invNo,
          cust,
          spName,
          `${item.title || 'Item'} (x${qty})`,
          mode,
          disc > 0 ? fmtCurrency(disc) : '-',
          fmtCurrency(netTotal),
        ];
      })
    : [['-', '--', '--', '--', '--', 'No sales transactions recorded for this day', '--', '--', fmtCurrency(0)]];

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Time', 'Bill / Ref', 'Customer', 'Sold By', 'Product / Service', 'Mode', 'Disc', 'Net Amount']],
    body: salesTableData,
    foot: salesItems.length > 0 ? [[
      '',
      '',
      '',
      'TOTAL SALES REVENUE',
      '',
      `${salesItems.length} items sold`,
      '',
      fmtCurrency(expected.totalDiscount),
      fmtCurrency(expected.totalSales),
    ]] : undefined,
    theme: 'grid',
    styles: {
      fontSize: 6.8,
      cellPadding: 1.6,
      font: 'helvetica',
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.2,
    },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      1: { cellWidth: 15, halign: 'center' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 25 },
      4: { cellWidth: 22 },
      5: { cellWidth: 43 },
      6: { cellWidth: 16, halign: 'center' },
      7: { cellWidth: 16, halign: 'right' },
      8: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 7.2,
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 8;

  // ── SECTION 5: VERIFICATION & AUTHORIZATION SIGNATURES ─────────────────────
  if (yPos > pageHeight - 35) {
    doc.addPage();
    yPos = 16;
  }

  const sigBoxW = (contentWidth - 20) / 2;
  const sigBoxH = 22;

  // Cashier / Staff box
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, yPos, sigBoxW, sigBoxH, 1, 1);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Prepared & Reconciled By:', margin + 4, yPos + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(settledByName || settlement?.settledByName || 'Store Cashier / Staff', margin + 4, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Signature & Date:', margin + 4, yPos + sigBoxH - 3);

  // Store Manager / Owner box
  const sig2X = margin + sigBoxW + 20;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(sig2X, yPos, sigBoxW, sigBoxH, 1, 1);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Verified & Approved By:', sig2X + 4, yPos + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${shopDetails.shopName || 'Digital Zone'} (Owner / Manager)`, sig2X + 4, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Authorized Signature & Stamp:', sig2X + 4, yPos + sigBoxH - 3);

  // ── MULTI-PAGE NUMBERING & FOOTER ─────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 8, pageWidth - margin, pageHeight - 8);

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${shopDetails.shopName || 'Digital Zone'} • Daily Sales, Expense & Settlement Audit Report • Confidential`,
      margin,
      pageHeight - 4.5
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 4.5, { align: 'right' });
  }

  // ── SAVE & DOWNLOAD ───────────────────────────────────────────────────────
  const fileName = `Settlement_Daily_${fileDateStr}.pdf`;

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
      (window as any).AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (_e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};


// ══════════════════════════════════════════════════════════════════════════════
// ── MONTHLY SETTLEMENT & MASTER FINANCIAL REPORT PDF ─────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

export interface GenerateMonthlySettlementParams {
  monthDate: Date | string;
  shopDetails: ShopDetails;
  monthlyExpected: SettlementExpected;
  monthlyItems: BillingItem[];
  monthlyCreditItems?: BillingItem[];
  monthlyExpenseItems?: BillingItem[];
  dailyBreakdown: Array<{
    dateStr: string;
    expected: SettlementExpected;
    settlement?: Settlement | null;
    count: number;
  }>;
  monthlySettlements: Settlement[];
  returnBlob?: boolean;
}

export const generateMonthlySettlementPDF = (params: GenerateMonthlySettlementParams) => {
  const {
    monthDate,
    shopDetails,
    monthlyExpected,
    monthlyItems,
    monthlyCreditItems: _monthlyCreditItems = [],
    dailyBreakdown,
    monthlySettlements,
    returnBlob = false,
  } = params;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  // Helpers
  const dateObj = typeof monthDate === 'string' ? new Date(monthDate) : monthDate;
  const monthNameStr = dateObj.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const fileMonthStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

  const fmtCurrency = (amt: number): string => {
    const isNeg = amt < 0;
    const formatted = Math.abs(amt).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return isNeg ? `-Rs ${formatted}` : `Rs ${formatted}`;
  };

  // Metrics
  const grossSales = monthlyExpected.totalSales + monthlyExpected.totalDiscount;
  const netSales = monthlyExpected.totalSales;
  const totalDiscounts = monthlyExpected.totalDiscount;
  const totalExpenses = monthlyExpected.totalExpenses;
  const netProfit = monthlyExpected.totalProfit - monthlyExpected.totalExpenses;
  const activeDays = dailyBreakdown.filter(d => d.expected.totalSales > 0 || d.expected.totalExpenses > 0).length;
  const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
  const settledDaysCount = monthlySettlements.length;

  let yPos = 12;

  // ── HEADER ────────────────────────────────────────────────────────────────
  doc.setFillColor(30, 58, 138); // Deep Navy bar
  doc.rect(0, 0, pageWidth, 4, 'F');

  // Shop Logo
  const logoH = 12;
  const logoW = Math.round(logoH * 2.314);
  try {
    doc.addImage(logoImg, 'PNG', margin, yPos, logoW, logoH);
  } catch (_e) {
    // Graceful fallback
  }

  // Shop Info
  const shopX = margin + logoW + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(shopDetails.shopName || 'DIGITAL ZONE', shopX, yPos + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  let infoY = yPos + 8.5;
  if (shopDetails.address) {
    const addr = doc.splitTextToSize(shopDetails.address, 95);
    doc.text(addr, shopX, infoY);
    infoY += addr.length * 3.5;
  }
  const contactText = [
    shopDetails.phone ? `Ph: ${shopDetails.phone}` : '',
    shopDetails.email ? `Email: ${shopDetails.email}` : '',
  ].filter(Boolean).join(' | ');
  if (contactText) {
    doc.text(contactText, shopX, infoY);
    infoY += 3.5;
  }
  if (shopDetails.gst) {
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${shopDetails.gst}`, shopX, infoY);
  }

  // Title & Month Block
  const rightX = pageWidth - margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 58, 138);
  doc.text('MONTHLY FINANCIAL & SETTLEMENT', rightX, yPos + 4, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(monthNameStr.toUpperCase(), rightX, yPos + 9, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Audit Period: 01 to ${daysInMonth} ${dateObj.toLocaleDateString('en-IN', { month: 'short' })}`, rightX, yPos + 13, { align: 'right' });

  // Settlement Compliance Badge
  const compliancePct = activeDays > 0 ? Math.round((settledDaysCount / activeDays) * 100) : 100;
  const badgeWidth = 65;
  const badgeHeight = 6.5;
  const badgeX = rightX - badgeWidth;
  const badgeY = yPos + 15;
  doc.setFillColor(compliancePct >= 90 ? 22 : compliancePct >= 60 ? 217 : 220, compliancePct >= 90 ? 163 : compliancePct >= 60 ? 119 : 38, compliancePct >= 90 ? 74 : compliancePct >= 60 ? 6 : 38);
  doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(`SETTLED: ${settledDaysCount} OF ${activeDays} DAYS (${compliancePct}%)`, badgeX + badgeWidth / 2, badgeY + 4.5, { align: 'center' });

  yPos = Math.max(infoY + 4, badgeY + badgeHeight + 5);

  // Line separator
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;

  // ── SECTION 1: MONTHLY EXECUTIVE SUMMARY TILES ────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Monthly Executive Financial Overview', margin, yPos);
  yPos += 3.5;

  const cardCols = 4;
  const cardGap = 3;
  const cardW = (contentWidth - cardGap * (cardCols - 1)) / cardCols;
  const cardH = 15;

  const monthKpisRow1 = [
    { label: 'GROSS SALES REVENUE', val: fmtCurrency(grossSales), sub: `${monthlyExpected.salesCount} Sales Total`, color: [37, 99, 235] },
    { label: 'TOTAL DISCOUNTS GIVEN', val: fmtCurrency(totalDiscounts), sub: `${grossSales > 0 ? ((totalDiscounts / grossSales) * 100).toFixed(1) : 0}% of Gross Sales`, color: [168, 85, 247] },
    { label: 'NET SALES REVENUE', val: fmtCurrency(netSales), sub: 'Discount Adjusted', color: [16, 185, 129] },
    { label: 'OPERATING EXPENSES', val: fmtCurrency(totalExpenses), sub: `${monthlyExpected.expenseCount} Expense items`, color: [239, 68, 68] },
  ];

  monthKpisRow1.forEach((kpi, idx) => {
    const cx = margin + idx * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, yPos, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.roundedRect(cx, yPos, 1.5, cardH, 0.5, 0.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + 4, yPos + 4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.val, cx + 4, yPos + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(kpi.sub, cx + 4, yPos + 13);
  });

  yPos += cardH + 3.5;

  const monthKpisRow2 = [
    { label: 'NET OPERATING PROFIT', val: fmtCurrency(netProfit), sub: 'Gross Profit - Expenses', color: netProfit >= 0 ? [16, 185, 129] : [239, 68, 68] },
    { label: 'CASH SALES COLLECTED', val: fmtCurrency(monthlyExpected.cash), sub: `${netSales > 0 ? ((monthlyExpected.cash / netSales) * 100).toFixed(1) : 0}% of collections`, color: [245, 158, 11] },
    { label: 'DIGITAL / BANK (UPI/CARD)', val: fmtCurrency(monthlyExpected.upi + monthlyExpected.card), sub: `UPI: ${fmtCurrency(monthlyExpected.upi)} • Card: ${fmtCurrency(monthlyExpected.card)}`, color: [14, 165, 233] },
    { label: 'ACTIVE WORKING DAYS', val: `${activeDays} Days`, sub: `${daysInMonth} calendar days in month`, color: [99, 102, 241] },
  ];

  monthKpisRow2.forEach((kpi, idx) => {
    const cx = margin + idx * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, yPos, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.roundedRect(cx, yPos, 1.5, cardH, 0.5, 0.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + 4, yPos + 4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.val, cx + 4, yPos + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(kpi.sub, cx + 4, yPos + 13);
  });

  yPos += cardH + 6;

  // ── SECTION 2: PAYMENT MODES & EXPENSE CATEGORY TABLES ────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Monthly Collections & Expense Categories', margin, yPos);
  yPos += 2.5;

  // Payment Breakdown data
  const totalCollected = monthlyExpected.cash + monthlyExpected.upi + monthlyExpected.card + monthlyExpected.finance + monthlyExpected.credit + monthlyExpected.cheque;
  const payModes = [
    { mode: 'Cash', val: monthlyExpected.cash },
    { mode: 'UPI / QR', val: monthlyExpected.upi },
    { mode: 'Debit/Credit Card', val: monthlyExpected.card },
    { mode: 'Finance / EMI', val: monthlyExpected.finance },
    { mode: 'Customer Credit', val: monthlyExpected.credit },
    { mode: 'Cheque / Bank', val: monthlyExpected.cheque },
  ];

  const payTableRows = payModes.map(m => [
    m.mode,
    fmtCurrency(m.val),
    totalCollected > 0 ? `${((m.val / totalCollected) * 100).toFixed(1)}%` : '0%',
  ]);

  // Expense Category data
  const expenseMap = new Map<string, number>();
  const rawMonthlyExp = params.monthlyExpenseItems
    ? [...params.monthlyExpenseItems, ...monthlyItems.filter(isExpenseItem)]
    : monthlyItems.filter(isExpenseItem);
  const seenMExp = new Set<string>();
  const monthlyExpenses = rawMonthlyExp.filter(e => {
    if (e.id && seenMExp.has(e.id)) return false;
    if (e.id) seenMExp.add(e.id);
    return true;
  });
  for (const exp of monthlyExpenses) {
    const cat = exp.expenseCategory || (exp as any).category || exp.type || 'General';
    const catName = cat.charAt(0).toUpperCase() + cat.slice(1);
    const cost = Number(exp.cost || exp.sellingPrice || 0) * Number(exp.quantity || 1);
    expenseMap.set(catName, (expenseMap.get(catName) || 0) + cost);
  }

  const expTableRows = expenseMap.size > 0
    ? Array.from(expenseMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => [
          cat,
          fmtCurrency(amt),
          totalExpenses > 0 ? `${((amt / totalExpenses) * 100).toFixed(1)}%` : '0%',
        ])
    : [['General Store Expenses', fmtCurrency(totalExpenses), '100%']];

  // Render Table A (Payment modes) on left
  const halfTableW = (contentWidth - 6) / 2;

  autoTable(doc, {
    startY: yPos,
    head: [['Payment Mode', 'Revenue', 'Share']],
    body: payTableRows,
    foot: [['TOTAL COLLECTION', fmtCurrency(totalCollected), '100%']],
    tableWidth: halfTableW,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.8, font: 'helvetica' },
    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
      1: { cellWidth: 30, halign: 'right' },
      2: { cellWidth: 22, halign: 'center' },
    },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
    margin: { left: margin },
  });

  const payTableFinalY = (doc as any).lastAutoTable.finalY;

  // Render Table B (Expense categories) on right
  autoTable(doc, {
    startY: yPos,
    head: [['Expense Category', 'Amount', 'Share']],
    body: expTableRows,
    foot: [['TOTAL EXPENSES', fmtCurrency(totalExpenses), '100%']],
    tableWidth: halfTableW,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.8, font: 'helvetica' },
    headStyles: { fillColor: [220, 38, 38], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: 'bold' },
      1: { cellWidth: 30, halign: 'right' },
      2: { cellWidth: 22, halign: 'center' },
    },
    footStyles: { fillColor: [254, 242, 242], textColor: [185, 28, 28], fontStyle: 'bold', fontSize: 7.5 },
    margin: { left: margin + halfTableW + 6 },
  });

  const expTableFinalY = (doc as any).lastAutoTable.finalY;
  yPos = Math.max(payTableFinalY, expTableFinalY) + 6;

  // ── SECTION 3: MONTHLY SALESPERSON PERFORMANCE SUMMARY ────────────────────
  if (yPos > pageHeight - 55) {
    doc.addPage();
    yPos = 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Monthly Salesperson Performance Summary', margin, yPos);
  yPos += 2.5;

  const monthlySalesOnly = [...monthlyItems.filter(i => !isExpenseItem(i)), ...(_monthlyCreditItems || []).filter(i => !isExpenseItem(i))];
  const mSpMap = new Map<string, { bills: Set<string>; qty: number; revenue: number; profit: number; cash: number; digital: number }>();
  monthlySalesOnly.forEach((item, idx) => {
    const spName = resolveSalesPersonName(item);
    const qty = Number(item.quantity || 1);
    const sellingPrice = Number(item.sellingPrice || 0);
    const totalWithGst = Number(item.totalWithGst || 0);
    const disc = Number(item.itemDiscount || item.discountAmount || 0);
    const netTotal = totalWithGst > 0 ? totalWithGst : Math.max(0, sellingPrice * qty - disc);
    const cost = Number(item.cost || 0) * qty;
    const profit = Number(item.totalProfit || 0) || (netTotal - cost);
    const txKey = item.transactionId || item.invoiceNumber || item.id || `mtx-${idx}`;

    if (!mSpMap.has(spName)) {
      mSpMap.set(spName, { bills: new Set(), qty: 0, revenue: 0, profit: 0, cash: 0, digital: 0 });
    }
    const entry = mSpMap.get(spName)!;
    entry.bills.add(txKey);
    entry.qty += qty;
    entry.revenue += netTotal;
    entry.profit += profit;
    if (item.paymentMode === 'cash') entry.cash += netTotal;
    else if (item.paymentMode === 'split') {
      entry.cash += Number(item.paymentSplit?.cash || 0);
      entry.digital += Number(item.paymentSplit?.upi || 0) + Number(item.paymentSplit?.card || 0);
    } else {
      entry.digital += netTotal;
    }
  });

  const mSpRows = mSpMap.size > 0
    ? Array.from(mSpMap.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([name, st], i) => [
          String(i + 1),
          name,
          String(st.bills.size),
          String(st.qty),
          fmtCurrency(st.cash),
          fmtCurrency(st.digital),
          fmtCurrency(st.revenue),
          netSales > 0 ? `${((st.revenue / netSales) * 100).toFixed(1)}%` : '0%',
        ])
    : [['-', 'No salesperson sales recorded', '0', '0', fmtCurrency(0), fmtCurrency(0), fmtCurrency(0), '0%']];

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Salesperson Name', 'Bills', 'Qty Sold', 'Cash Sales', 'UPI/Card/Other', 'Total Revenue', 'Share %']],
    body: mSpRows,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.8, font: 'helvetica', textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 46, fontStyle: 'bold' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      7: { cellWidth: 18, halign: 'center' },
    },
    margin: { left: margin, right: margin },
  });

  yPos = (doc as any).lastAutoTable.finalY + 6;

  // ── SECTION 4: DAY-BY-DAY MASTER BREAKDOWN TABLE ───────────────────────────
  if (yPos > pageHeight - 55) {
    doc.addPage();
    yPos = 14;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('4. Day-by-Day Financial Breakdown & Settlement Status', margin, yPos);
  yPos += 2.5;

  let grandBills = 0;
  let grandGross = 0;
  let grandDisc = 0;
  let grandNet = 0;
  let grandExp = 0;
  let grandProfit = 0;

  const dayRows = dailyBreakdown.map(day => {
    const dayDate = new Date(day.dateStr);
    const dayLabel = dayDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const weekday = dayDate.toLocaleDateString('en-IN', { weekday: 'short' });

    const dayGross = day.expected.totalSales + day.expected.totalDiscount;
    const dayDisc = day.expected.totalDiscount;
    const dayNet = day.expected.totalSales;
    const dayExpense = day.expected.totalExpenses;
    const dayProfit = day.expected.totalProfit - day.expected.totalExpenses;

    grandBills += day.count;
    grandGross += dayGross;
    grandDisc += dayDisc;
    grandNet += dayNet;
    grandExp += dayExpense;
    grandProfit += dayProfit;

    const isDaySettled = !!day.settlement;
    const cashVariance = day.settlement ? (day.settlement.actual.cash - day.settlement.expected.cash) : 0;
    let statusText = 'Unsettled';
    if (isDaySettled) {
      if (Math.abs(cashVariance) < 1) statusText = 'Balanced';
      else if (cashVariance < 0) statusText = `Short (${fmtCurrency(cashVariance)})`;
      else statusText = `Surplus (${fmtCurrency(cashVariance)})`;
    }

    return [
      `${dayLabel} (${weekday})`,
      String(day.count),
      fmtCurrency(dayGross),
      dayDisc > 0 ? fmtCurrency(dayDisc) : '-',
      fmtCurrency(dayNet),
      fmtCurrency(dayExpense),
      fmtCurrency(dayProfit),
      isDaySettled ? statusText : 'OPEN',
      isDaySettled ? (Math.abs(cashVariance) < 1 ? 'Balanced' : fmtCurrency(cashVariance)) : '--',
    ];
  });

  autoTable(doc, {
    startY: yPos,
    head: [['Date', 'Bills', 'Gross (Rs)', 'Disc (Rs)', 'Net Sales', 'Expenses', 'Net Profit', 'Status', 'Cash Diff']],
    body: dayRows,
    foot: [[
      'MONTH GRAND TOTALS',
      String(grandBills),
      fmtCurrency(grandGross),
      fmtCurrency(grandDisc),
      fmtCurrency(grandNet),
      fmtCurrency(grandExp),
      fmtCurrency(grandProfit),
      `${settledDaysCount}/${activeDays}`,
      '--',
    ]],
    theme: 'grid',
    styles: {
      fontSize: 6.8,
      cellPadding: 1.5,
      font: 'helvetica',
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.2,
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 26, halign: 'left', fontStyle: 'bold' },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 20, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      7: { cellWidth: 18, halign: 'center' },
      8: { cellWidth: 28, halign: 'center' },
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 7.2,
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.section === 'body') {
        if (data.column.index === 6) {
          const val = String(data.cell.raw);
          if (val.startsWith('-')) data.cell.styles.textColor = [220, 38, 38];
          else data.cell.styles.textColor = [22, 163, 74];
        }
        if (data.column.index === 7) {
          const val = String(data.cell.raw);
          if (val === 'SETTLED') data.cell.styles.textColor = [22, 163, 74];
          else data.cell.styles.textColor = [217, 119, 6];
        }
      }
    },
  });

  yPos = (doc as any).lastAutoTable.finalY + 8;

  // ── SECTION 5: AUTHORIZATION & SIGNATURES ─────────────────────────────────
  if (yPos > pageHeight - 35) {
    doc.addPage();
    yPos = 16;
  }

  const sigBoxW = (contentWidth - 20) / 2;
  const sigBoxH = 22;

  // In-charge signature
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, yPos, sigBoxW, sigBoxH, 1, 1);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Prepared & Compiled By:', margin + 4, yPos + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Accounts & Store In-Charge', margin + 4, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Signature & Date:', margin + 4, yPos + sigBoxH - 3);

  // Owner signature
  const sig2X = margin + sigBoxW + 20;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(sig2X, yPos, sigBoxW, sigBoxH, 1, 1);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('Audited & Approved By:', sig2X + 4, yPos + 4.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(`For ${shopDetails.shopName || 'Digital Zone'} (Managing Director / Owner)`, sig2X + 4, yPos + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Authorized Signatory & Stamp:', sig2X + 4, yPos + sigBoxH - 3);

  // ── MULTI-PAGE NUMBERING & FOOTER ─────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 8, pageWidth - margin, pageHeight - 8);

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${shopDetails.shopName || 'Digital Zone'} • Monthly Sales, Expense & Settlement Audit Report (${monthNameStr})`,
      margin,
      pageHeight - 4.5
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 4.5, { align: 'right' });
  }

  // ── SAVE & DOWNLOAD ───────────────────────────────────────────────────────
  const fileName = `Settlement_Monthly_${fileMonthStr}.pdf`;

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
      (window as any).AndroidInterface?.downloadPDF(dataUrl, fileName);
    } catch (_e) {
      doc.save(fileName);
    }
  } else {
    doc.save(fileName);
  }
};
