#!/usr/bin/env node

const { spawn } = require("child_process");

console.log(
  "\n🎵 Spotify Subgenre Helper is starting...\n" +
    "⚠️  Use http://127.0.0.1:3000 (NOT localhost) — Spotify auth requires the loopback IP.\n"
);

const proc = spawn("next", ["dev"], { stdio: "inherit" });
proc.on("exit", (code) => process.exit(code));
