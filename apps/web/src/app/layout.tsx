import type { Metadata } from "next";
import { Baloo_2, Jersey_15, Jersey_25, Nunito, Outfit } from "next/font/google";
import { APP_NAME } from "@stepup/shared";
import "./globals.css";

const baloo = Baloo_2({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-baloo" });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
// Nouvelle direction OneUP : Outfit pour l'interface 2D, Jersey (pixel) pour le logo et les titres de jeu.
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "800"], variable: "--font-outfit" });
const jersey15 = Jersey_15({ subsets: ["latin"], weight: "400", variable: "--font-jersey15" });
const jersey25 = Jersey_25({ subsets: ["latin"], weight: "400", variable: "--font-jersey25" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} — mini-jeux multijoueurs entre amis.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${baloo.variable} ${nunito.variable} ${outfit.variable} ${jersey15.variable} ${jersey25.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
