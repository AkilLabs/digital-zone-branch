import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { isExpenseItem, type BillingItem } from '../types';

type Props = {
  items: BillingItem[];
  days?: number;
};

const ProfitMarginChart: React.FC<Props> = ({ items, days = 7 }) => {
  const chartData = useMemo(() => {
    const today = new Date();
    const data = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const dayLabel = date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      });

      // Filter items for this specific day
      const dayItems = items.filter((item) => {
        const itemDate = new Date(item.createdAt);
        return (
          itemDate.getDate() === date.getDate() &&
          itemDate.getMonth() === date.getMonth() &&
          itemDate.getFullYear() === date.getFullYear()
        );
      });

      // Calculate metrics for sales only
      let totalRevenue = 0;
      let totalCost = 0;
      let totalProfit = 0;
      let salesCount = 0;

      dayItems.forEach((item) => {
        const qty = item.quantity || 1;
        const isExpense = isExpenseItem(item);

        if (!isExpense) {
          totalRevenue += item.sellingPrice * qty;
          totalCost += item.cost * qty;
          totalProfit += item.totalProfit || 0;
          salesCount++;
        }
      });

      const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
      const avgSaleValue = salesCount > 0 ? totalRevenue / salesCount : 0;

      data.push({
        date: dayLabel,
        'Profit Margin %': Math.round(profitMargin * 10) / 10,
        'Avg Sale': Math.round(avgSaleValue * 100) / 100,
        'Sales Count': salesCount,
      });
    }

    return data;
  }, [items, days]);

  const avgMargin = useMemo(() => {
    const margins = chartData.map(d => d['Profit Margin %']).filter(m => m > 0);
    return margins.length > 0 
      ? Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 10) / 10
      : 0;
  }, [chartData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
          <p className="font-semibold text-gray-900 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.name === 'Profit Margin %' ? `${entry.value}%` : 
                           entry.name === 'Sales Count' ? entry.value :
                           `₹${entry.value}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
        <div>
          <h3 className="text-base md:text-lg font-bold text-gray-900">
            Profit Margin Trend
          </h3>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            Average margin: <span className="font-semibold text-green-600">{avgMargin}%</span>
          </p>
        </div>
      </div>

      <div className="w-full h-[200px] md:h-[250px]" style={{ minHeight: '200px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              stroke="#6B7280"
              style={{ fontSize: '12px' }}
            />
            <YAxis stroke="#6B7280" style={{ fontSize: '12px' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
            />
            <Line
              type="monotone"
              dataKey="Profit Margin %"
              stroke="#10B981"
              strokeWidth={3}
              dot={{ fill: '#10B981', r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="Sales Count"
              stroke="#8B5CF6"
              strokeWidth={2}
              dot={{ fill: '#8B5CF6', r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ProfitMarginChart;
