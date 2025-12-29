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
 * Logic Summary:
 * 1. Start-of-Day DTBP is calculated (or overridden by user).
 * 2. ENTRIES (Buys, Short Sells) consume DTBP.
 * 3. EXITS (Sells, Buy-to-Covers) do NOT re-credit DTBP (Conservative Rule).
 * 4. Options consume DTBP 1:1 against Stock BP (User Custom Rule).
 * 5. Leveraged ETFs consume DTBP at a higher rate (Safety Rule).
 * 6. Cash is tracked separately: Sells go to "Pending" (not spendable).
 */
export const calculateBuyingPower = (
  settings: AccountSettings,
  trades: Trade[]
): CalculationResult => {
  const auditLog: string[] = [];
  const warnings: string[] = [];

  // ------------------------------------------
  // 1. Initialize Start-of-Day State
  // ------------------------------------------
  let spendableCash = settings.startOfDayCash;
  let pendingCash = 0; 
  const equity = settings.startOfDayEquity;

  // Calculate Maintenance Excess (Equity - Maintenance Requirement)
  const maintenanceExcess = Math.max(0, equity - settings.startOfDayMaintReq);

  // Calculate Start-of-Day DTBP
  // If user provided a manual DTBP (from broker dashboard), use it.
  // Otherwise, estimate: 4x Excess for Non-PDT, 2x for Overnight/PDT restrictions usually.
  const dtbpStart =
    settings.startOfDayDTBP && settings.startOfDayDTBP > 0
      ? settings.startOfDayDTBP
      : settings.isPDT
        ? maintenanceExcess * 4 // Standard Day Trading BP is 4x Excess
        : maintenanceExcess * 2; // Conservative fall-back if unsure

  // Track consumption
  let dtbpUsed = 0;
  
  // Position tracker (Symbol -> Net Quantity)
  const openPositions: Record<string, { quantity: number; avgPrice: number }> = {};

  // Ensure trades are processed in chronological order
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  auditLog.push(`Init: Equity=$${equity}, Cash=$${spendableCash}, StartDTBP=$${dtbpStart}`);

  // ------------------------------------------
  // 2. Process Trades
  // ------------------------------------------
  for (const trade of sortedTrades) {
    const isOption = trade.instrument === InstrumentType.OPTION;
    const isLeveragedETF = trade.instrument === InstrumentType.ETF_LEVERAGED;
    
    // Safety: Default leverage to 1 if missing
    const leverageFactor = trade.leverageFactor || 1; 
    const multiplier = isOption ? 100 : 1;

    // Calculate Financials
    const tradeNotional = trade.quantity * trade.price * multiplier;
    const totalCost = tradeNotional + trade.fees;

    // Determine Action Type
    // ENTRY: Consumes Buying Power (Opening Long or Opening Short)
    const isEntry = 
      trade.side === Side.BUY || 
      trade.side === Side.SELL_SHORT;

    // EXIT: Closing Position (Selling Long or Covering Short)
    const isExit = 
      trade.side === Side.SELL || 
      trade.side === Side.BUY_TO_COVER;

    // CASH SPENDER: Actions that explicitly require cash outflow
    const requiresCash = 
      trade.side === Side.BUY || 
      trade.side === Side.BUY_TO_COVER;

    // ------------------------------------------
    // A) UPDATE CASH (Spendable vs Pending)
    // ------------------------------------------
    if (requiresCash) {
      spendableCash -= totalCost;
      if (spendableCash < 0) {
        warnings.push(`Warning: Spendable Cash went negative on trade ${trade.id} (${trade.symbol})`);
      }
    } 
    else if (trade.side === Side.SELL) {
      // Sells lock funds into Pending (Conservative Rule: Not reusable same-day for options)
      pendingCash += (tradeNotional - trade.fees);
    }
    // Note: SELL_SHORT technically generates a cash credit, but in a conservative 
    // engine we do not treat this as spendable liquidity to avoid over-leveraging.

    // ------------------------------------------
    // B) UPDATE DTBP (Entries Consume, Exits Ignore)
    // ------------------------------------------
    if (isEntry) {
      let consumption = totalCost;

      if (isOption) {
        // RULE: Options consume DTBP 1:1.
        // Reason: Options are non-marginable, so they reduce Buying Power dollar-for-dollar.
        consumption = totalCost;
        auditLog.push(`Trade ${trade.id} (Option): Consumed $${consumption} DTBP`);
      } 
      else if (isLeveragedETF && leverageFactor > 1) {
        // RULE: Leveraged ETFs consume DTBP based on Higher Maint Req.
        // If a 3x ETF has a 75% Maintenance Req, it consumes BP 3x faster than a stock (25% req).
        // We cap this penalty at 4x (equivalent to 100% cash requirement).
        const penaltyMultiplier = Math.min(leverageFactor, 4);
        consumption = totalCost * penaltyMultiplier;
        
        auditLog.push(`Trade ${trade.id} (Lev ETF x${leverageFactor}): Consumed $${consumption} DTBP (Penalty Applied)`);
      } 
      else {
        // Standard Stock (Marginable)
        // Consumes DTBP 1:1 on the notional value.
        consumption = totalCost;
      }

      dtbpUsed += consumption;
    } 
    else if (isExit) {
      // Exit: Do NOT decrease dtbpUsed (Conservative Rule).
      // Standard FINRA rules say you reclaim BP, but for "Call Avoidance", we assume 
      // intraday BP does not replenish to prevent over-trading.
      auditLog.push(`Trade ${trade.id} (Exit): No DTBP credit returned (Conservative Mode).`);
    }

    // ------------------------------------------
    // C) Update Positions (Display Only)
    // ------------------------------------------
    const direction = (trade.side === Side.BUY || trade.side === Side.BUY_TO_COVER) ? 1 : -1;
    
    if (!openPositions[trade.symbol]) {
        openPositions[trade.symbol] = { quantity: 0, avgPrice: 0 };
    }
    
    // Update Avg Price only on Entry
    if (isEntry) {
        const oldQty = openPositions[trade.symbol].quantity;
        const newQty = oldQty + (trade.quantity * direction);
        // Simple weighted average approx
        if (newQty !== 0) {
             const oldCost = oldQty * openPositions[trade.symbol].avgPrice;
             const newCost = trade.quantity * trade.price; // ignoring fees for simple display
             openPositions[trade.symbol].avgPrice = (oldCost + newCost) / newQty;
        }
        openPositions[trade.symbol].quantity = newQty;
    } else {
        openPositions[trade.symbol].quantity += (trade.quantity * direction);
    }
    
    // Clean up closed positions
    if (Math.abs(openPositions[trade.symbol].quantity) < 0.0001) {
        delete openPositions[trade.symbol];
    }
  }

  // ------------------------------------------
  // 3. Final Calculations & Safety Checks
  // ------------------------------------------
  const intradayBP = Math.max(0, dtbpStart - dtbpUsed);
  const optionBP = Math.max(0, spendableCash); // Options strictly limited by cash

  if (intradayBP <= 0) {
      warnings.push("CRITICAL: Day Trading Buying Power Depleted");
  }

  return {
    currentEquity: equity,
    currentCash: spendableCash + pendingCash,
    stockBP: intradayBP,
    optionBP: optionBP,
    dtbpStartOfDay: dtbpStart,
    intradayBP: intradayBP,
    warnings: Array.from(new Set(warnings)),
    auditLog,
    openPositions,
  };
};
