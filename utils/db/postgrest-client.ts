/**
 * Generic, reusable PostgREST client.
 *
 * Framework-agnostic on purpose: it depends only on Node's global `fetch`
 * (Node 18+), NOT on Playwright. Tests import it and call it to read the
 * source-of-truth database, but it can equally be used from a seeding script,
 * a CI data check, or a one-off Node REPL.
 *
 * Design:
 * - `PostgrestClient.from(table)` returns a chainable `QueryBuilder`.
 * - The builder maps fluent calls to PostgREST's URL query syntax
 *   (https://postgrest.org/en/stable/references/api/tables_views.html), e.g.
 *     .select("id,name").eq("state", "done").order("id", "desc").limit(1)
 *   becomes  ?select=id,name&state=eq.done&order=id.desc&limit=1
 * - `await builder` resolves to a typed array (the builder is a thenable).
 * - `.single()` / `.maybeSingle()` resolve to one row (or null) using
 *   PostgREST's object representation.
 *
 * Nothing here is Odoo-specific — table names, columns and filters are passed
 * by the caller, so the same client serves any table in the schema.
 */

import { PostgrestConfig, resolveConfig } from "./config";

/** Comparison operators supported by PostgREST horizontal filtering. */
export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "in"
  | "is";

/** Sort direction for `order`. */
export type SortDirection = "asc" | "desc";

/**
 * Error thrown for any non-2xx PostgREST response. Carries the HTTP status and
 * the parsed PostgREST error body (message / details / hint / code) so callers
 * and test reports get an actionable message instead of a bare "fetch failed".
 */
export class PostgrestError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  /** Raw PostgREST error payload, when the body parsed as JSON. */
  readonly body?: unknown;

  constructor(args: { status: number; statusText: string; url: string; body?: unknown }) {
    const detail =
      args.body && typeof args.body === "object" ? ` — ${JSON.stringify(args.body)}` : "";
    super(`PostgREST ${args.status} ${args.statusText} for ${args.url}${detail}`);
    this.name = "PostgrestError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.url = args.url;
    this.body = args.body;
  }
}

/**
 * Fluent query builder for a single table/view. Construct via
 * `PostgrestClient.from(...)`, not directly. Generic over the row shape `T`
 * (defaults to a loose record) so callers can supply their own types.
 *
 * The builder is immutable-by-convention: each filter pushes onto internal
 * lists and returns `this` for chaining. It is a thenable — awaiting it runs
 * the request and resolves to `T[]`.
 */
export class QueryBuilder<T = Record<string, unknown>> implements PromiseLike<T[]> {
  // Raw `key=value` query-string segments, already PostgREST-encoded.
  private readonly params: string[] = [];

  constructor(
    private readonly config: PostgrestConfig,
    private readonly table: string,
  ) {}

  /**
   * Choose the columns to return. Accepts any PostgREST select expression,
   * including embedded resources and JSON paths, e.g.
   *   "id,name,state"
   *   "id,name->>en_US"                 (read a key from a jsonb column)
   *   "*,stock_move(id,product_qty)"    (embed a related table via FK)
   */
  select(columns = "*"): this {
    this.params.push(`select=${encodeURIComponent(columns)}`);
    return this;
  }

  /**
   * Generic horizontal filter: `column <op> value`.
   * Prefer the named shortcuts (`eq`, `gte`, ...) for readability.
   */
  filter(column: string, operator: FilterOperator, value: unknown): this {
    const encoded = this.encodeFilterValue(operator, value);
    this.params.push(`${encodeURIComponent(column)}=${operator}.${encoded}`);
    return this;
  }

  /** column = value */
  eq(column: string, value: unknown): this {
    return this.filter(column, "eq", value);
  }

  /** column <> value */
  neq(column: string, value: unknown): this {
    return this.filter(column, "neq", value);
  }

  /** column > value */
  gt(column: string, value: unknown): this {
    return this.filter(column, "gt", value);
  }

  /** column >= value */
  gte(column: string, value: unknown): this {
    return this.filter(column, "gte", value);
  }

  /** column < value */
  lt(column: string, value: unknown): this {
    return this.filter(column, "lt", value);
  }

  /** column <= value */
  lte(column: string, value: unknown): this {
    return this.filter(column, "lte", value);
  }

  /** Pattern match (case-sensitive). Use `*` as the wildcard, e.g. "WH/IN/*". */
  like(column: string, pattern: string): this {
    return this.filter(column, "like", pattern);
  }

