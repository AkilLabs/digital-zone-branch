import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import type { Product } from "../types";

const DB_NAME = "tallyon_pos_cache";
const STORE_NAME = "branch_products";
const ROOT_CACHE_KEY = "root_warehouse";

function resolveCacheKey(storeId?: string | null): string {
  if (!storeId || storeId === "hub_warehouse") {
    return ROOT_CACHE_KEY;
  }
  return storeId;
}

function toValidDate(val: any, fallback?: Date): Date {
  if (!val) return fallback || new Date();
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? fallback || new Date() : val;
  }
  if (typeof val?.toDate === "function") {
    const d = val.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : fallback || new Date();
  }
  if (typeof val === "object" && typeof val.seconds === "number") {
    return new Date(val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6));
  }
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? fallback || new Date() : parsed;
}

function toNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeProductRecord(id: string, data: any): Product {
  const createdAt = toValidDate(data.createdAt);
  const updatedAt = data.updatedAt ? toValidDate(data.updatedAt, createdAt) : createdAt;
  const quantity = toNumber(data.quantity, 0);
  const gstEnabled = Boolean(data.gstEnabled);

  return {
    ...data,
    id,
    name: data.name || "",
    model: data.model || "",
    brand: data.brand || "",
    category: data.category || "",
    cost: toNumber(data.cost, 0),
    baseCost: data.baseCost !== undefined ? toNumber(data.baseCost, 0) : undefined,
    mrp: toNumber(data.mrp, 0),
    quantity,
    productCode: data.productCode || "",
    imei: data.imei || "",
    paymentType: data.paymentType || "cash",
    suitableModels: Array.isArray(data.suitableModels) ? data.suitableModels : [],
    hcsCode: data.hcsCode || data.hsnCode || "",
    mop: toNumber(data.mop, 0),
    supplier: data.supplier || "",
    taxPercent: data.taxPercent !== undefined ? toNumber(data.taxPercent, 0) : gstEnabled ? 18 : 0,
    gstEnabled,
    isAvailable: data.isAvailable !== undefined ? Boolean(data.isAvailable) : quantity > 0,
    createdAt,
    updatedAt,
    createdBy: data.createdBy || "",
    createdByName: data.createdByName || "",
    imageUrl: data.imageUrl || "",
  } as Product;
}

function openLocalDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readLocalCatalog(storeId?: string | null): Promise<{
  lastSyncMs: number;
  productMap: Record<string, Product>;
}> {
  const key = resolveCacheKey(storeId);
  try {
    const idb = await openLocalDB();
    return await new Promise((resolve) => {
      const tx = idb.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const res = req.result;
        if (!res || !res.productMap) {
          resolve({ lastSyncMs: 0, productMap: {} });
          return;
        }
        const rawMap = res.productMap as Record<string, Product>;
        const normalizedMap: Record<string, Product> = {};
        for (const [docId, prod] of Object.entries(rawMap)) {
          normalizedMap[docId] = normalizeProductRecord(docId, prod);
        }
        resolve({
          lastSyncMs: Number(res.lastSyncMs) || 0,
          productMap: normalizedMap,
        });
      };
      req.onerror = () => resolve({ lastSyncMs: 0, productMap: {} });
    });
  } catch {
    return { lastSyncMs: 0, productMap: {} };
  }
}

async function writeLocalCatalog(
  storeId: string | undefined | null,
  lastSyncMs: number,
  productMap: Record<string, Product>
): Promise<void> {
  const key = resolveCacheKey(storeId);
  try {
    const idb = await openLocalDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ lastSyncMs, productMap }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("IndexedDB writeLocalCatalog failed:", err);
  }
}

/**
 * Syncs only changed products since lastSyncMs for a given storeId.
 * - First load: reads 2,000 products once and stores them in IndexedDB.
 * - Subsequent loads/searches: reads ONLY products modified since lastSyncMs (0-5 reads).
 */
