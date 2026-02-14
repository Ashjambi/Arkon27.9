
import { TradingSignal, SignalDirection, SignalStrength, DeribitBookSummary, DeribitCandleData, DeribitOrderBook, MarketAnalysisState, LogicGate } from '../types';

const mean = (data: number[]) => data.length === 0 ? 0 : data.reduce((a, b) => a + b, 0) / data.length;
const stdDev = (data: number[]) => {
    if (data.length === 0) return 0;
    const m = mean(data);
    const variance = data.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / data.length;
    return Math.sqrt(variance);
};

const calculateZScore = (current: number, history: number[]) => {
    const sd = stdDev(history);
    return sd < (current * 0.0001) ? 0 : (current - mean(history)) / sd;
};

const calculateHurst = (closes: number[]): number => {
    const n = closes.length;
    if (n < 40) return 0.5;
    
    // Simplified R/S Analysis for Hurst Exponent
    const logReturns = [];
    for (let i = 1; i < closes.length; i++) {
        logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
    
    const m = mean(logReturns);
    const centered = logReturns.map(x => x - m);
    const cumDev = [];
    let currentSum = 0;
    for(let val of centered) { 
        currentSum += val; 
        cumDev.push(currentSum); 
    }
    
    const r = Math.max(...cumDev) - Math.min(...cumDev);
    const s = stdDev(logReturns);
    
    if (s === 0 || r === 0) return 0.5;
    return Math.log(r / s) / Math.log(n);
};

// حساب توازن دفتر الأوامر (Order Book Imbalance)
const calculateImbalance = (orderBook: DeribitOrderBook | null): number => {
    if (!orderBook) return 0;
    const totalBids = orderBook.bids.reduce((acc, b) => acc + b[1], 0);
    const totalAsks = orderBook.asks.reduce((acc, a) => acc + a[1], 0);
    if (totalBids + totalAsks === 0) return 0;
    return (totalBids - totalAsks) / (totalBids + totalAsks);
};

export const generateSignal = (
  asset: 'BTC' | 'ETH',
  summary: DeribitBookSummary,
  allSummaries: DeribitBookSummary[],
  candles15M: DeribitCandleData | null, 
  candles1D: DeribitCandleData | null, 
  orderBook: DeribitOrderBook | null, 
  dvol: number, 
  optionsVolume: number 
): { signal: TradingSignal | null; analysis: MarketAnalysisState } => {
  
  const price = summary.last || 0;
  const fundingRate = summary.funding_8h || 0;
  
  const dailyHistory = candles1D?.close.slice(-100) || [];
  const dailySma50 = mean(dailyHistory.slice(-50));
  const dailyTrend: 'UP' | 'DOWN' | 'NEUTRAL' = dailyHistory.length < 50 ? 'NEUTRAL' : (price > dailySma50 ? 'UP' : 'DOWN');

  const m15Closes = candles15M?.close.slice(-60) || [];
  const hurst = calculateHurst(m15Closes);
  const zScore = calculateZScore(price, m15Closes);
  const imbalance = calculateImbalance(orderBook);
  
  let regime: 'MEAN_REVERSION' | 'MOMENTUM_TREND' | 'CHOPPY/NOISE' = 'CHOPPY/NOISE';
  if (hurst > 0.55) regime = 'MOMENTUM_TREND';
  else if (Math.abs(zScore) > 1.8 && hurst < 0.48) regime = 'MEAN_REVERSION';

  // --- مصفوفة تدقيق المؤسسات (The Institutional Big 5) ---
  const gates: LogicGate[] = [
    { 
        id: 'macro_alpha', 
        name: 'Macro Alpha', 
        value: dailyTrend, 
        threshold: 'SMA50 Confirmed', 
        status: dailyTrend !== 'NEUTRAL' ? 'PASS' : 'FAIL', 
        requiredFor: 'ENTRY' 
    },
    { 
        id: 'fractal_eff', 
        name: 'Fractal Efficiency', 
        value: hurst.toFixed(3), 
        threshold: 'Hurst > 0.52', 
        status: hurst > 0.52 ? 'PASS' : 'FAIL', 
        requiredFor: 'ENTRY' 
    },
    { 
        id: 'iv_barrier', 
        name: 'Volatility IV', 
        value: dvol.toFixed(1), 
        threshold: 'DVOL > 30', 
        status: dvol > 30 ? 'PASS' : 'FAIL', 
        requiredFor: 'ENTRY' 
    },
    { 
        id: 'quant_dev', 
        name: 'Quant Deviation', 
        value: zScore.toFixed(2), 
        threshold: '|Z| > 1.2', 
        status: Math.abs(zScore) > 1.2 ? 'PASS' : 'FAIL', 
        requiredFor: 'ENTRY' 
    },
    { 
        id: 'depth_integrity', 
        name: 'Depth Integrity', 
        value: (imbalance * 100).toFixed(1) + '%', 
        threshold: 'Imbalance < 40%', 
        status: Math.abs(imbalance) < 0.4 ? 'PASS' : 'FAIL', 
        requiredFor: 'SAFETY' 
    }
  ];

  let direction: SignalDirection | null = null;
  const criticalGatesPassed = gates.filter(g => g.requiredFor === 'ENTRY').every(g => g.status === 'PASS');
  
  if (criticalGatesPassed) {
      if (regime === 'MOMENTUM_TREND') {
          direction = (dailyTrend === 'UP') ? SignalDirection.LONG : SignalDirection.SHORT;
      } else if (regime === 'MEAN_REVERSION') {
          if (zScore < -1.8) direction = SignalDirection.LONG;
          else if (zScore > 1.8) direction = SignalDirection.SHORT;
      }
  }

  // حساب جودة الإشارة بناءً على عدد البوابات المجتازة
  const passedCount = gates.filter(g => g.status === 'PASS').length;
  const qualityScore = (passedCount / gates.length) * 100;

  const analysis: MarketAnalysisState = {
      asset: summary.instrument_name, price, zScore, vwapDeviation: 0, rSquared: 0, dvol, hurst, rsi: 50, volRatio: 1,
      yearlyHigh: Math.max(...dailyHistory, price), yearlyLow: Math.min(...dailyHistory, price), pricePositionRank: 50, regime, 
      qualityScore, gates, 
      primaryBlocker: direction ? "ALPHA LOCKED 🎯" : "AUDITING SECTORS 📡", 
      isCooldownActive: false, cooldownRemaining: 0, isCorrelatedBlocked: false,
      liquidityGap: imbalance, toxicityScore: 0, estimatedSlippage: 0, dataLatencyMs: 0, scoreBreakdown: [],
      dominantFactor: regime, reversalProbability: Math.abs(zScore) * 20, trendStrength: hurst * 100,
      trendDirection: dailyTrend, fundingRate, openInterest: summary.open_interest || 0, isNewsPaused: false,
      mtfStatus: { dailyTrend, h4Regime: regime, m15Trigger: Math.abs(zScore) > 1.5 }
  };

  if (!direction || qualityScore < 70) return { signal: null, analysis };

  const volatilityFactor = (dvol / 100) * price * 0.008; 
  const tp = direction === SignalDirection.LONG ? price + volatilityFactor : price - volatilityFactor;
  const sl = direction === SignalDirection.LONG ? price - (volatilityFactor * 0.8) : price + (volatilityFactor * 0.8);

  const signal: TradingSignal = {
    id: `ARK-${asset}-${Date.now()}`, timestamp: Date.now(), asset: summary.instrument_name, direction,
    strength: SignalStrength.STRONG, entry: price, stopLoss: sl, tp1: price + (volatilityFactor * 0.4), tp2: tp, takeProfit: tp,
    qualityScore, reasoning: `Institutional Audit Passed (${passedCount}/5 Gates). Regime: ${regime}`, gates,
    details: { 
        volumeMultiplier: 1.5, fundingRate, correlationScore: imbalance, zScore, volatilityPremium: dvol, 
        statisticalEdge: qualityScore, quantRegime: regime, vwap: imbalance, vwapDeviation: 0, hurstExponent: hurst
    }
  };

  return { signal, analysis };
};
