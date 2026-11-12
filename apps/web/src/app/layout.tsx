import type { Metadata } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import { APP_NAME } from "@stepup/shared";
import "./globals.css";

const baloo = Baloo_2({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-baloo" });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} — mini-jeux multijoueurs entre amis.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${baloo.variable} ${nunito.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
