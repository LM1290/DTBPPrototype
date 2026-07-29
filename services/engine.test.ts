import { describe, expect, test } from "vitest";
import { addBusinessDays, calculateAccount, settlementDateFor } from "./engine";
import {
  PROTOTYPE_MARGIN_SYMBOLS,
  resolveSymbolMargin,
} from "../data/prototypeMarginCatalog";
import {
  AccountSettings,
  AccountType,
  DEFAULT_SETTINGS,
  DtbpMethod,
  InstrumentType,
  MarginAccountClass,
  MarginRegime,
  Side,
  Trade,
} from "../types";

const settings = (overrides: Partial<AccountSettings> = {}): AccountSettings => ({
  ...DEFAULT_SETTINGS,
  snapshotDate: "2026-07-27",
  settlementHolidays: [],
  ...overrides,
});

const trade = (overrides: Partial<Trade> = {}): Trade => ({
  id: crypto.randomUUID(),
  executedAt: "2026-07-27T14:30:00.000Z",
  symbol: "SPY",
  instrument: InstrumentType.STOCK,
  side: Side.BUY,
  quantity: 100,
  price: 100,
  fees: 0,
  contractMultiplier: 100,
  leverageFactor: 1,
  ...overrides,
});

describe("settlement calendar", () => {
  test("uses T+1 for an ordinary weekday", () => {
    expect(settlementDateFor(trade(), settings())).toBe("2026-07-28");
  });

  test("skips weekends", () => {
    expect(addBusinessDays("2026-07-31", 1)).toBe("2026-08-03");
  });

  test("skips standard market holidays", () => {
    expect(addBusinessDays("2026-11-25", 1)).toBe("2026-11-27");
  });

  test("accepts exceptional closure dates", () => {
    expect(addBusinessDays("2026-07-27", 1, ["2026-07-28"])).toBe("2026-07-29");
  });
});

describe("cash account funding ledger", () => {
  test("same-day sale of a fully settled-cash purchase is not a GFV", () => {
    const buy = trade({ id: "buy" });
    const sell = trade({ id: "sell", side: Side.SELL, executedAt: "2026-07-27T15:30:00.000Z" });
    const result = calculateAccount(
      settings({ accountType: AccountType.CASH, settledCash: 10_000, unsettledCash: 0 }),
      [buy, sell],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.alerts.some((alert) => alert.title.includes("good-faith"))).toBe(false);
    expect(result.analyses.sell.risk).toBe("info");
  });

  test("flags a sale of a lot funded by unsettled proceeds", () => {
    const buyA = trade({ id: "buy-a" });
    const sellA = trade({ id: "sell-a", side: Side.SELL, executedAt: "2026-07-27T15:00:00.000Z" });
    const buyB = trade({ id: "buy-b", symbol: "QQQ", executedAt: "2026-07-27T16:00:00.000Z" });
    const sellB = trade({ id: "sell-b", symbol: "QQQ", side: Side.SELL, executedAt: "2026-07-27T17:00:00.000Z" });
    const result = calculateAccount(
      settings({ accountType: AccountType.CASH, settledCash: 10_000, unsettledCash: 0 }),
      [buyA, sellA, buyB, sellB],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.analyses["buy-b"].unsettledFundsUsed).toBe(10_000);
    expect(result.analyses["sell-b"].risk).toBe("danger");
    expect(result.alerts.some((alert) => alert.title === "Potential good-faith violation")).toBe(true);
  });

  test("flags an unfunded purchase and freeriding when that lot is sold", () => {
    const buy = trade({ id: "buy" });
    const sell = trade({ id: "sell", side: Side.SELL, executedAt: "2026-07-28T15:30:00.000Z" });
    const result = calculateAccount(
      settings({ accountType: AccountType.CASH, settledCash: 2_000, unsettledCash: 0 }),
      [buy, sell],
      "2026-07-28T20:00:00.000Z",
    );

    expect(result.analyses.buy.unfundedAmount).toBe(8_000);
    expect(result.alerts.some((alert) => alert.title === "Potential freeriding violation")).toBe(true);
  });

  test("cash-up-front restriction excludes unsettled proceeds from cash available", () => {
    const result = calculateAccount(
      settings({
        accountType: AccountType.CASH,
        settledCash: 1_000,
        unsettledCash: 2_000,
        cashRestricted: true,
      }),
      [],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.cashAvailableToTrade).toBe(1_000);
  });
});

