/**
 * Returns the straight-line distance in kilometres between two GPS points.
 * Uses the Haversine formula. Earth radius = 6371 km.
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Sums Haversine distances across an ordered list of waypoints.
 * Used on Punch Out to calculate the rep's total daily distance.
 *
 * Waypoint order: [punchIn, ...storeVisitCheckIns sorted by time, punchOut]
 */
export function totalRouteKm(
  waypoints: Array<{ latitude: number; longitude: number }>
): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineKm(
      waypoints[i - 1].latitude,
      waypoints[i - 1].longitude,
      waypoints[i].latitude,
      waypoints[i].longitude
    );
  }
  return Math.round(total * 100) / 100;
}
