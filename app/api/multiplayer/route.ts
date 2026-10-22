import { NextRequest, NextResponse } from 'next/server';
import { SkinId, WeatherType } from '@/lib/game-data';

export interface ServerMatchState {
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
  updatedAtMs: number;
}

// Server-authoritative multiplayer rooms store + global leaderboard store
const globalStore = globalThis as unknown as {
  __frostlineRooms?: Map<string, ServerMatchState>;
  __frostlineLeaderboard?: Array<{
    entryId: string;
    uid: string;
    displayName: string;
    score: number;
    maxCombo: number;
    snowCleared: number;
    mode: string;
    dailySeed: string;
    skinId: SkinId;
    updatedAtMs: number;
  }>;
};

if (!globalStore.__frostlineRooms) {
  globalStore.__frostlineRooms = new Map<string, ServerMatchState>();
}
if (!globalStore.__frostlineLeaderboard) {
  globalStore.__frostlineLeaderboard = [
    {
      entryId: 'seed_1',
      uid: 'nordic_erik',
      displayName: 'Erik Lindqvist',
      score: 14850,
      maxCombo: 28,
      snowCleared: 312,
      mode: 'standard',
      dailySeed: '2026-10-21',
      skinId: 'golden_mammoth',
      updatedAtMs: Date.now() - 3600000,
    },
    {
      entryId: 'seed_2',
      uid: 'sapporo_yuki',
      displayName: 'Yuki Takahashi',
      score: 12420,
      maxCombo: 22,
      snowCleared: 284,
      mode: 'blizzard',
      dailySeed: '2026-10-21',
      skinId: 'arctic_rescue',
      updatedAtMs: Date.now() - 7200000,
    },
    {
      entryId: 'seed_3',
      uid: 'banff_claire',
      displayName: 'Claire Tremblay',
      score: 10960,
      maxCombo: 19,
      snowCleared: 255,
      mode: 'daily',
      dailySeed: '2026-10-21',
      skinId: 'pine_ranger',
      updatedAtMs: Date.now() - 10800000,
    },
    {
      entryId: 'seed_4',
      uid: 'anchorage_hank',
      displayName: 'Hank Mercer',
      score: 9340,
      maxCombo: 16,
      snowCleared: 220,
      mode: 'standard',
      dailySeed: '2026-10-21',
      skinId: 'classic_orange',
      updatedAtMs: Date.now() - 14400000,
    },
  ];
}

const rooms = globalStore.__frostlineRooms;
const serverLeaderboard = globalStore.__frostlineLeaderboard;

function pruneStaleRooms() {
  const cutoff = Date.now() - 1000 * 60 * 15;
  for (const [id, room] of rooms.entries()) {
    if (room.updatedAtMs < cutoff) {
      rooms.delete(id);
    }
  }
}

export async function GET(req: NextRequest) {
  pruneStaleRooms();
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get('matchId');
  const type = searchParams.get('type');

  if (type === 'leaderboard') {
    const sorted = [...serverLeaderboard].sort((a, b) => b.score - a.score).slice(0, 25);
    return NextResponse.json({ entries: sorted });
  }

  if (matchId) {
    const room = rooms.get(matchId);
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    return NextResponse.json({ room });
  }

  const openRooms = Array.from(rooms.values())
    .filter((r) => r.status !== 'finished')
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, 15);

  return NextResponse.json({ rooms: openRooms });
}

