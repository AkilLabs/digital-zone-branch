import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAttendance } from '@/context/AttendanceContext';

interface ProtectedRouteProps {
  children: React.ReactElement;
  hubOnly?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, hubOnly }) => {
  const { currentUser, loading: authLoading } = useAuth();
  const { isCheckedIn, loading: attendanceLoading } = useAttendance();
  const location = useLocation();

  if (authLoading || attendanceLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Handle Hub-only access
  if (hubOnly && currentUser.scope !== 'hub' && currentUser.role !== 'owner' && currentUser.role !== 'admin') {
    // Redirect store-level users to their dashboard if they try to access hub routes
    return <Navigate to="/dashboard" replace />;
  }

  // If employee is not allowed to view this page (not checked in), redirect to dashboard
  if (currentUser.role === 'employee' && !isCheckedIn && location.pathname !== '/employee-dashboard') {
    return <Navigate to="/employee-dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;