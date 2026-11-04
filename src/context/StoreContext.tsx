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
  /** Whether the current user is a hub-level user (owner, hq-admin, hub-admin) */
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

const ENV_BRANCH_ID = (import.meta.env.VITE_BRANCH_ID || import.meta.env.VITE_STORE_ID || '').trim();

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [currentHub, setCurrentHub] = useState<Hub | null>(null);
  const [currentStore, setCurrentStoreState] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  const isHubUser =
    currentUser?.scope === 'hub' ||
    currentUser?.role === 'owner' ||
    currentUser?.role === 'hq-admin' ||
    currentUser?.role === 'hub-admin';

  const loadStores = useCallback(async (hubId?: string, preferredStoreId?: string) => {
    try {
      const storesRef = collection(db, 'stores');
      let snapshot = hubId
        ? await getDocs(query(storesRef, where('hubId', '==', hubId)))
        : await getDocs(storesRef);

      if (snapshot.empty && hubId) {
        snapshot = await getDocs(storesRef);
      }

      const storesList: Store[] = snapshot.docs
        .map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data(),
          shopName: docSnap.data().shopName || 'Digital Zone',
          createdAt: docSnap.data().createdAt?.toDate() || new Date(),
          updatedAt: docSnap.data().updatedAt?.toDate(),
        } as Store))
        .filter(s => s.isActive !== false || s.id === preferredStoreId);

      storesList.sort((a, b) => a.name.localeCompare(b.name));
      setStores(storesList);

      const targetStoreId = preferredStoreId || ENV_BRANCH_ID || currentUser?.storeId;
      if (targetStoreId) {
        const matched = storesList.find(s => s.id === targetStoreId);
        if (matched) {
          setCurrentStoreState(matched);
          return;
        }
      }

      if (storesList.length > 0) {
        const savedStoreId = localStorage.getItem('selectedStoreId');
        const saved = storesList.find(s => s.id === savedStoreId);
        setCurrentStoreState(saved || storesList[0]);
      }
    } catch (error) {
      console.error('Error loading stores:', error);
    }
  }, [currentUser?.storeId]);

  useEffect(() => {
    const loadHubAndStore = async () => {
      if (!currentUser) {
        setLoading(false);
        return;
      }

      try {
        const targetBranchId = ENV_BRANCH_ID || currentUser.storeId;
        let resolvedHubId = currentUser.hubId;

        // 1. If VITE_BRANCH_ID or user storeId is present, load that branch directly
        if (targetBranchId) {
          const storeDoc = await getDoc(doc(db, 'stores', targetBranchId));
          if (storeDoc.exists()) {
            const storeData = storeDoc.data();
            const resolvedStore: Store = {
              id: storeDoc.id,
              ...storeData,
              shopName: storeData.shopName || 'Digital Zone',
              createdAt: storeData.createdAt?.toDate() || new Date(),
              updatedAt: storeData.updatedAt?.toDate(),
            } as Store;
            setCurrentStoreState(resolvedStore);
            if (!resolvedHubId && storeData.hubId) {
              resolvedHubId = storeData.hubId;
            }
          }
        }

        // 2. Load hub metadata if available
        if (resolvedHubId) {
          const hubDoc = await getDoc(doc(db, 'hubs', resolvedHubId));
          if (hubDoc.exists()) {
            setCurrentHub({
              id: hubDoc.id,
              ...hubDoc.data(),
              createdAt: hubDoc.data().createdAt?.toDate() || new Date(),
              updatedAt: hubDoc.data().updatedAt?.toDate(),
            } as Hub);
          }
        }

        // 3. Load stores list for branch context / transfers
        await loadStores(resolvedHubId, targetBranchId);
      } catch (error) {
        console.error('Error loading hub/store data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadHubAndStore();
  }, [currentUser, loadStores]);

  const setCurrentStore = useCallback((storeId: string) => {
    // If VITE_BRANCH_ID is hard-configured for this deployment, keep the branch locked
    if (ENV_BRANCH_ID && storeId !== ENV_BRANCH_ID) {
      return;
    }

    const store = stores.find(s => s.id === storeId);
    if (store) {
      setCurrentStoreState(store);
      localStorage.setItem('selectedStoreId', storeId);
    }
  }, [stores]);

  const refreshStores = useCallback(async () => {
    await loadStores(currentUser?.hubId || currentHub?.id, ENV_BRANCH_ID || currentUser?.storeId);
  }, [currentUser?.hubId, currentUser?.storeId, currentHub?.id, loadStores]);

  const refreshCurrentStore = useCallback(async () => {
    const idToRefresh = ENV_BRANCH_ID || currentStore?.id;
    if (!idToRefresh) return;
    const storeDoc = await getDoc(doc(db, 'stores', idToRefresh));
    if (storeDoc.exists()) {
      const updated = {
        id: storeDoc.id,
        ...storeDoc.data(),
        shopName: storeDoc.data().shopName || 'Digital Zone',
        createdAt: storeDoc.data().createdAt?.toDate() || new Date(),
        updatedAt: storeDoc.data().updatedAt?.toDate(),
      } as Store;
      setCurrentStoreState(updated);
      setStores(prev => prev.map(s => (s.id === updated.id ? updated : s)));
    }
  }, [currentStore?.id]);

  const getCollectionRef = useCallback((collectionName: string): CollectionReference => {
    const activeStoreId = ENV_BRANCH_ID || currentStore?.id;
    if (!activeStoreId || isSharedRootCollection(collectionName)) {
      return collection(db, collectionName);
    }
    return getStoreCollectionRef('', activeStoreId, collectionName);
  }, [currentStore?.id]);

  const getDocRef = useCallback((collectionName: string, docId: string): DocumentReference => {
    const activeStoreId = ENV_BRANCH_ID || currentStore?.id;
    if (!activeStoreId || isSharedRootCollection(collectionName)) {
      return doc(db, collectionName, docId);
    }
    return getStoreDocRef('', activeStoreId, collectionName, docId);
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
