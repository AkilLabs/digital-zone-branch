export type PaymentMode = 'cash' | 'upi' | 'card' | 'split' | 'credit' | 'cheque' | 'finance';

export interface PaymentSplit {
  cash?: number;
  upi?: number;
  card?: number;
}

export interface BillingItem {
  id?: string;
  title: string;
  brand?: string;
  category?: string;
  cost: number;
  sellingPrice: number;
  profit: number;
  quantity: number;
  totalProfit: number;
  imei?: string;
  hsnCode?: string;
  paymentMode: PaymentMode;
  paymentType?: string;
  paymentSplit?: PaymentSplit;
  financeProvider?: string;
  financeTenureMonths?: number;
  financeDownPayment?: number;
  processingFee?: number;
  financeAmount?: number;
  monthlyEmi?: number;
  gstRate?: number; // GST percentage (0, 5, 12, 18, 28)
  gstAmount?: number; // Calculated GST amount
  totalWithGst?: number; // Total including GST
  gstEnabled?: boolean; // Whether GST is enabled for this item
  baseAmount?: number; // Base amount before GST
  customerName?: string; // Customer name for invoice
  customerPhone?: string; // Customer phone for WhatsApp
  customerEmail?: string; // Customer email for email sharing
  customerGstNo?: string; // Customer GST number for invoice details
  customerDetails?: string; // Full customer details string
  type?: 'product' | 'service' | 'credit' | 'expense'; // Entry type: product, service, credit, or expense
  expenseCategory?: 'general' | 'salary' | 'bonus'; // Category for expenses
  employeeId?: string; // Linked employee for salary/bonus
  employeeName?: string; // Name of linked employee
  salesPersonId?: string; // Salesperson ID who sold this item
  salesPersonName?: string; // Salesperson name who sold this item
  isAgingStock?: boolean; // Whether item was sold from aged inventory
  agingDays?: number; // Days in stock when sold
  agingIncentiveAmount?: number; // Incentive amount earned by salesperson for clearing aging stock
  creditCustomerName?: string; // Customer name for credit sales
  isPaid?: boolean; // Payment status for credit sales
  paidAmount?: number; // Amount paid for credit sales
  remainingAmount?: number; // Remaining amount for credit sales
  transactionId?: string; // Links products sold together in the same transaction
  itemNumber?: number; // Position of this item in the transaction (1, 2, 3...)
  totalItems?: number; // Total number of items in this transaction
  itemDiscount?: number; // Discount applied to this specific item
  itemSubtotal?: number; // Subtotal before discount for this item
  discountType?: 'amount' | 'percent'; // Type of discount applied to transaction
  discountValue?: number; // Value of discount (amount or percentage)
  discountAmount?: number; // Calculated discount amount for transaction
  items?: BillingItem[]; // List of items in a combined order
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
  invoiceNumber?: string; // Invoice number if generated
  invoiceTime?: string; // Formatted time string (e.g. 02:30 PM)
  subtotal?: number; // Subtotal for transaction (all items)
  grandTotal?: number; // Grand total for transaction
  roundOff?: number; // Round off amount applied (+ or -)
  description?: string; // Optional description for expenses
  storeId?: string; // Store this billing item belongs to
  _collection?: 'billingItems' | 'creditSales' | 'expenses'; // Source Firestore collection
}

/**
 * Dedicated Expense Record stored in the `expenses` Firestore collection
 * (separated from `billingItems` to prevent conflicts with sales transactions)
 */
export interface ExpenseRecord {
  id?: string;
  title: string;
  amount: number;
  cost: number; // Alias for amount to maintain compatibility with BillingItem
  sellingPrice?: number;
  profit?: number;
  totalProfit?: number;
  quantity?: number;
  description?: string;
  vendorName?: string;
  customerName?: string;
  type: 'expense';
  expenseCategory: 'general' | 'salary' | 'bonus';
  paymentMode: PaymentMode | 'bank';
  paymentType?: string;
  employeeId?: string | null;
  employeeName?: string | null;
  storeId?: string | null;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
  _collection?: 'expenses' | 'billingItems';
}

/**
 * Accurately determines if an item is an expense.
 * A product or service sold at a discount or loss (negative profit) is NEVER an expense.
 */
export const isExpenseItem = (item: any): boolean => {
  if (!item) return false;
  if (item._collection === 'expenses') return true;
  if (item.type === 'expense') return true;
  if (item.type === 'product' || item.type === 'service' || item.type === 'credit') return false;
  if ((item.sellingPrice || 0) > 0) return false;
  if ((item.cost || 0) > 0 && (item.sellingPrice || 0) === 0 && !item.productCode && !item.imei && !item.productId) {
    return true;
  }
  return false;
};

