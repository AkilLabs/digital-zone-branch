import { getDocs, getDoc, setDoc, updateDoc, Timestamp, writeBatch } from 'firebase/firestore';
import type { CollectionReference, DocumentReference } from 'firebase/firestore';
import { db } from '../config/firebase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single billing or credit-sale document involved in a duplicate group. */
interface DuplicateItem {
  docId: string;
  collection: 'billingItems' | 'creditSales';
  transactionId: string;
  createdAt: Date;
  /** Raw Firestore document data (kept for copying into new transaction summaries). */
  data: Record<string, unknown>;
}

/** Items that share the same transactionId AND the same date. */
interface DateGroup {
  /** YYYY-MM-DD */
  date: string;
  items: DuplicateItem[];
}

/** A transactionId that spans multiple distinct dates. */
export interface DuplicateGroup {
  transactionId: string;
  groups: DateGroup[];
}

export interface ScanResult {
  duplicates: DuplicateGroup[];
  duplicateCount: number;
  totalTransactions: number;
}

export interface FixResult {
  fixed: number;
  total: number;
}

type GetCollectionRef = (collectionName: string) => CollectionReference;
type GetDocRef = (collectionName: string, docId: string) => DocumentReference;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise any Firestore-compatible date value to a JS `Date`.
 * Handles Firestore Timestamps, Date objects, numeric millis, and strings.
 */
function normalizeDate(value: unknown): Date {
  if (!value) return new Date(0);

  // Firestore Timestamp (has `.toDate()`)
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate();
  }
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? new Date(0) : parsed;
  }
  return new Date(0);
}

/** Return `YYYY-MM-DD` for a given Date. */
function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build a transaction ID:
 * - GST: `NNNN/YY-YY` (old format)
 * - Non-GST: `DDMMYY/NNNN` (new format)
 *
 * @param date  The date to encode in the prefix (non-GST).
 * @param seq   The 4-digit sequence number.
 * @param isGst Whether this is a GST invoice.
 */
function buildNewTransactionId(date: Date, seq: number, isGst: boolean): string {
  const seqStr = String(seq).padStart(4, '0');
  if (isGst) {
    const month = date.getMonth();
    const startYear = month >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    const endYear = startYear + 1;
    return `${startYear}-${endYear}/${seqStr}`;
  } else {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear() % 100).padStart(2, '0');
    return `${dd}${mm}${yy}/${seqStr}`;
  }
}

