import { useState, useEffect, useMemo } from 'react';
import { X, Printer, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { useStore } from '../context/StoreContext';
import { db } from '../config/firebase';
import { getDoc, getDocs, setDoc, runTransaction, Timestamp } from 'firebase/firestore';
import logo from '../assets/logo.png';
import type { ServiceRequest, ShopDetails } from '../types';
import { getBranchServicePrefix } from '../utils/serviceSequence';

interface PrintServiceQRLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopName?: string;
  job?: ServiceRequest | null;
}

interface LabelItem {
  code: string;
  displayCode: string;
  qrDataUrl: string;
  deviceModel: string;
  customerNameOnly: string;
  phoneOnly: string;
  faultInfo: string;
  dateInfo: string;
}

export default function PrintServiceQRLabelsModal({
  isOpen,
  onClose,
  shopName: initialShopName = 'Digital Zone',
  job = null
}: PrintServiceQRLabelsModalProps) {
  const { getCollectionRef, getDocRef, currentStore, stores } = useStore();
  const [shopName, setShopName] = useState<string>(initialShopName);
  const [startNum, setStartNum] = useState<number>(1);
  const [count, setCount] = useState<number>(job ? 2 : 12);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');

  // Fetch shopDetails to ensure shopName is live from settings
  useEffect(() => {
    const fetchShopDetails = async () => {
      try {
        const docRef = getDocRef('settings', 'shopDetails');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data() as ShopDetails;
          if (data.shopName && data.shopName.trim()) {
            setShopName(data.shopName.trim());
          }
        }
      } catch (err) {
        console.error('Failed to load shop details', err);
      }
    };

    if (isOpen) {
      fetchShopDetails();
    }
  }, [isOpen, getDocRef]);

  // Derive standardized branch service prefix (e.g. DZ-AN, DZ-MDU, DZ-HUB)
  const shopPrefix = useMemo(() => {
    return getBranchServicePrefix(currentStore, stores);
  }, [currentStore, stores]);

  // Update default count if job changes
  useEffect(() => {
    if (job) {
      setCount(2);
    } else {
      setCount(12);
    }
  }, [job]);

  // Convert logo to base64 for reliable printing
  useEffect(() => {
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

  // Fetch / bootstrap systematic start number for pre-printed batches
  useEffect(() => {
    const resolveStartNumber = async () => {
      if (!isOpen) return;

      // If a specific job is provided, resolve its numeric sequence
      if (job) {
        const rawCode = job.jobSheetNumber || job.qrCodeValue || '';
        const match = rawCode.match(/(\d+)$/);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num)) {
            setStartNum(num);
            return;
          }
        }
        setStartNum(1);
        return;
      }

      setLoading(true);
      try {
        const counterDocRef = getDocRef('counters', 'serviceJobCounter');
        const counterCheck = await getDoc(counterDocRef);
        if (counterCheck.exists()) {
          setStartNum(counterCheck.data().nextJobNumber || 1);
        } else {
          // Bootstrap by scanning existing serviceRequests
          const snap = await getDocs(getCollectionRef('serviceRequests'));
          let maxNum = 0;
          snap.forEach((docSnap) => {
            const data = docSnap.data();
            const code = data.jobSheetNumber || data.qrCodeValue || '';
            const match = code.match(/(\d+)$/);
            if (match && match[1]) {
              const num = parseInt(match[1], 10);
              if (!isNaN(num)) {
                maxNum = Math.max(maxNum, num);
              }
            }
          });
          const nextNum = maxNum + 1;
          await setDoc(counterDocRef, {
            nextJobNumber: nextNum,
            lastUpdated: Timestamp.now()
          });
          setStartNum(nextNum);
        }
      } catch (err) {
        console.error('Failed to resolve start number:', err);
      } finally {
        setLoading(false);
      }
    };

    resolveStartNumber();
  }, [isOpen, job, getCollectionRef, getDocRef]);

  // Generate labels based on resolved startNum, count, shopPrefix, and job mode
  const generateLabels = async () => {
    if (!startNum && !job) return;
    setLoading(true);
    const items: LabelItem[] = [];
    const baseUrl =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'https://the-legend-mobiles.vercel.app';

    const formattedDate = (d?: Date | string) => {
      if (!d) return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const parsed = new Date(d);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      }
      return String(d);
    };

    if (job) {
      // Specific Job Mode: all stickers carry this job's details
      const rawCode = job.jobSheetNumber || job.qrCodeValue || `TLM-${String(startNum).padStart(4, '0')}`;
      // Replace TLM- with shopPrefix- for display
      const displayCode = rawCode.toUpperCase().startsWith('TLM-')
        ? `${shopPrefix}-${rawCode.substring(4)}`
        : rawCode.includes('-')
        ? rawCode
        : `${shopPrefix}-${rawCode}`;

      const url = `${baseUrl}/view-job/${rawCode}`;
      const deviceModel =
        [job.brand, job.modelName].filter(Boolean).join(' ') ||
        job.productName ||
        'Mobile Device';
      const customerNameOnly = job.customerName || 'Walk-in Customer';
      const phoneOnly = job.mobile ? job.mobile : '-';
      const faultInfo =
        (job.issues && job.issues.length > 0 ? job.issues.slice(0, 2).join(', ') : job.issueNotes) ||
        'Repair Service';
      const dateInfo = formattedDate(job.jobDate || job.createdAt);

      try {
        const qrDataUrl = await QRCode.toDataURL(url, {
          margin: 1,
          width: 250,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#FFFFFF' }
        });

        for (let i = 0; i < count; i++) {
          items.push({
            code: rawCode,
            displayCode,
            qrDataUrl,
            deviceModel,
            customerNameOnly,
            phoneOnly,
            faultInfo,
            dateInfo
          });
        }
      } catch (err) {
        console.error('Failed to generate QR for specific job label:', err);
      }
    } else {
      // Pre-printed Batch Mode: sequential codes using dynamic shopPrefix with fillable intake lines
      for (let i = 0; i < count; i++) {
        const codeNum = startNum + i;
        const systematicCode = `${shopPrefix}-${String(codeNum).padStart(4, '0')}`;
        const url = `${baseUrl}/view-job/${systematicCode}`;
        try {
          const qrDataUrl = await QRCode.toDataURL(url, {
            margin: 1,
            width: 250,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#FFFFFF' }
          });
          items.push({
            code: systematicCode,
            displayCode: systematicCode,
            qrDataUrl,
            deviceModel: '____________________',
            customerNameOnly: '____________________',
            phoneOnly: '____________________',
            faultInfo: '____________________',
            dateInfo: '___ / ___ / 2026'
          });
        } catch (err) {
          console.error('Failed to generate QR for pre-printed label code:', codeNum, err);
        }
      }
    }

    setLabels(items);
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen && (startNum || job)) {
      generateLabels();
    }
  }, [isOpen, startNum, count, job, shopPrefix]);

  if (!isOpen) return null;

  const handlePrint = async () => {
    setLoading(true);
    try {
      // Only increment counter if in pre-printed batch mode
      if (!job) {
        const counterDocRef = getDocRef('counters', 'serviceJobCounter');
        await runTransaction(db, async (transaction) => {
          const counterDoc = await transaction.get(counterDocRef);
          const currentNumber = counterDoc.exists()
            ? counterDoc.data().nextJobNumber || 1
            : startNum;
          transaction.set(
            counterDocRef,
            {
              nextJobNumber: currentNumber + count,
              lastUpdated: Timestamp.now()
            },
            { merge: true }
          );
        });

        setStartNum((prev) => prev + count);
      }

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Pop-up blocked! Please allow pop-ups to print QR label sheet.');
        return;
      }

      // Group labels into pages of 48 labels each (12 rows of 4 columns)
      const labelsPerPage = 48;
      let allPagesHTML = '';
      for (let i = 0; i < labels.length; i += labelsPerPage) {
        const pageLabels = labels
          .slice(i, i + labelsPerPage)
          .map((lbl) => {
            return `
            <div class="label">
              <div class="label-content">
                <div class="label-header">
                  <div class="header-left">
                    <img src="${logoDataUrl || logo}" alt="Logo" class="label-logo" />
                    <div class="shop-name">${shopName}</div>
                  </div>
                  <div class="tag-badge">${shopPrefix} REPAIR</div>
                </div>
                
                <div class="label-body">
                  <div class="body-qr-container">
                    <img src="${lbl.qrDataUrl}" alt="QR" class="body-qr-code" />
                    <div class="qr-caption">SCAN TO TRACK</div>
                  </div>
                  <div class="job-details">
                    <div class="job-id-banner">
                      <span class="job-id-text">${lbl.displayCode}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">DEV:</span>
                      <span class="detail-value-dev">${lbl.deviceModel}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">CUST:</span>
                      <span class="detail-value">${lbl.customerNameOnly}</span>
                    </div>
                    <div class="detail-row-phone">
                      <span class="detail-label">PH:</span>
                      <span class="detail-value-phone">${lbl.phoneOnly}</span>
                    </div>
                    <div class="detail-row-fault">
                      <span class="detail-label">FAULT:</span>
                      <span class="detail-value-fault">${lbl.faultInfo}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">DATE:</span>
                      <span class="detail-value-date">${lbl.dateInfo}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
          })
          .join('');

        allPagesHTML += `
          <div class="labels-container">
            ${pageLabels}
          </div>
        `;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Service Job Stickers - ${job ? (job.jobSheetNumber || 'Job') : `${count} Stickers`}</title>
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
                font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
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
                border: 0.1mm solid #ddd;
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
                padding: 0.6mm 1.1mm;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
              }
              
              .label-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 0.3mm;
                border-bottom: 0.25px solid #cbd5e1;
                height: 3.5mm;
              }
              
              .header-left {
                display: flex;
                align-items: center;
                gap: 1mm;
                overflow: hidden;
              }
              
              .label-logo {
                width: 3.2mm;
                height: 3.2mm;
                object-fit: contain;
              }
              
              .shop-name {
                font-size: 5pt;
                font-weight: 800;
                text-transform: uppercase;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                color: #0f172a;
              }
              
              .tag-badge {
                font-size: 4.5pt;
                font-family: monospace;
                font-weight: 800;
                color: #2563eb;
                text-transform: uppercase;
                white-space: nowrap;
              }
              
              .label-body {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 1.5mm;
                overflow: hidden;
                padding-top: 0.5mm;
              }
              
              .body-qr-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
              }
              
              .body-qr-code {
                width: 16.5mm;
                height: 16.5mm;
                object-fit: contain;
                flex-shrink: 0;
              }
              
              .qr-caption {
                font-size: 3.4pt;
                font-weight: 800;
                color: #475569;
                text-transform: uppercase;
                letter-spacing: 0.2px;
                margin-top: 0.2mm;
                line-height: 1;
              }
              
              .job-details {
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: center;
                overflow: hidden;
                line-height: 1.15;
              }
              
              .job-id-banner {
                margin-bottom: 0.5mm;
                line-height: 1;
              }
              
              .job-id-text {
                font-size: 8.5pt;
                font-family: monospace;
                font-weight: 900;
                color: #0f172a;
                letter-spacing: 0.3px;
              }
              
              .detail-row {
                font-size: 4.8pt;
                color: #334155;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 0.2mm;
              }
              
              .detail-row-phone {
                font-size: 6.2pt;
                color: #0f172a;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 0.2mm;
              }
              
              .detail-row-fault {
                font-size: 6.2pt;
                color: #dc2626;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 0.2mm;
              }
              
              .detail-label {
                font-weight: 800;
                color: #64748b;
                display: inline-block;
                min-width: 8mm;
              }
              
              .detail-value {
                font-weight: 600;
                color: #0f172a;
              }
              
              .detail-value-dev {
                font-weight: 700;
                color: #1e293b;
              }
              
              .detail-value-phone {
                font-weight: 900;
                font-family: monospace;
                color: #0f172a;
              }
              
              .detail-value-fault {
                font-weight: 900;
                color: #dc2626;
              }
              
              .detail-value-date {
                font-family: monospace;
                color: #475569;
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
      `);
      printWindow.document.close();

      // Wait for content to load, then print
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          printWindow.close();
        }, 500);
      };
    } catch (err) {
      console.error('Failed to increment sequence / print:', err);
    } finally {
      setLoading(false);
    }
  };

  const sampleLabel = labels[0] || {
    code: job?.jobSheetNumber || `TLM-${String(startNum).padStart(4, '0')}`,
    displayCode: `${shopPrefix}-${String(startNum).padStart(4, '0')}`,
    qrDataUrl: '',
    deviceModel: job?.productName || '____________________',
    customerNameOnly: job?.customerName || '____________________',
    phoneOnly: job?.mobile || '____________________',
    faultInfo: job?.issues?.join(', ') || '____________________',
    dateInfo: '03 Nov 2026'
  };

  const startCodeFormatted = job
    ? sampleLabel.displayCode
    : `${shopPrefix}-${String(startNum).padStart(4, '0')}`;
  const endCodeFormatted = job
    ? sampleLabel.displayCode
    : `${shopPrefix}-${String(startNum + count - 1).padStart(4, '0')}`;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 sm:p-6 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <QrCode className="w-4 h-4" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-gray-900">
                {job ? `Print Sticker for Job #${sampleLabel.displayCode}` : 'Print Service Job Stickers'}
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mt-1">
              {job
                ? `Pre-filled sticker for ${job.customerName || 'customer'} (${job.productName || 'device'})`
                : `Compact 4.8cm × 2.4cm stickers with shop prefix (${shopPrefix}-) and large QR code`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Label Preview - Scaled 6x Preview (4.8cm × 2.4cm) with NO Footer & Enlarged QR/Text */}
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-gray-700 mb-2.5 text-center">
              Service Job Sheet Label Preview (Actual: 4.8cm × 2.4cm)
            </h3>
            <div className="rounded-xl p-5 bg-gray-100 flex justify-center">
              {/* Scaled preview - 6x scale for clarity (288px × 144px) */}
              <div
                className="bg-white shadow-md border border-gray-300 flex overflow-hidden rounded-md"
                style={{
                  width: '288px', // 48mm × 6
                  height: '144px' // 24mm × 6
                }}
              >
                <div className="flex flex-col justify-between w-full h-full p-[6px]">
                  {/* Top Bar: Shop Name + Tag */}
                  <div className="flex items-center justify-between border-b border-slate-200 pb-[3px] h-[22px]">
                    <div className="flex items-center gap-[4px] overflow-hidden">
                      <img
                        src={logoDataUrl || logo}
                        alt="Logo"
                        className="object-contain w-auto max-w-[28px] h-[18px]"
                      />
                      <div className="font-extrabold text-[9px] uppercase truncate text-slate-800">
                        {shopName}
                      </div>
                    </div>
                    <div className="font-mono text-[7.5px] text-blue-600 font-bold uppercase tracking-tight">
                      {shopPrefix} REPAIR
                    </div>
                  </div>

                  {/* Body - Large QR Code on Left, Enlarged Job ID, Phone, Fault on Right */}
                  <div className="flex-1 flex items-center gap-[8px] overflow-hidden py-[3px]">
                    {/* Left: Enlarged QR Code + Scan Caption */}
                    <div className="flex flex-col items-center justify-center shrink-0">
                      {sampleLabel.qrDataUrl ? (
                        <img
                          src={sampleLabel.qrDataUrl}
                          alt="QR"
                          className="w-[80px] h-[80px] object-contain"
                        />
                      ) : (
                        <div className="w-[80px] h-[80px] bg-gray-100 border border-gray-200 rounded flex items-center justify-center text-gray-400">
                          <QrCode className="w-8 h-8" />
                        </div>
                      )}
                      <span className="text-[6.5px] font-extrabold text-slate-500 uppercase tracking-tight mt-[1px]">
                        SCAN TO TRACK
                      </span>
                    </div>

                    {/* Right: Enlarged Service Job Details (No Footer Needed) */}
                    <div className="flex-1 flex flex-col justify-center overflow-hidden leading-tight space-y-[1px]">
                      {/* Big Job ID */}
                      <div>
                        <span className="font-mono text-[13px] font-black text-slate-900 bg-slate-100 border border-slate-300 px-1.5 py-[1px] rounded tracking-wide inline-block">
                          {sampleLabel.displayCode}
                        </span>
                      </div>

                      {/* Device */}
                      <div className="text-[8px] text-slate-700 truncate leading-snug">
                        <span className="font-bold text-slate-400 mr-1">DEV:</span>
                        <span className="font-bold text-slate-900">{sampleLabel.deviceModel}</span>
                      </div>

                      {/* Customer */}
                      <div className="text-[8px] text-slate-700 truncate leading-snug">
                        <span className="font-bold text-slate-400 mr-1">CUST:</span>
                        <span className="font-semibold text-slate-800">{sampleLabel.customerNameOnly}</span>
                      </div>

                      {/* Enlarged Phone Number */}
                      <div className="text-[9.5px] truncate leading-snug">
                        <span className="font-bold text-slate-400 mr-1">PH:</span>
                        <span className="font-black font-mono text-slate-900">{sampleLabel.phoneOnly}</span>
                      </div>

                      {/* Enlarged Fault in Red */}
                      <div className="text-[9.5px] truncate leading-snug">
                        <span className="font-bold text-slate-400 mr-1">FAULT:</span>
                        <span className="font-black text-rose-600">{sampleLabel.faultInfo}</span>
                      </div>

                      {/* Date */}
                      <div className="text-[7.5px] text-slate-500 truncate leading-snug">
                        <span className="font-bold text-slate-400 mr-1">DATE:</span>
                        <span className="font-mono text-slate-600">{sampleLabel.dateInfo}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Details Card */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2.5">
              {job ? 'Job Sticker Details' : 'Batch Sequence Information'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-gray-500 block">{job ? 'Job ID' : 'Start Sequence'}</span>
                <span className="font-mono font-bold text-gray-900 text-sm">{startCodeFormatted}</span>
              </div>
              <div>
                <span className="text-gray-500 block">{job ? 'Print Mode' : 'End Sequence'}</span>
                <span className="font-mono font-bold text-gray-900 text-sm">
                  {job ? 'Job Specific Tag' : endCodeFormatted}
                </span>
              </div>
              <div>
                <span className="text-gray-500 block">Total Stickers</span>
                <span className="font-bold text-blue-700 text-sm">
                  {count} Sticker{count > 1 ? 's' : ''}
                </span>
              </div>
              <div>
                <span className="text-gray-500 block">Paper Size</span>
                <span className="font-medium text-gray-800">A4 (48 Labels)</span>
              </div>
            </div>
          </div>

          {/* Quantity Selector */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Select Quantity to Print
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {(job ? [1, 2, 4, 8, 12, 16] : [8, 12, 16, 24, 32, 48]).map((qty) => (
                <button
                  key={qty}
                  type="button"
                  onClick={() => setCount(qty)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all ${
                    count === qty
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {qty} Label{qty > 1 ? 's' : ''} {qty === 48 ? '(1 Page)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handlePrint}
              disabled={loading || labels.length === 0}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-xs transition-all active:scale-[0.99] disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              {loading ? (
                <span>Generating Stickers...</span>
              ) : (
                <span>Print {count} Sticker{count > 1 ? 's' : ''}</span>
              )}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-semibold text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
