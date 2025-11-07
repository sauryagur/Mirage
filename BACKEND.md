# Mirage Backend Integration Notes

This document outlines the backend API contract for integrating the Mirage mobile app with the separately maintained backend service (Admin Portal + Control Room).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Firebase Firestore                      │
│  (Central Data Store - Real-time Sync)                      │
│  - treasures/{treasureId}                                   │
│  - teams/{teamId}                                           │
│  - gps_logs/{logId}                                         │
└──────────────┬─────────────────────────────┬────────────────┘
               │                             │
               │                             │
       ┌───────▼────────┐           ┌───────▼────────┐
       │  Mobile App    │           │  Backend Repo  │
       │  (This Repo)   │           │ (Separate)     │
       │                │           │                │
       │ - Player UI    │           │ - Admin Portal │
       │ - AR View      │           │ - Control Room │
       │ - Geolocation  │           │ - Analytics    │
       └────────────────┘           └────────────────┘
```

**Key Principle**: Both repos read/write to the same Firestore database. **No REST API between them.**

---

## Firebase Firestore Schema

### Collection: `/treasures/{treasureId}`

```javascript
{
  "treasureId": "treasure_001",
  "lat": 30.3517,
  "lng": 76.3598,
  "geohash": "ttnf6e5k",  // Precision 8
  "hint": "Where taste meets nostalgia. Look for the sign.",
  "question": "What's written above the doorway?",
  "correctAnswer": "Amul Parlour",
  "discoveryCount": 3,  // How many teams have solved this
  "discoveryTeams": [   // Ordered list of solvers
    {
      "teamId": "team_alpha",
      "timestamp": "2025-11-08T10:23:00Z",
      "rank": 1  // 1st team to solve
    },
    {
      "teamId": "team_beta",
      "timestamp": "2025-11-08T10:45:00Z",
      "rank": 2  // 2nd team to solve
    }
  ],
  "isActive": true,  // Control Room can disable buggy treasures
  "createdBy": "admin_user_id",
  "createdAt": "2025-11-07T12:00:00Z"
}
```

**Indexes Required**:
- Composite: `geohash` (ASC) + `discoveryCount` (ASC)
- Single: `discoveryCount` (ASC)
- Single: `isActive` (ASC)

---

### Collection: `/teams/{teamId}`

```javascript
{
  "teamId": "team_alpha",
  "teamName": "Phoenix Squad",
  "members": ["player1_uid", "player2_uid"],  // Firebase Auth UIDs
  "totalScore": 175,
  "wrongAnswerCount": 2,
  "solvedTreasures": [
    {
      "treasureId": "treasure_001",
      "rank": 1,  // 1st to solve this treasure
      "pointsEarned": 100,  // Discovery Bonus
      "timestamp": "2025-11-08T10:23:00Z"
    },
    {
      "treasureId": "treasure_003",
      "rank": 3,  // 3rd to solve this treasure
      "pointsEarned": 50,
      "timestamp": "2025-11-08T11:15:00Z"
    }
  ],
  "currentHint": {
    "treasureId": "treasure_007",
    "hintText": "Near the bronze statue...",
    "assignedAt": "2025-11-08T11:20:00Z"
  },
  "lastGpsUpdate": {
    "lat": 30.3520,
    "lng": 76.3600,
    "timestamp": "2025-11-08T11:25:00Z"
  },
  "createdAt": "2025-11-08T09:00:00Z",
  "isActive": true  // Control Room can mark teams as inactive
}
```

**Indexes Required**:
- Single: `totalScore` (DESC) - for leaderboard
- Single: `isActive` (ASC)

---

### Collection: `/gps_logs/{logId}` (Optional - for analytics)

```javascript
{
  "logId": "auto_generated",
  "teamId": "team_alpha",
  "treasureId": "treasure_001",  // null if just tracking movement
  "lat": 30.3518,
  "lng": 76.3599,
  "accuracy": 12.5,  // GPS accuracy in meters
  "timestamp": "2025-11-08T11:25:00Z",
  "action": "ar_viewed" | "answer_submitted" | "gps_update"
}
```

---

## Mobile App Responsibilities (This Repo)

### 1. Team Authentication & Registration

**Firebase Auth** handles user authentication. Mobile app:
- Allows players to sign up with email/password
- Creates or joins a team
- Stores team info in `/teams/{teamId}` collection

**Code Location**: `src/Views/Login.jsx`, `src/Views/Signup.jsx`

---

### 2. Geohash-based Proximity Detection

**Real-time Firestore Listener** for nearby treasures:

```javascript
// src/firebase/treasureQueries.js
import { geohashQueryBounds, distanceBetween } from 'geofire-common';

