import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://rainv6.com"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "RAIN V6 — AI-Powered Audio Mastering | Professional Sound in Seconds",
  description: "Transform your mixes with RAIN V6's AI audio mastering engine. Real ITU-R BS.1770-4 LUFS, Ed25519 provenance, 12-stem separation, Dolby Atmos — all in your browser. Free public beta.",
  keywords: ["RAIN V6", "AI mastering", "audio mastering", "LUFS", "BS.1770-4", "Ed25519", "provenance", "DDEX", "Dolby Atmos", "stem separation", "MP3 encoder", "WAV export", "in-browser DSP"],
  authors: [{ name: "ThatGuy Productions · ARCOVEL Technologies" }],
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "RAIN V6 — AI-Powered Audio Mastering | Professional Sound in Seconds",
    description: "Transform your mixes with RAIN V6's AI audio mastering engine. Professional-grade loudness, stereo width, and tonal balance — instantly. Free public beta.",
    url: SITE_URL,
    siteName: "RAIN V6",
    images: [{ url: "/og-image.svg", width: 1200, height: 630, alt: "RAIN V6 AI Audio Mastering Platform" }],
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "RAIN V6 — AI-Powered Audio Mastering",
    description: "Professional AI audio mastering in seconds. Real DSP, Ed25519 provenance, in-browser processing. Free public beta.",
    images: ["/og-image.svg"],
  },
  alternates: {
    canonical: SITE_URL,
  },
  other: {
    "theme-color": "#0a0a0a",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "RAIN V6",
  },
};

// JSON-LD structured data
const softwareAppSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "RAIN V6",
  "applicationCategory": "MultimediaApplication",
  "operatingSystem": "Web",
  "description": "AI-powered audio mastering platform that delivers professional-grade loudness, stereo width, and tonal balance instantly. Runs entirely in the browser.",
  "url": SITE_URL,
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "featureList": [
    "Real ITU-R BS.1770-4 LUFS measurement",
    "Ed25519 provenance certificates",
    "12-stem source separation",
    "Dolby Atmos 7.1.4 binaural spatial rendering",
    "DDEX ERN 4.3.2 distribution package builder",
    "MP3 320 kbps and WAV 24-bit export",
    "AI Co-Master Engineer with LLM-powered suggestions",
    "35 free in-browser file conversion tools",
  ],
};

const orgSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "RAIN V6",
  "url": SITE_URL,
  "logo": `${SITE_URL}/favicon.svg`,
  "description": "AI-powered audio mastering platform with real DSP, Ed25519 provenance, and in-browser processing.",
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "Does my audio leave my device?", "acceptedAnswer": { "@type": "Answer", "text": "No. All DSP runs entirely in your browser via the Web Audio API. Audio files are never uploaded to a server." } },
    { "@type": "Question", "name": "Is the mastering quality professional-grade?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. The DSP engine implements ITU-R BS.1770-4 K-weighted LUFS, 4x polyphase oversampling for true-peak, RBJ biquad filters, 3-band multiband compression, and a look-ahead limiter." } },
    { "@type": "Question", "name": "What export formats are supported?", "acceptedAnswer": { "@type": "Answer", "text": "WAV 24-bit, WAV 16-bit, MP3 320 kbps, and Dolby Atmos 7.1.4 packages with ADM XML sidecar." } },
    { "@type": "Question", "name": "How much does it cost?", "acceptedAnswer": { "@type": "Answer", "text": "Every feature is unlocked during the free public beta. Pricing tiers will be introduced post-beta." } },
  ],
};

// Service worker registration script
const swRegisterScript = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'rgba(10, 12, 18, 0.95)',
              border: '1px solid rgba(170, 255, 0, 0.2)',
              color: '#F0F0F0',
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: '13px',
              borderRadius: '8px',
              backdropFilter: 'blur(12px)',
            },
          }}
          theme="dark"
        />
        <script dangerouslySetInnerHTML={{ __html: swRegisterScript }} />
      </body>
    </html>
  );
}
