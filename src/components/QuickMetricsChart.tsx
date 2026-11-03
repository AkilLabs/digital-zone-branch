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
import { isExpenseItem, type BillingItem } from '../types';

type Props = {
  items: BillingItem[];
  days?: number;
};

const QuickMetricsChart: React.FC<Props> = ({ items, days = 7 }) => {
  const metrics = useMemo(() => {
    const today = new Date();
    const recentItems = items.filter((item) => {
      const itemDate = new Date(item.createdAt);
      const daysDiff = Math.floor((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff < days;
    });

    let totalRevenue = 0;
    let totalExpenses = 0;
    let totalProfit = 0;
    let salesCount = 0;
    let expenseCount = 0;

    recentItems.forEach((item) => {
      const qty = item.quantity || 1;
      const isExpense = isExpenseItem(item);

      if (isExpense) {
        totalExpenses += Math.abs(item.cost || item.profit || 0) * qty;
        expenseCount++;
      } else {
        totalRevenue += item.sellingPrice * qty;
        totalProfit += item.totalProfit || 0;
        salesCount++;
      }
    });

    const avgSaleValue = salesCount > 0 ? totalRevenue / salesCount : 0;

    return [
      { name: 'Revenue', value: Math.round(totalRevenue * 100) / 100, color: '#3B82F6' },
      { name: 'Expenses', value: Math.round(totalExpenses * 100) / 100, color: '#EF4444' },
      { name: 'Profit', value: Math.round(totalProfit * 100) / 100, color: '#10B981' },
      { name: 'Avg Sale', value: Math.round(avgSaleValue * 100) / 100, color: '#8B5CF6' },
      { name: 'Sales Count', value: salesCount, color: '#F59E0B' },
    ];
  }, [items, days]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
          <p className="font-semibold text-gray-900 mb-1">{data.name}</p>
          <p className="text-sm" style={{ color: data.color }}>
            {data.name === 'Sales Count' ? data.value : `₹${data.value.toFixed(2)}`}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
      <div className="mb-4">
        <h3 className="text-base md:text-lg font-bold text-gray-900">
          Quick Metrics Overview
        </h3>
        <p className="text-xs md:text-sm text-gray-500 mt-1">
          Last {days} days summary
        </p>
      </div>

      <div className="w-full h-[250px]" style={{ minHeight: '250px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={metrics}
            margin={{ top: 10, right: 10, left: 0, bottom: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="name"
              stroke="#6B7280"
              style={{ fontSize: '11px' }}
              angle={-15}
              textAnchor="end"
              height={60}
            />
            <YAxis stroke="#6B7280" style={{ fontSize: '12px' }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {metrics.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
        {metrics.map((metric, index) => (
          <div key={index} className="text-center p-2 bg-gray-50 rounded-lg">
            <div
              className="w-3 h-3 rounded-full mx-auto mb-1"
              style={{ backgroundColor: metric.color }}
            />
            <p className="text-xs text-gray-600">{metric.name}</p>
            <p className="text-sm font-semibold text-gray-900">
              {metric.name === 'Sales Count' ? metric.value : `₹${metric.value.toFixed(2)}`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default QuickMetricsChart;
