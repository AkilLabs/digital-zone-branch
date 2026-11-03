/**
 * Role-Based Access Control (RBAC) Configuration
 * 
 * Defines what each user role can access across the entire application.
 * 
 * Roles hierarchy (most → least privileged):
 *   owner > hub-admin > store-admin/admin > employee > qr
 * 
 * owner:       Full access to everything (hub + store level)
 * hub-admin:   Hub-level management + all store features
 * store-admin: Full store-level access (no hub features)
 * admin:       Same as store-admin (legacy alias)
 * employee:    Limited daily operations (billing, products view, services, recharge)
 * qr:          QR display only
 */

import type { UserRole } from '../types';

// ─── Route Permissions ───────────────────────────────────────────────────────
// Maps each route to the roles that are allowed to access it.

export interface RoutePermission {
  path: string;
  allowedRoles: UserRole[];
  label?: string;
  category?: string;
}

/**
 * Master list of all protected routes with their allowed roles.
 * Used by ProtectedRoute component and Navbar for filtering.
 */
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  // ── Hub Management (hub-level users only) ──
  '/hub-dashboard':     ['owner', 'hub-admin'],
  '/store-management':  ['owner', 'hub-admin'],
  '/stock-transfer':    ['owner', 'hub-admin'],

  // ── Dashboard ──
  '/dashboard':         ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],

  // ── Billing & Sales ──
  '/billing':           ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/quotations':        ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/add-entry':         ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],

  // ── Expenses ──
  '/add-expense':       ['owner', 'hub-admin', 'store-admin', 'admin'],

  // ── Products & Inventory ──
  '/products':          ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/add-product':       ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/delete-products-by-brand-category': ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/bulk-delete-products': ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/master':            ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/stock-value':       ['owner'],
  '/defect-management': ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/stock-requirement': ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],

  // ── Purchases & Suppliers ──
  '/purchases':         ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/add-purchase':      ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/add-purchase-imei': ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/suppliers':         ['owner', 'hub-admin', 'store-admin', 'admin'],

  // ── Service Management ──
  '/service-management': ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/service-management/create': ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],

  // ── Finance & Reports ──
  '/overall-sales':     ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/settlement':        ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/sales-report':      ['owner', 'hub-admin', 'store-admin', 'admin'],

  // ── Customer Management ──
  '/customers':         ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],

  // ── Employee & Administration ──
  '/employee-dashboard':  ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/employee-management': ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/employee-profile':    ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/add-employee':        ['owner'],
  '/users':               ['owner', 'hub-admin', 'store-admin', 'admin'],


  // ── Recharge ──
  '/recharge-accounts':   ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/bulk-recharge':       ['owner', 'hub-admin', 'store-admin', 'admin', 'employee'],
  '/recharge-report':     ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/provider-management': ['owner', 'hub-admin', 'store-admin', 'admin'],

  // ── Settings & About ──
  '/settings':          ['owner', 'hub-admin', 'store-admin', 'admin'],
  '/about':             ['owner'],
  '/migration':         ['owner'],
};


// ─── Feature Permissions ─────────────────────────────────────────────────────
// Fine-grained feature flags per role (used within pages for button/action visibility).

export interface FeaturePermissions {
  canEditProduct: boolean;
  canDeleteProduct: boolean;
  canAddProduct: boolean;
  canEditPrice: boolean;       // Can edit cost/selling price
  canViewCost: boolean;        // Can see purchase cost
  canViewProfit: boolean;      // Can see profit figures
  canManageEmployees: boolean;
  canManageUsers: boolean;
  canManageSuppliers: boolean;
  canAddPurchase: boolean;
  canAddExpense: boolean;
  canViewReports: boolean;
  canExportData: boolean;
  canDeleteEntry: boolean;
  canManageMaster: boolean;    // Brands, categories
  canViewStockValue: boolean;
  canManageDefects: boolean;
  canManageProviders: boolean;
}

const OWNER_PERMISSIONS: FeaturePermissions = {
  canEditProduct: true,
  canDeleteProduct: true,
  canAddProduct: true,
  canEditPrice: true,
  canViewCost: true,
  canViewProfit: true,
  canManageEmployees: true,
  canManageUsers: true,
  canManageSuppliers: true,
  canAddPurchase: true,
  canAddExpense: true,
  canViewReports: true,
  canExportData: true,
  canDeleteEntry: true,
  canManageMaster: true,
  canViewStockValue: true,
  canManageDefects: true,
  canManageProviders: true,
};

const ADMIN_PERMISSIONS: FeaturePermissions = {
  canEditProduct: true,
  canDeleteProduct: true,
  canAddProduct: true,
  canEditPrice: true,
  canViewCost: true,
  canViewProfit: true,
  canManageEmployees: true,
  canManageUsers: true,
  canManageSuppliers: true,
  canAddPurchase: true,
  canAddExpense: true,
  canViewReports: true,
  canExportData: true,
  canDeleteEntry: true,
  canManageMaster: true,
  canViewStockValue: false,
  canManageDefects: true,
  canManageProviders: true,
};

const EMPLOYEE_PERMISSIONS: FeaturePermissions = {
  canEditProduct: false,
  canDeleteProduct: false,
  canAddProduct: false,
  canEditPrice: false,
  canViewCost: false,
  canViewProfit: false,
  canManageEmployees: false,
  canManageUsers: false,
  canManageSuppliers: false,
  canAddPurchase: false,
  canAddExpense: false,
  canViewReports: false,
  canExportData: false,
  canDeleteEntry: false,
  canManageMaster: false,
  canViewStockValue: false,
  canManageDefects: false,
  canManageProviders: false,
};

const QR_PERMISSIONS: FeaturePermissions = {
  canEditProduct: false,
  canDeleteProduct: false,
  canAddProduct: false,
  canEditPrice: false,
  canViewCost: false,
  canViewProfit: false,
  canManageEmployees: false,
  canManageUsers: false,
  canManageSuppliers: false,
  canAddPurchase: false,
  canAddExpense: false,
  canViewReports: false,
  canExportData: false,
  canDeleteEntry: false,
  canManageMaster: false,
  canViewStockValue: false,
  canManageDefects: false,
  canManageProviders: false,
};

const FEATURE_PERMISSIONS_MAP: Record<UserRole, FeaturePermissions> = {
  'owner': OWNER_PERMISSIONS,
  'hub-admin': { ...ADMIN_PERMISSIONS, canViewStockValue: true },
  'store-admin': ADMIN_PERMISSIONS,
  'admin': ADMIN_PERMISSIONS,
  'employee': EMPLOYEE_PERMISSIONS,
  'qr': QR_PERMISSIONS,
};

/**
 * Get the feature permissions for a given user role.
 */
export const getFeaturePermissions = (role: UserRole): FeaturePermissions => {
  return FEATURE_PERMISSIONS_MAP[role] || EMPLOYEE_PERMISSIONS;
};

/**
 * Check if a role has access to a specific route.
 */
export const hasRouteAccess = (role: UserRole, path: string): boolean => {
  const allowed = ROUTE_PERMISSIONS[path];
  if (!allowed) return true; // If route isn't listed, allow by default
  return allowed.includes(role);
};

/**
 * Get all accessible routes for a role.
 */
export const getAccessibleRoutes = (role: UserRole): string[] => {
  return Object.entries(ROUTE_PERMISSIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([path]) => path);
};
