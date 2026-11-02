import { VoozinError } from "./errors.js";
import type { RequestOptions } from "./types.js";
import { VERSION } from "./version.js";

export interface ClientOptions {
  /** Defaults to https://api.voozin.com */
  baseUrl?: string;
  /** Retries for 429, 5xx and network errors. Defaults to 2. */
  maxRetries?: number;
  /** Milliseconds per attempt. Defaults to 30 000. */
  timeout?: number;
  /** A custom fetch, for tests or proxies. */
  fetch?: typeof fetch;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface Call extends RequestOptions {
  query?: object;
  body?: unknown;
  /** Return the raw Response instead of parsing JSON. */
  raw?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Http {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeout: number;
  private readonly fetch: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options: ClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? "https://api.voozin.com").replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 2;
    this.timeout = options.timeout ?? 30_000;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  request<T>(method: Method, path: string, call: Call & { raw: true }): Promise<Response>;
  request<T>(method: Method, path: string, call?: Call): Promise<T>;
  async request<T>(method: Method, path: string, call: Call = {}): Promise<T | Response> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(call.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: call.raw ? "*/*" : "application/json",
      "user-agent": `voozin-node/${VERSION}`,
    };
    if (call.body !== undefined) headers["content-type"] = "application/json";
    if (call.idempotencyKey) headers["idempotency-key"] = call.idempotencyKey;
    // A POST without an idempotency key may have been processed when the connection failed.
    const safeToRepeat = method !== "POST" || Boolean(call.idempotencyKey);

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(url, {
          method,
          headers,
          body: call.body === undefined ? undefined : JSON.stringify(call.body),
          signal: withTimeout(this.timeout, call.signal),
        });
      } catch (err) {
        if (call.signal?.aborted || !safeToRepeat || attempt >= this.maxRetries) {
          throw new VoozinError(`Request to Voozin failed: ${err instanceof Error ? err.message : String(err)}`, { statusCode: 0, error: "NetworkError", cause: err });
        }
        await sleep(backoff(attempt));
        continue;
      }

      if (response.ok) {
        if (call.raw) return response;
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const retryable = response.status === 429 || (response.status >= 500 && safeToRepeat);
      if (retryable && attempt < this.maxRetries) {
        await sleep(retryAfter !== undefined ? Math.min(retryAfter * 1000, 60_000) : backoff(attempt));
        continue;
      }
      throw await toError(response, retryAfter);
    }
  }
}

/** Chains the caller's signal with the timeout; AbortSignal.any is missing in some edge runtimes. */
function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const controller = new AbortController();
  const abort = (source: AbortSignal) => controller.abort(source.reason);
  if (signal.aborted) abort(signal);
  signal.addEventListener("abort", () => abort(signal), { once: true });
  timeout.addEventListener("abort", () => abort(timeout), { once: true });
  return controller.signal;
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8_000) * (0.75 + Math.random() * 0.5);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

async function toError(response: Response, retryAfter: number | undefined): Promise<VoozinError> {
  let body: { message?: string | string[]; error?: string; index?: number } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // not JSON
  }
  const message = Array.isArray(body.message) ? body.message.join("; ") : (body.message ?? `Voozin API returned ${response.status}`);
  return new VoozinError(message, { statusCode: response.status, error: body.error ?? response.statusText, index: body.index, retryAfter });
}
