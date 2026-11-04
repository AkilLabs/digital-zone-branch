import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Search,
  Phone,
  Mail,
  Plus,
  Edit,
  Trash2,
  X,
  MapPin,
  RefreshCw,
  Download,
  ChevronDown,
  ArrowUpDown,
  UserCheck,
  Calendar,
  Eye,
  Copy,
  Check,
  FileSpreadsheet,
  FileText,
  ShoppingBag,
  ShoppingCart,
  ExternalLink,
  Receipt,
  Share2
} from 'lucide-react';
import Navbar from '../components/Navbar';
import ShareModal from '../components/ShareModal';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToastContext } from '../context/ToastContext';
import {
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import type { Customer, BillingItem, ShopDetails } from '../types';
import { resolveShopDetails } from '../utils/shopDetails';
import { generateInvoice } from '../utils/pdfGenerator';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type CustomerTab = 'all' | 'with_phone' | 'with_email' | 'with_address' | 'recent';

function CustomerManagement() {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore } = useStore();
  const navigate = useNavigate();
  const { success, error: showError } = useToastContext();
  const displayName = currentUser?.displayName || currentUser?.email || 'Unknown User';

  // Data states
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);

  // Tabs & Filters
  const [activeTab, setActiveTab] = useState<CustomerTab>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'phone'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Customer Details Inspector Drawer State
  const [selectedCustomerForDetails, setSelectedCustomerForDetails] = useState<Customer | null>(null);
  const [customerPurchases, setCustomerPurchases] = useState<BillingItem[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');

  // Bill Download & Share State
  const [itemToShare, setItemToShare] = useState<BillingItem | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
  const [sharingInvoiceId, setSharingInvoiceId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Modal states
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Form states
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch shop details from currentStore first (0 reads) with fallback to settings/shopDetails
  useEffect(() => {
    const fetchShopDetails = async () => {
      try {
        const resolved = await resolveShopDetails(currentStore);
        if (resolved) {
          setShopDetails(resolved);
        }
      } catch (error) {
        console.error('Error fetching shop details:', error);
      }
    };
    fetchShopDetails();
  }, [currentStore]);

  const effectiveShopDetails: ShopDetails = useMemo(() => {
    return shopDetails || {
      shopName: currentStore?.name || 'The Legend Mobiles',
      ownerName: currentStore?.ownerName || 'Owner',
      address: currentStore?.address || 'Main Road',
      phone: currentStore?.phone || '',
      email: currentStore?.email || '',
      gst: currentStore?.gst || '',
    };
  }, [shopDetails, currentStore]);

  // Fetch customers from Firebase
  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const customersRef = getCollectionRef('customers');
      const q = query(customersRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);

      const customersList = querySnapshot.docs.map(docSnap => ({
        id: docSnap.id,
        name: docSnap.data().name || '',
        phone: docSnap.data().phone || '',
        email: docSnap.data().email || '',
        address: docSnap.data().address || '',
        homeStoreId: docSnap.data().homeStoreId || '',
        homeStoreName: docSnap.data().homeStoreName || '',
        createdAt: docSnap.data().createdAt?.toDate ? docSnap.data().createdAt.toDate() : new Date(docSnap.data().createdAt || Date.now()),
        createdBy: docSnap.data().createdBy,
        createdByName: docSnap.data().createdByName,
      })) as Customer[];

      setCustomers(customersList);
    } catch (error) {
      console.error('Error fetching customers:', error);
      showError('Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [currentStore?.id]);

  // Helper to group multi-item transactions into a single combined order
  const groupPurchasesByTransaction = (rawItems: BillingItem[]): BillingItem[] => {
    const transactionMap = new Map<string, BillingItem>();
    const standaloneItems: BillingItem[] = [];

    for (const raw of rawItems) {
      const item = { ...raw };
      const txId = (item.transactionId || '').trim();

      if (txId) {
        if (transactionMap.has(txId)) {
          const parent = transactionMap.get(txId)!;
          if (!parent.items) {
            parent.items = [{ ...parent }];
          }
          parent.items.push(item);

          if (item.type === 'credit') {
            parent.type = 'credit';
            parent.isPaid = (parent.isPaid !== undefined ? parent.isPaid : true) && (item.isPaid !== undefined ? item.isPaid : false);
            parent.paidAmount = (parent.paidAmount || 0) + (item.paidAmount || 0);
            parent.remainingAmount = (parent.remainingAmount || 0) + (item.remainingAmount || 0);
          }

          parent.quantity = (parent.quantity || 0) + (item.quantity || 1);

          if (item.imei) {
            parent.imei = parent.imei ? `${parent.imei}, ${item.imei}` : item.imei;
          }
        } else {
          const parent = { ...item };
          if (parent.items && Array.isArray(parent.items) && parent.items.length > 0) {
            parent.items = [...parent.items];
          }
          transactionMap.set(txId, parent);
        }
      } else {
        standaloneItems.push(item);
      }
    }

    const grouped: BillingItem[] = [];
    for (const parent of transactionMap.values()) {
      if (parent.items && parent.items.length > 1) {
        if (parent.grandTotal !== undefined && parent.grandTotal > 0) {
          parent.totalWithGst = parent.grandTotal;
        } else {
          parent.totalWithGst = parent.items.reduce((sum, sub) => {
            return sum + (sub.totalWithGst !== undefined ? sub.totalWithGst : (sub.sellingPrice * (sub.quantity || 1)));
          }, 0);
        }

        const titles = parent.items.map(it => it.title).filter(Boolean);
        parent.title = titles.length <= 2 
          ? titles.join(', ') 
          : `${titles.slice(0, 2).join(', ')} + ${titles.length - 2} more`;
      }
      grouped.push(parent);
    }

    return [...grouped, ...standaloneItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };

  // Fetch purchases when a customer is selected for details
  useEffect(() => {
    if (!selectedCustomerForDetails?.phone) {
      setCustomerPurchases([]);
      setHistorySearchTerm('');
      return;
    }

    const fetchCustomerPurchases = async () => {
      try {
        setLoadingPurchases(true);
        setHistorySearchTerm('');
        const phone = selectedCustomerForDetails.phone.trim();

        const billingRef = getCollectionRef('billingItems');
        const billingQ = query(
          billingRef,
          where('customerPhone', '==', phone),
          orderBy('createdAt', 'desc')
        );

        const creditRef = getCollectionRef('creditSales');
        const creditQ = query(
          creditRef,
          where('customerPhone', '==', phone),
          orderBy('createdAt', 'desc')
        );

        const [billingSnap, creditSnapResult] = await Promise.all([
          getDocs(billingQ).catch(err => {
            console.warn('Billing query fallback:', err);
            const fallbackQ = query(billingRef, where('customerPhone', '==', phone));
            return getDocs(fallbackQ);
          }),
          getDocs(creditQ).catch(err => {
            console.warn('Credit query fallback:', err);
            const fallbackQ = query(creditRef, where('customerPhone', '==', phone));
            return getDocs(fallbackQ);
          })
        ]);

        const billingList = billingSnap.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data(),
          createdAt: docSnap.data().createdAt?.toDate ? docSnap.data().createdAt.toDate() : new Date(docSnap.data().createdAt || Date.now()),
        })) as BillingItem[];

        const creditList = creditSnapResult.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data(),
          createdAt: docSnap.data().createdAt?.toDate ? docSnap.data().createdAt.toDate() : new Date(docSnap.data().createdAt || Date.now()),
        })) as BillingItem[];

        // Group multi-item transactions into single combined orders
        const allRawPurchases = [...billingList, ...creditList];
        const groupedPurchases = groupPurchasesByTransaction(allRawPurchases);

        setCustomerPurchases(groupedPurchases);
      } catch (error) {
        console.error('Error fetching customer purchase records:', error);
      } finally {
        setLoadingPurchases(false);
      }
    };

    fetchCustomerPurchases();
  }, [selectedCustomerForDetails?.phone]);

  // Customer Financial KPIs
  const customerTotalSpent = useMemo(() => {
    return customerPurchases.reduce((sum, item) => sum + (item.totalWithGst || (item.sellingPrice * item.quantity)), 0);
  }, [customerPurchases]);

  const customerTotalOrders = useMemo(() => {
    return customerPurchases.length;
  }, [customerPurchases]);

  const customerLastPurchaseDate = useMemo(() => {
    return customerPurchases.length > 0 ? customerPurchases[0].createdAt : null;
  }, [customerPurchases]);

  const filteredHistory = useMemo(() => {
    if (!historySearchTerm.trim()) return customerPurchases;
    const q = historySearchTerm.toLowerCase();
    return customerPurchases.filter(p => {
      const matchTitle = p.title && p.title.toLowerCase().includes(q);
      const matchTx = p.transactionId && p.transactionId.toLowerCase().includes(q);
      const matchImei = p.imei && p.imei.toLowerCase().includes(q);
      const matchSub = p.items && p.items.some(sub =>
        (sub.title && sub.title.toLowerCase().includes(q)) ||
        (sub.imei && sub.imei.toLowerCase().includes(q))
      );
      return matchTitle || matchTx || matchImei || matchSub;
    });
  }, [customerPurchases, historySearchTerm]);

  // Download Bill PDF handler
  const handleDownloadInvoice = async (item: BillingItem) => {
    try {
      setDownloadingInvoiceId(item.id || 'bill');
      const preparedItem: BillingItem = {
        ...item,
        customerName: item.customerName || selectedCustomerForDetails?.name || 'Customer',
        customerPhone: item.customerPhone || selectedCustomerForDetails?.phone || '',
        customerEmail: item.customerEmail || selectedCustomerForDetails?.email || '',
        customerDetails: item.customerDetails || selectedCustomerForDetails?.address || '',
      };
      await generateInvoice(preparedItem, effectiveShopDetails, item.transactionId, false);
      success('Bill PDF downloaded successfully');
    } catch (error) {
      console.error('Error generating bill PDF:', error);
      showError('Failed to generate bill PDF. Please try again.');
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  // Directly trigger Universal Share
  const handleShareInvoice = async (item: BillingItem) => {
    try {
      setSharingInvoiceId(item.id || 'share');

      const customerName = (item.customerName || selectedCustomerForDetails?.name || 'Customer').trim();
      const customerPhone = (item.customerPhone || selectedCustomerForDetails?.phone || '').trim();
      const customerEmail = (item.customerEmail || selectedCustomerForDetails?.email || '').trim();
      const customerDetails = (item.customerDetails || selectedCustomerForDetails?.address || '').trim();

      const preparedItem: BillingItem = {
        ...item,
        customerName,
        customerPhone,
        customerEmail,
        customerDetails,
      };

      const billId = item.transactionId || item.id;
      const safeId = (billId || '').replace(/\//g, '_');
      const rawPhoneDigits = customerPhone.replace(/\D/g, '').slice(-10);
      const phoneParam = rawPhoneDigits ? `?p=${encodeURIComponent(rawPhoneDigits)}` : '';
      const billUrl = `https://the-legend-mobiles.vercel.app/view-bill/${encodeURIComponent(safeId)}${phoneParam}`;
      const totalAmount = Math.round(item.totalWithGst || (item.sellingPrice * item.quantity)).toLocaleString('en-IN');
      const shareTitle = `Invoice - ${item.transactionId || safeId}`;
      const shareText = `Hi ${customerName}! 👋\nThank you for shopping at ${effectiveShopDetails.shopName || 'The Legend Mobiles'}!\nTotal: ₹${totalAmount}\nYou can view & download your bill here:\n${billUrl}`;

      // Generate PDF
      const result = await generateInvoice(preparedItem, effectiveShopDetails, item.transactionId, true) as any;

      // 1. Android WebView bridge
      if (typeof window !== 'undefined' && (window as any).AndroidInterface?.sharePDF && result?.pdfData) {
        (window as any).AndroidInterface.sharePDF(
          result.pdfData,
          result.fileName || `Invoice_${safeId}.pdf`,
          shareTitle
        );
        success('Invoice shared via device!');
        return;
      }

      // 2. Web Share API (Universal Native Device Share)
      if (typeof navigator !== 'undefined' && navigator.share) {
        // Try file sharing if PDF Blob is available
        if (result?.pdfBlob && navigator.canShare) {
          const pdfFile = new File(
            [result.pdfBlob],
            result.fileName || `Invoice_${safeId}.pdf`,
            { type: 'application/pdf' }
          );
          if (navigator.canShare({ files: [pdfFile] })) {
            try {
              await navigator.share({
                title: shareTitle,
                text: shareText,
                files: [pdfFile],
              });
              success('Invoice shared successfully!');
              return;
            } catch (err: any) {
              if (err.name === 'AbortError') return;
              console.warn('Native file share failed, trying URL share:', err);
            }
          }
        }

        // Try text & URL share
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: billUrl,
          });
          success('Invoice shared successfully!');
          return;
        } catch (err: any) {
          if (err.name === 'AbortError') return;
          console.warn('Native text share failed:', err);
        }
      }

      // 3. Fallback for desktop browsers without navigator.share support
      setItemToShare(preparedItem);
      setIsShareModalOpen(true);
    } catch (error: any) {
      console.error('Error during universal share:', error);
      showError('Failed to share bill. Please try again.');
    } finally {
      setSharingInvoiceId(null);
    }
  };

  // Navigate to Billing with pre-filled customer details
  const handleCreateBillForCustomer = (cust: Customer) => {
    navigate(
      `/billing?customerName=${encodeURIComponent(cust.name || '')}&customerPhone=${encodeURIComponent(cust.phone || '')}&customerEmail=${encodeURIComponent(cust.email || '')}&customerAddress=${encodeURIComponent(cust.address || '')}`,
      {
        state: {
          customer: cust,
          customerName: cust.name,
          customerPhone: cust.phone,
          customerEmail: cust.email,
          customerAddress: cust.address,
          customerGstNo: cust.gstNo,
        }
      }
    );
  };

  // Click outside to close export dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut: '/' to focus search, 'Escape' to dismiss modals/drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInputActive = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'Escape') {
        if (isShareModalOpen) {
          setIsShareModalOpen(false);
          setItemToShare(null);
        } else if (selectedCustomerForDetails) {
          setSelectedCustomerForDetails(null);
        } else if (showAddCustomer) {
          closeAddModal();
        } else if (showEditCustomer) {
          closeEditModal();
        } else if (showDeleteModal) {
          setShowDeleteModal(false);
          setCustomerToDelete(null);
        } else if (showExportMenu) {
          setShowExportMenu(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isShareModalOpen, selectedCustomerForDetails, showAddCustomer, showEditCustomer, showDeleteModal, showExportMenu]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let withPhone = 0;
    let withEmail = 0;
    let withAddress = 0;
    let recent = 0;

    customers.forEach(c => {
      if (c.phone && c.phone.trim().length > 0) withPhone++;
      if (c.email && c.email.trim().length > 0) withEmail++;
      if (c.address && c.address.trim().length > 0) withAddress++;
      if (c.createdAt && c.createdAt >= thirtyDaysAgo) recent++;
    });

    return {
      all: customers.length,
      with_phone: withPhone,
      with_email: withEmail,
      with_address: withAddress,
      recent
    };
  }, [customers]);

  // Filtered & sorted customers
  const filteredCustomers = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return customers
      .filter(customer => {
        // Tab filter
        if (activeTab === 'with_phone' && (!customer.phone || !customer.phone.trim())) return false;
        if (activeTab === 'with_email' && (!customer.email || !customer.email.trim())) return false;
        if (activeTab === 'with_address' && (!customer.address || !customer.address.trim())) return false;
        if (activeTab === 'recent' && (!customer.createdAt || customer.createdAt < thirtyDaysAgo)) return false;

        // Search term filter
        if (searchTerm.trim() !== '') {
          const q = searchTerm.toLowerCase();
          const matches =
            customer.name.toLowerCase().includes(q) ||
            customer.phone.includes(q) ||
            (customer.email && customer.email.toLowerCase().includes(q)) ||
            (customer.address && customer.address.toLowerCase().includes(q));
          if (!matches) return false;
        }

        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'phone':
            comparison = (a.phone || '').localeCompare(b.phone || '');
            break;
          case 'date':
          default:
            comparison = (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
            break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [customers, activeTab, searchTerm, sortBy, sortOrder]);

  // Pagination logic
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm, sortBy, sortOrder]);

  // Copy phone number
  const copyPhone = (phone: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 1800);
  };

  // Add new customer
  const handleAddCustomer = async () => {
    if (!customerName.trim() || !customerPhone.trim()) {
      showError('Please enter customer name and phone number');
      return;
    }

    try {
      setFormSubmitting(true);
      const docRef = await addDoc(getCollectionRef('customers'), {
        name: customerName.trim(),
        phone: customerPhone.trim(),
        email: customerEmail.trim() || '',
        address: customerAddress.trim() || '',
        homeStoreId: currentStore?.id || '',
        homeStoreName: currentStore?.name || '',
        createdAt: Timestamp.now(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser?.uid,
        createdByName: displayName,
      });

      // Add to local state
      const newCustomerObj: Customer = {
        id: docRef.id,
        name: customerName.trim(),
        phone: customerPhone.trim(),
        email: customerEmail.trim(),
        address: customerAddress.trim(),
        homeStoreId: currentStore?.id || '',
        homeStoreName: currentStore?.name || '',
        createdAt: new Date(),
        createdBy: currentUser?.uid,
        createdByName: displayName,
      };

      setCustomers(prev => [newCustomerObj, ...prev]);
      closeAddModal();
      success('Customer added successfully!');
    } catch (error) {
      console.error('Error adding customer:', error);
      showError('Failed to add customer');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Edit customer
  const handleEditCustomer = async () => {
    if (!editingCustomer || !customerName.trim() || !customerPhone.trim()) {
      showError('Please enter customer name and phone number');
      return;
    }

    try {
      setFormSubmitting(true);
      const customerRef = getDocRef('customers', editingCustomer.id!);
      await updateDoc(customerRef, {
        name: customerName.trim(),
        phone: customerPhone.trim(),
        email: customerEmail.trim() || '',
        address: customerAddress.trim() || '',
        updatedAt: serverTimestamp(),
      });

      // Update local state
      const updatedCustomer: Customer = {
        ...editingCustomer,
        name: customerName.trim(),
        phone: customerPhone.trim(),
        email: customerEmail.trim(),
        address: customerAddress.trim(),
      };

      setCustomers(prev =>
        prev.map(c => (c.id === editingCustomer.id ? updatedCustomer : c))
      );

      // If this customer is open in the details drawer, update it too
      if (selectedCustomerForDetails?.id === editingCustomer.id) {
        setSelectedCustomerForDetails(updatedCustomer);
      }

      closeEditModal();
      success('Customer updated successfully!');
    } catch (error) {
      console.error('Error updating customer:', error);
      showError('Failed to update customer');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Delete customer
  const confirmDeleteCustomer = async () => {
    if (!customerToDelete) return;

    try {
      setDeleteLoading(customerToDelete.id!);
      await deleteDoc(getDocRef('customers', customerToDelete.id!));
      setCustomers(prev => prev.filter(c => c.id !== customerToDelete.id));

      if (selectedCustomerForDetails?.id === customerToDelete.id) {
        setSelectedCustomerForDetails(null);
      }

      setShowDeleteModal(false);
      setCustomerToDelete(null);
      success('Customer deleted successfully!');
    } catch (error) {
      console.error('Error deleting customer:', error);
      showError('Failed to delete customer');
    } finally {
      setDeleteLoading(null);
    }
  };

  const openAddModal = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
    setShowAddCustomer(true);
  };

  const closeAddModal = () => {
    setShowAddCustomer(false);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
  };

  const openEditModal = (customer: Customer, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingCustomer(customer);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    setCustomerEmail(customer.email || '');
    setCustomerAddress(customer.address || '');
    setShowEditCustomer(true);
  };

  const closeEditModal = () => {
    setShowEditCustomer(false);
    setEditingCustomer(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
  };

  const openDeleteModal = (customer: Customer, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCustomerToDelete(customer);
    setShowDeleteModal(true);
  };

  // Export functions
  const exportToCSV = () => {
    const headers = ['Name', 'Phone', 'Email', 'Address', 'Joined Date'];
    const rows = filteredCustomers.map(c => [
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${c.phone || ''}"`,
      `"${(c.email || '').replace(/"/g, '""')}"`,
      `"${(c.address || '').replace(/"/g, '""')}"`,
      `"${c.createdAt?.toLocaleDateString() || ''}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `customers_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToExcel = () => {
    const data = filteredCustomers.map(c => ({
      'Customer Name': c.name,
      'Phone Number': c.phone,
      'Email Address': c.email || '',
      'Address': c.address || '',
      'Joined Date': c.createdAt?.toLocaleDateString() || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    XLSX.writeFile(wb, `customers_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToPDF = () => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('Customer Directory', 14, 20);
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleDateString()} • Total: ${filteredCustomers.length} customers`, 14, 26);

      const tableColumn = ['Name', 'Phone', 'Email', 'Address', 'Joined'];
      const tableRows = filteredCustomers.map(c => [
        c.name,
        c.phone,
        c.email || '—',
        c.address || '—',
        c.createdAt?.toLocaleDateString() || '—'
      ]);

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 32,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] },
      });

      doc.save(`customers_${activeTab}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      showError('Failed to generate PDF report');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4 pb-24 sm:pb-8">

        {/* COMPACT HEADER (Clean Project Style matching Purchases & Products) */}
        <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              Customers
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              {filteredCustomers.length} customer{filteredCustomers.length !== 1 ? 's' : ''} found
              {currentStore?.name && (
                <span className="text-gray-400 hidden md:inline"> • Location: <strong className="text-gray-700 font-medium">{currentStore.name}</strong></span>
              )}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Refresh */}
            <button
              type="button"
              onClick={fetchCustomers}
              disabled={loading}
              title="Refresh customer list"
              className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Export Menu */}
            <div className="relative" ref={exportDropdownRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="bg-green-600 text-white py-2 px-3 sm:px-4 rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 text-xs">
                  <button
                    onClick={() => { exportToExcel(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-green-600" />
                    Excel File (.xlsx)
                  </button>
                  <button
                    onClick={() => { exportToCSV(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4 text-blue-600" />
                    CSV File (.csv)
                  </button>
                  <button
                    onClick={() => { exportToPDF(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2.5 text-gray-700 hover:bg-gray-50 font-medium flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4 text-red-600" />
                    PDF File (.pdf)
                  </button>
                </div>
              )}
            </div>

            {/* Add Customer Button */}
            <button
              type="button"
              onClick={openAddModal}
              className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-1.5 text-xs sm:text-sm shadow-sm whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Customer</span>
            </button>
          </div>
        </div>

        {/* COMPACT STATS CARDS */}
        <div className="hidden sm:grid grid-cols-4 gap-3 mb-4">
          <div
            onClick={() => setActiveTab('all')}
            className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${
              activeTab === 'all' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <p className="text-xs text-gray-500">Total Customers</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">{tabCounts.all}</p>
          </div>

          <div
            onClick={() => setActiveTab(activeTab === 'with_phone' ? 'all' : 'with_phone')}
            className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${
              activeTab === 'with_phone' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:border-blue-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">With Phone</p>
              {activeTab === 'with_phone' && <span className="text-[10px] text-blue-600 font-bold uppercase">Active</span>}
            </div>
            <p className="text-lg font-bold text-blue-600 mt-0.5">{tabCounts.with_phone}</p>
          </div>

          <div
            onClick={() => setActiveTab(activeTab === 'with_email' ? 'all' : 'with_email')}
            className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${
              activeTab === 'with_email' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:border-blue-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">With Email</p>
              {activeTab === 'with_email' && <span className="text-[10px] text-blue-600 font-bold uppercase">Active</span>}
            </div>
            <p className="text-lg font-bold text-green-600 mt-0.5">{tabCounts.with_email}</p>
          </div>

          <div
            onClick={() => setActiveTab(activeTab === 'recent' ? 'all' : 'recent')}
            className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer transition-colors ${
              activeTab === 'recent' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:border-blue-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">New (Last 30 Days)</p>
              {activeTab === 'recent' && <span className="text-[10px] text-blue-600 font-bold uppercase">Active</span>}
            </div>
            <p className="text-lg font-bold text-purple-600 mt-0.5">{tabCounts.recent}</p>
          </div>
        </div>

        {/* DESKTOP-LIKE CUSTOMER SEGMENT TABS */}
        <div className="flex bg-white rounded-lg p-1 border border-gray-200 mb-3 sm:mb-4 overflow-x-auto hide-scrollbar sm:w-max shadow-sm">
          {[
            { key: 'all', label: 'All Customers', icon: Users, count: tabCounts.all },
            { key: 'with_phone', label: 'With Phone', icon: Phone, count: tabCounts.with_phone },
            { key: 'with_email', label: 'With Email', icon: Mail, count: tabCounts.with_email },
            { key: 'with_address', label: 'With Address', icon: MapPin, count: tabCounts.with_address },
            { key: 'recent', label: 'New This Month', icon: Calendar, count: tabCounts.recent }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none flex items-center justify-center gap-2 ${
                  isActive
                    ? 'bg-blue-100 text-blue-700 shadow-sm font-semibold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  isActive ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* COMPACT FILTERS & SEARCH */}
        <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3 mb-3 sm:mb-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">

            {/* Quick Segment Filter Tags */}
            {[
              { key: 'all', label: 'All' },
              { key: 'with_phone', label: 'Phone' },
              { key: 'with_email', label: 'Email' },
              { key: 'with_address', label: 'Address' },
              { key: 'recent', label: 'Recent' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setActiveTab(s.key as any)}
                className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-all ${
                  activeTab === s.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {s.label}
              </button>
            ))}

            {/* Inline Search Bar */}
            <div className="relative flex-1 min-w-[200px] sm:min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by customer name, phone, email, address..."
                className="w-full pl-9 pr-7 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7 cursor-pointer appearance-none"
              >
                <option value="date">Recent Joined</option>
                <option value="name">Name (A-Z)</option>
                <option value="phone">Phone Number</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Sort Order Toggle */}
            <button
              type="button"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-2.5 py-1.5 sm:py-2 border border-gray-300 rounded-lg text-xs sm:text-sm bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1 font-medium"
              title={sortOrder === 'asc' ? 'Ascending Order' : 'Descending Order'}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{sortOrder === 'asc' ? '↑' : '↓'}</span>
            </button>
          </div>

          {/* Active Filter Indicators */}
          {(searchTerm || activeTab !== 'all') && (
            <div className="mt-2.5 pt-2.5 border-t border-gray-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-500">Active filters:</span>
                {activeTab !== 'all' && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium flex items-center gap-1">
                    Tab: {activeTab.replace('_', ' ')}
                    <button onClick={() => setActiveTab('all')}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {searchTerm && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium flex items-center gap-1">
                    "{searchTerm}"
                    <button onClick={() => setSearchTerm('')}><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setActiveTab('all');
                }}
                className="text-blue-600 hover:text-blue-800 font-medium ml-2 shrink-0"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* CUSTOMERS LIST (Responsive: Cards on Mobile, Table on Desktop) */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 text-sm font-medium">Loading customer database...</p>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
            <Users className="w-14 h-14 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-700 font-semibold text-base">No customers found</p>
            <p className="text-gray-500 text-xs mt-1 max-w-sm mx-auto">
              {customers.length === 0
                ? 'Your customer database is empty. Add your first customer to get started.'
                : 'No customers match your active search and filter criteria.'}
            </p>
            {customers.length === 0 && (
              <div className="mt-4">
                <button
                  onClick={openAddModal}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Add First Customer
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* MOBILE CARD VIEW (md:hidden) */}
            <div className="md:hidden space-y-3">
              {paginatedCustomers.map(customer => {
                const isSelected = selectedCustomerForDetails?.id === customer.id;

                return (
                  <div
                    key={customer.id}
                    onClick={() => setSelectedCustomerForDetails(customer)}
                    className={`bg-white rounded-lg shadow-sm border p-4 transition-all cursor-pointer ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-300 bg-blue-50/20' : 'border-gray-200 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 bg-blue-50 text-blue-600 font-bold rounded-full flex items-center justify-center shrink-0 text-sm border border-blue-100">
                          {customer.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-sm leading-snug">{customer.name}</h3>
                          <p className="text-[11px] text-gray-500">
                            Joined {customer.createdAt?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => openEditModal(customer, e)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Customer"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => openDeleteModal(customer, e)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete Customer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Contact Info Rows */}
                    <div className="space-y-1.5 text-xs pt-2 border-t border-gray-100">
                      {customer.phone && (
                        <div className="flex items-center justify-between">
                          <a
                            href={`tel:${customer.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-2 text-gray-700 hover:text-blue-600 font-medium"
                          >
                            <Phone className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span>{customer.phone}</span>
                          </a>
                          <button
                            type="button"
                            onClick={(e) => copyPhone(customer.phone, e)}
                            className="text-[11px] text-gray-400 hover:text-gray-600 font-mono"
                          >
                            {copiedPhone === customer.phone ? (
                              <span className="text-green-600 font-semibold flex items-center gap-0.5"><Check className="w-3 h-3" /> Copied</span>
                            ) : (
                              'Copy'
                            )}
                          </button>
                        </div>
                      )}

                      {customer.email && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <a
                            href={`mailto:${customer.email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="truncate hover:text-blue-600 hover:underline"
                          >
                            {customer.email}
                          </a>
                        </div>
                      )}

                      {customer.address && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="truncate">{customer.address}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Footer Link & Quick Bill */}
                    <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
                      <span className="text-blue-600 font-semibold flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        Quick View Details →
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateBillForCustomer(customer);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors border border-blue-200"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>New Bill</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* DESKTOP TABLE VIEW (hidden md:block) */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium text-xs">
                    <tr>
                      <th className="px-5 py-3 font-semibold text-gray-600">Customer Name</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Email</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Address</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Joined Date</th>
                      <th className="px-5 py-3 font-semibold text-gray-600 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedCustomers.map(customer => {
                      const isSelected = selectedCustomerForDetails?.id === customer.id;

                      return (
                        <tr
                          key={customer.id}
                          onClick={() => setSelectedCustomerForDetails(customer)}
                          className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                            isSelected ? 'bg-blue-50/70' : ''
                          }`}
                        >
                          {/* Customer Name & Avatar */}
                          <td className="px-5 py-3.5 max-w-xs">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-blue-50 text-blue-600 font-bold rounded-full flex items-center justify-center shrink-0 text-sm border border-blue-100">
                                {customer.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate">
                                  {customer.name}
                                </div>
                                <div className="text-[11px] text-gray-400">
                                  {customer.createdByName ? `Added by ${customer.createdByName}` : 'Registered Customer'}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Phone */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {customer.phone ? (
                              <div className="flex items-center gap-1.5">
                                <a
                                  href={`tel:${customer.phone}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-gray-800 hover:text-blue-600 font-medium hover:underline flex items-center gap-1 font-mono text-xs"
                                >
                                  <Phone className="w-3 h-3 text-gray-400" />
                                  {customer.phone}
                                </a>
                                <button
                                  type="button"
                                  onClick={(e) => copyPhone(customer.phone, e)}
                                  title="Copy Phone Number"
                                  className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
                                >
                                  {copiedPhone === customer.phone ? (
                                    <Check className="w-3 h-3 text-green-600" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </td>

                          {/* Email */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {customer.email ? (
                              <a
                                href={`mailto:${customer.email}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-gray-700 hover:text-blue-600 hover:underline flex items-center gap-1.5 text-xs truncate max-w-[180px]"
                              >
                                <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                                <span className="truncate">{customer.email}</span>
                              </a>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </td>

                          {/* Address */}
                          <td className="px-4 py-3.5 max-w-[200px] truncate" title={customer.address}>
                            {customer.address ? (
                              <div className="flex items-center gap-1.5 text-gray-700 text-xs truncate">
                                <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                                <span className="truncate">{customer.address}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </td>

                          {/* Joined Date */}
                          <td className="px-4 py-3.5 whitespace-nowrap text-xs text-gray-500">
                            {customer.createdAt?.toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-3.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleCreateBillForCustomer(customer)}
                                title={`Create New Bill for ${customer.name}`}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              >
                                <ShoppingCart className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedCustomerForDetails(customer)}
                                title="Inspect Details & Purchase History"
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => openEditModal(customer, e)}
                                title="Edit Customer"
                                className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => openDeleteModal(customer, e)}
                                title="Delete Customer"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* PAGINATION (Matching Project Style) */}
        {filteredCustomers.length > 0 && (
          <div className="mt-4 p-3 sm:p-4 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="text-gray-600 font-medium">
              Showing <span className="text-blue-600 font-bold">{filteredCustomers.length === 0 ? 0 : startIndex + 1}</span> to{' '}
              <span className="text-blue-600 font-bold">{Math.min(endIndex, filteredCustomers.length)}</span> of{' '}
              <span className="text-blue-600 font-bold">{filteredCustomers.length}</span> customers
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="px-3 py-1.5 text-xs font-bold text-blue-600 border border-blue-600 rounded-lg bg-blue-50">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

      </div>

      {/* CUSTOMER DETAILS SLIDE-OVER INSPECTOR DRAWER */}
      {selectedCustomerForDetails && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fadeIn"
          onClick={() => setSelectedCustomerForDetails(null)}
        >
          <div
            className="w-full sm:w-[580px] bg-white shadow-2xl overflow-y-auto max-h-screen flex flex-col animate-slideInRight"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 z-10 p-4 sm:p-5 flex items-start justify-between shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 font-bold rounded-xl flex items-center justify-center shrink-0 text-xl border border-blue-100 shadow-sm">
                  {selectedCustomerForDetails.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 leading-tight">
                    {selectedCustomerForDetails.name}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span>Joined {selectedCustomerForDetails.createdAt?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => navigate(`/customers/${selectedCustomerForDetails.id}`)}
                  title="Open Dedicated Full Page"
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCustomerForDetails(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Close Inspector"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Drawer Body Content */}
            <div className="p-4 sm:p-6 space-y-5 flex-1">
              
              {/* Contact Information Bar */}
              <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-200 space-y-2 text-xs">
                {selectedCustomerForDetails.phone && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-700">
                      <Phone className="w-4 h-4 text-blue-500 shrink-0" />
                      <a href={`tel:${selectedCustomerForDetails.phone}`} className="font-mono font-semibold text-gray-900 hover:text-blue-600 hover:underline">
                        {selectedCustomerForDetails.phone}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyPhone(selectedCustomerForDetails.phone)}
                      className="px-2 py-0.5 bg-white border border-gray-300 rounded text-[11px] font-medium text-gray-600 hover:bg-gray-100 transition-colors flex items-center gap-1"
                    >
                      {copiedPhone === selectedCustomerForDetails.phone ? (
                        <span className="text-green-600 font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Copied</span>
                      ) : (
                        <span>Copy</span>
                      )}
                    </button>
                  </div>
                )}

                {selectedCustomerForDetails.email && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                    <a href={`mailto:${selectedCustomerForDetails.email}`} className="hover:text-blue-600 hover:underline">
                      {selectedCustomerForDetails.email}
                    </a>
                  </div>
                )}

                {selectedCustomerForDetails.address && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                    <span>{selectedCustomerForDetails.address}</span>
                  </div>
                )}
              </div>

              {/* Financial KPI Summary Cards */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <div className="text-[10px] text-green-700 font-bold uppercase tracking-wider">Total Spent</div>
                  <div className="text-base sm:text-lg font-bold text-green-800 mt-0.5">
                    ₹{Math.round(customerTotalSpent).toLocaleString('en-IN')}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <div className="text-[10px] text-blue-700 font-bold uppercase tracking-wider">Orders / Items</div>
                  <div className="text-base sm:text-lg font-bold text-blue-800 mt-0.5">
                    {customerTotalOrders}
                  </div>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                  <div className="text-[10px] text-purple-700 font-bold uppercase tracking-wider">Last Order</div>
                  <div className="text-xs sm:text-sm font-bold text-purple-900 mt-0.5 truncate">
                    {customerLastPurchaseDate
                      ? customerLastPurchaseDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                      : 'None'}
                  </div>
                </div>
              </div>

              {/* Action Button: Create Bill */}
              <button
                type="button"
                onClick={() => handleCreateBillForCustomer(selectedCustomerForDetails)}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 transition-colors"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Create New Bill for {selectedCustomerForDetails.name}</span>
              </button>

              {/* Customer Purchase History Section */}
              <div className="pt-2">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <Receipt className="w-4 h-4 text-blue-600" />
                    Purchase History ({customerPurchases.length})
                  </h4>

                  {customerPurchases.length > 0 && (
                    <div className="relative w-36 sm:w-44">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search items..."
                        value={historySearchTerm}
                        onChange={(e) => setHistorySearchTerm(e.target.value)}
                        className="w-full pl-7 pr-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>

                {loadingPurchases ? (
                  <div className="py-8 text-center text-gray-500">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-xs">Fetching transactions from phone records...</p>
                  </div>
                ) : customerPurchases.length === 0 ? (
                  <div className="p-6 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <ShoppingBag className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-gray-700">No purchase records found</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      No invoices or credit sales found for {selectedCustomerForDetails.phone}.
                    </p>
                  </div>
                ) : filteredHistory.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-500">
                    No items match "{historySearchTerm}"
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {filteredHistory.map(item => (
                      <div
                        key={item.id}
                        className="p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors shadow-xs"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0 flex-1">
                            {item.items && item.items.length > 1 && (
                              <div className="mb-1.5">
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                                  Combined Order ({item.items.length} items)
                                </span>
                              </div>
                            )}
                            <div className="font-semibold text-gray-900 text-xs sm:text-sm leading-tight">
                              {item.title}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                              <span>Total Qty: <strong className="text-gray-700">{item.quantity}</strong></span>
                              <span>•</span>
                              <span>{item.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                              {item.transactionId && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono text-[10px] text-gray-400">#{item.transactionId.slice(-6)}</span>
                                </>
                              )}
                            </div>

                            {/* Sub-items list if combined */}
                            {item.items && item.items.length > 1 ? (
                              <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                                {item.items.map((sub, sIdx) => (
                                  <div key={sIdx} className="text-xs text-gray-700 flex justify-between items-center py-0.5">
                                    <div className="flex items-center gap-1.5 truncate">
                                      <span className="text-gray-400 font-mono text-[10px]">#{sIdx + 1}</span>
                                      <span className="font-medium text-gray-800 truncate">{sub.title}</span>
                                      {sub.imei && <span className="text-[10px] text-blue-600 font-mono">({sub.imei})</span>}
                                    </div>
                                    <div className="text-[11px] text-gray-500 font-medium shrink-0 ml-2">
                                      {sub.quantity} × ₹{Math.round(sub.sellingPrice || 0).toLocaleString('en-IN')}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              item.imei && (
                                <div className="mt-1 text-[11px] font-mono text-blue-600 font-semibold">
                                  IMEI: {item.imei}
                                </div>
                              )
                            )}
                          </div>

                          <div className="text-right shrink-0">
                            <div className="font-bold text-gray-900 text-xs sm:text-sm">
                              ₹{Math.round(item.totalWithGst || (item.sellingPrice * item.quantity)).toLocaleString('en-IN')}
                            </div>
                            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.type === 'credit'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-green-100 text-green-800'
                            }`}>
                              {item.type === 'credit' ? 'Credit' : 'Paid'}
                            </span>
                          </div>
                        </div>

                        {/* Bill Download & Share Actions Row */}
                        <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleDownloadInvoice(item)}
                            disabled={downloadingInvoiceId === item.id}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                            title="Download Invoice PDF"
                          >
                            {downloadingInvoiceId === item.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            <span>Download Bill</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleShareInvoice(item)}
                            disabled={sharingInvoiceId === (item.id || 'share')}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                            title="Universal Share (Direct)"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>{sharingInvoiceId === (item.id || 'share') ? 'Sharing...' : 'Share'}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Sticky Drawer Footer Actions */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const c = selectedCustomerForDetails;
                  openEditModal(c);
                }}
                className="flex-1 py-2 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Edit className="w-3.5 h-3.5" />
                <span>Edit Profile</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = selectedCustomerForDetails;
                  openDeleteModal(c);
                }}
                className="flex-1 py-2 px-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 border border-red-200"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SHARE INVOICE MODAL (WhatsApp & Email sharing) */}
      {isShareModalOpen && itemToShare && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => {
            setIsShareModalOpen(false);
            setItemToShare(null);
          }}
          item={itemToShare}
          shopDetails={effectiveShopDetails}
          initialCustomerName={itemToShare.customerName || selectedCustomerForDetails?.name}
          initialCustomerPhone={itemToShare.customerPhone || selectedCustomerForDetails?.phone}
          initialCustomerEmail={itemToShare.customerEmail || selectedCustomerForDetails?.email}
        />
      )}

      {/* ADD CUSTOMER MODAL */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Add New Customer</h3>
                  <p className="text-xs text-gray-500">Create a customer profile for billing & service</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAddModal}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-gray-700 block mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium text-gray-900"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1">Mobile / Phone Number *</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono text-gray-900"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1">Email Address (Optional)</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="e.g. ramesh@example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-gray-900"
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1">Address / Location (Optional)</label>
                <textarea
                  rows={2}
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="e.g. #12 Main Street, Gandhi Nagar"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-gray-900 resize-none"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
              <button
                type="button"
                onClick={closeAddModal}
                disabled={formSubmitting}
                className="flex-1 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddCustomer}
                disabled={formSubmitting || !customerName.trim() || !customerPhone.trim()}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {formSubmitting ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CUSTOMER MODAL */}
      {showEditCustomer && editingCustomer && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-green-100 text-green-700 rounded-lg">
                  <Edit className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Edit Customer Details</h3>
                  <p className="text-xs text-gray-500">Update phone, email, and address</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-gray-700 block mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium text-gray-900"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1">Mobile / Phone Number *</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono text-gray-900"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1">Email Address</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-gray-900"
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1">Address / Location</label>
                <textarea
                  rows={2}
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-gray-900 resize-none"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={formSubmitting}
                className="flex-1 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditCustomer}
                disabled={formSubmitting || !customerName.trim() || !customerPhone.trim()}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {formSubmitting ? 'Updating...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && customerToDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-3 text-xs animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2.5 text-red-600">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-base font-bold text-gray-900">Delete Customer</h3>
            </div>

            <p className="text-gray-600">
              Are you sure you want to delete <strong className="text-gray-900">{customerToDelete.name}</strong> ({customerToDelete.phone})?
            </p>
            <p className="text-gray-500 text-[11px]">
              This will remove their profile from the active customer directory. Past invoice and job sheet history will still be preserved.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setCustomerToDelete(null);
                }}
                disabled={deleteLoading === customerToDelete.id}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteCustomer}
                disabled={deleteLoading === customerToDelete.id}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-40 shadow-sm"
              >
                {deleteLoading === customerToDelete.id ? 'Deleting...' : 'Delete Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default CustomerManagement;
