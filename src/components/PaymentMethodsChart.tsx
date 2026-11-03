import React, { useMemo } from 'react';
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip,
} from 'recharts';
import type { BillingItem } from '../types';

type Props = {
    items: BillingItem[];
};

const PAYMENT_COLORS = {
    cash: '#10B981', // Green
    upi: '#3B82F6',  // Blue
    card: '#8B5CF6', // Purple
    split: '#F59E0B', // Amber
    credit: '#EF4444', // Red
};

const PAYMENT_LABELS = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    split: 'Split Payment',
    credit: 'Credit',
};

const PaymentMethodsChart: React.FC<Props> = ({ items }) => {
    const chartData = useMemo(() => {
        // Filter only sales items (not expenses)
        const salesItems = items.filter((item) => item.sellingPrice > 0);

        if (salesItems.length === 0) {
            return [];
        }

        // Group by payment method - use ALL items passed to component
        const paymentMap = new Map<string, { amount: number; count: number }>();

        salesItems.forEach((item) => {
            const paymentMode = item.paymentMode || 'cash';
            const amount = item.sellingPrice * item.quantity;

            if (paymentMap.has(paymentMode)) {
                const existing = paymentMap.get(paymentMode)!;
                paymentMap.set(paymentMode, {
                    amount: existing.amount + amount,
                    count: existing.count + 1,
                });
            } else {
                paymentMap.set(paymentMode, { amount, count: 1 });
            }
        });

        // Convert to array
        const data = Array.from(paymentMap.entries())
            .map(([method, stats]) => ({
                name: PAYMENT_LABELS[method as keyof typeof PAYMENT_LABELS] || method,
                method: method,
                value: Math.round(stats.amount * 100) / 100,
                count: stats.count,
                color: PAYMENT_COLORS[method as keyof typeof PAYMENT_COLORS] || '#6B7280',
            }))
            .sort((a, b) => b.value - a.value);

        return data;
    }, [items]);

    const totalAmount = useMemo(() => {
        return chartData.reduce((sum, item) => sum + item.value, 0);
    }, [chartData]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const percentage = totalAmount > 0 ? ((data.value / totalAmount) * 100).toFixed(1) : 0;
            return (
                <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
                    <p className="font-semibold text-gray-900 mb-1">{data.name}</p>
                    <p className="text-sm text-gray-600">Amount: ₹{data.value.toFixed(2)}</p>
                    <p className="text-sm text-gray-600">Transactions: {data.count}</p>
                    <p className="text-sm font-semibold" style={{ color: data.color }}>
                        {percentage}% of total
                    </p>
                </div>
            );
        }
        return null;
    };

    const renderCustomLabel = (entry: any) => {
        const percentage = totalAmount > 0 ? ((entry.value / totalAmount) * 100).toFixed(0) : 0;
        return `${percentage}%`;
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
            <div className="mb-4">
                <h3 className="text-base md:text-lg font-bold text-gray-900">
                    Payment Methods Distribution
                </h3>
                <p className="text-xs md:text-sm text-gray-500 mt-1">
                    Last 7 Days • Total: ₹{totalAmount.toFixed(2)}
                </p>
            </div>

            {chartData.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                    <p>No payment data available</p>
                </div>
            ) : (
                <>
                    <div className="w-full h-[250px]" style={{ minHeight: '250px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={renderCustomLabel}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-4 space-y-2">
                        {chartData.map((item, index) => (
                            <div key={index} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: item.color }}
                                    />
                                    <span className="text-gray-700 font-medium">{item.name}</span>
                                </div>
                                <div className="text-right">
                                    <span className="font-semibold text-gray-900">₹{item.value.toFixed(2)}</span>
                                    <span className="text-gray-500 text-xs ml-2">({item.count} sales)</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default PaymentMethodsChart;
