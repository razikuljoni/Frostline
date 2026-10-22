export type SkinId =
  | 'classic_orange'
  | 'arctic_rescue'
  | 'midnight_frost'
  | 'pine_ranger'
  | 'golden_mammoth';

export type WeatherType = 'clear' | 'flurry' | 'blizzard' | 'ice_storm';

export type GameMode = 'standard' | 'daily' | 'blizzard' | 'multiplayer';

export interface TruckSkin {
  id: SkinId;
  name: string;
  subtitle: string;
  cost: number;
  cabColor: number;
  cabHex: string;
  bladeColor: number;
  bladeHex: string;
  trimColor: number;
  accentColor: number;
  metalness: number;
  roughness: number;
}

export const TRUCK_SKINS: TruckSkin[] = [
  {
    id: 'classic_orange',
    name: 'Municipal Amber',
    subtitle: 'County Highway Heavy-Duty Spec',
    cost: 0,
    cabColor: 0xea580c,
    cabHex: '#EA580C',
    bladeColor: 0xcbd5e1,
    bladeHex: '#CBD5E1',
    trimColor: 0x1e293b,
    accentColor: 0xf59e0b,
    metalness: 0.45,
    roughness: 0.32,
  },
  {
    id: 'arctic_rescue',
    name: 'Arctic Search & Rescue',
    subtitle: 'High-Visibility Polar Responder',
    cost: 400,
    cabColor: 0xdc2626,
    cabHex: '#DC2626',
    bladeColor: 0xf8fafc,
    bladeHex: '#F8FAFC',
    trimColor: 0x0f172a,
    accentColor: 0x38bdf8,
    metalness: 0.55,
    roughness: 0.25,
  },
  {
    id: 'midnight_frost',
    name: 'Obsidian Interceptor',
    subtitle: 'Anodized Slate & Cryo-Titanium Blade',
    cost: 850,
    cabColor: 0x1e293b,
    cabHex: '#1E293B',
    bladeColor: 0x38bdf8,
    bladeHex: '#38BDF8',
    trimColor: 0x090d16,
    accentColor: 0x06b6d4,
    metalness: 0.78,
    roughness: 0.2,
  },
  {
    id: 'pine_ranger',
    name: 'Timberline Forestry',
    subtitle: 'Nordic Evergreen & Brushed Brass Rig',
    cost: 1400,
    cabColor: 0x15803d,
    cabHex: '#15803D',
    bladeColor: 0xd97706,
    bladeHex: '#D97706',
    trimColor: 0x1c1917,
    accentColor: 0xfbbf24,
    metalness: 0.5,
    roughness: 0.35,
  },
  {
    id: 'golden_mammoth',
    name: 'Golden Mammoth V12',
    subtitle: '24K Brushed Gold & Mirror Chrome Finish',
    cost: 2400,
    cabColor: 0xf59e0b,
    cabHex: '#F59E0B',
    bladeColor: 0xfef08a,
    bladeHex: '#FEF08A',
    trimColor: 0x0f172a,
    accentColor: 0xffffff,
    metalness: 0.92,
    roughness: 0.14,
  },
];

export interface UpgradeSpec {
  key:
    | 'plowWidthLevel'
    | 'enginePowerLevel'
    | 'tireGripLevel'
    | 'saltSpreaderLevel'
    | 'thermalCabLevel';
  name: string;
  shortLabel: string;
  description: string;
  baseCost: number;
  unit: string;
  values: [number, number, number, number, number];
}

export const UPGRADE_SPECS: UpgradeSpec[] = [
  {
    key: 'plowWidthLevel',
    name: 'Hydraulic V-Blade Width',
    shortLabel: 'Blade Width',
    description: 'Widens the physical steel plow blade to clear broader swaths per pass.',
    baseCost: 150,
    unit: 'm',
    values: [2.4, 2.9, 3.4, 3.9, 4.5],
  },
  {
    key: 'enginePowerLevel',
    name: 'Turbo Diesel Torque',
    shortLabel: 'Engine Torque',
    description: 'Increases horsepower to push through deep packed snowdrifts without stalling.',
    baseCost: 180,
    unit: 'HP',
    values: [320, 410, 520, 650, 800],
  },
  {
    key: 'tireGripLevel',
    name: 'Tungsten Tire Chains',
    shortLabel: 'Tire Grip',
    description: 'Reduces lateral skidding on black ice and improves cornering response.',
    baseCost: 160,
    unit: '%',
    values: [65, 75, 84, 92, 99],
  },
  {
    key: 'saltSpreaderLevel',
    name: 'Thermal Salt Spreader',
    shortLabel: 'Salt Spreader',
    description: 'Extends combo decay window and melts residual frost alongside the truck.',
    baseCost: 200,
    unit: 's',
    values: [3.2, 4.0, 4.8, 5.8, 7.0],
  },
  {
    key: 'thermalCabLevel',
    name: 'Halogen Fog & Bounty Rig',
    shortLabel: 'Halogen Rig',
    description: 'Pushes back blizzard fog density and boosts municipal coin payout per tile.',
    baseCost: 220,
    unit: 'x',
    values: [1.0, 1.25, 1.5, 1.8, 2.2],
  },
];