export async function syncStoreProducts(
  storeId?: string | null,
  forceFullSync: boolean = false
): Promise<Product[]> {
  const { lastSyncMs, productMap } = await readLocalCatalog(storeId);
  const isStoreScoped = Boolean(storeId && storeId !== "hub_warehouse");
  const productsRef = isStoreScoped
    ? collection(db, "stores", storeId!, "products")
    : collection(db, "products");

  const hasLocalCatalog = !forceFullSync && lastSyncMs > 0 && Object.keys(productMap).length > 0;
  const syncStartMs = Date.now();

  const q = hasLocalCatalog
    ? query(
        productsRef,
        where("updatedAt", ">", Timestamp.fromMillis(lastSyncMs))
      )
    : productsRef;

  const snapshot = await getDocs(q);

  if (!hasLocalCatalog) {
    // Full sync: rebuild map cleanly so deleted items from other sessions are also cleared
    const freshMap: Record<string, Product> = {};
    snapshot.docs.forEach((docSnap) => {
      freshMap[docSnap.id] = normalizeProductRecord(docSnap.id, docSnap.data());
    });
    await writeLocalCatalog(storeId, syncStartMs, freshMap);
    return Object.values(freshMap);
  }

  if (!snapshot.empty) {
    snapshot.docs.forEach((docSnap) => {
      productMap[docSnap.id] = normalizeProductRecord(docSnap.id, docSnap.data());
    });
    await writeLocalCatalog(storeId, syncStartMs, productMap);
  } else {
    // Advance lastSyncMs so future delta queries stay narrow
    await writeLocalCatalog(storeId, syncStartMs, productMap);
  }

  return Object.values(productMap);
}

/**
 * Optimistically updates local IndexedDB cache immediately after billing or stock edit
 * so the UI updates with 0 extra Firestore reads.
 */
export async function updateLocalProductQuantities(
  storeId: string | undefined | null,
  changes: { productId: string; quantityDelta: number }[]
): Promise<void> {
  if (!changes.length) return;
  const { lastSyncMs, productMap } = await readLocalCatalog(storeId);
  const now = new Date();
  for (const change of changes) {
    if (productMap[change.productId]) {
      const nextQty =
        (Number(productMap[change.productId].quantity) || 0) +
        change.quantityDelta;
      productMap[change.productId].quantity = nextQty;
      productMap[change.productId].isAvailable = nextQty > 0;
      productMap[change.productId].updatedAt = now;
    }
  }
  await writeLocalCatalog(storeId, lastSyncMs || Date.now(), productMap);
}

/**
 * Inserts or updates products in the local IndexedDB catalog immediately after create/edit
 * so local views reflect the change with 0 extra Firestore reads.
 */
export async function upsertLocalProducts(
  storeId: string | undefined | null,
  products: Array<Partial<Product> & { id: string }>
): Promise<void> {
  if (!products.length) return;
  const { lastSyncMs, productMap } = await readLocalCatalog(storeId);
  for (const p of products) {
    if (!p.id) continue;
    const existing = productMap[p.id] || {};
    productMap[p.id] = normalizeProductRecord(p.id, {
      ...existing,
      ...p,
      updatedAt: p.updatedAt || new Date(),
    });
  }
  await writeLocalCatalog(storeId, lastSyncMs || Date.now(), productMap);
}

/**
 * Removes deleted product IDs from the local IndexedDB catalog immediately.
 */
export async function removeLocalProducts(
  storeId: string | undefined | null,
  productIds: string[]
): Promise<void> {
  if (!productIds.length) return;
  const { lastSyncMs, productMap } = await readLocalCatalog(storeId);
  for (const id of productIds) {
    delete productMap[id];
  }
  await writeLocalCatalog(storeId, lastSyncMs || Date.now(), productMap);
}

/**
 * Returns the locally cached product catalog for a store straight from IndexedDB.
 * Performs 0 Firestore reads — used to refresh React Query after local mutations
 * (billing, stock edits, transfers) without a redundant network round-trip.
 */
export async function getCachedStoreProductsOnly(storeId?: string | null): Promise<Product[]> {
  const { productMap } = await readLocalCatalog(storeId);
  return Object.values(productMap);
}
