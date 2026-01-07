import { AccountSettings, CalculationResult, InstrumentType, Side, Trade } from "../types";

// Excel Parity: Standard 25% or House Reqs
const SPECIAL_MARGIN_REQS: Record<string, number> = {
  "AVGO": 0.30, "SPY": 0.25, "QQQ": 0.25, "TSLA": 0.40, "NVDA": 0.30, "MSTR": 1.00,
};

export const calculateBuyingPower = (settings: AccountSettings, trades: Trade[]): CalculationResult => {
  const auditLog: string[] = [];
  const warnings: string[] = [];
  let currentEquity = settings.startOfDayEquity;
  let maintenanceReq = 0;
  let dtbpUsed = 0;

  const maintenanceExcessStart = Math.max(0, settings.startOfDayEquity - settings.startOfDayMaintReq);
  const dtbpCap = settings.startOfDayDTBP || (settings.isPDT ? maintenanceExcessStart * 4 : maintenanceExcessStart * 2);

  auditLog.push(`[Init] Equity: $${currentEquity.toLocaleString()} | DTBP Cap: $${dtbpCap.toLocaleString()}`);

  [...trades].sort((a, b) => a.timestamp - b.timestamp).forEach((trade, idx) => {
    const isOption = trade.instrument === InstrumentType.OPTION;
    const multiplier = isOption ? 100 : 1;
    
    // Excel Parity: Contracts * Price * 100 for Options
    const notional = Math.abs(trade.quantity) * trade.price * multiplier;
    const symbol = trade.symbol.toUpperCase();

    let reqPercent = isOption ? 1.00 : (SPECIAL_MARGIN_REQS[symbol] || 0.25);
    
    // Logic: Buying power consumption is 1:1 for the notional value
    const isEntry = trade.quantity > 0;
    
    if (isEntry) {
      dtbpUsed += notional;
      maintenanceReq += (notional * reqPercent);
      currentEquity -= (trade.fees || 0);
      auditLog.push(`${idx + 1}. BUY ${trade.quantity} ${symbol} @ $${trade.price}: $${notional.toLocaleString()} Notional | Consumption: $${notional.toLocaleString()}`);
    } else {
      maintenanceReq -= (notional * reqPercent);
      currentEquity -= (trade.fees || 0);
      // In Excel logic, selling releases BP based on the net effect
      auditLog.push(`${idx + 1}. SELL ${trade.quantity} ${symbol}: Released $${notional.toLocaleString()} BP`);
    }
  });

  const marginExcess = currentEquity - maintenanceReq;
  if (marginExcess < 0) {
    warnings.push(`MARGIN CALL: $${Math.abs(marginExcess).toLocaleString()} deficit`);
  }

  // Final BP = (Total DTBP Capacity - Used DTBP), capped by (Excess Equity * 4)
  const stockBP = Math.max(0, Math.min(dtbpCap - dtbpUsed, marginExcess * 4));

  return {
    currentEquity,
    currentCash: Math.max(0, marginExcess),
    stockBP,
    optionBP: Math.max(0, marginExcess),
    dtbpStartOfDay: dtbpCap,
    intradayBP: 0,
    warnings,
    auditLog,
    openPositions: {}
  };
};
