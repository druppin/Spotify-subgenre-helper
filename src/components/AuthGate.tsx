"use client";

import { useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { SettingsForm } from "./SettingsDialog";

type Status = { configured: boolean; authenticated: boolean };

export function AuthGate() {
  const [status, setStatus] = useState<Status | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const check = () =>
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((body: Status) => setStatus(body))
      .catch(() => setStatus({ configured: true, authenticated: false }));
  useEffect(() => {
    check();
  }, []);

  if (status === null) {
    return <div className="flex h-screen items-center justify-center text-muted">Loading…</div>;
  }

  if (status.authenticated) return <AppShell />;

  // First run: there's no Spotify app to log in with until one is entered.
  if (!status.configured || showSettings) {
    return (
      <div className="min-h-screen bg-ground px-4 py-10 text-ink">
        <div className="mx-auto max-w-xl space-y-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Spotify Subgenre Assistant</h1>
            <p className="text-muted">
              {status.configured
                ? "Settings"
                : "Welcome! Connect the app to Spotify and an AI provider to get started. You can change these later in Settings."}
            </p>
          </div>
          <SettingsForm
            onSaved={(settings) => {
              if (!settings.spotifyConfigured) return;
              setShowSettings(false);
              check();
            }}
          />
          {status.configured && (
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="text-sm text-muted hover:text-ink"
            >
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-ground text-ink">
      <h1 className="text-2xl font-bold">Spotify Subgenre Assistant</h1>
      <p className="text-muted">Connect your Spotify account to start sorting tracks.</p>
      <a
        href="/api/auth/login"
        className="rounded-full bg-ink px-6 py-2 font-semibold text-ground hover:bg-ink-2"
      >
        Connect Spotify
      </a>
      <button type="button" onClick={() => setShowSettings(true)} className="text-sm text-muted hover:text-ink">
        Settings
      </button>
    </div>
  );
}
