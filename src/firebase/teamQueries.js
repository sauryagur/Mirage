import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Subscribe to real-time team data updates
 * @param {string} teamId - Team document ID
 * @param {Function} callback - Called with updated team data
 * @returns {Function} Unsubscribe function
 */
export function subscribeToTeam(teamId, callback) {
  const teamRef = doc(db, 'teams', teamId);

  return onSnapshot(
    teamRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback({ id: snapshot.id, ...snapshot.data() });
      } else {
        callback(null);
      }
    },
    (error) => {
      console.error('Error subscribing to team:', error);
      callback(null);
    }
  );
}

/**
 * Get team data once (no real-time updates)
 * @param {string} teamId - Team document ID
 * @returns {Promise<Object|null>} Team data or null
 */
export async function getTeam(teamId) {
  try {
    const teamRef = doc(db, 'teams', teamId);
    const snapshot = await getDoc(teamRef);

    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() };
    }

    return null;
  } catch (error) {
    console.error('Error fetching team:', error);
    throw error;
  }
}

/**
 * Update team's GPS location (optional, for Control Room tracking)
 * @param {string} teamId - Team document ID
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} accuracy - GPS accuracy in meters
 * @returns {Promise<void>}
 */
export async function updateTeamLocation(teamId, lat, lng, accuracy) {
  try {
    const teamRef = doc(db, 'teams', teamId);
    await updateDoc(teamRef, {
      lastGpsUpdate: {
        lat,
        lng,
        accuracy,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating team location:', error);
    // Don't throw - GPS updates are optional
  }
}
