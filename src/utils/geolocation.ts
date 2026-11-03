/**
 * Calculate the distance between two geographic coordinates using the Haversine formula
 * @param lat1 Latitude of first point
 * @param lon1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lon2 Longitude of second point
 * @returns Distance in meters
 */
export function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

/**
 * Get the current position using the browser's Geolocation API
 * @returns Promise with coordinates or null if permission denied/error
 */
export function getCurrentPosition(): Promise<{
    latitude: number;
    longitude: number;
} | null> {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.error('Geolocation is not supported by this browser');
            resolve(null);
            return;
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 20000, // Increased to 20 seconds
            maximumAge: 0,
        };

        // First try with high accuracy
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                });
            },
            (error) => {
                console.warn('High accuracy geolocation failed, trying low accuracy:', error);

                // Fallback to low accuracy
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        resolve({
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                        });
                    },
                    (error) => {
                        console.error('Error getting location (fallback):', error);
                        resolve(null);
                    },
                    {
                        enableHighAccuracy: false,
                        timeout: 30000,
                        maximumAge: 0,
                    }
                );
            },
            options
        );
    });
}

/**
 * Check if a given location is within a specified radius of a target location
 * @param userLat User's latitude
 * @param userLon User's longitude
 * @param targetLat Target latitude (shop location)
 * @param targetLon Target longitude (shop location)
 * @param radius Radius in meters (default: 500)
 * @returns Object with isWithin boolean and actual distance
 */
export function isWithinRadius(
    userLat: number,
    userLon: number,
    targetLat: number,
    targetLon: number,
    radius: number = 500
): { isWithin: boolean; distance: number } {
    const distance = calculateDistance(userLat, userLon, targetLat, targetLon);
    return {
        isWithin: distance <= radius,
        distance: Math.round(distance),
    };
}

/**
 * Format distance for display
 * @param meters Distance in meters
 * @returns Formatted string (e.g., "250m" or "1.2km")
 */
export function formatDistance(meters: number): string {
    if (meters < 1000) {
        return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
}
