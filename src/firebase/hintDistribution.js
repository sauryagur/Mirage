import {
  doc,
  updateDoc,
  getDocs,
  query,
  collection,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Assign a new hint to a team
 * Selects from least discovered treasures that the team hasn't solved yet
 * @param {string} teamId - Team document ID
 * @param {Array<string>} solvedTreasureIds - Array of already solved treasure IDs
 * @returns {Promise<Object|null>} Selected treasure or null if all solved
 */
export async function assignNextHint(teamId, solvedTreasureIds = []) {
  try {
    // Query treasures ordered by discoveryCount (least discovered first)
    const q = query(
      collection(db, 'treasures'),
      where('isActive', '==', true),
      orderBy('discoveryCount', 'asc'),
      limit(20) // Get top 20 least discovered
    );

    const snapshot = await getDocs(q);
    const unsolvedTreasures = [];

    // Filter out treasures already solved by this team
    snapshot.forEach((doc) => {
      if (!solvedTreasureIds.includes(doc.id)) {
        unsolvedTreasures.push({ id: doc.id, ...doc.data() });
      }
    });

    // No unsolved treasures left
    if (unsolvedTreasures.length === 0) {
      console.log('All treasures solved by team:', teamId);
      return null;
    }

    // Get the minimum discovery count
    const minCount = unsolvedTreasures[0].discoveryCount;

    // Filter treasures with the minimum discovery count
    const leastDiscovered = unsolvedTreasures.filter(
      (t) => t.discoveryCount === minCount
    );

    // Randomly select from the least discovered treasures
    const selectedTreasure =
      leastDiscovered[Math.floor(Math.random() * leastDiscovered.length)];

    // Update team's currentHint
    const teamRef = doc(db, 'teams', teamId);
    await updateDoc(teamRef, {
      currentHint: {
        treasureId: selectedTreasure.id,
        hintText: selectedTreasure.hint,
        assignedAt: new Date().toISOString(),
      },
    });

    return selectedTreasure;
  } catch (error) {
    console.error('Error assigning next hint:', error);
    throw error;
  }
}

/**
 * Assign initial hint to a team (called on first login or game start)
 * @param {string} teamId - Team document ID
 * @returns {Promise<Object|null>} Selected treasure or null if none available
 */
export async function assignInitialHint(teamId) {
  return assignNextHint(teamId, []);
}

/**
 * Clear a team's current hint (useful for debugging or manual intervention)
 * @param {string} teamId - Team document ID
 * @returns {Promise<void>}
 */
export async function clearCurrentHint(teamId) {
  try {
    const teamRef = doc(db, 'teams', teamId);
    await updateDoc(teamRef, {
      currentHint: null,
    });
  } catch (error) {
    console.error('Error clearing hint:', error);
    throw error;
  }
}

/**
 * Get hint distribution statistics (for debugging)
 * Shows how many teams have each treasure as their current hint
 * @returns {Promise<Object>} Map of treasureId to count
 */
export async function getHintDistributionStats() {
  try {
    const q = query(
      collection(db, 'teams'),
      where('isActive', '==', true)
    );

    const snapshot = await getDocs(q);
    const distribution = {};

    snapshot.forEach((doc) => {
      const team = doc.data();
      if (team.currentHint?.treasureId) {
        const treasureId = team.currentHint.treasureId;
        distribution[treasureId] = (distribution[treasureId] || 0) + 1;
      }
    });

    return distribution;
  } catch (error) {
    console.error('Error getting hint distribution stats:', error);
    throw error;
  }
}
