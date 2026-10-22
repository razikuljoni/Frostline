'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  PlayerProgress,
  TRUCK_SKINS,
  UPGRADE_SPECS,
  WEATHER_SPECS,
  WeatherType,
  SkinId,
  CameraPreset,
  generateProceduralWinterMap,
  SnowCell,
} from '@/lib/game-data';
import { audioSynth } from '@/lib/audio-synth';

// Pre-allocated module-scope math helpers (Zero GC in render loop)
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _camTarget = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();

export interface RadarMarker {
  x: number;
  z: number;
  type: 'cabin' | 'rescue_pending' | 'rescue_done';
}

export interface LiveTelemetry {
  score: number;
  combo: number;
  comboTimerRatio: number; // 0..1
  clearedCount: number;
  totalCount: number;
  progressPct: number;
  speedKmh: number;
  coinsEarned: number;
  currentDepthLoad: number; // 0..3
  onIce: boolean;
  timeRemainingSec: number;
  x: number;
  z: number;
  angle: number;
  propertyHits: number;
  rescuedCount: number;
  totalRescues: number;
  turboCharge: number; // 0..100
  turboActive: boolean;
  lastEventBanner: string;
  lastEventTone: 'neutral' | 'penalty' | 'bonus';
  radarMarkers: RadarMarker[];
}

export interface RivalTelemetry {
  active: boolean;
  name: string;
  skin: SkinId;
  x: number;
  z: number;
  angle: number;
  score: number;
  progress: number;
}

export interface TouchControlState {
  forward: number; // -1, 0, 1
  turn: number; // -1, 0, 1
  turbo: boolean;
}

interface SnowPlowCanvasProps {
  gameState: 'title' | 'playing' | 'paused' | 'victory';
  mapSeed: string;
  weather: WeatherType;
  progress: PlayerProgress;
  cameraPreset: CameraPreset;
  saltActive: boolean;
  timeLimitSec: number; // 0 = endless/standard until 100%, >0 = timed daily/multiplayer
  rival: RivalTelemetry;
  touchControl: TouchControlState;
  onTelemetryUpdate: (t: LiveTelemetry) => void;
  onRunComplete: (finalStats: {
    score: number;
    maxCombo: number;
    clearedCount: number;
    coinsEarned: number;
    propertyHits: number;
    rescuedCount: number;
    safetyBonus: number;
  }) => void;
}

// Procedural CanvasTexture generator for soft radial contact shadows & snow surface bump
function createRadialShadowTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(6, 12, 24, 0.65)');
  grad.addColorStop(0.6, 'rgba(6, 12, 24, 0.28)');
  grad.addColorStop(1, 'rgba(6, 12, 24, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createAsphaltGridTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#192231';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 650; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 252, 252);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 36);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

interface TruckRig {
  group: THREE.Group;
  cabMesh: THREE.Mesh;
  glassMesh: THREE.Mesh;
  bladeGroup: THREE.Group;
  bladeMesh: THREE.Mesh;
  wheels: THREE.Mesh[];
  frontWheelPivots: THREE.Group[];
  spreaderDisc: THREE.Mesh;
  beaconLight: THREE.Mesh;
}

