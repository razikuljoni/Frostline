# Frostline Plow Co. — Cozy 3D Alpine Snow-Plowing Simulation

**Frostline Plow Co.** is a cozy, responsive 3D snow-plowing simulation game built with **Next.js 15 (App Router)**, **Three.js (WebGL)**, **Web Audio API Procedural Synthesis**, and **Firebase (Firestore & Authentication)**.

Command a municipal snowplow fleet across procedurally generated winter sectors, switch between **Isometric**, **Chase**, **Front Driver Cockpit**, and **Overhead** cameras, rescue stranded town vehicles, manage hydraulic overdrive turbo, avoid property damage penalties on glowing cabins, upgrade your rig, and compete in real-time cross-platform multiplayer.

---

## Key Features

### 1. Multi-Angle 3D Camera System (Including Front Driver View)
- **Isometric (`Iso`)**: Classic cozy diorama perspective showing the town grid, snowdrifts, and warm cabin windows.
- **Chase (`Chase`)**: Behind-the-rig third-person view for tight drift navigation.
- **Front Driver (`Driver` / Key `V`)**: First-person cabin windshield view looking directly over the beveled hood, emergency beacon glow, and hydraulic V-plow blade with responsive steering look-ahead and cockpit windshield HUD framing.
- **Overhead (`Top`)**: Tactical municipal top-down sector map view.

### 2. Realistic Snow Depth Physics & Property Damage System
- **Voxelized Snow Grid (`48 × 48` cells)**: Each tile models continuous snow depth (`0.0m` to `1.0m`) with dynamic vertex displacement and instanced snowdrifts.
- **Depth-Based Drag & Traction**: Deep snowbanks (`>0.65m`) apply physical resistance unless countered by upgraded **Engine Torque** or **Tire Chains**, or bypassed with **Hydraulic Turbo Boost**.
- **Property Damage Penalties (`-150 PTS`)**: Colliding with residential cabins or alpine boulders (`-75 PTS`) triggers a low-brass synth warning horn, resets your active combo multiplier, shakes the camera, and logs a property hit. Completing a shift with **0 property hits** awards a **+500 PTS / +75 CR Clean Safety Bonus**.

### 3. Stranded Priority Vehicles & Rescue Beacons
- Every procedural map spawns **4 Stranded Town Vehicles** trapped in deep snowdrifts with pulsing amber hazard beacons.
- Plowing the snow cells surrounding a stranded vehicle rescues it, turns its beacon ring emerald green, and awards an immediate **+600 PTS** and **+45 CR** rescue bonus.

### 4. Overdrive Hydraulic Turbo & Combo Multipliers
- **Overdrive Turbo (`Shift` / Touch `BOOST`)**: Drains the rechargeable hydraulic reserve to increase top speed by **+48%** and power through deep snowbanks without speed loss.
- **Combo Multiplier (`1x` – `10x`)**: Continuous snow clearing scales your score multiplier and arpeggiated Web Audio chime pitch (`pentatonic scale`).

### 5. Procedural Weather, Fleet Garage & Cosmetics
- **4 Dynamic Weather Modes**: *Clear Starlight*, *Flurry*, *Heavy Gale* (lateral crosswinds), and *Whiteout Blizzard* (dense volumetric fog + active snow re-accumulation).
- **4 Upgradeable Systems (Levels 1–5)**: *Blade Width*, *Engine Torque*, *Tire Chains*, and *Salt Spreader*.
- **6 Unlockable Livery Skins**: *Municipal Amber*, *Alpine Crimson*, *Midnight Gold*, *Glacier Mint*, *Polar Violet*, and *Evergreen Ranger*.

### 6. Daily Seeded Challenges, Cloud Saves & Live Multiplayer
- **Daily Seeded Challenge**: Deterministic `UTC YYYY-MM-DD` PRNG seed ensures every player worldwide faces the exact same town layout and blizzard conditions each day.
- **Cross-Device Cloud Saves**: Google Sign-In automatically syncs credits, upgrades, unlocked skins, and personal bests via Firebase Firestore.
- **Cross-Platform Multiplayer**: Real-time 2-player competitive snow-clearing matches (`90s` clock) with live opponent truck rendering and authoritative API state validation.

### 7. Full Mobile, Tablet & Desktop Responsiveness
- **Adaptive HUD**: Compact telemetry strip, collapsible **Sector Mini-Radar**, and responsive modal drawers that fit phones (`320px+`), tablets, and ultrawide desktop monitors.
- **On-Screen Touch Driving Deck**: Auto-activates on touch devices (or toggle via the top bar Touch icon) with ergonomic left steering (`◀` / `▶` + `BOOST`) and right throttle pedals (`REV` / `DRIVE`).

---

## Controls Reference

| Action | Desktop Keyboard | Mobile / Touch Controls |
| :--- | :--- | :--- |
| **Accelerate / Forward** | `W` or `↑` | Hold `DRIVE` Pedal (Bottom Right) |
| **Brake / Reverse** | `S` or `↓` | Hold `REV` Pedal (Bottom Right) |
| **Steer Left / Right** | `A` / `D` or `←` / `→` | Hold `◀` / `▶` Pads (Bottom Left) |
| **Hydraulic Turbo Boost** | `Shift` or `Space` | Hold `BOOST` Button |
| **Toggle Front Driver Cam** | `V` | Tap `Driver` in Top Camera Pill |
| **Cycle All 4 Cameras** | `C` | Tap `Iso` / `Chase` / `Driver` / `Top` |

---

## Project Architecture

```text
├── app/
│   ├── api/multiplayer/route.ts   # Server-authoritative multiplayer room & score validation API
│   ├── globals.css                # Tailwind v4 configuration & typography tokens
│   ├── layout.tsx                 # Root metadata, OpenGraph, Twitter & JSON-LD Schema
│   └── page.tsx                   # Responsive Alpine Telemetry HUD, Modals & Touch Controller
├── components/
│   └── SnowPlowCanvas.tsx         # Three.js WebGL engine, 4 cameras, physics, collisions & rescues
├── lib/
│   ├── audio-synth.ts             # Zero-asset Web Audio API procedural sound synthesizer
│   ├── firebase.ts                # Firebase Auth & Firestore cloud save / leaderboard client
│   ├── game-data.ts               # Seeded PRNG map generator, upgrades, skins & challenge logic
│   └── utils.ts                   # Tailwind class utilities
├── firebase-blueprint.json        # Firestore data model schema specification
├── firestore.rules                # Production Firestore security rules (RBAC & schema validation)
├── vercel.json                    # Vercel production deployment & security header configuration
└── PRODUCTION_RELEASE.md          # Step-by-step GitHub & Vercel production release runbook
```

---

## Local Development Setup

### Prerequisites
- **Node.js** `20.x` or later
- **npm** `10.x` or later

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
> **Note**: Firebase client configuration is loaded from `firebase-applet-config.json` by default, or can be overridden via `NEXT_PUBLIC_FIREBASE_*` environment variables on Vercel.

### 3. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## GitHub & Vercel Production Deployment

See [**PRODUCTION_RELEASE.md**](./PRODUCTION_RELEASE.md) for the complete production deployment checklist, including:
1. Pushing to GitHub and connecting to Vercel.
2. Adding your Vercel production domain to **Firebase Authentication -> Authorized Domains**.
3. Deploying `firestore.rules` to your Firebase project.
4. Verifying production builds (`npm run lint && npm run build`).