export function getUpgradeCost(spec: UpgradeSpec, currentLevel: number): number {
  if (currentLevel >= 5) return 0;
  return Math.round(spec.baseCost * Math.pow(1.65, currentLevel - 1));
}

export interface WeatherSpec {
  id: WeatherType;
  name: string;
  description: string;
  fogDensity: number;
  windStrength: number;
  snowfallRate: number;
  tractionMultiplier: number;
  scoreMultiplier: number;
  skyHex: string;
  skyColor: number;
  keyLightIntensity: number;
}

export const WEATHER_SPECS: Record<WeatherType, WeatherSpec> = {
  clear: {
    id: 'clear',
    name: 'Crisp Alpine Dawn',
    description: 'Golden morning sunlight, calm winds, and predictable road traction.',
    fogDensity: 0.008,
    windStrength: 0.0,
    snowfallRate: 0.15,
    tractionMultiplier: 1.0,
    scoreMultiplier: 1.0,
    skyHex: '#0F1B2D',
    skyColor: 0x0f1b2d,
    keyLightIntensity: 2.2,
  },
  flurry: {
    id: 'flurry',
    name: 'Steady Snow Flurry',
    description: 'Cozy snowfall that slowly dusts cleared lanes with fresh powder.',
    fogDensity: 0.014,
    windStrength: 1.2,
    snowfallRate: 0.55,
    tractionMultiplier: 0.88,
    scoreMultiplier: 1.25,
    skyHex: '#132035',
    skyColor: 0x132035,
    keyLightIntensity: 1.75,
  },
  blizzard: {
    id: 'blizzard',
    name: 'Whiteout Blizzard',
    description: 'Gale-force crosswinds, thick atmospheric fog, and rapid drift formation.',
    fogDensity: 0.025,
    windStrength: 3.8,
    snowfallRate: 1.2,
    tractionMultiplier: 0.76,
    scoreMultiplier: 1.6,
    skyHex: '#18263A',
    skyColor: 0x18263a,
    keyLightIntensity: 1.2,
  },
  ice_storm: {
    id: 'ice_storm',
    name: 'Glacial Ice Storm',
    description: 'Slick glazed asphalt requiring careful counter-steering and heavy torque.',
    fogDensity: 0.018,
    windStrength: 2.4,
    snowfallRate: 0.75,
    tractionMultiplier: 0.58,
    scoreMultiplier: 1.75,
    skyHex: '#0B1528',
    skyColor: 0x0b1528,
    keyLightIntensity: 1.5,
  },
};

export interface PlayerProgress {
  uid: string;
  displayName: string;
  coins: number;
  totalSnowCleared: number;
  bestCombo: number;
  highScore: number;
  equippedSkin: SkinId;
  unlockedSkins: SkinId[];
  plowWidthLevel: number;
  enginePowerLevel: number;
  tireGripLevel: number;
  saltSpreaderLevel: number;
  thermalCabLevel: number;
  dailyStreak: number;
  lastDailyDate: string;
}

export const DEFAULT_PLAYER_PROGRESS: PlayerProgress = {
  uid: 'local_operator',
  displayName: 'Operator #42',
  coins: 250,
  totalSnowCleared: 0,
  bestCombo: 1,
  highScore: 0,
  equippedSkin: 'classic_orange',
  unlockedSkins: ['classic_orange'],
  plowWidthLevel: 1,
  enginePowerLevel: 1,
  tireGripLevel: 1,
  saltSpreaderLevel: 1,
  thermalCabLevel: 1,
  dailyStreak: 0,
  lastDailyDate: '',
};

