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
  Building2,
  ChevronDown
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';

import Navbar from '../components/Navbar';
import LocationSwitcher from '../components/LocationSwitcher';
import PrintServiceQRLabelsModal from '../components/PrintServiceQRLabelsModal';
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
  subtleClass: string;
}> = [
  {
    value: 'received',
    label: 'Received',
    pillClass: 'bg-amber-50 text-amber-800 border-amber-200/80',
    dotClass: 'bg-amber-500',
    subtleClass: 'hover:border-amber-300'
  },
  {
    value: 'repairing',
    label: 'In Repair',
    pillClass: 'bg-sky-50 text-sky-800 border-sky-200/80',
    dotClass: 'bg-sky-500',
    subtleClass: 'hover:border-sky-300'
  },
  {
    value: 'serviced',
    label: 'Ready for Pickup',
    pillClass: 'bg-indigo-50 text-indigo-800 border-indigo-200/80',
    dotClass: 'bg-indigo-500',
    subtleClass: 'hover:border-indigo-300'
  },
  {
    value: 'delivered',
    label: 'Delivered',
    pillClass: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
    dotClass: 'bg-emerald-500',
    subtleClass: 'hover:border-emerald-300'
  }
];

function getStatusMeta(status: StatusValue) {
  return STATUS_OPTIONS.find((item) => item.value === status) || STATUS_OPTIONS[0];
}