export function subscribeToNearbyTreasures(userLat, userLng, radius, callback) {
  const bounds = geohashQueryBounds([userLat, userLng], radius);
  
  const queries = bounds.map(([start, end]) => {
    return query(
      collection(db, 'treasures'),
      where('isActive', '==', true),  // Only active treasures
      where('geohash', '>=', start),
      where('geohash', '<=', end)
    );
  });
  
  const unsubscribes = queries.map(q => 
    onSnapshot(q, snapshot => {
      const treasures = [];
      snapshot.forEach(doc => {
        const treasure = doc.data();
        const distance = distanceBetween(
          [userLat, userLng],
          [treasure.lat, treasure.lng]
        );
        if (distance <= radius / 1000) {  // Convert m to km
          treasures.push({ id: doc.id, ...treasure, distance: distance * 1000 });
        }
      });
      callback(treasures);
    })
  );
  
  return () => unsubscribes.forEach(u => u());
}
```

**Trigger AR View**: When distance ≤ 15m to current hinted treasure.

**Code Location**: `src/Pages/GameManager.jsx`

---

### 3. Hint Distribution System

**After correct answer**, assign new hint from most unvisited treasures:

```javascript
// src/firebase/hintDistribution.js
export async function assignNextHint(teamId, currentSolvedTreasures) {
  // Query treasures ordered by discoveryCount
  const q = query(
    collection(db, 'treasures'),
    where('isActive', '==', true),
    orderBy('discoveryCount', 'asc'),
    limit(20)
  );
  
  const snapshot = await getDocs(q);
  const unsolved = [];
  
  snapshot.forEach(doc => {
    if (!currentSolvedTreasures.includes(doc.id)) {
      unsolved.push({ id: doc.id, ...doc.data() });
    }
  });
  
  if (unsolved.length === 0) return null;  // All treasures solved!
  
  // Get treasures with minimum discoveryCount
  const minCount = unsolved[0].discoveryCount;
  const leastDiscovered = unsolved.filter(t => t.discoveryCount === minCount);
  
  // Random selection from least discovered
  const selected = leastDiscovered[Math.floor(Math.random() * leastDiscovered.length)];
  
  // Update team's currentHint
  await updateDoc(doc(db, 'teams', teamId), {
    currentHint: {
      treasureId: selected.id,
      hintText: selected.hint,
      assignedAt: new Date().toISOString()
    }
  });
  
  return selected;
}
```

**Code Location**: `src/firebase/hintDistribution.js`

---

### 4. Discovery Bonus Scoring

**When team submits correct answer**:

```javascript
// src/firebase/scoring.js
export async function handleCorrectAnswer(teamId, treasureId) {
  const treasureRef = doc(db, 'treasures', treasureId);
  const teamRef = doc(db, 'teams', teamId);
  
  return await runTransaction(db, async (transaction) => {
    const treasureDoc = await transaction.get(treasureRef);
    const teamDoc = await transaction.get(teamRef);
    
    const treasure = treasureDoc.data();
    const team = teamDoc.data();
    
    // Calculate rank (next solver)
    const currentRank = treasure.discoveryCount + 1;
    
    // Discovery Bonus Table
    const bonusTable = { 1: 100, 2: 75, 3: 50, 4: 25 };
    const pointsEarned = bonusTable[currentRank] || 0;
    
    // Update treasure
    transaction.update(treasureRef, {
      discoveryCount: increment(1),
      discoveryTeams: arrayUnion({
        teamId: teamId,
        timestamp: new Date().toISOString(),
        rank: currentRank
      })
    });
    
    // Update team
    transaction.update(teamRef, {
      totalScore: increment(pointsEarned),
      solvedTreasures: arrayUnion({
        treasureId: treasureId,
        rank: currentRank,
        pointsEarned: pointsEarned,
        timestamp: new Date().toISOString()
      })
    });
    
    return { rank: currentRank, pointsEarned };
  });
}
```

**Wrong Answer Penalty**:

```javascript
export async function handleWrongAnswer(teamId) {
  await updateDoc(doc(db, 'teams', teamId), {
    totalScore: increment(-10),
    wrongAnswerCount: increment(1)
  });
}
```

**Code Location**: `src/firebase/scoring.js`

---

### 5. GPS Tracking Updates

**Optional**: Periodically update team's last known location for Control Room tracking:

```javascript
// Every 30 seconds if location changed
export async function updateTeamLocation(teamId, lat, lng, accuracy) {
  await updateDoc(doc(db, 'teams', teamId), {
    lastGpsUpdate: {
      lat,
      lng,
      accuracy,
      timestamp: new Date().toISOString()
    }
  });
}
```

**Code Location**: `src/hooks/useGeolocation.js` (modified)

---

## Backend Responsibilities (Separate Repo)

### 1. Admin Portal

**Features**:
- Create treasures at current GPS location
- 60m proximity validation (check existing treasures via geohash)
- Edit/delete treasures
- Bulk import from CSV

**Firestore Operations**:
- Write to `/treasures/{treasureId}`
- Query existing treasures with geohash for proximity check

---

### 2. Control Room Dashboard

**Features**:
- Real-time leaderboard (query `/teams` ordered by `totalScore`)
- Team GPS tracking (map view using `lastGpsUpdate` field)
- Dispute resolution:
  - Manually adjust team scores (update `totalScore` field)
  - Disable buggy treasures (set `isActive: false`)
- Game timer/countdown

**Firestore Operations**:
- Read from `/teams` (real-time listener)
- Read from `/treasures` (list view)
- Write to `/teams/{teamId}` (manual adjustments)
- Write to `/treasures/{treasureId}` (disable/enable)

---

## Firebase Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Treasures: Read by authenticated users, write by admins only
    match /treasures/{treasureId} {
      allow read: if request.auth != null && get(/databases/$(database)/documents/treasures/$(treasureId)).data.isActive == true;
      allow write: if request.auth != null && request.auth.token.admin == true;
    }
    
    // Teams: Users can only read/write their own team
    match /teams/{teamId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null && 
                       (request.auth.uid in resource.data.members || 
                        request.auth.token.admin == true);
    }
    
    // GPS Logs: Write-only for tracking
    match /gps_logs/{logId} {
      allow create: if request.auth != null;
      allow read: if request.auth.token.admin == true;
    }
  }
}
```