describe("legacy DTBP", () => {
  test("uses a broker opening limit and peak time-and-tick commitment", () => {
    const result = calculateAccount(
      settings({ marginRegime: MarginRegime.LEGACY_PDT, brokerDtbp: 120_000 }),
      [trade()],
      "2026-07-27T20:00:00.000Z",
    );
    expect(result.dtbpUsed).toBe(10_000);
    expect(result.dtbpRemaining).toBe(110_000);
  });

  test("a completed round trip does not erase the day's peak commitment", () => {
    const result = calculateAccount(
      settings({ marginRegime: MarginRegime.LEGACY_PDT, brokerDtbp: 120_000, dtbpMethod: DtbpMethod.TIME_AND_TICK }),
      [
        trade({ id: "buy" }),
        trade({ id: "sell", side: Side.SELL, executedAt: "2026-07-27T15:00:00.000Z" }),
      ],
      "2026-07-27T20:00:00.000Z",
    );
    expect(result.dtbpUsed).toBe(10_000);
    expect(result.dtbpRemaining).toBe(110_000);
    expect(result.dayTrades).toBe(1);
  });

  test("aggregate commitment counts repeat openings while time-and-tick uses the peak", () => {
    const executions = [
      trade({ id: "buy-1" }),
      trade({ id: "sell", side: Side.SELL, executedAt: "2026-07-27T15:00:00.000Z" }),
      trade({ id: "buy-2", executedAt: "2026-07-27T16:00:00.000Z" }),
    ];
    const aggregate = calculateAccount(
      settings({ marginRegime: MarginRegime.LEGACY_PDT, dtbpMethod: DtbpMethod.AGGREGATE, brokerDtbp: 120_000 }),
      executions,
      "2026-07-27T20:00:00.000Z",
    );
    const peak = calculateAccount(
      settings({ marginRegime: MarginRegime.LEGACY_PDT, dtbpMethod: DtbpMethod.TIME_AND_TICK, brokerDtbp: 120_000 }),
      executions,
      "2026-07-27T20:00:00.000Z",
    );
    expect(aggregate.dtbpUsed).toBe(20_000);
    expect(peak.dtbpUsed).toBe(10_000);
  });

  test("leveraged ETP commitment scales with its maintenance factor", () => {
    const result = calculateAccount(
      settings({ marginRegime: MarginRegime.LEGACY_PDT, brokerDtbp: 120_000 }),
      [trade({ instrument: InstrumentType.LEVERAGED_ETP, leverageFactor: 3 })],
      "2026-07-27T20:00:00.000Z",
    );
    expect(result.dtbpUsed).toBe(30_000);
    expect(result.positions[0].maintenanceRequirement).toBe(7_500);
  });
});

