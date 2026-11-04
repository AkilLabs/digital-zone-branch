import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAttendance } from '@/context/AttendanceContext';
import { useStore } from '../context/StoreContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { hasRouteAccess } from '../config/rolePermissions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import logo from '../assets/logo.png';
import {
  Menu,
  X,
  Search,
  LayoutDashboard,
  Receipt,
  FileText,
  Wallet,
  Users,
  Package,
  Boxes,
  TrendingUp,
  ShoppingBag,
  PlusCircle,
  Smartphone,
  Tag,
  AlertTriangle,
  Truck,
  Sliders,
  Wrench,
  Plus,
  Zap,
  Radio,
  BarChart3,
  UserCheck,
  UserPlus,
  Settings,
  Clock,
  User,
  LogOut
} from 'lucide-react';

interface MenuItem {
  title: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  badge?: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const Navbar: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const { isCheckedIn } = useAttendance();
  const { currentStore } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const sidebarRef = useRef<HTMLDivElement>(null);

  const isOwner = currentUser?.role === 'owner';
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'store-admin' || currentUser?.role === 'hub-admin';
  const isEmployee = currentUser?.role === 'employee';

  // Navigation visibility logic
  const showNavigation = isOwner || isAdmin || (isEmployee && isCheckedIn);

  // Role-based route access check helper
  const canAccess = useCallback((path: string) => {
    if (!currentUser) return false;
    return hasRouteAccess(currentUser.role, path);
  }, [currentUser]);

  // Recharge toggle state - synced with currentStore (0 reads) or Firestore/localStorage fallback
  const [rechargeEnabled, setRechargeEnabled] = useState<boolean>(() => {
    if (typeof currentStore?.rechargeEnabled === 'boolean') {
      return currentStore.rechargeEnabled;
    }
    const cached = localStorage.getItem('recharge_enabled');
    return cached !== null ? cached === 'true' : true;
  });

