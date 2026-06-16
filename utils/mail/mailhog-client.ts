/**
 * Minimal MailHog HTTP API client.
 *
 * MailHog (see docker-compose `mailhog` service) is a fake SMTP server that
 * captures every message Odoo sends and exposes them over an HTTP API on
 * :8025. The POS "email receipt" test uses this client to prove the email
 * actually left Odoo — not just that the UI said it did.
 *
 * Design mirrors the PostgREST client: framework-agnostic, depends only on
 * Node's global `fetch` (Node 18+), and NEVER calls `expect`. Helpers throw a
 * descriptive `MailhogError` on a bad response so the assertions can stay in
 * the spec.
 *
 * API reference: https://github.com/mailhog/MailHog/blob/master/docs/APIv2.md
 *   GET    /api/v2/search?kind=to&query=<addr>  → { total, items: [...] }
 *   GET    /api/v2/messages                      → { total, items: [...] }
 *   DELETE /api/v1/messages                      → 200, clears the inbox
 */

/** Where MailHog's HTTP API lives. Overridable for CI/other hosts. */
export const MAILHOG_ENV = {
  baseUrl: "MAILHOG_URL",
  timeoutMs: "MAILHOG_TIMEOUT_MS",
} as const;

const DEFAULT_BASE_URL = "http://localhost:8025";
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * One captured message, narrowed to the fields the tests care about. MailHog
 * returns much more (MIME parts, raw data); we expose the recipient list and
 * subject, which is enough to assert the right email reached the right address.
 */
export interface MailhogMessage {
  /** MailHog's internal message id. */
  id: string;
  /** Recipient addresses, normalised to `local@domain` strings. */
  to: string[];
  /** Decoded Subject header (empty string when absent). */
  subject: string;
}

/** Raw MailHog message shape (only the parts we read). */
interface RawMailhogMessage {
  ID: string;
  Content?: { Headers?: Record<string, string[]> };
  To?: Array<{ Mailbox: string; Domain: string }>;
}

interface RawSearchResponse {
  total: number;
  items: RawMailhogMessage[];
}

/** Thrown for any non-2xx MailHog response or transport failure. */
export class MailhogError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(args: { status: number; statusText: string; url: string }) {
    super(`MailHog ${args.status} ${args.statusText} for ${args.url}`);
    this.name = "MailhogError";
    this.status = args.status;
    this.url = args.url;
  }
}

export class MailhogClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(overrides: { baseUrl?: string; timeoutMs?: number } = {}) {
    this.baseUrl = (
      overrides.baseUrl ??
      process.env[MAILHOG_ENV.baseUrl] ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    const envTimeout = process.env[MAILHOG_ENV.timeoutMs];
    this.timeoutMs = overrides.timeoutMs ?? (envTimeout ? Number(envTimeout) : DEFAULT_TIMEOUT_MS);
  }

  /**
   * Search captured messages by recipient address (exact, server-side `to`
   * match). Returns a normalised, possibly empty list — callers assert on it.
   */
  async searchByRecipient(address: string): Promise<MailhogMessage[]> {
    const url = `${this.baseUrl}/api/v2/search?kind=to&query=${encodeURIComponent(address)}`;
    const raw = await this.request<RawSearchResponse>(url, "GET");
    return (raw.items ?? []).map(normalizeMessage);
  }

  /** Delete every captured message (use to start a run from a clean inbox). */
  async deleteAll(): Promise<void> {
    await this.request<unknown>(`${this.baseUrl}/api/v1/messages`, "DELETE");
  }

  /** Shared fetch wrapper: timeout, error mapping, tolerant JSON parse. */
  private async request<R>(url: string, method: "GET" | "DELETE"): Promise<R> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { method, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        throw new MailhogError({
          status: response.status,
          statusText: response.statusText,
          url,
        });
      }
      return (text ? JSON.parse(text) : undefined) as R;
    } catch (err) {
      if (err instanceof MailhogError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new MailhogError({
          status: 0,
          statusText: `Request timed out after ${this.timeoutMs}ms`,
          url,
        });
      }
      throw new MailhogError({
        status: 0,
        statusText: err instanceof Error ? err.message : String(err),
        url,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Project a raw MailHog message onto the fields the tests assert on. */
function normalizeMessage(raw: RawMailhogMessage): MailhogMessage {
  const to = (raw.To ?? []).map((addr) => `${addr.Mailbox}@${addr.Domain}`);
  const subjectHeader = raw.Content?.Headers?.Subject;
  const subject = Array.isArray(subjectHeader) ? (subjectHeader[0] ?? "") : "";
  return { id: raw.ID, to, subject };
}
