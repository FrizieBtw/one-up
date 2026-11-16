import type { NextConfig } from "next";

const config: NextConfig = {
  // Jouer depuis un autre appareil du réseau local (colocataire, téléphone) : le serveur de développement accepte les adresses privées.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  // Les paquets du monorepo sont consommés en TypeScript source, sans étape de build.
  transpilePackages: ["@stepup/shared", "@stepup/blackjack"],
};

export default config;
