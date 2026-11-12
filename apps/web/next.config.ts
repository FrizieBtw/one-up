import type { NextConfig } from "next";

const config: NextConfig = {
  // Les paquets du monorepo sont consommés en TypeScript source, sans étape de build.
  transpilePackages: ["@stepup/shared"],
};

export default config;
