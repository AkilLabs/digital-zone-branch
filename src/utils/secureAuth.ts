

/**
 * Determines the appropriate dashboard route based on the user's role and scope.
 * This centralizes the navigation logic to ensure consistency across the app.
 * 
 * @param role - The user's role (e.g., 'qr', 'employee', 'admin', 'owner', 'hub-admin', 'store-admin')
 * @param scope - The user's scope ('hub' or 'store')
 * @returns The path string to navigate to
 */
export const getRoleBasedDestination = (role: string, scope?: string): string => {
    switch (role) {
        case 'employee':
            return '/employee-dashboard';
        case 'owner':
        case 'hub-admin':
            // Hub-level users go to hub dashboard
            return scope === 'hub' ? '/hub-dashboard' : '/dashboard';
        case 'store-admin':
        case 'admin':
            return '/dashboard';
        default:
            return '/dashboard';
    }
};
