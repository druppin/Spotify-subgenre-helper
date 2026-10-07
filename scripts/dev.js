#!/usr/bin/env node

const { spawn } = require("child_process");

console.log(
  "\n🎵 Spotify Subgenre Helper is starting...\n" +
    "⚠️  Use http://127.0.0.1:3000 (NOT localhost) — Spotify auth requires the loopback IP.\n"
);

// Bound to loopback only: the app's API serves your library data, and
// nothing else on the network should reach it.
const proc = spawn("next", ["dev", "-H", "127.0.0.1"], { stdio: "inherit" });
proc.on("exit", (code) => process.exit(code));
