'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import SnowPlowCanvas, {
  LiveTelemetry,
  RivalTelemetry,
  TouchControlState,
} from '@/components/SnowPlowCanvas';
import {
  PlayerProgress,
  TRUCK_SKINS,
  UPGRADE_SPECS,
  WEATHER_SPECS,
  getUpgradeCost,
  WeatherType,
  SkinId,
  GameMode,
  CameraPreset,
  getTodayDateSeed,
  getDailyChallengeInfo,
  createRandomId,
} from '@/lib/game-data';
import {
  loadLocalProgress,
  saveCloudProfile,
  syncCloudProfile,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  submitLeaderboardScore,
  fetchLeaderboard,
  LeaderboardRecord,
  createFirestoreMatch,
  subscribeToFirestoreMatch,
} from '@/lib/firebase';
import { audioSynth } from '@/lib/audio-synth';
import type { User } from 'firebase/auth';

type DockDrawerTab = 'none' | 'upgrades' | 'skins' | 'daily' | 'multiplayer' | 'leaderboard';

const CAMERA_ORDER: CameraPreset[] = ['isometric', 'driver', 'chase', 'overhead'];
const CAMERA_LABELS: Record<CameraPreset, string> = {
  isometric: 'Isometric',
  driver: 'Front Driver',
  chase: 'Chase',
  overhead: 'Overhead',
};

