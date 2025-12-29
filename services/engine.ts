import {
  AccountSettings,
  BrokerType,
  CalculationResult,
  InstrumentType,
  Side,
  Trade,
} from "../types";

/**
 * CONSERVATIVE ENGINE (Call-Avoidance Mode)
 *
 * Goal: NEVER get a day-trade margin call.
 *
 * Conservative rules implemented:
 * - Start-of-day DTBP is a hard cap.
 * - DTBP is consumed by ENTRIES (Buys and Short Sells).
 * - EXITS (Sells and Buy-to-Covers) do NOT re-credit DTBP intraday.
 * - Options are cash-only: option BUYs consume spendable cash.
 * - Options consume DTBP 1:1 against Stock BP.
 * - Proceeds from SELLs go to pending/unsettled cash (NOT spendable intraday).
 */
export const calculateBuyingPower = (
  settings: AccountSettings,
  trades: Trade[]
): CalculationResult => {
  const auditLog: string[] = [];
  const warnings: string[] = [];

  // -----------------------------
  // 1) Start-of-day state
  // -----------------------------
  let spendableCash = settings.startOfDayCash; // Cash available to open new trades
  let pendingCash = 0; // Proceeds from sells (locked in conservative mode)
  const equity = settings.startOfDayEquity;

  // FINRA-ish DTBP approximation with user override
  const maintenanceExcess = Math.max(
    0,
    settings.startOfDayEquity - settings.startOfDayMaintReq
  );

  const dtbpStart =
    settings.startOfDayDTBP && settings.startOfDayDTBP > 0
      ? settings.startOfDayDTBP
      : settings.isPDT
        ? maintenanceExcess * 4
        : maintenanceExcess * 2;

  auditLog.push(
    `Initialization: Broker=${settings.broker}, Equity=$${equity.toLocaleString()}, SpendableCash=$${spendableCash.toLocaleString()}`
  );
  auditLog.push(
    `Start-of-Day DTBP set to $${dtbpStart.toLocaleString()} (Conservative Mode)`
  );

  // DTBP consumption model: increases on ENTRIES; never decreases intraday
  let dtbpUsed = 0;
  let intradayBP = dtbpStart;

  // Position tracking (for display only)
  const openPositions: Record<string, { quantity: number; avgPrice: number }> =
    {};

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  // -----------------------------
  // 2) Trade loop
  // -----------------------------
  for (const trade of sortedTrades) {
    const isOption = trade.instrument === InstrumentType.OPTION;
    const isLeveragedETF = trade.instrument === InstrumentType.ETF_LEVERAGED;

    const multiplier = isOption ? 100 : 1;
    const leverageFactor = trade.leverageFactor || 1;

    // "Cost" here refers to the notional value controlled
    const tradeNotional = trade.quantity * trade.price * multiplier; 
    const totalCost = tradeNotional + trade.fees; 

    // Categorize Action
    // ENTRY: Consumes BP (Opening a Long or Opening a Short)
    const isEntry = 
      trade.side === Side.BUY || 
      trade.side === Side.SELL_SHORT;

    // EXIT: Closes Position (Selling Long or Covering Short)
    const isExit = 
      trade.side === Side.SELL || 
      trade.side === Side.BUY_TO_COVER;

    // CASH SPENDER: Actions that explicitly require cash outflow
    const requiresCashOutlay = 
      trade.side === Side.BUY || 
      trade.side === Side.BUY_TO_COVER;

    auditLog.push(
      `--- Trade ${trade.id}: ${trade.side} ${trade.quantity} ${
        isOption ? "Contracts" : "Shares"
      } ${trade.symbol} @ ${trade.price} ---`
    );

    // -----------------------------
    // 2A) Pre-trade safety checks
    // -----------------------------
    
    // Check 1: Spendable Cash
    if (requiresCashOutlay) {
      const projectedSpendableCash = spendableCash - totalCost;
      if (projectedSpendableCash < 0) {
        warnings.push(
          `Insufficient SPENDABLE CASH for trade ${trade.id}. (Required: $${totalCost.toFixed(2)}, Available: $${spendableCash.toFixed(2)})`
        );
      }
    }

    // Check 2: DTBP (Only Entries consume BP)
    if (isEntry) {
      let projectedDTBPUsed = dtbpUsed;

      if (!isOption) {
        // Stocks / ETFs / Shorts
        let consumption = totalCost;
        if (
          settings.broker === BrokerType.SCHWAB_TOS &&
          isLeveragedETF &&
          leverageFactor > 1
        ) {
          // Schwab rule: Leveraged ETFs consume BP based on leverage ratio
          consumption = totalCost * leverageFactor;
        }
        projectedDTBPUsed += consumption;
      } else {
        // Options consume BP 1:1 against stock BP
        projectedDTBPUsed += totalCost;
      }

      if (dtbpStart - projectedDTBPUsed < 0) {
        warnings.push(
          `DTBP would be exceeded by trade ${trade.id} (Call-avoidance mode).`
        );
      }
    }

    // -----------------------------
    // 2B) Cash & Ledger updates
    // -----------------------------
    
    if (requiresCashOutlay) {
      // BUY or BUY_TO_COVER reduces spendable cash
      spendableCash -= totalCost;
    } 
    else if (trade.side === Side.SELL) {
      // SELL (Long) -> Proceeds go to Pending (Conservative: not reusable)
      const netProceeds = tradeNotional - trade.fees;
      pendingCash += netProceeds;
    }
    // Note: SELL_SHORT generates cash credit, but we do not add it to Spendable
    // in a conservative model to prevent accidental leverage usage.

    // -----------------------------
    // 2C) DTBP usage updates (CONSERVATIVE)
    // -----------------------------
    if (isEntry) {
      // Entries (Buy or Short) consume BP
      if (!isOption) {
        let consumption = totalCost;
        if (
          settings.broker === BrokerType.SCHWAB_TOS &&
          isLeveragedETF &&
          leverageFactor > 1
        ) {
          consumption = totalCost * leverageFactor;
          auditLog.push(`Schwab Leveraged ETF penalty applied: $${consumption}`);
        }
        dtbpUsed += consumption;
      } else {
        dtbpUsed += totalCost;
      }
      
      auditLog.push(`DTBP Used increased to $${dtbpUsed.toLocaleString()}`);
    } 
    else if (isExit) {
      // Exits (Sell or Cover) do NOT reduce dtbpUsed in Conservative Mode
      auditLog.push(`DTBP: Exit trade does NOT recycle BP (Conservative).`);
    }

    intradayBP = dtbpStart - dtbpUsed;

    // -----------------------------
    // 2D) Position Tracking (Simplified for Display)
    // -----------------------------
    if (!openPositions[trade.symbol]) {
      openPositions[trade.symbol] = { quantity: 0, avgPrice: 0 };
    }
    const pos = openPositions[trade.symbol];

    if (isEntry) {
      // Logic handles both Longs (Positive qty) and Shorts (Negative qty logic could go here, 
      // but for simple risk display, we usually just track absolute exposure or net qty).
      // Here we assume standard Long/Short netting:
      const direction = trade.side === Side.BUY ? 1 : -1;
      const tradeQty = trade.quantity * direction;
      
      // Update weighted average only if increasing position size
      const newQty = pos.quantity + tradeQty;
      pos.quantity = newQty;
      pos.avgPrice = trade.price; // Simplified; real avg cost requires deeper logic
    } else {
      // Closing
      const direction = trade.side === Side.SELL ? -1 : 1; // Sell reduces long, Cover increases back to 0
      pos.quantity += (trade.quantity * direction);
    }
    
    if (pos.quantity === 0) delete openPositions[trade.symbol];

    // -----------------------------
    // 2E) Hard-stop warnings
    // -----------------------------
    if (intradayBP < 0) {
      warnings.push(`CRITICAL: DTBP Exceeded after trade ${trade.id}.`);
    }
    if (spendableCash < 0) {
      warnings.push(`CRITICAL: Spendable Cash negative after trade ${trade.id}.`);
    }
  }

  // -----------------------------
  // 3) Final dashboard outputs
  // -----------------------------
  const optionBP = Math.max(0, spendableCash);

  return {
    currentEquity: equity,
    currentCash: spendableCash + pendingCash,
    stockBP: intradayBP,
    optionBP,
    dtbpStartOfDay: dtbpStart,
    intradayBP,
    warnings: Array.from(new Set(warnings)),
    auditLog,
    openPositions,
  };
};