// Composite 11-Part Procedural Plow Truck (THREE.Group)
function buildPlowTruckRig(
  skinId: SkinId,
  plowWidthLevel: number,
  shadowTex: THREE.CanvasTexture,
  castShadow: boolean
): TruckRig {
  const skin = TRUCK_SKINS.find((s) => s.id === skinId) || TRUCK_SKINS[0];
  const group = new THREE.Group();

  // 1. Contact Shadow Plane (grounded at y = 0.02)
  const shadowGeo = new THREE.PlaneGeometry(3.8, 5.2);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.65,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.set(0, 0.02, 0.1);
  group.add(shadowMesh);

  // 2. Heavy Steel Chassis Frame (Primary silhouette base)
  const chassisMat = new THREE.MeshStandardMaterial({
    color: skin.trimColor,
    roughness: 0.78,
    metalness: 0.45,
  });
  const chassisGeo = new THREE.BoxGeometry(1.75, 0.38, 3.5);
  const chassisMesh = new THREE.Mesh(chassisGeo, chassisMat);
  chassisMesh.position.set(0, 0.48, 0);
  chassisMesh.castShadow = castShadow;
  chassisMesh.receiveShadow = true;
  group.add(chassisMesh);

  // 3. Beveled Cab Body & Engine Hood (ExtrudeGeometry with bevels + clearcoat car paint)
  const cabShape = new THREE.Shape();
  cabShape.moveTo(-1.55, 0);
  cabShape.lineTo(1.45, 0);
  cabShape.lineTo(1.45, 0.65);
  cabShape.lineTo(0.45, 0.72);
  cabShape.lineTo(0.15, 1.38);
  cabShape.lineTo(-1.15, 1.38);
  cabShape.lineTo(-1.25, 0.75);
  cabShape.lineTo(-1.55, 0.75);
  cabShape.closePath();

  const cabGeo = new THREE.ExtrudeGeometry(cabShape, {
    depth: 1.48,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.07,
    bevelSegments: 3,
  });
  cabGeo.rotateY(Math.PI / 2);
  cabGeo.translate(-0.74, 0.62, 0);
  cabGeo.computeVertexNormals();

  const cabMat = new THREE.MeshPhysicalMaterial({
    color: skin.cabColor,
    roughness: skin.roughness,
    metalness: skin.metalness,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
  });
  const cabMesh = new THREE.Mesh(cabGeo, cabMat);
  cabMesh.castShadow = castShadow;
  cabMesh.receiveShadow = true;
  group.add(cabMesh);

  // 4. Panoramic Cab Windshield & Side Glass
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.08,
    metalness: 0.15,
    clearcoat: 1.0,
  });
  const glassGeo = new THREE.BoxGeometry(1.52, 0.48, 1.12);
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.position.set(0, 1.58, -0.45);
  group.add(glassMesh);

  // 5. Curved Hydraulic V-Plow Blade (ExtrudeGeometry curved profile)
  const bladeGroup = new THREE.Group();
  bladeGroup.position.set(0, 0.46, 2.15);

  const plowCurve = new THREE.Shape();
  plowCurve.moveTo(0, 0);
  plowCurve.quadraticCurveTo(-0.32, 0.48, 0.08, 0.96);
  plowCurve.lineTo(0.22, 0.96);
  plowCurve.quadraticCurveTo(-0.14, 0.48, 0.16, 0);
  plowCurve.closePath();

  const baseBladeWidth = 2.4;
  const bladeGeo = new THREE.ExtrudeGeometry(plowCurve, {
    depth: baseBladeWidth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  bladeGeo.rotateY(Math.PI / 2);
  bladeGeo.translate(-baseBladeWidth / 2, -0.18, 0);
  bladeGeo.computeVertexNormals();

  const bladeMat = new THREE.MeshStandardMaterial({
    color: skin.bladeColor,
    metalness: 0.86,
    roughness: 0.22,
  });
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.castShadow = castShadow;
  bladeMesh.receiveShadow = true;
  const widthScale =
    UPGRADE_SPECS[0].values[Math.min(4, Math.max(0, plowWidthLevel - 1))] / baseBladeWidth;
  bladeMesh.scale.set(widthScale, 1, 1);
  bladeGroup.add(bladeMesh);

  // 6. Dual Hydraulic Lift Pistons & A-Frame Struts
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.95,
    roughness: 0.12,
  });
  const pistonGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.75, 12);
  pistonGeo.rotateX(Math.PI / 2);
  const leftPiston = new THREE.Mesh(pistonGeo, chromeMat);
  leftPiston.position.set(-0.45, 0.12, -0.35);
  const rightPiston = new THREE.Mesh(pistonGeo, chromeMat);
  rightPiston.position.set(0.45, 0.12, -0.35);
  bladeGroup.add(leftPiston, rightPiston);

  group.add(bladeGroup);

  // 7. 4 Heavy-Duty Off-Road Chained Wheels (with front steering pivots)
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.92,
    metalness: 0.08,
  });
  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.38, 20);
  wheelGeo.rotateZ(Math.PI / 2);

  const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.41, 12);
  hubGeo.rotateZ(Math.PI / 2);

  const wheels: THREE.Mesh[] = [];
  const frontWheelPivots: THREE.Group[] = [];
  const wheelCoords = [
    { x: -0.95, y: 0.44, z: 1.15, isFront: true },
    { x: 0.95, y: 0.44, z: 1.15, isFront: true },
    { x: -0.95, y: 0.44, z: -1.05, isFront: false },
    { x: 0.95, y: 0.44, z: -1.05, isFront: false },
  ];

  for (const wc of wheelCoords) {
    const pivot = new THREE.Group();
    pivot.position.set(wc.x, wc.y, wc.z);

    const wMesh = new THREE.Mesh(wheelGeo, tireMat);
    wMesh.castShadow = castShadow;
    const hMesh = new THREE.Mesh(hubGeo, chromeMat);
    wMesh.add(hMesh);

    pivot.add(wMesh);
    group.add(pivot);
    wheels.push(wMesh);
    if (wc.isFront) frontWheelPivots.push(pivot);
  }

  // 8. Dual Chrome Exhaust Stacks
  const stackGeo = new THREE.CylinderGeometry(0.065, 0.065, 1.35, 12);
  const leftStack = new THREE.Mesh(stackGeo, chromeMat);
  leftStack.position.set(-0.82, 1.55, -0.98);
  const rightStack = new THREE.Mesh(stackGeo, chromeMat);
  rightStack.position.set(0.82, 1.55, -0.98);
  group.add(leftStack, rightStack);

  // 9. Roof Amber Beacon Lightbar
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  const beaconGeo = new THREE.BoxGeometry(0.95, 0.14, 0.26);
  const beaconLight = new THREE.Mesh(beaconGeo, beaconMat);
  beaconLight.position.set(0, 2.12, -0.45);
  group.add(beaconLight);

  // 10. Front Halogen Headlight Pods
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xfef08a,
    emissiveIntensity: 2.2,
    roughness: 0.1,
  });
  const hlGeo = new THREE.BoxGeometry(0.24, 0.16, 0.1);
  const leftHl = new THREE.Mesh(hlGeo, headlightMat);
  leftHl.position.set(-0.55, 0.95, 1.52);
  const rightHl = new THREE.Mesh(hlGeo, headlightMat);
  rightHl.position.set(0.55, 0.95, 1.52);
  group.add(leftHl, rightHl);

  // 11. Rear Thermal Salt Spreader Hopper (LatheGeometry) & Spinner Disc
  const hopperPts = [
    new THREE.Vector2(0.18, 0),
    new THREE.Vector2(0.62, 0.55),
    new THREE.Vector2(0.62, 0.82),
    new THREE.Vector2(0.0, 0.82),
  ];
  const hopperGeo = new THREE.LatheGeometry(hopperPts, 8);
  const hopperMat = new THREE.MeshStandardMaterial({
    color: skin.accentColor,
    roughness: 0.4,
    metalness: 0.6,
  });
  const hopperMesh = new THREE.Mesh(hopperGeo, hopperMat);
  hopperMesh.position.set(0, 0.72, -1.25);
  hopperMesh.castShadow = castShadow;
  group.add(hopperMesh);

  const discGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12);
  const spreaderDisc = new THREE.Mesh(discGeo, chromeMat);
  spreaderDisc.position.set(0, 0.35, -1.85);
  group.add(spreaderDisc);

  return {
    group,
    cabMesh,
    glassMesh,
    bladeGroup,
    bladeMesh,
    wheels,
    frontWheelPivots,
    spreaderDisc,
    beaconLight,
  };
}

// Composite 6-Part Cozy Winter Cabin (THREE.Group)
function buildWinterCabinGroup(
  roofColor: number,
  shadowTex: THREE.CanvasTexture,
  castShadow: boolean
): THREE.Group {
  const cabin = new THREE.Group();

  // 1. Contact shadow
  const shGeo = new THREE.PlaneGeometry(5.6, 5.6);
  shGeo.rotateX(-Math.PI / 2);
  const shMesh = new THREE.Mesh(
    shGeo,
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    })
  );
  shMesh.position.y = 0.02;
  cabin.add(shMesh);

  // 2. Timber Cabin Walls
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x78350f,
    roughness: 0.85,
    metalness: 0.05,
  });
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 3.2), wallMat);
  wallMesh.position.y = 1.1;
  wallMesh.castShadow = castShadow;
  wallMesh.receiveShadow = true;
  cabin.add(wallMesh);

  // 3. Pitched Roof with Thick Snow Cap (ExtrudeGeometry)
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-2.15, 0);
  roofShape.lineTo(2.15, 0);
  roofShape.lineTo(0, 1.45);
  roofShape.closePath();

  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: 3.6,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 2,
  });
  roofGeo.translate(0, 2.15, -1.8);
  const roofMat = new THREE.MeshStandardMaterial({
    color: roofColor,
    roughness: 0.65,
    metalness: 0.15,
  });
  const roofMesh = new THREE.Mesh(roofGeo, roofMat);
  roofMesh.castShadow = castShadow;
  roofMesh.receiveShadow = true;
  cabin.add(roofMesh);

  // 4. Fluffy Snow Pillow on Roof
  const snowCapGeo = roofGeo.clone();
  snowCapGeo.scale(0.98, 0.35, 0.98);
  snowCapGeo.translate(0, 1.65, 0);
  const snowCapMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.9,
    metalness: 0.02,
  });
  const snowCapMesh = new THREE.Mesh(snowCapGeo, snowCapMat);
  cabin.add(snowCapMesh);

  // 5. Stone Chimney
  const chimMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.9,
    metalness: 0.1,
  });
  const chimMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.6, 0.55), chimMat);
  chimMesh.position.set(1.1, 2.9, -0.6);
  chimMesh.castShadow = castShadow;
  cabin.add(chimMesh);

  // 6. Warm Glowing Cozy Windows
  const winMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xf59e0b,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });
  const winGeo = new THREE.PlaneGeometry(0.68, 0.68);
  const win1 = new THREE.Mesh(winGeo, winMat);
  win1.position.set(-0.85, 1.2, 1.62);
  const win2 = new THREE.Mesh(winGeo, winMat);
  win2.position.set(0.85, 1.2, 1.62);
  cabin.add(win1, win2);

  return cabin;
}

