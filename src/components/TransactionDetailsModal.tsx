import React from 'react';
import { X, Calendar, User, Phone, Mail, CreditCard, Layers, Package, Tag, Hourglass } from 'lucide-react';
import type { BillingItem } from '../types';

interface TransactionDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    transaction: BillingItem;
}

const TransactionDetailsModal: React.FC<TransactionDetailsModalProps> = ({ isOpen, onClose, transaction }) => {
    if (!isOpen) return null;

    const formatCurrency = (amount: number) => {
        return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatDate = (date: any) => {
        if (!date) return 'N/A';
        // Handle Firestore Timestamp or Date object or string
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Handle multi-item transactions
    const items = (transaction as any).items || [transaction];
    const isMultiItem = items.length > 1;

    // Calculate subtotal (before discount) - sum of all item subtotals
    // For combined orders, this should be the sum of itemSubtotal fields
    // For single items, fall back to sellingPrice * quantity
    const subtotal = items.reduce((sum: number, item: any) => {
        if (item.itemSubtotal !== undefined && item.itemSubtotal !== null) {
            return sum + item.itemSubtotal;
        }
        return sum + (item.sellingPrice * item.quantity);
    }, 0);

    // Calculate discount - sum of all item discounts if available, otherwise use transaction discountAmount
    const discount = items.reduce((sum: number, item: any) => sum + (item.itemDiscount || 0), 0)
        || transaction.discountAmount
        || 0;

    // Tax - sum of all item GST amounts
    const tax = items.reduce((sum: number, item: any) => sum + (item.gstAmount || 0), 0) || 0;

    const netBeforeRoundOff = subtotal - discount;
    const roundOff = transaction.roundOff !== undefined && transaction.roundOff !== null
        ? Number(transaction.roundOff)
        : (items[0]?.roundOff !== undefined && items[0]?.roundOff !== null
            ? Number(items[0].roundOff)
            : (transaction.grandTotal !== undefined && transaction.grandTotal !== null && Math.abs(Number(transaction.grandTotal) - netBeforeRoundOff) < 10
                ? Number((Number(transaction.grandTotal) - netBeforeRoundOff).toFixed(2))
                : 0));

    // Grand Total
    const total = transaction.grandTotal !== undefined && transaction.grandTotal !== null
        ? Number(transaction.grandTotal)
        : (subtotal > 0 ? Number((netBeforeRoundOff + roundOff).toFixed(2)) : (transaction.sellingPrice || transaction.totalWithGst || 0));

    return (
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center p-0 md:p-4 bg-transparent backdrop-blur-sm bg-opacity-75">
            <div
                className="bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full md:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-slide-up md:animate-in md:fade-in md:zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-100 flex justify-between items-start bg-gray-50 sticky top-0 z-10">
                    <div>
                        <h2 className="text-base md:text-xl font-bold text-gray-900 flex items-center gap-2">
                            Transaction Details
                            {isMultiItem && (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full font-medium flex items-center gap-1">
                                    <Layers className="w-3 h-3" /> Combined
                                </span>
                            )}
                        </h2>
                        <div className="flex items-center gap-1.5 text-xs md:text-sm text-gray-500 mt-0.5 md:mt-1">
                            <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4" />
                            {formatDate(transaction.createdAt)}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 md:p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 hover:text-gray-700"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="overflow-y-auto flex-1 p-3 md:p-6 space-y-3 md:space-y-6">

                    {/* Customer & Payment Info Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
                        {/* Customer Info */}
                        <div className="bg-blue-50 p-3 md:p-4 rounded-xl border border-blue-100">
                            <h3 className="text-xs md:text-sm font-semibold text-blue-900 uppercase tracking-wider mb-2 md:mb-3 flex items-center gap-2">
                                <User className="w-3.5 h-3.5 md:w-4 md:h-4" /> Customer Details
                            </h3>
                            <div className="space-y-1.5 md:space-y-2">
                                <p className="text-xs md:text-sm text-gray-700 font-medium">
                                    {transaction.customerName || 'Walk-in Customer'}
                                </p>
                                {(transaction.customerPhone || (transaction as any).creditCustomerName) && (
                                    <p className="text-xs md:text-sm text-gray-600 flex items-center gap-1.5 md:gap-2">
                                        <Phone className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                        {transaction.customerPhone || 'N/A'}
                                    </p>
                                )}
                                {(transaction as any).customerEmail && (
                                    <p className="text-xs md:text-sm text-gray-600 flex items-center gap-1.5 md:gap-2">
                                        <Mail className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                        {(transaction as any).customerEmail}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Payment Info */}
                        <div className="bg-green-50 p-3 md:p-4 rounded-xl border border-green-100">
                            <h3 className="text-xs md:text-sm font-semibold text-green-900 uppercase tracking-wider mb-2 md:mb-3 flex items-center gap-2">
                                <CreditCard className="w-3.5 h-3.5 md:w-4 md:h-4" /> Payment Info
                            </h3>
                            <div className="space-y-1.5 md:space-y-2">
                                <div className="flex justify-between text-xs md:text-sm">
                                    <span className="text-gray-600">Method:</span>
                                    <span className="font-medium capitalize px-1.5 md:px-2 py-0.5 bg-white rounded border border-green-200 text-green-700">
                                        {transaction.paymentMode}
                                    </span>
                                </div>
                                {transaction.paymentMode === 'split' && transaction.paymentSplit && (
                                    <div className="text-xs text-gray-500 bg-white/50 p-2 rounded mt-1 space-y-1">
                                        {(transaction.paymentSplit.cash || 0) > 0 && <div>Cash: {formatCurrency(transaction.paymentSplit.cash || 0)}</div>}
                                        {(transaction.paymentSplit.upi || 0) > 0 && <div>UPI: {formatCurrency(transaction.paymentSplit.upi || 0)}</div>}
                                        {(transaction.paymentSplit.card || 0) > 0 && <div>Card: {formatCurrency(transaction.paymentSplit.card || 0)}</div>}
                                    </div>
                                )}
                                {transaction.paymentMode === 'finance' && (
                                    <div className="text-xs text-gray-500 bg-white/50 p-2 rounded mt-1 space-y-1">
                                        <div>Provider: {transaction.financeProvider || 'N/A'}</div>
                                        <div>Down Payment: {formatCurrency(transaction.financeDownPayment || 0)}</div>
                                        <div>Tenure: {transaction.financeTenureMonths || 0} months</div>
                                        <div>Finance Amount: {formatCurrency(transaction.financeAmount || 0)}</div>
                                        <div>Monthly EMI: {formatCurrency(transaction.monthlyEmi || 0)}</div>
                                    </div>
                                )}
                                <div className="flex justify-between text-xs md:text-sm pt-1">
                                    <span className="text-gray-600">Status:</span>
                                    <span className={`font-medium ${transaction.type === 'credit' && !transaction.isPaid ? 'text-red-600' : 'text-green-600'}`}>
                                        {transaction.type === 'credit' && !transaction.isPaid ? 'Pending' : 'Completed'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Items List */}
                    <div>
                        <h3 className="text-xs md:text-sm font-semibold text-gray-900 uppercase tracking-wider mb-2 md:mb-3 flex items-center gap-2">
                            <Package className="w-3.5 h-3.5 md:w-4 md:h-4" /> Order Items
                        </h3>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-xs md:text-sm">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="px-2 md:px-4 py-1.5 md:py-2 text-left font-medium">Item</th>
                                        <th className="px-2 md:px-4 py-1.5 md:py-2 text-right font-medium">Price</th>
                                        <th className="px-2 md:px-4 py-1.5 md:py-2 text-center font-medium">Qty</th>
                                        <th className="px-2 md:px-4 py-1.5 md:py-2 text-right font-medium">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {items.map((item: any, idx: number) => {
                                        // For combined items, unit price might be derived or explicit
                                        const unitPrice = item.sellingPrice || 0;
                                        const itemTotal = unitPrice * (item.quantity || 1);
                                        return (
                                            <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-2 md:px-4 py-2 md:py-3">
                                                    <div className="text-gray-900 font-medium flex items-center gap-1.5 flex-wrap">
                                                        <span>{item.title || item.name}</span>
                                                        {item.isAgingStock && (
                                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[10px] font-bold rounded border border-amber-300">
                                                                <Hourglass className="w-2.5 h-2.5 text-amber-600" />
                                                                Aging ({item.agingDays}d)
                                                                {item.agingIncentiveAmount > 0 && (
                                                                    <span className="text-emerald-700 ml-0.5">+₹{Math.round(item.agingIncentiveAmount)} Bonus</span>
                                                                )}
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Additional Product Details */}
                                                    <div className="text-[10px] md:text-xs text-gray-500 mt-1 space-y-0.5">
                                                        {item.productCode && <div><span className="font-medium text-gray-600">Code:</span> {item.productCode}</div>}
                                                        {(item.imei || item.code) && <div><span className="font-medium text-gray-600">IMEI/SN:</span> {item.imei || item.code}</div>}
                                                        {item.hsnCode && <div><span className="font-medium text-gray-600">HSN:</span> {item.hsnCode}</div>}
                                                        {item.brand && <div><span className="font-medium text-gray-600">Brand:</span> {item.brand}</div>}
                                                        {item.category && <div><span className="font-medium text-gray-600">Category:</span> {item.category}</div>}
                                                        {item.warranty && <div><span className="font-medium text-gray-600">Warranty:</span> {item.warranty}</div>}
                                                    </div>

                                                    {item.itemDiscount > 0 && (
                                                        <div className="text-xs text-green-600 flex items-center gap-1 mt-1">
                                                            <Tag className="w-3 h-3" /> Discount: {formatCurrency(item.itemDiscount)}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-2 md:px-4 py-2 md:py-3 text-right text-gray-600">{formatCurrency(unitPrice)}</td>
                                                <td className="px-2 md:px-4 py-2 md:py-3 text-center text-gray-600">{item.quantity}</td>
                                                <td className="px-2 md:px-4 py-2 md:py-3 text-right text-gray-900 font-medium">{formatCurrency(itemTotal)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Totals Summary */}
                    <div className="flex justify-end">
                        <div className="w-full md:w-1/2 bg-gray-50 rounded-xl p-3 md:p-4 space-y-2 md:space-y-3">
                            <div className="flex justify-between text-xs md:text-sm text-gray-600">
                                <span>Subtotal</span>
                                <span>{formatCurrency(subtotal)}</span>
                            </div>

                            {discount > 0 && (
                                <div className="flex justify-between text-xs md:text-sm text-green-600">
                                    <span>Discount</span>
                                    <span>-{formatCurrency(discount)}</span>
                                </div>
                            )}

                            {tax > 0 && (
                                <div className="flex justify-between text-xs md:text-sm text-gray-600">
                                    <span>GST (Inclusive)</span>
                                    <span>{formatCurrency(tax)}</span>
                                </div>
                            )}

                            {roundOff !== 0 && (
                                <div className="flex justify-between text-xs md:text-sm text-gray-600">
                                    <span>Round Off</span>
                                    <span className={roundOff < 0 ? 'text-red-500 font-medium' : 'text-emerald-600 font-medium'}>
                                        {roundOff > 0 ? `+${formatCurrency(roundOff)}` : `-${formatCurrency(Math.abs(roundOff))}`}
                                    </span>
                                </div>
                            )}

                            {items.some((i: any) => i.isAgingStock) && (
                                <div className="flex justify-between text-xs md:text-sm text-amber-900 bg-amber-50 px-2 py-1.5 rounded-lg border border-amber-200">
                                    <span className="flex items-center gap-1 font-semibold">
                                        <Hourglass className="w-3.5 h-3.5 text-amber-600" /> Aging Clearance Bonus:
                                    </span>
                                    <span className="font-bold text-emerald-700">
                                        {formatCurrency(items.reduce((sum: number, it: any) => sum + (it.agingIncentiveAmount || 0), 0))}
                                    </span>
                                </div>
                            )}

                            <div className="border-t border-gray-200 pt-2 md:pt-3 flex justify-between items-center">
                                <span className="font-bold text-gray-900 text-base md:text-lg">Grand Total</span>
                                <span className="font-bold text-blue-600 text-lg md:text-xl">{formatCurrency(total)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Footer - Sold By */}
                    <div className="text-[10px] md:text-xs text-gray-400 text-center pt-3 md:pt-4 border-t border-gray-100">
                        Transaction ID: {transaction.transactionId || transaction.id || 'N/A'} • Sold by {transaction.createdByName || transaction.createdBy || 'Unknown'}
                    </div>

                </div>
            </div>
        </div>
    );
};

export default TransactionDetailsModal;
