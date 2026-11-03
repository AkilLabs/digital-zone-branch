package com.recallmobiles.pos

import android.content.Context
import android.content.Intent
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * JavaScript interface for widget configuration
 * Allows the web app to configure the widget with shop ID
 */
class WidgetConfigInterface(private val context: Context) {
    
    companion object {
        private const val TAG = "WidgetConfigInterface"
    }
    
    /**
     * Called from JavaScript to configure the widget with shop ID
     * Usage from web: window.Android?.configureWidget(shopId)
     */
    @JavascriptInterface
    fun configureWidget(shopId: String) {
        Log.d(TAG, "Configuring widget with shop ID: $shopId")
        
        // Save shop ID to SharedPreferences
        val prefs = context.getSharedPreferences("MaxMobilesWidget", Context.MODE_PRIVATE)
        prefs.edit().putString("shopId", shopId).apply()
        
        // Trigger widget refresh
        val intent = Intent(context, TodayReportWidget::class.java).apply {
            action = TodayReportWidget.ACTION_REFRESH_WIDGET
        }
        context.sendBroadcast(intent)
        
        Log.d(TAG, "Widget configured and refresh triggered")
    }
    
    /**
     * Check if widget is configured
     * Returns true if shop ID is saved
     */
    @JavascriptInterface
    fun isWidgetConfigured(): Boolean {
        val prefs = context.getSharedPreferences("MaxMobilesWidget", Context.MODE_PRIVATE)
        val shopId = prefs.getString("shopId", null)
        return shopId != null
    }
    
    /**
     * Get the current widget shop ID
     */
    @JavascriptInterface
    fun getWidgetShopId(): String? {
        val prefs = context.getSharedPreferences("MaxMobilesWidget", Context.MODE_PRIVATE)
        return prefs.getString("shopId", null)
    }
}
