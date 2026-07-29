import {
  AccountSettings,
  AccountType,
  AuditEntry,
  CalculationResult,
  DtbpMethod,
  InstrumentType,
  MarginRegime,
  Position,
  RiskAlert,
  SettlementItem,
  Side,
  Trade,
  TradeAnalysis,
} from "../types";

const EPSILON = 0.000_001;

interface PositionLot {
  quantity: number;
  price: number;
  remainingCost: number;
  unsettledFunding: Array<{ amount: number; settlesOn: string }>;
  unfundedAmount: number;
  openedAt: string;
}

interface InternalPosition {
  symbol: string;
  instrument: InstrumentType;
  multiplier: number;
  leverageFactor: number;
  marginRequirementPct?: number;
  lots: PositionLot[];
  shortLots: PositionLot[];
  markPrice: number;
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const clampZero = (value: number) => (Math.abs(value) < EPSILON ? 0 : value);
const dateOnly = (iso: string) => iso.slice(0, 10);

const nthWeekday = (year: number, month: number, weekday: number, nth: number) => {
  const first = new Date(Date.UTC(year, month, 1));
  const day = 1 + ((7 + weekday - first.getUTCDay()) % 7) + (nth - 1) * 7;
  return new Date(Date.UTC(year, month, day));
};

const lastWeekday = (year: number, month: number, weekday: number) => {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const day = last.getUTCDate() - ((7 + last.getUTCDay() - weekday) % 7);
  return new Date(Date.UTC(year, month, day));
};

const observed = (date: Date) => {
  const day = date.getUTCDay();
  const copy = new Date(date);
  if (day === 6) copy.setUTCDate(copy.getUTCDate() - 1);
  if (day === 0) copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
};

// Anonymous Gregorian computus, used because U.S. markets close on Good Friday.
const easterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export const marketHolidays = (year: number): Set<string> => {
  const easter = easterSunday(year);
  easter.setUTCDate(easter.getUTCDate() - 2);
  return new Set([
    isoDate(observed(new Date(Date.UTC(year, 0, 1)))),
    isoDate(nthWeekday(year, 0, 1, 3)),
    isoDate(nthWeekday(year, 1, 1, 3)),
    isoDate(easter),
    isoDate(lastWeekday(year, 4, 1)),
    isoDate(observed(new Date(Date.UTC(year, 5, 19)))),
    isoDate(observed(new Date(Date.UTC(year, 6, 4)))),
    isoDate(nthWeekday(year, 8, 1, 1)),
    isoDate(nthWeekday(year, 10, 4, 4)),
    isoDate(observed(new Date(Date.UTC(year, 11, 25)))),
  ]);
};

export const addBusinessDays = (date: string, days: number, extraHolidays: string[] = []) => {
  const cursor = new Date(`${date}T12:00:00Z`);
  const extras = new Set(extraHolidays);
  let remaining = days;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const candidate = isoDate(cursor);
    const weekday = cursor.getUTCDay();
    const closed = weekday === 0 || weekday === 6 || marketHolidays(cursor.getUTCFullYear()).has(candidate) || extras.has(candidate);
    if (!closed) remaining -= 1;
  }
  return isoDate(cursor);
};

export const settlementDateFor = (trade: Trade, settings: AccountSettings) =>
  addBusinessDays(dateOnly(trade.executedAt), 1, settings.settlementHolidays);

const tradeNotional = (trade: Trade) =>
  Math.abs(trade.quantity) * trade.price * (trade.instrument === InstrumentType.OPTION ? trade.contractMultiplier || 100 : 1);

const maintenanceRate = (trade: Trade, settings: AccountSettings, side: Side = trade.side) => {
  if (trade.marginRequirementPct && trade.marginRequirementPct > 0) {
    return trade.marginRequirementPct;
  }
  if (trade.instrument === InstrumentType.OPTION) return 1;
  const short = side === Side.SELL_SHORT || side === Side.BUY_TO_COVER;
  const base = short ? settings.shortMaintenancePct : settings.longMaintenancePct;
  if (trade.instrument === InstrumentType.LEVERAGED_ETP) {
    return short ? base * Math.max(1, trade.leverageFactor) : Math.min(1, base * Math.max(1, trade.leverageFactor));
  }
  return base;
};

const addAlert = (alerts: RiskAlert[], alert: RiskAlert) => {
  if (!alerts.some((existing) => existing.id === alert.id)) alerts.push(alert);
};

