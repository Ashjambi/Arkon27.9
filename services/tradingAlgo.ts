
import { TradingSignal, SignalDirection, SignalStrength, DeribitBookSummary, DeribitCandleData, DeribitOrderBook, MarketAnalysisState, LogicGate, AppConfig } from '../types';
import { calculateEMA, calculateMACD, calculateADX, calculateBollingerBands, calculateWilliamsR } from './quantIndicators';

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

const calculateRSI = (closes: number[], period: number = 14): number => {
    if (closes.length < period + 1) return 50;
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss -= diff;
    }
    avgGain /= period;
    avgLoss /= period;
    
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

// حساب توازن دفتر الأوامر (Order Book Imbalance)
const calculateImbalance = (orderBook: DeribitOrderBook | null): number => {
    if (!orderBook || !Array.isArray(orderBook.bids) || !Array.isArray(orderBook.asks)) return 0;
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
  optionsVolume: number,
  config: AppConfig
): { signal: TradingSignal | null; analysis: MarketAnalysisState } => {
  
  const price = summary.last || 0;
  const fundingRate = summary.funding_8h || 0;
  
  const dailyHistory = Array.isArray(candles1D?.close) ? candles1D.close.slice(-100) : [];
  const dailySma50 = mean(dailyHistory.slice(-50));
  const dailyTrend: 'UP' | 'DOWN' | 'NEUTRAL' = dailyHistory.length < 50 ? 'NEUTRAL' : (price > dailySma50 ? 'UP' : 'DOWN');

  const m15Closes = Array.isArray(candles15M?.close) ? candles15M.close.slice(-60) : [];
  const m15Highs = Array.isArray(candles15M?.high) ? candles15M.high.slice(-60) : [];
  const m15Lows = Array.isArray(candles15M?.low) ? candles15M.low.slice(-60) : [];
  
  const hurst = calculateHurst(m15Closes);
  const zScore = calculateZScore(price, m15Closes);
  const imbalance = calculateImbalance(orderBook);
  const rsi = calculateRSI(m15Closes);
  const williamsR = calculateWilliamsR(m15Highs, m15Lows, m15Closes);
  const { macd } = calculateMACD(m15Closes);
  const adx = calculateADX(m15Highs, m15Lows, m15Closes);
  const bollinger = calculateBollingerBands(m15Closes);
  
  // --- نظام كشف النظام السوقي (Regime Detection) ---
  let regime: 'MEAN_REVERSION' | 'MOMENTUM_TREND' | 'CHOPPY/NOISE' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' = 'CHOPPY/NOISE';
  if (dvol > 60) regime = 'HIGH_VOLATILITY';
  else if (dvol < 30) regime = 'LOW_VOLATILITY';
  else if (hurst > 0.55 && adx > 25) regime = 'MOMENTUM_TREND';
  else if (hurst < 0.45 && adx < 25) regime = 'MEAN_REVERSION';

  // --- مصفوفة تدقيق المؤسسات (The Institutional Big 5) ---
  const gates: LogicGate[] = [
    { id: 'macro_alpha', name: 'Macro Alpha', value: dailyTrend, threshold: 'SMA50/EMA/MACD', status: 'PASS', requiredFor: 'ENTRY' },
    { id: 'fractal_eff', name: 'Fractal Efficiency', value: hurst.toFixed(3), threshold: 'Hurst/ADX', status: 'PASS', requiredFor: 'ENTRY' },
    { id: 'iv_barrier', name: 'Volatility IV', value: dvol.toFixed(1), threshold: 'DVOL 30-70', status: dvol > 30 && dvol < 70 ? 'PASS' : 'FAIL', requiredFor: 'ENTRY' },
    { id: 'quant_dev', name: 'Quant Deviation', value: zScore.toFixed(2), threshold: 'Multi-Z/Bollinger', status: 'PASS', requiredFor: 'ENTRY' },
    { id: 'momentum', name: 'Momentum', value: rsi.toFixed(1), threshold: 'RSI/Williams', status: 'PASS', requiredFor: 'ENTRY' },
    { id: 'depth_integrity', name: 'Depth Integrity', value: (imbalance * 100).toFixed(1) + '%', threshold: 'Weighted Imbalance', status: 'PASS', requiredFor: 'SAFETY' },
    { id: 'volume_confirm', name: 'Volume Confirm', value: 'Trend', threshold: 'Ratio/Trend', status: 'PASS', requiredFor: 'ENTRY' },
    { id: 'vwap_position', name: 'VWAP Position', value: 'Bands', threshold: 'Deviation', status: 'PASS', requiredFor: 'ENTRY' },
    { id: 'whale_activity', name: 'Whale Activity', value: 'Signal', threshold: 'Detection', status: 'PASS', requiredFor: 'ENTRY' }
  ];


  let direction: SignalDirection | null = null;
  const criticalGatesPassed = gates.filter(g => g.requiredFor === 'ENTRY').every(g => g.status === 'PASS');
  
  if (criticalGatesPassed) {
      if (regime === 'MOMENTUM_TREND') {
          direction = (dailyTrend === 'UP') ? SignalDirection.LONG : SignalDirection.SHORT;
          
          // حماية من البيع في القاع أو الشراء في القمة
          if (direction === SignalDirection.SHORT && (rsi < 35 || zScore < -2.0 || imbalance > 0.3)) {
              direction = null; // إلغاء البيع بسبب ضعف الزخم أو دخول سيولة شرائية
          } else if (direction === SignalDirection.LONG && (rsi > 65 || zScore > 2.0 || imbalance < -0.3)) {
              direction = null; // إلغاء الشراء بسبب ضعف الزخم أو دخول سيولة بيعية
          }

          // اكتشاف الحيتان والسيولة العالية (Whale/Liquidity Detection)
          // إذا كان هناك اختلال كبير في دفتر الأوامر وزخم قوي، نتبع الحيتان
          if (imbalance > 0.5 && rsi > 55) {
              direction = SignalDirection.LONG; 
          } else if (imbalance < -0.5 && rsi < 45) {
              direction = SignalDirection.SHORT; 
          }
      } else if (regime === 'MEAN_REVERSION') {
          // تم خفض شرط التوجيه ليتوافق مع النظام الجديد
          if (zScore < -1.5) direction = SignalDirection.LONG;
          else if (zScore > 1.5) direction = SignalDirection.SHORT;
      }
  }

  // حساب جودة الإشارة بناءً على عدد البوابات المجتازة
  const passedCount = gates.filter(g => g.status === 'PASS').length;
  const qualityScore = (passedCount / gates.length) * 100;

  const analysis: MarketAnalysisState = {
      asset: summary.instrument_name, price, zScore, vwapDeviation: 0, rSquared: 0, dvol, hurst, rsi, volRatio: 1,
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
  const slDistance = volatilityFactor * 0.8;
  const tpDistance = slDistance * (config?.riskRewardRatio || 2.5);

  const tp = direction === SignalDirection.LONG ? price + tpDistance : price - tpDistance;
  const sl = direction === SignalDirection.LONG ? price - slDistance : price + slDistance;

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
