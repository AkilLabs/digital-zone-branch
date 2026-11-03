import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { User, Attendance, BillingItem } from '../types';
import { formatWorkHours } from '../utils/attendance';
import {
    User as UserIcon,
    Mail,
    Calendar,
    Clock,
    TrendingUp,
    Coffee,
    Utensils,
    CheckCircle,
    XCircle,
    BarChart3,
    IndianRupee,
    Briefcase
} from 'lucide-react';

interface EmployeeStats {
    totalDays: number;
    totalHours: number;
    avgHoursPerDay: number;
    totalBreaks: number;
    totalLunchTime: number;
    attendanceRate: number;
    thisMonthDays: number;
    lastMonthDays: number;
    thisMonthHours: number;
    lastMonthHours: number;
}

const EmployeeProfile: React.FC = () => {
    const { employeeId } = useParams<{ employeeId: string }>();
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { getCollectionRef } = useStore();

    const [employee, setEmployee] = useState<User | null>(null);
    const [attendanceRecords, setAttendanceRecords] = useState<Attendance[]>([]);
    const [salaryBonusRecords, setSalaryBonusRecords] = useState<BillingItem[]>([]);
    const [stats, setStats] = useState<EmployeeStats>({
        totalDays: 0,
        totalHours: 0,
        avgHoursPerDay: 0,
        totalBreaks: 0,
        totalLunchTime: 0,
        attendanceRate: 0,
        thisMonthDays: 0,
        lastMonthDays: 0,
        thisMonthHours: 0,
        lastMonthHours: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentUser) return;

        const targetId = employeeId || currentUser.uid;

        // Security check
        const isOwner = currentUser.role === 'owner' || currentUser.role === 'admin';
        const isSelf = currentUser.uid === targetId;

        if (!isOwner && !isSelf) {
            navigate('/dashboard');
            return;
        }

        fetchEmployeeData(targetId);
    }, [currentUser, employeeId, navigate]);

    const fetchEmployeeData = async (targetId: string) => {
        if (!targetId) return;

        try {
            // Fetch employee details
            const employeeDoc = await getDoc(doc(db, 'users', targetId));
            if (employeeDoc.exists()) {
                const data = employeeDoc.data();
                setEmployee({
                    uid: employeeDoc.id,
                    email: data.email,
                    role: data.role,
                    displayName: data.name || data.displayName,
                    name: data.name,
                    isActive: data.isActive,
                });
            }

            // Fetch all attendance records for this employee
            const attendanceQuery = query(
                getCollectionRef('attendance'),
                where('userId', '==', targetId)
            );
            const attendanceSnapshot = await getDocs(attendanceQuery);

            const records: Attendance[] = attendanceSnapshot.docs.map((doc) => {
                const data = doc.data();
                return {
                    id: doc.id,
                    userId: data.userId,
                    userName: data.userName,
                    checkInTime: data.checkInTime.toDate(),
                    checkOutTime: data.checkOutTime ? data.checkOutTime.toDate() : null,
                    checkInLocation: data.checkInLocation,
                    checkOutLocation: data.checkOutLocation || null,
                    distanceFromShop: data.distanceFromShop,
                    date: data.date,
                    status: data.status,
                    workHours: data.workHours || null,
                    breaks: (data.breaks || []).map((b: any) => ({
                        startTime: b.startTime.toDate(),
                        endTime: b.endTime ? b.endTime.toDate() : null,
                    })),
                    totalBreakTime: data.totalBreakTime || null,
                    isOnBreak: data.isOnBreak || false,
                    lunchStartTime: data.lunchStartTime ? data.lunchStartTime.toDate() : null,
                    lunchEndTime: data.lunchEndTime ? data.lunchEndTime.toDate() : null,
                    lunchDuration: data.lunchDuration || null,
                    isOnLunch: data.isOnLunch || false,
                };
            });

            // Sort by date descending
            records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setAttendanceRecords(records);

            // Calculate statistics
            calculateStats(records);

            // Fetch Salary and Bonus records from dedicated `expenses` collection and legacy `billingItems`
            try {
                const expQuery = query(
                    getCollectionRef('expenses'),
                    where('employeeId', '==', targetId)
                );
                const legacyQuery = query(
                    getCollectionRef('billingItems'),
                    where('type', '==', 'expense'),
                    where('employeeId', '==', targetId)
                );

                const [expSnap, legSnap] = await Promise.all([
                    getDocs(expQuery).catch(() => null),
                    getDocs(legacyQuery).catch(() => null)
                ]);

                const combinedMap = new Map<string, BillingItem>();
                if (expSnap) {
                    expSnap.docs.forEach(doc => {
                        const d = doc.data();
                        const amt = Number(d.amount ?? d.cost ?? 0);
                        combinedMap.set(doc.id, {
                            id: doc.id,
                            ...d,
                            cost: amt,
                            type: 'expense',
                            _collection: 'expenses',
                            createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt)
                        } as BillingItem);
                    });
                }
                if (legSnap) {
                    legSnap.docs.forEach(doc => {
                        if (combinedMap.has(doc.id)) return;
                        const d = doc.data();
                        combinedMap.set(doc.id, {
                            id: doc.id,
                            ...d,
                            type: 'expense',
                            _collection: 'billingItems',
                            createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt)
                        } as BillingItem);
                    });
                }
                const data = Array.from(combinedMap.values());
                data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                setSalaryBonusRecords(data);
            } catch (err) {
                console.warn("Could not fetch employee salary/bonus records:", err);
            }

        } catch (error) {
            console.error('Error fetching employee data:', error);
        } finally {
            setLoading(false);
        }
    };

    const calculateStats = (records: Attendance[]) => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

        let totalDays = 0;
        let totalHours = 0;
        let totalBreaks = 0;
        let totalLunchTime = 0;
        let thisMonthDays = 0;
        let lastMonthDays = 0;
        let thisMonthHours = 0;
        let lastMonthHours = 0;

        records.forEach((record) => {
            const recordDate = new Date(record.date);
            const recordMonth = recordDate.getMonth();
            const recordYear = recordDate.getFullYear();

            // Only count completed days (checked out)
            if (record.workHours !== null) {
                totalDays++;
                totalHours += record.workHours;

                // This month
                if (recordMonth === currentMonth && recordYear === currentYear) {
                    thisMonthDays++;
                    thisMonthHours += record.workHours;
                }

                // Last month
                if (recordMonth === lastMonth && recordYear === lastMonthYear) {
                    lastMonthDays++;
                    lastMonthHours += record.workHours;
                }
            }

            // Count breaks and lunch
            totalBreaks += record.breaks.length;
            if (record.lunchDuration) {
                totalLunchTime += record.lunchDuration;
            }
        });

        const avgHoursPerDay = totalDays > 0 ? totalHours / totalDays : 0;

        // Calculate attendance rate (assuming 30 days per month, can be customized)
        const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const attendanceRate = thisMonthDays > 0 ? (thisMonthDays / daysInCurrentMonth) * 100 : 0;

        setStats({
            totalDays,
            totalHours,
            avgHoursPerDay,
            totalBreaks,
            totalLunchTime,
            attendanceRate,
            thisMonthDays,
            lastMonthDays,
            thisMonthHours,
            lastMonthHours,
        });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };



    const [paymentFilter, setPaymentFilter] = useState<'all' | 'salary' | 'bonus'>('all');
    const [filterStartDate, setFilterStartDate] = useState<string>('');
    const [filterEndDate, setFilterEndDate] = useState<string>('');

    // Filtered records for display
    const filteredRecords = attendanceRecords.filter(record => {
        if (!filterStartDate && !filterEndDate) return true;

        const recordDate = new Date(record.date);
        recordDate.setHours(0, 0, 0, 0);

        if (filterStartDate) {
            const [y, m, d] = filterStartDate.split('-').map(Number);
            const start = new Date(y, m - 1, d);
            if (recordDate < start) return false;
        }

        if (filterEndDate) {
            const [y, m, d] = filterEndDate.split('-').map(Number);
            const end = new Date(y, m - 1, d);
            end.setHours(23, 59, 59, 999);
            if (recordDate > end) return false;
        }

        return true;
    });

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex justify-center items-center h-[calc(100vh-80px)]">
                    <div className="text-gray-500">Loading employee profile...</div>
                </div>
            </div>
        );
    }

    if (!employee) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex flex-col justify-center items-center h-[calc(100vh-80px)]">
                    <XCircle className="h-16 w-16 text-red-500 mb-4" />
                    <p className="text-gray-600">Employee not found</p>
                    <button
                        onClick={() => navigate('/employee-management')}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Back to Employee Management
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />

            <main className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-6">
                {/* Back Button */}
                {/* Back Button Removed */}

                {/* Employee Header */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <div className="flex items-start gap-4">
                        <div className="bg-blue-100 rounded-full p-4">
                            <UserIcon className="h-8 w-8 text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <h1 className="text-2xl font-bold text-gray-900 mb-2">{employee.displayName || 'Employee'}</h1>
                            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                <div className="flex items-center gap-2">
                                    <Mail className="h-4 w-4" />
                                    <span>{employee.email}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle className={`h-4 w-4 ${employee.isActive ? 'text-green-600' : 'text-gray-400'}`} />
                                    <span>{employee.isActive ? 'Active' : 'Inactive'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Statistics Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    {/* Total Days */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-blue-100 rounded-full p-2">
                                <Calendar className="h-4 w-4 text-blue-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">Total Days</p>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">{stats.totalDays}</p>
                        <p className="text-xs text-gray-500 mt-1">All time</p>
                    </div>

                    {/* Average Hours */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-green-100 rounded-full p-2">
                                <Clock className="h-4 w-4 text-green-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">Avg Hours/Day</p>
                        </div>
                        <p className="text-2xl font-bold text-green-600">{formatWorkHours(stats.avgHoursPerDay)}</p>
                        <p className="text-xs text-gray-500 mt-1">Average per day</p>
                    </div>

                    {/* This Month */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-purple-100 rounded-full p-2">
                                <TrendingUp className="h-4 w-4 text-purple-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">This Month</p>
                        </div>
                        <p className="text-2xl font-bold text-purple-600">{stats.thisMonthDays}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatWorkHours(stats.thisMonthHours)} total</p>
                    </div>

                    {/* Last Month */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-amber-100 rounded-full p-2">
                                <BarChart3 className="h-4 w-4 text-amber-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">Last Month</p>
                        </div>
                        <p className="text-2xl font-bold text-amber-600">{stats.lastMonthDays}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatWorkHours(stats.lastMonthHours)} total</p>
                    </div>

                    {/* Attendance Rate */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-indigo-100 rounded-full p-2">
                                <CheckCircle className="h-4 w-4 text-indigo-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">Attendance Rate</p>
                        </div>
                        <p className="text-2xl font-bold text-indigo-600">{stats.attendanceRate.toFixed(0)}%</p>
                        <p className="text-xs text-gray-500 mt-1">This month</p>
                    </div>

                    {/* Total Hours */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-cyan-100 rounded-full p-2">
                                <Clock className="h-4 w-4 text-cyan-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">Total Hours</p>
                        </div>
                        <p className="text-2xl font-bold text-cyan-600">{formatWorkHours(stats.totalHours)}</p>
                        <p className="text-xs text-gray-500 mt-1">All time</p>
                    </div>

                    {/* Total Breaks */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-purple-100 rounded-full p-2">
                                <Coffee className="h-4 w-4 text-purple-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">Total Breaks</p>
                        </div>
                        <p className="text-2xl font-bold text-purple-600">{stats.totalBreaks}</p>
                        <p className="text-xs text-gray-500 mt-1">All time</p>
                    </div>

                    {/* Total Lunch Time */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-orange-100 rounded-full p-2">
                                <Utensils className="h-4 w-4 text-orange-600" />
                            </div>
                            <p className="text-xs font-semibold text-gray-600">Total Lunch</p>
                        </div>
                        <p className="text-2xl font-bold text-orange-600">{stats.totalLunchTime}m</p>
                        <p className="text-xs text-gray-500 mt-1">All time</p>
                    </div>
                </div>

                {/* Salary & Bonus History Dashboard */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <IndianRupee className="w-5 h-5 text-green-600" />
                            Salary & Bonus History
                        </h2>

                        {/* Payment Filter */}
                        <div className="flex bg-gray-100 p-1 rounded-lg overflow-x-auto max-w-full">
                            <button
                                onClick={() => setPaymentFilter('all')}
                                className={`flex-shrink-0 px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${paymentFilter === 'all'
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setPaymentFilter('salary')}
                                className={`flex-shrink-0 px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${paymentFilter === 'salary'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                Salary
                            </button>
                            <button
                                onClick={() => setPaymentFilter('bonus')}
                                className={`flex-shrink-0 px-4 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${paymentFilter === 'bonus'
                                    ? 'bg-white text-green-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                Bonus
                            </button>
                        </div>
                    </div>

                    {/* Financial Summary Cards */}
                    <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
                        <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Total Paid</p>
                            <p className="text-2xl font-bold text-gray-900">
                                ₹{salaryBonusRecords.reduce((sum, item) => sum + item.cost, 0).toLocaleString()}
                            </p>
                        </div>
                        <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200">
                            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">Total Salary</p>
                            <p className="text-2xl font-bold text-blue-700">
                                ₹{salaryBonusRecords.filter(i => i.expenseCategory === 'salary').reduce((sum, item) => sum + item.cost, 0).toLocaleString()}
                            </p>
                        </div>
                        <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-green-100 border border-green-200">
                            <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-1">Total Bonus</p>
                            <p className="text-2xl font-bold text-green-700">
                                ₹{salaryBonusRecords.filter(i => i.expenseCategory === 'bonus').reduce((sum, item) => sum + item.cost, 0).toLocaleString()}
                            </p>
                        </div>
                    </div>

                    {salaryBonusRecords.filter(r => paymentFilter === 'all' || r.expenseCategory === paymentFilter).length === 0 ? (
                        <div className="text-center py-8">
                            <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                            <p className="text-gray-500 text-sm">No records found for this category.</p>
                        </div>
                    ) : (
                        <>
                            {/* Mobile: Card View */}
                            <div className="md:hidden space-y-3">
                                {salaryBonusRecords
                                    .filter(r => paymentFilter === 'all' || r.expenseCategory === paymentFilter)
                                    .map((record) => (
                                        <div key={record.id} className="p-4 border border-gray-100 rounded-lg bg-gray-50/50">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <p className="text-sm font-semibold text-gray-900">{formatDate(record.createdAt)}</p>
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide mt-1 ${record.expenseCategory === 'bonus'
                                                        ? 'bg-green-100 text-green-800'
                                                        : 'bg-blue-100 text-blue-800'
                                                        }`}>
                                                        {record.expenseCategory || 'Salary'}
                                                    </span>
                                                </div>
                                                <p className="text-base font-bold text-gray-900">₹{record.cost.toLocaleString()}</p>
                                            </div>
                                            <p className="text-sm text-gray-600">
                                                {record.title}
                                                {record.description && (
                                                    <span className="text-gray-400 block text-xs mt-1">{record.description}</span>
                                                )}
                                            </p>
                                        </div>
                                    ))}
                            </div>

                            {/* Desktop: Table View */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                                            <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                                            <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                                            <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {salaryBonusRecords
                                            .filter(r => paymentFilter === 'all' || r.expenseCategory === paymentFilter)
                                            .map((record) => (
                                                <tr key={record.id} className="group hover:bg-gray-50 transition-colors">
                                                    <td className="py-3 text-sm text-gray-900 font-medium">
                                                        {formatDate(record.createdAt)}
                                                    </td>
                                                    <td className="py-3">
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${record.expenseCategory === 'bonus'
                                                            ? 'bg-green-100 text-green-800'
                                                            : 'bg-blue-100 text-blue-800'
                                                            }`}>
                                                            {record.expenseCategory ? record.expenseCategory.charAt(0).toUpperCase() + record.expenseCategory.slice(1) : 'Salary'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 text-sm text-gray-600 max-w-xs truncate">
                                                        {record.title}
                                                        {record.description && <span className="text-gray-400 ml-1">- {record.description}</span>}
                                                    </td>
                                                    <td className="py-3 text-sm font-bold text-gray-900 text-right">
                                                        ₹{record.cost.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>

                {/* Attendance History */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <h2 className="text-lg font-bold text-gray-900">Attendance History</h2>

                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <input
                                    type="date"
                                    value={filterStartDate}
                                    onChange={(e) => setFilterStartDate(e.target.value)}
                                    className="pl-3 pr-2 py-1.5 text-xs md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    placeholder="Start Date"
                                />
                            </div>
                            <span className="text-gray-400">-</span>
                            <div className="relative">
                                <input
                                    type="date"
                                    value={filterEndDate}
                                    onChange={(e) => setFilterEndDate(e.target.value)}
                                    className="pl-3 pr-2 py-1.5 text-xs md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    placeholder="End Date"
                                />
                            </div>
                            {(filterStartDate || filterEndDate) && (
                                <button
                                    onClick={() => {
                                        setFilterStartDate('');
                                        setFilterEndDate('');
                                    }}
                                    className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Clear filters"
                                >
                                    <span className="text-xs font-semibold">Clear</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {filteredRecords.length === 0 ? (
                        <div className="text-center py-12">
                            <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                            <p className="text-gray-600">No attendance records found for this period</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredRecords.map((record) => (
                                <div
                                    key={record.id}
                                    className="flex flex-col md:flex-row md:items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors gap-3"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`rounded-full p-2 ${record.status === 'checked-in' ? 'bg-green-100' : 'bg-blue-100'
                                            }`}>
                                            <Calendar className={`h-4 w-4 ${record.status === 'checked-in' ? 'text-green-600' : 'text-blue-600'
                                                }`} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-gray-900">{formatDate(new Date(record.date))}</p>
                                            <p className="text-xs text-gray-500">
                                                {formatTime(record.checkInTime)} - {record.checkOutTime ? formatTime(record.checkOutTime) : 'In Progress'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4 text-center">
                                        <div>
                                            <p className="text-xs text-gray-500">Work Hours</p>
                                            <p className="text-sm font-bold text-blue-600">
                                                {record.workHours !== null ? formatWorkHours(record.workHours) : '-'}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500">Breaks</p>
                                            <p className="text-sm font-bold text-purple-600">
                                                {record.totalBreakTime ? `${record.breaks.length} (${record.totalBreakTime}m)` : '-'}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500">Lunch</p>
                                            <p className="text-sm font-bold text-orange-600">
                                                {record.lunchDuration ? `${record.lunchDuration}m` : '-'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main >
        </div >
    );
};

export default EmployeeProfile;
