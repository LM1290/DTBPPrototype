export enum AccountType {
  MARGIN = "margin",
  CASH = "cash",
}

export enum MarginRegime {
  LEGACY_PDT = "legacy_pdt",
  INTRADAY_MARGIN = "intraday_margin",
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

export interface AccountSettings {
  accountName: string;
  brokerName: string;
  accountType: AccountType;
  marginRegime: MarginRegime;
  dtbpMethod: DtbpMethod;
  snapshotDate: string;
  settledCash: number;
  unsettledCash: number;
  startOfDayEquity: number;
  startOfDayMaintenance: number;
  brokerMarginBuyingPower: number;
  brokerDtbp: number;
  pdtRestricted: boolean;
  cashRestricted: boolean;
  longMaintenancePct: number;
  shortMaintenancePct: number;
  initialMarginPct: number;
  houseBufferPct: number;
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
  highestIntradayDeficit: number;
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
  marginRegime: MarginRegime.LEGACY_PDT,
  dtbpMethod: DtbpMethod.TIME_AND_TICK,
  snapshotDate: today,
  settledCash: 30_000,
  unsettledCash: 0,
  startOfDayEquity: 30_000,
  startOfDayMaintenance: 0,
  brokerMarginBuyingPower: 60_000,
  brokerDtbp: 120_000,
  pdtRestricted: false,
  cashRestricted: false,
  longMaintenancePct: 0.25,
  shortMaintenancePct: 0.30,
  initialMarginPct: 0.50,
  houseBufferPct: 0,
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
  highestIntradayDeficit: 0,
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
