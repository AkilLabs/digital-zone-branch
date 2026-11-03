import { collection, getDocs, setDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { STORE_COLLECTIONS, HUB_COLLECTIONS } from './firestore';

/**
 * Migration script to move existing single-store data to the new Hub/Store architecture.
 * This should only be run ONCE by an admin.
 */
export const migrateToHubArchitecture = async (
  ownerUid: string,
  hubName: string,
  storeName: string
) => {
  try {
    console.log('Starting migration to Hub/Store architecture...');

    // 1. Create a new Hub
    const hubRef = doc(collection(db, 'hubs'));
    await setDoc(hubRef, {
      name: hubName,
      ownerName: 'Admin', // Update as needed
      isActive: true,
      createdAt: serverTimestamp(),
      createdBy: ownerUid,
    });
    console.log(`Created Hub: ${hubRef.id}`);

    // 2. Create an initial Store under this Hub
    const storeRef = doc(collection(db, 'hubs', hubRef.id, 'stores'));
    await setDoc(storeRef, {
      hubId: hubRef.id,
      name: storeName,
      isActive: true,
      createdAt: serverTimestamp(),
      createdBy: ownerUid,
    });
    console.log(`Created Store: ${storeRef.id}`);

    // 3. Update the Owner User object
    const userRef = doc(db, 'users', ownerUid);
    await setDoc(
      userRef, 
      { 
        hubId: hubRef.id, 
        role: 'owner', 
        scope: 'hub' 
      }, 
      { merge: true }
    );
    console.log('Updated owner user account');

    // 4. Migrate STORE-level collections
    for (const collectionName of STORE_COLLECTIONS) {
      // Don't migrate settings yet as it requires special handling, users will be updated individually
      if (['settings', 'users'].includes(collectionName)) continue;

      console.log(`Migrating ${collectionName}...`);
      const sourceQuery = collection(db, collectionName);
      const snapshot = await getDocs(sourceQuery);
      
      if (snapshot.empty) {
        console.log(`- ${collectionName} is empty. Skipping.`);
        continue;
      }

      console.log(`- Found ${snapshot.size} documents in ${collectionName}`);
      let batch = writeBatch(db);
      let numOps = 0;

      for (const docSnap of snapshot.docs) {
        const destRef = doc(db, 'hubs', hubRef.id, 'stores', storeRef.id, collectionName, docSnap.id);
        const data = docSnap.data();
        
        // Tag with storeId
        batch.set(destRef, { ...data, storeId: storeRef.id });
        numOps++;

        if (numOps >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          numOps = 0;
          console.log(`- Committed batch for ${collectionName}...`);
        }
      }

      if (numOps > 0) {
        await batch.commit();
        console.log(`- Finished migrating ${collectionName}`);
      }
    }

    // 5. Migrate HUB-level collections (like suppliers)
    for (const collectionName of HUB_COLLECTIONS) {
      if (collectionName === 'users') continue; // Handled separately
      
      console.log(`Migrating Hub-level collection: ${collectionName}...`);
      const sourceQuery = collection(db, collectionName);
      let snapshot;
      try {
        snapshot = await getDocs(sourceQuery);
      } catch {
        continue;
      }
      
      if (!snapshot || snapshot.empty) continue;

      console.log(`- Found ${snapshot.size} documents in ${collectionName}`);
      let batch = writeBatch(db);
      let numOps = 0;

      for (const docSnap of snapshot.docs) {
        const destRef = doc(db, 'hubs', hubRef.id, collectionName, docSnap.id);
        const data = docSnap.data();
        
        // Tag with hubId
        batch.set(destRef, { ...data, hubId: hubRef.id });
        numOps++;

        if (numOps >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          numOps = 0;
        }
      }

      if (numOps > 0) {
        await batch.commit();
      }
    }

    // 6. Migrate Users (except owner)
    console.log(`Migrating users...`);
    const usersSnap = await getDocs(collection(db, 'users'));
    let userBatch = writeBatch(db);
    let userOps = 0;

    for (const userDoc of usersSnap.docs) {
      if (userDoc.id === ownerUid) continue; // Owner already updated

      const userData = userDoc.data();
      const updatedUser: any = {
        ...userData,
        hubId: hubRef.id,
      };

      // Depending on existing role, assign scope
      if (userData.role === 'admin') {
        updatedUser.role = 'hub-admin';
        updatedUser.scope = 'hub';
      } else {
        // Employee/QR defaults to store level
        updatedUser.storeId = storeRef.id;
        updatedUser.scope = 'store';
      }

      userBatch.set(userDoc.ref, updatedUser, { merge: true });
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

    console.log('Migration completed successfully!');
    return { success: true, hubId: hubRef.id, storeId: storeRef.id };
  } catch (error) {
    console.error('Migration failed:', error);
    return { success: false, error };
  }
};
