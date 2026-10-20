import { NextResponse } from "next/server";
import { listModels } from "@/lib/checkSettings";
import { checkLocalRequest } from "@/lib/localRequest";
import type { LlmProvider } from "@/lib/llm/types";
import { getSetting, LLM_PROVIDERS } from "@/lib/settings";

/**
 * Body: { provider, apiKey? }. The models that key can use, best guess
 * first, for the Model field. Without a key, the saved one is tried.
 */
export async function POST(request: Request) {
  const denied = checkLocalRequest(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { provider?: string; apiKey?: string } | null;
  const provider = body?.provider as LlmProvider | undefined;
  if (!provider || !LLM_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Pick an AI provider first." }, { status: 400 });
  }
  const apiKey = body?.apiKey?.trim() || getSetting("LLM_API_KEY");
  if (!apiKey) return NextResponse.json({ models: [] });
  return NextResponse.json({ models: await listModels(provider, apiKey) });
}
