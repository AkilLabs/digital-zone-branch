import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit,
  startAfter,
  QueryConstraint,
  Timestamp
} from 'firebase/firestore';
import { isExpenseItem, type BillingItem } from '../types';
import { useStore } from '../context/StoreContext';
import { syncStoreProducts, getCachedStoreProductsOnly } from '../utils/productSyncCache';

// Cache times
const CACHE_TIME = {
  SHORT: 2 * 60 * 1000,    // 2 minutes
  MEDIUM: 5 * 60 * 1000,   // 5 minutes
  LONG: 15 * 60 * 1000,    // 15 minutes
};

// Helper to get today's date range
export const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
};

// Helper to convert date range to Timestamps
const dateToTimestamp = (date: Date) => Timestamp.fromDate(date);

const parseDocDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
};

// Hook for fetching today's billing items only (including separate expenses collection)
export const useTodayBillingItems = () => {
  const { getCollectionRef, currentStore } = useStore();

  return useQuery({
    queryKey: ['billingItems', 'today', currentStore?.id],
    queryFn: async () => {
      const { start, end } = getTodayRange();
      
      const billingQ = query(
        getCollectionRef('billingItems'),
        where('createdAt', '>=', dateToTimestamp(start)),
        where('createdAt', '<=', dateToTimestamp(end)),
        orderBy('createdAt', 'desc')
      );

      const expensesQ = query(
        getCollectionRef('expenses'),
        where('createdAt', '>=', dateToTimestamp(start)),
        where('createdAt', '<=', dateToTimestamp(end)),
        orderBy('createdAt', 'desc')
      );
      
      const [billingSnap, expensesSnap] = await Promise.all([
        getDocs(billingQ),
        getDocs(expensesQ).catch(() => null)
      ]);

      const items: BillingItem[] = [];
      
      billingSnap.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
          _collection: 'billingItems',
          createdAt: parseDocDate(data.createdAt),
          updatedAt: data.updatedAt ? parseDocDate(data.updatedAt) : undefined
        } as BillingItem);
      });

      if (expensesSnap) {
        expensesSnap.forEach((doc) => {
          const data = doc.data();
          const amt = Number(data.amount ?? data.cost ?? 0);
          items.push({
            id: doc.id,
            ...data,
            cost: amt,
            sellingPrice: 0,
            profit: -amt,
            totalProfit: -amt,
            quantity: Number(data.quantity || 1),
            type: 'expense',
            _collection: 'expenses',
            createdAt: parseDocDate(data.createdAt),
            updatedAt: data.updatedAt ? parseDocDate(data.updatedAt) : undefined
          } as BillingItem);
        });
      }
      
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return items;
    },
    staleTime: CACHE_TIME.SHORT,
    gcTime: CACHE_TIME.MEDIUM,
  });
};

// Hook for fetching billing items with date range and pagination (merges separate expenses collection seamlessly)
export const useBillingItems = (
  startDate?: Date,
  endDate?: Date,
  pageSize: number = 50,
  lastDoc?: any
) => {
  const { getCollectionRef, currentStore } = useStore();
  const queryKey = ['billingItems', currentStore?.id, startDate?.toISOString(), endDate?.toISOString(), pageSize, lastDoc?.id];
  
  return useQuery({
    queryKey,
    queryFn: async () => {
      const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
      
      if (startDate && endDate) {
        constraints.push(where('createdAt', '>=', dateToTimestamp(startDate)));
        constraints.push(where('createdAt', '<=', dateToTimestamp(endDate)));
      }
      
      constraints.push(limit(pageSize));
      
      if (lastDoc) {
        constraints.push(startAfter(lastDoc));
      }
      
      const q = query(getCollectionRef('billingItems'), ...constraints);
      const expenseConstraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
      if (startDate && endDate) {
        expenseConstraints.push(where('createdAt', '>=', dateToTimestamp(startDate)));
        expenseConstraints.push(where('createdAt', '<=', dateToTimestamp(endDate)));
      }
      expenseConstraints.push(limit(pageSize));
      const expQ = query(getCollectionRef('expenses'), ...expenseConstraints);

      const [querySnapshot, expSnapshot] = await Promise.all([
        getDocs(q),
        getDocs(expQ).catch(() => null)
      ]);

      const items: BillingItem[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
          _collection: 'billingItems',
          createdAt: parseDocDate(data.createdAt),
          updatedAt: data.updatedAt ? parseDocDate(data.updatedAt) : undefined
        } as BillingItem);
      });

      if (expSnapshot) {
        expSnapshot.forEach((doc) => {
          const data = doc.data();
          const amt = Number(data.amount ?? data.cost ?? 0);
          items.push({
            id: doc.id,
            ...data,
            cost: amt,
            sellingPrice: 0,
            profit: -amt,
            totalProfit: -amt,
            quantity: Number(data.quantity || 1),
            type: 'expense',
            _collection: 'expenses',
            createdAt: parseDocDate(data.createdAt),
            updatedAt: data.updatedAt ? parseDocDate(data.updatedAt) : undefined
          } as BillingItem);
        });
      }

      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      return {
        items,
        lastDoc: querySnapshot.docs[querySnapshot.docs.length - 1],
        hasMore: querySnapshot.docs.length === pageSize
      };
    },
    staleTime: CACHE_TIME.SHORT,
    gcTime: CACHE_TIME.MEDIUM,
  });
};

