import React, { useState } from 'react';
import type { BillingItem, ShopDetails } from '../types';
import ShareModal from './ShareModal';

interface BillingListProps {
  items: BillingItem[];
  onDelete: (id: string) => void;
  onEdit: (item: BillingItem) => void;
  isOwner: boolean;
  shopDetails?: ShopDetails;
}

const BillingList: React.FC<BillingListProps> = ({ items, onDelete, onEdit, isOwner, shopDetails }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'profit' | 'title'>('date');
  const [selectedItem, setSelectedItem] = useState<BillingItem | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const filteredItems = items.filter(item =>
    item.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedItems = [...filteredItems].sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'profit':
        return b.totalProfit - a.totalProfit;
      case 'title':
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });

  const totalRevenue = items.reduce((sum, item) => sum + (item.sellingPrice * item.quantity), 0);
  const totalCost = items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);
  const totalProfit = items.reduce((sum, item) => sum + item.totalProfit, 0);

  const handleInvoiceClick = (item: BillingItem) => {
    if (!shopDetails) {
      alert('Shop details not configured. Please set up shop details first.');
      return;
    }
    setSelectedItem(item);
    setShowShareModal(true);
  };

  return (
    <>
      <ShareModal
        isOpen={showShareModal}
        onClose={() => {
          setShowShareModal(false);
          setSelectedItem(null);
        }}
        item={selectedItem!}
        shopDetails={shopDetails || {
          shopName: 'Your Shop Name',
          ownerName: 'Owner',
          address: 'Shop Address',
          phone: '1234567890',
          email: 'shop@example.com',
          gst: ''
        }}
      />
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <h3 className="text-gray-900 text-xl font-bold m-0">
          Billing Items ({items.length})
        </h3>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-2.5 border-2 border-gray-200 rounded-lg text-sm min-w-[200px] transition-all duration-200 bg-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'profit' | 'title')}
            className="px-4 py-2.5 border-2 border-gray-200 rounded-lg text-sm bg-white cursor-pointer transition-all duration-200 text-gray-700 font-medium focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          >
            <option value="date">Sort by Date</option>
            <option value="profit">Sort by Profit</option>
            <option value="title">Sort by Title</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white px-5 py-4 rounded-xl border-2 border-gray-200 flex flex-col gap-2 transition-all duration-200 hover:border-gray-300 hover:shadow-md">
          <span className="text-xs text-gray-600 font-semibold uppercase tracking-wide">
            Total Revenue
          </span>
          <span className="text-3xl font-bold text-blue-500">
            ₹{totalRevenue.toFixed(2)}
          </span>
        </div>
        <div className="bg-white px-5 py-4 rounded-xl border-2 border-gray-200 flex flex-col gap-2 transition-all duration-200 hover:border-gray-300 hover:shadow-md">
          <span className="text-xs text-gray-600 font-semibold uppercase tracking-wide">
            Total Cost
          </span>
          <span className="text-3xl font-bold text-yellow-500">
            ₹{totalCost.toFixed(2)}
          </span>
        </div>
        <div className="bg-white px-5 py-4 rounded-xl border-2 border-gray-200 flex flex-col gap-2 transition-all duration-200 hover:border-gray-300 hover:shadow-md">
          <span className="text-xs text-gray-600 font-semibold uppercase tracking-wide">
            Total Profit
          </span>
          <span className={`text-3xl font-bold ${totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            ₹{totalProfit.toFixed(2)}
          </span>
        </div>
      </div>

      {sortedItems.length === 0 ? (
        <div className="text-center py-12 px-6 text-gray-400 text-base">
          <p>No billing items found. Add your first item above!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedItems.map((item) => (
            <div
              key={item.id}
              className="border-2 border-gray-200 rounded-xl p-5 transition-all duration-200 bg-white hover:-translate-y-0.5 hover:shadow-lg hover:border-gray-300"
            >
              <div className="flex justify-between items-start mb-4 pb-4 border-b-2 border-gray-100">
                <h4 className="m-0 text-gray-900 text-lg font-semibold">
                  {item.title}
                </h4>
                <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-md font-medium">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>
              
              <div className="flex flex-col gap-2.5 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 font-medium">Cost Price:</span>
                  <span className="font-semibold text-gray-900">₹{item.cost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 font-medium">Selling Price:</span>
                  <span className="font-semibold text-gray-900">₹{item.sellingPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 font-medium">Quantity:</span>
                  <span className="font-semibold text-gray-900">{item.quantity}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 font-medium">Unit Profit:</span>
                  <span className={`font-semibold ${item.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    ₹{item.profit.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-base pt-3 border-t-2 border-gray-100 font-semibold">
                  <span className="text-gray-600 font-medium">Total Profit:</span>
                  <span className={`font-semibold ${item.totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    ₹{item.totalProfit.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-gray-100">
                  <span className="text-gray-600 font-medium">Payment:</span>
                  <span className="font-semibold text-purple-600 uppercase text-xs">
                    {item.paymentMode}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleInvoiceClick(item)}
                  className="flex-1 px-4 py-2.5 border-none rounded-lg text-sm font-semibold cursor-pointer transition-all duration-200 bg-green-500 text-white shadow-sm hover:bg-green-600 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(34,197,94,0.3)]"
                  title="Share Invoice"
                >
                  📤 Share
                </button>
                <button
                  onClick={() => onEdit(item)}
                  className="flex-1 px-4 py-2.5 border-none rounded-lg text-sm font-semibold cursor-pointer transition-all duration-200 bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.3)]"
                  title="Edit item"
                >
                  Edit
                </button>
                {isOwner && (
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to delete this item?')) {
                        onDelete(item.id!);
                      }
                    }}
                    className="flex-1 px-4 py-2.5 border-none rounded-lg text-sm font-semibold cursor-pointer transition-all duration-200 bg-red-500 text-white shadow-sm hover:bg-red-600 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(239,68,68,0.3)]"
                    title="Delete item"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
};

export default BillingList;
