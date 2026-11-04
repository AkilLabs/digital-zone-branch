import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { getDocs, query, where, onSnapshot } from 'firebase/firestore';
import type { User, Attendance, AttendanceStats } from '../types';
import { getAttendanceByDate, calculateTotalHours, formatWorkHours } from '../utils/attendance';
import { Users, UserCheck, Clock, TrendingUp, Calendar, Search, FileDown, ChevronRight, Filter, X } from 'lucide-react';
import EmployeeAttendanceView from '../components/EmployeeAttendanceView';

const EmployeeManagement: React.FC = () => {
    const { currentUser } = useAuth();
    const { getCollectionRef, currentStore } = useStore();
    const navigate = useNavigate();

    const [employees, setEmployees] = useState<User[]>([]);
    const [attendanceRecords, setAttendanceRecords] = useState<Attendance[]>([]);
    const [filteredRecords, setFilteredRecords] = useState<Attendance[]>([]);
    const [stats, setStats] = useState<AttendanceStats>({
        totalEmployees: 0,
        currentlyCheckedIn: 0,
        attendanceRate: 0,
        totalHoursToday: 0,
    });
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
    const [showFilterModal, setShowFilterModal] = useState(false);

    useEffect(() => {
        // Redirect if user doesn't have employee management access
        const allowedRoles = ['owner', 'hub-admin', 'store-admin', 'admin'];
        if (!currentUser?.role || !allowedRoles.includes(currentUser.role)) {
            navigate('/dashboard');
            return;
        }

        fetchEmployees();
    }, [currentUser, currentStore?.id, navigate]);

    useEffect(() => {
        if (selectedDate && employees.length > 0) {
            const unsubscribe = fetchAttendanceForDate(new Date(selectedDate));

            // Cleanup listener when date changes or component unmounts
            return () => {
                if (unsubscribe) {
                    unsubscribe.then(unsub => unsub && unsub());
                }
            };
        }
    }, [selectedDate, employees]);

    useEffect(() => {
        filterRecords();
    }, [searchQuery, selectedEmployee, attendanceRecords]);

    const fetchEmployees = async () => {
        try {
            const employeesQuery = query(
                getCollectionRef('users'),
                where('role', '==', 'employee')
            );
            const snapshot = await getDocs(employeesQuery);

            const allUsers: User[] = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    uid: doc.id,
                    email: data.email,
                    role: data.role,
                    displayName: data.name || data.displayName,
                    name: data.name,
                    storeId: data.storeId || '',
                    isActive: data.isActive,
                };
            });

            const branchEmployees = allUsers.filter(
                u => !currentStore?.id || !u.storeId || u.storeId === currentStore.id
            );

            setEmployees(branchEmployees);

            // Fetch attendance for today after employees are loaded
            const records = await getAttendanceByDate(new Date(selectedDate), currentStore?.id);
            setAttendanceRecords(records);
            calculateStats(branchEmployees, records);
        } catch (err) {
            console.error('Error fetching employees:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchAttendanceForDate = async (date: Date) => {
        try {
            const dateStr = date.toISOString().split('T')[0];

            // Set up real-time listener
            const q = query(
                getCollectionRef('attendance'),
                where('date', '==', dateStr)
            );

            // Subscribe to real-time updates
            const unsubscribe = onSnapshot(q, (querySnapshot) => {
                const records: Attendance[] = querySnapshot.docs.map((doc) => {
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

                // Sort in-memory by check-in time
                records.sort((a, b) => b.checkInTime.getTime() - a.checkInTime.getTime());

                setAttendanceRecords(records);
                calculateStats(employees, records);
            }, (error) => {
                console.error('Error in real-time listener:', error);
            });

            // Return unsubscribe function for cleanup
            return unsubscribe;
        } catch (err) {
            console.error('Error setting up attendance listener:', err);
        }
    };

    const calculateStats = (employeesList: User[], records: Attendance[]) => {
        const totalEmployees = employeesList.length;
        const currentlyCheckedIn = records.filter(r => r.status === 'checked-in').length;
        const attendanceRate = totalEmployees > 0 ? (records.length / totalEmployees) * 100 : 0;
        const totalHoursToday = calculateTotalHours(records);

        setStats({
            totalEmployees,
            currentlyCheckedIn,
            attendanceRate,
            totalHoursToday,
        });
    };

    const filterRecords = () => {
        let filtered = [...attendanceRecords];

        // Filter by employee
        if (selectedEmployee !== 'all') {
            filtered = filtered.filter(record => record.userId === selectedEmployee);
        }

        // Filter by search query (employee name)
        if (searchQuery.trim()) {
            filtered = filtered.filter(record =>
                record.userName.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        setFilteredRecords(filtered);
    };

    const exportToCSV = () => {
        const headers = ['Employee Name', 'Date', 'Check-in Time', 'Check-out Time', 'Work Hours', 'Distance (m)'];
        const rows = filteredRecords.map(record => [
            record.userName,
            record.date,
            record.checkInTime.toLocaleString(),
            record.checkOutTime ? record.checkOutTime.toLocaleString() : 'Not checked out',
            record.workHours !== null ? formatWorkHours(record.workHours) : 'N/A',
            record.distanceFromShop.toString(),
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `attendance_${selectedDate}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const getEmployeeStatus = (userId: string): 'checked-in' | 'checked-out' | 'absent' => {
        const record = attendanceRecords.find(r => r.userId === userId);
        if (!record) return 'absent';
        return record.status;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar />
                <div className="flex justify-center items-center h-[calc(100vh-80px)]">
                    <div className="text-gray-500">Loading...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />

            <main className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-6">
                {/* Header */}
                <div className="mb-4 md:mb-6">
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-1">Employee Management</h1>
                    <p className="text-sm md:text-base text-gray-600">Track and manage employee attendance</p>
                </div>

                {/* Statistics Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-4">
                        <div className="flex items-center gap-2 md:gap-3 mb-1 md:mb-2">
                            <div className="bg-blue-100 rounded-full p-1.5 md:p-2">
                                <Users className="h-3.5 w-3.5 md:h-5 md:w-5 text-blue-600" />
                            </div>
                            <p className="text-xs md:text-sm font-semibold text-gray-600">Total Employees</p>
                        </div>
                        <p className="text-lg md:text-2xl font-bold text-gray-900">{stats.totalEmployees}</p>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-4">
                        <div className="flex items-center gap-2 md:gap-3 mb-1 md:mb-2">
                            <div className="bg-green-100 rounded-full p-1.5 md:p-2">
                                <UserCheck className="h-3.5 w-3.5 md:h-5 md:w-5 text-green-600" />
                            </div>
                            <p className="text-xs md:text-sm font-semibold text-gray-600">Checked In</p>
                        </div>
                        <p className="text-lg md:text-2xl font-bold text-green-600">{stats.currentlyCheckedIn}</p>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-4">
                        <div className="flex items-center gap-2 md:gap-3 mb-1 md:mb-2">
                            <div className="bg-purple-100 rounded-full p-1.5 md:p-2">
                                <TrendingUp className="h-3.5 w-3.5 md:h-5 md:w-5 text-purple-600" />
                            </div>
                            <p className="text-xs md:text-sm font-semibold text-gray-600">Attendance Rate</p>
                        </div>
                        <p className="text-lg md:text-2xl font-bold text-purple-600">{stats.attendanceRate.toFixed(0)}%</p>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-4">
                        <div className="flex items-center gap-2 md:gap-3 mb-1 md:mb-2">
                            <div className="bg-amber-100 rounded-full p-1.5 md:p-2">
                                <Clock className="h-3.5 w-3.5 md:h-5 md:w-5 text-amber-600" />
                            </div>
                            <p className="text-xs md:text-sm font-semibold text-gray-600">Total Hours</p>
                        </div>
                        <p className="text-lg md:text-2xl font-bold text-amber-600">{stats.totalHoursToday.toFixed(1)}h</p>
                    </div>
                </div>

                {/* Mobile Filters & Controls */}
                <div className="md:hidden bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search..."
                                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <button
                            onClick={() => setShowFilterModal(true)}
                            className={`p-2 rounded-lg border transition-colors ${selectedEmployee !== 'all' || selectedDate !== new Date().toISOString().split('T')[0]
                                ? 'bg-blue-50 border-blue-200 text-blue-600'
                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                            title="Filter"
                        >
                            <Filter className="h-5 w-5" />
                        </button>
                        <button
                            onClick={exportToCSV}
                            disabled={filteredRecords.length === 0}
                            className="p-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                            title="Export to CSV"
                        >
                            <FileDown className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Desktop Filters & Controls */}
                <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <div className="grid grid-cols-3 gap-4">
                        {/* Date Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                <Calendar className="inline h-4 w-4 mr-1" />
                                Select Date
                            </label>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* Employee Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                <Users className="inline h-4 w-4 mr-1" />
                                Filter Employee
                            </label>
                            <select
                                value={selectedEmployee}
                                onChange={(e) => setSelectedEmployee(e.target.value)}
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="all">All Employees</option>
                                {employees.map(emp => (
                                    <option key={emp.uid} value={emp.uid}>
                                        {emp.displayName || emp.email}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Search */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                <Search className="inline h-4 w-4 mr-1" />
                                Search
                            </label>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by name..."
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    {/* Export Button */}
                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={exportToCSV}
                            disabled={filteredRecords.length === 0}
                            className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            <FileDown className="h-4 w-4" />
                            Export to CSV
                        </button>
                    </div>
                </div>

                {/* Filter Modal (Mobile) */}
                {showFilterModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 md:hidden">
                        <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-xl animate-in fade-in zoom-in duration-200">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold text-gray-900">Filters</h3>
                                <button
                                    onClick={() => setShowFilterModal(false)}
                                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
                                >
                                    <X className="h-6 w-6" />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Select Date
                                    </label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                        <input
                                            type="date"
                                            value={selectedDate}
                                            onChange={(e) => setSelectedDate(e.target.value)}
                                            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Filter Employee
                                    </label>
                                    <div className="relative">
                                        <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                        <select
                                            value={selectedEmployee}
                                            onChange={(e) => setSelectedEmployee(e.target.value)}
                                            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                                        >
                                            <option value="all">All Employees</option>
                                            {employees.map(emp => (
                                                <option key={emp.uid} value={emp.uid}>
                                                    {emp.displayName || emp.email}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowFilterModal(false)}
                                className="w-full mt-6 bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors"
                            >
                                Apply Filters
                            </button>
                        </div>
                    </div>
                )}

                {/* Employee List with Attendance Status */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6">
                    <h2 className="text-base md:text-lg font-bold text-gray-900 mb-4">Employee Attendance Details</h2>
                    <EmployeeAttendanceView records={filteredRecords} formatTime={formatTime} formatWorkHours={formatWorkHours} />
                </div>

                {/* All Employees Status */}
                {selectedEmployee === 'all' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-6 mt-4 md:mt-6">
                        <h2 className="text-base md:text-lg font-bold text-gray-900 mb-4">All Employees</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {employees.map(employee => {
                                const status = getEmployeeStatus(employee.uid);
                                const record = attendanceRecords.find(r => r.userId === employee.uid);

                                return (
                                    <div
                                        key={employee.uid}
                                        className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-3">
                                                <div className={`rounded-full p-2 ${status === 'checked-in' ? 'bg-green-100' :
                                                    status === 'checked-out' ? 'bg-blue-100' : 'bg-gray-100'
                                                    }`}>
                                                    <UserCheck className={`h-4 w-4 ${status === 'checked-in' ? 'text-green-600' :
                                                        status === 'checked-out' ? 'text-blue-600' : 'text-gray-400'
                                                        }`} />
                                                </div>
                                                <p className="text-sm font-semibold text-gray-900 truncate max-w-[120px]">
                                                    {employee.displayName || employee.email}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => navigate(`/employee-profile/${employee.uid}`)}
                                                className="p-1 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium"
                                                title="View Profile"
                                            >
                                                View
                                                <ChevronRight className="h-4 w-4" />
                                            </button>
                                        </div>

                                        <div className="ml-11">
                                            <span className={`text-xs font-medium px-2 py-1 rounded-full inline-block ${status === 'checked-in' ? 'bg-green-100 text-green-800' :
                                                status === 'checked-out' ? 'bg-blue-100 text-blue-800' :
                                                    'bg-gray-100 text-gray-600'
                                                }`}>
                                                {status === 'checked-in' ? 'Checked In' :
                                                    status === 'checked-out' ? 'Checked Out' : 'Absent'}
                                            </span>
                                            {record && record.workHours !== null && (
                                                <p className="text-xs text-gray-600 mt-1">
                                                    {formatWorkHours(record.workHours)} worked
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default EmployeeManagement;
