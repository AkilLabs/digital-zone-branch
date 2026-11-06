import { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
  Smartphone,
  CreditCard,
  Share2,
  Copy,
  Check,
  ShieldCheck,
  Eye,
  EyeOff,
  Printer,
  Search,
  MessageCircle,
  Sparkles,
  Lock,
  Warehouse,
  Building2
} from 'lucide-react';
import logoImg from '../../assets/logo.png';
import QRCode from 'qrcode';

interface BranchMeta {
  id?: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

const MILESTONES = [
  {
    step: 0,
    key: 'received',
    label: 'Received',
    badge: 'Step 1 of 4',
    title: 'Intake & Diagnostics Queued',
    desc: 'Device verified & logged into workshop inventory'
  },
  {
    step: 1,
    key: 'repairing',
    label: 'In Repair',
    badge: 'Step 2 of 4',
    title: 'Active Workbench Service',
    desc: 'Technician is diagnosing, servicing & testing hardware'
  },
  {
    step: 2,
    key: 'serviced',
    label: 'Ready for Pickup',
    badge: 'Step 3 of 4',
    title: 'QC Passed & Packed',
    desc: 'Repair complete & verified. Ready at the counter'
  },
  {
    step: 3,
    key: 'delivered',
    label: 'Delivered',
    badge: 'Step 4 of 4',
    title: 'Handed Over to Customer',
    desc: 'Device successfully returned with warranty coverage'
  }
];

export default function ViewJobSheet() {
  const params = useParams();
  const navigate = useNavigate();

  // Extract raw identifier from route wildcard or param
  const rawId = params['*'] ? decodeURIComponent(params['*']) : params.id;
  const targetId = rawId ? rawId.replace(/^\/+|\/+$/g, '').trim() : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState<ServiceRequest | null>(null);
  const [branchInfo, setBranchInfo] = useState<BranchMeta | null>(null);
  const [shopDetails, setShopDetails] = useState<ShopDetails>({
    shopName: 'Digital Zone',
    ownerName: '',
    address: 'Central Workshop, City Center',
    phone: '+91-XXXXXXXXXX',
    email: 'support@digitalzone.com',
    gst: '',
    upiId: '',
    merchantName: ''
  });

  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showSecurityInfo, setShowSecurityInfo] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Fetch global shop settings
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

