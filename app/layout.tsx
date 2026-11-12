import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const sora = Sora({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "J.A.R.V.I.S.",
  description: "Just A Rather Very Intelligent System — assistente pessoal do Adolfo.",
  applicationName: "J.A.R.V.I.S.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    title: "J.A.R.V.I.S.",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#070809",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
