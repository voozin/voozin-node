import { WebhookVerificationError } from "./errors.js";
import type { WebhookEvent } from "./types.js";
import { verifyWebhook } from "./webhooks.js";

/** The parts of Express's request and response used here, so express is not a dependency. */
interface Req extends AsyncIterable<unknown> {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
  end(): unknown;
}
type Next = (err?: unknown) => void;

export interface WebhookHandlerOptions<R extends Req = Req> {
  /** The endpoint's signing secret (whsec_…). */
  secret: string;
  onEvent: (event: WebhookEvent, req: R) => unknown | Promise<unknown>;
}

async function rawBody(req: Req): Promise<string | Uint8Array> {
  if (typeof req.body === "string" || req.body instanceof Uint8Array) return req.body;
  if (req.body !== undefined && req.body !== null && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    throw new Error("voozin: the request body was already parsed as JSON. Mount express.raw({ type: 'application/json' }) on the webhook route.");
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : (chunk as Uint8Array));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/**
 * Express middleware that verifies a Voozin webhook and calls `onEvent`.
 *
 * ```ts
 * app.post("/webhooks/voozin", express.raw({ type: "application/json" }), webhookHandler({ secret, onEvent }));
 * ```
 *
 * Responds 204 when `onEvent` resolves and 400 for an invalid signature; other errors go to
 * `next(err)`, so Voozin retries the delivery.
 */
export function webhookHandler<R extends Req = Req>(options: WebhookHandlerOptions<R>): (req: R, res: Res, next: Next) => Promise<void> {
  return async (req, res, next) => {
    try {
      const event = await verifyWebhook(await rawBody(req), req.headers, options.secret);
      await options.onEvent(event, req);
      res.status(204).end();
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  };
}