// ===== HUB & STORE TYPES =====

export interface Hub {
  id?: string;
  name: string;
  ownerName: string;
  address?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
}

export interface Store {
  id?: string;
  hubId: string;
  shopName?: string;
  name: string;
  code?: string;
  branchId?: string;
  ownerName?: string;
  managerName?: string;
  managerId?: string;
  address?: string;
  phone?: string;
  email?: string;
  gst?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  upiId?: string;
  merchantName?: string;
  /** Enables the Branch Purchase module (Purchases, Add Purchase, Add Purchase IMEI, Master Settings) for this branch */
  purchaseEnabled?: boolean;
  /** Enables the Recharge module for this branch (managed from HO) */
  rechargeEnabled?: boolean;
  /** Cumulative counters maintained atomically by Billing (0 extra reads for HO) */
  lifetimeRevenue?: number;
  lifetimeBills?: number;
  totalStockUnits?: number;
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
}

export interface StockTransferItem {
  productId: string;
  productCode: string;
  productName: string;
  brand: string;
  category: string;
  quantity: number;
  cost: number;
  mrp: number;
  imei?: string;
  picked?: boolean;
  pickedAt?: any;
  received?: boolean;
  receivedAt?: any;
  receivedBy?: string;
  receivedByName?: string;
}

export type TransferStatus =
  | 'draft'
  | 'triggered'
  | 'picked'
  | 'received'
  | 'dispatched'
  | 'pending'
  | 'in-transit'
  | 'completed'
  | 'cancelled';

export interface StockTransfer {
  id?: string;
  hubId: string;
  transferType?: 'hq_to_branch' | 'branch_to_branch';
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  items: StockTransferItem[];
  totalItems: number;
  totalQuantity: number;
  totalValue: number; // total cost value of transferred items
  status: TransferStatus;
  notes?: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  triggeredAt?: Date;
  pickedAt?: Date;
  pickedBy?: string;
  pickedByName?: string;
  receivedAt?: Date;
  receivedBy?: string;
  receivedByName?: string;
  completedAt?: Date;
  completedBy?: string;
  completedByName?: string;
  cancelledAt?: Date;
  cancelledBy?: string;
  cancelReason?: string;
}

export interface User {
  uid: string;
  email: string;
  phone?: string;
  address?: string;
  joiningDate?: string;
  role: UserRole;
  displayName?: string;
  name?: string;
  isActive?: boolean;
  createdAt?: Date;
  createdBy?: string;
  createdByName?: string;
  allowedDeviceToken?: string; // For Admin device binding
  // Multi-store fields
  hubId?: string; // The hub this user belongs to
  storeId?: string; // The store this user is assigned to (null for hub-level users)
  storeName?: string;
  scope?: 'hub' | 'store'; // Whether user operates at hub or store level
}

export type UserRole =
  | 'owner'
  | 'hq-admin'
  | 'hub-admin'
  | 'store-admin'
  | 'admin'
  | 'manager'
  | 'sales_person'
  | 'technician'
  | 'cashier'
  | 'employee'
  | 'qr';

export interface ShopDetails {
  shopName: string;
  ownerName: string;
  address: string;
  phone: string;
  email: string;
  gst?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  upiId?: string; // UPI ID for QR code generation
  merchantName?: string; // Merchant name for UPI QR
}

export interface Product {
  id?: string;
  productCode: string; // 8-digit unique code
  hcsCode?: string;
  name: string;
  model?: string;
  cost: number;
  baseCost?: number;
  mrp: number;
  brand: string;
  category: string;
  paymentType: string;
  supplier?: string;
  quantity: number;
  isAvailable?: boolean; // Product availability status
  imageUrl?: string;
  suitableModels?: string[]; // Array of compatible model names (for accessories/parts)
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
  imei?: string;
  sourcePurchaseId?: string;
  storeId?: string; // Store this product belongs to
  mop?: number;
  taxPercent?: number;
  highestDiscountLimit?: number;
  gstEnabled?: boolean;
}

export interface Supplier {
  id?: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  totalPurchaseAmount: number; // Total purchases from this supplier
  totalPaid: number; // Total amount paid to supplier
  totalPending: number; // Total amount pending
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
}

export interface SupplierPayment {
  id?: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  type: 'payment_out' | 'payment_in' | 'purchase'; // payment_out = paid to supplier, payment_in = received from supplier, purchase = total purchase amount
  paymentMode: PaymentMode;
  paymentSplit?: PaymentSplit;
  notes?: string;
  referenceNumber?: string;
  relatedPurchaseId?: string; // Link to related purchase if applicable
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
}

