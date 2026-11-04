import {
  collection,
  getDocs,
  setDoc,
  doc,
  writeBatch,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { STORE_COLLECTIONS } from './firestore';

export interface CollectionScanResult {
  collectionName: string;
  rootCount: number;
  storeCount: number;
  status: 'empty' | 'ready' | 'synced' | 'diverged';
}

const toDateKey = (val: any): string => {
  if (!val) return new Date().toISOString().split('T')[0];
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val?.toDate === 'function') {
    try {
      return val.toDate().toISOString().split('T')[0];
    } catch {
      // fallback
    }
  }
  if (typeof val === 'string') {
    return val.includes('T') ? val.split('T')[0] : val.substring(0, 10);
  }
  if (typeof val === 'number') {
    return new Date(val).toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
};

const getItemRevenue = (item: any): number => {
  if (item.totalWithGst !== undefined && !isNaN(Number(item.totalWithGst))) {
    return Number(item.totalWithGst) || 0;
  }
  if (item.grandTotal !== undefined && !isNaN(Number(item.grandTotal))) {
    return Number(item.grandTotal) || 0;
  }
  const qty = Number(item.quantity) || 1;
  const price = Number(item.sellingPrice ?? item.price ?? 0);
  const discount = Number(item.itemDiscount ?? item.discountAmount ?? 0);
  return Math.max(0, price * qty - discount);
};

/**
 * Scan document counts in root collections vs the target store's subcollections.
 */
export const scanStoreMigrationCounts = async (
  targetStoreId: string
): Promise<CollectionScanResult[]> => {
  const results: CollectionScanResult[] = [];

  for (const collectionName of STORE_COLLECTIONS) {
    if (['settings', 'users'].includes(collectionName)) continue;

    let rootCount = 0;
    let storeCount = 0;

    try {
      const rootSnap = await getDocs(collection(db, collectionName));
      rootCount = rootSnap.size;
    } catch (err) {
      console.warn(`Could not count root collection ${collectionName}:`, err);
    }

    if (targetStoreId) {
      try {
        const storeSnap = await getDocs(
          collection(db, 'stores', targetStoreId, collectionName)
        );
        storeCount = storeSnap.size;
      } catch (err) {
        console.warn(
          `Could not count store subcollection stores/${targetStoreId}/${collectionName}:`,
          err
        );
      }
    }

    let status: CollectionScanResult['status'] = 'empty';
    if (rootCount === 0 && storeCount === 0) {
      status = 'empty';
    } else if (rootCount > 0 && storeCount === 0) {
      status = 'ready';
    } else if (rootCount > 0 && storeCount >= rootCount) {
      status = 'synced';
    } else if (storeCount > 0) {
      status = 'diverged';
    }

    results.push({
      collectionName,
      rootCount,
      storeCount,
      status,
    });
  }

  return results;
};

/**
 * Migrates all un-scoped root operational collections into a specific target store:
 * stores/{targetStoreId}/{collectionName}/{docId}
 *
 * Safe merge write: does not delete root documents by default, preserving backup.
 * Recalculates totalStockUnits, lifetimeRevenue, and lifetimeBills on stores/{targetStoreId}.
 * Automatically populates overallSales daily summary docs.
 */
export const migrateRootToStoreSubcollections = async (
  targetStoreId: string,
  options?: {
    deleteSource?: boolean;
    onProgress?: (msg: string) => void;
  }
) => {
  const log = options?.onProgress || console.log;
  log(`=== Starting Root Collection Migration to stores/${targetStoreId} ===`);

  try {
    // 1. Verify target store exists
    const storeRef = doc(db, 'stores', targetStoreId);
    const storeSnap = await getDoc(storeRef);
    if (!storeSnap.exists()) {
      throw new Error(`Target store stores/${targetStoreId} does not exist.`);
    }

    const storeData = storeSnap.data();
    const storeName = storeData?.name || 'Main Branch';
    log(`Target Store: "${storeName}" (${targetStoreId})`);

    let totalMigrated = 0;
    const collectionSummary: Record<string, number> = {};

    let totalStockUnits = 0;
    let lifetimeRevenue = 0;
    const uniqueInvoiceIds = new Set<string>();
    const dailySalesMap: Record<
      string,
      { totalRevenue: number; totalBills: Set<string>; totalItemsSold: number }
    > = {};

    // 2. Loop through operational collections
    for (const collectionName of STORE_COLLECTIONS) {
      if (['users'].includes(collectionName)) continue;

      // Special handling for settings
      if (collectionName === 'settings') {
        try {
          const rootShopSnap = await getDoc(doc(db, 'settings', 'shopDetails'));
          if (rootShopSnap.exists()) {
            const s = rootShopSnap.data();
            log(`  • Merging root settings/shopDetails into stores/${targetStoreId}...`);
            await setDoc(
              storeRef,
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

            // Also copy to stores/{storeId}/settings/shopDetails
            await setDoc(
              doc(db, 'stores', targetStoreId, 'settings', 'shopDetails'),
              s,
              { merge: true }
            );
            log(`  ✓ Successfully linked shopDetails.`);
          }
        } catch (setErr) {
          log(`  ! Warning migrating settings: ${setErr}`);
        }
        continue;
      }

      log(`Scanning root /${collectionName}...`);
      const rootColRef = collection(db, collectionName);
      let snapshot;
      try {
        snapshot = await getDocs(rootColRef);
      } catch (colErr) {
        log(`  ! Could not read root ${collectionName}: ${colErr}`);
        continue;
      }

      if (snapshot.empty) {
        log(`  - 0 documents in root /${collectionName}. Skipping.`);
        continue;
      }

      log(`  Found ${snapshot.size} document(s) in root /${collectionName}. Migrating...`);

      let batch = writeBatch(db);
      let opsInBatch = 0;
      let colMigratedCount = 0;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const destRef = doc(
          db,
          'stores',
          targetStoreId,
          collectionName,
          docSnap.id
        );

        // Tag document with storeId and updated timestamp
        const enriched: Record<string, any> = {
          ...data,
          storeId: targetStoreId,
          storeName: storeName,
        };

        // Compute metrics for products
        if (collectionName === 'products') {
          const qty = Number(data.quantity) || 0;
          totalStockUnits += qty;
        }

        // Compute metrics for billingItems
        if (collectionName === 'billingItems') {
          const rev = getItemRevenue(data);
          lifetimeRevenue += rev;
          const invoiceId = data.invoiceNumber || data.transactionId || docSnap.id;
          uniqueInvoiceIds.add(invoiceId);

          // Group by date for overallSales
          const dKey = toDateKey(data.createdAt);
          if (!dailySalesMap[dKey]) {
            dailySalesMap[dKey] = {
              totalRevenue: 0,
              totalBills: new Set<string>(),
              totalItemsSold: 0,
            };
          }
          dailySalesMap[dKey].totalRevenue += rev;
          dailySalesMap[dKey].totalBills.add(invoiceId);
          dailySalesMap[dKey].totalItemsSold += Number(data.quantity) || 1;
        }

        batch.set(destRef, enriched, { merge: true });
        opsInBatch++;
        colMigratedCount++;
        totalMigrated++;

        if (options?.deleteSource) {
          batch.delete(docSnap.ref);
          opsInBatch++;
        }

        if (opsInBatch >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          opsInBatch = 0;
          log(`    → Committed batch of ${colMigratedCount}/${snapshot.size} in ${collectionName}...`);
        }
      }

      if (opsInBatch > 0) {
        await batch.commit();
      }

      collectionSummary[collectionName] = colMigratedCount;
      log(`  ✓ Migrated ${colMigratedCount} doc(s) into stores/${targetStoreId}/${collectionName}`);
    }

    // 3. Write overallSales daily summaries
    const dates = Object.keys(dailySalesMap);
    if (dates.length > 0) {
      log(`Creating / Updating ${dates.length} daily summary doc(s) in root /overallSales...`);
      let osBatch = writeBatch(db);
      let osOps = 0;

      for (const dKey of dates) {
        const item = dailySalesMap[dKey];
        const osRef = doc(db, 'overallSales', `${dKey}_${targetStoreId}`);
        osBatch.set(
          osRef,
          {
            storeId: targetStoreId,
            storeName: storeName,
            date: dKey,
            totalRevenue: Math.round(item.totalRevenue),
            totalBills: item.totalBills.size,
            totalItemsSold: item.totalItemsSold,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        osOps++;

        if (osOps >= 400) {
          await osBatch.commit();
          osBatch = writeBatch(db);
          osOps = 0;
        }
      }

      if (osOps > 0) {
        await osBatch.commit();
      }
      log(`  ✓ Created overallSales daily records.`);
    }

    // 4. Update cumulative counters on stores/{targetStoreId}
    const storeLifetimeBills = Math.max(
      storeData.lifetimeBills || 0,
      uniqueInvoiceIds.size
    );
    const storeLifetimeRevenue = Math.max(
      storeData.lifetimeRevenue || 0,
      Math.round(lifetimeRevenue)
    );
    const storeTotalStockUnits =
      totalStockUnits > 0 ? totalStockUnits : storeData.totalStockUnits || 0;

    log(`Updating cumulative stats on stores/${targetStoreId}:`);
    log(`  • Stock Units: ${storeTotalStockUnits}`);
    log(`  • Lifetime Revenue: ₹${storeLifetimeRevenue.toLocaleString('en-IN')}`);
    log(`  • Lifetime Bills: ${storeLifetimeBills}`);

    await setDoc(
      storeRef,
      {
        totalStockUnits: storeTotalStockUnits,
        lifetimeRevenue: storeLifetimeRevenue,
        lifetimeBills: storeLifetimeBills,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    log(`✅ Migration to stores/${targetStoreId} completed successfully!`);
    log(`Total documents migrated: ${totalMigrated}`);

    return {
      success: true,
      totalMigrated,
      collectionSummary,
      storeId: targetStoreId,
    };
  } catch (error: any) {
    log(`❌ Migration error: ${error?.message || error}`);
    console.error('Migration failed:', error);
    return {
      success: false,
      error: error?.message || String(error),
    };
  }
};

/**
 * Rescues data from legacy nested hub subcollections:
 * hubs/{hubId}/stores/{oldStoreId}/*
 * and copies them to root stores/{targetStoreId}/*
 */
export const rescueOldNestedHubDocs = async (
  targetStoreId: string,
  onProgress?: (msg: string) => void
) => {
  const log = onProgress || console.log;
  log(`=== Scanning for Legacy Nested Hub Subcollections (hubs/.../stores) ===`);

  try {
    const hubsSnap = await getDocs(collection(db, 'hubs'));
    if (hubsSnap.empty) {
      log('No hubs found. Nothing to rescue.');
      return { success: true, totalRescued: 0 };
    }

    let totalRescued = 0;

    for (const hubDoc of hubsSnap.docs) {
      const hubId = hubDoc.id;
      log(`Checking Hub: ${hubDoc.data()?.name || hubId} (${hubId})...`);

      const nestedStoresSnap = await getDocs(
        collection(db, 'hubs', hubId, 'stores')
      );
      if (nestedStoresSnap.empty) {
        log(`  - No nested stores in hubs/${hubId}/stores.`);
        continue;
      }

      log(`  Found ${nestedStoresSnap.size} nested store(s) in hubs/${hubId}/stores.`);

      for (const nestedStoreDoc of nestedStoresSnap.docs) {
        const oldStoreId = nestedStoreDoc.id;
        const destStoreId = targetStoreId || oldStoreId;
        const oldStoreData = nestedStoreDoc.data();
        log(`  Rescuing from hubs/${hubId}/stores/${oldStoreId} -> stores/${destStoreId}...`);

        // Ensure root store document exists
        await setDoc(
          doc(db, 'stores', destStoreId),
          {
            ...oldStoreData,
            hubId: hubId,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        // Copy all operational collections
        for (const colName of STORE_COLLECTIONS) {
          if (['users', 'settings'].includes(colName)) continue;

          try {
            const nestedColSnap = await getDocs(
              collection(db, 'hubs', hubId, 'stores', oldStoreId, colName)
            );
            if (nestedColSnap.empty) continue;

            log(`    • ${colName}: found ${nestedColSnap.size} doc(s) in nested store. Copying...`);
            let batch = writeBatch(db);
            let ops = 0;

            for (const itemDoc of nestedColSnap.docs) {
              const destRef = doc(
                db,
                'stores',
                destStoreId,
                colName,
                itemDoc.id
              );
              batch.set(
                destRef,
                { ...itemDoc.data(), storeId: destStoreId },
                { merge: true }
              );
              ops++;
              totalRescued++;

              if (ops >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                ops = 0;
              }
            }

            if (ops > 0) {
              await batch.commit();
            }
            log(`    ✓ Rescued ${nestedColSnap.size} ${colName} doc(s).`);
          } catch (colErr) {
            log(`    ! Could not read nested ${colName}: ${colErr}`);
          }
        }
      }
    }

    log(`✅ Rescue complete! Rescued ${totalRescued} document(s).`);
    return { success: true, totalRescued };
  } catch (err: any) {
    log(`❌ Rescue error: ${err?.message || err}`);
    return { success: false, error: err?.message || String(err) };
  }
};

/**
 * Recalculates live metrics for a store from its subcollections:
 * - totalStockUnits from stores/{storeId}/products
 * - lifetimeRevenue & lifetimeBills from stores/{storeId}/billingItems
 * - Reconstructs / updates overallSales daily summary docs
 */
export const recomputeStoreMetrics = async (
  storeId: string,
  onProgress?: (msg: string) => void
) => {
  const log = onProgress || console.log;
  log(`Recalculating live metrics for stores/${storeId}...`);

  try {
    const storeRef = doc(db, 'stores', storeId);
    const storeSnap = await getDoc(storeRef);
    if (!storeSnap.exists()) {
      throw new Error(`Store stores/${storeId} does not exist.`);
    }

    const storeData = storeSnap.data();
    const storeName = storeData?.name || 'Branch';

    // 1. Calculate stock units
    let totalStockUnits = 0;
    const prodSnap = await getDocs(collection(db, 'stores', storeId, 'products'));
    prodSnap.docs.forEach((d) => {
      totalStockUnits += Number(d.data().quantity) || 0;
    });
    log(`  • Counted ${prodSnap.size} products, ${totalStockUnits} stock units.`);

    // 2. Calculate sales & daily breakdown
    let lifetimeRevenue = 0;
    const uniqueInvoiceIds = new Set<string>();
    const dailySalesMap: Record<
      string,
      { totalRevenue: number; totalBills: Set<string>; totalItemsSold: number }
    > = {};

    const billSnap = await getDocs(
      collection(db, 'stores', storeId, 'billingItems')
    );
    billSnap.docs.forEach((d) => {
      const data = d.data();
      const rev = getItemRevenue(data);
      lifetimeRevenue += rev;
      const invoiceId = data.invoiceNumber || data.transactionId || d.id;
      uniqueInvoiceIds.add(invoiceId);

      const dKey = toDateKey(data.createdAt);
      if (!dailySalesMap[dKey]) {
        dailySalesMap[dKey] = {
          totalRevenue: 0,
          totalBills: new Set<string>(),
          totalItemsSold: 0,
        };
      }
      dailySalesMap[dKey].totalRevenue += rev;
      dailySalesMap[dKey].totalBills.add(invoiceId);
      dailySalesMap[dKey].totalItemsSold += Number(data.quantity) || 1;
    });

    log(
      `  • Counted ${billSnap.size} billing items across ${uniqueInvoiceIds.size} invoices (Total: ₹${Math.round(
        lifetimeRevenue
      ).toLocaleString('en-IN')}).`
    );

    // 3. Update overallSales daily docs
    const dates = Object.keys(dailySalesMap);
    if (dates.length > 0) {
      log(`  • Updating ${dates.length} overallSales records...`);
      let osBatch = writeBatch(db);
      let osOps = 0;

      for (const dKey of dates) {
        const item = dailySalesMap[dKey];
        const osRef = doc(db, 'overallSales', `${dKey}_${storeId}`);
        osBatch.set(
          osRef,
          {
            storeId,
            storeName,
            date: dKey,
            totalRevenue: Math.round(item.totalRevenue),
            totalBills: item.totalBills.size,
            totalItemsSold: item.totalItemsSold,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        osOps++;

        if (osOps >= 400) {
          await osBatch.commit();
          osBatch = writeBatch(db);
          osOps = 0;
        }
      }

      if (osOps > 0) {
        await osBatch.commit();
      }
    }

    // 4. Update stores/{storeId}
    await setDoc(
      storeRef,
      {
        totalStockUnits,
        lifetimeRevenue: Math.round(lifetimeRevenue),
        lifetimeBills: uniqueInvoiceIds.size,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    log(`✅ Successfully recomputed metrics for ${storeName}!`);
    return {
      success: true,
      totalStockUnits,
      lifetimeRevenue: Math.round(lifetimeRevenue),
      lifetimeBills: uniqueInvoiceIds.size,
      dailyRecordsCount: dates.length,
    };
  } catch (err: any) {
    log(`❌ Error recomputing metrics: ${err?.message || err}`);
    return { success: false, error: err?.message || String(err) };
  }
};

/**
 * Migration script to initialize the Hub/Store architecture (stores-first schema).
 * 1. Creates/Updates root 'hubs/{hubId}'
 * 2. Creates/Updates root 'stores/{storeId}'
 * 3. Updates Owner User object with hubId and role: 'owner', scope: 'hub'
 * 4. Migrates root operational collections to stores/{storeId}/*
 * 5. Updates other employees with hubId and storeId
 */
export const migrateToHubArchitecture = async (
  ownerUid: string,
  hubName: string,
  storeName: string,
  onProgress?: (msg: string) => void
) => {
  const log = onProgress || console.log;
  try {
    log('Starting migration to stores-first architecture...');

    // 1. Create a new Hub in root hubs collection
    const hubRef = doc(collection(db, 'hubs'));
    await setDoc(hubRef, {
      name: hubName,
      ownerName: 'Admin',
      isActive: true,
      createdAt: serverTimestamp(),
      createdBy: ownerUid,
      updatedAt: serverTimestamp(),
    });
    log(`Created Hub: ${hubRef.id} (${hubName})`);

    // 2. Create the primary Store in the root stores collection
    const storeRef = doc(collection(db, 'stores'));
    await setDoc(storeRef, {
      hubId: hubRef.id,
      name: storeName,
      isActive: true,
      createdAt: serverTimestamp(),
      createdBy: ownerUid,
      updatedAt: serverTimestamp(),
      lifetimeRevenue: 0,
      lifetimeBills: 0,
      totalStockUnits: 0,
    });
    log(`Created Primary Store: ${storeRef.id} (${storeName})`);

    // 3. Update the Owner User object at root users/{ownerUid}
    const userRef = doc(db, 'users', ownerUid);
    await setDoc(
      userRef,
      {
        hubId: hubRef.id,
        role: 'owner',
        scope: 'hub',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    log('Updated owner user account in root /users');

    // 4. Migrate root operational collections to stores/{storeId}/*
    log('Migrating root operational collections to the new store...');
    const migrationResult = await migrateRootToStoreSubcollections(storeRef.id, {
      onProgress: log,
    });

    // 5. Update other users
    log('Linking existing users to the new Hub...');
    const usersSnap = await getDocs(collection(db, 'users'));
    let userBatch = writeBatch(db);
    let userOps = 0;

    for (const uDoc of usersSnap.docs) {
      if (uDoc.id === ownerUid) continue;

      const uData = uDoc.data();
      const updatedUser: Record<string, any> = {
        ...uData,
        hubId: hubRef.id,
      };

      if (uData.role === 'admin' || uData.role === 'owner') {
        updatedUser.role = 'hub-admin';
        updatedUser.scope = 'hub';
      } else {
        updatedUser.storeId = storeRef.id;
        updatedUser.scope = 'store';
      }

      userBatch.set(uDoc.ref, updatedUser, { merge: true });
      userOps++;

      if (userOps >= 400) {
        await userBatch.commit();
        userBatch = writeBatch(db);
        userOps = 0;
      }
    }

    if (userOps > 0) {
      await userBatch.commit();
    }
    log('Linked users to Hub & Store successfully.');

    log('=== Architecture Initialization Complete ===');
    return {
      success: true,
      hubId: hubRef.id,
      storeId: storeRef.id,
      totalMigrated: migrationResult.totalMigrated,
    };
  } catch (error: any) {
    log(`❌ Architecture initialization failed: ${error?.message || error}`);
    console.error('Architecture initialization failed:', error);
    return { success: false, error: error?.message || String(error) };
  }
};
