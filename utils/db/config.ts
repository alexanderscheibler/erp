/**
 * PostgREST connection configuration.
 *
 * The database is *not* accessed directly from the tests. Instead it is exposed
 * read-only over HTTP by a PostgREST container (see docker-compose `api`
 * service), which we query from these utils. Verification therefore happens
 * completely apart from Playwright — the browser flow and the DB checks are
 * independent concerns.
 *
 * Defaults match the local SIT/UAT stack:
 *   api:
 *     image: postgrest/postgrest:v14.13
 *     ports: ["3000:3000"]
 *     environment:
 *       PGRST_DB_URI: postgres://odoo:odoo@db:5432/odoo_db
 *       PGRST_DB_SCHEMA: public
 *       PGRST_DB_ANON_ROLE: odoo   # anon role => no auth token required
 *
 * Everything is overridable via environment variables so the same code runs
 * locally, in CI, and against other environments without edits.
 */

export interface PostgrestConfig {
  /** Base URL of the PostgREST endpoint, no trailing slash. */
  baseUrl: string;
  /**
   * Optional bearer token. The local stack uses an anonymous role
   * (PGRST_DB_ANON_ROLE), so this is normally undefined. Set POSTGREST_TOKEN
   * to switch on `Authorization: Bearer <token>` for secured environments.
   */
  token?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

/** Environment variable names this module reads. */
export const ENV = {
  baseUrl: "POSTGREST_URL",
  token: "POSTGREST_TOKEN",
  timeoutMs: "POSTGREST_TIMEOUT_MS",
} as const;

const DEFAULTS: PostgrestConfig = {
  baseUrl: "http://localhost:3000",
  token: undefined,
  timeoutMs: 10_000,
};

/**
 * Resolve the effective config from (in priority order) explicit overrides,
 * environment variables, then built-in defaults.
 *
 * @param overrides values that take precedence over env/defaults
 */
export function resolveConfig(overrides: Partial<PostgrestConfig> = {}): PostgrestConfig {
  const envTimeout = process.env[ENV.timeoutMs];

  const baseUrl = (overrides.baseUrl ?? process.env[ENV.baseUrl] ?? DEFAULTS.baseUrl).replace(
    /\/+$/,
    "",
  ); // normalise: never keep a trailing slash

  return {
    baseUrl,
    token: overrides.token ?? process.env[ENV.token] ?? DEFAULTS.token,
    timeoutMs: overrides.timeoutMs ?? (envTimeout ? Number(envTimeout) : DEFAULTS.timeoutMs),
  };
}
