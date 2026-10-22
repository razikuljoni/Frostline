# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Zero-PII User Progression (`/users/{userId}`)**:
   - Contains strictly game progression (coins, upgrade levels, unlocked skins, high score). No PII (`email`, `phone`, `address`) is stored.
   - Only a verified authenticated user (`request.auth != null && request.auth.token.email_verified == true`) whose `request.auth.uid == userId` and `incoming().uid == userId` can create or update their own profile.
   - Read (`get` and `list`) is strictly restricted to the document owner (`request.auth.uid == userId` and `resource.data.uid == request.auth.uid`).
   - `createdAt` and `uid` are immutable on update; `updatedAt` must equal `request.time`.

2. **Leaderboard Entries (`/leaderboard/{entryId}`)**:
   - Read (`get` and `list`) requires `resource.data.visibility == 'public'` (no blanket reads without resource evaluation).
   - Creation and updates require verified authentication (`request.auth.token.email_verified == true`), `incoming().uid == request.auth.uid`, valid `entryId` matching the path parameter, bounded integer scores (`0 <= score <= 10000000`), valid enums for `mode` and `skinId`, and server timestamps (`request.time`).
   - Updates must preserve immutable `uid`, `entryId`, `mode`, and `createdAt`, and only allow updating `displayName`, `score`, `maxCombo`, `snowCleared`, `dailySeed`, `skinId`, and `updatedAt`.

3. **Multiplayer Matches (`/matches/{matchId}`)**:
   - Read (`get` and `list`) requires `resource.data.visibility == 'public'`.
   - Creation requires verified auth, `incoming().hostUid == request.auth.uid`, `incoming().status == 'waiting'`, `incoming().guestUid == ''`, and `incoming().createdAt == request.time`.
   - Terminal State Locking: Once `existing().status == 'finished'`, NO further updates are permitted.
   - Action-Based Updates:
     - **Join Action**: Authenticated verified guest (`request.auth.uid != existing().hostUid && existing().status == 'waiting' && incoming().guestUid == request.auth.uid && incoming().status == 'active'`) modifying only `['guestUid', 'guestName', 'guestSkin', 'guestX', 'guestZ', 'guestAngle', 'status', 'updatedAt']`.
     - **Host Telemetry Action**: Host (`request.auth.uid == existing().hostUid`) modifying only `['hostScore', 'hostProgress', 'hostX', 'hostZ', 'hostAngle', 'status', 'winnerUid', 'updatedAt']`.
     - **Guest Telemetry Action**: Joined Guest (`request.auth.uid == existing().guestUid`) modifying only `['guestScore', 'guestProgress', 'guestX', 'guestZ', 'guestAngle', 'status', 'winnerUid', 'updatedAt']`.

---

## 2. The "Dirty Dozen" Payloads

1. **Shadow Field Injection on UserProfile**:
   - Payload: `{ ...validUserProfile, "isAdmin": true }`
   - Expected: `PERMISSION_DENIED` (blocked by `data.keys().hasOnly(...)`).
2. **Unverified Email Spoof on UserProfile Write**:
   - Auth Context: `uid: 'user_1', email_verified: false`
   - Expected: `PERMISSION_DENIED` (blocked by `isVerifiedUser()`).
3. **Cross-User Profile Read (PII / Privacy Blanket Test)**:
   - Auth Context: `uid: 'attacker_uid'` attempting `get(/users/victim_uid)`
   - Expected: `PERMISSION_DENIED` (blocked by `request.auth.uid == userId`).
4. **Cross-User Leaderboard Identity Spoofing**:
   - Auth Context: `uid: 'attacker_uid'` creating `/leaderboard/entry_1` with `uid: 'victim_uid'`
   - Expected: `PERMISSION_DENIED` (blocked by `incoming().uid == request.auth.uid`).
5. **Denial-of-Wallet 2KB String in DisplayName**:
   - Payload: `displayName: "A".repeat(2048)`
   - Expected: `PERMISSION_DENIED` (blocked by `displayName.size() <= 50`).
6. **Value Poisoning on Upgrade Level**:
   - Payload: Updating `/users/user_1` with `plowWidthLevel: 999` or `"max"`
   - Expected: `PERMISSION_DENIED` (blocked by `isValidUserProfile(incoming())` checking `plowWidthLevel is int && plowWidthLevel >= 1 && plowWidthLevel <= 5`).
7. **Unbounded Array Injection in `unlockedSkins`**:
   - Payload: `unlockedSkins: ["a","b","c","d","e","f","g","h","i","j","k","l"]` (12 items)
   - Expected: `PERMISSION_DENIED` (blocked by `unlockedSkins.size() <= 10`).
8. **Client-Spoofed Timestamp (`createdAt` in the past/future)**:
   - Payload: `createdAt: Timestamp.fromMillis(1000000)` instead of `serverTimestamp()`
   - Expected: `PERMISSION_DENIED` (blocked by `incoming().createdAt == request.time`).
9. **Immortal Field Mutation (`createdAt` or `uid` changed on update)**:
   - Payload: Updating `/users/user_1` with a new `createdAt`
   - Expected: `PERMISSION_DENIED` (blocked by `incoming().createdAt == existing().createdAt`).
10. **Terminal State Bypass on Finished Multiplayer Match**:
    - Context: `/matches/match_1` has `status: 'finished'`. Host attempts to update `hostScore`.
    - Expected: `PERMISSION_DENIED` (blocked by `existing().status != 'finished'`).
11. **Guest Modifying Host Score in Multiplayer Match**:
    - Context: Guest (`request.auth.uid == existing().guestUid`) attempts to update `hostScore: 0`.
    - Expected: `PERMISSION_DENIED` (blocked by action-specific `affectedKeys().hasOnly(...)`).
12. **ID Poisoning on Path Parameter**:
    - Path: `/leaderboard/invalid$id!with*spaces`
    - Expected: `PERMISSION_DENIED` (blocked by `isValidId(entryId)`).
