import { collection, getDocs } from 'firebase/firestore';
import type { CollectionReference, DocumentData } from 'firebase/firestore';
import { db } from '../config/firebase';
import { syncStoreProducts } from './productSyncCache';

export const IMEI_PRODUCT_CODE_START = 10000001;
export const NON_IMEI_PRODUCT_CODE_START = 1;

/**
 * Validate if a product code is in correct format (8 digits)
 */
export const isValidProductCode = (code: string): boolean => {
  return /^\d{8}$/.test(code);
};

/**
 * Check if a product code belongs to the IMEI range (>= 10000001)
 */
export const isIMEIProductCode = (code: string): boolean => {
  if (!isValidProductCode(code)) return false;
  const num = parseInt(code, 10);
  return !Number.isNaN(num) && num >= IMEI_PRODUCT_CODE_START;
};

/**
 * Check if a product code belongs to the Non-IMEI range (< 10000001)
 */
export const isNonIMEIProductCode = (code: string): boolean => {
  if (!isValidProductCode(code)) return false;
  const num = parseInt(code, 10);
  return !Number.isNaN(num) && num < IMEI_PRODUCT_CODE_START;
};

/**
 * Generate a unique sequential 8-digit product code.
 * - Non-IMEI products (isIMEI = false): Format 00000001, 00000002, ... (always < 10000001).
 *   Ignores any codes >= 10000001 so non-IMEI sequence is never affected by IMEI products.
 * - IMEI products (isIMEI = true): Format 10000001, 10000002, ... (starts at 10000001).
 */
export const generateProductCode = async (
  productsCollectionRef: CollectionReference<DocumentData> = collection(db, 'products'),
  isIMEI: boolean = false
): Promise<string> => {
  try {
    const storeId = productsCollectionRef.parent?.id || null;
    const cachedProducts = await syncStoreProducts(storeId);
    let highestCodeNumber = 0;

    if (isIMEI) {
      // Baseline for IMEI is 10000000, so the first generated code will be 10000001
      highestCodeNumber = IMEI_PRODUCT_CODE_START - 1;

      // 1. Scan local delta-synced products catalog for existing IMEI product codes (>= 10000001)
      cachedProducts.forEach((product) => {
        const code = product.productCode;
        if (!code || !isValidProductCode(code)) return;

        const codeNumber = parseInt(code, 10);
        if (!Number.isNaN(codeNumber) && codeNumber >= IMEI_PRODUCT_CODE_START && codeNumber > highestCodeNumber) {
          highestCodeNumber = codeNumber;
        }
      });

      // 2. Also check imeiPurchases collection to prevent collisions even if product doc was removed
      try {
        const imeiPurchasesRef = productsCollectionRef.parent
          ? collection(productsCollectionRef.parent, 'imeiPurchases')
          : collection(db, 'imeiPurchases');
        const imeiPurchasesSnap = await getDocs(imeiPurchasesRef);
        imeiPurchasesSnap.docs.forEach((docSnapshot) => {
          const items = docSnapshot.data().items;
          if (Array.isArray(items)) {
            items.forEach((it: any) => {
              if (it && it.productCode && isValidProductCode(it.productCode)) {
                const num = parseInt(it.productCode, 10);
                if (!Number.isNaN(num) && num >= IMEI_PRODUCT_CODE_START && num > highestCodeNumber) {
                  highestCodeNumber = num;
                }
              }
            });
          }
        });
      } catch {
        // Non-blocking fallback if imeiPurchases is unavailable
      }

      const nextNumber = highestCodeNumber + 1;
      if (nextNumber > 99999999) {
        throw new Error('IMEI Product code limit reached');
      }

      return nextNumber.toString().padStart(8, '0');
    } else {
      // Non-IMEI: strictly scan codes < 10000001 (excluding IMEI range >= 10000001)
      cachedProducts.forEach((product) => {
        const code = product.productCode;
        if (!code || !isValidProductCode(code)) return;

        const codeNumber = parseInt(code, 10);
        if (!Number.isNaN(codeNumber) && codeNumber < IMEI_PRODUCT_CODE_START && codeNumber > highestCodeNumber) {
          highestCodeNumber = codeNumber;
        }
      });

      const nextNumber = highestCodeNumber + 1;
      if (nextNumber >= IMEI_PRODUCT_CODE_START) {
        throw new Error('Non-IMEI Product code limit reached');
      }

      return nextNumber.toString().padStart(8, '0');
    }
  } catch (error) {
    console.error('Error generating product code:', error);
    if (isIMEI) {
      // Fallback in the 10000000 range
      const timestamp = (10000000 + (Date.now() % 9000000)).toString();
      return timestamp.padStart(8, '0');
    }
    const timestamp = Date.now().toString().slice(-8);
    return timestamp.padStart(8, '0');
  }
};

/**
 * Generate a unique sequential 8-digit product code specifically for IMEI products starting from 10000001.
 */
export const generateIMEIProductCode = async (
  productsCollectionRef: CollectionReference<DocumentData> = collection(db, 'products')
): Promise<string> => {
  return generateProductCode(productsCollectionRef, true);
};
