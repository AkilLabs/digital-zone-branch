import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Utensils, LogIn, LogOut, UserCheck, Clock } from 'lucide-react';
import type { Attendance } from '../types';

interface EmployeeAttendanceViewProps {
    records: Attendance[];
    formatTime: (date: Date) => string;
    formatWorkHours: (hours: number) => string;
}

const EmployeeAttendanceView: React.FC<EmployeeAttendanceViewProps> = ({ records, formatTime, formatWorkHours }) => {
    const navigate = useNavigate();

    if (records.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="bg-gray-100 rounded-full p-4 w-16 h-16 mx-auto mb-4">
                    <UserCheck className="h-8 w-8 text-gray-400" />
                </div>
                <p className="text-sm text-gray-600">No attendance records found</p>
            </div>
        );
    }

    const handleEmployeeClick = (userId: string) => {
        navigate(`/employee-profile/${userId}`);
    };

    return (
        <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Employee</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Check-in</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Check-out</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Breaks</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Lunch</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Work Hours</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {records.map((record) => (
                            <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`rounded-full p-2 ${record.status === 'checked-in' ? 'bg-green-100' : 'bg-blue-100'
                                            }`}>
                                            <UserCheck className={`h-4 w-4 ${record.status === 'checked-in' ? 'text-green-600' : 'text-blue-600'
                                                }`} />
                                        </div>
                                        <div>
                                            <button
                                                onClick={() => handleEmployeeClick(record.userId)}
                                                className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline text-left transition-colors"
                                            >
                                                {record.userName}
                                            </button>
                                            <p className="text-xs text-gray-500">{record.distanceFromShop}m away</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-4">
                                    <div className="flex flex-col gap-1">
                                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full inline-block w-fit ${record.status === 'checked-in'
                                            ? 'bg-green-100 text-green-800'
                                            : 'bg-blue-100 text-blue-800'
                                            }`}>
                                            {record.status === 'checked-in' ? 'Working' : 'Done'}
                                        </span>
                                        {record.isOnBreak && (
                                            <span className="text-xs font-medium px-2.5 py-1 rounded-full inline-block w-fit bg-purple-100 text-purple-800 animate-pulse">
                                                ☕ On Break
                                            </span>
                                        )}
                                        {record.isOnLunch && (
                                            <span className="text-xs font-medium px-2.5 py-1 rounded-full inline-block w-fit bg-orange-100 text-orange-800 animate-pulse">
                                                🍴 On Lunch
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-4">
                                    <div className="flex items-center gap-2">
                                        <LogIn className="h-3.5 w-3.5 text-green-600" />
                                        <span className="text-sm text-gray-900">{formatTime(record.checkInTime)}</span>
                                    </div>
                                </td>
                                <td className="px-4 py-4">
                                    {record.checkOutTime ? (
                                        <div className="flex items-center gap-2">
                                            <LogOut className="h-3.5 w-3.5 text-blue-600" />
                                            <span className="text-sm text-gray-900">{formatTime(record.checkOutTime)}</span>
                                        </div>
                                    ) : (
                                        <span className="text-sm text-gray-400">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-4">
                                    {record.totalBreakTime && record.totalBreakTime > 0 ? (
                                        <div className="flex items-center gap-1.5">
                                            <Coffee className="h-3.5 w-3.5 text-purple-600" />
                                            <span className="text-sm font-medium text-purple-900">
                                                {record.breaks.length} ({record.totalBreakTime}m)
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-sm text-gray-400">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-4">
                                    {record.lunchDuration ? (
                                        <div className="flex items-center gap-1.5">
                                            <Utensils className="h-3.5 w-3.5 text-orange-600" />
                                            <span className="text-sm font-medium text-orange-900">{record.lunchDuration}m</span>
                                        </div>
                                    ) : (
                                        <span className="text-sm text-gray-400">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-4">
                                    {record.workHours !== null ? (
                                        <div className="flex items-center gap-1.5">
                                            <Clock className="h-3.5 w-3.5 text-blue-600" />
                                            <span className="text-sm font-bold text-blue-600">{formatWorkHours(record.workHours)}</span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-amber-600 font-medium">In Progress</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
                {records.map((record) => (
                    <div key={record.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <div className={`rounded-full p-1.5 ${record.status === 'checked-in' ? 'bg-green-100' : 'bg-blue-100'
                                    }`}>
                                    <UserCheck className={`h-4 w-4 ${record.status === 'checked-in' ? 'text-green-600' : 'text-blue-600'
                                        }`} />
                                </div>
                                <div>
                                    <button
                                        onClick={() => handleEmployeeClick(record.userId)}
                                        className="text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline text-left transition-colors"
                                    >
                                        {record.userName}
                                    </button>
                                    <div className="flex flex-wrap gap-1">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${record.status === 'checked-in'
                                            ? 'bg-green-100 text-green-800'
                                            : 'bg-blue-100 text-blue-800'
                                            }`}>
                                            {record.status === 'checked-in' ? 'Working' : 'Done'}
                                        </span>
                                        {record.isOnBreak && (
                                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 animate-pulse">
                                                ☕ Break
                                            </span>
                                        )}
                                        {record.isOnLunch && (
                                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 animate-pulse">
                                                🍴 Lunch
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {record.workHours !== null ? (
                                <div className="text-right">
                                    <p className="text-xs text-gray-500">Hours</p>
                                    <p className="text-base font-bold text-blue-600">{formatWorkHours(record.workHours)}</p>
                                </div>
                            ) : (
                                <span className="text-xs text-amber-600 font-medium">In Progress</span>
                            )}
                        </div>

                        {/* Activity Details */}
                        <div className="space-y-2">
                            {/* Check-in/out */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex items-center gap-1.5 p-2 bg-green-50 rounded">
                                    <LogIn className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] text-gray-600">Check-in</p>
                                        <p className="text-xs font-semibold text-gray-900 truncate">{formatTime(record.checkInTime)}</p>
                                    </div>
                                </div>
                                <div className={`flex items-center gap-1.5 p-2 rounded ${record.checkOutTime ? 'bg-blue-50' : 'bg-gray-50'
                                    }`}>
                                    <LogOut className={`h-3.5 w-3.5 shrink-0 ${record.checkOutTime ? 'text-blue-600' : 'text-gray-400'
                                        }`} />
                                    <div className="min-w-0">
                                        <p className="text-[10px] text-gray-600">Check-out</p>
                                        <p className="text-xs font-semibold text-gray-900 truncate">
                                            {record.checkOutTime ? formatTime(record.checkOutTime) : '-'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Breaks & Lunch */}
                            {((record.totalBreakTime && record.totalBreakTime > 0) || record.lunchDuration) && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className={`flex items-center gap-1.5 p-2 rounded ${record.totalBreakTime && record.totalBreakTime > 0 ? 'bg-purple-50' : 'bg-gray-50'
                                        }`}>
                                        <Coffee className={`h-3.5 w-3.5 shrink-0 ${record.totalBreakTime && record.totalBreakTime > 0 ? 'text-purple-600' : 'text-gray-400'
                                            }`} />
                                        <div className="min-w-0">
                                            <p className="text-[10px] text-gray-600">Breaks</p>
                                            <p className="text-xs font-semibold text-gray-900 truncate">
                                                {record.totalBreakTime && record.totalBreakTime > 0
                                                    ? `${record.breaks.length} (${record.totalBreakTime}m)`
                                                    : '-'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className={`flex items-center gap-1.5 p-2 rounded ${record.lunchDuration ? 'bg-orange-50' : 'bg-gray-50'
                                        }`}>
                                        <Utensils className={`h-3.5 w-3.5 shrink-0 ${record.lunchDuration ? 'text-orange-600' : 'text-gray-400'
                                            }`} />
                                        <div className="min-w-0">
                                            <p className="text-[10px] text-gray-600">Lunch</p>
                                            <p className="text-xs font-semibold text-gray-900 truncate">
                                                {record.lunchDuration ? `${record.lunchDuration}m` : '-'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};

export default EmployeeAttendanceView;
