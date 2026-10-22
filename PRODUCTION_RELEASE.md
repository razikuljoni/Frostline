# Production Release Runbook (GitHub & Vercel)

This document provides the complete checklist and instructions for publishing **Frostline Plow Co.** to **GitHub** and deploying to **Vercel** (or Google Cloud Run / Docker).

---

## 1. Pre-Release Verification

Before pushing to GitHub, run the local verification suite to confirm zero TypeScript or ESLint issues and a clean production bundle:

```bash
# 1. Run ESLint & Next.js static analysis
npm run lint

# 2. Run a full production build
npm run build

# 3. (Optional) Run Firestore security rules unit tests
npx vitest run firestore.rules.test.ts
```

---

## 2. Publishing to GitHub

1. Initialize Git (if not already initialized) and verify `.gitignore` excludes `node_modules/`, `.next/`, and `.env*.local`:
   ```bash
   git status
   ```
2. Stage and commit the production release:
   ```bash
   git add .
   git commit -m "feat: production release with front driver cam, cabin penalties, rescues & responsive touch controls"
   ```
3. Create a new repository on GitHub and push:
   ```bash
   git branch -M main
   git remote add origin https://github.com/<your-org>/<your-repo>.git
   git push -u origin main
   ```

---

## 3. Deploying to Vercel

### Option A: Automatic GitHub Integration (Recommended)
1. Sign in to [Vercel](https://vercel.com) and click **Add New... -> Project**.
2. Import your GitHub repository.
3. **Framework Preset**: Vercel automatically detects **Next.js**.
4. **Build & Output Settings**:
   - Build Command: `next build` (or `npm run build`)
   - Install Command: `npm install`
   - Note: `next.config.ts` automatically disables `output: 'standalone'` when `process.env.VERCEL` is present so Vercel uses its native serverless optimization.
5. **Environment Variables**:
   Configure the following variables in **Vercel Project Settings -> Environment Variables** (or rely on `firebase-applet-config.json` if using the bundled Firebase project):
   - `APP_URL`: `https://<your-vercel-domain>.vercel.app`
   - `NEXT_PUBLIC_FIREBASE_API_KEY`: *(Optional override for custom Firebase project)*
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: *(Optional override)*
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: *(Optional override)*
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`: *(Optional override)*
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: *(Optional override)*
   - `NEXT_PUBLIC_FIREBASE_APP_ID`: *(Optional override)*
   - `NEXT_PUBLIC_FIREBASE_DATABASE_ID`: *(Optional override)*
6. Click **Deploy**.

### Option B: Vercel CLI Deployment
```bash
npx vercel --prod
```

---

## 4. Firebase Production Post-Deploy Checklist

### A. Authorize Your Vercel Domain for Google Sign-In
Firebase Authentication requires your production domain to be listed in **Authorized Domains** so the Google OAuth popup (`signInWithPopup`) succeeds:
1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Select your project (`gen-lang-client-0864617930` or your custom Firebase project).
3. Navigate to **Authentication -> Settings -> Authorized domains**.
4. Click **Add domain** and enter your Vercel production domain (e.g., `frostline-plow-co.vercel.app` and any custom domain).

### B. Deploy Firestore Security Rules
Whenever `firestore.rules` is updated, deploy the rules to your production Firestore instance:
```bash
npx firebase deploy --only firestore:rules
```

---

## 5. Production Architecture & Performance Notes

- **Zero External Asset Dependencies**: All 3D models (snowplow rig, hydraulic V-plow, cabins, pine trees, stranded vehicles, salt beacons) and audio effects (engine rumble, snow crunch, combo chimes, collision horn, turbo whoosh) are generated procedurally at runtime via **Three.js** and the **Web Audio API**. There are zero external `.glb`, `.mp3`, or texture URLs that could fail or 404 in production.
- **Hardware & Software WebGL Compatibility**: `SnowPlowCanvas.tsx` automatically detects software WebGL renderers (such as SwiftShader or headless environments), adjusts pixel ratio (`DPR`), disables costly shadow maps on low-tier GPUs, and inserts a WebGL2 `fenceSync` guard to prevent compositor frame artifacts.
- **No `backdrop-filter` Over WebGL**: All HUD panels over the active 3D canvas use high-contrast opaque/alpha-tinted surfaces (`bg-[#0B121E]/95`) without CSS `backdrop-blur`, preventing GPU readback stutter on mobile browsers and Safari/iOS.
