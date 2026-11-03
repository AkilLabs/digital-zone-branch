import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import Navbar from '../components/Navbar';
import {
    Smartphone, Plus, DollarSign, X, Edit2, RefreshCw,
    Wallet, CreditCard, Filter, Download, FileText
} from 'lucide-react';
import type { RechargeProvider, ProviderTransaction } from '../types';
import {
    collection, getDocs, query, orderBy, addDoc, updateDoc, doc,
    Timestamp, increment, writeBatch
} from 'firebase/firestore';
import { db } from '../config/firebase';

type ViewState = 'list' | 'add' | 'edit' | 'refill' | 'pay' | 'statement';

const ProviderManagement: React.FC = () => {
    const { currentUser } = useAuth();
    const { showToast } = useToast();

    // Data State
    const [providers, setProviders] = useState<RechargeProvider[]>([]);
    const [transactions, setTransactions] = useState<ProviderTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // UI State
    const [currentView, setCurrentView] = useState<ViewState>('list');
    const [selectedProvider, setSelectedProvider] = useState<RechargeProvider | null>(null);
    const [showFilterModal, setShowFilterModal] = useState(false);

    // Forms State
    const [providerName, setProviderName] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [initialBalance, setInitialBalance] = useState('');
    const [providerImageUrl, setProviderImageUrl] = useState('');

    // Edit Form
    const [editProviderName, setEditProviderName] = useState('');
    const [editAccountNumber, setEditAccountNumber] = useState('');
    const [editProviderImageUrl, setEditProviderImageUrl] = useState('');

    // Refill/Pay State
    const [amount, setAmount] = useState('');
    const [receivedAmount, setReceivedAmount] = useState('');
    const [refillType, setRefillType] = useState<'paid' | 'credit'>('paid');

    // Filter State
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'refill' | 'payment'>('all');

    const isOwner = currentUser?.role === 'owner';
    const isAdmin = currentUser?.role === 'admin';
    const isEmployee = currentUser?.role === 'employee';
    const canManage = isOwner || isAdmin;

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setIsLoading(true);
            const providersRef = collection(db, 'rechargeProviders');
            const qProviders = query(providersRef, orderBy('createdAt', 'desc'));
            const snapshotPro = await getDocs(qProviders);

            const pList = snapshotPro.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date(),
                updatedAt: doc.data().updatedAt?.toDate()
            })) as RechargeProvider[];
            setProviders(pList);

            const transRef = collection(db, 'providerTransactions');
            const qTrans = query(transRef, orderBy('createdAt', 'desc'));
            const snapshotTrans = await getDocs(qTrans);

            const tList = snapshotTrans.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || new Date()
            })) as ProviderTransaction[];
            setTransactions(tList);

        } catch (error: any) {
            showToast('Error fetching data: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddProvider = async () => {
        if (!providerName || !initialBalance) {
            showToast('Please fill required fields', 'error');
            return;
        }

        const balance = parseFloat(initialBalance);
        if (isNaN(balance) || balance < 0) return showToast('Invalid balance', 'error');

        try {
            await addDoc(collection(db, 'rechargeProviders'), {
                providerName,
                accountNumber,
                imageUrl: providerImageUrl,
                balance,
                outstandingBalance: 0,
                totalRechargeAmount: 0,
                totalCommission: 0,
                totalPaidAmount: 0,
                totalCreditAmount: 0,
                isActive: true,
                createdAt: Timestamp.now(),
                createdBy: currentUser?.uid,
                createdByName: currentUser?.displayName
            });
            showToast('Provider added successfully', 'success');
            resetForms();
            fetchData();
        } catch (error: any) {
            showToast('Error: ' + error.message, 'error');
        }
    };

    const handleEditProvider = async () => {
        if (!selectedProvider || !editProviderName) return;

        try {
            await updateDoc(doc(db, 'rechargeProviders', selectedProvider.id!), {
                providerName: editProviderName,
                accountNumber: editAccountNumber,
                imageUrl: editProviderImageUrl,
                updatedAt: Timestamp.now()
            });
            showToast('Provider updated', 'success');
            resetForms();
            fetchData();
        } catch (error: any) {
            showToast('Error: ' + error.message, 'error');
        }
    };

    const handleRefill = async () => {
        if (!amount || isNaN(parseFloat(amount))) return showToast('Invalid amount', 'error');
        if (!selectedProvider) return;

        const amountPaid = parseFloat(amount);
        const amountReceived = receivedAmount ? parseFloat(receivedAmount) : amountPaid;

        if (isNaN(amountReceived) || amountReceived < amountPaid) {
            return showToast('Received amount cannot be less than paid amount', 'error');
        }

        try {
            const batch = writeBatch(db);
            const pRef = doc(db, 'rechargeProviders', selectedProvider.id!);
            const tRef = doc(collection(db, 'providerTransactions'));

            let newBalance = selectedProvider.balance + amountReceived;
            let newOutstanding = selectedProvider.outstandingBalance || 0;
            const commission = amountReceived - amountPaid;

            const updates: any = {
                balance: increment(amountReceived),
                totalCommission: increment(commission),
                updatedAt: Timestamp.now()
            };

            if (refillType === 'credit') {
                updates.outstandingBalance = increment(amountPaid);
                updates.totalCreditAmount = increment(amountPaid);
                newOutstanding += amountPaid;
            }

            batch.update(pRef, updates);

            batch.set(tRef, {
                providerId: selectedProvider.id!,
                providerName: selectedProvider.providerName,
                type: 'refill',
                paymentType: refillType,
                amount: amountPaid,
                receivedAmount: amountReceived,
                commission: commission,
                walletBalanceAfter: newBalance,
                outstandingBalanceAfter: newOutstanding,
                description: refillType === 'credit'
                    ? `Refill on Credit (Paid: ${amountPaid}, Rec: ${amountReceived})`
                    : `Paid Refill (Paid: ${amountPaid}, Rec: ${amountReceived})`,
                createdAt: Timestamp.now(),
                createdBy: currentUser?.uid,
                createdByName: currentUser?.displayName
            });

            await batch.commit();
            showToast(`Refill: +₹${amountReceived} (Comm: ₹${commission})`, 'success');
            resetForms();
            fetchData();
        } catch (error: any) {
            showToast('Error: ' + error.message, 'error');
        }
    };

    const handlePayment = async () => {
        if (!amount || isNaN(parseFloat(amount))) return showToast('Invalid amount', 'error');
        if (!selectedProvider) return;

        const val = parseFloat(amount);
        try {
            const batch = writeBatch(db);
            const pRef = doc(db, 'rechargeProviders', selectedProvider.id!);
            const tRef = doc(collection(db, 'providerTransactions'));

            // Payment reduces outstanding
            // It does NOT affect wallet balance (wallet balance was increased when credit was taken)
            // Payment is just settling the debt
            let newOutstanding = (selectedProvider.outstandingBalance || 0) - val;

            batch.update(pRef, {
                outstandingBalance: increment(-val),
                totalPaidAmount: increment(val),
                updatedAt: Timestamp.now()
            });

            batch.set(tRef, {
                providerId: selectedProvider.id!,
                providerName: selectedProvider.providerName,
                type: 'payment',
                paymentType: 'paid', // Payment is always 'paid' (money leaving us)
                amount: val,
                walletBalanceAfter: selectedProvider.balance,
                outstandingBalanceAfter: newOutstanding,
                description: 'Outstanding Settlement',
                createdAt: Timestamp.now(),
                createdBy: currentUser?.uid,
                createdByName: currentUser?.displayName
            });

            await batch.commit();
            showToast('Payment Recorded', 'success');
            resetForms();
            fetchData();
        } catch (error: any) {
            showToast('Error: ' + error.message, 'error');
        }
    };

    const resetForms = () => {
        setCurrentView('list');
        setSelectedProvider(null);
        setProviderName('');
        setAccountNumber('');
        setInitialBalance('');
        setProviderImageUrl('');
        setEditProviderName('');
        setEditAccountNumber('');
        setEditProviderImageUrl('');
        setEditProviderImageUrl('');
        setAmount('');
        setReceivedAmount('');
        setRefillType('paid');
    };

    const openEdit = (p: RechargeProvider) => {
        setSelectedProvider(p);
        setEditProviderName(p.providerName);
        setEditAccountNumber(p.accountNumber || '');
        setEditProviderImageUrl(p.imageUrl || '');
        setCurrentView('edit');
    };

    const openRefill = (p: RechargeProvider) => {
        setSelectedProvider(p);
        setAmount('');
        setReceivedAmount('');
        setRefillType('paid');
        setCurrentView('refill');
    };

    const openPay = (p: RechargeProvider) => {
        if (!isOwner && !isAdmin && !isEmployee) return showToast('Only authorized personnel can settle payments', 'error');
        setSelectedProvider(p);
        setAmount('');
        setCurrentView('pay');
    };

    const openStatement = (p: RechargeProvider) => {
        setSelectedProvider(p);
        setCurrentView('statement');
    };

    // Filter Logic
    const getFilteredTransactions = () => {
        if (!selectedProvider) return [];
        let filtered = transactions.filter(t => t.providerId === selectedProvider.id);

        if (filterType !== 'all') {
            filtered = filtered.filter(t => t.type === filterType);
        }

        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            filtered = filtered.filter(t => t.createdAt >= start);
        }

        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            filtered = filtered.filter(t => t.createdAt <= end);
        }

        return filtered;
    };

    const activeTransactions = getFilteredTransactions();

    const exportStatement = () => {
        if (activeTransactions.length === 0) return;
        const headers = ['Date', 'Type', 'Amount', 'Wallet Balance', 'Outstanding', 'Description', 'By'];
        const rows = activeTransactions.map(t => [
            t.createdAt.toLocaleDateString(),
            t.type === 'payment' ? 'Payment' : `Refill (${t.paymentType})`,
            t.amount.toFixed(2),
            t.walletBalanceAfter.toFixed(2),
            t.outstandingBalanceAfter.toFixed(2),
            t.description,
            t.createdByName
        ]);

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `statement-${selectedProvider?.providerName}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    // Calculate totals for report
    const totalRefills = activeTransactions.filter(t => t.type === 'refill').reduce((acc, t) => acc + t.amount, 0);
    const totalPayments = activeTransactions.filter(t => t.type === 'payment').reduce((acc, t) => acc + t.amount, 0);

    // Global Stats
    const totalProviderBalance = providers.reduce((acc, p) => acc + p.balance, 0);
    const totalOutstanding = providers.reduce((acc, p) => acc + (p.outstandingBalance || 0), 0);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex items-center justify-center p-20">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />
            <div className="max-w-7xl mx-auto px-4 py-6 pb-24">

                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Provider Management</h1>
                        <p className="text-gray-500">Manage balances, settlements, and reports</p>
                    </div>
                    {currentView === 'list' && canManage && (
                        <button
                            onClick={() => setCurrentView('add')}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition"
                        >
                            <Plus className="w-5 h-5" />
                            Add Provider
                        </button>
                    )}
                    {currentView !== 'list' && (
                        <button
                            onClick={resetForms}
                            className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
                        >
                            <X className="w-5 h-5" />
                            Close
                        </button>
                    )}
                </div>

                {/* Status Cards */}
                {/* Status Cards */}
                {currentView === 'list' && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 mb-6">
                        <div className="bg-white p-3 md:p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between">
                            <div>
                                <p className="text-gray-500 text-xs md:text-sm font-medium uppercase">Wallet Balance</p>
                                <h3 className="text-xl md:text-2xl font-bold text-green-600 mt-1">₹{totalProviderBalance.toFixed(0)}</h3>
                            </div>
                            <div className="hidden md:block bg-green-50 p-3 rounded-lg">
                                <Wallet className="w-6 h-6 text-green-600" />
                            </div>
                        </div>
                        <div className="bg-white p-3 md:p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between">
                            <div>
                                <p className="text-gray-500 text-xs md:text-sm font-medium uppercase">Outstanding</p>
                                <h3 className="text-xl md:text-2xl font-bold text-red-600 mt-1">₹{totalOutstanding.toFixed(0)}</h3>
                            </div>
                            <div className="hidden md:block bg-red-50 p-3 rounded-lg">
                                <CreditCard className="w-6 h-6 text-red-600" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Content */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

                    {/* List View */}
                    {currentView === 'list' && (
                        <>
                            {/* Desktop Table View */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Provider</th>
                                            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Wallet Balance</th>
                                            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Outstanding</th>
                                            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {providers.map(p => (
                                            <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.imageUrl ? 'bg-white border border-gray-200' : 'bg-blue-50'}`}>
                                                            {p.imageUrl ? (
                                                                <img src={p.imageUrl} alt="" className="w-6 h-6 object-contain" />
                                                            ) : (
                                                                <Smartphone className="w-5 h-5 text-blue-600" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-gray-900">{p.providerName}</p>
                                                            {p.accountNumber && <p className="text-xs text-gray-500">{p.accountNumber}</p>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className="font-bold text-blue-600">₹{p.balance.toFixed(2)}</span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className={`font-bold ${(p.outstandingBalance || 0) > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                                        ₹{p.outstandingBalance?.toFixed(2) || '0.00'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => openRefill(p)}
                                                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                            title="Refill"
                                                        >
                                                            <RefreshCw className="w-5 h-5" />
                                                        </button>
                                                        {(isOwner || isAdmin || isEmployee) && (
                                                            <button
                                                                onClick={() => openPay(p)}
                                                                disabled={(p.outstandingBalance || 0) <= 0}
                                                                className={`p-2 rounded-lg transition-colors ${(p.outstandingBalance || 0) > 0
                                                                    ? 'text-orange-600 hover:bg-orange-50'
                                                                    : 'text-gray-300 cursor-not-allowed'
                                                                    }`}
                                                                title="Settle"
                                                            >
                                                                <CreditCard className="w-5 h-5" />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => openStatement(p)}
                                                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                            title="Statement"
                                                        >
                                                            <FileText className="w-5 h-5" />
                                                        </button>
                                                        {canManage && (
                                                            <button
                                                                onClick={() => openEdit(p)}
                                                                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                                title="Edit"
                                                            >
                                                                <Edit2 className="w-5 h-5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Card View */}
                            <div className="md:hidden p-4 grid grid-cols-1 gap-4">
                                {providers.map(p => {
                                    const hasOutstanding = (p.outstandingBalance || 0) > 0;
                                    return (
                                        <div key={p.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 transition-all active:scale-[0.99]">
                                            {/* Header */}
                                            <div className="flex items-start justify-between mb-6">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${p.imageUrl ? 'bg-white border border-gray-100' : 'bg-gradient-to-br from-blue-50 to-blue-100'}`}>
                                                        {p.imageUrl ? (
                                                            <img src={p.imageUrl} alt={p.providerName} className="w-8 h-8 object-contain" />
                                                        ) : (
                                                            <Smartphone className="w-6 h-6 text-blue-600" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h3 className="font-bold text-lg text-gray-900 leading-tight">{p.providerName}</h3>
                                                        {p.accountNumber && (
                                                            <p className="text-sm text-gray-500 font-medium">#{p.accountNumber}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                {canManage && (
                                                    <button
                                                        onClick={() => openEdit(p)}
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
                                                    <span className="text-3xl font-bold text-gray-900">₹{p.balance?.toFixed(2) || '0.00'}</span>
                                                </div>
                                            </div>

                                            {/* Stats Row */}
                                            <div className="grid grid-cols-3 gap-2 mb-6">
                                                <div className={`p-3 rounded-xl border ${hasOutstanding ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                                                    <p className={`text-[10px] uppercase font-bold tracking-wider mb-1 ${hasOutstanding ? 'text-red-600' : 'text-gray-500'}`}>Outstanding</p>
                                                    <p className={`font-bold ${hasOutstanding ? 'text-red-700' : 'text-gray-700'}`}>
                                                        ₹{p.outstandingBalance?.toFixed(0) || '0'}
                                                    </p>
                                                </div>
                                                <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                                                    <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">Recharges</p>
                                                    <p className="font-bold text-gray-700">₹{p.totalRechargeAmount?.toFixed(0) || '0'}</p>
                                                </div>
                                                <div className="p-3 rounded-xl bg-green-50 border border-green-100">
                                                    <p className="text-[10px] uppercase font-bold tracking-wider text-green-700 mb-1">Total Paid</p>
                                                    <p className="font-bold text-green-700">₹{p.totalPaidAmount?.toFixed(0) || '0'}</p>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <button
                                                    onClick={() => openRefill(p)}
                                                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200 active:scale-95 transition-all"
                                                >
                                                    <RefreshCw className="w-5 h-5 mb-1" />
                                                    <span className="text-xs font-bold">Refill</span>
                                                </button>

                                                {(isOwner || isAdmin || isEmployee) && (
                                                    <button
                                                        onClick={() => openPay(p)}
                                                        disabled={!hasOutstanding}
                                                        className={`flex flex-col items-center justify-center p-3 rounded-xl active:scale-95 transition-all ${hasOutstanding
                                                            ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
                                                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                            }`}
                                                    >
                                                        <CreditCard className="w-5 h-5 mb-1" />
                                                        <span className="text-xs font-bold">Settle</span>
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => openStatement(p)}
                                                    className={`flex flex-col items-center justify-center p-3 rounded-xl bg-white border border-gray-200 text-gray-700 active:scale-95 transition-all ${(isOwner || isAdmin || isEmployee) ? 'col-span-2' : ''}`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <FileText className="w-4 h-4" />
                                                        <span className="text-sm font-bold">Statement</span>
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* Statement View */}
                    {currentView === 'statement' && selectedProvider && (
                        <div className="p-6">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b border-gray-200 pb-6">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">{selectedProvider.providerName} Statement</h2>
                                    <div className="mt-3 flex flex-wrap gap-3">
                                        <div className="bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg">
                                            <span className="text-xs text-blue-600 uppercase font-semibold mr-1">Balance:</span>
                                            <b className="text-blue-700">₹{selectedProvider.balance.toFixed(2)}</b>
                                        </div>
                                        <div className="bg-red-50 border border-red-100 px-3 py-1.5 rounded-lg">
                                            <span className="text-xs text-red-600 uppercase font-semibold mr-1">Due:</span>
                                            <b className="text-red-700">₹{selectedProvider.outstandingBalance?.toFixed(2) || '0.00'}</b>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2 w-full md:w-auto">
                                    <button
                                        onClick={() => setShowFilterModal(true)}
                                        className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 bg-white text-sm font-medium transition-colors"
                                    >
                                        <Filter className="w-4 h-4" /> Filter
                                    </button>
                                    <button
                                        onClick={exportStatement}
                                        className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition-colors shadow-sm"
                                    >
                                        <Download className="w-4 h-4" /> Export
                                    </button>
                                </div>
                            </div>

                            {/* Summary for Range */}
                            {(startDate || endDate || filterType !== 'all') && (
                                <div className="grid grid-cols-3 gap-4 mb-6 bg-gray-50 p-4 rounded-lg">
                                    <div>
                                        <p className="text-xs text-gray-500">Filtered Refills</p>
                                        <p className="text-lg font-bold text-green-600">₹{totalRefills.toFixed(2)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">Filtered Payments</p>
                                        <p className="text-lg font-bold text-orange-600">₹{totalPayments.toFixed(2)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-500">Records</p>
                                        <p className="text-lg font-bold">{activeTransactions.length}</p>
                                    </div>
                                </div>
                            )}

                            {/* Desktop Statement Table */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Amount</th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Wallet Bal</th>
                                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Outstanding</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Description</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {activeTransactions.map(t => (
                                            <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-4 py-3 text-sm text-gray-900">
                                                    {t.createdAt.toLocaleDateString()} <span className="text-gray-400 text-xs">{t.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </td>
                                                <td className="px-4 py-3 text-sm">
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${t.type === 'payment' ? 'bg-orange-100 text-orange-800' :
                                                        t.paymentType === 'credit' ? 'bg-red-100 text-red-800' :
                                                            'bg-green-100 text-green-800'
                                                        }`}>
                                                        {t.type === 'payment' ? 'Payment' : `${t.paymentType === 'credit' ? 'Credit' : 'Paid'} Refill`}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-right font-medium">₹{t.amount.toFixed(2)}</td>
                                                <td className="px-4 py-3 text-sm text-right text-blue-600">₹{t.walletBalanceAfter.toFixed(2)}</td>
                                                <td className="px-4 py-3 text-sm text-right text-red-600">₹{t.outstandingBalanceAfter.toFixed(2)}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate" title={t.description}>{t.description}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Statement Cards */}
                            <div className="md:hidden space-y-3">
                                {activeTransactions.map(t => (
                                    <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <p className="text-xs text-gray-500 mb-1">{t.createdAt.toLocaleDateString()} at {t.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wide ${t.type === 'payment' ? 'bg-orange-100 text-orange-800' :
                                                    t.paymentType === 'credit' ? 'bg-red-100 text-red-800' :
                                                        'bg-green-100 text-green-800'
                                                    }`}>
                                                    {t.type === 'payment' ? 'Payment' : `${t.paymentType === 'credit' ? 'Credit' : 'Paid'} Refill`}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-lg font-bold text-gray-900">₹{t.amount.toFixed(2)}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 mb-3 bg-gray-50 p-3 rounded-lg">
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase">Wallet Bal</p>
                                                <p className="font-semibold text-blue-700">₹{t.walletBalanceAfter.toFixed(2)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] text-gray-500 uppercase">Outstanding</p>
                                                <p className="font-semibold text-red-700">₹{t.outstandingBalanceAfter.toFixed(2)}</p>
                                            </div>
                                        </div>

                                        <p className="text-xs text-gray-500 italic">{t.description}</p>
                                    </div>
                                ))}
                                {activeTransactions.length === 0 && (
                                    <div className="text-center py-8 text-gray-500">
                                        No transactions found for this period.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Forms (Add, Edit, Refill, Pay) */}
                    {['add', 'edit', 'refill', 'pay'].includes(currentView) && (
                        <div className="p-6">
                            <div className="max-w-xl mx-auto">
                                {currentView === 'add' && (
                                    <div className="space-y-6">
                                        <div className="border-b border-gray-200 pb-4 mb-4">
                                            <h2 className="text-xl font-bold text-gray-900">Add New Provider</h2>
                                            <p className="text-sm text-gray-500">Enter provider details to create a new account.</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Provider Name <span className="text-red-500">*</span></label>
                                            <input
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                                placeholder="e.g. Airtel, Jio, Vi"
                                                value={providerName}
                                                onChange={e => setProviderName(e.target.value)}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Account Number <span className="text-gray-400">(Optional)</span></label>
                                            <input
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                                placeholder="Provider account number"
                                                value={accountNumber}
                                                onChange={e => setAccountNumber(e.target.value)}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Initial Balance <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">₹</span>
                                                <input
                                                    className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                                    placeholder="0.00"
                                                    type="number"
                                                    value={initialBalance}
                                                    onChange={e => setInitialBalance(e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL <span className="text-gray-400">(Optional)</span></label>
                                            <input
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                                placeholder="https://example.com/logo.png"
                                                value={providerImageUrl}
                                                onChange={e => setProviderImageUrl(e.target.value)}
                                            />
                                        </div>

                                        <div className="pt-4">
                                            <button
                                                onClick={handleAddProvider}
                                                className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-[0.98] transition-all"
                                            >
                                                Create Provider
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {currentView === 'edit' && (
                                    <div className="space-y-6">
                                        <div className="border-b border-gray-200 pb-4 mb-4">
                                            <h2 className="text-xl font-bold text-gray-900">Edit Provider</h2>
                                            <p className="text-sm text-gray-500">Update provider information.</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Provider Name</label>
                                            <input
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                                value={editProviderName}
                                                onChange={e => setEditProviderName(e.target.value)}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Account Number</label>
                                            <input
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                                value={editAccountNumber}
                                                onChange={e => setEditAccountNumber(e.target.value)}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL</label>
                                            <input
                                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                                value={editProviderImageUrl}
                                                onChange={e => setEditProviderImageUrl(e.target.value)}
                                            />
                                        </div>

                                        <div className="pt-4">
                                            <button
                                                onClick={handleEditProvider}
                                                className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-[0.98] transition-all"
                                            >
                                                Update Provider
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {currentView === 'refill' && selectedProvider && (
                                    <div className="space-y-6">
                                        <div className="text-center mb-8">
                                            <h2 className="text-2xl font-bold text-gray-900 mb-2">Refill Balance</h2>
                                            <p className="text-gray-500">Add funds to <span className="font-semibold text-gray-900">{selectedProvider.providerName}</span></p>
                                        </div>

                                        <div className="bg-blue-50 rounded-2xl p-6 mb-6 text-center border border-blue-100">
                                            <p className="text-sm text-blue-600 font-medium uppercase tracking-wide mb-1">Current Balance</p>
                                            <p className="text-3xl font-bold text-blue-700">₹{selectedProvider.balance.toFixed(2)}</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-3">Refill Type</label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <button
                                                    onClick={() => setRefillType('paid')}
                                                    className={`p-4 border-2 rounded-xl flex flex-col items-center gap-2 transition-all ${refillType === 'paid'
                                                        ? 'bg-green-50 border-green-500 text-green-700 shadow-md transform scale-[1.02]'
                                                        : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200'
                                                        }`}
                                                >
                                                    <DollarSign className={`w-6 h-6 ${refillType === 'paid' ? 'text-green-600' : 'text-gray-400'}`} />
                                                    <span className="font-bold">Paid Now</span>
                                                </button>
                                                <button
                                                    onClick={() => setRefillType('credit')}
                                                    className={`p-4 border-2 rounded-xl flex flex-col items-center gap-2 transition-all ${refillType === 'credit'
                                                        ? 'bg-red-50 border-red-500 text-red-700 shadow-md transform scale-[1.02]'
                                                        : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200'
                                                        }`}
                                                >
                                                    <Wallet className={`w-6 h-6 ${refillType === 'credit' ? 'text-red-500' : 'text-gray-400'}`} />
                                                    <span className="font-bold">Take Credit</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Amount Paid <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-lg">₹</span>
                                                <input
                                                    className="w-full pl-8 pr-4 py-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all text-lg font-medium"
                                                    placeholder="0.00"
                                                    type="number"
                                                    value={amount}
                                                    onChange={e => setAmount(e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Balance Received <span className="text-gray-400">(Optional)</span></label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-lg">₹</span>
                                                <input
                                                    className="w-full pl-8 pr-4 py-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all text-lg font-medium"
                                                    placeholder="Same as paid amount"
                                                    type="number"
                                                    value={receivedAmount}
                                                    onChange={e => setReceivedAmount(e.target.value)}
                                                />
                                                {receivedAmount && parseFloat(receivedAmount) > parseFloat(amount || '0') && (
                                                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                        <span className="text-xs font-bold text-green-700 bg-green-100 px-3 py-1.5 rounded-full border border-green-200">
                                                            +₹{(parseFloat(receivedAmount) - (parseFloat(amount) || 0)).toFixed(2)} Profit
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-2 ml-1">
                                                Only enter if you received more balance (commission) than what you paid.
                                            </p>
                                        </div>

                                        <div className="pt-4">
                                            <button
                                                onClick={handleRefill}
                                                className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-green-200 hover:bg-green-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                            >
                                                <RefreshCw className="w-5 h-5" />
                                                Process Refill
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {currentView === 'pay' && selectedProvider && (
                                    <div className="space-y-6">
                                        <div className="text-center mb-8">
                                            <h2 className="text-2xl font-bold text-gray-900 mb-2">Settle Payment</h2>
                                            <p className="text-gray-500">Record payment for <span className="font-semibold text-gray-900">{selectedProvider.providerName}</span></p>
                                        </div>

                                        <div className="bg-red-50 rounded-2xl p-6 mb-6 text-center border border-red-100">
                                            <p className="text-sm text-red-600 font-medium uppercase tracking-wide mb-1">Outstanding Due</p>
                                            <p className="text-3xl font-bold text-red-700">₹{selectedProvider.outstandingBalance?.toFixed(2) || '0.00'}</p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Payment Amount <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-lg">₹</span>
                                                <input
                                                    className="w-full pl-8 pr-4 py-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all text-lg font-medium"
                                                    placeholder="0.00"
                                                    type="number"
                                                    value={amount}
                                                    onChange={e => setAmount(e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        <div className="pt-4">
                                            <button
                                                onClick={handlePayment}
                                                className="w-full bg-orange-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-orange-200 hover:bg-orange-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                            >
                                                <CreditCard className="w-5 h-5" />
                                                Record Payment
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Filter Modal */}
            {showFilterModal && (
                <div className="fixed inset-0 bg-transparent backdrop-blur-xl bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold">Filter Statement</h3>
                            <button onClick={() => setShowFilterModal(false)}><X className="w-5 h-5" /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                                <select
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value as any)}
                                    className="w-full p-2 border rounded-lg"
                                >
                                    <option value="all">All Transactions</option>
                                    <option value="refill">Refills Only</option>
                                    <option value="payment">Payments Only</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 border rounded-lg" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2 border rounded-lg" />
                            </div>
                            <div className="flex gap-2 mt-6">
                                <button
                                    onClick={() => {
                                        setStartDate('');
                                        setEndDate('');
                                        setFilterType('all');
                                    }}
                                    className="flex-1 p-2 border rounded-lg text-gray-600"
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={() => setShowFilterModal(false)}
                                    className="flex-1 p-2 bg-blue-600 text-white rounded-lg"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProviderManagement;
