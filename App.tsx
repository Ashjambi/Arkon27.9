
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMarketSummary, fetchCandles, fetchDVOL, fetchOptionsVolume, fetchOrderBook, fetchHistoricalContext } from './services/deribitService';
import { generateSignal } from './services/tradingAlgo';
import { sendToWebhook, checkBridgeStatus, fetchBridgeState } from './services/webhookService';
import { sendTestMessage, sendSignalToTelegram } from './services/telegramService';
import { getIncomingHighImpactEvents, checkNewsImpactStatus } from './services/newsService';
import { TradingSignal, AppConfig, LogEntry, LogType, MarketAnalysisState, EconomicEvent, SignalDirection } from './types';
import { MQL5_CODE } from './utils/mqlCode';
import MarketStats from './components/MarketStats';
import TradeLog from './components/TradeLog';
import SignalCard from './components/SignalCard';

const CURRENT_VERSION = '29.2.0'; 
const MIN_SCORE_THRESHOLD = 75; 

const DEFAULT_CONFIG: AppConfig = {
  telegramBotToken: '',
  telegramChatId: '',
  webhookUrl: 'http://127.0.0.1:3000',
  webhookSecret: 'ARKON_SECURE_PRIME',
  riskRewardRatio: 2.5, 
  cooldownHours: 1,
  autoExecution: true,
  enableTrailing: true,
  equityProtectionPercent: 5.0, 
  maxAllocationPerTrade: 0.01, 
  maxPyramidingLayers: 3, 
  secureThreshold: 50.0, 
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
  const [activeTab, setActiveTab] = useState<'CONN' | 'NOTIF' | 'PROT' | 'RISK' | 'NEWS' | 'SYSTEM' | 'DASHBOARD' | 'EA'>('DASHBOARD');
  const [bridgeStatus, setBridgeStatus] = useState<boolean | null>(null);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [copiedType, setCopiedType] = useState<'MQL' | 'BRIDGE' | 'SECRET' | null>(null);
  
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const sendingRef = useRef<Record<string, boolean>>({});
  const sentSignalsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((message: string, type: LogType = 'INFO', details?: string | object) => {
      setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), type, message, details }, ...prev].slice(150)); 
  }, []);

  useEffect(() => {
    localStorage.setItem(`arkon_config_v${CURRENT_VERSION}`, JSON.stringify(config));
  }, [config]);

  const handleCopyCode = (type: 'MQL' | 'BRIDGE' | 'SECRET', code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
    addLog(`تم نسخ ${type} إلى الحافظة`, "INFO");
  };

  const handleSendSignal = async (signal: TradingSignal, overrideAction?: any): Promise<boolean> => {
    const assetPure = signal.asset.split('-')[0];
    
    // فحص عدد الصفقات المفتوحة (السيف)
    if (managedTrades.length >= config.maxOpenTrades && !overrideAction) {
        addLog(`حظر: تم الوصول للحد الأقصى من الصفقات (${config.maxOpenTrades})`, 'RISK');
        return false;
    }

    if (bridgeStatus === false) {
      addLog(`فشل الإرسال: الجسر غير متصل`, 'ERROR');
      return false;
    }

    let actionType: any = overrideAction || 'ENTRY';
    
    // إذا كان خيار تعطيل الستوب لوز الابتدائي مفعلاً، نقوم بتصفيره قبل الإرسال
    const finalSignal = { ...signal };
    if (config.disableInitialSL && actionType === 'ENTRY') {
        finalSignal.stopLoss = 0;
    }

    if (sendingRef.current[signal.id]) return false;
    sendingRef.current[signal.id] = true;

    try {
        const result = await sendToWebhook(finalSignal, config.webhookUrl, 0.0, actionType, config.maxAllocationPerTrade, config.webhookSecret);
        if (result.success) {
            if (config.telegramBotToken && config.telegramChatId) {
                sendSignalToTelegram(finalSignal, config.telegramChatId, config.telegramBotToken, actionType, finalSignal.reasoning, config.webhookUrl).catch(() => {});
            }
            if (!overrideAction) sentSignalsRef.current.add(signal.id);
            addLog(`✅ EXEC: ${actionType} ${assetPure}`, 'EXEC');
            return true;
        } else {
            addLog(`فشل تنفيذ العملية: ${result.error}`, 'ERROR');
        }
    } catch (err: any) { 
        addLog(`خطأ في اتصال الجسر`, 'ERROR'); 
    } finally { 
        sendingRef.current[signal.id] = false; 
    }
    return false;
  };

  const processAsset = async (asset: 'BTC' | 'ETH') => {
    try {
      const summaries = await fetchMarketSummary(asset);
      const perp = summaries.find(s => s.instrument_name.includes('PERPETUAL'));
      if (perp) {
          const [dvol, optVol, candles, orderBook, dailyCandles] = await Promise.all([
            fetchDVOL(asset), fetchOptionsVolume(asset), fetchCandles(perp.instrument_name, '15'), 
            fetchOrderBook(perp.instrument_name), fetchHistoricalContext(perp.instrument_name)
          ]);
          const { signal, analysis } = generateSignal(asset, perp, summaries, candles, dailyCandles, orderBook, dvol, optVol);
          
          if (asset === 'BTC') setBtcAnalysis({...analysis, isNewsPaused: newsGuard.isPaused, activeEvent: newsGuard.event}); 
          else setEthAnalysis({...analysis, isNewsPaused: newsGuard.isPaused, activeEvent: newsGuard.event});
          
          if (signal && !sentSignalsRef.current.has(signal.id)) {
               setSignals(prev => [signal, ...prev].slice(0, 50));
               const canExecute = config.autoExecution && 
                                  (!config.hunterMode || signal.qualityScore >= MIN_SCORE_THRESHOLD) && 
                                  !newsGuard.isPaused;

               if (canExecute) {
                 handleSendSignal(signal);
               }
          }
      }
    } catch (e: any) {}
  };

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
      setNewsGuard(checkNewsImpactStatus(events, config.newsBypassMinutes, config.newsCooldownMinutes));
      await processAsset('BTC');
      await processAsset('ETH');
    } finally { setIsProcessing(false); }
  }, [config, isProcessing, newsGuard]);

  useEffect(() => {
    const interval = setInterval(updateMarketData, 5000); 
    return () => clearInterval(interval);
  }, [updateMarketData]);

  const calculateSetupProgress = () => {
    let score = 0;
    if (bridgeStatus === true) score += 25;
    if (config.telegramBotToken && config.telegramChatId) score += 25;
    if (config.maxAllocationPerTrade > 0) score += 25;
    if (config.autoExecution) score += 25;
    return score;
  };

  const handleTestTg = async () => {
    if (!config.telegramBotToken || !config.telegramChatId) return;
    setIsTestingTg(true);
    const res = await sendTestMessage(config.telegramBotToken, config.telegramChatId, config.webhookUrl);
    setIsTestingTg(false);
    addLog(res.success ? "تم إرسال رسالة الاختبار بنجاح" : `فشل الاختبار: ${res.error}`, res.success ? "INFO" : "ERROR");
  };

  return (
    <div className="min-h-screen pb-12 px-6 pt-8 max-w-[1920px] mx-auto space-y-6 text-right font-sans" dir="rtl">
      
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-2xl animate-in fade-in zoom-in duration-300">
          <div className="glass-card w-full max-w-7xl rounded-[3.5rem] border-zinc-800 p-0 shadow-[0_0_100px_rgba(0,0,0,1)] relative overflow-hidden flex flex-col md:flex-row h-[92vh]" dir="rtl">
             
             {/* LEFT Sidebar */}
             <div className="w-full md:w-80 border-l border-zinc-800 bg-zinc-950/90 p-10 flex flex-col justify-between overflow-y-auto">
                <div>
                    <div className="flex items-center gap-5 mb-12">
                        <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-amber-500/20">
                            <i className="fas fa-layer-group text-black text-2xl"></i>
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white leading-tight tracking-tighter">مركز القيادة</h2>
                            <p className="text-[10px] text-amber-500 font-black uppercase tracking-[0.2em] mt-1">ARKON PRIME ENGINE</p>
                        </div>
                    </div>

                    <nav className="space-y-3">
                        {[
                            {id: 'DASHBOARD', label: 'اللمحة العامة', icon: 'grip-vertical'},
                            {id: 'CONN', label: 'الجسر والتشفير', icon: 'bolt'},
                            {id: 'EA', label: 'تحميل الأكواد', icon: 'file-code'},
                            {id: 'NOTIF', label: 'إرسال التنبيهات', icon: 'paper-plane'},
                            {id: 'NEWS', label: 'رادار الأخبار', icon: 'satellite-dish'},
                            {id: 'PROT', label: 'بروتوكولات القنص', icon: 'microchip'},
                            {id: 'RISK', label: 'إدارة المخاطر', icon: 'chart-pie'},
                            {id: 'SYSTEM', label: 'النظام والصيانة', icon: 'terminal'}
                        ].map(tab => (
                            <button 
                                key={tab.id} 
                                onClick={() => setActiveTab(tab.id as any)} 
                                className={`w-full flex items-center gap-5 px-6 py-4 rounded-2xl text-[13px] font-black transition-all group ${activeTab === tab.id ? 'bg-amber-500 text-black shadow-xl shadow-amber-500/10 scale-[1.02]' : 'text-zinc-500 hover:bg-white/5'}`}
                            >
                                <i className={`fas fa-${tab.icon} w-6 text-center text-lg ${activeTab === tab.id ? 'text-black' : 'text-zinc-700 group-hover:text-zinc-400'}`}></i>
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                <div className="pt-8 border-t border-zinc-900">
                    <div className="bg-zinc-900/50 p-5 rounded-3xl border border-zinc-800">
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">جاهزية المحرك</span>
                            <span className="text-[10px] font-black text-amber-500">{calculateSetupProgress()}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 transition-all duration-1000" style={{width: `${calculateSetupProgress()}%`}}></div>
                        </div>
                    </div>
                </div>
             </div>

             {/* RIGHT Content */}
             <div className="flex-1 bg-gradient-to-br from-zinc-900/20 to-black/40 p-12 overflow-y-auto custom-scrollbar relative">
                <button onClick={() => setIsSettingsOpen(false)} className="absolute top-10 left-10 w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white flex items-center justify-center transition-all hover:scale-110 z-50">
                    <i className="fas fa-times text-xl"></i>
                </button>

                {activeTab === 'DASHBOARD' && (
                    <div className="space-y-12 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-4xl font-black text-white mb-3 tracking-tighter">تحية طيبة، أيها القائد.</h3>
                            <p className="text-zinc-500 text-lg font-medium">نظام ARKON يعمل حالياً. إليك حالة الأنظمة الأساسية.</p>
                        </header>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {[
                                {label: 'اتصال الجسر', status: bridgeStatus ? 'ONLINE' : 'OFFLINE', icon: 'link', color: bridgeStatus ? 'text-emerald-500' : 'text-rose-500'},
                                {label: 'إشارات التليجرام', status: config.telegramBotToken ? 'ACTIVE' : 'DISABLED', icon: 'paper-plane', color: config.telegramBotToken ? 'text-indigo-400' : 'text-zinc-600'},
                                {label: 'درع الأخبار', status: newsGuard.isPaused ? 'LOCKED' : 'READY', icon: 'shield-alt', color: newsGuard.isPaused ? 'text-amber-500' : 'text-emerald-400'}
                            ].map((item, idx) => (
                                <div key={idx} className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 flex flex-col items-center text-center gap-5 hover:border-zinc-700 transition-all">
                                    <div className={`w-20 h-20 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center ${item.color}`}>
                                        <i className={`fas fa-${item.icon} text-3xl`}></i>
                                    </div>
                                    <div>
                                        <h4 className="text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1">{item.label}</h4>
                                        <p className={`text-2xl font-black ${item.color}`}>{item.status}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'CONN' && (
                    <div className="space-y-12 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3">إعدادات الجسر (The Bridge Protocol)</h3>
                            <p className="text-zinc-500 text-sm">الجسر هو الرابط بين خوادم التحليل وميتاتريدر.</p>
                        </header>

                        <div className="grid grid-cols-1 gap-10">
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-10">
                                <div className="space-y-4">
                                    <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest block">رابط الجسر (Webhook URL)</label>
                                    <div className="flex gap-4">
                                        <input 
                                            type="text" 
                                            value={config.webhookUrl} 
                                            onChange={(e)=>setConfig({...config, webhookUrl: e.target.value})} 
                                            placeholder="http://127.0.0.1:3000"
                                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500/50 font-mono text-left" dir="ltr"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest block">مفتاح الأمان (Bridge Secret)</label>
                                    <input 
                                        type="password" 
                                        value={config.webhookSecret} 
                                        onChange={(e)=>setConfig({...config, webhookSecret: e.target.value})} 
                                        placeholder="ARKON_SECURE_PRIME"
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500/50 font-mono text-left" dir="ltr"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'RISK' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3">إدارة المخاطر والتعرض</h3>
                            <p className="text-zinc-500 text-sm">تحكم في حجم الحصص وبروتوكولات حماية رأس المال.</p>
                        </header>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8">
                                <h4 className="text-sm font-black text-amber-500 uppercase tracking-widest border-b border-zinc-800 pb-4">إعدادات الدخول والعدد</h4>
                                
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">سيف عدد الصفقات (Max Concurrent)</label>
                                    <input 
                                        type="number" 
                                        value={config.maxOpenTrades} 
                                        onChange={(e)=>setConfig({...config, maxOpenTrades: parseInt(e.target.value)})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono" 
                                    />
                                </div>

                                <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-black text-white uppercase">No Initial SL</span>
                                        <span className="text-[9px] text-zinc-500 font-bold">تعطيل الوقف الابتدائي لتفعيل الهيدج</span>
                                    </div>
                                    <button 
                                        onClick={() => setConfig({...config, disableInitialSL: !config.disableInitialSL})}
                                        className={`w-14 h-8 rounded-full transition-all relative ${config.disableInitialSL ? 'bg-rose-500' : 'bg-zinc-800'}`}
                                    >
                                        <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${config.disableInitialSL ? 'left-7' : 'left-1'}`}></div>
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">حجم اللوت الافتراضي (Default Lot)</label>
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        value={config.maxAllocationPerTrade} 
                                        onChange={(e)=>setConfig({...config, maxAllocationPerTrade: parseFloat(e.target.value)})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono" 
                                    />
                                </div>
                            </div>

                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8">
                                <h4 className="text-sm font-black text-amber-500 uppercase tracking-widest border-b border-zinc-800 pb-4">حماية رأس المال</h4>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">الخروج عند خسارة (%) من الرصيد</label>
                                    <input 
                                        type="number" 
                                        value={config.equityProtectionPercent} 
                                        onChange={(e)=>setConfig({...config, equityProtectionPercent: parseFloat(e.target.value)})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono" 
                                    />
                                </div>
                                <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                                    <span className="text-xs font-black text-zinc-400">التنفيذ التلقائي (Auto Exec)</span>
                                    <button 
                                        onClick={() => setConfig({...config, autoExecution: !config.autoExecution})}
                                        className={`w-14 h-8 rounded-full transition-all relative ${config.autoExecution ? 'bg-amber-500' : 'bg-zinc-800'}`}
                                    >
                                        <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${config.autoExecution ? 'left-7' : 'left-1'}`}></div>
                                    </button>
                                </div>
                                <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-black text-white uppercase">Hedge Mode Active</span>
                                        <span className="text-[9px] text-zinc-500 font-bold">تفعيل التحوط التلقائي عند انعكاس الإشارة</span>
                                    </div>
                                    <button 
                                        onClick={() => setConfig({...config, autoHedgeEnabled: !config.autoHedgeEnabled})}
                                        className={`w-14 h-8 rounded-full transition-all relative ${config.autoHedgeEnabled ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                                    >
                                        <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${config.autoHedgeEnabled ? 'left-7' : 'left-1'}`}></div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'PROT' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3">بروتوكولات القنص (Hunting Protocols)</h3>
                            <p className="text-zinc-500 text-sm">إدارة ذكية للصفقات المفتوحة وتأمين الأرباح.</p>
                        </header>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8">
                                <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-black text-white uppercase">One Trade Hunter</span>
                                        <span className="text-[9px] text-zinc-500 font-bold">انتظار التوافق التام للفريمات قبل الدخول</span>
                                    </div>
                                    <button 
                                        onClick={() => setConfig({...config, hunterMode: !config.hunterMode})}
                                        className={`w-14 h-8 rounded-full transition-all relative ${config.hunterMode ? 'bg-amber-500' : 'bg-zinc-800'}`}
                                    >
                                        <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${config.hunterMode ? 'left-7' : 'left-1'}`}></div>
                                    </button>
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">عتبة تأمين الأرباح (USD)</label>
                                    <input 
                                        type="number" 
                                        value={config.secureThreshold} 
                                        onChange={(e)=>setConfig({...config, secureThreshold: parseFloat(e.target.value)})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono" 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* بقية التبويبات المتبقية */}
                {activeTab === 'NOTIF' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                         <header>
                            <h3 className="text-3xl font-black text-white mb-3">ربط التليجرام (Telegram Relay)</h3>
                            <p className="text-zinc-500 text-sm">استقبل الإشارات والتقارير مباشرة على هاتفك.</p>
                        </header>

                        <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-10">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">مفتاح البوت (Bot Token)</label>
                                    <input 
                                        type="text" 
                                        value={config.telegramBotToken} 
                                        onChange={(e)=>setConfig({...config, telegramBotToken: e.target.value})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-indigo-500 font-mono text-left" dir="ltr"
                                    />
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">معرف المحادثة (Chat ID)</label>
                                    <input 
                                        type="text" 
                                        value={config.telegramChatId} 
                                        onChange={(e)=>setConfig({...config, telegramChatId: e.target.value})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-indigo-500 font-mono text-left" dir="ltr"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'EA' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3">كود المستشار الخبير (MQL5 EA)</h3>
                            <p className="text-zinc-500 text-sm">انسخ الكود التالي وضعه في MetaEditor 5 للربط مع المنصة.</p>
                        </header>
                        <div className="bg-zinc-950 border border-zinc-800 rounded-[2.5rem] p-10 h-[500px] overflow-auto custom-scrollbar font-mono text-[11px] text-zinc-400 leading-relaxed text-left" dir="ltr">
                            <pre>{MQL5_CODE}</pre>
                        </div>
                    </div>
                )}

                {activeTab === 'NEWS' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3">رادار الأخبار (News Shield)</h3>
                            <p className="text-zinc-500 text-sm">توقف عن التداول تلقائياً خلال الأخبار عالية التأثير.</p>
                        </header>
                        <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 space-y-6">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">الإيقاف قبل الخبر (دقائق)</label>
                                <input 
                                    type="number" 
                                    value={config.newsBypassMinutes} 
                                    onChange={(e)=>setConfig({...config, newsBypassMinutes: parseInt(e.target.value)})} 
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono" 
                                />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'SYSTEM' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                         <header>
                            <h3 className="text-3xl font-black text-white mb-3">إدارة النظام والبيانات</h3>
                        </header>
                        <div className="p-8 bg-rose-950/10 rounded-[2.5rem] border border-rose-900/20">
                            <button 
                                onClick={() => {
                                    if(confirm('إعادة ضبط المصنع؟')) {
                                        localStorage.removeItem(`arkon_config_v${CURRENT_VERSION}`);
                                        window.location.reload();
                                    }
                                }}
                                className="w-full py-4 rounded-xl bg-rose-600/20 border border-rose-600/30 text-rose-500 font-black uppercase text-[10px] tracking-[0.2em] hover:bg-rose-600 hover:text-white transition-all"
                            >
                                إعادة ضبط المحرك (RESET ALL)
                            </button>
                        </div>
                    </div>
                )}
             </div>
          </div>
        </div>
      )}

      {/* Main Terminal Header */}
      <header className="flex justify-between items-center mb-10">
          <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.1)]">
                  <span className="text-black font-black text-3xl">A</span>
              </div>
              <div>
                  <h1 className="text-4xl font-black text-white tracking-tighter uppercase leading-none">ARKON <span className="text-zinc-600">QUANT</span></h1>
                  <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-500 px-3 py-1 rounded-full font-bold uppercase tracking-widest">v{CURRENT_VERSION}</span>
                      <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${bridgeStatus ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'}`}></div>
                          <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{bridgeStatus ? 'Bridge Active' : 'Bridge Offline'}</span>
                      </div>
                  </div>
              </div>
          </div>

          <div className="flex items-center gap-4">
               <button 
                onClick={() => setIsSettingsOpen(true)}
                className="group flex items-center gap-4 bg-zinc-950 border border-zinc-800 hover:border-amber-500/50 px-8 py-4 rounded-3xl transition-all hover:shadow-[0_0_30px_rgba(245,158,11,0.1)]"
               >
                   <div className="text-right">
                       <span className="block text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-0.5">Engine Setup</span>
                       <span className="block text-xs font-black text-white">إعدادات المحرك</span>
                   </div>
                   <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center group-hover:bg-amber-500 group-hover:text-black transition-all">
                       <i className="fas fa-sliders-h text-lg"></i>
                   </div>
               </button>
          </div>
      </header>

      {/* Dashboard Grid */}
      <main className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-stretch h-full">
          <div className="xl:col-span-8 space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
                  <MarketStats title="BITCOIN CORE" state={btcAnalysis} />
                  <MarketStats title="ETHEREUM CORE" state={ethAnalysis} />
              </div>

              <div className="glass-card rounded-[3rem] p-10 border border-zinc-800">
                  <div className="flex justify-between items-center mb-8">
                      <div className="flex items-center gap-4">
                          <div className="w-1.5 h-6 bg-amber-500 rounded-full"></div>
                          <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Signal <span className="text-zinc-600">Archive</span></h3>
                      </div>
                      <div className="flex items-center gap-4">
                          <div className="bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-xl flex items-center gap-2">
                               <span className="text-[10px] font-black text-zinc-500 uppercase">Live Hedge:</span>
                               <span className={`text-[10px] font-black ${config.disableInitialSL ? 'text-emerald-500' : 'text-zinc-600'}`}>{config.disableInitialSL ? 'ACTIVE (NO SL)' : 'INACTIVE'}</span>
                          </div>
                          <div className="bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-xl flex items-center gap-2">
                               <span className="text-[10px] font-black text-zinc-500 uppercase">Cap:</span>
                               <span className="text-[10px] font-black text-amber-500">{managedTrades.length}/{config.maxOpenTrades}</span>
                          </div>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {signals.length === 0 ? (
                          <div className="col-span-full py-20 text-center">
                              <i className="fas fa-radar text-4xl text-zinc-800 mb-4 animate-pulse"></i>
                              <p className="text-zinc-600 font-bold uppercase tracking-widest text-[10px]">Scanning markets for alpha...</p>
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
                            />
                          ))
                      )}
                  </div>
              </div>
          </div>

          <div className="xl:col-span-4 space-y-8 flex flex-col h-full">
              <div className="glass-card rounded-[3rem] border border-zinc-800 p-8 flex flex-col gap-6 bg-zinc-950/30">
                  <div className="flex justify-between items-center">
                      <h3 className="text-lg font-black text-white uppercase tracking-widest">Active <span className="text-zinc-600">Positions</span></h3>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full text-[10px] font-black text-emerald-500">{managedTrades.length} LIVE</div>
                  </div>

                  <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                      {managedTrades.length === 0 ? (
                          <div className="py-10 text-center border border-dashed border-zinc-800 rounded-3xl">
                              <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">No exposure active</span>
                          </div>
                      ) : (
                          managedTrades.map((trade, i) => (
                              <div key={i} className="p-5 bg-zinc-900/40 rounded-[2rem] border border-zinc-800 flex justify-between items-center group hover:border-zinc-600 transition-all">
                                  <div className="flex items-center gap-4">
                                      <div className={`w-2 h-2 rounded-full ${trade.direction === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                                      <div>
                                          <h4 className="text-xs font-black text-white leading-none mb-1">{trade.asset}</h4>
                                          <span className="text-[9px] font-mono text-zinc-600">{trade.volume} Lot @ {trade.entryPrice.toLocaleString()}</span>
                                      </div>
                                  </div>
                                  <div className="text-right">
                                      <div className={`text-sm font-mono font-black ${trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                          {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} USD
                                      </div>
                                      <span className="text-[8px] font-black text-zinc-700 uppercase">{trade.direction}</span>
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </div>

              <div className="flex-1 min-h-[400px]">
                  <TradeLog 
                      logs={logs} 
                      activeTradesCount={managedTrades.length} 
                      managedTrades={managedTrades} 
                      onCloseTrade={(asset) => {
                          const sig = signals.find(s => s.asset.includes(asset));
                          if (sig) handleSendSignal(sig, 'EXIT');
                      }} 
                  />
              </div>
          </div>
      </main>

      <footer className="mt-12 pt-8 border-t border-zinc-900/50 flex justify-between items-center text-zinc-700">
           <div className="text-[10px] font-black uppercase tracking-[0.3em]">ARKON PRIME // QUANTITATIVE RESEARCH DIVISION</div>
      </footer>
    </div>
  );
};

export default App;