export interface CreditClearance {
  id?: string;
  purchaseId: string; // Reference to the credit purchase
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  amountCleared: number;
  paymentMode: PaymentMode;
  paymentSplit?: PaymentSplit;
  notes?: string;
  clearedAt: Date;
  clearedBy: string;
  clearedByName?: string;
}

export interface PurchaseItem {
  productCode?: string;
  hcsCode?: string;
  productName: string;
  brand: string;
  model?: string;
  category: string;
  quantity: number;
  costPerUnit: number;
  totalCost: number;
  costWithGst?: number;
  mrp?: number;
  imei?: string;
  mop?: number;
  taxPercent?: number;
  highestDiscountLimit?: number;
  gstEnabled?: boolean;
  baseCost?: number;
}

export interface Purchase {
  id?: string;
  purchaseNumber: string; // Auto-generated purchase reference number
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  totalQuantity: number;
  totalAmount: number;
  baseAmount?: number;
  totalGstAmount?: number;
  gstEnabled?: boolean;
  paidAmount: number;
  pendingAmount: number;
  paymentMode: PaymentMode;
  paymentSplit?: PaymentSplit;
  paymentStatus: 'paid' | 'pending' | 'unpaid'; // Simplified status: paid (full), pending (partial), unpaid (none)
  isCredit: boolean; // Flag to indicate if this purchase is on credit
  creditCleared: number; // Total amount cleared against this credit purchase
  invoiceNumber?: string;
  notes?: string;
  isIMEIPurchase?: boolean;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
}

export interface Customer {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  gstNo?: string;
  homeStoreId?: string;
  homeStoreName?: string;
  createdAt: Date;
  createdBy?: string;
  createdByName?: string;
}

export interface StockRequirement {
  id?: string;
  productName: string;
  customerId: string;
  customerName: string;
  mobile: string;
  status: 'pending' | 'stock-updated' | 'customer-updated';
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
  updatedBy?: string;
  updatedByName?: string;
  _storeId?: string;
  _storeName?: string;
}

export interface ServiceRequest {
  id?: string;
  productName: string;
  customerId: string;
  customerName: string;
  mobile: string;
  cost: number;
  lockType: 'none' | 'text' | 'pattern';
  password?: string;
  pattern?: number[];
  status: 'pending' | 'serviced' | 'customer-updated' | 'received' | 'inspecting' | 'waiting-approval' | 'repairing' | 'ready-delivery' | 'delivered';
  _storeId?: string;
  _storeName?: string;
  // Job info
  jobSheetNumber?: string;
  jobDate?: string;
  jobTime?: string;
  serviceType?: 'walk-in' | 'pickup' | 'warranty' | 'insurance';
  priority?: 'normal' | 'urgent';
  // Customer details
  alternateNumber?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  // Device details
  brand?: string;
  modelName?: string;
  imei1?: string;
  imei2?: string;
  serialNumber?: string;
  color?: string;
  storageVariant?: string;
  processorVariant?: string;
  purchaseDate?: string;
  warrantyStatus?: 'in-warranty' | 'out-of-warranty';
  // Security details
  screenLockType?: 'none' | 'pin' | 'password' | 'pattern' | 'fingerprint' | 'face-lock';
  unlockCode?: string;
  googleAccountRemoved?: boolean;
  appleIdRemoved?: boolean;
  frpLockStatus?: 'unknown' | 'locked' | 'unlocked';
  simRemoved?: boolean;
  memoryCardRemoved?: boolean;
  // Complaint and inspection
  issues?: string[];
  issueNotes?: string;
  inspection?: Record<string, boolean>;
  accessoriesReceived?: string[];
  // Diagnosis and repair
  preliminaryInspection?: string;
  possibleCause?: string;
  partsRequired?: string;
  estimatedRepairTime?: string;
  workPerformed?: string;
  partsReplaced?: string;
  softwareUpdated?: boolean;
  dataBackupTaken?: boolean;
  factoryResetDone?: boolean;
  waterCleaningDone?: boolean;
  solderingWorkDone?: boolean;
  spareParts?: Array<{
    partName: string;
    quantity: number;
    price: number;
    warranty: string;
  }>;
  // Approval and payment
  approvedCost?: number;
  advancePaid?: number;
  paymentMethod?: 'cash' | 'upi' | 'card' | 'bank-transfer';
  customerSignature?: string;
  // Testing and delivery
  finalTesting?: Record<string, boolean>;
  deliveryDate?: string;
  deliveredBy?: string;
  receivedByCustomer?: string;
  balanceAmount?: number;
  deliverySignature?: string;
  // Additional features
  qrCodeValue?: string;
  photoUrls?: string[];
  internalNotes?: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
  updatedBy?: string;
  updatedByName?: string;
}

