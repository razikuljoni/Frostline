import type {Metadata, Viewport} from 'next';
import './globals.css';

const appUrl = process.env.APP_URL || 'https://frostline-plow-co.vercel.app';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0B121E',
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'Frostline Plow Co. | 3D Alpine Snow-Plowing Simulation Game',
    template: '%s | Frostline Plow Co.',
  },
  description:
    'Command an alpine municipal snowplow fleet in 3D. Features realistic snow depth physics, front driver cockpit camera, property hazard penalties, stranded vehicle rescues, synth audio, daily challenges, cloud saves, and live multiplayer.',
  keywords: [
    'snow plow game',
    '3D driving simulator',
    'Three.js game',
    'cozy winter game',
    'isometric snow plow',
    'multiplayer webgl game',
    'Frostline Plow Co',
  ],
  authors: [{name: 'Frostline Municipal Fleet Works'}],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Frostline Plow Co. | 3D Alpine Snow-Plowing Simulation',
    description:
      'Cozy 3D snow-plowing simulation with front driver cockpit view, realistic snow depth physics, dynamic blizzards, rescue beacons, truck upgrades, and live multiplayer.',
    url: appUrl,
    siteName: 'Frostline Plow Co.',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Frostline Plow Co. | 3D Alpine Snow-Plowing Simulation',
    description:
      'Command a 3D snowplow rig across procedural winter towns with front driver camera, blizzard physics, truck upgrades, and multiplayer.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'VideoGame',
  name: 'Frostline Plow Co.',
  description:
    'A cozy 3D snow-plowing simulation game featuring isometric and first-person front driver cameras, realistic snow depth physics, property collision penalties, stranded vehicle rescues, synth audio, daily challenges, cloud saves, and cross-platform multiplayer.',
  genre: ['Simulation', 'Driving', 'Arcade', 'Casual'],
  playMode: ['SinglePlayer', 'MultiPlayer'],
  applicationCategory: 'Game',
  operatingSystem: 'Web Browser (Desktop, iOS, Android)',
  url: appUrl,
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}}
        />
      </head>
      <body
        suppressHydrationWarning
        className="font-sans bg-[#0B121E] text-slate-100 overflow-hidden select-none antialiased"
      >
        {children}
      </body>
    </html>
  );
}
