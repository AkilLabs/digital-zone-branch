/**
 * Firestore helper utilities for the stores-first architecture.
 *
 * New flat structure:
 *   stores/{storeId}/{collectionName}        — store-level data
 *   stores/{storeId}/{collectionName}/{docId} — store-level doc
 *   hubs/{hubId}                              — hub metadata only (no subcollections)
 */
import { collection, doc, CollectionReference, DocumentReference } from 'firebase/firestore';
import { db } from '../config/firebase';

// ─────────────────────────────────────────────
//  Shared root collections (HO + all branches)
// ─────────────────────────────────────────────

/**
 * Collections shared between the Head Office app and every Branch app.
 * These always live at the Firestore root, regardless of the current store.
 * High-volume operational data (products, billingItems, creditSales, expenses,
 * attendance, serviceRequests, purchases, ...) stays under stores/{storeId}/.
 */
export const SHARED_ROOT_COLLECTIONS = [
  'users',
  'customers',
  'creditCustomers',
  'brands',
  'categories',
  'financeProviders',
  'suppliers',
  'rechargeProviders',
  'stores',
  'hubs',
  'overallSales',
  'stockTransfers',
] as const;

const SHARED_ROOT_SET = new Set<string>(SHARED_ROOT_COLLECTIONS);

/** Whether a collection is shared at the Firestore root. */
export const isSharedRootCollection = (collectionName: string): boolean =>
  SHARED_ROOT_SET.has(collectionName);

// ─────────────────────────────────────────────
//  Store-scoped helpers  (primary data path)
// ─────────────────────────────────────────────

/**
 * Get a Firestore collection reference scoped to a specific store.
 * Path: stores/{storeId}/{collectionName}
 * Shared collections (see SHARED_ROOT_COLLECTIONS) resolve to the root: {collectionName}
 */
export const getStoreCollectionRef = (
  _hubId: string,          // kept for API compatibility – no longer used in path
  storeId: string,
  collectionName: string
): CollectionReference => {
  if (SHARED_ROOT_SET.has(collectionName)) {
    return collection(db, collectionName);
  }
  return collection(db, 'stores', storeId, collectionName);
};

/**
 * Get a Firestore document reference scoped to a specific store.
 * Path: stores/{storeId}/{collectionName}/{docId}
 * Shared collections (see SHARED_ROOT_COLLECTIONS) resolve to the root: {collectionName}/{docId}
 */
export const getStoreDocRef = (
  _hubId: string,          // kept for API compatibility – no longer used in path
  storeId: string,
  collectionName: string,
  docId: string
): DocumentReference => {
  if (SHARED_ROOT_SET.has(collectionName)) {
    return doc(db, collectionName, docId);
  }
  return doc(db, 'stores', storeId, collectionName, docId);
};

// ─────────────────────────────────────────────
//  Hub-scoped helpers  (metadata only)
// ─────────────────────────────────────────────

/**
 * Get a Firestore collection reference scoped to a hub.
 * Hub-level collections are rare; prefer store-level data.
 * Path: hubs/{hubId}/{collectionName}
 */
export const getHubCollectionRef = (
  hubId: string,
  collectionName: string
): CollectionReference => {
  return collection(db, 'hubs', hubId, collectionName);
};

/**
 * Get a Firestore document reference scoped to a hub.
 * Path: hubs/{hubId}/{collectionName}/{docId}
 */
export const getHubDocRef = (
  hubId: string,
  collectionName: string,
  docId: string
): DocumentReference => {
  return doc(db, 'hubs', hubId, collectionName, docId);
};

// ─────────────────────────────────────────────
//  Top-level document helpers
// ─────────────────────────────────────────────

/**
 * Get the hub document reference.
 * Path: hubs/{hubId}
 */
export const getHubRef = (hubId: string): DocumentReference =>
  doc(db, 'hubs', hubId);

/**
 * Get the store document reference.
 * Path: stores/{storeId}
 */
export const getStoreRef = (_hubId: string, storeId: string): DocumentReference =>
  doc(db, 'stores', storeId);

/**
 * Get the root stores collection reference (all stores in the app).
 * Path: stores
 */
export const getStoresCollectionRef = (_hubId?: string): CollectionReference =>
  collection(db, 'stores');

// ─────────────────────────────────────────────
//  Collection name registries
// ─────────────────────────────────────────────

/**
 * Collections that live under stores/{storeId}/
 */
export const STORE_COLLECTIONS = [
  'products',
  'billingItems',
  'expenses',
  'expensePresets',
  'creditSales',
  'stockRequirements',
  'serviceRequests',
  'attendance',
  'rechargeTransactions',
  'providerTransactions',
  'purchases',
  'imeiPurchases',
  'supplierPayments',
  'creditClearances',
  'transactions',
  'paymentRequests',
  'razorpayQRCodes',
  'notifications',
  'defectProducts',
  'settings',
] as const;

/**
 * Collections that used to live under stores/{storeId}/ but are now shared at the root.
 * Used by the one-time migration utility (Migration page) to copy legacy data.
 */
export const LEGACY_STORE_SCOPED_SHARED_COLLECTIONS = [
  'customers',
  'creditCustomers',
  'suppliers',
  'rechargeProviders',
  'stockTransfers',
  'users',
  'brands',
  'categories',
] as const;

/**
 * Collections that exist only at the hub metadata level.
 * In practice these are effectively empty – all data lives in stores.
 */
export const HUB_COLLECTIONS = [] as const;
