#!/usr/bin/env node
// Finishes the standalone build (.next/standalone) for the desktop app: adds
// the static files Next leaves out, and makes sure none of this machine's own
// data or keys end up in an installer.

import { cpSync, existsSync, readdirSync, rmSync } from "fs";
import path from "path";

const standalone = path.join(".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build. Run `next build` first (next.config.ts sets output: \"standalone\").");
  process.exit(1);
}

cpSync("public", path.join(standalone, "public"), { recursive: true });
cpSync(path.join(".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });

for (const name of readdirSync(standalone)) {
  if (name === ".cache" || name.startsWith(".env")) {
    rmSync(path.join(standalone, name), { recursive: true, force: true });
    console.log(`Removed ${name} from the desktop build.`);
  }
}
console.log("Desktop build ready in .next/standalone.");
