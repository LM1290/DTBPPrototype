import { AccountSettings, CalculationResult, InstrumentType, Side, Trade } from "../types";

// Standard House Requirements for high-volatility tickers
const SPECIAL_MARGIN_REQS: Record<string, number> = {
  "AVGO": 0.30, "SPY": 0.30, "QQQ": 0.30, "TSLA": 0.40,
  "NVDA": 0.30, "MSTR": 1.00, "AMD": 0.30,
};

export const calculateBuyingPower = (settings: AccountSettings, trades: Trade[]): CalculationResult => {
  let currentEquity = settings.startOfDayEquity;
  let maintenanceReq = 0;
  let dtbpUsed = 0;
  const warnings: string[] = [];
  const openPositions: Record<string, { quantity: number; avgPrice: number }> = {};

  const maintenanceExcessStart = Math.max(0, settings.startOfDayEquity - settings.startOfDayMaintReq);
  const dtbpCap = settings.startOfDayDTBP || (settings.isPDT ? maintenanceExcessStart * 4 : maintenanceExcessStart * 2);

  [...trades].sort((a, b) => a.timestamp - b.timestamp).forEach(trade => {
    const isOption = trade.instrument === InstrumentType.OPTION;
    const multiplier = isOption ? 100 : 1;
    const tradeNotional = trade.quantity * trade.price * multiplier;
    
    // Excel-Parity: Profit Adjustment math
    const profitAdj = trade.price * trade.quantity * multiplier;

    // Margin Requirement Logic
    let reqPercent = isOption ? 1.00 : (SPECIAL_MARGIN_REQS[trade.symbol] || 0.25);
    if (trade.side === Side.SELL_SHORT) reqPercent = Math.max(reqPercent, 0.30);

    if (trade.side === Side.BUY || trade.side === Side.SELL_SHORT) {
      maintenanceReq += (tradeNotional * reqPercent);
      dtbpUsed += (tradeNotional + trade.fees);
      currentEquity -= trade.fees;
    } else {
      maintenanceReq -= (tradeNotional * reqPercent);
      // PnL calculation matching spreadsheet tracker logic
      const pos = openPositions[trade.symbol];
      if (pos) {
        const costBasis = pos.avgPrice * trade.quantity * multiplier;
        currentEquity += (trade.side === Side.SELL ? (tradeNotional - costBasis) : (costBasis - tradeNotional));
      }
      currentEquity -= trade.fees;
    }

    // Position Tracking
    if (!openPositions[trade.symbol]) openPositions[trade.symbol] = { quantity: 0, avgPrice: 0 };
    const factor = (trade.side === Side.BUY || trade.side === Side.SELL_SHORT) ? 1 : -1;
    openPositions[trade.symbol].quantity += (trade.quantity * factor);
  });

  // Advanced Margin Call Calculator
  const marginExcess = currentEquity - maintenanceReq;
  if (marginExcess < 0) {
    const deficit = Math.abs(marginExcess);
    const liquidationNeeded = deficit / 0.30; // Estimated based on 30% house req
    warnings.push(`MARGIN CALL: $${deficit.toLocaleString()} deficit. Liquidate ~$${liquidationNeeded.toLocaleString()} to clear.`);
  }

  return {
    currentEquity,
    currentCash: Math.max(0, marginExcess),
    stockBP: Math.min(Math.max(0, dtbpCap - dtbpUsed), Math.max(0, marginExcess * 4)),
    optionBP: Math.max(0, marginExcess),
    dtbpStartOfDay: dtbpCap,
    intradayBP: 0, // Simplified for this view
    warnings,
    auditLog: [],
    openPositions
  };
};
