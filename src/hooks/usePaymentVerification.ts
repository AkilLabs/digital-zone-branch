import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';

interface PaymentStatus {
    verified: boolean;
    paymentId?: string;
    verifiedAt?: Date;
    loading: boolean;
}

/**
 * Hook to monitor payment verification status for a QR code
 * Alternative to webhook - uses Firestore real-time listener
 */
export const usePaymentVerification = (firestoreQrId: string | null): PaymentStatus => {
    const [status, setStatus] = useState<PaymentStatus>({
        verified: false,
        loading: !!firestoreQrId
    });

    useEffect(() => {
        if (!firestoreQrId) {
            setStatus({ verified: false, loading: false });
            return;
        }

        // Listen to the QR code document for payment updates
        const unsubscribe = onSnapshot(
            doc(db, 'razorpayQRCodes', firestoreQrId),
            (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const data = docSnapshot.data();
                    setStatus({
                        verified: data.paymentVerified || false,
                        paymentId: data.razorpayPaymentId,
                        verifiedAt: data.verifiedAt?.toDate(),
                        loading: false
                    });
                } else {
                    setStatus({ verified: false, loading: false });
                }
            },
            (error) => {
                console.error('Error listening to payment status:', error);
                setStatus({ verified: false, loading: false });
            }
        );

        return () => unsubscribe();
    }, [firestoreQrId]);

    return status;
};