export interface Attendance {
  id?: string;
  userId: string;
  userName: string;
  checkInTime: Date;
  checkOutTime: Date | null;
  checkInLocation: {
    latitude: number;
    longitude: number;
  };
  checkOutLocation: {
    latitude: number;
    longitude: number;
  } | null;
  distanceFromShop: number; // in meters
  date: string; // YYYY-MM-DD format for easy querying
  status: 'checked-in' | 'checked-out';
  workHours: number | null; // in hours
  // Break tracking
  breaks: Array<{
    startTime: Date;
    endTime: Date | null;
  }>;
  totalBreakTime: number | null; // in minutes
  isOnBreak: boolean;
  // Lunch tracking
  lunchStartTime: Date | null;
  lunchEndTime: Date | null;
  lunchDuration: number | null; // in minutes
  isOnLunch: boolean;
}

export interface AttendanceStats {
  totalEmployees: number;
  currentlyCheckedIn: number;
  attendanceRate: number; // percentage
  totalHoursToday: number;
}

export interface Brand {
  id?: string;
  name: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
}

export interface Category {
  id?: string;
  name: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
}

export interface FinanceProvider {
  id?: string;
  name: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
}

export interface RechargeProvider {
  id?: string;
  providerName: string; // e.g., "Airtel", "Jio", "Vi", etc.
  accountNumber?: string; // Provider account number
  imageUrl?: string; // Optional provider logo/image URL
  balance: number; // Current balance in the provider account
  outstandingBalance: number; // Amount we owe to the provider
  totalRechargeAmount: number; // Total amount used for recharges
  totalCommission: number; // Total commission earned
  totalPaidAmount: number; // Total amount we paid to provider (settlement)
  totalCreditAmount: number; // Total credit taken from provider
  isActive: boolean;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
}

export interface RechargeTransaction {
  id?: string;
  providerId: string; // Reference to the provider used
  providerName: string;
  customerNumber: string; // Mobile number recharged
  rechargeAmount: number; // Amount recharged
  commission?: number; // Optional commission earned
  balanceAfter: number; // Balance after this transaction
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
}

export interface ProviderTransaction {
  id?: string;
  providerId: string;
  providerName: string;
  type: 'refill' | 'payment';
  paymentType: 'credit' | 'paid'; // 'paid' for immediate payment/cash refill, 'credit' for credit refill
  amount: number;
  receivedAmount?: number; // Amount added to wallet
  commission?: number; // Difference between received and paid
  outstandingBalanceAfter: number;
  walletBalanceAfter: number;
  description?: string;
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
}

export interface DefectProduct {
  id?: string;
  productCode?: string; // Reference to original product if available
  productName: string;
  brand: string;
  model?: string;
  category: string;
  quantity: number;
  cost: number; // Original cost per unit
  totalCost: number; // Total cost (quantity * cost)
  defectType: 'damaged' | 'defective' | 'expired' | 'other';
  defectReason: string; // Detailed reason for defect
  supplier?: string;
  actionTaken: 'pending' | 'returned' | 'discarded' | 'repaired' | 'sold-at-loss';
  actionNotes?: string;
  recoverableAmount?: number; // Amount recovered (if returned/sold)
  lossAmount?: number; // Final loss amount
  createdAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedAt?: Date;
  updatedBy?: string;
  updatedByName?: string;
}

// ===== SETTLEMENT TYPES =====

export interface SettlementExpected {
  totalSales: number;
  totalExpenses: number;
  totalRevenue: number;
  totalProfit: number;
  totalDiscount: number;
  cash: number;
  upi: number;
  card: number;
  finance: number;
  credit: number;
  cheque: number;
  split: number;
  splitCash: number;
  splitUpi: number;
  splitCard: number;
  transactionCount: number;
  salesCount: number;
  expenseCount: number;
}

export interface SettlementActual {
  cash: number;
  upi: number;
  card: number;
  finance: number;
  credit: number;
  cheque: number;
  notes?: string;
}

export interface SettlementDifference {
  cash: number;
  upi: number;
  card: number;
  total: number;
}

export interface Settlement {
  id?: string;
  type: 'daily' | 'monthly';
  date: string; // YYYY-MM-DD for daily, YYYY-MM for monthly
  period: {
    start: Date;
    end: Date;
  };
  expected: SettlementExpected;
  actual: SettlementActual;
  difference: SettlementDifference;
  status: 'open' | 'settled' | 'reviewed';
  settledBy: string;
  settledByName: string;
  reviewedBy?: string;
  reviewedByName?: string;
  notes?: string;
  storeId?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export type { StockAgingSettings, EmployeeTarget } from '../utils/stockAging';

