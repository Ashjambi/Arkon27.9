
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMarketSummary, fetchCandles, fetchDVOL, fetchOptionsVolume, fetchOrderBook, fetchHistoricalContext } from './services/deribitService';
import { generateSignal } from './services/tradingAlgo';
import { sendToWebhook, checkBridgeStatus, fetchBridgeState, clearRemoteBridge } from './services/webhookService';
import { sendTestMessage, sendSignalToTelegram } from './services/telegramService';
import { getIncomingHighImpactEvents, checkNewsImpactStatus, NewsStatus } from './services/newsService';
import { TradingSignal, AppConfig, LogEntry, LogType, MarketAnalysisState, EconomicEvent, SignalDirection, SignalStrength } from './types';
import { MQL5_CODE, BRIDGE_CODE } from './utils/mqlCode';
import MarketStats from './components/MarketStats';
import TradeLog from './components/TradeLog';
import SignalCard from './components/SignalCard';
import NewsRadar from './components/NewsRadar';
import HistoryTable from './components/HistoryTable';

const CURRENT_VERSION = '45.5.0-TURBO-EXEC'; 

const DEFAULT_CONFIG: AppConfig = {
  telegramBotToken: '',
  telegramChatId: '',
  enableTelegramAlerts: true,
  webhookUrl: 'http://127.0.0.1:3000',
  webhookSecret: 'ARKON_SECURE_2025',
  bridgeLatencyThreshold: 500,
  autoExecution: true,
  hunterMode: true,
  minSignalScore: 74, // تم الخفض من 78 لتسريع الدخول
  cooldownHours: 1,
  cooldownSameAssetMins: 30,
  riskRewardRatio: 2.5,
  maxOpenTrades: 4,
  maxAllocationPerTradePercent: 1.0,
  fixedLotSize: 0.01,
  equityProtectionPercent: 10.0,
  dailyLossLimitUSD: 250,
  maxDrawdownDailyPercent: 3.5,
  secureThresholdUSD: 50.0,
  breakevenOffsetPoints: 10,
  partialClosePercent: 50.0,
  enableTrailing: true,
  trailingStartPoints: 120,
  trailingStepPoints: 40,
  autoHedgeEnabled: true,
  hedgeRatio: 0.5,
  flipEnabled: true,
  flipSensitivityScore: 85,
  newsBypassMinutes: 45,
  newsCooldownMinutes: 90,
  blockOnMediumImpact: false,
  disableInitialSL: true, 
  useVirtualSL: false
};

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(() => {
    try {
        const saved = localStorage.getItem(`arkon_config_v${CURRENT_VERSION}`);
        return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
    } catch (e) {
        return DEFAULT_CONFIG;
    }
  });

  const [managedTrades, setManagedTrades] = useState<any[]>([]); 
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
      { id: 'start', timestamp: Date.now(), type: 'SYSTEM', message: `ARKON v${CURRENT_VERSION} [TURBO MODE] ACTIVE.` }
  ]);
  const [btcAnalysis, setBtcAnalysis] = useState<MarketAnalysisState | null>(null);
  const [ethAnalysis, setEthAnalysis] = useState<MarketAnalysisState | null>(null);
  const [newsEvents, setNewsEvents] = useState<EconomicEvent[]>([]);
  const [newsGuard, setNewsGuard] = useState<NewsStatus>({isPaused: false, reason: 'NORMAL', remainingMs: 0});
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'HISTORY'>('DASHBOARD');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'ENGINE' | 'RISK' | 'SAFETY' | 'CHASE' | 'STRATEGY' | 'NEWS' | 'RELAY' | 'SYSTEM' | 'MQL5' | 'BRIDGE'>('ENGINE');
  const [bridgeStatus, setBridgeStatus] = useState<boolean | null>(null);
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const sendingRef = useRef<Record<string, boolean>>({});
  const sentSignalsRef = useRef<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const addLog = useCallback((message: string, type: LogType = 'INFO', details?: string | object) => {
      setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), type, message, details }, ...prev].slice(200)); 
  }, []);

  useEffect(() => {
    localStorage.setItem(`arkon_config_v${CURRENT_VERSION}`, JSON.stringify(config));
  }, [config]);

  const handleSendSignal = useCallback(async (originalSignal: any, actionType: any = 'ENTRY'): Promise<boolean> => {
    if (!bridgeStatus && actionType !== 'TELEGRAM') {
      addLog(`فشل: الجسر غير متصل`, 'ERROR');
      return false;
    }
    
    // Auto-map action based on live state if not overridden
    if (actionType === 'ENTRY') {
        const assetPure = originalSignal?.asset?.split('-')[0] || '';
        const assetTrades = managedTrades.filter(t => t?.asset?.includes(assetPure));
        const hasOppositeTrade = assetTrades.some(t => t.direction !== originalSignal.direction);
        
        if (hasOppositeTrade) {
            actionType = config.autoHedgeEnabled ? 'HEDGE' : (config.flipEnabled ? 'FLIP' : 'ENTRY');
            if (actionType !== 'ENTRY') {
                addLog(`🔄 mapping strategy: ${actionType} triggered by opposite exposure`, 'QUANT');
            }
        } else if (assetTrades.length > 0) {
            if (assetTrades.length < config.maxOpenTrades) {
                actionType = 'ENTRY';
            } else {
                addLog(`⛔ Layer Block: Max capacity for ${assetPure}`, 'RISK');
                return false;
            }
        }
    }

    if (actionType === 'ENTRY' && managedTrades.length >= config.maxOpenTrades) {
        addLog(`تم بلوغ الحد الأقصى للصفقات المسموح به (${config.maxOpenTrades})`, 'RISK');
        return false;
    }

    // Risk Management: Equity Protection
    if (actionType === 'ENTRY') {
        const currentTotalLots = managedTrades.length * config.fixedLotSize;
        if (currentTotalLots + config.fixedLotSize > config.equityProtectionPercent) {
            addLog(`⛔ Risk Block: Equity Protection Limit Reached`, 'RISK');
            return false;
        }
    }

    const reqId = (originalSignal.id || originalSignal.signalId || Math.random()) + actionType;
    if (sendingRef.current[reqId]) return false;
    sendingRef.current[reqId] = true;

    // استنساخ عميق للإشارة لضمان عدم تعديل الأصل في الذاكرة
    const signalToSend = { ...originalSignal };
    
    // فرض تصفير الوقف إذا كان الهيدج أو خيار تعطيل الستوب مفعلاً
    if (actionType === 'ENTRY' && (config.autoHedgeEnabled || config.disableInitialSL)) {
        signalToSend.stopLoss = 0;
        signalToSend.sl = 0; // تصفير كلا الحقلين لضمان عدم الالتباس
        addLog(`🛡️ نظام الهيدج نِشط: تم مسح الستوب لوز من أمر التنفيذ`, 'HEDGE');
    }

    try {
        const result = await sendToWebhook(signalToSend, config.webhookUrl, config.maxAllocationPerTradePercent, actionType, config.fixedLotSize, config.webhookSecret, config.partialClosePercent);
        if (result.success) {
            addLog(`🚀 تم تنفيذ: ${actionType} لـ ${signalToSend.asset || 'System'}`, 'EXEC');
            if (config.enableTelegramAlerts && config.telegramBotToken) {
                sendSignalToTelegram(signalToSend, config.telegramChatId, config.telegramBotToken, actionType, "", config.webhookUrl).catch(() => {});
            }
            if (actionType === 'ENTRY') sentSignalsRef.current.add(signalToSend.id);
            return true;
        }
    } catch (err) { addLog(`خطأ في الوصول للجسر`, 'ERROR'); } 
    finally { sendingRef.current[reqId] = false; }
    return false;
  }, [config, bridgeStatus, addLog, managedTrades.length]);

  const updateMarketData = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const isOnline = await checkBridgeStatus(config.webhookUrl);
      setBridgeStatus(isOnline);
      const bridgeState = await fetchBridgeState(config.webhookUrl);
      let dailyLossReached = false;
      if (bridgeState) {
          if (bridgeState.positions) setManagedTrades(Array.isArray(bridgeState.positions) ? bridgeState.positions : []);
          if (bridgeState.history) {
              const history = Array.isArray(bridgeState.history) ? bridgeState.history : [];
              setTradeHistory(history);
              const today = new Date().setHours(0, 0, 0, 0);
              const dailyPnL = history
                  .filter((t: any) => t.timestamp >= today)
                  .reduce((acc: number, t: any) => acc + (t.pnlPoints || 0), 0);
              
              if (config.dailyLossLimitUSD > 0 && dailyPnL <= -config.dailyLossLimitUSD) {
                  dailyLossReached = true;
                  if (!sendingRef.current['DAILY_LOSS_LOG']) {
                      addLog(`🛑 تم إيقاف التداول: تم الوصول للحد الأقصى للخسارة اليومية ($${Math.abs(dailyPnL).toFixed(2)})`, 'RISK');
                      sendingRef.current['DAILY_LOSS_LOG'] = true;
                  }
              } else if (config.maxDrawdownDailyPercent > 0 && bridgeState.balance && bridgeState.balance > 0) {
                  const drawdownPercent = (Math.abs(dailyPnL) / bridgeState.balance) * 100;
                  if (dailyPnL < 0 && drawdownPercent >= config.maxDrawdownDailyPercent) {
                      dailyLossReached = true;
                      if (!sendingRef.current['DAILY_LOSS_LOG']) {
                          addLog(`🛑 تم إيقاف التداول: تم الوصول للحد الأقصى للتراجع اليومي (${drawdownPercent.toFixed(2)}%)`, 'RISK');
                          sendingRef.current['DAILY_LOSS_LOG'] = true;
                      }
                  } else {
                      sendingRef.current['DAILY_LOSS_LOG'] = false;
                  }
              } else {
                  sendingRef.current['DAILY_LOSS_LOG'] = false;
              }
          }
      }
      
      const events = await getIncomingHighImpactEvents(config.blockOnMediumImpact);
      setNewsEvents(events);
      const guardResult = checkNewsImpactStatus(events, config.newsBypassMinutes, config.newsCooldownMinutes);
      setNewsGuard(guardResult);
      
      const processAsset = async (asset: 'BTC' | 'ETH') => {
        try {
            const summaries = await fetchMarketSummary(asset);
            const perp = summaries.find(s => s?.instrument_name?.includes('PERPETUAL'));
            if (perp) {
                const assetName = perp.instrument_name;
                
                // Check SECURE logic against real managed trades from bridge
                managedTrades.forEach(trade => {
                   const tradeAsset = trade?.asset?.includes(asset) ? assetName : null;
                   
                   if (tradeAsset && trade.pnl && trade.pnl >= config.secureThresholdUSD) {
                       const secureId = `SECURE-${trade.ticket}-${Math.floor(Date.now() / 60000)}`; 
                       if(!sentSignalsRef.current.has(secureId)) {
                           const tempSignal: TradingSignal = {
                               id: secureId, asset: tradeAsset, direction: trade.direction, entry: trade.entryPrice, 
                               tp1: 0, tp2: 0, takeProfit: trade.tp, stopLoss: trade.sl, 
                               strength: SignalStrength.STANDARD, qualityScore: 100, reasoning: "SECURE_AUTO", gates: [], details: {} as any, timestamp: Date.now()
                           };
                           handleSendSignal(tempSignal, 'SECURE');
                           addLog(`🛡️ تأمين: ${tradeAsset} (PnL: $${trade.pnl.toFixed(2)})`, 'SECURE');
                       }
                   }
                });

                const [dvol, optVol, candles, orderBook, dailyCandles] = await Promise.all([
                  fetchDVOL(asset), fetchOptionsVolume(asset), fetchCandles(perp.instrument_name, '15'), 
                  fetchOrderBook(perp.instrument_name), fetchHistoricalContext(perp.instrument_name)
                ]);
                const { signal, analysis } = generateSignal(asset, perp, summaries, candles, dailyCandles, orderBook, dvol, optVol, config);
                const enrichedAnalysis = { ...analysis, isNewsPaused: guardResult.isPaused || dailyLossReached, activeEvent: guardResult.event };
                if (asset === 'BTC') setBtcAnalysis(enrichedAnalysis); 
                else setEthAnalysis(enrichedAnalysis);
                
                if (signal && !sentSignalsRef.current.has(signal.id)) {
                    setSignals(prev => [signal, ...prev].slice(0, 50));
                    if (config.autoExecution && !guardResult.isPaused && !dailyLossReached) {
                        if (!config.hunterMode || signal.qualityScore >= config.minSignalScore) {
                            handleSendSignal(signal);
                        }
                    }
                }
            }
        } catch (e) {}
      };
      await processAsset('BTC');
      await processAsset('ETH');
    } finally { setIsProcessing(false); }
  }, [config, isProcessing, handleSendSignal]);

  useEffect(() => {
    const interval = setInterval(updateMarketData, 5000); 
    return () => clearInterval(interval);
  }, [updateMarketData]);

  const totalPnL = managedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);

  return (
    <div className="min-h-screen pb-12 px-6 pt-8 max-w-[1920px] mx-auto space-y-6 text-right font-sans bg-[#050507]" dir="rtl">
      
      {/* Dynamic Settings Command Center */}
      {isSettingsOpen && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-6 bg-black/98 backdrop-blur-3xl">
             <div className="glass-card w-full max-w-7xl rounded-[3rem] border-zinc-800 p-0 shadow-[0_0_100px_rgba(0,0,0,0.5)] flex h-[85vh] overflow-hidden">
                {/* Modal Navigation Sidebar */}
                <div className="w-80 bg-zinc-950/50 border-l border-zinc-900 p-10 flex flex-col gap-2 overflow-y-auto custom-scrollbar">
                    <div className="mb-10 text-center">
                        <div className="w-20 h-20 bg-amber-500 rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-amber-500/20 mb-6">
                            <i className="fas fa-terminal text-black text-3xl"></i>
                        </div>
                        <h3 className="text-white font-black text-xl italic uppercase tracking-tighter">Command Node</h3>
                        <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">v{CURRENT_VERSION}</p>
                    </div>
                    {[
                        {id: 'ENGINE', label: 'محرك التنفيذ', icon: 'bolt'},
                        {id: 'RISK', label: 'إدارة المخاطر', icon: 'shield-halved'},
                        {id: 'SAFETY', label: 'تأمين الأرباح', icon: 'lock'},
                        {id: 'CHASE', label: 'ملاحقة الربح', icon: 'arrow-trend-up'},
                        {id: 'STRATEGY', label: 'الهيدج والانعكاس', icon: 'shuffle'},
                        {id: 'NEWS', label: 'فلتر الأخبار', icon: 'newspaper'},
                        {id: 'RELAY', label: 'التليجرام', icon: 'paper-plane'},
                        {id: 'SYSTEM', label: 'الجسر والأمان', icon: 'link'},
                        {id: 'MQL5', label: 'كود MT5', icon: 'code'},
                        {id: 'BRIDGE', label: 'كود الجسر', icon: 'server'}
                    ].map(tab => (
                        <button 
                            key={tab.id} 
                            onClick={() => setSettingsTab(tab.id as any)}
                            className={`flex items-center gap-5 px-6 py-5 rounded-2xl text-[11px] font-black transition-all ${settingsTab === tab.id ? 'bg-white text-black translate-x-[-10px]' : 'text-zinc-500 hover:bg-white/5'}`}
                        >
                            <i className={`fas fa-${tab.icon} text-lg w-6`}></i> {tab.label}
                        </button>
                    ))}
                    <div className="mt-auto pt-10 border-t border-zinc-900">
                        <button onClick={() => {if(window.confirm('إعادة ضبط كافة البروتوكولات؟')) setConfig(DEFAULT_CONFIG)}} className="w-full text-rose-500 text-[10px] font-black uppercase tracking-widest hover:text-rose-400 transition-all flex items-center justify-center gap-3">
                            <i className="fas fa-undo-alt"></i> استعادة الإعدادات الأصلية
                        </button>
                    </div>
                </div>

                {/* Modal Viewport */}
                <div className="flex-1 p-20 overflow-y-auto custom-scrollbar relative bg-zinc-950/20">
                    <button onClick={() => setIsSettingsOpen(false)} className="absolute top-10 left-10 w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all z-10 shadow-2xl">
                        <i className="fas fa-times text-2xl"></i>
                    </button>
                    
                    <div className="max-w-4xl space-y-16 animate-in slide-in-from-left duration-500">
                        
                        {/* 1. EXECUTION ENGINE */}
                        {settingsTab === 'ENGINE' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">محرك التنفيذ (Execution)</h2>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-amber-500/30 transition-all">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">التنفيذ الآلي (Auto-Trade)</label>
                                            <p className="text-[10px] text-zinc-500">بدء العمليات فور صدور الإشارة</p>
                                        </div>
                                        <input type="checkbox" checked={config.autoExecution} onChange={(e)=>setConfig({...config, autoExecution: e.target.checked})} className="w-8 h-8 accent-amber-500 cursor-pointer" />
                                    </div>
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-amber-500/30 transition-all">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">وضع الصياد (Hunter Mode)</label>
                                            <p className="text-[10px] text-zinc-500">تجاهل الإشارات الضعيفة والمتوسطة</p>
                                        </div>
                                        <input type="checkbox" checked={config.hunterMode} onChange={(e)=>setConfig({...config, hunterMode: e.target.checked})} className="w-8 h-8 accent-amber-500 cursor-pointer" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">أدنى تقييم للجودة (Quality %)</label>
                                        <input type="number" value={config.minSignalScore} onChange={(e)=>setConfig({...config, minSignalScore: parseInt(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-amber-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">ساعات التبريد العامة (Cooldown)</label>
                                        <input type="number" step="0.5" value={config.cooldownHours} onChange={(e)=>setConfig({...config, cooldownHours: parseFloat(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-amber-500/50 outline-none transition-all" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 2. RISK MANAGEMENT */}
                        {settingsTab === 'RISK' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">إدارة المخاطر (Risk)</h2>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">مخاطرة المحفظة لكل صفقة (%)</label>
                                        <input type="number" step="0.1" value={config.maxAllocationPerTradePercent} onChange={(e)=>setConfig({...config, maxAllocationPerTradePercent: parseFloat(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-blue-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">أقصى عدد صفقات متزامنة</label>
                                        <input type="number" value={config.maxOpenTrades} onChange={(e)=>setConfig({...config, maxOpenTrades: parseInt(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-blue-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">حد الخسارة اليومي القصوى ($ USD)</label>
                                        <input type="number" value={config.dailyLossLimitUSD} onChange={(e)=>setConfig({...config, dailyLossLimitUSD: parseFloat(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-rose-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">حماية رأس المال (Equity Shield %)</label>
                                        <input type="number" value={config.equityProtectionPercent} onChange={(e)=>setConfig({...config, equityProtectionPercent: parseFloat(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-rose-500/50 outline-none transition-all" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 3. SAFETY & PARTIALS */}
                        {settingsTab === 'SAFETY' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">تأمين الأرباح (Profit Defense)</h2>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">تأمين الدخول عند ربح ($ USD)</label>
                                        <input type="number" value={config.secureThresholdUSD} onChange={(e)=>setConfig({...config, secureThresholdUSD: parseFloat(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-emerald-500/50 outline-none transition-all" />
                                        <p className="text-[10px] text-zinc-600 font-bold">سيتم نقل SL إلى نقطة الدخول فوراً عند بلوغ هذا الربح.</p>
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">نسبة الإغلاق الجزئي عند التأمين (%)</label>
                                        <input type="number" value={config.partialClosePercent} onChange={(e)=>setConfig({...config, partialClosePercent: parseFloat(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-emerald-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-emerald-500/30 transition-all col-span-2">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">الوقف التخيلي (Virtual Stop Loss)</label>
                                            <p className="text-[10px] text-zinc-500">إخفاء مستويات الوقف عن مزودي السيولة لتجنب "صيد الستوب"</p>
                                        </div>
                                        <input type="checkbox" checked={config.useVirtualSL} onChange={(e)=>setConfig({...config, useVirtualSL: e.target.checked})} className="w-8 h-8 accent-emerald-500 cursor-pointer" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 4. TRAILING CHASE */}
                        {settingsTab === 'CHASE' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">ملاحقة الربح (Trailing)</h2>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-amber-500/30 transition-all col-span-2">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">تفعيل الـ Trailing Stop</label>
                                            <p className="text-[10px] text-zinc-500">تحريك الوقف للأعلى تلقائياً مع تحرك السعر لزيادة الأرباح</p>
                                        </div>
                                        <input type="checkbox" checked={config.enableTrailing} onChange={(e)=>setConfig({...config, enableTrailing: e.target.checked})} className="w-8 h-8 accent-amber-500 cursor-pointer" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">نقطة انطلاق الملاحقة (Points)</label>
                                        <input type="number" value={config.trailingStartPoints} onChange={(e)=>setConfig({...config, trailingStartPoints: parseInt(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-amber-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">خطوة التحديث (Step Points)</label>
                                        <input type="number" value={config.trailingStepPoints} onChange={(e)=>setConfig({...config, trailingStepPoints: parseInt(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-amber-500/50 outline-none transition-all" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 5. STRATEGY (HEDGE & FLIP) */}
                        {settingsTab === 'STRATEGY' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">الهيدج والانعكاس (Protocols)</h2>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-purple-500/30 transition-all">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">الهيدج الآلي (Auto-Hedge)</label>
                                            <p className="text-[10px] text-zinc-500">فتح مراكز معاكسة للحماية بدلاً من ضرب الستوب</p>
                                        </div>
                                        <input type="checkbox" checked={config.autoHedgeEnabled} onChange={(e)=>setConfig({...config, autoHedgeEnabled: e.target.checked})} className="w-8 h-8 accent-purple-500 cursor-pointer" />
                                    </div>
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-purple-500/30 transition-all">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">نظام الانعكاس (Flip Logic)</label>
                                            <p className="text-[10px] text-zinc-500">إغلاق المركز المفتوح وفتح عكسه فوراً عند تغير الزخم</p>
                                        </div>
                                        <input type="checkbox" checked={config.flipEnabled} onChange={(e)=>setConfig({...config, flipEnabled: e.target.checked})} className="w-8 h-8 accent-purple-500 cursor-pointer" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">نسبة حجم الهيدج (Hedge Ratio)</label>
                                        <input type="number" step="0.1" value={config.hedgeRatio} onChange={(e)=>setConfig({...config, hedgeRatio: parseFloat(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-purple-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">حساسية الانعكاس (Flip Sensitivity)</label>
                                        <input type="number" value={config.flipSensitivityScore} onChange={(e)=>setConfig({...config, flipSensitivityScore: parseInt(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-purple-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-amber-500/30 transition-all col-span-2">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">تعطيل الوقف الأولي (Disable Initial SL)</label>
                                            <p className="text-[10px] text-zinc-500">موصى به عند استخدام الهيدج لفتح الصفقات بدون ستوب لوز</p>
                                        </div>
                                        <input type="checkbox" checked={config.disableInitialSL} onChange={(e)=>setConfig({...config, disableInitialSL: e.target.checked})} className="w-8 h-8 accent-amber-500 cursor-pointer" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 6. NEWS SHIELD */}
                        {settingsTab === 'NEWS' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">حماية الأخبار (News Shield)</h2>
                                <div className="grid grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">دقائق الحظر قبل الخبر (Bypass)</label>
                                        <input type="number" value={config.newsBypassMinutes} onChange={(e)=>setConfig({...config, newsBypassMinutes: parseInt(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-rose-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">دقائق التبريد بعد الخبر (Cooldown)</label>
                                        <input type="number" value={config.newsCooldownMinutes} onChange={(e)=>setConfig({...config, newsCooldownMinutes: parseInt(e.target.value)})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-3xl focus:border-rose-500/50 outline-none transition-all" />
                                    </div>
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-rose-500/30 transition-all col-span-2">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">حظر الأخبار متوسطة التأثير (Medium Impact)</label>
                                            <p className="text-[10px] text-zinc-500">افتراضياً يتم الحظر للأخبار عالية التأثير فقط (High Impact)</p>
                                        </div>
                                        <input type="checkbox" checked={config.blockOnMediumImpact} onChange={(e)=>setConfig({...config, blockOnMediumImpact: e.target.checked})} className="w-8 h-8 accent-rose-500 cursor-pointer" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 7. TELEGRAM RELAY */}
                        {settingsTab === 'RELAY' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">إشعارات التليجرام (Relay)</h2>
                                <div className="space-y-8">
                                    <div className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-indigo-500/30 transition-all">
                                        <div>
                                            <label className="text-xs font-black text-white block mb-1">تفعيل التقارير الفورية</label>
                                            <p className="text-[10px] text-zinc-500">إرسال كل تحرك للنظام (دخول، تأمين، إغلاق) للهاتف</p>
                                        </div>
                                        <input type="checkbox" checked={config.enableTelegramAlerts} onChange={(e)=>setConfig({...config, enableTelegramAlerts: e.target.checked})} className="w-8 h-8 accent-indigo-500 cursor-pointer" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-8">
                                        <div className="space-y-4">
                                            <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">Bot Token</label>
                                            <input type="password" value={config.telegramBotToken} onChange={(e)=>setConfig({...config, telegramBotToken: e.target.value})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-lg focus:border-indigo-500/50 outline-none" />
                                        </div>
                                        <div className="space-y-4">
                                            <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">Chat ID</label>
                                            <input type="text" value={config.telegramChatId} onChange={(e)=>setConfig({...config, telegramChatId: e.target.value})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-lg focus:border-indigo-500/50 outline-none" />
                                        </div>
                                    </div>
                                    <button onClick={async () => {
                                        const res = await sendTestMessage(config.telegramBotToken, config.telegramChatId, config.webhookUrl);
                                        addLog(res.success ? "✅ تم إرسال إشعار الاختبار" : "❌ فشل اختبار التليجرام", res.success ? "SYSTEM" : "ERROR");
                                    }} className="w-full py-8 bg-indigo-500 text-white font-black rounded-3xl hover:bg-indigo-400 hover:scale-[1.01] active:scale-95 transition-all text-sm uppercase tracking-[0.2em] shadow-2xl shadow-indigo-500/20">اختبار اتصال التليجرام</button>
                                </div>
                            </div>
                        )}

                        {/* 8. SYSTEM & BRIDGE */}
                        {settingsTab === 'SYSTEM' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">أمان الجسر (Bridge Security)</h2>
                                <div className="space-y-8">
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">رابط الـ Webhook الخاص بـ MT5</label>
                                        <input type="text" value={config.webhookUrl} onChange={(e)=>setConfig({...config, webhookUrl: e.target.value})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-lg focus:border-zinc-500/50 outline-none" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">مفتاح التشفير السري (Secret Key)</label>
                                        <input type="password" value={config.webhookSecret} onChange={(e)=>setConfig({...config, webhookSecret: e.target.value})} className="w-full bg-zinc-900/60 border border-zinc-800 rounded-3xl px-8 py-6 text-white font-mono text-lg focus:border-zinc-500/50 outline-none" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-8">
                                        <button onClick={async () => {
                                            if(window.confirm('سيتم تصفير كافة السجلات والصفقات في الجسر حالاً. هل أنت متأكد؟')) {
                                                const res = await clearRemoteBridge(config.webhookUrl);
                                                addLog(res ? "✅ تم تصفير بيانات الجسر" : "❌ فشل تصفير الجسر", "SYSTEM");
                                            }
                                        }} className="py-8 bg-rose-500/10 border border-rose-500/20 text-rose-500 font-black rounded-3xl hover:bg-rose-500 hover:text-white transition-all text-xs uppercase tracking-widest">تصفير ذاكرة الجسر</button>
                                        <button onClick={async () => {
                                            const isOnline = await checkBridgeStatus(config.webhookUrl);
                                            setBridgeStatus(isOnline);
                                            addLog(isOnline ? "✅ الجسر متصل ومستقر" : "❌ لا يمكن الوصول للجسر", "SYSTEM");
                                        }} className="py-8 bg-zinc-800 text-white font-black rounded-3xl hover:bg-zinc-700 transition-all text-xs uppercase tracking-widest">تحقق من الاتصال</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 9. MQL5 CODE */}
                        {settingsTab === 'MQL5' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">كود MetaTrader 5 (MQL5)</h2>
                                <div className="space-y-6">
                                    <div className="p-8 bg-amber-500/10 border border-amber-500/20 rounded-3xl flex items-center gap-6">
                                        <i className="fas fa-exclamation-triangle text-amber-500 text-2xl"></i>
                                        <p className="text-xs text-amber-200/80 leading-relaxed font-bold">تأكد من نسخ الكود المحدث ليتوافق مع بروتوكولات v45.2. الصقه في MetaEditor وقم بعمل Compile.</p>
                                    </div>
                                    <div className="relative group">
                                        <pre className="bg-black/60 p-10 rounded-3xl border border-zinc-800 font-mono text-[11px] text-zinc-400 overflow-x-auto max-h-[450px] custom-scrollbar text-left group-hover:border-zinc-700 transition-all" dir="ltr">
                                            {MQL5_CODE}
                                        </pre>
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(MQL5_CODE);
                                                addLog("📋 تم نسخ الكود المحدث للحافظة", "SYSTEM");
                                            }}
                                            className="absolute top-8 right-8 px-8 py-4 bg-white text-black font-black rounded-2xl text-[10px] uppercase hover:bg-amber-500 transition-all shadow-2xl active:scale-90"
                                        >
                                            <i className="fas fa-copy mr-2"></i> نسخ الكود بالكامل
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 10. BRIDGE CODE */}
                        {settingsTab === 'BRIDGE' && (
                            <div className="space-y-12">
                                <h2 className="text-5xl font-black text-white italic tracking-tighter">كود الجسر (Node.js)</h2>
                                <div className="space-y-6">
                                    <div className="p-8 bg-emerald-500/10 border border-emerald-500/20 rounded-3xl flex items-center gap-6">
                                        <i className="fas fa-server text-emerald-500 text-2xl"></i>
                                        <p className="text-xs text-emerald-200/80 leading-relaxed font-bold">هذا هو كود الجسر (Bridge) الذي يعمل على Node.js. تأكد من تشغيله باستخدام `node arkon-bridge.js`.</p>
                                    </div>
                                    <div className="relative group">
                                        <pre className="bg-black/60 p-10 rounded-3xl border border-zinc-800 font-mono text-[11px] text-zinc-400 overflow-x-auto max-h-[450px] custom-scrollbar text-left group-hover:border-zinc-700 transition-all" dir="ltr">
                                            {BRIDGE_CODE}
                                        </pre>
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(BRIDGE_CODE);
                                                addLog("📋 تم نسخ كود الجسر للحافظة", "SYSTEM");
                                            }}
                                            className="absolute top-8 right-8 px-8 py-4 bg-white text-black font-black rounded-2xl text-[10px] uppercase hover:bg-emerald-500 transition-all shadow-2xl active:scale-90"
                                        >
                                            <i className="fas fa-copy mr-2"></i> نسخ الكود بالكامل
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Global Save Button */}
                    <div className="mt-20 pt-10 border-t border-zinc-900 flex justify-end">
                        <button onClick={() => { 
                            localStorage.setItem(`arkon_config_v${CURRENT_VERSION}`, JSON.stringify(config)); 
                            setIsSettingsOpen(false); 
                            addLog("💾 تم تطبيق البروتوكول الجديد بنجاح", "SYSTEM");
                        }} className="px-24 py-8 bg-white text-black font-black rounded-3xl uppercase tracking-[0.4em] hover:bg-amber-500 hover:scale-105 transition-all shadow-2xl shadow-white/5 active:scale-95">حفظ وتنشيط الإعدادات</button>
                    </div>
                </div>
             </div>
          </div>
      )}

      {/* Persistent Header */}
      <header className="flex justify-between items-center mb-10 px-4">
          <div className="flex items-center gap-10">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-2xl group cursor-pointer hover:rotate-12 transition-all">
                  <span className="text-black font-black text-3xl">A</span>
              </div>
              <div>
                  <h1 className="text-4xl font-black text-white uppercase italic tracking-tighter">ARKON <span className="text-amber-500">QUANT</span> <span className="text-zinc-800 not-italic ml-2 text-sm uppercase">ELITE v{CURRENT_VERSION}</span></h1>
                  <div className="flex items-center gap-5 mt-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${bridgeStatus ? 'bg-emerald-500 shadow-[0_0_12px_#10b981]' : 'bg-rose-500 shadow-[0_0_12px_#f43f5e]'}`}></div>
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">{bridgeStatus ? 'Bridge Relay Connected' : 'Relay Disconnected'}</span>
                      <span className="text-[10px] font-black text-zinc-800 uppercase tracking-[0.3em]">| High-Latency Protected</span>
                  </div>
              </div>
          </div>

          <div className="flex items-center gap-8">
              <div className="text-right px-8 border-r border-zinc-900">
                  <span className="text-[9px] text-zinc-600 font-black uppercase block tracking-widest mb-1">Portfolio Balance PnL</span>
                  <span className={`text-3xl font-mono font-black ${totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
                  </span>
              </div>
              <button onClick={() => setIsSettingsOpen(true)} className="group bg-zinc-900 border border-zinc-800 hover:border-amber-500/50 px-8 py-5 rounded-2xl transition-all flex items-center gap-4 shadow-xl">
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">إدارة البروتوكولات</span>
                  <i className="fas fa-sliders text-amber-500 group-hover:rotate-90 transition-all"></i>
              </button>
          </div>
      </header>

      {/* View Switcher */}
      {activeTab === 'HISTORY' ? (
          <HistoryTable trades={tradeHistory} />
      ) : (
          <main className="grid grid-cols-1 xl:grid-cols-12 gap-10">
              <div className="xl:col-span-8 space-y-10">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                      <MarketStats title="BTC/USD ALGO" state={btcAnalysis} />
                      <MarketStats title="ETH/USD ALGO" state={ethAnalysis} />
                  </div>

                  <div className="glass-card rounded-[4rem] p-12 border border-zinc-900 bg-zinc-950/20 shadow-2xl relative overflow-hidden">
                      <div className="flex justify-between items-center mb-12 border-b border-zinc-900/50 pb-8">
                          <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">تدفق الإشارات (Quantum Stream)</h3>
                          <div className="flex gap-4 items-center">
                            <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">{signals.length} ACTIVE AUDITS</span>
                            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></div>
                          </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                          {signals.length === 0 ? (
                            <div className="col-span-full py-24 text-center opacity-10 flex flex-col items-center">
                                <i className="fas fa-radar text-7xl mb-6"></i>
                                <p className="text-xs font-black uppercase tracking-[0.5em]">Scanning Block Structure...</p>
                            </div>
                          ) : (
                            signals.map(sig => (
                                <SignalCard 
                                    key={sig.id} 
                                    signal={sig} 
                                    onSend={handleSendSignal} 
                                    sending={sendingRef.current[sig.id + 'ENTRY'] || false} 
                                    userRiskCap={config.maxAllocationPerTradePercent} 
                                    isActive={managedTrades.some(t => t.signalId === sig.id)}
                                    isSystemLocked={newsGuard.isPaused}
                                />
                            ))
                          )}
                      </div>
                  </div>
              </div>

              <div className="xl:col-span-4 space-y-10 flex flex-col">
                  <NewsRadar events={newsEvents} isPaused={newsGuard.isPaused} activeEvent={newsGuard.event} newsStatus={{ reason: newsGuard.reason, remainingMs: newsGuard.remainingMs }} />

                  <div className="glass-card rounded-[4rem] border border-zinc-900 p-12 flex flex-col gap-10 bg-zinc-950/40 min-h-[500px] shadow-2xl relative overflow-hidden">
                      <div className="flex justify-between items-center border-b border-zinc-900 pb-6">
                        <h3 className="text-xl font-black text-white italic uppercase tracking-widest">المراكز المفتوحة</h3>
                        <span className="text-[10px] font-mono text-zinc-600 bg-zinc-900 px-3 py-1 rounded-full">{managedTrades.length} ACTIVE</span>
                      </div>
                      
                      <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar">
                          {managedTrades.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-32 text-center space-y-6 opacity-10">
                                <i className="fas fa-microchip text-6xl"></i>
                                <p className="text-[11px] font-black uppercase tracking-[0.5em]">System Idle | No Exposure</p>
                            </div>
                          ) : (
                            managedTrades.map((trade, idx) => (
                                <div key={idx} className="p-8 rounded-[2.5rem] bg-zinc-900/90 border border-zinc-800 space-y-6 group hover:border-zinc-500 transition-all shadow-xl">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-5">
                                            <div className={`w-2 h-12 rounded-full ${trade.direction === 'LONG' ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-rose-500 shadow-[0_0_15px_#f43f5e]'}`}></div>
                                            <div>
                                                <h4 className="text-lg font-black text-white uppercase tracking-tighter">{trade?.asset?.split('.')[0] || 'UNKNOWN'}</h4>
                                                <span className="text-[10px] font-mono text-zinc-600">Entry: ${(trade.entryPrice || 0).toLocaleString()}</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className={`text-3xl font-mono font-black ${(trade.pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {(trade.pnl || 0) >= 0 ? '+' : ''}${(trade.pnl || 0).toFixed(2)}
                                            </span>
                                            <div className="text-[8px] font-black text-zinc-700 uppercase mt-1 tracking-widest">Unrealized PnL</div>
                                        </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-4">
                                        <button 
                                            onClick={() => handleSendSignal(trade, 'SECURE')}
                                            disabled={sendingRef.current[trade.signalId + 'SECURE']}
                                            className="bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500 hover:text-black py-4 rounded-2xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-3 active:scale-95"
                                        >
                                            <i className="fas fa-shield-halved"></i> تأمين الربح
                                        </button>
                                        <button 
                                            onClick={() => handleSendSignal(trade, 'EXIT')}
                                            disabled={sendingRef.current[trade.signalId + 'EXIT']}
                                            className="bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500 hover:text-white py-4 rounded-2xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-3 active:scale-95"
                                        >
                                            <i className="fas fa-times-circle"></i> تصفية المركز
                                        </button>
                                    </div>
                                </div>
                            ))
                          )}
                      </div>
                      
                      <div className="mt-auto">
                        <TradeLog logs={logs} activeTradesCount={managedTrades.length} managedTrades={managedTrades} onCloseTrade={()=>{}} />
                      </div>
                  </div>
              </div>
          </main>
      )}

      {/* Footer Navigation Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-3xl border-t border-zinc-900 py-6 px-12 flex justify-center items-center gap-20 z-[100] shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
          <button onClick={() => setActiveTab('DASHBOARD')} className={`group flex items-center gap-4 text-[11px] font-black uppercase tracking-[0.4em] transition-all ${activeTab === 'DASHBOARD' ? 'text-amber-500' : 'text-zinc-700 hover:text-zinc-400'}`}>
            <i className="fas fa-chart-line text-lg"></i>
            <span>Dashboard</span>
          </button>
          <button onClick={() => setActiveTab('HISTORY')} className={`group flex items-center gap-4 text-[11px] font-black uppercase tracking-[0.4em] transition-all ${activeTab === 'HISTORY' ? 'text-amber-500' : 'text-zinc-700 hover:text-zinc-400'}`}>
            <i className="fas fa-history text-lg"></i>
            <span>History Log</span>
          </button>
      </footer>
    </div>
  );
};

export default App;