// Dedicated hook for fetching expenses from `expenses` collection AND legacy `billingItems` expenses
export const useExpenses = (
  startDate?: Date,
  endDate?: Date,
  pageSize: number = 1000
) => {
  const { getCollectionRef, currentStore } = useStore();
  const queryKey = ['expenses', currentStore?.id, startDate?.toISOString(), endDate?.toISOString(), pageSize];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const expConstraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
      if (startDate && endDate) {
        expConstraints.push(where('createdAt', '>=', dateToTimestamp(startDate)));
        expConstraints.push(where('createdAt', '<=', dateToTimestamp(endDate)));
      }
      expConstraints.push(limit(pageSize));

      // 1. Fetch from dedicated `expenses` collection
      let expSnap;
      try {
        expSnap = await getDocs(query(getCollectionRef('expenses'), ...expConstraints));
      } catch {
        expSnap = await getDocs(query(getCollectionRef('expenses')));
      }

      // 2. Fetch legacy expenses from `billingItems` collection (where type == 'expense')
      let legacySnap;
      try {
        const legConstraints: QueryConstraint[] = [where('type', '==', 'expense')];
        if (startDate && endDate) {
          legConstraints.push(where('createdAt', '>=', dateToTimestamp(startDate)));
          legConstraints.push(where('createdAt', '<=', dateToTimestamp(endDate)));
        }
        legacySnap = await getDocs(query(getCollectionRef('billingItems'), ...legConstraints));
      } catch {
        try {
          legacySnap = await getDocs(query(getCollectionRef('billingItems'), where('type', '==', 'expense')));
        } catch {
          legacySnap = null;
        }
      }

      const items: BillingItem[] = [];
      const seenIds = new Set<string>();

      expSnap.forEach((doc) => {
        const data = doc.data();
        const createdAt = parseDocDate(data.createdAt);
        if (startDate && endDate && (createdAt < startDate || createdAt > endDate)) return;
        const amt = Number(data.amount ?? data.cost ?? 0);
        seenIds.add(doc.id);
        items.push({
          id: doc.id,
          ...data,
          cost: amt,
          sellingPrice: 0,
          profit: -amt,
          totalProfit: -amt,
          quantity: Number(data.quantity || 1),
          type: 'expense',
          _collection: 'expenses',
          createdAt,
          updatedAt: data.updatedAt ? parseDocDate(data.updatedAt) : undefined
        } as BillingItem);
      });

      if (legacySnap) {
        legacySnap.forEach((doc) => {
          if (seenIds.has(doc.id)) return;
          const data = doc.data();
          if (!isExpenseItem(data)) return;
          const createdAt = parseDocDate(data.createdAt);
          if (startDate && endDate && (createdAt < startDate || createdAt > endDate)) return;
          seenIds.add(doc.id);
          items.push({
            id: doc.id,
            ...data,
            type: 'expense',
            _collection: 'billingItems',
            createdAt,
            updatedAt: data.updatedAt ? parseDocDate(data.updatedAt) : undefined
          } as BillingItem);
        });
      }

      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items };
    },
    staleTime: CACHE_TIME.SHORT,
    gcTime: CACHE_TIME.MEDIUM,
  });
};

