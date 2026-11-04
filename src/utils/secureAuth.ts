/**
 * Determines the appropriate dashboard route based on the user's role and scope.
 * Employee check-in/check-out attendance has been removed (handled via separate APK).
 */
export const getRoleBasedDestination = (_role: string, _scope?: string): string => {
  return '/dashboard';
};
