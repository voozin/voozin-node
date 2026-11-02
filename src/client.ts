import { VoozinError } from "./errors.js";
import { type ClientOptions, Http } from "./http.js";
import type {
  BatchResponse,
  CreateInboundRouteParams,
  CreateWebhookParams,
  Domain,
  Email,
  InboundFile,
  InboundMessage,
  InboundRoute,
  List,
  ListEmailsParams,
  ListInboundParams,
  Page,
  RenderedTemplate,
  RenderTemplateParams,
  ReplyParams,
  RequestOptions,
  SendEmailParams,
  SendEmailResponse,
  TemplateSummary,
  WebhookEndpoint,
  WebhookEvent,
} from "./types.js";
import { type HeaderSource, type RawBody, verifyWebhook } from "./webhooks.js";

export type { ClientOptions };

const id = (value: string) => encodeURIComponent(value);

/** Wraps a message id in angle brackets, as In-Reply-To and References require. */
const bracket = (messageId: string) => (messageId.startsWith("<") ? messageId : `<${messageId}>`);

class Emails {
  constructor(private readonly http: Http) {}

  send(params: SendEmailParams, options?: RequestOptions): Promise<SendEmailResponse> {
    return this.http.request("POST", "/v1/emails", { body: params, ...options });
  }

  /** Up to 100 emails. Nothing is sent unless every entry is valid. */
  batch(emails: SendEmailParams[], options?: RequestOptions): Promise<BatchResponse> {
    return this.http.request("POST", "/v1/emails/batch", { body: { emails }, ...options });
  }

  get(emailId: string): Promise<Email> {
    return this.http.request("GET", `/v1/emails/${id(emailId)}`);
  }

  list(params: ListEmailsParams = {}): Promise<Page<Email>> {
    return this.http.request("GET", "/v1/emails", { query: params });
  }

  cancel(emailId: string): Promise<{ id: string; status: string }> {
    return this.http.request("POST", `/v1/emails/${id(emailId)}/cancel`);
  }

  reschedule(emailId: string, scheduledAt: string | Date): Promise<{ id: string; scheduled_at: string }> {
    const scheduled_at = scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt;
    return this.http.request("PATCH", `/v1/emails/${id(emailId)}`, { body: { scheduled_at } });
  }
}

class Templates {
  constructor(private readonly http: Http) {}

  list(): Promise<List<TemplateSummary>> {
    return this.http.request("GET", "/v1/templates");
  }

  /** By id or alias, with its versions. */
  get(idOrAlias: string): Promise<TemplateSummary & { versions: Record<string, unknown>[] }> {
    return this.http.request("GET", `/v1/templates/${id(idOrAlias)}`);
  }

  /** Renders content without saving it. */
  render(params: RenderTemplateParams): Promise<RenderedTemplate> {
    return this.http.request("POST", "/v1/templates/render", { body: params });
  }
}

class Domains {
  constructor(private readonly http: Http) {}

  list(): Promise<List<Domain>> {
    return this.http.request("GET", "/v1/domains");
  }

  get(domainId: string): Promise<Domain> {
    return this.http.request("GET", `/v1/domains/${id(domainId)}`);
  }
}

class Webhooks {
  constructor(private readonly http: Http) {}

  /** Verifies a delivery's signature and returns the event. See `verifyWebhook`. */
  verify(rawBody: RawBody, headers: HeaderSource, secret: string): Promise<WebhookEvent> {
    return verifyWebhook(rawBody, headers, secret);
  }

  /** The response includes the endpoint's signing `secret`. */
  create(params: CreateWebhookParams): Promise<WebhookEndpoint & { secret: string }> {
    return this.http.request("POST", "/v1/webhooks", { body: params });
  }

  list(): Promise<List<WebhookEndpoint>> {
    return this.http.request("GET", "/v1/webhooks");
  }

  get(endpointId: string): Promise<WebhookEndpoint> {
    return this.http.request("GET", `/v1/webhooks/${id(endpointId)}`);
  }

  update(endpointId: string, params: Partial<CreateWebhookParams> & { enabled?: boolean }): Promise<WebhookEndpoint> {
    return this.http.request("PATCH", `/v1/webhooks/${id(endpointId)}`, { body: params });
  }

  delete(endpointId: string): Promise<void> {
    return this.http.request("DELETE", `/v1/webhooks/${id(endpointId)}`);
  }
}

class InboundRoutes {
  constructor(private readonly http: Http) {}

  create(params: CreateInboundRouteParams): Promise<InboundRoute> {
    return this.http.request("POST", "/v1/inbound-routes", { body: params });
  }