// Fetches all products using Delta Sync (0-5 Firestore reads instead of 2,000)
export const useAllStoreProducts = () => {
  const { currentStore } = useStore();

  return useQuery({
    queryKey: ['products', 'catalog', currentStore?.id],
    queryFn: async () => {
      return await syncStoreProducts(currentStore?.id);
    },
    staleTime: 1000 * 60 * 5, // 5 minutes in memory, backed by IndexedDB
    gcTime: 1000 * 60 * 60,
  });
};

// Drop-in replacement for useAvailableProducts() used by BillingForm.tsx and Billing.tsx
export const useAvailableProducts = () => {
  const queryResult = useAllStoreProducts();
  const availableData = useMemo(
    () =>
      (queryResult.data || [])
        .filter((p) => Number(p.quantity) > 0)
        .sort((a, b) => Number(b.quantity) - Number(a.quantity)),
    [queryResult.data]
  );

  return {
    ...queryResult,
    data: availableData,
  };
};

// Hook for fetching all products with pagination (shares local Delta-Sync catalog)
export const useProducts = (pageSize: number = 50) => {
  const queryResult = useAllStoreProducts();
  const paginatedData = useMemo(
    () =>
      [...(queryResult.data || [])]
        .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
        .slice(0, pageSize),
    [queryResult.data, pageSize]
  );

  return {
    ...queryResult,
    data: paginatedData,
  };
};

// Hook for fetching credit sales with date range
export const useCreditSales = (
  startDate?: Date,
  endDate?: Date,
  pageSize: number = 50
) => {
  const { getCollectionRef, currentStore } = useStore();
  const queryKey = ['creditSales', currentStore?.id, startDate?.toISOString(), endDate?.toISOString(), pageSize];
  
  return useQuery({
    queryKey,
    queryFn: async () => {
      const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
      
      if (startDate && endDate) {
        constraints.push(where('createdAt', '>=', dateToTimestamp(startDate)));
        constraints.push(where('createdAt', '<=', dateToTimestamp(endDate)));
      }
      
      constraints.push(limit(pageSize));
      
      const q = query(getCollectionRef('creditSales'), ...constraints);
      const querySnapshot = await getDocs(q);
      const items: BillingItem[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
          type: 'credit', // Mark as credit sale
          _collection: 'creditSales',
          createdAt: parseDocDate(data.createdAt),
          updatedAt: data.updatedAt ? parseDocDate(data.updatedAt) : undefined
        } as BillingItem);
      });
      
      return {
        items,
        hasMore: querySnapshot.docs.length === pageSize
      };
    },
    staleTime: CACHE_TIME.SHORT,
    gcTime: CACHE_TIME.MEDIUM,
  });
};

// Hook to invalidate caches after mutations
export const useInvalidateCache = () => {
  const queryClient = useQueryClient();
  const { currentStore } = useStore();
  
  return {
    invalidateBillingItems: () => {
      queryClient.invalidateQueries({ queryKey: ['billingItems'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    invalidateExpenses: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['billingItems'] });
    },
    invalidateCreditSales: () => {
      queryClient.invalidateQueries({ queryKey: ['creditSales'] });
    },
    /**
     * Zero-read product refresh: callers update IndexedDB first
     * (updateLocalProductQuantities / upsertLocalProducts / removeLocalProducts),
     * then this pushes the local catalog into React Query without a Firestore query.
     */
    invalidateProducts: async () => {
      try {
        const localData = await getCachedStoreProductsOnly(currentStore?.id);
        queryClient.setQueryData(['products', 'catalog', currentStore?.id], localData);
      } catch (err) {
        console.warn('Local product cache refresh failed, falling back to refetch:', err);
        queryClient.invalidateQueries({ queryKey: ['products'] });
      }
    },
    invalidateAll: () => {
      queryClient.invalidateQueries();
    }
  };
};
