import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // We access the dev server via 127.0.0.1 (not localhost) so it matches the
  // Spotify OAuth redirect URI, which trips the default HMR origin check.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
