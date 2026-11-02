import { WebhookVerificationError } from "./errors.js";
import type { WebhookEvent } from "./types.js";

export type HeaderSource = Headers | Record<string, string | string[] | undefined>;
export type RawBody = string | ArrayBuffer | ArrayBufferView;

/** Signatures older or newer than this many seconds are rejected. */
const TOLERANCE_SECONDS = 5 * 60;

function header(headers: HeaderSource, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

function toBytes(body: RawBody): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(secret: string, id: string, timestamp: string, body: RawBody): Promise<string> {
  let keyBytes: Uint8Array;
  try {
    keyBytes = fromBase64(secret.replace(/^whsec_/, ""));
  } catch {
    throw new WebhookVerificationError("The webhook secret is not valid base64; copy it again from the dashboard");
  }
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const payload = toBytes(body);
  const message = new Uint8Array(prefix.length + payload.length);
  message.set(prefix);
  message.set(payload, prefix.length);
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, message as BufferSource)));
}

/**
 * Verifies a Standard Webhooks signature and returns the parsed event.
 * `rawBody` must be the exact bytes received, before any JSON parsing.
 */
export async function verifyWebhook(rawBody: RawBody, headers: HeaderSource, secret: string, now: number = Date.now()): Promise<WebhookEvent> {
  if (!secret) throw new WebhookVerificationError("No webhook secret configured");
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatures = header(headers, "webhook-signature");
  if (!id || !timestamp || !signatures) throw new WebhookVerificationError("Missing webhook-id, webhook-timestamp or webhook-signature header");

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) {
    throw new WebhookVerificationError("Webhook timestamp is too old or too far in the future");
  }

  const expected = await sign(secret, id, timestamp, rawBody);
  const valid = signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    return version === "v1" && value !== undefined && timingSafeEqual(value, expected);
  });
  if (!valid) throw new WebhookVerificationError("Webhook signature does not match");

  const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(toBytes(rawBody));
  try {
    return JSON.parse(text) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError("Webhook body is not valid JSON");
  }
}
