/** Request and response shapes of the Voozin REST API (snake_case, as on the wire). */

export type Attachment =
  | { filename: string; content: string; content_type?: string }
  | { filename: string; path: string; content_type?: string };

type Content =
  | { subject: string; html?: string; text?: string; template_id?: never }
  | { template_id: string; template_version?: number; variables?: Record<string, unknown>; subject?: never };

export type SendEmailParams = Content & {
  from: string;
  /** Up to 50 addresses. */
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  attachments?: Attachment[];
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
  track_opens?: boolean;
  track_clicks?: boolean;
  unsubscribe?: boolean;
  scheduled_at?: string;
};

export type EmailStatus = "QUEUED" | "SENDING" | "SENT" | "DEFERRED" | "FAILED" | "PARTIAL" | "SCHEDULED" | "CANCELED" | (string & {});

export interface SendEmailResponse {
  id: string;
  status: EmailStatus;
  suppressed: string[];
  scheduled_at: string | null;
}

export interface BatchResponse {
  data: SendEmailResponse[];
}

export interface Email {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  status: EmailStatus;
  stream: string;
  source: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  template_id: string | null;
  template_version: number | null;
  campaign_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface ListEmailsParams {
  status?: string;
  tag?: string;
  source?: "api" | "campaign";
  campaign_id?: string;
  to?: string;
  after?: string;
  before?: string;
  limit?: number;
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface List<T> {
  data: T[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  alias: string;
  published_version: number | null;
  latest_version: number | null;
  subject: string | null;
  updated_at: string;
  created_at: string;
}

export interface RenderTemplateParams {
  subject: string;
  html?: string;
  text?: string;
  variables?: Record<string, unknown>;
}

export interface RenderedTemplate {
  subject: string;
  html: string | null;
  text: string | null;
  [key: string]: unknown;
}

export interface Domain {
  id: string;
  name: string;
  status: "PENDING" | "VERIFYING" | "ACTIVE" | "FAILED" | (string & {});
  verified_at: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  created_at: string;
  dns_records?: { type: string; purpose: string; host: string; value: string; priority: number | null; status: string }[];
}

export type EmailEventType =
  | "email.sent"
  | "email.scheduled"
  | "email.canceled"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.complained"
  | "email.opened"
  | "email.clicked"
  | "email.unsubscribed";

export type ContactEventType = "contact.created" | "contact.updated" | "contact.unsubscribed";

export type EventType = EmailEventType | ContactEventType | "inbound.received";

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  [key: string]: unknown;
}

export interface CreateWebhookParams {
  url: string;
  events?: EventType[];
  description?: string;
}

export interface Address {
  name: string | null;
  address: string | null;
}

export interface InboundAttachment {
  index: number;
  filename: string | null;
  content_type: string | null;
  content_id: string | null;
  size: number;
  url: string;
}

/** The `data` of an `inbound.received` event. Parsed fields are missing once content is purged (`content_available: false`). */
export interface InboundMessage {
  id: string;
  route_id: string;
  received_at: string;
  mail_from: string;
  recipients: string[];
  size: number;
  auth: { spf?: string; dkimPass?: boolean; aligned?: boolean; dmarc?: Record<string, unknown>; [key: string]: unknown } | null;
  content_available: boolean;
  parse_error?: string;
  from?: Address | null;
  to?: Address[];
  cc?: Address[];
  reply_to?: Address[];
  subject?: string | null;
  message_id?: string | null;
  in_reply_to?: string | null;
  references?: string[] | null;
  date?: string | null;
  text?: string;
  html?: string;
  truncated?: boolean;
  headers?: { name: string; value: string }[];
  attachments?: InboundAttachment[];
  raw_url?: string;
}

export interface EmailEventData {
  email_id: string;
  from: string;
  to: string[];
  recipient?: string;
  subject: string | null;
  tags: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
  campaign_id: string | null;
  contact_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

export type WebhookEvent =
  | { type: "inbound.received"; timestamp: string; data: InboundMessage }
  | { type: EmailEventType; timestamp: string; data: EmailEventData }
  | { type: ContactEventType; timestamp: string; data: Record<string, unknown> };

export interface InboundRoute {
  id: string;
  domain_id: string;
  pattern: string;
  endpoint_id: string | null;
  mailbox_id: string | null;
  enabled: boolean;
  [key: string]: unknown;
}

export interface CreateInboundRouteParams {
  domain_id: string;
  pattern: string;
  endpoint_id?: string | null;
  mailbox_id?: string | null;
  enabled?: boolean;
}

export interface ListInboundParams {
  route_id?: string;
  status?: "received" | "delivered" | "failed";
  limit?: number;
  cursor?: string;
}

export interface InboundFile {
  filename: string | null;
  contentType: string;
  content: ArrayBuffer;
}

export type ReplyParams = Omit<SendEmailParams, "to" | "subject" | "template_id"> & {
  html?: string;
  text?: string;
  /** Defaults to the message's Reply-To, or its sender. */
  to?: string | string[];
  /** Defaults to "Re: <original subject>". */
  subject?: string;
};

export interface RequestOptions {
  /** Sent as the Idempotency-Key header; a repeat within 24 hours returns the first response. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}
