"use client";

import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { SettingsResponse } from "@/app/api/settings/route";
import type { ApiKeyInfo } from "@/lib/api/tokens";
import type { SettingName } from "@/lib/settings";

const PROVIDERS: { id: string; label: string; keyUrl: string; modelHint: string }[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    modelHint: "e.g. claude-haiku-4-5-20251001",
  },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", modelHint: "An OpenAI model ID" },
  {
    id: "google",
    label: "Google Gemini (free tier)",
    keyUrl: "https://aistudio.google.com/apikey",
    modelHint: "A Gemini Flash model ID (see ai.google.dev/gemini-api/docs/models)",
  },
  {
    id: "groq",
    label: "Groq (free tier)",
    keyUrl: "https://console.groq.com/keys",
    modelHint: "e.g. llama-3.3-70b-versatile",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyUrl: "https://openrouter.ai/keys",
    modelHint: "Any model ID; ones ending in :free cost nothing",
  },
];

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-green-600";

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function Field({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-neutral-300">{label}</span>
      {children}
      {note && <span className="block text-xs text-neutral-500">{note}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-neutral-800 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * The keys the app needs, entered here instead of in .env.local. Saved
 * secrets are never sent back; their fields stay blank and keep the saved
 * value unless something new is typed.
 */
export function SettingsForm({ onSaved }: { onSaved?: (settings: SettingsResponse) => void }) {
  const [loaded, setLoaded] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Partial<Record<SettingName, string>>>({});
  const [status, setStatus] = useState<{ kind: "saving" | "saved" | "error"; message?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    sendJson<SettingsResponse>("/api/settings", "GET")
      .then(setLoaded)
      .catch((err) => setStatus({ kind: "error", message: err.message }));
  }, []);

  if (!loaded) {
    return <p className="text-sm text-neutral-500">{status?.message ?? "Loading settings…"}</p>;
  }

  const saved = loaded.settings;
  const value = (name: SettingName) => draft[name] ?? saved[name].value ?? "";
  const set = (name: SettingName) => (e: { target: { value: string } }) =>
    setDraft((prev) => ({ ...prev, [name]: e.target.value }));
  const provider = PROVIDERS.find((p) => p.id === value("LLM_PROVIDER"));

  const secretNote = (name: SettingName) => {
    const state = saved[name];
    if (!state.hint) return null;
    return (
      <>
        Saved{state.hint !== "••••" && ` (ends in ${state.hint})`}
        {state.source === "env" && " in .env.local"}. Leave blank to keep it.
        {state.source === "app" && (
          <>
            {" "}
            <button
              type="button"
              className="text-red-400 hover:underline"
              onClick={() => save({ [name]: "" })}
            >
              Remove
            </button>
          </>
        )}
      </>
    );
  };
  const envNote = (name: SettingName) => (saved[name].source === "env" ? "From .env.local" : undefined);

  const save = async (changes: Partial<Record<SettingName, string>>) => {
    setStatus({ kind: "saving" });
    try {
      const next = await sendJson<SettingsResponse>("/api/settings", "PUT", changes);
      setLoaded(next);
      setDraft({});
      setStatus({ kind: "saved" });
      onSaved?.(next);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Blank secret fields mean "keep what's saved", so they aren't sent.
    const changes = Object.fromEntries(
      Object.entries(draft).filter(([name, v]) => !(v === "" && saved[name as SettingName].hint))
    );
    save(changes);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Section title="Spotify (required)">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-400">
          <li>
            Open the{" "}
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="text-green-400 hover:underline"
            >
              Spotify Developer Dashboard
            </a>{" "}
            and create an app. Any name works; tick &ldquo;Web API&rdquo; and &ldquo;Web Playback SDK&rdquo;.
          </li>
          <li>
            Add this Redirect URI:{" "}
            <code className="rounded bg-neutral-800 px-1 text-neutral-200">{loaded.redirectUri}</code>{" "}
            <button
              type="button"
              className="text-xs text-green-400 hover:underline"
              onClick={() => {
                navigator.clipboard.writeText(loaded.redirectUri).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </li>
          <li>Copy the app&apos;s Client ID and Client secret into the boxes below.</li>
        </ol>
        <p className="text-xs text-neutral-500">Playing songs in the app needs Spotify Premium.</p>
        <Field label="Client ID" note={envNote("SPOTIFY_CLIENT_ID")}>
          <input className={inputClass} value={value("SPOTIFY_CLIENT_ID")} onChange={set("SPOTIFY_CLIENT_ID")} />
        </Field>
        <Field label="Client secret" note={secretNote("SPOTIFY_CLIENT_SECRET")}>
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            value={draft.SPOTIFY_CLIENT_SECRET ?? ""}
            onChange={set("SPOTIFY_CLIENT_SECRET")}
          />
        </Field>
      </Section>

      <Section title="AI genre guesses">
        <p className="text-sm text-neutral-400">
          Pick a provider and paste an API key from it. Google and Groq have free tiers; an Anthropic key is billed
          separately from a claude.ai subscription.
        </p>
        <Field label="Provider" note={envNote("LLM_PROVIDER")}>
          <select className={inputClass} value={value("LLM_PROVIDER")} onChange={set("LLM_PROVIDER")}>
            <option value="">Not set</option>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="API key"
          note={
            secretNote("LLM_API_KEY") ??
            (provider && (
              <>
                Get one at{" "}
                <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-green-400 hover:underline">
                  {new URL(provider.keyUrl).host}
                </a>
              </>
            ))
          }
        >
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            value={draft.LLM_API_KEY ?? ""}
            onChange={set("LLM_API_KEY")}
          />
        </Field>
        <Field label="Model" note={envNote("LLM_MODEL")}>
          <input
            className={inputClass}
            value={value("LLM_MODEL")}
            onChange={set("LLM_MODEL")}
            placeholder={provider?.modelHint}
          />
        </Field>
      </Section>

      <Section title="Last.fm (optional)">
        <p className="text-sm text-neutral-400">
          Adds Last.fm tags and artist bios to what the AI sees. Get a free key at{" "}
          <a
            href="https://www.last.fm/api/account/create"
            target="_blank"
            rel="noreferrer"
            className="text-green-400 hover:underline"
          >
            last.fm/api
          </a>
          .
        </p>
        <Field label="API key" note={secretNote("LASTFM_API_KEY")}>
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            value={draft.LASTFM_API_KEY ?? ""}
            onChange={set("LASTFM_API_KEY")}
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {status?.kind === "saved" && <span className="text-sm text-green-400">Saved</span>}
        {status?.kind === "error" && <span className="text-sm text-red-400">{status.message}</span>}
        <button
          type="submit"
          disabled={status?.kind === "saving"}
          className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          {status?.kind === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/** Keys other programs use for the library API (docs/api.md). */
function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    sendJson<{ keys: ApiKeyInfo[] }>("/api/settings/api-keys", "GET")
      .then((body) => setKeys(body.keys))
      .catch((err) => setError(err.message));
  useEffect(() => {
    refresh();
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const { token } = await sendJson<{ token: string }>("/api/settings/api-keys", "POST", { name: trimmed });
      setCreated({ name: trimmed, token });
      setName("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRevoke = async (key: ApiKeyInfo) => {
    if (!window.confirm(`Revoke "${key.name}"? Programs using it will stop working.`)) return;
    try {
      await sendJson(`/api/settings/api-keys/${key.id}`, "DELETE");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : "never");

  return (
    <Section title="Library API keys">
      <p className="text-sm text-neutral-400">
        For other programs on this computer, like DJ software or a file tagger, to read your songs and genres at{" "}
        <code className="text-neutral-300">http://127.0.0.1:3000/api/v1</code>.
      </p>
      {created && (
        <div className="space-y-1 rounded-md border border-green-800 bg-green-950/40 p-2 text-sm">
          <p>
            Key for &ldquo;{created.name}&rdquo;. Copy it now; it won&apos;t be shown again.
          </p>
          <code className="block break-all rounded bg-neutral-950 px-2 py-1 text-green-300">{created.token}</code>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, e.g. mixxx tagger"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="shrink-0 rounded-md bg-neutral-700 px-3 py-1 text-sm font-semibold text-white hover:bg-neutral-600 disabled:opacity-50"
        >
          Create key
        </button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {keys && keys.length > 0 && (
        <ul className="space-y-1">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{key.name}</span>
              <span className="text-xs text-neutral-500">
                made {when(key.createdAt)}, last used {when(key.lastUsedAt)}
              </span>
              <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => handleRevoke(key)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function SettingsDialog({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  // Mounted on open so it shows what's saved now, not when the page loaded.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const sync = () => setOpen(dialog.open);
    const observer = new MutationObserver(sync);
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [dialogRef]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-full max-w-xl rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-white backdrop:bg-black/60"
    >
      <div className="max-h-[90vh] space-y-5 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="text-neutral-500 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {open && (
          <>
            <SettingsForm />
            <ApiKeysSection />
          </>
        )}
      </div>
    </dialog>
  );
}
