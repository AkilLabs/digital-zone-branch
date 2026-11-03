package com.recallmobiles.pos

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import androidx.work.*
import com.google.firebase.firestore.FirebaseFirestore
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

/**
 * Widget provider for today's sales report
 * Displays revenue, profit, expense, and net profit
 */
class TodayReportWidget : AppWidgetProvider() {

    companion object {
        private const val TAG = "TodayReportWidget"
        const val ACTION_REFRESH_WIDGET = "com.recallmobiles.pos.ACTION_REFRESH_WIDGET"
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        Log.d(TAG, "onUpdate called for ${appWidgetIds.size} widgets")
        
        // Update all widget instances
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
        
        // Schedule periodic updates using WorkManager
        scheduleWidgetUpdate(context)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        Log.d(TAG, "Widget enabled - scheduling updates")
        scheduleWidgetUpdate(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        Log.d(TAG, "Widget disabled - canceling updates")
        WorkManager.getInstance(context).cancelUniqueWork("WidgetUpdate")
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        
        if (intent.action == ACTION_REFRESH_WIDGET) {
            Log.d(TAG, "Manual refresh triggered")
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(
                ComponentName(context, TodayReportWidget::class.java)
            )
            onUpdate(context, appWidgetManager, appWidgetIds)
        }
    }

    /**
     * Schedule periodic widget updates using WorkManager
     */
    private fun scheduleWidgetUpdate(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val updateRequest = PeriodicWorkRequestBuilder<WidgetUpdateWorker>(
            30, TimeUnit.MINUTES,
            5, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "WidgetUpdate",
            ExistingPeriodicWorkPolicy.KEEP,
            updateRequest
        )
        
        Log.d(TAG, "Scheduled periodic widget updates every 30 minutes")
    }

    /**
     * Update widget UI with latest data
     */
    private fun updateAppWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        try {
            val views = RemoteViews(context.packageName, R.layout.widget_today_report)

            // Set up click intent to open main app
            try {
                val intent = Intent(context, MainActivity::class.java)
                val pendingIntent = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.revenue_card, pendingIntent)
                views.setOnClickPendingIntent(R.id.profit_card, pendingIntent)
                views.setOnClickPendingIntent(R.id.expense_card, pendingIntent)
                views.setOnClickPendingIntent(R.id.net_profit_card, pendingIntent)
            } catch (e: Exception) {
                Log.e(TAG, "Error setting up click listeners", e)
            }

            // Set up refresh button
            try {
                val refreshIntent = Intent(context, TodayReportWidget::class.java).apply {
                    action = ACTION_REFRESH_WIDGET
                }
                val refreshPendingIntent = PendingIntent.getBroadcast(
                    context, 0, refreshIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.refresh_button, refreshPendingIntent)
            } catch (e: Exception) {
                Log.e(TAG, "Error setting up refresh button", e)
            }

            // Check if widget is configured
            val prefs = context.getSharedPreferences("MaxMobilesWidget", Context.MODE_PRIVATE)
            val shopId = prefs.getString("shopId", null)
            
            if (shopId == null) {
                // Not configured - show helpful message
                try {
                    views.setTextViewText(R.id.last_updated, "Tap to setup")
                    views.setTextViewText(R.id.revenue_amount, "₹0")
                    views.setTextViewText(R.id.profit_amount, "₹0")
                    views.setTextViewText(R.id.expense_amount, "₹0")
                    views.setTextViewText(R.id.net_profit_amount, "₹0")
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                    Log.w(TAG, "Widget not configured - user needs to open app and login")
                } catch (e: Exception) {
                    Log.e(TAG, "Error updating widget with not configured state", e)
                }
                return
            }
            
            // Show loading state first
            try {
                views.setTextViewText(R.id.last_updated, "Loading...")
                views.setTextViewText(R.id.revenue_amount, "₹0")
                views.setTextViewText(R.id.profit_amount, "₹0")
                views.setTextViewText(R.id.expense_amount, "₹0")
                views.setTextViewText(R.id.net_profit_amount, "₹0")
                appWidgetManager.updateAppWidget(appWidgetId, views)
            } catch (e: Exception) {
                Log.e(TAG, "Error showing loading state", e)
            }
            
            // Fetch and update data
            fetchTodayReport(context) { report ->
                try {
                    views.setTextViewText(R.id.revenue_amount, report.getFormattedRevenue())
                    views.setTextViewText(R.id.profit_amount, report.getFormattedProfit())
                    views.setTextViewText(R.id.expense_amount, report.getFormattedExpense())
                    views.setTextViewText(R.id.net_profit_amount, report.getFormattedNetProfit())
                    
                    // Update last updated time
                    val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
                    val currentTime = timeFormat.format(Date())
                    views.setTextViewText(R.id.last_updated, currentTime)

                    // Update the widget
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                    Log.d(TAG, "Widget $appWidgetId updated successfully - Revenue: ${report.revenue}, Profit: ${report.profit}")
                } catch (e: Exception) {
                    Log.e(TAG, "Error updating widget with data", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Critical error in updateAppWidget", e)
            // Try to show a basic error state
            try {
                val views = RemoteViews(context.packageName, R.layout.widget_today_report)
                views.setTextViewText(R.id.last_updated, "Error")
                views.setTextViewText(R.id.revenue_amount, "₹0")
                views.setTextViewText(R.id.profit_amount, "₹0")
                views.setTextViewText(R.id.expense_amount, "₹0")
                views.setTextViewText(R.id.net_profit_amount, "₹0")
                appWidgetManager.updateAppWidget(appWidgetId, views)
            } catch (fallbackError: Exception) {
                Log.e(TAG, "Even fallback failed", fallbackError)
            }
        }
    }

    /**
     * Fetch today's report data from Firebase
     */
    private fun fetchTodayReport(context: Context, onComplete: (TodayReport) -> Unit) {
        // Get shop ID from SharedPreferences
        val prefs = context.getSharedPreferences("MaxMobilesWidget", Context.MODE_PRIVATE)
        val shopId = prefs.getString("shopId", null)
        
        if (shopId == null) {
            Log.w(TAG, "Shop ID not configured, showing placeholder. Please open the main app first.")
            // Show a message in the widget that it needs to be configured
            onComplete(TodayReport())
            return
        }

        val db = FirebaseFirestore.getInstance()
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        
        // Parse today's date range
        val calendar = Calendar.getInstance()
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        val startOfDay = calendar.time

        calendar.set(Calendar.HOUR_OF_DAY, 23)
        calendar.set(Calendar.MINUTE, 59)
        calendar.set(Calendar.SECOND, 59)
        calendar.set(Calendar.MILLISECOND, 999)
        val endOfDay = calendar.time

        Log.d(TAG, "Fetching billing items for shop: $shopId, date: $today")

        db.collection("billingItems")
            .whereEqualTo("shopId", shopId)
            .whereGreaterThanOrEqualTo("createdAt", startOfDay)
            .whereLessThanOrEqualTo("createdAt", endOfDay)
            .get()
            .addOnSuccessListener { documents ->
                Log.d(TAG, "Fetched ${documents.size()} billing items")
                
                var revenue = 0.0
                var profit = 0.0
                var expense = 0.0

                for (document in documents) {
                    val data = document.data
                    val sellingPrice = (data["sellingPrice"] as? Number)?.toDouble() ?: 0.0
                    val quantity = (data["quantity"] as? Number)?.toInt() ?: 1
                    val totalProfit = (data["totalProfit"] as? Number)?.toDouble() ?: 0.0
                    val cost = (data["cost"] as? Number)?.toDouble() ?: 0.0
                    val type = data["type"] as? String

                    // Calculate revenue (total selling price)
                    revenue += sellingPrice * quantity

                    // Calculate profit and expense
                    if (totalProfit < 0 || type == "expense") {
                        // This is an expense
                        expense += Math.abs(totalProfit)
                    } else {
                        // This is profit
                        profit += totalProfit
                    }
                }

                val netProfit = profit - expense
                val report = TodayReport(revenue, profit, expense, netProfit)
                
                Log.d(TAG, "Calculated - Revenue: $revenue, Profit: $profit, Expense: $expense, Net: $netProfit")
                onComplete(report)
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Error fetching billing items", e)
                onComplete(TodayReport())
            }
    }
    
    /**
     * Save shop ID to SharedPreferences
     * This should be called from the main app when user logs in
     */
    fun saveShopId(context: Context, shopId: String) {
        val prefs = context.getSharedPreferences("MaxMobilesWidget", Context.MODE_PRIVATE)
        prefs.edit().putString("shopId", shopId).apply()
        Log.d(TAG, "Shop ID saved: $shopId")
        
        // Trigger widget update after saving shop ID
        val intent = Intent(context, TodayReportWidget::class.java).apply {
            action = ACTION_REFRESH_WIDGET
        }
        context.sendBroadcast(intent)
    }
}
