/**
 * Converts Firebase Authentication error codes to user-friendly messages
 * @param error - The error object from Firebase Authentication
 * @returns User-friendly error message
 */
export const getAuthErrorMessage = (error: any): string => {
    const errorCode = error?.code || '';

    switch (errorCode) {
        case 'auth/invalid-credential':
            return 'Invalid email or password. Please check your credentials and try again.';

        case 'auth/user-not-found':
            return 'No account found with this email address.';

        case 'auth/wrong-password':
            return 'Incorrect password. Please try again.';

        case 'auth/invalid-email':
            return 'Invalid email address format.';

        case 'auth/user-disabled':
            return 'This account has been disabled. Please contact support.';

        case 'auth/too-many-requests':
            return 'Too many failed login attempts. Please try again later or reset your password.';

        case 'auth/network-request-failed':
            return 'Network error. Please check your internet connection and try again.';

        case 'auth/email-already-in-use':
            return 'This email is already registered.';

        case 'auth/weak-password':
            return 'Password is too weak. Please use a stronger password.';

        case 'auth/operation-not-allowed':
            return 'Email/password sign-in is not enabled. Please contact support.';

        case 'auth/account-exists-with-different-credential':
            return 'An account already exists with the same email but different sign-in credentials.';

        case 'auth/requires-recent-login':
            return 'This operation requires recent authentication. Please log in again.';

        case 'auth/expired-action-code':
            return 'This action code has expired. Please request a new one.';

        case 'auth/invalid-action-code':
            return 'This action code is invalid. Please request a new one.';

        default:
            // For any unknown errors, provide a generic message
            if (error?.message) {
                // Clean up Firebase prefix if present
                return error.message.replace('Firebase: ', '').replace(/\(auth\/[\w-]+\)\.?/g, '').trim();
            }
            return 'An error occurred during authentication. Please try again.';
    }
};
