import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import { Smartphone, Plus, TrendingDown, TrendingUp, DollarSign, X, Edit2, RefreshCw, Trash2, Wallet, CreditCard } from 'lucide-react';
import type { RechargeProvider, RechargeTransaction, ProviderTransaction } from '../types';
import { getDocs, query, orderBy, addDoc, updateDoc, doc, Timestamp, increment, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';

type ActiveView = 'list' | 'add' | 'edit' | 'recharge' | 'bulk-recharge' | 'refill' | 'pay' | 'history';

interface BulkRechargeRow {
    id: string;
    customerNumber: string;
    amount: string;
    commission: string;
}

import { useNavigate } from 'react-router-dom';

const RechargeAccounts: React.FC = () => {
    const { currentUser } = useAuth();
  const { getCollectionRef, getDocRef } = useStore();
    const { showToast } = useToast();
    const navigate = useNavigate();

    const [providers, setProviders] = useState<RechargeProvider[]>([]);
    const [transactions, setTransactions] = useState<RechargeTransaction[]>([]);
    const [providerTransactions, setProviderTransactions] = useState<ProviderTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeView, setActiveView] = useState<ActiveView>('list');
    const [selectedProvider, setSelectedProvider] = useState<RechargeProvider | null>(null);

    const [historyTab, setHistoryTab] = useState<'recharges' | 'account'>('recharges');

    // Add Provider Form
    const [providerName, setProviderName] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [initialBalance, setInitialBalance] = useState('');
    const [providerImageUrl, setProviderImageUrl] = useState('');

    // Edit Provider Form
    const [editProviderName, setEditProviderName] = useState('');
    const [editAccountNumber, setEditAccountNumber] = useState('');
    const [editProviderImageUrl, setEditProviderImageUrl] = useState('');

    // Recharge Form
    const [customerNumber, setCustomerNumber] = useState('');
    const [rechargeAmount, setRechargeAmount] = useState('');
    const [commission, setCommission] = useState('');

    // Refill Balance Form
    const [refillAmount, setRefillAmount] = useState('');
    const [receivedAmount, setReceivedAmount] = useState('');
    const [refillType, setRefillType] = useState<'paid' | 'credit'>('paid');

    // Pay Provider Form
    const [payAmount, setPayAmount] = useState('');

    // Bulk Recharge
    const [bulkRechargeRows, setBulkRechargeRows] = useState<BulkRechargeRow[]>([
        { id: '1', customerNumber: '', amount: '', commission: '' },
        { id: '2', customerNumber: '', amount: '', commission: '' },
        { id: '3', customerNumber: '', amount: '', commission: '' }
    ]);
    const [isProcessingBulk, setIsProcessingBulk] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isOwner = currentUser?.role === 'owner';

    useEffect(() => {
        fetchProviders();
        fetchTransactions();
    }, []);

    const fetchProviders = async () => {
        try {
            const providersRef = getCollectionRef('rechargeProviders');
            const q = query(providersRef, orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);

            const providersList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date(),
                updatedAt: doc.data().updatedAt?.toDate()
            })) as RechargeProvider[];

            setProviders(providersList);
        } catch (error: any) {
            showToast('Failed to load providers: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchTransactions = async () => {
        try {
            // Fetch Customer Recharges
            const transactionsRef = getCollectionRef('rechargeTransactions');
            const q = query(transactionsRef, orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);

            const transactionsList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date()
            })) as RechargeTransaction[];

            setTransactions(transactionsList);

            // Fetch Provider Transactions (Refills/Payments)
            const providerTransRef = getCollectionRef('providerTransactions');
            const qProvider = query(providerTransRef, orderBy('createdAt', 'desc'));
            const snapshotProvider = await getDocs(qProvider);

            const providerTransList = snapshotProvider.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date()
            })) as ProviderTransaction[];

            setProviderTransactions(providerTransList);

        } catch (error: any) {
            showToast('Failed to load transactions: ' + error.message, 'error');
        }
    };

    const handleAddProvider = async () => {
        if (!providerName || !initialBalance) {
            showToast('Please fill required fields', 'error');
            return;
        }

        const balance = parseFloat(initialBalance);
        if (isNaN(balance) || balance < 0) {
            showToast('Invalid balance amount', 'error');
            return;
        }

        try {
            const providerData = {
                providerName,
                accountNumber: accountNumber || '',
                imageUrl: providerImageUrl || '',
                balance,
                outstandingBalance: 0,
                totalRechargeAmount: 0,
                totalCommission: 0,
                totalPaidAmount: 0,
                totalCreditAmount: 0,
                isActive: true,
                createdAt: Timestamp.now(),
                createdBy: currentUser?.uid || '',
                createdByName: currentUser?.displayName || ''
            };

            await addDoc(getCollectionRef('rechargeProviders'), providerData);

            showToast('Provider added successfully', 'success');
            resetAddProviderForm();
            setActiveView('list');
            fetchProviders();
        } catch (error: any) {
            showToast('Failed to add provider: ' + error.message, 'error');
        }
    };

    const handleEditProvider = async () => {
        if (!selectedProvider || !editProviderName) {
            showToast('Please fill required fields', 'error');
            return;
        }

        try {
            const providerRef = getDocRef('rechargeProviders', selectedProvider.id!);
            await updateDoc(providerRef, {
                providerName: editProviderName,
                accountNumber: editAccountNumber,
                imageUrl: editProviderImageUrl || '',
                updatedAt: Timestamp.now()
            });

            showToast('Provider updated successfully', 'success');
            setActiveView('list');
            setSelectedProvider(null);
            fetchProviders();
        } catch (error: any) {
            showToast('Failed to update provider: ' + error.message, 'error');
        }
    };

    const handleRecharge = async () => {
        if (!selectedProvider || !customerNumber || !rechargeAmount) {
            showToast('Please fill required fields', 'error');
            return;
        }

        const amount = parseFloat(rechargeAmount);
        const commissionAmount = parseFloat(commission) || 0;

        if (isNaN(amount) || amount <= 0) {
            showToast('Invalid recharge amount', 'error');
            return;
        }

        if (commissionAmount < 0) {
            showToast('Commission cannot be negative', 'error');
            return;
        }

        if (amount > selectedProvider.balance) {
            showToast('Insufficient balance in provider account', 'error');
            return;
        }

        try {
            const newBalance = selectedProvider.balance - amount + commissionAmount;

            const transactionData = {
                providerId: selectedProvider.id!,
                providerName: selectedProvider.providerName,
                customerNumber,
                rechargeAmount: amount,
                commission: commissionAmount,
                balanceAfter: newBalance,
                createdAt: Timestamp.now(),
                createdBy: currentUser?.uid || '',
                createdByName: currentUser?.displayName || ''
            };

            await addDoc(getCollectionRef('rechargeTransactions'), transactionData);

            const providerRef = getDocRef('rechargeProviders', selectedProvider.id!);
            await updateDoc(providerRef, {
                balance: newBalance,
                totalRechargeAmount: increment(amount),
                totalCommission: increment(commissionAmount),
                updatedAt: Timestamp.now()
            });

            showToast('Recharge completed successfully', 'success');
            resetRechargeForm();
            setActiveView('list');
            setSelectedProvider(null);
            fetchProviders();
            fetchTransactions();
        } catch (error: any) {
            showToast('Failed to process recharge: ' + error.message, 'error');
        }
    };

    const handleRefillBalance = async () => {
        if (!selectedProvider || !refillAmount) {
            showToast('Please enter refill amount', 'error');
            return;
        }

        const amountPaid = parseFloat(refillAmount);
        // If receivedAmount is not entered, assume it's same as paid
        const amountReceived = receivedAmount ? parseFloat(receivedAmount) : amountPaid;

        if (isNaN(amountPaid) || amountPaid <= 0) {
            showToast('Invalid refill amount', 'error');
            return;
        }

        if (isNaN(amountReceived) || amountReceived < amountPaid) {
            showToast('Received amount cannot be less than paid amount', 'error');
            return;
        }

        setIsSubmitting(true);

        try {
            console.log('Starting refill process...');
            const batch = writeBatch(db);
            const providerRef = getDocRef('rechargeProviders', selectedProvider.id!);

            let newOutstanding = selectedProvider.outstandingBalance || 0;
            const newBalance = selectedProvider.balance + amountReceived;
            const commission = amountReceived - amountPaid;

            // Prepare Provider Updates
            const providerUpdates: any = {
                balance: increment(amountReceived),
                totalCommission: increment(commission),
                updatedAt: Timestamp.now()
            };

            if (refillType === 'credit') {
                providerUpdates.outstandingBalance = increment(amountPaid);
                providerUpdates.totalCreditAmount = increment(amountPaid);
                newOutstanding += amountPaid;
            }

            batch.update(providerRef, providerUpdates);

            // Create Transaction Record
            const transactionRef = doc(getCollectionRef('providerTransactions'));
            const transactionData: ProviderTransaction = {
                providerId: selectedProvider.id!,
                providerName: selectedProvider.providerName,
                type: 'refill',
                paymentType: refillType,
                amount: amountPaid,
                receivedAmount: amountReceived,
                commission: commission,
                outstandingBalanceAfter: newOutstanding,
                walletBalanceAfter: newBalance,
                description: refillType === 'credit'
                    ? `Refill on Credit (Paid: ${amountPaid}, Rec: ${amountReceived})`
                    : `Paid Refill (Paid: ${amountPaid}, Rec: ${amountReceived})`,
                createdAt: Timestamp.now() as any,
                createdBy: currentUser?.uid || '',
                createdByName: currentUser?.displayName || ''
            };

            batch.set(transactionRef, transactionData);

            await batch.commit();
            console.log('Refill transaction committed successfully');

            showToast(`Refill Successful! Wallet: +₹${amountReceived.toFixed(2)}, Comm: ₹${commission.toFixed(2)}`, 'success');
            setRefillAmount('');
            setReceivedAmount('');
            setRefillType('paid');
            setActiveView('list');
            setSelectedProvider(null);
            fetchProviders();
        } catch (error: any) {
            console.error('Refill failed:', error);
            showToast('Failed to refill: ' + error.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handlePayProvider = async () => {
        if (!selectedProvider || !payAmount) {
            showToast('Please enter payment amount', 'error');
            return;
        }

        const amount = parseFloat(payAmount);

        if (isNaN(amount) || amount <= 0) {
            showToast('Invalid payment amount', 'error');
            return;
        }

        if (amount > (selectedProvider.outstandingBalance || 0)) {
            showToast('Payment amount cannot exceed outstanding balance', 'error');
            return;
        }

        try {
            const batch = writeBatch(db);
            const providerRef = getDocRef('rechargeProviders', selectedProvider.id!);

            const newOutstanding = (selectedProvider.outstandingBalance || 0) - amount;

            // Update Provider
            batch.update(providerRef, {
                outstandingBalance: increment(-amount),
                totalPaidAmount: increment(amount),
                updatedAt: Timestamp.now()
            });

            // Create Transaction Record
            const transactionRef = doc(getCollectionRef('providerTransactions'));
            const transactionData: ProviderTransaction = {
                providerId: selectedProvider.id!,
                providerName: selectedProvider.providerName,
                type: 'payment',
                paymentType: 'paid',
                amount: amount,
                outstandingBalanceAfter: newOutstanding,
                walletBalanceAfter: selectedProvider.balance, // Balance doesn't change on payment
                description: 'Payment made to provider',
                createdAt: Timestamp.now() as any,
                createdBy: currentUser?.uid || '',
                createdByName: currentUser?.displayName || ''
            };
            batch.set(transactionRef, transactionData);

            await batch.commit();

            showToast(`Payment of ₹${amount.toFixed(2)} recorded successfully`, 'success');
            setPayAmount('');
            setActiveView('list');
            setSelectedProvider(null);
            fetchProviders();
        } catch (error: any) {
            showToast('Failed to record payment: ' + error.message, 'error');
        }
    };

    // Bulk Recharge Functions
    const addBulkRow = () => {
        const newId = (Math.max(...bulkRechargeRows.map(r => parseInt(r.id) || 0)) + 1).toString();
        setBulkRechargeRows([...bulkRechargeRows, { id: newId, customerNumber: '', amount: '', commission: '' }]);
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
        if (!selectedProvider) {
            showToast('No provider selected', 'error');
            return;
        }

        const { validRows, netDeduction } = calculateBulkTotals();

        if (validRows.length === 0) {
            showToast('Please add at least one valid recharge entry', 'error');
            return;
        }

        if (netDeduction > selectedProvider.balance) {
            showToast('Insufficient balance for bulk recharge', 'error');
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

                const transactionRef = doc(getCollectionRef('rechargeTransactions'));
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
            const providerRef = getDocRef('rechargeProviders', selectedProvider.id!);
            batch.update(providerRef, {
                balance: runningBalance,
                totalRechargeAmount: increment(totalRecharges),
                totalCommission: increment(totalCommissions),
                updatedAt: Timestamp.now()
            });

            await batch.commit();

            showToast(`Successfully processed ${validRows.length} recharges`, 'success');
            setBulkRechargeRows([
                { id: '1', customerNumber: '', amount: '', commission: '' },
                { id: '2', customerNumber: '', amount: '', commission: '' },
                { id: '3', customerNumber: '', amount: '', commission: '' }
            ]);
            setActiveView('list');
            setSelectedProvider(null);
            fetchProviders();
            fetchTransactions();
        } catch (error: any) {
            showToast('Failed to process bulk recharge: ' + error.message, 'error');
        } finally {
            setIsProcessingBulk(false);
        }
    };

    const openAddProvider = () => {
        if (!isOwner) {
            showToast('Only owners can add providers', 'error');
            return;
        }
        setActiveView('add');
    };

    const openEditProvider = (provider: RechargeProvider) => {
        if (!isOwner) {
            showToast('Only owners can edit providers', 'error');
            return;
        }
        setSelectedProvider(provider);
        setEditProviderName(provider.providerName);
        setEditAccountNumber(provider.accountNumber || '');
        setEditProviderImageUrl(provider.imageUrl || '');
        setActiveView('edit');
    };



    const openRefill = (provider: RechargeProvider) => {
        if (!(currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.role === 'employee')) {
            showToast('You do not have permission to refill balance', 'error');
            return;
        }
        setSelectedProvider(provider);
        setRefillAmount('');
        setReceivedAmount('');
        setRefillType('paid');
        setActiveView('refill');
    };

    const openPay = (provider: RechargeProvider) => {
        if (!(currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.role === 'employee')) {
            showToast('Only authorized personnel can settle payments', 'error');
            return;
        }
        setSelectedProvider(provider);
        setPayAmount('');
        setActiveView('pay');
    };

    const openHistory = (provider: RechargeProvider) => {
        setSelectedProvider(provider);
        setActiveView('history');
    };

    const resetAddProviderForm = () => {
        setProviderName('');
        setAccountNumber('');
        setInitialBalance('');
        setProviderImageUrl('');
    };

    const resetRechargeForm = () => {
        setCustomerNumber('');
        setRechargeAmount('');
        setCommission('');
    };

    const getProviderTransactions = (providerId: string) => {
        return transactions.filter(t => t.providerId === providerId);
    };

    const totalBalance = providers.reduce((sum, p) => sum + p.balance, 0);
    const totalRecharges = providers.reduce((sum, p) => sum + p.totalRechargeAmount, 0);
    const totalCommissions = providers.reduce((sum, p) => sum + p.totalCommission, 0);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex items-center justify-center h-[calc(100vh-64px)]">
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading recharge accounts...</p>
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
                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Recharge Accounts</h1>
                            <p className="text-gray-600 mt-1">Manage provider accounts and recharge transactions</p>
                        </div>

                        {activeView === 'list' && (
                            <div className="flex flex-wrap gap-2">
                                {providers.length > 0 && (
                                    <button
                                        onClick={() => {
                                            navigate('/bulk-recharge');
                                        }}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                                    >
                                        <Plus className="w-5 h-5" />
                                        Add Transaction
                                    </button>
                                )}
                                {isOwner && (
                                    <button
                                        onClick={openAddProvider}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                    >
                                        <Plus className="w-5 h-5" />
                                        Add Provider
                                    </button>
                                )}
                            </div>
                        )}

                        {activeView !== 'list' && (
                            <button
                                onClick={() => {
                                    setActiveView('list');
                                    setSelectedProvider(null);
                                }}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                            >
                                <X className="w-5 h-5" />
                                Close
                            </button>
                        )}
                    </div>
                </div>

                {/* Summary Cards */}
                {activeView === 'list' && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex items-start justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Total Balance</p>
                                <p className="text-3xl font-semibold text-blue-600 mt-1">₹{totalBalance.toFixed(2)}</p>
                            </div>
                            <div className="bg-blue-50 p-3 rounded-2xl">
                                <DollarSign className="w-5 h-5 text-blue-600" />
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex items-start justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Total Recharges</p>
                                <p className="text-3xl font-semibold text-purple-600 mt-1">₹{totalRecharges.toFixed(2)}</p>
                            </div>
                            <div className="bg-purple-50 p-3 rounded-2xl">
                                <TrendingDown className="w-5 h-5 text-purple-600" />
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex items-start justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Total Commission</p>
                                <p className="text-3xl font-semibold text-green-600 mt-1">₹{totalCommissions.toFixed(2)}</p>
                            </div>
                            <div className="bg-green-50 p-3 rounded-2xl">
                                <TrendingUp className="w-5 h-5 text-green-600" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Content Area */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* List View */}
                    {activeView === 'list' && (
                        <>
                            <div className="bg-white border-b border-gray-200 p-6">
                                <h2 className="text-xl font-bold text-gray-900">Provider Accounts</h2>
                                <p className="text-gray-500 mt-1">Manage your recharge provider accounts</p>
                            </div>

                            <div className="p-6">
                                {providers.length === 0 ? (
                                    <div className="text-center py-12">
                                        <Smartphone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                        <p className="text-gray-500 mb-4">No providers added yet</p>
                                        {isOwner && (
                                            <button
                                                onClick={openAddProvider}
                                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                            >
                                                <Plus className="w-5 h-5" />
                                                Add First Provider
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        {/* Desktop Table View */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full">
                                                <thead>
                                                    <tr className="border-b border-gray-200">
                                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Provider</th>
                                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Account #</th>
                                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Balance</th>
                                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Outstanding</th>
                                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Total Recharges</th>
                                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Commission</th>
                                                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Transactions</th>
                                                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-200">
                                                    {providers.map(provider => {
                                                        const providerTransactions = getProviderTransactions(provider.id!);
                                                        return (
                                                            <tr key={provider.id} className="hover:bg-gray-50 transition-colors">
                                                                <td className="px-4 py-4">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={`p-2 rounded-lg flex items-center justify-center w-10 h-10 ${provider.imageUrl ? 'bg-white border border-gray-200' : 'bg-blue-100'}`}>
                                                                            {provider.imageUrl ? (
                                                                                <img
                                                                                    src={provider.imageUrl}
                                                                                    alt={provider.providerName}
                                                                                    className="w-6 h-6 object-contain"
                                                                                    onError={(e) => {
                                                                                        e.currentTarget.style.display = 'none';
                                                                                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                                                    }}
                                                                                />
                                                                            ) : null}
                                                                            <Smartphone className={`w-5 h-5 text-blue-600 ${provider.imageUrl ? 'hidden' : ''}`} />
                                                                        </div>
                                                                        <span className="font-semibold text-gray-900">{provider.providerName}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-4 text-sm text-gray-600">
                                                                    {provider.accountNumber || '-'}
                                                                </td>
                                                                <td className="px-4 py-4 text-right">
                                                                    <span className="font-semibold text-blue-600">₹{provider.balance?.toFixed(2) || '0.00'}</span>
                                                                </td>
                                                                <td className="px-4 py-4 text-right">
                                                                    <span className={`font-semibold ${(provider.outstandingBalance || 0) > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                                                        ₹{provider.outstandingBalance?.toFixed(2) || '0.00'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-4 text-right">
                                                                    <span className="font-semibold text-purple-600">₹{provider.totalRechargeAmount.toFixed(2)}</span>
                                                                </td>
                                                                <td className="px-4 py-4 text-right">
                                                                    <span className="font-semibold text-green-600">₹{provider.totalCommission.toFixed(2)}</span>
                                                                </td>
                                                                <td className="px-4 py-4 text-center">
                                                                    <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-full">
                                                                        {providerTransactions.length}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-4">
                                                                    <div className="flex items-center justify-center gap-2">
                                                                        {isOwner && (
                                                                            <>
                                                                                <button
                                                                                    onClick={() => openEditProvider(provider)}
                                                                                    className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                                                                                    title="Edit"
                                                                                >
                                                                                    <Edit2 className="w-4 h-4" />
                                                                                </button>
                                                                            </>
                                                                        )}
                                                                        {(currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.role === 'employee') && (
                                                                            <button
                                                                                onClick={() => openRefill(provider)}
                                                                                className="p-2 text-green-600 hover:text-green-700 transition-colors"
                                                                                title="Refill"
                                                                            >
                                                                                <RefreshCw className="w-4 h-4" />
                                                                            </button>
                                                                        )}
                                                                        {(currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.role === 'employee') && (
                                                                            <button
                                                                                onClick={() => openPay(provider)}
                                                                                disabled={(provider.outstandingBalance || 0) <= 0}
                                                                                className={`p-2 transition-colors ${(provider.outstandingBalance || 0) > 0
                                                                                    ? 'text-orange-600 hover:text-orange-700'
                                                                                    : 'text-gray-300 cursor-not-allowed'
                                                                                    }`}
                                                                                title="Pay Provider"
                                                                            >
                                                                                <CreditCard className="w-4 h-4" />
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={() => openHistory(provider)}
                                                                            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                                                                        >
                                                                            History
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Card View */}
                                        <div className="md:hidden grid grid-cols-1 gap-4">
                                            {providers.map(provider => {
                                                const hasOutstanding = (provider.outstandingBalance || 0) > 0;
                                                return (
                                                    <div
                                                        key={provider.id}
                                                        className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 transition-all active:scale-[0.99]"
                                                    >
                                                        {/* Header */}
                                                        <div className="flex items-start justify-between mb-6">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${provider.imageUrl ? 'bg-white border border-gray-100' : 'bg-gradient-to-br from-blue-50 to-blue-100'}`}>
                                                                    {provider.imageUrl ? (
                                                                        <img
                                                                            src={provider.imageUrl}
                                                                            alt={provider.providerName}
                                                                            className="w-8 h-8 object-contain"
                                                                            onError={(e) => {
                                                                                e.currentTarget.style.display = 'none';
                                                                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                                            }}
                                                                        />
                                                                    ) : null}
                                                                    <Smartphone className={`w-6 h-6 text-blue-600 ${provider.imageUrl ? 'hidden' : ''}`} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="font-bold text-lg text-gray-900 leading-tight">{provider.providerName}</h3>
                                                                    {provider.accountNumber && (
                                                                        <p className="text-sm text-gray-500 font-medium">#{provider.accountNumber}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {isOwner && (
                                                                <button
                                                                    onClick={() => openEditProvider(provider)}
                                                                    className="p-2 -mr-2 text-gray-400 hover:text-blue-600 active:bg-gray-100 rounded-full transition-colors"
                                                                >
                                                                    <Edit2 className="w-5 h-5" />
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Hero Balance */}
                                                        <div className="mb-6">
                                                            <p className="text-sm text-gray-500 font-medium mb-1">Wallet Balance</p>
                                                            <div className="flex items-baseline gap-1">
                                                                <span className="text-3xl font-bold text-gray-900">₹{provider.balance?.toFixed(2) || '0.00'}</span>
                                                            </div>
                                                        </div>

                                                        {/* Stats Row */}
                                                        <div className="grid grid-cols-3 gap-2 mb-6">
                                                            <div className={`p-3 rounded-xl border ${hasOutstanding ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                                                                <p className={`text-[10px] uppercase font-bold tracking-wider mb-1 ${hasOutstanding ? 'text-red-600' : 'text-gray-500'}`}>Due</p>
                                                                <p className={`font-bold ${hasOutstanding ? 'text-red-700' : 'text-gray-700'}`}>
                                                                    ₹{provider.outstandingBalance?.toFixed(0) || '0'}
                                                                </p>
                                                            </div>
                                                            <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                                                                <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">Sales</p>
                                                                <p className="font-bold text-gray-700">₹{provider.totalRechargeAmount?.toFixed(0) || '0'}</p>
                                                            </div>
                                                            <div className="p-3 rounded-xl bg-green-50 border border-green-100">
                                                                <p className="text-[10px] uppercase font-bold tracking-wider text-green-700 mb-1">Comm.</p>
                                                                <p className="font-bold text-green-700">₹{provider.totalCommission?.toFixed(0) || '0'}</p>
                                                            </div>
                                                        </div>

                                                        {/* Action Buttons */}
                                                        <div className="grid grid-cols-2 gap-3">
                                                            {(currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.role === 'employee') && (
                                                                <>
                                                                    <button
                                                                        onClick={() => openRefill(provider)}
                                                                        className="flex flex-col items-center justify-center p-3 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200 active:scale-95 transition-all"
                                                                    >
                                                                        <RefreshCw className="w-5 h-5 mb-1" />
                                                                        <span className="text-xs font-bold">Refill</span>
                                                                    </button>

                                                                    <button
                                                                        onClick={() => openPay(provider)}
                                                                        disabled={!hasOutstanding}
                                                                        className={`flex flex-col items-center justify-center p-3 rounded-xl active:scale-95 transition-all ${hasOutstanding
                                                                            ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
                                                                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                            }`}
                                                                    >
                                                                        <CreditCard className="w-5 h-5 mb-1" />
                                                                        <span className="text-xs font-bold">Settle</span>
                                                                    </button>
                                                                </>
                                                            )}
                                                            <button
                                                                onClick={() => openHistory(provider)}
                                                                className={`flex flex-col items-center justify-center p-3 rounded-xl bg-white border border-gray-200 text-gray-700 active:scale-95 transition-all ${(currentUser?.role === 'owner' || currentUser?.role === 'admin' || currentUser?.role === 'employee') ? 'col-span-2' : 'col-span-2'}`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-sm font-bold">View History</span>
                                                                </div>
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </div>
                        </>
                    )}

                    {/* Add Provider Form */}
                    {activeView === 'add' && (
                        <>
                            <div className="bg-white border-b border-gray-200 p-6">
                                <h2 className="text-xl font-bold text-gray-900">Add New Provider</h2>
                                <p className="text-gray-500 mt-1">Enter provider details to add a new account</p>
                            </div>

                            <div className="p-6">
                                <div className="max-w-2xl mx-auto">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Provider Name <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={providerName}
                                                onChange={(e) => setProviderName(e.target.value)}
                                                placeholder="e.g., Airtel, Jio, Vi"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Account Number (Optional)
                                            </label>
                                            <input
                                                type="text"
                                                value={accountNumber}
                                                onChange={(e) => setAccountNumber(e.target.value)}
                                                placeholder="Provider account number"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Image URL (Optional)
                                            </label>
                                            <input
                                                type="url"
                                                value={providerImageUrl}
                                                onChange={(e) => setProviderImageUrl(e.target.value)}
                                                placeholder="https://example.com/logo.png"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Enter a URL to display provider logo</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Initial Balance <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                value={initialBalance}
                                                onChange={(e) => setInitialBalance(e.target.value)}
                                                placeholder="0.00"
                                                step="0.01"
                                                min="0"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex gap-3 mt-8">
                                        <button
                                            onClick={() => {
                                                setActiveView('list');
                                                resetAddProviderForm();
                                            }}
                                            className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleAddProvider}
                                            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                        >
                                            Add Provider
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Edit Provider Form */}
                    {activeView === 'edit' && selectedProvider && (
                        <>
                            <div className="bg-white border-b border-gray-200 p-6">
                                <h2 className="text-xl font-bold text-gray-900">Edit Provider</h2>
                                <p className="text-gray-500 mt-1">Update provider information</p>
                            </div>

                            <div className="p-6">
                                <div className="max-w-2xl mx-auto">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Provider Name <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={editProviderName}
                                                onChange={(e) => setEditProviderName(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>

                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Account Number
                                            </label>
                                            <input
                                                type="text"
                                                value={editAccountNumber}
                                                onChange={(e) => setEditAccountNumber(e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>

                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Image URL (Optional)
                                            </label>
                                            <input
                                                type="url"
                                                value={editProviderImageUrl}
                                                onChange={(e) => setEditProviderImageUrl(e.target.value)}
                                                placeholder="https://example.com/logo.png"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Enter a URL to display provider logo</p>
                                        </div>
                                    </div>

                                    <div className="flex gap-3 mt-8">
                                        <button
                                            onClick={() => {
                                                setActiveView('list');
                                                setSelectedProvider(null);
                                            }}
                                            className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleEditProvider}
                                            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                        >
                                            Update Provider
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Recharge Form */}
                    {activeView === 'recharge' && selectedProvider && (
                        <>
                            <div className="bg-white border-b border-gray-200 p-6">
                                <h2 className="text-xl font-bold text-gray-900">New Recharge</h2>
                                <p className="text-gray-500 mt-1">Process customer recharge</p>
                            </div>

                            <div className="p-6">
                                <div className="max-w-2xl mx-auto">
                                    {/* Provider Info Banner */}
                                    <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm text-gray-600">Provider</p>
                                                <p className="font-semibold text-gray-900 text-lg">{selectedProvider.providerName}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm text-gray-600">Available Balance</p>
                                                <p className="font-bold text-blue-600 text-lg">₹{selectedProvider.balance.toFixed(2)}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Customer Number <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="tel"
                                                value={customerNumber}
                                                onChange={(e) => setCustomerNumber(e.target.value)}
                                                placeholder="Mobile number"
                                                maxLength={10}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Recharge Amount <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                value={rechargeAmount}
                                                onChange={(e) => setRechargeAmount(e.target.value)}
                                                placeholder="0.00"
                                                step="0.01"
                                                min="0"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Commission (Optional)
                                            </label>
                                            <input
                                                type="number"
                                                value={commission}
                                                onChange={(e) => setCommission(e.target.value)}
                                                placeholder="0.00"
                                                step="0.01"
                                                min="0"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>
                                    </div>

                                    {rechargeAmount && (
                                        <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                            <h3 className="font-semibold text-gray-900 mb-3">Balance Preview</h3>
                                            <div className="space-y-2">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-gray-600">Current Balance:</span>
                                                    <span className="font-medium">₹{selectedProvider.balance.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-gray-600">Recharge Amount:</span>
                                                    <span className="font-medium text-red-600">-₹{parseFloat(rechargeAmount || '0').toFixed(2)}</span>
                                                </div>
                                                {commission && (
                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-gray-600">Commission:</span>
                                                        <span className="font-medium text-green-600">+₹{parseFloat(commission).toFixed(2)}</span>
                                                    </div>
                                                )}
                                                <div className="border-t border-gray-300 mt-2 pt-2 flex justify-between">
                                                    <span className="text-gray-900 font-semibold">New Balance:</span>
                                                    <span className="font-bold text-blue-600">
                                                        ₹{(selectedProvider.balance - parseFloat(rechargeAmount || '0') + parseFloat(commission || '0')).toFixed(2)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3 mt-8">
                                        <button
                                            onClick={() => {
                                                setActiveView('list');
                                                setSelectedProvider(null);
                                                resetRechargeForm();
                                            }}
                                            className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleRecharge}
                                            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                        >
                                            Process Recharge
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Refill Balance Form */}
                    {activeView === 'refill' && selectedProvider && (
                        <>
                            <div className="bg-white border-b border-gray-200 p-6">
                                <h2 className="text-xl font-bold text-gray-900">Refill {selectedProvider.providerName} Balance</h2>
                                <p className="text-gray-500 mt-1">Add funds to provider wallet</p>
                            </div>

                            <div className="p-6">
                                <div className="max-w-xl mx-auto">
                                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                                        <div className="flex justify-between items-center mb-4">
                                            <p className="text-sm text-gray-500">Current Wallet Balance</p>
                                            <p className="text-xl font-bold text-blue-600">₹{selectedProvider.balance.toFixed(2)}</p>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <p className="text-sm text-gray-500">Current Outstanding</p>
                                            <p className={`text-xl font-bold ${selectedProvider.outstandingBalance > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                                ₹{selectedProvider.outstandingBalance?.toFixed(2) || '0.00'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Refill Type
                                            </label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setRefillType('paid')}
                                                    className={`px-4 py-3 rounded-lg border-2 flex items-center justify-center gap-2 ${refillType === 'paid'
                                                        ? 'border-green-500 bg-green-50 text-green-700'
                                                        : 'border-gray-200 hover:border-gray-300'
                                                        }`}
                                                >
                                                    <DollarSign className="w-5 h-5" />
                                                    <span className="font-semibold">Paid Amount</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setRefillType('credit')}
                                                    className={`px-4 py-3 rounded-lg border-2 flex items-center justify-center gap-2 ${refillType === 'credit'
                                                        ? 'border-red-500 bg-red-50 text-red-700'
                                                        : 'border-gray-200 hover:border-gray-300'
                                                        }`}
                                                >
                                                    <Wallet className="w-5 h-5" />
                                                    <span className="font-semibold">Credit</span>
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-2">
                                                {refillType === 'paid'
                                                    ? 'This amount is already paid to the provider.'
                                                    : 'This amount will be added to your outstanding due.'}
                                            </p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Refill Amount <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                value={refillAmount}
                                                onChange={(e) => setRefillAmount(e.target.value)}
                                                placeholder="Enter amount"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Balance Received (in Wallet)
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={receivedAmount}
                                                    onChange={(e) => setReceivedAmount(e.target.value)}
                                                    placeholder="Enter amount if different from Paid"
                                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                                                />
                                                {receivedAmount && parseFloat(receivedAmount) > parseFloat(refillAmount || '0') && (
                                                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                        <span className="text-sm font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                                                            +₹{(parseFloat(receivedAmount) - (parseFloat(refillAmount) || 0)).toFixed(2)} Profit
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-2">
                                                Leave empty if same as Paid Amount. Commission is calculated automatically.
                                            </p>
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => {
                                                    setActiveView('list');
                                                    setSelectedProvider(null);
                                                    setRefillAmount('');
                                                    setReceivedAmount('');
                                                }}
                                                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleRefillBalance}
                                                disabled={isSubmitting}
                                                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                                            >
                                                {isSubmitting ? (
                                                    <>
                                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                        Updating...
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCw className="w-5 h-5" />
                                                        Update Balance
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Pay Provider Form */}
                    {activeView === 'pay' && selectedProvider && (
                        <>
                            <div className="bg-white border-b border-gray-200 p-6">
                                <h2 className="text-xl font-bold text-gray-900">Pay Provider</h2>
                                <p className="text-gray-500 mt-1">Settle outstanding due for {selectedProvider.providerName}</p>
                            </div>

                            <div className="p-6">
                                <div className="max-w-xl mx-auto">
                                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                                        <div className="text-center">
                                            <p className="text-sm text-gray-500 mb-1">Total Outstanding Due</p>
                                            <p className="text-4xl font-bold text-red-600">₹{selectedProvider.outstandingBalance?.toFixed(2) || '0.00'}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                Payment Amount <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                value={payAmount}
                                                onChange={(e) => setPayAmount(e.target.value)}
                                                placeholder="Enter amount to pay"
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                                            />
                                            <p className="text-xs text-gray-500 mt-2">
                                                Entering this amount will deduct it from your outstanding balance.
                                            </p>
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => {
                                                    setActiveView('list');
                                                    setSelectedProvider(null);
                                                    setPayAmount('');
                                                }}
                                                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handlePayProvider}
                                                className="flex-1 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center gap-2 font-medium"
                                            >
                                                <CreditCard className="w-5 h-5" />
                                                Record Payment
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Bulk Recharge Form */}
                    {activeView === 'bulk-recharge' && selectedProvider && (
                        <>
                            <div className="bg-white border-b border-gray-200 p-6">
                                <h2 className="text-xl font-bold text-gray-900">Bulk Recharge</h2>
                                <p className="text-gray-500 mt-1">Enter multiple recharges at once - Excel-like entry</p>
                            </div>

                            <div className="p-6">
                                {/* Provider Info Banner */}
                                <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
                                    <div className="flex items-center justify-between flex-wrap gap-3">
                                        <div>
                                            <p className="text-sm text-gray-600">Provider</p>
                                            <p className="font-semibold text-gray-900 text-lg">{selectedProvider.providerName}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-600">Available Balance</p>
                                            <p className="font-bold text-purple-600 text-lg">₹{selectedProvider.balance.toFixed(2)}</p>
                                        </div>
                                    </div>
                                </div>

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
                                                            value={row.customerNumber}
                                                            onChange={(e) => updateBulkRow(row.id, 'customerNumber', e.target.value)}
                                                            placeholder="10-digit mobile"
                                                            maxLength={10}
                                                            className="w-full px-3 py-2 border-0 focus:ring-2 focus:ring-purple-500 rounded"
                                                        />
                                                    </td>
                                                    <td className="border border-gray-300 px-2 py-2">
                                                        <input
                                                            type="number"
                                                            value={row.amount}
                                                            onChange={(e) => updateBulkRow(row.id, 'amount', e.target.value)}
                                                            placeholder="0.00"
                                                            step="0.01"
                                                            min="0"
                                                            className="w-full px-3 py-2 border-0 focus:ring-2 focus:ring-purple-500 rounded"
                                                        />
                                                    </td>
                                                    <td className="border border-gray-300 px-2 py-2">
                                                        <input
                                                            type="number"
                                                            value={row.commission}
                                                            onChange={(e) => updateBulkRow(row.id, 'commission', e.target.value)}
                                                            placeholder="0.00"
                                                            step="0.01"
                                                            min="0"
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
                                    return totals.count > 0 && (
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
                                        onClick={() => {
                                            setActiveView('list');
                                            setSelectedProvider(null);
                                            setBulkRechargeRows([
                                                { id: '1', customerNumber: '', amount: '', commission: '' },
                                                { id: '2', customerNumber: '', amount: '', commission: '' },
                                                { id: '3', customerNumber: '', amount: '', commission: '' }
                                            ]);
                                        }}
                                        className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleBulkRecharge}
                                        disabled={isProcessingBulk || calculateBulkTotals().count === 0}
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
                        </>
                    )}

                    {/* Transaction History */}
                    {activeView === 'history' && selectedProvider && (
                        <>
                            <div className="bg-white border-b border-gray-200">
                                <div className="p-6 pb-0">
                                    <div className="flex items-center justify-between mb-6">
                                        <div>
                                            <h2 className="text-xl font-bold text-gray-900">Transaction History</h2>
                                            <p className="text-gray-500 mt-1">{selectedProvider.providerName}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-500">Total Transactions</p>
                                            <p className="text-2xl font-bold text-gray-900">
                                                {historyTab === 'recharges'
                                                    ? getProviderTransactions(selectedProvider.id!).length
                                                    : providerTransactions.filter(t => t.providerId === selectedProvider.id!).length
                                                }
                                            </p>
                                        </div>
                                    </div>

                                    {/* Tabs */}
                                    <div className="flex gap-6 border-b border-gray-200">
                                        <button
                                            onClick={() => setHistoryTab('recharges')}
                                            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${historyTab === 'recharges'
                                                ? 'border-blue-600 text-blue-600'
                                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                                }`}
                                        >
                                            Customer Recharges
                                        </button>
                                        <button
                                            onClick={() => setHistoryTab('account')}
                                            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${historyTab === 'account'
                                                ? 'border-blue-600 text-blue-600'
                                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                                }`}
                                        >
                                            Account Statement
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6">
                                {historyTab === 'recharges' ? (
                                    getProviderTransactions(selectedProvider.id!).length === 0 ? (
                                        <div className="text-center py-12">
                                            <Smartphone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                            <p className="text-gray-500">No customer recharges yet</p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Customer Recharges Table */}
                                            <div className="hidden md:block overflow-x-auto">
                                                <table className="w-full">
                                                    <thead className="bg-gray-50 border-b border-gray-200">
                                                        <tr>
                                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer Number</th>
                                                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Commission</th>
                                                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance After</th>
                                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">By</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-gray-200">
                                                        {getProviderTransactions(selectedProvider.id!).map(transaction => (
                                                            <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                                                    <div>{transaction.createdAt.toLocaleDateString()}</div>
                                                                    <div className="text-xs text-gray-500">{transaction.createdAt.toLocaleTimeString()}</div>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                                    {transaction.customerNumber}
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-purple-600">
                                                                    ₹{transaction.rechargeAmount.toFixed(2)}
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-green-600">
                                                                    {transaction.commission !== undefined && transaction.commission > 0 ? `₹${transaction.commission.toFixed(2)}` : '-'}
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-blue-600">
                                                                    ₹{transaction.balanceAfter.toFixed(2)}
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">
                                                                    {transaction.createdByName}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Customer Recharges Mobile Card View */}
                                            <div className="md:hidden space-y-3">
                                                {getProviderTransactions(selectedProvider.id!).map(transaction => (
                                                    <div key={transaction.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors bg-white">
                                                        <div className="flex items-start justify-between mb-3">
                                                            <div>
                                                                <p className="font-semibold text-gray-900 text-lg">{transaction.customerNumber}</p>
                                                                <p className="text-xs text-gray-500">
                                                                    {transaction.createdAt.toLocaleDateString()} {transaction.createdAt.toLocaleTimeString()}
                                                                </p>
                                                            </div>
                                                            <span className="text-lg font-bold text-purple-600">₹{transaction.rechargeAmount.toFixed(2)}</span>
                                                        </div>
                                                        <div className="grid grid-cols-3 gap-2">
                                                            {transaction.commission !== undefined && transaction.commission > 0 && (
                                                                <div className="bg-green-50 rounded-lg p-2">
                                                                    <p className="text-xs text-gray-500">Commission</p>
                                                                    <p className="font-semibold text-green-700 text-sm">₹{transaction.commission.toFixed(2)}</p>
                                                                </div>
                                                            )}
                                                            <div className="bg-blue-50 rounded-lg p-2">
                                                                <p className="text-xs text-gray-500">Balance After</p>
                                                                <p className="font-semibold text-blue-700 text-sm">₹{transaction.balanceAfter.toFixed(2)}</p>
                                                            </div>
                                                            <div className="bg-gray-50 rounded-lg p-2">
                                                                <p className="text-xs text-gray-500">By</p>
                                                                <p className="font-semibold text-gray-700 text-sm truncate">{transaction.createdByName}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )
                                ) : (
                                    providerTransactions.filter(t => t.providerId === selectedProvider.id!).length === 0 ? (
                                        <div className="text-center py-12">
                                            <Wallet className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                            <p className="text-gray-500">No account transactions yet</p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Account Statement Table View */}
                                            <div className="hidden md:block overflow-x-auto">
                                                <table className="w-full">
                                                    <thead className="bg-gray-50 border-b border-gray-200">
                                                        <tr>
                                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Wallet Bal</th>
                                                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Outstanding</th>
                                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">By</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-gray-200">
                                                        {providerTransactions
                                                            .filter(t => t.providerId === selectedProvider.id!)
                                                            .map(transaction => (
                                                                <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                                                        <div>{transaction.createdAt.toLocaleDateString()}</div>
                                                                        <div className="text-xs text-gray-500">{transaction.createdAt.toLocaleTimeString()}</div>
                                                                    </td>
                                                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                                                                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${transaction.type === 'payment' ? 'bg-orange-100 text-orange-700' :
                                                                            transaction.paymentType === 'credit' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                                                                            }`}>
                                                                            {transaction.type === 'payment' ? 'Payment' : `Refill (${transaction.paymentType})`}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                                                                        ₹{transaction.amount.toFixed(2)}
                                                                    </td>
                                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-blue-600">
                                                                        ₹{transaction.walletBalanceAfter.toFixed(2)}
                                                                    </td>
                                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-red-600">
                                                                        ₹{transaction.outstandingBalanceAfter.toFixed(2)}
                                                                    </td>
                                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                        {transaction.description}
                                                                    </td>
                                                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">
                                                                        {transaction.createdByName}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Account Statement Mobile Card View */}
                                            <div className="md:hidden space-y-3">
                                                {providerTransactions
                                                    .filter(t => t.providerId === selectedProvider.id!)
                                                    .map(transaction => (
                                                        <div key={transaction.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors bg-white">
                                                            <div className="flex items-start justify-between mb-3">
                                                                <div>
                                                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${transaction.type === 'payment' ? 'bg-orange-100 text-orange-700' :
                                                                        transaction.paymentType === 'credit' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                                                                        }`}>
                                                                        {transaction.type === 'payment' ? 'Payment' : `Refill (${transaction.paymentType})`}
                                                                    </span>
                                                                    <p className="text-xs text-gray-500 mt-2">
                                                                        {transaction.createdAt.toLocaleDateString()} {transaction.createdAt.toLocaleTimeString()}
                                                                    </p>
                                                                </div>
                                                                <span className="text-lg font-bold text-gray-900">₹{transaction.amount.toFixed(2)}</span>
                                                            </div>
                                                            <p className="text-sm text-gray-600 mb-3">{transaction.description}</p>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="bg-blue-50 rounded-lg p-2">
                                                                    <p className="text-xs text-gray-500">Wallet Bal</p>
                                                                    <p className="font-semibold text-blue-700 text-sm">₹{transaction.walletBalanceAfter.toFixed(2)}</p>
                                                                </div>
                                                                <div className="bg-red-50 rounded-lg p-2">
                                                                    <p className="text-xs text-gray-500">Outstanding</p>
                                                                    <p className="font-semibold text-red-700 text-sm">₹{transaction.outstandingBalanceAfter.toFixed(2)}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        </>
                                    )
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div >
    );
};

export default RechargeAccounts;
