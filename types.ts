export enum AccountType {
  MARGIN = "margin",
  CASH = "cash",
}

export enum MarginRegime {
  LEGACY_PDT = "legacy_pdt",
  INTRADAY_MARGIN = "intraday_margin",
}

export enum MarginAccountClass {
  STANDARD = "standard",
  PORTFOLIO_MARGIN = "portfolio_margin",
  GOOD_FAITH = "good_faith",
}

export enum DtbpMethod {
  TIME_AND_TICK = "time_and_tick",
  AGGREGATE = "aggregate",
}

export enum InstrumentType {
  STOCK = "stock",
  ETF = "etf",
  LEVERAGED_ETP = "leveraged_etp",
  OPTION = "option",
}

export enum Side {
  BUY = "buy",
  SELL = "sell",
  SELL_SHORT = "sell_short",
  BUY_TO_COVER = "buy_to_cover",
}

export type RiskLevel = "info" | "watch" | "danger";

export interface Trade {
  id: string;
  executedAt: string;
  symbol: string;
  instrument: InstrumentType;
  side: Side;
  quantity: number;
  price: number;
  fees: number;
  contractMultiplier: number;
  leverageFactor: number;
  marginRequirementPct?: number;
  notes?: string;
}

export interface SymbolMarginOverride {
  initialMarginPct?: number;
  longMaintenancePct?: number;
  shortMaintenancePct?: number;
  notes?: string;
}

export interface AccountSettings {
  accountName: string;
  brokerName: string;
  accountType: AccountType;
  marginRegime: MarginRegime;
  marginAccountClass: MarginAccountClass;
  dtbpMethod: DtbpMethod;
  snapshotDate: string;
  settledCash: number;
  unsettledCash: number;
  startOfDayEquity: number;
  startOfDayMaintenance: number;
  brokerMarginBuyingPower: number;
  brokerDtbp: number;
  brokerIntradayBuyingPower: number;
  pdtRestricted: boolean;
  outstandingIntradayDeficit: number;
  intradayDeficitDate: string;
  intradayDeficitPractice: boolean;
  intradayDeficitExtraordinary: boolean;
  intradayRestrictionUntil: string;
  cashRestricted: boolean;
  longMaintenancePct: number;
  shortMaintenancePct: number;
  initialMarginPct: number;
  houseBufferPct: number;
  symbolMarginOverrides: Record<string, SymbolMarginOverride>;
  settlementHolidays: string[];
}

export interface Position {
  symbol: string;
  instrument: InstrumentType;
  quantity: number;
  averagePrice: number;
  markPrice: number;
  marketValue: number;
  maintenanceRequirement: number;
  unrealizedPnl: number;
}

export interface SettlementItem {
  id: string;
  tradeId: string;
  symbol: string;
  tradeDate: string;
  settlementDate: string;
  amount: number;
  status: "settled" | "pending";
}

export interface RiskAlert {
  id: string;
  level: RiskLevel;
  title: string;
  detail: string;
  tradeId?: string;
}

export interface TradeAnalysis {
  tradeId: string;
  notional: number;
  settlementDate: string;
  settledFundsUsed: number;
  unsettledFundsUsed: number;
  unfundedAmount: number;
  risk: RiskLevel;
  message: string;
  imlBefore: number;
  imlAfter: number;
  imlReducing: boolean;
  intradayBuyingPowerAfter: number;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  label: string;
  formula: string;
  result: number;
}

export interface CalculationResult {
  asOf: string;
  currentEquity: number;
  settledCash: number;
  unsettledCash: number;
  cashAvailableToTrade: number;
  marginBuyingPower: number;
  optionBuyingPower: number;
  dtbpLimit: number;
  dtbpUsed: number;
  dtbpRemaining: number;
  maintenanceRequirement: number;
  maintenanceExcess: number;
  intradayMarginLevel: number;
  intradayBuyingPower: number;
  intradayBuyingPowerLimit: number;
  intradayBuyingPowerUsed: number;
  intradayBuyingPowerRate: number;
  highestIntradayDeficit: number;
  outstandingIntradayDeficit: number;
  intradayDeficitDueDate?: string;
  intradayDeficitExpiresOn?: string;
  deficitCountsTowardPractice: boolean;
  intradayRestrictionActive: boolean;
  intradayRestrictionEndsOn?: string;
  imlReducingTransactions: number;
  leverageEligible: boolean;
  intradayRuleApplies: boolean;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  positions: Position[];
  settlements: SettlementItem[];
  alerts: RiskAlert[];
  analyses: Record<string, TradeAnalysis>;
  auditTrail: AuditEntry[];
  dayTrades: number;
  tradeCount: number;
}

const today = new Date().toISOString().slice(0, 10);

export const DEFAULT_SETTINGS: AccountSettings = {
  accountName: "Primary brokerage",
  brokerName: "My broker",
  accountType: AccountType.MARGIN,
  marginRegime: MarginRegime.INTRADAY_MARGIN,
  marginAccountClass: MarginAccountClass.STANDARD,
  dtbpMethod: DtbpMethod.TIME_AND_TICK,
  snapshotDate: today,
  settledCash: 30_000,
  unsettledCash: 0,
  startOfDayEquity: 30_000,
  startOfDayMaintenance: 0,
  brokerMarginBuyingPower: 60_000,
  brokerDtbp: 120_000,
  brokerIntradayBuyingPower: 0,
  pdtRestricted: false,
  outstandingIntradayDeficit: 0,
  intradayDeficitDate: "",
  intradayDeficitPractice: false,
  intradayDeficitExtraordinary: false,
  intradayRestrictionUntil: "",
  cashRestricted: false,
  longMaintenancePct: 0.25,
  shortMaintenancePct: 0.30,
  initialMarginPct: 0.50,
  houseBufferPct: 0,
  symbolMarginOverrides: {},
  settlementHolidays: [],
};

export const EMPTY_RESULT: CalculationResult = {
  asOf: today,
  currentEquity: 0,
  settledCash: 0,
  unsettledCash: 0,
  cashAvailableToTrade: 0,
  marginBuyingPower: 0,
  optionBuyingPower: 0,
  dtbpLimit: 0,
  dtbpUsed: 0,
  dtbpRemaining: 0,
  maintenanceRequirement: 0,
  maintenanceExcess: 0,
  intradayMarginLevel: 0,
  intradayBuyingPower: 0,
  intradayBuyingPowerLimit: 0,
  intradayBuyingPowerUsed: 0,
  intradayBuyingPowerRate: 0,
  highestIntradayDeficit: 0,
  outstandingIntradayDeficit: 0,
  deficitCountsTowardPractice: false,
  intradayRestrictionActive: false,
  imlReducingTransactions: 0,
  leverageEligible: false,
  intradayRuleApplies: false,
  realizedPnl: 0,
  unrealizedPnl: 0,
  fees: 0,
  positions: [],
  settlements: [],
  alerts: [],
  analyses: {},
  auditTrail: [],
  dayTrades: 0,
  tradeCount: 0,
};
