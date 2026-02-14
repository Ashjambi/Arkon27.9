
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
  
  // 1. تحليل الإطار الزمني الكبير (1D) - الاتجاه المؤسسي
  const dailyHistory = candles1D?.close.slice(-100) || [];
  const dailySma50 = mean(dailyHistory.slice(-50));
  // FIX: Added condition to support NEUTRAL status to resolve type narrowing error on comparison
  const dailyTrend: 'UP' | 'DOWN' | 'NEUTRAL' = dailyHistory.length < 50 ? 'NEUTRAL' : (price > dailySma50 ? 'UP' : 'DOWN');

  // 2. تحليل الإطار الزمني المتوسط (4H/15M) - منطق النظام
  const m15Closes = candles15M?.close.slice(-60) || [];
  const hurst = calculateHurst(m15Closes);
  const zScore = calculateZScore(price, m15Closes);
  
  // 3. تحديد نوع السوق
  let regime: 'MEAN_REVERSION' | 'MOMENTUM_TREND' | 'CHOPPY/NOISE' = 'CHOPPY/NOISE';
  if (hurst > 0.58) regime = 'MOMENTUM_TREND';
  else if (Math.abs(zScore) > 2.0 && hurst < 0.50) regime = 'MEAN_REVERSION';

  // 4. بوابات المنطق متعددة الأطر (MTF Gates)
  const gates: LogicGate[] = [];
  gates.push({ id: 'mtf_trend', name: 'Macro Alignment', value: dailyTrend, threshold: 'Trend Follow', status: dailyTrend !== 'NEUTRAL' ? 'PASS' : 'FAIL', requiredFor: 'ENTRY' });
  gates.push({ id: 'regime', name: 'Regime Clarity', value: regime.replace('_', ' '), threshold: 'Trend/Reverse', status: regime !== 'CHOPPY/NOISE' ? 'PASS' : 'FAIL', requiredFor: 'ENTRY' });
  gates.push({ id: 'zscore', name: 'Hunter Trigger', value: zScore.toFixed(2), threshold: '> 2.0σ', status: Math.abs(zScore) > 1.8 ? 'PASS' : 'FAIL', requiredFor: 'ENTRY' });

  let direction: SignalDirection | null = null;
  
  // منطق "الصياد" - الدخول فقط عند توافق الفريمات
  if (regime === 'MOMENTUM_TREND' && dailyTrend === 'UP' && zScore > 1.0) direction = SignalDirection.LONG;
  else if (regime === 'MOMENTUM_TREND' && dailyTrend === 'DOWN' && zScore < -1.0) direction = SignalDirection.SHORT;
  else if (regime === 'MEAN_REVERSION') {
      if (zScore < -2.2) direction = SignalDirection.LONG;
      else if (zScore > 2.2) direction = SignalDirection.SHORT;
  }

  const mtfPassed = gates.every(g => g.status === 'PASS');
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
      mtfStatus: { dailyTrend, h4Regime: regime, m15Trigger: Math.abs(zScore) > 2 }
  };

  if (!direction || !mtfPassed) return { signal: null, analysis };

  // إعدادات القنص الخاطف (Tight TPs for Fast Rotation)
  const volatilityFactor = (dvol / 100) * price * 0.005; 
  const tp = direction === SignalDirection.LONG ? price + volatilityFactor : price - volatilityFactor;
  const sl = direction === SignalDirection.LONG ? price - (volatilityFactor * 0.8) : price + (volatilityFactor * 0.8);

  const signal: TradingSignal = {
    id: `ARK-${asset}-${Date.now()}`, timestamp: Date.now(), asset: summary.instrument_name, direction,
    strength: SignalStrength.STRONG, entry: price, stopLoss: sl, tp1: price + (volatilityFactor * 0.3), tp2: tp, takeProfit: tp,
    qualityScore, reasoning: `MTF Alignment | ${dailyTrend} Trend | ${regime}`, gates,
    details: { 
        volumeMultiplier: 1.5, fundingRate, correlationScore: 0, zScore, volatilityPremium: dvol, 
        statisticalEdge: qualityScore, quantRegime: regime, vwap: 0, vwapDeviation: 0, hurstExponent: hurst,
        secureThreshold: 0.2, partialClosePercent: 50
    }
  };

  return { signal, analysis };
};
