import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import { Smartphone, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { RechargeProvider } from '../types';
import { collection, getDocs, query, orderBy, doc, Timestamp, increment, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';

interface BulkRechargeRow {
    id: string;
    customerNumber: string;
    amount: string;
    commission: string;
}

const BulkRecharge: React.FC = () => {
    const { currentUser } = useAuth();
    const { showToast } = useToast();
    const navigate = useNavigate();

    const [providers, setProviders] = useState<RechargeProvider[]>([]);
    const [selectedProviderId, setSelectedProviderId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingBulk, setIsProcessingBulk] = useState(false);
    const [shouldFocusNewRow, setShouldFocusNewRow] = useState(false);



    // Bulk Recharge
    const [bulkRechargeRows, setBulkRechargeRows] = useState<BulkRechargeRow[]>([
        { id: '1', customerNumber: '', amount: '', commission: '' },
        { id: '2', customerNumber: '', amount: '', commission: '' },
        { id: '3', customerNumber: '', amount: '', commission: '' }
    ]);

    useEffect(() => {
        fetchProviders();
    }, []);

    useEffect(() => {
        if (shouldFocusNewRow && bulkRechargeRows.length > 0) {
            const index = bulkRechargeRows.length - 1;
            const el = document.getElementById(`cell-${index}-customerNumber`);
            if (el) {
                el.focus();
                setShouldFocusNewRow(false);
            }
        }
    }, [bulkRechargeRows, shouldFocusNewRow]);

    const fetchProviders = async () => {
        try {
            const providersRef = collection(db, 'rechargeProviders');
            const q = query(providersRef, orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);

            const providersList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date(),
                updatedAt: doc.data().updatedAt?.toDate()
            })) as RechargeProvider[];

            setProviders(providersList.filter(p => p.isActive));

            // Auto-select first provider if available
            if (providersList.length > 0 && !selectedProviderId) {
                setSelectedProviderId(providersList[0].id!);
            }
        } catch (error: any) {
            showToast('Failed to load providers: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const addBulkRow = () => {
        const newId = (Math.max(...bulkRechargeRows.map(r => parseInt(r.id) || 0)) + 1).toString();
        setBulkRechargeRows([...bulkRechargeRows, { id: newId, customerNumber: '', amount: '', commission: '' }]);
        setShouldFocusNewRow(true);
    };

    const removeBulkRow = (id: string) => {
        if (bulkRechargeRows.length > 1) {
            setBulkRechargeRows(bulkRechargeRows.filter(row => row.id !== id));
        }
    };

    const updateBulkRow = (id: string, field: keyof BulkRechargeRow, value: string) => {
        setBulkRechargeRows(bulkRechargeRows.map(row =>
            row.id === id ? { ...row, [field]: value } : row
        ));
    };

    const handleKeyDown = (e: React.KeyboardEvent, index: number, field: string) => {
        const fields = ['customerNumber', 'amount', 'commission'];
        const fieldIndex = fields.indexOf(field);
        const target = e.currentTarget as HTMLInputElement;

        if (e.key === 'Enter') {
            e.preventDefault();
            if (fieldIndex < fields.length - 1) {
                // Next column same row
                document.getElementById(`cell-${index}-${fields[fieldIndex + 1]}`)?.focus();
            } else {
                // Last column -> Next row or Add row
                if (index < bulkRechargeRows.length - 1) {
                    document.getElementById(`cell-${index + 1}-${fields[0]}`)?.focus();
                } else {
                    addBulkRow();
                }
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (index > 0) {
                document.getElementById(`cell-${index - 1}-${field}`)?.focus();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (index < bulkRechargeRows.length - 1) {
                document.getElementById(`cell-${index + 1}-${field}`)?.focus();
            }
        } else if (e.key === 'ArrowRight') {
            // Navigate if cursor is at the end of input
            if (target.selectionStart === target.value.length) {
                e.preventDefault();
                if (fieldIndex < fields.length - 1) {
                    document.getElementById(`cell-${index}-${fields[fieldIndex + 1]}`)?.focus();
                } else if (index < bulkRechargeRows.length - 1) {
                    document.getElementById(`cell-${index + 1}-${fields[0]}`)?.focus();
                }
            }
        } else if (e.key === 'ArrowLeft') {
            // Navigate if cursor is at the start of input
            if (target.selectionStart === 0) {
                e.preventDefault();
                if (fieldIndex > 0) {
                    document.getElementById(`cell-${index}-${fields[fieldIndex - 1]}`)?.focus();
                } else if (index > 0) {
                    // Go to previous row's last column
                    document.getElementById(`cell-${index - 1}-${fields[fields.length - 1]}`)?.focus();
                }
            }
        }
    };

    const calculateBulkTotals = () => {
        const validRows = bulkRechargeRows.filter(row =>
            row.customerNumber && row.amount && parseFloat(row.amount) > 0
        );

        const totalAmount = validRows.reduce((sum, row) => sum + parseFloat(row.amount || '0'), 0);
        const totalCommission = validRows.reduce((sum, row) => sum + parseFloat(row.commission || '0'), 0);
        const netDeduction = totalAmount - totalCommission;

        return { validRows, totalAmount, totalCommission, netDeduction, count: validRows.length };
    };

    const handleBulkRecharge = async () => {
        if (!selectedProviderId) {
            showToast('Please select a provider', 'error');
            return;
        }

        const selectedProvider = providers.find(p => p.id === selectedProviderId);
        if (!selectedProvider) {
            showToast('Provider not found', 'error');
            return;
        }

        const { validRows, netDeduction } = calculateBulkTotals();

        if (validRows.length === 0) {
            showToast('Please add at least one valid recharge entry', 'error');
            return;
        }

        if (netDeduction > selectedProvider.balance) {
            showToast('Insufficient balance in provider account', 'error');
            return;
        }

        setIsProcessingBulk(true);

        try {
            const batch = writeBatch(db);
            let runningBalance = selectedProvider.balance;
            let totalRecharges = 0;
            let totalCommissions = 0;

            // Create all transaction documents
            for (const row of validRows) {
                const amount = parseFloat(row.amount);
                const commissionAmount = parseFloat(row.commission || '0');
                runningBalance = runningBalance - amount + commissionAmount;
                totalRecharges += amount;
                totalCommissions += commissionAmount;

                const transactionRef = doc(collection(db, 'rechargeTransactions'));
                batch.set(transactionRef, {
                    providerId: selectedProvider.id!,
                    providerName: selectedProvider.providerName,
                    customerNumber: row.customerNumber,
                    rechargeAmount: amount,
                    commission: commissionAmount,
                    balanceAfter: runningBalance,
                    createdAt: Timestamp.now(),
                    createdBy: currentUser?.uid || '',
                    createdByName: currentUser?.displayName || ''
                });
            }

            // Update provider
            const providerRef = doc(db, 'rechargeProviders', selectedProvider.id!);
            batch.update(providerRef, {
                balance: runningBalance,
                totalRechargeAmount: increment(totalRecharges),
                totalCommission: increment(totalCommissions),
                updatedAt: Timestamp.now()
            });

            await batch.commit();

            showToast(`Successfully processed ${validRows.length} recharges`, 'success');

            // Reset form
            setBulkRechargeRows([
                { id: '1', customerNumber: '', amount: '', commission: '' },
                { id: '2', customerNumber: '', amount: '', commission: '' },
                { id: '3', customerNumber: '', amount: '', commission: '' }
            ]);

            // Refresh providers to get updated balance
            fetchProviders();
        } catch (error: any) {
            showToast('Failed to process bulk recharge: ' + error.message, 'error');
        } finally {
            setIsProcessingBulk(false);
        }
    };

    const selectedProvider = providers.find(p => p.id === selectedProviderId);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex items-center justify-center h-[calc(100vh-64px)]">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading providers...</p>
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

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Bulk Recharge</h1>
                            <p className="text-gray-600 mt-1">Enter multiple recharges at once - Excel-like entry</p>
                        </div>
                    </div>
                </div>

                {providers.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                        <Smartphone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Providers Available</h3>
                        <p className="text-gray-600 mb-4">Please add a provider first to use bulk recharge</p>
                        <button
                            onClick={() => navigate('/recharge-accounts')}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Go to Recharge Accounts
                        </button>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-white border-b border-gray-200 p-6">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">Select Provider & Enter Recharges</h2>

                            {/* Provider Selection */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Recharge Provider <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={selectedProviderId}
                                    onChange={(e) => setSelectedProviderId(e.target.value)}
                                    className="w-full md:w-96 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-medium"
                                >
                                    {providers.map(provider => (
                                        <option key={provider.id} value={provider.id}>
                                            {provider.providerName} - Balance: ₹{provider.balance.toFixed(2)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Provider Info Banner */}
                            {selectedProvider && (
                                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                                    <div className="flex items-center justify-between flex-wrap gap-3">
                                        <div className="flex items-center gap-3">
                                            {selectedProvider.imageUrl ? (
                                                <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                                                    <img
                                                        src={selectedProvider.imageUrl}
                                                        alt={selectedProvider.providerName}
                                                        className="w-full h-full object-contain p-1"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center shrink-0">
                                                    <Smartphone className="w-6 h-6 text-gray-400" />
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-sm text-gray-600">Selected Provider</p>
                                                <p className="font-semibold text-gray-900 text-lg">{selectedProvider.providerName}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-600">Available Balance</p>
                                            <p className="font-bold text-purple-600 text-lg">₹{selectedProvider.balance.toFixed(2)}</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-6">
                            {/* Desktop Table View */}
                            <div className="hidden md:block overflow-x-auto mb-6">
                                <table className="w-full border-collapse border border-gray-300">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="border border-gray-300 px-4 py-3 text-left text-sm font-semibold text-gray-700 w-12">#</th>
                                            <th className="border border-gray-300 px-4 py-3 text-left text-sm font-semibold text-gray-700">Customer Number *</th>
                                            <th className="border border-gray-300 px-4 py-3 text-left text-sm font-semibold text-gray-700">Amount *</th>
                                            <th className="border border-gray-300 px-4 py-3 text-left text-sm font-semibold text-gray-700">Commission</th>
                                            <th className="border border-gray-300 px-4 py-3 text-center text-sm font-semibold text-gray-700 w-20">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bulkRechargeRows.map((row, index) => (
                                            <tr key={row.id} className="hover:bg-gray-50">
                                                <td className="border border-gray-300 px-4 py-2 text-sm text-gray-600 text-center">{index + 1}</td>
                                                <td className="border border-gray-300 px-2 py-2">
                                                    <input
                                                        type="tel"
                                                        id={`cell-${index}-customerNumber`}
                                                        value={row.customerNumber}
                                                        onChange={(e) => updateBulkRow(row.id, 'customerNumber', e.target.value)}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'customerNumber')}
                                                        placeholder="10-digit mobile"
                                                        maxLength={10}
                                                        className="w-full px-3 py-2 border-0 focus:ring-2 focus:ring-purple-500 rounded"
                                                    />
                                                </td>
                                                <td className="border border-gray-300 px-2 py-2">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        id={`cell-${index}-amount`}
                                                        value={row.amount}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                                updateBulkRow(row.id, 'amount', val);
                                                            }
                                                        }}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'amount')}
                                                        placeholder="0.00"
                                                        className="w-full px-3 py-2 border-0 focus:ring-2 focus:ring-purple-500 rounded"
                                                    />
                                                </td>
                                                <td className="border border-gray-300 px-2 py-2">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        id={`cell-${index}-commission`}
                                                        value={row.commission}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                                updateBulkRow(row.id, 'commission', val);
                                                            }
                                                        }}
                                                        onKeyDown={(e) => handleKeyDown(e, index, 'commission')}
                                                        placeholder="0.00"
                                                        className="w-full px-3 py-2 border-0 focus:ring-2 focus:ring-purple-500 rounded"
                                                    />
                                                </td>
                                                <td className="border border-gray-300 px-2 py-2 text-center">
                                                    <button
                                                        onClick={() => removeBulkRow(row.id)}
                                                        disabled={bulkRechargeRows.length === 1}
                                                        className="text-red-600 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed"
                                                        title="Remove row"
                                                    >
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                <button
                                    onClick={addBulkRow}
                                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Row
                                </button>
                            </div>

                            {/* Mobile Card View */}
                            <div className="md:hidden space-y-4 mb-6">
                                {bulkRechargeRows.map((row, index) => (
                                    <div key={row.id} className="border border-gray-300 rounded-lg p-4 bg-white">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="font-semibold text-gray-900">Entry #{index + 1}</span>
                                            <button
                                                onClick={() => removeBulkRow(row.id)}
                                                disabled={bulkRechargeRows.length === 1}
                                                className="text-red-600 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">Customer Number *</label>
                                                <input
                                                    type="tel"
                                                    value={row.customerNumber}
                                                    onChange={(e) => updateBulkRow(row.id, 'customerNumber', e.target.value)}
                                                    placeholder="10-digit mobile"
                                                    maxLength={10}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-1">Amount *</label>
                                                    <input
                                                        type="number"
                                                        value={row.amount}
                                                        onChange={(e) => updateBulkRow(row.id, 'amount', e.target.value)}
                                                        onWheel={(e) => e.currentTarget.blur()}
                                                        placeholder="0.00"
                                                        step="0.01"
                                                        min="0"
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-1">Commission</label>
                                                    <input
                                                        type="number"
                                                        value={row.commission}
                                                        onChange={(e) => updateBulkRow(row.id, 'commission', e.target.value)}
                                                        onWheel={(e) => e.currentTarget.blur()}
                                                        placeholder="0.00"
                                                        step="0.01"
                                                        min="0"
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                <button
                                    onClick={addBulkRow}
                                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium"
                                >
                                    <Plus className="w-5 h-5" />
                                    Add Another Entry
                                </button>
                            </div>

                            {/* Summary */}
                            {(() => {
                                const totals = calculateBulkTotals();
                                return totals.count > 0 && selectedProvider && (
                                    <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                        <h3 className="font-semibold text-gray-900 mb-3">Bulk Summary</h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                            <div>
                                                <p className="text-gray-600">Valid Entries</p>
                                                <p className="font-bold text-gray-900 text-lg">{totals.count}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-600">Total Amount</p>
                                                <p className="font-bold text-purple-600 text-lg">₹{totals.totalAmount.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-600">Total Commission</p>
                                                <p className="font-bold text-green-600 text-lg">+₹{totals.totalCommission.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-600">Net Deduction</p>
                                                <p className="font-bold text-red-600 text-lg">-₹{totals.netDeduction.toFixed(2)}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-gray-300">
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-700 font-semibold">Balance After Processing:</span>
                                                <span className={`font-bold text-xl ${(selectedProvider.balance - totals.netDeduction) >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                                    ₹{(selectedProvider.balance - totals.netDeduction).toFixed(2)}
                                                </span>
                                            </div>
                                            {(selectedProvider.balance - totals.netDeduction) < 0 && (
                                                <p className="text-red-600 text-sm mt-2">⚠️ Insufficient balance</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="flex gap-3">
                                <button
                                    onClick={() => navigate('/recharge-accounts')}
                                    className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleBulkRecharge}
                                    disabled={isProcessingBulk || calculateBulkTotals().count === 0 || !selectedProviderId}
                                    className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isProcessingBulk ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                            Processing...
                                        </>
                                    ) : (
                                        `Process ${calculateBulkTotals().count} Recharge${calculateBulkTotals().count !== 1 ? 's' : ''}`
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BulkRecharge;