  /** Pattern match (case-insensitive). */
  ilike(column: string, pattern: string): this {
    return this.filter(column, "ilike", pattern);
  }

  /** column IN (...values). */
  in(column: string, values: ReadonlyArray<string | number>): this {
    return this.filter(column, "in", values);
  }

  /** IS check for null / true / false, e.g. `.is("date_done", null)`. */
  is(column: string, value: null | boolean): this {
    return this.filter(column, "is", value);
  }

  /** ORDER BY column. `nullsLast` appends `.nullslast` when true. */
  order(
    column: string,
    direction: SortDirection = "asc",
    opts: { nullsLast?: boolean } = {},
  ): this {
    const suffix = opts.nullsLast ? ".nullslast" : "";
    this.params.push(`order=${encodeURIComponent(column)}.${direction}${suffix}`);
    return this;
  }

  /** LIMIT n. */
  limit(n: number): this {
    this.params.push(`limit=${n}`);
    return this;
  }

  /** OFFSET n. */
  offset(n: number): this {
    this.params.push(`offset=${n}`);
    return this;
  }

  /** Full URL this builder will request (handy for debugging/logging). */
  toURL(): string {
    const qs = this.params.join("&");
    return `${this.config.baseUrl}/${this.table}${qs ? `?${qs}` : ""}`;
  }

  /** Execute and return all matching rows. */
  async execute(): Promise<T[]> {
    const data = await this.request<T[]>({});
    return data;
  }

  /**
   * Execute expecting exactly one row. Throws if zero or more than one row
   * matches (PostgREST enforces this via the singular Accept header → 406).
   * Use for lookups that must be unique, e.g. a picking by its reference.
   */
  async single(): Promise<T> {
    return this.request<T>({
      headers: { Accept: "application/vnd.pgrst.object+json" },
    });
  }

  /**
   * Execute expecting zero or one row. Returns the row, or `null` when nothing
   * matched. Useful for "does this exist yet?" checks.
   */
  async maybeSingle(): Promise<T | null> {
    const rows = await this.limit(1).execute();
    return rows.length > 0 ? rows[0] : null;
  }

  // ---- PromiseLike: lets callers `await builder` directly (resolves to T[]) ---
  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  // -------------------------------- internals --------------------------------

  /**
   * Encode the value part of a filter for the PostgREST query string.
   * - `in` expects `(a,b,c)`.
   * - `is` expects the bareword null/true/false.
   * - everything else is URI-encoded so slashes/spaces (e.g. "WH/IN/00001")
   *   survive transport.
   */
  private encodeFilterValue(operator: FilterOperator, value: unknown): string {
    if (operator === "in") {
      const list = (value as ReadonlyArray<string | number>)
        .map((v) => encodeURIComponent(String(v)))
        .join(",");
      return `(${list})`;
    }
    if (operator === "is") {
      return value === null ? "null" : String(value);
    }
    return encodeURIComponent(String(value));
  }

  /** Shared fetch wrapper: timeout, auth header, error mapping, JSON parse. */
  private async request<R>(opts: { headers?: Record<string, string> }): Promise<R> {
    const url = this.toURL();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
          ...opts.headers,
        },
      });

      const text = await response.text();
      const parsed = text ? safeJsonParse(text) : undefined;

      if (!response.ok) {
        throw new PostgrestError({
          status: response.status,
          statusText: response.statusText,
          url,
          body: parsed ?? text,
        });
      }

      return parsed as R;
    } catch (err) {
      if (err instanceof PostgrestError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new PostgrestError({
          status: 0,
          statusText: `Request timed out after ${this.config.timeoutMs}ms`,
          url,
        });
      }
      // Network/DNS/connection-refused etc.
      throw new PostgrestError({
        status: 0,
        statusText: err instanceof Error ? err.message : String(err),
        url,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse JSON, returning the raw string if it is not valid JSON. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Entry point. Create once and reuse:
 *
 *   const db = new PostgrestClient();                 // localhost:3000 defaults
 *   const rows = await db.from("stock_picking")
 *     .select("id,name,state")
 *     .eq("name", "WH/IN/00001")
 *     .single();
 */
export class PostgrestClient {
  private readonly config: PostgrestConfig;

  constructor(overrides: Partial<PostgrestConfig> = {}) {
    this.config = resolveConfig(overrides);
  }

  /** Start a query against `table` (a table or view name in the schema). */
  from<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this.config, table);
  }

  /** The resolved config in use (base URL, timeout, whether a token is set). */
  getConfig(): Readonly<PostgrestConfig> {
    return this.config;
  }
}
