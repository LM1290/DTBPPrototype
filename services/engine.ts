import { AccountSettings, CalculationResult, InstrumentType, Side, Trade } from "../types";

const SPECIAL_MARGIN_REQS: Record<string, number> = {
  "AVGO": 0.30, "SPY": 0.25, "QQQ": 0.25, "TSLA": 0.40, "NVDA": 0.30, "MSTR": 1.00,
};

export const calculateBuyingPower = (settings: AccountSettings, trades: Trade[]): CalculationResult => {
  const auditLog: string[] = [];
  const warnings: string[] = [];
  let currentEquity = settings.startOfDayEquity;
  let maintenanceReq = settings.startOfDayMaintReq; // Initialize with start-of-day req
  let dtbpUsed = 0;

  const maintenanceExcessStart = Math.max(0, settings.startOfDayEquity - settings.startOfDayMaintReq);
  const dtbpCap = settings.startOfDayDTBP || (settings.isPDT ? maintenanceExcessStart * 4 : maintenanceExcessStart * 2);

  auditLog.push(`[Init] Equity: $${currentEquity.toLocaleString()} | DTBP Cap: $${dtbpCap.toLocaleString()}`);

  [...trades].sort((a, b) => a.timestamp - b.timestamp).forEach((trade, idx) => {
    const isOption = trade.instrument === InstrumentType.OPTION;
    const isLeveraged = trade.instrument === InstrumentType.ETF_LEVERAGED;
    const multiplier = isOption ? 100 : 1;

    const notional = Math.abs(trade.quantity) * trade.price * multiplier;
    const symbol = trade.symbol.toUpperCase();

    // Use specific req, or fallback to settings/0.25
    let reqPercent = isOption ? 1.00 : (SPECIAL_MARGIN_REQS[symbol] || settings.maintenanceMarginPct || 0.25);

    // Apply leverage factor if applicable (e.g. 3x ETF uses 3 * 25% = 75% req)
    if (isLeveraged && trade.leverageFactor) {
      reqPercent = Math.min(1.0, reqPercent * trade.leverageFactor);
    }

    // An ENTRY is a Buy or a Sell Short. An EXIT is a Sell or Buy to Cover.
    const isEntry = trade.side === Side.BUY || trade.side === Side.SELL_SHORT;

    if (isEntry) {
      dtbpUsed += notional;
      maintenanceReq += (notional * reqPercent);
      currentEquity -= (trade.fees || 0);
      auditLog.push(`${idx + 1}. OPEN ${trade.side} ${trade.quantity} ${symbol}: $${notional.toLocaleString()} Notional | BP Consumed: $${notional.toLocaleString()}`);
    } else {
      // Exits release maintenance req but NOT DTBP capacity (standard broker rule)
      maintenanceReq = Math.max(0, maintenanceReq - (notional * reqPercent));
      currentEquity -= (trade.fees || 0);
      auditLog.push(`${idx + 1}. CLOSE ${trade.side} ${trade.quantity} ${symbol}: Released $${(notional * reqPercent).toLocaleString()} Maint Req`);
    }
  });

  const marginExcess = currentEquity - maintenanceReq;
  if (marginExcess < 0) {
    warnings.push(`MARGIN CALL: $${Math.abs(marginExcess).toLocaleString()} deficit`);
  }

  // Stock BP is 4x the current excess equity, capped by the day's remaining DTBP
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
