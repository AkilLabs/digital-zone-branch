const Razorpay = require('razorpay');

// Initialize Razorpay instance
exports.getRazorpayInstance = () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel environment variables.');
    }

    return new Razorpay({
        key_id: keyId,
        key_secret: keySecret
    });
};

// Get webhook secret (optional - for signature verification)
exports.getWebhookSecret = () => {
    return process.env.RAZORPAY_WEBHOOK_SECRET;
};