  // Multi-tier search to locate service job across root and store subcollections
  useEffect(() => {
    if (!targetId) {
      setError('Please provide a valid Job Sheet Number or Tracking Code.');
      setLoading(false);
      return;
    }

    const fetchJobSheet = async () => {
      try {
        setLoading(true);
        setError('');
        let foundData: (ServiceRequest & { _matchedStoreId?: string }) | null = null;

        const normalizedTarget = targetId.trim();
        const upperTarget = normalizedTarget.toUpperCase();
        const searchCandidates = Array.from(new Set([normalizedTarget, upperTarget].filter(Boolean)));

        // 1. Direct search in root serviceRequests by document ID
        for (const candidate of searchCandidates) {
          try {
            const directDoc = await getDoc(doc(db, 'serviceRequests', candidate));
            if (directDoc.exists()) {
              foundData = { id: directDoc.id, ...directDoc.data() } as ServiceRequest;
              break;
            }
          } catch (_e) {
            /* continue */
          }
        }

        // 2. Query root serviceRequests by jobSheetNumber
        if (!foundData) {
          for (const candidate of searchCandidates) {
            try {
              const q = query(collection(db, 'serviceRequests'), where('jobSheetNumber', '==', candidate));
              const snap = await getDocs(q);
              if (!snap.empty) {
                const first = snap.docs[0];
                foundData = { id: first.id, ...first.data() } as ServiceRequest;
                break;
              }
            } catch (_e) {
              /* continue */
            }
          }
        }

        // 3. Query root serviceRequests by qrCodeValue
        if (!foundData) {
          for (const candidate of searchCandidates) {
            try {
              const q = query(collection(db, 'serviceRequests'), where('qrCodeValue', '==', candidate));
              const snap = await getDocs(q);
              if (!snap.empty) {
                const first = snap.docs[0];
                foundData = { id: first.id, ...first.data() } as ServiceRequest;
                break;
              }
            } catch (_e) {
              /* continue */
            }
          }
        }

        // 4. Query collectionGroup('serviceRequests') by jobSheetNumber across all branches
        if (!foundData) {
          for (const candidate of searchCandidates) {
            try {
              const q = query(collectionGroup(db, 'serviceRequests'), where('jobSheetNumber', '==', candidate));
              const snap = await getDocs(q);
              if (!snap.empty) {
                const first = snap.docs[0];
                const storeMatch = first.ref.path.match(/stores\/([^/]+)\/serviceRequests/);
                foundData = {
                  id: first.id,
                  ...first.data(),
                  _matchedStoreId: storeMatch ? storeMatch[1] : undefined
                } as ServiceRequest & { _matchedStoreId?: string };
                break;
              }
            } catch (_e) {
              /* continue */
            }
          }
        }

        // 5. Query collectionGroup('serviceRequests') by qrCodeValue
        if (!foundData) {
          for (const candidate of searchCandidates) {
            try {
              const q = query(collectionGroup(db, 'serviceRequests'), where('qrCodeValue', '==', candidate));
              const snap = await getDocs(q);
              if (!snap.empty) {
                const first = snap.docs[0];
                const storeMatch = first.ref.path.match(/stores\/([^/]+)\/serviceRequests/);
                foundData = {
                  id: first.id,
                  ...first.data(),
                  _matchedStoreId: storeMatch ? storeMatch[1] : undefined
                } as ServiceRequest & { _matchedStoreId?: string };
                break;
              }
            } catch (_e) {
              /* continue */
            }
          }
        }

        // 6. Direct loop through all branches in `stores` collection (vital if collectionGroup lacks index)
        if (!foundData) {
          try {
            const storesSnap = await getDocs(collection(db, 'stores'));
            for (const storeDoc of storesSnap.docs) {
              const sId = storeDoc.id;
              for (const candidate of searchCandidates) {
                // Check direct document ID in store
                try {
                  const directBranchDoc = await getDoc(doc(db, 'stores', sId, 'serviceRequests', candidate));
                  if (directBranchDoc.exists()) {
                    foundData = {
                      id: directBranchDoc.id,
                      ...directBranchDoc.data(),
                      _matchedStoreId: sId
                    } as ServiceRequest & { _matchedStoreId?: string };
                    break;
                  }
                } catch (_e) {}

                // Query jobSheetNumber in store
                try {
                  const qStore = query(
                    collection(db, 'stores', sId, 'serviceRequests'),
                    where('jobSheetNumber', '==', candidate)
                  );
                  const storeReqSnap = await getDocs(qStore);
                  if (!storeReqSnap.empty) {
                    const first = storeReqSnap.docs[0];
                    foundData = {
                      id: first.id,
                      ...first.data(),
                      _matchedStoreId: sId
                    } as ServiceRequest & { _matchedStoreId?: string };
                    break;
                  }
                } catch (_e) {}

                // Query qrCodeValue in store
                try {
                  const qStoreQr = query(
                    collection(db, 'stores', sId, 'serviceRequests'),
                    where('qrCodeValue', '==', candidate)
                  );
                  const storeQrSnap = await getDocs(qStoreQr);
                  if (!storeQrSnap.empty) {
                    const first = storeQrSnap.docs[0];
                    foundData = {
                      id: first.id,
                      ...first.data(),
                      _matchedStoreId: sId
                    } as ServiceRequest & { _matchedStoreId?: string };
                    break;
                  }
                } catch (_e) {}
              }

              if (foundData) break;
            }
          } catch (_e) {
            /* continue */
          }
        }

        // 7. Fallback: Numeric suffix search if job ID has a hyphen (e.g. DZ-SC-0001 -> 0001)
        if (!foundData && normalizedTarget.includes('-')) {
          const parts = normalizedTarget.split('-');
          const lastNum = parts[parts.length - 1];
          if (lastNum && /^\d+$/.test(lastNum)) {
            try {
              // Try root and stores for common variations
              const possiblePrefixes = ['DZ', 'DZ-HUB', 'TLM', 'JOB'];
              for (const pfx of possiblePrefixes) {
                const alt = `${pfx}-${lastNum}`;
                const q = query(collection(db, 'serviceRequests'), where('jobSheetNumber', '==', alt));
                const snap = await getDocs(q);
                if (!snap.empty) {
                  const first = snap.docs[0];
                  foundData = { id: first.id, ...first.data() } as ServiceRequest;
                  break;
                }
              }
            } catch (_e) {}
          }
        }

        if (foundData) {
          setJob(foundData);

          // Fetch specific branch details if job belongs to a branch store
          const effectiveStoreId = foundData._matchedStoreId || foundData._storeId;
          if (effectiveStoreId && effectiveStoreId !== 'hub_warehouse') {
            try {
              const storeSnap = await getDoc(doc(db, 'stores', effectiveStoreId));
              if (storeSnap.exists()) {
                const sData = storeSnap.data();
                setBranchInfo({
                  id: storeSnap.id,
                  name: sData.name || sData.shopName || foundData._storeName || 'Branch Workshop',
                  address: sData.address || sData.location,
                  phone: sData.phone || sData.contactNumber,
                  email: sData.email
                });
              }
            } catch (_e) {
              /* ignore */
            }
          } else if (foundData._storeId === 'hub_warehouse' || !effectiveStoreId) {
            setBranchInfo({
              id: 'hub_warehouse',
              name: 'Central Hub Workshop',
              address: shopDetails.address,
              phone: shopDetails.phone,
              email: shopDetails.email
            });
          }

          // Generate dynamic tracking page QR code for quick scanning at counter
          try {
            const currentUrl = window.location.href;
            const dataUrl = await QRCode.toDataURL(currentUrl, {
              margin: 1,
              width: 140,
              color: { dark: '#0f172a', light: '#ffffff' }
            });
            setQrCodeDataUrl(dataUrl);
          } catch (_e) {
            /* ignore */
          }
        } else {
          setError(`No service job sheet was found matching reference "${targetId}".`);
        }
      } catch (err) {
        console.error('Error fetching service job:', err);
        setError('Unable to load service job details. Please verify the tracking code or try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchJobSheet();
  }, [targetId]);

  // Derived Effective Shop Details for PDF and Contacting
  const effectiveShopDetails: ShopDetails = useMemo(() => {
    return {
      ...shopDetails,
      shopName: branchInfo?.name || shopDetails.shopName || 'Digital Zone',
      address: branchInfo?.address || shopDetails.address,
      phone: branchInfo?.phone || shopDetails.phone,
      email: branchInfo?.email || shopDetails.email
    };
  }, [shopDetails, branchInfo]);

  // Step Index Mapping (0: received, 1: repairing, 2: serviced, 3: delivered)
  const currentStep = useMemo(() => {
    if (!job) return 0;
    const s = job.status;
    if (s === 'delivered') return 3;
    if (s === 'serviced' || s === 'ready-delivery') return 2;
    if (s === 'repairing' || s === 'waiting-approval') return 1;
    return 0; // received, pending, inspecting, customer-updated
  }, [job]);

  // Financial Computations
  const totalCost = Number(job?.cost || job?.approvedCost || 0);
  const advancePaid = Number(job?.advancePaid || 0);
  const balanceDue = Number(job?.balanceAmount ?? Math.max(0, totalCost - advancePaid));
  const isFullyPaid = totalCost > 0 && balanceDue <= 0;

  // Format Dates Nicely
  const formattedIntakeDate = useMemo(() => {
    if (!job) return '—';
    if (job.jobDate) {
      try {
        const d = new Date(job.jobDate);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + (job.jobTime ? ` at ${job.jobTime}` : '');
        }
      } catch {}
      return job.jobDate + (job.jobTime ? ` ${job.jobTime}` : '');
    }
    if (job.createdAt) {
      const ca: any = job.createdAt;
      if (ca.toDate && typeof ca.toDate === 'function') {
        return ca.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
      try {
        const d = new Date(ca);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      } catch {}
    }
    return '—';
  }, [job]);

  const handleCopyId = () => {
    const code = job?.jobSheetNumber || targetId;
    navigator.clipboard.writeText(code);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleShareLink = async () => {
    const shareUrl = window.location.href;
    const shareText = `Track live repair status for ${job?.productName || 'Device'} (Job #${job?.jobSheetNumber || targetId}) at Digital Zone: ${shareUrl}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Service Job #${job?.jobSheetNumber || targetId}`,
          text: shareText,
          url: shareUrl
        });
        return;
      } catch (_e) {
        /* fallback to copy */
      }
    }

    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleDownloadPDF = async () => {
    if (!job) return;
    try {
      setDownloadingPdf(true);
      await generateServiceJobPDF(job, effectiveShopDetails, false);
    } catch (err) {
      console.error('Failed to generate PDF', err);
      alert('Could not download PDF. Please try again.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/view-job/${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  // Status Meta Config
  const statusTheme = useMemo(() => {
    switch (currentStep) {
      case 3:
        return {
          bannerBg: 'bg-emerald-900 text-white',
          badgeBg: 'bg-emerald-800 text-emerald-200 border-emerald-700',
          accentColor: 'text-emerald-600',
          dotColor: 'bg-emerald-500',
          title: 'Repair Completed & Delivered',
          subtitle: 'Device has been handed over to customer. Warranty is now active.'
        };
      case 2:
        return {
          bannerBg: 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white',
          badgeBg: 'bg-white/20 text-white border-white/30 backdrop-blur-xs',
          accentColor: 'text-emerald-600',
          dotColor: 'bg-emerald-400',
          title: 'Serviced & Ready for Pickup!',
          subtitle: 'Testing and quality inspection passed. Ready for collection at our service desk.'
        };
      case 1:
        return {
          bannerBg: 'bg-gradient-to-r from-blue-700 to-sky-800 text-white',
          badgeBg: 'bg-white/20 text-white border-white/30 backdrop-blur-xs',
          accentColor: 'text-blue-600',
          dotColor: 'bg-sky-400',
          title: 'Device Under Active Repair',
          subtitle: 'Certified technician is actively servicing hardware & components at our bench.'
        };
      case 0:
      default:
        return {
          bannerBg: 'bg-gradient-to-r from-amber-600 to-orange-700 text-white',
          badgeBg: 'bg-white/20 text-white border-white/30 backdrop-blur-xs',
          accentColor: 'text-amber-600',
          dotColor: 'bg-amber-400',
          title: 'Device Received & Registered',
          subtitle: 'Intake inspection complete. Device is securely queued for diagnosis.'
        };
    }
  }, [currentStep]);

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center animate-pulse">
            <Wrench className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
        </div>
        <p className="mt-4 text-base font-semibold text-slate-200">Retrieving Service Job Record...</p>
        <p className="text-xs text-slate-400 mt-1">Connecting to Digital Zone Live Workshop Database</p>
      </div>
    );
  }

  // Not Found / Error State
  if (error || !job) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col antialiased">
        <header className="bg-white border-b border-slate-200 py-3.5 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src={logoImg} alt="Logo" className="w-8 h-8 object-contain rounded" />
              <span className="font-bold text-slate-900 text-sm tracking-tight">
                {shopDetails.shopName || 'Digital Zone'}
              </span>
            </div>
            <Link
              to="/login"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              Staff Login &rarr;
            </Link>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm text-center">
            <div className="w-14 h-14 bg-rose-50 border border-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-rose-600">
              <AlertCircle className="w-7 h-7" />
            </div>

            <h2 className="text-xl font-bold text-slate-900 mb-1">Job Sheet Not Found</h2>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              {error || `We could not locate any repair record for "${targetId}". Please check your job sheet number or QR code.`}
            </p>

            {/* Quick Search Form */}
            <form onSubmit={handleManualSearch} className="mb-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. DZ-SC-0001 or Mobile Number"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-20 py-2.5 text-xs font-mono font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <button
                  type="submit"
                  disabled={!searchQuery.trim()}
                  className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Track
                </button>
              </div>
            </form>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">Need help?</span>
              {shopDetails.phone && (
                <a
                  href={`tel:${shopDetails.phone}`}
                  className="text-blue-600 font-bold hover:underline inline-flex items-center gap-1"
                >
                  <Phone className="w-3.5 h-3.5" /> Call {shopDetails.phone}
                </a>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const jobCode = job.jobSheetNumber || targetId;
  const isUrgent = job.priority === 'urgent';

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 flex flex-col antialiased selection:bg-blue-100 selection:text-blue-900">
      {/* ================= STICKY TOP APP BAR ================= */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/90 sticky top-0 z-40 shadow-2xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          {/* Brand Info */}
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Logo" className="w-9 h-9 object-contain rounded-lg shrink-0" />
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight leading-tight">
                  {effectiveShopDetails.shopName}
                </h1>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  Live Tracker
                </span>
              </div>
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                {branchInfo?.name ? (
                  <>
                    <Building2 className="w-3 h-3 text-slate-400" />
                    <span>{branchInfo.name}</span>
                  </>
                ) : (
                  <>
                    <Warehouse className="w-3 h-3 text-slate-400" />
                    <span>Authorized Service Center</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShareLink}
              className="p-2 sm:px-3 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Share Tracking Link"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copiedLink ? 'Copied Link' : 'Share'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={downloadingPdf}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
              title="Download Official Job Sheet PDF"
            >
              {downloadingPdf ? (
                <Loader className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">PDF Slip</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="hidden md:flex p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold items-center gap-1 transition-colors cursor-pointer"
              title="Print Slip"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ================= MAIN CONTAINER ================= */}
      <main className="max-w-6xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 flex-1 pb-24 sm:pb-12">
        {/* ================= HERO REPAIR STATUS CARD ================= */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
          {/* Dynamic Status Ribbon Header */}
          <div className={`p-4 sm:p-6 ${statusTheme.bannerBg} transition-colors`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusTheme.badgeBg}`}>
                    <span className={`w-2 h-2 rounded-full ${statusTheme.dotColor} animate-ping`} />
                    <span className={`w-2 h-2 rounded-full ${statusTheme.dotColor} absolute`} />
                    <span>{MILESTONES[currentStep].label}</span>
                  </span>

                  {isUrgent && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-extrabold bg-rose-500 text-white shadow-2xs">
                      🔥 Priority Fast-Track
                    </span>
                  )}

                  <span className="text-xs text-white/80 font-medium hidden sm:inline">
                    • Logged {formattedIntakeDate}
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight">
                  {statusTheme.title}
                </h2>
                <p className="text-xs sm:text-sm text-white/90 mt-1 max-w-2xl leading-relaxed">
                  {statusTheme.subtitle}
                </p>
              </div>

              {/* Job Sheet Mono Badge with 1-click Copy */}
              <div className="self-start sm:self-auto bg-black/25 backdrop-blur-md border border-white/20 rounded-2xl p-3 text-right shrink-0">
                <span className="text-[10px] text-white/70 block uppercase font-bold tracking-wider mb-0.5">
                  Tracking Job Ref
                </span>
                <div className="flex items-center justify-end gap-1.5">
                  <span className="font-mono text-base sm:text-lg font-black text-white tracking-wide">
                    {jobCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="p-1 hover:bg-white/20 rounded-md text-white/80 hover:text-white transition-colors cursor-pointer"
                    title="Copy Job ID"
                  >
                    {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ================= 4-STEP INTERACTIVE PROGRESS TIMELINE ================= */}
          <div className="p-4 sm:p-6 bg-slate-50/70 border-b border-slate-200/80">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative">
              {MILESTONES.map((m, idx) => {
                const isPassed = idx < currentStep;
                const isCurrent = idx === currentStep;

                let cardClasses = 'bg-white border-slate-200 text-slate-400';
                let iconClasses = 'bg-slate-100 text-slate-400 border-slate-200';
                let badgeClasses = 'bg-slate-100 text-slate-500';

                if (isCurrent) {
                  cardClasses = 'bg-white border-blue-500 ring-2 ring-blue-500/10 shadow-xs';
                  iconClasses = 'bg-blue-600 text-white border-blue-600';
                  badgeClasses = 'bg-blue-50 text-blue-700 font-bold';
                } else if (isPassed) {
                  cardClasses = 'bg-white border-emerald-300 shadow-2xs';
                  iconClasses = 'bg-emerald-600 text-white border-emerald-600';
                  badgeClasses = 'bg-emerald-50 text-emerald-700 font-semibold';
                }

                return (
                  <div
                    key={m.key}
                    className={`rounded-2xl p-3 sm:p-4 border transition-all flex flex-col justify-between ${cardClasses}`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${badgeClasses}`}>
                          {m.badge}
                        </span>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border ${iconClasses}`}>
                          {isPassed ? (
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          ) : isCurrent ? (
                            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                          ) : (
                            <span>{idx + 1}</span>
                          )}
                        </div>
                      </div>
                      <h4 className={`text-xs sm:text-sm font-bold ${isCurrent ? 'text-blue-900' : isPassed ? 'text-slate-900' : 'text-slate-500'}`}>
                        {m.label}
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                        {m.desc}
                      </p>
                    </div>

                    {isCurrent && (
                      <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-[10px] text-blue-600 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                        <span>Active Stage</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Summary Pill Strip */}
          <div className="px-4 sm:px-6 py-3.5 bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-500">Customer:</span>
              <strong className="text-slate-900 font-bold">{job.customerName || 'Walk-in Customer'}</strong>
              {job.mobile && (
                <span className="text-slate-500 font-mono">({job.mobile})</span>
              )}
            </div>

            <div className="flex items-center gap-4 text-slate-600">
              {job.serviceType && (
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Type:</span>
                  <span className="font-semibold uppercase text-slate-800">{job.serviceType}</span>
                </div>
              )}
              {job.estimatedRepairTime && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-slate-400">Est. Time:</span>
                  <span className="font-bold text-slate-900">{job.estimatedRepairTime}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ================= 2-COLUMN MAIN CONTENT GRID ================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* ================= LEFT MAIN COLUMN (2 COLS ON DESKTOP) ================= */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* 1. Device Hardware & Specs Card */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm sm:text-base">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <span>Device & Hardware Profile</span>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                  {job.warrantyStatus === 'in-warranty' ? 'In Warranty' : 'Standard Service'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                    Brand & Model
                  </span>
                  <p className="text-base font-extrabold text-slate-900">
                    {job.brand ? `${job.brand} ${job.modelName || ''}` : job.productName || 'Handset Repair'}
                  </p>
                  {(job.storageVariant || job.color) && (
                    <p className="text-xs text-slate-500 font-medium">
                      {[job.color, job.storageVariant].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </div>

                <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                    IMEI 1 / Serial Number
                  </span>
                  <p className="font-mono text-sm font-bold text-slate-800 break-all select-all">
                    {job.imei1 || job.serialNumber || 'Not Recorded'}
                  </p>
                  {job.imei2 && (
                    <p className="font-mono text-xs text-slate-500">IMEI 2: {job.imei2}</p>
                  )}
                </div>
              </div>

              {/* Accessories Handed Over */}
              {job.accessoriesReceived && job.accessoriesReceived.length > 0 && (
                <div className="pt-2">
                  <span className="text-xs font-bold text-slate-700 block mb-2">
                    Accessories Handed In with Device:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {job.accessoriesReceived.map((acc) => (
                      <span
                        key={acc}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/80 flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3 text-blue-600" />
                        <span>{acc}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Reported Complaint & Diagnostics Card */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 text-slate-900 font-bold text-sm sm:text-base">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <span>Reported Issues & Complaints</span>
              </div>

              {job.issues && job.issues.length > 0 ? (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 block">Symptoms / Faults Reported:</span>
                  <div className="flex flex-wrap gap-2">
                    {job.issues.map((iss, i) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-200/90 rounded-xl text-xs font-bold flex items-center gap-1.5"
                      >
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                        <span>{iss}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No specific issue tags provided during intake.</p>
              )}

              {/* Customer / Intake Notes */}
              {job.issueNotes && (
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                  <span className="text-[11px] font-bold text-slate-900 uppercase tracking-wider block mb-1">
                    Customer Observations & Remarks:
                  </span>
                  <p className="italic text-slate-800 font-medium">"{job.issueNotes}"</p>
                </div>
              )}

              {/* Work Performed / Spare Parts Replaced (if any recorded) */}
              {(job.workPerformed || (job.spareParts && job.spareParts.length > 0)) && (
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Work Performed by Technician:</span>
                  </span>
                  {job.workPerformed && (
                    <p className="text-xs text-slate-700 bg-emerald-50/50 border border-emerald-200 rounded-xl p-3">
                      {job.workPerformed}
                    </p>
                  )}
                  {job.spareParts && job.spareParts.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                        Installed Genuine Replacement Parts:
                      </span>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                        {job.spareParts.map((sp, idx) => (
                          <div key={idx} className="p-2.5 bg-white flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-900">{sp.partName} (Qty: {sp.quantity})</span>
                            <span className="font-mono font-bold text-slate-700">₹{sp.price}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. Screen Lock & Security Credentials (Privacy Guarded) */}
            {(job.password || job.unlockCode || job.pattern || (job.lockType && job.lockType !== 'none')) && (
              <div className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/90 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Device Lock Credentials</h4>
                      <p className="text-[11px] text-slate-500">Required by bench technician for full diagnosis</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowSecurityInfo(!showSecurityInfo)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {showSecurityInfo ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Hide</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>Reveal</span>
                      </>
                    )}
                  </button>
                </div>

                {showSecurityInfo && (
                  <div className="mt-3 p-3.5 bg-purple-50/70 border border-purple-200/80 rounded-2xl text-xs space-y-1.5 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Lock Type:</span>
                      <strong className="text-purple-900 capitalize font-bold">
                        {job.screenLockType || job.lockType || 'Pattern / PIN'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Unlock Code / Pattern Sequence:</span>
                      <strong className="font-mono text-sm font-black text-purple-900 bg-white px-2 py-0.5 rounded border border-purple-200">
                        {job.unlockCode || job.password || (job.pattern ? job.pattern.join(' → ') : 'None')}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ================= RIGHT RAIL (SIDEBAR ON DESKTOP) ================= */}
          <div className="space-y-4 sm:space-y-6">
            {/* 1. Financial & Settlement Card */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 text-slate-900 font-bold text-sm sm:text-base">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CreditCard className="w-4 h-4" />
                </div>
                <span>Service Charges & Billing</span>
              </div>

              {/* Balance Due Big Callout */}
              <div
                className={`p-4 rounded-2xl border text-center transition-all ${
                  isFullyPaid
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-200 text-amber-950'
                }`}
              >
                <span className="text-[10px] uppercase font-bold tracking-wider block mb-1">
                  {isFullyPaid ? 'Payment Status' : 'Balance Payable on Pickup'}
                </span>
                <div className="text-2xl sm:text-3xl font-black font-mono tracking-tight">
                  {isFullyPaid ? (
                    <span className="text-emerald-700 flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                      <span>Paid in Full</span>
                    </span>
                  ) : (
                    <span>₹{balanceDue.toFixed(2)}</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {isFullyPaid
                    ? 'All repair charges settled. Zero dues pending.'
                    : 'Payable via Cash, UPI, or Card at the service desk counter.'}
                </p>
              </div>

              {/* Financial Breakdown Table */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                  <span>Total Estimated Cost</span>
                  <span className="font-mono font-bold text-slate-900">₹{totalCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100 text-slate-600">
                  <span>Advance Deposited</span>
                  <span className="font-mono font-semibold text-emerald-700">
                    - ₹{advancePaid.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 text-sm font-extrabold text-slate-900">
                  <span>Net Due</span>
                  <span className="font-mono text-blue-700">₹{balanceDue.toFixed(2)}</span>
                </div>
              </div>

              {/* UPI Quick Pay Information if balance exists and shop has UPI */}
              {balanceDue > 0 && effectiveShopDetails.upiId && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Workshop UPI ID:</span>
                    <strong className="font-mono text-slate-900">{effectiveShopDetails.upiId}</strong>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Mention Job #{jobCode} in payment remarks.
                  </p>
                </div>
              )}
            </div>

            {/* 2. Fast Counter Pickup QR Pass */}
            {qrCodeDataUrl && (
              <div className="bg-white rounded-2xl sm:rounded-3xl p-5 border border-slate-200/90 shadow-2xs text-center space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                  Service Counter QR Pass
                </span>
                <div className="inline-block p-3 bg-white border border-slate-200 rounded-2xl shadow-xs">
                  <img src={qrCodeDataUrl} alt="Service QR Code" className="w-28 h-28 mx-auto" />
                </div>
                <p className="text-[11px] text-slate-500 leading-tight max-w-xs mx-auto">
                  Show this screen at the counter when collecting your device for instant verification.
                </p>
              </div>
            )}

            {/* 3. Workshop & Store Contact Card */}
            <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-2xs space-y-4">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">
                  Servicing Branch Desk
                </span>
                <h4 className="text-base font-bold text-slate-900 leading-snug">
                  {effectiveShopDetails.shopName}
                </h4>
                {effectiveShopDetails.address && (
                  <p className="text-xs text-slate-500 mt-1 flex items-start gap-1.5 leading-relaxed">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <span>{effectiveShopDetails.address}</span>
                  </p>
                )}
              </div>

              {/* Action Buttons: Call & WhatsApp */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {effectiveShopDetails.phone && (
                  <a
                    href={`tel:${effectiveShopDetails.phone}`}
                    className="px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call Store</span>
                  </a>
                )}

                {effectiveShopDetails.phone && (
                  <a
                    href={`https://wa.me/${effectiveShopDetails.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                      `Hello ${effectiveShopDetails.shopName},\nInquiring about my device service:\n• Job Sheet: ${jobCode}\n• Device: ${job.productName}\n• Status: ${MILESTONES[currentStep].label}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>WhatsApp</span>
                  </a>
                )}
              </div>
            </div>

            {/* 4. Service Assurance Trust Badges */}
            <div className="p-4 bg-slate-50/90 rounded-2xl border border-slate-200/80 space-y-2 text-xs text-slate-600">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Digital Zone Service Assurance</span>
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-500 pl-6 list-disc">
                <li>Quality-tested OEM / High-grade components</li>
                <li>Strict customer privacy & device data protection</li>
                <li>30-Day post-repair workshop testing guarantee</li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* ================= MOBILE BOTTOM STICKY ACTION BAR ================= */}
      <aside aria-label="Mobile actions" className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-3 z-30 shadow-lg flex items-center justify-between gap-2">
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Balance Due</span>
          <span className="text-base font-black font-mono text-slate-900">
            {isFullyPaid ? '₹0.00' : `₹${balanceDue.toFixed(2)}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {effectiveShopDetails.phone && (
            <a
              href={`tel:${effectiveShopDetails.phone}`}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Phone className="w-3.5 h-3.5 text-blue-600" />
              <span>Call</span>
            </a>
          )}

          <button
            type="button"
            onClick={handleDownloadPDF}
            disabled={downloadingPdf}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Slip PDF</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
