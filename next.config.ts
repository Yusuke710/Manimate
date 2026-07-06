import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Lets scripts/bench-tabs.mjs run an isolated second dev server against the
  // same source tree without fighting the primary server over .next.
  ...(process.env.MANIMATE_DIST_DIR ? { distDir: process.env.MANIMATE_DIST_DIR } : {}),
};

export default nextConfig;