// Composite 6-Part Stranded Priority Vehicle (THREE.Group)
function buildStrandedVehicleGroup(
  bodyColor: number,
  shadowTex: THREE.CanvasTexture,
  castShadow: boolean
): { group: THREE.Group; beaconRing: THREE.Mesh; snowDriftCap: THREE.Mesh } {
  const group = new THREE.Group();

  // 1. Contact shadow
  const shGeo = new THREE.PlaneGeometry(3.0, 4.4);
  shGeo.rotateX(-Math.PI / 2);
  const shMesh = new THREE.Mesh(
    shGeo,
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    })
  );
  shMesh.position.y = 0.02;
  group.add(shMesh);

  // 2. Lower SUV Body
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: bodyColor,
    roughness: 0.3,
    metalness: 0.5,
    clearcoat: 0.9,
  });
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 3.1), bodyMat);
  lowerBody.position.y = 0.52;
  lowerBody.castShadow = castShadow;
  group.add(lowerBody);

  // 3. Upper Cabin
  const upperCab = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.52, 1.85), bodyMat);
  upperCab.position.set(0, 1.02, -0.15);
  upperCab.castShadow = castShadow;
  group.add(upperCab);

  // 4. Frosted Windows
  const winMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    roughness: 0.25,
    metalness: 0.2,
  });
  const winMesh = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.4, 1.65), winMat);
  winMesh.position.set(0, 1.02, -0.15);
  group.add(winMesh);

  // 5. Heavy Snow Cap burying the hood (hides once rescued!)
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.9,
  });
  const snowDriftCap = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 10), snowMat);
  snowDriftCap.scale.set(1.1, 0.55, 1.45);
  snowDriftCap.position.set(0, 0.65, 0.65);
  group.add(snowDriftCap);

  // 6. Priority Rescue Ground Ring Indicator
  const ringGeo = new THREE.RingGeometry(2.1, 2.38, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const beaconRing = new THREE.Mesh(ringGeo, ringMat);
  beaconRing.position.y = 0.03;
  group.add(beaconRing);

  return { group, beaconRing, snowDriftCap };
}

