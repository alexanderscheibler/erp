# ERP Test Suite
### Supply Chain End-to-End demo

When dealing with data integrity, with products, stock, prices, values that need to be accurate, it's not enough to have an automated test running against the **user-facing** part of the system.

A transfer can validate, stock can appear to move, and the operator closes the tab - but the database may never have committed the change (or may have commited it incorrectly). 

Nobody finds out until a store tries to fulfill an order that doesn't exist.

To mitigate this risk, it's necessary to verify the data thorough all the process.

I built this demo to demonstrate this.

---

## What it covers

Three basic operations in the core of any product-based supply chain. 

| # | Operation                            | What it proves |
|---|--------------------------------------|----------------|
| 01 | **Receive Inventory**                | Vendor shipment lands correctly in warehouse stock |
| 02 | **Transfer to Store**                | Stock moves from warehouse shelf to retail location |
| 03 | **POS Checkout** (To be Implemented) | Cashier can sell the transferred product and collect payment |

---

## The Database verification

After the operations are verified in the ERP, the suite queries the database directly (via PostgREST) to confirm the accuracy of the records.

---

## Design decisions

### - **Data-driven scenarios**

Test cases live in plain data files. Adding a new scenario — different product, quantity, or location path — is one new object, no spec changes.

### - **Fully isolated tests.** 

Each test creates its own data. No shared state, no implicit ordering. Safe to run in parallel.

### - **No arbitrary waits.** 

Every assertion uses Playwright's native auto-retry.


---

## Stack

- **Playwright** (TypeScript) — UI automation and test orchestration

- **PostgREST** — lightweight HTTP interface to the Postgres database

- **Odoo 19** — the target ERP application

- **Docker Compose** — reproducible testing environment (Odoo + Postgres + PostgREST)

---

## Low-code/no-code and AI tools

- Playwright Codegen
- Claude Desktop

## Running locally

```bash
# Start the full stack
docker compose up -d

# Run all specs
npx playwright test

# Open the HTML report
npx playwright show-report
```

---

## Structure

```
tests/
  01-receive-inventory.spec.ts    # Incoming shipments
  02-transfer-to-store.spec.ts    # Warehouse → retail location

pages/                            # Page Object Model
  InventoryPage.ts
  PosPage.ts
  BasePage.ts

utils/db/                         # DB verification layer
  postgrest-client.ts             # Generic PostgREST query builder
  inventory.ts                    # On-hand, moves, location helpers

data/
  receipt-scenarios.ts
  transfer-scenarios.ts
```
