import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { collection, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { StockTransfer, BillingItem } from '../types';

const HubDashboard: React.FC = () => {
  useAuth();
  const { currentHub, stores, setCurrentStore } = useStore();
  const navigate = useNavigate();

  const [storeStats, setStoreStats] = useState<Map<string, {
    totalSales: number;
    totalProfit: number;
    productCount: number;
    todayOrders: number;
  }>>(new Map());
  const [warehouseProductCount, setWarehouseProductCount] = useState(0);
  const [recentTransfers, setRecentTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTransfer, setExpandedTransfer] = useState<string | null>(null);

  useEffect(() => {
    if (currentHub?.id && stores.length > 0) {
      loadHubStats();
    } else if (currentHub?.id) {
      loadWarehouseStats();
    }
  }, [currentHub?.id, stores]);

  const loadWarehouseStats = async () => {
    if (!currentHub?.id || stores.length === 0) return;
    setLoading(true);
    try {
      // Count products across all stores of this hub
      let totalProducts = 0;
      for (const store of stores) {
        if (!store.id) continue;
        const productsSnap = await getDocs(collection(db, 'stores', store.id, 'products'));
        totalProducts += productsSnap.size;
      }
      setWarehouseProductCount(totalProducts);
    } catch (err) {
      console.error('Error loading warehouse stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadHubStats = async () => {
    if (!currentHub?.id) return;
    setLoading(true);

    try {
      const statsMap = new Map<string, { totalSales: number; totalProfit: number; productCount: number; todayOrders: number }>();

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      // Warehouse product count: sum across all store products for this hub
      try {
        let total = 0;
        for (const s of stores) {
          if (s.id) {
            const snap = await getDocs(collection(db, 'stores', s.id, 'products'));
            total += snap.size;
          }
        }
        setWarehouseProductCount(total);
      } catch {
        setWarehouseProductCount(0);
      }

      // Load stats for each store
      for (const store of stores) {
        if (!store.id) continue;

        try {
          // Flat path: stores/{storeId}/products
          const productsSnap = await getDocs(
            collection(db, 'stores', store.id, 'products')
          );

          const billingQ = query(
            collection(db, 'stores', store.id, 'billingItems'),
            where('createdAt', '>=', Timestamp.fromDate(todayStart)),
            where('createdAt', '<=', Timestamp.fromDate(todayEnd)),
            orderBy('createdAt', 'desc')
          );

          let todaySales = 0;
          let todayProfit = 0;
          let todayOrders = 0;

          try {
            const billingSnap = await getDocs(billingQ);
            billingSnap.forEach((doc) => {
              const data = doc.data() as BillingItem;
              if ((data.sellingPrice || 0) > 0) {
                todaySales += (data.sellingPrice || 0) * (data.quantity || 0);
                todayProfit += data.totalProfit || 0;
                todayOrders++;
              }
            });
          } catch {
            // Collection may not exist yet
          }

          statsMap.set(store.id, {
            totalSales: todaySales,
            totalProfit: todayProfit,
            productCount: productsSnap.size,
            todayOrders,
          });
        } catch (err) {
          console.error(`Error loading stats for store ${store.id}:`, err);
          statsMap.set(store.id, { totalSales: 0, totalProfit: 0, productCount: 0, todayOrders: 0 });
        }
      }

      setStoreStats(statsMap);

      // Load recent stock transfers
      try {
        const transfersQ = query(
          collection(db, 'hubs', currentHub.id, 'stockTransfers'),
          orderBy('createdAt', 'desc')
        );
        const transfersSnap = await getDocs(transfersQ);
        const transfers: StockTransfer[] = transfersSnap.docs.slice(0, 10).map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
          completedAt: doc.data().completedAt?.toDate(),
        } as StockTransfer));
        setRecentTransfers(transfers);
      } catch {
        // stockTransfers collection may not exist
      }
    } catch (err) {
      console.error('Error loading hub stats:', err);
    } finally {
      setLoading(false);
    }
  };

  // Aggregate stats
  const totalSalesAllStores = useMemo(() => {
    let total = 0;
    storeStats.forEach(s => total += s.totalSales);
    return total;
  }, [storeStats]);

  const totalProfitAllStores = useMemo(() => {
    let total = 0;
    storeStats.forEach(s => total += s.totalProfit);
    return total;
  }, [storeStats]);

  const totalProductsAllStores = useMemo(() => {
    let total = 0;
    storeStats.forEach(s => total += s.productCount);
    return total;
  }, [storeStats]);

  const totalOrdersAllStores = useMemo(() => {
    let total = 0;
    storeStats.forEach(s => total += s.todayOrders);
    return total;
  }, [storeStats]);

  const handleSelectStore = (storeId: string) => {
    setCurrentStore(storeId);
    navigate('/dashboard');
  };

  const handleViewWarehouse = () => {
    setCurrentStore('hub_warehouse');
    navigate('/products');
  };

  const getTransferStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'in-transit': return 'bg-sky-100 text-sky-700 border-sky-200';
      case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getTransferStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
      case 'pending':
        return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
      case 'in-transit':
        return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>;
      default:
        return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
    }
  };

  return (
    <div className="min-h-screen bg-white pb-20 md:pb-0 font-sans">
      <Navbar />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 mt-16 md:mt-0">
        {/* Hub Header */}
        <div className="mb-6 bg-gradient-to-br from-indigo-600 via-blue-600 to-purple-700 rounded-2xl shadow-xl p-5 md:p-6 text-white relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/4" />
          
          <div className="relative z-10">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                    </svg>
                  </div>
                  <h1 className="text-xl md:text-2xl font-bold">{currentHub?.name || 'Hub Dashboard'}</h1>
                </div>
                <p className="text-blue-100 text-sm pl-10">
                  {stores.length} store{stores.length !== 1 ? 's' : ''} • {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
              </div>
              <div className="hidden md:flex gap-2">
                <button
                  onClick={() => navigate('/store-management')}
                  className="px-4 py-2 bg-white/15 hover:bg-white/25 rounded-xl text-sm font-medium transition-all backdrop-blur-sm border border-white/20 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                  Manage Stores
                </button>
                <button
                  onClick={() => navigate('/stock-transfer')}
                  className="px-4 py-2 bg-white/15 hover:bg-white/25 rounded-xl text-sm font-medium transition-all backdrop-blur-sm border border-white/20 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                  Stock Transfer
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Aggregate Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
          <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <p className="text-xs text-gray-500 font-medium">Today's Sales</p>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-gray-900">₹{totalSalesAllStores.toLocaleString('en-IN')}</h3>
            <p className="text-[10px] md:text-xs text-gray-400 mt-0.5">All stores combined</p>
          </div>
          <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              </div>
              <p className="text-xs text-gray-500 font-medium">Today's Profit</p>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-gray-900">₹{totalProfitAllStores.toLocaleString('en-IN')}</h3>
            <p className="text-[10px] md:text-xs text-gray-400 mt-0.5">Net earnings</p>
          </div>
          <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
              </div>
              <p className="text-xs text-gray-500 font-medium">Total Products</p>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-gray-900">{totalProductsAllStores + warehouseProductCount}</h3>
            <p className="text-[10px] md:text-xs text-gray-400 mt-0.5">{warehouseProductCount} in warehouse</p>
          </div>
          <div className="bg-white p-4 md:p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              </div>
              <p className="text-xs text-gray-500 font-medium">Today's Orders</p>
            </div>
            <h3 className="text-lg md:text-2xl font-bold text-gray-900">{totalOrdersAllStores}</h3>
            <p className="text-[10px] md:text-xs text-gray-400 mt-0.5">Transactions today</p>
          </div>
        </div>

        {/* Quick Actions - Mobile */}
        <div className="md:hidden grid grid-cols-3 gap-3 mb-6">
          <button
            onClick={() => navigate('/store-management')}
            className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center gap-2 hover:border-indigo-200 hover:shadow-md transition-all active:scale-[0.97]"
          >
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="text-xs font-medium text-gray-700">Stores</span>
          </button>
          <button
            onClick={() => navigate('/stock-transfer')}
            className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center gap-2 hover:border-blue-200 hover:shadow-md transition-all active:scale-[0.97]"
          >
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <span className="text-xs font-medium text-gray-700">Transfer</span>
          </button>
          <button
            onClick={handleViewWarehouse}
            className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center gap-2 hover:border-purple-200 hover:shadow-md transition-all active:scale-[0.97]"
          >
            <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-gray-700">Warehouse</span>
          </button>
        </div>

        {/* Warehouse Card */}
        <div className="mb-6">
          <div
            className="bg-gradient-to-r from-slate-50 to-indigo-50 p-4 md:p-5 rounded-xl border-2 border-dashed border-indigo-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer group"
            onClick={handleViewWarehouse}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 group-hover:text-indigo-700 transition-colors">
                    {currentHub?.name} — Warehouse
                  </h3>
                  <p className="text-xs text-gray-500">Central inventory hub • {warehouseProductCount} products</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden md:flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate('/stock-transfer'); }}
                    className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-100 hover:bg-indigo-200 rounded-lg transition-colors"
                  >
                    Transfer Stock
                  </button>
                </div>
                <svg className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Store Cards */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg md:text-xl font-bold text-gray-800">Your Stores</h2>
          <button
            onClick={() => navigate('/store-management')}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors"
          >
            Manage
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-1/2 mb-4"></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-14 bg-gray-100 rounded-lg"></div>
                  <div className="h-14 bg-gray-100 rounded-lg"></div>
                </div>
              </div>
            ))
          ) : stores.length === 0 ? (
            <div className="col-span-full bg-white p-8 md:p-12 rounded-xl shadow-sm border border-gray-100 text-center">
              <svg className="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No stores yet</h3>
              <p className="text-sm text-gray-500 mb-4">Create your first store to start managing inventory</p>
              <button
                onClick={() => navigate('/store-management')}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-all shadow-sm"
              >
                + Create Store
              </button>
            </div>
          ) : (
            stores.map((store) => {
              const stats = storeStats.get(store.id!) || { totalSales: 0, totalProfit: 0, productCount: 0, todayOrders: 0 };
              return (
                <div
                  key={store.id}
                  className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer group"
                  onClick={() => handleSelectStore(store.id!)}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-100">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900 group-hover:text-blue-700 transition-colors">{store.name}</h3>
                        {store.address && <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{store.address}</p>}
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-blue-50/70 p-2.5 rounded-lg">
                      <p className="text-[9px] text-gray-400 uppercase font-semibold tracking-wider">Sales</p>
                      <p className="text-sm font-bold text-blue-700">₹{stats.totalSales.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-emerald-50/70 p-2.5 rounded-lg">
                      <p className="text-[9px] text-gray-400 uppercase font-semibold tracking-wider">Profit</p>
                      <p className="text-sm font-bold text-emerald-700">₹{stats.totalProfit.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-purple-50/70 p-2.5 rounded-lg">
                      <p className="text-[9px] text-gray-400 uppercase font-semibold tracking-wider">Products</p>
                      <p className="text-sm font-bold text-purple-700">{stats.productCount}</p>
                    </div>
                    <div className="bg-amber-50/70 p-2.5 rounded-lg">
                      <p className="text-[9px] text-gray-400 uppercase font-semibold tracking-wider">Orders</p>
                      <p className="text-sm font-bold text-amber-700">{stats.todayOrders}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Recent Stock Transfers */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              </div>
              <h2 className="text-base font-bold text-gray-800">Recent Transfers</h2>
            </div>
            <button
              onClick={() => navigate('/stock-transfer')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              View All
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          {recentTransfers.length === 0 ? (
            <div className="p-8 text-center">
              <svg className="w-12 h-12 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <p className="text-sm text-gray-400 mb-3">No transfers yet</p>
              <button
                onClick={() => navigate('/stock-transfer')}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Create First Transfer →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentTransfers.slice(0, 5).map((transfer) => (
                <div
                  key={transfer.id}
                  className="p-4 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  onClick={() => setExpandedTransfer(expandedTransfer === transfer.id ? null : transfer.id!)}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-semibold text-gray-800 truncate">{transfer.fromStoreName}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="w-6 h-px bg-gray-300" />
                        <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        <div className="w-6 h-px bg-gray-300" />
                      </div>
                      <span className="text-sm font-semibold text-gray-800 truncate">{transfer.toStoreName}</span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ml-2 flex items-center gap-1 flex-shrink-0 ${getTransferStatusColor(transfer.status)}`}>
                      {getTransferStatusIcon(transfer.status)}
                      {transfer.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-gray-400">
                    <span>{transfer.totalQuantity} items</span>
                    <span>•</span>
                    <span>₹{transfer.totalValue?.toLocaleString('en-IN')}</span>
                    <span>•</span>
                    <span>{transfer.createdAt instanceof Date ? transfer.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</span>
                    {transfer.createdByName && <>
                      <span>•</span>
                      <span>by {transfer.createdByName}</span>
                    </>}
                  </div>
                  {/* Expanded items */}
                  {expandedTransfer === transfer.id && transfer.items && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {transfer.items.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-lg">
                            <span className="text-xs text-gray-700 font-medium truncate">{item.productName}</span>
                            <span className="text-xs text-gray-500 flex-shrink-0 ml-2">×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                      {transfer.notes && <p className="text-xs text-gray-400 mt-2 italic">📝 {transfer.notes}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HubDashboard;