**Admin Claims**: Set via Firebase Admin SDK in backend:

```javascript
// Backend sets admin claim
admin.auth().setCustomUserClaims(uid, { admin: true });
```

---

## Data Synchronization

### Mobile App → Firestore (Writes)

1. **Team Registration**: Create document in `/teams`
2. **Answer Submission**: Update `/teams` and `/treasures` (transaction)
3. **GPS Updates**: Update `/teams/{teamId}/lastGpsUpdate`

### Firestore → Mobile App (Reads/Listeners)

1. **Nearby Treasures**: Real-time listener on `/treasures` with geohash query
2. **Team Data**: Real-time listener on `/teams/{currentTeamId}`
3. **Current Hint**: Part of team document, auto-syncs

### Backend → Firestore (Writes)

1. **Treasure Creation**: Write to `/treasures`
2. **Score Adjustments**: Update `/teams/{teamId}/totalScore`
3. **Treasure Disable**: Update `/treasures/{treasureId}/isActive`

### Firestore → Backend (Reads/Listeners)

1. **Leaderboard**: Real-time listener on `/teams` ordered by `totalScore`
2. **Team Tracking**: Real-time listener on all `/teams` for GPS data
3. **Analytics**: Query `/gps_logs` for heatmaps

---

## Environment Variables

