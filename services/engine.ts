import {
  AccountSettings,
  BrokerType,
  CalculationResult,
  InstrumentType,
  Side,
  Trade,
} from "../types";

/**
 * ULTRA-CONSERVATIVE MARGIN ENGINE (Final Version)
 *
 * FEATURES PRESERVED:
 * 1. Stock Buys: Consume DTBP and 25% Margin (leaving Cash free for options).
 * 2. Option Buys: Consume DTBP and 100% Cash (reducing Stock BP & Option BP).
 * 3. Shorting: Correctly treated as an ENTRY (consumes BP).
 * 4. Leverage: 3x/4x ETFs apply specific penalties to DTBP usage.
 * 5. Call Avoidance: Sells do not recycle DTBP intraday.
 *
 * NEW SAFETY FEATURES:
 * 6. Equity Protection: Real-time PnL tracking updates your Margin Excess instantly.
 * 7. Maintenance Limits: Prevents "Technically have DTBP but no Cash" margin calls.
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
  const startEquity = settings.startOfDayEquity;
  
  // Calculate Base DTBP (Regulatory Limit)
  const maintenanceExcessStart = Math.max(0, startEquity - settings.startOfDayMaintReq);
  const dtbpCap =
    settings.startOfDayDTBP && settings.startOfDayDTBP > 0
      ? settings.startOfDayDTBP
      : settings.isPDT
        ? maintenanceExcessStart * 4 
        : maintenanceExcessStart * 2;

  auditLog.push(`[Init] Equity: $${startEquity.toLocaleString()} | DTBP Cap: $${dtbpCap.toLocaleString()}`);

  // REAL-TIME TRACKERS
  let dtbpUsed = 0;             // Accumulates on Entries, never decreases (Call Avoidance)
  let currentEquity = startEquity; // Fluctuates with Fees and PnL
  let currentMaintenanceReq = 0;   // The "House" Margin Requirement

  // Position Tracker (Needed for PnL and Requirement Release)
  const openPositions: Record<string, { quantity: number; avgPrice: number }> = {};
  
  // Sort trades chronologically
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  // ------------------------------------------
  // 2. Process Trades
  // ------------------------------------------
  for (const trade of sortedTrades) {
    const isOption = trade.instrument === InstrumentType.OPTION;
    const isLeveragedETF = trade.instrument === InstrumentType.ETF_LEVERAGED;
    const leverageFactor = trade.leverageFactor || 1; 
    const multiplier = isOption ? 100 : 1;

    // Financials
    const tradeNotional = trade.quantity * trade.price * multiplier;
    const totalCost = tradeNotional + trade.fees;

    // Classify Action
    // ENTRY: Opening a new risk position (Long or Short)
    const isEntryLong = trade.side === Side.BUY;
    const isEntryShort = trade.side === Side.SELL_SHORT;
    const isEntry = isEntryLong || isEntryShort;

    // EXIT: Closing a risk position
    const isExitLong = trade.side === Side.SELL;
    const isExitShort = trade.side === Side.BUY_TO_COVER;
    const isExit = isExitLong || isExitShort;

    auditLog.push(`--- Trade ${trade.id} (${trade.side} ${trade.symbol}) ---`);

    // ------------------------------------------
    // A) REGULATORY CHECK: DTBP Usage
    // ------------------------------------------
    if (isEntry) {
      let consumption = totalCost;

      if (isOption) {
        // Options consume DTBP 1:1
        consumption = totalCost;
      } 
      else if (isLeveragedETF && leverageFactor > 1) {
         // Leverage Penalty: Cap at 4x (100% cash req equivalence)
         const penalty = Math.min(leverageFactor, 4);
         consumption = totalCost * penalty;
         auditLog.push(`   -> Lev ETF Penalty (x${penalty}): DTBP Hit $${consumption.toLocaleString()}`);
      }

      dtbpUsed += consumption;
    }
    // NOTE: Conservative Rule -> DTBP is NEVER credited back on Exits.

    // ------------------------------------------
    // B) FINANCIAL CHECK: Maintenance Margin & Equity
    // ------------------------------------------
    
    // 1. Calculate the Maintenance Requirement for THIS trade
    let tradeReq = 0;
    if (isOption) {
      tradeReq = tradeNotional; // 100% Requirement
    } else if (isEntryShort) {
      // Shorting requires more margin (Conservative 40% House Rule)
      // Leveraged Short ETFs might need more, capped at 100%
      const shortRate = isLeveragedETF ? Math.min(0.40 * leverageFactor, 1.0) : 0.40;
      tradeReq = tradeNotional * shortRate;
    } else if (isLeveragedETF) {
      // Long Lev ETF: 25% * Leverage (e.g. 3x = 75%)
      tradeReq = tradeNotional * Math.min(0.25 * leverageFactor, 1.0);
    } else {
      // Standard Stock: 25% Requirement
      tradeReq = tradeNotional * 0.25;
    }

    // 2. Update Account Level Requirements
    if (isEntry) {
       currentMaintenanceReq += tradeReq;
       currentEquity -= trade.fees; // Fees reduce equity immediately
    } 
    else if (isExit) {
       // RELEASING MARGIN:
       // We estimate how much margin is freed up. 
       // Conservative: Use the CURRENT trade value as the released requirement base.
       currentMaintenanceReq -= tradeReq;
       
       // PnL CALCULATION (Crucial for Option BP)
       // We must update currentEquity based on Profit/Loss.
       const pos = openPositions[trade.symbol];
       if (pos) {
          const costBasis = pos.avgPrice * trade.quantity;
          const proceeds = tradeNotional;
          let pnl = 0;
          
          if (isExitLong) pnl = proceeds - costBasis; // Sell Higher = Profit
          if (isExitShort) pnl = costBasis - proceeds; // Cover Lower = Profit
          
          currentEquity += pnl;
          auditLog.push(`   -> PnL Realized: $${pnl.toFixed(2)}`);
       }
       currentEquity -= trade.fees;
    }

    // ------------------------------------------
    // C) Position Tracking (Weighted Average)
    // ------------------------------------------
    if (!openPositions[trade.symbol]) {
        openPositions[trade.symbol] = { quantity: 0, avgPrice: 0 };
    }
    
    if (isEntry) {
        const oldQty = openPositions[trade.symbol].quantity;
        const newQty = oldQty + trade.quantity;
        
        // Update Avg Price
        if (newQty > 0) {
          const oldCost = oldQty * openPositions[trade.symbol].avgPrice;
          const newCost = tradeNotional;
          openPositions[trade.symbol].avgPrice = (oldCost + newCost) / newQty;
        }
        openPositions[trade.symbol].quantity = newQty;
    } else {
        openPositions[trade.symbol].quantity -= trade.quantity;
    }
    
    // Cleanup zero positions
    if (openPositions[trade.symbol].quantity <= 0.0001) {
       delete openPositions[trade.symbol];
    }

    // ------------------------------------------
    // D) Warnings
    // ------------------------------------------
    const currentExcess = currentEquity - currentMaintenanceReq;
    
    if ((dtbpCap - dtbpUsed) < 0) {
       warnings.push(`VIOLATION: DTBP Exceeded on Trade ${trade.id}`);
    }
    if (currentExcess < 0) {
       warnings.push(`CRITICAL: MARGIN CALL PREDICTED. Equity < Requirement.`);
    }
  }

  // ------------------------------------------
  // 3. Final Outputs
  // ------------------------------------------
  
  const finalDTBP = Math.max(0, dtbpCap - dtbpUsed);
  const finalExcess = Math.max(0, currentEquity - currentMaintenanceReq);

  // OPTION BP logic:
  // Options require 100% Equity. Therefore, Option BP is exactly your Maintenance Excess.
  // (You cannot use margin leverage to buy options).
  const optionBP = finalExcess;

  // STOCK BP logic:
  // Stock BP is your DTBP, but hard-capped by your Ability to Borrow (Excess * 4).
  // This handles the "120k stock in 30k account" scenario perfectly.
  // If you used all your Excess, Stock BP becomes 0 even if DTBP is high.
  const stockBP = Math.min(finalDTBP, finalExcess * 4); 

  if (stockBP <= 0) warnings.push("CRITICAL: Stock Buying Power Depleted");
  if (optionBP <= 0) warnings.push("CRITICAL: Option Buying Power Depleted");

  return {
    currentEquity: currentEquity,
    currentCash: optionBP, // "Spendable Cash" is effectively your Option BP
    stockBP: stockBP,
    optionBP: optionBP,
    dtbpStartOfDay: dtbpCap,
    intradayBP: stockBP,
    warnings: Array.from(new Set(warnings)),
    auditLog,
    openPositions,
  };
};
