import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { User } from '../types';

/**
 * Send a notification to all owners (creates Firestore document)
 */
export async function sendNotificationToOwners(
    title: string,
    body: string,
    data?: Record<string, string>
): Promise<void> {
    try {
        // Get all owner users
        const usersQuery = query(
            collection(db, 'users'),
            where('role', '==', 'owner')
        );

        const querySnapshot = await getDocs(usersQuery);
        const owners = querySnapshot.docs.map(doc => ({
            uid: doc.id,
            ...doc.data()
        } as User));

        if (owners.length === 0) {
            console.log('No owners found');
            return;
        }

        // Create notification document for each owner
        // Android app will listen to these in real-time
        const notificationPromises = owners.map(async (owner) => {
            await addDoc(collection(db, 'notifications'), {
                userId: owner.uid,
                title,
                body,
                data: data || {},
                timestamp: new Date(),
                status: 'pending', // pending, read, dismissed
                type: 'attendance'
            });
        });

        await Promise.all(notificationPromises);
        console.log(`Notification created for ${owners.length} owner(s)`);
    } catch (error) {
        console.error('Error creating notification:', error);
    }
}

/**
 * Send check-in notification
 */
export async function sendCheckInNotification(
    employeeName: string,
    checkInTime: Date
): Promise<void> {
    const timeStr = checkInTime.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    await sendNotificationToOwners(
        '✅ Employee Check-In',
        `${employeeName} checked in at ${timeStr}`,
        {
            type: 'check-in',
            employeeName,
            timestamp: checkInTime.toISOString()
        }
    );
}

/**
 * Send check-out notification
 */
export async function sendCheckOutNotification(
    employeeName: string,
    checkOutTime: Date,
    workHours: number
): Promise<void> {
    const timeStr = checkOutTime.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    const hoursStr = formatWorkHours(workHours);

    await sendNotificationToOwners(
        '🏁 Employee Check-Out',
        `${employeeName} checked out at ${timeStr} (Worked: ${hoursStr})`,
        {
            type: 'check-out',
            employeeName,
            workHours: workHours.toString(),
            timestamp: checkOutTime.toISOString()
        }
    );
}

/**
 * Helper function to format work hours
 */
function formatWorkHours(hours: number): string {
    const totalMinutes = Math.round(hours * 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hrs}h ${mins}m`;
}
