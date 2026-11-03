/**
 * Client-side Razorpay utilities for QR code generation and payment verification
 */

interface CreateQRCodeParams {
    amount: number;
    description?: string;
    customerId?: string;
    customerName?: string;
}

interface QRCodeResponse {
    success: boolean;
    qrCodeId: string;
    qrCodeUrl: string;
    firestoreId: string;
    amount: number;
    expiresAt: Date;
}

interface CreateOrderParams {
    amount: number;
    currency?: string;
    receipt?: string;
    notes?: Record<string, any>;
}

interface OrderResponse {
    success: boolean;
    orderId: string;
    amount: number;
    currency: string;
    receipt: string;
}

interface CheckoutOptions {
    amount: number;
    currency?: string;
    name: string;
    description?: string;
    customerName?: string;
    customerEmail?: string;
    customerContact?: string;
    notes?: Record<string, any>;
    onSuccess: (response: any) => void;
    onFailure: (error: any) => void;
}

/**
 * Create a Razorpay QR code
 */
export const createRazorpayQRCode = async (params: CreateQRCodeParams): Promise<QRCodeResponse> => {
    try {
        const response = await fetch('/api/razorpay/create-qr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create QR code');
        }

        const data = await response.json();

        // Import Firestore here to avoid circular dependencies
        const { db } = await import('../config/firebase');
        const { collection, addDoc } = await import('firebase/firestore');

        // Store QR code data in Firestore from frontend
        const firestoreDoc = await addDoc(collection(db, 'razorpayQRCodes'), {
            razorpayQrId: data.qrCodeId,
            amount: params.amount,
            description: params.description || `Payment of ₹${params.amount}`,
            status: 'active',
            paymentVerified: false,
            createdAt: new Date(),
            expiresAt: new Date(data.expiresAt),
            qrCodeUrl: data.qrCodeUrl,
            // Only include customer fields if they are defined
            ...(params.customerId ? { customerId: params.customerId } : {}),
            ...(params.customerName ? { customerName: params.customerName } : {})
        });

        return {
            ...data,
            firestoreId: firestoreDoc.id,
            expiresAt: new Date(data.expiresAt)
        };
    } catch (error: any) {
        console.error('Error creating Razorpay QR code:', error);
        throw error;
    }
};

/**
 * Create a Razorpay order for standard checkout
 */
export const createRazorpayOrder = async (params: CreateOrderParams): Promise<OrderResponse> => {
    try {
        const response = await fetch('/api/razorpay/create-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create order');
        }

        const data = await response.json();
        return data;
    } catch (error: any) {
        console.error('Error creating Razorpay order:', error);
        throw error;
    }
};

/**
 * Load Razorpay checkout script
 */
const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') {
            resolve(false);
            return;
        }

        // Check if script is already loaded
        if ((window as any).Razorpay) {
            resolve(true);
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
};

/**
 * Open Razorpay checkout for card/netbanking payments (without server-side order creation)
 * Using amount-based checkout for simpler integration
 */
export const openRazorpayCheckout = async (options: CheckoutOptions): Promise<void> => {
    try {
        // Load Razorpay script
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
            throw new Error('Failed to load Razorpay SDK');
        }

        // Get Razorpay key from environment
        const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;
        if (!RAZORPAY_KEY_ID) {
            throw new Error('Razorpay Key ID not configured. Please add VITE_RAZORPAY_KEY_ID to your .env.local file');
        }

        // Convert amount to paise (Razorpay expects amount in smallest currency unit)
        const amountInPaise = Math.round(options.amount * 100);

        // Configure Razorpay checkout options (amount-based, no order creation needed)
        const checkoutOptions = {
            key: RAZORPAY_KEY_ID,
            amount: amountInPaise,
            currency: options.currency || 'INR',
            name: options.name,
            description: options.description || `Payment of ₹${options.amount}`,
            image: '', // You can add your logo URL here
            prefill: {
                name: options.customerName || '',
                email: options.customerEmail || '',
                contact: options.customerContact || '',
            },
            notes: options.notes || {},
            theme: {
                color: '#2563eb', // Blue theme
            },
            modal: {
                ondismiss: () => {
                    options.onFailure({ error: 'Payment cancelled by user' });
                },
            },
            handler: (response: any) => {
                // Payment successful
                console.log('Payment successful:', response);
                options.onSuccess({
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_order_id: response.razorpay_order_id || null,
                    razorpay_signature: response.razorpay_signature || null,
                });
            },
        };

        // Open Razorpay checkout
        const razorpay = new (window as any).Razorpay(checkoutOptions);
        razorpay.on('payment.failed', (response: any) => {
            console.error('Payment failed:', response);
            options.onFailure({
                error: response.error.description || 'Payment failed',
                code: response.error.code,
                metadata: response.error.metadata,
            });
        });
        razorpay.open();
    } catch (error: any) {
        console.error('Error opening Razorpay checkout:', error);
        options.onFailure({ error: error.message || 'Failed to open payment gateway' });
    }
};


