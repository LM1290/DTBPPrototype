import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, ScanSearch } from "lucide-react";
import { formatMoney } from "../services/engine";
import { InstrumentType, Side, Trade, TradeAnalysis } from "../types";

interface Props {
  onAddTrade: (trade: Trade) => void;
  onPreview: (trade: Trade | null) => void;
  previewAnalysis?: TradeAnalysis;
}

const localDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const blankTrade = (): Omit<Trade, "id"> => ({
  executedAt: localDateTime(),
  symbol: "",
  instrument: InstrumentType.STOCK,
  side: Side.BUY,
  quantity: 100,
  price: 0,
  fees: 0,
  contractMultiplier: 100,
  leverageFactor: 1,
  notes: "",
});

export function TradeForm({ onAddTrade, onPreview, previewAnalysis }: Props) {
  const [trade, setTrade] = useState(blankTrade);
  const [expanded, setExpanded] = useState(false);

  const preview = useMemo<Trade | null>(() => {
    if (!trade.symbol.trim() || trade.quantity <= 0 || trade.price <= 0) return null;
    return {
      ...trade,
      id: "preview",
      symbol: trade.symbol.trim().toUpperCase(),
      executedAt: new Date(trade.executedAt).toISOString(),
    };
  }, [trade]);

  useEffect(() => {
    onPreview(preview);
  }, [preview, onPreview]);

  const set = <K extends keyof typeof trade>(key: K, value: (typeof trade)[K]) => {
    setTrade((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    onAddTrade({ ...preview, id: crypto.randomUUID() });
    setTrade((current) => ({ ...blankTrade(), instrument: current.instrument, side: current.side }));
    setExpanded(false);
  };

  return (
    <section className="trade-ticket" aria-labelledby="trade-ticket-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">New execution</span>
          <h2 id="trade-ticket-title">Clear a trade before you log it</h2>
        </div>
        <span className="keyboard-hint">Live preview</span>
      </div>

      <form onSubmit={submit}>
        <div className="ticket-grid">
          <label className="field symbol-field">
            <span>Symbol</span>
            <input
              autoComplete="off"
              inputMode="text"
              maxLength={12}
              placeholder="AAPL"
              value={trade.symbol}
              onChange={(event) => set("symbol", event.target.value.toUpperCase())}
            />
          </label>

          <label className="field">
            <span>Action</span>
            <select value={trade.side} onChange={(event) => set("side", event.target.value as Side)}>
              <option value={Side.BUY}>Buy</option>
              <option value={Side.SELL}>Sell</option>
              <option value={Side.SELL_SHORT}>Sell short</option>
              <option value={Side.BUY_TO_COVER}>Buy to cover</option>
            </select>
          </label>

          <label className="field">
            <span>Quantity</span>
            <input
              type="number"
              min="0.0001"
              step="any"
              value={trade.quantity}
              onChange={(event) => set("quantity", Number(event.target.value))}
            />
          </label>

          <label className="field">
            <span>Price</span>
            <div className="money-input">
              <b>$</b>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={trade.price || ""}
                onChange={(event) => set("price", Number(event.target.value))}
              />
            </div>
          </label>

          <div className="ticket-submit">
            <button className="button primary" type="submit" disabled={!preview}>
              <Plus size={17} aria-hidden="true" />
              Log trade
            </button>
          </div>
        </div>

        <div className="ticket-meta-row">
          <button className="text-button" type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide trade details" : "Instrument, fees & execution time"}
            <ArrowRight className={expanded ? "rotate" : ""} size={14} aria-hidden="true" />
          </button>
          {preview && (
            <div className={`preview-line ${previewAnalysis?.risk ?? "info"}`}>
              <ScanSearch size={15} aria-hidden="true" />
              <span>
                {formatMoney(previewAnalysis?.notional ?? 0)} notional
                {previewAnalysis ? ` · ${previewAnalysis.message}` : ""}
              </span>
            </div>
          )}
        </div>

        {expanded && (
          <div className="ticket-details">
            <label className="field">
              <span>Instrument</span>
              <select
                value={trade.instrument}
                onChange={(event) => {
                  const instrument = event.target.value as InstrumentType;
                  setTrade((current) => ({
                    ...current,
                    instrument,
                    leverageFactor: instrument === InstrumentType.LEVERAGED_ETP ? 3 : 1,
                  }));
                }}
              >
                <option value={InstrumentType.STOCK}>Stock</option>
                <option value={InstrumentType.ETF}>ETF</option>
                <option value={InstrumentType.LEVERAGED_ETP}>Leveraged ETP</option>
                <option value={InstrumentType.OPTION}>Option</option>
              </select>
            </label>
            {trade.instrument === InstrumentType.OPTION && (
              <label className="field">
                <span>Contract multiplier</span>
                <input
                  type="number"
                  min="1"
                  value={trade.contractMultiplier}
                  onChange={(event) => set("contractMultiplier", Number(event.target.value))}
                />
              </label>
            )}
            {trade.instrument === InstrumentType.LEVERAGED_ETP && (
              <label className="field">
                <span>Leverage factor</span>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={trade.leverageFactor}
                  onChange={(event) => set("leverageFactor", Number(event.target.value))}
                />
              </label>
            )}
            <label className="field">
              <span>Fees</span>
              <div className="money-input">
                <b>$</b>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={trade.fees || ""}
                  onChange={(event) => set("fees", Number(event.target.value))}
                />
              </div>
            </label>
            <label className="field">
              <span>Executed at</span>
              <input
                type="datetime-local"
                value={trade.executedAt}
                onChange={(event) => set("executedAt", event.target.value)}
              />
            </label>
            <label className="field notes-field">
              <span>Notes</span>
              <input
                placeholder="Optional context"
                value={trade.notes ?? ""}
                onChange={(event) => set("notes", event.target.value)}
              />
            </label>
          </div>
        )}
      </form>
    </section>
  );
}
