/** An error response from the Voozin API, or a request that could not complete. */
export class VoozinError extends Error {
  readonly statusCode: number;
  readonly error: string;
  /** For batch sends: the entry that failed validation. */
  readonly index?: number;
  readonly retryAfter?: number;

  constructor(message: string, init: { statusCode: number; error?: string; index?: number; retryAfter?: number; cause?: unknown }) {
    super(message, { cause: init.cause });
    this.name = "VoozinError";
    this.statusCode = init.statusCode;
    this.error = init.error ?? "Error";
    this.index = init.index;
    this.retryAfter = init.retryAfter;
  }
}

/** The webhook signature, timestamp or headers were invalid. Respond with 400. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
