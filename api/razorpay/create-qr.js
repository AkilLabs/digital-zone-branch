const { getRazorpayInstance } = require('./config.js');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('🔵 Create QR endpoint called');

        const { amount, description, customerId, customerName } = req.body;

        // Validate required fields
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            console.log('❌ Invalid amount:', amount);
            return res.status(400).json({ error: 'Valid amount is required' });
        }

        console.log('✅ Amount validated:', amount);

        // Get Razorpay instance
        console.log('🔧 Initializing Razorpay...');
        const razorpay = getRazorpayInstance();
        console.log('✅ Razorpay initialized');

        // Create QR code
        console.log('🔄 Creating QR code for ₹', amount);
        const qrCode = await razorpay.qrCode.create({
            type: 'upi_qr',
            name: customerName || 'Customer',
            usage: 'single_use',
            fixed_amount: true,
            payment_amount: amount * 100,
            description: description || `Payment of ₹${amount}`,
            customer_id: customerId,
            close_by: Math.floor(Date.now() / 1000) + 300,
            notes: {
                created_at: new Date().toISOString(),
                amount_inr: amount
            }
        });

        console.log('✅ QR code created successfully:', qrCode.id);

        return res.status(200).json({
            success: true,
            qrCodeId: qrCode.id,
            qrCodeUrl: qrCode.image_url,
            amount: amount,
            expiresAt: new Date(Date.now() + 300000)
        });

    } catch (error) {
        console.error('❌ ERROR in create-qr:', error);
        console.error('Error message:', error.message);

        return res.status(500).json({
            error: 'Failed to create QR code',
            message: error.message || 'Unknown error',
            details: error.description || error.error?.description || null
        });
    }
};
