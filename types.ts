
export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT'
}

export enum SignalStrength {
  STRONG = 'STRONG',
  MEDIUM = 'MEDIUM',
  STANDARD = 'STANDARD'
}

export type LogType = 'QUANT' | 'RISK' | 'EXEC' | 'SYSTEM' | 'INFO' | 'ERROR' | 'WHALE' | 'NEWS' | 'COOLDOWN' | 'SECURE' | 'BOOST' | 'LATENCY' | 'KELLY' | 'VWAP' | 'HUNTER' | 'PROFIT_LOCK';

export interface LogEntry {
  id: string;
  timestamp: number;
  type: LogType;
  message: string;
  details?: string | object; 
  latency?: number;
}

export interface LogicGate {
    id: string;
    name: string;
    value: string;
    threshold: string;
    status: 'PASS' | 'FAIL' | 'NEUTRAL';
    requiredFor: 'ENTRY' | 'SAFETY'; 
}

export interface EconomicEvent {
    id: string;
    name: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    timestamp: number;
    currency: string;
}

export interface MarketAnalysisState {
    asset: string;
    price: number;
    zScore: number;
    vwapDeviation: number;
    rSquared: number;
    dvol: number;
    hurst: number; 
    rsi: number;
    volRatio: number; 
    yearlyHigh: number;
    yearlyLow: number;
    pricePositionRank: number; 
    regime: 'MEAN_REVERSION' | 'MOMENTUM_TREND' | 'CHOPPY/NOISE';
    qualityScore: number;
    gates: LogicGate[];
    primaryBlocker: string;
    isCooldownActive: boolean;
    cooldownRemaining: number;
    isCorrelatedBlocked: boolean;
    liquidityGap: number;
    toxicityScore: number;
    estimatedSlippage: number;
    dataLatencyMs: number;
    scoreBreakdown: any[];
    dominantFactor: string;
    reversalProbability: number;
    trendStrength: number;
    trendDirection: 'UP' | 'DOWN' | 'NEUTRAL';
    fundingRate: number;
    openInterest: number;
    isNewsPaused: boolean;
    activeEvent?: EconomicEvent;
    mtfStatus: {
        dailyTrend: 'UP' | 'DOWN' | 'NEUTRAL';
        h4Regime: string;
        m15Trigger: boolean;
    };
}

export interface TradingSignal {
  id: string;
  timestamp: number;
  asset: string;
  direction: SignalDirection;
  strength: SignalStrength;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  tp1: number;
  tp2: number;
  qualityScore: number;
  reasoning: string;
  gates: LogicGate[];
  details: {
    volumeMultiplier: number;
    fundingRate: number;
    correlationScore: number;
    zScore: number;
    volatilityPremium: number;
    statisticalEdge: number;
    quantRegime: string;
    vwap: number;
    vwapDeviation: number;
    hurstExponent: number;
    kellyBet?: number;
    secureThreshold?: number;
    partialClosePercent?: number;
  };
}

export interface AppConfig {
  telegramBotToken: string;
  telegramChatId: string;
  webhookUrl: string;
  webhookSecret: string;
  riskRewardRatio: number;
  cooldownHours: number;
  autoExecution: boolean;
  enableTrailing: boolean;
  equityProtectionPercent: number;
  maxAllocationPerTrade: number;
  maxPyramidingLayers: number;
  secureThreshold: number;
  partialClosePercent: number;
  autoHedgeEnabled: boolean;
  trailingStepPoints: number;
  newsBypassMinutes: number;
  newsCooldownMinutes: number;
  secureHedgeTrades: boolean;
  hunterMode: boolean;
  globalProfitTargetUSD: number; 
  perTradeProfitTargetUSD: number;
  maxOpenTrades: number; // السيف لعدد الصفقات
  disableInitialSL: boolean; // تعطيل الستوب لوز الابتدائي
}

export interface DeribitBookSummary {
    instrument_name: string;
    last: number;
    funding_8h?: number;
    open_interest?: number;
    volume?: number;
    _data_age_ms?: number;
}

export interface DeribitCandleData {
    status: string;
    close: number[];
    open: number[];
    high: number[];
    low: number[];
    volume: number[];
    ticks: number[];
}

export interface DeribitOrderBook {
    bids: [number, number][];
    asks: [number, number][];
    instrument_name: string;
    timestamp: number;
}

export interface HistoricalTrade {
    id: string;
    asset: string;
    direction: SignalDirection;
    entryPrice: number;
    exitPrice: number;
    timestamp: number;
    pnlPoints: number;
    outcome: 'WIN' | 'LOSS' | 'BE';
}
