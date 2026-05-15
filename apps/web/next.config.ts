import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@au/db"],
  typedRoutes: true,
  // Produce a self-contained server bundle for Docker.
  output: "standalone",
  outputFileTracingRoot: require("node:path").join(__dirname, "..", ".."),
  // We rely on `tsc --noEmit` for type checking; the default Next ESLint
  // config can't parse our TS at build time without extra plugins.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
