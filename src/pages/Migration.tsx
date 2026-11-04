import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { db } from '../config/firebase';
import {
  collection,
  getDocs,
  getDoc,
  setDoc,
  doc,
  deleteDoc,
  query,
  where,
  updateDoc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import {
  migrateToHubArchitecture,
  migrateRootToStoreSubcollections,
  rescueOldNestedHubDocs,
  recomputeStoreMetrics,
  scanStoreMigrationCounts,
  type CollectionScanResult,
} from '../utils/migrateToHub';
import { LEGACY_STORE_SCOPED_SHARED_COLLECTIONS } from '../utils/firestore';
import {
  scanDuplicateInvoices,
  fixDuplicateInvoices,
  initializeInvoiceCounter,
} from '../utils/fixDuplicateInvoices';
import * as XLSX from 'xlsx';
import {
  Database,
  AlertTriangle,
  RefreshCw,
  Building2,
  ShieldCheck,
  FileSpreadsheet,
  Wrench,
  Sparkles,
  Layers,
  Trash2,
  Play,
  RotateCcw,
} from 'lucide-react';

type AuditDuration = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';
type AuditFilterMode = 'gst-only' | 'all-bills';

const toDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const formatInputDate = (date: Date) => date.toISOString().split('T')[0];
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const Migration: React.FC = () => {
  const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef, currentStore, stores, refreshStores } = useStore();

  const [log, setLog] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Subcollection migration state
  const [targetStoreId, setTargetStoreId] = useState<string>('');
  const [scanResults, setScanResults] = useState<CollectionScanResult[]>([]);
  const [isScanningCollections, setIsScanningCollections] = useState(false);
  const [deleteRootAfterMigration, setDeleteRootAfterMigration] = useState(false);

  // Audit export state
  const [auditFilterMode, setAuditFilterMode] = useState<AuditFilterMode>('gst-only');
  const [auditDuration, setAuditDuration] = useState<AuditDuration>('month');
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');
  const [isExportingAudit, setIsExportingAudit] = useState(false);

  // Duplicate invoice state
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
  const [isFixingDuplicates, setIsFixingDuplicates] = useState(false);

  // Set default target store on load
  useEffect(() => {
    if (stores.length > 0 && !targetStoreId) {
      const preferred = currentStore?.id || stores[0].id;
      if (preferred) setTargetStoreId(preferred);
    }
  }, [stores, currentStore?.id, targetStoreId]);

  const addLog = (msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // ──────────────────────────────────────────────────────────────────────────
  //  1. SUB-COLLECTION MIGRATION WORKFLOW
  // ──────────────────────────────────────────────────────────────────────────

  const handleScanCounts = async () => {
    if (!targetStoreId) {
      addLog('Please select a target branch store first.');
      return;
    }
    setIsScanningCollections(true);
    addLog(`Scanning root vs stores/${targetStoreId} document counts...`);
    try {
      const results = await scanStoreMigrationCounts(targetStoreId);
      setScanResults(results);
      const readyToMigrate = results.filter((r) => r.rootCount > 0);
      addLog(
        `✓ Scan complete: ${results.length} collections scanned. ${readyToMigrate.length} collection(s) have root documents ready to migrate.`
      );
    } catch (err: any) {
      addLog(`✗ Error scanning counts: ${err?.message || err}`);
    } finally {
      setIsScanningCollections(false);
    }
  };

  const handleMigrateRootToSubcollections = async () => {
    if (!targetStoreId) {
      alert('Please select a target branch store.');
      return;
    }

    const selectedStore = stores.find((s) => s.id === targetStoreId);
    const storeName = selectedStore?.name || targetStoreId;

    const confirmMsg = deleteRootAfterMigration
      ? `WARNING: You have checked 'Delete root documents after migration'.\n\nThis will copy operational data from root to stores/${targetStoreId} and DELETE root copies.\n\nTarget Store: ${storeName}\n\nProceed?`
      : `This will copy all root operational collections (products, billingItems, creditSales, expenses, attendance, purchases, transactions, etc.) into:\n\nstores/${targetStoreId}/*\n\nExisting root documents will NOT be deleted (safe merge mode).\n\nTarget Store: ${storeName}\n\nProceed?`;

    if (!confirm(confirmMsg)) return;

    setIsRunning(true);
    setLog([]);
    addLog(`=== Starting Sub-Collection Migration to "${storeName}" (${targetStoreId}) ===`);

    try {
      const res = await migrateRootToStoreSubcollections(targetStoreId, {
        deleteSource: deleteRootAfterMigration,
        onProgress: addLog,
      });

      if (res.success) {
        addLog(`🎉 Migration succeeded! Migrated ${res.totalMigrated} document(s).`);
        await handleScanCounts();
        await refreshStores();
      } else {
        addLog(`✗ Migration finished with error: ${res.error}`);
      }
    } catch (err: any) {
      addLog(`Fatal migration error: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRescueOldNestedHubData = async () => {
    if (!confirm('This will search for documents in legacy nested hub collections (hubs/{hubId}/stores/{storeId}/*) and copy them into root stores/{storeId}/*.\n\nProceed?')) {
      return;
    }

    setIsRunning(true);
    setLog([]);
    addLog('=== Starting Rescue of Old Nested Hub Data ===');
    try {
      const res = await rescueOldNestedHubDocs(targetStoreId, addLog);
      if (res.success) {
        addLog(`✓ Rescue complete. Rescued ${res.totalRescued} document(s).`);
        await handleScanCounts();
        await refreshStores();
      } else {
        addLog(`✗ Rescue error: ${res.error}`);
      }
    } catch (err: any) {
      addLog(`Fatal error: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRecomputeMetrics = async () => {
    if (!targetStoreId) {
      alert('Please select a target store.');
      return;
    }
    setIsRunning(true);
    addLog(`Recomputing metrics for stores/${targetStoreId}...`);
    try {
      const res = await recomputeStoreMetrics(targetStoreId, addLog);
      if (res.success) {
        addLog(`✓ Recomputation complete! Updated revenue, bill count, and inventory.`);
        await refreshStores();
      } else {
        addLog(`✗ Error: ${res.error}`);
      }
    } catch (err: any) {
      addLog(`Fatal error: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCreateDefaultStore = async () => {
    if (!currentUser?.uid) return;
    const branchName = prompt('Enter name for the new branch:', 'Main Branch');
    if (!branchName) return;

    setIsRunning(true);
    addLog(`Creating branch "${branchName}" in root stores collection...`);
    try {
      const newStoreRef = doc(collection(db, 'stores'));
      await setDoc(newStoreRef, {
        name: branchName.trim(),
        ownerName: currentUser.displayName || 'Admin',
        isActive: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser.uid,
        updatedAt: Timestamp.now(),
        lifetimeRevenue: 0,
        lifetimeBills: 0,
        totalStockUnits: 0,
      });
      addLog(`✓ Created store: ${newStoreRef.id} (${branchName})`);
      await refreshStores();
      setTargetStoreId(newStoreRef.id);
    } catch (err: any) {
      addLog(`✗ Error creating store: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  //  2. SHARED ROOT COLLECTION MIGRATION
  // ──────────────────────────────────────────────────────────────────────────

  const migrateSharedStoreDocsToRoot = async () => {
    if (
      !confirm(
        'This one-time migration copies legacy store-scoped shared collections (customers, creditCustomers, suppliers, rechargeProviders, stockTransfers, users, brands, categories) and branch settings into the shared root collections tagged with homeStoreId / storeId.\n\nExisting root documents will be merged safely without deleting any data.\n\nProceed?'
      )
    ) {
      return;
    }

    setIsRunning(true);
    setLog([]);
    addLog('=== Starting Shared HO & Branch Root Collection Migration ===');

    try {
      const storesSnap = await getDocs(collection(db, 'stores'));
      addLog(`Found ${storesSnap.size} branch store(s).`);

      let totalCopied = 0;

      for (const storeDoc of storesSnap.docs) {
        const storeId = storeDoc.id;
        const storeData = storeDoc.data();
        const storeName = storeData.name || storeId;
        addLog(`\nScanning Branch: ${storeName} (${storeId})...`);

        // 1. Copy store-scoped shared collections to root
        for (const colName of LEGACY_STORE_SCOPED_SHARED_COLLECTIONS) {
          try {
            const subSnap = await getDocs(collection(db, 'stores', storeId, colName));
            if (subSnap.empty) continue;

            addLog(`  • ${colName}: copying ${subSnap.size} document(s) to root /${colName}...`);
            let batch = writeBatch(db);
            let opsInBatch = 0;

            for (const itemDoc of subSnap.docs) {
              const raw = itemDoc.data();
              const enriched: Record<string, any> = { ...raw };

              if (colName === 'customers' || colName === 'creditCustomers') {
                if (!enriched.homeStoreId) enriched.homeStoreId = storeId;
                if (!enriched.homeStoreName) enriched.homeStoreName = storeName;
              } else if (colName === 'users') {
                if (!enriched.storeId) enriched.storeId = storeId;
              }

              batch.set(doc(db, colName, itemDoc.id), enriched, { merge: true });
              opsInBatch++;
              totalCopied++;

              if (opsInBatch >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                opsInBatch = 0;
              }
            }

            if (opsInBatch > 0) {
              await batch.commit();
            }
          } catch (colErr) {
            addLog(`  ✗ Failed scanning ${colName} in ${storeName}: ${getErrorMessage(colErr)}`);
          }
        }

        // 2. Merge legacy stores/{storeId}/settings/shopDetails into stores/{storeId}
        try {
          const legacyShopSnap = await getDoc(
            doc(db, 'stores', storeId, 'settings', 'shopDetails')
          );
          if (legacyShopSnap.exists()) {
            const s = legacyShopSnap.data();
            await setDoc(
              doc(db, 'stores', storeId),
              {
                ownerName: storeData.ownerName || s.ownerName || '',
                address: storeData.address || s.address || '',
                phone: storeData.phone || s.phone || '',
                email: storeData.email || s.email || '',
                gst: storeData.gst || s.gst || '',
                upiId: storeData.upiId || s.upiId || '',
                merchantName: storeData.merchantName || s.merchantName || storeName,
                ...(s.latitude !== undefined && storeData.latitude === undefined
                  ? { latitude: s.latitude }
                  : {}),
                ...(s.longitude !== undefined && storeData.longitude === undefined
                  ? { longitude: s.longitude }
                  : {}),
              },
              { merge: true }
            );
            addLog(`  ✓ Merged legacy shopDetails into stores/${storeId}`);
          }
        } catch (_e) {
          // ignore
        }
      }

      addLog(`\n✅ Shared Root Collection Migration Complete! Copied/merged ${totalCopied} document(s).`);
    } catch (err: any) {
      console.error(err);
      addLog(`❌ Migration error: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  //  3. GST AUDIT EXCEL EXPORT
  // ──────────────────────────────────────────────────────────────────────────

  const getAuditRange = () => {
    const now = new Date();
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    let start = new Date(0);

    switch (auditDuration) {
      case 'today':
        start = new Date();
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start = new Date();
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        break;
      case 'month':
        start = new Date();
        start.setMonth(now.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'year':
        start = new Date();
        start.setFullYear(now.getFullYear() - 1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'custom': {
        if (!auditStartDate || !auditEndDate) return null;
        start = new Date(auditStartDate);
        end.setTime(new Date(auditEndDate).getTime());
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      }
      case 'all':
      default:
        start = new Date(0);
        break;
    }

    return { start, end };
  };

  const getAuditRangeLabel = () => {
    switch (auditDuration) {
      case 'today': return 'Today';
      case 'week': return 'Last 7 Days';
      case 'month': return 'Last 30 Days';
      case 'year': return 'Last 1 Year';
      case 'custom':
        return auditStartDate && auditEndDate
          ? `${auditStartDate} to ${auditEndDate}`
          : 'Custom Range';
      case 'all':
      default:
        return 'All Time';
    }
  };

  const exportGstAuditExcel = async () => {
    if (isExportingAudit) return;

    if (auditDuration === 'custom' && (!auditStartDate || !auditEndDate)) {
      addLog('Please choose both start and end dates for the custom audit duration.');
      return;
    }

    const range = getAuditRange();
    if (!range) {
      addLog('Invalid audit duration range.');
      return;
    }

    setIsExportingAudit(true);
    addLog(
      `Preparing ${auditFilterMode === 'gst-only' ? 'GST-only' : 'all billing'} audit export for ${getAuditRangeLabel()}...`
    );

    try {
      const billingSnap = await getDocs(getCollectionRef('billingItems'));
      const rows: Array<{ sortTime: number; data: Record<string, string | number> }> = [];

      billingSnap.docs.forEach((billingDoc) => {
        const item = billingDoc.data() as any;
        const createdAt = toDateValue(item.createdAt);

        if (!createdAt) return;
        if (createdAt < range.start || createdAt > range.end) return;

        const gstRate = Number(item.taxPercent ?? item.gstRate ?? 0);
        const gstAmountField = Number(item.gstAmount ?? 0);
        const isGstEnabled = item.gstEnabled !== false && (gstRate > 0 || gstAmountField > 0);

        if (auditFilterMode === 'gst-only' && !isGstEnabled) return;

        const quantity = Number(item.quantity ?? 0);
        const unitPrice = Number(item.sellingPrice ?? item.price ?? 0);
        const lineSubtotal = Number(item.itemSubtotal ?? unitPrice * quantity);
        const lineDiscount = Number(item.itemDiscount ?? item.discountAmount ?? 0);
        const taxableValue = Math.max(lineSubtotal - lineDiscount, 0);
        const gstAmount = roundToTwo(
          gstAmountField > 0
            ? gstAmountField
            : gstRate > 0
            ? (taxableValue * gstRate) / 100
            : 0
        );
        const cgst = roundToTwo(gstAmount / 2);
        const sgst = roundToTwo(gstAmount - cgst);
        const total = roundToTwo(taxableValue + gstAmount);

        rows.push({
          sortTime: createdAt.getTime(),
          data: {
            'Sl no': 0,
            'Customer Name': item.customerName || item.creditCustomerName || 'Walk In Customer',
            'Invoice No': item.invoiceNumber || item.transactionId || item.id || '',
            Date: createdAt.toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            }),
            'GST No': item.customerGstNo || '',
            'HSN Code': item.hsnCode || '',
            Qty: quantity,
            'Taxable Value': taxableValue,
            IGST: 0,
            CGST: cgst,
            SGST: sgst,
            Total: total,
          },
        });
      });

      if (rows.length === 0) {
        addLog('No GST billing items found for the selected audit filter and duration.');
        return;
      }

      rows.sort((a, b) => a.sortTime - b.sortTime);
      rows.forEach((row, index) => {
        row.data['Sl no'] = index + 1;
      });

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => row.data));

      worksheet['!cols'] = [
        { wch: 8 },
        { wch: 28 },
        { wch: 16 },
        { wch: 14 },
        { wch: 18 },
        { wch: 14 },
        { wch: 8 },
        { wch: 16 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 16 },
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, 'GST Audit');

      const datePart = formatInputDate(new Date());
      const filterPart = auditFilterMode === 'gst-only' ? 'gst_only' : 'all_bills';
      const durationPart =
        auditDuration === 'custom'
          ? `${auditStartDate}_${auditEndDate}`
          : auditDuration;

      XLSX.writeFile(
        workbook,
        `billing_audit_${filterPart}_${durationPart}_${datePart}.xlsx`
      );
      addLog(`Exported ${rows.length} GST billing item(s) to Excel.`);
    } catch (error: any) {
      console.error('Failed to export GST audit Excel:', error);
      addLog(`Error exporting Excel: ${error?.message || error}`);
    } finally {
      setIsExportingAudit(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  //  4. INVOICE REPAIR & RENAME
  // ──────────────────────────────────────────────────────────────────────────

  const runRepair = async () => {
    if (isRunning) return;
    setIsRunning(true);
    addLog('Starting repair process...');

    try {
      const billingItemsRef = getCollectionRef('billingItems');
      const creditSalesRef = getCollectionRef('creditSales');

      const [billingSnap, creditSnap] = await Promise.all([
        getDocs(billingItemsRef),
        getDocs(creditSalesRef),
      ]);

      const allItems: any[] = [
        ...billingSnap.docs.map((d) => ({ ...d.data(), _id: d.id, _collection: 'billingItems' })),
        ...creditSnap.docs.map((d) => ({ ...d.data(), _id: d.id, _collection: 'creditSales' })),
      ];

      addLog(`Scanned ${allItems.length} items. Grouping by transactionId...`);

      const groups: Record<string, any[]> = {};
      allItems.forEach((item) => {
        if (item.transactionId) {
          if (!groups[item.transactionId]) groups[item.transactionId] = [];
          groups[item.transactionId].push(item);
        }
      });

      const transactionIds = Object.keys(groups);
      addLog(`Found ${transactionIds.length} unique transactions.`);

      const transactionsRef = getCollectionRef('transactions');
      const transactionsSnap = await getDocs(transactionsRef);
      const existingTransactionsMap = new Map();
      const oldTransactions: any[] = [];

      transactionsSnap.docs.forEach((docSnap) => {
        existingTransactionsMap.set(docSnap.id, docSnap.data());
        if (!docSnap.id.startsWith('INV-')) {
          oldTransactions.push({ id: docSnap.id, ...docSnap.data() });
        }
      });

      addLog(`Found ${existingTransactionsMap.size} existing transaction documents.`);

      let repairedCount = 0;
      let skippedCount = 0;

      for (const tid of transactionIds) {
        if (!tid.startsWith('INV-')) continue;

        if (existingTransactionsMap.has(tid)) {
          skippedCount++;
          continue;
        }

        addLog(`Repairing missing transaction: ${tid}`);
        const groupItems = groups[tid];
        const firstItem = groupItems[0];

        let calculatedSubtotal = 0;
        let calculatedGrandTotal = 0;
        let calculatedDiscount = 0;
        let itemCount = 0;

        const summaryItems = groupItems.map((item: any) => {
          const qty = Number(item.quantity) || 0;
          const price = Number(item.sellingPrice) || 0;
          const lineTotal = Number(item.totalWithGst) || price * qty;
          const lineSubtotal = item.itemSubtotal || price * qty;

          calculatedSubtotal += lineSubtotal;
          calculatedGrandTotal += lineTotal;
          calculatedDiscount += Number(item.itemDiscount) || 0;
          itemCount++;

          return {
            ...item,
            title: item.title || item.name || 'Unknown Item',
            sellingPrice: price,
            quantity: qty,
            totalWithGst: lineTotal,
          };
        });

        const calculatedTotalAfterDiscount = calculatedSubtotal - calculatedDiscount;
        const createdAt = firstItem.createdAt;

        const transactionData = {
          transactionId: tid,
          subtotal: calculatedSubtotal,
          discount: calculatedDiscount,
          totalAfterDiscount: calculatedTotalAfterDiscount,
          grandTotal: calculatedGrandTotal,
          itemsCount: itemCount,
          createdAt: createdAt,
          createdBy: firstItem.createdBy || '',
          createdByName: firstItem.createdByName || '',
          paymentMode: firstItem.paymentMode || 'cash',
          customerName: firstItem.customerName || 'Walk In Customer',
          customerPhone: firstItem.customerPhone || '',
          customerEmail: firstItem.customerEmail || '',
          customerDetails: firstItem.customerDetails || '',
          items: summaryItems,
        };

        const safeCandidateId = tid.replace(/\//g, '_');
        await setDoc(getDocRef('transactions', safeCandidateId), transactionData);
        repairedCount++;
      }

      addLog(
        `Repair Complete. Created ${repairedCount} transaction documents. (Skipped ${skippedCount} existing)`
      );
    } catch (error: any) {
      console.error(error);
      addLog(`Error: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const runRenameOldInvoices = async () => {
    if (isRunning) return;
    if (
      !confirm(
        'This will rename existing INV- invoice IDs to the new 0001/YY-YY format and update related documents. Proceed?'
      )
    ) {
      return;
    }
    setIsRunning(true);
    addLog('Starting INV- -> new invoice ID migration...');

    try {
      const billingItemsRef = getCollectionRef('billingItems');
      const creditSalesRef = getCollectionRef('creditSales');

      const [billingSnap, creditSnap, transactionsSnap] = await Promise.all([
        getDocs(billingItemsRef),
        getDocs(creditSalesRef),
        getDocs(getCollectionRef('transactions')),
      ]);

      const allItems: any[] = [
        ...billingSnap.docs.map((d) => ({ ...d.data(), _id: d.id, _ref: d.ref, _collection: 'billingItems' })),
        ...creditSnap.docs.map((d) => ({ ...d.data(), _id: d.id, _ref: d.ref, _collection: 'creditSales' })),
      ];

      const oldIds = new Set<string>();
      allItems.forEach((it) => {
        if (it.transactionId && String(it.transactionId).startsWith('INV-')) {
          oldIds.add(it.transactionId);
        }
      });

      addLog(`Found ${oldIds.size} unique INV- transaction IDs to migrate.`);
      const existingIds = new Set(transactionsSnap.docs.map((d) => d.id));
      const existingTransactionsMap = new Map(
        transactionsSnap.docs.map((d) => [d.id, d.data()])
      );
      const generatedThisRun = new Set<string>();
      let migratedCount = 0;

      for (const oldId of Array.from(oldIds)) {
        addLog(`Migrating ${oldId}...`);

        const relatedItems = allItems.filter((it) => it.transactionId === oldId);
        if (relatedItems.length === 0) continue;

        const firstItem = relatedItems[0];
        let createdAtDate = new Date();
        if (firstItem.createdAt) {
          const ca = firstItem.createdAt;
          if (ca.seconds) createdAtDate = new Date(ca.seconds * 1000);
          else if (ca instanceof Date) createdAtDate = ca;
          else createdAtDate = new Date(ca);
        }

        const yy = String(createdAtDate.getFullYear() % 100).padStart(2, '0');
        const nextYy = String((createdAtDate.getFullYear() + 1) % 100).padStart(2, '0');
        const fiscalLabel = `${yy}-${nextYy}`;

        let seq = 1;
        let candidate = '';
        while (true) {
          candidate = `${String(seq).padStart(4, '0')}/${fiscalLabel}`;
          if (!existingIds.has(candidate) && !generatedThisRun.has(candidate)) break;
          seq++;
        }

        addLog(`  > New ID will be ${candidate}`);

        for (const colName of ['billingItems', 'creditSales']) {
          const q = query(getCollectionRef(colName), where('transactionId', '==', oldId));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            try {
              await updateDoc(d.ref, { transactionId: candidate });
            } catch (err) {
              addLog(`    ! Failed to update ${colName}/${d.id}: ${getErrorMessage(err)}`);
            }
          }
        }

        if (existingTransactionsMap.has(oldId)) {
          const oldData = existingTransactionsMap.get(oldId);
          const newData = { ...(oldData as any), transactionId: candidate };
          try {
            const safeCandidateId = candidate.replace(/\//g, '_');
            await setDoc(getDocRef('transactions', safeCandidateId), newData);
            const safeOldId = oldId.replace(/\//g, '_');
            try { await deleteDoc(getDocRef('transactions', safeOldId)); } catch {}
            try { await deleteDoc(getDocRef('transactions', oldId)); } catch {}
            addLog(`  > Copied transaction doc ${oldId} -> ${candidate}`);
          } catch (err) {
            addLog(`    ! Failed to copy transaction doc: ${getErrorMessage(err)}`);
          }
        }

        existingIds.add(candidate);
        generatedThisRun.add(candidate);
        migratedCount++;
      }

      addLog(`Migration complete. Migrated ${migratedCount} invoice IDs.`);
    } catch (err: any) {
      console.error(err);
      addLog(`Error: ${err.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const cleanInventory = async () => {
    if (isRunning) return;
    setIsRunning(true);
    addLog('Starting inventory cleanup...');

    try {
      const productsRef = getCollectionRef('products');
      const zeroQtyQuery = query(productsRef, where('quantity', '==', 0));
      const snapshot = await getDocs(zeroQtyQuery);

      if (snapshot.empty) {
        addLog('No products with 0 quantity found.');
        return;
      }

      addLog(`Found ${snapshot.size} products with 0 quantity. Deleting...`);
      let deletedCount = 0;

      for (const docSnapshot of snapshot.docs) {
        await deleteDoc(docSnapshot.ref);
        deletedCount++;
        if (deletedCount % 20 === 0) {
          addLog(`Deleted ${deletedCount} products...`);
        }
      }

      addLog(`Cleanup Complete. Deleted ${deletedCount} products.`);
    } catch (error: any) {
      console.error(error);
      addLog(`Error: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const migrateSlashDocIds = async () => {
    if (isRunning) return;

    if (
      !confirm(
        'This will migrate all transaction document IDs from slash (/) format to underscore (_) format.\n\nExample: 0001/26-27 → 0001_26-27\n\nProceed?'
      )
    ) {
      return;
    }

    setIsRunning(true);
    setLog([]);
    addLog('=== Starting Transaction Doc ID Migration (/ → _) ===');
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    try {
      addLog('\nScanning root-level transactions collection...');
      const rootTransRef = collection(db, 'transactions');
      const rootSnap = await getDocs(rootTransRef);
      const rootSlashDocs = rootSnap.docs.filter((d) => d.id.includes('/'));
      addLog(`Found ${rootSnap.size} total docs, ${rootSlashDocs.length} with slash in ID.`);

      for (const docSnap of rootSlashDocs) {
        const oldId = docSnap.id;
        const newId = oldId.replace(/\//g, '_');

        try {
          await setDoc(doc(db, 'transactions', newId), docSnap.data());
          await deleteDoc(doc(db, 'transactions', oldId));
          addLog(`  ✓ Migrated root doc: ${oldId} → ${newId}`);
          totalMigrated++;
        } catch (err) {
          addLog(`  ✗ Error migrating ${oldId}: ${getErrorMessage(err)}`);
          totalErrors++;
        }
      }

      addLog('\nScanning store-scoped transactions...');
      const storesSnap = await getDocs(collection(db, 'stores'));
      addLog(`Found ${storesSnap.size} stores to scan.`);

      for (const storeDoc of storesSnap.docs) {
        const sId = storeDoc.id;
        const sName = storeDoc.data()?.name || sId;

        try {
          const storeTransRef = collection(db, 'stores', sId, 'transactions');
          const storeTransSnap = await getDocs(storeTransRef);
          const slashDocs = storeTransSnap.docs.filter((d) => d.id.includes('/'));

          if (slashDocs.length === 0) {
            totalSkipped++;
            continue;
          }

          addLog(`\n  Store: ${sName} (${sId}) — ${slashDocs.length} docs to migrate`);

          for (const transDoc of slashDocs) {
            const oldId = transDoc.id;
            const newId = oldId.replace(/\//g, '_');

            try {
              await setDoc(
                doc(db, 'stores', sId, 'transactions', newId),
                transDoc.data()
              );
              await deleteDoc(doc(db, 'stores', sId, 'transactions', oldId));
              addLog(`    ✓ ${oldId} → ${newId}`);
              totalMigrated++;
            } catch (err) {
              addLog(`    ✗ Error migrating ${oldId}: ${getErrorMessage(err)}`);
              totalErrors++;
            }
          }
        } catch (err) {
          addLog(`  ✗ Error scanning store ${sName}: ${getErrorMessage(err)}`);
          totalErrors++;
        }
      }

      addLog(`\n=== Migration Complete ===`);
      addLog(`✓ Migrated: ${totalMigrated} docs`);
      addLog(`⊘ Stores skipped (no slash IDs): ${totalSkipped}`);
      if (totalErrors > 0) addLog(`✗ Errors: ${totalErrors}`);
    } catch (err: any) {
      console.error(err);
      addLog(`Fatal error: ${err.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const runFullHubInit = async () => {
    if (isRunning || !currentUser?.uid) return;

    if (
      !confirm(
        'This will initialize the entire multi-store architecture: create a Hub, create a Primary Store in stores/, link your owner user account, and migrate all root operational collections into stores/{storeId}/*.\n\nProceed?'
      )
    ) {
      return;
    }

    setIsRunning(true);
    setLog([]);
    addLog('Starting Full Hub & Store Architecture Initialization...');

    try {
      const result = await migrateToHubArchitecture(
        currentUser.uid,
        'Digital Zone Hub',
        'Main Branch',
        addLog
      );

      if (result.success) {
        addLog(`\n✅ Hub Architecture Initialized Successfully!`);
        addLog(`Hub ID: ${result.hubId}`);
        addLog(`Store ID: ${result.storeId}`);
        addLog(`Migrated Documents: ${result.totalMigrated}`);
        await refreshStores();
      } else {
        addLog(`❌ Error: ${result.error}`);
      }
    } catch (err: any) {
      addLog(`Fatal error: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 font-sans text-slate-900">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-700">
                <Database className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Database Migration & Maintenance
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Safely migrate legacy root collections to isolated branch subcollections{' '}
              <code className="bg-slate-200/60 px-1.5 py-0.5 rounded text-slate-800 font-mono text-[11px]">
                stores/&#123;storeId&#125;/*
              </code>
            </p>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* PRIMARY STUDIO: STORE SUBCOLLECTION MIGRATION                       */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-teal-200 shadow-[0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden">
          <div className="p-6 bg-gradient-to-r from-teal-50/70 via-white to-white border-b border-teal-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Primary Action
                </span>
                <h2 className="text-lg font-bold text-slate-900">
                  Migrate Root Collections to Store Subcollections
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
                  Moves your single-store inventory, billing items, credit sales, expenses, and
                  attendance from the Firestore root into your selected branch's isolated subcollections.
                </p>
              </div>

              {/* Target Branch Selector */}
              <div className="flex flex-col gap-1.5 min-w-[240px]">
                <label className="text-[11px] font-semibold text-slate-700 flex items-center justify-between">
                  <span>Target Branch Store</span>
                  <button
                    onClick={handleCreateDefaultStore}
                    className="text-teal-700 hover:text-teal-800 text-[10px] font-bold"
                  >
                    + New Branch
                  </button>
                </label>
                <select
                  value={targetStoreId}
                  onChange={(e) => setTargetStoreId(e.target.value)}
                  className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-teal-500 cursor-pointer shadow-2xs"
                >
                  {stores.length === 0 ? (
                    <option value="">No stores found (Click + New Branch)</option>
                  ) : (
                    stores.map((s) => (
                      <option key={s.id || s.name} value={s.id || ''}>
                        {s.name} ({s.id ? `${s.id.slice(0, 8)}...` : 'New'})
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Live Inspection / Pre-Flight Scanner Table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-500" />
                  Pre-Flight Collection Inspection
                </h3>
                <button
                  onClick={handleScanCounts}
                  disabled={isScanningCollections || isRunning}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isScanningCollections ? 'animate-spin text-teal-600' : ''}`}
                  />
                  <span>{isScanningCollections ? 'Scanning...' : 'Scan / Refresh Counts'}</span>
                </button>
              </div>

              {scanResults.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-slate-200 text-center bg-slate-50/50">
                  <Database className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-600 font-medium">
                    Inspection table not scanned yet
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Click <strong>Scan / Refresh Counts</strong> to see document counts in root vs the selected branch.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                        <th className="py-2.5 px-3">Collection</th>
                        <th className="py-2.5 px-3 text-right">Root Count</th>
                        <th className="py-2.5 px-3 text-right">Target Store Count</th>
                        <th className="py-2.5 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {scanResults.map((row) => (
                        <tr key={row.collectionName} className="hover:bg-slate-50/60">
                          <td className="py-2 px-3 font-sans font-bold text-slate-900">
                            {row.collectionName}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                            {row.rootCount.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-teal-700 tabular-nums">
                            {row.storeCount.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2 px-3 text-center font-sans">
                            {row.status === 'ready' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                Ready to Migrate
                              </span>
                            )}
                            {row.status === 'synced' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Synced
                              </span>
                            )}
                            {row.status === 'diverged' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                                In Store ({row.storeCount})
                              </span>
                            )}
                            {row.status === 'empty' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-400">
                                Empty
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Safety Options */}
            <div className="flex items-center gap-2 p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900">
              <input
                id="deleteRoot"
                type="checkbox"
                checked={deleteRootAfterMigration}
                onChange={(e) => setDeleteRootAfterMigration(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
              />
              <label htmlFor="deleteRoot" className="cursor-pointer font-medium select-none">
                Delete original root operational documents after copying (Clean-up mode). Leave unchecked to keep root backups.
              </label>
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={handleMigrateRootToSubcollections}
                disabled={isRunning || !targetStoreId}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 text-teal-400 fill-teal-400" />
                <span>{isRunning ? 'Migrating...' : 'Run Sub-collection Migration'}</span>
              </button>

              <button
                onClick={handleRescueOldNestedHubData}
                disabled={isRunning}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                title="Rescues documents from hubs/.../stores if created during old migration tests"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Rescue Legacy Hub Data</span>
              </button>

              <button
                onClick={handleRecomputeMetrics}
                disabled={isRunning || !targetStoreId}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5 text-teal-600" />
                <span>Recompute Store Metrics</span>
              </button>
            </div>
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* SECONDARY UTILITIES                                                 */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Shared Root Collection Migration */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Shared Global Root Migration
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Copies branch-scoped customers, credit customers, suppliers, recharge providers, and
              brands to the shared root collections tagged with <code className="bg-slate-100 px-1 rounded">homeStoreId</code>.
            </p>
            <button
              onClick={migrateSharedStoreDocsToRoot}
              disabled={isRunning}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Run Shared Root Migration
            </button>
          </section>

          {/* Slash Doc ID Fix */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-3">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-purple-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Invoice Doc ID Migration (/ → _)
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Migrates transaction document IDs from forward-slash (<code className="bg-slate-100 px-1 rounded">0001/26-27</code>) to underscore (<code className="bg-slate-100 px-1 rounded">0001_26-27</code>) so Firestore can index them.
            </p>
            <button
              onClick={migrateSlashDocIds}
              disabled={isRunning}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Migrate Slash Doc IDs
            </button>
          </section>

          {/* Invoice Repair & Sequential Format */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Invoice Record Repair
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Reconstructs missing transaction summary records from raw billing items to fix "Invoice Not Found" errors.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={runRepair}
                disabled={isRunning}
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Start Repair
              </button>
              <button
                onClick={runRenameOldInvoices}
                disabled={isRunning}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Migrate INV- to New Format
              </button>
            </div>
          </section>

          {/* Zero Quantity Product Cleanup */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-3">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Zero Quantity Product Cleanup
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Deletes all products with quantity = 0 from the current store inventory to reduce index size.
            </p>
            <button
              onClick={cleanInventory}
              disabled={isRunning}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Delete 0 Qty Products
            </button>
          </section>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* GST AUDIT EXCEL EXPORT                                              */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-teal-700" />
            <h2 className="text-base font-bold text-slate-900">
              GST Audit Excel Export
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Export GST billing items formatted with HSN code, CGST, SGST, IGST, and taxable values.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Filter</label>
              <select
                value={auditFilterMode}
                onChange={(e) => setAuditFilterMode(e.target.value as AuditFilterMode)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="gst-only">GST Billing Items Only</option>
                <option value="all-bills">All Billing Items</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Duration</label>
              <select
                value={auditDuration}
                onChange={(e) => setAuditDuration(e.target.value as AuditDuration)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
                <option value="year">Last 1 Year</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
          </div>

          {auditDuration === 'custom' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={auditStartDate}
                  onChange={(e) => setAuditStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={auditEndDate}
                  onChange={(e) => setAuditEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
            </div>
          )}

          <button
            onClick={exportGstAuditExcel}
            disabled={isExportingAudit}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            {isExportingAudit ? 'Exporting...' : `Download Audit Excel (${getAuditRangeLabel()})`}
          </button>
        </section>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* DUPLICATE INVOICE FIXER                                             */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            <h2 className="text-base font-bold text-slate-900">
              Fix Duplicate Invoice Numbers
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Scans billing items for invoices sharing the same ID on different dates. Earliest bill keeps its ID; later bills receive unique sequential numbers.
          </p>

          {duplicateCount !== null && (
            <div
              className={`p-3 rounded-lg text-xs font-semibold ${
                duplicateCount > 0
                  ? 'bg-rose-50 text-rose-800 border border-rose-200'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              {duplicateCount > 0
                ? `Found ${duplicateCount} duplicate invoice group(s) needing repair.`
                : 'All invoice numbers are unique!'}
            </div>
          )}

          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={async () => {
                if (isScanningDuplicates) return;
                setIsScanningDuplicates(true);
                addLog('Scanning for duplicate invoices...');
                try {
                  const result = await scanDuplicateInvoices(getCollectionRef, getDocRef);
                  setDuplicateCount(result.duplicateCount);
                  addLog(
                    `Scan complete. Found ${result.duplicateCount} duplicate group(s) out of ${result.totalTransactions} transactions.`
                  );
                } catch (err: any) {
                  addLog(`Error scanning: ${err?.message || err}`);
                } finally {
                  setIsScanningDuplicates(false);
                }
              }}
              disabled={isScanningDuplicates || isRunning}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isScanningDuplicates ? 'Scanning...' : 'Scan for Duplicates'}
            </button>

            <button
              onClick={async () => {
                if (isFixingDuplicates) return;
                if (!confirm('This will assign new unique IDs to duplicate bills. Proceed?')) return;
                setIsFixingDuplicates(true);
                setLog([]);
                try {
                  const result = await fixDuplicateInvoices(
                    getCollectionRef,
                    getDocRef,
                    addLog
                  );
                  addLog(`✅ Fix complete! Fixed ${result.fixed} duplicate group(s).`);
                  setDuplicateCount(0);
                } catch (err: any) {
                  addLog(`❌ Error: ${err?.message || err}`);
                } finally {
                  setIsFixingDuplicates(false);
                }
              }}
              disabled={isFixingDuplicates || isRunning}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isFixingDuplicates ? 'Fixing...' : 'Fix Duplicate Invoices'}
            </button>

            <button
              onClick={async () => {
                addLog('Initializing atomic invoice counter...');
                try {
                  const res = await initializeInvoiceCounter(getCollectionRef, getDocRef);
                  addLog(
                    `✅ Counter initialized (Non-GST: ${res.nextInvoiceNumber}, GST: ${res.nextGstInvoiceNumber})`
                  );
                } catch (err: any) {
                  addLog(`❌ Error: ${err?.message || err}`);
                }
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              Initialize Counter Only
            </button>
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* FULL INITIALIZATION (OWNER ONLY)                                    */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {currentUser?.role === 'owner' && (
          <section className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm border border-slate-800 space-y-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400" />
              Full Multi-Store Architecture Initialization
            </h2>
            <p className="text-xs text-slate-400">
              Only run this if setting up the multi-store architecture for the first time. Creates a Hub document, creates the Primary Store in root <code className="text-teal-300">stores/</code>, links your owner account, and migrates all root collections.
            </p>
            <button
              onClick={runFullHubInit}
              disabled={isRunning}
              className="px-4 py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isRunning ? 'Initializing...' : 'Run Full Architecture Initialization'}
            </button>
          </section>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* LIVE TERMINAL LOG VIEWER                                            */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section className="bg-slate-950 rounded-2xl border border-slate-800 p-4 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
            <span className="text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Migration Terminal Log
            </span>
            {log.length > 0 && (
              <button
                onClick={() => setLog([])}
                className="text-[10px] text-slate-400 hover:text-white"
              >
                Clear Log
              </button>
            )}
          </div>
          <div className="font-mono text-xs text-emerald-400 h-80 overflow-y-auto space-y-1">
            {log.length === 0 ? (
              <div className="text-slate-600 italic">Ready to run commands...</div>
            ) : (
              log.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Migration;
