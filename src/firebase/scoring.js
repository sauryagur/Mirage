import {
  doc,
  updateDoc,
  increment,
  arrayUnion,
  runTransaction,
  getDocs,
  query,
  collection,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Discovery Bonus Table
 * Rank 1: 100 points
 * Rank 2: 75 points
 * Rank 3: 50 points
 * Rank 4: 25 points
 * Rank 5+: 0 points
 */
const DISCOVERY_BONUS = {
  1: 100,
  2: 75,
  3: 50,
  4: 25,
};

const WRONG_ANSWER_PENALTY = -10;

/**
 * Handle a correct answer submission
 * Updates both treasure and team documents in a transaction
 * @param {string} teamId - Team document ID
 * @param {string} treasureId - Treasure document ID
 * @returns {Promise<Object>} Result with rank and points earned
 */
export async function handleCorrectAnswer(teamId, treasureId) {
  const treasureRef = doc(db, 'treasures', treasureId);
  const teamRef = doc(db, 'teams', teamId);

  try {
    const result = await runTransaction(db, async (transaction) => {
      const treasureDoc = await transaction.get(treasureRef);
      const teamDoc = await transaction.get(teamRef);

      if (!treasureDoc.exists()) {
        throw new Error('Treasure not found');
      }

      if (!teamDoc.exists()) {
        throw new Error('Team not found');
      }

      const treasure = treasureDoc.data();
      const team = teamDoc.data();

      // Check if team already solved this treasure
      const alreadySolved = team.solvedTreasures?.some(
        (t) => t.treasureId === treasureId
      );

      if (alreadySolved) {
        throw new Error('Treasure already solved by this team');
      }

      // Calculate rank (next solver)
      const currentRank = treasure.discoveryCount + 1;

      // Calculate points earned
      const pointsEarned = DISCOVERY_BONUS[currentRank] || 0;

      const timestamp = new Date().toISOString();

      // Update treasure document
      transaction.update(treasureRef, {
        discoveryCount: increment(1),
        discoveryTeams: arrayUnion({
          teamId: teamId,
          timestamp: timestamp,
          rank: currentRank,
        }),
      });

      // Update team document
      transaction.update(teamRef, {
        totalScore: increment(pointsEarned),
        solvedTreasures: arrayUnion({
          treasureId: treasureId,
          rank: currentRank,
          pointsEarned: pointsEarned,
          timestamp: timestamp,
        }),
        // Clear current hint after solving
        currentHint: null,
      });

      return {
        rank: currentRank,
        pointsEarned: pointsEarned,
        timestamp: timestamp,
      };
    });

    return result;
  } catch (error) {
    console.error('Error handling correct answer:', error);
    throw error;
  }
}

/**
 * Handle a wrong answer submission
 * Deducts 10 points from team's total score
 * @param {string} teamId - Team document ID
 * @returns {Promise<void>}
 */
export async function handleWrongAnswer(teamId) {
  const teamRef = doc(db, 'teams', teamId);

  try {
    await updateDoc(teamRef, {
      totalScore: increment(WRONG_ANSWER_PENALTY),
      wrongAnswerCount: increment(1),
    });
  } catch (error) {
    console.error('Error handling wrong answer:', error);
    throw error;
  }
}

/**
 * Get the current leaderboard
 * @param {number} limitCount - Number of top teams to fetch
 * @returns {Promise<Array>} Array of teams ordered by score
 */
export async function getLeaderboard(limitCount = 10) {
  try {
    const q = query(
      collection(db, 'teams'),
      where('isActive', '==', true),
      orderBy('totalScore', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    const leaderboard = [];

    snapshot.forEach((doc, index) => {
      leaderboard.push({
        id: doc.id,
        rank: index + 1,
        ...doc.data(),
      });
    });

    return leaderboard;
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    throw error;
  }
}

/**
 * Subscribe to real-time leaderboard updates
 * @param {number} limitCount - Number of top teams to watch
 * @param {Function} callback - Called with updated leaderboard array
 * @returns {Function} Unsubscribe function
 */
export function subscribeToLeaderboard(limitCount = 10, callback) {
  const q = query(
    collection(db, 'teams'),
    where('isActive', '==', true),
    orderBy('totalScore', 'desc'),
    limit(limitCount)
  );

  return onSnapshot(q, (snapshot) => {
    const leaderboard = [];
    snapshot.forEach((doc, index) => {
      leaderboard.push({
        id: doc.id,
        rank: index + 1,
        ...doc.data(),
      });
    });
    callback(leaderboard);
  });
}