  list(): Promise<List<InboundRoute>> {
    return this.http.request("GET", "/v1/inbound-routes");
  }

  get(routeId: string): Promise<InboundRoute> {
    return this.http.request("GET", `/v1/inbound-routes/${id(routeId)}`);
  }

  update(routeId: string, params: Partial<CreateInboundRouteParams>): Promise<InboundRoute> {
    return this.http.request("PATCH", `/v1/inbound-routes/${id(routeId)}`, { body: params });
  }

  delete(routeId: string): Promise<void> {
    return this.http.request("DELETE", `/v1/inbound-routes/${id(routeId)}`);
  }
}

class Inbound {
  readonly routes: InboundRoutes;

  constructor(
    private readonly http: Http,
    private readonly emails: Emails,
  ) {
    this.routes = new InboundRoutes(http);
  }

  list(params: ListInboundParams = {}): Promise<Page<Record<string, unknown>>> {
    return this.http.request("GET", "/v1/inbound", { query: params });
  }

  /** The parsed message and its webhook deliveries. */
  get(inboundId: string): Promise<Record<string, unknown> & { payload?: InboundMessage }> {
    return this.http.request("GET", `/v1/inbound/${id(inboundId)}`);
  }

  /** The original message (message/rfc822). */
  async raw(inboundId: string): Promise<ArrayBuffer> {
    const response = await this.http.request("GET", `/v1/inbound/${id(inboundId)}/raw`, { raw: true });
    return response.arrayBuffer();
  }

  async attachment(inboundId: string, index: number): Promise<InboundFile> {
    const response = await this.http.request("GET", `/v1/inbound/${id(inboundId)}/attachments/${index}`, { raw: true });
    return {
      filename: filenameFrom(response.headers.get("content-disposition")),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      content: await response.arrayBuffer(),
    };
  }

  /** Sends inbound.received again with fresh links, to the route's endpoint or another one. */
  replay(inboundId: string, options: { endpoint_id?: string } = {}): Promise<Record<string, unknown>> {
    return this.http.request("POST", `/v1/inbound/${id(inboundId)}/replay`, { body: options });
  }

  /**
   * Replies to an inbound message so it threads in the sender's mail app: sends to its Reply-To
   * (or sender), prefixes the subject with "Re:", and sets In-Reply-To and References.
   */
  reply(message: InboundMessage, params: ReplyParams, options?: RequestOptions): Promise<SendEmailResponse> {
    const to = params.to ?? replyRecipients(message);
    if (!to || (Array.isArray(to) && to.length === 0)) {
      throw new VoozinError("The inbound message has no sender address to reply to", { statusCode: 0, error: "InvalidMessage" });
    }
    const original = message.subject?.trim() ?? "";
    const subject = params.subject ?? (/^re:/i.test(original) ? original : `Re: ${original}`.trim());
    const headers: Record<string, string> = { ...params.headers };
    if (message.message_id) {
      headers["In-Reply-To"] = bracket(message.message_id);
      headers["References"] = [...(message.references ?? []), message.message_id].map(bracket).join(" ");
    }
    const { to: _to, subject: _subject, ...rest } = params;
    return this.emails.send({ ...rest, to, subject, headers }, options);
  }
}

function replyRecipients(message: InboundMessage): string[] {
  const replyTo = (message.reply_to ?? []).map((a) => a.address).filter((a): a is string => Boolean(a));
  if (replyTo.length > 0) return replyTo;
  const from = message.from?.address ?? message.mail_from;
  return from ? [from] : [];
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded?.[1]) return decodeURIComponent(encoded[1]);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? null;
}

/**
 * The Voozin API client.
 *
 * ```ts
 * const voozin = new Voozin(process.env.VOOZIN_API_KEY);
 * await voozin.emails.send({ from: "hello@acme.com", to: "ada@example.com", subject: "Hi", text: "Hello" });
 * ```
 */
export class Voozin {
  readonly emails: Emails;
  readonly templates: Templates;
  readonly domains: Domains;
  readonly webhooks: Webhooks;
  readonly inbound: Inbound;

  constructor(apiKey?: string, options: ClientOptions = {}) {
    const key = apiKey ?? readEnv("VOOZIN_API_KEY");
    if (!key) {
      throw new VoozinError("Missing API key: pass it to new Voozin(apiKey) or set VOOZIN_API_KEY", { statusCode: 0, error: "MissingApiKey" });
    }
    const http = new Http(key, options);
    this.emails = new Emails(http);
    this.templates = new Templates(http);
    this.domains = new Domains(http);
    this.webhooks = new Webhooks(http);
    this.inbound = new Inbound(http, this.emails);
  }
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name] || undefined;
}
