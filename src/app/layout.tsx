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

export const metadata: Metadata = {
  title: "RAIN V6 — AI Audio Operating System",
  description: "Studio-grade AI mastering, 12-stem separation, Dolby Atmos binaural, RAIN-CERT provenance, and DDEX distribution. Local-first: audio never leaves your device on the free path.",
  keywords: ["RAIN V6", "AI mastering", "audio", "WASM DSP", "BS.1770-4", "Ed25519", "C2PA", "DDEX", "Dolby Atmos", "stem separation"],
  authors: [{ name: "ThatGuy Productions · ARCOVEL Technologies" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "RAIN V6 — AI Audio Operating System",
    description: "The next-generation AI audio mastering & distribution infrastructure. Commercial release candidate.",
    url: "https://chat.z.ai",
    siteName: "RAIN V6",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RAIN V6 — AI Audio Operating System",
    description: "Studio-grade AI mastering with Ed25519 provenance & DDEX distribution.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
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
      </body>
    </html>
  );
}
