import {
    collection,
    addDoc,
    updateDoc,
    doc,
    query,
    where,
    getDocs,
    Timestamp,
    limit,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Attendance } from '../types';
import { sendCheckInNotification, sendCheckOutNotification } from './notifications';

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get today's attendance record for a user
 */
export async function getTodayAttendance(
    userId: string
): Promise<Attendance | null> {
    try {
        const today = formatDate(new Date());

        // Query by userId and date to reliably find today's record
        const q = query(
            collection(db, 'attendance'),
            where('userId', '==', userId),
            where('date', '==', today),
            limit(1)
        );

        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            return null;
        }

        const doc = querySnapshot.docs[0];

        if (!doc) {
            return null;
        }

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
    } catch (error) {
        console.error('Error getting today\'s attendance:', error);
        return null; // Return null so we don't block, but this might allow double check-in if DB is really broken
    }
}

/**
 * Check in an employee
 */
export async function checkIn(
    userId: string,
    userName: string,
    latitude: number | null,
    longitude: number | null,
    distanceFromShop: number
): Promise<{ success: boolean; message: string; attendanceId?: string }> {
    try {
        // Check if already checked in today (either currently checked in OR already checked out)
        const existingAttendance = await getTodayAttendance(userId);
        if (existingAttendance) {
            if (existingAttendance.status === 'checked-in') {
                return {
                    success: false,
                    message: 'You are already checked in today',
                };
            } else if (existingAttendance.status === 'checked-out') {
                return {
                    success: false,
                    message: 'You have already completed your attendance for today',
                };
            }
        }

        const today = formatDate(new Date());

        let checkInLocation = null;
        if (latitude !== null && longitude !== null) {
            checkInLocation = { latitude, longitude };
        }

        const attendanceData = {
            userId,
            userName,
            checkInTime: Timestamp.now(),
            checkOutTime: null,
            checkInLocation,
            checkOutLocation: null,
            distanceFromShop,
            date: today,
            status: 'checked-in',
            workHours: null,
            breaks: [],
            totalBreakTime: null,
            isOnBreak: false,
            lunchStartTime: null,
            lunchEndTime: null,
            lunchDuration: null,
            isOnLunch: false,
        };

        const docRef = await addDoc(collection(db, 'attendance'), attendanceData);

        // Send notification to all owners about check-in
        try {
            await sendCheckInNotification(userName, new Date());
        } catch (notifError) {
            console.error('Failed to send check-in notification:', notifError);
            // Don't fail the check-in if notification fails
        }

        return {
            success: true,
            message: 'Checked in successfully!',
            attendanceId: docRef.id,
        };
    } catch (error: any) {
        console.error('Error checking in:', error);
        return {
            success: false,
            message: `Failed to check in: ${error.message || 'Unknown error'}`,
        };
    }
}

/**
 * Check out an employee
 */
export async function checkOut(
    userId: string,
    latitude: number | null,
    longitude: number | null
): Promise<{ success: boolean; message: string; workHours?: number }> {
    try {
        const attendance = await getTodayAttendance(userId);
        if (!attendance) {
            return {
                success: false,
                message: 'No check-in record found for today',
            };
        }

        if (attendance.status === 'checked-out') {
            return {
                success: false,
                message: 'You have already checked out today',
            };
        }

        // End any ongoing break or lunch
        if (attendance.isOnBreak || attendance.isOnLunch) {
            return {
                success: false,
                message: 'Please end your current break or lunch before checking out',
            };
        }

        const checkOutTime = new Date();
        const totalHours = (checkOutTime.getTime() - attendance.checkInTime.getTime()) / (1000 * 60 * 60);

        // Calculate total break time in hours
        const breakMinutes = attendance.totalBreakTime || 0;
        const lunchMinutes = attendance.lunchDuration || 0;
        const totalBreakHours = (breakMinutes + lunchMinutes) / 60;

        // Actual work hours = total hours - break time - lunch time
        const actualWorkHours = Number((totalHours - totalBreakHours).toFixed(2));

        let checkOutLocation = null;
        if (latitude !== null && longitude !== null) {
            checkOutLocation = { latitude, longitude };
        }

        await updateDoc(doc(db, 'attendance', attendance.id!), {
            checkOutTime: Timestamp.now(),
            checkOutLocation,
            status: 'checked-out',
            workHours: actualWorkHours,
        });

        // Send notification to all owners about check-out
        try {
            await sendCheckOutNotification(attendance.userName, new Date(), actualWorkHours);
        } catch (notifError) {
            console.error('Failed to send check-out notification:', notifError);
            // Don't fail the check-out if notification fails
        }

        return {
            success: true,
            message: 'Checked out successfully!',
            workHours: actualWorkHours,
        };
    } catch (error: any) {
        console.error('Error checking out:', error);
        return {
            success: false,
            message: `Failed to check out: ${error.message || 'Unknown error'}`,
        };
    }
}

