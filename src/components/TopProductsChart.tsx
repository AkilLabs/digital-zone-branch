import React, { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from 'recharts';
import type { BillingItem } from '../types';

type Props = {
    items: BillingItem[];
};

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

const TopProductsChart: React.FC<Props> = ({ items }) => {
    const chartData = useMemo(() => {
        // Filter only sales items (not expenses)
        const salesItems = items.filter((item) => item.sellingPrice > 0);

        if (salesItems.length === 0) {
            return [];
        }

        // Group by product name - use ALL items passed to component
        const productMap = new Map<string, { revenue: number; quantity: number; profit: number }>();

        salesItems.forEach((item) => {
            const productName = item.title;
            const revenue = item.sellingPrice * item.quantity;
            const quantity = item.quantity;
            const profit = item.totalProfit || 0;

            if (productMap.has(productName)) {
                const existing = productMap.get(productName)!;
                productMap.set(productName, {
                    revenue: existing.revenue + revenue,
                    quantity: existing.quantity + quantity,
                    profit: existing.profit + profit,
                });
            } else {
                productMap.set(productName, { revenue, quantity, profit });
            }
        });

        // Convert to array and sort by revenue
        const data = Array.from(productMap.entries())
            .map(([name, stats]) => ({
                name: name.length > 15 ? name.substring(0, 15) + '...' : name,
                fullName: name,
                revenue: Math.round(stats.revenue * 100) / 100,
                quantity: stats.quantity,
                profit: Math.round(stats.profit * 100) / 100,
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5); // Top 5 products

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
                    <p className="text-sm text-gray-600">Units Sold: {data.quantity}</p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
            <div className="mb-4">
                <h3 className="text-base md:text-lg font-bold text-gray-900">
                    Top 5 Selling Products
                </h3>
                <p className="text-xs md:text-sm text-gray-500 mt-1">
                    By Revenue • Last 7 Days
                </p>
            </div>

            {chartData.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                    <p>No sales data available</p>
                </div>
            ) : (
                <>
                    <div className="w-full h-[280px]" style={{ minHeight: '280px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={chartData}
                                margin={{ top: 10, right: 10, left: 0, bottom: 50 }}
                                layout="horizontal"
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
                                <Bar dataKey="revenue" radius={[8, 8, 0, 0]}>
                                    {chartData.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="mt-4 space-y-2">
                        {chartData.map((item, index) => (
                            <div key={index} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-500 font-semibold">#{index + 1}</span>
                                        <div
                                            className="w-3 h-3 rounded-full"
                                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                        />
                                    </div>
                                    <span className="text-gray-700 truncate font-medium" title={item.fullName}>
                                        {item.name}
                                    </span>
                                </div>
                                <div className="text-right ml-2">
                                    <div className="font-semibold text-gray-900">₹{item.revenue.toFixed(2)}</div>
                                    <div className="text-xs text-gray-500">{item.quantity} units</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default TopProductsChart;
