import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  doc,
  getDoc,
  setDoc,
  runTransaction
} from 'firebase/firestore';
import {
  ArrowLeft,
  Save,
  QrCode,
  Camera,
  User,
  Banknote,
  Search,
  Phone,
  Mail,
  MapPin,
  Flame,
  Check
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import QRScannerModal from '../components/QRScannerModal';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import { db } from '../config/firebase';
import type { Customer, ServiceRequest, Brand } from '../types';
import { getBranchServicePrefix } from '../utils/serviceSequence';

type SparePartRow = {
  partName: string;
  quantity: number;
  price: number;
  warranty: string;
};

type ServiceFormState = {
  jobSheetNumber: string;
  jobDate: string;
  jobTime: string;
  serviceType: 'walk-in' | 'pickup' | 'warranty' | 'insurance';
  priority: 'normal' | 'urgent';
  status: 'received' | 'repairing' | 'serviced' | 'delivered';
  customerName: string;
  mobile: string;
  alternateNumber: string;
  email: string;
  address: string;
  gstNumber: string;
  brand: string;
  modelName: string;
  productName: string;
  imei1: string;
  imei2: string;
  serialNumber: string;
  color: string;
  storageVariant: string;
  processorVariant: string;
  purchaseDate: string;
  warrantyStatus: 'in-warranty' | 'out-of-warranty';
  screenLockType: 'none' | 'pin' | 'password' | 'pattern' | 'fingerprint' | 'face-lock';
  unlockCode: string;
  googleAccountRemoved: boolean;
  appleIdRemoved: boolean;
  frpLockStatus: 'unknown' | 'locked' | 'unlocked';
  simRemoved: boolean;
  memoryCardRemoved: boolean;
  simRemovedCheck?: boolean;
  issues: string[];
  issueNotes: string;
  inspection: Record<string, boolean>;
  accessoriesReceived: string[];
  preliminaryInspection: string;
  possibleCause: string;
  partsRequired: string;
  estimatedRepairTime: string;
  estimatedCost: string;
  workPerformed: string;
  partsReplaced: string;
  softwareUpdated: boolean;
  dataBackupTaken: boolean;
  factoryResetDone: boolean;
  waterCleaningDone: boolean;
  solderingWorkDone: boolean;
  spareParts: SparePartRow[];
  approvedCost: string;
  advancePaid: string;
  paymentMethod: 'cash' | 'upi' | 'card' | 'bank-transfer';
  customerSignature: string;
  finalTesting: Record<string, boolean>;
  deliveryDate: string;
  deliveredBy: string;
  receivedByCustomer: string;
  balanceAmount: string;
  deliverySignature: string;
  qrCodeValue: string;
  photoUrlsText: string;
  internalNotes: string;
  termsAccepted: boolean;
};

const ISSUE_OPTIONS = [
  'Display Broken',
  'Touch Not Working',
  'Not Charging',
  'Battery Drain',
  'Dead Phone',
  'Water Damage',
  'Speaker Problem',
  'Mic Problem',
  'Camera Not Working',
  'Network Issue',
  'Restarting Automatically',
  'Heating Issue',
  'Software Issue',
  'Hanging / Lag',
  'Back Glass Broken',
  'Power Button Issue',
  'Volume Button Issue',
  'Motherboard Issue',
  'Others'
];

const ACCESSORY_OPTIONS = [
  'Charger',
  'Adapter Only',
  'Type-C Cable',
  'Lightning Cable',
  'SIM Tray',
  'Back Cover / Case',
  'Earphones',
  'Memory Card',
  'Box / Packaging',
  'Stylus Pen',
  'Others'
];

const INSPECTION_ITEMS: Array<{ key: string; label: string; category: string }> = [
  { key: 'frontGlassCondition', label: 'Front Glass Intact (No Cracks)', category: 'Body & Screen' },
  { key: 'touchWorking', label: 'Touch Function Responsive', category: 'Body & Screen' },
  { key: 'displayLines', label: 'Display Free of Lines/Spots', category: 'Body & Screen' },
  { key: 'backPanelCondition', label: 'Back Panel Scratch Free', category: 'Body & Screen' },
  { key: 'frameDamage', label: 'Frame Body Straight (No Bend)', category: 'Body & Screen' },
  { key: 'chargingPortCondition', label: 'Charging Port Pins OK', category: 'Hardware & Ports' },
  { key: 'fastCharging', label: 'Takes Charge Normally', category: 'Hardware & Ports' },
  { key: 'powerButton', label: 'Power Button Clicks', category: 'Hardware & Ports' },
  { key: 'volumeButtons', label: 'Volume Buttons Click', category: 'Hardware & Ports' },
  { key: 'frontCamera', label: 'Front Camera Clear', category: 'Camera & Media' },
  { key: 'rearCamera', label: 'Rear Camera Focus OK', category: 'Camera & Media' },
  { key: 'flashWorking', label: 'Flashlight Functional', category: 'Camera & Media' },
  { key: 'speakerWorking', label: 'Main Loudspeaker Working', category: 'Audio & Sensors' },
  { key: 'earpieceWorking', label: 'Earpiece Speaker Working', category: 'Audio & Sensors' },
  { key: 'micWorking', label: 'Microphone Records Clear', category: 'Audio & Sensors' },
  { key: 'wifi', label: 'Wi-Fi & Bluetooth Detectable', category: 'Connectivity' },
  { key: 'mobileNetwork', label: 'SIM Signals Verified', category: 'Connectivity' },
  { key: 'waterIndicatorChecked', label: 'Liquid Indicator Inspected', category: 'Safety' },
  { key: 'corrosionFound', label: 'No Board Corrosion Observed', category: 'Safety' }
];

const POPULAR_BRANDS = [
  'Apple',
  'Samsung',
  'Vivo',
  'Oppo',
  'Realme',
  'Xiaomi',
  'OnePlus',
  'Motorola',
  'Nothing',
  'Google Pixel'
];

function nowAsDateTime() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  return { date, time };
}

