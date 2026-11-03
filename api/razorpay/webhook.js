const crypto = require('crypto');
const { getWebhookSecret } = require('./config.js');

/**
 * Verify Razorpay webhook signature
 */
function verifyWebhookSignature(body, signature, secret) {
    try {
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body)
            .digest('hex');

        return expectedSignature === signature;
    } catch (error) {
        console.error('Error verifying signature:', error);
        return false;
    }
}

module.exports = async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('📥 Webhook received');

        // Get signature from headers
        const signature = req.headers['x-razorpay-signature'];

        if (!signature) {
            console.error('❌ No signature found in webhook request');
            return res.status(400).json({ error: 'No signature provided' });
        }

        // Get webhook secret from environment
        const secret = getWebhookSecret();

        if (!secret) {
            console.error('❌ RAZORPAY_WEBHOOK_SECRET not configured');
            console.log('⚠️ Webhook signature validation skipped');
            console.log('Event data:', JSON.stringify(req.body, null, 2));

            return res.status(200).json({
                status: 'ok',
                message: 'Webhook received (validation skipped - configure RAZORPAY_WEBHOOK_SECRET)'
            });
        }

        // Verify signature
        const rawBody = JSON.stringify(req.body);
        const isValid = verifyWebhookSignature(rawBody, signature, secret);

        if (!isValid) {
            console.error('❌ Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        console.log('✅ Webhook signature verified');

        // Process the webhook event
        const event = req.body;
        const eventType = event.event;

        console.log('📝 Event type:', eventType);

        // Handle QR code payment
        if (eventType === 'qr_code.credited') {
            const payload = event.payload;
            const qrCode = payload?.qr_code?.entity;
            const payment = payload?.payment?.entity;

            if (qrCode && payment) {
                console.log('💰 QR Payment:', {
                    qrCodeId: qrCode.id,
                    paymentId: payment.id,
                    amount: payment.amount / 100
                });

                // Update Firestore document
                try {
                    // Import Firebase Admin dynamically
                    const admin = require('firebase-admin');

                    // Initialize Firebase Admin if not already initialized
                    if (!admin.apps.length) {
                        // Check if we have service account credentials
                        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

                        if (serviceAccount) {
                            admin.initializeApp({
                                credential: admin.credential.cert(JSON.parse(serviceAccount))
                            });
                        } else {
                            console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not configured, skipping Firestore update');
                            console.log('ℹ️ Payment verification will rely on frontend polling');
                        }
                    }

                    if (admin.apps.length > 0) {
                        const db = admin.firestore();

                        // Find the QR code document by razorpayQrId
                        const qrCodesRef = db.collection('razorpayQRCodes');
                        const snapshot = await qrCodesRef
                            .where('razorpayQrId', '==', qrCode.id)
                            .limit(1)
                            .get();

                        if (!snapshot.empty) {
                            const docRef = snapshot.docs[0].ref;
                            await docRef.update({
                                paymentVerified: true,
                                razorpayPaymentId: payment.id,
                                verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
                                status: 'completed'
                            });
                            console.log('✅ Firestore document updated with payment verification');
                        } else {
                            console.warn('⚠️ No Firestore document found for QR code:', qrCode.id);
                        }
                    }
                } catch (error) {
                    console.error('❌ Error updating Firestore:', error);
                    console.log('ℹ️ Payment verification will rely on frontend polling');
                }
            }
        } else if (eventType === 'payment.captured' || eventType === 'payment.authorized') {
            const payment = event.payload?.payment?.entity;

            if (payment) {
                console.log('💰 Payment:', {
                    paymentId: payment.id,
                    amount: payment.amount / 100,
                    method: payment.method
                });
            }
        }

        return res.status(200).json({
            status: 'ok',
            message: 'Webhook processed successfully',
            eventType: eventType
        });

    } catch (error) {
        console.error('❌ Webhook error:', error);

        return res.status(500).json({
            error: 'Webhook processing failed',
            message: error.message
        });
    }
};