describe("new intraday margin standard", () => {
  test("captures the largest negative intraday margin level", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 10_000,
        startOfDayMaintenance: 0,
        brokerMarginBuyingPower: 0,
      }),
      [trade({ quantity: 500 })],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.maintenanceRequirement).toBe(12_500);
    expect(result.highestIntradayDeficit).toBe(2_500);
    expect(result.intradayBuyingPower).toBe(0);
    expect(result.dtbpLimit).toBe(0);
    expect(result.dtbpUsed).toBe(0);
    expect(result.alerts.some((alert) => alert.title === "Intraday margin deficit")).toBe(true);
  });

  test("eliminates PDT counting, the $25,000 floor, and legacy DTBP in the new branch", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 10_000,
        startOfDayMaintenance: 0,
        brokerMarginBuyingPower: 0,
        brokerDtbp: 999_999,
      }),
      [
        trade({ id: "buy" }),
        trade({ id: "sell", side: Side.SELL, executedAt: "2026-07-27T15:00:00.000Z" }),
      ],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.dayTrades).toBe(0);
    expect(result.dtbpLimit).toBe(0);
    expect(result.dtbpUsed).toBe(0);
    expect(result.dtbpRemaining).toBe(0);
    expect(result.intradayBuyingPower).toBe(40_000);
    expect(result.alerts.some((alert) => alert.id === "pdt-minimum")).toBe(false);
  });

  test("keeps the largest negative IML after a later same-day recovery", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 10_000,
        startOfDayMaintenance: 0,
        brokerMarginBuyingPower: 0,
      }),
      [
        trade({ id: "buy", quantity: 500 }),
        trade({ id: "sell", side: Side.SELL, quantity: 500, executedAt: "2026-07-27T15:00:00.000Z" }),
      ],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.intradayMarginLevel).toBe(10_000);
    expect(result.intradayBuyingPower).toBe(40_000);
    expect(result.highestIntradayDeficit).toBe(2_500);
    expect(result.imlReducingTransactions).toBe(1);
    expect(result.analyses.buy.imlReducing).toBe(true);
    expect(result.analyses.sell.imlReducing).toBe(false);
  });

  test("uses house maintenance to reduce default-rate intraday capacity", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 30_000,
        startOfDayMaintenance: 0,
        brokerMarginBuyingPower: 0,
        brokerIntradayBuyingPower: 0,
      }),
      [trade({ symbol: "MSTR" })],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.maintenanceRequirement).toBe(4_000);
    expect(result.intradayBuyingPowerLimit).toBe(120_000);
    expect(result.intradayBuyingPower).toBe(104_000);
    expect(result.intradayBuyingPowerUsed).toBe(16_000);
  });

  test("honors a broker-reported opening intraday cap", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 30_000,
        startOfDayMaintenance: 0,
        brokerIntradayBuyingPower: 100_000,
      }),
      [trade()],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.intradayBuyingPowerLimit).toBe(100_000);
    expect(result.intradayBuyingPower).toBe(90_000);
  });

  test("retains the general $2,000 leverage floor", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 1_500,
        startOfDayMaintenance: 0,
        settledCash: 1_200,
        brokerIntradayBuyingPower: 10_000,
      }),
      [],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.leverageEligible).toBe(false);
    expect(result.intradayBuyingPower).toBe(1_200);
    expect(result.alerts.some((alert) => alert.id === "minimum-margin-equity")).toBe(true);
  });

  test("models the fifth-business-day restriction only for material repeated late cures", () => {
    const restricted = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 10_000,
        outstandingIntradayDeficit: 2_000,
        intradayDeficitDate: "2026-07-20",
        intradayDeficitPractice: true,
      }),
      [],
      "2026-07-29T20:00:00.000Z",
    );
    const belowPracticeThreshold = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 10_000,
        outstandingIntradayDeficit: 400,
        intradayDeficitDate: "2026-07-20",
        intradayDeficitPractice: true,
      }),
      [],
      "2026-07-29T20:00:00.000Z",
    );

    expect(restricted.intradayDeficitDueDate).toBe("2026-07-27");
    expect(restricted.deficitCountsTowardPractice).toBe(true);
    expect(restricted.intradayRestrictionActive).toBe(true);
    expect(restricted.intradayBuyingPower).toBe(0);
    expect(belowPracticeThreshold.deficitCountsTowardPractice).toBe(false);
    expect(belowPracticeThreshold.intradayRestrictionActive).toBe(false);
  });

  test("expires the deficit after 15 business days while preserving an applicable freeze", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 10_000,
        outstandingIntradayDeficit: 2_000,
        intradayDeficitDate: "2026-07-20",
        intradayDeficitPractice: true,
      }),
      [],
      "2026-08-11T20:00:00.000Z",
    );

    expect(result.intradayDeficitExpiresOn).toBe("2026-08-10");
    expect(result.outstandingIntradayDeficit).toBe(0);
    expect(result.intradayRestrictionActive).toBe(true);
  });

  test("does not derive a practice freeze for a broker-classified extraordinary deficit", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        startOfDayEquity: 10_000,
        outstandingIntradayDeficit: 2_000,
        intradayDeficitDate: "2026-07-20",
        intradayDeficitPractice: true,
        intradayDeficitExtraordinary: true,
      }),
      [],
      "2026-07-29T20:00:00.000Z",
    );

    expect(result.deficitCountsTowardPractice).toBe(false);
    expect(result.intradayRestrictionActive).toBe(false);
  });

  test("uses broker capacity for account classes excluded from standard IML", () => {
    const result = calculateAccount(
      settings({
        marginRegime: MarginRegime.INTRADAY_MARGIN,
        marginAccountClass: MarginAccountClass.PORTFOLIO_MARGIN,
        brokerIntradayBuyingPower: 75_000,
      }),
      [],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.intradayRuleApplies).toBe(false);
    expect(result.intradayBuyingPower).toBe(75_000);
  });
});