function buildDefaultChecklist(items: Array<{ key: string }>) {
  return items.reduce<Record<string, boolean>>((acc, item) => {
    acc[item.key] = false;
    return acc;
  }, {});
}

export default function ServiceJobEntryPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore, stores } = useStore();
  const { success, error: showError } = useToastContext();
  const displayName = currentUser?.displayName || currentUser?.email || 'Unknown User';

  const { date, time } = useMemo(() => nowAsDateTime(), []);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [brands, setBrands] = useState<string[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);

  const handleScanSuccess = (scannedCode: string) => {
    setForm((prev) => ({
      ...prev,
      qrCodeValue: scannedCode,
      jobSheetNumber: scannedCode || prev.jobSheetNumber
    }));
    success(`Pre-printed QR Code assigned: ${scannedCode}`);
  };

  const [form, setForm] = useState<ServiceFormState>({
    jobSheetNumber: '...',
    jobDate: date,
    jobTime: time,
    serviceType: 'walk-in',
    priority: 'normal',
    status: 'received',
    customerName: '',
    mobile: '',
    alternateNumber: '',
    email: '',
    address: '',
    gstNumber: '',
    brand: '',
    modelName: '',
    productName: '',
    imei1: '',
    imei2: '',
    serialNumber: '',
    color: '',
    storageVariant: '',
    processorVariant: '',
    purchaseDate: '',
    warrantyStatus: 'out-of-warranty',
    screenLockType: 'none',
    unlockCode: '',
    googleAccountRemoved: false,
    appleIdRemoved: false,
    frpLockStatus: 'unknown',
    simRemoved: false,
    memoryCardRemoved: false,
    issues: [],
    issueNotes: '',
    inspection: buildDefaultChecklist(INSPECTION_ITEMS),
    accessoriesReceived: [],
    preliminaryInspection: '',
    possibleCause: '',
    partsRequired: '',
    estimatedRepairTime: '',
    estimatedCost: '',
    workPerformed: '',
    partsReplaced: '',
    softwareUpdated: false,
    dataBackupTaken: false,
    factoryResetDone: false,
    waterCleaningDone: false,
    solderingWorkDone: false,
    spareParts: [],
    approvedCost: '',
    advancePaid: '',
    paymentMethod: 'cash',
    customerSignature: '',
    finalTesting: {},
    deliveryDate: '',
    deliveredBy: '',
    receivedByCustomer: '',
    balanceAmount: '',
    deliverySignature: '',
    qrCodeValue: 'TLM-...',
    photoUrlsText: '',
    internalNotes: '',
    termsAccepted: true
  });

  // Calculate live balance amount
  const computedBalance = useMemo(() => {
    const est = Number(form.estimatedCost) || 0;
    const adv = Number(form.advancePaid) || 0;
    return Math.max(0, est - adv);
  }, [form.estimatedCost, form.advancePaid]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      balanceAmount: String(computedBalance)
    }));
  }, [computedBalance]);

  // Derive standardized branch service prefix (e.g. DZ-AN, DZ-MDU, DZ-HUB)
  const shopPrefix = useMemo(() => {
    return getBranchServicePrefix(currentStore, stores);
  }, [currentStore, stores]);

  // Fetch systematic next job number
  useEffect(() => {
    const fetchNextJobNumber = async () => {
      try {
        const counterDocRef = getDocRef('counters', 'serviceJobCounter');
        const counterCheck = await getDoc(counterDocRef);
        let nextNum = 1;
        if (counterCheck.exists()) {
          nextNum = counterCheck.data().nextJobNumber || 1;
        } else {
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
          nextNum = maxNum + 1;
          await setDoc(counterDocRef, {
            nextJobNumber: nextNum,
            lastUpdated: Timestamp.now()
          });
        }
        const systematicCode = `${shopPrefix}-${String(nextNum).padStart(4, '0')}`;
        setForm((prev) => ({
          ...prev,
          jobSheetNumber: systematicCode,
          qrCodeValue: systematicCode
        }));
      } catch (err) {
        console.error('Failed to load next systematic job number:', err);
      }
    };
    fetchNextJobNumber();
  }, [getCollectionRef, getDocRef, shopPrefix]);

  // Load customer directory
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const customersRef = getCollectionRef('customers');
        const q = query(customersRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const rows = snapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              name: doc.data().name || '',
              phone: doc.data().phone || '',
              email: doc.data().email || '',
              address: doc.data().address || '',
              gstin: doc.data().gstin || '',
              createdAt: doc.data().createdAt?.toDate?.() || new Date(),
              createdBy: doc.data().createdBy,
              createdByName: doc.data().createdByName
            } as Customer)
        );
        setCustomers(rows);
      } catch (err) {
        console.error('Failed to fetch customers', err);
      }
    };

    fetchCustomers();
  }, [getCollectionRef]);

  // Load device brands
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const q = query(collection(db, 'brands'), orderBy('name', 'asc'));
        const snapshot = await getDocs(q);
        const brandsList = snapshot.docs.map((doc) => {
          const data = doc.data() as Brand;
          return data.name;
        });
        const combined = Array.from(new Set([...POPULAR_BRANDS, ...brandsList])).filter(Boolean);
        setBrands(combined);
      } catch (err) {
        console.error('Failed to fetch brands', err);
        setBrands(POPULAR_BRANDS);
      }
    };

    fetchBrands();
  }, []);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    const q = customerSearch.toLowerCase();
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(customerSearch)
    );
  }, [customers, customerSearch]);

  const selectExistingCustomer = (c: Customer) => {
    setSelectedCustomerId(c.id || '');
    setForm((prev) => ({
      ...prev,
      customerName: c.name || prev.customerName,
      mobile: c.phone || prev.mobile,
      email: c.email || prev.email,
      address: c.address || prev.address,
      gstNumber: c.gstNo || prev.gstNumber
    }));
    setCustomerSearch(`${c.name} (${c.phone})`);
    setIsCustomerDropdownOpen(false);
    success(`Customer "${c.name}" loaded`);
  };

  const setField = <K extends keyof ServiceFormState>(key: K, value: ServiceFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleIssue = (issue: string) => {
    setForm((prev) => ({
      ...prev,
      issues: prev.issues.includes(issue)
        ? prev.issues.filter((i) => i !== issue)
        : [...prev.issues, issue]
    }));
  };

  const toggleAccessory = (value: string) => {
    setForm((prev) => ({
      ...prev,
      accessoriesReceived: prev.accessoriesReceived.includes(value)
        ? prev.accessoriesReceived.filter((item) => item !== value)
        : [...prev.accessoriesReceived, value]
    }));
  };

  const toggleInspection = (key: string) => {
    setForm((prev) => ({
      ...prev,
      inspection: {
        ...prev.inspection,
        [key]: !prev.inspection[key]
      }
    }));
  };

  const handleSelectAllInspection = () => {
    const allChecked = INSPECTION_ITEMS.every((item) => !!form.inspection[item.key]);
    const nextState = INSPECTION_ITEMS.reduce<Record<string, boolean>>((acc, item) => {
      acc[item.key] = !allChecked;
      return acc;
    }, {});
    setForm((prev) => ({ ...prev, inspection: nextState }));
  };

  const handleSubmit = async () => {
    if (!form.customerName.trim() || !form.mobile.trim()) {
      showError('Customer name and mobile number are required');
      return;
    }
    if (!form.brand.trim() || !form.modelName.trim()) {
      showError('Device brand and model name are required');
      return;
    }

    const estimatedCost = Number(form.estimatedCost || '0');
    const approvedCost = Number(form.approvedCost || '0');
    const advancePaid = Number(form.advancePaid || '0');
    const balanceAmount = Number(form.balanceAmount || '0');

    if (Number.isNaN(estimatedCost) || estimatedCost < 0) {
      showError('Estimated cost must be a valid amount');
      return;
    }

    let finalCustomerId = selectedCustomerId;
    try {
      setSaving(true);

      if (!finalCustomerId) {
        const byPhone = customers.find((c) => c.phone === form.mobile.trim());
        if (byPhone?.id) {
          finalCustomerId = byPhone.id;
        } else {
          const customerDoc = await addDoc(getCollectionRef('customers'), {
            name: form.customerName.trim(),
            phone: form.mobile.trim(),
            email: form.email.trim(),
            address: form.address.trim(),
            gstNo: form.gstNumber.trim(),
            createdAt: Timestamp.now(),
            createdBy: currentUser?.uid,
            createdByName: displayName
          });
          finalCustomerId = customerDoc.id;
        }
      }

      const lockType: 'none' | 'text' | 'pattern' =
        form.screenLockType === 'none'
          ? 'none'
          : form.screenLockType === 'pattern'
          ? 'pattern'
          : 'text';

      let finalJobSheetNumber = form.jobSheetNumber.trim();
      let finalQrCodeValue = form.qrCodeValue.trim();

      const isSystematic =
        form.jobSheetNumber.startsWith('TLM-') ||
        form.jobSheetNumber.startsWith('DZ-') ||
        form.jobSheetNumber.startsWith(`${shopPrefix}-`);

      await runTransaction(db, async (transaction) => {
        const counterDocRef = getDocRef('counters', 'serviceJobCounter');

        if (isSystematic) {
          const counterDoc = await transaction.get(counterDocRef);
          const currentNumber = counterDoc.exists()
            ? counterDoc.data().nextJobNumber || 1
            : 1;
          finalJobSheetNumber = `${shopPrefix}-${String(currentNumber).padStart(4, '0')}`;

          if (
            form.qrCodeValue.startsWith('TLM-') ||
            form.qrCodeValue.startsWith('DZ-') ||
            form.qrCodeValue.startsWith(`${shopPrefix}-`) ||
            !form.qrCodeValue.trim()
          ) {
            finalQrCodeValue = finalJobSheetNumber;
          }

          transaction.set(
            counterDocRef,
            {
              nextJobNumber: currentNumber + 1,
              lastUpdated: Timestamp.now()
            },
            { merge: true }
          );
        } else {
          const match = finalJobSheetNumber.match(/(\d+)$/);
          if (match && match[1]) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num)) {
              const counterDoc = await transaction.get(counterDocRef);
              const maxVal = counterDoc.exists()
                ? counterDoc.data().nextJobNumber || 1
                : 1;
              if (num >= maxVal) {
                transaction.set(
                  counterDocRef,
                  {
                    nextJobNumber: num + 1,
                    lastUpdated: Timestamp.now()
                  },
                  { merge: true }
                );
              }
            }
          }
        }

        const payload: Omit<ServiceRequest, 'id' | 'createdAt'> & {
          createdAt: Timestamp;
        } = {
          productName: `${form.brand} ${form.modelName}`.trim(),
          customerId: finalCustomerId,
          customerName: form.customerName.trim(),
          mobile: form.mobile.trim(),
          cost: estimatedCost,
          lockType,
          password: lockType === 'text' ? form.unlockCode.trim() : undefined,
          status: form.status,
          jobSheetNumber: finalJobSheetNumber,
          jobDate: form.jobDate,
          jobTime: form.jobTime,
          serviceType: form.serviceType,
          priority: form.priority,
          alternateNumber: form.alternateNumber.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          gstNumber: form.gstNumber.trim(),
          brand: form.brand.trim(),
          modelName: form.modelName.trim(),
          imei1: form.imei1.trim(),
          imei2: form.imei2.trim(),
          serialNumber: form.serialNumber.trim(),
          color: form.color.trim(),
          storageVariant: form.storageVariant.trim(),
          processorVariant: form.processorVariant.trim(),
          purchaseDate: form.purchaseDate,
          warrantyStatus: form.warrantyStatus,
          screenLockType: form.screenLockType,
          unlockCode: form.unlockCode,
          googleAccountRemoved: form.googleAccountRemoved,
          appleIdRemoved: form.appleIdRemoved,
          frpLockStatus: form.frpLockStatus,
          simRemoved: form.simRemoved,
          memoryCardRemoved: form.memoryCardRemoved,
          issues: form.issues,
          issueNotes: form.issueNotes.trim(),
          inspection: form.inspection,
          accessoriesReceived: form.accessoriesReceived,
          preliminaryInspection: form.preliminaryInspection.trim(),
          possibleCause: form.possibleCause.trim(),
          partsRequired: form.partsRequired.trim(),
          estimatedRepairTime: form.estimatedRepairTime.trim(),
          workPerformed: form.workPerformed.trim(),
          partsReplaced: form.partsReplaced.trim(),
          softwareUpdated: form.softwareUpdated,
          dataBackupTaken: form.dataBackupTaken,
          factoryResetDone: form.factoryResetDone,
          waterCleaningDone: form.waterCleaningDone,
          solderingWorkDone: form.solderingWorkDone,
          spareParts: form.spareParts,
          approvedCost,
          advancePaid,
          paymentMethod: form.paymentMethod,
          customerSignature: form.customerSignature.trim(),
          finalTesting: form.finalTesting,
          deliveryDate: form.deliveryDate,
          deliveredBy: form.deliveredBy.trim(),
          receivedByCustomer: form.receivedByCustomer.trim(),
          balanceAmount,
          deliverySignature: form.deliverySignature.trim(),
          qrCodeValue: finalQrCodeValue,
          photoUrls: form.photoUrlsText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          internalNotes: form.internalNotes.trim(),
          createdAt: Timestamp.now(),
          createdBy: currentUser?.uid || '',
          createdByName: displayName
        };

        const serviceRequestDocRef = doc(getCollectionRef('serviceRequests'));
        transaction.set(serviceRequestDocRef, payload);
      });

      success(`Job Sheet ${finalJobSheetNumber} created successfully!`);
      navigate('/service-management');
    } catch (err) {
      console.error('Failed to save service request', err);
      showError('Failed to create service job sheet');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <Navbar />

      <main className="max-w-full w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8 space-y-4">
        {/* Executive Header */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <button
                onClick={() => navigate('/service-management')}
                className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 flex items-center justify-center transition-all shrink-0 active:scale-95"
                title="Back to Service List"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    New Service Job Sheet
                  </h1>
                  <span className="font-mono text-xs font-black bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-lg">
                    {form.jobSheetNumber}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Device intake, diagnosis notes, hardware checklist & advance booking
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all active:scale-95"
              >
                <Camera className="w-4 h-4 text-blue-600" />
                <span>Scan Sticker QR</span>
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xs transition-all active:scale-95 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Creating Job...' : 'Save Job Sheet'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 2-Column Responsive Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT COLUMN: Intake, Customer & Device (7 Cols on LG) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Section 1: Job Reference & Service Protocol */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                    1
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Job Metadata & QR Tracking
                  </h2>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setField(
                        'priority',
                        form.priority === 'urgent' ? 'normal' : 'urgent'
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
                      form.priority === 'urgent'
                        ? 'bg-rose-50 border-rose-200 text-rose-700 shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>{form.priority === 'urgent' ? 'Urgent Job' : 'Normal Priority'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {/* QR Code Sticker Value */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Sticker Code / QR Tag
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.qrCodeValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          qrCodeValue: val,
                          jobSheetNumber: val.trim() || prev.jobSheetNumber
                        }));
                      }}
                      placeholder="e.g. TLM-0001"
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-8 pr-3 py-2 text-xs font-mono font-bold text-slate-900 outline-none transition-all"
                    />
                    <QrCode className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                {/* Job Sheet Number */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Job Sheet Number
                  </label>
                  <input
                    type="text"
                    value={form.jobSheetNumber}
                    onChange={(e) => setField('jobSheetNumber', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-blue-700 outline-none transition-all"
                  />
                </div>

                {/* Service Type */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Service Type
                  </label>
                  <select
                    value={form.serviceType}
                    onChange={(e) =>
                      setField(
                        'serviceType',
                        e.target.value as ServiceFormState['serviceType']
                      )
                    }
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                  >
                    <option value="walk-in">Walk-in Customer</option>
                    <option value="pickup">Courier / Pickup</option>
                    <option value="warranty">Brand Warranty</option>
                    <option value="insurance">Insurance Claim</option>
                  </select>
                </div>

                {/* Intake Date */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Intake Date
                  </label>
                  <input
                    type="date"
                    value={form.jobDate}
                    onChange={(e) => setField('jobDate', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  />
                </div>

                {/* Intake Time */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Intake Time
                  </label>
                  <input
                    type="time"
                    value={form.jobTime}
                    onChange={(e) => setField('jobTime', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  />
                </div>

                {/* Initial Status */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Initial Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setField('status', e.target.value as ServiceFormState['status'])
                    }
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer font-medium"
                  >
                    <option value="received">Received (Awaiting Inspection)</option>
                    <option value="repairing">Under Active Repair</option>
                    <option value="serviced">Serviced (Ready for Delivery)</option>
                    <option value="delivered">Delivered to Customer</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Section 2: Customer Intake */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                    2
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Customer Information
                  </h2>
                </div>
                <span className="text-[11px] text-slate-400">
                  Quick search auto-populates registered profile
                </span>
              </div>

              {/* Autocomplete / Search Existing Customer */}
              <div className="relative mb-3.5">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Search Registered Customer
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setIsCustomerDropdownOpen(true);
                      if (!e.target.value) setSelectedCustomerId('');
                    }}
                    onFocus={() => setIsCustomerDropdownOpen(true)}
                    placeholder="Search by customer name or 10-digit phone number..."
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-9 pr-8 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  {customerSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerSearch('');
                        setSelectedCustomerId('');
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Dropdown Results */}
                {isCustomerDropdownOpen && filteredCustomers.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-20 divide-y divide-slate-100">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectExistingCustomer(c)}
                        className="w-full text-left px-3.5 py-2 hover:bg-blue-50 transition-colors flex items-center justify-between"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900">{c.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{c.phone}</p>
                        </div>
                        <span className="text-[10px] text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded">
                          Select
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Input Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Customer Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.customerName}
                      onChange={(e) => setField('customerName', e.target.value)}
                      placeholder="e.g. Rahul Sharma"
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-8 pr-3 py-2 text-xs sm:text-sm text-slate-900 outline-none transition-all"
                    />
                    <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Primary Mobile <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="tel"
                      value={form.mobile}
                      onChange={(e) => setField('mobile', e.target.value)}
                      placeholder="9876543210"
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-8 pr-3 py-2 text-xs sm:text-sm font-mono text-slate-900 outline-none transition-all"
                    />
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Alternate Mobile
                  </label>
                  <input
                    type="tel"
                    value={form.alternateNumber}
                    onChange={(e) => setField('alternateNumber', e.target.value)}
                    placeholder="Optional 2nd phone"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      placeholder="customer@email.com"
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-800 outline-none transition-all"
                    />
                    <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Delivery Address / Locality
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setField('address', e.target.value)}
                      placeholder="Street, Area, City..."
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-800 outline-none transition-all"
                    />
                    <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              </div>
            </section>

            {/* Section 3: Device Identity & Specs */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                    3
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Device Specifications
                  </h2>
                </div>
                <span className="text-[11px] text-slate-400">
                  Select brand chip or type manually
                </span>
              </div>

              {/* Popular Brand Chips */}
              <div className="mb-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Popular Brands (Click to select)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_BRANDS.map((brandName) => {
                    const isSelected = form.brand.toLowerCase() === brandName.toLowerCase();
                    return (
                      <button
                        key={brandName}
                        type="button"
                        onClick={() => setField('brand', brandName)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {brandName}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Device Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Brand <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    list="brand-datalist"
                    value={form.brand}
                    onChange={(e) => setField('brand', e.target.value)}
                    placeholder="e.g. Apple, Samsung"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 font-medium outline-none transition-all"
                  />
                  <datalist id="brand-datalist">
                    {brands.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Model Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.modelName}
                    onChange={(e) => setField('modelName', e.target.value)}
                    placeholder="e.g. iPhone 13 / Galaxy S23"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 font-medium outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Device Color
                  </label>
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => setField('color', e.target.value)}
                    placeholder="e.g. Midnight Black"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Storage / RAM Variant
                  </label>
                  <input
                    type="text"
                    value={form.storageVariant}
                    onChange={(e) => setField('storageVariant', e.target.value)}
                    placeholder="e.g. 8GB / 128GB"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    IMEI 1 (15 digits)
                  </label>
                  <input
                    type="text"
                    value={form.imei1}
                    onChange={(e) => setField('imei1', e.target.value)}
                    placeholder="Dial *#06#"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Serial No / IMEI 2
                  </label>
                  <input
                    type="text"
                    value={form.imei2 || form.serialNumber}
                    onChange={(e) => {
                      setField('imei2', e.target.value);
                      setField('serialNumber', e.target.value);
                    }}
                    placeholder="Serial or IMEI 2"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 outline-none transition-all"
                  />
                </div>
              </div>
            </section>

            {/* Section 4: Lock & Device Security */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-xs">
                    4
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Security & Lock Access
                  </h2>
                </div>
                <span className="text-[11px] text-slate-400">
                  Required for technician testing
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Screen Lock Type
                  </label>
                  <select
                    value={form.screenLockType}
                    onChange={(e) =>
                      setField(
                        'screenLockType',
                        e.target.value as ServiceFormState['screenLockType']
                      )
                    }
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer font-medium"
                  >
                    <option value="none">No Lock / Open Device</option>
                    <option value="pin">Numeric PIN</option>
                    <option value="password">Alphanumeric Password</option>
                    <option value="pattern">Pattern (e.g. L-shape, 1-2-5-8)</option>
                    <option value="fingerprint">Biometric / Fingerprint</option>
                    <option value="face-lock">Face Lock</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unlock PIN / Pattern Password
                  </label>
                  <input
                    type="text"
                    value={form.unlockCode}
                    onChange={(e) => setField('unlockCode', e.target.value)}
                    placeholder={
                      form.screenLockType === 'pattern'
                        ? 'e.g. 1-2-5-8 or Z-shape'
                        : 'e.g. 1234 or device password'
                    }
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    FRP / Cloud Lock
                  </label>
                  <select
                    value={form.frpLockStatus}
                    onChange={(e) =>
                      setField(
                        'frpLockStatus',
                        e.target.value as ServiceFormState['frpLockStatus']
                      )
                    }
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                  >
                    <option value="unknown">Not Verified / Unknown</option>
                    <option value="unlocked">Account Removed / Unlocked</option>
                    <option value="locked">Locked / Customer Has Credentials</option>
                  </select>
                </div>
              </div>

              {/* Security Check Chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-100">
                {[
                  { key: 'simRemoved', label: 'SIM Removed' },
                  { key: 'memoryCardRemoved', label: 'Memory Card Removed' },
                  { key: 'googleAccountRemoved', label: 'Google Account Removed' },
                  { key: 'appleIdRemoved', label: 'Apple ID Removed' }
                ].map((item) => {
                  const isChecked = Boolean(form[item.key as keyof ServiceFormState]);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        setField(item.key as keyof ServiceFormState, (!isChecked) as never)
                      }
                      className={`p-2 rounded-xl text-xs font-semibold flex items-center justify-between border transition-all ${
                        isChecked
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-2xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{item.label}</span>
                      <div
                        className={`w-4 h-4 rounded-md flex items-center justify-center text-white text-[10px] ${
                          isChecked ? 'bg-emerald-600' : 'bg-slate-300'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN: Diagnostics, Inspection & Billing (5 Cols on LG) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Section 5: Complaints & Reported Issues */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-xs">
                    5
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Complaints & Reported Faults
                  </h2>
                </div>
                <span className="text-[11px] font-bold text-rose-600">
                  {form.issues.length} Issues Tagged
                </span>
              </div>

              {/* Quick Issue Chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ISSUE_OPTIONS.map((issue) => {
                  const isSelected = form.issues.includes(issue);
                  return (
                    <button
                      key={issue}
                      type="button"
                      onClick={() => toggleIssue(issue)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                        isSelected
                          ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {issue}
                    </button>
                  );
                })}
              </div>

              {/* Detailed Problem Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Technician / Customer Fault Description
                </label>
                <textarea
                  value={form.issueNotes}
                  onChange={(e) => setField('issueNotes', e.target.value)}
                  rows={2}
                  placeholder="e.g. Phone fell into water, display blank but vibrating, power button loose..."
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl p-2.5 text-xs text-slate-900 outline-none transition-all placeholder:text-slate-400"
                />
              </div>

              {/* Accessories Received */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Accessories Received With Device
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ACCESSORY_OPTIONS.map((acc) => {
                    const isSelected = form.accessoriesReceived.includes(acc);
                    return (
                      <button
                        key={acc}
                        type="button"
                        onClick={() => toggleAccessory(acc)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-all border ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 border-blue-300 font-bold'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {isSelected ? `✓ ${acc}` : `+ ${acc}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Section 6: Physical Inspection Checklist */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-xs">
                    6
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Physical Hardware Inspection
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleSelectAllInspection}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                  Toggle All OK
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                {INSPECTION_ITEMS.map((item) => {
                  const isChecked = !!form.inspection[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleInspection(item.key)}
                      className={`p-2 rounded-xl text-left text-xs font-semibold flex items-center justify-between border transition-all ${
                        isChecked
                          ? 'bg-teal-50/70 border-teal-300 text-teal-900'
                          : 'bg-slate-50/70 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span className="truncate pr-1">{item.label}</span>
                      <div
                        className={`w-3.5 h-3.5 rounded flex items-center justify-center text-white shrink-0 ${
                          isChecked ? 'bg-teal-600' : 'bg-slate-300'
                        }`}
                      >
                        {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Section 7: Commercials & Advance Payment */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                    7
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Estimate & Advance Receipt
                  </h2>
                </div>
                <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                  <Banknote className="w-4 h-4" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Estimated Repair Cost */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Estimated Cost (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={form.estimatedCost}
                      onChange={(e) => setField('estimatedCost', e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl pl-8 pr-3 py-2 text-sm font-mono font-bold text-slate-900 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Advance Amount Paid */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Advance Collected (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-600 font-bold text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={form.advancePaid}
                      onChange={(e) => setField('advancePaid', e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-emerald-500 rounded-xl pl-8 pr-3 py-2 text-sm font-mono font-bold text-emerald-700 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Mode & Delivery Commitment */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={form.paymentMethod}
                    onChange={(e) =>
                      setField(
                        'paymentMethod',
                        e.target.value as ServiceFormState['paymentMethod']
                      )
                    }
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer font-medium"
                  >
                    <option value="cash">Cash In Hand</option>
                    <option value="upi">UPI / QR Payment</option>
                    <option value="card">Card Swipe</option>
                    <option value="bank-transfer">Bank Transfer</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Est. Ready Time / Promise
                  </label>
                  <input
                    type="text"
                    value={form.estimatedRepairTime}
                    onChange={(e) => setField('estimatedRepairTime', e.target.value)}
                    placeholder="e.g. 2 Hours / Tomorrow 5 PM"
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Balance Due Live Slip */}
              <div className="bg-white border border-gray-200 rounded-lg p-3.5 sm:p-4 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider font-bold">
                    Balance Due on Delivery
                  </p>
                  <p className="text-2xl font-bold font-mono tracking-tight mt-0.5 text-blue-600">
                    ₹{computedBalance.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="text-right space-y-0.5">
                  <p className="text-xs font-medium text-gray-500 font-mono">
                    Total: <span className="font-bold text-gray-900">₹{(Number(form.estimatedCost) || 0).toLocaleString('en-IN')}</span>
                  </p>
                  <p className="text-xs font-medium text-emerald-700 font-mono">
                    Advance: <span className="font-bold">₹{(Number(form.advancePaid) || 0).toLocaleString('en-IN')}</span>
                  </p>
                </div>
              </div>

              {/* Internal Workshop Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Internal Workshop Notes (Private)
                </label>
                <input
                  type="text"
                  value={form.internalNotes}
                  onChange={(e) => setField('internalNotes', e.target.value)}
                  placeholder="Technician rack location, spare part source, etc."
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                />
              </div>

              {/* Primary Submit Button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="w-full py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white rounded-xl text-sm font-black flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Creating Job Sheet...' : 'Save & Issue Job Sheet'}</span>
              </button>
            </section>
          </div>
        </div>
      </main>

      {/* QR Scanner Modal for Pre-printed QR Stickers */}
      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
        title="Scan Pre-Printed Sticker QR"
      />
    </div>
  );
}
