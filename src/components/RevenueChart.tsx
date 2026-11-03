import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
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
  type?: 'area' | 'bar';
};

const RevenueChart: React.FC<Props> = ({ items, days = 7, type = 'area' }) => {
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

      // Calculate metrics
      let revenue = 0;
      let expenses = 0;
      let profit = 0;

      dayItems.forEach((item) => {
        const qty = item.quantity || 1;
        const isExpense = isExpenseItem(item);

        if (isExpense) {
          expenses += Math.abs(item.cost || item.profit || 0) * qty;
        } else {
          revenue += item.sellingPrice * qty;
          profit += item.totalProfit || 0;
        }
      });

      data.push({
        date: dayLabel,
        Revenue: Math.round(revenue * 100) / 100,
        Expenses: Math.round(expenses * 100) / 100,
        Profit: Math.round(profit * 100) / 100,
      });
    }

    return data;
  }, [items, days]);

  const totals = useMemo(() => {
    return chartData.reduce(
      (acc, day) => ({
        revenue: acc.revenue + day.Revenue,
        expenses: acc.expenses + day.Expenses,
        profit: acc.profit + day.Profit,
      }),
      { revenue: 0, expenses: 0, profit: 0 }
    );
  }, [chartData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
          <p className="font-semibold text-gray-900 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: ₹{entry.value.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
        <div>
          <h3 className="text-base md:text-lg font-bold text-gray-900">
            {days}-Day Performance Overview
          </h3>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            Revenue, Expenses & Profit Trends
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-3 md:mt-0 text-xs md:text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <span className="text-gray-600">Revenue: ₹{totals.revenue.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <span className="text-gray-600">Expenses: ₹{totals.expenses.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <span className="text-gray-600">Profit: ₹{totals.profit.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="w-full h-[250px] md:h-[300px]" style={{ minHeight: '250px' }}>
        <ResponsiveContainer width="100%" height="100%">
          {type === 'area' ? (
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.1} />
                </linearGradient>
              </defs>
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
              <Area
                type="monotone"
                dataKey="Revenue"
                stroke="#3B82F6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorRevenue)"
              />
              <Area
                type="monotone"
                dataKey="Expenses"
                stroke="#EF4444"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorExpenses)"
              />
              <Area
                type="monotone"
                dataKey="Profit"
                stroke="#10B981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorProfit)"
              />
            </AreaChart>
          ) : (
            <BarChart
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
              <Bar dataKey="Revenue" fill="#3B82F6" radius={[8, 8, 0, 0]} />
              <Bar dataKey="Expenses" fill="#EF4444" radius={[8, 8, 0, 0]} />
              <Bar dataKey="Profit" fill="#10B981" radius={[8, 8, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {chartData.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <p>No data available for the selected period</p>
        </div>
      )}
    </div>
  );
};

export default RevenueChart;
