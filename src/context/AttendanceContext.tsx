import React, { createContext, useContext } from 'react';
import type { Attendance } from '../types';

interface AttendanceContextType {
  attendance: Attendance | null;
  loading: boolean;
  refreshAttendance: () => Promise<void>;
  isCheckedIn: boolean;
}

const AttendanceContext = createContext<AttendanceContextType | undefined>(undefined);

/**
 * Employee check-in/check-out is handled externally via a dedicated APK.
 * This provider remains as a lightweight compatibility shim with zero Firestore reads.
 */
export const AttendanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const refreshAttendance = async () => {};

  return (
    <AttendanceContext.Provider
      value={{
        attendance: null,
        loading: false,
        refreshAttendance,
        isCheckedIn: true,
      }}
    >
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
