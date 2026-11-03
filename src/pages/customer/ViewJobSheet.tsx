import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { ServiceRequest, ShopDetails } from '../../types';
import { generateServiceJobPDF } from '../../utils/pdfGenerator';
import {
  Wrench,
  Clock,
  CheckCircle2,
  AlertCircle,
  Phone,
  MapPin,
  FileText,
  Download,
  Loader,
  ArrowLeft,
  Smartphone,
  CreditCard
} from 'lucide-react';
import logoImg from '../../assets/logo.png';
import QRCode from 'qrcode';

const STATUS_STEPS: Array<{ key: ServiceRequest['status']; label: string; description: string }> = [
  { key: 'received', label: 'Received', description: 'Device received & queued for inspection' },
  { key: 'repairing', label: 'In Repair', description: 'Technician is actively working on the device' },
  { key: 'serviced', label: 'Serviced / Ready', description: 'Repair completed & passed testing' },
  { key: 'delivered', label: 'Delivered', description: 'Device handed over to customer' }
];

export default function ViewJobSheet() {
  const params = useParams();
  const rawId = params['*'] ? decodeURIComponent(params['*']) : params.id;
  const targetId = rawId ? rawId.replace(/^\//, '').trim() : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState<ServiceRequest | null>(null);
  const [shopDetails, setShopDetails] = useState<ShopDetails>({
    shopName: 'Digital Zone',
    ownerName: '',
    address: 'Main Market, City Center',
    phone: '+91-XXXXXXXXXX',
    email: 'support@digitalzone.com',
    gst: '',
    upiId: '',
    merchantName: ''
  });
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  useEffect(() => {
    const fetchShopDetails = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'shopDetails'));
        if (snap.exists()) {
          setShopDetails((prev) => ({ ...prev, ...(snap.data() as ShopDetails) }));
        }
      } catch (err) {
        console.error('Failed to load shop details', err);
      }
    };
    fetchShopDetails();
  }, []);

  useEffect(() => {
    if (!targetId) {
      setError('Invalid or missing Job Sheet ID');
      setLoading(false);
      return;
    }

    const fetchJobSheet = async () => {
      try {
        setLoading(true);
        setError('');
        let foundData: ServiceRequest | null = null;

        // 1. Search in root serviceRequests by document ID
        try {
          const directDoc = await getDoc(doc(db, 'serviceRequests', targetId));
          if (directDoc.exists()) {
            foundData = { id: directDoc.id, ...directDoc.data() } as ServiceRequest;
          }
        } catch (_e) {
          // continue
        }

        // 2. Search root serviceRequests by jobSheetNumber
        if (!foundData) {
          try {
            const q = query(collection(db, 'serviceRequests'), where('jobSheetNumber', '==', targetId));
            const snap = await getDocs(q);
            if (!snap.empty) {
              const first = snap.docs[0];
              foundData = { id: first.id, ...first.data() } as ServiceRequest;
            }
          } catch (_e) {
            // continue
          }
        }

        // 3. Search root serviceRequests by qrCodeValue
        if (!foundData) {
          try {
            const q = query(collection(db, 'serviceRequests'), where('qrCodeValue', '==', targetId));
            const snap = await getDocs(q);
            if (!snap.empty) {
              const first = snap.docs[0];
              foundData = { id: first.id, ...first.data() } as ServiceRequest;
            }
          } catch (_e) {
            // continue
          }
        }

        // 4. Search across all stores using collectionGroup query for jobSheetNumber
        if (!foundData) {
          try {
            const q = query(collectionGroup(db, 'serviceRequests'), where('jobSheetNumber', '==', targetId));
            const snap = await getDocs(q);
            if (!snap.empty) {
              const first = snap.docs[0];
              foundData = { id: first.id, ...first.data() } as ServiceRequest;
            }
          } catch (_e) {
            // continue
          }
        }

        // 5. Search across all stores using collectionGroup query for qrCodeValue
        if (!foundData) {
          try {
            const q = query(collectionGroup(db, 'serviceRequests'), where('qrCodeValue', '==', targetId));
            const snap = await getDocs(q);
            if (!snap.empty) {
              const first = snap.docs[0];
              foundData = { id: first.id, ...first.data() } as ServiceRequest;
            }
          } catch (_e) {
            // continue
          }
        }

        // 6. Fallback: Search with alternative prefix (e.g. TLM-XXXX vs custom shop prefix)
        if (!foundData && targetId.includes('-')) {
          const numPart = targetId.split('-')[1];
          if (numPart) {
            const possiblePrefixes = ['TLM', 'DZ', 'JOB'];
            for (const pfx of possiblePrefixes) {
              const candidate = `${pfx}-${numPart}`;
              if (candidate === targetId) continue;
              try {
                const q = query(collection(db, 'serviceRequests'), where('jobSheetNumber', '==', candidate));
                const snap = await getDocs(q);
                if (!snap.empty) {
                  const first = snap.docs[0];
                  foundData = { id: first.id, ...first.data() } as ServiceRequest;
                  break;
                }
              } catch (_e) {
                // continue
              }
            }
          }
        }

        if (foundData) {
          setJob(foundData);
          // Generate page QR Code Data URL for display
          try {
            const currentUrl = window.location.href;
            const dataUrl = await QRCode.toDataURL(currentUrl, { margin: 1, width: 120 });
            setQrCodeDataUrl(dataUrl);
          } catch (_e) {
            /* ignore */
          }
        } else {
          setError(`No service job sheet found matching "${targetId}".`);
        }
      } catch (err) {
        console.error('Error fetching service job:', err);
        setError('Unable to load service job details. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchJobSheet();
  }, [targetId]);

  const handleDownloadPDF = async () => {
    if (!job) return;
    try {
      await generateServiceJobPDF(job, shopDetails, false);
    } catch (err) {
      console.error('Failed to generate PDF', err);
    }
  };

  const getCurrentStepIndex = (status?: ServiceRequest['status']) => {
    switch (status) {
      case 'received': return 0;
      case 'repairing': return 1;
      case 'serviced': return 2;
      case 'delivered': return 3;
      default: return 0;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Loader className="w-10 h-10 text-blue-600 animate-spin mb-3" />
        <p className="text-sm text-slate-600 font-medium">Fetching Job Sheet Status...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900 mb-1">Job Sheet Not Found</h2>
          <p className="text-sm text-slate-600 mb-6">{error || 'Invalid service job code.'}</p>
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium text-sm rounded-xl hover:bg-blue-700 transition-colors w-full"
          >
            <ArrowLeft className="w-4 h-4" /> Go to Home Page
          </Link>
        </div>
      </div>
    );
  }

  const currentStep = getCurrentStepIndex(job.status);
  const totalCost = Number(job.cost || job.approvedCost || 0);
  const advancePaid = Number(job.advancePaid || 0);
  const balanceDue = Number(job.balanceAmount ?? (totalCost - advancePaid));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-12">
      {/* Top Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Logo" className="w-8 h-8 object-contain rounded" />
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">
                {shopDetails.shopName || 'Digital Zone'}
              </h1>
              <p className="text-xs text-slate-500">Service Tracking Slip</p>
            </div>
          </div>
          <button
            onClick={handleDownloadPDF}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> PDF Copy
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
        {/* Main Status Header Card */}
        <div className="bg-white text-gray-900 rounded-lg p-5 border border-gray-200 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded-md text-xs font-semibold mb-2">
                <Wrench className="w-3.5 h-3.5" /> Service Job #{job.jobSheetNumber || targetId}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {job.brand ? `${job.brand} ${job.modelName || ''}` : job.productName || 'Device Repair'}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Customer: <span className="font-semibold text-gray-800">{job.customerName}</span>
                {job.mobile && ` (${job.mobile})`}
              </p>
            </div>

            {qrCodeDataUrl && (
              <div className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm text-center hidden sm:block">
                <img src={qrCodeDataUrl} alt="QR Code" className="w-16 h-16" />
                <span className="block text-[9px] text-gray-500 font-medium mt-0.5">Scan Code</span>
              </div>
            )}
          </div>

          {/* Status Timeline */}
          <div className="pt-3 border-t border-gray-200">
            <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">Repair Workflow Status</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STATUS_STEPS.map((step, idx) => {
                const isCompleted = idx <= currentStep;
                const isCurrent = idx === currentStep;
                return (
                  <div
                    key={step.key}
                    className={`p-2.5 rounded-lg border transition-all ${
                      isCurrent
                        ? 'bg-blue-50 border-blue-400 text-blue-700 ring-1 ring-blue-300'
                        : isCompleted
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-gray-50 border-gray-200 text-gray-400'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {isCompleted ? (
                        <CheckCircle2 className={`w-4 h-4 ${isCurrent ? 'text-blue-600' : 'text-emerald-600'}`} />
                      ) : (
                        <Clock className="w-4 h-4 text-gray-400" />
                      )}
                      <span className={`text-xs font-bold ${isCurrent ? 'text-blue-700' : isCompleted ? 'text-emerald-800' : 'text-gray-500'}`}>
                        {step.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 leading-tight hidden sm:block">{step.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Device & Issue Overview Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Device Details Card */}
          <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm">
              <Smartphone className="w-4 h-4 text-blue-600" /> Device & Lock Info
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Brand & Model:</span>
                <span className="font-semibold text-slate-900">{job.brand} {job.modelName}</span>
              </div>
              {job.color && (
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Device Color:</span>
                  <span className="font-medium text-slate-800">{job.color}</span>
                </div>
              )}
              {(job.imei1 || job.serialNumber) && (
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">IMEI / Serial No:</span>
                  <span className="font-mono font-medium text-slate-800">{job.imei1 || job.serialNumber}</span>
                </div>
              )}
              {job.serviceType && (
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Service Type:</span>
                  <span className="font-medium capitalize text-slate-800">{job.serviceType}</span>
                </div>
              )}
              {job.estimatedRepairTime && (
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Est. Repair Time:</span>
                  <span className="font-medium text-slate-800">{job.estimatedRepairTime}</span>
                </div>
              )}
            </div>
          </div>

          {/* Reported Complaint & Issues Card */}
          <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm">
              <FileText className="w-4 h-4 text-amber-600" /> Reported Issues
            </div>
            {job.issues && job.issues.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {job.issues.map((iss, i) => (
                  <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold">
                    {iss}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic mb-2">No specific issues listed</p>
            )}

            {job.issueNotes && (
              <div className="bg-slate-50 rounded-xl p-2.5 text-xs text-slate-700 border border-slate-200 mt-2">
                <span className="font-semibold text-slate-900 block mb-0.5">Notes:</span>
                {job.issueNotes}
              </div>
            )}
          </div>
        </div>

        {/* Cost & Payment Summary Card */}
        <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
          <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm">
            <CreditCard className="w-4 h-4 text-emerald-600" /> Financial Summary
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-500 block mb-1">Total Estimated Amount</span>
              <span className="text-base font-extrabold text-slate-900">
                ₹{totalCost.toFixed(2)}
              </span>
            </div>
            <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-100">
              <span className="text-xs text-blue-600 block mb-1 font-medium">Advance Paid</span>
              <span className="text-base font-extrabold text-blue-700">
                ₹{advancePaid.toFixed(2)}
              </span>
            </div>
            <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200">
              <span className="text-xs text-amber-700 block mb-1 font-semibold">Balance Due</span>
              <span className="text-base font-extrabold text-amber-800">
                ₹{balanceDue.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Shop Contact Card */}
        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 text-center">
          <h3 className="text-sm font-bold text-slate-900 mb-1">{shopDetails.shopName || 'Digital Zone'}</h3>
          {shopDetails.address && (
            <p className="text-xs text-slate-500 flex items-center justify-center gap-1 mb-3">
              <MapPin className="w-3.5 h-3.5 text-slate-400" /> {shopDetails.address}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            {shopDetails.phone && (
              <a
                href={`tel:${shopDetails.phone}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors"
              >
                <Phone className="w-3.5 h-3.5" /> Call Shop ({shopDetails.phone})
              </a>
            )}
            {shopDetails.phone && (
              <a
                href={`https://wa.me/${shopDetails.phone.replace(/\D/g, '')}?text=Hi,%20inquiring%20about%20Job%20Sheet%20%23${job.jobSheetNumber || targetId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-900 transition-colors"
              >
                WhatsApp Support
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
