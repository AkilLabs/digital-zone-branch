package com.recallmobiles.pos

import java.text.NumberFormat
import java.util.*

/**
 * Data class to hold today's financial report metrics
 */
data class TodayReport(
    val revenue: Double = 0.0,
    val profit: Double = 0.0,
    val expense: Double = 0.0,
    val netProfit: Double = 0.0
) {
    /**
     * Format currency value in Indian Rupee format
     */
    fun formatCurrency(amount: Double): String {
        val format = NumberFormat.getCurrencyInstance(Locale("en", "IN"))
        format.maximumFractionDigits = 0
        return format.format(amount)
    }
    
    /**
     * Get formatted revenue string
     */
    fun getFormattedRevenue(): String = formatCurrency(revenue)
    
    /**
     * Get formatted profit string
     */
    fun getFormattedProfit(): String = formatCurrency(profit)
    
    /**
     * Get formatted expense string
     */
    fun getFormattedExpense(): String = formatCurrency(expense)
    
    /**
     * Get formatted net profit string
     */
    fun getFormattedNetProfit(): String = formatCurrency(netProfit)
}
