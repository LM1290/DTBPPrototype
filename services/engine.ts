import { AccountSettings, BrokerType, CalculationResult, InstrumentType, Side, Trade } from '../types';

export const calculateBuyingPower = (
  settings: AccountSettings,
  trades: Trade[]
): CalculationResult => {
  const auditLog: string[] = [];
  const warnings: string[] = [];
  
  // 1. Initialize Start of Day Values
  let cash = settings.startOfDayCash;
  let equity = settings.startOfDayEquity; // Simplified assumption: Start Equity = Start Cash for this demo if no positions
  
  // Start of Day DTBP Calculation (FINRA Rule 4210 approx)
  // DTBP = 4 * (Equity - Maintenance Margin Requirement)
  // If settings.startOfDayDTBP is provided (e.g. from broker), use it, otherwise calculate.
  const maintenanceExcess = Math.max(0, settings.startOfDayEquity - settings.startOfDayMaintReq);
  
  let dtbpStart = settings.startOfDayDTBP && settings.startOfDayDTBP > 0
    ? settings.startOfDayDTBP
    : (settings.isPDT ? maintenanceExcess * 4 : maintenanceExcess * 2); // 2x for non-PDT usually, simplified

  auditLog.push(`Initialization: Broker=${settings.broker}, Equity=$${equity.toLocaleString()}, Cash=$${cash.toLocaleString()}`);
  auditLog.push(`Start-of-Day DTBP set to $${dtbpStart.toLocaleString()} based on ${settings.startOfDayDTBP ? 'User Override' : '4x Maintenance Excess (PDT)'}`);

  let currentDTBP = dtbpStart;
  let intradayBP = dtbpStart; // Fidelity concept: tracks intraday usage
  
  const openPositions: Record<string, { quantity: number; avgCost: number }> = {};
  
  // Sort trades by time just in case
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of sortedTrades) {
    const isOption = trade.instrument === InstrumentType.OPTION;
    const multiplier = isOption ? 100 : 1;
    
    const tradeCost = trade.quantity * trade.price * multiplier;
    const totalCost = tradeCost + trade.fees;
    
    const isBuy = trade.side === Side.BUY || trade.side === Side.BUY_TO_COVER;
    const isSell = trade.side === Side.SELL || trade.side === Side.SELL_SHORT;
    const isLeveragedETF = trade.instrument === InstrumentType.ETF_LEVERAGED;
    const leverageFactor = trade.leverageFactor || 1;

    auditLog.push(`--- Processing Trade: ${trade.side} ${trade.quantity} ${trade.instrument === InstrumentType.OPTION ? 'Contracts' : 'Shares'} ${trade.symbol} @ ${trade.price} (Mult: ${multiplier}) ---`);

    // --- Cash & Equity Updates ---
    if (isBuy) {
      cash -= totalCost;
      // Position tracking
      if (!openPositions[trade.symbol]) openPositions[trade.symbol] = { quantity: 0, avgCost: 0 };
      const currentPos = openPositions[trade.symbol];
      // Weighted average cost update
      const newQty = currentPos.quantity + trade.quantity;
      const newCost = ((currentPos.quantity * currentPos.avgCost) + tradeCost) / newQty;
      openPositions[trade.symbol] = { quantity: newQty, avgCost: newCost };
    } else if (isSell) {
      cash += (tradeCost - trade.fees);
      // Realized P/L calculation would go here for equity updates
      // For simplicity in this demo, we approximate Equity = Cash + Position Value
      if (openPositions[trade.symbol]) {
        openPositions[trade.symbol].quantity -= trade.quantity;
        if (openPositions[trade.symbol].quantity <= 0) delete openPositions[trade.symbol];
      }
    }

    // --- Buying Power Logic based on Broker ---
    
    if (settings.broker === BrokerType.FIDELITY) {
      // FIDELITY RULES:
      // 1. DTBP (Start) is fixed. It does NOT increase when you sell overnight positions.
      // 2. Intraday BP starts at DTBP.
      // 3. Buying stocks reduces Intraday BP by cost.
      // 4. Selling Day Trades (opening and closing same day) replenishes Intraday BP.
      // 5. Selling Overnight positions does NOT replenish Intraday BP (it only adds to cash).
      
      if (isBuy) {
        // Fidelity treats non-marginables (options) as 100% req, Marginable stocks as 25% (4x leverage) impact on DTBP
        // However, "Intraday BP" usually decrements 1:1 with the *Buying Power Usage*
        // Buying $10k stock uses $10k Intraday BP? No, usually it uses $2.5k of Maintenance Requirement...
        // Fidelity's "Intraday BP" simplifies to: How much *Stock Value* can I buy?
        // So if I have $100k DTBP, I can buy $100k of stock.
        
        const usage = totalCost; 
        // Note: For mixed mode, we assume Intraday BP tracks Stock Capacity.
        
        intradayBP -= usage; 
        auditLog.push(`Fidelity: Buy trade reduced Intraday BP by $${usage.toLocaleString()}. Remaining: $${intradayBP.toLocaleString()}`);

      } else if (isSell) {
        // Did we hold this position at start of day?
        // Complex logic: In this engine, without persistent overnight history, we assume 
        // trades NOT in the current "trades" array were overnight.
        // But here we are iterating 'trades' which are *today's* trades.
        // If we are selling something we just bought (Day Trade), we restore BP.
        
        // *Simulated Check*: If we are selling a position that was opened *in this session* (in `trades` list before this index), it's a day trade.
        // For this immutable calc, we can assume all `trades` passed in are Intraday.
        // Therefore, selling releases BP.
        
        const releaseAmount = tradeCost; // Approximation
        intradayBP = Math.min(dtbpStart, intradayBP + releaseAmount);
        auditLog.push(`Fidelity: Sell trade replenished Intraday BP up to cap. New: $${intradayBP.toLocaleString()}`);
      }
    
    } else if (settings.broker === BrokerType.SCHWAB_TOS) {
      // SCHWAB RULES:
      // 1. DTBP updates intraday unless there is a call.
      // 2. Leveraged ETFs reduce DTBP by Cost * Leverage.
      
      if (isBuy) {
        let reduction = totalCost;
        if (isLeveragedETF) {
          reduction = totalCost * leverageFactor; // 3x ETF hits DTBP 3x harder logic (approximation of maintenance impact)
          auditLog.push(`Schwab: Leveraged ETF (x${leverageFactor}) trade. $${totalCost.toLocaleString()} cost consumes $${reduction.toLocaleString()} DTBP.`);
        }
        currentDTBP -= reduction;
      } else if (isSell) {
        // Schwab replenishes DTBP on close
        currentDTBP += (tradeCost - trade.fees);
      }
      intradayBP = currentDTBP; // Schwab doesn't distinguish as strictly as Fidelity visually, but concept is same.
    } else {
      // GENERIC FINRA
      // Standard flow
      if (isBuy) intradayBP -= totalCost;
      else intradayBP += (tradeCost - trade.fees);
    }

    // --- Hard Stops & Warnings ---
    if (intradayBP < 0) {
      warnings.push(`Day Trade Buying Power Exceeded on trade ${trade.id}! Risk of Margin Call.`);
    }
  }

  // Final Calculations for Dashboard
  // Option BP is usually Cash - Committed on Open Orders (or just Cash available for withdrawal/non-marginable)
  // For margin accounts, Option BP ~ Cash + Loan Value? No, usually Options are non-marginable, so strictly Cash (or Cash + Sweep).
  // We will treat Option BP as Current Cash (simplified conservative view).
  
  return {
    currentEquity: equity, // In a real engine, this would float with Mark-to-Market of open positions
    currentCash: cash,
    stockBP: intradayBP,
    optionBP: Math.max(0, cash), 
    dtbpStartOfDay: dtbpStart,
    intradayBP: intradayBP,
    warnings: Array.from(new Set(warnings)),
    auditLog,
    openPositions
  };
};
