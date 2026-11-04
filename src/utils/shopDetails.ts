import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { ShopDetails, Store } from '../types';

/**
 * Build branch ShopDetails directly from the already-loaded store document
 * (stores/{storeId}) — 0 extra Firestore reads.
 */
export const shopDetailsFromStore = (store: Store): ShopDetails => ({
  shopName: store.name || '',
  ownerName: store.ownerName || store.managerName || '',
  address: store.address || '',
  phone: store.phone || '',
  email: store.email || '',
  gst: store.gst || '',
  description: store.description || '',
  latitude: store.latitude,
  longitude: store.longitude,
  upiId: store.upiId || '',
  merchantName: store.merchantName || store.name || '',
});

/**
 * Resolve ShopDetails for the active branch.
 * - If a branch (currentStore) is selected → built from stores/{storeId} (0 reads).
 * - Otherwise (HO warehouse / no store) → falls back to the global settings/shopDetails doc.
 */
export const resolveShopDetails = async (store: Store | null | undefined): Promise<ShopDetails | null> => {
  if (store?.id) {
    return shopDetailsFromStore(store);
  }
  try {
    const snap = await getDoc(doc(db, 'settings', 'shopDetails'));
    return snap.exists() ? (snap.data() as ShopDetails) : null;
  } catch (error) {
    console.error('Error fetching global shop details:', error);
    return null;
  }
};
