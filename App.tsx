
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMarketSummary, fetchCandles, fetchDVOL, fetchOptionsVolume, fetchOrderBook, fetchHistoricalContext } from './services/deribitService';
import { generateSignal } from './services/tradingAlgo';
import { sendToWebhook, checkBridgeStatus, fetchBridgeState, clearRemoteBridge } from './services/webhookService';
import { sendTestMessage, sendSignalToTelegram } from './services/telegramService';
import { getIncomingHighImpactEvents, checkNewsImpactStatus } from './services/newsService';
import { TradingSignal, AppConfig, LogEntry, LogType, MarketAnalysisState, EconomicEvent, SignalDirection } from './types';
import { MQL5_CODE } from './utils/mqlCode';
import MarketStats from './components/MarketStats';
import TradeLog from './components/TradeLog';
import SignalCard from './components/SignalCard';
import NewsRadar from './components/NewsRadar';

const CURRENT_VERSION = '34.0.0'; 
const MIN_SCORE_THRESHOLD = 75; 

const DEFAULT_CONFIG: AppConfig = {
  telegramBotToken: '',
  telegramChatId: '',
  webhookUrl: 'http://127.0.0.1:3000',
  webhookSecret: 'ARKON_SECURE_PRIME_2025',
  riskRewardRatio: 2.5, 
  cooldownHours: 1,
  autoExecution: true,
  enableTrailing: true,
  equityProtectionPercent: 5.0, 
  maxAllocationPerTrade: 0.01, 
  maxPyramidingLayers: 3, 
  secureThreshold: 30.0, 
  partialClosePercent: 50.0,
  autoHedgeEnabled: true,
  trailingStepPoints: 150,
  newsBypassMinutes: 45,
  newsCooldownMinutes: 90,
  secureHedgeTrades: true,
  hunterMode: true,
  globalProfitTargetUSD: 1000,
  perTradeProfitTargetUSD: 100,
  maxOpenTrades: 5,
  disableInitialSL: true
};

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(() => {
    const vCurrent = localStorage.getItem(`arkon_config_v${CURRENT_VERSION}`);
    if (vCurrent) return JSON.parse(vCurrent);
    return DEFAULT_CONFIG;
  });

  const [managedTrades, setManagedTrades] = useState<any[]>([]); 
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [btcAnalysis, setBtcAnalysis] = useState<MarketAnalysisState | null>(null);
  const [ethAnalysis, setEthAnalysis] = useState<MarketAnalysisState | null>(null);
  const [newsEvents, setNewsEvents] = useState<EconomicEvent[]>([]);
  const [newsGuard, setNewsGuard] = useState<{isPaused: boolean, event?: EconomicEvent, reason: string}>({isPaused: false, reason: 'NORMAL'});
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'RISK' | 'SECURITY' | 'PROT' | 'NEWS' | 'NOTIF' | 'EA' | 'SYSTEM'>('DASHBOARD');
  const [bridgeStatus, setBridgeStatus] = useState<boolean | null>(null);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const sendingRef = useRef<Record<string, boolean>>({});
  const securedTicketsRef = useRef<Set<string>>(new Set());
  const sentSignalsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((message: string, type: LogType = 'INFO', details?: string | object) => {
      setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), type, message, details }, ...prev].slice(150)); 
  }, []);

  useEffect(() => {
    localStorage.setItem(`arkon_config_v${CURRENT_VERSION}`, JSON.stringify(config));
  }, [config]);

  const generateNewSecret = () => {
    const randomSecret = 'ARKON_' + Math.random().toString(36).substring(2, 12).toUpperCase();
    setConfig({...config, webhookSecret: randomSecret});
    addLog("توليد مفتاح أمان مشفر جديد", "SYSTEM");
  };

  const handleSendSignal = useCallback(async (signal: TradingSignal, overrideAction?: any): Promise<boolean> => {
    if (bridgeStatus === false) {
      addLog(`فشل: الجسر غير متصل`, 'ERROR');
      return false;
    }

    if (!overrideAction && managedTrades.length >= config.maxOpenTrades) {
        addLog(`الوصول للحد الأقصى للسعة (${config.maxOpenTrades})`, 'RISK');
        return false;
    }

    const actionType: any = overrideAction || 'ENTRY';
    const finalSignal = { ...signal };
    
    if (actionType === 'SECURE') {
        finalSignal.details = {
            ...finalSignal.details,
            secureThreshold: config.secureThreshold,
            partialClosePercent: config.partialClosePercent
        };
    }

    if (config.disableInitialSL && actionType === 'ENTRY') {
        finalSignal.stopLoss = 0;
    }

    if (sendingRef.current[signal.id] && actionType !== 'SECURE') return false;
    sendingRef.current[signal.id] = true;

    try {
        const result = await sendToWebhook(finalSignal, config.webhookUrl, 0.0, actionType, config.maxAllocationPerTrade, config.webhookSecret);
        if (result.success) {
            if (config.telegramBotToken && config.telegramChatId) {
                sendSignalToTelegram(finalSignal, config.telegramChatId, config.telegramBotToken, actionType, finalSignal.reasoning, config.webhookUrl).catch(() => {});
            }
            if (!overrideAction) sentSignalsRef.current.add(signal.id);
            addLog(`✅ تنفيذ: ${actionType} لـ ${signal.asset}`, 'EXEC');
            return true;
        } else {
            addLog(`رفض الجسر: ${result.error}`, 'ERROR');
        }
    } catch (err) { 
        addLog(`خطأ اتصال بالجسر`, 'ERROR'); 
    } finally { 
        sendingRef.current[signal.id] = false; 
    }
    return false;
  }, [config, bridgeStatus, managedTrades.length, addLog]);

  useEffect(() => {
    managedTrades.forEach(trade => {
        const pnl = parseFloat(trade.pnl);
        const threshold = parseFloat(config.secureThreshold.toString());
        
        if (pnl >= threshold && !securedTicketsRef.current.has(trade.ticket.toString())) {
            const baseSignal = signals.find(s => s.id === trade.signalId) || {
                id: trade.signalId || `T-${trade.ticket}`,
                asset: trade.asset,
                direction: trade.direction === 'LONG' ? SignalDirection.LONG : SignalDirection.SHORT,
                entry: trade.entryPrice,
                stopLoss: trade.sl,
                takeProfit: trade.tp,
                details: {}
            };
            handleSendSignal(baseSignal as any, 'SECURE');
            securedTicketsRef.current.add(trade.ticket.toString());
            addLog(`🛡️ حماية الأرباح نشطة للـ Ticket #${trade.ticket}`, 'SECURE');
        }
    });
  }, [managedTrades, config.secureThreshold, signals, handleSendSignal, addLog]);

  const updateMarketData = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const isOnline = await checkBridgeStatus(config.webhookUrl);
      setBridgeStatus(isOnline);
      const bridgeState = await fetchBridgeState(config.webhookUrl);
      if (bridgeState && bridgeState.positions) {
          setManagedTrades(bridgeState.positions);
      }
      const events = await getIncomingHighImpactEvents();
      setNewsEvents(events);
      const guardResult = checkNewsImpactStatus(events, config.newsBypassMinutes, config.newsCooldownMinutes);
      setNewsGuard(guardResult);
      
      const processAsset = async (asset: 'BTC' | 'ETH') => {
        const summaries = await fetchMarketSummary(asset);
        const perp = summaries.find(s => s.instrument_name.includes('PERPETUAL'));
        if (perp) {
            const [dvol, optVol, candles, orderBook, dailyCandles] = await Promise.all([
              fetchDVOL(asset), fetchOptionsVolume(asset), fetchCandles(perp.instrument_name, '15'), 
              fetchOrderBook(perp.instrument_name), fetchHistoricalContext(perp.instrument_name)
            ]);
            const { signal, analysis } = generateSignal(asset, perp, summaries, candles, dailyCandles, orderBook, dvol, optVol);
            if (asset === 'BTC') setBtcAnalysis({...analysis, isNewsPaused: guardResult.isPaused, activeEvent: guardResult.event}); 
            else setEthAnalysis({...analysis, isNewsPaused: guardResult.isPaused, activeEvent: guardResult.event});
            if (signal && !sentSignalsRef.current.has(signal.id)) {
                setSignals(prev => [signal, ...prev].slice(0, 50));
                if (config.autoExecution && (!config.hunterMode || signal.qualityScore >= MIN_SCORE_THRESHOLD) && !guardResult.isPaused) {
                    handleSendSignal(signal);
                }
            }
        }
      };
      await processAsset('BTC');
      await processAsset('ETH');
    } finally { setIsProcessing(false); }
  }, [config, isProcessing, handleSendSignal]);

  useEffect(() => {
    const interval = setInterval(updateMarketData, 5000); 
    return () => clearInterval(interval);
  }, [updateMarketData]);

  const testTelegram = async () => {
      setIsTestingTg(true);
      addLog("بدء اختبار تنبيهات تليجرام...", "INFO");
      const res = await sendTestMessage(config.telegramBotToken, config.telegramChatId, config.webhookUrl);
      if (res.success) addLog("وصلت رسالة الاختبار بنجاح ✅", "INFO");
      else addLog(`فشل اختبار تليجرام: ${res.error}`, "ERROR");
      setIsTestingTg(false);
  };

  const handleClearBridge = async () => {
      if (!window.confirm("هل أنت متأكد من تصفير الجسر؟ سيتم مسح قائمة الصفقات المنتظرة.")) return;
      const ok = await clearRemoteBridge(config.webhookUrl);
      if (ok) {
          addLog("تم تصفير بيانات الجسر بنجاح", "SYSTEM");
          setManagedTrades([]);
          securedTicketsRef.current.clear();
      } else {
          addLog("فشل تصفير الجسر - تحقق من الاتصال", "ERROR");
      }
  };

  return (
    <div className={`min-h-screen pb-12 px-6 pt-8 max-w-[1920px] mx-auto space-y-6 text-right font-sans transition-all duration-1000 ${newsGuard.isPaused ? 'bg-rose-950/5' : ''}`} dir="rtl">
      
      {/* Settings Modal (Fully Completed) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-6 bg-black/90 backdrop-blur-3xl animate-in fade-in zoom-in duration-300">
          <div className="glass-card w-full max-w-7xl rounded-[3rem] border-zinc-800 p-0 shadow-[0_0_200px_rgba(0,0,0,0.9)] relative overflow-hidden flex h-[85vh]">
            
            {/* Modal Sidebar */}
            <div className="w-80 border-l border-zinc-900 bg-zinc-950/50 p-10 flex flex-col justify-between overflow-y-auto">
                <div className="space-y-12">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shadow-2xl shadow-amber-500/20 rotate-3">
                            <i className="fas fa-terminal text-black text-xl"></i>
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white leading-none">CORE TERMINAL</h2>
                            <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Prime Engine v{CURRENT_VERSION}</p>
                        </div>
                    </div>

                    <nav className="flex flex-col gap-2">
                        {[
                            {id: 'DASHBOARD', label: 'الحالة الحالية', icon: 'server'},
                            {id: 'SECURITY', label: 'التشفير والربط', icon: 'key'},
                            {id: 'RISK', label: 'إدارة المخاطر', icon: 'chart-pie'},
                            {id: 'PROT', label: 'تأمين الأرباح', icon: 'shield-check'},
                            {id: 'NEWS', label: 'رادار الأخبار', icon: 'satellite'},
                            {id: 'NOTIF', label: 'التنبيهات (TG)', icon: 'bell'},
                            {id: 'EA', label: 'كود MQL5', icon: 'code'},
                            {id: 'SYSTEM', label: 'الصيانة والتصفير', icon: 'hammer'}
                        ].map(tab => (
                            <button 
                                key={tab.id} 
                                onClick={() => setActiveTab(tab.id as any)} 
                                className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-xs font-black transition-all ${activeTab === tab.id ? 'bg-white text-black shadow-xl scale-[1.05]' : 'text-zinc-500 hover:bg-white/5'}`}
                            >
                                <i className={`fas fa-${tab.icon} w-5 text-center text-sm ${activeTab === tab.id ? 'text-amber-500' : 'text-zinc-800'}`}></i>
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Modal Main Surface */}
            <div className="flex-1 bg-gradient-to-br from-zinc-900/10 to-transparent p-16 overflow-y-auto custom-scrollbar relative">
                <button onClick={() => setIsSettingsOpen(false)} className="absolute top-10 left-10 w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white flex items-center justify-center transition-all hover:scale-110 z-10">
                    <i className="fas fa-times text-xl"></i>
                </button>

                <div className="max-w-3xl">
                    {/* Tab: Dashboard */}
                    {activeTab === 'DASHBOARD' && (
                        <div className="space-y-12 animate-in slide-in-from-bottom duration-500">
                            <header>
                                <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">حالة المحرك المركزية</h3>
                                <p className="text-zinc-500 text-sm">التشخيص اللحظي لكافة مكونات النظام والاتصال مع الجسر.</p>
                            </header>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex items-center gap-6 relative overflow-hidden group">
                                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${bridgeStatus ? 'bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]' : 'bg-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]'}`}>
                                        <i className="fas fa-plug text-black text-2xl"></i>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">حالة قناة الجسر</span>
                                        <h4 className={`text-2xl font-black ${bridgeStatus ? 'text-emerald-500' : 'text-rose-500'}`}>{bridgeStatus ? 'CONNECTED' : 'OFFLINE'}</h4>
                                    </div>
                                </div>
                                <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex items-center gap-6">
                                    <div className="w-16 h-16 bg-amber-500 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.3)]">
                                        <i className="fas fa-layer-group text-black text-2xl"></i>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">السعة النشطة</span>
                                        <h4 className="text-2xl font-black text-white">{managedTrades.length} / {config.maxOpenTrades}</h4>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab: Security */}
                    {activeTab === 'SECURITY' && (
                        <div className="space-y-12 animate-in slide-in-from-left duration-500">
                            <header>
                                <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">التشفير وقناة الربط</h3>
                                <p className="text-zinc-500 text-sm">تأمين قناة الاتصال بين المنصة واكسبيرت MT5 باستخدام مفتاح أمان مشفر.</p>
                            </header>

                            <div className="p-10 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 space-y-10 shadow-inner">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">رابط الويب هوك الخاص بالجسر</label>
                                    <input type="text" value={config.webhookUrl} onChange={(e)=>setConfig({...config, webhookUrl: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-lg" placeholder="http://127.0.0.1:3000" />
                                </div>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">مفتاح الأمان المشفر (Secret Key)</label>
                                        <button onClick={generateNewSecret} className="text-[9px] font-black text-amber-500 hover:underline uppercase">توليد مفتاح جديد</button>
                                    </div>
                                    <div className="relative">
                                        <input type={showSecret ? "text" : "password"} value={config.webhookSecret} onChange={(e)=>setConfig({...config, webhookSecret: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-lg pr-20" />
                                        <button onClick={() => setShowSecret(!showSecret)} className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"><i className={`fas fa-eye${showSecret ? '-slash' : ''}`}></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab: Risk */}
                    {activeTab === 'RISK' && (
                        <div className="space-y-12 animate-in slide-in-from-left duration-500">
                            <header>
                                <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">إدارة المخاطر والسعة</h3>
                                <p className="text-zinc-500 text-sm">تحديد حجم العقود والحد الأقصى للتعرض المسموح به في المحفظة.</p>
                            </header>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 space-y-8">
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">الحد الأقصى للصفقات المتزامنة</label>
                                        <input type="number" value={config.maxOpenTrades} onChange={(e)=>setConfig({...config, maxOpenTrades: parseInt(e.target.value) || 1})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono text-xl" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">حجم اللوت الثابت (Lot Size)</label>
                                        <input type="number" step="0.01" value={config.maxAllocationPerTrade} onChange={(e)=>setConfig({...config, maxAllocationPerTrade: parseFloat(e.target.value) || 0.01})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono text-xl" />
                                    </div>
                                </div>
                                <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex items-center justify-between">
                                    <div>
                                        <span className="text-xs font-black text-white uppercase block mb-1">Zero-SL Mode</span>
                                        <p className="text-[9px] text-zinc-600 font-bold uppercase">بدء الصفقات بدون وقف خسارة</p>
                                    </div>
                                    <button onClick={() => setConfig({...config, disableInitialSL: !config.disableInitialSL})} className={`w-14 h-7 rounded-full transition-all relative ${config.disableInitialSL ? 'bg-amber-500 shadow-[0_0_15px_#f59e0b]' : 'bg-zinc-800'}`}>
                                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${config.disableInitialSL ? 'left-8' : 'left-1'}`}></div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab: Protection */}
                    {activeTab === 'PROT' && (
                        <div className="space-y-12 animate-in slide-in-from-left duration-500">
                            <header>
                                <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">تأمين الأرباح (Shield)</h3>
                                <p className="text-zinc-500 text-sm">بروتوكول التأمين التلقائي يقوم بحجز أجزاء من العقد عند الوصول لأهداف مالية معينة.</p>
                            </header>

                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-10 shadow-inner">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">عتبة تفعيل التأمين (ربح بـ $)</label>
                                        <input type="number" value={config.secureThreshold} onChange={(e)=>setConfig({...config, secureThreshold: parseFloat(e.target.value) || 0})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-2xl shadow-inner" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">نسبة الإغلاق الجزئي (%)</label>
                                        <input type="number" value={config.partialClosePercent} onChange={(e)=>setConfig({...config, partialClosePercent: parseFloat(e.target.value) || 0})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-2xl shadow-inner" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab: News Settings */}
                    {activeTab === 'NEWS' && (
                        <div className="space-y-12 animate-in slide-in-from-left duration-500">
                            <header>
                                <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">رادار الأخبار</h3>
                                <p className="text-zinc-500 text-sm">تخصيص "الدرع الواقي" الذي يمنع التداول قبل وبعد صدور الأخبار الاقتصادية الهامة.</p>
                            </header>

                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-10">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">فترة الحظر قبل الخبر (بالدقائق)</label>
                                        <input type="number" value={config.newsBypassMinutes} onChange={(e)=>setConfig({...config, newsBypassMinutes: parseInt(e.target.value) || 0})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-2xl shadow-inner" />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">فترة التبريد بعد الخبر (بالدقائق)</label>
                                        <input type="number" value={config.newsCooldownMinutes} onChange={(e)=>setConfig({...config, newsCooldownMinutes: parseInt(e.target.value) || 0})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-2xl shadow-inner" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab: Notifications */}
                    {activeTab === 'NOTIF' && (
                        <div className="space-y-12 animate-in slide-in-from-left duration-500">
                            <header>
                                <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">تنبيهات تليجرام</h3>
                                <p className="text-zinc-500 text-sm">ابقَ على اطلاع دائم بجميع عمليات التداول عبر التنبيهات الفورية على هاتفك.</p>
                            </header>

                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-10">
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Bot Token</label>
                                        <input type="text" value={config.telegramBotToken} onChange={(e)=>setConfig({...config, telegramBotToken: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono" placeholder="123456:ABC-DEF..." />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Chat ID</label>
                                        <input type="text" value={config.telegramChatId} onChange={(e)=>setConfig({...config, telegramChatId: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono" placeholder="-100123456789" />
                                    </div>
                                </div>
                                <button onClick={testTelegram} disabled={isTestingTg} className="w-full py-6 bg-amber-500 text-black font-black uppercase tracking-widest rounded-2xl hover:bg-amber-400 transition-all flex items-center justify-center gap-4 shadow-xl shadow-amber-500/10">
                                    {isTestingTg ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-paper-plane"></i>}
                                    إرسال رسالة اختبار للجهاز
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Tab: System & Maintenance */}
                    {activeTab === 'SYSTEM' && (
                        <div className="space-y-12 animate-in slide-in-from-left duration-500">
                            <header>
                                <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">الصيانة والتصفير</h3>
                                <p className="text-zinc-500 text-sm">أدوات متقدمة لتنظيف النظام، مسح السجلات، وتصحيح مسار الجسر.</p>
                            </header>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 flex flex-col gap-6">
                                    <div>
                                        <h4 className="text-xs font-black text-white uppercase mb-2">تصفير الجسر (Reset Bridge)</h4>
                                        <p className="text-[9px] text-zinc-600 font-bold uppercase mb-6 leading-relaxed">مسح جميع الصفقات والبيانات المخزنة في الجسر المحلي MT5 Sync.</p>
                                    </div>
                                    <button onClick={handleClearBridge} className="w-full py-5 bg-rose-500/10 border border-rose-500/20 text-rose-500 font-black uppercase text-[10px] tracking-widest rounded-2xl hover:bg-rose-500 hover:text-white transition-all">تصفير الجسر الآن</button>
                                </div>

                                <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 flex flex-col gap-6">
                                    <div>
                                        <h4 className="text-xs font-black text-white uppercase mb-2">مسح السجلات (Clear Logs)</h4>
                                        <p className="text-[9px] text-zinc-600 font-bold uppercase mb-6 leading-relaxed">تفريغ قائمة العمليات والسجلات الظاهرة في الواجهة المركزية.</p>
                                    </div>
                                    <button onClick={() => {setLogs([]); addLog("تم مسح السجلات يدوياً", "SYSTEM")}} className="w-full py-5 bg-zinc-900 border border-zinc-800 text-zinc-400 font-black uppercase text-[10px] tracking-widest rounded-2xl hover:bg-white hover:text-black transition-all">مسح السجلات</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab: EA Code */}
                    {activeTab === 'EA' && (
                        <div className="space-y-12 animate-in slide-in-from-left duration-500 h-full flex flex-col">
                            <header className="flex justify-between items-end">
                                <div>
                                    <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">كود الاكسبيرت MQL5</h3>
                                    <p className="text-zinc-500 text-sm leading-relaxed">انسخ الكود بالكامل واستخدمه في MetaEditor 5 لبناء الجسر التنفيذي المشفر.</p>
                                </div>
                                <button onClick={() => {navigator.clipboard.writeText(MQL5_CODE); addLog("تم نسخ الكود للحافظة", "INFO")}} className="bg-amber-500 text-black px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 transition-all">
                                    نسخ الكود بالكامل
                                </button>
                            </header>
                            <div className="flex-1 bg-zinc-950 rounded-[2.5rem] border border-zinc-900 p-10 font-mono text-[11px] overflow-auto custom-scrollbar shadow-inner text-left" dir="ltr">
                                <pre className="text-emerald-500/70 leading-relaxed whitespace-pre-wrap">{MQL5_CODE}</pre>
                            </div>
                        </div>
                    )}
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Main UI Header */}
      <header className="flex justify-between items-center mb-10 px-4">
          <div className="flex items-center gap-8">
              <div className="w-20 h-20 bg-white rounded-[2.5rem] flex items-center justify-center shadow-[0_0_50px_rgba(255,255,255,0.1)] relative group cursor-pointer overflow-hidden">
                  <span className="text-black font-black text-4xl relative z-10">A</span>
                  <div className="absolute inset-0 bg-gradient-to-tr from-amber-500 to-amber-300 opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
              </div>
              <div>
                  <h1 className="text-5xl font-black text-white uppercase tracking-tighter">ARKON <span className="text-zinc-700">PRIME</span></h1>
                  <div className="flex items-center gap-4 mt-2">
                      <span className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-500 px-4 py-1.5 rounded-full font-black uppercase tracking-[0.3em]">Institutional Engine v{CURRENT_VERSION}</span>
                      <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${bridgeStatus ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-rose-500 shadow-[0_0_15px_#f43f5e]'}`}></div>
                          <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{bridgeStatus ? 'Relay Active' : 'Relay Offline'}</span>
                      </div>
                  </div>
              </div>
          </div>

          <div className="flex items-center gap-6">
              <div className="hidden lg:flex items-center gap-10 bg-zinc-950/40 border border-zinc-900 px-12 py-5 rounded-[2.5rem] shadow-xl">
                  <div className="text-center">
                      <span className="block text-[9px] font-black text-zinc-600 uppercase mb-1 tracking-widest">سعة الصفقات</span>
                      <span className="text-xl font-black text-white">{managedTrades.length} / {config.maxOpenTrades}</span>
                  </div>
                  <div className="w-px h-10 bg-zinc-900"></div>
                  <div className="text-center">
                      <span className="block text-[9px] font-black text-zinc-600 uppercase mb-1 tracking-widest">Safeguard</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xl font-black ${newsGuard.isPaused ? 'text-rose-500' : 'text-emerald-500'}`}>{newsGuard.isPaused ? 'LOCKED' : 'READY'}</span>
                        {newsGuard.isPaused && <i className="fas fa-lock text-rose-500 animate-pulse text-[10px]"></i>}
                      </div>
                  </div>
              </div>

              <button onClick={() => setIsSettingsOpen(true)} className="group flex items-center gap-5 bg-white border border-transparent hover:bg-amber-500 px-10 py-5 rounded-[2.5rem] transition-all shadow-2xl hover:shadow-amber-500/20 active:scale-95">
                   <div className="text-right">
                       <span className="block text-[10px] font-black text-zinc-400 group-hover:text-black/60 uppercase tracking-widest">Control Hub</span>
                       <span className="block text-sm font-black text-black">مركز التحكم</span>
                   </div>
                   <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center group-hover:bg-black transition-all">
                       <i className="fas fa-sliders text-xl text-black group-hover:text-white"></i>
                   </div>
              </button>
          </div>
      </header>

      <main className="grid grid-cols-1 xl:grid-cols-12 gap-10 items-stretch">
          <div className="xl:col-span-8 space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  <MarketStats title="BITCOIN CORE" state={btcAnalysis} />
                  <MarketStats title="ETHEREUM CORE" state={ethAnalysis} />
              </div>

              <div className="glass-card rounded-[4rem] p-12 border border-zinc-900 bg-zinc-950/20 shadow-2xl">
                  <div className="flex justify-between items-center mb-12">
                      <div className="flex items-center gap-6">
                          <div className="w-2 h-10 bg-amber-500 rounded-full shadow-[0_0_20px_#f59e0b]"></div>
                          <h3 className="text-3xl font-black text-white uppercase tracking-tighter">Quantum <span className="text-zinc-700">Vault</span></h3>
                      </div>
                      {newsGuard.isPaused && (
                        <div className="px-6 py-2 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3">
                           <i className="fas fa-exclamation-triangle text-rose-500 text-xs"></i>
                           <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Auto-Execution Locked (News Impact)</span>
                        </div>
                      )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                      {signals.length === 0 ? (
                        <div className="col-span-full py-28 text-center border border-dashed border-zinc-900 rounded-[3rem] opacity-30">
                            <i className="fas fa-radar text-4xl mb-6 block"></i>
                            <span className="text-xs font-black text-zinc-700 uppercase tracking-[0.4em]">Auditing institutional flow sectors...</span>
                        </div>
                      ) : (
                        signals.map(sig => (
                          <SignalCard 
                            key={sig.id} 
                            signal={sig} 
                            onSend={handleSendSignal} 
                            sending={sendingRef.current[sig.id] || false} 
                            userRiskCap={config.maxAllocationPerTrade} 
                            isActive={managedTrades.some(t => t.signalId === sig.id)}
                            isSystemLocked={newsGuard.isPaused}
                          />
                        ))
                      )}
                  </div>
              </div>
          </div>

          <div className="xl:col-span-4 space-y-10 flex flex-col h-full">
              {/* Enhanced News Experience: Radar Widget */}
              <NewsRadar 
                events={newsEvents} 
                isPaused={newsGuard.isPaused} 
                activeEvent={newsGuard.event} 
              />

              <div className="glass-card rounded-[4rem] border border-zinc-900 p-12 flex flex-col gap-10 bg-zinc-950/40 relative overflow-hidden flex-1 shadow-2xl">
                  <div className="flex justify-between items-end">
                      <div>
                          <h3 className="text-2xl font-black text-white uppercase tracking-widest">Portfolio <span className="text-zinc-700">Sync</span></h3>
                          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-2">Active MT5 Terminals</p>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 px-6 py-3 rounded-2xl text-[12px] font-black text-emerald-500 shadow-lg shadow-emerald-500/5">{managedTrades.length} ACTIVE</div>
                  </div>

                  <div className="space-y-6 overflow-y-auto custom-scrollbar pr-4 max-h-[60vh]">
                      {managedTrades.length === 0 ? (
                          <div className="py-32 text-center border border-dashed border-zinc-900 rounded-[3rem] bg-zinc-900/10">
                              <i className="fas fa-box-open text-3xl text-zinc-800 mb-6 block"></i>
                              <span className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.3em]">No exposure detected.</span>
                          </div>
                      ) : (
                          managedTrades.map((trade, i) => {
                              const pnl = parseFloat(trade.pnl);
                              const target = parseFloat(config.secureThreshold.toString());
                              const progress = target > 0 ? Math.min((pnl / target) * 100, 100) : 0;
                              const isSecured = securedTicketsRef.current.has(trade.ticket.toString());

                              return (
                                <div key={i} className="p-10 bg-zinc-900/40 rounded-[3.5rem] border border-zinc-900/60 space-y-8 hover:border-zinc-700 transition-all group relative overflow-hidden shadow-xl">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-5">
                                            <div className={`w-4 h-4 rounded-full ${trade.direction === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'} shadow-lg`}></div>
                                            <div>
                                                <h4 className="text-lg font-black text-white uppercase tracking-tighter">{trade.asset}</h4>
                                                <span className="text-[10px] font-black text-zinc-600 uppercase">{trade.volume} Lot</span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-2xl font-mono font-black tracking-tighter ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} <span className="text-[10px]">USD</span>
                                            </div>
                                            {isSecured && <span className="text-[8px] bg-emerald-500 text-black px-3 py-1 rounded-full font-black uppercase tracking-widest mt-2 inline-block">SECURED</span>}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex justify-between text-[8px] font-black uppercase tracking-[0.2em] px-2">
                                            <span className="text-zinc-600">هدف التأمين: ${config.secureThreshold}</span>
                                            <span className={progress >= 100 ? 'text-emerald-500' : 'text-zinc-500'}>{progress >= 100 ? 'LOCKED' : Math.round(progress) + '%'}</span>
                                        </div>
                                        <div className="h-2 w-full bg-zinc-950 rounded-full overflow-hidden p-[2px] shadow-inner">
                                            <div className={`h-full rounded-full transition-all duration-1000 ${progress >= 100 ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]'}`} style={{width: `${progress}%`}}></div>
                                        </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-6 pt-6 border-t border-zinc-900/50">
                                        <div>
                                            <span className="text-[8px] font-black text-zinc-700 uppercase block mb-1">تذكرة MT5</span>
                                            <span className="text-xs font-mono text-zinc-400 font-bold">{trade.ticket}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[8px] font-black text-zinc-700 uppercase block mb-1">Entry Avg</span>
                                            <span className="text-xs font-mono text-zinc-400 font-bold">${trade.entryPrice.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>
                              );
                          })
                      )}
                  </div>
              </div>

              <div className="h-[300px]">
                  <TradeLog logs={logs} activeTradesCount={managedTrades.length} managedTrades={managedTrades} onCloseTrade={() => {}} />
              </div>
          </div>
      </main>
    </div>
  );
};

export default App;
