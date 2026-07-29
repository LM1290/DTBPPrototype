# True DTBP

A local-first trade clearance ledger for:

- legacy pattern-day-trader / day-trading buying-power tracking;
- FINRA's 2026 intraday-margin framework and transition from legacy PDT;
- headline intraday buying power derived from current IML and house maintenance;
- margin and maintenance estimates;
- a 504-symbol prototype margin catalog with broker-specific overrides;
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

Type-check and build the production bundle with:

```bash
npm run typecheck
npm run build
```

## Symbol margin rules

The app includes the 503 equity symbols in State Street's 2026-07-28 SPY
holdings file plus MSTR. Catalog membership is broad, but the included rates are
prototype assumptions rather than a live broker feed:

- account defaults apply to ordinary catalog symbols;
- MSTR and TSLA demonstrate higher prototype house-maintenance rates;
- saved symbol overrides replace initial, long-maintenance, and
  short-maintenance rates;
- the optional override on an individual trade has highest precedence.

Always replace the assumptions with the rates displayed by the actual brokerage.
Broker house requirements can change without notice and may vary by account.

## Optional Supabase sync

The app works without an account and saves its state in IndexedDB on the current device.

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Add the Supabase project URL and publishable anon key.
5. Restart the development server.

The schema enables row-level security and limits each signed-in user to their own atomic account state. No credentials are hardcoded in the source.
Symbol overrides are part of that atomic JSON state, so no schema migration is
needed for the catalog.

## Calculation boundaries

- T+1 dates skip weekends and standard U.S. exchange holidays. Exceptional closures can be added to the account configuration.
- Legacy DTBP supports time-and-tick peak commitment and aggregate commitment.
- Once the new regime is selected, PDT trade counting, the $25,000 minimum,
  four-times DTBP, and legacy DTBP calls are disabled.
- New intraday margin computes IML after each IML-reducing transaction, preserves
  the largest negative IML for the day, and estimates long-stock intraday buying
  power from positive IML and the account's default long house rate.
- The general $2,000 floor for leveraged margin trading remains. Below it, the
  displayed capacity is limited to tracked cash.
- Outstanding deficits include fifth- and fifteenth-business-day checkpoints,
  the materiality exception for establishing a late-cure practice, and the
  potential 90-calendar-day credit freeze.
- Portfolio-margin and good-faith accounts are recognized as excluded from the
  standard IML computation and therefore require broker-reported intraday buying
  power.
- Short-stock maintenance applies the percentage and per-share floors. Leveraged
  ETP requirements scale with leverage.
- Options default conservatively to 100% unless an execution override is entered.
  Strategy offsets, opening-position market moves, deposits, assignments,
  corporate actions, and proprietary broker controls can still materially change
  official calculations. Reconcile every discrepancy before trading.
