import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Package,
  Plus,
  Search,
  Check,
  Clock,
  UserPlus,
  X,
  Trash2,
  Phone,
  RefreshCw,
  MessageSquare,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Warehouse,
  Building2,
  Layers,
  Download,
  FileText,
  FileSpreadsheet,
  EyeOff,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import LocationSwitcher from '../components/LocationSwitcher';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { StockRequirement, Customer } from '../types';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type StatusType = 'pending' | 'stock-updated' | 'customer-updated';

function StockRequirementPage() {
  const { currentUser } = useAuth();
  const { getCollectionRef, currentStore, selectedLocation, stores } = useStore();
  const { success, error: showError } = useToastContext();
  const displayName = currentUser?.displayName || currentUser?.email || 'Staff';

  // Form state
  const [productName, setProductName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  // Data state
  const [requirements, setRequirements] = useState<StockRequirement[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<'all' | StatusType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Add customer modal state
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');

  // Download & Privacy Confirmation Modal state
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [omitCustomerPhone, setOmitCustomerPhone] = useState(true);
  const [downloadScope, setDownloadScope] = useState<'filtered' | 'pending' | 'all'>('filtered');

  // Click outside to dismiss customer dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target as Node)) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch customers from Firebase
  const fetchCustomers = async () => {
    try {
      const customersRef = getCollectionRef('customers');
      const q = query(customersRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);

      const customersList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || '',
        phone: doc.data().phone || '',
        email: doc.data().email || '',
        createdAt: doc.data().createdAt?.toDate() || new Date(),
        createdBy: doc.data().createdBy,
        createdByName: doc.data().createdByName,
      }));

      setCustomers(customersList);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  // Fetch stock requirements from Firebase
  const fetchRequirements = async () => {
    try {
      setLoading(true);

      if (selectedLocation === 'all_locations') {
        // Fetch Hub requirements
        const hubRef = collection(db, 'stockRequirements');
        const hubSnap = await getDocs(query(hubRef, orderBy('createdAt', 'desc')));
        const hubList: StockRequirement[] = hubSnap.docs.map(doc => ({
          id: doc.id,
          productName: doc.data().productName,
          customerId: doc.data().customerId,
          customerName: doc.data().customerName,
          mobile: doc.data().mobile,
          status: doc.data().status,
          createdAt: doc.data().createdAt?.toDate() || new Date(),
          createdBy: doc.data().createdBy,
          createdByName: doc.data().createdByName,
          updatedAt: doc.data().updatedAt?.toDate(),
          updatedBy: doc.data().updatedBy,
          updatedByName: doc.data().updatedByName,
          _storeId: 'hub_warehouse',
          _storeName: 'Hub Warehouse',
        })) as StockRequirement[];

        // Fetch each branch
        const branchPromises = stores
          .filter((s): s is typeof s & { id: string } => Boolean(s && s.id))
          .map(async store => {
            const storeId = store.id;
            try {
              const bRef = collection(db, 'stores', storeId, 'stockRequirements');
              const bSnap = await getDocs(query(bRef, orderBy('createdAt', 'desc')));
              return bSnap.docs.map(doc => ({
                id: doc.id,
                productName: doc.data().productName,
                customerId: doc.data().customerId,
                customerName: doc.data().customerName,
                mobile: doc.data().mobile,
                status: doc.data().status,
                createdAt: doc.data().createdAt?.toDate() || new Date(),
                createdBy: doc.data().createdBy,
                createdByName: doc.data().createdByName,
                updatedAt: doc.data().updatedAt?.toDate(),
                updatedBy: doc.data().updatedBy,
                updatedByName: doc.data().updatedByName,
                _storeId: storeId,
                _storeName: store.name,
              })) as StockRequirement[];
            } catch (err) {
              console.error(`Error loading requirements for store ${store.name}:`, err);
              return [] as StockRequirement[];
            }
          });

        const branchResults = await Promise.all(branchPromises);
        const allList = [...hubList, ...branchResults.flat()].sort((a, b) => {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        setRequirements(allList);
      } else {
        const requirementsRef = getCollectionRef('stockRequirements');
        const q = query(requirementsRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const locName = currentStore ? currentStore.name : 'Hub Warehouse';
        const locId = currentStore?.id || 'hub_warehouse';

        const requirementsList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          productName: doc.data().productName,
          customerId: doc.data().customerId,
          customerName: doc.data().customerName,
          mobile: doc.data().mobile,
          status: doc.data().status,
          createdAt: doc.data().createdAt?.toDate() || new Date(),
          createdBy: doc.data().createdBy,
          createdByName: doc.data().createdByName,
          updatedAt: doc.data().updatedAt?.toDate(),
          updatedBy: doc.data().updatedBy,
          updatedByName: doc.data().updatedByName,
          _storeId: locId,
          _storeName: locName,
        })) as StockRequirement[];

        setRequirements(requirementsList);
      }
    } catch (error) {
      console.error('Error fetching stock requirements:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchRequirements();
  }, [selectedLocation, currentStore?.id, stores]);

  // Add new customer modal action
  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      showError('Please enter customer name and phone number');
      return;
    }

    try {
      const docRef = await addDoc(getCollectionRef('customers'), {
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim(),
        email: newCustomerEmail.trim() || '',
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid,
        createdByName: displayName,
      });

      const created: Customer = {
        id: docRef.id,
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim(),
        email: newCustomerEmail.trim(),
        createdAt: new Date(),
        createdBy: currentUser?.uid,
        createdByName: displayName,
      };

      setCustomers(prev => [created, ...prev]);
      setSelectedCustomerId(docRef.id);
      setCustomerSearch(created.name);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setNewCustomerEmail('');
      setShowAddCustomer(false);
      success('Customer added and selected');
    } catch (error) {
      console.error('Error adding customer:', error);
      showError('Failed to add customer');
    }
  };

  // Add new stock requirement
  const handleAddRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) {
      showError('Please enter product / item name');
      return;
    }

    let finalCustomer: Customer | undefined | null = null;
    const inputVal = customerSearch.trim();

    if (selectedCustomerId) {
      finalCustomer = customers.find(c => c.id === selectedCustomerId);
    } else if (inputVal) {
      const existingByPhone = customers.find(c => c.phone === inputVal);
      if (existingByPhone) {
        finalCustomer = existingByPhone;
      } else {
        if (!/[a-zA-Z]/.test(inputVal) && inputVal.length >= 10) {
          try {
            setSaving(true);
            const nextNum = customers.length + 1;
            const newName = `Customer ${nextNum}`;
            const newCustomerData = {
              name: newName,
              phone: inputVal,
              email: '',
              createdAt: Timestamp.now(),
              createdBy: currentUser?.uid,
              createdByName: displayName,
            };

            const docRef = await addDoc(getCollectionRef('customers'), newCustomerData);
            finalCustomer = {
              id: docRef.id,
              ...newCustomerData,
              createdAt: new Date(),
            } as Customer;

            setCustomers(prev => [finalCustomer!, ...prev]);
          } catch (error) {
            console.error('Error creating customer:', error);
          }
        }
      }
    }

    try {
      setSaving(true);
      const docRef = await addDoc(getCollectionRef('stockRequirements'), {
        productName: productName.trim(),
        customerId: finalCustomer?.id || '',
        customerName: finalCustomer?.name || '',
        mobile: finalCustomer?.phone || inputVal || '',
        status: 'pending',
        createdAt: Timestamp.now(),
        createdBy: currentUser?.uid || '',
        createdByName: displayName,
      });

      const newReq: StockRequirement = {
        id: docRef.id,
        productName: productName.trim(),
        customerId: finalCustomer?.id || '',
        customerName: finalCustomer?.name || '',
        mobile: finalCustomer?.phone || inputVal || '',
        status: 'pending',
        createdAt: new Date(),
        createdBy: currentUser?.uid || '',
        createdByName: displayName,
      };

      setRequirements(prev => [newReq, ...prev]);
      setProductName('');
      setSelectedCustomerId('');
      setCustomerSearch('');
      success('Stock requirement logged successfully');
    } catch (error) {
      console.error('Error adding stock requirement:', error);
      showError('Failed to log stock requirement');
    } finally {
      setSaving(false);
    }
  };

  // Update requirement status
  const handleUpdateStatus = async (requirementId: string, newStatus: StatusType) => {
    try {
      const targetReq = requirements.find(r => r.id === requirementId);
      const storeId = targetReq?._storeId;
      const requirementRef =
        storeId && storeId !== 'hub_warehouse'
          ? doc(db, 'stores', storeId, 'stockRequirements', requirementId)
          : doc(db, 'stockRequirements', requirementId);

      await updateDoc(requirementRef, {
        status: newStatus,
        updatedAt: Timestamp.now(),
        updatedBy: currentUser?.uid,
        updatedByName: displayName,
      });

      setRequirements(prev =>
        prev.map(req =>
          req.id === requirementId
            ? { ...req, status: newStatus, updatedAt: new Date(), updatedBy: currentUser?.uid, updatedByName: displayName }
            : req
        )
      );

      success(`Status updated: ${newStatus.replace('-', ' ')}`);
    } catch (error) {
      console.error('Error updating status:', error);
      showError('Failed to update status');
    }
  };

  // Delete requirement
  const handleDelete = async (requirementId: string) => {
    if (!window.confirm('Delete this stock requirement?')) return;
    try {
      const targetReq = requirements.find(r => r.id === requirementId);
      const storeId = targetReq?._storeId;
      const requirementRef =
        storeId && storeId !== 'hub_warehouse'
          ? doc(db, 'stores', storeId, 'stockRequirements', requirementId)
          : doc(db, 'stockRequirements', requirementId);

      await deleteDoc(requirementRef);
      setRequirements(prev => prev.filter(req => req.id !== requirementId));
      success('Stock requirement deleted');
    } catch (error) {
      console.error('Error deleting stock requirement:', error);
      showError('Failed to delete requirement');
    }
  };

  // Quick product suggestion chips
  const quickSuggestions = [
    'Display Combo',
    'Battery Replacement',
    'Screen Guard / Glass',
    '65W Fast Charger',
    'Type-C Cable',
    'AirPods Case',
    'Back Cover / Case',
    'Charging Port / Strip'
  ];

  // KPI calculations
  const kpis = useMemo(() => {
    const total = requirements.length;
    const pending = requirements.filter(r => r.status === 'pending').length;
    const stockUpdated = requirements.filter(r => r.status === 'stock-updated').length;
    const customerUpdated = requirements.filter(r => r.status === 'customer-updated').length;
    return { total, pending, stockUpdated, customerUpdated };
  }, [requirements]);

  // Filtered requirements
  const filteredRequirements = useMemo(() => {
    return requirements
      .filter(req => {
        if (statusFilter !== 'all' && req.status !== statusFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matches =
            req.productName.toLowerCase().includes(q) ||
            (req.customerName && req.customerName.toLowerCase().includes(q)) ||
            (req.mobile && req.mobile.includes(q));
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [requirements, statusFilter, searchQuery, sortOrder]);

  // Filtered customers for autocomplete
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers.slice(0, 8);
    const q = customerSearch.toLowerCase();
    return customers.filter(
      c => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))
    ).slice(0, 8);
  }, [customers, customerSearch]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Items to export based on chosen scope
  const exportItems = useMemo(() => {
    if (downloadScope === 'pending') {
      return requirements.filter(r => r.status === 'pending');
    }
    if (downloadScope === 'all') {
      return requirements;
    }
    return filteredRequirements;
  }, [requirements, filteredRequirements, downloadScope]);

  const formatStatusLabel = (st: string) => {
    switch (st) {
      case 'pending': return 'Pending Sourcing';
      case 'stock-updated': return 'Stock In Store';
      case 'customer-updated': return 'Customer Notified';
      default: return st;
    }
  };

  // Export handlers
  const handleExportPDF = () => {
    if (exportItems.length === 0) {
      showError('No stock requirement records to export');
      return;
    }

    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const isAllLocs = selectedLocation === 'all_locations';
      const locationName = isAllLocs
        ? 'Complete Stock (Chain-wide)'
        : currentStore?.name || 'Hub Warehouse';
      const dateStr = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      // Minimal Header
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39);
      doc.text('Stock Requirements', 14, 16);

      // Minimal Metadata Subtitle
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      const subInfo = `${locationName}  •  ${dateStr}  •  ${exportItems.length} items${omitCustomerPhone ? '  •  Supplier Copy' : ''}`;
      doc.text(subInfo, 14, 22);

      // Subtle Divider
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(14, 25, 196, 25);

      const headers = omitCustomerPhone
        ? (isAllLocs
            ? ['#', 'Item / Requirement', 'Location', 'Customer', 'Status', 'Date']
            : ['#', 'Item / Requirement', 'Customer', 'Status', 'Date'])
        : (isAllLocs
            ? ['#', 'Item / Requirement', 'Location', 'Customer', 'Phone', 'Status', 'Date']
            : ['#', 'Item / Requirement', 'Customer', 'Phone', 'Status', 'Date']);

      const body = exportItems.map((req, idx) => {
        const itemDate = req.createdAt
          ? new Date(req.createdAt).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : '—';

        const statusText =
          req.status === 'pending'
            ? 'Pending'
            : req.status === 'stock-updated'
            ? 'In Stock'
            : req.status === 'customer-updated'
            ? 'Notified'
            : req.status;

        const locLabel = req._storeName || (req._storeId === 'hub_warehouse' ? 'Hub Warehouse' : 'Branch');

        if (omitCustomerPhone) {
          return isAllLocs
            ? [idx + 1, req.productName || '—', locLabel, req.customerName || 'Walk-in', statusText, itemDate]
            : [idx + 1, req.productName || '—', req.customerName || 'Walk-in', statusText, itemDate];
        }
        return isAllLocs
          ? [idx + 1, req.productName || '—', locLabel, req.customerName || 'Walk-in', req.mobile || '—', statusText, itemDate]
          : [idx + 1, req.productName || '—', req.customerName || 'Walk-in', req.mobile || '—', statusText, itemDate];
      });

      autoTable(doc, {
        head: [headers],
        body,
        startY: 28,
        theme: 'plain',
        styles: {
          font: 'helvetica',
          fontSize: 8,
          textColor: [30, 41, 59],
          cellPadding: { top: 3.5, bottom: 3.5, left: 2.5, right: 2.5 },
          lineColor: [241, 245, 249],
          lineWidth: { bottom: 0.2 },
        },
        headStyles: {
          fillColor: [248, 250, 252],
          textColor: [71, 85, 105],
          fontStyle: 'bold',
          fontSize: 8,
          lineColor: [226, 232, 240],
          lineWidth: { bottom: 0.4 },
        },
        alternateRowStyles: {
          fillColor: [253, 254, 255],
        },
        columnStyles: omitCustomerPhone
          ? (isAllLocs
              ? {
                  0: { halign: 'center', cellWidth: 8, textColor: [148, 163, 184] },
                  1: { fontStyle: 'bold', cellWidth: 'auto', textColor: [15, 23, 42] },
                  2: { cellWidth: 32, textColor: [100, 116, 139] },
                  3: { cellWidth: 34, textColor: [71, 85, 105] },
                  4: { halign: 'center', cellWidth: 22 },
                  5: { halign: 'right', cellWidth: 20, textColor: [100, 116, 139] },
                }
              : {
                  0: { halign: 'center', cellWidth: 10, textColor: [148, 163, 184] },
                  1: { fontStyle: 'bold', cellWidth: 'auto', textColor: [15, 23, 42] },
                  2: { cellWidth: 42, textColor: [71, 85, 105] },
                  3: { halign: 'center', cellWidth: 26 },
                  4: { halign: 'right', cellWidth: 24, textColor: [100, 116, 139] },
                })
          : (isAllLocs
              ? {
                  0: { halign: 'center', cellWidth: 8, textColor: [148, 163, 184] },
                  1: { fontStyle: 'bold', cellWidth: 'auto', textColor: [15, 23, 42] },
                  2: { cellWidth: 26, textColor: [100, 116, 139] },
                  3: { cellWidth: 28, textColor: [71, 85, 105] },
                  4: { cellWidth: 25, textColor: [71, 85, 105] },
                  5: { halign: 'center', cellWidth: 20 },
                  6: { halign: 'right', cellWidth: 18, textColor: [100, 116, 139] },
                }
              : {
                  0: { halign: 'center', cellWidth: 10, textColor: [148, 163, 184] },
                  1: { fontStyle: 'bold', cellWidth: 'auto', textColor: [15, 23, 42] },
                  2: { cellWidth: 32, textColor: [71, 85, 105] },
                  3: { cellWidth: 28, textColor: [71, 85, 105] },
                  4: { halign: 'center', cellWidth: 24 },
                  5: { halign: 'right', cellWidth: 22, textColor: [100, 116, 139] },
                }),
        didDrawPage: (data) => {
          const pageCount = (doc as any).internal.getNumberOfPages();
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(148, 163, 184);
          doc.text('Digital Zone', 14, 290);
          doc.text(`Page ${data.pageNumber} of ${pageCount}`, 196, 290, { align: 'right' });
        },
      });

      const privacySuffix = omitCustomerPhone ? '_without_phone' : '_internal';
      doc.save(`stock_requirements${privacySuffix}_${new Date().toISOString().split('T')[0]}.pdf`);
      success(`PDF downloaded ${omitCustomerPhone ? 'without phone numbers' : 'with phone numbers'}`);
      setShowDownloadModal(false);
    } catch (err) {
      console.error('Error generating PDF:', err);
      showError('Failed to generate PDF document');
    }
  };

  const handleExportExcel = () => {
    if (exportItems.length === 0) {
      showError('No stock requirement records to export');
      return;
    }

    try {
      const rows = exportItems.map((req, idx) => {
        const itemDate = req.createdAt ? new Date(req.createdAt).toLocaleDateString('en-IN') : '—';
        const row: Record<string, any> = {
          'S.No': idx + 1,
          'Required Product / Spare Part': req.productName || '—',
        };

        if (selectedLocation === 'all_locations') {
          row['Location'] = req._storeName || (req._storeId === 'hub_warehouse' ? 'Hub Warehouse' : 'Branch');
        }

        row['Customer Name'] = req.customerName || 'Walk-in Customer';

        if (!omitCustomerPhone) {
          row['Customer Phone Number'] = req.mobile || '—';
        }

        row['Status'] = formatStatusLabel(req.status);
        row['Date Logged'] = itemDate;
        row['Created By'] = req.createdByName || 'Staff';

        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Stock Requirements');

      const privacySuffix = omitCustomerPhone ? '_without_phone' : '_internal';
      XLSX.writeFile(wb, `stock_requirements${privacySuffix}_${new Date().toISOString().split('T')[0]}.xlsx`);
      success(`Excel downloaded ${omitCustomerPhone ? 'without phone numbers' : 'with phone numbers'}`);
      setShowDownloadModal(false);
    } catch (err) {
      console.error('Error exporting Excel:', err);
      showError('Failed to export Excel spreadsheet');
    }
  };

  const handleExportCSV = () => {
    if (exportItems.length === 0) {
      showError('No stock requirement records to export');
      return;
    }

    try {
      const isAllLocs = selectedLocation === 'all_locations';
      const headers = omitCustomerPhone
        ? (isAllLocs
            ? ['S.No', 'Required Product', 'Location', 'Customer Name', 'Status', 'Date Logged']
            : ['S.No', 'Required Product', 'Customer Name', 'Status', 'Date Logged'])
        : (isAllLocs
            ? ['S.No', 'Required Product', 'Location', 'Customer Name', 'Customer Phone', 'Status', 'Date Logged']
            : ['S.No', 'Required Product', 'Customer Name', 'Customer Phone', 'Status', 'Date Logged']);

      const csvRows = exportItems.map((req, idx) => {
        const itemDate = req.createdAt ? new Date(req.createdAt).toLocaleDateString('en-IN') : '—';
        const safeProduct = `"${(req.productName || '').replace(/"/g, '""')}"`;
        const safeLoc = `"${(req._storeName || (req._storeId === 'hub_warehouse' ? 'Hub Warehouse' : 'Branch')).replace(/"/g, '""')}"`;
        const safeCust = `"${(req.customerName || 'Walk-in Customer').replace(/"/g, '""')}"`;
        const safeStatus = `"${formatStatusLabel(req.status)}"`;
        const safeDate = `"${itemDate}"`;

        if (omitCustomerPhone) {
          return isAllLocs
            ? [idx + 1, safeProduct, safeLoc, safeCust, safeStatus, safeDate].join(',')
            : [idx + 1, safeProduct, safeCust, safeStatus, safeDate].join(',');
        }
        const safePhone = `"${(req.mobile || '').replace(/"/g, '""')}"`;
        return isAllLocs
          ? [idx + 1, safeProduct, safeLoc, safeCust, safePhone, safeStatus, safeDate].join(',')
          : [idx + 1, safeProduct, safeCust, safePhone, safeStatus, safeDate].join(',');
      });

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...csvRows].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      const privacySuffix = omitCustomerPhone ? '_without_phone' : '_internal';
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `stock_requirements${privacySuffix}_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      success(`CSV downloaded ${omitCustomerPhone ? 'without phone numbers' : 'with phone numbers'}`);
      setShowDownloadModal(false);
    } catch (err) {
      console.error('Error exporting CSV:', err);
      showError('Failed to export CSV file');
    }
  };

  const totalPages = Math.max(1, Math.ceil(filteredRequirements.length / itemsPerPage));
  const paginatedRequirements = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredRequirements.slice(start, start + itemsPerPage);
  }, [filteredRequirements, currentPage]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <Navbar />

      {/* FULL WIDTH FLUID CONTAINER MATCHING PRODUCTS & CUSTOMER MANAGEMENT */}
      <main className="flex-1 max-w-full w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8 space-y-3.5">
        
        {/* COMPACT PAGE HEADER */}
        <div className="mb-2 sm:mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Stock Requirements
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>
                Log requested items out of stock, track part sourcing & notify customers when stock arrives
              </span>
              <span className="text-gray-300">•</span>
              {selectedLocation === 'all_locations' ? (
                <span className="inline-flex items-center gap-1 text-blue-800 font-bold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>Complete Stock Requirements (Hub + All Branches)</span>
                </span>
              ) : currentStore?.name ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Branch: {currentStore.name}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                  <Warehouse className="w-3.5 h-3.5" />
                  <span>Hub Warehouse (Main Office)</span>
                </span>
              )}
            </p>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <LocationSwitcher includeAllLocations />

            <button
              type="button"
              onClick={() => setShowDownloadModal(true)}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              title="Download stock requirements report"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAddCustomer(true)}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Customer</span>
            </button>

            <button
              type="button"
              onClick={() => {
                fetchRequirements();
                fetchCustomers();
              }}
              disabled={loading}
              className="p-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh requirements"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
            </button>
          </div>
        </div>

        {/* COMPACT TOP KPI CARDS STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            onClick={() => setStatusFilter('all')}
            className={`bg-white rounded-lg border p-3 shadow-xs cursor-pointer transition-colors ${
              statusFilter === 'all' ? 'border-blue-500 bg-blue-50/30' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Total Requests</span>
              <Package className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{kpis.total}</p>
          </div>

          <div
            onClick={() => setStatusFilter('pending')}
            className={`bg-white rounded-lg border p-3 shadow-xs cursor-pointer transition-colors ${
              statusFilter === 'pending' ? 'border-amber-500 bg-amber-50/30' : 'border-gray-200 hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Pending Sourcing</span>
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-lg font-bold text-amber-600 tabular-nums">{kpis.pending}</p>
          </div>

          <div
            onClick={() => setStatusFilter('stock-updated')}
            className={`bg-white rounded-lg border p-3 shadow-xs cursor-pointer transition-colors ${
              statusFilter === 'stock-updated' ? 'border-emerald-500 bg-emerald-50/30' : 'border-gray-200 hover:border-emerald-300'
            }`}
          >
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Stock Updated</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-lg font-bold text-emerald-600 tabular-nums">{kpis.stockUpdated}</p>
          </div>

          <div
            onClick={() => setStatusFilter('customer-updated')}
            className={`bg-white rounded-lg border p-3 shadow-xs cursor-pointer transition-colors ${
              statusFilter === 'customer-updated' ? 'border-purple-500 bg-purple-50/30' : 'border-gray-200 hover:border-purple-300'
            }`}
          >
            <div className="flex items-center justify-between text-gray-500 mb-0.5">
              <span className="text-xs text-gray-500">Customer Notified</span>
              <Check className="w-4 h-4 text-purple-600" />
            </div>
            <p className="text-lg font-bold text-purple-600 tabular-nums">{kpis.customerUpdated}</p>
          </div>
        </div>

        {/* 2-COLUMN BALANCED DESKTOP GRID (4 cols Left Form / 8 cols Right Ledger) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
          
          {/* Left Column (4 cols): Quick Requirement Entry Form */}
          <div className="lg:col-span-4 space-y-3">
            <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <h2 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-blue-600" />
                  Log Stock Requirement
                </h2>
                <span className="text-[10px] text-gray-400">Demand Intake</span>
              </div>

              <form onSubmit={handleAddRequirement} className="space-y-3">
                {/* Product Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Requested Product / Spare Part <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={productName}
                    onChange={e => setProductName(e.target.value)}
                    placeholder="e.g. Vivo V29 Display Combo, iPhone 14 Battery"
                    required
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />

                  {/* Suggestion Chips */}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {quickSuggestions.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setProductName(s)}
                        className="px-2 py-0.5 bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-600 rounded text-[10px] font-medium transition-colors cursor-pointer"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Customer Autocomplete Search */}
                <div className="relative" ref={customerDropdownRef}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-700">
                      Customer <span className="text-gray-400 font-normal">(Optional)</span>
                    </label>
                    {selectedCustomerId && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId('');
                          setCustomerSearch('');
                        }}
                        className="text-[10px] text-red-500 hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={e => {
                        setCustomerSearch(e.target.value);
                        setSelectedCustomerId('');
                        setShowCustomerDropdown(true);
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      placeholder="Search customer name or mobile..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Customer Dropdown */}
                  {showCustomerDropdown && filteredCustomers.length > 0 && !selectedCustomerId && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-gray-100">
                      {filteredCustomers.map(cust => (
                        <div
                          key={cust.id}
                          onClick={() => {
                            setSelectedCustomerId(cust.id || '');
                            setCustomerSearch(cust.name);
                            setShowCustomerDropdown(false);
                          }}
                          className="p-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors"
                        >
                          <div>
                            <p className="text-xs font-semibold text-gray-900">{cust.name}</p>
                            <p className="text-[10px] text-gray-500">{cust.phone || 'No phone'}</p>
                          </div>
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded font-medium">
                            Select
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedCustomer && (
                    <div className="mt-1.5 p-2 bg-blue-50/70 border border-blue-200 rounded-lg flex items-center justify-between text-xs">
                      <div>
                        <span className="font-semibold text-blue-900">{selectedCustomer.name}</span>
                        <span className="text-gray-500 ml-1.5">({selectedCustomer.phone})</span>
                      </div>
                      <span className="text-[10px] text-blue-600 font-bold">Selected</span>
                    </div>
                  )}
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={saving || !productName.trim()}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs sm:text-sm transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>{saving ? 'Logging Request...' : 'Log Stock Requirement'}</span>
                </button>
              </form>
            </div>
          </div>

          {/* Right Column (8 cols): Requirements Ledger */}
          <div className="lg:col-span-8 space-y-3">
            <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-gray-200 shadow-xs space-y-3">
              
              {/* Filter & Search Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-gray-100">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-xs sm:text-sm font-bold text-gray-900">Requirements Ledger</h2>
                  <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.2 rounded-full font-bold">
                    {filteredRequirements.length}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Search */}
                  <div className="relative flex-1 sm:w-48">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search product or customer..."
                      value={searchQuery}
                      onChange={e => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="w-full pl-8 pr-3 py-1 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Status Pills */}
                  <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs">
                    {(['all', 'pending', 'stock-updated', 'customer-updated'] as const).map(st => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          setStatusFilter(st);
                          setCurrentPage(1);
                        }}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all capitalize cursor-pointer ${
                          statusFilter === st
                            ? 'bg-white text-blue-700 shadow-xs'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {st === 'all' ? 'All' : st === 'stock-updated' ? 'Stock In' : st === 'customer-updated' ? 'Notified' : 'Pending'}
                      </button>
                    ))}
                  </div>

                  {/* Sort Order */}
                  <button
                    type="button"
                    onClick={() => setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))}
                    className="p-1 text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors cursor-pointer"
                    title={`Sort date: ${sortOrder === 'asc' ? 'Oldest first' : 'Newest first'}`}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  </button>

                  {/* Quick Download Button in Ledger Toolbar */}
                  <button
                    type="button"
                    onClick={() => setShowDownloadModal(true)}
                    className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-gray-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                    title="Export sheet"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-600" />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                </div>
              </div>

              {/* Table / List */}
              {loading ? (
                <div className="py-12 text-center text-gray-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                  <p className="text-xs">Loading requirements...</p>
                </div>
              ) : filteredRequirements.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                  <Package className="w-7 h-7 text-gray-300 mx-auto mb-1.5" />
                  <p className="text-xs font-semibold text-gray-600">No matching stock requirements found</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Use the form on the left to record incoming demand.</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto -mx-3.5 sm:mx-0">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-700 border-b border-gray-200 font-semibold">
                          <th className="p-2.5">Product Required</th>
                          <th className="p-2.5">Customer & Phone</th>
                          <th className="p-2.5">Status</th>
                          <th className="p-2.5">Logged Date</th>
                          <th className="p-2.5 text-center">Quick Connect</th>
                          <th className="p-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-800">
                        {paginatedRequirements.map(req => {
                          const dateStr = req.createdAt ? new Date(req.createdAt).toLocaleDateString('en-IN') : 'N/A';
                          const phoneDigits = (req.mobile || '').replace(/\D/g, '');
                          const waText = encodeURIComponent(
                            `Hi ${req.customerName || 'Customer'}! 👋\nThe ${req.productName} you requested is now in stock at ${currentStore?.name || 'our shop'}. Please visit us to collect it.`
                          );
                          const waUrl = phoneDigits ? `https://wa.me/91${phoneDigits.slice(-10)}?text=${waText}` : '';

                          return (
                            <tr key={req.id} className="hover:bg-blue-50/20 transition-colors">
                              <td className="p-2.5">
                                <p className="font-bold text-gray-900">{req.productName}</p>
                                {selectedLocation === 'all_locations' && (
                                  <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                    {req._storeId === 'hub_warehouse' ? (
                                      <>
                                        <Warehouse className="w-2.5 h-2.5 text-amber-600" />
                                        <span>Hub Warehouse</span>
                                      </>
                                    ) : (
                                      <>
                                        <Building2 className="w-2.5 h-2.5 text-blue-600" />
                                        <span>{req._storeName || 'Branch'}</span>
                                      </>
                                    )}
                                  </span>
                                )}
                              </td>

                              <td className="p-2.5">
                                <p className="font-semibold text-gray-900">{req.customerName || 'Walk-in Customer'}</p>
                                {req.mobile && <p className="text-[11px] text-gray-500 font-mono">{req.mobile}</p>}
                              </td>

                              <td className="p-2.5">
                                <select
                                  value={req.status}
                                  onChange={e => handleUpdateStatus(req.id!, e.target.value as StatusType)}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border cursor-pointer ${
                                    req.status === 'pending'
                                      ? 'bg-amber-100 border-amber-200 text-amber-800'
                                      : req.status === 'stock-updated'
                                      ? 'bg-emerald-100 border-emerald-200 text-emerald-800'
                                      : 'bg-purple-100 border-purple-200 text-purple-800'
                                  }`}
                                >
                                  <option value="pending">Pending Sourcing</option>
                                  <option value="stock-updated">Stock In Store</option>
                                  <option value="customer-updated">Customer Notified</option>
                                </select>
                              </td>

                              <td className="p-2.5 text-gray-600 text-[11px] whitespace-nowrap">{dateStr}</td>

                              <td className="p-2.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  {req.mobile && (
                                    <>
                                      <a
                                        href={`tel:${req.mobile}`}
                                        className="p-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded transition-colors"
                                        title="Call Customer"
                                      >
                                        <Phone className="w-3.5 h-3.5" />
                                      </a>
                                      <a
                                        href={waUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1 bg-green-50 hover:bg-green-100 text-green-600 rounded transition-colors"
                                        title="WhatsApp Customer: Stock is Available"
                                      >
                                        <MessageSquare className="w-3.5 h-3.5" />
                                      </a>
                                    </>
                                  )}
                                </div>
                              </td>

                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(req.id!)}
                                  className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                  title="Delete Requirement"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
                      <span className="text-gray-500">
                        Page {currentPage} of {totalPages}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="p-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="p-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ADD CUSTOMER MODAL */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-5 border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 mb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-600" />
                Add New Customer
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCustomer(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  required
                  className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Mobile Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={newCustomerPhone}
                  onChange={e => setNewCustomerPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  required
                  className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Email Address <span className="text-gray-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="email"
                  value={newCustomerEmail}
                  onChange={e => setNewCustomerEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={!newCustomerName.trim() || !newCustomerPhone.trim()}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  Save & Select Customer
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DOWNLOAD & PRIVACY CONFIRMATION MODAL */}
      {showDownloadModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
          onClick={() => setShowDownloadModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between p-4 sm:p-5 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Download Stock Requirements</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Confirm customer privacy settings before generating the file
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDownloadModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 text-xs">
              {/* Privacy Confirmation Option Cards */}
              <div>
                <label className="font-bold text-slate-800 block mb-2">
                  Customer Privacy & Phone Number Option:
                </label>
                <div className="space-y-2">
                  {/* Option 1: WITHOUT Customer Phone Number (Recommended & Default) */}
                  <div
                    onClick={() => setOmitCustomerPhone(true)}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      omitCustomerPhone
                        ? 'border-emerald-600 bg-emerald-50/50 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 border ${
                          omitCustomerPhone
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {omitCustomerPhone && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                            <EyeOff className="w-4 h-4 text-emerald-600" />
                            Without Customer Phone Numbers
                          </span>
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-emerald-100 text-emerald-800 shrink-0">
                            Safe for Suppliers
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                          Customer mobile numbers are <strong>completely removed</strong> from the download.
                          Recommended when sharing item demand sheets with external distributors, wholesalers, or vendors.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Option 2: INCLUDE Customer Phone Number */}
                  <div
                    onClick={() => setOmitCustomerPhone(false)}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      !omitCustomerPhone
                        ? 'border-amber-600 bg-amber-50/50 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 border ${
                          !omitCustomerPhone
                            ? 'bg-amber-600 border-amber-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {!omitCustomerPhone && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                            <Phone className="w-4 h-4 text-amber-600" />
                            Include Customer Phone Numbers
                          </span>
                          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-100 text-amber-800 shrink-0">
                            Internal Team Only
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                          Customer phone numbers will remain visible in the downloaded file.
                          Use this only for internal staff follow-up and customer call-backs.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Scope Selector */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">
                  Select Items to Include:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDownloadScope('filtered')}
                    className={`py-2 px-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      downloadScope === 'filtered'
                        ? 'border-blue-600 bg-blue-50 text-blue-800 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700 font-medium'
                    }`}
                  >
                    <div className="text-xs">Current Filter</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{filteredRequirements.length} items</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDownloadScope('pending')}
                    className={`py-2 px-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      downloadScope === 'pending'
                        ? 'border-blue-600 bg-blue-50 text-blue-800 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700 font-medium'
                    }`}
                  >
                    <div className="text-xs">Pending Only</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{kpis.pending} items</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDownloadScope('all')}
                    className={`py-2 px-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      downloadScope === 'all'
                        ? 'border-blue-600 bg-blue-50 text-blue-800 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700 font-medium'
                    }`}
                  >
                    <div className="text-xs">All Records</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{requirements.length} items</div>
                  </button>
                </div>
              </div>

              {/* Status Summary Pill */}
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500">Items ready to download:</span>{' '}
                  <strong className="text-slate-900 font-bold">{exportItems.length} records</strong>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    omitCustomerPhone
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {omitCustomerPhone ? '✓ No Phone Numbers' : '⚠ Phone Numbers Included'}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 sm:p-5 pt-3 bg-slate-50/60 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => setShowDownloadModal(false)}
                className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleExportPDF}
                  disabled={exportItems.length === 0}
                  className="flex-1 sm:flex-none px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  title="Download PDF Document"
                >
                  <FileText className="w-4 h-4" />
                  <span>Download PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={exportItems.length === 0}
                  className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  title="Download Excel Spreadsheet"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Download Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  disabled={exportItems.length === 0}
                  className="hidden md:inline-flex px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold items-center justify-center gap-1 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  title="Download CSV"
                >
                  <span>CSV</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StockRequirementPage;
