import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import CustomLoader from '../components/CustomLoader';
import RevenueChart from '../components/RevenueChart';
import PaymentMethodsChart from '../components/PaymentMethodsChart';
import TopProductsChart from '../components/TopProductsChart';
import { useBillingItems, useProducts, useCreditSales } from '../hooks/useFirestoreCache';
import { isExpenseItem } from '../types';
import { getItemFinancials } from './OverallSales';
const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // State for date filter
  const [dateFilter, setDateFilter] = useState<'today' | 'last7days' | 'last30days'>('today');
  const [activeAlertTab, setActiveAlertTab] = useState<'lowStock' | 'pending' | 'smart'>('lowStock');

  // Calculate date range based on filter
  const getDateRange = (filter: 'today' | 'last7days' | 'last30days') => {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date();

    if (filter === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'last7days') {
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'last30days') {
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
    }

    return { startDate, endDate };
  };

  const { startDate, endDate } = getDateRange(dateFilter);

  // Use React Query for data fetching with caching
  const { data: billingData, isLoading: loadingBilling } = useBillingItems(startDate, endDate, 200);
  const billingItems = billingData?.items || [];

  // Fetch products for low stock alerts
  const { data: products, isLoading: loadingProducts } = useProducts(500);

  // Fetch credit sales for pending collections
  const { data: creditSalesData, isLoading: loadingCredits } = useCreditSales(undefined, undefined, 100);
  const creditSales = creditSalesData?.items || [];

  const loading = loadingBilling || loadingProducts || loadingCredits;

  // Calculate stats
  // Logic updated to match OverallSales.tsx
  const salesEntries = useMemo(() =>
    billingItems.filter(item => !isExpenseItem(item)),
    [billingItems]
  );

  const recentSales = useMemo(() =>
    salesEntries.filter(item => item.sellingPrice > 0).slice(0, 5),
    [salesEntries]
  );

  const topCustomers = useMemo(() => {
    const customerMap = new Map<string, { name: string; total: number; orders: number }>();
    salesEntries.forEach(item => {
      if (item.sellingPrice > 0 && item.customerName) {
        const existing = customerMap.get(item.customerName) || { name: item.customerName, total: 0, orders: 0 };
        existing.total += getItemFinancials(item).netTotal;
        existing.orders += 1;
        customerMap.set(item.customerName, existing);
      }
    });
    return Array.from(customerMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [salesEntries]);

  const expenseEntries = useMemo(() =>
    billingItems.filter(isExpenseItem),
    [billingItems]
  );

  const totalSales = useMemo(() =>
    salesEntries
      .reduce((sum, item) => sum + getItemFinancials(item).netTotal, 0),
    [salesEntries]
  );

  const soldItems = useMemo(() =>
    salesEntries
      .reduce((sum, item) => sum + (item.quantity || 0), 0),
    [salesEntries]
  );

  // This is now "Total Expenses" instead of "Total Purchase Cost of Sold Items"
  const totalPurchase = useMemo(() =>
    expenseEntries
      .reduce((sum, item) => sum + Math.abs((item.cost || item.profit || 0) * (item.quantity || 1)), 0),
    [expenseEntries]
  );

  const totalProfit = useMemo(() => {
    const grossProfit = salesEntries.reduce((sum, item) => sum + getItemFinancials(item).totalProfit, 0);
    const expenses = expenseEntries.reduce((sum, item) => sum + Math.abs((item.cost || item.profit || 0) * (item.quantity || 1)), 0);
    return grossProfit - expenses;
  }, [salesEntries, expenseEntries]);



  // Group sales by product
  const topSellingProducts = useMemo(() => {
    const productMap = new Map<string, { title: string; quantity: number; sales: number }>();

    billingItems
      .filter(item => item.sellingPrice > 0)
      .forEach(item => {
        const fin = getItemFinancials(item);
        const existing = productMap.get(item.title) || { title: item.title, quantity: 0, sales: 0 };
        existing.quantity += item.quantity;
        existing.sales += fin.netTotal;
        productMap.set(item.title, existing);
      });

    return Array.from(productMap.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 6);
  }, [billingItems]);

  // Get unique counts
  const uniqueSuppliers = useMemo(() => {
    const suppliers = new Set(billingItems.map(item => item.createdBy).filter(Boolean));
    return suppliers.size;
  }, [billingItems]);

  const uniqueCustomers = useMemo(() => {
    const customers = new Set(
      billingItems
        .filter(item => item.customerName)
        .map(item => item.customerName)
    );
    return customers.size;
  }, [billingItems]);

  // Calculate low stock products (quantity < 5)
  const lowStockProducts = useMemo(() => {
    if (!products) return [];
    return products.filter((p: any) => p.quantity > 0 && p.quantity < 5 && p.isAvailable !== false);
  }, [products]);

  // Calculate pending credit sales
  const pendingCredits = useMemo(() => {
    return creditSales.filter((item: any) => !item.isPaid || (item.remainingAmount && item.remainingAmount > 0));
  }, [creditSales]);

  // Calculate total pending amount
  const totalPendingAmount = useMemo(() => {
    return pendingCredits.reduce((sum: number, item: any) => {
      const remaining = item.remainingAmount || (item.sellingPrice * item.quantity);
      return sum + remaining;
    }, 0);
  }, [pendingCredits]);

  // Generate smart suggestions
  const smartSuggestions = useMemo(() => {
    const suggestions: string[] = [];

    if (lowStockProducts.length > 0) {
      suggestions.push(`${lowStockProducts.length} product${lowStockProducts.length > 1 ? 's' : ''} running low on stock`);
    }

    if (totalPendingAmount > 0) {
      suggestions.push(`₹${totalPendingAmount.toLocaleString('en-IN')} pending collection from ${pendingCredits.length} customer${pendingCredits.length > 1 ? 's' : ''}`);
    }

    if (topSellingProducts.length > 0 && topSellingProducts[0]) {
      suggestions.push(`Best seller: ${topSellingProducts[0].title} - ${topSellingProducts[0].quantity} units`);
    }

    const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
    if (profitMargin > 0) {
      suggestions.push(`Average profit margin: ${profitMargin.toFixed(1)}%`);
    }

    return suggestions;
  }, [lowStockProducts, pendingCredits, totalPendingAmount, topSellingProducts, totalProfit, totalSales]);

  if (loading) {
    return (
      <>
        <Navbar />
        <CustomLoader message="Loading dashboard..." />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-6">
        {/* Welcome Section */}
        <div className="mb-4 md:mb-6 bg-white rounded-xl shadow-sm p-4 md:p-6 border border-blue-100">
          <div className="flex flex-col gap-3">
            {/* Header Row: Greeting & Time */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl md:text-3xl font-bold text-gray-800 leading-tight">
                  Hi, {currentUser?.displayName?.split(' ')[0] || 'Admin'}
                </h1>
                <p className="text-sm md:text-base text-gray-600 mt-1">
                  <span className="font-bold text-blue-600">{billingItems.length}</span> orders {dateFilter === 'today' ? 'today' : dateFilter === 'last7days' ? 'this week' : 'this month'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs md:text-sm font-semibold text-gray-500 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                  {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">
                  {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>

            {/* Date Filter Buttons - Desktop Style */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setDateFilter('today')}
                className={`px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-200 border ${dateFilter === 'today'
                  ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
              >
                Today
              </button>
              <button
                onClick={() => setDateFilter('last7days')}
                className={`px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-200 border ${dateFilter === 'last7days'
                  ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
              >
                Last 7 Days
              </button>
              <button
                onClick={() => setDateFilter('last30days')}
                className={`px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-200 border ${dateFilter === 'last30days'
                  ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
              >
                Last 30 Days
              </button>
            </div>
          </div>
        </div>

        {/* Key Stats Cards - Mobile Optimized */}
        <h2 className="text-base md:text-lg font-bold text-gray-800 mb-3 px-1">Overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
          <div className="bg-gradient-to-br from-blue-50 to-white p-2 md:p-5 rounded-xl shadow-sm border border-blue-100">
            <div className="flex items-center justify-between mb-1 md:mb-2">
              <p className="text-[10px] md:text-sm text-gray-600 font-medium">Total Sales</p>
              <div className="w-6 h-6 md:w-10 md:h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-3 h-3 md:w-5 md:h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <h3 className="text-base md:text-2xl font-bold text-blue-600 truncate">₹{totalSales.toLocaleString('en-IN')}</h3>
            <p className="text-[9px] md:text-xs text-gray-500 mt-1 truncate">+{billingItems.filter(i => i.sellingPrice > 0).length} transactions</p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-white p-2 md:p-5 rounded-xl shadow-sm border border-purple-100">
            <div className="flex items-center justify-between mb-1 md:mb-2">
              <p className="text-[10px] md:text-sm text-gray-600 font-medium">Items Sold</p>
              <div className="w-6 h-6 md:w-10 md:h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-3 h-3 md:w-5 md:h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            </div>
            <h3 className="text-base md:text-2xl font-bold text-purple-600 truncate">{soldItems}</h3>
            <p className="text-[9px] md:text-xs text-gray-500 mt-1 truncate">Products sold</p>
          </div>

          <div className="bg-gradient-to-br from-red-50 to-white p-2 md:p-5 rounded-xl shadow-sm border border-red-100">
            <div className="flex items-center justify-between mb-1 md:mb-2">
              <p className="text-[10px] md:text-sm text-gray-600 font-medium">Expense</p>
              <div className="w-6 h-6 md:w-10 md:h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <svg className="w-3 h-3 md:w-5 md:h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
            </div>
            <h3 className="text-base md:text-2xl font-bold text-red-600 truncate">₹{totalPurchase.toLocaleString('en-IN')}</h3>
            <p className="text-[9px] md:text-xs text-gray-500 mt-1 truncate">Total investment</p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-white p-2 md:p-5 rounded-xl shadow-sm border border-green-100">
            <div className="flex items-center justify-between mb-1 md:mb-2">
              <p className="text-[10px] md:text-sm text-gray-600 font-medium">Total Profit</p>
              <div className="w-6 h-6 md:w-10 md:h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-3 h-3 md:w-5 md:h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
            </div>
            <h3 className="text-base md:text-2xl font-bold text-green-600 truncate">₹{totalProfit.toLocaleString('en-IN')}</h3>
            <p className="text-[9px] md:text-xs text-gray-500 mt-1 truncate">Net earnings</p>
          </div>
        </div>

        {/* Quick Actions - Navigation Shortcuts */}
        <div className="mb-4 md:mb-6">
          <h2 className="text-base md:text-lg font-bold text-gray-800 mb-3 px-1">Quick Actions</h2>
          <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-3">
            <button
              onClick={() => navigate('/billing')}
              className="bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-blue-200 hover:border-blue-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-blue-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">New Sale</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/add-purchase')}
              className="bg-gradient-to-br from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-purple-200 hover:border-purple-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-purple-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Purchase</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/products')}
              className="bg-gradient-to-br from-teal-50 to-teal-100 hover:from-teal-100 hover:to-teal-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-teal-200 hover:border-teal-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-teal-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Product</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/overall-sales')}
              className="bg-gradient-to-br from-green-50 to-green-100 hover:from-green-100 hover:to-green-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-green-200 hover:border-green-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-green-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Reports</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/defect-management')}
              className="bg-gradient-to-br from-orange-50 to-orange-100 hover:from-orange-100 hover:to-orange-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-orange-200 hover:border-orange-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-orange-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Defects</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/add-expense')}
              className="bg-gradient-to-br from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-red-200 hover:border-red-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-red-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Expense</span>
              </div>
            </button>

            <button
              onClick={() => navigate(currentUser?.role === 'employee' ? '/employee-dashboard' : '/employee-management')}
              className="bg-gradient-to-br from-indigo-50 to-indigo-100 hover:from-indigo-100 hover:to-indigo-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-indigo-200 hover:border-indigo-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-indigo-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Attendance</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/customers')}
              className="bg-gradient-to-br from-pink-50 to-pink-100 hover:from-pink-100 hover:to-pink-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-pink-200 hover:border-pink-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-pink-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Customers</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/service-management')}
              className="bg-gradient-to-br from-cyan-50 to-cyan-100 hover:from-cyan-100 hover:to-cyan-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-cyan-200 hover:border-cyan-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-cyan-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Service</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/stock-requirement')}
              className="bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-amber-200 hover:border-amber-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-amber-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Req. Stock</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/recharge-accounts')}
              className="bg-gradient-to-br from-violet-50 to-violet-100 hover:from-violet-100 hover:to-violet-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-violet-200 hover:border-violet-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-violet-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Recharge</span>
              </div>
            </button>

            <button
              onClick={() => navigate('/recharge-report')}
              className="bg-gradient-to-br from-rose-50 to-rose-100 hover:from-rose-100 hover:to-rose-200 p-2 md:p-4 rounded-lg transition-all duration-200 border border-rose-200 hover:border-rose-300 hover:shadow-md"
            >
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="w-8 h-8 md:w-12 md:h-12 bg-rose-500 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <span className="text-[10px] md:text-sm font-medium text-gray-700 text-center leading-tight">Rech. Report</span>
              </div>
            </button>
          </div>
        </div>

        {/* Alerts & Insights - Actionable Information */}
        {(lowStockProducts.length > 0 || pendingCredits.length > 0 || smartSuggestions.length > 0) && (
          <div className="mb-4 md:mb-6">
            <h2 className="text-base md:text-lg font-bold text-gray-800 mb-3 px-1">Alerts & Insights</h2>

            {/* Mobile Tabs */}
            <div className="flex p-1 mb-3 bg-gray-100 rounded-lg lg:hidden overflow-x-auto scrollbar-hide">
              {lowStockProducts.length > 0 && (
                <button
                  onClick={() => setActiveAlertTab('lowStock')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-all ${activeAlertTab === 'lowStock'
                    ? 'bg-white text-amber-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  Low Stock
                </button>
              )}
              {pendingCredits.length > 0 && (
                <button
                  onClick={() => setActiveAlertTab('pending')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-all ${activeAlertTab === 'pending'
                    ? 'bg-white text-red-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  Pending
                </button>
              )}
              {smartSuggestions.length > 0 && (
                <button
                  onClick={() => setActiveAlertTab('smart')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-all ${activeAlertTab === 'smart'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  Insights
                </button>
              )}
            </div>

            {/* Content Container - Mobile (Tabbed) & Desktop (Grid) */}
            <div className="block lg:hidden">
              {activeAlertTab === 'lowStock' && lowStockProducts.length > 0 && (
                <div className="bg-gradient-to-br from-amber-50 to-white p-4 rounded-xl shadow-sm border border-amber-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-bold text-amber-900">Low Stock Alert</h3>
                  </div>
                  <p className="text-xs text-amber-800 mb-3">{lowStockProducts.length} product{lowStockProducts.length > 1 ? 's' : ''} running low</p>
                  <div className="space-y-2 mb-3 max-h-48 overflow-y-auto scrollbar-hide">
                    {lowStockProducts.slice(0, 5).map((product: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-white rounded-lg p-2 border border-amber-100">
                        <span className="font-medium text-gray-700 truncate flex-1">{product.name}</span>
                        <span className="text-amber-600 font-bold ml-2">{product.quantity} left</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => navigate('/products')}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Manage Stock
                  </button>
                </div>
              )}

              {activeAlertTab === 'pending' && pendingCredits.length > 0 && (
                <div className="bg-gradient-to-br from-red-50 to-white p-4 rounded-xl shadow-sm border border-red-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-bold text-red-900">Pending Collections</h3>
                  </div>
                  <p className="text-xs text-red-800 mb-1">₹{totalPendingAmount.toLocaleString('en-IN')} pending</p>
                  <p className="text-xs text-red-600 mb-3">{pendingCredits.length} customer{pendingCredits.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2 mb-3 max-h-48 overflow-y-auto scrollbar-hide">
                    {pendingCredits.slice(0, 5).map((credit: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-white rounded-lg p-2 border border-red-100">
                        <span className="font-medium text-gray-700 truncate flex-1">
                          {credit.creditCustomerName || credit.customerName || 'Customer'}
                        </span>
                        <span className="text-red-600 font-bold ml-2">
                          ₹{(credit.remainingAmount || (credit.sellingPrice * credit.quantity)).toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => navigate('/customers')}
                    className="w-full bg-red-500 hover:bg-red-600 text-white text-xs font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Collect Payments
                  </button>
                </div>
              )}

              {activeAlertTab === 'smart' && smartSuggestions.length > 0 && (
                <div className="bg-gradient-to-br from-blue-50 to-white p-4 rounded-xl shadow-sm border border-blue-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-bold text-blue-900">Smart Insights</h3>
                  </div>
                  <div className="space-y-2">
                    {smartSuggestions.map((suggestion, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs bg-white rounded-lg p-2 border border-blue-100">
                        <svg className="w-3 h-3 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-gray-700 flex-1">{suggestion}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Desktop Grid Layout (Hidden on Mobile) */}
            <div className="hidden lg:grid grid-cols-3 gap-4">
              {/* Low Stock Alert */}
              {lowStockProducts.length > 0 && (
                <div className="bg-gradient-to-br from-amber-50 to-white p-5 rounded-xl shadow-sm border border-amber-200 h-full">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-bold text-amber-900">Low Stock Alert</h3>
                  </div>
                  <p className="text-xs text-amber-800 mb-3">{lowStockProducts.length} product{lowStockProducts.length > 1 ? 's' : ''} running low</p>
                  <div className="space-y-2 mb-3 max-h-32 overflow-y-auto">
                    {lowStockProducts.slice(0, 3).map((product: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-white rounded-lg p-2 border border-amber-100">
                        <span className="font-medium text-gray-700 truncate flex-1">{product.name}</span>
                        <span className="text-amber-600 font-bold ml-2">{product.quantity} left</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => navigate('/products')}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Manage Stock
                  </button>
                </div>
              )}

              {/* Pending Credits */}
              {pendingCredits.length > 0 && (
                <div className="bg-gradient-to-br from-red-50 to-white p-5 rounded-xl shadow-sm border border-red-200 h-full">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-bold text-red-900">Pending Collections</h3>
                  </div>
                  <p className="text-xs text-red-800 mb-1">₹{totalPendingAmount.toLocaleString('en-IN')} pending</p>
                  <p className="text-xs text-red-600 mb-3">{pendingCredits.length} customer{pendingCredits.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2 mb-3 max-h-32 overflow-y-auto">
                    {pendingCredits.slice(0, 3).map((credit: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-white rounded-lg p-2 border border-red-100">
                        <span className="font-medium text-gray-700 truncate flex-1">
                          {credit.creditCustomerName || credit.customerName || 'Customer'}
                        </span>
                        <span className="text-red-600 font-bold ml-2">
                          ₹{(credit.remainingAmount || (credit.sellingPrice * credit.quantity)).toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => navigate('/customers')}
                    className="w-full bg-red-500 hover:bg-red-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Collect Payments
                  </button>
                </div>
              )}

              {/* Smart Suggestions */}
              {smartSuggestions.length > 0 && (
                <div className="bg-gradient-to-br from-blue-50 to-white p-5 rounded-xl shadow-sm border border-blue-200 h-full">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-bold text-blue-900">Smart Insights</h3>
                  </div>
                  <div className="space-y-2">
                    {smartSuggestions.map((suggestion, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs bg-white rounded-lg p-2 border border-blue-100">
                        <svg className="w-3 h-3 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-gray-700 flex-1">{suggestion}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sales & Purchase Chart */}
        <div className="mb-4 md:mb-6">
          <RevenueChart
            items={billingItems}
            days={dateFilter === 'today' ? 1 : dateFilter === 'last7days' ? 7 : 30}
            type="area"
          />
        </div>

        {/* Two Column Layout - Charts & Info */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6">
          {/* Payment Methods Chart - 2 columns */}
          <div className="lg:col-span-2">
            <PaymentMethodsChart items={billingItems} />
          </div>

          {/* Overall Information - 1 column */}
          <div className="bg-white rounded-xl shadow-sm border-2 border-gray-100 p-4 md:p-6">
            <h3 className="text-lg md:text-xl font-bold text-gray-800 mb-4">Overall Information</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3 md:gap-4">
              <div className="flex items-center justify-between p-3 bg-white rounded-lg border-2 border-blue-100 hover:border-blue-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-white border-2 border-blue-300 rounded-lg flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 md:w-5 md:h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs md:text-sm text-gray-600">Suppliers</p>
                    <p className="text-lg md:text-xl font-bold text-gray-800">{uniqueSuppliers}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-white rounded-lg border-2 border-purple-100 hover:border-purple-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-white border-2 border-purple-300 rounded-lg flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 md:w-5 md:h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs md:text-sm text-gray-600">Customers</p>
                    <p className="text-lg md:text-xl font-bold text-gray-800">{uniqueCustomers}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-white rounded-lg border-2 border-orange-100 hover:border-orange-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-white border-2 border-orange-300 rounded-lg flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 md:w-5 md:h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs md:text-sm text-gray-600">Products</p>
                    <p className="text-lg md:text-xl font-bold text-gray-800">{soldItems}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Overview */}
            <div className="mt-6 pt-6 border-t-2 border-gray-100">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Customer Overview</h4>
              <div className="flex items-center justify-center gap-4">
                <div className="relative w-32 h-32">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="56" fill="none" stroke="#E5E7EB" strokeWidth="12" />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      fill="none"
                      stroke="#93C5FD"
                      strokeWidth="12"
                      strokeDasharray={`${(uniqueCustomers / (uniqueCustomers + uniqueSuppliers)) * 351.86} 351.86`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-2xl font-bold text-gray-800">{uniqueCustomers}</p>
                    <p className="text-xs text-gray-500">Total</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-300 rounded-full"></div>
                    <span className="text-xs text-gray-600">Active</span>
                    <span className="text-xs font-semibold">{Math.floor(uniqueCustomers * 0.8)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                    <span className="text-xs text-gray-600">Inactive</span>
                    <span className="text-xs font-semibold">{Math.ceil(uniqueCustomers * 0.2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top Selling Products - Full Width */}
        <div className="mb-4 md:mb-6">
          <div className="bg-white rounded-xl shadow-sm border-2 border-gray-100 p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg md:text-xl font-bold text-gray-800">Top Selling Products</h3>
              <button className="text-sm text-blue-500 hover:text-blue-600 font-medium">View All →</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {topSellingProducts.map((product, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg border-2 border-orange-100 hover:border-orange-200 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-white border-2 border-orange-300 rounded-lg flex items-center justify-center text-orange-500 font-bold shrink-0">
                      {product.title.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{product.title}</p>
                      <p className="text-xs text-gray-500">Sold: {product.quantity} units</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-sm font-bold text-blue-500">₹{product.sales.toFixed(0)}</p>
                  </div>
                </div>
              ))}
              {topSellingProducts.length === 0 && (
                <div className="col-span-full">
                  <p className="text-center text-gray-400 py-8 text-sm">No sales data available</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Row - Stats, Customers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {/* Recent Sales */}
          <div className="bg-white rounded-xl shadow-sm border-2 border-gray-100 p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg md:text-xl font-bold text-gray-800">Recent Sales</h3>
              <span className="text-xs text-gray-500">Today</span>
            </div>

            <div className="space-y-3">
              {recentSales.map((sale, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg border-2 border-green-100 hover:border-green-200 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 bg-white border-2 border-green-300 rounded-full flex items-center justify-center text-green-500 text-xs font-bold shrink-0">
                      {sale.title.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 text-sm truncate">{sale.title}</p>
                      <p className="text-xs text-gray-500">Qty: {sale.quantity}</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-green-500 shrink-0 ml-2">₹{sale.sellingPrice}</span>
                </div>
              ))}
              {recentSales.length === 0 && (
                <p className="text-center text-gray-400 py-8 text-sm">No recent sales</p>
              )}
            </div>
          </div>

          {/* Top Customers */}
          <div className="bg-white rounded-xl shadow-sm border-2 border-gray-100 p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg md:text-xl font-bold text-gray-800">Top Customers</h3>
              <button className="text-sm text-blue-500 hover:text-blue-600 font-medium">View All →</button>
            </div>

            <div className="space-y-3">
              {topCustomers.map((customer, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg border-2 border-blue-100 hover:border-blue-200 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-white border-2 border-blue-300 rounded-full flex items-center justify-center text-blue-500 font-bold text-sm shrink-0">
                      {customer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{customer.name}</p>
                      <p className="text-xs text-gray-500">{customer.orders} orders</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-blue-500 shrink-0 ml-2">₹{customer.total.toFixed(0)}</span>
                </div>
              ))}
              {topCustomers.length === 0 && (
                <p className="text-center text-gray-400 py-8 text-sm">No customer data available</p>
              )}
            </div>
          </div>
        </div>

        {/* Top Products Chart */}
        <div className="mt-4 md:mt-6">
          <TopProductsChart items={billingItems} />
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
