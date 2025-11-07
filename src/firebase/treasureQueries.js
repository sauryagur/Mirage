import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  getDocs,
  doc,
} from 'firebase/firestore';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';
import { db } from '../firebase';

/**
 * Subscribe to nearby treasures within a given radius using geohash queries
 * @param {number} userLat - User's latitude
 * @param {number} userLng - User's longitude
 * @param {number} radius - Search radius in meters
 * @param {Function} callback - Called with array of nearby treasures
 * @returns {Function} Unsubscribe function
 */
export function subscribeToNearbyTreasures(userLat, userLng, radius, callback) {
  // Calculate geohash bounds for the radius
  const center = [userLat, userLng];
  const radiusInKm = radius / 1000;
  const bounds = geohashQueryBounds(center, radiusInKm);

  // Create queries for each geohash bound
  const queries = bounds.map(([startHash, endHash]) => {
    return query(
      collection(db, 'treasures'),
      where('isActive', '==', true), // Only active treasures
      where('geohash', '>=', startHash),
      where('geohash', '<=', endHash)
    );
  });

  // Store unsubscribe functions
  const unsubscribes = [];
  const treasureMap = new Map();

  queries.forEach((q) => {
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const treasure = { id: change.doc.id, ...change.doc.data() };
        
        // Calculate actual distance
        const distance = distanceBetween(
          [userLat, userLng],
          [treasure.lat, treasure.lng]
        );
        const distanceInMeters = distance * 1000;

        if (change.type === 'added' || change.type === 'modified') {
          // Only include if within actual radius
          if (distanceInMeters <= radius) {
            treasureMap.set(treasure.id, {
              ...treasure,
              distance: distanceInMeters,
            });
          } else {
            treasureMap.delete(treasure.id);
          }
        } else if (change.type === 'removed') {
          treasureMap.delete(treasure.id);
        }
      });

      // Convert map to array and call callback
      callback(Array.from(treasureMap.values()));
    });

    unsubscribes.push(unsubscribe);
  });

  // Return combined unsubscribe function
  return () => {
    unsubscribes.forEach((unsub) => unsub());
  };
}

/**
 * Subscribe to a specific treasure by ID
 * @param {string} treasureId - Treasure document ID
 * @param {Function} callback - Called with treasure data
 * @returns {Function} Unsubscribe function
 */
export function subscribeToTreasure(treasureId, callback) {
  const treasureRef = doc(db, 'treasures', treasureId);
  
  return onSnapshot(treasureRef, (snapshot) => {
    if (snapshot.exists()) {
      callback({ id: snapshot.id, ...snapshot.data() });
    } else {
      callback(null);
    }
  });
}

/**
 * Get treasures ordered by discovery count (for hint distribution)
 * @param {number} limit - Maximum number of treasures to fetch
 * @returns {Promise<Array>} Array of least discovered treasures
 */
export async function getLeastDiscoveredTreasures(limit = 20) {
  const q = query(
    collection(db, 'treasures'),
    where('isActive', '==', true),
    orderBy('discoveryCount', 'asc'),
    limit(limit)
  );

  const snapshot = await getDocs(q);
  const treasures = [];
  
  snapshot.forEach((doc) => {
    treasures.push({ id: doc.id, ...doc.data() });
  });

  return treasures;
}
