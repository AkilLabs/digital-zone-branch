import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useToastContext } from '../context/ToastContext';
import { useAttendance } from '@/context/AttendanceContext';
import { getCurrentPosition, isWithinRadius, formatDistance } from '../utils/geolocation';
import { checkIn, checkOut, getTodayAttendance, getAttendanceHistory, startBreak, endBreak, startLunch, endLunch, formatWorkHours } from '../utils/attendance';
import type { Attendance } from '../types';
import { MapPin, Clock, LogIn, LogOut, Calendar, TrendingUp, Coffee, Utensils } from 'lucide-react';

const EmployeeDashboard: React.FC = () => {
    const { currentUser } = useAuth();
    const { currentStore } = useStore();
    const navigate = useNavigate();
    const { success, error } = useToastContext();
    const { refreshAttendance } = useAttendance();
    const activeStoreId = currentStore?.id || currentUser?.storeId || null;

    const [shopLocation, setShopLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [distance, setDistance] = useState<number | null>(null);
    const [todayAttendance, setTodayAttendance] = useState<Attendance | null>(null);
    const [attendanceHistory, setAttendanceHistory] = useState<Attendance[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [locationLoading, setLocationLoading] = useState(false); // New state for granular feedback
    const [locationError, setLocationError] = useState<string>('');
    const [employeeLocationSetting, setEmployeeLocationSetting] = useState<'required' | 'not-required'>('not-required');

    const [filterStartDate, setFilterStartDate] = useState<string>('');
    const [filterEndDate, setFilterEndDate] = useState<string>('');

    useEffect(() => {
        // Redirect if not employee
        if (currentUser?.role !== 'employee') {
            navigate('/dashboard');
            return;
        }

        fetchShopLocation();
        fetchTodayAttendance();
        fetchEmployeeSettings();
    }, [currentUser, currentStore?.id, navigate]);

    useEffect(() => {
        // Update location every 30 seconds
        const interval = setInterval(() => {
            updateUserLocation();
        }, 30000);

        updateUserLocation();

        return () => clearInterval(interval);
    }, [shopLocation]);

    useEffect(() => {
        fetchAttendanceHistory();
    }, [filterStartDate, filterEndDate, currentUser, activeStoreId]);

    const fetchShopLocation = async () => {
        try {
            // Read branch GPS coordinates directly from currentStore (0 reads) when available
            if (currentStore?.latitude && currentStore?.longitude) {
                setShopLocation({ latitude: currentStore.latitude, longitude: currentStore.longitude });
                return;
            }
            if (currentUser?.storeId) {
                const storeSnap = await getDoc(doc(db, 'stores', currentUser.storeId));
                if (storeSnap.exists()) {
                    const sData = storeSnap.data();
                    if (sData.latitude && sData.longitude) {
                        setShopLocation({ latitude: sData.latitude, longitude: sData.longitude });
                        return;
                    }
                }
            }
            const docRef = doc(db, 'settings', 'shopDetails');
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.latitude && data.longitude) {
                    setShopLocation({ latitude: data.latitude, longitude: data.longitude });
                }
            }
        } catch (err) {
            console.error('Error fetching shop location:', err);
        }
    };

    const fetchEmployeeSettings = async () => {
        if (!currentUser) return;

        try {
            const docRef = doc(db, 'users', currentUser.uid);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                setEmployeeLocationSetting(data.locationCheckIn || 'not-required');
            }
        } catch (err) {
            console.error('Error fetching employee settings:', err);
        }
    };

    const fetchTodayAttendance = async () => {
        if (!currentUser) return;

        try {
            const attendance = await getTodayAttendance(currentUser.uid, activeStoreId);
            setTodayAttendance(attendance);
        } catch (err) {
            console.error('Error fetching today\'s attendance:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchAttendanceHistory = async () => {
        if (!currentUser) return;

        try {
            let start: Date | undefined;
            if (filterStartDate) {
                const [y, m, d] = filterStartDate.split('-').map(Number);
                start = new Date(y, m - 1, d);
            }

            let end: Date | undefined;
            if (filterEndDate) {
                const [y, m, d] = filterEndDate.split('-').map(Number);
                end = new Date(y, m - 1, d);
            }

            const history = await getAttendanceHistory(currentUser.uid, start, end, activeStoreId);
            setAttendanceHistory(history);
        } catch (err) {
            console.error('Error fetching attendance history:', err);
        }
    };

    const updateUserLocation = async () => {
        const position = await getCurrentPosition();
        if (position) {
            setUserLocation(position);
            setLocationError('');

            if (shopLocation) {
                const result = isWithinRadius(
                    position.latitude,
                    position.longitude,
                    shopLocation.latitude,
                    shopLocation.longitude,
                    500
                );
                setDistance(result.distance);
            }
        } else {
            setLocationError('Unable to get your location. Please enable location access.');
        }
    };

    const handleCheckIn = async () => {
        if (!currentUser) return;

        setActionLoading(true);
        try {
            // Get current location if not available or if setting is required
            let currentLoc = userLocation;

            // Only strictly enforce location fetching if setting is 'required'
            if (!currentLoc && employeeLocationSetting === 'required') {
                setLocationLoading(true);
                try {
                    currentLoc = await getCurrentPosition();
                    if (currentLoc) {
                        setUserLocation(currentLoc);
                    }
                } catch (e) {
                    console.error("Error fetching location during check-in:", e);
                } finally {
                    setLocationLoading(false);
                }
            }

            // Only block if location is strict required and still missing
            if (!currentLoc && employeeLocationSetting === 'required') {
                error("Unable to access location. Please ensure location services are enabled.");
                setActionLoading(false);
                return;
            }

            // Only enforce location check if employee has 'required' setting
            if (employeeLocationSetting === 'required') {
                // We dealt with !currentLoc above, so here currentLoc is guaranteed by the check above
                if (currentLoc && !shopLocation) {
                    error('Shop location not set. Please contact administrator.');
                    setActionLoading(false);
                    return;
                }

                if (currentLoc && shopLocation) {
                    const result = isWithinRadius(
                        currentLoc.latitude,
                        currentLoc.longitude,
                        shopLocation.latitude,
                        shopLocation.longitude,
                        500
                    );

                    if (!result.isWithin) {
                        error(`You are ${formatDistance(result.distance)} from the shop. You must be within 500m to check in.`);
                        setActionLoading(false);
                        return;
                    }
                }
            }

            // Calculate distance if shop location & user location exists
            let distanceFromShop = 0;
            if (shopLocation && currentLoc) {
                const result = isWithinRadius(
                    currentLoc.latitude,
                    currentLoc.longitude,
                    shopLocation.latitude,
                    shopLocation.longitude,
                    500
                );
                distanceFromShop = result.distance;
            }

            const response = await checkIn(
                currentUser.uid,
                currentUser.displayName || currentUser.email || 'Employee',
                currentLoc ? currentLoc.latitude : null,
                currentLoc ? currentLoc.longitude : null,
                distanceFromShop,
                activeStoreId
            );

            if (response.success) {
                success(response.message);
                // Immediately update local state so the UI reflects the check-in
                // without relying on re-fetching from Firestore
                setTodayAttendance({
                    id: response.attendanceId || '',
                    userId: currentUser.uid,
                    userName: currentUser.displayName || currentUser.email || 'Employee',
                    checkInTime: new Date(),
                    checkOutTime: null,
                    checkInLocation: currentLoc ? { latitude: currentLoc.latitude, longitude: currentLoc.longitude } : { latitude: 0, longitude: 0 },
                    checkOutLocation: null,
                    distanceFromShop,
                    date: new Date().toISOString().split('T')[0],
                    status: 'checked-in',
                    workHours: null,
                    breaks: [],
                    totalBreakTime: null,
                    isOnBreak: false,
                    lunchStartTime: null,
                    lunchEndTime: null,
                    lunchDuration: null,
                    isOnLunch: false,
                });
                await refreshAttendance();
            } else {
                error(response.message);
            }
        } catch (err: any) {
            console.error(err);
            error(err.message || 'Failed to check in');
        } finally {
            setActionLoading(false);
        }
    };

    const handleCheckOut = async () => {
        if (!currentUser) return;

        setActionLoading(true);
        try {
            // Try to get location for record, but don't block if not required
            let currentLoc = userLocation;
            if (!currentLoc) {
                try {
                    currentLoc = await getCurrentPosition();
                } catch (e) {
                    console.error("Error fetching location during check-out:", e);
                }
            }

            const response = await checkOut(
                currentUser.uid,
                currentLoc ? currentLoc.latitude : null,
                currentLoc ? currentLoc.longitude : null,
                activeStoreId
            );

            if (response.success) {
                success(`${response.message} Total hours: ${response.workHours?.toFixed(2)}h`);
                await fetchTodayAttendance();
                await refreshAttendance();
                await fetchAttendanceHistory();
            } else {
                error(response.message);
            }
        } catch (err: any) {
            error('Failed to check out');
        } finally {
            setActionLoading(false);
        }
    };

    const handleStartBreak = async () => {
        if (!currentUser) return;
        setActionLoading(true);
        try {
            const response = await startBreak(currentUser.uid, activeStoreId);
            if (response.success) {
                success(response.message);
                await fetchTodayAttendance();
            } else {
                error(response.message);
            }
        } catch (err) {
            error('Failed to start break');
        } finally {
            setActionLoading(false);
        }
    };

    const handleEndBreak = async () => {
        if (!currentUser) return;
        setActionLoading(true);
        try {
            const response = await endBreak(currentUser.uid, activeStoreId);
            if (response.success) {
                success(response.message);
                await fetchTodayAttendance();
            } else {
                error(response.message);
            }
        } catch (err) {
            error('Failed to end break');
        } finally {
            setActionLoading(false);
        }
    };

    const handleStartLunch = async () => {
        if (!currentUser) return;
        setActionLoading(true);
        try {
            const response = await startLunch(currentUser.uid, activeStoreId);
            if (response.success) {
                success(response.message);
                await fetchTodayAttendance();
            } else {
                error(response.message);
            }
        } catch (err) {
            error('Failed to start lunch');
        } finally {
            setActionLoading(false);
        }
    };

    const handleEndLunch = async () => {
        if (!currentUser) return;
        setActionLoading(true);
        try {
            const response = await endLunch(currentUser.uid, activeStoreId);
            if (response.success) {
                success(response.message);
                await fetchTodayAttendance();
            } else {
                error(response.message);
            }
        } catch (err) {
            error('Failed to end lunch');
        } finally {
            setActionLoading(false);
        }
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const isCheckedIn = todayAttendance?.status === 'checked-in';
    // Can only check in if:
    // - No attendance record today AND
    // - Not loading AND
    // - Either location not required OR (location required AND within range)
    const canCheckIn = !todayAttendance && !actionLoading && (
        employeeLocationSetting === 'not-required' ||
        (employeeLocationSetting === 'required' && distance !== null && distance <= 500)
    );
    const canCheckOut = isCheckedIn && !actionLoading;

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
                <div className="mb-3 md:mb-6">
                    <h1 className="text-lg md:text-2xl font-bold text-gray-900 mb-0.5 md:mb-1">My Attendance</h1>
                    <p className="text-xs md:text-base text-gray-600">Track your check-in and check-out times</p>
                </div>

                {/* Location Status Card - Only show for employees with location restrictions */}
                {employeeLocationSetting === 'required' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-6 mb-3 md:mb-6">
                        <div className="flex items-start gap-2 md:gap-3 mb-3 md:mb-4">
                            <div className={`rounded-full p-1.5 md:p-2 ${distance !== null && distance <= 500 ? 'bg-green-100' : 'bg-amber-100'}`}>
                                <MapPin className={`h-4 w-4 md:h-5 md:w-5 ${distance !== null && distance <= 500 ? 'text-green-600' : 'text-amber-600'}`} />
                            </div>
                            <div className="flex-1">
                                <h2 className="text-sm md:text-lg font-bold text-gray-900 mb-0.5 md:mb-1">Location Status</h2>

                                {locationError ? (
                                    <p className="text-xs md:text-sm text-red-600">{locationError}</p>
                                ) : distance !== null ? (
                                    <div>
                                        <p className={`text-xs md:text-sm font-medium ${distance <= 500 ? 'text-green-600' : 'text-amber-600'}`}>
                                            {distance <= 500 ? '✓ Within shop range' : '✗ Too far from shop'}
                                        </p>
                                        <p className="text-[10px] md:text-xs text-gray-500 mt-0.5 md:mt-1">
                                            Distance: {formatDistance(distance)} (Max: 500m)
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-xs md:text-sm text-gray-600">Fetching location...</p>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={updateUserLocation}
                            className="w-full md:w-auto text-xs md:text-sm px-3 md:px-4 py-1.5 md:py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium"
                        >
                            Refresh Location
                        </button>
                    </div>
                )}

                {/* Today's Status */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-6 mb-4 md:mb-6">
                    <h2 className="text-base md:text-lg font-bold text-gray-900 mb-3 md:mb-4">Today's Status</h2>

                    {todayAttendance ? (
                        <div className="space-y-3 md:space-y-4">
                            {/* Check-in/out times - Compact on mobile */}
                            <div className="flex items-center justify-between p-3 md:p-4 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-2 md:gap-3">
                                    <div className="bg-green-100 rounded-full p-1.5 md:p-2">
                                        <LogIn className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs md:text-sm font-semibold text-gray-900">Check-in</p>
                                        <p className="text-sm md:text-lg font-bold text-green-600">
                                            {formatTime(todayAttendance.checkInTime)}
                                        </p>
                                    </div>
                                </div>
                                {todayAttendance.checkOutTime && (
                                    <div className="flex items-center gap-2 md:gap-3">
                                        <div>
                                            <p className="text-xs md:text-sm font-semibold text-gray-900 text-right">Check-out</p>
                                            <p className="text-sm md:text-lg font-bold text-blue-600">
                                                {formatTime(todayAttendance.checkOutTime)}
                                            </p>
                                        </div>
                                        <div className="bg-blue-100 rounded-full p-1.5 md:p-2">
                                            <LogOut className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {todayAttendance.workHours !== null && (
                                <div className="flex items-center gap-2 md:gap-3 p-3 md:p-4 bg-blue-50 rounded-lg">
                                    <Clock className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                                    <div>
                                        <p className="text-xs md:text-sm font-semibold text-gray-900">Total Hours</p>
                                        <p className="text-sm md:text-lg font-bold text-blue-600">
                                            {formatWorkHours(todayAttendance.workHours)}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Break & Lunch Details - Show individual entries */}
                            {(todayAttendance.breaks.length > 0 || todayAttendance.lunchStartTime) && (
                                <div className="border-t border-gray-200 pt-3 space-y-2">
                                    <p className="text-xs md:text-sm font-bold text-gray-700 mb-2">Today's Breaks & Lunch</p>

                                    {/* Individual Breaks */}
                                    {todayAttendance.breaks.map((breakItem, index) => (
                                        <div key={index} className="flex items-center justify-between p-2 bg-purple-50 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                <Coffee className="h-3.5 w-3.5 md:h-4 md:w-4 text-purple-600" />
                                                <div>
                                                    <p className="text-xs font-semibold text-gray-900">Break {index + 1}</p>
                                                    <p className="text-[10px] md:text-xs text-gray-600">
                                                        {formatTime(breakItem.startTime)} - {breakItem.endTime ? formatTime(breakItem.endTime) : 'Ongoing'}
                                                    </p>
                                                </div>
                                            </div>
                                            {breakItem.endTime && (
                                                <span className="text-xs font-bold text-purple-600">
                                                    {Math.round((breakItem.endTime.getTime() - breakItem.startTime.getTime()) / (1000 * 60))}m
                                                </span>
                                            )}
                                        </div>
                                    ))}

                                    {/* Lunch */}
                                    {todayAttendance.lunchStartTime && (
                                        <div className="flex items-center justify-between p-2 bg-orange-50 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                <Utensils className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-600" />
                                                <div>
                                                    <p className="text-xs font-semibold text-gray-900">Lunch Break</p>
                                                    <p className="text-[10px] md:text-xs text-gray-600">
                                                        {formatTime(todayAttendance.lunchStartTime)} - {todayAttendance.lunchEndTime ? formatTime(todayAttendance.lunchEndTime) : 'Ongoing'}
                                                    </p>
                                                </div>
                                            </div>
                                            {todayAttendance.lunchDuration !== null && (
                                                <span className="text-xs font-bold text-orange-600">
                                                    {todayAttendance.lunchDuration}m
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Primary Action Button - Compact on mobile */}
                            <div className="pt-2">
                                {isCheckedIn ? (
                                    <button
                                        onClick={handleCheckOut}
                                        disabled={!canCheckOut}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 md:py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed text-sm md:text-base"
                                    >
                                        <LogOut className="h-4 w-4 md:h-5 md:w-5" />
                                        {actionLoading ? 'Checking out...' : 'Check Out'}
                                    </button>
                                ) : todayAttendance?.status === 'checked-out' ? (
                                    <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 md:py-3 bg-gray-100 text-gray-600 font-semibold rounded-lg text-sm md:text-base border-2 border-gray-200">
                                        <LogOut className="h-4 w-4 md:h-5 md:w-5" />
                                        Attendance Completed for Today
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleCheckIn}
                                        disabled={!canCheckIn}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 md:py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed text-sm md:text-base"
                                    >
                                        <LogIn className="h-4 w-4 md:h-5 md:w-5" />
                                        {actionLoading ? (locationLoading ? 'Acquiring location...' : 'Checking in...') : 'Check In'}
                                    </button>
                                )}
                            </div>

                            {/* Break and Lunch Section - Only show when checked in */}
                            {isCheckedIn && (
                                <div className="pt-3 border-t border-gray-200">
                                    <p className="text-xs md:text-sm font-semibold text-gray-700 mb-2">Break & Lunch</p>

                                    {/* Break/Lunch Time Display - Compact grid */}
                                    {(todayAttendance.totalBreakTime !== null && todayAttendance.totalBreakTime > 0) || todayAttendance.lunchDuration !== null ? (
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            {todayAttendance.totalBreakTime !== null && todayAttendance.totalBreakTime > 0 && (
                                                <div className="flex items-center gap-1.5 p-2 bg-purple-50 rounded-lg">
                                                    <Coffee className="h-3.5 w-3.5 md:h-4 md:w-4 text-purple-600 shrink-0" />
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] md:text-xs text-gray-600">Breaks</p>
                                                        <p className="text-xs md:text-sm font-bold text-purple-600 truncate">{todayAttendance.totalBreakTime}m</p>
                                                    </div>
                                                </div>
                                            )}
                                            {todayAttendance.lunchDuration !== null && (
                                                <div className="flex items-center gap-1.5 p-2 bg-orange-50 rounded-lg">
                                                    <Utensils className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-600 shrink-0" />
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] md:text-xs text-gray-600">Lunch</p>
                                                        <p className="text-xs md:text-sm font-bold text-orange-600 truncate">{todayAttendance.lunchDuration}m</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : null}

                                    {/* Action Buttons - Compact 2-column grid */}
                                    <div className="grid grid-cols-2 gap-2">
                                        {/* Break button */}
                                        {!todayAttendance.isOnBreak ? (
                                            <button
                                                onClick={handleStartBreak}
                                                disabled={actionLoading || todayAttendance.isOnLunch}
                                                className="flex items-center justify-center gap-1.5 px-3 py-2 md:py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed text-xs md:text-sm"
                                            >
                                                <Coffee className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                <span className="hidden sm:inline">Start Break</span>
                                                <span className="sm:hidden">Break</span>
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleEndBreak}
                                                disabled={actionLoading}
                                                className="flex items-center justify-center gap-1.5 px-3 py-2 md:py-2.5 bg-purple-700 text-white font-semibold rounded-lg hover:bg-purple-800 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed text-xs md:text-sm animate-pulse"
                                            >
                                                <Coffee className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                <span className="hidden sm:inline">End Break</span>
                                                <span className="sm:hidden">End</span>
                                            </button>
                                        )}

                                        {/* Lunch button */}
                                        {!todayAttendance.lunchStartTime ? (
                                            <button
                                                onClick={handleStartLunch}
                                                disabled={actionLoading || todayAttendance.isOnBreak}
                                                className="flex items-center justify-center gap-1.5 px-3 py-2 md:py-2.5 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed text-xs md:text-sm"
                                            >
                                                <Utensils className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                <span className="hidden sm:inline">Start Lunch</span>
                                                <span className="sm:hidden">Lunch</span>
                                            </button>
                                        ) : !todayAttendance.isOnLunch ? (
                                            <div className="flex items-center justify-center gap-1.5 px-3 py-2 md:py-2.5 bg-gray-200 text-gray-600 font-semibold rounded-lg text-xs md:text-sm cursor-not-allowed">
                                                <Utensils className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                <span className="hidden sm:inline">Lunch Taken</span>
                                                <span className="sm:hidden">Done</span>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={handleEndLunch}
                                                disabled={actionLoading}
                                                className="flex items-center justify-center gap-1.5 px-3 py-2 md:py-2.5 bg-orange-700 text-white font-semibold rounded-lg hover:bg-orange-800 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed text-xs md:text-sm animate-pulse"
                                            >
                                                <Utensils className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                <span className="hidden sm:inline">End Lunch</span>
                                                <span className="sm:hidden">End</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-6 md:py-8">
                            <div className="bg-gray-100 rounded-full p-3 md:p-4 w-12 h-12 md:w-16 md:h-16 mx-auto mb-3 md:mb-4">
                                <Calendar className="h-6 w-6 md:h-8 md:w-8 text-gray-400" />
                            </div>
                            <p className="text-xs md:text-sm text-gray-600 mb-3 md:mb-4">You haven't checked in today</p>
                            <button
                                onClick={handleCheckIn}
                                disabled={!canCheckIn}
                                className="px-5 py-2.5 md:px-6 md:py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed inline-flex items-center gap-2 text-sm md:text-base"
                            >
                                <LogIn className="h-4 w-4 md:h-5 md:w-5" />
                                {actionLoading ? 'Checking in...' : 'Check In Now'}
                            </button>
                            {!canCheckIn && employeeLocationSetting === 'required' && distance !== null && distance > 500 && (
                                <p className="text-xs text-red-600 mt-2">
                                    You must be within 500m of the shop to check in
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Attendance History */}
                {/* Attendance History */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 md:mb-6">
                        <div className="flex items-center gap-1.5 md:gap-2">
                            <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                            <h2 className="text-sm md:text-lg font-bold text-gray-900">Attendance History</h2>
                        </div>

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

                    <div className="space-y-2 md:space-y-3">
                        {attendanceHistory.length > 0 ? (
                            attendanceHistory.map((record) => (
                                <div
                                    key={record.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 md:p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors gap-2"
                                >
                                    <div className="flex items-center gap-2 md:gap-3">
                                        <div className="bg-blue-100 rounded-full p-1.5 md:p-2">
                                            <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4 text-blue-600" />
                                        </div>
                                        <div>
                                            <p className="text-xs md:text-sm font-semibold text-gray-900">{formatDate(record.checkInTime)}</p>
                                            <p className="text-[10px] md:text-xs text-gray-500">
                                                {formatTime(record.checkInTime)} - {record.checkOutTime ? formatTime(record.checkOutTime) : 'Not checked out'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-left sm:text-right pl-8 sm:pl-0">
                                        {record.workHours !== null ? (
                                            <p className="text-xs md:text-sm font-bold text-blue-600">{formatWorkHours(record.workHours)}</p>
                                        ) : (
                                            <p className="text-[10px] md:text-xs text-amber-600 font-medium">In Progress</p>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-8 text-gray-500">
                                <p className="text-sm">No attendance records found for this period.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default EmployeeDashboard;
