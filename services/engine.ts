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
 * Key conservative assumptions:
 * - Start-of-day DTBP is a hard cap.
 * - DTBP is consumed by opening stock/ETF exposure (buys). It is NOT re-credited intraday by sells.
 * - Long options are cash-only; option BUYs consume spendable cash.
 * - Proceeds from SELLs are treated as pending/unsettled (NOT spendable intraday for new trades).
 * - This intentionally underestimates "available" buying power to keep you safe.
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
  let spendableCash = settings.startOfDayCash; // cash allowed to deploy today
  let pendingCash = 0; // proceeds from sells; NOT reusable intraday (conservative)
  const equity = settings.startOfDayEquity;

  // FINRA-ish DTBP approximation with user override
  // maintenanceExcess = max(0, Equity - Maintenance Requirement)
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
    `Start-of-Day DTBP set to $${dtbpStart.toLocaleString()} based on ${
      settings.startOfDayDTBP ? "User Override" : settings.isPDT ? "4x Maintenance Excess (PDT approx)" : "2x Maintenance Excess (Non-PDT approx)"
    }`
  );

  // DTBP consumption model: only increases; no intraday re-credit
  let dtbpUsed = 0;
  let intradayBP = dtbpStart; // derived as dtbpStart - dtbpUsed each trade

  // Simple position tracking (for display only)
  const openPositions: Record<string, { quantity: number; avgCost: number }> =
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

    const tradeNotional = trade.quantity * trade.price * multiplier; // excludes fees
    const totalCost = tradeNotional + trade.fees; // cash outlay on buys; gross proceeds on sells handled below

    const isBuy =
      trade.side === Side.BUY || trade.side === Side.BUY_TO_COVER;
    const isSell =
      trade.side === Side.SELL || trade.side === Side.SELL_SHORT;

    auditLog.push(
      `--- Trade ${trade.id}: ${trade.side} ${trade.quantity} ${
        isOption ? "Contracts" : "Shares"
      } ${trade.symbol} @ ${trade.price} (mult=${multiplier}) fees=$${trade.fees} ---`
    );

    // -----------------------------
    // 2A) Pre-trade safety checks
    // -----------------------------
    if (isBuy) {
      if (isOption) {
        // Options are cash-only (conservative), and pending proceeds do not count
        const projectedSpendable = spendableCash - totalCost;
        if (projectedSpendable < 0) {
          warnings.push(
            `Insufficient SPENDABLE CASH for option buy on trade ${trade.id}. (Conservative: option sell proceeds not reusable intraday.)`
          );
        }
      } else {
        // Stocks/ETFs consume DTBP on buys
        let consumption = totalCost;

        // Schwab leveraged ETF penalty (conservative approximation)
        if (
          settings.broker === BrokerType.SCHWAB_TOS &&
          isLeveragedETF &&
          leverageFactor > 1
        ) {
          consumption = totalCost * leverageFactor;
        }

        const projectedUsed = dtbpUsed + consumption;
        const projectedRemaining = dtbpStart - projectedUsed;

        if (projectedRemaining < 0) {
          warnings.push(
            `DTBP would be exceeded by trade ${trade.id} (Conservative mode).`
          );
        }
      }
    }

    // -----------------------------
    // 2B) Cash ledger updates
    // -----------------------------
    if (isBuy) {
      // All buys consume spendable cash in this conservative model
      spendableCash -= totalCost;

      // Position tracking (display)
      if (!openPositions[trade.symbol]) {
        openPositions[trade.symbol] = { quantity: 0, avgCost: 0 };
      }
      const currentPos = openPositions[trade.symbol];
      const newQty = currentPos.quantity + trade.quantity;

      // Weighted average cost using notional (excluding fees) for simplicity
      const newAvgCost =
        newQty > 0
          ? (currentPos.quantity * currentPos.avgCost + tradeNotional) / newQty
          : 0;

      openPositions[trade.symbol] = { quantity: newQty, avgCost: newAvgCost };
    } else if (isSell) {
      // Sells are NOT credited to spendable cash intraday; treated as pending/unsettled
      const netProceeds = tradeNotional - trade.fees;
      pendingCash += netProceeds;

      // Position tracking (display)
      if (openPositions[trade.symbol]) {
        openPositions[trade.symbol].quantity -= trade.quantity;
        if (openPositions[trade.symbol].quantity <= 0) {
          delete openPositions[trade.symbol];
        }
      }
    }

    // -----------------------------
    // 2C) DTBP usage updates (stocks/ETFs only)
    // -----------------------------
    if (!isOption && isBuy) {
      let consumption = totalCost;

      if (
        settings.broker === BrokerType.SCHWAB_TOS &&
        isLeveragedETF &&
        leverageFactor > 1
      ) {
        consumption = totalCost * leverageFactor;
        auditLog.push(
          `Schwab: Leveraged ETF x${leverageFactor} consumes DTBP: $${consumption.toLocaleString()}`
        );
      }

      dtbpUsed += consumption;
      auditLog.push(
        `DTBP: Consumed $${consumption.toLocaleString()} (used=$${dtbpUsed.toLocaleString()})`
      );
    } else if (!isOption && isSell) {
      // Conservative: no intraday re-credit on sells
      auditLog.push(`DTBP: Sell does NOT re-credit intraday DTBP (conservative).`);
    } else if (isOption) {
      auditLog.push(`Options: DTBP unchanged (cash-only constraint).`);
    }

    intradayBP = dtbpStart - dtbpUsed;

    // -----------------------------
    // 2D) Hard-stop warning if negative
    // -----------------------------
    if (intradayBP < 0) {
      warnings.push(
        `DTBP exceeded after trade ${trade.id}! High risk of day-trade margin call.`
      );
    }
    if (spendableCash < 0) {
      warnings.push(
        `Spendable cash went negative after trade ${trade.id}. (Conservative: pending proceeds not spendable intraday.)`
      );
    }

    auditLog.push(
      `State: SpendableCash=$${spendableCash.toLocaleString()}, PendingCash=$${pendingCash.toLocaleString()}, IntradayBP=$${intradayBP.toLocaleString()}`
    );
  }

  // -----------------------------
  // 3) Final dashboard outputs
  // -----------------------------
  // Option buying power = spendable cash only (pending is excluded)
  const optionBP = Math.max(0, spendableCash);

  return {
    currentEquity: equity, // keeping as start-of-day equity in this simplified model
    currentCash: spendableCash + pendingCash, // informational only
    stockBP: intradayBP,
    optionBP,
    dtbpStartOfDay: dtbpStart,
    intradayBP,
    warnings: Array.from(new Set(warnings)),
    auditLog,
    openPositions,
  };
};
