import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, doc, getDoc, getDocs, query, where, CollectionReference, DocumentReference } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import type { Hub, Store } from '../types';
import { getStoreCollectionRef, getStoreDocRef, getHubCollectionRef, getHubDocRef, isSharedRootCollection } from '../utils/firestore';

export type LocationScope = 'all_locations' | 'hub_warehouse' | string;

interface StoreContextType {
  currentHub: Hub | null;
  currentStore: Store | null;
  /** Explicit location scope: 'all_locations' (Complete Stock: Hub + Branches), 'hub_warehouse' (Main Office Storage), or a branch store.id */
  selectedLocation: LocationScope;
  stores: Store[];
  loading: boolean;
  setCurrentStore: (storeId: LocationScope) => void;
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
  /** Whether the hub user is currently viewing the Hub Warehouse / All Locations (currentStore === null) */
  isViewingWarehouse: boolean;
  /** Whether the hub user is currently viewing Complete Stock across Hub + All Branches */
  isViewingAllLocations: boolean;
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
  const [selectedLocation, setSelectedLocation] = useState<LocationScope>(() => {
    const saved = localStorage.getItem('selectedStoreId');
    return saved || 'hub_warehouse';
  });
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  const isHubUser =
    currentUser?.scope === 'hub' ||
    currentUser?.role === 'owner' ||
    currentUser?.role === 'hq-admin' ||
    currentUser?.role === 'hub-admin';

  const loadStores = useCallback(async (hubId?: string) => {
    try {
      const storesRef = collection(db, 'stores');
      let snapshot = hubId
        ? await getDocs(query(storesRef, where('hubId', '==', hubId)))
        : await getDocs(storesRef);

      if (snapshot.empty && hubId) {
        snapshot = await getDocs(storesRef);
      }

      const storesList: Store[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
        shopName: docSnap.data().shopName || 'Digital Zone',
        createdAt: docSnap.data().createdAt?.toDate() || new Date(),
        updatedAt: docSnap.data().updatedAt?.toDate(),
      } as Store));

      storesList.sort((a, b) => a.name.localeCompare(b.name));
      setStores(storesList);

      // In HQ, restore saved scope: 'all_locations', 'hub_warehouse', or a specific store.id
      if (!currentUser?.storeId) {
        const savedStoreId = localStorage.getItem('selectedStoreId');
        if (savedStoreId === 'all_locations') {
          setCurrentStoreState(null);
          setSelectedLocation('all_locations');
        } else if (!savedStoreId || savedStoreId === 'hub_warehouse') {
          setCurrentStoreState(null);
          setSelectedLocation('hub_warehouse');
        } else {
          const saved = storesList.find(s => s.id === savedStoreId);
          setCurrentStoreState(saved || null);
          setSelectedLocation(saved?.id || 'hub_warehouse');
        }
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
        let resolvedHubId = currentUser.hubId;

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
        } else {
          // Fallback: find first hub in hubs collection or synthesize default Digital Zone HQ hub
          const hubsSnap = await getDocs(collection(db, 'hubs'));
          if (!hubsSnap.empty) {
            const firstHub = hubsSnap.docs[0];
            resolvedHubId = firstHub.id;
            setCurrentHub({
              id: firstHub.id,
              ...firstHub.data(),
              createdAt: firstHub.data().createdAt?.toDate() || new Date(),
              updatedAt: firstHub.data().updatedAt?.toDate(),
            } as Hub);
          } else {
            resolvedHubId = 'digital_zone_hq';
            setCurrentHub({
              id: 'digital_zone_hq',
              name: 'Digital Zone HQ',
              ownerName: currentUser.displayName || 'Owner',
              isActive: true,
              createdAt: new Date(),
              createdBy: currentUser.uid,
            });
          }
        }

        await loadStores(resolvedHubId);

        if (currentUser.storeId) {
          const storeDoc = await getDoc(doc(db, 'stores', currentUser.storeId));
          if (storeDoc.exists()) {
            setCurrentStoreState({
              id: storeDoc.id,
              ...storeDoc.data(),
              shopName: storeDoc.data().shopName || 'Digital Zone',
              createdAt: storeDoc.data().createdAt?.toDate() || new Date(),
              updatedAt: storeDoc.data().updatedAt?.toDate(),
            } as Store);
            setSelectedLocation(storeDoc.id);
          }
        }
      } catch (error) {
        console.error('Error loading hub/store data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadHubAndStore();
  }, [currentUser, loadStores]);

  const setCurrentStore = useCallback((storeId: LocationScope) => {
    if (storeId === 'all_locations') {
      setCurrentStoreState(null);
      setSelectedLocation('all_locations');
      if (isHubUser) localStorage.setItem('selectedStoreId', 'all_locations');
      return;
    }

    if (storeId === 'hub_warehouse' || !storeId) {
      setCurrentStoreState(null);
      setSelectedLocation('hub_warehouse');
      if (isHubUser) localStorage.setItem('selectedStoreId', 'hub_warehouse');
      return;
    }

    const store = stores.find(s => s.id === storeId);
    if (store && store.id) {
      setCurrentStoreState(store);
      setSelectedLocation(store.id);
      if (isHubUser) localStorage.setItem('selectedStoreId', store.id);
    }
  }, [stores, isHubUser]);

  const refreshStores = useCallback(async () => {
    await loadStores(currentUser?.hubId || currentHub?.id);
  }, [currentUser?.hubId, currentHub?.id, loadStores]);

  const refreshCurrentStore = useCallback(async () => {
    if (!currentStore?.id) return;
    const storeDoc = await getDoc(doc(db, 'stores', currentStore.id));
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
    if (!currentStore?.id || isSharedRootCollection(collectionName)) {
      return collection(db, collectionName);
    }
    return getStoreCollectionRef('', currentStore.id, collectionName);
  }, [currentStore?.id]);

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

  const isViewingWarehouse = isHubUser && !currentStore;
  const isViewingAllLocations = isHubUser && selectedLocation === 'all_locations';

  const value: StoreContextType = {
    currentHub,
    currentStore,
    selectedLocation,
    stores,
    loading,
    setCurrentStore,
    getCollectionRef,
    getDocRef,
    getHubCollection,
    getHubDoc,
    isHubUser,
    isViewingWarehouse,
    isViewingAllLocations,
    refreshStores,
    refreshCurrentStore,
  };

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
};
