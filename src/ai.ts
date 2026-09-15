/**
 * AI adjudication layer. Given ambiguous/unclassified findings, ask an
 * LLM to adjudicate. Works with any OpenAI-compatible chat completions API
 * (OpenAI, Anthropic via compatible gateway, OpenRouter, local Ollama, ...).
 *
 * Boot-up: the user only supplies an API key (`secular --api-key sk-...` or
 * SECULAR_API_KEY / OPENAI_API_KEY env var).
 */

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const PROVIDERS: Record<string, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-20250514" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" },
  ollama: { baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.1" },
};

export function resolveAiConfig(opts: {
  apiKey?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
}): AiConfig | null {
  const apiKey =
    opts.apiKey ??
    process.env.SECULAR_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const provider = opts.provider ?? (process.env.SECULAR_PROVIDER ?? guessProvider(apiKey));
  const p = PROVIDERS[provider] ?? PROVIDERS.openai!;
  return {
    apiKey,
    baseUrl: opts.baseUrl ?? process.env.SECULAR_BASE_URL ?? p.baseUrl,
    model: opts.model ?? process.env.SECULAR_MODEL ?? p.defaultModel,
  };
}

function guessProvider(key: string): string {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-or-")) return "openrouter";
  return "openai";
}

export interface Adjudication {
  license: string;
  category: "permissive" | "weak-copyleft" | "strong-copyleft" | "network-copyleft" | "unfree" | "public-domain" | "unknown";
  obligations: string;
  proprietaryUse: "allowed" | "conditional" | "prohibited" | "unclear";
  reasoning: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are Secular, an elite open-source license compliance analyst.
You will be given the text of a software license (possibly partial).
Classify it and respond ONLY with minified JSON matching:
{"license":"<SPDX id or best guess>","category":"permissive|weak-copyleft|strong-copyleft|network-copyleft|unfree|public-domain|unknown","obligations":"<one sentence>","proprietaryUse":"allowed|conditional|prohibited|unclear","reasoning":"<2-3 sentences>","confidence":0.0-1.0}
Be precise about copyleft strength and network-use (AGPL-style) clauses.`;

export async function adjudicate(
  cfg: AiConfig,
  licenseText: string,
  hint?: string
): Promise<Adjudication> {
  const isAnthropic = cfg.baseUrl.includes("anthropic.com");
  const userContent = (hint ? `Context: ${hint}\n\n` : "") + licenseText.slice(0, 6000);

  let res: Response;
  if (isAnthropic) {
    res = await fetch(`${cfg.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } else {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(`AI provider rejected the API key (HTTP ${res.status}). Check the key and that --provider matches it.`);
    }
    if (res.status === 429) {
      throw new Error("AI provider rate limit hit (HTTP 429). Retry later or reduce the number of ambiguous licenses.");
    }
    throw new Error(`AI provider error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    content?: { text?: string }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? data.content?.[0]?.text ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI returned non-JSON response");
  let parsed: Adjudication;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Adjudication;
  } catch {
    throw new Error("AI returned malformed JSON");
  }
  parsed.confidence = Number(parsed.confidence) || 0;
  if (!parsed.license || typeof parsed.license !== "string") {
    throw new Error("AI response missing license id");
  }
  return parsed;
}
