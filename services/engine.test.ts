import { describe, expect, test } from "vitest";
import { addBusinessDays, calculateAccount, settlementDateFor } from "./engine";
import {
  AccountSettings,
  AccountType,
  DEFAULT_SETTINGS,
  DtbpMethod,
  InstrumentType,
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
    const result = calculateAccount(settings({ brokerDtbp: 120_000 }), [trade()], "2026-07-27T20:00:00.000Z");
    expect(result.dtbpUsed).toBe(10_000);
    expect(result.dtbpRemaining).toBe(110_000);
  });

  test("a completed round trip does not erase the day's peak commitment", () => {
    const result = calculateAccount(
      settings({ brokerDtbp: 120_000, dtbpMethod: DtbpMethod.TIME_AND_TICK }),
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
      settings({ dtbpMethod: DtbpMethod.AGGREGATE, brokerDtbp: 120_000 }),
      executions,
      "2026-07-27T20:00:00.000Z",
    );
    const peak = calculateAccount(
      settings({ dtbpMethod: DtbpMethod.TIME_AND_TICK, brokerDtbp: 120_000 }),
      executions,
      "2026-07-27T20:00:00.000Z",
    );
    expect(aggregate.dtbpUsed).toBe(20_000);
    expect(peak.dtbpUsed).toBe(10_000);
  });

  test("leveraged ETP commitment scales with its maintenance factor", () => {
    const result = calculateAccount(
      settings({ brokerDtbp: 120_000 }),
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
    expect(result.alerts.some((alert) => alert.title === "Intraday margin deficit")).toBe(true);
  });
});
