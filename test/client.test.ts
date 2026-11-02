import { describe, expect, it, vi } from "vitest";
import { Voozin, VoozinError } from "../src/index.js";
import type { InboundMessage } from "../src/types.js";

type Call = { url: string; init: RequestInit };

function mockFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const header = (call: Call | undefined, name: string) => (call?.init.headers as Record<string, string>)[name];

describe("Voozin client", () => {
  it("sends an email with auth and idempotency headers", async () => {
    const { fetch, calls } = mockFetch(json({ id: "e1", status: "QUEUED", suppressed: [], scheduled_at: null }));
    const voozin = new Voozin("ic_live_test", { fetch });
    const result = await voozin.emails.send({ from: "a@acme.com", to: "b@example.com", subject: "Hi", text: "Hello" }, { idempotencyKey: "k1" });

    expect(result.id).toBe("e1");
    expect(calls[0]?.url).toBe("https://api.voozin.com/v1/emails");
    expect(calls[0]?.init.method).toBe("POST");
    expect(header(calls[0], "authorization")).toBe("Bearer ic_live_test");
    expect(header(calls[0], "idempotency-key")).toBe("k1");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ to: "b@example.com", subject: "Hi" });
  });

  it("uses a custom base URL and query parameters", async () => {
    const { fetch, calls } = mockFetch(json({ data: [], next_cursor: null }));
    const voozin = new Voozin("k", { fetch, baseUrl: "http://localhost:3000/" });
    await voozin.emails.list({ tag: "category:receipt", limit: 10, cursor: undefined });
    expect(calls[0]?.url).toBe("http://localhost:3000/v1/emails?tag=category%3Areceipt&limit=10");
  });

  it("wraps a batch in { emails }", async () => {
    const { fetch, calls } = mockFetch(json({ data: [] }));
    await new Voozin("k", { fetch }).emails.batch([{ from: "a@acme.com", to: ["b@x.com"], subject: "s", text: "t" }]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ emails: [{ from: "a@acme.com", to: ["b@x.com"], subject: "s", text: "t" }] });
  });

  it("throws VoozinError with the API's message", async () => {
    const { fetch } = mockFetch(json({ statusCode: 403, error: "Forbidden", message: "missing scope" }, 403));
    const err = await new Voozin("k", { fetch }).emails.get("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoozinError);
    expect(err).toMatchObject({ statusCode: 403, error: "Forbidden", message: "missing scope" });
  });

  it("joins validation messages and keeps the batch index", async () => {
    const { fetch } = mockFetch(json({ statusCode: 400, error: "Bad Request", message: ["to must be an array", "from is required"], index: 2 }, 400));
    const err = (await new Voozin("k", { fetch }).emails.batch([]).catch((e: unknown) => e)) as VoozinError;
    expect(err.message).toBe("to must be an array; from is required");
    expect(err.index).toBe(2);
  });

  it("retries 429 after Retry-After", async () => {
    const { fetch, calls } = mockFetch(json({ message: "slow down" }, 429, { "retry-after": "0" }), json({ id: "e1" }));
    const result = await new Voozin("k", { fetch }).emails.send({ from: "a@acme.com", to: "b@x.com", subject: "s", text: "t" });
    expect(result.id).toBe("e1");
    expect(calls).toHaveLength(2);
  });

  it("retries 5xx for GET and for POST with an idempotency key", async () => {
    const get = mockFetch(json({}, 503, { "retry-after": "0" }), json({ id: "e1" }));
    await new Voozin("k", { fetch: get.fetch }).emails.get("e1");
    expect(get.calls).toHaveLength(2);

    const post = mockFetch(json({}, 502, { "retry-after": "0" }), json({ id: "e1" }));
    await new Voozin("k", { fetch: post.fetch }).emails.send({ from: "a@acme.com", to: "b@x.com", subject: "s", text: "t" }, { idempotencyKey: "k" });
    expect(post.calls).toHaveLength(2);
  });

  it("does not retry a POST without an idempotency key after a 5xx or network error", async () => {
    const server = mockFetch(json({ message: "boom" }, 500));
    const err = await new Voozin("k", { fetch: server.fetch }).emails.send({ from: "a@acme.com", to: "b@x.com", subject: "s", text: "t" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 500 });
    expect(server.calls).toHaveLength(1);

    const network = mockFetch(new TypeError("fetch failed"));
    const netErr = await new Voozin("k", { fetch: network.fetch }).emails.send({ from: "a@acme.com", to: "b@x.com", subject: "s", text: "t" }).catch((e: unknown) => e);
    expect(netErr).toMatchObject({ statusCode: 0, error: "NetworkError" });
    expect(network.calls).toHaveLength(1);
  });

  it("gives up after maxRetries", async () => {
    const { fetch, calls } = mockFetch(json({}, 429, { "retry-after": "0" }), json({}, 429, { "retry-after": "0" }));
    const err = await new Voozin("k", { fetch, maxRetries: 1 }).domains.list().catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 429, retryAfter: 0 });
    expect(calls).toHaveLength(2);
  });

  it("returns undefined for 204 responses", async () => {
    const { fetch, calls } = mockFetch(new Response(null, { status: 204 }));
    await expect(new Voozin("k", { fetch }).inbound.routes.delete("r1")).resolves.toBeUndefined();
    expect(calls[0]?.init.method).toBe("DELETE");
  });

  it("downloads attachments with their filename and type", async () => {
    const { fetch } = mockFetch(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png", "content-disposition": "attachment; filename=\"photo.png\"" } }),
    );
    const file = await new Voozin("k", { fetch }).inbound.attachment("in1", 0);
    expect(file.filename).toBe("photo.png");
    expect(file.contentType).toBe("image/png");
    expect(new Uint8Array(file.content)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reads VOOZIN_API_KEY and fails clearly without a key", () => {
    vi.stubEnv("VOOZIN_API_KEY", "");
    expect(() => new Voozin()).toThrow(/Missing API key/);
    vi.stubEnv("VOOZIN_API_KEY", "ic_live_env");
    expect(() => new Voozin()).not.toThrow();
    vi.unstubAllEnvs();
  });
});

