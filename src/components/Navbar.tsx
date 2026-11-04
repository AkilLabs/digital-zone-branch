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
  ShoppingBag,
  PlusCircle,
  Smartphone,
  AlertTriangle,
  Sliders,
  Wrench,
  Plus,
  BarChart3,
  UserCheck,
  LogOut,
  ArrowDownToLine,
  ArrowLeftRight,
  Building2,
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
  const { currentStore } = useStore();
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

  const purchaseEnabled = Boolean(currentStore?.purchaseEnabled);

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
        return location.pathname === '/dashboard' || location.pathname === '/';
      }
      return (
        location.pathname === path ||
        (path !== '/' && location.pathname.startsWith(path + '/'))
      );
    },
    [location.pathname]
  );

  // Strictly Mandatory Branch Features + Optional Branch Purchase (when turned on in HQ)
  const menuSections: MenuSection[] = useMemo(() => {
    const sections: MenuSection[] = [];

    // 1. Branch Workspace (Mandatory)
    const mainItems: MenuItem[] = [
      ...(canAccess('/dashboard')
        ? [{ title: 'Home', path: '/dashboard', icon: LayoutDashboard, keywords: ['home', 'dashboard'] }]
        : []),
      ...(canAccess('/billing')
        ? [{ title: 'Billing', path: '/billing', icon: Receipt, keywords: ['billing', 'pos', 'sale', 'invoice'] }]
        : []),
      ...(canAccess('/add-expense')
        ? [{ title: 'Add Expense', path: '/add-expense', icon: Wallet, keywords: ['expense', 'cash out'] }]
        : []),
      ...(canAccess('/customers')
        ? [{ title: 'Customer', path: '/customers', icon: Users, keywords: ['customer', 'universal', 'client'] }]
        : []),
    ];
    if (mainItems.length > 0) sections.push({ title: 'Branch Workspace', items: mainItems });

    // 2. Inventory & Stock (Mandatory)
    const inventoryItems: MenuItem[] = [
      ...(canAccess('/products')
        ? [{ title: 'Product', path: '/products', icon: Package, keywords: ['product', 'inventory', 'stock'] }]
        : []),
      ...(canAccess('/stock-received')
        ? [
            {
              title: 'Stock Received (HQ)',
              path: '/stock-received',
              icon: ArrowDownToLine,
              keywords: ['stock received', 'hq', 'check product', 'incoming'],
            },
          ]
        : []),
      ...(canAccess('/stock-transfer')
        ? [
            {
              title: 'Stock Transfer',
              path: '/stock-transfer',
              icon: ArrowLeftRight,
              keywords: ['stock transfer', 'triggered', 'picked', 'received', 'branch transfer'],
            },
          ]
        : []),
      ...(canAccess('/stock-requirement')
        ? [
            {
              title: 'Stock Requirement',
              path: '/stock-requirement',
              icon: Boxes,
              keywords: ['stock requirement', 'low stock', 'order'],
            },
          ]
        : []),
      ...(canAccess('/defect-management')
        ? [
            {
              title: 'Defect & Damage',
              path: '/defect-management',
              icon: AlertTriangle,
              keywords: ['defect', 'damage', 'return', 'faulty'],
            },
          ]
        : []),
    ];
    if (inventoryItems.length > 0) sections.push({ title: 'Inventory & Stock', items: inventoryItems });

    // 3. Optional: Branch Purchase (Enabled only if turned ON for this branch in HQ)
    if (purchaseEnabled) {
      const purchaseItems: MenuItem[] = [
        ...(canAccess('/purchases')
          ? [{ title: 'Purchase', path: '/purchases', icon: ShoppingBag, keywords: ['purchase', 'bills'] }]
          : []),
        ...(canAccess('/add-purchase')
          ? [{ title: 'Add Purchase', path: '/add-purchase', icon: PlusCircle, keywords: ['add purchase', 'stock in'] }]
          : []),
        ...(canAccess('/add-purchase-imei')
          ? [
              {
                title: 'Add Purchase IMEI',
                path: '/add-purchase-imei',
                icon: Smartphone,
                keywords: ['imei', 'phone purchase', 'serial'],
              },
            ]
          : []),
        ...(canAccess('/master')
          ? [{ title: 'Master Setting', path: '/master', icon: Sliders, keywords: ['master', 'brand', 'category'] }]
          : []),
      ];
      if (purchaseItems.length > 0) {
        sections.push({ title: 'Branch Purchase', items: purchaseItems });
      }
    }

    // 4. Service, Reports & Staff (Mandatory)
    const serviceAndReportItems: MenuItem[] = [
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
              keywords: ['job sheet', 'new service', 'repair entry'],
            },
          ]
        : []),
      ...(canAccess('/overall-sales')
        ? [
            {
              title: 'Sales Report',
              path: '/overall-sales',
              icon: BarChart3,
              keywords: ['sales report', 'turnover', 'settlement'],
            },
          ]
        : []),
      ...(canAccess('/employee-management')
        ? [
            {
              title: 'Branch Employee List',
              path: '/employee-management',
              icon: UserCheck,
              keywords: ['employee', 'staff', 'branch employee list'],
            },
          ]
        : []),
    ];
    if (serviceAndReportItems.length > 0) {
      sections.push({ title: 'Service, Reports & Staff', items: serviceAndReportItems });
    }

    return sections;
  }, [canAccess, purchaseEnabled]);

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

  return (
    <>
      <header className="bg-slate-50/95 text-gray-900 border-b border-slate-200/80 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w mx-auto px-3 sm:px-4 md:px-6">
          <div className="flex justify-between items-center py-2 sm:py-2.5">
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 active:scale-95 cursor-pointer transition-all duration-150"
                title="Toggle Navigation Menu"
                aria-label="Toggle navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="h-8 sm:h-9 flex items-center justify-center cursor-pointer hover:opacity-85 active:scale-95 transition-all duration-150"
                title="Open Navigation Menu"
              >
                <img src={logo} alt="Digital Zone" className="h-full w-auto max-w-[120px] object-contain" />
              </button>
              <div>
                <h1 className="m-0 text-sm sm:text-base md:text-xl font-bold text-gray-900 leading-tight">
                  Digital Zone
                </h1>
                <p className="m-0 text-gray-500 text-[10px] sm:text-xs flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-blue-600" />
                  {currentStore?.name || 'Branch Terminal'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="text-right">
                <p className="m-0 text-[10px] sm:text-xs md:text-sm font-medium text-gray-900">
                  {currentUser?.displayName || currentUser?.email}
                </p>
                <span className="inline-block bg-gray-100 text-gray-700 px-1.5 sm:px-2 md:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] md:text-xs uppercase font-semibold tracking-wider border border-gray-200 mt-0.5">
                  {currentUser?.role?.replace('_', ' ')}
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
              <p className="text-xs font-bold text-slate-900 truncate">Digital Zone</p>
              <p className="text-[10px] text-slate-500 truncate">
                {currentStore ? currentStore.name : 'Branch'}
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

        <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search branch menu..."
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
              {currentUser?.role?.replace('_', ' ')}
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
          {canAccess('/dashboard') && (
            <button
              onClick={() => handleNavigation('/dashboard')}
              className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
            >
              <LayoutDashboard className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">Home</span>
            </button>
          )}
          {canAccess('/billing') && (
            <button
              onClick={() => handleNavigation('/billing')}
              className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
            >
              <Receipt className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">Billing</span>
            </button>
          )}
          {canAccess('/stock-received') && (
            <button
              onClick={() => handleNavigation('/stock-received')}
              className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
            >
              <ArrowDownToLine className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">HQ Stock</span>
            </button>
          )}
          {canAccess('/products') && (
            <button
              onClick={() => handleNavigation('/products')}
              className="flex flex-col items-center justify-center flex-1 py-1.5 px-1 text-gray-600 hover:text-blue-600"
            >
              <Package className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">Product</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
};

export default Navbar;