export default function FrostlinePlowGame() {
  const [gameState, setGameState] = useState<'title' | 'playing' | 'paused' | 'victory'>('title');
  const [gameMode, setGameMode] = useState<GameMode>('standard');
  const [mapSeed, setMapSeed] = useState<string>('alpine_valley_01');
  const [weather, setWeather] = useState<WeatherType>('flurry');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('isometric');
  const [saltActive, setSaltActive] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DockDrawerTab>('none');
  const [showTouchPad, setShowTouchPad] = useState<boolean>(false);

  const [touchControl, setTouchControl] = useState<TouchControlState>({
    forward: 0,
    turn: 0,
    turbo: false,
  });

  const [progress, setProgress] = useState<PlayerProgress>(() => loadLocalProgress());
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<string>('Local Save Ready');

  const [telemetry, setTelemetry] = useState<LiveTelemetry>({
    score: 0,
    combo: 1,
    comboTimerRatio: 0,
    clearedCount: 0,
    totalCount: 100,
    progressPct: 0,
    speedKmh: 0,
    coinsEarned: 0,
    currentDepthLoad: 0,
    onIce: false,
    timeRemainingSec: 0,
    x: 0,
    z: 0,
    angle: 0,
    propertyHits: 0,
    rescuedCount: 0,
    totalRescues: 4,
    turboCharge: 50,
    turboActive: false,
    lastEventBanner: '',
    lastEventTone: 'neutral',
    radarMarkers: [],
  });

  const [lastRunSummary, setLastRunSummary] = useState<{
    score: number;
    maxCombo: number;
    clearedCount: number;
    coinsEarned: number;
    propertyHits: number;
    rescuedCount: number;
    safetyBonus: number;
  } | null>(null);

  // Leaderboards
  const [leaderboardFilter, setLeaderboardFilter] = useState<GameMode>('standard');
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardRecord[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState<boolean>(false);

  // Multiplayer State
  const [activeMatchId, setActiveMatchId] = useState<string>('');
  const [openRooms, setOpenRooms] = useState<
    Array<{
      matchId: string;
      hostName: string;
      weather: WeatherType;
      status: string;
      hostScore: number;
      guestName: string;
    }>
  >([]);
  const [rival, setRival] = useState<RivalTelemetry>({
    active: false,
    name: '',
    skin: 'arctic_rescue',
    x: 3,
    z: 0,
    angle: 0,
    score: 0,
    progress: 0,
  });

  const dailyInfo = getDailyChallengeInfo(getTodayDateSeed());
  const telemetryRef = useRef(telemetry);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  // Detect touch capability on mount to auto-enable touch controls on mobile/tablets
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isTouch =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.innerWidth < 768;
      if (isTouch) {
        const timer = setTimeout(() => setShowTouchPad(true), 0);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Subscribe to Firebase Auth for Cloud Saves
  useEffect(() => {
    const unsub = subscribeToAuth(async (user) => {
      setAuthUser(user);
      if (user) {
        setCloudSyncStatus('Syncing Cloud Save...');
        try {
          const merged = await syncCloudProfile(loadLocalProgress());
          setProgress(merged);
          setCloudSyncStatus('Cloud Synced');
        } catch {
          setCloudSyncStatus('Local Save Active');
        }
      } else {
        setCloudSyncStatus('Local Save Ready');
      }
    });
    return () => unsub();
  }, []);

  // Load Leaderboard from both authoritative API + Firestore when opened
  const refreshLeaderboard = useCallback(async (mode: GameMode) => {
    setLoadingLeaderboard(true);
    try {
      const [apiRes, fsList] = await Promise.allSettled([
        fetch('/api/multiplayer?type=leaderboard').then((r) => r.json()),
        fetchLeaderboard(mode),
      ]);

      const combined = new Map<string, LeaderboardRecord>();
      if (apiRes.status === 'fulfilled' && Array.isArray(apiRes.value?.entries)) {
        for (const item of apiRes.value.entries) {
          if (!mode || item.mode === mode) {
            combined.set(item.entryId, item);
          }
        }
      }
      if (fsList.status === 'fulfilled') {
        for (const item of fsList.value) {
          combined.set(item.entryId, item);
        }
      }
      const sorted = Array.from(combined.values()).sort((a, b) => b.score - a.score);
      setLeaderboardEntries(sorted);
    } finally {
      setLoadingLeaderboard(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'leaderboard') return;
    const timer = setTimeout(() => {
      void refreshLeaderboard(leaderboardFilter);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeTab, leaderboardFilter, refreshLeaderboard]);

  // Multiplayer Room Polling & Telemetry Sync
  useEffect(() => {
    if (activeTab !== 'multiplayer' && !activeMatchId) return;

    let unsubFirestore: (() => void) | null = null;
    if (activeMatchId && authUser) {
      try {
        unsubFirestore = subscribeToFirestoreMatch(activeMatchId, (room) => {
          const isHost = room.hostUid === progress.uid || room.hostName === progress.displayName;
          if (isHost && room.guestUid) {
            setRival({
              active: true,
              name: room.guestName || 'Challenger',
              skin: room.guestSkin || 'arctic_rescue',
              x: room.guestX,
              z: room.guestZ,
              angle: room.guestAngle,
              score: room.guestScore,
              progress: room.guestProgress,
            });
          } else if (!isHost) {
            setRival({
              active: true,
              name: room.hostName || 'Host',
              skin: room.hostSkin || 'classic_orange',
              x: room.hostX,
              z: room.hostZ,
              angle: room.hostAngle,
              score: room.hostScore,
              progress: room.hostProgress,
            });
          }
        });
      } catch {
        // Fallback to server API polling
      }
    }

    const interval = setInterval(async () => {
      try {
        if (!activeMatchId) {
          const res = await fetch('/api/multiplayer');
          const data = await res.json();
          if (Array.isArray(data.rooms)) {
            setOpenRooms(data.rooms);
          }
        } else {
          const t = telemetryRef.current;
          const res = await fetch('/api/multiplayer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'player:telemetry',
              matchId: activeMatchId,
              uid: progress.uid,
              score: t.score,
              progress: t.progressPct,
              x: t.x,
              z: t.z,
              angle: t.angle,
            }),
          });
          if (res.ok) {
            const { room } = await res.json();
            if (room) {
              const isHost = room.hostUid === progress.uid;
              if (isHost && room.guestUid) {
                setRival({
                  active: true,
                  name: room.guestName,
                  skin: room.guestSkin,
                  x: room.guestX,
                  z: room.guestZ,
                  angle: room.guestAngle,
                  score: room.guestScore,
                  progress: room.guestProgress,
                });
              } else if (!isHost) {
                setRival({
                  active: true,
                  name: room.hostName,
                  skin: room.hostSkin,
                  x: room.hostX,
                  z: room.hostZ,
                  angle: room.hostAngle,
                  score: room.hostScore,
                  progress: room.hostProgress,
                });
              }
            }
          }
        }
      } catch {
        // ignore transient network error
      }
    }, 600);

    return () => {
      clearInterval(interval);
      if (unsubFirestore) unsubFirestore();
    };
  }, [activeTab, activeMatchId, authUser, progress.uid, progress.displayName]);

  const cycleCameraPreset = useCallback(() => {
    setCameraPreset((prev) => {
      const idx = CAMERA_ORDER.indexOf(prev);
      return CAMERA_ORDER[(idx + 1) % CAMERA_ORDER.length];
    });
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      if (gameState === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        audioSynth.startContinuousEngineAndWind();
        setGameState('playing');
        setActiveTab('none');
      } else if (gameState === 'playing') {
        if (e.code === 'Escape') {
          e.preventDefault();
          setGameState('paused');
        } else if (e.code === 'Space') {
          e.preventDefault();
          setSaltActive((prev) => !prev);
        } else if (e.code === 'KeyH') {
          e.preventDefault();
          setDockCollapsed((prev) => !prev);
        } else if (e.code === 'KeyC') {
          e.preventDefault();
          cycleCameraPreset();
        } else if (e.code === 'KeyV') {
          e.preventDefault();
          setCameraPreset((prev) => (prev === 'driver' ? 'isometric' : 'driver'));
        }
      } else if (gameState === 'paused' && e.code === 'Escape') {
        e.preventDefault();
        setGameState('playing');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [gameState, cycleCameraPreset]);

  const handleStartRun = (
    mode: GameMode = 'standard',
    seedOverride?: string,
    weatherOverride?: WeatherType
  ) => {
    audioSynth.startContinuousEngineAndWind();
    setGameMode(mode);
    if (seedOverride) setMapSeed(seedOverride);
    if (weatherOverride) setWeather(weatherOverride);
    setLastRunSummary(null);
    setActiveTab('none');
    setGameState('playing');
  };

  const handleRunComplete = useCallback(
    async (stats: {
      score: number;
      maxCombo: number;
      clearedCount: number;
      coinsEarned: number;
      propertyHits: number;
      rescuedCount: number;
      safetyBonus: number;
    }) => {
      setLastRunSummary(stats);
      setGameState('victory');

      const todaySeed = getTodayDateSeed();
      const isDailyBonus =
        gameMode === 'daily' &&
        stats.score >= dailyInfo.targetScore &&
        progress.lastDailyDate !== todaySeed;

      const bonusCoins = isDailyBonus ? dailyInfo.rewardCoins : 0;
      const updated: PlayerProgress = {
        ...progress,
        coins: progress.coins + stats.coinsEarned + bonusCoins,
        totalSnowCleared: progress.totalSnowCleared + stats.clearedCount,
        bestCombo: Math.max(progress.bestCombo, stats.maxCombo),
        highScore: Math.max(progress.highScore, stats.score),
        dailyStreak: isDailyBonus ? progress.dailyStreak + 1 : progress.dailyStreak,
        lastDailyDate: isDailyBonus ? todaySeed : progress.lastDailyDate,
      };
      setProgress(updated);

      try {
        await saveCloudProfile(updated, true);
      } catch {}

      try {
        await fetch('/api/multiplayer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'leaderboard:submit',
            uid: updated.uid,
            displayName: updated.displayName,
            score: stats.score,
            maxCombo: stats.maxCombo,
            snowCleared: stats.clearedCount,
            mode: gameMode,
            dailySeed: todaySeed,
            skinId: updated.equippedSkin,
          }),
        });
        await submitLeaderboardScore({
          displayName: updated.displayName,
          score: stats.score,
          maxCombo: stats.maxCombo,
          snowCleared: stats.clearedCount,
          mode: gameMode,
          dailySeed: todaySeed,
          skinId: updated.equippedSkin,
        });
      } catch {}
    },
    [gameMode, dailyInfo, progress]
  );

  const handleBuyUpgrade = async (
    key:
      | 'plowWidthLevel'
      | 'enginePowerLevel'
      | 'tireGripLevel'
      | 'saltSpreaderLevel'
      | 'thermalCabLevel',
    cost: number
  ) => {
    const currentLvl = progress[key];
    if (currentLvl >= 5 || progress.coins < cost) return;
    audioSynth.playUpgradeSuccess();
    const updated: PlayerProgress = {
      ...progress,
      coins: progress.coins - cost,
      [key]: currentLvl + 1,
    };
    setProgress(updated);
    try {
      await saveCloudProfile(updated, true);
    } catch {}
  };

  const handleSelectOrBuySkin = async (skinId: SkinId, cost: number) => {
    const isUnlocked = progress.unlockedSkins.includes(skinId);
    if (isUnlocked) {
      audioSynth.playUpgradeSuccess();
      const updated: PlayerProgress = {
        ...progress,
        equippedSkin: skinId,
      };
      setProgress(updated);
      try {
        await saveCloudProfile(updated, true);
      } catch {}
      return;
    }
    if (progress.coins < cost) return;
    audioSynth.playUpgradeSuccess();
    const updated: PlayerProgress = {
      ...progress,
      coins: progress.coins - cost,
      equippedSkin: skinId,
      unlockedSkins: [...progress.unlockedSkins, skinId].slice(0, 10),
    };
    setProgress(updated);
    try {
      await saveCloudProfile(updated, true);
    } catch {}
  };

  const handleCreateMultiplayerRoom = async () => {
    const matchId = createRandomId('frost');
    const mpSeed = `mp_${matchId}`;
    const res = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'room:create',
        matchId,
        hostUid: progress.uid,
        hostName: progress.displayName,
        hostSkin: progress.equippedSkin,
        mapSeed: mpSeed,
        weather,
      }),
    });
    if (res.ok) {
      const { room } = await res.json();
      setActiveMatchId(room.matchId);
      try {
        await createFirestoreMatch(room);
      } catch {}
      handleStartRun('multiplayer', room.mapSeed, room.weather);
    }
  };

  const handleJoinMultiplayerRoom = async (roomId: string) => {
    const guestId =
      progress.uid === 'local_operator'
        ? createRandomId('guest')
        : progress.uid;
    const res = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'room:join',
        matchId: roomId,
        guestUid: guestId,
        guestName: progress.displayName,
        guestSkin: progress.equippedSkin,
      }),
    });
    if (res.ok) {
      const { room } = await res.json();
      setActiveMatchId(room.matchId);
      setRival({
        active: true,
        name: room.hostName,
        skin: room.hostSkin,
        x: room.hostX,
        z: room.hostZ,
        angle: room.hostAngle,
        score: room.hostScore,
        progress: room.hostProgress,
      });
      handleStartRun('multiplayer', room.mapSeed, room.weather);
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    audioSynth.setMuted(next);
  };

  const timeLimitForMode =
    gameMode === 'daily' ? dailyInfo.timeLimitSec : gameMode === 'multiplayer' ? 90 : 0;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0B121E] select-none">
      {/* 100% Full-Viewport 3D WebGL Scene */}
      <SnowPlowCanvas
        gameState={gameState}
        mapSeed={mapSeed}
        weather={weather}
        progress={progress}
        cameraPreset={cameraPreset}
        saltActive={saltActive}
        timeLimitSec={timeLimitForMode}
        rival={rival}
        touchControl={touchControl}
        onTelemetryUpdate={setTelemetry}
        onRunComplete={handleRunComplete}
      />

      {/* Subtle First-Person Cabin Windshield Frame when in Front Driver Camera */}
      {gameState === 'playing' && cameraPreset === 'driver' && (
        <div className="fixed inset-0 pointer-events-none z-5 border-[10px] sm:border-[16px] border-[#0B121E]/85 rounded-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-[#0B121E]/90 px-4 py-1 rounded-b-lg border-b border-x border-slate-700/70 text-[11px] font-mono text-amber-400">
            CABIN DRIVER VIEW · HDG {Math.round(((telemetry.angle * 180) / Math.PI + 360) % 360)}° ·{' '}
            {telemetry.speedKmh} KM/H
          </div>
        </div>
      )}

      {/* Top Perimeter Status Cluster (Responsive across Mobile, Tablet & Desktop) */}
      <div className="fixed top-2 sm:top-4 left-2 sm:left-4 right-2 sm:right-4 z-10 pointer-events-none flex flex-col lg:flex-row items-stretch lg:items-start justify-between gap-2 sm:gap-3">
        {/* Top-Left Primary Telemetry Strip */}
        <div className="pointer-events-auto bg-[#0B121E]/92 border border-slate-700/70 rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-xl flex flex-wrap items-center justify-between sm:justify-start gap-3 sm:gap-5">
          <div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium">Run Score</div>
            <div className="text-base sm:text-xl font-bold font-mono tabular-nums text-white">
              {telemetry.score.toLocaleString()}
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800" />

          <div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium">Combo</div>
            <div className="flex items-center gap-1.5">
              <span className="text-base sm:text-xl font-bold font-mono tabular-nums text-amber-400">
                {telemetry.combo}x
              </span>
              <div className="w-10 sm:w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-transform duration-75 origin-left"
                  style={{ transform: `scaleX(${telemetry.comboTimerRatio})` }}
                />
              </div>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800" />

          <div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium">Cleared</div>
            <div className="text-base sm:text-xl font-bold font-mono tabular-nums text-sky-300">
              {telemetry.progressPct}%
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden xs:block" />

          {/* Overdrive Turbo Charge Readout */}
          <div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium">
              Turbo (Shift)
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs sm:text-sm font-bold font-mono tabular-nums ${
                  telemetry.turboActive ? 'text-cyan-300' : 'text-slate-200'
                }`}
              >
                {telemetry.turboCharge}%
              </span>
              <div className="w-10 sm:w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-transform duration-75 origin-left ${
                    telemetry.turboActive ? 'bg-cyan-400' : 'bg-sky-500'
                  }`}
                  style={{ transform: `scaleX(${telemetry.turboCharge / 100})` }}
                />
              </div>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden md:block" />

          {/* Rescues & Property Hits Readout */}
          <div className="hidden md:block">
            <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium">
              Rescues · Home Hits
            </div>
            <div className="text-xs sm:text-sm font-mono tabular-nums font-semibold">
              <span className="text-emerald-400">
                {telemetry.rescuedCount}/{telemetry.totalRescues}
              </span>
              <span className="text-slate-500 mx-1.5">·</span>
              <span className={telemetry.propertyHits > 0 ? 'text-rose-400' : 'text-slate-300'}>
                {telemetry.propertyHits} hits
              </span>
            </div>
          </div>

          {timeLimitForMode > 0 && (
            <>
              <div className="h-6 w-px bg-slate-800" />
              <div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium">Timer</div>
                <div className="text-base sm:text-xl font-bold font-mono tabular-nums text-rose-400">
                  {telemetry.timeRemainingSec}s
                </div>
              </div>
            </>
          )}

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          <div className="hidden sm:block">
            <div className="text-[10px] sm:text-[11px] text-slate-400 font-medium">Treasury</div>
            <div className="text-base sm:text-xl font-bold font-mono tabular-nums text-emerald-400">
              {(
                progress.coins + (gameState === 'playing' ? telemetry.coinsEarned : 0)
              ).toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">cr</span>
            </div>
          </div>
        </div>

        {/* Top-Right Sector Mini-Radar, Weather & Cloud Sync */}
        <div className="pointer-events-auto flex items-center justify-between lg:justify-end gap-2">
          <div className="bg-[#0B121E]/92 border border-slate-700/70 rounded-xl px-3 py-2 shadow-xl flex items-center gap-3 w-full lg:w-auto justify-between">
            {/* Compact SVG Tactical Radar */}
            <div className="hidden sm:flex items-center gap-2.5">
              <svg
                width="44"
                height="44"
                viewBox="-36 -36 72 72"
                className="bg-[#070C15] rounded-full border border-slate-700/80 shrink-0"
                aria-label="Sector Mini-Radar"
              >
                <circle cx="0" cy="0" r="32" fill="none" stroke="#1E293B" strokeWidth="1.5" />
                <circle cx="0" cy="0" r="18" fill="none" stroke="#1E293B" strokeWidth="1" />
                {telemetry.radarMarkers.map((m, idx) =>
                  m.type === 'cabin' ? (
                    <rect
                      key={idx}
                      x={m.x - 1.8}
                      y={m.z - 1.8}
                      width="3.6"
                      height="3.6"
                      fill="#78350F"
                      stroke="#F59E0B"
                      strokeWidth="0.8"
                    />
                  ) : (
                    <circle
                      key={idx}
                      cx={m.x}
                      cy={m.z}
                      r="2.6"
                      fill={m.type === 'rescue_done' ? '#10B981' : '#F59E0B'}
                    />
                  )
                )}
                {rival.active && (
                  <circle cx={rival.x} cy={rival.z} r="2.8" fill="#38BDF8" />
                )}
                <g
                  transform={`translate(${telemetry.x}, ${telemetry.z}) rotate(${
                    (-telemetry.angle * 180) / Math.PI
                  })`}
                >
                  <polygon points="0,4.2 -3,-3 3,-3" fill="#22D3EE" />
                </g>
              </svg>

              <div className="text-xs text-slate-300">
                <div className="font-semibold text-white">{WEATHER_SPECS[weather].name}</div>
                <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                  {telemetry.speedKmh} km/h · Cam: {CAMERA_LABELS[cameraPreset]}
                </div>
              </div>
            </div>

            {/* Mobile compact weather & camera badge */}
            <div className="flex sm:hidden items-center gap-2 text-xs text-slate-300">
              <span className="font-semibold text-white">{WEATHER_SPECS[weather].name}</span>
              <span>·</span>
              <span className="font-mono tabular-nums">{telemetry.speedKmh} km/h</span>
              <span>·</span>
              <span className="text-rose-300 font-mono tabular-nums">
                Hits: {telemetry.propertyHits}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {rival.active && (
                <div className="text-xs text-sky-300 font-mono tabular-nums border-l border-slate-800 pl-2">
                  Rival: {rival.score.toLocaleString()}
                </div>
              )}

              {authUser ? (
                <button
                  onClick={() => signOutUser()}
                  className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {progress.displayName.slice(0, 12)} · Sign Out
                </button>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await signInWithGoogle();
                    } catch {}
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Cloud Sync
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Live Event / Home Collision Penalty / Vehicle Rescue Notification Banner */}
      {gameState === 'playing' && telemetry.lastEventBanner && (
        <div className="fixed top-24 sm:top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none px-3 w-full max-w-md flex justify-center">
          <div
            className={`px-4 py-1.5 rounded-lg border text-xs font-semibold shadow-lg transition-opacity duration-150 text-center ${
              telemetry.lastEventTone === 'penalty'
                ? 'bg-rose-950/95 border-rose-500/80 text-rose-200'
                : telemetry.lastEventTone === 'bonus'
                ? 'bg-emerald-950/95 border-emerald-500/80 text-emerald-200'
                : 'bg-[#0B121E]/90 border-slate-700 text-slate-200'
            }`}
          >
            {telemetry.lastEventBanner}
          </div>
        </div>
      )}

      {/* Title Screen Hero Overlay (35% Negative Space + Bespoke Inline SVG Lockup) */}
      {gameState === 'title' && (
        <div className="fixed inset-0 z-20 pointer-events-none flex flex-col items-center justify-center px-4 sm:px-6">
          <div className="pointer-events-auto max-w-xl w-full bg-[#0B121E]/94 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl text-center">
            <div className="flex justify-center mb-3 sm:mb-4">
              <svg
                width="72"
                height="60"
                viewBox="0 0 76 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M8 46L22 20H54L68 46H8Z"
                  fill="#1E293B"
                  stroke="#38BDF8"
                  strokeWidth="2.5"
                />
                <path
                  d="M16 48C16 36 24 28 38 28C52 28 60 36 60 48"
                  stroke="#F59E0B"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <rect x="28" y="12" width="20" height="8" rx="2" fill="#F59E0B" />
                <circle cx="24" cy="48" r="7" fill="#0F172A" stroke="#94A3B8" strokeWidth="3" />
                <circle cx="52" cy="48" r="7" fill="#0F172A" stroke="#94A3B8" strokeWidth="3" />
              </svg>
            </div>

            <h1
              className="text-2xl sm:text-4xl font-bold tracking-tight text-white mb-2"
              style={{ textWrap: 'balance' }}
            >
              Frostline Plow Co.
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 mb-5 sm:mb-6 max-w-md mx-auto leading-relaxed">
              Cozy 3D municipal snow-plowing simulation. Carve through multi-depth alpine drifts,
              rescue stranded town vehicles, avoid hitting homes (-150 pts), and switch between
              Isometric and First-Person Front Driver views.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3 mb-5">
              <button
                onClick={() => handleStartRun('standard')}
                className="w-full sm:w-auto px-6 py-3 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-transform active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Start Plowing Shift (Enter)
              </button>

              <button
                onClick={() => {
                  setCameraPreset('driver');
                  handleStartRun('standard');
                }}
                className="w-full sm:w-auto px-5 py-3 text-sm font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Start in Driver Cam
              </button>

              <button
                onClick={() =>
                  handleStartRun('daily', `daily_${dailyInfo.dateSeed}`, dailyInfo.weather)
                }
                className="w-full sm:w-auto px-5 py-3 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Daily · {dailyInfo.dateSeed}
              </button>
            </div>

            <div className="text-[11px] sm:text-xs text-slate-400 font-mono">
              WASD Move · Shift Turbo · V Driver Cam · C Cycle Cam · Space Salt · Esc Pause
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {gameState === 'paused' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#060B14]/80 px-4">
          <div className="max-w-md w-full bg-[#0F1829] border border-slate-700 rounded-2xl p-6 text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-2">Shift Paused</h2>
            <p className="text-xs text-slate-400 mb-6">
              Seed: {mapSeed} · Weather: {WEATHER_SPECS[weather].name} · {cloudSyncStatus}
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => setGameState('playing')}
                className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Resume Shift (Esc)
              </button>
              <button
                onClick={() =>
                  handleStartRun(gameMode, createRandomId('sector'), weather)
                }
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Generate New Winter Map
              </button>
              <button
                onClick={() => setGameState('title')}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-slate-400 font-medium text-sm rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Return to Title Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Victory / Run Complete Modal */}
      {gameState === 'victory' && lastRunSummary && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#060B14]/82 px-4">
          <div className="max-w-md w-full bg-[#0F1829] border border-slate-700 rounded-2xl p-6 text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-1">Sector Cleared</h2>
            <p className="text-xs text-slate-400 mb-5">
              {WEATHER_SPECS[weather].name} · {cloudSyncStatus}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6 text-left bg-[#0B121E] p-4 rounded-xl border border-slate-800">
              <div>
                <div className="text-xs text-slate-400">Final Score</div>
                <div className="text-lg font-bold font-mono tabular-nums text-white">
                  {lastRunSummary.score.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Peak Combo</div>
                <div className="text-lg font-bold font-mono tabular-nums text-amber-400">
                  {lastRunSummary.maxCombo}x
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Vehicles Rescued</div>
                <div className="text-lg font-bold font-mono tabular-nums text-sky-300">
                  {lastRunSummary.rescuedCount} / 4
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Home Collisions</div>
                <div
                  className={`text-lg font-bold font-mono tabular-nums ${
                    lastRunSummary.propertyHits === 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {lastRunSummary.propertyHits === 0
                    ? '0 (Clean +500)'
                    : `${lastRunSummary.propertyHits} (-${lastRunSummary.propertyHits * 150})`}
                </div>
              </div>
              <div className="col-span-2 pt-2 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Municipal Payout</span>
                <span className="text-base font-bold font-mono tabular-nums text-emerald-400">
                  +{lastRunSummary.coinsEarned} cr
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                onClick={() =>
                  handleStartRun('standard', createRandomId('valley'), weather)
                }
                className="flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Next Winter Map
              </button>
              <button
                onClick={() => {
                  setGameState('playing');
                  setActiveTab('upgrades');
                }}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Upgrade Rig
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Responsive On-Screen Touch Driving Controls (For Mobile/Tablet or Toggleable) */}
      {gameState === 'playing' && showTouchPad && (
        <div className="fixed bottom-24 left-3 right-3 z-20 pointer-events-none flex items-end justify-between">
          {/* Left Thumb: Steering Left / Right */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onPointerDown={() => setTouchControl((c) => ({ ...c, turn: 1 }))}
              onPointerUp={() => setTouchControl((c) => ({ ...c, turn: 0 }))}
              onPointerLeave={() => setTouchControl((c) => ({ ...c, turn: 0 }))}
              className="w-14 h-14 rounded-2xl bg-[#0B121E]/90 border border-slate-700 active:bg-amber-500 active:text-slate-950 text-white font-bold text-lg shadow-xl flex items-center justify-center select-none"
              aria-label="Steer Left"
            >
              ◀
            </button>
            <button
              onPointerDown={() => setTouchControl((c) => ({ ...c, turn: -1 }))}
              onPointerUp={() => setTouchControl((c) => ({ ...c, turn: 0 }))}
              onPointerLeave={() => setTouchControl((c) => ({ ...c, turn: 0 }))}
              className="w-14 h-14 rounded-2xl bg-[#0B121E]/90 border border-slate-700 active:bg-amber-500 active:text-slate-950 text-white font-bold text-lg shadow-xl flex items-center justify-center select-none"
              aria-label="Steer Right"
            >
              ▶
            </button>
          </div>

          {/* Right Thumb: Turbo, Reverse, Drive */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onPointerDown={() => setTouchControl((c) => ({ ...c, turbo: true, forward: 1 }))}
              onPointerUp={() => setTouchControl((c) => ({ ...c, turbo: false, forward: 0 }))}
              onPointerLeave={() => setTouchControl((c) => ({ ...c, turbo: false, forward: 0 }))}
              className="h-14 px-3.5 rounded-2xl bg-cyan-950/90 border border-cyan-500/70 active:bg-cyan-400 active:text-slate-950 text-cyan-300 font-bold text-xs shadow-xl flex items-center justify-center select-none whitespace-nowrap"
            >
              BOOST
            </button>
            <button
              onPointerDown={() => setTouchControl((c) => ({ ...c, forward: -1 }))}
              onPointerUp={() => setTouchControl((c) => ({ ...c, forward: 0 }))}
              onPointerLeave={() => setTouchControl((c) => ({ ...c, forward: 0 }))}
              className="w-14 h-14 rounded-2xl bg-[#0B121E]/90 border border-slate-700 active:bg-rose-500 text-slate-200 font-bold text-xs shadow-xl flex items-center justify-center select-none"
            >
              REV
            </button>
            <button
              onPointerDown={() => setTouchControl((c) => ({ ...c, forward: 1 }))}
              onPointerUp={() => setTouchControl((c) => ({ ...c, forward: 0 }))}
              onPointerLeave={() => setTouchControl((c) => ({ ...c, forward: 0 }))}
              className="w-16 h-14 rounded-2xl bg-amber-500 active:bg-amber-400 text-slate-950 font-bold text-xs shadow-xl flex items-center justify-center select-none"
            >
              DRIVE
            </button>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      <div
        className="fixed left-1/2 -translate-x-1/2 bottom-2 sm:bottom-4 z-20 w-[min(960px,96vw)] transition-transform duration-200"
        style={{
          transform: dockCollapsed ? 'translate(-50%, calc(100% - 28px))' : 'translate(-50%, 0)',
        }}
      >
        {/* Collapse / Expand Tab Handle */}
        <div className="flex justify-center gap-2 mb-1">
          <button
            onClick={() => {
              setDockCollapsed((prev) => !prev);
              if (!dockCollapsed) setActiveTab('none');
            }}
            className="px-3.5 py-1 text-xs font-medium bg-[#0B121E]/95 border border-slate-700/80 text-slate-300 hover:text-white rounded-t-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {dockCollapsed ? '▴ Show Controls (H)' : '▾ Hide Controls (H)'}
          </button>

          <button
            onClick={() => setShowTouchPad((p) => !p)}
            className="px-3 py-1 text-xs font-medium bg-[#0B121E]/95 border border-slate-700/80 text-sky-300 hover:text-white rounded-t-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {showTouchPad ? 'Touch Pad: On' : 'Touch Pad: Off'}
          </button>
        </div>

        {/* Expandable Drawer Panel */}
        {!dockCollapsed && activeTab !== 'none' && (
          <div className="mb-2 bg-[#0B121E]/96 border border-slate-700/80 rounded-xl p-3 sm:p-4 shadow-2xl max-h-[54vh] overflow-y-auto">
            {activeTab === 'upgrades' && (
              <div>
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Municipal Garage · Rig Upgrades
                    </h3>
                    <p className="text-xs text-slate-400">
                      Available Treasury: {progress.coins.toLocaleString()} cr · {cloudSyncStatus}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('none')}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1"
                  >
                    Close
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3">
                  {UPGRADE_SPECS.map((spec) => {
                    const lvl = progress[spec.key];
                    const cost = getUpgradeCost(spec, lvl);
                    const isMax = lvl >= 5;
                    const canAfford = progress.coins >= cost && !isMax;

                    return (
                      <div
                        key={spec.key}
                        className="bg-[#111C2D] border border-slate-800 rounded-lg p-3 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                            <span>{spec.shortLabel}</span>
                            <span className="font-mono tabular-nums text-amber-400">
                              Lv.{lvl}/5
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-white mb-1">
                            {spec.values[Math.min(4, lvl - 1)]} {spec.unit}
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug mb-3">
                            {spec.description}
                          </p>
                        </div>

                        <button
                          disabled={!canAfford}
                          onClick={() => handleBuyUpgrade(spec.key, cost)}
                          className={`w-full py-1.5 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            isMax
                              ? 'bg-slate-800 text-slate-500 cursor-default'
                              : canAfford
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800/70 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {isMax ? 'Max Spec' : `Upgrade · ${cost} cr`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'skins' && (
              <div>
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Chassis Finishes & Livery Skins
                    </h3>
                    <p className="text-xs text-slate-400">
                      Custom PBR metallic/clearcoat paint finishes synced to your cloud profile
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('none')}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1"
                  >
                    Close
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3">
                  {TRUCK_SKINS.map((skin) => {
                    const unlocked = progress.unlockedSkins.includes(skin.id);
                    const equipped = progress.equippedSkin === skin.id;
                    const canAfford = progress.coins >= skin.cost;

                    return (
                      <div
                        key={skin.id}
                        className="bg-[#111C2D] border border-slate-800 rounded-lg p-3 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span
                              className="w-4 h-4 rounded-sm border border-white/20 shrink-0"
                              style={{ backgroundColor: skin.cabHex }}
                            />
                            <span
                              className="w-4 h-4 rounded-sm border border-white/20 shrink-0"
                              style={{ backgroundColor: skin.bladeHex }}
                            />
                            <span className="text-xs font-semibold text-white truncate">
                              {skin.name}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mb-3">{skin.subtitle}</p>
                        </div>

                        <button
                          onClick={() => handleSelectOrBuySkin(skin.id, skin.cost)}
                          disabled={!unlocked && !canAfford}
                          className={`w-full py-1.5 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            equipped
                              ? 'bg-sky-500/20 border border-sky-400 text-sky-300'
                              : unlocked
                              ? 'bg-slate-800 hover:bg-slate-700 text-white cursor-pointer'
                              : canAfford
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {equipped
                            ? 'Equipped'
                            : unlocked
                            ? 'Equip Finish'
                            : `Unlock · ${skin.cost} cr`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'daily' && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-amber-400 font-medium mb-0.5">
                    Daily Challenge Seed · {dailyInfo.dateSeed} · Streak: {progress.dailyStreak}d
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">{dailyInfo.title}</h3>
                  <p className="text-xs text-slate-300">
                    Weather: {WEATHER_SPECS[dailyInfo.weather].name} · Target Score:{' '}
                    <span className="font-mono tabular-nums font-semibold">
                      {dailyInfo.targetScore.toLocaleString()}
                    </span>{' '}
                    · Time Limit: {dailyInfo.timeLimitSec}s · Bonus: +{dailyInfo.rewardCoins} cr
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() =>
                      handleStartRun('daily', `daily_${dailyInfo.dateSeed}`, dailyInfo.weather)
                    }
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Launch Daily Challenge
                  </button>
                  <button
                    onClick={() => setActiveTab('none')}
                    className="px-3 py-2 text-xs text-slate-400 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'multiplayer' && (
              <div>
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Cross-Platform Competitive Snow Matchmaking
                    </h3>
                    <p className="text-xs text-slate-400">
                      Compete head-to-head on a synchronized winter map with live rival telemetry
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCreateMultiplayerRoom}
                      className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Host New Match Room
                    </button>
                    <button
                      onClick={() => setActiveTab('none')}
                      className="text-xs text-slate-400 hover:text-white px-2 py-1"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {activeMatchId ? (
                  <div className="bg-[#111C2D] border border-slate-800 rounded-lg p-3 flex items-center justify-between">
                    <div className="text-xs text-slate-200">
                      Connected to Room <span className="font-mono font-bold">{activeMatchId}</span>{' '}
                      ·{' '}
                      {rival.active
                        ? `Racing vs ${rival.name} (${rival.score.toLocaleString()} pts)`
                        : 'Waiting for challenger to join... (you can start plowing immediately)'}
                    </div>
                    <button
                      onClick={() => {
                        setActiveMatchId('');
                        setRival((r) => ({ ...r, active: false }));
                      }}
                      className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md whitespace-nowrap shrink-0"
                    >
                      Leave Match
                    </button>
                  </div>
                ) : openRooms.length === 0 ? (
                  <div className="text-xs text-slate-400 py-3">
                    No active public rooms waiting right now. Click &ldquo;Host New Match
                    Room&rdquo; to open a live cross-platform lobby.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {openRooms.map((rm) => (
                      <div
                        key={rm.matchId}
                        className="bg-[#111C2D] border border-slate-800 rounded-lg p-2.5 flex items-center justify-between"
                      >
                        <div>
                          <div className="text-xs font-semibold text-white">
                            {rm.hostName}&apos;s Plow Lobby ({rm.matchId})
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {WEATHER_SPECS[rm.weather]?.name || 'Snow Flurry'} · Host Score:{' '}
                            {rm.hostScore}
                          </div>
                        </div>
                        <button
                          onClick={() => handleJoinMultiplayerRoom(rm.matchId)}
                          className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Join Match
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'leaderboard' && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">Global High Scores</h3>
                    <div className="flex items-center gap-1 p-0.5 bg-slate-900 rounded-lg">
                      {(['standard', 'daily', 'blizzard', 'multiplayer'] as GameMode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => setLeaderboardFilter(m)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap shrink-0 ${
                            leaderboardFilter === m
                              ? 'bg-slate-800 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('none')}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1"
                  >
                    Close
                  </button>
                </div>

                {loadingLeaderboard ? (
                  <div className="text-xs text-slate-400 py-4">Loading leaderboard standings...</div>
                ) : leaderboardEntries.length === 0 ? (
                  <div className="text-xs text-slate-400 py-4">
                    No scores recorded for this mode yet. Complete a shift to claim #1!
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {leaderboardEntries.slice(0, 8).map((entry, idx) => (
                      <div
                        key={entry.entryId}
                        className="bg-[#111C2D] border border-slate-800/80 rounded-lg px-3 py-2 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="font-mono tabular-nums text-slate-400 w-5">
                            #{idx + 1}
                          </span>
                          <span className="font-semibold text-white truncate">
                            {entry.displayName}
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="font-mono tabular-nums text-amber-400">
                            {entry.maxCombo}x
                          </span>
                        </div>
                        <div className="font-mono tabular-nums font-bold text-sky-300 shrink-0">
                          {entry.score.toLocaleString()} pts
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main Horizontal Control Bar (Scrollable & Responsive on all viewports) */}
        <div className="bg-[#0B121E]/95 border border-slate-700/80 rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
          {/* Left: Workshop, Skins, Daily, Multiplayer, Leaderboard Drawer Toggles */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 md:pb-0">
            <button
              onClick={() => setActiveTab(activeTab === 'upgrades' ? 'none' : 'upgrades')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'upgrades'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200'
              }`}
            >
              Upgrades
            </button>

            <button
              onClick={() => setActiveTab(activeTab === 'skins' ? 'none' : 'skins')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'skins'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200'
              }`}
            >
              Skins
            </button>

            <button
              onClick={() => setActiveTab(activeTab === 'daily' ? 'none' : 'daily')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'daily'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200'
              }`}
            >
              Daily
            </button>

            <button
              onClick={() => setActiveTab(activeTab === 'multiplayer' ? 'none' : 'multiplayer')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'multiplayer'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200'
              }`}
            >
              Multiplayer
            </button>

            <button
              onClick={() => setActiveTab(activeTab === 'leaderboard' ? 'none' : 'leaderboard')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'leaderboard'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200'
              }`}
            >
              Leaderboards
            </button>
          </div>

          {/* Right: Weather Variation Switcher, Camera Angles (including Front Driver), Map & Audio */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 md:pb-0">
            {/* Weather Selector */}
            <div className="flex items-center bg-slate-900/90 p-0.5 rounded-lg border border-slate-800 shrink-0">
              {(['clear', 'flurry', 'blizzard', 'ice_storm'] as WeatherType[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setWeather(w)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    weather === w
                      ? 'bg-sky-500/25 text-sky-300 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {w === 'clear'
                    ? 'Dawn'
                    : w === 'flurry'
                    ? 'Flurry'
                    : w === 'blizzard'
                    ? 'Blizzard'
                    : 'Ice'}
                </button>
              ))}
            </div>

            {/* Direct Front Driver Cam Toggle + Cycle */}
            <button
              onClick={() =>
                setCameraPreset((prev) => (prev === 'driver' ? 'isometric' : 'driver'))
              }
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                cameraPreset === 'driver'
                  ? 'bg-sky-500 text-slate-950'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-sky-300'
              }`}
            >
              Driver Cam (V)
            </button>

            <button
              onClick={cycleCameraPreset}
              className="px-2.5 py-1.5 text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cam: {CAMERA_LABELS[cameraPreset]}
            </button>

            <button
              onClick={() =>
                handleStartRun('standard', createRandomId('sector'), weather)
              }
              className="px-2.5 py-1.5 text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              New Map
            </button>

            <button
              onClick={toggleMute}
              className="px-2.5 py-1.5 text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isMuted ? 'Sound: Off' : 'Synth: On'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
