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
export declare const PROVIDERS: Record<string, {
    baseUrl: string;
    defaultModel: string;
}>;
export declare function resolveAiConfig(opts: {
    apiKey?: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
}): AiConfig | null;
export interface Adjudication {
    license: string;
    category: "permissive" | "weak-copyleft" | "strong-copyleft" | "network-copyleft" | "unfree" | "public-domain" | "unknown";
    obligations: string;
    proprietaryUse: "allowed" | "conditional" | "prohibited" | "unclear";
    reasoning: string;
    confidence: number;
}
export declare function adjudicate(cfg: AiConfig, licenseText: string, hint?: string): Promise<Adjudication>;
