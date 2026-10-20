"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
}

/**
 * Follow-up questions to the AI about one song: why it chose the tags,
 * what it knows about the song or a genre, and so on. The conversation is
 * saved per song, so it's still there when the song comes up again.
 */
export function TrackChat({ trackId, firstTag }: { trackId: string; firstTag?: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  // The question waiting on an answer, shown until it's saved.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/track/${trackId}/chat`)
      .then((res) => res.json())
      .then((body) => !cancelled && setMessages(body.messages ?? []))
      .catch(() => !cancelled && setMessages([]));
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  const ask = async (question: string) => {
    question = question.trim();
    if (!question || pending) return;
    setPending(question);
    setDraft("");
    setError(null);
    try {
      // The AI can take a while on a long answer; the server gives it 60s
      // plus one retry.
      const res = await fetchWithTimeout(
        `/api/track/${trackId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        },
        150_000
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessages(body.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Put the question back so it can be sent again.
      setDraft(question);
    } finally {
      setPending(null);
    }
  };

  const startOver = async () => {
    await fetch(`/api/track/${trackId}/chat`, { method: "DELETE" }).catch(() => {});
    setMessages([]);
    setError(null);
  };

  const suggestions = [
    "Why did you tag it this way?",
    "What do you know about this song?",
    ...(firstTag ? [`Tell me about ${firstTag}.`] : []),
  ];

  if (messages === null) return null;

  return (
    <div className="space-y-2 border-t border-neutral-800 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-400">Ask the AI about this song</p>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => void startOver()}
            disabled={!!pending}
            title="Delete this conversation and start a new one"
            className="text-xs text-neutral-500 hover:text-red-400 disabled:opacity-50"
          >
            Start over
          </button>
        )}
      </div>

      {(messages.length > 0 || pending) && (
        <div ref={listRef} className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {messages.map((m) => (
            <ChatBubble key={m.id} role={m.role} content={m.content} />
          ))}
          {pending && (
            <>
              <ChatBubble role="user" content={pending} />
              <p className="text-xs text-neutral-500">Thinking…</p>
            </>
          )}
        </div>
      )}

      {messages.length === 0 && !pending && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:border-green-600 hover:text-neutral-200"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter starts a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
          rows={1}
          placeholder="Ask a follow-up question…"
          aria-label="Ask the AI a question about this song"
          className="max-h-32 min-h-[2rem] flex-1 resize-y rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-green-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || !!pending}
          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

function ChatBubble({ role, content }: { role: Message["role"]; content: string }) {
  return (
    <div
      className={`whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs ${
        role === "user" ? "ml-8 bg-green-600/15 text-neutral-200" : "mr-8 bg-neutral-800 text-neutral-300"
      }`}
    >
      {content}
    </div>
  );
}
