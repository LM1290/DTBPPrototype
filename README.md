# True DTBP

A local-first trade clearance ledger for:

- legacy pattern-day-trader / day-trading buying-power tracking;
- FINRA's 2026 intraday-margin framework;
- margin and maintenance estimates;
- T+1 cash-settlement tracking;
- good-faith, freeriding, and unfunded-purchase warnings;
- optional, private Supabase sync.

The calculator is decision support, not a brokerage statement or order-entry system. Broker house requirements and broker-reported balances remain authoritative.

## Run locally

This project uses Vite, React, and TypeScript.

```bash
npm install
npm run dev
```

Run the calculation tests with:

```bash
npm test
```

## Optional Supabase sync

The app works without an account and saves its state in IndexedDB on the current device.

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Add the Supabase project URL and publishable anon key.
5. Restart the development server.

The schema enables row-level security and limits each signed-in user to their own atomic account state. No credentials are hardcoded in the source.

## Calculation boundaries

- T+1 dates skip weekends and standard U.S. exchange holidays. Exceptional closures can be added to the account configuration.
- Legacy DTBP supports time-and-tick peak commitment and aggregate commitment.
- New intraday margin tracks the lowest margin level after logged exposure-increasing trades.
- Options, short sales, house margin, opening positions, deposits, assignments, and corporate actions can materially change broker calculations. Reconcile every discrepancy before trading.
