# voozin

The official Node.js SDK for [Voozin](https://voozin.com): send transactional email, verify signed webhooks, receive inbound email and reply to it.

- TypeScript, ESM and CommonJS, no dependencies
- Works in Node.js 20+, Bun, Deno, Cloudflare Workers and the Vercel Edge runtime
- Retries rate limits and server errors safely, with idempotency keys
- Helpers for Next.js route handlers and Express

```bash
npm install voozin
```

## Send an email

```ts
import { Voozin } from "voozin";

const voozin = new Voozin(process.env.VOOZIN_API_KEY);

const { id } = await voozin.emails.send(
  {
    from: "Acme <hello@acme.com>",
    to: ["ada@example.com"],
    subject: "Welcome to Acme",
    html: "<p>Thanks for signing up!</p>",
    tags: { category: "welcome" },
  },
  { idempotencyKey: "welcome-user-42" },
);
```

Create an API key under **Developers → API keys** in the [Voozin dashboard](https://app.voozin.com). The sending domain must be verified.

Templates, batch sending, scheduling and listing:

```ts
await voozin.emails.send({ from, to: [user.email], template_id: "password-reset", variables: { reset_url } });
await voozin.emails.batch([email1, email2]); // up to 100
await voozin.emails.reschedule(id, new Date("2026-11-02T09:00:00Z"));
await voozin.emails.cancel(id);
const page = await voozin.emails.list({ tag: "category:welcome", limit: 50 });
```

## Webhooks

```ts
import { verifyWebhook, WebhookVerificationError } from "voozin";

const event = await verifyWebhook(rawBody, headers, process.env.VOOZIN_WEBHOOK_SECRET!);
if (event.type === "email.bounced") {
  console.log(event.data.recipient);
}
```

Verify against the raw request body. Invalid signatures and timestamps older than five minutes throw `WebhookVerificationError`.

### Next.js (App Router)

```ts
// app/api/webhooks/voozin/route.ts
import { createWebhookHandler } from "voozin/next";

export const POST = createWebhookHandler({
  secret: process.env.VOOZIN_WEBHOOK_SECRET!,
  async onEvent(event) {
    // ...
  },
});
```

### Express

```ts
import express from "express";
import { webhookHandler } from "voozin/express";

app.post("/webhooks/voozin", express.raw({ type: "application/json" }), webhookHandler({ secret, onEvent }));
```

## Inbound email

Route mail for an address on your domain to your webhook, then reply in the same thread:

```ts
await voozin.inbound.routes.create({ domain_id, pattern: "support", endpoint_id });

// in your webhook handler
if (event.type === "inbound.received") {
  await voozin.inbound.reply(
    event.data,
    { from: "Acme Support <support@acme.com>", text: "Thanks, we're on it." },
    { idempotencyKey: `reply-${event.data.id}` },
  );
}
```

`reply` sends to the Reply-To (or sender) address, prefixes the subject with `Re:`, and sets `In-Reply-To` and `References`. Download the original message or attachments with `voozin.inbound.raw(id)` and `voozin.inbound.attachment(id, index)`.

## Errors and retries

API errors throw `VoozinError` with `statusCode`, `error`, `message` and, for batches, `index`. Requests are retried up to `maxRetries` times (default 2) on `429`, and on `5xx` and network errors when it is safe: for `GET`, `PATCH` and `DELETE`, and for `POST` with an `idempotencyKey`.

```ts
new Voozin(apiKey, { baseUrl: "https://api.voozin.com", maxRetries: 2, timeout: 30_000 });
```

## Documentation

- [Node.js SDK reference](https://voozin.com/docs/sdk/node)
- [Quickstart](https://voozin.com/docs/quickstart)
- [API reference](https://voozin.com/docs/api-reference)

## License

MIT
