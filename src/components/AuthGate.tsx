"use client";

import { useEffect, useState } from "react";
import { AppShell } from "./AppShell";

export function AuthGate() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((body) => setAuthenticated(body.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return <div className="flex h-screen items-center justify-center text-neutral-500">Loading…</div>;
  }

  if (!authenticated) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-white">
        <h1 className="text-2xl font-bold">Spotify Subgenre Assistant</h1>
        <p className="text-neutral-400">Connect your Spotify account to start sorting tracks.</p>
        <a
          href="/api/auth/login"
          className="rounded-full bg-green-600 px-6 py-2 font-semibold text-white hover:bg-green-500"
        >
          Connect Spotify
        </a>
      </div>
    );
  }

  return <AppShell />;
}
