import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (.next/standalone) that the desktop app ships,
  // so installed copies need no npm install. See electron/.
  output: "standalone",
  // Code that reads the data folder makes the build trace .cache/ in; it's
  // this machine's library and keys, never part of the app.
  outputFileTracingExcludes: { "/*": [".cache/**/*"] },
  // We access the dev server via 127.0.0.1 (not localhost) so it matches the
  // Spotify OAuth redirect URI, which trips the default HMR origin check.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
