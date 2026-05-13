import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/auth/AuthGate";
import { AppShell } from "@/features/shell/AppShell";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans-app",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-app",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Arauco-Seam",
  description: "Mantenimiento industrial — avisos, OT, materiales, firmas",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Arauco-Seam" },
};

export const viewport: Viewport = {
  themeColor: "#2c2c2c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${plusJakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans text-foreground">
        <AppShell>
          <AuthGate>{children}</AuthGate>
        </AppShell>
      </body>
    </html>
  );
}
