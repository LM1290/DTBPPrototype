import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  BookOpen,
  Check,
  Cloud,
  CloudOff,
  ExternalLink,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { TradeForm } from "./components/TradeForm";
import { calculateAccount, formatMoney } from "./services/engine";
import { cloud, isCloudConfigured } from "./services/supabase";
import { localStore } from "./services/storage";
import {
  AccountSettings,
  AccountType,
  DEFAULT_SETTINGS,
  MarginRegime,
  Trade,
} from "./types";

type View = "dashboard" | "audit" | "rules";

export default function App() {
  const [settings, setSettings] = useState<AccountSettings>(DEFAULT_SETTINGS);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [preview, setPreview] = useState<Trade | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [cloudStatus, setCloudStatus] = useState("Saved on this device");
  const [cloudReady, setCloudReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const local = await localStore.load();
        if (!active) return;
        setSettings(local.settings);
        setTrades(local.trades);

        const activeSession = await cloud.getSession();
        if (!active) return;
        setSession(activeSession);
        if (activeSession) {
          const remote = await cloud.load();
          if (remote && active) {
            setSettings({
              ...DEFAULT_SETTINGS,
              ...remote.settings,
              symbolMarginOverrides: remote.settings.symbolMarginOverrides ?? {},
            });
            setTrades(remote.trades ?? []);
            setCloudStatus("Cloud workspace loaded");
          }
          if (active) setCloudReady(true);
        }
      } catch (error) {
        setCloudStatus(error instanceof Error ? error.message : "Could not load saved data");
      } finally {
        if (active) setHydrated(true);
      }
    };
    initialize();
    const unsubscribe = cloud.onAuthChange((nextSession) => {
      setSession(nextSession);
      if (!nextSession) setCloudReady(false);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(async () => {
      try {
        await localStore.save(settings, trades);
        if (session && cloudReady) {
          setCloudStatus("Syncing…");
          await cloud.save(settings, trades);
          setCloudStatus(`Synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
        } else {
          setCloudStatus("Saved on this device");
        }
      } catch (error) {
        setCloudStatus(error instanceof Error ? error.message : "Save failed");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cloudReady, hydrated, settings, trades, session]);

  const result = useMemo(() => calculateAccount(settings, trades), [settings, trades]);
  const previewResult = useMemo(
    () => (preview ? calculateAccount(settings, [...trades, preview]) : result),
    [preview, result, settings, trades],
  );

  const handlePreview = useCallback((trade: Trade | null) => setPreview(trade), []);
  const addTrade = (trade: Trade) => {
    setTrades((current) => [...current, trade]);
    setPreview(null);
  };
  const deleteTrade = (id: string) => setTrades((current) => current.filter((trade) => trade.id !== id));

  const navItems: Array<{ id: View; label: string; icon: ReactNode }> = [
    { id: "dashboard", label: "Overview", icon: <LayoutDashboard /> },
    { id: "audit", label: "Math audit", icon: <FileClock /> },
    { id: "rules", label: "Rules & method", icon: <BookOpen /> },
  ];

  if (!hydrated) {
    return (
      <main className="loading-screen">
        <div className="brand-mark"><ShieldCheck /></div>
        <span>Rebuilding your ledger…</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView("dashboard"); }}>
          <span className="brand-mark"><ShieldCheck /></span>
          <span>
            <strong>True DTBP</strong>
            <small>Trade clearance ledger</small>
          </span>
        </a>

        <nav className={`main-nav ${mobileNavOpen ? "open" : ""}`} aria-label="Primary navigation">
          {navItems.map((item) => (
            <button className={view === item.id ? "active" : ""} type="button" key={item.id} onClick={() => { setView(item.id); setMobileNavOpen(false); }}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <button className="sync-button" type="button" onClick={() => setCloudOpen(true)}>
            {session ? <Cloud /> : <CloudOff />}
            <span>{cloudStatus}</span>
          </button>
          <button className="button secondary" type="button" onClick={() => setSettingsOpen(true)}>
            <Settings />
            <span>Opening balances</span>
          </button>
          <button className="icon-button menu-button" type="button" aria-label="Toggle navigation" onClick={() => setMobileNavOpen((value) => !value)}>
            <Menu />
          </button>
        </div>
      </header>

      <main className="main-content">
        {view === "dashboard" && (
          <>
            <div className="regime-strip">
              <div>
                <span className="live-dot" />
                <strong>
                  {settings.accountType === AccountType.CASH
                    ? "Cash · T+1 settlement"
                    : settings.marginRegime === MarginRegime.LEGACY_PDT
                      ? "Margin · legacy PDT / DTBP"
                      : "Margin · new intraday standard"}
                </strong>
              </div>
              <button type="button" onClick={() => setSettingsOpen(true)}>Change regime</button>
            </div>
            <TradeForm
              onAddTrade={addTrade}
              onPreview={handlePreview}
              previewAnalysis={previewResult.analyses.preview}
              previewIntradayBuyingPower={previewResult.intradayBuyingPower}
              settings={settings}
            />
            <Dashboard result={result} settings={settings} trades={trades} onDeleteTrade={deleteTrade} />
          </>
        )}
        {view === "audit" && <AuditView result={result} />}
        {view === "rules" && <RulesView />}
      </main>

      <footer className="site-footer">
        <p>Decision support only — not a broker statement, legal advice, or an order-entry system.</p>
        <span>Calculations run locally in your browser.</span>
      </footer>

      <SettingsPanel isOpen={settingsOpen} settings={settings} onSave={setSettings} onClose={() => setSettingsOpen(false)} />
      <CloudPanel
        isOpen={cloudOpen}
        session={session}
        onClose={() => setCloudOpen(false)}
        onSession={(nextSession) => {
          setSession(nextSession);
          setCloudReady(false);
        }}
        onLoad={async () => {
          const remote = await cloud.load();
          if (remote) {
            setSettings({
              ...DEFAULT_SETTINGS,
              ...remote.settings,
              symbolMarginOverrides: remote.settings.symbolMarginOverrides ?? {},
            });
            setTrades(remote.trades ?? []);
            setCloudStatus("Cloud workspace loaded");
          }
          setCloudReady(true);
        }}
      />
    </div>
  );
}

function AuditView({ result }: { result: ReturnType<typeof calculateAccount> }) {
  return (
    <section className="page-view">
      <div className="page-header">
        <span className="eyebrow">Explain every number</span>
        <h1>Math audit trail</h1>
        <p>Each row records the inputs and formula used by the local calculation engine. This is the fastest place to reconcile a mismatch with your broker.</p>
      </div>
      <div className="audit-summary">
        <div><span>Current equity</span><strong>{formatMoney(result.currentEquity)}</strong></div>
        <div><span>Maintenance excess / IML</span><strong>{formatMoney(result.maintenanceExcess)}</strong></div>
        <div><span>Realized P&amp;L</span><strong>{formatMoney(result.realizedPnl)}</strong></div>
        <div><span>Unrealized P&amp;L</span><strong>{formatMoney(result.unrealizedPnl)}</strong></div>
      </div>
      <div className="panel audit-panel">
        {result.auditTrail.length === 0 ? (
          <div className="empty-table">Log a trade to build the audit trail.</div>
        ) : (
          result.auditTrail.map((entry) => (
            <article className="audit-row" key={entry.id}>
              <time>{new Date(entry.timestamp).toLocaleString()}</time>
              <div><strong>{entry.label}</strong><code>{entry.formula}</code></div>
              <strong>{formatMoney(entry.result)}</strong>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function RulesView() {
  return (
    <section className="page-view rules-view">
      <div className="page-header">
        <span className="eyebrow">Source-grounded methodology</span>
        <h1>What this ledger can — and cannot — know</h1>
        <p>True DTBP is deliberately conservative. It uses your opening broker balances, execution sequence, and published minimum rules. It never pretends to know a broker’s unpublished house logic.</p>
      </div>
      <div className="rules-grid">
        <article className="rule-card featured">
          <span>2026 transition</span>
          <h2>Ask which margin regime your broker uses.</h2>
          <p>FINRA’s new intraday standard became available June 4, 2026, but firms may phase it in through October 20, 2027. During that window, two customers can correctly see different frameworks.</p>
          <a href="https://syndication.finra.org/content/understanding-new-intraday-margin-requirements" target="_blank" rel="noreferrer">
            FINRA transition overview <ExternalLink />
          </a>
        </article>
        <article className="rule-card">
          <span>PDT eliminated after migration</span>
          <h2>No trade-count designation or $25,000 floor.</h2>
          <p>Once the broker migrates an account, the PDT designation, four-in-five counting test, $25,000 minimum and legacy four-times DTBP framework no longer apply. The general margin rules remain.</p>
          <a href="https://www.sec.gov/files/rules/sro/finra/2026/34-105226.pdf" target="_blank" rel="noreferrer">
            SEC approval order <ExternalLink />
          </a>
        </article>
        <article className="rule-card">
          <span>Current capacity</span>
          <h2>Intraday buying power starts with positive IML.</h2>
          <p>IML is the cash that could be withdrawn while still meeting maintenance margin—or, when negative, the cash required to restore it. Each position uses its applicable house-maintenance rate.</p>
          <a href="https://www.sec.gov/rules-regulations/self-regulatory-organization-rulemaking/sr-finra-2025-017" target="_blank" rel="noreferrer">
            SEC approval record <ExternalLink />
          </a>
        </article>
        <article className="rule-card">
          <span>Deficit lifecycle</span>
          <h2>The largest negative IML survives a same-day recovery.</h2>
          <p>A deficit is measured after IML-reducing transactions and must be satisfied promptly. It normally expires after 15 business days; repeated late cures can trigger a 90-day freeze after the fifth-business-day checkpoint.</p>
          <a href="https://www.finra.org/sites/default/files/2025-12/SR-FINRA-2025-017.pdf" target="_blank" rel="noreferrer">
            FINRA rule filing <ExternalLink />
          </a>
        </article>
        <article className="rule-card">
          <span>Margin floors</span>
          <h2>The $2,000 leverage floor and house rates remain.</h2>
          <p>Below $2,000 equity, an account may trade without leverage but cannot borrow. Baseline maintenance is generally 25% long and 30% or a per-share floor short; firms may require more.</p>
          <a href="https://www.finra.org/rules-guidance/guidance/interps-4210" target="_blank" rel="noreferrer">
            FINRA margin interpretations <ExternalLink />
          </a>
        </article>
        <article className="rule-card">
          <span>Cash settlement</span>
          <h2>PDT removal does not remove settlement rules.</h2>
          <p>Most covered securities settle T+1. Selling a purchase funded by unsettled proceeds too early can still create a good-faith violation; never-paid purchases can create freeriding risk.</p>
          <a href="https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/new-t1-settlement-cycle-what-investors-need-know-investor-bulletin" target="_blank" rel="noreferrer">
            SEC T+1 bulletin <ExternalLink />
          </a>
        </article>
        <article className="rule-card caution">
          <span>Hard boundary</span>
          <h2>Your broker remains the source of truth.</h2>
          <p>Portfolio-margin models, option offsets, deposits, assignments, corporate actions and proprietary controls require broker data. Enter broker-reported capacity for excluded account classes and treat discrepancies as a stop signal.</p>
        </article>
      </div>
    </section>
  );
}

function CloudPanel({
  isOpen,
  session,
  onClose,
  onSession,
  onLoad,
}: {
  isOpen: boolean;
  session: Session | null;
  onClose: () => void;
  onSession: (session: Session | null) => void;
  onLoad: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "signup") {
        await cloud.signUp(email, password);
        setMessage("Check your email to confirm the account, then sign in.");
      } else {
        await cloud.signIn(email, password);
        const nextSession = await cloud.getSession();
        onSession(nextSession);
        await onLoad();
        setMessage("Cloud workspace connected.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cloud request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="cloud-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button cloud-close" type="button" onClick={onClose} aria-label="Close cloud sync"><X /></button>
        <div className="cloud-icon"><Cloud /></div>
        <span className="eyebrow">Optional backup</span>
        <h2 id="cloud-title">Supabase cloud sync</h2>
        {!isCloudConfigured ? (
          <div className="cloud-setup">
            <p>This build is safely running device-only. To enable private cloud sync:</p>
            <ol>
              <li>Run <code>supabase/schema.sql</code> in your Supabase SQL editor.</li>
              <li>Copy <code>.env.example</code> to <code>.env.local</code> and add your project URL and publishable key.</li>
              <li>Restart the app. Email sign-in will appear here.</li>
            </ol>
            <div className="config-safe"><ShieldCheck /><span>The old hardcoded project credentials have been removed.</span></div>
          </div>
        ) : session ? (
          <div className="cloud-session">
            <div className="connected-account"><Check /><div><strong>Connected</strong><span>{session.user.email}</span></div></div>
            <button className="button secondary" type="button" onClick={async () => { setBusy(true); await onLoad(); setBusy(false); }}>
              <RefreshCw className={busy ? "spin" : ""} /> Pull cloud copy
            </button>
            <button className="text-button danger-text" type="button" onClick={async () => { await cloud.signOut(); onSession(null); }}>
              <LogOut /> Sign out
            </button>
          </div>
        ) : (
          <>
            <p>Use email authentication to keep one private, RLS-protected account state across devices.</p>
            <form className="cloud-form" onSubmit={submit}>
              <label className="field"><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label className="field"><span>Password</span><input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <button className="button primary" type="submit" disabled={busy}>{busy ? "Working…" : mode === "signin" ? "Sign in & sync" : "Create account"}</button>
            </form>
            <button className="text-button centered" type="button" onClick={() => setMode((current) => current === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
            {message && <p className="form-message">{message}</p>}
          </>
        )}
      </section>
    </div>
  );
}