describe("symbol margin catalog", () => {
  test("ships a broad prototype universe with the requested examples", () => {
    expect(PROTOTYPE_MARGIN_SYMBOLS.length).toBeGreaterThanOrEqual(500);
    expect(new Set(PROTOTYPE_MARGIN_SYMBOLS).size).toBe(PROTOTYPE_MARGIN_SYMBOLS.length);
    expect(resolveSymbolMargin("MSTR", settings()).longMaintenancePct).toBe(0.40);
    expect(resolveSymbolMargin("TSLA", settings()).longMaintenancePct).toBe(0.30);
  });

  test("uses a saved symbol override in maintenance and initial buying power", () => {
    const result = calculateAccount(
      settings({
        brokerMarginBuyingPower: 60_000,
        symbolMarginOverrides: {
          AAPL: {
            initialMarginPct: 0.60,
            longMaintenancePct: 0.45,
            shortMaintenancePct: 0.55,
          },
        },
      }),
      [trade({ symbol: "AAPL" })],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.positions[0].maintenanceRequirement).toBe(4_500);
    expect(result.marginBuyingPower).toBe(54_000);
  });

  test("keeps the execution override as the highest-precedence rule", () => {
    const result = calculateAccount(
      settings({
        brokerMarginBuyingPower: 60_000,
        symbolMarginOverrides: {
          MSTR: { initialMarginPct: 0.55, longMaintenancePct: 0.45 },
        },
      }),
      [trade({ symbol: "MSTR", marginRequirementPct: 0.65 })],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.positions[0].maintenanceRequirement).toBe(6_500);
    expect(result.marginBuyingPower).toBe(53_500);
  });
});

describe("short-stock maintenance floors", () => {
  test("applies the $5 per-share floor at $5 and above", () => {
    const result = calculateAccount(
      settings({ brokerIntradayBuyingPower: 0 }),
      [trade({ side: Side.SELL_SHORT, quantity: 100, price: 10 })],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.positions[0].maintenanceRequirement).toBe(500);
  });

  test("applies the greater of 100% market value or $2.50 per share below $5", () => {
    const result = calculateAccount(
      settings({ brokerIntradayBuyingPower: 0 }),
      [trade({ side: Side.SELL_SHORT, quantity: 100, price: 2 })],
      "2026-07-27T20:00:00.000Z",
    );

    expect(result.positions[0].maintenanceRequirement).toBe(250);
  });
});
