import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Debug endpoint to check environment variables and basic function status
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        const envStatus = {
            RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ? '✅ Set' : '❌ Not Set',
            RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ? '✅ Set' : '❌ Not Set',
            RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ? '✅ Set' : '❌ Not Set',
            NODE_VERSION: process.version,
            VERCEL_ENV: process.env.VERCEL_ENV || 'unknown'
        };

        return res.status(200).json({
            status: 'API is working! ✅',
            timestamp: new Date().toISOString(),
            environment: envStatus,
            message: 'If you see this, the API endpoint is functioning correctly'
        });
    } catch (error: any) {
        return res.status(500).json({
            error: 'Debug endpoint failed',
            message: error.message
        });
    }
}