function formatDate(value?: Date | string) {
  if (!value) return '—';
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
  return String(value);
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
  const [branchFilter, setBranchFilter] = useState<'all' | string>('all');
  const [isLabelsModalOpen, setIsLabelsModalOpen] = useState(false);
  const [selectedJobForLabel, setSelectedJobForLabel] = useState<ServiceRequest | null>(null);
  const [printingJobId, setPrintingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

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
            ...data,
            id: docSnap.id,
            productName:
              data.productName ||
              `${data.brand || ''} ${data.modelName || ''}`.trim() ||
              'Unknown Device',
            customerId: data.customerId || '',
            customerName: data.customerName || '',
            mobile: data.mobile || '',
            cost: Number(data.cost || data.approvedCost || 0),
            lockType: data.lockType || 'pattern',
            createdBy: data.createdBy || '',
            status,
            jobSheetNumber: data.jobSheetNumber,
            qrCodeValue: data.qrCodeValue,
            jobDate: data.jobDate,
            jobTime: data.jobTime,
            priority: data.priority || 'normal',
            brand: data.brand || '',
            modelName: data.modelName || '',
            color: data.color || '',
            issues: Array.isArray(data.issues) ? data.issues : [],
            issueNotes: data.issueNotes || '',
            advancePaid: Number(data.advancePaid || 0),
            balanceAmount: Number(data.balanceAmount || 0),
            serviceType: data.serviceType || 'walk-in',
            createdAt,
            _storeId: 'hub_warehouse',
            _storeName: 'Hub Workshop (Main Office)'
          } as ServiceRequest;
        });

        // 2. Fetch service requests from each branch subcollection
        const branchJobsPromises = stores
          .filter((store): store is typeof store & { id: string } => Boolean(store && store.id))
          .map(async (store) => {
            const storeId = store.id;
            try {
              const storeRef = collection(db, 'stores', storeId, 'serviceRequests');
              const snap = await getDocs(query(storeRef, orderBy('createdAt', 'desc')));
              return snap.docs.map((docSnap) => {
                const data = docSnap.data();
                const status = (data.status || 'received') as StatusValue;
                const createdAt = data.createdAt?.toDate?.() || new Date();
                return {
                  ...data,
                  id: docSnap.id,
                  productName:
                    data.productName ||
                    `${data.brand || ''} ${data.modelName || ''}`.trim() ||
                    'Unknown Device',
                  customerId: data.customerId || '',
                  customerName: data.customerName || '',
                  mobile: data.mobile || '',
                  cost: Number(data.cost || data.approvedCost || 0),
                  lockType: data.lockType || 'pattern',
                  createdBy: data.createdBy || '',
                  status,
                  jobSheetNumber: data.jobSheetNumber,
                  qrCodeValue: data.qrCodeValue,
                  jobDate: data.jobDate,
                  jobTime: data.jobTime,
                  priority: data.priority || 'normal',
                  brand: data.brand || '',
                  modelName: data.modelName || '',
                  color: data.color || '',
                  issues: Array.isArray(data.issues) ? data.issues : [],
                  issueNotes: data.issueNotes || '',
                  advancePaid: Number(data.advancePaid || 0),
                  balanceAmount: Number(data.balanceAmount || 0),
                  serviceType: data.serviceType || 'walk-in',
                  createdAt,
                  _storeId: storeId,
                  _storeName: store.name || 'Branch'
                } as ServiceRequest;
              });
            } catch (err) {
              console.error(`Failed to fetch service requests for branch ${storeId}:`, err);
              return [];
            }
          });

        const branchJobsNested = await Promise.all(branchJobsPromises);
        const branchJobs = branchJobsNested.flat();

        const combined = [...hubJobs, ...branchJobs];
        combined.sort((a, b) => {
          const tA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const tB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return tB - tA;
        });

        setJobs(combined);
      } else {
        const collectionRef = getCollectionRef('serviceRequests');
        const q = query(collectionRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        const loaded: ServiceRequest[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const status = (data.status || 'received') as StatusValue;
          const createdAt = data.createdAt?.toDate?.() || new Date();

          return {
            ...data,
            id: docSnap.id,
            productName:
              data.productName ||
              `${data.brand || ''} ${data.modelName || ''}`.trim() ||
              'Unknown Device',
            customerId: data.customerId || '',
            customerName: data.customerName || '',
            mobile: data.mobile || '',
            cost: Number(data.cost || data.approvedCost || 0),
            lockType: data.lockType || 'pattern',
            createdBy: data.createdBy || '',
            status,
            jobSheetNumber: data.jobSheetNumber,
            qrCodeValue: data.qrCodeValue,
            jobDate: data.jobDate,
            jobTime: data.jobTime,
            priority: data.priority || 'normal',
            brand: data.brand || '',
            modelName: data.modelName || '',
            color: data.color || '',
            issues: Array.isArray(data.issues) ? data.issues : [],
            issueNotes: data.issueNotes || '',
            advancePaid: Number(data.advancePaid || 0),
            balanceAmount: Number(data.balanceAmount || 0),
            serviceType: data.serviceType || 'walk-in',
            createdAt,
            _storeId: currentStore?.id || 'hub_warehouse',
            _storeName: currentStore?.name || 'Hub Workshop'
          } as ServiceRequest;
        });

        setJobs(loaded);
      }
    } catch (err) {
      console.error('Failed to load service jobs:', err);
      showError('Failed to load service requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [getCollectionRef, selectedLocation, stores.length]);

  const stats = useMemo(() => {
    const total = jobs.length;
    const received = jobs.filter((j) => j.status === 'received').length;
    const repairing = jobs.filter((j) => j.status === 'repairing').length;
    const serviced = jobs.filter((j) => j.status === 'serviced').length;
    const delivered = jobs.filter((j) => j.status === 'delivered').length;
    const urgentCount = jobs.filter((j) => j.priority === 'urgent').length;
    const totalValue = jobs.reduce((sum, j) => sum + Number(j.cost || 0), 0);

    return { total, received, repairing, serviced, delivered, urgentCount, totalValue };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // Branch filter if in all_locations
      if (selectedLocation === 'all_locations' && branchFilter !== 'all') {
        if (job._storeId !== branchFilter) return false;
      }

      // Status filter
      if (statusFilter !== 'all' && job.status !== statusFilter) {
        return false;
      }

      // Priority filter
      if (priorityFilter === 'urgent' && job.priority !== 'urgent') {
        return false;
      }

      // Text search
      if (!search.trim()) return true;

      const q = search.toLowerCase().trim();
      const jobCode = (job.jobSheetNumber || job.qrCodeValue || job.id || '').toLowerCase();
      const customer = (job.customerName || '').toLowerCase();
      const phone = (job.mobile || '').toLowerCase();
      const device = (job.productName || '').toLowerCase();
      const brand = (job.brand || '').toLowerCase();
      const issues = (job.issues || []).join(' ').toLowerCase();
      const notes = (job.issueNotes || '').toLowerCase();
      const storeName = (job._storeName || '').toLowerCase();

      return (
        jobCode.includes(q) ||
        customer.includes(q) ||
        phone.includes(q) ||
        device.includes(q) ||
        brand.includes(q) ||
        issues.includes(q) ||
        notes.includes(q) ||
        storeName.includes(q)
      );
    });
  }, [jobs, search, statusFilter, priorityFilter, branchFilter, selectedLocation]);

  const handleStatusChange = async (jobId: string, newStatus: StatusValue) => {
    try {
      const targetJob = jobs.find((j) => j.id === jobId);
      const targetStoreId = (targetJob as any)?._storeId;

      const payload: any = {
        status: newStatus,
        updatedAt: Timestamp.now(),
        updatedBy: currentUser?.uid || '',
        updatedByName: displayName
      };

      if (newStatus === 'delivered') {
        payload.deliveryDate = new Date().toISOString().split('T')[0];
        payload.deliveredBy = displayName;
      }

      if (targetStoreId && targetStoreId !== 'hub_warehouse') {
        const storeRef = doc(db, 'stores', targetStoreId, 'serviceRequests', jobId);
        await updateDoc(storeRef, payload);
      } else {
        const hubRef = doc(db, 'serviceRequests', jobId);
        await updateDoc(hubRef, payload);
      }

      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: newStatus,
                ...(newStatus === 'delivered'
                  ? {
                      deliveryDate: payload.deliveryDate,
                      deliveredBy: payload.deliveredBy
                    }
                  : {})
              }
            : job
        )
      );

      success(`Job status updated to ${getStatusMeta(newStatus).label}`);
    } catch (err) {
      console.error('Failed to update status:', err);
      showError('Failed to update job status');
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!window.confirm('Are you sure you want to delete this service job record?')) return;
    try {
      setDeletingJobId(jobId);
      const targetJob = jobs.find((j) => j.id === jobId);
      const targetStoreId = (targetJob as any)?._storeId;

      if (targetStoreId && targetStoreId !== 'hub_warehouse') {
        const storeRef = doc(db, 'stores', targetStoreId, 'serviceRequests', jobId);
        await deleteDoc(storeRef);
      } else {
        const hubRef = doc(db, 'serviceRequests', jobId);
        await deleteDoc(hubRef);
      }

      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      success('Service request deleted successfully');
    } catch (err) {
      console.error('Failed to delete service request:', err);
      showError('Failed to delete service request');
    } finally {
      setDeletingJobId(null);
    }
  };

  const handlePrintJobSheet = async (job: ServiceRequest) => {
    try {
      setPrintingJobId(job.id || 'current');
      await printJobSheet(job);
      success('Job sheet generated for print');
    } catch (err) {
      console.error('Failed to print job sheet:', err);
      showError('Failed to print job sheet');
    } finally {
      setPrintingJobId(null);
    }
  };

  const handleWhatsAppUpdate = (job: ServiceRequest) => {
    const cleanPhone = (job.mobile || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
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
    <div className="min-h-screen bg-slate-50/60 flex flex-col antialiased">
      <Navbar />

      <main className="w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 pb-24 sm:pb-12 space-y-4">
        {/* ================= HEADER BAR ================= */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                      Service Management
                    </h1>
                    <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/80">
                      Workshop Desk
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>Intake tracking, technician workflow, device tags & customer alerts</span>
                    <span className="text-slate-300">•</span>
                    {selectedLocation === 'all_locations' ? (
                      <span className="inline-flex items-center gap-1 text-blue-800 font-bold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                        <Layers className="w-3.5 h-3.5 text-blue-600" />
                        <span>Complete Service Data (Hub + All Branches)</span>
                      </span>
                    ) : currentStore?.name ? (
                      <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Branch: {currentStore.name}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-900 font-semibold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                        <Warehouse className="w-3.5 h-3.5 text-amber-700" />
                        <span>Hub Workshop (Main Office)</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Top Controls & Actions */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <LocationSwitcher includeAllLocations />

              <button
                type="button"
                onClick={() => {
                  setSelectedJobForLabel(null);
                  setIsLabelsModalOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                title="Print batch QR code stickers"
              >
                <QrCode className="w-4 h-4 text-purple-600" />
                <span>Print Stickers</span>
              </button>

              <button
                type="button"
                onClick={fetchJobs}
                disabled={loading}
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all cursor-pointer shadow-2xs"
                title="Refresh service list"
              >
                <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => navigate('/service-management/create')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs hover:shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Job Sheet</span>
              </button>
            </div>
          </div>
        </div>

        {/* ================= METRICS STRIP ================= */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Total Jobs */}
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`bg-white border rounded-xl p-3 text-left transition-all cursor-pointer flex flex-col justify-between ${
              statusFilter === 'all'
                ? 'border-blue-500 ring-2 ring-blue-500/10 shadow-xs'
                : 'border-slate-200/90 shadow-2xs hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Intake</span>
              <Layers className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="mt-2">
              <div className="text-xl sm:text-2xl font-black font-mono text-slate-900 leading-tight">
                {stats.total}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">All repair records</div>
            </div>
          </button>

          {/* Received */}
          <button
            type="button"
            onClick={() => setStatusFilter('received')}
            className={`bg-white border rounded-xl p-3 text-left transition-all cursor-pointer flex flex-col justify-between ${
              statusFilter === 'received'
                ? 'border-amber-500 ring-2 ring-amber-500/10 shadow-xs'
                : 'border-slate-200/90 shadow-2xs hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between text-amber-600">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Received</span>
              <Clock3 className="w-3.5 h-3.5" />
            </div>
            <div className="mt-2">
              <div className="text-xl sm:text-2xl font-black font-mono text-amber-700 leading-tight">
                {stats.received}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Awaiting technician</div>
            </div>
          </button>

          {/* In Repair */}
          <button
            type="button"
            onClick={() => setStatusFilter('repairing')}
            className={`bg-white border rounded-xl p-3 text-left transition-all cursor-pointer flex flex-col justify-between ${
              statusFilter === 'repairing'
                ? 'border-sky-500 ring-2 ring-sky-500/10 shadow-xs'
                : 'border-slate-200/90 shadow-2xs hover:border-sky-300'
            }`}
          >
            <div className="flex items-center justify-between text-sky-600">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">In Repair</span>
              <Wrench className="w-3.5 h-3.5" />
            </div>
            <div className="mt-2">
              <div className="text-xl sm:text-2xl font-black font-mono text-sky-700 leading-tight">
                {stats.repairing}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Active workbench</div>
            </div>
          </button>

          {/* Serviced / Ready */}
          <button
            type="button"
            onClick={() => setStatusFilter('serviced')}
            className={`bg-white border rounded-xl p-3 text-left transition-all cursor-pointer flex flex-col justify-between ${
              statusFilter === 'serviced'
                ? 'border-indigo-500 ring-2 ring-indigo-500/10 shadow-xs'
                : 'border-slate-200/90 shadow-2xs hover:border-indigo-300'
            }`}
          >
            <div className="flex items-center justify-between text-indigo-600">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Ready Pickup</span>
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <div className="mt-2">
              <div className="text-xl sm:text-2xl font-black font-mono text-indigo-700 leading-tight">
                {stats.serviced}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">QC passed & ready</div>
            </div>
          </button>

          {/* Delivered */}
          <button
            type="button"
            onClick={() => setStatusFilter('delivered')}
            className={`bg-white border rounded-xl p-3 text-left transition-all cursor-pointer flex flex-col justify-between ${
              statusFilter === 'delivered'
                ? 'border-emerald-500 ring-2 ring-emerald-500/10 shadow-xs'
                : 'border-slate-200/90 shadow-2xs hover:border-emerald-300'
            }`}
          >
            <div className="flex items-center justify-between text-emerald-600">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Delivered</span>
              <Smartphone className="w-3.5 h-3.5" />
            </div>
            <div className="mt-2">
              <div className="text-xl sm:text-2xl font-black font-mono text-emerald-700 leading-tight">
                {stats.delivered}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Handed to customer</div>
            </div>
          </button>

          {/* Total Value */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Pipeline Value</span>
              <Banknote className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="mt-2">
              <div className="text-xl sm:text-2xl font-black font-mono text-slate-900 leading-tight">
                ₹{stats.totalValue.toLocaleString('en-IN')}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-between">
                <span>Estimated revenue</span>
                {stats.urgentCount > 0 && (
                  <span className="text-rose-600 font-bold inline-flex items-center gap-0.5">
                    <Flame className="w-3 h-3" /> {stats.urgentCount} Urgent
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ================= FILTER TOOLBAR ================= */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-4 shadow-2xs space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px] max-w-md xl:max-w-xl">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search job #, customer name, mobile, device, fault..."
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-9 pr-9 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none transition-all"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Secondary Filters */}
            <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
              {/* Branch filter if in all_locations */}
              {selectedLocation === 'all_locations' && (
                <div className="relative">
                  <select
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-xs font-semibold text-slate-700 outline-none hover:bg-slate-100 transition-all cursor-pointer appearance-none"
                  >
                    <option value="all">All Locations (Hub + Branches)</option>
                    <option value="hub_warehouse">Hub Workshop (Main Office)</option>
                    {stores.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name || 'Branch'}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              )}

              {/* Priority Pill */}
              <button
                type="button"
                onClick={() => setPriorityFilter(priorityFilter === 'all' ? 'urgent' : 'all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
                  priorityFilter === 'urgent'
                    ? 'bg-rose-50 border-rose-200 text-rose-700 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Flame className={`w-3.5 h-3.5 ${priorityFilter === 'urgent' ? 'text-rose-600' : 'text-slate-400'}`} />
                <span>Urgent Only</span>
                {stats.urgentCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-600 text-white font-bold">
                    {stats.urgentCount}
                  </span>
                )}
              </button>

              <div className="text-xs text-slate-500 font-medium pl-2 hidden sm:block whitespace-nowrap">
                Showing <strong>{filteredJobs.length}</strong> of {jobs.length} jobs
              </div>
            </div>
          </div>

          {/* Status Tabs Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-t border-slate-100 pt-2.5 scrollbar-none">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>All Statuses</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
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
                  type="button"
                  onClick={() => setStatusFilter(status.value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap border cursor-pointer ${
                    isActive
                      ? `${status.pillClass} font-black shadow-2xs`
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

        {/* ================= DATA CONTAINER ================= */}
        <div className="bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden">
          {loading ? (
            <div className="p-16 text-center">
              <RotateCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-800">Loading service intake ledger...</p>
              <p className="text-xs text-slate-400 mt-1">Fetching repair jobs across active location</p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-16 text-center max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
                <Wrench className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">No service jobs found</h3>
              <p className="text-xs text-slate-500 mt-1">
                {search || statusFilter !== 'all' || priorityFilter !== 'all' || branchFilter !== 'all'
                  ? 'No repair jobs matched your current search or filter settings.'
                  : 'No repair requests in this workshop ledger yet. Create your first job sheet!'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {(search || statusFilter !== 'all' || priorityFilter !== 'all' || branchFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                      setPriorityFilter('all');
                      setBranchFilter('all');
                    }}
                    className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Clear Filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/service-management/create')}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Job Sheet</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Mobile View: Cards */}
              <div className="lg:hidden divide-y divide-slate-100">
                {filteredJobs.map((job) => {
                  const statusMeta = getStatusMeta(job.status);
                  const isUrgent = job.priority === 'urgent';
                  const jobCode = job.jobSheetNumber || job.qrCodeValue || job.id;

                  return (
                    <div key={job.id} className="p-4 space-y-3 hover:bg-slate-50/50 transition-colors">
                      {/* Top Bar: Job Ref, Branch, Priority & Date */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                            {job.jobSheetNumber || '—'}
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
                            Customer: <strong className="text-slate-900">{job.customerName || 'Walk-in'}</strong>
                          </p>
                          {job.mobile && (
                            <p className="text-xs text-slate-500 font-mono ml-5.5">{job.mobile}</p>
                          )}
                        </div>

                        {/* Cost & Advance */}
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">Cost</span>
                          <span className="text-base font-bold text-slate-900 font-mono tabular-nums">
                            ₹{Number(job.cost || 0).toLocaleString('en-IN')}
                          </span>
                          {job.advancePaid && job.advancePaid > 0 ? (
                            <p className="text-[10px] text-emerald-600 font-semibold font-mono">
                              Adv: ₹{job.advancePaid}
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

                      {/* Status Selector & Communication Actions */}
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
                            className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-medium focus:border-blue-500 outline-none flex-1 cursor-pointer"
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
                                type="button"
                                onClick={() => handleWhatsAppUpdate(job)}
                                className="p-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                                title="Send WhatsApp Status Alert"
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
                            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer"
                            title="Open Public Tracking Page"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedJobForLabel(job);
                              setIsLabelsModalOpen(true);
                            }}
                            className="p-2 bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors cursor-pointer"
                            title="Print Device Sticker Label (4.8cm × 2.4cm)"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handlePrintJobSheet(job)}
                            disabled={printingJobId === job.id}
                            className="p-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                            title="Print PDF Job Sheet"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(job.id || '')}
                            disabled={deletingJobId === job.id}
                            className="p-2 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
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

              {/* Desktop View: Clean Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-3.5 pl-5 pr-3">Job ID & Ref</th>
                      <th className="py-3.5 px-3">Customer Details</th>
                      <th className="py-3.5 px-3">Device & Specs</th>
                      <th className="py-3.5 px-3">Complaint / Issues</th>
                      <th className="py-3.5 px-3 text-right">Cost (₹)</th>
                      <th className="py-3.5 px-3 text-center">Status Pipeline</th>
                      <th className="py-3.5 px-3">Intake Date</th>
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
                          className="hover:bg-slate-50/70 transition-colors group"
                        >
                          {/* Job ID & Location */}
                          <td className="py-3.5 pl-5 pr-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                                  {job.jobSheetNumber || '—'}
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
                                    type="button"
                                    onClick={() => handleWhatsAppUpdate(job)}
                                    className="text-emerald-600 hover:text-emerald-700 p-0.5 rounded transition-colors cursor-pointer"
                                    title="Send WhatsApp update"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                  </button>
                                  <a
                                    href={`tel:${job.mobile}`}
                                    className="text-blue-600 hover:text-blue-700 p-0.5 rounded transition-colors"
                                    title="Call Customer"
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
                                {[job.brand, job.modelName].filter(Boolean).join(' ') || '—'}
                              </p>
                              {job.color && (
                                <span className="text-[10px] text-slate-400 block">Color: {job.color}</span>
                              )}
                            </div>
                          </td>

                          {/* Reported Issues */}
                          <td className="py-3.5 px-3 max-w-xs xl:max-w-md">
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
                            <p className="font-bold text-slate-900 font-mono text-xs tabular-nums">
                              ₹{Number(job.cost || 0).toLocaleString('en-IN')}
                            </p>
                            {job.advancePaid && job.advancePaid > 0 ? (
                              <p className="text-[10px] text-emerald-600 font-mono">
                                Adv: ₹{job.advancePaid}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-400">Nil Adv</p>
                            )}
                          </td>

                          {/* Status Pipeline with Changer */}
                          <td className="py-3.5 px-3 text-center">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusMeta.pillClass}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                                {statusMeta.label}
                              </span>

                              <select
                                value={job.status}
                                onChange={(e) =>
                                  handleStatusChange(job.id || '', e.target.value as StatusValue)
                                }
                                className="border border-slate-200 bg-white text-slate-700 text-[10px] font-medium rounded-md px-1.5 py-0.5 outline-none hover:border-blue-400 focus:border-blue-500 cursor-pointer shadow-2xs"
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
                          <td className="py-3.5 px-3 text-slate-500 text-[11px] font-medium">
                            {formatDate(job.createdAt)}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 pl-3 pr-5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Link
                                to={`/view-job/${jobCode}`}
                                target="_blank"
                                className="p-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 rounded-lg transition-colors cursor-pointer"
                                title="Public Tracking Page"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Link>

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedJobForLabel(job);
                                  setIsLabelsModalOpen(true);
                                }}
                                className="p-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors cursor-pointer"
                                title="Print Device Sticker Label (4.8cm × 2.4cm)"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handlePrintJobSheet(job)}
                                disabled={printingJobId === job.id}
                                className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                                title="Print Job Sheet PDF"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDelete(job.id || '')}
                                disabled={deletingJobId === job.id}
                                className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
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
        shopName={currentStore?.shopName || 'Digital Zone'}
        job={selectedJobForLabel}
      />
    </div>
  );
}