export default function SnowPlowCanvas({
  gameState,
  mapSeed,
  weather,
  progress,
  cameraPreset,
  saltActive,
  timeLimitSec,
  rival,
  touchControl,
  onTelemetryUpdate,
  onRunComplete,
}: SnowPlowCanvasProps) {
  const canvasMountRef = useRef<HTMLDivElement>(null);

  const stateRef = useRef({
    gameState,
    mapSeed,
    weather,
    progress,
    cameraPreset,
    saltActive,
    timeLimitSec,
    rival,
    touchControl,
    onTelemetryUpdate,
    onRunComplete,
  });

  useEffect(() => {
    stateRef.current = {
      gameState,
      mapSeed,
      weather,
      progress,
      cameraPreset,
      saltActive,
      timeLimitSec,
      rival,
      touchControl,
      onTelemetryUpdate,
      onRunComplete,
    };
  }, [
    gameState,
    mapSeed,
    weather,
    progress,
    cameraPreset,
    saltActive,
    timeLimitSec,
    rival,
    touchControl,
    onTelemetryUpdate,
    onRunComplete,
  ]);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software-WebGL Guard
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Scene & Studio Environment Map
    const scene = new THREE.Scene();
    const initialWeatherSpec = WEATHER_SPECS[stateRef.current.weather];
    scene.background = new THREE.Color(initialWeatherSpec.skyColor);
    scene.fog = new THREE.FogExp2(initialWeatherSpec.skyColor, initialWeatherSpec.fogDensity);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.35,
      190
    );
    camera.position.set(22, 24, 22);
    camera.lookAt(0, 0, 0);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const shadowTex = createRadialShadowTexture(maxAnisotropy);
    const asphaltTex = createAsphaltGridTexture(maxAnisotropy);

    // 3. Balanced 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4d6, initialWeatherSpec.keyLightIntensity);
    keyLight.position.set(28, 42, 24);
    keyLight.castShadow = !isSoftwareGl;
    const d = 38;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 110;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
    rimLight.position.set(-26, 22, -28);
    scene.add(rimLight);

    // 4. Expansive Ground Terrain
    const outerSnowPlaneGeo = new THREE.PlaneGeometry(240, 240);
    outerSnowPlaneGeo.rotateX(-Math.PI / 2);
    const outerSnowMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.92,
      metalness: 0.04,
    });
    const outerSnowPlane = new THREE.Mesh(outerSnowPlaneGeo, outerSnowMat);
    outerSnowPlane.position.y = -0.04;
    outerSnowPlane.receiveShadow = true;
    scene.add(outerSnowPlane);

    const roadPlaneGeo = new THREE.CircleGeometry(33.5, 64);
    roadPlaneGeo.rotateX(-Math.PI / 2);
    const roadPlaneMat = new THREE.MeshStandardMaterial({
      map: asphaltTex,
      roughness: 0.72,
      metalness: 0.15,
    });
    const roadPlane = new THREE.Mesh(roadPlaneGeo, roadPlaneMat);
    roadPlane.position.y = 0.0;
    roadPlane.receiveShadow = true;
    scene.add(roadPlane);

    // 5. Build Hero Plow Truck & Rival Multiplayer Plow Truck
    let currentSkinId = stateRef.current.progress.equippedSkin;
    let currentPlowLevel = stateRef.current.progress.plowWidthLevel;

    const playerRig = buildPlowTruckRig(
      currentSkinId,
      currentPlowLevel,
      shadowTex,
      !isSoftwareGl
    );
    scene.add(playerRig.group);

    const truckHeadlight = new THREE.PointLight(0xfef08a, 3.4, 18, 1.5);
    truckHeadlight.position.set(0, 1.2, 2.8);
    playerRig.group.add(truckHeadlight);

    const rivalRig = buildPlowTruckRig(
      stateRef.current.rival.skin || 'arctic_rescue',
      2,
      shadowTex,
      !isSoftwareGl
    );
    rivalRig.group.visible = false;
    scene.add(rivalRig.group);

    // 6. Dynamic Map Group & Instanced Meshes
    const worldPropsGroup = new THREE.Group();
    scene.add(worldPropsGroup);

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.1, 8);
    trunkGeo.translate(0, 0.55, 0);
    const tier1Geo = new THREE.ConeGeometry(1.25, 1.9, 8);
    tier1Geo.translate(0, 1.75, 0);
    const tier2Geo = new THREE.ConeGeometry(0.98, 1.6, 8);
    tier2Geo.translate(0, 2.75, 0);
    const tier3Geo = new THREE.ConeGeometry(0.68, 1.3, 8);
    tier3Geo.translate(0, 3.6, 0);
    const mergedTreeGeo = BufferGeometryUtils.mergeGeometries([
      trunkGeo,
      tier1Geo,
      tier2Geo,
      tier3Geo,
    ]);
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.05,
    });

    const rockGeo = new THREE.DodecahedronGeometry(0.85, 1);
    rockGeo.scale(1.2, 0.78, 1.0);
    rockGeo.translate(0, 0.45, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.88,
      metalness: 0.12,
    });

    const MAX_SNOW_CELLS = 1600;
    const snowCellGeo = new THREE.BoxGeometry(1.56, 1.0, 1.56);
    snowCellGeo.translate(0, 0.5, 0);
    const snowCellMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.06,
    });
    const snowInstanced = new THREE.InstancedMesh(snowCellGeo, snowCellMat, MAX_SNOW_CELLS);
    snowInstanced.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_SNOW_CELLS * 3),
      3
    );
    snowInstanced.castShadow = !isSoftwareGl;
    snowInstanced.receiveShadow = true;
    snowInstanced.frustumCulled = false;
    scene.add(snowInstanced);

    // Pooled 3D Snow Spray & Salt Particle System
    const PARTICLE_COUNT = 220;
    const particleGeo = new THREE.DodecahedronGeometry(0.14, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.6,
      metalness: 0.1,
    });
    const particleInstanced = new THREE.InstancedMesh(
      particleGeo,
      particleMat,
      PARTICLE_COUNT
    );
    particleInstanced.frustumCulled = false;
    scene.add(particleInstanced);

    interface PooledParticle {
      active: boolean;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      scale: number;
      life: number;
      maxLife: number;
    }
    const particles: PooledParticle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      active: false,
      x: 0,
      y: -10,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      scale: 1,
      life: 0,
      maxLife: 1,
    }));
    let particleCursor = 0;

    function spawnSnowBurst(wx: number, wz: number, count: number, boostScale = 1) {
      for (let i = 0; i < count; i++) {
        const p = particles[particleCursor];
        particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
        p.active = true;
        p.x = wx + (Math.random() - 0.5) * 1.1;
        p.y = 0.25 + Math.random() * 0.35;
        p.z = wz + (Math.random() - 0.5) * 1.1;
        const angle = Math.random() * Math.PI * 2;
        const speed = (2.4 + Math.random() * 4.5) * boostScale;
        p.vx = Math.cos(angle) * speed;
        p.vy = (3.2 + Math.random() * 4.2) * boostScale;
        p.vz = Math.sin(angle) * speed;
        p.scale = (0.7 + Math.random() * 0.9) * boostScale;
        p.life = 0;
        p.maxLife = 0.42 + Math.random() * 0.35;
      }
    }

    // Weather Falling Snowflakes
    const SNOWFLAKE_COUNT = 600;
    const flakePositions = new Float32Array(SNOWFLAKE_COUNT * 3);
    for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
      flakePositions[i * 3] = (Math.random() - 0.5) * 75;
      flakePositions[i * 3 + 1] = Math.random() * 28;
      flakePositions[i * 3 + 2] = (Math.random() - 0.5) * 75;
    }
    const flakeGeo = new THREE.BufferGeometry();
    flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePositions, 3));
    const flakeMat = new THREE.PointsMaterial({
      color: 0xf8fafc,
      size: 0.22,
      transparent: true,
      opacity: 0.8,
    });
    const flakePoints = new THREE.Points(flakeGeo, flakeMat);
    scene.add(flakePoints);

    // Simulation State
    let activeMapSeed = '';
    let snowCells: SnowCell[] = [];
    let totalSnowCells = 1;
    let clearedSnowCells = 0;
    let cabinObstacleCoords: { x: number; z: number; r: number }[] = [];
    let rockObstacleCoords: { x: number; z: number; r: number }[] = [];
    let strandedTargets: {
      id: number;
      x: number;
      z: number;
      rescued: boolean;
      beaconRing: THREE.Mesh;
      snowDriftCap: THREE.Mesh;
    }[] = [];

    let truckX = 0;
    let truckZ = 0;
    let truckAngle = 0;
    let truckSpeed = 0;
    let truckLateralVel = 0;
    let wheelSpinAngle = 0;
    let steerAngle = 0;

    let runScore = 0;
    let combo = 1;
    let maxCombo = 1;
    let comboTimer = 0;
    let coinsEarned = 0;
    let timeRemaining = 0;
    let hitstopTimer = 0;
    let cameraShake = 0;
    let roundCompletedTriggered = false;

    // New Penalty, Rescue & Overdrive Turbo State
    let propertyHits = 0;
    let collisionPenaltyCooldown = 0;
    let rescuedCount = 0;
    let turboCharge = 50; // Starts at 50% ready
    let wasTurboActive = false;
    let lastEventBanner = 'Clear village roads · Avoid hitting homes (-150 pts)';
    let lastEventTone: 'neutral' | 'penalty' | 'bonus' = 'neutral';
    let eventBannerTimer = 4.0;

    function triggerBanner(msg: string, tone: 'neutral' | 'penalty' | 'bonus', duration = 3.2) {
      lastEventBanner = msg;
      lastEventTone = tone;
      eventBannerTimer = duration;
    }

    function updateSnowCellInstance(cell: SnowCell) {
      if (cell.depth <= 0) {
        _pos.set(cell.x, -5, cell.z);
        _scale.set(0.001, 0.001, 0.001);
      } else {
        const height = cell.depth === 1 ? 0.2 : cell.depth === 2 ? 0.45 : 0.82;
        _pos.set(cell.x, 0.01, cell.z);
        _scale.set(1, height, 1);
      }
      _quat.identity();
      _mat4.compose(_pos, _quat, _scale);
      snowInstanced.setMatrixAt(cell.id, _mat4);

      if (cell.isIcePatch && cell.depth === 1) {
        _color.setHex(0x93c5fd);
      } else if (cell.depth === 3) {
        _color.setHex(0xe2e8f0);
      } else if (cell.depth === 2) {
        _color.setHex(0xf1f5f9);
      } else {
        _color.setHex(0xf8fafc);
      }
      snowInstanced.setColorAt(cell.id, _color);
    }

    function rebuildMap(seed: string) {
      activeMapSeed = seed;
      const mapData = generateProceduralWinterMap(seed);
      snowCells = mapData.snowCells.slice(0, MAX_SNOW_CELLS);
      totalSnowCells = Math.max(1, snowCells.length);
      clearedSnowCells = 0;

      while (worldPropsGroup.children.length > 0) {
        const child = worldPropsGroup.children[0];
        worldPropsGroup.remove(child);
      }
      cabinObstacleCoords = [];
      rockObstacleCoords = [];
      strandedTargets = [];

      // Populate cabins
      for (const c of mapData.cabins) {
        const cabinGroup = buildWinterCabinGroup(c.roofColor, shadowTex, !isSoftwareGl);
        cabinGroup.position.set(c.x, 0, c.z);
        cabinGroup.rotation.y = c.rotationY;
        cabinGroup.scale.setScalar(c.scale);
        worldPropsGroup.add(cabinGroup);
        cabinObstacleCoords.push({ x: c.x, z: c.z, r: 2.35 * c.scale });
      }

      // Populate Stranded Priority Vehicles for Rescue Bonus
      for (const sv of mapData.strandedVehicles) {
        const built = buildStrandedVehicleGroup(sv.color, shadowTex, !isSoftwareGl);
        built.group.position.set(sv.x, 0, sv.z);
        built.group.rotation.y = sv.rotationY;
        worldPropsGroup.add(built.group);
        strandedTargets.push({
          id: sv.id,
          x: sv.x,
          z: sv.z,
          rescued: false,
          beaconRing: built.beaconRing,
          snowDriftCap: built.snowDriftCap,
        });
      }

      // Populate Instanced Pine Trees
      if (mapData.trees.length > 0) {
        const treeInst = new THREE.InstancedMesh(
          mergedTreeGeo,
          treeMat,
          mapData.trees.length
        );
        treeInst.castShadow = !isSoftwareGl;
        treeInst.receiveShadow = true;
        mapData.trees.forEach((t, idx) => {
          _pos.set(t.x, 0, t.z);
          _euler.set(0, t.rotationY, 0);
          _quat.setFromEuler(_euler);
          _scale.setScalar(t.scale);
          _mat4.compose(_pos, _quat, _scale);
          treeInst.setMatrixAt(idx, _mat4);
          _color.setHex(t.tint);
          treeInst.setColorAt(idx, _color);
        });
        treeInst.instanceMatrix.needsUpdate = true;
        if (treeInst.instanceColor) treeInst.instanceColor.needsUpdate = true;
        treeInst.computeBoundingSphere();
        worldPropsGroup.add(treeInst);
      }

      // Populate Instanced Rocks
      if (mapData.rocks.length > 0) {
        const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, mapData.rocks.length);
        rockInst.castShadow = !isSoftwareGl;
        rockInst.receiveShadow = true;
        mapData.rocks.forEach((r, idx) => {
          _pos.set(r.x, 0, r.z);
          _euler.set(0, r.rotationY, 0);
          _quat.setFromEuler(_euler);
          _scale.setScalar(r.scale);
          _mat4.compose(_pos, _quat, _scale);
          rockInst.setMatrixAt(idx, _mat4);
          rockObstacleCoords.push({ x: r.x, z: r.z, r: 0.9 * r.scale });
        });
        rockInst.instanceMatrix.needsUpdate = true;
        rockInst.computeBoundingSphere();
        worldPropsGroup.add(rockInst);
      }

      // Populate Snow Cells
      for (let i = 0; i < MAX_SNOW_CELLS; i++) {
        if (i < snowCells.length) {
          updateSnowCellInstance(snowCells[i]);
        } else {
          _pos.set(0, -10, 0);
          _scale.setScalar(0.001);
          _mat4.compose(_pos, _quat.identity(), _scale);
          snowInstanced.setMatrixAt(i, _mat4);
        }
      }
      snowInstanced.instanceMatrix.needsUpdate = true;
      if (snowInstanced.instanceColor) snowInstanced.instanceColor.needsUpdate = true;

      // Reset Truck & Run Stats
      truckX = 0;
      truckZ = 0;
      truckAngle = 0;
      truckSpeed = 0;
      truckLateralVel = 0;
      runScore = 0;
      combo = 1;
      maxCombo = 1;
      comboTimer = 0;
      coinsEarned = 0;
      propertyHits = 0;
      collisionPenaltyCooldown = 0;
      rescuedCount = 0;
      turboCharge = 50;
      timeRemaining = stateRef.current.timeLimitSec;
      roundCompletedTriggered = false;
      triggerBanner('Clear village roads · Avoid hitting homes (-150 pts)', 'neutral', 4.5);
    }

    rebuildMap(stateRef.current.mapSeed);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Keyboard & Touch Input Handling
    const heldKeys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      heldKeys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      heldKeys.delete(e.code);
    };
    const onBlur = () => {
      heldKeys.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let isDisposed = false;
    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const clock = new THREE.Clock();
    let lastTelemetryPush = 0;

    function tick() {
      if (isDisposed) return;
      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.05);
      const elapsed = clock.getElapsedTime();
      const st = stateRef.current;

      if (st.mapSeed !== activeMapSeed) {
        rebuildMap(st.mapSeed);
      }

      if (collisionPenaltyCooldown > 0) {
        collisionPenaltyCooldown = Math.max(0, collisionPenaltyCooldown - dt);
      }
      if (eventBannerTimer > 0) {
        eventBannerTimer = Math.max(0, eventBannerTimer - dt);
        if (eventBannerTimer === 0) {
          lastEventBanner = '';
          lastEventTone = 'neutral';
        }
      }

      // Sync truck skin or blade width if upgraded
      if (st.progress.equippedSkin !== currentSkinId) {
        currentSkinId = st.progress.equippedSkin;
        const skin = TRUCK_SKINS.find((s) => s.id === currentSkinId) || TRUCK_SKINS[0];
        const cabMat = playerRig.cabMesh.material as THREE.MeshPhysicalMaterial;
        cabMat.color.setHex(skin.cabColor);
        cabMat.metalness = skin.metalness;
        cabMat.roughness = skin.roughness;
        const bladeMat = playerRig.bladeMesh.material as THREE.MeshStandardMaterial;
        bladeMat.color.setHex(skin.bladeColor);
      }

      if (st.progress.plowWidthLevel !== currentPlowLevel) {
        currentPlowLevel = st.progress.plowWidthLevel;
        const wVal =
          UPGRADE_SPECS[0].values[Math.min(4, Math.max(0, currentPlowLevel - 1))] / 2.4;
        playerRig.bladeMesh.scale.set(wVal, 1, 1);
      }

      // Update Weather Atmosphere & Fog smoothly
      const wSpec = WEATHER_SPECS[st.weather];
      _color.setHex(wSpec.skyColor);
      (scene.background as THREE.Color).lerp(_color, 1 - Math.exp(-3 * dt));
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(scene.background as THREE.Color);
      const fogReduction = (st.progress.thermalCabLevel - 1) * 0.0022;
      const targetFogDensity = Math.max(0.005, wSpec.fogDensity - fogReduction);
      fog.density = THREE.MathUtils.damp(fog.density, targetFogDensity, 3, dt);
      keyLight.intensity = THREE.MathUtils.damp(
        keyLight.intensity,
        wSpec.keyLightIntensity,
        3,
        dt
      );

      // Animate Falling Snowflakes
      const posAttr = flakeGeo.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const fallSpeed = 3.5 + wSpec.snowfallRate * 6.5;
      const windX = wSpec.windStrength * 2.2;
      for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
        arr[i * 3] += windX * dt;
        arr[i * 3 + 1] -= fallSpeed * dt;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 26;
          arr[i * 3] = truckX + (Math.random() - 0.5) * 65;
          arr[i * 3 + 2] = truckZ + (Math.random() - 0.5) * 65;
        }
      }
      posAttr.needsUpdate = true;

      // Update Rival Truck in Multiplayer
      if (st.rival.active) {
        rivalRig.group.visible = true;
        rivalRig.group.position.x = THREE.MathUtils.damp(
          rivalRig.group.position.x,
          st.rival.x,
          10,
          dt
        );
        rivalRig.group.position.z = THREE.MathUtils.damp(
          rivalRig.group.position.z,
          st.rival.z,
          10,
          dt
        );
        rivalRig.group.rotation.y = THREE.MathUtils.damp(
          rivalRig.group.rotation.y,
          st.rival.angle,
          10,
          dt
        );
      } else {
        rivalRig.group.visible = false;
      }

      let currentDepthLoad = 0;
      let onIcePatch = false;
      let isTurboActiveNow = false;

      if (st.gameState === 'title') {
        const demoAngle = elapsed * 0.35;
        truckX = Math.sin(demoAngle) * 12;
        truckZ = Math.cos(demoAngle) * 12;
        truckAngle = demoAngle + Math.PI / 2;
        playerRig.group.position.set(truckX, 0, truckZ);
        playerRig.group.rotation.y = truckAngle;

        for (const w of playerRig.wheels) {
          w.rotation.x += dt * 4.5;
        }

        const camOrbit = elapsed * 0.16;
        _desiredCamPos.set(
          Math.cos(camOrbit) * 28,
          21,
          Math.sin(camOrbit) * 28
        );
        camera.position.lerp(_desiredCamPos, 1 - Math.exp(-3 * dt));
        camera.lookAt(0, 1.2, 0);
        audioSynth.updateTelemetry(0, 0, 0, false);
      } else if (st.gameState === 'playing') {
        if (hitstopTimer > 0) {
          hitstopTimer -= dt;
        } else {
          // Timed challenge countdown
          if (st.timeLimitSec > 0) {
            timeRemaining = Math.max(0, timeRemaining - dt);
            if (timeRemaining <= 0 && !roundCompletedTriggered) {
              roundCompletedTriggered = true;
              const safetyBonus = propertyHits === 0 ? 500 : 0;
              runScore += safetyBonus;
              if (propertyHits === 0) coinsEarned += 75;
              audioSynth.playRoundComplete();
              st.onRunComplete({
                score: runScore,
                maxCombo,
                clearedCount: clearedSnowCells,
                coinsEarned,
                propertyHits,
                rescuedCount,
                safetyBonus,
              });
            }
          }

          // Upgrade multipliers
          const bladeWidthM =
            UPGRADE_SPECS[0].values[Math.min(4, st.progress.plowWidthLevel - 1)];
          const torqueFactor = 1 + (st.progress.enginePowerLevel - 1) * 0.16;
          const gripFactor = 0.65 + (st.progress.tireGripLevel - 1) * 0.085;
          const maxComboWindow =
            UPGRADE_SPECS[3].values[Math.min(4, st.progress.saltSpreaderLevel - 1)];
          const coinBountyMult =
            UPGRADE_SPECS[4].values[Math.min(4, st.progress.thermalCabLevel - 1)];

          // Combine Keyboard & Responsive Touch Controls
          const kbForward =
            (heldKeys.has('KeyW') || heldKeys.has('ArrowUp') ? 1 : 0) -
            (heldKeys.has('KeyS') || heldKeys.has('ArrowDown') ? 1 : 0);
          const kbTurn =
            (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft') ? 1 : 0) -
            (heldKeys.has('KeyD') || heldKeys.has('ArrowRight') ? 1 : 0);

          const forwardInput =
            kbForward !== 0 ? kbForward : st.touchControl.forward;
          const turnInput = kbTurn !== 0 ? kbTurn : st.touchControl.turn;

          // Overdrive Hydraulic Turbo Boost (ShiftLeft / ShiftRight / Touch Turbo)
          const wantsTurbo =
            heldKeys.has('ShiftLeft') ||
            heldKeys.has('ShiftRight') ||
            st.touchControl.turbo;

          if (wantsTurbo && turboCharge > 4 && Math.abs(forwardInput) > 0) {
            isTurboActiveNow = true;
            turboCharge = Math.max(0, turboCharge - 26 * dt);
            if (!wasTurboActive) {
              audioSynth.playTurboEngage();
            }
          } else {
            isTurboActiveNow = false;
            turboCharge = Math.min(100, turboCharge + 3.5 * dt);
          }
          wasTurboActive = isTurboActiveNow;

          const turboSpeedMult = isTurboActiveNow ? 1.48 : 1.0;
          const maxSpeed =
            14.5 * (1 + (st.progress.enginePowerLevel - 1) * 0.07) * turboSpeedMult;
          const accel = 22.0 * torqueFactor * (isTurboActiveNow ? 1.4 : 1.0);

          if (forwardInput !== 0) {
            truckSpeed += forwardInput * accel * dt;
          } else {
            truckSpeed = THREE.MathUtils.damp(truckSpeed, 0, 4.2, dt);
          }
          truckSpeed = THREE.MathUtils.clamp(truckSpeed, -maxSpeed * 0.55, maxSpeed);

          // Steering response scaled by tire grip & weather traction
          const effectiveGrip = Math.min(1.0, gripFactor * wSpec.tractionMultiplier);
          const targetSteer = turnInput * 0.45;
          steerAngle = THREE.MathUtils.damp(steerAngle, targetSteer, 10, dt);
          for (const fp of playerRig.frontWheelPivots) {
            fp.rotation.y = steerAngle;
          }
          playerRig.bladeGroup.rotation.y = steerAngle * 0.35;

          if (Math.abs(truckSpeed) > 0.25) {
            const turnSign = truckSpeed >= 0 ? 1 : -1;
            const turnRate = 2.15 * (0.65 + effectiveGrip * 0.35);
            truckAngle += turnInput * turnRate * turnSign * dt;
            truckLateralVel +=
              -turnInput * Math.abs(truckSpeed) * (1.05 - effectiveGrip) * 2.2 * dt;
          }

          if (wSpec.windStrength > 0.5) {
            truckLateralVel += Math.sin(elapsed * 0.9) * wSpec.windStrength * 0.35 * dt;
          }
          truckLateralVel = THREE.MathUtils.damp(
            truckLateralVel,
            0,
            2.5 + effectiveGrip * 4.5,
            dt
          );

          const sinA = Math.sin(truckAngle);
          const cosA = Math.cos(truckAngle);
          let nextX = truckX + (sinA * truckSpeed + cosA * truckLateralVel) * dt;
          let nextZ = truckZ + (cosA * truckSpeed - sinA * truckLateralVel) * dt;

          // Natural perimeter boundary clamp
          const distFromCenter = Math.hypot(nextX, nextZ);
          if (distFromCenter > 31.5) {
            const scaleBack = 31.5 / distFromCenter;
            nextX *= scaleBack;
            nextZ *= scaleBack;
            truckSpeed *= 0.65;
          }

          // Cabin / Home Collision Check WITH MINUS SCORE PENALTY!
          for (const cab of cabinObstacleCoords) {
            const dx = nextX - cab.x;
            const dz = nextZ - cab.z;
            const dCab = Math.hypot(dx, dz);
            const minR = cab.r + 1.35;
            if (dCab < minR && dCab > 0.001) {
              nextX = cab.x + (dx / dCab) * minR;
              nextZ = cab.z + (dz / dCab) * minR;

              if (Math.abs(truckSpeed) > 2.2 && collisionPenaltyCooldown <= 0) {
                const penalty = 150;
                runScore = Math.max(0, runScore - penalty);
                combo = 1;
                comboTimer = 0;
                propertyHits++;
                collisionPenaltyCooldown = 1.15;
                hitstopTimer = 0.05;
                cameraShake = Math.min(0.55, cameraShake + 0.38);
                audioSynth.playCabinCollisionPenalty();
                spawnSnowBurst(nextX, nextZ, 10, 1.2);
                triggerBanner(
                  `Home Hit Penalty! -${penalty} pts · Combo Reset`,
                  'penalty',
                  3.0
                );
              }
              truckSpeed = -truckSpeed * 0.35;
            }
          }

          // Boulder / Rock Collision Check with Minus Score Penalty
          for (const rk of rockObstacleCoords) {
            const dx = nextX - rk.x;
            const dz = nextZ - rk.z;
            const dRk = Math.hypot(dx, dz);
            const minR = rk.r + 1.15;
            if (dRk < minR && dRk > 0.001) {
              nextX = rk.x + (dx / dRk) * minR;
              nextZ = rk.z + (dz / dRk) * minR;

              if (Math.abs(truckSpeed) > 3.0 && collisionPenaltyCooldown <= 0) {
                const penalty = 75;
                runScore = Math.max(0, runScore - penalty);
                combo = 1;
                comboTimer = 0;
                propertyHits++;
                collisionPenaltyCooldown = 1.0;
                hitstopTimer = 0.035;
                cameraShake = Math.min(0.45, cameraShake + 0.25);
                audioSynth.playCabinCollisionPenalty();
                triggerBanner(`Boulder Impact! -${penalty} pts`, 'penalty', 2.5);
              }
              truckSpeed *= 0.35;
            }
          }

          truckX = nextX;
          truckZ = nextZ;

          // Check Snow Plowing Collisions at front blade & rear salt spreader
          const bladeX = truckX + sinA * 2.15;
          const bladeZ = truckZ + cosA * 2.15;
          const plowHalfRadius = bladeWidthM * 0.54;
          const saltRadius = st.saltActive
            ? 1.85 + (st.progress.saltSpreaderLevel - 1) * 0.32
            : 0;

          let anyClearedThisFrame = false;
          for (let i = 0; i < snowCells.length; i++) {
            const cell = snowCells[i];
            if (cell.depth <= 0) continue;

            const distBlade = Math.hypot(cell.x - bladeX, cell.z - bladeZ);
            const distTruck = Math.hypot(cell.x - truckX, cell.z - truckZ);

            if (distBlade <= plowHalfRadius || (st.saltActive && distTruck <= saltRadius)) {
              const clearedDepth = cell.depth;
              currentDepthLoad = Math.max(currentDepthLoad, clearedDepth);
              if (cell.isIcePatch) onIcePatch = true;

              // Physical snow depth drag (bypassed when Overdrive Turbo is active!)
              if (!isTurboActiveNow) {
                const dragPenalty =
                  clearedDepth === 3
                    ? Math.max(0.76, 0.96 - 0.14 / torqueFactor)
                    : clearedDepth === 2
                    ? Math.max(0.88, 0.98 - 0.06 / torqueFactor)
                    : 0.992;
                truckSpeed *= dragPenalty;
              }

              if (clearedDepth === 3) {
                hitstopTimer = isTurboActiveNow ? 0.015 : 0.036;
                cameraShake = Math.min(0.45, cameraShake + 0.22);
                audioSynth.playHeavyDriftImpact();
                spawnSnowBurst(cell.x, cell.z, 12, isTurboActiveNow ? 1.65 : 1.35);
              } else {
                spawnSnowBurst(
                  cell.x,
                  cell.z,
                  clearedDepth === 2 ? 7 : 4,
                  isTurboActiveNow ? 1.35 : 1.0
                );
              }

              cell.depth = 0;
              clearedSnowCells++;
              anyClearedThisFrame = true;
              updateSnowCellInstance(cell);

              // Recharge Turbo from plowing snow
              if (!isTurboActiveNow) {
                turboCharge = Math.min(100, turboCharge + clearedDepth * 1.4);
              }

              comboTimer = maxComboWindow;
              combo = Math.min(50, combo + 1);
              if (combo > maxCombo) maxCombo = combo;

              const basePts = clearedDepth * 25;
              const earnedPts = Math.round(basePts * combo * wSpec.scoreMultiplier);
              runScore += earnedPts;
              coinsEarned += Math.max(1, Math.round(clearedDepth * 2 * coinBountyMult));

              audioSynth.playSnowClear(clearedDepth, combo);
            }
          }

          if (anyClearedThisFrame) {
            snowInstanced.instanceMatrix.needsUpdate = true;
            if (snowInstanced.instanceColor) snowInstanced.instanceColor.needsUpdate = true;

            // Check if any Stranded Priority Vehicles have been freed!
            for (const sv of strandedTargets) {
              if (sv.rescued) continue;
              const distToPlayer = Math.hypot(sv.x - bladeX, sv.z - bladeZ);
              if (distToPlayer < 4.2) {
                // Count remaining snow cells within 3.2m of the stranded vehicle
                let remainingNear = 0;
                for (let j = 0; j < snowCells.length; j++) {
                  const sc = snowCells[j];
                  if (sc.depth > 0 && Math.hypot(sc.x - sv.x, sc.z - sv.z) < 3.2) {
                    remainingNear++;
                  }
                }
                if (remainingNear <= 1) {
                  sv.rescued = true;
                  sv.snowDriftCap.visible = false;
                  (sv.beaconRing.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
                  rescuedCount++;
                  runScore += 600;
                  coinsEarned += 45;
                  audioSynth.playRescueBeaconCleared();
                  spawnSnowBurst(sv.x, sv.z, 16, 1.5);
                  triggerBanner(
                    `Stranded Vehicle Rescued (${rescuedCount}/${strandedTargets.length})! +600 pts · +45 cr`,
                    'bonus',
                    3.5
                  );
                }
              }
            }
          }

          // Combo decay
          if (comboTimer > 0) {
            comboTimer -= dt;
            if (comboTimer <= 0) {
              combo = 1;
              comboTimer = 0;
            }
          }

          // Check 100% map completion
          if (clearedSnowCells >= totalSnowCells && !roundCompletedTriggered) {
            roundCompletedTriggered = true;
            const safetyBonus = propertyHits === 0 ? 500 : 0;
            runScore += 2500 + safetyBonus;
            coinsEarned += 150 + (propertyHits === 0 ? 75 : 0);
            audioSynth.playRoundComplete();
            st.onRunComplete({
              score: runScore,
              maxCombo,
              clearedCount: clearedSnowCells,
              coinsEarned,
              propertyHits,
              rescuedCount,
              safetyBonus,
            });
          }

          // Update Truck Transform & Mechanical Sub-parts
          playerRig.group.position.set(truckX, 0, truckZ);
          playerRig.group.rotation.y = truckAngle;

          wheelSpinAngle += truckSpeed * dt * 2.1;
          for (const w of playerRig.wheels) {
            w.rotation.x = wheelSpinAngle;
          }
          if (st.saltActive) {
            playerRig.spreaderDisc.rotation.y += dt * 16;
          }

          audioSynth.updateTelemetry(
            Math.abs(truckSpeed) / maxSpeed,
            currentDepthLoad / 3,
            wSpec.windStrength,
            true
          );
        }

        // Smooth Exponentially Damped Camera Following (Isometric, Chase, Front Driver, Overhead)
        const sinA = Math.sin(truckAngle);
        const cosA = Math.cos(truckAngle);

        // Adjust FOV smoothly for Driver Cam & Turbo Overdrive
        const baseFov = st.cameraPreset === 'driver' ? 58 : 42;
        const targetFov = baseFov + (isTurboActiveNow ? 6 : 0);
        if (Math.abs(camera.fov - targetFov) > 0.1) {
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
          camera.updateProjectionMatrix();
        }

        if (st.cameraPreset === 'driver') {
          // Front Driver / Cockpit Hood View looking directly over the beveled hood and V-Plow blade!
          const engineBob = Math.sin(elapsed * 18) * Math.min(0.018, Math.abs(truckSpeed) * 0.0015);
          _desiredCamPos.set(
            truckX + sinA * 0.42,
            1.78 + engineBob,
            truckZ + cosA * 0.42
          );
          _camTarget.set(
            truckX + sinA * 11.5 + Math.cos(truckAngle) * steerAngle * 2.2,
            0.72,
            truckZ + cosA * 11.5 - Math.sin(truckAngle) * steerAngle * 2.2
          );
          // Snap closely in driver view so the hood never lags behind the camera
          camera.position.lerp(_desiredCamPos, 1 - Math.exp(-24 * dt));
          camera.lookAt(_camTarget);
        } else if (st.cameraPreset === 'chase') {
          _desiredCamPos.set(truckX - sinA * 15, 9.5, truckZ - cosA * 15);
          _camTarget.set(truckX + sinA * 5, 1.2, truckZ + cosA * 5);
          if (cameraShake > 0.005) {
            _desiredCamPos.x += (Math.random() - 0.5) * cameraShake;
            _desiredCamPos.y += (Math.random() - 0.5) * cameraShake;
            cameraShake = THREE.MathUtils.damp(cameraShake, 0, 8, dt);
          }
          camera.position.lerp(_desiredCamPos, 1 - Math.exp(-6.5 * dt));
          camera.lookAt(_camTarget);
        } else if (st.cameraPreset === 'overhead') {
          _desiredCamPos.set(truckX, 38, truckZ + 12);
          _camTarget.set(truckX, 0, truckZ);
          camera.position.lerp(_desiredCamPos, 1 - Math.exp(-6.5 * dt));
          camera.lookAt(_camTarget);
        } else {
          // Cozy Isometric Follow
          _desiredCamPos.set(truckX + 20, 22, truckZ + 20);
          _camTarget.set(truckX + sinA * 2.5, 0.8, truckZ + cosA * 2.5);
          if (cameraShake > 0.005) {
            _desiredCamPos.x += (Math.random() - 0.5) * cameraShake;
            _desiredCamPos.y += (Math.random() - 0.5) * cameraShake;
            cameraShake = THREE.MathUtils.damp(cameraShake, 0, 8, dt);
          }
          camera.position.lerp(_desiredCamPos, 1 - Math.exp(-6.5 * dt));
          camera.lookAt(_camTarget);
        }
      } else {
        audioSynth.updateTelemetry(0, 0, 0, false);
      }

      // Update Pooled 3D Snow Particles
      let anyParticleActive = false;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particles[i];
        if (!p.active) {
          _pos.set(0, -10, 0);
          _scale.setScalar(0.001);
          _mat4.compose(_pos, _quat.identity(), _scale);
          particleInstanced.setMatrixAt(i, _mat4);
          continue;
        }
        anyParticleActive = true;
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          _pos.set(0, -10, 0);
          _scale.setScalar(0.001);
        } else {
          p.vy -= 14.5 * dt;
          p.x += p.vx * dt;
          p.y = Math.max(0.05, p.y + p.vy * dt);
          p.z += p.vz * dt;
          const lifeRatio = 1 - p.life / p.maxLife;
          _pos.set(p.x, p.y, p.z);
          _scale.setScalar(p.scale * lifeRatio);
        }
        _mat4.compose(_pos, _quat.identity(), _scale);
        particleInstanced.setMatrixAt(i, _mat4);
      }
      if (anyParticleActive) {
        particleInstanced.instanceMatrix.needsUpdate = true;
      }

      // Throttled HUD Telemetry Push (~15Hz)
      if (elapsed - lastTelemetryPush > 0.065) {
        lastTelemetryPush = elapsed;
        const maxComboWindow =
          UPGRADE_SPECS[3].values[Math.min(4, st.progress.saltSpreaderLevel - 1)];

        const radarMarkers: RadarMarker[] = [
          ...cabinObstacleCoords.map((c) => ({
            x: c.x,
            z: c.z,
            type: 'cabin' as const,
          })),
          ...strandedTargets.map((sv) => ({
            x: sv.x,
            z: sv.z,
            type: sv.rescued ? ('rescue_done' as const) : ('rescue_pending' as const),
          })),
        ];

        st.onTelemetryUpdate({
          score: runScore,
          combo,
          comboTimerRatio: Math.max(0, Math.min(1, comboTimer / maxComboWindow)),
          clearedCount: clearedSnowCells,
          totalCount: totalSnowCells,
          progressPct: Math.min(100, Math.round((clearedSnowCells / totalSnowCells) * 100)),
          speedKmh: Math.round(Math.abs(truckSpeed) * 4.2),
          coinsEarned,
          currentDepthLoad,
          onIce: onIcePatch,
          timeRemainingSec: Math.ceil(timeRemaining),
          x: Number(truckX.toFixed(2)),
          z: Number(truckZ.toFixed(2)),
          angle: Number(truckAngle.toFixed(2)),
          propertyHits,
          rescuedCount,
          totalRescues: strandedTargets.length,
          turboCharge: Math.round(turboCharge),
          turboActive: isTurboActiveNow,
          lastEventBanner,
          lastEventTone,
          radarMarkers,
        });
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={canvasMountRef}
      className="fixed inset-0 w-screen h-screen overflow-hidden z-0 touch-none"
      aria-label="3D Isometric Snow Plowing Viewport"
    />
  );
}
