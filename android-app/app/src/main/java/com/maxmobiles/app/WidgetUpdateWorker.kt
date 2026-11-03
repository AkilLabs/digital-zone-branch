package com.recallmobiles.pos

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Background worker to update widgets periodically
 */
class WidgetUpdateWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : Worker(context, workerParams) {

    companion object {
        private const val TAG = "WidgetUpdateWorker"
    }

    override fun doWork(): Result {
        Log.d(TAG, "Starting widget update work")

        try {
            // Get all widget instances
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(
                ComponentName(context, TodayReportWidget::class.java)
            )

            if (appWidgetIds.isEmpty()) {
                Log.d(TAG, "No widgets to update")
                return Result.success()
            }

            Log.d(TAG, "Updating ${appWidgetIds.size} widget(s)")

            // Trigger widget update
            val widget = TodayReportWidget()
            widget.onUpdate(context, appWidgetManager, appWidgetIds)

            Log.d(TAG, "Widget update completed successfully")
            return Result.success()
            
        } catch (e: Exception) {
            Log.e(TAG, "Error updating widgets", e)
            return Result.retry()
        }
    }
}
