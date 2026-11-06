export interface StockAgingSettings {
  enabled: boolean;
  agingDays: number;
  enableIncentive: boolean;
  incentivePercent: number;
  incentiveBasis: 'sales_amount' | 'profit';
}

export const DEFAULT_STOCK_AGING_SETTINGS: StockAgingSettings = {
  enabled: true,
  agingDays: 60,
  enableIncentive: true,
  incentivePercent: 5,
  incentiveBasis: 'sales_amount',
};

const STORAGE_KEY = 'dz_stock_aging_settings';

export const getCachedStockAgingSettings = (): StockAgingSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STOCK_AGING_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_STOCK_AGING_SETTINGS.enabled,
      agingDays: Number(parsed.agingDays) > 0 ? Number(parsed.agingDays) : DEFAULT_STOCK_AGING_SETTINGS.agingDays,
      enableIncentive: typeof parsed.enableIncentive === 'boolean' ? parsed.enableIncentive : DEFAULT_STOCK_AGING_SETTINGS.enableIncentive,
      incentivePercent: Number(parsed.incentivePercent) >= 0 ? Number(parsed.incentivePercent) : DEFAULT_STOCK_AGING_SETTINGS.incentivePercent,
      incentiveBasis: parsed.incentiveBasis === 'profit' ? 'profit' : 'sales_amount',
    };
  } catch {
    return DEFAULT_STOCK_AGING_SETTINGS;
  }
};

export const setCachedStockAgingSettings = (settings: StockAgingSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Could not cache stock aging settings:', err);
  }
};

/**
 * Calculates stock age in calendar days from createdAt or purchaseDate.
 */
export const getProductAgeInDays = (product: { createdAt?: any; purchaseDate?: any; dateAdded?: any } | null | undefined): number => {
  if (!product) return 0;
  const rawDate = product.purchaseDate || product.createdAt || product.dateAdded;
  if (!rawDate) return 0;

  let d: Date | null = null;
  if (rawDate instanceof Date) {
    d = rawDate;
  } else if (typeof rawDate.toDate === 'function') {
    d = rawDate.toDate();
  } else if (typeof rawDate === 'string' || typeof rawDate === 'number') {
    d = new Date(rawDate);
  }

  if (!d || isNaN(d.getTime())) return 0;
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - d.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};

/**
 * Checks if a product exceeds the aging threshold.
 */
export const isProductAging = (
  product: { createdAt?: any; purchaseDate?: any; dateAdded?: any } | null | undefined,
  thresholdOrSettings: number | StockAgingSettings = 60
): boolean => {
  if (typeof thresholdOrSettings === 'object' && thresholdOrSettings !== null) {
    if (!thresholdOrSettings.enabled) return false;
    const threshold = Number(thresholdOrSettings.agingDays) || 60;
    return getProductAgeInDays(product) >= threshold;
  }
  const threshold = Number(thresholdOrSettings) || 60;
  return getProductAgeInDays(product) >= threshold;
};

/**
 * Calculates salesperson incentive for selling aging stock.
 */
export const calculateAgingIncentive = (
  sellingPrice: number,
  profit: number,
  settings: StockAgingSettings
): number => {
  if (!settings.enabled || !settings.enableIncentive || settings.incentivePercent <= 0) {
    return 0;
  }

  const base = settings.incentiveBasis === 'profit'
    ? Math.max(0, Number(profit) || 0)
    : Math.max(0, Number(sellingPrice) || 0);

  const incentive = (base * settings.incentivePercent) / 100;
  return Math.round(incentive * 100) / 100;
};

export interface EmployeeTarget {
  id?: string;
  employeeId: string;
  employeeName: string;
  storeId?: string;
  storeName?: string;
  period: 'daily' | 'monthly';
  metric: 'sales_amount' | 'profit_amount';
  targetAmount: number;
  periodKey?: string; // e.g. "2026-11" or "2026-11-06"
  createdAt?: any;
  updatedAt?: any;
}

// Runtime constants to prevent Vite unbundled dev import errors if imported without 'type'
export const EmployeeTarget = {};
export const StockAgingSettings = {};