/**
 * Get attendance history for a user
 */
export async function getAttendanceHistory(
    userId: string,
    startDate?: Date,
    endDate?: Date
): Promise<Attendance[]> {
    try {
        // Query only by userId to avoid complex index requirements
        // We fetch all records for the user and filter in memory
        // This avoids the "FirebaseError: The query requires an index" error
        const q = query(
            collection(db, 'attendance'),
            where('userId', '==', userId)
        );

        const querySnapshot = await getDocs(q);
        const history = querySnapshot.docs.map((doc) => {
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

        // Format dates for comparison
        const startDateStr = startDate ? formatDate(startDate) : null;
        const endDateStr = endDate ? formatDate(endDate) : null;

        // Filter and sort in memory
        return history
            .filter(record => {
                if (startDateStr && record.date < startDateStr) return false;
                if (endDateStr && record.date > endDateStr) return false;
                return true;
            })
            .sort((a, b) => b.checkInTime.getTime() - a.checkInTime.getTime());
    } catch (error) {
        console.error('Error getting attendance history:', error);
        return [];
    }
}

/**
 * Get all attendance records for a specific date
 */
export async function getAttendanceByDate(date: Date): Promise<Attendance[]> {
    try {
        const dateStr = formatDate(date);
        console.log('Fetching attendance for date:', dateStr); // Debug log

        const q = query(
            collection(db, 'attendance'),
            where('date', '==', dateStr)
        );

        const querySnapshot = await getDocs(q);
        console.log('Found attendance records:', querySnapshot.size); // Debug log

        const records = querySnapshot.docs.map((doc) => {
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

        // Sort in-memory instead of using Firestore orderBy
        records.sort((a, b) => b.checkInTime.getTime() - a.checkInTime.getTime());

        return records;
    } catch (error) {
        console.error('Error getting attendance by date:', error);
        return [];
    }
}

/**
 * Calculate total work hours from attendance records
 */
export function calculateTotalHours(attendanceRecords: Attendance[]): number {
    return attendanceRecords.reduce((total, record) => {
        return total + (record.workHours || 0);
    }, 0);
}

/**
 * Start a break
 */
export async function startBreak(userId: string): Promise<{ success: boolean; message: string }> {
    try {
        const attendance = await getTodayAttendance(userId);
        if (!attendance) {
            return {
                success: false,
                message: 'You must check in first',
            };
        }

        if (attendance.status === 'checked-out') {
            return {
                success: false,
                message: 'You have already checked out for the day',
            };
        }

        if (attendance.isOnBreak) {
            return {
                success: false,
                message: 'You are already on a break',
            };
        }

        if (attendance.isOnLunch) {
            return {
                success: false,
                message: 'You are currently on lunch break',
            };
        }

        const newBreak = {
            startTime: Timestamp.now(),
            endTime: null,
        };

        await updateDoc(doc(db, 'attendance', attendance.id!), {
            breaks: [...attendance.breaks.map(b => ({
                startTime: Timestamp.fromDate(b.startTime),
                endTime: b.endTime ? Timestamp.fromDate(b.endTime) : null,
            })), newBreak],
            isOnBreak: true,
        });

        return {
            success: true,
            message: 'Break started',
        };
    } catch (error: any) {
        console.error('Error starting break:', error);
        return {
            success: false,
            message: `Failed to start break: ${error.message || 'Unknown error'}`,
        };
    }
}

/**
 * End a break
 */
export async function endBreak(userId: string): Promise<{ success: boolean; message: string }> {
    try {
        const attendance = await getTodayAttendance(userId);
        if (!attendance || !attendance.isOnBreak) {
            return {
                success: false,
                message: 'You are not on a break',
            };
        }

        const updatedBreaks = attendance.breaks.map((b, index) => {
            if (index === attendance.breaks.length - 1 && !b.endTime) {
                return {
                    startTime: Timestamp.fromDate(b.startTime),
                    endTime: Timestamp.now(),
                };
            }
            return {
                startTime: Timestamp.fromDate(b.startTime),
                endTime: b.endTime ? Timestamp.fromDate(b.endTime) : null,
            };
        });

        // Calculate total break time
        let totalBreakMinutes = 0;
        updatedBreaks.forEach((b: any) => {
            if (b.endTime) {
                const start = b.startTime.toDate();
                const end = b.endTime.toDate();
                totalBreakMinutes += (end.getTime() - start.getTime()) / (1000 * 60);
            }
        });

        await updateDoc(doc(db, 'attendance', attendance.id!), {
            breaks: updatedBreaks,
            totalBreakTime: Math.round(totalBreakMinutes),
            isOnBreak: false,
        });

        return {
            success: true,
            message: 'Break ended',
        };
    } catch (error: any) {
        console.error('Error ending break:', error);
        return {
            success: false,
            message: `Failed to end break: ${error.message || 'Unknown error'}`,
        };
    }
}

/**
 * Start lunch break (once per day only)
 */
export async function startLunch(userId: string): Promise<{ success: boolean; message: string }> {
    try {
        const attendance = await getTodayAttendance(userId);
        if (!attendance) {
            return {
                success: false,
                message: 'You must check in first',
            };
        }

        if (attendance.status === 'checked-out') {
            return {
                success: false,
                message: 'You have already checked out for the day',
            };
        }

        if (attendance.lunchStartTime) {
            return {
                success: false,
                message: 'You have already taken your lunch break today',
            };
        }

        if (attendance.isOnBreak) {
            return {
                success: false,
                message: 'Please end your current break first',
            };
        }

        if (attendance.isOnLunch) {
            return {
                success: false,
                message: 'You are already on lunch break',
            };
        }

        await updateDoc(doc(db, 'attendance', attendance.id!), {
            lunchStartTime: Timestamp.now(),
            isOnLunch: true,
        });

        return {
            success: true,
            message: 'Lunch break started',
        };
    } catch (error: any) {
        console.error('Error starting lunch:', error);
        return {
            success: false,
            message: `Failed to start lunch: ${error.message || 'Unknown error'}`,
        };
    }
}

/**
 * End lunch break
 */
export async function endLunch(userId: string): Promise<{ success: boolean; message: string }> {
    try {
        const attendance = await getTodayAttendance(userId);
        if (!attendance || !attendance.isOnLunch) {
            return {
                success: false,
                message: 'You are not on lunch break',
            };
        }

        const lunchStart = attendance.lunchStartTime!;
        const lunchEnd = new Date();
        const lunchMinutes = (lunchEnd.getTime() - lunchStart.getTime()) / (1000 * 60);

        await updateDoc(doc(db, 'attendance', attendance.id!), {
            lunchEndTime: Timestamp.now(),
            lunchDuration: Math.round(lunchMinutes),
            isOnLunch: false,
        });

        return {
            success: true,
            message: `Lunch break ended (${Math.round(lunchMinutes)} minutes)`,
        };
    } catch (error: any) {
        console.error('Error ending lunch:', error);
        return {
            success: false,
            message: `Failed to end lunch: ${error.message || 'Unknown error'}`,
        };
    }
}

// Utility function to format work hours from decimal to HH:MM
export function formatWorkHours(hours: number): string {
    const totalMinutes = Math.round(hours * 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hrs}:${mins.toString().padStart(2, '0')}`;
}
