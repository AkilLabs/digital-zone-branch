import logoImg from '../assets/logo.png';
import type { StockTransfer, StockTransferItem } from '../types';

// Convert number to words in Indian numbering system
export const numberToWordsINR = (num: number): string => {
  if (!num || num === 0) return 'Zero Rupees Only';

  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = [
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertTwoDigits = (n: number): string => {
    if (n < 10) return units[n];
    if (n >= 10 && n < 20) return teens[n - 10];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + units[n % 10] : '');
  };

  const convertThreeDigits = (n: number): string => {
    if (n === 0) return '';
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? units[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? convertTwoDigits(r) : '');
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

  result = result.trim() + ' Rupees';

  if (paise > 0) {
    result += ' and ' + convertTwoDigits(paise) + ' Paise';
  }

  return result.trim() + ' Only';
};

export interface PrintableStockTransfer {
  id?: string;
  fromStoreId?: string;
  fromStoreName?: string;
  fromName?: string;
  toStoreId?: string;
  toStoreName?: string;
  toName?: string;
  items?: StockTransferItem[];
  totalItems?: number;
  totalQuantity?: number;
  totalValue?: number;
  status?: string;
  notes?: string;
  createdAt?: any;
  date?: any;
  createdBy?: string;
  createdByName?: string;
}

export interface PrintStockTransferOptions {
  transfer: PrintableStockTransfer | StockTransfer;
  hubName?: string;
  hubAddress?: string;
  hubPhone?: string;
  hubEmail?: string;
  hubGst?: string;
  consignorAddress?: string;
  consigneeAddress?: string;
}

export function printStockTransferInvoice(options: PrintStockTransferOptions): void {
  const {
    transfer,
    hubName = 'DIGITAL ZONE',
    hubAddress = 'Head Office & Central Warehouse',
    hubPhone = '+91 98765 43210',
    hubEmail = 'support@digitalzone.com',
    hubGst = '33AAAAA0000A1Z5',
    consignorAddress,
    consigneeAddress,
  } = options;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to open and print the Stock Transfer Invoice.');
    return;
  }

  // Build absolute logo URL
  const absoluteLogoUrl =
    typeof logoImg === 'string' && (logoImg.startsWith('data:') || logoImg.startsWith('http'))
      ? logoImg
      : `${window.location.origin}${logoImg && logoImg.startsWith('/') ? '' : '/'}${logoImg || 'logo.png'}`;

  // Format date and time
  const t = transfer as any;
  const originName = t.fromStoreName || t.fromName || 'Central Warehouse';
  const destinationName = t.toStoreName || t.toName || 'Branch Store';
  const rawDate = t.createdAt || t.date;
  const transferDate =
    rawDate instanceof Date
      ? rawDate
      : rawDate
      ? new Date(rawDate)
      : new Date();

  const formattedDate = transferDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const formattedTime = transferDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const items = transfer.items || [];
  const totalQty = transfer.totalQuantity || items.reduce((s, i) => s + (i.quantity || 0), 0);
  const totalValuation =
    transfer.totalValue || items.reduce((s, i) => s + (i.cost || 0) * (i.quantity || 0), 0);
  const totalSkus = transfer.totalItems || items.length;

  const amountInWords = numberToWordsINR(totalValuation);

  const transferStatus = (transfer.status || 'Completed').toUpperCase();
  const transferId = transfer.id || 'N/A';
  const gatePassNo = `GP-${transferId.slice(0, 8).toUpperCase()}`;

  // Table items rows
  const itemsHtml = items
    .map((item: StockTransferItem, idx: number) => {
      const lineCost = (item.cost || 0) * (item.quantity || 0);
      return `
        <tr>
          <td style="text-align: center; color: #64748b; font-weight: 600;">${idx + 1}</td>
          <td>
            <div style="font-weight: 700; color: #0f172a; font-size: 11.5px;">${item.productName || 'Item'}</div>
            <div style="color: #64748b; font-size: 10px; margin-top: 1px;">
              ${item.brand ? `Brand: <strong>${item.brand}</strong>` : ''} 
              ${item.category ? `• Category: ${item.category}` : ''}
            </div>
            ${
              item.imei
                ? `<div style="display: inline-block; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 4px; padding: 1px 5px; font-family: monospace; font-size: 9.5px; margin-top: 3px;">
                    IMEI/SN: ${item.imei}
                   </div>`
                : ''
            }
          </td>
          <td style="font-family: monospace; font-size: 11px; color: #334155; font-weight: 600;">
            ${item.productCode || '—'}
          </td>
          <td style="text-align: center; font-size: 10.5px; color: #475569;">
            ${item.category || 'General'}
          </td>
          <td style="text-align: right; font-weight: 800; font-size: 12px; color: #0f172a;">
            ${item.quantity} <span style="font-size: 9.5px; font-weight: 500; color: #64748b;">PCS</span>
          </td>
          <td style="text-align: right; font-family: monospace; font-size: 11px; color: #334155;">
            ₹${(item.cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td style="text-align: right; font-weight: 700; font-family: monospace; font-size: 11.5px; color: #0f172a;">
            ₹${lineCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
        </tr>
      `;
    })
    .join('');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <base href="${window.location.origin}/">
        <title>Stock Transfer Invoice - ${transferId}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 10mm 12mm 12mm 12mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 16px;
            color: #0f172a;
            font-size: 11px;
            line-height: 1.4;
            background: #ffffff;
          }
          .invoice-card {
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            overflow: hidden;
            background: #ffffff;
          }

          /* Header Section */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 16px 20px;
            border-bottom: 2px solid #0f172a;
            background: #ffffff;
          }
          .brand-col {
            display: flex;
            align-items: center;
            gap: 14px;
          }
          .brand-logo {
            height: 48px;
            max-width: 140px;
            object-fit: contain;
          }
          .brand-info h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: #0f172a;
            text-transform: uppercase;
          }
          .brand-info p {
            margin: 2px 0 0 0;
            font-size: 10px;
            color: #64748b;
            font-weight: 500;
          }
          .doc-col {
            text-align: right;
          }
          .doc-title {
            font-size: 15px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #1e40af;
          }
          .doc-subtitle {
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            color: #64748b;
            margin-top: 1px;
          }
          .inv-badge {
            display: inline-block;
            margin-top: 4px;
            padding: 3px 8px;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            font-family: monospace;
            font-size: 11px;
            font-weight: 700;
            color: #0f172a;
          }

          /* Metadata Grid */
          .route-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            border-bottom: 1px solid #e2e8f0;
            background: #f8fafc;
          }
          .route-box {
            padding: 12px 18px;
          }
          .route-box.right {
            border-left: 1px solid #e2e8f0;
          }
          .box-label {
            font-size: 9px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: #64748b;
            margin-bottom: 3px;
          }
          .party-name {
            font-size: 13px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 2px;
          }
          .party-detail {
            font-size: 10px;
            color: #475569;
            line-height: 1.4;
          }

          /* Transport Strip */
          .transport-strip {
            display: grid;
            grid-template-columns: 1.2fr 1.2fr 1fr 1fr;
            padding: 8px 18px;
            background: #ffffff;
            border-bottom: 1px solid #cbd5e1;
            font-size: 10px;
          }
          .t-col strong {
            display: block;
            font-size: 8.5px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #64748b;
            margin-bottom: 2px;
          }
          .t-col span {
            font-weight: 600;
            color: #0f172a;
          }

          /* Table */
          table {
            width: 100%;
            border-collapse: collapse;
          }
          thead th {
            background: #f1f5f9;
            color: #334155;
            font-size: 9.5px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 8px 12px;
            border-bottom: 1.5px solid #cbd5e1;
          }
          tbody td {
            padding: 8px 12px;
            border-bottom: 1px solid #e2e8f0;
            font-size: 11px;
            vertical-align: middle;
          }
          tbody tr:nth-child(even) {
            background: #fafbfc;
          }

          /* Summary Section */
          .summary-section {
            display: grid;
            grid-template-columns: 1.5fr 1fr;
            padding: 12px 18px;
            background: #ffffff;
            border-top: 1.5px solid #cbd5e1;
            gap: 16px;
          }
          .notes-box {
            font-size: 10px;
            color: #475569;
          }
          .words-block {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 8px 10px;
            margin-top: 6px;
          }
          .words-label {
            font-size: 8.5px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #64748b;
          }
          .words-text {
            font-size: 10.5px;
            font-weight: 700;
            color: #0f172a;
            margin-top: 1px;
          }
          .declaration {
            font-size: 8.5px;
            color: #64748b;
            line-height: 1.4;
            margin-top: 8px;
            border-left: 2px solid #94a3b8;
            padding-left: 6px;
          }

          .totals-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          .totals-table td {
            padding: 4px 6px;
          }
          .totals-table td.label {
            color: #64748b;
            text-align: right;
          }
          .totals-table td.value {
            font-weight: 700;
            text-align: right;
            font-family: monospace;
          }
          .totals-table tr.grand-total {
            border-top: 1.5px solid #0f172a;
            font-size: 13px;
          }
          .totals-table tr.grand-total td {
            padding-top: 8px;
            font-weight: 800;
            color: #0f172a;
          }

          /* Signatures */
          .sig-section {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
            padding: 30px 18px 14px 18px;
            border-top: 1px solid #cbd5e1;
            background: #ffffff;
            text-align: center;
          }
          .sig-box {
            padding-top: 8px;
            border-top: 1px dashed #64748b;
          }
          .sig-title {
            font-size: 10px;
            font-weight: 700;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          .sig-sub {
            font-size: 8.5px;
            color: #64748b;
            margin-top: 2px;
          }

          /* Footer notice */
          .footer-bar {
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            padding: 6px 18px;
            font-size: 8.5px;
            color: #94a3b8;
            display: flex;
            justify-content: space-between;
          }

          @media print {
            body {
              padding: 0;
            }
            .invoice-card {
              border: 1px solid #94a3b8;
            }
          }
        </style>
      </head>
      <body>
        <div class="invoice-card">
          <!-- Header Bar with Logo -->
          <div class="header">
            <div class="brand-col">
              <img src="${absoluteLogoUrl}" alt="Logo" class="brand-logo" onerror="this.style.display='none'" />
              <div class="brand-info">
                <h1>${hubName}</h1>
                <p>Central Inventory & Multi-Branch Logistics Division</p>
                <p>GSTIN: <strong>${hubGst}</strong> • Phone: ${hubPhone} • ${hubEmail}</p>
                <p>${hubAddress}</p>
              </div>
            </div>
            <div class="doc-col">
              <div class="doc-title">Stock Transfer Invoice</div>
              <div class="doc-subtitle">Delivery Challan & Gate Pass</div>
              <div class="inv-badge">#${transferId}</div>
              <div style="font-size: 9.5px; color: #64748b; margin-top: 4px;">
                Date: <strong>${formattedDate}</strong>, ${formattedTime}
              </div>
            </div>
          </div>

          <!-- Consignor / Consignee Route Grid -->
          <div class="route-grid">
            <div class="route-box">
              <div class="box-label">Dispatched From (Consignor / Origin)</div>
              <div class="party-name">${originName}</div>
              <div class="party-detail">
                ${consignorAddress ? `<div>${consignorAddress}</div>` : `<div>Central Logistics Hub, Head Office</div>`}
                <div>Dispatch Operator: <strong>${transfer.createdByName || transfer.createdBy || 'Warehouse Admin'}</strong></div>
                <div>Location ID: <span style="font-family: monospace;">${transfer.fromStoreId || 'HQ'}</span></div>
              </div>
            </div>
            <div class="route-box right">
              <div class="box-label">Delivered To (Consignee / Destination Branch)</div>
              <div class="party-name">${destinationName}</div>
              <div class="party-detail">
                ${consigneeAddress ? `<div>${consigneeAddress}</div>` : `<div>Branch Retail Store & Warehouse</div>`}
                <div>Destination Code: <span style="font-family: monospace;">${transfer.toStoreId || 'STORE'}</span></div>
                <div>Transfer Status: <strong style="color: #1e40af;">${transferStatus}</strong></div>
              </div>
            </div>
          </div>

          <!-- Transport & Gate Pass Details Bar -->
          <div class="transport-strip">
            <div class="t-col">
              <strong>Gate Pass Ref No.</strong>
              <span>${gatePassNo}</span>
            </div>
            <div class="t-col">
              <strong>Carrier / Vehicle Notes</strong>
              <span>${transfer.notes ? transfer.notes : 'Company Transit / Handover'}</span>
            </div>
            <div class="t-col">
              <strong>Movement Nature</strong>
              <span>Inter-Branch Stock Balancing</span>
            </div>
            <div class="t-col">
              <strong>Statutory Compliance</strong>
              <span>Delivery Challan (Rule 55)</span>
            </div>
          </div>

          <!-- Itemized Table -->
          <table>
            <thead>
              <tr>
                <th style="width: 32px; text-align: center;">#</th>
                <th style="text-align: left;">Item Description & Specifications</th>
                <th style="width: 120px; text-align: left;">SKU / Code</th>
                <th style="width: 90px; text-align: center;">Category</th>
                <th style="width: 70px; text-align: right;">Qty</th>
                <th style="width: 95px; text-align: right;">Transfer Rate</th>
                <th style="width: 110px; text-align: right;">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <!-- Summary & Totals Block -->
          <div class="summary-section">
            <div class="notes-box">
              <div class="words-block">
                <div class="words-label">Amount in Words (Transfer Valuation):</div>
                <div class="words-text">${amountInWords}</div>
              </div>
              <div class="declaration">
                <strong>Non-Commercial Declaration:</strong> This stock transfer invoice / delivery challan is issued for inter-store stock movement between branches of the same legal entity. This transfer does not constitute a sale, and no sale proceeds are receivable.
              </div>
            </div>
            <div>
              <table class="totals-table">
                <tr>
                  <td class="label">Total Unique SKUs:</td>
                  <td class="value">${totalSkus}</td>
                </tr>
                <tr>
                  <td class="label">Total Units Transferred:</td>
                  <td class="value">${totalQty} PCS</td>
                </tr>
                <tr class="grand-total">
                  <td class="label">Total Consignment Value:</td>
                  <td class="value" style="color: #1e40af;">₹${totalValuation.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </div>
          </div>

          <!-- Signature & Verification Sign-off -->
          <div class="sig-section">
            <div class="sig-box">
              <div class="sig-title">Prepared & Dispatched By</div>
              <div class="sig-sub">Central Warehouse Supervisor</div>
            </div>
            <div class="sig-box">
              <div class="sig-title">Driver / Gate Security</div>
              <div class="sig-sub">Vehicle Verified & Released</div>
            </div>
            <div class="sig-box">
              <div class="sig-title">Received & Verified By</div>
              <div class="sig-sub">Branch Store Manager & Seal</div>
            </div>
          </div>

          <!-- Bottom Micro Footer -->
          <div class="footer-bar">
            <span>Generated electronically via ${hubName} ERP System</span>
            <span>Page 1 of 1 • System Ref: ${transferId}</span>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();

  // Print automatically after styles & images load
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 350);
  };
}
