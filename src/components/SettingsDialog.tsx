"use client";

import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { SettingsResponse } from "@/app/api/settings/route";
import type { ApiKeyInfo } from "@/lib/api/tokens";
import type { SettingName } from "@/lib/settings";
import { setDisplayPrefs, useDisplayPrefs, type ConfidenceDisplay, type ThemePref } from "@/lib/displayPrefs";
import { CloseIcon } from "./Icons";

// Free options first: Gemini's free tier is the easiest start.
const PROVIDERS: { id: string; label: string; keyUrl: string; modelHint: string }[] = [
  {
    id: "google",
    label: "Google Gemini (free tier, recommended)",
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
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    modelHint: "e.g. claude-haiku-4-5",
  },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", modelHint: "An OpenAI model ID" },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyUrl: "https://openrouter.ai/keys",
    modelHint: "Any model ID; ones ending in :free cost nothing",
  },
];

const inputClass =
  "w-full rounded-md border border-line-strong bg-ground px-2 py-1.5 text-sm outline-none focus:border-ink-2";

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
      <span className="text-sm text-ink-2">{label}</span>
      {children}
      {note && <span className="block text-xs text-muted">{note}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-line p-3">
      <legend className="px-1 text-[15px] font-bold text-ink">{title}</legend>
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
  // The models the entered key can use, best guess first; null until asked.
  const [models, setModels] = useState<{ provider: string; ids: string[] } | null>(null);

  useEffect(() => {
    sendJson<SettingsResponse>("/api/settings", "GET")
      .then(setLoaded)
      .catch((err) => setStatus({ kind: "error", message: err.message }));
  }, []);

  // Ask the provider which models the key can use once both are known
  // (a typed key, or the saved one), and fill in its best guess if the
  // Model box is empty.
  const llmProvider = draft.LLM_PROVIDER ?? loaded?.settings.LLM_PROVIDER.value ?? "";
  const typedKey = draft.LLM_API_KEY ?? "";
  const hasKey = typedKey.trim() !== "" || Boolean(loaded?.settings.LLM_API_KEY.hint);
  useEffect(() => {
    if (!llmProvider || !hasKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      sendJson<{ models: string[] }>("/api/settings/models", "POST", { provider: llmProvider, apiKey: typedKey })
        .then(({ models: ids }) => {
          if (cancelled) return;
          setModels({ provider: llmProvider, ids });
          if (ids.length > 0) {
            setDraft((prev) => {
              const current = prev.LLM_MODEL ?? (prev.LLM_PROVIDER ? "" : loaded?.settings.LLM_MODEL.value) ?? "";
              return current ? prev : { ...prev, LLM_MODEL: ids[0] };
            });
          }
        })
        .catch(() => !cancelled && setModels({ provider: llmProvider, ids: [] }));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [llmProvider, typedKey, hasKey, loaded]);

  if (!loaded) {
    return <p className="text-sm text-muted">{status?.message ?? "Loading settings…"}</p>;
  }

  const saved = loaded.settings;
  const value = (name: SettingName) => draft[name] ?? saved[name].value ?? "";
  const set = (name: SettingName) => (e: { target: { value: string } }) =>
    setDraft((prev) => ({ ...prev, [name]: e.target.value }));
  const provider = PROVIDERS.find((p) => p.id === value("LLM_PROVIDER"));
  const modelIds = models?.provider === llmProvider ? models.ids : [];
  const modelNote =
    models?.provider !== llmProvider || !hasKey
      ? "Filled in for you once there's a key."
      : modelIds.length > 0
        ? `${modelIds[0]} suits this well; click the box to see the other ${modelIds.length - 1}.`
        : "Couldn't list this key's models. Check the key, or type a model ID.";

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
              className="text-danger hover:underline"
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
      setStatus({ kind: "saved", message: next.warnings?.join(" ") });
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
        <p className="text-sm text-muted">
          Spotify only lets each app serve a few people, so everyone makes their own. It takes about five minutes and
          needs <span className="text-ink">Spotify Premium</span>, which playing songs in the app needs too.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            Log in to the{" "}
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="text-ink underline underline-offset-2 hover:text-ink-2"
            >
              Spotify Developer Dashboard
            </a>{" "}
            and click <span className="text-ink">Create app</span>. Any name and description work.
          </li>
          <li>
            Under Redirect URIs, paste this and click <span className="text-ink">Add</span>:{" "}
            <code className="rounded bg-raised px-1 text-ink">{loaded.redirectUri}</code>{" "}
            <button
              type="button"
              className="text-xs text-ink underline underline-offset-2 hover:text-ink-2"
              onClick={() => {
                navigator.clipboard.writeText(loaded.redirectUri).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </li>
          <li>
            Under &ldquo;Which API/SDKs are you planning to use?&rdquo;, tick{" "}
            <span className="text-ink">Web API</span> and <span className="text-ink">Web Playback SDK</span>. Agree to
            the terms and save.
          </li>
          <li>
            On the app&apos;s page, open <span className="text-ink">Settings</span> and copy the Client ID and Client
            secret (behind &ldquo;View client secret&rdquo;) into the boxes below.
          </li>
        </ol>
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
        <p className="text-sm text-muted">
          Pick a provider and paste an API key from it. Google and Groq have free tiers; an Anthropic key is billed
          separately from a claude.ai subscription.
        </p>
        <Field label="Provider" note={envNote("LLM_PROVIDER")}>
          <select
            className={inputClass}
            value={value("LLM_PROVIDER")}
            // Another provider's model ID won't work here; a new one is suggested.
            onChange={(e) => setDraft((prev) => ({ ...prev, LLM_PROVIDER: e.target.value, LLM_MODEL: "" }))}
          >
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
                <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2 hover:text-ink-2">
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
        <Field label="Model" note={envNote("LLM_MODEL") ?? modelNote}>
          <input
            className={inputClass}
            value={value("LLM_MODEL")}
            onChange={set("LLM_MODEL")}
            placeholder={provider?.modelHint}
            list="llm-models"
          />
          <datalist id="llm-models">
            {modelIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </Field>
      </Section>

      <Section title="Last.fm (optional)">
        <p className="text-sm text-muted">
          Adds Last.fm tags and artist bios to what the AI sees. Get a free key at{" "}
          <a
            href="https://www.last.fm/api/account/create"
            target="_blank"
            rel="noreferrer"
            className="text-ink underline underline-offset-2 hover:text-ink-2"
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
        {status?.kind === "saved" && (
          <span className={`text-sm ${status.message ? "text-warn" : "text-ok"}`}>{status.message ?? "Saved"}</span>
        )}
        {status?.kind === "error" && <span className="text-sm text-danger">{status.message}</span>}
        <button
          type="submit"
          disabled={status?.kind === "saving"}
          className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-ground hover:bg-ink-2 disabled:opacity-50"
        >
          {status?.kind === "saving" ? "Checking and saving…" : "Save"}
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
      <p className="text-sm text-muted">
        For other programs on this computer, like DJ software or a file tagger, to read your songs and genres at{" "}
        <code className="text-ink-2">http://127.0.0.1:3000/api/v1</code>.
      </p>
      {created && (
        <div className="space-y-1 rounded-md border border-line-strong bg-raised p-2 text-sm">
          <p>
            Key for &ldquo;{created.name}&rdquo;. Copy it now; it won&apos;t be shown again.
          </p>
          <code className="block break-all rounded bg-ground px-2 py-1 text-ink">{created.token}</code>
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
          className="shrink-0 rounded-md bg-ink px-3 py-1 text-sm font-semibold text-ground hover:bg-ink-2 disabled:opacity-50"
        >
          Create key
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
      {keys && keys.length > 0 && (
        <ul className="space-y-1">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{key.name}</span>
              <span className="text-xs text-muted">
                made {when(key.createdAt)}, last used {when(key.lastUsedAt)}
              </span>
              <button type="button" className="text-xs text-danger hover:underline" onClick={() => handleRevoke(key)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const SEGMENT = "rounded-[5px] px-3 py-1 text-[13px] font-medium";

/** A row of choices where one is picked, like a set of radio buttons. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[13px] font-semibold">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-md border border-line bg-ground p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`${SEGMENT} inline-flex items-center gap-2 ${
              o.value === value ? "bg-raised font-semibold text-ink ring-1 ring-line-strong" : "text-ink-2 hover:bg-raised"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// A small sample of the confidence bar, as each choice would show it.
function BarSample() {
  return (
    <span className="relative inline-block h-1 w-6 rounded-full bg-current/25" aria-hidden>
      <span className="absolute inset-y-0 left-0 w-[70%] rounded-full bg-current" />
    </span>
  );
}

/** How the app looks on this computer. Applies as soon as it's picked. */
function DisplaySection() {
  const { theme, confidence } = useDisplayPrefs();
  return (
    <Section title="Display">
      <Segmented<ConfidenceDisplay>
        label="Show confidence as"
        value={confidence}
        onChange={(value) => setDisplayPrefs({ confidence: value })}
        options={[
          { value: "both", label: <>Both <BarSample /> 70%</> },
          { value: "bars", label: <>Bars <BarSample /></> },
          { value: "percent", label: <>Percentage 70%</> },
        ]}
      />
      <p className="text-xs text-muted">Applies to tags, the source playlist and My library.</p>
      <Segmented<ThemePref>
        label="Theme"
        value={theme}
        onChange={(value) => setDisplayPrefs({ theme: value })}
        options={[
          { value: "system", label: "Match system" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
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
      aria-labelledby="settings-title"
      className="m-auto w-full max-w-5xl overflow-hidden rounded-xl bg-panel p-0 text-ink shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop:bg-black/60"
    >
      <div className="band flex items-center justify-between px-6 py-3.5">
        <h2 id="settings-title" className="font-narrow text-xl font-bold">
          Settings
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-raised"
          aria-label="Close"
        >
          <CloseIcon size={16} />
        </button>
      </div>
      {open && (
        <div className="grid max-h-[80vh] gap-5 overflow-y-auto p-6 md:grid-cols-2">
          <div className="space-y-5">
            <SettingsForm />
          </div>
          <div className="space-y-5">
            <DisplaySection />
            <ApiKeysSection />
          </div>
        </div>
      )}
    </dialog>
  );
}
