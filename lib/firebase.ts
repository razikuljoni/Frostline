import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  PlayerProgress,
  DEFAULT_PLAYER_PROGRESS,
  SkinId,
  GameMode,
  WeatherType,
} from './game-data';

const resolvedConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || firebaseConfig.appId,
};
const resolvedDatabaseId =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId;

const app = getApps().length === 0 ? initializeApp(resolvedConfig) : getApps()[0];
export const db = getFirestore(app, resolvedDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on boot as mandated by firebase-integration-rpc skill
let connectionTested = false;
export async function testFirestoreConnection() {
  if (connectionTested || typeof window === 'undefined') return;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
if (typeof window !== 'undefined') {
  testFirestoreConnection();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const VALID_SKINS: SkinId[] = [
  'classic_orange',
  'arctic_rescue',
  'midnight_frost',
  'golden_mammoth',
  'pine_ranger',
];

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return ID_REGEX.test(cleaned) ? cleaned : 'default_id';
}

function sanitizeDisplayName(name: string): string {
  const trimmed = (name || 'Operator').trim().slice(0, 50);
  return trimmed.length >= 1 ? trimmed : 'Operator';
}

function clampInt(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number(val) || 0)));
}

const LOCAL_STORAGE_KEY = 'frostline_plow_progress_v1';

export function loadLocalProgress(): PlayerProgress {
  if (typeof window === 'undefined') return DEFAULT_PLAYER_PROGRESS;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYER_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<PlayerProgress>;
    return {
      ...DEFAULT_PLAYER_PROGRESS,
      ...parsed,
      coins: clampInt(parsed.coins ?? 250, 0, 100000000),
      totalSnowCleared: clampInt(parsed.totalSnowCleared ?? 0, 0, 100000000),
      bestCombo: clampInt(parsed.bestCombo ?? 1, 1, 1000),
      highScore: clampInt(parsed.highScore ?? 0, 0, 100000000),
      plowWidthLevel: clampInt(parsed.plowWidthLevel ?? 1, 1, 5),
      enginePowerLevel: clampInt(parsed.enginePowerLevel ?? 1, 1, 5),
      tireGripLevel: clampInt(parsed.tireGripLevel ?? 1, 1, 5),
      saltSpreaderLevel: clampInt(parsed.saltSpreaderLevel ?? 1, 1, 5),
      thermalCabLevel: clampInt(parsed.thermalCabLevel ?? 1, 1, 5),
    };
  } catch {
    return DEFAULT_PLAYER_PROGRESS;
  }
}

export function saveLocalProgress(progress: PlayerProgress) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // ignore storage quota errors
  }
}

export async function signInWithGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export function subscribeToAuth(cb: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, cb);
}

