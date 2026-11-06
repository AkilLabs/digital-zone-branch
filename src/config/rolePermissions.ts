/**
 * Role-Based Access Control (RBAC) Configuration — Head Office (HQ)
 *
 * Roles:
 *   HQ:     owner, hq-admin (alias: hub-admin)
 *   Branch: admin (alias: store-admin), manager, sales_person, technician, cashier, employee
 */

import type { UserRole } from '../types';

export interface RoutePermission {
  path: string;
  allowedRoles: UserRole[];
  label?: string;
  category?: string;
}

const ALL_ROLES: UserRole[] = [
  'owner',
  'hq-admin',
  'hub-admin',
  'admin',
  'store-admin',
  'manager',
  'sales_person',
  'technician',
  'cashier',
  'employee',
];

const HQ_AND_ADMIN_ROLES: UserRole[] = [
  'owner',
  'hq-admin',
  'hub-admin',
  'admin',
  'store-admin',
  'manager',
];

export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  // ── Dashboard & Head Office ──
  '/dashboard':         ALL_ROLES,
  '/hub-dashboard':     ['owner', 'hq-admin', 'hub-admin'],
  '/branches':          ['owner', 'hq-admin', 'hub-admin'],
  '/branch-management': ['owner', 'hq-admin', 'hub-admin'],
  '/store-management':  ['owner', 'hq-admin', 'hub-admin'],
  '/stock-transfer':    ['owner', 'hq-admin', 'hub-admin'],
  '/stock-transfer/history': ['owner', 'hq-admin', 'hub-admin'],
  '/stock-transfer-history': ['owner', 'hq-admin', 'hub-admin'],
  '/stock-transfers':   ['owner', 'hq-admin', 'hub-admin'],

  // ── Billing ──
  '/billing':           ALL_ROLES,
  '/add-entry':         ALL_ROLES,

  // ── Expenses ──
  '/add-expense':       HQ_AND_ADMIN_ROLES,

  // ── Products & Inventory ──
  '/products':          ALL_ROLES,
  '/add-product':       HQ_AND_ADMIN_ROLES,
  '/delete-products-by-brand-category': ['owner', 'hq-admin', 'hub-admin'],
  '/bulk-delete-products': ['owner', 'hq-admin', 'hub-admin'],
  '/master':            HQ_AND_ADMIN_ROLES,
  '/stock-value':       ['owner', 'hq-admin', 'hub-admin'],
  '/defect-management': HQ_AND_ADMIN_ROLES,
  '/stock-requirement': ALL_ROLES,

  // ── Purchases & Suppliers ──
  '/purchases':         HQ_AND_ADMIN_ROLES,
  '/add-purchase':      HQ_AND_ADMIN_ROLES,
  '/add-purchase-imei': HQ_AND_ADMIN_ROLES,
  '/suppliers':            HQ_AND_ADMIN_ROLES,
  '/suppliers/:id':        HQ_AND_ADMIN_ROLES,
  '/supplier-ledger/:id':  HQ_AND_ADMIN_ROLES,

  // ── Service Management ──
  '/service-management': ALL_ROLES,
  '/service-management/create': ALL_ROLES,

  // ── Finance & Reports ──
  '/overall-sales':     HQ_AND_ADMIN_ROLES,
  '/settlement':        HQ_AND_ADMIN_ROLES,
  '/sales-report':      HQ_AND_ADMIN_ROLES,

  // ── Customer Management ──
  '/customers':         ALL_ROLES,

  // ── Employee & User Administration (HQ Only) ──
  '/employee-management': ['owner', 'hq-admin', 'hub-admin', 'admin', 'store-admin', 'manager'],
  '/employee-profile':    ALL_ROLES,
  '/add-employee':        ['owner', 'hq-admin', 'hub-admin'],
  '/create-employee':     ['owner', 'hq-admin', 'hub-admin'],
  '/users':               ['owner', 'hq-admin', 'hub-admin'],

  // ── Settings ──
  '/settings':          ['owner', 'hq-admin', 'hub-admin'],
  '/about':             ['owner', 'hq-admin', 'hub-admin'],
  '/migration':         ['owner'],
};

export interface FeaturePermissions {
  canEditProduct: boolean;
  canDeleteProduct: boolean;
  canAddProduct: boolean;
  canEditPrice: boolean;
  canViewCost: boolean;
  canViewProfit: boolean;
  canManageEmployees: boolean;
  canManageUsers: boolean;
  canManageSuppliers: boolean;
  canAddPurchase: boolean;
  canAddExpense: boolean;
  canViewReports: boolean;
  canExportData: boolean;
  canDeleteEntry: boolean;
  canManageMaster: boolean;
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
  canViewStockValue: true,
  canManageDefects: true,
  canManageProviders: true,
};

const STAFF_PERMISSIONS: FeaturePermissions = {
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
  'hq-admin': ADMIN_PERMISSIONS,
  'hub-admin': ADMIN_PERMISSIONS,
  'store-admin': { ...ADMIN_PERMISSIONS, canViewStockValue: false },
  'admin': { ...ADMIN_PERMISSIONS, canViewStockValue: false },
  'manager': { ...ADMIN_PERMISSIONS, canViewStockValue: false, canManageUsers: false },
  'sales_person': STAFF_PERMISSIONS,
  'technician': STAFF_PERMISSIONS,
  'cashier': STAFF_PERMISSIONS,
  'employee': STAFF_PERMISSIONS,
  'qr': STAFF_PERMISSIONS,
};

export const getFeaturePermissions = (role: UserRole): FeaturePermissions => {
  return FEATURE_PERMISSIONS_MAP[role] || STAFF_PERMISSIONS;
};

export const hasRouteAccess = (role: UserRole, path: string): boolean => {
  const allowed = ROUTE_PERMISSIONS[path];
  if (!allowed) return true;
  return allowed.includes(role);
};

export const getAccessibleRoutes = (role: UserRole): string[] => {
  return Object.entries(ROUTE_PERMISSIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([path]) => path);
};
