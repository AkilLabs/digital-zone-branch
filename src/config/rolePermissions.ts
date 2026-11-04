/**
 * Role-Based Access Control (RBAC) Configuration — Branch Application
 *
 * Roles:
 *   Owner / HQ: owner, hq-admin, hub-admin (owner credentials work on every branch)
 *   Branch:     admin, store-admin, manager, sales_person, technician, cashier, employee
 */

import type { UserRole } from '../types';

export interface RoutePermission {
  path: string;
  allowedRoles: UserRole[];
  label?: string;
  category?: string;
}

const ALL_BRANCH_ROLES: UserRole[] = [
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

const BRANCH_MANAGER_ROLES: UserRole[] = [
  'owner',
  'hq-admin',
  'hub-admin',
  'admin',
  'store-admin',
  'manager',
];

export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  // ── Mandatory Branch Routes ──
  '/dashboard':                 ALL_BRANCH_ROLES,
  '/billing':                   ALL_BRANCH_ROLES,
  '/add-expense':               ALL_BRANCH_ROLES,
  '/customers':                 ALL_BRANCH_ROLES,
  '/products':                  ALL_BRANCH_ROLES,
  '/add-product':               BRANCH_MANAGER_ROLES,
  '/stock-received':            ALL_BRANCH_ROLES,
  '/stock-transfer':            ALL_BRANCH_ROLES,
  '/stock-requirement':         ALL_BRANCH_ROLES,
  '/defect-management':         ALL_BRANCH_ROLES,
  '/service-management':        ALL_BRANCH_ROLES,
  '/service-management/create': ALL_BRANCH_ROLES,
  '/overall-sales':             BRANCH_MANAGER_ROLES,
  '/sales-report':              BRANCH_MANAGER_ROLES,
  '/settlement':                BRANCH_MANAGER_ROLES,
  '/employee-management':       ALL_BRANCH_ROLES,
  '/employee-profile':          ALL_BRANCH_ROLES,

  // ── Optional Branch Purchase Routes (Gated by store.purchaseEnabled) ──
  '/purchases':                 BRANCH_MANAGER_ROLES,
  '/add-purchase':              BRANCH_MANAGER_ROLES,
  '/add-purchase-imei':         BRANCH_MANAGER_ROLES,
  '/suppliers':                 BRANCH_MANAGER_ROLES,
  '/master':                    BRANCH_MANAGER_ROLES,
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
  canManageUsers: false, // User creation is HQ only
  canManageSuppliers: true,
  canAddPurchase: true,
  canAddExpense: true,
  canViewReports: true,
  canExportData: true,
  canDeleteEntry: true,
  canManageMaster: true,
  canViewStockValue: true,
  canManageDefects: true,
  canManageProviders: false,
};

const BRANCH_ADMIN_PERMISSIONS: FeaturePermissions = {
  canEditProduct: true,
  canDeleteProduct: true,
  canAddProduct: true,
  canEditPrice: true,
  canViewCost: true,
  canViewProfit: true,
  canManageEmployees: false, // Controlled from HQ
  canManageUsers: false,     // Controlled from HQ
  canManageSuppliers: true,
  canAddPurchase: true,
  canAddExpense: true,
  canViewReports: true,
  canExportData: true,
  canDeleteEntry: true,
  canManageMaster: true,
  canViewStockValue: false,
  canManageDefects: true,
  canManageProviders: false,
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
  canAddExpense: true,
  canViewReports: false,
  canExportData: false,
  canDeleteEntry: false,
  canManageMaster: false,
  canViewStockValue: false,
  canManageDefects: true,
  canManageProviders: false,
};

const FEATURE_PERMISSIONS_MAP: Record<UserRole, FeaturePermissions> = {
  'owner': OWNER_PERMISSIONS,
  'hq-admin': BRANCH_ADMIN_PERMISSIONS,
  'hub-admin': BRANCH_ADMIN_PERMISSIONS,
  'store-admin': BRANCH_ADMIN_PERMISSIONS,
  'admin': BRANCH_ADMIN_PERMISSIONS,
  'manager': BRANCH_ADMIN_PERMISSIONS,
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
