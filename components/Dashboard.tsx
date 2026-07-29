import type { CSSProperties, ReactNode } from "react";
import {
  AlertOctagon,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  Landmark,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { formatMoney } from "../services/engine";
import {
  AccountSettings,
  AccountType,
  CalculationResult,
  MarginRegime,
  Side,
  Trade,
} from "../types";

interface Props {
  result: CalculationResult;
  settings: AccountSettings;
  trades: Trade[];
  onDeleteTrade: (id: string) => void;
}

const signedMoney = (value: number) => `${value >= 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
const actionLabel: Record<Side, string> = {
  [Side.BUY]: "Buy",
  [Side.SELL]: "Sell",
  [Side.SELL_SHORT]: "Sell short",
  [Side.BUY_TO_COVER]: "Cover",
};

export function Dashboard({ result, settings, trades, onDeleteTrade }: Props) {
  const isIntradayMargin =
    settings.accountType === AccountType.MARGIN
    && settings.marginRegime === MarginRegime.INTRADAY_MARGIN;
  const primaryValue =
    settings.accountType === AccountType.CASH
      ? result.cashAvailableToTrade
      : settings.marginRegime === MarginRegime.LEGACY_PDT
        ? result.dtbpRemaining
        : result.intradayBuyingPower;

  const primaryLabel =
    settings.accountType === AccountType.CASH
      ? "Cash available to trade"
      : settings.marginRegime === MarginRegime.LEGACY_PDT
        ? "Estimated DTBP remaining"
        : "Estimated intraday buying power";
  const capacityLimit =
    settings.accountType === AccountType.CASH
      ? result.cashAvailableToTrade
      : settings.marginRegime === MarginRegime.LEGACY_PDT
        ? result.dtbpLimit
        : result.intradayBuyingPowerLimit;
  const capacityRemaining =
    settings.accountType === AccountType.CASH
      ? result.cashAvailableToTrade
      : settings.marginRegime === MarginRegime.LEGACY_PDT
        ? result.dtbpRemaining
        : result.intradayBuyingPower;
  const capacityPercent = capacityLimit > 0
    ? Math.min(100, Math.max(0, (capacityRemaining / capacityLimit) * 100))
    : 100;

  return (
    <>
      <section className="hero-metric">
        <div className="hero-copy">
          <span className="eyebrow">{settings.accountName}</span>
          <div className="hero-value-row">
            <h1>{formatMoney(primaryValue)}</h1>
            <span className={`status-pill ${result.alerts.some((alert) => alert.level === "danger") ? "danger" : "safe"}`}>
              {result.alerts.some((alert) => alert.level === "danger") ? (
                <ShieldAlert size={14} />
              ) : (
                <CheckCircle2 size={14} />
              )}
              {result.alerts.some((alert) => alert.level === "danger") ? "Action needed" : "Within tracked limits"}
            </span>
          </div>
          <p>{primaryLabel}</p>
          <small>
            {isIntradayMargin
              ? `${formatMoney(result.intradayMarginLevel)} current IML · ${(result.intradayBuyingPowerRate * 100).toFixed(1)}% baseline long requirement · `
              : ""}
            Based on {settings.brokerName} opening balances and {result.tradeCount} tracked execution
            {result.tradeCount === 1 ? "" : "s"}. Reconcile against your broker before placing an order.
          </small>
        </div>
        <div className="capacity-ring" style={{ "--capacity": `${capacityPercent}%` } as CSSProperties}>
          <div>
            <strong>
              {settings.accountType === AccountType.MARGIN
                ? `${Math.round(capacityPercent)}%`
                : result.alerts.filter((alert) => alert.level === "danger").length}
            </strong>
            <span>
              {settings.accountType === AccountType.MARGIN
                ? "capacity left"
                : "critical flags"}
            </span>
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Account metrics">
        <MetricCard
          icon={<Gauge />}
          label={settings.accountType === AccountType.CASH ? "Cash available" : "Margin buying power"}
          value={formatMoney(settings.accountType === AccountType.CASH ? result.cashAvailableToTrade : result.marginBuyingPower)}
          note={settings.accountType === AccountType.CASH
            ? "Settled plus eligible pending proceeds"
            : settings.brokerMarginBuyingPower > 0
              ? "Broker opening BP less tracked use"
              : "Estimate from maintenance excess"}
        />
        <MetricCard
          icon={<Landmark />}
          label={isIntradayMargin ? "Current IML" : settings.accountType === AccountType.CASH ? "Current equity" : "Maintenance excess"}
          value={formatMoney(isIntradayMargin || settings.accountType === AccountType.MARGIN ? result.maintenanceExcess : result.currentEquity)}
          note={isIntradayMargin
            ? `${result.imlReducingTransactions} IML-reducing transaction${result.imlReducingTransactions === 1 ? "" : "s"}`
            : settings.accountType === AccountType.CASH
              ? "Tracked cash-account equity"
              : `${formatMoney(result.maintenanceRequirement)} requirement`}
          danger={settings.accountType === AccountType.MARGIN && result.maintenanceExcess < 0}
        />
        <MetricCard
          icon={<CircleDollarSign />}
          label="Settled cash"
          value={formatMoney(result.settledCash)}
          note={`${formatMoney(result.unsettledCash)} pending settlement`}
        />
        <MetricCard
          icon={<CalendarClock />}
          label={settings.accountType === AccountType.CASH
            ? "Pending settlement"
            : settings.marginRegime === MarginRegime.LEGACY_PDT
              ? "DTBP used"
              : "Largest intraday deficit"}
          value={formatMoney(settings.accountType === AccountType.CASH
            ? result.unsettledCash
            : settings.marginRegime === MarginRegime.LEGACY_PDT
              ? result.dtbpUsed
              : result.highestIntradayDeficit)}
          note={
            settings.accountType === AccountType.CASH
              ? "Sale proceeds awaiting T+1"
              : settings.marginRegime === MarginRegime.LEGACY_PDT
              ? `${formatMoney(result.dtbpLimit)} opening limit`
              : result.outstandingIntradayDeficit > 0
                ? `${formatMoney(result.outstandingIntradayDeficit)} outstanding${result.intradayDeficitDueDate ? ` · checkpoint ${result.intradayDeficitDueDate}` : ""}`
                : "Largest negative IML after reducing transactions"
          }
          danger={isIntradayMargin && result.highestIntradayDeficit > 0}
        />
      </section>

      <section className="content-grid">
        <div className="panel risk-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Guardrails</span>
              <h2>Risk center</h2>
            </div>
            <span className="count-badge">{result.alerts.length}</span>
          </div>
          {result.alerts.length === 0 ? (
            <div className="empty-state short">
              <CheckCircle2 />
              <div>
                <strong>No tracked violations</strong>
                <p>New settlement and margin risks will appear here.</p>
              </div>
            </div>
          ) : (
            <div className="alert-list">
              {result.alerts.slice(0, 5).map((alert) => (
                <article className={`alert-row ${alert.level}`} key={alert.id}>
                  {alert.level === "danger" ? <AlertOctagon /> : <ShieldAlert />}
                  <div>
                    <strong>{alert.title}</strong>
                    <p>{alert.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="panel settlement-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">T+1 ledger</span>
              <h2>Settlement queue</h2>
            </div>
          </div>
          {result.settlements.length === 0 ? (
            <div className="empty-state short">
              <CalendarClock />
              <div>
                <strong>No sale proceeds pending</strong>
                <p>Completed sales will produce a settlement timeline.</p>
              </div>
            </div>
          ) : (
            <div className="timeline">
              {result.settlements.slice(-5).map((item) => (
                <div className="timeline-row" key={item.id}>
                  <span className={`timeline-dot ${item.status}`} />
                  <div>
                    <strong>{item.symbol}</strong>
                    <small>
                      Sold {new Date(`${item.tradeDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </small>
                  </div>
                  <div className="timeline-value">
                    <strong>{formatMoney(item.amount)}</strong>
                    <small>{item.status === "settled" ? "Settled" : `Due ${item.settlementDate}`}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel positions-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Exposure</span>
            <h2>Tracked positions</h2>
          </div>
          <span className="muted-copy">{result.positions.length} open</span>
        </div>
        {result.positions.length === 0 ? (
          <div className="empty-table">Open positions built from logged trades will appear here.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Position</th>
                  <th>Average</th>
                  <th>Mark</th>
                  <th>Market value</th>
                  <th>Maintenance</th>
                  <th>Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {result.positions.map((position) => (
                  <tr key={`${position.symbol}-${position.instrument}`}>
                    <td>
                      <strong>{position.symbol}</strong>
                      <small>{position.instrument.replaceAll("_", " ")}</small>
                    </td>
                    <td>{position.quantity.toLocaleString()}</td>
                    <td>{formatMoney(position.averagePrice)}</td>
                    <td>{formatMoney(position.markPrice)}</td>
                    <td>{formatMoney(position.marketValue)}</td>
                    <td>{formatMoney(position.maintenanceRequirement)}</td>
                    <td className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>
                      {signedMoney(position.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel ledger-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Execution history</span>
            <h2>Trade ledger</h2>
          </div>
          <div className="ledger-totals">
            <span>
              {settings.accountType === AccountType.MARGIN && settings.marginRegime === MarginRegime.LEGACY_PDT
                ? `${result.dayTrades} day trade${result.dayTrades === 1 ? "" : "s"}`
                : isIntradayMargin
                  ? `${result.imlReducingTransactions} IML-reducing`
                  : `${result.tradeCount} execution${result.tradeCount === 1 ? "" : "s"}`}
            </span>
            <span>{formatMoney(result.fees)} fees</span>
          </div>
        </div>
        {trades.length === 0 ? (
          <div className="empty-table">Log your first execution above. Nothing leaves this device unless you enable cloud sync.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Execution</th>
                  <th>Symbol</th>
                  <th>Action</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Notional</th>
                  <th>Clearance</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {[...trades].sort((a, b) => b.executedAt.localeCompare(a.executedAt)).map((trade) => {
                  const analysis = result.analyses[trade.id];
                  const isBuy = trade.side === Side.BUY || trade.side === Side.BUY_TO_COVER;
                  return (
                    <tr key={trade.id}>
                      <td>
                        <strong>{new Date(trade.executedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong>
                        <small>{new Date(trade.executedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</small>
                      </td>
                      <td><strong>{trade.symbol}</strong></td>
                      <td>
                        <span className={`action-chip ${isBuy ? "buy" : "sell"}`}>
                          {isBuy ? <ArrowDownRight /> : <ArrowUpRight />}
                          {actionLabel[trade.side]}
                        </span>
                      </td>
                      <td>{trade.quantity.toLocaleString()}</td>
                      <td>{formatMoney(trade.price)}</td>
                      <td>{formatMoney(analysis?.notional ?? 0)}</td>
                      <td>
                        <span className={`clearance ${analysis?.risk ?? "info"}`}>
                          {analysis?.risk === "danger" ? "Review" : analysis?.risk === "watch" ? "Hold" : "Clear"}
                        </span>
                      </td>
                      <td>
                        <button className="icon-button" type="button" aria-label={`Delete ${trade.symbol} trade`} onClick={() => onDeleteTrade(trade.id)}>
                          <Trash2 />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  danger?: boolean;
}) {
  return (
    <article className={`metric-card ${danger ? "danger" : ""}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}
