
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
    const m = mean(closes);
    const centered = closes.map(x => x - m);
    const cumDev = [];
    let currentSum = 0;
    for(let val of centered) { currentSum += val; cumDev.push(currentSum); }
    const r = Math.max(...cumDev) - Math.min(...cumDev);
    const s = stdDev(closes);
    if (s === 0 || r === 0) return 0.5;
    return Math.log(r / s) / Math.log(n);
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
  
  let regime: 'MEAN_REVERSION' | 'MOMENTUM_TREND' | 'CHOPPY/NOISE' = 'CHOPPY/NOISE';
  if (hurst > 0.55) regime = 'MOMENTUM_TREND';
  else if (Math.abs(zScore) > 1.8 && hurst < 0.48) regime = 'MEAN_REVERSION';

  const gates: LogicGate[] = [];
  gates.push({ id: 'mtf_trend', name: 'Macro Alignment', value: dailyTrend, threshold: 'Trend Follow', status: dailyTrend !== 'NEUTRAL' ? 'PASS' : 'FAIL', requiredFor: 'ENTRY' });
  gates.push({ id: 'regime', name: 'Regime Clarity', value: regime.replace('_', ' '), threshold: 'Valid Regime', status: regime !== 'CHOPPY/NOISE' ? 'PASS' : 'FAIL', requiredFor: 'ENTRY' });
  gates.push({ id: 'volatility', name: 'Volatility Filter', value: dvol.toFixed(1), threshold: '> 30', status: dvol > 30 ? 'PASS' : 'FAIL', requiredFor: 'ENTRY' });

  let direction: SignalDirection | null = null;
  const mtfPassed = gates.every(g => g.status === 'PASS');
  
  // منطق "الصياد" المحسن: إذا كان هناك توافق فريمات (MTF) نفتح الصفقة فوراً حتى بوجود Z-Score منخفض
  if (mtfPassed) {
      if (regime === 'MOMENTUM_TREND') {
          // في حال الاتجاه القوي، نتبع اتجاه الفريم اليومي
          direction = (dailyTrend === 'UP') ? SignalDirection.LONG : SignalDirection.SHORT;
      } else if (regime === 'MEAN_REVERSION') {
          // في حال الارتداد، ننتظر انحراف إحصائي
          if (zScore < -1.5) direction = SignalDirection.LONG;
          else if (zScore > 1.5) direction = SignalDirection.SHORT;
      }
  }

  const qualityScore = mtfPassed ? 85 + (hurst * 10) : 40;

  const analysis: MarketAnalysisState = {
      asset: summary.instrument_name, price, zScore, vwapDeviation: 0, rSquared: 0, dvol, hurst, rsi: 50, volRatio: 1,
      yearlyHigh: Math.max(...dailyHistory), yearlyLow: Math.min(...dailyHistory), pricePositionRank: 50, regime, 
      qualityScore, gates, 
      primaryBlocker: direction ? "TARGET ACQUIRED 🎯" : "SCANNING SECTORS 📡", 
      isCooldownActive: false, cooldownRemaining: 0, isCorrelatedBlocked: false,
      liquidityGap: 0, toxicityScore: 0, estimatedSlippage: 0, dataLatencyMs: 0, scoreBreakdown: [],
      dominantFactor: regime, reversalProbability: Math.abs(zScore) * 20, trendStrength: hurst * 100,
      trendDirection: dailyTrend, fundingRate, openInterest: summary.open_interest || 0, isNewsPaused: false,
      mtfStatus: { dailyTrend, h4Regime: regime, m15Trigger: Math.abs(zScore) > 1.5 }
  };

  if (!direction || !mtfPassed) return { signal: null, analysis };

  const volatilityFactor = (dvol / 100) * price * 0.006; 
  const tp = direction === SignalDirection.LONG ? price + volatilityFactor : price - volatilityFactor;
  const sl = direction === SignalDirection.LONG ? price - (volatilityFactor * 0.7) : price + (volatilityFactor * 0.7);

  const signal: TradingSignal = {
    id: `ARK-${asset}-${Date.now()}`, timestamp: Date.now(), asset: summary.instrument_name, direction,
    strength: SignalStrength.STRONG, entry: price, stopLoss: sl, tp1: price + (volatilityFactor * 0.3), tp2: tp, takeProfit: tp,
    qualityScore, reasoning: `MTF Aligned | ${dailyTrend} Trend | Regime: ${regime}`, gates,
    details: { 
        volumeMultiplier: 1.5, fundingRate, correlationScore: 0, zScore, volatilityPremium: dvol, 
        statisticalEdge: qualityScore, quantRegime: regime, vwap: 0, vwapDeviation: 0, hurstExponent: hurst,
        secureThreshold: 0.2, partialClosePercent: 50
    }
  };

  return { signal, analysis };
};
