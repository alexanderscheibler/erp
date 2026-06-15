# DB verification utilities (`@utils/db`)

Read-only helpers for verifying the **source of truth** — the Odoo Postgres
database — independently of the UI. The Playwright specs drive the Odoo
interface; these utils confirm the database actually changed the way the UI
claimed it did.

The DB is exposed over HTTP by a [PostgREST](https://postgrest.org) container
(see the `api` service in `docker-compose`). These utils only depend on Node's
global `fetch` — **no Playwright dependency** — so they're equally usable from
seeding scripts, CI checks, or a REPL.

## Layout

| File                  | Responsibility                                                      |
| --------------------- | ------------------------------------------------------------------- |
| `config.ts`           | Resolve base URL / token / timeout from overrides → env → defaults. |
| `postgrest-client.ts` | **Generic, reusable** PostgREST client + fluent query builder.      |
| `inventory.ts`        | Thin, example helpers for the entities specs 01 & 02 touch.         |
| `index.ts`            | Barrel export (`import { ... } from "@utils/db"`).                  |

## Configuration

Defaults match the local stack (anon role `odoo`, **no auth token**). Override
via env vars — nothing is hardcoded:

| Env var                | Default                 | Meaning                          |
| ---------------------- | ----------------------- | -------------------------------- |
| `POSTGREST_URL`        | `http://localhost:3000` | PostgREST base URL.              |
| `POSTGREST_TOKEN`      | _(unset)_               | Bearer token, if env is secured. |
| `POSTGREST_TIMEOUT_MS` | `10000`                 | Per-request timeout.             |

## Generic client

```ts
import { PostgrestClient } from "@utils/db";

const db = new PostgrestClient(); // localhost:3000 by default

// Awaiting a builder returns an array:
const moves = await db
  .from("stock_move")
  .select("id,product_uom_qty,quantity,state")
  .eq("picking_id", 42)
  .order("id", "asc");

// .single() requires exactly one row; .maybeSingle() returns the row or null:
const picking = await db
  .from("stock_picking")
  .select("id,name,state")
  .eq("name", "WH/IN/00001")
  .single();
```

Filters: `eq, neq, gt, gte, lt, lte, like, ilike, in, is` (or the generic
`.filter(col, op, value)`). `.select()` accepts any PostgREST expression,
including JSON paths (`name->>en_US`) and embeds (`*,stock_move(id)`).
`.toURL()` returns the exact request URL for debugging.

## Inventory helpers

```ts
import {
  PostgrestClient,
  getLocationByPath,
  getProductByDefaultCode,
  getOnHandQty,
  getPickingByReference,
  getMovesForPicking,
} from "@utils/db";
```

## The verify pattern (specs 01 & 02)

The UI flow stays in Playwright; the DB snapshots wrap around it. Example for a
receipt that should add 10 units to `WH/Stock`:

```ts
const db = new PostgrestClient();
const stock = await getLocationByPath(db, "WH/Stock");
const product = await getProductByDefaultCode(db, "E-COM10");

// 1. snapshot BEFORE
const before = await getOnHandQty(db, product.id, stock.id);

// 2. [Playwright] create + validate the receipt → capture reference e.g. WH/IN/00001

// 3. snapshot AFTER + read the persisted record
const after = await getOnHandQty(db, product.id, stock.id);
const picking = await getPickingByReference(db, reference);
const moves = await getMovesForPicking(db, picking.id);

// 4. [Playwright assertions] — e.g.
//    expect(after - before).toBe(10)
//    expect(picking.state).toBe("done")
//    expect(moves[0].quantity).toBe(10)
```

For an **internal transfer** (spec 02) snapshot on-hand at _both_ the source
(`WH/Stock`, expected to decrease) and the destination (`WH/Stock/Shelf 2`,
expected to increase) and assert the deltas mirror each other.

> Note: actual Playwright assertions (`expect(...)`) belong in the spec files,
> per project rules — these helpers only fetch the data to assert on.
