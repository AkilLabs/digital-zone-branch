import Razorpay from 'razorpay';

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { amount, currency = 'INR', receipt, notes = {} } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        // Initialize Razorpay instance
        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        // Create Razorpay order
        const options = {
            amount: Math.round(amount * 100), // Amount in paise
            currency: currency,
            receipt: receipt || `receipt_${Date.now()}`,
            notes: notes,
        };

        const order = await razorpay.orders.create(options);

        return res.status(200).json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt,
        });
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create order',
        });
    }
}
