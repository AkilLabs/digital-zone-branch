package com.recallmobiles.pos

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

object NotificationHelper {
    
    private const val CHANNEL_ID = "attendance_channel"
    private const val CHANNEL_NAME = "Employee Attendance"
    private const val CHANNEL_DESCRIPTION = "Notifications for employee check-in and check-out"
    
    /**
     * Create notification channel (required for Android 8.0+)
     */
    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = CHANNEL_DESCRIPTION
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500)
            }
            
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }
    
    /**
     * Show check-in notification
     */
    fun showCheckInNotification(context: Context, employeeName: String, time: String) {
        showNotification(
            context = context,
            title = "✅ Employee Check-In",
            message = "$employeeName checked in at $time",
            notificationId = 1001
        )
    }
    
    /**
     * Show check-out notification
     */
    fun showCheckOutNotification(context: Context, employeeName: String, time: String, workHours: String) {
        showNotification(
            context = context,
            title = "🏁 Employee Check-Out",
            message = "$employeeName checked out at $time (Worked: $workHours)",
            notificationId = 1002
        )
    }
    
    /**
     * Internal function to show notification
     */
    private fun showNotification(context: Context, title: String, message: String, notificationId: Int) {
        // Create intent to open MainActivity when notification is tapped
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
        
        // Build notification
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // Replace with your app icon
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setVibrate(longArrayOf(0, 500, 200, 500))
            .setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI)
        
        // Show notification
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(notificationId, builder.build())
    }
}
