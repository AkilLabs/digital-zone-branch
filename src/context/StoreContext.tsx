import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, doc, getDoc, getDocs, query, where, CollectionReference, DocumentReference } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import type { Hub, Store } from '../types';
import { getStoreCollectionRef, getStoreDocRef, getHubCollectionRef, getHubDocRef, isSharedRootCollection } from '../utils/firestore';

interface StoreContextType {
  currentHub: Hub | null;
  currentStore: Store | null;
  stores: Store[];
  loading: boolean;
  setCurrentStore: (storeId: string) => void;
  /** Get a scoped collection ref for the current store — stores/{storeId}/{name} */
  getCollectionRef: (collectionName: string) => CollectionReference;
  /** Get a scoped document ref for the current store — stores/{storeId}/{name}/{docId} */
  getDocRef: (collectionName: string, docId: string) => DocumentReference;
  /** Get a hub-level collection ref (hub metadata only) */
  getHubCollection: (collectionName: string) => CollectionReference;
  /** Get a hub-level document ref */
  getHubDoc: (collectionName: string, docId: string) => DocumentReference;
  /** Whether the current user is a hub-level user (owner, hub-admin) */
  isHubUser: boolean;
  /** Refresh stores list */
  refreshStores: () => Promise<void>;
  /** Re-read the current store document (branch settings) */
  refreshCurrentStore: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType>({} as StoreContextType);

export const useStore = () => {
  return useContext(StoreContext);
};

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [currentHub, setCurrentHub] = useState<Hub | null>(null);
  const [currentStore, setCurrentStoreState] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  const isHubUser =
    currentUser?.scope === 'hub' ||
    currentUser?.role === 'owner' ||
    currentUser?.role === 'hub-admin';

  // ─── Load hub metadata + stores ───────────────────────────────────────────
  useEffect(() => {
    const loadHubAndStore = async () => {
      if (!currentUser?.hubId) {
        setLoading(false);
        return;
      }

      try {
        // 1. Load hub metadata (hubs/{hubId})
        const hubDoc = await getDoc(doc(db, 'hubs', currentUser.hubId));
        if (hubDoc.exists()) {
          setCurrentHub({
            id: hubDoc.id,
            ...hubDoc.data(),
            createdAt: hubDoc.data().createdAt?.toDate() || new Date(),
            updatedAt: hubDoc.data().updatedAt?.toDate(),
          } as Hub);
        }

        // 2. Load stores from the flat stores/ collection, filtered by hubId
        await loadStores(currentUser.hubId);

        // 3. If user has a specific store assigned, set it from stores/ collection
        if (currentUser.storeId) {
          const storeDoc = await getDoc(doc(db, 'stores', currentUser.storeId));
          if (storeDoc.exists()) {
            setCurrentStoreState({
              id: storeDoc.id,
              ...storeDoc.data(),
              createdAt: storeDoc.data().createdAt?.toDate() || new Date(),
              updatedAt: storeDoc.data().updatedAt?.toDate(),
            } as Store);
          }
        }
      } catch (error) {
        console.error('Error loading hub/store data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadHubAndStore();
  }, [currentUser?.hubId, currentUser?.storeId]);

  /**
   * Load all stores belonging to this hub.
   * New path: stores/ (flat collection) filtered by hubId field.
   */
  const loadStores = async (hubId: string) => {
    try {
      const storesRef = collection(db, 'stores');
      const q = query(storesRef, where('hubId', '==', hubId), where('isActive', '==', true));
      const snapshot = await getDocs(q);

      const storesList: Store[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt?.toDate() || new Date(),
        updatedAt: docSnap.data().updatedAt?.toDate(),
      } as Store));

      // Sort by name in memory (avoids needing a composite Firestore index)
      storesList.sort((a, b) => a.name.localeCompare(b.name));
      setStores(storesList);

      // Restore previously selected store for hub-level users
      if (!currentUser?.storeId && storesList.length > 0) {
        const savedStoreId = localStorage.getItem('selectedStoreId');
        if (savedStoreId === 'hub_warehouse') {
          setCurrentStoreState(null);
        } else {
          const saved = storesList.find(s => s.id === savedStoreId);
          setCurrentStoreState(saved || storesList[0]);
        }
      }
    } catch (error) {
      console.error('Error loading stores:', error);
    }
  };

  const setCurrentStore = useCallback((storeId: string) => {
    if (storeId === 'hub_warehouse') {
      setCurrentStoreState(null);
      if (isHubUser) localStorage.setItem('selectedStoreId', 'hub_warehouse');
      return;
    }

    const store = stores.find(s => s.id === storeId);
    if (store) {
      setCurrentStoreState(store);
      if (isHubUser) localStorage.setItem('selectedStoreId', storeId);
    }
  }, [stores, isHubUser]);

  const refreshStores = useCallback(async () => {
    if (currentUser?.hubId) {
      await loadStores(currentUser.hubId);
    }
  }, [currentUser?.hubId]);

  /** Re-read stores/{currentStoreId} (1 read) after branch settings are edited. */
  const refreshCurrentStore = useCallback(async () => {
    if (!currentStore?.id) return;
    const storeDoc = await getDoc(doc(db, 'stores', currentStore.id));
    if (storeDoc.exists()) {
      const updated = {
        id: storeDoc.id,
        ...storeDoc.data(),
        createdAt: storeDoc.data().createdAt?.toDate() || new Date(),
        updatedAt: storeDoc.data().updatedAt?.toDate(),
      } as Store;
      setCurrentStoreState(updated);
      setStores(prev => prev.map(s => (s.id === updated.id ? updated : s)));
    }
  }, [currentStore?.id]);

  // ─── Scoped Firestore references ──────────────────────────────────────────
  /**
   * Returns a CollectionReference for the current store.
   * Path: stores/{storeId}/{collectionName}
   * Shared HO collections (users, customers, suppliers, ...) always resolve to the root.
   * Falls back to a root-level collection if no store is in context.
   */
  const getCollectionRef = useCallback((collectionName: string): CollectionReference => {
    if (!currentStore?.id || isSharedRootCollection(collectionName)) {
      // No store context or shared collection: root-level collection
      return collection(db, collectionName);
    }
    // Pass empty string for hubId; the new helper ignores it
    return getStoreCollectionRef('', currentStore.id, collectionName);
  }, [currentStore?.id]);

  /**
   * Returns a DocumentReference for the current store.
   * Path: stores/{storeId}/{collectionName}/{docId}
   * Shared HO collections always resolve to the root.
   */
  const getDocRef = useCallback((collectionName: string, docId: string): DocumentReference => {
    if (!currentStore?.id || isSharedRootCollection(collectionName)) {
      return doc(db, collectionName, docId);
    }
    return getStoreDocRef('', currentStore.id, collectionName, docId);
  }, [currentStore?.id]);

  const getHubCollection = useCallback((collectionName: string): CollectionReference => {
    if (!currentHub?.id) {
      return collection(db, collectionName);
    }
    return getHubCollectionRef(currentHub.id, collectionName);
  }, [currentHub?.id]);

  const getHubDoc = useCallback((collectionName: string, docId: string): DocumentReference => {
    if (!currentHub?.id) {
      return doc(db, collectionName, docId);
    }
    return getHubDocRef(currentHub.id, collectionName, docId);
  }, [currentHub?.id]);

  const value: StoreContextType = {
    currentHub,
    currentStore,
    stores,
    loading,
    setCurrentStore,
    getCollectionRef,
    getDocRef,
    getHubCollection,
    getHubDoc,
    isHubUser,
    refreshStores,
    refreshCurrentStore,
  };

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
};
