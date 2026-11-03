import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import { Search, Filter, Download, Calendar, Smartphone, X } from 'lucide-react';
import type { RechargeProvider, RechargeTransaction } from '../types';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../config/firebase';

const RechargeReport: React.FC = () => {
    const [providers, setProviders] = useState<RechargeProvider[]>([]);
    const [transactions, setTransactions] = useState<RechargeTransaction[]>([]);
    const [filteredTransactions, setFilteredTransactions] = useState<RechargeTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showFiltersModal, setShowFiltersModal] = useState(false);

    // Filter states (Provider and Date)
    const [selectedProvider, setSelectedProvider] = useState<string>('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Search state (Customer Number)
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        applyFiltersAndSearch();
    }, [transactions, selectedProvider, startDate, endDate, searchQuery]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            // Fetch providers
            const providersRef = collection(db, 'rechargeProviders');
            const providersSnapshot = await getDocs(query(providersRef, orderBy('createdAt', 'desc')));
            const providersList = providersSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date(),
                updatedAt: doc.data().updatedAt?.toDate()
            })) as RechargeProvider[];
            setProviders(providersList);

            // Fetch all transactions
            const transactionsRef = collection(db, 'rechargeTransactions');
            const transactionsSnapshot = await getDocs(query(transactionsRef, orderBy('createdAt', 'desc')));
            const transactionsList = transactionsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date()
            })) as RechargeTransaction[];
            setTransactions(transactionsList);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const applyFiltersAndSearch = () => {
        let filtered = [...transactions];

        // Provider filter
        if (selectedProvider !== 'all') {
            filtered = filtered.filter(t => t.providerId === selectedProvider);
        }

        // Date range filter
        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            filtered = filtered.filter(t => new Date(t.createdAt) >= start);
        }

        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            filtered = filtered.filter(t => new Date(t.createdAt) <= end);
        }

        // Customer number search
        if (searchQuery) {
            filtered = filtered.filter(t =>
                t.customerNumber.includes(searchQuery)
            );
        }

        setFilteredTransactions(filtered);
    };

    const getProviderImage = (providerId: string) => {
        const provider = providers.find(p => p.id === providerId);
        return provider?.imageUrl || '';
    };

    const clearFilters = () => {
        setSelectedProvider('all');
        setStartDate('');
        setEndDate('');
    };

    const clearSearch = () => {
        setSearchQuery('');
    };

    const hasActiveFilters = selectedProvider !== 'all' || startDate || endDate;

    const exportToCSV = () => {
        if (filteredTransactions.length === 0) return;

        const headers = ['Date', 'Time', 'Provider', 'Customer Number', 'Amount', 'Commission', 'Balance After', 'Created By'];
        const csvData = filteredTransactions.map(t => [
            new Date(t.createdAt).toLocaleDateString('en-IN'),
            new Date(t.createdAt).toLocaleTimeString('en-IN'),
            t.providerName,
            t.customerNumber,
            t.rechargeAmount.toFixed(2),
            (t.commission || 0).toFixed(2),
            t.balanceAfter.toFixed(2),
            t.createdByName || 'Unknown'
        ]);

        const csvContent = [
            headers.join(','),
            ...csvData.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recharge-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    // Calculate totals
    const totalAmount = filteredTransactions.reduce((sum, t) => sum + t.rechargeAmount, 0);
    const totalCommission = filteredTransactions.reduce((sum, t) => sum + (t.commission || 0), 0);
    const netAmount = totalAmount - totalCommission;

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex items-center justify-center h-[calc(100vh-64px)]">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading report...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 pb-24 sm:pb-8">
            <Navbar />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {/* Header */}
                <div className="mb-6">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div>
                                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Recharge Report</h1>
                                <p className="text-gray-600 mt-1">View and analyze all recharge transactions</p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setShowFiltersModal(true)}
                                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${hasActiveFilters
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                                        }`}
                                >
                                    <Filter className="w-5 h-5" />
                                    Filters
                                    {hasActiveFilters && (
                                        <span className="ml-1 px-2 py-0.5 bg-white text-purple-600 rounded-full text-xs font-semibold">
                                            Active
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={exportToCSV}
                                    disabled={filteredTransactions.length === 0}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                                >
                                    <Download className="w-5 h-5" />
                                    Export CSV
                                </button>
                            </div>
                        </div>

                        {/* Search Bar */}
                        <div className="relative max-w-md">
                            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by customer number..."
                                className="w-full pl-12 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                            {searchQuery && (
                                <button
                                    onClick={clearSearch}
                                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Filters Modal */}
                {showFiltersModal && (
                    <>
                        {/* Backdrop */}
                        <div
                            className="fixed inset-0 bg-transparent backdrop-blur-xl bg-opacity-50 z-50"
                            onClick={() => setShowFiltersModal(false)}
                        ></div>

                        {/* Modal */}
                        <div className="fixed inset-0 z-50 overflow-y-auto">
                            <div className="flex items-center justify-center min-h-screen p-4">
                                <div
                                    className="bg-white rounded-xl shadow-2xl w-full max-w-4xl relative"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {/* Modal Header */}
                                    <div className="flex items-center justify-between p-6 border-b border-gray-200">
                                        <div>
                                            <h2 className="text-xl font-bold text-gray-900">Filter Transactions</h2>
                                            <p className="text-sm text-gray-500 mt-1">Filter by provider and date range</p>
                                        </div>
                                        <button
                                            onClick={() => setShowFiltersModal(false)}
                                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            <X className="w-5 h-5 text-gray-500" />
                                        </button>
                                    </div>

                                    {/* Modal Body */}
                                    <div className="p-6">
                                        <div className="grid grid-cols-1 gap-6">
                                            {/* Provider Filter */}
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Provider
                                                </label>
                                                <select
                                                    value={selectedProvider}
                                                    onChange={(e) => setSelectedProvider(e.target.value)}
                                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                >
                                                    <option value="all">All Providers</option>
                                                    {providers.map(provider => (
                                                        <option key={provider.id} value={provider.id}>
                                                            {provider.providerName}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Date Range */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {/* Start Date Filter */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        Start Date
                                                    </label>
                                                    <div className="relative">
                                                        <Calendar className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                                                        <input
                                                            type="date"
                                                            value={startDate}
                                                            onChange={(e) => setStartDate(e.target.value)}
                                                            className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                        />
                                                    </div>
                                                </div>

                                                {/* End Date Filter */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                                        End Date
                                                    </label>
                                                    <div className="relative">
                                                        <Calendar className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                                                        <input
                                                            type="date"
                                                            value={endDate}
                                                            onChange={(e) => setEndDate(e.target.value)}
                                                            className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Modal Footer */}
                                    <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                                        <button
                                            onClick={clearFilters}
                                            className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
                                        >
                                            Clear All
                                        </button>
                                        <button
                                            onClick={() => setShowFiltersModal(false)}
                                            className="px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
                                        >
                                            Apply Filters
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                        <p className="text-sm text-gray-500">Total Transactions</p>
                        <p className="text-2xl font-bold text-gray-900 mt-1">{filteredTransactions.length}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                        <p className="text-sm text-gray-500">Total Amount</p>
                        <p className="text-2xl font-bold text-purple-600 mt-1">₹{totalAmount.toFixed(2)}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                        <p className="text-sm text-gray-500">Total Commission</p>
                        <p className="text-2xl font-bold text-green-600 mt-1">₹{totalCommission.toFixed(2)}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                        <p className="text-sm text-gray-500">Net Amount</p>
                        <p className="text-2xl font-bold text-blue-600 mt-1">₹{netAmount.toFixed(2)}</p>
                    </div>
                </div>

                {/* Transactions Table/List */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-white border-b border-gray-200 p-6">
                        <h2 className="text-xl font-bold text-gray-900">Transactions</h2>
                        <p className="text-gray-500 mt-1">
                            Showing {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
                        </p>
                    </div>

                    <div className="p-6">
                        {filteredTransactions.length === 0 ? (
                            <div className="text-center py-12">
                                <Smartphone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                <p className="text-gray-500">No transactions found</p>
                                <p className="text-sm text-gray-400 mt-1">Try adjusting your filters</p>
                            </div>
                        ) : (
                            <>
                                {/* Desktop Table View */}
                                <div className="hidden lg:block overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-gray-200">
                                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date & Time</th>
                                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Provider</th>
                                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Customer</th>
                                                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Amount</th>
                                                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Commission</th>
                                                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Balance After</th>
                                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Created By</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {filteredTransactions.map(transaction => {
                                                const providerImage = getProviderImage(transaction.providerId);
                                                return (
                                                    <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-4 text-sm">
                                                            <div className="text-gray-900 font-medium">
                                                                {new Date(transaction.createdAt).toLocaleDateString('en-IN')}
                                                            </div>
                                                            <div className="text-gray-500 text-xs">
                                                                {new Date(transaction.createdAt).toLocaleTimeString('en-IN')}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            <span className="inline-flex items-center gap-2 px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
                                                                {providerImage ? (
                                                                    <img
                                                                        src={providerImage}
                                                                        alt={transaction.providerName}
                                                                        className="w-4 h-4 object-contain"
                                                                        onError={(e) => {
                                                                            e.currentTarget.style.display = 'none';
                                                                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                                        }}
                                                                    />
                                                                ) : null}
                                                                <Smartphone className={`w-3 h-3 ${providerImage ? 'hidden' : ''}`} />
                                                                {transaction.providerName}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-4 text-sm text-gray-900 font-medium">
                                                            {transaction.customerNumber}
                                                        </td>
                                                        <td className="px-4 py-4 text-right text-sm font-semibold text-purple-600">
                                                            ₹{transaction.rechargeAmount.toFixed(2)}
                                                        </td>
                                                        <td className="px-4 py-4 text-right text-sm font-semibold text-green-600">
                                                            ₹{(transaction.commission || 0).toFixed(2)}
                                                        </td>
                                                        <td className="px-4 py-4 text-right text-sm font-semibold text-blue-600">
                                                            ₹{transaction.balanceAfter.toFixed(2)}
                                                        </td>
                                                        <td className="px-4 py-4 text-sm text-gray-600">
                                                            {transaction.createdByName || 'Unknown'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Card View */}
                                <div className="lg:hidden space-y-4">
                                    {filteredTransactions.map(transaction => (
                                        <div key={transaction.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <Smartphone className="w-4 h-4 text-blue-600" />
                                                        <span className="font-semibold text-gray-900">{transaction.providerName}</span>
                                                    </div>
                                                    <p className="text-sm text-gray-600">{transaction.customerNumber}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-gray-500">
                                                        {new Date(transaction.createdAt).toLocaleDateString('en-IN')}
                                                    </p>
                                                    <p className="text-xs text-gray-400">
                                                        {new Date(transaction.createdAt).toLocaleTimeString('en-IN')}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-purple-50 rounded-lg p-3">
                                                    <p className="text-xs text-gray-600">Amount</p>
                                                    <p className="text-lg font-bold text-purple-600">₹{transaction.rechargeAmount.toFixed(2)}</p>
                                                </div>
                                                <div className="bg-green-50 rounded-lg p-3">
                                                    <p className="text-xs text-gray-600">Commission</p>
                                                    <p className="text-lg font-bold text-green-600">₹{(transaction.commission || 0).toFixed(2)}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                                                <span className="text-xs text-gray-500">Balance After</span>
                                                <span className="text-sm font-semibold text-blue-600">₹{transaction.balanceAfter.toFixed(2)}</span>
                                            </div>

                                            <div className="flex items-center justify-between text-xs text-gray-500">
                                                <span>Created by</span>
                                                <span className="font-medium text-gray-700">{transaction.createdByName || 'Unknown'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RechargeReport;
