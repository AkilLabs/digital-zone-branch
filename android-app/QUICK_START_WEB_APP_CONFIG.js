// ============================================
// QUICK START: Add this to your web app
// ============================================

// 1. ADD TO: src/vite-env.d.ts or src/types/android.d.ts
// --------------------------------------------
interface Window {
    WidgetInterface?: {
        configureWidget(shopId: string): void;
        isWidgetConfigured(): boolean;
        getWidgetShopId(): string | null;
    };
}


// 2. ADD TO: src/contexts/AuthContext.tsx (or wherever you handle auth)
// --------------------------------------------
import { useEffect } from 'react';

// Inside your AuthContext component, after you fetch shop details:
useEffect(() => {
    // When user logs in and shop details are loaded
    if (user && shopDetails?.shopId) {
        // Configure Android widget with shop ID
        if (window.WidgetInterface) {
            try {
                console.log('[Widget] Configuring with shop ID:', shopDetails.shopId);
                window.WidgetInterface.configureWidget(shopDetails.shopId);
                console.log('[Widget] ✅ Configured successfully');
            } catch (error) {
                console.error('[Widget] ❌ Configuration failed:', error);
            }
        } else {
            // Running in browser, not Android app
            console.log('[Widget] Not running in Android app');
        }
    }
}, [user, shopDetails]);


// 3. VERIFY YOUR FIREBASE DATA STRUCTURE
// --------------------------------------------
// Make sure your billingItems collection has this structure:
/*
{
  shopId: "your-shop-id",        // ← REQUIRED for widget to work
  createdAt: Timestamp,          // ← REQUIRED (Firebase Timestamp, not string)
  sellingPrice: 100,
  quantity: 1,
  totalProfit: 20,
  type: "sale" | "expense",      // Optional
  // ... other fields
}
*/

// 4. TEST IN BROWSER CONSOLE
// --------------------------------------------
// After logging in, check console for:
// ✅ "[Widget] Configuring with shop ID: xyz123"
// ✅ "[Widget] ✅ Configured successfully"
//
// To manually test (in Android app):
// window.WidgetInterface?.configureWidget("your-shop-id")


// ============================================
// DEPLOYMENT CHECKLIST
// ============================================
/*
□ Add TypeScript declarations (step 1)
□ Add useEffect hook to AuthContext (step 2)
□ Verify Firebase has shopId on all billing items
□ Deploy web app
□ Rebuild Android app
□ Install Android app on device
□ Open app and login (configures widget)
□ Add widget to home screen
□ Verify widget shows data
*/


// ============================================
// TROUBLESHOOTING
// ============================================
/*
WIDGET SHOWS ₹0 OR "LOADING...":
- Open browser console and check for "[Widget] ✅ Configured"
- If not shown, check if running in Android app
- Verify shopDetails.shopId exists
- Check Android logs: adb logcat | grep TodayReportWidget

WIDGET NOT UPDATING:
- Tap refresh icon on widget
- Remove and re-add widget
- Check if billing items have shopId field
- Verify createdAt is Firebase Timestamp (not string)

NO DATA IN WIDGET:
- Check if there are billing items for today
- Verify they have matching shopId
- Check Firebase console for data
- Look at Android logs for error messages
*/
