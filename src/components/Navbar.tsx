import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { hasRouteAccess } from '../config/rolePermissions';
import logo from '../assets/logo.png';
import {
  Menu,
  X,
  Search,
  LayoutDashboard,
  Receipt,
  Wallet,
  Users,
  Package,
  Boxes,
  TrendingUp,
  ShoppingBag,
  PlusCircle,
  Smartphone,
  AlertTriangle,
  Truck,
  ArrowLeftRight,
  Sliders,
  Wrench,
  Plus,
  BarChart3,
  UserCheck,
  UserPlus,
  Settings,
  LogOut,
  Building2,
  Warehouse,
  History,
} from 'lucide-react';

interface MenuItem {
  title: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const Navbar: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const { currentStore, stores, setCurrentStore, isViewingWarehouse } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const sidebarRef = useRef<HTMLDivElement>(null);

  const canAccess = useCallback(
    (path: string) => {
      if (!currentUser) return false;
      return hasRouteAccess(currentUser.role, path);
    },
    [currentUser]
  );

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
      if (event.key === 'Escape' && showSidebar) {
        setShowSidebar(false);
        setSearchQuery('');
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
    }
  };

  const handleNavigation = (path: string) => {
    navigate(path);
    setShowSidebar(false);
    setSearchQuery('');
  };

  const isActiveRoute = useCallback(
    (path: string) => {
      if (path === '/dashboard') {
        return (
          location.pathname === '/dashboard' ||
          location.pathname === '/hub-dashboard' ||
          location.pathname === '/'
        );
      }
      return (
        location.pathname === path ||
        (path !== '/' && location.pathname.startsWith(path + '/'))
      );
    },
    [location.pathname]
  );

  // Clean, readable HQ menu sections matching the Branch UI look (without old /store-management or /stock-transfer tabs)
  const menuSections: MenuSection[] = useMemo(() => {
    const sections: MenuSection[] = [];

    // 1. Head Office & Branch Control
    const workspaceItems: MenuItem[] = [
      ...(canAccess('/dashboard')
        ? [
            {
              title: 'Home & Branch Control',
              path: '/dashboard',
              icon: LayoutDashboard,
              keywords: ['home', 'dashboard', 'branch', 'create branch', 'stock transfer', 'hq'],
            },
          ]
        : []),
      ...(canAccess('/branch-management')
        ? [
            {
              title: 'Branch Management',
              path: '/branch-management',
              icon: Building2,
              keywords: ['branches', 'store management', 'owner', 'gps', 'geofence', 'branch manager'],
            },
          ]
        : []),
      ...(canAccess('/billing')
        ? [{ title: 'Billing', path: '/billing', icon: Receipt, keywords: ['bill', 'pos', 'invoice'] }]
        : []),
      ...(canAccess('/add-expense')
        ? [{ title: 'Add Expense', path: '/add-expense', icon: Wallet, keywords: ['expense', 'cost'] }]
        : []),
      ...(canAccess('/customers')
        ? [
            {
              title: 'Customers (Universal)',
              path: '/customers',
              icon: Users,
              keywords: ['customer', 'client', 'universal'],
            },
          ]
        : []),
    ];
    if (workspaceItems.length > 0) {
      sections.push({ title: 'HQ Workspace', items: workspaceItems });
    }

    // 2. Inventory, Stock Value & Purchases
    const inventoryItems: MenuItem[] = [
      ...(canAccess('/products')
        ? [{ title: 'Products', path: '/products', icon: Package, keywords: ['product', 'inventory', 'stock'] }]
        : []),
      ...(canAccess('/stock-value')
        ? [
            {
              title: 'Stock Value (Total & Branches)',
              path: '/stock-value',
              icon: TrendingUp,
              keywords: ['stock value', 'valuation', 'total', 'branch stock value'],
            },
          ]
        : []),
      ...(canAccess('/stock-requirement')
        ? [
            {
              title: 'Stock Requirement',
              path: '/stock-requirement',
              icon: Boxes,
              keywords: ['low stock', 'requirement'],
            },
          ]
        : []),
      ...(canAccess('/stock-transfer')
        ? [
            {
              title: 'Stock Transfer',
              path: '/stock-transfer',
              icon: ArrowLeftRight,
              keywords: ['stock transfer', 'dispatch', 'branch transfer', 'inter-store'],
            },
            {
              title: 'Transfer History',
              path: '/stock-transfer/history',
              icon: History,
              keywords: ['transfer history', 'dispatches', 'gate pass', 'challan audit'],
            },
          ]
        : []),
      ...(canAccess('/defect-management')
        ? [
            {
              title: 'Defect & Damage',
              path: '/defect-management',
              icon: AlertTriangle,
              keywords: ['defect', 'damage', 'return'],
            },
          ]
        : []),
      ...(canAccess('/purchases')
        ? [{ title: 'Purchases', path: '/purchases', icon: ShoppingBag, keywords: ['purchase', 'bills'] }]
        : []),
      ...(canAccess('/add-purchase')
        ? [{ title: 'Add Purchase', path: '/add-purchase', icon: PlusCircle, keywords: ['add purchase'] }]
        : []),
      ...(canAccess('/add-purchase-imei')
        ? [
            {
              title: 'Add Purchase IMEI',
              path: '/add-purchase-imei',
              icon: Smartphone,
              keywords: ['imei', 'serial'],
            },
          ]
        : []),
      ...(canAccess('/suppliers')
        ? [{ title: 'Suppliers', path: '/suppliers', icon: Truck, keywords: ['supplier', 'vendor'] }]
        : []),
      ...(canAccess('/master')
        ? [
            {
              title: 'Master Setting',
              path: '/master',
              icon: Sliders,
              keywords: ['master', 'brand', 'category'],
            },
          ]
        : []),
    ];
    if (inventoryItems.length > 0) {
      sections.push({ title: 'Inventory & Purchases', items: inventoryItems });
    }

    // 3. Service & Sales Reports
    const serviceReportItems: MenuItem[] = [
      ...(canAccess('/service-management')
        ? [
            {
              title: 'Service Management',
              path: '/service-management',
              icon: Wrench,
              keywords: ['service', 'repair'],
            },
          ]
        : []),
      ...(canAccess('/service-management/create')
        ? [
            {
              title: 'Service Job Sheet',
              path: '/service-management/create',
              icon: Plus,
              keywords: ['job sheet', 'new service'],
            },
          ]
        : []),
      ...(canAccess('/overall-sales')
        ? [
            {
              title: 'Sales Report',
              path: '/overall-sales',
              icon: BarChart3,
              keywords: ['sales report', 'revenue', 'turnover'],
            },
          ]
        : []),
    ];
    if (serviceReportItems.length > 0) {
      sections.push({ title: 'Service & Reports', items: serviceReportItems });
    }

    // 4. Employees & Login Users (HQ Control)
    const adminItems: MenuItem[] = [
      ...(canAccess('/employee-management')
        ? [
            {
              title: 'Employees & Branch Staff',
              path: '/employee-management',
              icon: UserCheck,
              keywords: ['employee', 'create employee', 'assign branch', 'staff'],
            },
          ]
        : []),
      ...(canAccess('/add-employee')
        ? [
            {
              title: 'Add Login User',
              path: '/add-employee',
              icon: UserPlus,
              keywords: ['add user', 'login', 'hq-admin', 'branch admin'],
            },
          ]
        : []),
      ...(canAccess('/settings')
        ? [{ title: 'Settings', path: '/settings', icon: Settings, keywords: ['settings', 'users'] }]
        : []),
    ];
    if (adminItems.length > 0) {
      sections.push({ title: 'Employees & Users', items: adminItems });
    }

    return sections;
  }, [canAccess]);

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return menuSections;
    const q = searchQuery.toLowerCase().trim();
    return menuSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.path.toLowerCase().includes(q) ||
            item.keywords?.some((k) => k.toLowerCase().includes(q))
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [menuSections, searchQuery]);

  const selectedStoreValue = isViewingWarehouse
    ? 'hub_warehouse'
    : currentStore?.id || 'hub_warehouse';

  return (
    <>
      {/* Minimal Light Header Matching Branch UI Look */}
      <header className="bg-slate-50/95 text-gray-900 border-b border-slate-200/80 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w mx-auto px-3 sm:px-4 md:px-6">
          <div className="flex justify-between items-center py-2 sm:py-2.5 gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 active:scale-95 cursor-pointer transition-all duration-150"
                title="Toggle Navigation Menu"
                aria-label="Toggle navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleNavigation('/dashboard')}
                className="h-8 sm:h-9 flex items-center justify-center cursor-pointer hover:opacity-85 active:scale-95 transition-all duration-150"
                title="Go to HQ Home"
              >
                <img src={logo} alt="Digital Zone" className="h-full w-auto max-w-[120px] object-contain" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="m-0 text-sm sm:text-base md:text-xl font-bold text-gray-900 leading-tight truncate">
                    Digital Zone
                  </h1>
                  <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-600 text-white rounded">
                    HQ
                  </span>
                </div>
                <p className="m-0 text-gray-500 text-[10px] sm:text-xs truncate">
                  {isViewingWarehouse
                    ? 'Head Office & All Branches'
                    : `Inspecting Branch: ${currentStore?.name}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* Clean Branch Scope Selector */}
              <div className="hidden sm:flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-2xs">
                {isViewingWarehouse ? (
                  <Warehouse className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                )}
                <select
                  aria-label="Select HQ or Branch View"
                  value={selectedStoreValue}
                  onChange={(e) => setCurrentStore(e.target.value)}
                  className="text-xs font-medium text-slate-800 bg-transparent outline-none cursor-pointer max-w-[180px]"
                >
                  <option value="hub_warehouse">HQ Central Warehouse</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      Branch: {store.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-right">
                <p className="m-0 text-[10px] sm:text-xs md:text-sm font-medium text-gray-900 truncate max-w-[120px]">
                  {currentUser?.displayName || currentUser?.email}
                </p>
                <span className="inline-block bg-blue-50 text-blue-700 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] uppercase font-semibold tracking-wider border border-blue-200 mt-0.5">
                  {currentUser?.role}
                </span>
              </div>

              <button
                onClick={handleLogout}
                className="px-2.5 sm:px-3 md:px-4 py-1 sm:py-1.5 md:py-2 rounded-lg font-semibold cursor-pointer transition-all duration-200 text-[10px] sm:text-xs md:text-sm bg-white text-red-500 border border-red-200 hover:bg-red-500 hover:text-white"
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
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <img src={logo} alt="Logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">Digital Zone HQ</p>
              <p className="text-[10px] text-slate-500 truncate">
                {isViewingWarehouse ? 'Central Control' : currentStore?.name}
              </p>
            </div>
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

        {/* Mobile Branch Scope Switcher inside Sidebar */}
        <div className="px-3 pt-2.5 sm:hidden">
          <select
            aria-label="Select HQ or Branch View"
            value={selectedStoreValue}
            onChange={(e) => setCurrentStore(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md text-slate-800"
          >
            <option value="hub_warehouse">HQ Central Warehouse</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                Branch: {store.name}
              </option>
            ))}
          </select>
        </div>

        <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search HQ menu..."
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
                        <Icon
                          className={`w-4 h-4 flex-shrink-0 ${
                            active ? 'text-blue-600' : 'text-slate-400'
                          }`}
                        />
                        <span className="truncate">{item.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

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

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
        <div className="flex justify-around items-center py-2">
          <button
            onClick={() => handleNavigation('/dashboard')}
            className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
          >
            <LayoutDashboard className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">HQ Home</span>
          </button>
          <button
            onClick={() => handleNavigation('/stock-value')}
            className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
          >
            <TrendingUp className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">Stock Value</span>
          </button>
          <button
            onClick={() => handleNavigation('/stock-transfer')}
            className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
          >
            <ArrowLeftRight className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">Transfer</span>
          </button>
          <button
            onClick={() => handleNavigation('/employee-management')}
            className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
          >
            <UserCheck className="w-5 h-5 mb-0.5" />
            <span className="text-[10px] font-medium">Employees</span>
          </button>
        </div>
      </nav>
    </>
  );
};

export default Navbar;
