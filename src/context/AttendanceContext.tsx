
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { getTodayAttendance } from '../utils/attendance';
import type { Attendance } from '../types';

interface AttendanceContextType {
    attendance: Attendance | null;
    loading: boolean;
    refreshAttendance: () => Promise<void>;
    isCheckedIn: boolean;
}

const AttendanceContext = createContext<AttendanceContextType | undefined>(undefined);

export const AttendanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentUser } = useAuth();
    const [attendance, setAttendance] = useState<Attendance | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshAttendance = useCallback(async () => {
        if (currentUser?.role === 'employee') {
            try {
                const data = await getTodayAttendance(currentUser.uid, currentUser.storeId);
                setAttendance(data);
            } catch (error) {
                console.error('Error fetching attendance in context:', error);
                setAttendance(null);
            }
        } else {
            setAttendance(null);
        }
        setLoading(false);
    }, [currentUser]);

    useEffect(() => {
        refreshAttendance();
    }, [refreshAttendance]);

    const isCheckedIn = attendance?.status === 'checked-in';

    return (
        <AttendanceContext.Provider value={{ attendance, loading, refreshAttendance, isCheckedIn }}>
            {children}
        </AttendanceContext.Provider>
    );
};

export const useAttendance = () => {
    const context = useContext(AttendanceContext);
    if (context === undefined) {
        throw new Error('useAttendance must be used within an AttendanceProvider');
    }
    return context;
};
