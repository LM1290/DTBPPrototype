import { useEffect, useMemo, useState } from "react";
import { Info, RotateCcw, Search, X } from "lucide-react";
import {
  PROTOTYPE_MARGIN_SYMBOLS,
  normalizeMarginSymbol,
  resolveSymbolMargin,
} from "../data/prototypeMarginCatalog";
import {
  AccountSettings,
  AccountType,
  DtbpMethod,
  MarginRegime,
} from "../types";

interface Props {
  isOpen: boolean;
  settings: AccountSettings;
  onSave: (settings: AccountSettings) => void;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(settings);
  const [marginSymbol, setMarginSymbol] = useState("MSTR");

  useEffect(() => setDraft(settings), [settings, isOpen]);

  const normalizedMarginSymbol = normalizeMarginSymbol(marginSymbol);
  const resolvedMargin = resolveSymbolMargin(normalizedMarginSymbol, draft);
  const matchingSymbols = useMemo(
    () => PROTOTYPE_MARGIN_SYMBOLS
      .filter((symbol) => !normalizedMarginSymbol || symbol.includes(normalizedMarginSymbol))
      .slice(0, 12),
    [normalizedMarginSymbol],
  );

  if (!isOpen) return null;

  const set = <K extends keyof AccountSettings>(key: K, value: AccountSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const updateMarginOverride = (
    key: "initialMarginPct" | "longMaintenancePct" | "shortMaintenancePct",
    value: number,
  ) => {
    if (!normalizedMarginSymbol) return;
    setDraft((current) => ({
      ...current,
      symbolMarginOverrides: {
        ...(current.symbolMarginOverrides ?? {}),
        [normalizedMarginSymbol]: {
          ...(current.symbolMarginOverrides?.[normalizedMarginSymbol] ?? {}),
          [key]: value,
        },
      },
    }));
  };

  const resetMarginOverride = () => {
    if (!normalizedMarginSymbol) return;
    setDraft((current) => {
      const next = { ...(current.symbolMarginOverrides ?? {}) };
      delete next[normalizedMarginSymbol];
      return { ...current, symbolMarginOverrides: next };
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          <div>
            <span className="eyebrow">Opening snapshot</span>
            <h2 id="settings-title">Account configuration</h2>
            <p>Copy these balances from your broker before the first tracked trade.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <X />
          </button>
        </header>

        <div className="sheet-body">
          <div className="settings-section">
            <div className="settings-section-title">
              <span>01</span>
              <div>
                <h3>Account identity</h3>
                <p>Labels only. No brokerage connection is made.</p>
              </div>
            </div>
            <div className="settings-grid">
              <label className="field">
                <span>Account name</span>
                <input value={draft.accountName} onChange={(event) => set("accountName", event.target.value)} />
              </label>
              <label className="field">
                <span>Broker</span>
                <input value={draft.brokerName} onChange={(event) => set("brokerName", event.target.value)} />
              </label>
              <label className="field">
                <span>Account type</span>
                <select value={draft.accountType} onChange={(event) => set("accountType", event.target.value as AccountType)}>
                  <option value={AccountType.MARGIN}>Margin account</option>
                  <option value={AccountType.CASH}>Cash account</option>
                </select>
              </label>
              <label className="field">
                <span>Snapshot date</span>
                <input type="date" value={draft.snapshotDate} onChange={(event) => set("snapshotDate", event.target.value)} />
              </label>
            </div>
          </div>

          {draft.accountType === AccountType.MARGIN ? (
            <>
              <div className="settings-section">
                <div className="settings-section-title">
                  <span>02</span>
                  <div>
                    <h3>Broker regime</h3>
                    <p>Firms may transition to FINRA’s new intraday standard through October 20, 2027.</p>
                  </div>
                </div>
                <div className="choice-grid">
                  <button className={`choice-card ${draft.marginRegime === MarginRegime.LEGACY_PDT ? "selected" : ""}`} type="button" onClick={() => set("marginRegime", MarginRegime.LEGACY_PDT)}>
                    <strong>Legacy PDT / DTBP</strong>
                    <span>Prior-day maintenance excess × 4, with the $25,000 PDT minimum.</span>
                  </button>
                  <button className={`choice-card ${draft.marginRegime === MarginRegime.INTRADAY_MARGIN ? "selected" : ""}`} type="button" onClick={() => set("marginRegime", MarginRegime.INTRADAY_MARGIN)}>
                    <strong>New intraday margin</strong>
                    <span>Tracks intraday margin level and the largest negative IML.</span>
                  </button>
                </div>
                {draft.marginRegime === MarginRegime.LEGACY_PDT && (
                  <div className="inline-fields">
                    <label className="field">
                      <span>DTBP calculation method</span>
                      <select value={draft.dtbpMethod} onChange={(event) => set("dtbpMethod", event.target.value as DtbpMethod)}>
                        <option value={DtbpMethod.TIME_AND_TICK}>Time and tick (peak open commitment)</option>
                        <option value={DtbpMethod.AGGREGATE}>Aggregate trading commitment</option>
                      </select>
                    </label>
                    <label className="toggle-row">
                      <input type="checkbox" checked={draft.pdtRestricted} onChange={(event) => set("pdtRestricted", event.target.checked)} />
                      <span><strong>Active DTBP call restriction</strong><small>Use 2× rather than 4× maintenance excess.</small></span>
                    </label>
                  </div>
                )}
              </div>

              <div className="settings-section">
                <div className="settings-section-title">
                  <span>03</span>
                  <div>
                    <h3>Broker balances</h3>
                    <p>Broker-reported values produce a better reconciliation than an inferred balance.</p>
                  </div>
                </div>
                <div className="settings-grid">
                  <MoneyField label="Start-of-day equity" value={draft.startOfDayEquity} onChange={(value) => set("startOfDayEquity", value)} />
                  <MoneyField label="Maintenance requirement" value={draft.startOfDayMaintenance} onChange={(value) => set("startOfDayMaintenance", value)} />
                  <MoneyField label="Margin buying power" value={draft.brokerMarginBuyingPower} onChange={(value) => set("brokerMarginBuyingPower", value)} />
                  <MoneyField label="Day-trade buying power" value={draft.brokerDtbp} onChange={(value) => set("brokerDtbp", value)} />
                  <MoneyField label="Settled cash" value={draft.settledCash} onChange={(value) => set("settledCash", value)} />
                  <MoneyField label="Unsettled cash" value={draft.unsettledCash} onChange={(value) => set("unsettledCash", value)} />
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-title">
                  <span>04</span>
                  <div>
                    <h3>Margin assumptions</h3>
                    <p>House rules can be higher. Override a security’s requirement on the trade when needed.</p>
                  </div>
                </div>
                <div className="settings-grid four">
                  <PercentField label="Long maintenance" value={draft.longMaintenancePct} onChange={(value) => set("longMaintenancePct", value)} />
                  <PercentField label="Short maintenance" value={draft.shortMaintenancePct} onChange={(value) => set("shortMaintenancePct", value)} />
                  <PercentField label="Initial margin" value={draft.initialMarginPct} onChange={(value) => set("initialMarginPct", value)} />
                  <PercentField label="House buffer" value={draft.houseBufferPct} onChange={(value) => set("houseBufferPct", value)} />
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-title">
                  <span>05</span>
                  <div>
                    <h3>Symbol margin catalog</h3>
                    <p>{PROTOTYPE_MARGIN_SYMBOLS.length} prototype symbols. Search any ticker and replace the assumptions with your broker’s current house requirements.</p>
                  </div>
                </div>
                <div className="catalog-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    aria-label="Search margin symbols"
                    value={marginSymbol}
                    placeholder="MSTR, TSLA, AAPL…"
                    onChange={(event) => setMarginSymbol(event.target.value.toUpperCase())}
                  />
                  <span>{resolvedMargin.inPrototypeCatalog ? "Prototype catalog" : "Account default"}</span>
                </div>
                {normalizedMarginSymbol && (
                  <>
                    <div className="settings-grid four catalog-editor">
                      <div className="catalog-symbol-card">
                        <span>Selected symbol</span>
                        <strong>{normalizedMarginSymbol}</strong>
                        <small>{resolvedMargin.isCustom ? "Custom broker rule" : "Prototype assumption"}</small>
                      </div>
                      <PercentField label="Initial margin" value={resolvedMargin.initialMarginPct} onChange={(value) => updateMarginOverride("initialMarginPct", value)} />
                      <PercentField label="Long maintenance" value={resolvedMargin.longMaintenancePct} onChange={(value) => updateMarginOverride("longMaintenancePct", value)} />
                      <PercentField label="Short maintenance" value={resolvedMargin.shortMaintenancePct} onChange={(value) => updateMarginOverride("shortMaintenancePct", value)} />
                    </div>
                    <div className="catalog-actions">
                      <p>{resolvedMargin.notes ?? "Baseline rates inherit from the account assumptions above."}</p>
                      {resolvedMargin.isCustom && (
                        <button className="text-button" type="button" onClick={resetMarginOverride}>
                          <RotateCcw size={14} aria-hidden="true" />
                          Restore prototype
                        </button>
                      )}
                    </div>
                  </>
                )}
                {matchingSymbols.length > 0 && normalizedMarginSymbol !== matchingSymbols[0] && (
                  <div className="catalog-matches" aria-label="Matching prototype symbols">
                    {matchingSymbols.map((symbol) => (
                      <button type="button" key={symbol} onClick={() => setMarginSymbol(symbol)}>
                        {symbol}
                      </button>
                    ))}
                  </div>
                )}
                <div className="info-callout">
                  <Info />
                  <p>These values are planning assumptions, not a live broker feed. A trade-level override still takes precedence over both catalog and account rates.</p>
                </div>
              </div>
            </>
          ) : (
            <div className="settings-section">
              <div className="settings-section-title">
                <span>02</span>
                <div>
                  <h3>Cash balances</h3>
                  <p>Use balances immediately before the first execution in this ledger.</p>
                </div>
              </div>
              <div className="settings-grid">
                <MoneyField label="Settled cash" value={draft.settledCash} onChange={(value) => set("settledCash", value)} />
                <MoneyField label="Unsettled sale proceeds" value={draft.unsettledCash} onChange={(value) => set("unsettledCash", value)} />
                <label className="toggle-row wide">
                  <input type="checkbox" checked={draft.cashRestricted} onChange={(event) => set("cashRestricted", event.target.checked)} />
                  <span><strong>Cash-up-front restriction active</strong><small>Purchases may use settled cash only, such as during a 90-day restriction.</small></span>
                </label>
              </div>
              <div className="info-callout">
                <Info />
                <p>Most U.S. equities and options settle T+1. The calculator skips weekends and standard exchange holidays; add exceptional closures as needed.</p>
              </div>
            </div>
          )}
        </div>

        <footer className="sheet-footer">
          <button className="button ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" type="button" onClick={() => { onSave(draft); onClose(); }}>Save snapshot</button>
        </footer>
      </section>
    </div>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="money-input">
        <b>$</b>
        <input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </label>
  );
}

function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="percent-input">
        <input type="number" min="0" step="0.1" value={value * 100} onChange={(event) => onChange(Number(event.target.value) / 100)} />
        <b>%</b>
      </div>
    </label>
  );
}
