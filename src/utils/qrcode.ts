import QRCode from 'qrcode';

interface UPIQRCodeParams {
    upiId: string;
    merchantName: string;
    amount: number;
    transactionNote?: string;
}

/**
 * Generates a UPI payment QR code
 * @param params UPI payment parameters
 * @returns Promise<string> Base64 encoded QR code image
 */
export const generateUPIQRCode = async (params: UPIQRCodeParams): Promise<string> => {
    const { upiId, merchantName, amount, transactionNote = 'Payment' } = params;

    // UPI payment URL format
    // upi://pay?pa=<UPI_ID>&pn=<MERCHANT_NAME>&am=<AMOUNT>&tn=<TRANSACTION_NOTE>&cu=INR
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${amount}&tn=${encodeURIComponent(transactionNote)}&cu=INR`;

    try {
        // Generate QR code as base64 image
        const qrCodeDataUrl = await QRCode.toDataURL(upiUrl, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            width: 400,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        return qrCodeDataUrl;
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw new Error('Failed to generate QR code');
    }
};

/**
 * Validates UPI ID format
 * @param upiId UPI ID to validate
 * @returns boolean
 */
export const validateUPIId = (upiId: string): boolean => {
    // UPI ID format: username@bankname
    const upiRegex = /^[\w.-]+@[\w.-]+$/;
    return upiRegex.test(upiId);
};
