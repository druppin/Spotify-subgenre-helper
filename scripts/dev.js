#!/usr/bin/env node

const { spawn } = require("child_process");

console.log(
  "\n🎵 Spotify Subgenre Helper is starting...\n" +
    "⚠️  Use http://127.0.0.1:3000 (NOT localhost) — Spotify auth requires the loopback IP.\n"
);

// Bound to loopback only: the app's API serves your library data, and
// nothing else on the network should reach it.
// Runs Next's CLI with this same Node rather than a bare `next`, which
// Windows can't spawn (its shim there is next.cmd).
const nextBin = require.resolve("next/dist/bin/next");
const proc = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1"], { stdio: "inherit" });
proc.on("exit", (code) => process.exit(code));
