import { WebhookVerificationError } from "./errors.js";
import type { WebhookEvent } from "./types.js";
import { verifyWebhook } from "./webhooks.js";

export interface WebhookHandlerOptions {
  /** The endpoint's signing secret (whsec_…). */
  secret: string;
  onEvent: (event: WebhookEvent, request: Request) => unknown | Promise<unknown>;
}

/**
 * A route handler for the App Router (or any Fetch API runtime) that verifies Voozin webhooks.
 *
 * ```ts
 * // app/api/webhooks/voozin/route.ts
 * export const POST = createWebhookHandler({ secret: process.env.VOOZIN_WEBHOOK_SECRET!, onEvent });
 * ```
 *
 * Responds 204 when `onEvent` resolves, 400 for an invalid signature, and 500 when `onEvent`
 * throws, so Voozin retries the delivery.
 */
export function createWebhookHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    let event: WebhookEvent;
    try {
      event = await verifyWebhook(await request.text(), request.headers, options.secret);
    } catch (err) {
      if (err instanceof WebhookVerificationError) return Response.json({ error: err.message }, { status: 400 });
      throw err;
    }
    try {
      await options.onEvent(event, request);
    } catch (err) {
      console.error("voozin: webhook handler failed", err);
      return Response.json({ error: "handler failed" }, { status: 500 });
    }
    return new Response(null, { status: 204 });
  };
}
