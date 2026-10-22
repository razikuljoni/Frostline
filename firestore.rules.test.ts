/**
 * Security Rules Dirty Dozen Verification Suite (Phase 0 TDD)
 * Validates that all 12 adversarial payloads defined in security_spec.md
 * are rejected with PERMISSION_DENIED by the Firestore security rules.
 */

export interface DirtyDozenScenario {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedResult: 'PERMISSION_DENIED';
  description: string;
}

export const DIRTY_DOZEN_TESTS: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on UserProfile',
    collection: '/users/user_1',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects payload containing unauthorized field isAdmin: true via data.keys().hasOnly()',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof on UserProfile Write',
    collection: '/users/user_1',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects write when request.auth.token.email_verified is false',
  },
  {
    id: 3,
    name: 'Cross-User Profile Read (PII / Privacy Blanket Test)',
    collection: '/users/victim_uid',
    operation: 'get',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects read when request.auth.uid != userId',
  },
  {
    id: 4,
    name: 'Cross-User Leaderboard Identity Spoofing',
    collection: '/leaderboard/entry_1',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects leaderboard entry where incoming().uid != request.auth.uid',
  },
  {
    id: 5,
    name: 'Denial-of-Wallet 2KB String in DisplayName',
    collection: '/users/user_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects displayName exceeding 50 characters',
  },
  {
    id: 6,
    name: 'Value Poisoning on Upgrade Level',
    collection: '/users/user_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects plowWidthLevel: 999 because isValidUserProfile(incoming()) enforces 1..5',
  },
  {
    id: 7,
    name: 'Unbounded Array Injection in unlockedSkins',
    collection: '/users/user_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects unlockedSkins array with > 10 items',
  },
  {
    id: 8,
    name: 'Client-Spoofed Timestamp',
    collection: '/leaderboard/entry_1',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects createdAt != request.time',
  },
  {
    id: 9,
    name: 'Immortal Field Mutation on Update',
    collection: '/users/user_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects mutation of createdAt or uid on update',
  },
  {
    id: 10,
    name: 'Terminal State Bypass on Finished Multiplayer Match',
    collection: '/matches/match_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects updates once existing().status == finished',
  },
  {
    id: 11,
    name: 'Guest Modifying Host Score in Multiplayer Match',
    collection: '/matches/match_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects guest attempting to modify hostScore via affectedKeys().hasOnly()',
  },
  {
    id: 12,
    name: 'ID Poisoning on Path Parameter',
    collection: '/leaderboard/invalid$id!with*spaces',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Rejects document IDs failing ^[a-zA-Z0-9_\\-]+$ regex guard',
  },
];
