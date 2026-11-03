import React, { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { isExpenseItem, type BillingItem } from '../types';

type Props = {
    items: BillingItem[];
};

const SellerPerformanceChart: React.FC<Props> = ({ items }) => {
    const chartData = useMemo(() => {
        if (items.length === 0) {
            return [];
        }

        // Helper to get display name
        const getDisplayName = (item: BillingItem): string => {
            if (item.createdByName) {
                return item.createdByName;
            }
            if (item.createdBy && item.createdBy.includes('@')) {
                const name = item.createdBy.split('@')[0];
                return name.charAt(0).toUpperCase() + name.slice(1);
            }
            return item.createdBy || 'Unknown';
        };

        // Group by seller - use ALL items passed to component
        const sellerMap = new Map<string, {
            revenue: number;
            profit: number;
            expenses: number;
            salesCount: number;
            expenseCount: number;
        }>();

        items.forEach((item) => {
            const sellerName = getDisplayName(item);
            const isExpense = isExpenseItem(item);

            if (!sellerMap.has(sellerName)) {
                sellerMap.set(sellerName, {
                    revenue: 0,
                    profit: 0,
                    expenses: 0,
                    salesCount: 0,
                    expenseCount: 0,
                });
            }

            const stats = sellerMap.get(sellerName)!;

            if (isExpense) {
                stats.expenses += Math.abs(item.cost || item.profit || 0) * (item.quantity || 1);
                stats.expenseCount++;
            } else {
                stats.revenue += item.sellingPrice * item.quantity;
                stats.profit += item.totalProfit || 0;
                stats.salesCount++;
            }
        });

        // Convert to array and sort by revenue
        const data = Array.from(sellerMap.entries())
            .map(([name, stats]) => ({
                name: name.length > 12 ? name.substring(0, 12) + '...' : name,
                fullName: name,
                revenue: Math.round(stats.revenue * 100) / 100,
                profit: Math.round(stats.profit * 100) / 100,
                expenses: Math.round(stats.expenses * 100) / 100,
                salesCount: stats.salesCount,
                expenseCount: stats.expenseCount,
            }))
            .sort((a, b) => b.revenue - a.revenue);

        return data;
    }, [items]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
                    <p className="font-semibold text-gray-900 mb-2">{data.fullName}</p>
                    <p className="text-sm text-blue-600">Revenue: ₹{data.revenue.toFixed(2)}</p>
                    <p className="text-sm text-green-600">Profit: ₹{data.profit.toFixed(2)}</p>
                    <p className="text-sm text-red-600">Expenses: ₹{data.expenses.toFixed(2)}</p>
                    <div className="mt-2 pt-2 border-t border-gray-200">
                        <p className="text-xs text-gray-600">Sales: {data.salesCount} | Expenses: {data.expenseCount}</p>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
            <div className="mb-4">
                <h3 className="text-base md:text-lg font-bold text-gray-900">
                    Seller Performance
                </h3>
                <p className="text-xs md:text-sm text-gray-500 mt-1">
                    Last 7 Days • Revenue vs Profit
                </p>
            </div>

            {chartData.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                    <p>No performance data available</p>
                </div>
            ) : (
                <>
                    <div className="w-full h-[280px]" style={{ minHeight: '280px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={chartData}
                                margin={{ top: 10, right: 10, left: 0, bottom: 50 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="name"
                                    stroke="#6B7280"
                                    style={{ fontSize: '11px' }}
                                    angle={-35}
                                    textAnchor="end"
                                    height={80}
                                />
                                <YAxis stroke="#6B7280" style={{ fontSize: '12px' }} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend
                                    iconType="circle"
                                    wrapperStyle={{ fontSize: '12px' }}
                                />
                                <Bar dataKey="revenue" fill="#3B82F6" name="Revenue" radius={[8, 8, 0, 0]} />
                                <Bar dataKey="profit" fill="#10B981" name="Profit" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-4 space-y-2">
                        {chartData.map((seller, index) => (
                            <div key={index} className="p-2 bg-gray-50 rounded-lg">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-semibold text-gray-900" title={seller.fullName}>
                                        {seller.name}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {seller.salesCount} sales, {seller.expenseCount} expenses
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div>
                                        <span className="text-gray-600">Revenue:</span>
                                        <div className="font-semibold text-blue-600">₹{seller.revenue.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Profit:</span>
                                        <div className="font-semibold text-green-600">₹{seller.profit.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Expenses:</span>
                                        <div className="font-semibold text-red-600">₹{seller.expenses.toFixed(2)}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default SellerPerformanceChart;