const addAudit = (
  auditTrail: AuditEntry[],
  timestamp: string,
  label: string,
  formula: string,
  result: number,
) => {
  auditTrail.push({
    id: `${timestamp}-${auditTrail.length}`,
    timestamp,
    label,
    formula,
    result: roundMoney(result),
  });
};

const releaseFunding = (
  funding: PositionLot["unsettledFunding"],
  ratio: number,
) => funding.map((source) => ({ ...source, amount: source.amount * ratio }));

export const calculateAccount = (
  settings: AccountSettings,
  inputTrades: Trade[],
  asOf = new Date().toISOString(),
): CalculationResult => {
  const trades = [...inputTrades]
    .filter((trade) => new Date(trade.executedAt).getTime() <= new Date(asOf).getTime())
    .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());

  const alerts: RiskAlert[] = [];
  const analyses: Record<string, TradeAnalysis> = {};
  const auditTrail: AuditEntry[] = [];
  const settlements: SettlementItem[] = [];
  const positions = new Map<string, InternalPosition>();
  const openingByDay = new Map<string, Set<string>>();
  const closingByDay = new Map<string, Set<string>>();

  let settledCash = settings.settledCash;
  let initialUnsettled = settings.unsettledCash;
  let fees = 0;
  let realizedPnl = 0;
  let marginBuyingPowerConsumed = 0;
  let aggregateDtbpUse = 0;
  let peakIntradayExposure = 0;
  let highestIntradayDeficit = 0;
  let currentTradeMaintenance = 0;
  let currentEquity = settings.startOfDayEquity;
  let unsettledPool: Array<{ amount: number; settlesOn: string; tradeId: string; symbol: string }> = [];

  if (initialUnsettled > 0) {
    unsettledPool.push({
      amount: initialUnsettled,
      settlesOn: addBusinessDays(settings.snapshotDate, 1, settings.settlementHolidays),
      tradeId: "opening-unsettled",
      symbol: "Opening balance",
    });
  }

  const settleThrough = (day: string) => {
    const stillPending: typeof unsettledPool = [];
    unsettledPool.forEach((item) => {
      if (item.settlesOn <= day) {
        settledCash += item.amount;
      } else {
        stillPending.push(item);
      }
    });
    unsettledPool = stillPending;
  };

  const getPosition = (trade: Trade) => {
    const key = `${trade.symbol.toUpperCase()}::${trade.instrument}`;
    const existing = positions.get(key);
    if (existing) return existing;
    const created: InternalPosition = {
      symbol: trade.symbol.toUpperCase(),
      instrument: trade.instrument,
      multiplier: trade.instrument === InstrumentType.OPTION ? trade.contractMultiplier || 100 : 1,
      leverageFactor: trade.leverageFactor || 1,
      marginRequirementPct: trade.marginRequirementPct,
      lots: [],
      shortLots: [],
      markPrice: trade.price,
    };
    positions.set(key, created);
    return created;
  };

  const calculateTradeMaintenance = () => {
    let total = 0;
    positions.forEach((position) => {
      const longQty = position.lots.reduce((sum, lot) => sum + lot.quantity, 0);
      const shortQty = position.shortLots.reduce((sum, lot) => sum + lot.quantity, 0);
      const baseTrade: Trade = {
        id: "rate",
        executedAt: asOf,
        symbol: position.symbol,
        instrument: position.instrument,
        side: longQty >= shortQty ? Side.BUY : Side.SELL_SHORT,
        quantity: 0,
        price: position.markPrice,
        fees: 0,
        contractMultiplier: position.multiplier,
        leverageFactor: position.leverageFactor,
        marginRequirementPct: position.marginRequirementPct,
      };
      total += longQty * position.markPrice * position.multiplier * maintenanceRate(baseTrade, settings, Side.BUY);
      total += shortQty * position.markPrice * position.multiplier * maintenanceRate(baseTrade, settings, Side.SELL_SHORT);
    });
    return total;
  };

  const currentIntradayExposure = () => {
    let exposure = 0;
    positions.forEach((position) => {
      const longCost = position.lots.reduce((sum, lot) => sum + lot.remainingCost, 0);
      const shortCost = position.shortLots.reduce((sum, lot) => sum + lot.remainingCost, 0);
      const rateTrade: Trade = {
        id: "exposure",
        executedAt: asOf,
        symbol: position.symbol,
        instrument: position.instrument,
        side: Side.BUY,
        quantity: 0,
        price: position.markPrice,
        fees: 0,
        contractMultiplier: position.multiplier,
        leverageFactor: position.leverageFactor,
        marginRequirementPct: position.marginRequirementPct,
      };
      const longFactor = maintenanceRate(rateTrade, settings, Side.BUY) / Math.max(settings.longMaintenancePct, EPSILON);
      const shortFactor = maintenanceRate(rateTrade, settings, Side.SELL_SHORT) / Math.max(settings.longMaintenancePct, EPSILON);
      exposure += longCost * longFactor + shortCost * shortFactor;
    });
    return exposure;
  };

  trades.forEach((trade, index) => {
    const tradeDay = dateOnly(trade.executedAt);
    const settlementDate = settlementDateFor(trade, settings);
    const notional = tradeNotional(trade);
    const position = getPosition(trade);
    position.markPrice = trade.price;
    settleThrough(tradeDay);
    fees += trade.fees || 0;
    currentEquity = settings.startOfDayEquity + realizedPnl - fees;

    const opened = openingByDay.get(tradeDay) ?? new Set<string>();
    const closed = closingByDay.get(tradeDay) ?? new Set<string>();
    openingByDay.set(tradeDay, opened);
    closingByDay.set(tradeDay, closed);

    let settledFundsUsed = 0;
    let unsettledFundsUsed = 0;
    let unfundedAmount = 0;
    let analysisRisk: TradeAnalysis["risk"] = "info";
    let message = "Recorded with no settlement warning.";

    const addLongLot = (quantity: number, cost: number) => {
      let remainingCost = cost + (trade.fees || 0);
      if (settings.accountType === AccountType.CASH) {
        settledFundsUsed = Math.min(settledCash, remainingCost);
        settledCash -= settledFundsUsed;
        remainingCost -= settledFundsUsed;

        const funding: PositionLot["unsettledFunding"] = [];
        for (const source of unsettledPool) {
          if (remainingCost <= EPSILON) break;
          const used = Math.min(source.amount, remainingCost);
          if (used > 0) {
            source.amount -= used;
            remainingCost -= used;
            unsettledFundsUsed += used;
            funding.push({ amount: used, settlesOn: source.settlesOn });
          }
        }
        unsettledPool = unsettledPool.filter((source) => source.amount > EPSILON);
        unfundedAmount = Math.max(0, remainingCost);
        position.lots.push({
          quantity,
          price: trade.price,
          remainingCost: cost,
          unsettledFunding: funding,
          unfundedAmount,
          openedAt: trade.executedAt,
        });
      } else {
        position.lots.push({
          quantity,
          price: trade.price,
          remainingCost: cost,
          unsettledFunding: [],
          unfundedAmount: 0,
          openedAt: trade.executedAt,
        });
      }
    };

    const closeLots = (lots: PositionLot[], quantity: number, isLong: boolean) => {
      let remaining = quantity;
      let proceedsForCash = 0;
      let riskUnsettled = 0;
      let riskUnfunded = 0;

      while (remaining > EPSILON && lots.length > 0) {
        const lot = lots[0];
        const closedQty = Math.min(remaining, lot.quantity);
        const ratio = closedQty / lot.quantity;
        const allocatedCost = lot.remainingCost * ratio;
        const exitValue = closedQty * trade.price * position.multiplier;
        realizedPnl += isLong ? exitValue - allocatedCost : allocatedCost - exitValue;
        proceedsForCash += isLong ? exitValue : 0;

        releaseFunding(lot.unsettledFunding, ratio).forEach((source) => {
          if (source.settlesOn > tradeDay) riskUnsettled += source.amount;
        });
        riskUnfunded += lot.unfundedAmount * ratio;
        lot.quantity -= closedQty;
        lot.remainingCost -= allocatedCost;
        lot.unfundedAmount -= lot.unfundedAmount * ratio;
        lot.unsettledFunding = lot.unsettledFunding
          .map((source) => ({ ...source, amount: source.amount * (1 - ratio) }))
          .filter((source) => source.amount > EPSILON);
        remaining -= closedQty;
        if (lot.quantity <= EPSILON) lots.shift();
      }

      if (settings.accountType === AccountType.CASH && proceedsForCash > 0) {
        unsettledPool.push({
          amount: Math.max(0, proceedsForCash - (trade.fees || 0)),
          settlesOn: settlementDate,
          tradeId: trade.id,
          symbol: trade.symbol.toUpperCase(),
        });
        settlements.push({
          id: `settlement-${trade.id}`,
          tradeId: trade.id,
          symbol: trade.symbol.toUpperCase(),
          tradeDate: tradeDay,
          settlementDate,
          amount: Math.max(0, proceedsForCash - (trade.fees || 0)),
          status: settlementDate <= dateOnly(asOf) ? "settled" : "pending",
        });
      }

      if (riskUnfunded > EPSILON) {
        analysisRisk = "danger";
        message = `Potential freeriding: ${formatMoney(riskUnfunded)} of this lot was not paid for before sale.`;
        addAlert(alerts, {
          id: `freeride-${trade.id}`,
          level: "danger",
          title: "Potential freeriding violation",
          detail: message,
          tradeId: trade.id,
        });
      } else if (riskUnsettled > EPSILON) {
        analysisRisk = "danger";
        message = `Potential good-faith violation: ${formatMoney(riskUnsettled)} of the sold lot was funded by proceeds that had not settled.`;
        addAlert(alerts, {
          id: `gfv-${trade.id}`,
          level: "danger",
          title: "Potential good-faith violation",
          detail: message,
          tradeId: trade.id,
        });
      }

      return remaining;
    };

    if (trade.side === Side.BUY) {
      const remainingAfterCover = closeLots(position.shortLots, trade.quantity, false);
      if (remainingAfterCover > EPSILON) {
        addLongLot(remainingAfterCover, remainingAfterCover * trade.price * position.multiplier);
        opened.add(`${position.symbol}::long`);
        aggregateDtbpUse += remainingAfterCover * trade.price * position.multiplier;
      } else {
        closed.add(`${position.symbol}::short`);
      }
      marginBuyingPowerConsumed += Math.max(0, remainingAfterCover) * trade.price * position.multiplier * settings.initialMarginPct;
    } else if (trade.side === Side.SELL) {
      const remainingAfterSale = closeLots(position.lots, trade.quantity, true);
      closed.add(`${position.symbol}::long`);
      if (remainingAfterSale > EPSILON) {
        analysisRisk = "danger";
        message = `Sale exceeds tracked long position by ${remainingAfterSale.toLocaleString()} unit(s). Use Sell short or add the opening position.`;
        addAlert(alerts, {
          id: `oversell-${trade.id}`,
          level: "danger",
          title: "Unmatched sale",
          detail: message,
          tradeId: trade.id,
        });
      }
      marginBuyingPowerConsumed = Math.max(0, marginBuyingPowerConsumed - notional * settings.initialMarginPct);
    } else if (trade.side === Side.SELL_SHORT) {
      position.shortLots.push({
        quantity: trade.quantity,
        price: trade.price,
        remainingCost: notional,
        unsettledFunding: [],
        unfundedAmount: 0,
        openedAt: trade.executedAt,
      });
      opened.add(`${position.symbol}::short`);
      aggregateDtbpUse += notional;
      marginBuyingPowerConsumed += notional * settings.initialMarginPct;
    } else if (trade.side === Side.BUY_TO_COVER) {
      const remainingAfterCover = closeLots(position.shortLots, trade.quantity, false);
      closed.add(`${position.symbol}::short`);
      if (remainingAfterCover > EPSILON) {
        analysisRisk = "danger";
        message = `Cover exceeds tracked short position by ${remainingAfterCover.toLocaleString()} unit(s).`;
        addAlert(alerts, {
          id: `overcover-${trade.id}`,
          level: "danger",
          title: "Unmatched cover",
          detail: message,
          tradeId: trade.id,
        });
      }
      marginBuyingPowerConsumed = Math.max(0, marginBuyingPowerConsumed - notional * settings.initialMarginPct);
    }

    if (unsettledFundsUsed > EPSILON && analysisRisk === "info") {
      analysisRisk = "watch";
      const latestSettlement = position.lots
        .flatMap((lot) => lot.unsettledFunding.map((funding) => funding.settlesOn))
        .sort()
        .at(-1);
      message = `Bought with ${formatMoney(unsettledFundsUsed)} of unsettled proceeds. Hold through ${latestSettlement ?? settlementDate} to avoid a potential good-faith violation.`;
      addAlert(alerts, {
        id: `unsettled-buy-${trade.id}`,
        level: "watch",
        title: "Unsettled proceeds used",
        detail: message,
        tradeId: trade.id,
      });
    }

    if (unfundedAmount > EPSILON) {
      analysisRisk = "danger";
      message = `${formatMoney(unfundedAmount)} is not covered by tracked cash. Deposit funds by settlement or correct the opening balances.`;
      addAlert(alerts, {
        id: `unfunded-${trade.id}`,
        level: "danger",
        title: "Purchase not fully funded",
        detail: message,
        tradeId: trade.id,
      });
    }

    currentTradeMaintenance = calculateTradeMaintenance();
    currentEquity = settings.startOfDayEquity + realizedPnl - fees;
    const iml = currentEquity - settings.startOfDayMaintenance - currentTradeMaintenance;
    if (iml < 0) highestIntradayDeficit = Math.max(highestIntradayDeficit, Math.abs(iml));
    peakIntradayExposure = Math.max(peakIntradayExposure, currentIntradayExposure());

    analyses[trade.id] = {
      tradeId: trade.id,
      notional: roundMoney(notional),
      settlementDate,
      settledFundsUsed: roundMoney(settledFundsUsed),
      unsettledFundsUsed: roundMoney(unsettledFundsUsed),
      unfundedAmount: roundMoney(unfundedAmount),
      risk: analysisRisk,
      message,
    };

    addAudit(
      auditTrail,
      trade.executedAt,
      `${index + 1}. ${trade.side.replaceAll("_", " ")} ${trade.symbol.toUpperCase()}`,
      `${trade.quantity} × ${formatMoney(trade.price)} × ${position.multiplier}`,
      notional,
    );
  });

  settleThrough(dateOnly(asOf));

  const outputPositions: Position[] = [];
  let unrealizedPnl = 0;
  positions.forEach((position) => {
    const longQty = position.lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const shortQty = position.shortLots.reduce((sum, lot) => sum + lot.quantity, 0);
    const quantity = longQty - shortQty;
    if (Math.abs(quantity) < EPSILON) return;
    const activeLots = quantity > 0 ? position.lots : position.shortLots;
    const totalCost = activeLots.reduce((sum, lot) => sum + lot.remainingCost, 0);
    const absoluteQty = Math.abs(quantity);
    const averagePrice = absoluteQty > 0 ? totalCost / absoluteQty / position.multiplier : 0;
    const marketValue = absoluteQty * position.markPrice * position.multiplier;
    const pnl = quantity > 0 ? marketValue - totalCost : totalCost - marketValue;
    unrealizedPnl += pnl;
    const representative: Trade = {
      id: "position-rate",
      executedAt: asOf,
      symbol: position.symbol,
      instrument: position.instrument,
      side: quantity > 0 ? Side.BUY : Side.SELL_SHORT,
      quantity: absoluteQty,
      price: position.markPrice,
      fees: 0,
      contractMultiplier: position.multiplier,
      leverageFactor: position.leverageFactor,
      marginRequirementPct: position.marginRequirementPct,
    };
    outputPositions.push({
      symbol: position.symbol,
      instrument: position.instrument,
      quantity,
      averagePrice: roundMoney(averagePrice),
      markPrice: position.markPrice,
      marketValue: roundMoney(marketValue),
      maintenanceRequirement: roundMoney(marketValue * maintenanceRate(representative, settings)),
      unrealizedPnl: roundMoney(pnl),
    });
  });

  currentEquity = settings.startOfDayEquity + realizedPnl + unrealizedPnl - fees;
  const maintenanceRequirement = settings.startOfDayMaintenance + currentTradeMaintenance;
  const maintenanceExcess = currentEquity - maintenanceRequirement;
  const intradayMarginLevel = maintenanceExcess;
  const computedLegacyLimit = Math.max(0, (settings.startOfDayEquity - settings.startOfDayMaintenance) * (settings.pdtRestricted ? 2 : 4));
  const dtbpLimit = settings.brokerDtbp > 0 ? settings.brokerDtbp : computedLegacyLimit;
  const dtbpUsed = settings.dtbpMethod === DtbpMethod.AGGREGATE ? aggregateDtbpUse : peakIntradayExposure;
  const dtbpRemaining = Math.max(0, dtbpLimit - dtbpUsed);
  const estimatedMarginBp = Math.max(0, maintenanceExcess / Math.max(settings.initialMarginPct + settings.houseBufferPct, EPSILON));
  const brokerBasedMarginBp = Math.max(0, settings.brokerMarginBuyingPower - marginBuyingPowerConsumed + realizedPnl - fees);
  const marginBuyingPower = settings.brokerMarginBuyingPower > 0 ? brokerBasedMarginBp : estimatedMarginBp;
  const pendingCash = unsettledPool.reduce((sum, item) => sum + item.amount, 0);
  const cashAvailableToTrade = Math.max(0, settledCash + (settings.cashRestricted ? 0 : pendingCash));
  const optionBuyingPower = settings.accountType === AccountType.CASH
    ? cashAvailableToTrade
    : Math.max(0, (settings.brokerMarginBuyingPower > 0 ? settings.brokerMarginBuyingPower * settings.initialMarginPct : maintenanceExcess) - marginBuyingPowerConsumed);

  const dayTrades = [...openingByDay.entries()].reduce((count, [day, opened]) => {
    const closed = closingByDay.get(day) ?? new Set<string>();
    return count + [...opened].filter((key) => closed.has(key)).length;
  }, 0);

  if (settings.accountType === AccountType.MARGIN) {
    if (settings.marginRegime === MarginRegime.LEGACY_PDT && settings.startOfDayEquity < 25_000) {
      addAlert(alerts, {
        id: "pdt-minimum",
        level: "danger",
        title: "Below legacy PDT minimum",
        detail: "Prior-day equity is below $25,000. A legacy-regime broker may block day trades until equity is restored.",
      });
    }
    if (settings.marginRegime === MarginRegime.LEGACY_PDT && dtbpUsed > dtbpLimit) {
      addAlert(alerts, {
        id: "dtbp-call",
        level: "danger",
        title: "Estimated DTBP exceeded",
        detail: `Tracked intraday commitment exceeds the start-of-day limit by ${formatMoney(dtbpUsed - dtbpLimit)}.`,
      });
    }
    if (settings.marginRegime === MarginRegime.INTRADAY_MARGIN && highestIntradayDeficit > 0) {
      addAlert(alerts, {
        id: "intraday-deficit",
        level: "danger",
        title: "Intraday margin deficit",
        detail: `The largest tracked negative intraday margin level was ${formatMoney(highestIntradayDeficit)}. Contact your broker about cure timing.`,
      });
    }
    if (maintenanceExcess < 0) {
      addAlert(alerts, {
        id: "maintenance-deficit",
        level: "danger",
        title: "Maintenance deficit",
        detail: `Estimated maintenance requirement exceeds equity by ${formatMoney(Math.abs(maintenanceExcess))}.`,
      });
    }
  }

  settlements.forEach((item) => {
    item.status = item.settlementDate <= dateOnly(asOf) ? "settled" : "pending";
  });

  addAudit(
    auditTrail,
    asOf,
    "Current maintenance excess",
    `${formatMoney(currentEquity)} equity − ${formatMoney(maintenanceRequirement)} maintenance`,
    maintenanceExcess,
  );
  if (settings.accountType === AccountType.MARGIN && settings.marginRegime === MarginRegime.LEGACY_PDT) {
    addAudit(
      auditTrail,
      asOf,
      "Remaining legacy DTBP",
      `${formatMoney(dtbpLimit)} start-of-day limit − ${formatMoney(dtbpUsed)} ${settings.dtbpMethod === DtbpMethod.TIME_AND_TICK ? "peak commitment" : "aggregate commitment"}`,
      dtbpRemaining,
    );
  }

  return {
    asOf,
    currentEquity: roundMoney(currentEquity),
    settledCash: roundMoney(settledCash),
    unsettledCash: roundMoney(pendingCash),
    cashAvailableToTrade: roundMoney(cashAvailableToTrade),
    marginBuyingPower: roundMoney(marginBuyingPower),
    optionBuyingPower: roundMoney(optionBuyingPower),
    dtbpLimit: roundMoney(dtbpLimit),
    dtbpUsed: roundMoney(dtbpUsed),
    dtbpRemaining: roundMoney(dtbpRemaining),
    maintenanceRequirement: roundMoney(maintenanceRequirement),
    maintenanceExcess: roundMoney(maintenanceExcess),
    intradayMarginLevel: roundMoney(intradayMarginLevel),
    highestIntradayDeficit: roundMoney(highestIntradayDeficit),
    realizedPnl: roundMoney(realizedPnl),
    unrealizedPnl: roundMoney(unrealizedPnl),
    fees: roundMoney(fees),
    positions: outputPositions.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    settlements: settlements.sort((a, b) => a.settlementDate.localeCompare(b.settlementDate)),
    alerts,
    analyses,
    auditTrail,
    dayTrades,
    tradeCount: trades.length,
  };
};

export const calculateBuyingPower = calculateAccount;

export const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(clampZero(value));