### Mobile App (.env)

```bash
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=mirage-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=mirage-app
VITE_FIREBASE_STORAGE_BUCKET=mirage-app.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### Backend (Admin Portal)

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
FIREBASE_PROJECT_ID=mirage-app
ADMIN_EMAIL=admin@mirage.com  # For setting admin claims
```

---

## API Contract Summary

| Feature | Mobile App | Backend | Firestore Collection |
|---------|------------|---------|---------------------|
| **Treasure Creation** | ❌ | ✅ | `/treasures` |
| **Proximity Detection** | ✅ | ❌ | `/treasures` (query) |
| **Answer Submission** | ✅ | ❌ | `/treasures`, `/teams` |
| **Hint Assignment** | ✅ | ❌ | `/teams` |
| **Scoring** | ✅ | ❌ | `/teams`, `/treasures` |
| **GPS Tracking** | ✅ | ✅ (read) | `/teams` |
| **Leaderboard** | ✅ (read) | ✅ (display) | `/teams` |
| **Score Adjustments** | ❌ | ✅ | `/teams` |
| **Treasure Disable** | ❌ | ✅ | `/treasures` |

---

## Testing Integration

### Mock Data Setup

Create test treasures in Firestore:

```javascript
// scripts/seedTestData.js
const testTreasures = [
  {
    treasureId: "treasure_001",
    lat: 30.3517,
    lng: 76.3598,
    geohash: geohashForLocation([30.3517, 76.3598], 8),
    hint: "Near the library entrance",
    question: "How many steps lead to the door?",
    correctAnswer: "7",
    discoveryCount: 0,
    discoveryTeams: [],
    isActive: true,
    createdAt: new Date().toISOString()
  },
  // Add more test treasures...
];

// Upload to Firestore
testTreasures.forEach(async (treasure) => {
  await setDoc(doc(db, 'treasures', treasure.treasureId), treasure);
});
```

### Verification Checklist

- [ ] Mobile app can read treasures from Firestore
- [ ] Geohash queries return treasures within 15m radius
- [ ] Correct answer updates both team and treasure documents
- [ ] Discovery Bonus calculates correctly (100/75/50/25/0)
- [ ] Wrong answer penalty deducts 10 points
- [ ] Hint assignment selects from least discovered treasures
- [ ] Backend can disable treasures (mobile app filters them out)
- [ ] Backend leaderboard matches mobile app scores
- [ ] GPS updates visible in Control Room

---

## Deployment Notes

1. **Firestore Indexes**: Deploy via Firebase CLI
   ```bash
   firebase deploy --only firestore:indexes
   ```

2. **Security Rules**: Deploy via Firebase CLI
   ```bash
   firebase deploy --only firestore:rules
   ```

3. **Admin Claims**: Set via backend admin script
   ```javascript
   admin.auth().setCustomUserClaims(adminUid, { admin: true });
   ```

4. **CORS**: No CORS needed (both repos use Firebase SDK, not REST)

---

## Contact & Coordination

- **Mobile App Repo**: This repo (Mirage frontend)
- **Backend Repo**: [Link to be added]
- **Firestore Console**: https://console.firebase.google.com/project/mirage-app/firestore

For schema changes or new features requiring coordination between repos, create an issue in both repositories with the `[integration]` tag.