/** Convert a transactionId to a Firestore-safe document ID. */
function safeDocId(transactionId: string): string {
  return transactionId.replace(/\//g, '_');
}

/**
 * Extract the sequence number from a transaction ID.
 *
 * New GST format: `YYYY-YYYY/NNNN` — sequence is after `/` (e.g. 2026-2027/0001).
 * Non-GST format: `DDMMYY/NNNN` — sequence is after `/`.
 * Old GST format: `NNNN/YY-YY` — sequence is before `/`.
 *
 * Returns `0` when the format is unrecognisable.
 */
function extractSequenceNumber(transactionId: string): number {
  const slashIdx = transactionId.indexOf('/');
  if (slashIdx <= 0) return 0;

  const prefix = transactionId.substring(0, slashIdx).trim();
  const suffix = transactionId.substring(slashIdx + 1).trim();

  // New GST format: 2026-2027/0001
  if (/^\d{4}-\d{4}$/.test(prefix)) {
    const parsed = parseInt(suffix, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  // Non-GST format: DDMMYY/NNNN — sequence after slash
  if (prefix.length === 6) {
    const parsed = parseInt(suffix, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  // Old format: NNNN/YY-YY — sequence before slash (≤ 4 chars)
  if (prefix.length <= 4) {
    const parsed = parseInt(prefix, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// 1. scanDuplicateInvoices
// ---------------------------------------------------------------------------

/**
 * Scan `billingItems` and `creditSales` for transaction IDs that span
 * multiple distinct dates — i.e. duplicate invoices.
 */
export async function scanDuplicateInvoices(
  getCollectionRef: GetCollectionRef,
  _getDocRef: GetDocRef,
): Promise<ScanResult> {
  // Fetch all documents from both collections.
  const [billingSnap, creditSnap] = await Promise.all([
    getDocs(getCollectionRef('billingItems')),
    getDocs(getCollectionRef('creditSales')),
  ]);

  // Group every item by its transactionId.
  const txMap = new Map<string, DuplicateItem[]>();

  const pushItem = (
    docId: string,
    data: Record<string, unknown>,
    col: 'billingItems' | 'creditSales',
  ) => {
    const txId = data.transactionId as string | undefined;
    if (!txId) return; // skip items without a transactionId
    const createdAt = normalizeDate(data.createdAt);
    const item: DuplicateItem = { docId, collection: col, transactionId: txId, createdAt, data };
    const arr = txMap.get(txId);
    if (arr) {
      arr.push(item);
    } else {
      txMap.set(txId, [item]);
    }
  };

  billingSnap.forEach((doc) => pushItem(doc.id, doc.data() as Record<string, unknown>, 'billingItems'));
  creditSnap.forEach((doc) => pushItem(doc.id, doc.data() as Record<string, unknown>, 'creditSales'));

  // Build duplicate groups: a transactionId is "duplicate" when its items
  // span more than one distinct date (YYYY-MM-DD).
  const duplicates: DuplicateGroup[] = [];

  for (const [txId, items] of txMap.entries()) {
    const dateMap = new Map<string, DuplicateItem[]>();
    for (const item of items) {
      const key = toDateKey(item.createdAt);
      const arr = dateMap.get(key);
      if (arr) {
        arr.push(item);
      } else {
        dateMap.set(key, [item]);
      }
    }

    if (dateMap.size > 1) {
      const groups: DateGroup[] = [];
      for (const [date, dateItems] of dateMap.entries()) {
        groups.push({ date, items: dateItems });
      }
      // Sort groups chronologically (earliest first).
      groups.sort((a, b) => a.date.localeCompare(b.date));
      duplicates.push({ transactionId: txId, groups });
    }
  }

  return {
    duplicates,
    duplicateCount: duplicates.length,
    totalTransactions: txMap.size,
  };
}

// ---------------------------------------------------------------------------
// 2. fixDuplicateInvoices
// ---------------------------------------------------------------------------

/**
 * Fix all duplicate invoices by assigning new transaction IDs to later-dated
 * groups and updating Firestore accordingly.
 */
export async function fixDuplicateInvoices(
  getCollectionRef: GetCollectionRef,
  getDocRef: GetDocRef,
  onProgress: (message: string) => void,
): Promise<FixResult> {
  onProgress('Scanning for duplicate invoices…');

  const { duplicates, duplicateCount } = await scanDuplicateInvoices(getCollectionRef, getDocRef);

  if (duplicateCount === 0) {
    onProgress('No duplicate invoices found. Everything looks good!');
    return { fixed: 0, total: 0 };
  }

  onProgress(`Found ${duplicateCount} duplicate transaction(s). Starting fix…`);

  // Determine current max sequences for both formats
  let { maxNormal, maxGst } = await findMaxSequenceNumbers(getCollectionRef);
  onProgress(`Current max sequence numbers: Non-GST (Normal)=${maxNormal}, GST=${maxGst}`);

  let fixedCount = 0;

  for (let dupIdx = 0; dupIdx < duplicates.length; dupIdx++) {
    const dup = duplicates[dupIdx];
    onProgress(
      `Processing duplicate ${dupIdx + 1}/${duplicateCount}: transactionId="${dup.transactionId}" with ${dup.groups.length} date groups`,
    );

    // The earliest group keeps the original transactionId.
    const [earliestGroup, ...laterGroups] = dup.groups;
    onProgress(`  Keeping original ID for earliest date: ${earliestGroup.date} (${earliestGroup.items.length} items)`);

    // Fetch the existing transaction summary for the original transactionId.
    const originalSafeId = safeDocId(dup.transactionId);
    let originalTxData: Record<string, unknown> | null = null;
    try {
      const txSnap = await getDoc(getDocRef('transactions', originalSafeId));
      if (txSnap.exists()) {
        originalTxData = txSnap.data() as Record<string, unknown>;
      }
    } catch (err) {
      onProgress(`  ⚠ Could not fetch original transaction summary: ${err}`);
    }

    const isGst = Boolean(originalTxData?.gstEnabled) || earliestGroup.items.some(item => Boolean(item.data?.gstEnabled));

    // Process each later-dated group.
    for (const group of laterGroups) {
      let currentSeq = 0;
      if (isGst) {
        maxGst++;
        currentSeq = maxGst;
      } else {
        maxNormal++;
        currentSeq = maxNormal;
      }

      const representativeDate = group.items[0].createdAt;
      const newTxId = buildNewTransactionId(representativeDate, currentSeq, isGst);
      const newSafeId = safeDocId(newTxId);

      onProgress(`  Reassigning ${group.items.length} item(s) on ${group.date} → "${newTxId}" (${isGst ? 'GST' : 'Non-GST'})`);

      // --- Batch-update all billing/credit docs in this group ---------------
      const itemsToUpdate = [...group.items];
      // Process in batches of 500 (Firestore limit).
      for (let batchStart = 0; batchStart < itemsToUpdate.length; batchStart += 500) {
        const batchSlice = itemsToUpdate.slice(batchStart, batchStart + 500);
        const batch = writeBatch(db);
        for (const item of batchSlice) {
          const docRef = getDocRef(item.collection, item.docId);
          batch.update(docRef, { transactionId: newTxId });
        }
        await batch.commit();
      }

      // --- Create a new transaction summary for the new ID ------------------
      try {
        const newTxSummary: Record<string, unknown> = {
          ...(originalTxData ?? {}),
          transactionId: newTxId,
          itemsCount: group.items.length,
          createdAt: Timestamp.fromDate(representativeDate),
          gstEnabled: isGst,
          _migratedFrom: dup.transactionId,
          _migratedAt: Timestamp.now(),
        };
        await setDoc(getDocRef('transactions', newSafeId), newTxSummary);
        onProgress(`  ✓ Created transaction summary for "${newTxId}"`);
      } catch (err) {
        onProgress(`  ⚠ Failed to create transaction summary for "${newTxId}": ${err}`);
      }

      fixedCount++;
    }

    // --- Update the original transaction summary to reflect only the earliest group ---
    if (originalTxData) {
      try {
        await updateDoc(getDocRef('transactions', originalSafeId), {
          itemsCount: earliestGroup.items.length,
          _fixedDuplicatesAt: Timestamp.now(),
        });
        onProgress(`  ✓ Updated original transaction summary for "${dup.transactionId}"`);
      } catch (err) {
        onProgress(`  ⚠ Failed to update original transaction summary: ${err}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Initialise / update the invoice counter so future invoices continue from
  // the correct sequence.
  // -----------------------------------------------------------------------
  onProgress('Updating invoice counter…');
  try {
    await setDoc(getDocRef('counters', 'invoiceCounter'), {
      nextInvoiceNumber: maxNormal + 1,
      nextGstInvoiceNumber: maxGst + 1,
      lastUpdated: Timestamp.now(),
    });
    onProgress(`✓ Invoice counter set to nextInvoiceNumber=${maxNormal + 1}, nextGstInvoiceNumber=${maxGst + 1}`);
  } catch (err) {
    onProgress(`⚠ Failed to update invoice counter: ${err}`);
  }

  onProgress(`Done! Fixed ${fixedCount} duplicate group(s) out of ${duplicateCount} total.`);
  return { fixed: fixedCount, total: duplicateCount };
}

// ---------------------------------------------------------------------------
// 3. initializeInvoiceCounter
// ---------------------------------------------------------------------------

/**
 * Scan all existing transactions and set the `counters/invoiceCounter`
 * document to the correct next sequence numbers.
 */
export async function initializeInvoiceCounter(
  getCollectionRef: GetCollectionRef,
  getDocRef: GetDocRef,
): Promise<{ nextInvoiceNumber: number; nextGstInvoiceNumber: number }> {
  const { maxNormal, maxGst } = await findMaxSequenceNumbers(getCollectionRef);
  const nextNormal = maxNormal + 1;
  const nextGst = maxGst + 1;

  await setDoc(getDocRef('counters', 'invoiceCounter'), {
    nextInvoiceNumber: nextNormal,
    nextGstInvoiceNumber: nextGst,
    lastUpdated: Timestamp.now(),
  });

  return { nextInvoiceNumber: nextNormal, nextGstInvoiceNumber: nextGst };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk every document in the `transactions` collection and return the highest
 * sequence numbers found for GST and Non-GST formats.
 */
async function findMaxSequenceNumbers(
  getCollectionRef: GetCollectionRef,
): Promise<{ maxNormal: number; maxGst: number }> {
  const txSnap = await getDocs(getCollectionRef('transactions'));
  let maxNormal = 0;
  let maxGst = 0;

  txSnap.forEach((doc) => {
    const data = doc.data();
    const txId = (data.transactionId as string) || doc.id.replace(/_/g, '/');
    const isGst = Boolean(data.gstEnabled);
    const seq = extractSequenceNumber(txId);

    if (isGst) {
      if (seq > maxGst) maxGst = seq;
    } else {
      if (seq > maxNormal) maxNormal = seq;
    }
  });

  return { maxNormal, maxGst };
}