  useEffect(() => {
    if (typeof currentStore?.rechargeEnabled === 'boolean') {
      setRechargeEnabled(currentStore.rechargeEnabled);
      localStorage.setItem('recharge_enabled', String(currentStore.rechargeEnabled));
      return;
    }

    const unsub = onSnapshot(doc(db, 'settings', 'projectSettings'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (typeof data.rechargeEnabled === 'boolean') {
          setRechargeEnabled(data.rechargeEnabled);
          localStorage.setItem('recharge_enabled', String(data.rechargeEnabled));
        }
      }
    }, (err) => {
      console.warn('Could not listen to projectSettings:', err);
    });

    const handleCustomEvent = (e: any) => {
      if (typeof e.detail?.rechargeEnabled === 'boolean') {
        setRechargeEnabled(e.detail.rechargeEnabled);
      } else {
        const cached = localStorage.getItem('recharge_enabled');
        if (cached !== null) {
          setRechargeEnabled(cached === 'true');
        }
      }
    };
    window.addEventListener('recharge-setting-changed', handleCustomEvent);

    return () => {
      unsub();
      window.removeEventListener('recharge-setting-changed', handleCustomEvent);
    };
  }, [currentStore?.id, currentStore?.rechargeEnabled]);

  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setShowSidebar(false);
      }
    };

    if (showSidebar) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSidebar]);

  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showSidebar) {
          setShowSidebar(false);
          setSearchQuery('');
        }
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showSidebar]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
      alert('Failed to logout. Please try again.');
    }
  };

  const handleNavigation = (path: string) => {
    navigate(path);
    setShowSidebar(false);
    setSearchQuery('');
  };

  const isActiveRoute = useCallback((path: string) => {
    if (path === '/dashboard') {
      return location.pathname === '/dashboard' || location.pathname === '/';
    }
    return location.pathname === path || (path !== '/' && location.pathname.startsWith(path + '/'));
  }, [location.pathname]);

  // Memoized sidebar navigation sections based on roles and permissions
  const menuSections: MenuSection[] = useMemo(() => {
    const sections: MenuSection[] = [];

    // Main Workspace
    if (!isEmployee) {
      const mainItems: MenuItem[] = [
        ...(canAccess('/dashboard') ? [{ title: 'Home', path: '/dashboard', icon: LayoutDashboard, keywords: ['dashboard', 'home', 'main', 'overview'] }] : []),
        ...(canAccess('/billing') ? [{ title: 'Billing & POS', path: '/billing', icon: Receipt, keywords: ['bill', 'invoice', 'pos', 'cashier', 'checkout', 'sale'] }] : []),
        ...(canAccess('/quotations') ? [{ title: 'Quotations', path: '/quotations', icon: FileText, keywords: ['quote', 'estimate', 'price estimate'] }] : []),
        ...(canAccess('/add-expense') ? [{ title: 'Add Expense', path: '/add-expense', icon: Wallet, keywords: ['expense', 'spending', 'cost', 'cash out'] }] : []),
        ...(canAccess('/customers') ? [{ title: 'Customers', path: '/customers', icon: Users, keywords: ['client', 'directory', 'phone', 'customer details'] }] : []),
      ];
      if (mainItems.length > 0) sections.push({ title: 'Workspace', items: mainItems });
    }

    // Inventory & Stock
    const inventoryItems: MenuItem[] = [
      ...(!isEmployee ? [{ title: 'Products', path: '/products', icon: Package, keywords: ['items', 'inventory', 'catalog', 'stock'] }] : []),
      { title: 'Stock Requirement', path: '/stock-requirement', icon: Boxes, keywords: ['low stock', 'order', 'requirement'] },
      ...(!isEmployee && canAccess('/stock-value') ? [{ title: 'Stock Value', path: '/stock-value', icon: TrendingUp, keywords: ['valuation', 'worth', 'cost', 'assets'] }] : []),
      ...(!isEmployee && canAccess('/purchases') ? [{ title: 'Purchases', path: '/purchases', icon: ShoppingBag, keywords: ['buy', 'vendor', 'purchase bills'] }] : []),
      ...(!isEmployee && canAccess('/add-purchase') ? [{ title: 'Add Purchase', path: '/add-purchase', icon: PlusCircle, keywords: ['new purchase', 'stock in'] }] : []),
      ...(!isEmployee && canAccess('/add-purchase-imei') ? [{ title: 'Add Purchase (IMEI)', path: '/add-purchase-imei', icon: Smartphone, keywords: ['phone purchase', 'imei', 'serial'] }] : []),
      ...(!isEmployee ? [{ title: 'Tamper Box Labels', path: '/tamper-labels', icon: Tag, keywords: ['barcode', 'label', 'qr', 'print', 'tamper'] }] : []),
      ...(!isEmployee && canAccess('/defect-management') ? [{ title: 'Defect & Damage', path: '/defect-management', icon: AlertTriangle, keywords: ['faulty', 'damaged', 'broken', 'return'] }] : []),
      ...(!isEmployee && canAccess('/suppliers') ? [{ title: 'Suppliers', path: '/suppliers', icon: Truck, keywords: ['vendor', 'dealer', 'distributor'] }] : []),
      ...(!isEmployee && canAccess('/master') ? [{ title: 'Master Settings', path: '/master', icon: Sliders, keywords: ['brand', 'category', 'configuration', 'master'] }] : []),
    ];
    if (inventoryItems.length > 0) sections.push({ title: 'Inventory & Stock', items: inventoryItems });

    // Services
    const serviceItems: MenuItem[] = [
      ...(canAccess('/service-management') ? [{ title: 'Service Management', path: '/service-management', icon: Wrench, keywords: ['repair', 'job sheet', 'device service', 'fix'] }] : []),
      ...(canAccess('/service-management/create') ? [{ title: 'New Service Job', path: '/service-management/create', icon: Plus, keywords: ['create job', 'receive device', 'new repair'] }] : []),
    ];
    if (serviceItems.length > 0) sections.push({ title: 'Services & Repairs', items: serviceItems });

    // Recharge (if enabled)
    if (!isEmployee && rechargeEnabled) {
      const rechargeItems: MenuItem[] = [
        { title: 'Recharge Accounts', path: '/recharge-accounts', icon: Smartphone, keywords: ['mobile', 'dth', 'balance', 'recharge'] },
        { title: 'Bulk Recharge', path: '/bulk-recharge', icon: Zap, keywords: ['quick recharge', 'topup', 'fast'] },
        ...(canAccess('/recharge-report') ? [{ title: 'Recharge Report', path: '/recharge-report', icon: FileText, keywords: ['history', 'recharge log', 'transactions'] }] : []),
        ...(canAccess('/provider-management') ? [{ title: 'Providers', path: '/provider-management', icon: Radio, keywords: ['airtel', 'jio', 'vi', 'bsnl', 'operator'] }] : []),
      ];
      if (rechargeItems.length > 0) sections.push({ title: 'Recharge Operations', items: rechargeItems });
    }

    // Reports & Turnover
    if (!isEmployee && (canAccess('/overall-sales') || canAccess('/settlement'))) {
      sections.push({
        title: 'Turnover & Reports',
        items: [
          { title: 'Sales Report & Settlement', path: '/overall-sales', icon: BarChart3, keywords: ['revenue', 'turnover', 'profit', 'daily report', 'closing', 'settlement'] }
        ]
      });
    }

    // Administration
    if (!isEmployee) {
      const adminItems: MenuItem[] = [
        ...(canAccess('/employee-management') ? [{ title: 'Employees', path: '/employee-management', icon: UserCheck, keywords: ['staff', 'workers', 'team', 'attendance'] }] : []),
        ...(canAccess('/add-employee') ? [{ title: 'Add User', path: '/add-employee', icon: UserPlus, keywords: ['create employee', 'new staff', 'register user'] }] : []),
        ...(canAccess('/settings') ? [{ title: 'System Settings', path: '/settings', icon: Settings, keywords: ['config', 'shop details', 'preferences', 'system'] }] : []),
      ];
      if (adminItems.length > 0) sections.push({ title: 'Administration', items: adminItems });
    }

    // Employee Workspace
    if (isEmployee) {
      sections.push({
        title: 'My Workspace',
        items: [
          { title: 'My Attendance', path: '/employee-dashboard', icon: Clock, keywords: ['check in', 'check out', 'time', 'attendance'] },
          { title: 'My Profile', path: '/employee-profile', icon: User, keywords: ['account', 'details', 'my info'] },
        ]
      });
    }

    return sections;
  }, [isEmployee, rechargeEnabled, canAccess]);

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return menuSections;
    const q = searchQuery.toLowerCase().trim();
    return menuSections
      .map(section => ({
        ...section,
        items: section.items.filter(item =>
          item.title.toLowerCase().includes(q) ||
          item.path.toLowerCase().includes(q) ||
          item.keywords?.some(k => k.toLowerCase().includes(q))
        )
      }))
      .filter(section => section.items.length > 0);
  }, [menuSections, searchQuery]);

  return (
    <>
      <header className="bg-slate-50/95 text-gray-900 border-b border-slate-200/80 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w mx-auto px-3 sm:px-4 md:px-6">
          <div className="flex justify-between items-center py-2 sm:py-2.5">
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <button
                onClick={() => showNavigation && setShowSidebar(!showSidebar)}
                className={`p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 active:scale-95 ${showNavigation ? 'cursor-pointer' : 'cursor-default opacity-40'} transition-all duration-150`}
                title={showNavigation ? "Toggle Navigation Menu" : "Check in to enable navigation"}
                disabled={!showNavigation}
                aria-label="Toggle navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                onClick={() => showNavigation && setShowSidebar(!showSidebar)}
                className={`h-8 sm:h-9 flex items-center justify-center ${showNavigation ? 'cursor-pointer hover:opacity-85 active:scale-95' : 'cursor-default'} transition-all duration-150`}
                title={showNavigation ? "Open Navigation Menu" : "Check in to enable navigation"}
                disabled={!showNavigation}
              >
                <img src={logo} alt="Logo" className="h-full w-auto max-w-[120px] object-contain" />
              </button>
              <div>
                <h1 className="m-0 text-sm sm:text-base md:text-xl font-bold text-gray-900 leading-tight">Digital Zone</h1>
                {currentStore ? (
                  <p className="m-0 text-gray-500 text-[10px] sm:text-xs flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                    {currentStore.name}
                  </p>
                ) : (
                  <p className="m-0 text-gray-500 text-[10px] sm:text-xs hidden md:block">Billing System</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="text-center">
                <p className="m-0 text-[10px] sm:text-xs md:text-sm font-medium text-gray-900">{currentUser?.displayName}</p>
                <span className="inline-block bg-gray-100 text-gray-700 px-1.5 sm:px-2 md:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] md:text-xs uppercase font-semibold tracking-wider border border-gray-200 mt-0.5">
                  {currentUser?.role}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="px-2.5 sm:px-3 md:px-5 py-1 sm:py-1.5 md:py-2 rounded-lg font-semibold cursor-pointer transition-all duration-200 text-[10px] sm:text-xs md:text-sm bg-white text-red-500 border-2 border-red-500 hover:bg-red-500 hover:text-white hover:shadow-md"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[60] transition-opacity duration-200"
          onClick={() => {
            setShowSidebar(false);
            setSearchQuery('');
          }}
        />
      )}

      <aside
        ref={sidebarRef}
        aria-label="Navigation Sidebar"
        className={`fixed top-0 left-0 h-[100dvh] w-72 max-w-[80vw] bg-white z-[70] transform transition-transform duration-200 ease-out flex flex-col border-r border-slate-100 shadow-xl ${
          showSidebar ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Simple Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <img src={logo} alt="Logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-800 truncate">
              {currentStore ? currentStore.name : 'Digital Zone'}
            </span>
          </div>
          <button
            onClick={() => {
              setShowSidebar(false);
              setSearchQuery('');
            }}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors cursor-pointer"
            title="Close"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Minimal Search */}
        <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white text-slate-800 placeholder-slate-400 rounded-md border border-slate-100 focus:border-slate-300 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Clean Navigation Body */}
        <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-slate-200">
          {filteredSections.length === 0 ? (
            <div className="py-10 text-center px-4 text-slate-400">
              <p className="text-xs">No matching items</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 text-xs text-blue-600 hover:underline cursor-pointer"
              >
                Clear
              </button>
            </div>
          ) : (
            filteredSections.map((section) => (
              <div key={section.title}>
                <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                  {section.title}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActiveRoute(item.path);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        onClick={() => handleNavigation(item.path)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer text-left ${
                          active
                            ? 'bg-blue-50 text-blue-600 font-medium'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                        <span className="truncate">{item.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* Simple Footer */}
        <div className="border-t border-slate-100 px-3.5 py-2.5 flex items-center justify-between gap-2 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-800 truncate">
              {currentUser?.displayName || 'User'}
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide truncate">
              {currentUser?.role}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 text-slate-400 hover:text-red-500 rounded-md transition-colors cursor-pointer flex-shrink-0"
            title="Sign out"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {showNavigation && isEmployee && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
          <div className="flex justify-around items-center py-2">
            <button
              onClick={() => handleNavigation('/stock-requirement')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <span className="text-[10px] font-medium text-center">Stock Req</span>
            </button>

            {canAccess('/service-management') && (
              <button
                onClick={() => handleNavigation('/service-management')}
                className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
              >
                <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[10px] font-medium text-center">Services</span>
              </button>
            )}

            {canAccess('/service-management/create') && (
              <button
                onClick={() => handleNavigation('/service-management/create')}
                className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
              >
                <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[10px] font-medium text-center">New Job</span>
              </button>
            )}

            <button
              onClick={() => handleNavigation('/employee-dashboard')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <span className="text-[10px] font-medium text-center">Attendance</span>
            </button>

            <button
              onClick={() => handleNavigation('/employee-profile')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-[10px] font-medium text-center">Profile</span>
            </button>
          </div>
        </nav>
      )}

      {showNavigation && !isEmployee && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
          <div className="flex justify-around items-center py-2">
            {canAccess('/dashboard') && (
            <button
              onClick={() => handleNavigation('/dashboard')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-xs font-medium">Home</span>
            </button>
            )}

            {canAccess('/billing') && (
            <button
              onClick={() => handleNavigation('/billing')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="text-xs font-medium">Billing</span>
            </button>
            )}

            {canAccess('/overall-sales') && (
            <button
              onClick={() => handleNavigation('/overall-sales')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-medium">Report</span>
            </button>
            )}

            {canAccess('/products') && (
            <button
              onClick={() => handleNavigation('/products')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="text-xs font-medium">Product</span>
            </button>
            )}
          </div>
        </nav>
      )}
    </>
  );
};

export default Navbar;