// Seeded PRNG (Mulberry32) for deterministic Daily Challenges & Procedural Maps
export function createSeededRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function getTodayDateSeed(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createRandomId(prefix: string): string {
  return `${prefix}_${Math.floor(1000 + Math.random() * 9000)}`;
}

export interface DailyChallengeInfo {
  dateSeed: string;
  title: string;
  weather: WeatherType;
  targetScore: number;
  rewardCoins: number;
  timeLimitSec: number;
}

export function getDailyChallengeInfo(dateSeed = getTodayDateSeed()): DailyChallengeInfo {
  const rng = createSeededRng(`daily-${dateSeed}`);
  const weatherPool: WeatherType[] = ['flurry', 'blizzard', 'ice_storm', 'clear'];
  const weather = weatherPool[Math.floor(rng() * weatherPool.length)];
  const prefixes = ['Frostpeak', 'Pinehollow', 'Glacier Pass', 'Nordic Valley', 'Timber Creek'];
  const suffixes = ['Emergency Dispatch', 'Morning Commute', 'Supply Route', 'Town Square Clearout'];
  const title = `${prefixes[Math.floor(rng() * prefixes.length)]} ${suffixes[Math.floor(rng() * suffixes.length)]}`;
  const targetScore = 4500 + Math.floor(rng() * 6) * 500;
  const rewardCoins = 500 + Math.floor(rng() * 4) * 100;
  return {
    dateSeed,
    title,
    weather,
    targetScore,
    rewardCoins,
    timeLimitSec: 95,
  };
}

export interface SnowCell {
  id: number;
  gx: number;
  gz: number;
  x: number;
  z: number;
  depth: number; // 0 = cleared, 1 = light powder (0.22m), 2 = medium drift (0.48m), 3 = packed bank (0.85m)
  maxDepth: number;
  isIcePatch: boolean;
}

export interface CabinPlacement {
  x: number;
  z: number;
  rotationY: number;
  scale: number;
  roofColor: number;
}

export interface TreePlacement {
  x: number;
  z: number;
  scale: number;
  rotationY: number;
  tint: number;
}

export interface RockPlacement {
  x: number;
  z: number;
  scale: number;
  rotationY: number;
}

export type CameraPreset = 'isometric' | 'chase' | 'driver' | 'overhead';

export interface LampPlacement {
  x: number;
  z: number;
  rotationY: number;
}

export interface StrandedVehiclePlacement {
  id: number;
  x: number;
  z: number;
  rotationY: number;
  color: number;
  rescued: boolean;
}

export interface ProceduralWinterMap {
  seed: string;
  snowCells: SnowCell[];
  cabins: CabinPlacement[];
  trees: TreePlacement[];
  rocks: RockPlacement[];
  lamps: LampPlacement[];
  strandedVehicles: StrandedVehiclePlacement[];
}

export function generateProceduralWinterMap(seed: string): ProceduralWinterMap {
  const rng = createSeededRng(seed);
  const snowCells: SnowCell[] = [];
  const cabins: CabinPlacement[] = [];
  const trees: TreePlacement[] = [];
  const rocks: RockPlacement[] = [];
  const lamps: LampPlacement[] = [];
  const strandedVehicles: StrandedVehiclePlacement[] = [];

  // Grid spans -34 to +34 in world units (step = 1.6m -> 43x43 grid)
  const step = 1.6;
  const halfExtent = 32;
  const gridRadius = Math.floor(halfExtent / step);

  // Determine procedural road parameters from seed
  const ringRadius = 17.5 + (rng() - 0.5) * 3.0;
  const diagAngle = rng() * Math.PI;
  const sinD = Math.sin(diagAngle);
  const cosD = Math.cos(diagAngle);

  const isRoadCoordinate = (x: number, z: number): boolean => {
    const distOrigin = Math.hypot(x, z);
    // Central town plaza
    if (distOrigin < 7.2) return true;
    // Outer ring boulevard
    if (Math.abs(distOrigin - ringRadius) < 3.4) return true;
    // North-South & East-West avenues
    if (Math.abs(x) < 3.2 && Math.abs(z) < ringRadius + 8) return true;
    if (Math.abs(z) < 3.2 && Math.abs(x) < ringRadius + 8) return true;
    // Seed-rotated scenic bypass lane
    const proj = Math.abs(x * cosD + z * sinD);
    if (proj < 2.7 && distOrigin < ringRadius + 4) return true;
    return false;
  };

  let idCounter = 0;
  for (let gx = -gridRadius; gx <= gridRadius; gx++) {
    for (let gz = -gridRadius; gz <= gridRadius; gz++) {
      const x = gx * step;
      const z = gz * step;
      // Leave immediate spawn center (0,0) clear so truck starts cleanly grounded
      if (Math.hypot(x, z) < 3.4) continue;

      if (isRoadCoordinate(x, z)) {
        const noise = rng();
        let depth = 1;
        if (noise > 0.82) depth = 3; // Heavy packed snowbank
        else if (noise > 0.42) depth = 2; // Medium drift
        const isIcePatch = rng() > 0.84;

        snowCells.push({
          id: idCounter++,
          gx,
          gz,
          x,
          z,
          depth,
          maxDepth: depth,
          isIcePatch,
        });
      }
    }
  }

  // Place cozy winter cabins in non-road quadrants
  const cabinCandidates = [
    { x: -10, z: -10 },
    { x: 10, z: -10 },
    { x: -10, z: 10 },
    { x: 10, z: 10 },
    { x: -24, z: -12 },
    { x: 24, z: -12 },
    { x: -24, z: 12 },
    { x: 24, z: 12 },
    { x: -12, z: -25 },
    { x: 12, z: 25 },
  ];

  const roofPalette = [0x991b1b, 0x1e3a8a, 0x065f46, 0x78350f, 0x334155];
  for (const cand of cabinCandidates) {
    const cx = cand.x + (rng() - 0.5) * 2.2;
    const cz = cand.z + (rng() - 0.5) * 2.2;
    if (!isRoadCoordinate(cx, cz) && !isRoadCoordinate(cx + 2, cz + 2) && !isRoadCoordinate(cx - 2, cz - 2)) {
      cabins.push({
        x: cx,
        z: cz,
        rotationY: Math.atan2(-cx, -cz) + (rng() - 0.5) * 0.4,
        scale: 0.9 + rng() * 0.25,
        roofColor: roofPalette[Math.floor(rng() * roofPalette.length)],
      });
    }
  }

  // Place 4 Stranded Priority Vehicles along the outer ring road for Rescue Bonus Points
  const vehicleColors = [0x0284c7, 0xdc2626, 0xd97706, 0x4f46e5];
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + (rng() - 0.5) * 0.45;
    const vx = Math.cos(angle) * ringRadius;
    const vz = Math.sin(angle) * ringRadius;
    strandedVehicles.push({
      id: i,
      x: vx,
      z: vz,
      rotationY: angle + Math.PI / 2,
      color: vehicleColors[i % vehicleColors.length],
      rescued: false,
    });
  }

  // Place streetlamps along the plaza and main avenues
  const lampCoords = [
    { x: -4.2, z: -8 },
    { x: 4.2, z: -8 },
    { x: -4.2, z: 8 },
    { x: 4.2, z: 8 },
    { x: -8, z: -4.2 },
    { x: 8, z: -4.2 },
    { x: -8, z: 4.2 },
    { x: 8, z: 4.2 },
    { x: -4.2, z: -20 },
    { x: 4.2, z: 20 },
    { x: -20, z: 4.2 },
    { x: 20, z: -4.2 },
  ];
  for (const lc of lampCoords) {
    if (!isRoadCoordinate(lc.x, lc.z)) {
      lamps.push({
        x: lc.x,
        z: lc.z,
        rotationY: Math.atan2(-lc.x, -lc.z),
      });
    }
  }

  // Place procedural pine trees & perimeter forest barrier (Natural Outdoor Perimeter!)
  const treeTints = [0x14532d, 0x166534, 0x064e3b, 0x1e3a2f, 0x0f392b];
  for (let i = 0; i < 165; i++) {
    let tx = (rng() - 0.5) * 86;
    let tz = (rng() - 0.5) * 86;
    const dist = Math.hypot(tx, tz);

    // Push more trees to the natural perimeter grove (r = 28..45)
    if (i > 70 && dist < 27) {
      const angle = rng() * Math.PI * 2;
      const r = 27.5 + rng() * 17;
      tx = Math.cos(angle) * r;
      tz = Math.sin(angle) * r;
    }

    if (isRoadCoordinate(tx, tz)) continue;
    // Keep clear of cabins
    const nearCabin = cabins.some((c) => Math.hypot(c.x - tx, c.z - tz) < 4.5);
    if (nearCabin) continue;

    trees.push({
      x: tx,
      z: tz,
      scale: 0.85 + rng() * 0.35,
      rotationY: rng() * Math.PI * 2,
      tint: treeTints[Math.floor(rng() * treeTints.length)],
    });
  }

  // Place boulders / rock outcrops around the perimeter and off-road islands
  for (let i = 0; i < 48; i++) {
    const angle = rng() * Math.PI * 2;
    const r = i < 16 ? 9 + rng() * 16 : 26 + rng() * 15;
    const rx = Math.cos(angle) * r;
    const rz = Math.sin(angle) * r;
    if (isRoadCoordinate(rx, rz)) continue;
    const nearCabin = cabins.some((c) => Math.hypot(c.x - rx, c.z - rz) < 4.2);
    if (nearCabin) continue;

    rocks.push({
      x: rx,
      z: rz,
      scale: 0.75 + rng() * 0.55,
      rotationY: rng() * Math.PI * 2,
    });
  }

  return {
    seed,
    snowCells,
    cabins,
    trees,
    rocks,
    lamps,
    strandedVehicles,
  };
}