export async function POST(req: NextRequest) {
  pruneStaleRooms();
  const body = await req.json();
  const { action } = body;

  if (action === 'leaderboard:submit') {
    const { uid, displayName, score, maxCombo, snowCleared, mode, dailySeed, skinId } = body;
    const entryId = `${uid}_${mode}`;
    const existingIdx = serverLeaderboard.findIndex((e) => e.entryId === entryId);
    const cleanScore = Math.max(0, Math.min(100000000, Math.round(Number(score) || 0)));
    if (existingIdx >= 0) {
      if (cleanScore > serverLeaderboard[existingIdx].score) {
        serverLeaderboard[existingIdx] = {
          entryId,
          uid: String(uid).slice(0, 128),
          displayName: String(displayName || 'Operator').slice(0, 50),
          score: cleanScore,
          maxCombo: Math.max(1, Math.round(Number(maxCombo) || 1)),
          snowCleared: Math.max(0, Math.round(Number(snowCleared) || 0)),
          mode: String(mode || 'standard'),
          dailySeed: String(dailySeed || ''),
          skinId: skinId || 'classic_orange',
          updatedAtMs: Date.now(),
        };
      }
    } else {
      serverLeaderboard.push({
        entryId,
        uid: String(uid).slice(0, 128),
        displayName: String(displayName || 'Operator').slice(0, 50),
        score: cleanScore,
        maxCombo: Math.max(1, Math.round(Number(maxCombo) || 1)),
        snowCleared: Math.max(0, Math.round(Number(snowCleared) || 0)),
        mode: String(mode || 'standard'),
        dailySeed: String(dailySeed || ''),
        skinId: skinId || 'classic_orange',
        updatedAtMs: Date.now(),
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'room:create') {
    const matchId = String(body.matchId || `room_${Date.now()}`).replace(/[^a-zA-Z0-9_\-]/g, '_');
    // Idempotency guard: if room with matchId exists, return it
    if (rooms.has(matchId)) {
      return NextResponse.json({ room: rooms.get(matchId) });
    }
    const newRoom: ServerMatchState = {
      matchId,
      hostUid: String(body.hostUid || 'host_1').slice(0, 128),
      hostName: String(body.hostName || 'Host Operator').slice(0, 50),
      hostSkin: body.hostSkin || 'classic_orange',
      hostScore: 0,
      hostProgress: 0,
      hostX: -2.2,
      hostZ: 0,
      hostAngle: 0,
      guestUid: '',
      guestName: '',
      guestSkin: 'arctic_rescue',
      guestScore: 0,
      guestProgress: 0,
      guestX: 2.2,
      guestZ: 0,
      guestAngle: 0,
      mapSeed: String(body.mapSeed || `mp_${Date.now()}`).slice(0, 32),
      weather: body.weather || 'flurry',
      status: 'waiting',
      winnerUid: '',
      updatedAtMs: Date.now(),
    };
    rooms.set(matchId, newRoom);
    return NextResponse.json({ room: newRoom });
  }

  if (action === 'room:join') {
    const matchId = String(body.matchId || '');
    const room = rooms.get(matchId);
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    if (room.status === 'waiting' || room.guestUid === body.guestUid || !room.guestUid) {
      room.guestUid = String(body.guestUid || 'guest_1').slice(0, 128);
      room.guestName = String(body.guestName || 'Challenger').slice(0, 50);
      room.guestSkin = body.guestSkin || 'arctic_rescue';
      room.status = 'active';
      room.updatedAtMs = Date.now();
    }
    return NextResponse.json({ room });
  }

  if (action === 'player:telemetry') {
    const matchId = String(body.matchId || '');
    const room = rooms.get(matchId);
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    if (room.status === 'finished') {
      return NextResponse.json({ room });
    }

    const isHost = body.uid === room.hostUid;
    if (isHost) {
      room.hostScore = Math.max(0, Math.round(Number(body.score) || 0));
      room.hostProgress = Math.max(0, Math.min(100, Math.round(Number(body.progress) || 0)));
      room.hostX = Number(body.x) || 0;
      room.hostZ = Number(body.z) || 0;
      room.hostAngle = Number(body.angle) || 0;
    } else if (body.uid === room.guestUid) {
      room.guestScore = Math.max(0, Math.round(Number(body.score) || 0));
      room.guestProgress = Math.max(0, Math.min(100, Math.round(Number(body.progress) || 0)));
      room.guestX = Number(body.x) || 0;
      room.guestZ = Number(body.z) || 0;
      room.guestAngle = Number(body.angle) || 0;
    }

    if (room.hostProgress >= 100 || room.guestProgress >= 100 || body.finishRequested) {
      room.status = 'finished';
      room.winnerUid = room.hostScore >= room.guestScore ? room.hostUid : room.guestUid;
    }

    room.updatedAtMs = Date.now();
    return NextResponse.json({ room });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