describe("inbound.reply", () => {
  const message: InboundMessage = {
    id: "in1",
    route_id: "r1",
    received_at: "2026-10-26T10:00:00Z",
    mail_from: "bounce@example.com",
    recipients: ["support@acme.com"],
    size: 100,
    auth: null,
    content_available: true,
    from: { name: "Ada", address: "ada@example.com" },
    reply_to: [],
    subject: "Order missing",
    message_id: "abc@mail.example.com",
    references: ["root@mail.example.com"],
  };

  it("threads the reply and answers the sender", async () => {
    const { fetch, calls } = mockFetch(json({ id: "e1" }));
    await new Voozin("k", { fetch }).inbound.reply(message, { from: "support@acme.com", text: "On it" }, { idempotencyKey: "reply-in1" });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({
      from: "support@acme.com",
      text: "On it",
      to: ["ada@example.com"],
      subject: "Re: Order missing",
      headers: { "In-Reply-To": "<abc@mail.example.com>", References: "<root@mail.example.com> <abc@mail.example.com>" },
    });
    expect(header(calls[0], "idempotency-key")).toBe("reply-in1");
  });

  it("prefers Reply-To, keeps an existing Re: and allows overrides", async () => {
    const { fetch, calls } = mockFetch(json({ id: "e1" }), json({ id: "e2" }));
    const voozin = new Voozin("k", { fetch });
    await voozin.inbound.reply({ ...message, subject: "RE: Order missing", reply_to: [{ name: null, address: "team@example.com" }] }, { from: "s@acme.com", text: "x" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ to: ["team@example.com"], subject: "RE: Order missing" });

    await voozin.inbound.reply(message, { from: "s@acme.com", text: "x", to: ["other@example.com"], subject: "Custom", headers: { "X-Ticket": "42" } });
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      to: ["other@example.com"],
      subject: "Custom",
      headers: { "X-Ticket": "42", "In-Reply-To": "<abc@mail.example.com>" },
    });
  });

  it("falls back to the envelope sender and skips threading headers without a Message-ID", async () => {
    const { fetch, calls } = mockFetch(json({ id: "e1" }));
    await new Voozin("k", { fetch }).inbound.reply({ ...message, from: null, message_id: null }, { from: "s@acme.com", text: "x" });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.to).toEqual(["bounce@example.com"]);
    expect(body.headers).toEqual({});
  });
});
