import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { webhookHandler } from "../src/express.js";
import { verifyWebhook, WebhookVerificationError } from "../src/index.js";
import { createWebhookHandler } from "../src/next.js";

const secret = `whsec_${Buffer.from("test-secret-key-0123456789abcdef").toString("base64")}`;
const body = JSON.stringify({ type: "email.delivered", timestamp: "2026-10-26T10:00:00Z", data: { email_id: "e1", recipient: "ada@example.com" } });

/** Signs like Voozin does, with node:crypto, to cross-check the Web Crypto implementation. */
function signed(payload = body, timestamp = Math.floor(Date.now() / 1000), id = "msg_1") {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}` };
}

describe("verifyWebhook", () => {
  it("accepts a valid signature from a string, bytes or Headers", async () => {
    const headers = signed();
    await expect(verifyWebhook(body, headers, secret)).resolves.toMatchObject({ type: "email.delivered", data: { email_id: "e1" } });
    await expect(verifyWebhook(Buffer.from(body), headers, secret)).resolves.toMatchObject({ type: "email.delivered" });
    await expect(verifyWebhook(new TextEncoder().encode(body).buffer, new Headers(headers), secret)).resolves.toMatchObject({ type: "email.delivered" });
  });

  it("accepts any of several signatures (secret rotation)", async () => {
    const headers = signed();
    headers["webhook-signature"] = `v1,AAAA ${headers["webhook-signature"]}`;
    await expect(verifyWebhook(body, headers, secret)).resolves.toBeTruthy();
  });

  it("matches header names case-insensitively", async () => {
    const headers = Object.fromEntries(Object.entries(signed()).map(([k, v]) => [k.toUpperCase(), v]));
    await expect(verifyWebhook(body, headers, secret)).resolves.toBeTruthy();
  });

  it("rejects a modified body, a wrong secret and missing headers", async () => {
    const headers = signed();
    await expect(verifyWebhook(body.replace("e1", "e2"), headers, secret)).rejects.toBeInstanceOf(WebhookVerificationError);
    await expect(verifyWebhook(body, headers, `whsec_${Buffer.from("other").toString("base64")}`)).rejects.toThrow(/does not match/);
    await expect(verifyWebhook(body, { "webhook-id": "x" }, secret)).rejects.toThrow(/Missing/);
    await expect(verifyWebhook(body, headers, "")).rejects.toThrow(/secret/);
  });

  it("rejects old and future timestamps", async () => {
    const old = signed(body, Math.floor(Date.now() / 1000) - 600);
    await expect(verifyWebhook(body, old, secret)).rejects.toThrow(/timestamp/);
    const future = signed(body, Math.floor(Date.now() / 1000) + 600);
    await expect(verifyWebhook(body, future, secret)).rejects.toThrow(/timestamp/);
  });
});

describe("voozin/next", () => {
  const request = (headers: Record<string, string>, payload = body) => new Request("https://acme.com/api/webhooks/voozin", { method: "POST", headers, body: payload });

  it("calls onEvent and responds 204", async () => {
    const onEvent = vi.fn();
    const response = await createWebhookHandler({ secret, onEvent })(request(signed()));
    expect(response.status).toBe(204);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "email.delivered" }), expect.any(Request));
  });

  it("responds 400 for a bad signature and 500 when the handler throws", async () => {
    const bad = await createWebhookHandler({ secret, onEvent: vi.fn() })(request({ ...signed(), "webhook-signature": "v1,nope" }));
    expect(bad.status).toBe(400);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = await createWebhookHandler({ secret, onEvent: () => Promise.reject(new Error("db down")) })(request(signed()));
    expect(failing.status).toBe(500);
  });
});

describe("voozin/express", () => {
  function response() {
    const res = { statusCode: 0, body: undefined as unknown, ended: false };
    const api = {
      status(code: number) {
        res.statusCode = code;
        return api;
      },
      json(value: unknown) {
        res.body = value;
        return api;
      },
      end() {
        res.ended = true;
        return api;
      },
    };
    return { res, api };
  }

  it("verifies a Buffer body from express.raw", async () => {
    const onEvent = vi.fn();
    const { res, api } = response();
    const req = Object.assign(Readable.from([]), { body: Buffer.from(body), headers: signed() });
    await webhookHandler({ secret, onEvent })(req, api, vi.fn());
    expect(res.statusCode).toBe(204);
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it("reads the stream when no body parser ran", async () => {
    const { res, api } = response();
    const req = Object.assign(Readable.from([Buffer.from(body.slice(0, 10)), Buffer.from(body.slice(10))]), { headers: signed() });
    await webhookHandler({ secret, onEvent: vi.fn() })(req, api, vi.fn());
    expect(res.statusCode).toBe(204);
  });

  it("responds 400 for bad signatures and passes parsed-JSON bodies and handler errors to next", async () => {
    const bad = response();
    await webhookHandler({ secret, onEvent: vi.fn() })(Object.assign(Readable.from([]), { body: Buffer.from(body), headers: { ...signed(), "webhook-signature": "v1,x" } }), bad.api, vi.fn());
    expect(bad.res.statusCode).toBe(400);

    const next = vi.fn();
    await webhookHandler({ secret, onEvent: vi.fn() })(Object.assign(Readable.from([]), { body: JSON.parse(body), headers: signed() }), response().api, next);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(String(next.mock.calls[0]?.[0])).toMatch(/express\.raw/);
  });
});
