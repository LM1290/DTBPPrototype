import type { AccountSettings, SymbolMarginOverride } from "../types";

/**
 * Prototype symbol coverage, not broker-authoritative margin data.
 *
 * The equity universe is the 503 positions in State Street's daily SPY holdings
 * file on 2026-07-28, plus MSTR because it is a useful high-house-margin example.
 * Unlisted symbols still resolve safely to the account defaults.
 */
const SPY_SYMBOLS = `
AAPL NVDA MSFT AMZN GOOGL AVGO GOOG META LLY JPM BRK-B MU TSLA AMD JNJ XOM V WMT ABBV CSCO MA COST BAC INTC UNH CAT GE AMAT CVX PG HD KO LRCX MRK PM GS NFLX RTX PLTR WFC PANW MS GEV TXN KLAC LIN C TMO IBM AMGN ORCL VZ PEP MCD ABT NEE CRWD AXP ADI TJX APH ANET UNP BA SCHW WELL DIS QCOM T STX GILD SNDK DE WDC BLK BKNG MRVL ETN CRM UBER PFE CVS COP PLD COF CB BMY SPGI PGR ISRG DHR MO PH VRTX LOW SYK LMT SBUX HWM NOW DELL APP MDT SO BNY MCK ADP TT VRT EQIX ACN PNC DUK ADBE USB GD BX GLW NEM MMM CDNS CSX CME FTNT MRSH MPC VLO FCX CMI WM PWR INTU ICE CMCSA WMB JCI EMR TMUS TRV MAR ELV CEG DDOG PSX AON GM SHW ROST RCL MDLZ AMT CI UPS HON ITW SPG NSC ORLY SLB EOG CL DASH SNPS HOOD HLT NOC TDG MSI CTAS MCO PCAR AEP ECL KKR ALL MNST REGN CRH FDX BSX HONA URI AJG DLR TFC NXPI TGT APD HCA ABNB WBD MPWR TEL COR D KMI O GWW NUE HPE CTVA AFL SRE F DAL BKR APO FIX LHX TRGP OKE PSA AME FAST CAH MET ROK FITB KEYS EBAY WAB NKE PYPL ETR AZO LITE STT TER XEL ADSK CIEN CARR AMP DVN EXC EW VTR COHR CVNA VST EA HUM BDX IDXX XYZ AXON RSG TTWO CBRE PRU CMG NDAQ AIG KDP MSCI FLEX GRMN YUM ODFL ED MCHP SYY IQV IBKR UAL ADM DHI A ROP PEG HIG OXY PCG PAYX KVUE WAT KMB VMC IRM COIN ACGL WEC MTB FANG CCL STLD HBAN MLM NTAP EXPE KR NTRS CCI ON WDAY ZTS EQT EXR JBL CASY EME CBOE AEE FICO CFG IR RJF EIX TPR BIIB DTE RMD VEEV TDY CNC WTW ATO XYL VICI GEHC FISV CNP DXCM LYV ES CINF OTIS MTD WSM VRSK DG DOV PPL HSY CPRT ARES AWK NRG Q RF SW PPG AVB DGX HAL TROW SYF HPQ FE LH PHM HUBB CPAY OMC VLTO CTSH WST DRI CHD KHC IP FIS EQR VRSN DLTR CMS FFIV LUV STE TPL EXPD PFG PKG WRB EFX NI ULTA FSLR SNA INCY BRO AMCR EXE EL KEY VTRS DOW JBHT GPN IFF L GIS CHRW EVRG MRNA FTV DD LNT ESS CF LEN SBAC ZBH STZ CDW BR GPC BALL KIM WY BBY NVR TSN LII IEX J MAS TSCO INVH FDXF AKAM HST NDSN SMCI BG DOC MAA EG TXT GEN LYB LDOS PTC DECK SWK RL LVS COO TYL AIZ GL ALLE GDDY TRMB ZBRA REG ALB MKC SJM IVZ AVY HAS PNW SOLV BAX LULU APTV RVTY CSGP APA CLX HII TKO CHTR ECHO PODD CRL ALGN CPT UDR FOXA ROL GNRC TECH JKHY PNR DPZ AES IT BXP FDS NWSA BEN FRT NCLH SWKS UHS MGM ARE WYNN HSIC TTD BLDR DVA HRL MOS FOX AOS TAP ERIE BF-B NWS PSKY
`.trim().split(/\s+/);

export const PROTOTYPE_MARGIN_SYMBOLS = [...SPY_SYMBOLS, "MSTR"].sort();
export const PROTOTYPE_MARGIN_SYMBOL_SET = new Set(PROTOTYPE_MARGIN_SYMBOLS);

/**
 * Illustrative house-margin examples supplied for this prototype. These are
 * intentionally not represented as current requirements at any specific broker.
 */
export const PROTOTYPE_SPECIAL_MARGIN: Record<string, SymbolMarginOverride> = {
  MSTR: {
    initialMarginPct: 0.50,
    longMaintenancePct: 0.40,
    shortMaintenancePct: 0.50,
    notes: "Prototype high-volatility example; confirm with your broker.",
  },
  TSLA: {
    initialMarginPct: 0.50,
    longMaintenancePct: 0.30,
    shortMaintenancePct: 0.40,
    notes: "Prototype high-volatility example; confirm with your broker.",
  },
};

export interface ResolvedSymbolMargin {
  symbol: string;
  inPrototypeCatalog: boolean;
  isCustom: boolean;
  initialMarginPct: number;
  longMaintenancePct: number;
  shortMaintenancePct: number;
  notes?: string;
}

export const normalizeMarginSymbol = (symbol: string) =>
  symbol.trim().toUpperCase().replace(".", "-");

export function resolveSymbolMargin(
  symbol: string,
  settings: AccountSettings,
): ResolvedSymbolMargin {
  const normalized = normalizeMarginSymbol(symbol);
  const prototype = PROTOTYPE_SPECIAL_MARGIN[normalized] ?? {};
  const custom = settings.symbolMarginOverrides?.[normalized] ?? {};

  return {
    symbol: normalized,
    inPrototypeCatalog: PROTOTYPE_MARGIN_SYMBOL_SET.has(normalized),
    isCustom: Boolean(settings.symbolMarginOverrides?.[normalized]),
    initialMarginPct: custom.initialMarginPct ?? prototype.initialMarginPct ?? settings.initialMarginPct,
    longMaintenancePct: custom.longMaintenancePct ?? prototype.longMaintenancePct ?? settings.longMaintenancePct,
    shortMaintenancePct: custom.shortMaintenancePct ?? prototype.shortMaintenancePct ?? settings.shortMaintenancePct,
    notes: custom.notes ?? prototype.notes,
  };
}
