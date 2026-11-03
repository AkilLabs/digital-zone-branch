package com.recallmobiles.pos

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import java.text.SimpleDateFormat
import java.util.*

class AttendanceListenerService : Service() {
    
    private val TAG = "AttendanceListener"
    private lateinit var db: FirebaseFirestore
    private var attendanceListener: ListenerRegistration? = null
    private val processedAttendanceIds = mutableSetOf<String>()
    
    override fun onCreate() {
        super.onCreate()
        db = FirebaseFirestore.getInstance()
        
        // Create notification channel
        NotificationHelper.createNotificationChannel(this)
        
        // Start listening for attendance changes
        startListeningToAttendance()
        
        Log.i(TAG, "AttendanceListenerService started")
    }
    
    private fun startListeningToAttendance() {
        // Check if user is logged in
        val currentUser = FirebaseAuth.getInstance().currentUser
        if (currentUser == null) {
            Log.e(TAG, "User not logged in")
            return
        }
        
        val userId = currentUser.uid
        Log.i(TAG, "Checking user role for: $userId")
        
        // Check if user is owner
        db.collection("users").document(userId).get()
            .addOnSuccessListener { document ->
                val role = document.getString("role")
                Log.i(TAG, "User role: $role")
                
                if (role != "owner") {
                    Log.i(TAG, "User is not owner, notifications disabled")
                    return@addOnSuccessListener
                }
                
                Log.i(TAG, "User is owner, starting real-time listener")
                
                // Listen to attendance collection for today's records
                val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                
                attendanceListener = db.collection("attendance")
                    .whereEqualTo("date", today)
                    .addSnapshotListener { snapshots, error ->
                        if (error != null) {
                            Log.e(TAG, "Listen failed: ${error.message}", error)
                            return@addSnapshotListener
                        }
                        
                        Log.i(TAG, "Attendance snapshot received, documents: ${snapshots?.size() ?: 0}")
                        
                        if (snapshots != null && !snapshots.isEmpty) {
                            for (document in snapshots.documents) {
                                val attendanceId = document.id
                                
                                // Skip if we've already processed this attendance record
                                if (processedAttendanceIds.contains(attendanceId)) {
                                    continue
                                }
                                
                                // Mark as processed
                                processedAttendanceIds.add(attendanceId)
                                
                                // Get attendance data
                                val userName = document.getString("userName") ?: continue
                                val status = document.getString("status") ?: continue
                                
                                Log.i(TAG, "Processing attendance: $userName, status: $status")
                                
                                // Format times
                                val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
                                
                                when (status) {
                                    "checked-in" -> {
                                        // Show check-in notification
                                        val checkInTime = document.getTimestamp("checkInTime")?.toDate()
                                        if (checkInTime != null) {
                                            val timeStr = timeFormat.format(checkInTime)
                                            
                                            NotificationHelper.showCheckInNotification(
                                                this,
                                                userName,
                                                timeStr
                                            )
                                            
                                            Log.i(TAG, "Check-in notification shown for $userName at $timeStr")
                                        }
                                    }
                                    "checked-out" -> {
                                        // Show check-out notification
                                        val checkOutTime = document.getTimestamp("checkOutTime")?.toDate()
                                        if (checkOutTime != null) {
                                            val timeStr = timeFormat.format(checkOutTime)
                                            val workHours = document.getDouble("workHours") ?: 0.0
                                            val workHoursStr = formatWorkHours(workHours)
                                            
                                            NotificationHelper.showCheckOutNotification(
                                                this,
                                                userName,
                                                timeStr,
                                                workHoursStr
                                            )
                                            
                                            Log.i(TAG, "Check-out notification shown for $userName at $timeStr (Worked: $workHoursStr)")
                                        }
                                    }
                                }
                            }
                        }
                    }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Failed to check user role: ${e.message}", e)
            }
    }
    
    private fun formatWorkHours(hours: Double): String {
        val totalMinutes = (hours * 60).toInt()
        val hrs = totalMinutes / 60
        val mins = totalMinutes % 60
        return "${hrs}h ${mins}m"
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY // Restart service if killed
    }
    
    override fun onDestroy() {
        super.onDestroy()
        attendanceListener?.remove()
        Log.i(TAG, "AttendanceListenerService stopped")
    }
    
    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}