export async function syncCloudProfile(local: PlayerProgress): Promise<PlayerProgress> {
  const user = auth.currentUser;
  if (!user) return local;

  const uid = sanitizeId(user.uid);
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      // Merge highest progress between local and cloud
      const mergedSkins = Array.from(
        new Set<string>([
          ...local.unlockedSkins,
          ...(Array.isArray(data.unlockedSkins) ? (data.unlockedSkins as string[]) : ['classic_orange']),
        ])
      )
        .filter((s): s is SkinId => VALID_SKINS.includes(s as SkinId))
        .slice(0, 10);

      const merged: PlayerProgress = {
        uid,
        displayName: sanitizeDisplayName(user.displayName || data.displayName || local.displayName),
        coins: Math.max(local.coins, clampInt(data.coins, 0, 100000000)),
        totalSnowCleared: Math.max(local.totalSnowCleared, clampInt(data.totalSnowCleared, 0, 100000000)),
        bestCombo: Math.max(local.bestCombo, clampInt(data.bestCombo, 1, 1000)),
        highScore: Math.max(local.highScore, clampInt(data.highScore, 0, 100000000)),
        equippedSkin: VALID_SKINS.includes(data.equippedSkin) ? data.equippedSkin : local.equippedSkin,
        unlockedSkins: mergedSkins.length > 0 ? mergedSkins : ['classic_orange'],
        plowWidthLevel: Math.max(local.plowWidthLevel, clampInt(data.plowWidthLevel, 1, 5)),
        enginePowerLevel: Math.max(local.enginePowerLevel, clampInt(data.enginePowerLevel, 1, 5)),
        tireGripLevel: Math.max(local.tireGripLevel, clampInt(data.tireGripLevel, 1, 5)),
        saltSpreaderLevel: Math.max(local.saltSpreaderLevel, clampInt(data.saltSpreaderLevel, 1, 5)),
        thermalCabLevel: Math.max(local.thermalCabLevel, clampInt(data.thermalCabLevel, 1, 5)),
        dailyStreak: Math.max(local.dailyStreak, clampInt(data.dailyStreak, 0, 10000)),
        lastDailyDate: String(data.lastDailyDate || local.lastDailyDate || '').slice(0, 20),
      };

      saveLocalProgress(merged);
      await saveCloudProfile(merged, true);
      return merged;
    } else {
      const created: PlayerProgress = {
        ...local,
        uid,
        displayName: sanitizeDisplayName(user.displayName || local.displayName),
      };
      saveLocalProgress(created);
      await saveCloudProfile(created, false);
      return created;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveCloudProfile(progress: PlayerProgress, isExisting = true): Promise<void> {
  saveLocalProgress(progress);
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const uid = sanitizeId(user.uid);
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  const unlockedSkins = progress.unlockedSkins
    .filter((s) => VALID_SKINS.includes(s))
    .slice(0, 10);

  const basePayload = {
    displayName: sanitizeDisplayName(progress.displayName || user.displayName || 'Operator'),
    coins: clampInt(progress.coins, 0, 100000000),
    totalSnowCleared: clampInt(progress.totalSnowCleared, 0, 100000000),
    bestCombo: clampInt(progress.bestCombo, 1, 1000),
    highScore: clampInt(progress.highScore, 0, 100000000),
    equippedSkin: VALID_SKINS.includes(progress.equippedSkin)
      ? progress.equippedSkin
      : 'classic_orange',
    unlockedSkins: unlockedSkins.length > 0 ? unlockedSkins : ['classic_orange'],
    plowWidthLevel: clampInt(progress.plowWidthLevel, 1, 5),
    enginePowerLevel: clampInt(progress.enginePowerLevel, 1, 5),
    tireGripLevel: clampInt(progress.tireGripLevel, 1, 5),
    saltSpreaderLevel: clampInt(progress.saltSpreaderLevel, 1, 5),
    thermalCabLevel: clampInt(progress.thermalCabLevel, 1, 5),
    dailyStreak: clampInt(progress.dailyStreak, 0, 10000),
    lastDailyDate: String(progress.lastDailyDate || '').slice(0, 20),
    updatedAt: serverTimestamp(),
  };

  try {
    if (isExisting) {
      await updateDoc(userRef, basePayload);
    } else {
      await setDoc(userRef, {
        ...basePayload,
        uid,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isExisting ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export interface LeaderboardRecord {
  entryId: string;
  uid: string;
  displayName: string;
  score: number;
  maxCombo: number;
  snowCleared: number;
  mode: GameMode;
  dailySeed: string;
  skinId: SkinId;
}

export async function submitLeaderboardScore(params: {
  displayName: string;
  score: number;
  maxCombo: number;
  snowCleared: number;
  mode: GameMode;
  dailySeed: string;
  skinId: SkinId;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const uid = sanitizeId(user.uid);
  const modeKey = params.mode === 'daily' ? `daily_${params.dailySeed}` : params.mode;
  const entryId = sanitizeId(`${uid}_${modeKey}`);
  const path = `leaderboard/${entryId}`;
  const entryRef = doc(db, 'leaderboard', entryId);

  try {
    const existingSnap = await getDoc(entryRef);
    if (existingSnap.exists()) {
      const prevScore = Number(existingSnap.data().score) || 0;
      if (params.score <= prevScore) return;
      await updateDoc(entryRef, {
        displayName: sanitizeDisplayName(params.displayName || user.displayName || 'Operator'),
        score: clampInt(params.score, 0, 100000000),
        maxCombo: clampInt(params.maxCombo, 1, 1000),
        snowCleared: clampInt(params.snowCleared, 0, 100000000),
        dailySeed: String(params.dailySeed || '').slice(0, 20),
        skinId: VALID_SKINS.includes(params.skinId) ? params.skinId : 'classic_orange',
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(entryRef, {
        entryId,
        uid,
        displayName: sanitizeDisplayName(params.displayName || user.displayName || 'Operator'),
        score: clampInt(params.score, 0, 100000000),
        maxCombo: clampInt(params.maxCombo, 1, 1000),
        snowCleared: clampInt(params.snowCleared, 0, 100000000),
        mode: params.mode,
        dailySeed: String(params.dailySeed || '').slice(0, 20),
        skinId: VALID_SKINS.includes(params.skinId) ? params.skinId : 'classic_orange',
        visibility: 'public',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchLeaderboard(modeFilter?: GameMode): Promise<LeaderboardRecord[]> {
  const path = 'leaderboard';
  try {
    const q = query(
      collection(db, 'leaderboard'),
      where('visibility', '==', 'public'),
      limit(50)
    );
    const snap = await getDocs(q);
    const list: LeaderboardRecord[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (!modeFilter || d.mode === modeFilter) {
        list.push({
          entryId: d.entryId,
          uid: d.uid,
          displayName: d.displayName,
          score: Number(d.score) || 0,
          maxCombo: Number(d.maxCombo) || 1,
          snowCleared: Number(d.snowCleared) || 0,
          mode: d.mode as GameMode,
          dailySeed: d.dailySeed || '',
          skinId: d.skinId as SkinId,
        });
      }
    });
    return list.sort((a, b) => b.score - a.score).slice(0, 20);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export interface LiveMatchRoom {
  matchId: string;
  hostUid: string;
  hostName: string;
  hostSkin: SkinId;
  hostScore: number;
  hostProgress: number;
  hostX: number;
  hostZ: number;
  hostAngle: number;
  guestUid: string;
  guestName: string;
  guestSkin: SkinId;
  guestScore: number;
  guestProgress: number;
  guestX: number;
  guestZ: number;
  guestAngle: number;
  mapSeed: string;
  weather: WeatherType;
  status: 'waiting' | 'active' | 'finished';
  winnerUid: string;
}

export async function createFirestoreMatch(room: LiveMatchRoom): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const matchId = sanitizeId(room.matchId);
  const path = `matches/${matchId}`;
  try {
    await setDoc(doc(db, 'matches', matchId), {
      matchId,
      hostUid: sanitizeId(user.uid),
      hostName: sanitizeDisplayName(room.hostName),
      hostSkin: room.hostSkin,
      hostScore: 0,
      hostProgress: 0,
      hostX: 0,
      hostZ: 0,
      hostAngle: 0,
      guestUid: '',
      guestName: '',
      guestSkin: 'arctic_rescue',
      guestScore: 0,
      guestProgress: 0,
      guestX: 3,
      guestZ: 0,
      guestAngle: 0,
      mapSeed: room.mapSeed.slice(0, 32),
      weather: room.weather,
      status: 'waiting',
      winnerUid: '',
      visibility: 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeToFirestoreMatch(
  matchId: string,
  onUpdate: (room: LiveMatchRoom) => void
): Unsubscribe {
  const cleanId = sanitizeId(matchId);
  const path = `matches/${cleanId}`;
  return onSnapshot(
    doc(db, 'matches', cleanId),
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as LiveMatchRoom);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}
