import { useState } from 'react';
import Navbar from '../components/Navbar';
import { db } from '../config/firebase';
import { collection, getDocs, setDoc, doc, deleteDoc, query, where, updateDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { migrateToHubArchitecture } from '../utils/migrateToHub';
import { scanDuplicateInvoices, fixDuplicateInvoices, initializeInvoiceCounter } from '../utils/fixDuplicateInvoices';
import * as XLSX from 'xlsx';

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
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const Migration = () => {
    const { currentUser } = useAuth();
    const { getCollectionRef, getDocRef, currentStore } = useStore();
    const [log, setLog] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [auditFilterMode, setAuditFilterMode] = useState<AuditFilterMode>('gst-only');
    const [auditDuration, setAuditDuration] = useState<AuditDuration>('month');
    const [auditStartDate, setAuditStartDate] = useState('');
    const [auditEndDate, setAuditEndDate] = useState('');
    const [isExportingAudit, setIsExportingAudit] = useState(false);
    const [duplicateCount, setDuplicateCount] = useState<number | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [isFixing, setIsFixing] = useState(false);

    const addLog = (msg: string) => {
        setLog(prev => [...prev, msg]);
    };

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
        addLog(`Preparing ${auditFilterMode === 'gst-only' ? 'GST-only' : 'all billing'} audit export for ${getAuditRangeLabel()}...`);

        try {
            const billingSnap = await getDocs(collection(db, 'billingItems'));
            const rows: Array<{ sortTime: number; data: Record<string, string | number> }> = [];

            billingSnap.docs.forEach((billingDoc) => {
                const item = billingDoc.data() as any;
                const createdAt = toDateValue(item.createdAt);

                if (!createdAt) return;
                if (createdAt < range.start || createdAt > range.end) return;

                const gstRate = Number(item.taxPercent ?? item.gstRate ?? 0);
                const gstAmountField = Number(item.gstAmount ?? 0);
                const isGstEnabled = item.gstEnabled !== false && (gstRate > 0 || gstAmountField > 0);

                if (auditFilterMode === 'gst-only' && !isGstEnabled) {
                    return;
                }

                const quantity = Number(item.quantity ?? 0);
                const unitPrice = Number(item.sellingPrice ?? item.price ?? 0);
                const lineSubtotal = Number(item.itemSubtotal ?? (unitPrice * quantity));
                const lineDiscount = Number(item.itemDiscount ?? item.discountAmount ?? 0);
                const taxableValue = Math.max(lineSubtotal - lineDiscount, 0);
                const gstAmount = roundToTwo(gstAmountField > 0 ? gstAmountField : (gstRate > 0 ? taxableValue * gstRate / 100 : 0));
                const cgst = roundToTwo(gstAmount / 2);
                const sgst = roundToTwo(gstAmount - cgst);
                const total = roundToTwo(taxableValue + gstAmount);

                rows.push({
                    sortTime: createdAt.getTime(),
                    data: {
                        'Sl no': 0,
                        'Customer Name': item.customerName || item.creditCustomerName || 'Walk In Customer',
                        'Invoice No': item.invoiceNumber || item.transactionId || item.id || '',
                        'Date': createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                        'GST No': item.customerGstNo || '',
                        'HSN Code': item.hsnCode || '',
                        'Qty': quantity,
                        'Taxable Value': taxableValue,
                        'IGST': 0,
                        'CGST': cgst,
                        'SGST': sgst,
                        'Total': total,
                    }
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
            const worksheet = XLSX.utils.json_to_sheet(rows.map(row => row.data));

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
            const durationPart = auditDuration === 'custom'
                ? `${auditStartDate}_${auditEndDate}`
                : auditDuration;

            XLSX.writeFile(workbook, `billing_audit_${filterPart}_${durationPart}_${datePart}.xlsx`);
            addLog(`Exported ${rows.length} GST billing item(s) to Excel.`);
        } catch (error: any) {
            console.error('Failed to export GST audit Excel:', error);
            addLog(`Error exporting Excel: ${error?.message || error}`);
        } finally {
            setIsExportingAudit(false);
        }
    };

    const runRepair = async () => {
        if (isRunning) return;
        setIsRunning(true);
        addLog('Starting repair process...');

        try {
            // 1. Fetch all billing items and credit sales
            const billingItemsRef = collection(db, 'billingItems');
            const creditSalesRef = collection(db, 'creditSales');

            const [billingSnap, creditSnap] = await Promise.all([
                getDocs(billingItemsRef),
                getDocs(creditSalesRef)
            ]);

            const allItems: any[] = [
                ...billingSnap.docs.map(d => ({ ...d.data(), _id: d.id, _collection: 'billingItems' })),
                ...creditSnap.docs.map(d => ({ ...d.data(), _id: d.id, _collection: 'creditSales' }))
            ];

            addLog(`Scanned ${allItems.length} items. Grouping by transactionId...`);

            // 2. Group by Transaction ID
            const groups: Record<string, any[]> = {};
            allItems.forEach(item => {
                if (item.transactionId) {
                    if (!groups[item.transactionId]) groups[item.transactionId] = [];
                    groups[item.transactionId].push(item);
                }
            });

            const transactionIds = Object.keys(groups);
            addLog(`Found ${transactionIds.length} unique transactions.`);

            // 3. Fetch existing Transactions to check what's missing
            const transactionsRef = collection(db, 'transactions');
            const transactionsSnap = await getDocs(transactionsRef);
            const existingTransactionsMap = new Map();
            const oldTransactions: any[] = [];

            transactionsSnap.docs.forEach(doc => {
                existingTransactionsMap.set(doc.id, doc.data());
                // Keep track of potential "orphaned" old transactions (TXN-...)
                if (!doc.id.startsWith('INV-')) {
                    oldTransactions.push({ id: doc.id, ...doc.data() });
                }
            });

            addLog(`Found ${existingTransactionsMap.size} existing transaction documents.`);

            let repairedCount = 0;
            let skippedCount = 0;

            // 4. Iterate over groups and repair if needed
            for (const tid of transactionIds) {
                // We only care about ensuring 'INV-' transactions exist
                if (!tid.startsWith('INV-')) {
                    continue; // Should likely be migrated by the previous step, but ignore for now
                }

                if (existingTransactionsMap.has(tid)) {
                    skippedCount++;
                    continue; // Already exists
                }

                addLog(`Repairing missing transaction: ${tid}`);

                const groupItems = groups[tid];
                const firstItem = groupItems[0];

                // Construct the summary
                // Calculate totals
                let calculatedSubtotal = 0;
                let calculatedGrandTotal = 0;
                let calculatedDiscount = 0;
                let calculatedTotalAfterDiscount = 0;
                let itemCount = 0;

                // Reconstruct items with display details
                const summaryItems = groupItems.map((item: any) => {
                    // Logic from Billing.tsx calculation
                    // item.sellingPrice is usually the unit price
                    // item.totalWithGst is the line total (after discount & GST)

                    const qty = Number(item.quantity) || 0;
                    const price = Number(item.sellingPrice) || 0;
                    const lineTotal = Number(item.totalWithGst) || (price * qty); // fallback

                    // Fallback subtotal calc if not present
                    const lineSubtotal = item.itemSubtotal || (price * qty);

                    calculatedSubtotal += lineSubtotal;
                    calculatedGrandTotal += lineTotal;
                    calculatedDiscount += (Number(item.itemDiscount) || 0);
                    itemCount++;

                    return {
                        ...item,
                        // Ensure vital display fields exist
                        title: item.title || item.name || 'Unknown Item',
                        sellingPrice: price,
                        quantity: qty,
                        totalWithGst: lineTotal
                    };
                });

                calculatedTotalAfterDiscount = calculatedSubtotal - calculatedDiscount;

                // Heuristic Parsing for Time
                let createdAt = firstItem.createdAt; // Timestamp or serialized date

                // Try to find a matching OLD transaction (orphaned) to steal metadata from
                let matchedOldDoc: any = null;

                if (createdAt) {
                    let targetTime = 0;
                    if (createdAt.seconds) targetTime = createdAt.seconds * 1000;
                    else if (createdAt instanceof Date) targetTime = createdAt.getTime();
                    else if (typeof createdAt === 'string') targetTime = new Date(createdAt).getTime();

                    // Look for old doc within 10 seconds window
                    matchedOldDoc = oldTransactions.find(old => {
                        let oldTime = 0;
                        if (old.createdAt?.seconds) oldTime = old.createdAt.seconds * 1000;
                        else if (old.createdAt instanceof Date) oldTime = old.createdAt.getTime(); // unlikely from firestore

                        return Math.abs(oldTime - targetTime) < 10000; // 10s window
                    });
                }

                // Base Data
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
                    shopName: matchedOldDoc?.shopName || firstItem.shopName || '', // Try match, then item, usually item NO have it.
                    shopAddress: matchedOldDoc?.shopAddress || firstItem.shopAddress || '',
                    shopPhone: matchedOldDoc?.shopPhone || firstItem.shopPhone || '',
                    shopEmail: matchedOldDoc?.shopEmail || firstItem.shopEmail || '',
                    shopGst: matchedOldDoc?.shopGst || firstItem.shopGst || '',

                    // Flags
                    gstEnabled: firstItem.gstEnabled || false,
                    gstRate: firstItem.gstRate || 0,
                    gstAmount: firstItem.gstAmount || 0, // This might be per item sum? 
                    // Summing gstAmount from items is safer:
                    // gstAmount: groupItems.reduce((acc, curr) => acc + (curr.gstAmount || 0), 0),

                    items: summaryItems,
                };

                // If we found a match, copy over richer metadata if missing
                if (matchedOldDoc) {
                    // addLog(`  > Matched with old doc: ${matchedOldDoc.id}`);
                    if (matchedOldDoc.notes) (transactionData as any).notes = matchedOldDoc.notes;
                    if (!transactionData.shopName) transactionData.shopName = matchedOldDoc.shopName;
                    // Copy other potential missing fields
                }

                // Write the new transaction document
                await setDoc(doc(db, 'transactions', tid), transactionData);
                repairedCount++;
            }

            addLog(`Repair Complete. Created ${repairedCount} transaction documents. (Skipped ${skippedCount} existing)`);

        } catch (error: any) {
            console.error(error);
            addLog(`Error: ${error.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    const runRenameOldInvoices = async () => {
        if (isRunning) return;
        if (!confirm('This will rename existing INV- invoice IDs to the new 0001/YY-YY format and update related documents. Proceed?')) return;
        setIsRunning(true);
        addLog('Starting INV- -> new invoice ID migration...');

        try {
            const billingItemsRef = collection(db, 'billingItems');
            const creditSalesRef = collection(db, 'creditSales');

            const [billingSnap, creditSnap, transactionsSnap] = await Promise.all([
                getDocs(billingItemsRef),
                getDocs(creditSalesRef),
                getDocs(collection(db, 'transactions'))
            ]);

            const allItems: any[] = [
                ...billingSnap.docs.map(d => ({ ...d.data(), _id: d.id, _ref: d.ref, _collection: 'billingItems' })),
                ...creditSnap.docs.map(d => ({ ...d.data(), _id: d.id, _ref: d.ref, _collection: 'creditSales' }))
            ];

            // collect unique old INV- ids
            const oldIds = new Set<string>();
            allItems.forEach(it => { if (it.transactionId && String(it.transactionId).startsWith('INV-')) oldIds.add(it.transactionId); });

            addLog(`Found ${oldIds.size} unique INV- transaction IDs to migrate.`);

            // existing transaction ids map
            const existingIds = new Set(transactionsSnap.docs.map(d => d.id));
            const existingTransactionsMap = new Map(transactionsSnap.docs.map(d => [d.id, d.data()]));

            const generatedThisRun = new Set<string>();
            let migratedCount = 0;

            for (const oldId of Array.from(oldIds)) {
                addLog(`Migrating ${oldId}...`);

                const relatedItems = allItems.filter(it => it.transactionId === oldId);
                if (relatedItems.length === 0) {
                    addLog(`  > No related items found for ${oldId}, skipping.`);
                    continue;
                }

                const firstItem = relatedItems[0];
                // determine createdAt from item, fallback to now
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

                // find a free sequential order number for this fiscal label
                let seq = 1;
                let candidate = '';
                while (true) {
                    candidate = `${String(seq).padStart(4, '0')}/${fiscalLabel}`;
                    if (!existingIds.has(candidate) && !generatedThisRun.has(candidate)) break;
                    seq++;
                }

                addLog(`  > New ID will be ${candidate}`);

                // Update all related billingItems and creditSales
                for (const colName of ['billingItems', 'creditSales']) {
                    const q = query(collection(db, colName), where('transactionId', '==', oldId));
                    const snap = await getDocs(q);
                    if (!snap.empty) addLog(`  > Updating ${snap.size} docs in ${colName}`);
                    for (const d of snap.docs) {
                        try {
                            await updateDoc(d.ref, { transactionId: candidate });
                        } catch (err) {
                            console.error('Failed updating item', d.id, err);
                            addLog(`    ! Failed to update ${colName}/${d.id}: ${getErrorMessage(err)}`);
                        }
                    }
                }

                // If a transactions doc exists for oldId, copy to new ID then delete old
                if (existingTransactionsMap.has(oldId)) {
                    const oldData = existingTransactionsMap.get(oldId);
                    const newData = { ...(oldData as any), transactionId: candidate };
                    try {
                        const safeCandidateId = candidate.replace(/\//g, '_');
                        await setDoc(doc(db, 'transactions', safeCandidateId), newData);
                        // Try to delete old doc with safe ID format, then original
                        const safeOldId = oldId.replace(/\//g, '_');
                        try { await deleteDoc(doc(db, 'transactions', safeOldId)); } catch { /* ignore */ }
                        try { await deleteDoc(doc(db, 'transactions', oldId)); } catch { /* ignore */ }
                        addLog(`  > Copied transaction doc ${oldId} -> ${candidate} and deleted old doc.`);
                    } catch (err) {
                        console.error('Failed copying/deleting transaction doc', oldId, err);
                        addLog(`    ! Failed to copy/delete transaction doc for ${oldId}: ${getErrorMessage(err)}`);
                    }
                } else {
                    // If no transaction doc exists, create a synthesized one from items
                    try {
                        // Build summary
                        let subtotal = 0, grandTotal = 0, discount = 0, itemsCount = 0;
                        const summaryItems = relatedItems.map((it: any) => {
                            const qty = Number(it.quantity) || 0;
                            const price = Number(it.sellingPrice) || 0;
                            const lineTotal = Number(it.totalWithGst) || (price * qty);
                            const lineSubtotal = it.itemSubtotal || (price * qty);
                            subtotal += lineSubtotal;
                            grandTotal += lineTotal;
                            discount += Number(it.itemDiscount) || 0;
                            itemsCount++;
                            return { ...it, title: it.title || it.name || 'Unknown Item', sellingPrice: price, quantity: qty, totalWithGst: lineTotal };
                        });

                        const transactionData = {
                            transactionId: candidate,
                            subtotal,
                            discount,
                            totalAfterDiscount: subtotal - discount,
                            grandTotal,
                            itemsCount,
                            createdAt: firstItem.createdAt || Timestamp.now(),
                            createdBy: firstItem.createdBy || '',
                            createdByName: firstItem.createdByName || '',
                            paymentMode: firstItem.paymentMode || 'cash',
                            customerName: firstItem.customerName || 'Walk In Customer',
                            customerPhone: firstItem.customerPhone || '',
                            items: summaryItems,
                        } as any;

                        const safeCandidateId = candidate.replace(/\//g, '_');
                        await setDoc(doc(db, 'transactions', safeCandidateId), transactionData);
                        addLog(`  > Created synthesized transaction doc ${candidate}`);
                    } catch (err) {
                        console.error('Failed to create transaction doc for', candidate, err);
                        addLog(`    ! Failed to create transaction ${candidate}: ${getErrorMessage(err)}`);
                    }
                }

                // mark generated
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
            const productsRef = collection(db, 'products');
            const zeroQtyQuery = query(productsRef, where('quantity', '==', 0));
            const snapshot = await getDocs(zeroQtyQuery);

            if (snapshot.empty) {
                addLog('No products with 0 quantity found.');
                return;
            }

            addLog(`Found ${snapshot.size} products with 0 quantity. Deleting...`);

            let deletedCount = 0;
            // Removed batchSize as it was unused

            // Using simple loop for deletion
            for (const docSnapshot of snapshot.docs) {
                await deleteDoc(doc(db, 'products', docSnapshot.id));
                deletedCount++;
                if (deletedCount % 10 === 0) {
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

    const runHubMigration = async () => {
        if (isRunning || !currentUser?.uid) return;
        
        if (!confirm('Are you sure you want to run the Hub Architecture migration? This will modify your database structure and cannot be easily undone.')) {
            return;
        }

        setIsRunning(true);
        addLog('Starting Hub Architecture migration...');
        addLog('This will restructure all your data into scoped hubs and stores.');

        try {
            const result = await migrateToHubArchitecture(
                currentUser.uid,
                'Digital Zone Hub',
                'Main Branch'
            );

            if (result.success) {
                addLog(`Migration successful! Created Hub ID: ${result.hubId}`);
                addLog(`Please refresh the page and sign in again to load the new architecture.`);
            } else {
                addLog(`Error during migration: ${result.error}`);
                console.error(result.error);
            }
        } catch (error: any) {
            console.error(error);
            addLog(`Error: ${error.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    /**
     * Migrate transaction document IDs from `/` format to `_` format.
     * Scans both root-level `transactions` and all store-scoped `stores/{storeId}/transactions`.
     * For each doc whose ID contains `/`, copies it to a new doc with `_` and deletes the old one.
     */
    const migrateSlashDocIds = async () => {
        if (isRunning) return;

        if (!confirm('This will migrate all transaction document IDs from slash (/) format to underscore (_) format.\n\nExample: 0001/26-27 → 0001_26-27\n\nThe invoice DISPLAY format will remain 0001/26-27.\n\nProceed?')) {
            return;
        }

        setIsRunning(true);
        setLog([]);
        addLog('=== Starting Transaction Doc ID Migration (/ → _) ===');
        let totalMigrated = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        try {
            // ── Part 1: Root-level transactions collection ──
            addLog('\nScanning root-level transactions collection...');
            const rootTransRef = collection(db, 'transactions');
            const rootSnap = await getDocs(rootTransRef);
            const rootSlashDocs = rootSnap.docs.filter(d => d.id.includes('/'));
            addLog(`Found ${rootSnap.size} total docs, ${rootSlashDocs.length} with slash in ID.`);

            for (const docSnap of rootSlashDocs) {
                const oldId = docSnap.id;
                const newId = oldId.replace(/\//g, '_');

                try {
                    // Copy data to new doc ID
                    await setDoc(doc(db, 'transactions', newId), docSnap.data());
                    // Delete old doc
                    await deleteDoc(doc(db, 'transactions', oldId));
                    addLog(`  ✓ Migrated: ${oldId} → ${newId}`);
                    totalMigrated++;
                } catch (err) {
                    addLog(`  ✗ Error migrating ${oldId}: ${getErrorMessage(err)}`);
                    totalErrors++;
                }
            }

            // ── Part 2: Store-scoped transactions ──
            addLog('\nScanning store-scoped transactions...');
            const storesSnap = await getDocs(collection(db, 'stores'));
            addLog(`Found ${storesSnap.size} stores to scan.`);

            for (const storeDoc of storesSnap.docs) {
                const storeId = storeDoc.id;
                const storeName = storeDoc.data()?.name || storeId;

                try {
                    const storeTransRef = collection(db, 'stores', storeId, 'transactions');
                    const storeTransSnap = await getDocs(storeTransRef);
                    const slashDocs = storeTransSnap.docs.filter(d => d.id.includes('/'));

                    if (slashDocs.length === 0) {
                        totalSkipped++;
                        continue;
                    }

                    addLog(`\n  Store: ${storeName} (${storeId}) — ${slashDocs.length} docs to migrate`);

                    for (const transDoc of slashDocs) {
                        const oldId = transDoc.id;
                        const newId = oldId.replace(/\//g, '_');

                        try {
                            await setDoc(
                                doc(db, 'stores', storeId, 'transactions', newId),
                                transDoc.data()
                            );
                            await deleteDoc(
                                doc(db, 'stores', storeId, 'transactions', oldId)
                            );
                            addLog(`    ✓ ${oldId} → ${newId}`);
                            totalMigrated++;
                        } catch (err) {
                            addLog(`    ✗ Error migrating ${oldId}: ${getErrorMessage(err)}`);
                            totalErrors++;
                        }
                    }

                    // Also sync all store transactions to root transactions for public invoice access
                    for (const transDoc of storeTransSnap.docs) {
                        const safeId = transDoc.id.replace(/\//g, '_');
                        try {
                            await setDoc(doc(db, 'transactions', safeId), transDoc.data(), { merge: true });
                        } catch (_e) {}
                    }
                } catch (err) {
                    addLog(`  ✗ Error scanning store ${storeName}: ${getErrorMessage(err)}`);
                    totalErrors++;
                }
            }

            addLog(`\n=== Migration Complete ===`);
            addLog(`✓ Migrated: ${totalMigrated} docs`);
            addLog(`⊘ Stores skipped (no slash IDs): ${totalSkipped}`);
            if (totalErrors > 0) addLog(`✗ Errors: ${totalErrors}`);
            if (totalMigrated === 0 && totalErrors === 0) {
                addLog('ℹ No documents with slash (/) in their ID were found. Nothing to migrate!');
            }
        } catch (err: any) {
            console.error(err);
            addLog(`Fatal error: ${err.message || err}`);
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-20 md:pb-0">
            <Navbar />
            <div className="max-w-4xl mx-auto px-4 py-8">
                <div className="bg-white rounded-xl shadow-lg p-6">
                    <h1 className="text-2xl font-bold mb-4 text-gray-800">System Maintenance Tools</h1>

                    <div className="space-y-8">
                        {/* Section 0: GST Audit Export */}
                        <div className="border-b pb-8">
                            <h2 className="text-xl font-semibold mb-2 text-gray-700">GST Audit Export</h2>
                            <div className="mb-4 text-gray-600">
                                <p className="mb-2">Download GST billing items in the audit format shown in your sample sheet.</p>
                                <p className="text-sm bg-amber-50 text-amber-800 p-3 rounded border border-amber-200">
                                    This export includes customer name, invoice no, date, GST no, HSN code, quantity, taxable value, CGST, SGST and total.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Audit Filter</label>
                                    <select
                                        value={auditFilterMode}
                                        onChange={(e) => setAuditFilterMode(e.target.value as AuditFilterMode)}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="gst-only">GST Billing Items Only</option>
                                        <option value="all-bills">All Billing Items</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Duration</label>
                                    <select
                                        value={auditDuration}
                                        onChange={(e) => setAuditDuration(e.target.value as AuditDuration)}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                                        <input
                                            type="date"
                                            value={auditStartDate}
                                            onChange={(e) => setAuditStartDate(e.target.value)}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                                        <input
                                            type="date"
                                            value={auditEndDate}
                                            onChange={(e) => setAuditEndDate(e.target.value)}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    onClick={exportGstAuditExcel}
                                    disabled={isExportingAudit}
                                    className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${isExportingAudit
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-700'
                                        }`}
                                >
                                    {isExportingAudit ? 'Exporting...' : 'Download GST Audit Excel'}
                                </button>
                                <span className="text-sm text-gray-500">
                                    Current selection: <span className="font-semibold text-gray-900">{getAuditRangeLabel()}</span>
                                </span>
                            </div>
                        </div>

                        {/* Section 1: Invoice Repair */}
                        <div className="border-b pb-8">
                            <h2 className="text-xl font-semibold mb-2 text-gray-700">Invoice Repair Tool</h2>
                            <div className="mb-4 text-gray-600">
                                <p className="mb-2">This tool fixes "Invoice Not Found" errors by reconstructing missing transaction records for new 'INV-' IDs.</p>
                                <p className="text-sm bg-blue-50 text-blue-800 p-3 rounded border border-blue-200">
                                    It will scan your items, group them by the new IDs, and ensure a summary document exists for each invoice.
                                </p>
                            </div>

                            <button
                                onClick={runRepair}
                                disabled={isRunning}
                                className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${isRunning
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-green-600 hover:bg-green-700'
                                    }`}
                            >
                                {isRunning ? 'Running...' : 'Start Invoice Repair'}
                            </button>
                            <div className="mt-4">
                                <p className="mb-2 text-gray-600">If you want to migrate legacy `INV-` invoice IDs to the new formatted IDs (e.g. 0001/26-27), run the migration below. This will update all related billing items and create/copy transaction documents.</p>
                                <button
                                    onClick={runRenameOldInvoices}
                                    disabled={isRunning}
                                    className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${isRunning
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-amber-600 hover:bg-amber-700'
                                        }`}
                                >
                                    {isRunning ? 'Running...' : 'Migrate INV- IDs to New Format'}
                                </button>
                            </div>
                        </div>

                        {/* Section 2: Inventory Cleanup */}
                        <div>
                            <h2 className="text-xl font-semibold mb-2 text-gray-700">Zero Quantity Product Cleanup</h2>
                            <div className="mb-4 text-gray-600">
                                <p className="mb-2">This tool deletes all products from the inventory that have a quantity of 0.</p>
                                <p className="text-sm bg-red-50 text-red-800 p-3 rounded border border-red-200">
                                    Warning: This action is irreversible. Ensure you want to remove all out-of-stock items.
                                </p>
                            </div>

                            <button
                                onClick={cleanInventory}
                                disabled={isRunning}
                                className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${isRunning
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-red-600 hover:bg-red-700'
                                    }`}
                            >
                                {isRunning ? 'Cleaning...' : 'Delete 0 Qty Products'}
                            </button>
                        </div>

                        {/* Section 3: Hub Migration */}
                        {currentUser?.role === 'owner' && (
                        <div className="border-t pt-8">
                            <h2 className="text-xl font-semibold mb-2 text-indigo-700">Hub Architecture Migration</h2>
                            <div className="mb-4 text-gray-600">
                                <p className="mb-2">This is a major structural update to move your single-store data into the new multi-store structure.</p>
                                <p className="text-sm bg-indigo-50 text-indigo-800 p-3 rounded border border-indigo-200">
                                    Warning: This action will restructure all your items into hubs and stores. It runs batch updates across thousands of documents. Do NOT close the tab.
                                </p>
                            </div>

                            <button
                                onClick={runHubMigration}
                                disabled={isRunning}
                                className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${isRunning
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-700'
                                    }`}
                            >
                                {isRunning ? 'Migrating...' : 'Start Hub Migration'}
                            </button>
                        </div>
                        )}

                        {/* Section 4: Slash Doc ID Migration */}
                        <div className="border-t pt-8">
                            <h2 className="text-xl font-semibold mb-2 text-gray-700">Invoice Doc ID Migration (/ → _)</h2>
                            <div className="mb-4 text-gray-600">
                                <p className="mb-2">Invoice numbers like <code className="bg-gray-100 px-1 rounded">0001/26-27</code> contain a forward slash which breaks Firestore document IDs. This tool migrates all transaction document IDs from <code className="bg-gray-100 px-1 rounded">/</code> to <code className="bg-gray-100 px-1 rounded">_</code> format.</p>
                                <p className="text-sm bg-purple-50 text-purple-800 p-3 rounded border border-purple-200">
                                    Example: Doc ID <strong>0001/26-27</strong> → <strong>0001_26-27</strong>. The invoice display format stays as 0001/26-27. Scans both root-level and store-scoped transactions.
                                </p>
                            </div>

                            <button
                                onClick={migrateSlashDocIds}
                                disabled={isRunning}
                                className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${isRunning
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-purple-600 hover:bg-purple-700'
                                    }`}
                            >
                                {isRunning ? 'Migrating...' : 'Migrate Slash Doc IDs'}
                            </button>
                        </div>

                        {/* Section 5: Fix Duplicate Invoices */}
                        <div className="border-t pt-8">
                            <h2 className="text-xl font-semibold mb-2 text-orange-700">Fix Duplicate Invoice Numbers</h2>
                            <div className="mb-4 text-gray-600">
                                <p className="mb-2">Scans all billing items for invoices that share the same transaction ID but have different dates. These duplicates cause bills to be mixed up in reports.</p>
                                <p className="text-sm bg-orange-50 text-orange-800 p-3 rounded border border-orange-200">
                                    <strong>How it works:</strong> The earliest bill keeps its original ID. Later bills with the same ID get new unique numbers in <code className="bg-orange-100 px-1 rounded">DDMMYY/NNNN</code> format (e.g., <code className="bg-orange-100 px-1 rounded">050726/0042</code>). The invoice counter is also initialized to prevent future duplicates.
                                </p>
                                {currentStore && (
                                    <p className="text-sm mt-2 text-gray-500">
                                        Scanning store: <strong>{currentStore.name}</strong> ({currentStore.id})
                                    </p>
                                )}
                            </div>

                            {duplicateCount !== null && (
                                <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${
                                    duplicateCount > 0
                                        ? 'bg-red-50 text-red-800 border border-red-200'
                                        : 'bg-green-50 text-green-800 border border-green-200'
                                }`}>
                                    {duplicateCount > 0
                                        ? `⚠️ Found ${duplicateCount} duplicate invoice group(s) that need fixing.`
                                        : '✅ No duplicate invoices found. All invoice numbers are unique!'}
                                </div>
                            )}

                            <div className="flex gap-3 flex-wrap">
                                <button
                                    onClick={async () => {
                                        if (isScanning || isFixing) return;
                                        setIsScanning(true);
                                        addLog('Scanning for duplicate invoices...');
                                        try {
                                            const result = await scanDuplicateInvoices(getCollectionRef, getDocRef);
                                            setDuplicateCount(result.duplicateCount);
                                            addLog(`Scan complete. Found ${result.duplicateCount} duplicate group(s) out of ${result.totalTransactions} total transactions.`);
                                            if (result.duplicates.length > 0) {
                                                result.duplicates.forEach(dup => {
                                                    addLog(`  → Invoice "${dup.transactionId}": ${dup.groups.length} different dates`);
                                                    dup.groups.forEach(g => {
                                                        addLog(`      Date: ${g.date}, Items: ${g.items.length}`);
                                                    });
                                                });
                                            }
                                        } catch (err: any) {
                                            addLog(`Error scanning: ${err?.message || err}`);
                                        } finally {
                                            setIsScanning(false);
                                        }
                                    }}
                                    disabled={isScanning || isFixing || isRunning}
                                    className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${
                                        isScanning || isFixing || isRunning
                                            ? 'bg-gray-400 cursor-not-allowed'
                                            : 'bg-orange-500 hover:bg-orange-600'
                                    }`}
                                >
                                    {isScanning ? 'Scanning...' : 'Scan for Duplicates'}
                                </button>

                                <button
                                    onClick={async () => {
                                        if (isFixing || isScanning) return;
                                        if (!confirm('This will fix all duplicate invoice numbers by assigning new unique IDs to the later bills.\n\nThe earliest bill keeps its original ID. Later bills get new DDMMYY/NNNN format IDs.\n\nThis also initializes the atomic invoice counter to prevent future duplicates.\n\nProceed?')) {
                                            return;
                                        }
                                        setIsFixing(true);
                                        setLog([]);
                                        try {
                                            const result = await fixDuplicateInvoices(
                                                getCollectionRef,
                                                getDocRef,
                                                (msg) => addLog(msg)
                                            );
                                            addLog(`✅ Fix complete! Fixed ${result.fixed} duplicate group(s). Total transactions: ${result.total}.`);
                                            setDuplicateCount(0);
                                        } catch (err: any) {
                                            addLog(`❌ Error fixing duplicates: ${err?.message || err}`);
                                        } finally {
                                            setIsFixing(false);
                                        }
                                    }}
                                    disabled={isFixing || isScanning || isRunning}
                                    className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${
                                        isFixing || isScanning || isRunning
                                            ? 'bg-gray-400 cursor-not-allowed'
                                            : 'bg-red-600 hover:bg-red-700'
                                    }`}
                                >
                                    {isFixing ? 'Fixing...' : 'Fix Duplicate Invoices'}
                                </button>

                                <button
                                    onClick={async () => {
                                        if (isFixing || isScanning) return;
                                        addLog('Initializing invoice counter from existing data...');
                                        try {
                                            const res = await initializeInvoiceCounter(getCollectionRef, getDocRef);
                                            addLog(`✅ Invoice counter initialized successfully! (Next Non-GST: ${res.nextInvoiceNumber}, Next GST: ${res.nextGstInvoiceNumber})`);
                                        } catch (err: any) {
                                            console.error("Error initializing counter:", err);
                                            addLog(`❌ Error initializing counter: ${err?.name || 'Error'} - ${err?.message || err} (Code: ${err?.code || 'unknown'})`);
                                            if (err?.stack) {
                                                addLog(`   Detail: ${err.stack.split('\n')[0]}`);
                                            }
                                        }
                                    }}
                                    disabled={isFixing || isScanning || isRunning}
                                    className={`px-6 py-3 rounded-lg font-bold text-white shadow transition-colors ${
                                        isFixing || isScanning || isRunning
                                            ? 'bg-gray-400 cursor-not-allowed'
                                            : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                                >
                                    Initialize Counter Only
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400 h-96 overflow-y-auto">
                        {log.length === 0 ? (
                            <div className="text-gray-500 italic">Ready to start...</div>
                        ) : (
                            log.map((line, i) => (
                                <div key={i} className="mb-1">{line}</div>
                            ))
                        )}
                        <div style={{ float: "left", clear: "both" }}
                            ref={(el) => { el?.scrollIntoView({ behavior: "smooth" }); }}>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Migration;
