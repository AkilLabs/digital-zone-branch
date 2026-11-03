import React, { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { isExpenseItem, type BillingItem } from '../types';

type Props = {
  items: BillingItem[];
  days?: number;
};

const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6'];

const SalesBreakdownChart: React.FC<Props> = ({ items, days = 7 }) => {
  const chartData = useMemo(() => {
    const today = new Date();
    const recentItems = items.filter((item) => {
      const itemDate = new Date(item.createdAt);
      const daysDiff = Math.floor((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff < days;
    });

    // Group by category (using title as category for now)
    const categoryMap = new Map<string, { revenue: number; count: number }>();

    recentItems.forEach((item) => {
      const isExpense = isExpenseItem(item);
      if (!isExpense && item.sellingPrice > 0) {
        const category = item.title;
        const qty = item.quantity || 1;
        const revenue = item.sellingPrice * qty;

        if (categoryMap.has(category)) {
          const existing = categoryMap.get(category)!;
          categoryMap.set(category, {
            revenue: existing.revenue + revenue,
            count: existing.count + 1,
          });
        } else {
          categoryMap.set(category, { revenue, count: 1 });
        }
      }
    });

    // Convert to array and sort by revenue
    const data = Array.from(categoryMap.entries())
      .map(([name, { revenue, count }]) => ({
        name: name.length > 20 ? name.substring(0, 20) + '...' : name,
        value: Math.round(revenue * 100) / 100,
        count,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6); // Top 6 categories

    return data;
  }, [items, days]);

  const totalRevenue = useMemo(() => {
    return chartData.reduce((sum, item) => sum + item.value, 0);
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const percentage = totalRevenue > 0 ? ((data.value / totalRevenue) * 100).toFixed(1) : 0;
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
          <p className="font-semibold text-gray-900 mb-1">{data.name}</p>
          <p className="text-sm text-gray-600">Revenue: ₹{data.value.toFixed(2)}</p>
          <p className="text-sm text-gray-600">Sales: {data.count}</p>
          <p className="text-sm font-semibold text-blue-600">{percentage}% of total</p>
        </div>
      );
    }
    return null;
  };

  const renderCustomLabel = (entry: any) => {
    const percentage = totalRevenue > 0 ? ((entry.value / totalRevenue) * 100).toFixed(0) : 0;
    return `${percentage}%`;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
      <div className="mb-4">
        <h3 className="text-base md:text-lg font-bold text-gray-900">
          Top Sales Categories
        </h3>
        <p className="text-xs md:text-sm text-gray-500 mt-1">
          Last {days} days • Total: ₹{totalRevenue.toFixed(2)}
        </p>
      </div>

      {chartData.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <p>No sales data available</p>
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
                  {chartData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 space-y-2">
            {chartData.map((item, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-gray-700 truncate max-w-[150px]">{item.name}</span>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-gray-900">₹{item.value.toFixed(2)}</span>
                  <span className="text-gray-500 text-xs ml-2">({item.count})</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SalesBreakdownChart;
