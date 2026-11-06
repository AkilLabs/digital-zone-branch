import { useEffect, useMemo, useState } from 'react';
import { collection, doc, deleteDoc, getDocs, orderBy, query, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  Clock3,
  Search,
  Trash2,
  Wrench,
  Printer,
  QrCode,
  Camera,
  Plus,
  ExternalLink,
  Phone,
  MessageSquare,
  CheckCircle2,
  RotateCw,
  Smartphone,
  X,
  Flame,
  Layers,
  Banknote,
  Calendar,
  Warehouse,
  Building2
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';

import Navbar from '../components/Navbar';
import LocationSwitcher from '../components/LocationSwitcher';
import PrintServiceQRLabelsModal from '../components/PrintServiceQRLabelsModal';
import QRScannerModal from '../components/QRScannerModal';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import type { ServiceRequest } from '../types';
import { printJobSheet } from '../utils/printJobSheet';

type StatusValue = ServiceRequest['status'];

const STATUS_OPTIONS: Array<{
  value: StatusValue;
  label: string;
  pillClass: string;
  dotClass: string;
}> = [
  {
    value: 'received',
    label: 'Received',
    pillClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500'
  },
  {
    value: 'repairing',
    label: 'Repairing',
    pillClass: 'bg-sky-50 text-sky-700 border-sky-200',
    dotClass: 'bg-sky-500'
  },
  {
    value: 'serviced',
    label: 'Serviced (Ready)',
    pillClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    dotClass: 'bg-indigo-500'
  },
  {
    value: 'delivered',
    label: 'Delivered',
    pillClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500'
  }
];

function getStatusMeta(status: StatusValue) {
  return STATUS_OPTIONS.find((item) => item.value === status) || STATUS_OPTIONS[0];
}

function formatDate(value?: Date | string) {
  if (!value) return '-';
  if (value instanceof Date) {
    return value.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
  return value;
}

export default function ServiceManagementPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getCollectionRef, currentStore, selectedLocation, stores } = useStore();
  const { success, error: showError } = useToastContext();
  const displayName = currentUser?.displayName || currentUser?.email || 'Unknown User';

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ServiceRequest[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StatusValue>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent'>('all');
  const [isLabelsModalOpen, setIsLabelsModalOpen] = useState(false);
  const [selectedJobForLabel, setSelectedJobForLabel] = useState<ServiceRequest | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [printingJobId, setPrintingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  const handleScanLookup = (scannedCode: string) => {
    setSearch(scannedCode);
    success(`Filtering job by QR Code: ${scannedCode}`);
  };

  const fetchJobs = async () => {
    try {
      setLoading(true);

      if (selectedLocation === 'all_locations') {
        // 1. Fetch Hub workshop service requests
        const hubRef = collection(db, 'serviceRequests');
        const hubSnap = await getDocs(query(hubRef, orderBy('createdAt', 'desc')));
        const hubJobs: ServiceRequest[] = hubSnap.docs.map((docSnap) => {
          const data = docSnap.data();
          const status = (data.status || 'received') as StatusValue;
          const createdAt = data.createdAt?.toDate?.() || new Date();
          return {
            id: docSnap.id,
            productName:
              data.productName ||
              `${data.brand || ''} ${data.modelName || ''}`.trim() ||
              'Unknown Device',
            customerId: data.customerId || '',
            customerName: data.customerName || '',
            mobile: data.mobile || '',
            cost: Number(data.cost || data.estimatedCost || 0),
            advancePaid: Number(data.advancePaid || 0),
            balanceAmount: data.balanceAmount !== undefined ? Number(data.balanceAmount) : undefined,
            lockType: data.lockType || 'none',
            password: data.password,
            pattern: data.pattern,
            status,
            jobSheetNumber: data.jobSheetNumber,
            qrCodeValue: data.qrCodeValue,
            jobDate: data.jobDate,
            jobTime: data.jobTime,
            serviceType: data.serviceType,
            priority: data.priority,
            brand: data.brand,
            modelName: data.modelName,
            issues: data.issues || [],
            issueNotes: data.issueNotes,
            estimatedRepairTime: data.estimatedRepairTime,
            createdAt,
            createdBy: data.createdBy || '',
            createdByName: data.createdByName,
            updatedAt: data.updatedAt?.toDate?.(),
            updatedBy: data.updatedBy,
            updatedByName: data.updatedByName,
            _storeId: 'hub_warehouse',
            _storeName: 'Hub Workshop',
          } as ServiceRequest;
        });

        // 2. Fetch each branch store's service requests
        const branchPromises = stores
          .filter((s): s is typeof s & { id: string } => Boolean(s && s.id))
          .map(async (store) => {
            const storeId = store.id;
            try {
              const bRef = collection(db, 'stores', storeId, 'serviceRequests');
              const bSnap = await getDocs(query(bRef, orderBy('createdAt', 'desc')));
              return bSnap.docs.map((docSnap) => {
                const data = docSnap.data();
                const status = (data.status || 'received') as StatusValue;
                const createdAt = data.createdAt?.toDate?.() || new Date();
                return {
                  id: docSnap.id,
                  productName:
                    data.productName ||
                    `${data.brand || ''} ${data.modelName || ''}`.trim() ||
                    'Unknown Device',
                  customerId: data.customerId || '',
                  customerName: data.customerName || '',
                  mobile: data.mobile || '',
                  cost: Number(data.cost || data.estimatedCost || 0),
                  advancePaid: Number(data.advancePaid || 0),
                  balanceAmount: data.balanceAmount !== undefined ? Number(data.balanceAmount) : undefined,
                  lockType: data.lockType || 'none',
                  password: data.password,
                  pattern: data.pattern,
                  status,
                  jobSheetNumber: data.jobSheetNumber,
                  qrCodeValue: data.qrCodeValue,
                  jobDate: data.jobDate,
                  jobTime: data.jobTime,
                  serviceType: data.serviceType,
                  priority: data.priority,
                  brand: data.brand,
                  modelName: data.modelName,
                  issues: data.issues || [],
                  issueNotes: data.issueNotes,
                  estimatedRepairTime: data.estimatedRepairTime,
                  createdAt,
                  createdBy: data.createdBy || '',
                  createdByName: data.createdByName,
                  updatedAt: data.updatedAt?.toDate?.(),
                  updatedBy: data.updatedBy,
                  updatedByName: data.updatedByName,
                  _storeId: storeId,
                  _storeName: store.name,
                } as ServiceRequest;
              });
            } catch (err) {
              console.error(`Error loading service jobs for store ${store.name}:`, err);
              return [] as ServiceRequest[];
            }
          });

        const branchResults = await Promise.all(branchPromises);
        const allJobs = [...hubJobs, ...branchResults.flat()].sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          return timeB - timeA;
        });
        setJobs(allJobs);
      } else {
        const jobsRef = getCollectionRef('serviceRequests');
        const q = query(jobsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const locName = currentStore ? currentStore.name : 'Hub Workshop';
        const locId = currentStore?.id || 'hub_warehouse';

        const rows = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const status = (data.status || 'received') as StatusValue;
          const createdAt = data.createdAt?.toDate?.() || new Date();
          return {
            id: docSnap.id,
            productName:
              data.productName ||
              `${data.brand || ''} ${data.modelName || ''}`.trim() ||
              'Unknown Device',
            customerId: data.customerId || '',
            customerName: data.customerName || '',
            mobile: data.mobile || '',
            cost: Number(data.cost || data.estimatedCost || 0),
            advancePaid: Number(data.advancePaid || 0),
            balanceAmount: data.balanceAmount !== undefined ? Number(data.balanceAmount) : undefined,
            lockType: data.lockType || 'none',
            password: data.password,
            pattern: data.pattern,
            status,
            jobSheetNumber: data.jobSheetNumber,
            qrCodeValue: data.qrCodeValue,
            jobDate: data.jobDate,
            jobTime: data.jobTime,
            serviceType: data.serviceType,
            priority: data.priority,
            brand: data.brand,
            modelName: data.modelName,
            issues: data.issues || [],
            issueNotes: data.issueNotes,
            estimatedRepairTime: data.estimatedRepairTime,
            createdAt,
            createdBy: data.createdBy || '',
            createdByName: data.createdByName,
            updatedAt: data.updatedAt?.toDate?.(),
            updatedBy: data.updatedBy,
            updatedByName: data.updatedByName,
            _storeId: locId,
            _storeName: locName,
          } as ServiceRequest;
        });

        setJobs(rows);
      }
    } catch (err) {
      console.error('Failed to fetch service jobs', err);
      showError('Failed to load service jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [selectedLocation, currentStore?.id, stores]);

  // Compute stats for KPI strip
  const stats = useMemo(() => {
    const total = jobs.length;
    let received = 0;
    let repairing = 0;
    let serviced = 0;
    let delivered = 0;
    let totalValue = 0;
    let urgentCount = 0;

    for (const job of jobs) {
      if (job.status === 'received') received++;
      else if (job.status === 'repairing') repairing++;
      else if (job.status === 'serviced') serviced++;
      else if (job.status === 'delivered') delivered++;

      totalValue += Number(job.cost || 0);
      if (job.priority === 'urgent') urgentCount++;
    }

    return {
      total,
      received,
      repairing,
      serviced,
      delivered,
      totalValue,
      urgentCount
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const statusOk = statusFilter === 'all' ? true : job.status === statusFilter;
      const priorityOk = priorityFilter === 'all' ? true : job.priority === 'urgent';
      const q = search.trim().toLowerCase();
      const searchOk = !q
        ? true
        : [
            job.jobSheetNumber,
            job.qrCodeValue,
            job.customerName,
            job.mobile,
            job.productName,
            job.brand,
            job.modelName,
            job.imei1,
            job.issueNotes
          ]
            .filter(Boolean)
            .some((val) => String(val).toLowerCase().includes(q));
      return statusOk && priorityOk && searchOk;
    });
  }, [jobs, search, statusFilter, priorityFilter]);

  const handleStatusChange = async (jobId: string, status: StatusValue) => {
    try {
      const targetJob = jobs.find((j) => j.id === jobId);
      const storeId = targetJob?._storeId;
      const jobRef =
        storeId && storeId !== 'hub_warehouse'
          ? doc(db, 'stores', storeId, 'serviceRequests', jobId)
          : doc(db, 'serviceRequests', jobId);

      await updateDoc(jobRef, {
        status,
        updatedAt: Timestamp.now(),
        updatedBy: currentUser?.uid,
        updatedByName: displayName
      });
      setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status } : job)));
      success(`Status updated to ${getStatusMeta(status).label}`);
    } catch (err) {
      console.error('Failed to update status', err);
      showError('Failed to update status');
    }
  };

  const handlePrintJobSheet = async (job: ServiceRequest) => {
    if (!job.id) return;
    try {
      setPrintingJobId(job.id);
      await printJobSheet(job);
      success('Job sheet generated for print');
    } catch (err) {
      console.error('Error printing job sheet:', err);
      showError('Failed to print job sheet');
    } finally {
      setPrintingJobId(null);
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!window.confirm('Are you sure you want to delete this service job sheet permanently?')) {
      return;
    }
    try {
      setDeletingJobId(jobId);
      const targetJob = jobs.find((j) => j.id === jobId);
      const storeId = targetJob?._storeId;
      const jobRef =
        storeId && storeId !== 'hub_warehouse'
          ? doc(db, 'stores', storeId, 'serviceRequests', jobId)
          : doc(db, 'serviceRequests', jobId);

      await deleteDoc(jobRef);
      setJobs((prev) => prev.filter((job) => job.id !== jobId));
      success('Service job deleted successfully');
    } catch (err) {
      console.error('Failed to delete service job', err);
      showError('Failed to delete service job');
    } finally {
      setDeletingJobId(null);
    }
  };

  const handleWhatsAppUpdate = (job: ServiceRequest) => {
    const rawPhone = (job.mobile || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    if (!cleanPhone) {
      showError('No valid customer phone number found');
      return;
    }

    const statusLabel = getStatusMeta(job.status).label;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const trackingUrl = `${origin}/view-job/${job.jobSheetNumber || job.qrCodeValue || job.id}`;

    let statusMsg = '';
    if (job.status === 'serviced') {
      statusMsg = `Good news! Your device is successfully repaired and ready for pickup.`;
    } else if (job.status === 'repairing') {
      statusMsg = `Our technician is actively diagnosing/repairing your device.`;
    } else if (job.status === 'delivered') {
      statusMsg = `Your device has been delivered. Thank you for choosing our service!`;
    } else {
      statusMsg = `Your device has been received and queued for technical inspection.`;
    }

    const text = encodeURIComponent(
      `Hello ${job.customerName || 'Customer'},\n\nUpdate regarding your repair service:\n` +
        `• *Job Sheet*: ${job.jobSheetNumber || '-'}\n` +
        `• *Device*: ${job.productName}\n` +
        `• *Current Status*: ${statusLabel}\n\n` +
        `${statusMsg}\n\n` +
        `Track live repair status & slip online here:\n${trackingUrl}`
    );

    window.open(`https://wa.me/${cleanPhone}?text=${text}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <Navbar />

      <main className="max-w-full w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8 space-y-3.5">
        {/* Header Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xs shrink-0">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    Service & Repair Management
                  </h1>
                  <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                    Live Workshop
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>Track intake, manage technician status pipeline, print QR tags & notify customers</span>
                  <span className="text-slate-300">•</span>
                  {selectedLocation === 'all_locations' ? (
                    <span className="inline-flex items-center gap-1 text-blue-800 font-bold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                      <Layers className="w-3.5 h-3.5 text-blue-600" />
                      <span>Complete Service Data (Hub Workshop + All Branches)</span>
                    </span>
                  ) : currentStore?.name ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <Building2 className="w-3.5 h-3.5" />
                      <span>Branch: {currentStore.name}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                      <Warehouse className="w-3.5 h-3.5" />
                      <span>Hub Workshop (Main Office)</span>
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <LocationSwitcher includeAllLocations />

              <button
                onClick={() => setIsScannerOpen(true)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all active:scale-95"
                title="Scan QR sticker on device"
              >
                <Camera className="w-4 h-4 text-blue-600" />
                <span>Scan Device QR</span>
              </button>

              <button
                onClick={() => {
                  setSelectedJobForLabel(null);
                  setIsLabelsModalOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all active:scale-95"
                title="Print batch QR code stickers"
              >
                <QrCode className="w-4 h-4 text-purple-600" />
                <span>Print QR Stickers</span>
              </button>

              <button
                onClick={fetchJobs}
                disabled={loading}
                className="p-2 bg-slate-100 hover:bg-slate-200/80 text-slate-600 rounded-xl transition-all"
                title="Refresh service list"
              >
                <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              </button>

              <button
                onClick={() => navigate('/service-management/create')}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xs transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>New Job Sheet</span>
              </button>
            </div>
          </div>
        </div>

        {/* KPI Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
          {/* Total Jobs */}
          <div className="bg-white border border-slate-200/80 rounded-xl p-3 sm:p-3.5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Jobs</p>
              <p className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 font-mono">
                {stats.total}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">All repair records</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
              <Layers className="w-4 h-4" />
            </div>
          </div>

          {/* Received / In Queue */}
          <div className="bg-white border border-amber-200/80 rounded-xl p-3 sm:p-3.5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Received</p>
              <p className="text-xl sm:text-2xl font-black text-amber-700 mt-0.5 font-mono">
                {stats.received}
              </p>
              <p className="text-[10px] text-amber-600/80 mt-0.5">Awaiting technician</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <Clock3 className="w-4 h-4" />
            </div>
          </div>

          {/* Repairing */}
          <div className="bg-white border border-sky-200/80 rounded-xl p-3 sm:p-3.5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-sky-700 uppercase tracking-wider">Repairing</p>
              <p className="text-xl sm:text-2xl font-black text-sky-700 mt-0.5 font-mono">
                {stats.repairing}
              </p>
              <p className="text-[10px] text-sky-600/80 mt-0.5">On workbench</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
              <Wrench className="w-4 h-4" />
            </div>
          </div>

          {/* Serviced / Ready */}
          <div className="bg-white border border-indigo-200/80 rounded-xl p-3 sm:p-3.5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Ready for Pickup</p>
              <p className="text-xl sm:text-2xl font-black text-indigo-700 mt-0.5 font-mono">
                {stats.serviced}
              </p>
              <p className="text-[10px] text-indigo-600/80 mt-0.5">Testing complete</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>

          {/* Delivered */}
          <div className="bg-white border border-emerald-200/80 rounded-xl p-3 sm:p-3.5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Delivered</p>
              <p className="text-xl sm:text-2xl font-black text-emerald-700 mt-0.5 font-mono">
                {stats.delivered}
              </p>
              <p className="text-[10px] text-emerald-600/80 mt-0.5">Handed over</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Smartphone className="w-4 h-4" />
            </div>
          </div>

          {/* Total Value */}
          <div className="bg-white border border-slate-200/80 rounded-xl p-3 sm:p-3.5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Repair Value</p>
              <p className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 font-mono tabular-nums">
                ₹{stats.totalValue.toLocaleString('en-IN')}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {stats.urgentCount > 0 ? (
                  <span className="text-rose-600 font-bold inline-flex items-center gap-0.5">
                    <Flame className="w-3 h-3" /> {stats.urgentCount} Urgent
                  </span>
                ) : (
                  'Estimated revenue'
                )}
              </p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700">
              <Banknote className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Filter Toolbar & Search Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-xs space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-lg">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by job #, customer name, mobile, device or fault..."
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-9 pr-9 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quick Priority Toggle */}
            <div className="flex items-center gap-2 self-start md:self-auto">
              <button
                onClick={() => setPriorityFilter(priorityFilter === 'all' ? 'urgent' : 'all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                  priorityFilter === 'urgent'
                    ? 'bg-rose-50 border-rose-200 text-rose-700 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Flame className={`w-3.5 h-3.5 ${priorityFilter === 'urgent' ? 'text-rose-600' : 'text-slate-400'}`} />
                <span>Urgent Only</span>
                {stats.urgentCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-600 text-white font-bold">
                    {stats.urgentCount}
                  </span>
                )}
              </button>

              <div className="text-xs text-slate-500 font-medium pl-2 hidden sm:block">
                Showing <span className="font-bold text-slate-900">{filteredJobs.length}</span> of {jobs.length} jobs
              </div>
            </div>
          </div>

          {/* Status Tabs Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-t border-slate-100 pt-2.5">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                statusFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>All Jobs</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  statusFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {jobs.length}
              </span>
            </button>

            {STATUS_OPTIONS.map((status) => {
              const count =
                status.value === 'received'
                  ? stats.received
                  : status.value === 'repairing'
                  ? stats.repairing
                  : status.value === 'serviced'
                  ? stats.serviced
                  : stats.delivered;

              const isActive = statusFilter === status.value;

              return (
                <button
                  key={status.value}
                  onClick={() => setStatusFilter(status.value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap border ${
                    isActive
                      ? `${status.pillClass} font-black ring-2 ring-blue-500/20`
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${status.dotClass}`} />
                  <span>{status.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                      isActive ? 'bg-black/10' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Data Container: Table for Desktop & Cards for Mobile */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-16 text-center">
              <RotateCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-800">Loading service jobs...</p>
              <p className="text-xs text-slate-400 mt-1">Retrieving workshop pipeline records</p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-16 text-center max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
                <Wrench className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-slate-900">No service jobs found</h3>
              <p className="text-xs text-slate-500 mt-1">
                {search || statusFilter !== 'all' || priorityFilter !== 'all'
                  ? 'No repair jobs match your current search or filter criteria. Try clearing filters.'
                  : 'No repair requests in your workshop ledger yet. Create your first job sheet!'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {(search || statusFilter !== 'all' || priorityFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                      setPriorityFilter('all');
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
                  >
                    Clear Filters
                  </button>
                )}
                <button
                  onClick={() => navigate('/service-management/create')}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> New Job Sheet
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Mobile View: Responsive Service Cards */}
              <div className="lg:hidden divide-y divide-slate-100">
                {filteredJobs.map((job) => {
                  const statusMeta = getStatusMeta(job.status);
                  const isUrgent = job.priority === 'urgent';
                  const jobCode = job.jobSheetNumber || job.qrCodeValue || job.id;

                  return (
                    <div key={job.id} className="p-4 space-y-3 hover:bg-slate-50/50 transition-colors">
                      {/* Top Bar: Job Ref, Priority & Date */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs font-black text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                            {job.jobSheetNumber || '-'}
                          </span>
                          {selectedLocation === 'all_locations' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              {job._storeId === 'hub_warehouse' ? (
                                <>
                                  <Warehouse className="w-2.5 h-2.5 text-amber-600" />
                                  <span>Hub Workshop</span>
                                </>
                              ) : (
                                <>
                                  <Building2 className="w-2.5 h-2.5 text-blue-600" />
                                  <span>{job._storeName || 'Branch'}</span>
                                </>
                              )}
                            </span>
                          )}
                          {isUrgent && (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold">
                              <Flame className="w-3 h-3 text-rose-500" /> Urgent
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(job.createdAt)}
                        </span>
                      </div>

                      {/* Device & Customer Info */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                            <Smartphone className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>{job.productName}</span>
                          </p>
                          <p className="text-xs text-slate-600 font-medium mt-0.5 ml-5.5">
                            Customer: <span className="text-slate-900 font-bold">{job.customerName || 'Walk-in'}</span>
                          </p>
                          {job.mobile && (
                            <p className="text-xs text-slate-500 font-mono ml-5.5">{job.mobile}</p>
                          )}
                        </div>

                        {/* Cost & Advance */}
                        <div className="text-right shrink-0">
                          <p className="text-xs text-slate-400">Total Cost</p>
                          <p className="text-base font-black text-slate-900 font-mono tabular-nums">
                            ₹{Number(job.cost || 0).toLocaleString('en-IN')}
                          </p>
                          {job.advancePaid && job.advancePaid > 0 ? (
                            <p className="text-[10px] text-emerald-600 font-semibold font-mono">
                              Paid: ₹{job.advancePaid}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {/* Issues & Notes */}
                      {(job.issueNotes || (job.issues && job.issues.length > 0)) && (
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-xs text-slate-700 space-y-1">
                          {job.issues && job.issues.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {job.issues.map((issue) => (
                                <span
                                  key={issue}
                                  className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 text-[10px] font-medium"
                                >
                                  {issue}
                                </span>
                              ))}
                            </div>
                          )}
                          {job.issueNotes && (
                            <p className="text-slate-600 line-clamp-2 text-[11px] italic">
                              "{job.issueNotes}"
                            </p>
                          )}
                        </div>
                      )}

                      {/* Status Selector & Direct Communication */}
                      <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2 flex-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border shrink-0 ${statusMeta.pillClass}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                            {statusMeta.label}
                          </span>

                          <select
                            value={job.status}
                            onChange={(e) => handleStatusChange(job.id || '', e.target.value as StatusValue)}
                            className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-medium focus:border-blue-500 outline-none flex-1"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                Change to: {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5 justify-end">
                          {job.mobile && (
                            <>
                              <button
                                onClick={() => handleWhatsAppUpdate(job)}
                                className="p-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                                title="Send WhatsApp Status Update"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </button>
                              <a
                                href={`tel:${job.mobile}`}
                                className="p-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                                title="Call Customer"
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                            </>
                          )}

                          <Link
                            to={`/view-job/${jobCode}`}
                            target="_blank"
                            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                            title="Open Public Tracking Page"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>

                          <button
                            onClick={() => {
                              setSelectedJobForLabel(job);
                              setIsLabelsModalOpen(true);
                            }}
                            className="p-2 bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors"
                            title="Print Device Sticker Label (4.8cm × 2.4cm)"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handlePrintJobSheet(job)}
                            disabled={printingJobId === job.id}
                            className="p-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors disabled:opacity-50"
                            title="Print PDF Job Sheet"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleDelete(job.id || '')}
                            disabled={deletingJobId === job.id}
                            className="p-2 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-50"
                            title="Delete Job"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop View: Full-featured Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-3.5 pl-5 pr-3">Job ID & Ref</th>
                      <th className="py-3.5 px-3">Customer Details</th>
                      <th className="py-3.5 px-3">Device & Specs</th>
                      <th className="py-3.5 px-3">Complaint / Issues</th>
                      <th className="py-3.5 px-3 text-right">Cost (₹)</th>
                      <th className="py-3.5 px-3 text-center">Status Pipeline</th>
                      <th className="py-3.5 px-3">Created</th>
                      <th className="py-3.5 pl-3 pr-5 text-right">Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredJobs.map((job) => {
                      const statusMeta = getStatusMeta(job.status);
                      const isUrgent = job.priority === 'urgent';
                      const jobCode = job.jobSheetNumber || job.qrCodeValue || job.id;

                      return (
                        <tr
                          key={job.id}
                          className="hover:bg-blue-50/30 transition-colors group"
                        >
                          {/* Job ID & Ref */}
                          <td className="py-3.5 pl-5 pr-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-xs font-black text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                                  {job.jobSheetNumber || '-'}
                                </span>
                                {selectedLocation === 'all_locations' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                    {job._storeId === 'hub_warehouse' ? (
                                      <>
                                        <Warehouse className="w-2.5 h-2.5 text-amber-600" />
                                        <span>Hub Workshop</span>
                                      </>
                                    ) : (
                                      <>
                                        <Building2 className="w-2.5 h-2.5 text-blue-600" />
                                        <span>{job._storeName || 'Branch'}</span>
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                              {isUrgent && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold">
                                  <Flame className="w-3 h-3 text-rose-500" /> Urgent
                                </span>
                              )}
                              {job.serviceType && job.serviceType !== 'walk-in' && (
                                <p className="text-[10px] text-slate-400 capitalize">{job.serviceType}</p>
                              )}
                            </div>
                          </td>

                          {/* Customer Details */}
                          <td className="py-3.5 px-3">
                            <div className="space-y-0.5">
                              <p className="font-bold text-slate-900 text-xs">
                                {job.customerName || 'Walk-in Customer'}
                              </p>
                              {job.mobile && (
                                <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
                                  <span>{job.mobile}</span>
                                  <button
                                    onClick={() => handleWhatsAppUpdate(job)}
                                    className="text-emerald-600 hover:text-emerald-700 p-0.5 rounded transition-colors"
                                    title="Send WhatsApp update"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </button>
                                  <a
                                    href={`tel:${job.mobile}`}
                                    className="text-blue-600 hover:text-blue-700 p-0.5 rounded transition-colors"
                                    title="Call"
                                  >
                                    <Phone className="w-3 h-3" />
                                  </a>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Device & Specs */}
                          <td className="py-3.5 px-3">
                            <div className="space-y-0.5">
                              <p className="font-bold text-slate-900 flex items-center gap-1.5">
                                <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>{job.productName}</span>
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {[job.brand, job.modelName].filter(Boolean).join(' ') || '-'}
                              </p>
                              {job.color && (
                                <span className="text-[10px] text-slate-400">Color: {job.color}</span>
                              )}
                            </div>
                          </td>

                          {/* Reported Issues */}
                          <td className="py-3.5 px-3 max-w-xs">
                            <div className="space-y-1">
                              {job.issues && job.issues.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {job.issues.slice(0, 2).map((issue) => (
                                    <span
                                      key={issue}
                                      className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium"
                                    >
                                      {issue}
                                    </span>
                                  ))}
                                  {job.issues.length > 2 && (
                                    <span className="px-1 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">
                                      +{job.issues.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                              {job.issueNotes && (
                                <p className="text-[11px] text-slate-600 line-clamp-1 italic">
                                  "{job.issueNotes}"
                                </p>
                              )}
                            </div>
                          </td>

                          {/* Cost */}
                          <td className="py-3.5 px-3 text-right">
                            <p className="font-black text-slate-900 font-mono text-xs tabular-nums">
                              ₹{Number(job.cost || 0).toLocaleString('en-IN')}
                            </p>
                            {job.advancePaid && job.advancePaid > 0 ? (
                              <p className="text-[10px] text-emerald-600 font-mono">
                                Adv: ₹{job.advancePaid}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-400">Nil Advance</p>
                            )}
                          </td>

                          {/* Status Pipeline with Changer */}
                          <td className="py-3.5 px-3 text-center">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${statusMeta.pillClass}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                                {statusMeta.label}
                              </span>

                              <select
                                value={job.status}
                                onChange={(e) =>
                                  handleStatusChange(job.id || '', e.target.value as StatusValue)
                                }
                                className="border border-slate-200 bg-white text-slate-700 text-[10px] rounded-md px-1.5 py-0.5 outline-none hover:border-blue-400 focus:border-blue-500 cursor-pointer"
                              >
                                {STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* Created Date */}
                          <td className="py-3.5 px-3 text-slate-500 text-[11px]">
                            {formatDate(job.createdAt)}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 pl-3 pr-5 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                              <Link
                                to={`/view-job/${jobCode}`}
                                target="_blank"
                                className="p-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 rounded-lg transition-colors"
                                title="Public Tracking Page"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Link>

                              <button
                                onClick={() => {
                                  setSelectedJobForLabel(job);
                                  setIsLabelsModalOpen(true);
                                }}
                                className="p-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors"
                                title="Print Device Sticker Label (4.8cm × 2.4cm)"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handlePrintJobSheet(job)}
                                disabled={printingJobId === job.id}
                                className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                                title="Print Job Sheet PDF"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleDelete(job.id || '')}
                                disabled={deletingJobId === job.id}
                                className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg transition-colors disabled:opacity-50"
                                title="Delete Job"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Service QR Label Generator Modal */}
      <PrintServiceQRLabelsModal
        isOpen={isLabelsModalOpen}
        onClose={() => {
          setIsLabelsModalOpen(false);
          setSelectedJobForLabel(null);
        }}
        job={selectedJobForLabel}
      />

      {/* QR Scanner Modal for instant lookups */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanLookup}
        title="Scan Job Sheet or Device QR Sticker"
      />
    </div>
  );
}
