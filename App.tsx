
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

const CURRENT_VERSION = '30.5.0'; 
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
  const [activeTab, setActiveTab] = useState<'CONN' | 'NOTIF' | 'PROT' | 'RISK' | 'NEWS' | 'SYSTEM' | 'DASHBOARD' | 'EA'>('DASHBOARD');
  const [bridgeStatus, setBridgeStatus] = useState<boolean | null>(null);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [copiedType, setCopiedType] = useState<'MQL' | 'BRIDGE' | 'SECRET' | null>(null);
  
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

  const handleCopyCode = (type: 'MQL' | 'BRIDGE' | 'SECRET', code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
    addLog(`تم نسخ ${type} إلى الحافظة`, "INFO");
  };

  const handleSendSignal = async (signal: TradingSignal, overrideAction?: any): Promise<boolean> => {
    const assetPure = signal.asset.split('-')[0];
    
    if (managedTrades.length >= config.maxOpenTrades && !overrideAction) {
        addLog(`حظر: تم الوصول للحد الأقصى من الصفقات (${config.maxOpenTrades})`, 'RISK');
        return false;
    }

    if (bridgeStatus === false) {
      addLog(`فشل الإرسال: الجسر غير متصل`, 'ERROR');
      return false;
    }

    let actionType: any = overrideAction || 'ENTRY';
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

  const testTelegram = async () => {
    setIsTestingTg(true);
    const res = await sendTestMessage(config.telegramBotToken, config.telegramChatId, config.webhookUrl);
    if (res.success) addLog("تم إرسال رسالة اختبار بنجاح", "INFO");
    else addLog(`خطأ تليجرام: ${res.error}`, "ERROR");
    setIsTestingTg(false);
  };

  const resetBridge = async () => {
      if (window.confirm("هل تريد تصفير الجسر وإغلاق مراقبة الصفقات؟")) {
          const ok = await clearRemoteBridge(config.webhookUrl);
          if (ok) {
              setManagedTrades([]);
              securedTicketsRef.current.clear();
              addLog("تم تصفير حالة الجسر بنجاح", "SYSTEM");
          }
      }
  };

  return (
    <div className="min-h-screen pb-12 px-6 pt-8 max-w-[1920px] mx-auto space-y-6 text-right font-sans" dir="rtl">
      
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-2xl animate-in fade-in zoom-in duration-300">
          <div className="glass-card w-full max-w-7xl rounded-[3.5rem] border-zinc-800 p-0 shadow-[0_0_100px_rgba(0,0,0,1)] relative overflow-hidden flex flex-col md:flex-row h-[92vh]" dir="rtl">
             
             {/* Sidebar Menu */}
             <div className="w-full md:w-80 border-l border-zinc-800 bg-zinc-950/90 p-10 flex flex-col justify-between overflow-y-auto">
                <div>
                    <div className="flex items-center gap-5 mb-12">
                        <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-amber-500/20">
                            <i className="fas fa-microchip text-black text-2xl"></i>
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white leading-tight">مركز التحكم</h2>
                            <p className="text-[10px] text-amber-500 font-black uppercase tracking-[0.2em] mt-1">ARKON PRIME ENGINE</p>
                        </div>
                    </div>

                    <nav className="space-y-3">
                        {[
                            {id: 'DASHBOARD', label: 'الحالة العامة', icon: 'grip-vertical'},
                            {id: 'PROT', label: 'تأمين الصفقات', icon: 'shield-halved'},
                            {id: 'RISK', label: 'إدارة المخاطر', icon: 'chart-pie'},
                            {id: 'CONN', label: 'اتصال الجسر', icon: 'bolt'},
                            {id: 'NOTIF', label: 'التنبيهات', icon: 'paper-plane'},
                            {id: 'NEWS', label: 'رادار الأخبار', icon: 'satellite-dish'},
                            {id: 'EA', label: 'كود الاكسبيرت', icon: 'code'},
                            {id: 'SYSTEM', label: 'صيانة النظام', icon: 'gears'}
                        ].map(tab => (
                            <button 
                                key={tab.id} 
                                onClick={() => setActiveTab(tab.id as any)} 
                                className={`w-full flex items-center gap-5 px-6 py-4 rounded-2xl text-[13px] font-black transition-all group ${activeTab === tab.id ? 'bg-amber-500 text-black shadow-xl shadow-amber-500/10 scale-[1.02]' : 'text-zinc-500 hover:bg-white/5'}`}
                            >
                                <i className={`fas fa-${tab.icon} w-6 text-center text-lg ${activeTab === tab.id ? 'text-black' : 'text-zinc-700'}`}></i>
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
                <div className="mt-10 border-t border-zinc-900 pt-10">
                    <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-widest mb-2">Engine Version</p>
                    <span className="text-xs font-mono font-black text-zinc-500">{CURRENT_VERSION} [STABLE]</span>
                </div>
             </div>

             {/* Settings Content Area */}
             <div className="flex-1 bg-gradient-to-br from-zinc-900/20 to-black/40 p-12 overflow-y-auto custom-scrollbar relative">
                <button onClick={() => setIsSettingsOpen(false)} className="absolute top-10 left-10 w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white flex items-center justify-center transition-all hover:scale-110 z-50">
                    <i className="fas fa-times text-xl"></i>
                </button>

                {/* Dashboard Tab */}
                {activeTab === 'DASHBOARD' && (
                    <div className="space-y-10 animate-in slide-in-from-bottom duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3 tracking-tighter uppercase">ملخص الحالة العامة</h3>
                            <p className="text-zinc-500 text-sm">نظرة شاملة على أداء المحرك وارتباطه بالمنصات الخارجية.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {[
                                {label: 'جسر التنفيذ', val: bridgeStatus ? 'CONNECTED' : 'OFFLINE', color: bridgeStatus ? 'text-emerald-500' : 'text-rose-500'},
                                {label: 'صفقات نشطة', val: managedTrades.length, color: 'text-amber-500'},
                                {label: 'رادار الأخبار', val: newsGuard.isPaused ? 'LOCKED' : 'SCANNING', color: newsGuard.isPaused ? 'text-rose-500' : 'text-emerald-500'}
                            ].map((stat, i) => (
                                <div key={i} className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex flex-col gap-2 shadow-inner">
                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">{stat.label}</span>
                                    <span className={`text-2xl font-black ${stat.color}`}>{stat.val}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Risk Management Tab */}
                {activeTab === 'RISK' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3 uppercase tracking-tighter">إدارة المخاطر والسعة</h3>
                            <p className="text-zinc-500 text-sm">تخصيص حدود التعرض الابتدائي وسياسة وقف الخسارة.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8 shadow-xl">
                                <h4 className="text-xs font-black text-amber-500 uppercase tracking-widest border-b border-zinc-800 pb-4">سعة المحرك</h4>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">الحد الأقصى للصفقات المتزامنة</label>
                                    <input type="number" value={config.maxOpenTrades} onChange={(e)=>setConfig({...config, maxOpenTrades: parseInt(e.target.value)})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-xl" />
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">حجم اللوت لكل صفقة (ثابت)</label>
                                    <input type="number" step="0.01" value={config.maxAllocationPerTrade} onChange={(e)=>setConfig({...config, maxAllocationPerTrade: parseFloat(e.target.value)})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono text-xl" />
                                </div>
                            </div>
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8 shadow-xl">
                                <h4 className="text-xs font-black text-amber-500 uppercase tracking-widest border-b border-zinc-800 pb-4">إعدادات وضع الهيدج</h4>
                                <div className="flex items-center justify-between p-6 bg-zinc-900/50 rounded-3xl border border-zinc-800 group hover:border-rose-500/30 transition-all">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-black text-white uppercase group-hover:text-rose-400 transition-colors">Zero-SL Mode (Start)</span>
                                        <span className="text-[9px] text-zinc-500 font-bold mt-1">بدء الصفقات بدون ستوب لوز لضمان المرونة</span>
                                    </div>
                                    <button onClick={() => setConfig({...config, disableInitialSL: !config.disableInitialSL})} className={`w-14 h-8 rounded-full transition-all relative ${config.disableInitialSL ? 'bg-rose-500' : 'bg-zinc-800'}`}>
                                        <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${config.disableInitialSL ? 'left-7' : 'left-1'}`}></div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Protection Tab */}
                {activeTab === 'PROT' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3 uppercase tracking-tighter">تأمين الصفقات الفردية</h3>
                            <p className="text-zinc-500 text-sm">حماية الأرباح المحققة لكل تذكرة تداول بشكل مستقل.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8 shadow-xl">
                                <h4 className="text-xs font-black text-amber-500 uppercase tracking-widest border-b border-zinc-800 pb-4">بروتوكول التأمين التلقائي</h4>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">عتبة الأمان (ربح بـ $)</label>
                                    <input type="number" value={config.secureThreshold} onChange={(e)=>setConfig({...config, secureThreshold: parseFloat(e.target.value)})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono" />
                                </div>
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">نسبة الإغلاق الجزئي عند التأمين (%)</label>
                                    <input type="number" value={config.partialClosePercent} onChange={(e)=>setConfig({...config, partialClosePercent: parseFloat(e.target.value)})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Connection Tab */}
                {activeTab === 'CONN' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3 uppercase tracking-tighter">اتصال الجسر (Web Relay)</h3>
                            <p className="text-zinc-500 text-sm">تكوين قناة الاتصال بين المحرك والمنصة المنفذة.</p>
                        </header>
                        <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">رابط الجسر (Webhook URL)</label>
                                <div className="relative">
                                    <input type="text" value={config.webhookUrl} onChange={(e)=>setConfig({...config, webhookUrl: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono" />
                                    <button onClick={()=>handleCopyCode('BRIDGE', config.webhookUrl)} className="absolute left-4 top-4 text-zinc-600 hover:text-white"><i className="fas fa-copy"></i></button>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">مفتاح الأمان السري (Secret Key)</label>
                                <div className="relative">
                                    <input type="password" value={config.webhookSecret} onChange={(e)=>setConfig({...config, webhookSecret: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500 font-mono" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Telegram Notifications Tab */}
                {activeTab === 'NOTIF' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3 uppercase tracking-tighter">إشعارات تليجرام</h3>
                            <p className="text-zinc-500 text-sm">تلقي تقارير التنفيذ وتأمين الصفقات مباشرة على هاتفك.</p>
                        </header>
                        <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Bot Token</label>
                                <input type="text" value={config.telegramBotToken} onChange={(e)=>setConfig({...config, telegramBotToken: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono" placeholder="123456789:ABC..." />
                            </div>
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Chat ID</label>
                                <input type="text" value={config.telegramChatId} onChange={(e)=>setConfig({...config, telegramChatId: e.target.value})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500 font-mono" placeholder="-100..." />
                            </div>
                            <button onClick={testTelegram} disabled={isTestingTg} className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:bg-zinc-200 transition-all flex items-center justify-center gap-3">
                                {isTestingTg ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-paper-plane"></i>}
                                إرسال رسالة اختبار
                            </button>
                        </div>
                    </div>
                )}

                {/* EA Code Tab */}
                {activeTab === 'EA' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500 h-full flex flex-col">
                        <header className="flex justify-between items-center">
                            <div>
                                <h3 className="text-3xl font-black text-white mb-3 uppercase tracking-tighter">كود الاكسبيرت (MQL5)</h3>
                                <p className="text-zinc-500 text-sm">قم بنسخ هذا الكود ولصقه في MetaEditor 5 لبناء الجسر التنفيذي.</p>
                            </div>
                            <button onClick={()=>handleCopyCode('MQL', MQL5_CODE)} className="bg-amber-500 text-black px-8 py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:scale-105 transition-all">
                                {copiedType === 'MQL' ? 'تم النسخ ✅' : 'نسخ الكود بالكامل'}
                            </button>
                        </header>
                        <div className="flex-1 bg-zinc-950/80 rounded-[2.5rem] border border-zinc-800 p-8 font-mono text-xs overflow-auto custom-scrollbar text-left" dir="ltr">
                            <pre className="text-emerald-500/80 leading-relaxed whitespace-pre-wrap">{MQL5_CODE}</pre>
                        </div>
                    </div>
                )}

                {/* System Maintenance Tab */}
                {activeTab === 'SYSTEM' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-3 uppercase tracking-tighter">صيانة النظام والذاكرة</h3>
                            <p className="text-zinc-500 text-sm">أدوات متقدمة لتنظيف الذاكرة المؤقتة وإعادة ضبط الحالة.</p>
                        </header>
                        <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-6">
                            <div className="p-8 bg-rose-500/5 border border-rose-500/20 rounded-[2rem] flex items-center justify-between">
                                <div>
                                    <h5 className="text-rose-500 font-black uppercase text-sm mb-1">تصفير الجسر (Full Reset)</h5>
                                    <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">مسح طابور الإشارات وحالة الصفقات النشطة نهائياً من الذاكرة.</p>
                                </div>
                                <button onClick={resetBridge} className="bg-rose-600 hover:bg-rose-500 text-white px-8 py-4 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all">تفعيل المسح</button>
                            </div>
                        </div>
                    </div>
                )}
             </div>
          </div>
        </div>
      )}

      {/* Main Terminal Interface */}
      <header className="flex justify-between items-center mb-10 px-4">
          <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center shadow-2xl shadow-white/5 relative group cursor-pointer">
                  <span className="text-black font-black text-3xl">A</span>
                  <div className="absolute -inset-1 bg-white/20 rounded-3xl blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
              </div>
              <div>
                  <h1 className="text-4xl font-black text-white uppercase tracking-tighter">ARKON <span className="text-zinc-600">QUANT</span></h1>
                  <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-500 px-3 py-1 rounded-full font-bold uppercase tracking-widest">v{CURRENT_VERSION}</span>
                      <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${bridgeStatus ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'}`}></div>
                          <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{bridgeStatus ? 'Relay Active' : 'Relay Offline'}</span>
                      </div>
                  </div>
              </div>
          </div>

          <div className="flex items-center gap-4">
              <div className="hidden lg:flex items-center gap-8 ml-8 bg-zinc-950/50 border border-zinc-900 px-10 py-4 rounded-[2rem]">
                  <div className="text-center">
                      <span className="block text-[8px] font-black text-zinc-600 uppercase mb-0.5">Active Load</span>
                      <span className="text-sm font-black text-white">{managedTrades.length}/{config.maxOpenTrades}</span>
                  </div>
                  <div className="w-px h-8 bg-zinc-900"></div>
                  <div className="text-center">
                      <span className="block text-[8px] font-black text-zinc-600 uppercase mb-0.5">Global Safeguard</span>
                      <span className={`text-sm font-black ${newsGuard.isPaused ? 'text-rose-500' : 'text-emerald-500'}`}>{newsGuard.isPaused ? 'LOCKED' : 'READY'}</span>
                  </div>
              </div>

              <button onClick={() => setIsSettingsOpen(true)} className="group flex items-center gap-4 bg-zinc-950 border border-zinc-800 hover:border-amber-500/50 px-8 py-4 rounded-[2rem] transition-all shadow-xl hover:shadow-amber-500/5">
                   <div className="text-right">
                       <span className="block text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-0.5">Settings Hub</span>
                       <span className="block text-xs font-black text-white">إعدادات المحرك</span>
                   </div>
                   <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center group-hover:bg-amber-500 group-hover:text-black transition-all">
                       <i className="fas fa-sliders-h text-lg"></i>
                   </div>
              </button>
          </div>
      </header>

      <main className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-stretch h-full">
          {/* Main Grid: Left Column (Analysis & Signals) */}
          <div className="xl:col-span-8 space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <MarketStats title="BITCOIN CORE" state={btcAnalysis} />
                  <MarketStats title="ETHEREUM CORE" state={ethAnalysis} />
              </div>

              <div className="glass-card rounded-[3.5rem] p-10 border border-zinc-800 bg-zinc-950/20">
                  <div className="flex justify-between items-center mb-10">
                      <div className="flex items-center gap-4">
                          <div className="w-2 h-8 bg-amber-500 rounded-full"></div>
                          <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Quantum <span className="text-zinc-600">Archive</span></h3>
                      </div>
                      <div className="text-[10px] font-black text-zinc-700 uppercase tracking-widest bg-zinc-900 px-4 py-2 rounded-xl border border-zinc-800">Showing Last 50 Events</div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {signals.length === 0 ? (
                        <div className="col-span-full py-20 text-center border border-dashed border-zinc-800 rounded-[3rem] opacity-50">
                            <i className="fas fa-crosshairs text-3xl text-zinc-800 mb-4 block"></i>
                            <span className="text-xs font-black text-zinc-700 uppercase tracking-widest">Scanning market for institutional alignment...</span>
                        </div>
                      ) : (
                        signals.map(sig => (
                          <SignalCard key={sig.id} signal={sig} onSend={handleSendSignal} sending={sendingRef.current[sig.id] || false} userRiskCap={config.maxAllocationPerTrade} isActive={managedTrades.some(t => t.signalId === sig.id)} />
                        ))
                      )}
                  </div>
              </div>
          </div>

          {/* Sidebar Grid: Right Column (Live Portfolio) */}
          <div className="xl:col-span-4 space-y-8 flex flex-col h-full">
              <div className="glass-card rounded-[3.5rem] border border-zinc-800 p-10 flex flex-col gap-8 bg-zinc-950/40 relative overflow-hidden flex-1 shadow-2xl">
                  {/* Glowing decoration */}
                  <div className="absolute -top-20 -right-20 w-40 h-40 bg-indigo-500/10 rounded-full blur-[100px]"></div>

                  <div className="flex justify-between items-end">
                      <div>
                          <h3 className="text-xl font-black text-white uppercase tracking-widest">Exposure <span className="text-zinc-600">Sync</span></h3>
                          <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Real-time MT5 Monitor</p>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-2xl text-[11px] font-black text-emerald-500">{managedTrades.length} ACTIVE</div>
                  </div>

                  <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2 max-h-[60vh]">
                      {managedTrades.length === 0 ? (
                          <div className="py-24 text-center border border-dashed border-zinc-800/40 rounded-[2.5rem] bg-zinc-900/10">
                              <div className="w-12 h-12 rounded-full border border-zinc-800 mx-auto flex items-center justify-center mb-4 text-zinc-800">
                                  <i className="fas fa-radar"></i>
                              </div>
                              <span className="text-[9px] font-black text-zinc-700 uppercase tracking-widest">No exposure detected on MT5 terminals.</span>
                          </div>
                      ) : (
                          managedTrades.map((trade, i) => {
                              const progress = Math.min((trade.pnl / config.secureThreshold) * 100, 100);
                              const isSecured = securedTicketsRef.current.has(trade.ticket.toString());

                              return (
                                <div key={i} className="p-8 bg-zinc-900/40 rounded-[2.5rem] border border-zinc-800/60 space-y-6 hover:border-zinc-700 transition-all group relative overflow-hidden shadow-lg">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-4 h-4 rounded-full ${trade.direction === 'LONG' ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]'}`}></div>
                                            <div>
                                                <h4 className="text-sm font-black text-white uppercase tracking-tighter">{trade.asset}</h4>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] font-black text-zinc-500 uppercase">{trade.volume} Lot</span>
                                                    <span className="text-[10px] text-zinc-700 font-bold">//</span>
                                                    <span className={`text-[10px] font-black uppercase ${trade.direction === 'LONG' ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>{trade.direction}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-xl font-mono font-black tracking-tighter ${trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} <span className="text-[10px]">USD</span>
                                            </div>
                                            {isSecured && <span className="text-[8px] bg-emerald-500 text-black px-2 py-0.5 rounded-md font-black uppercase tracking-widest mt-1 inline-block">SECURED</span>}
                                        </div>
                                    </div>

                                    {/* Security Progress Meter */}
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-[8px] font-black uppercase tracking-widest px-1">
                                            <span className="text-zinc-600">Security Gateway (Goal: ${config.secureThreshold})</span>
                                            <span className={progress >= 100 ? 'text-emerald-500' : 'text-zinc-500'}>{progress >= 100 ? 'LOCKED' : Math.round(progress) + '%'}</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden p-[2px]">
                                            <div className={`h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(245,158,11,0.2)] ${progress >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{width: `${progress}%`}}></div>
                                        </div>
                                    </div>
                                    
                                    {/* Sub-details */}
                                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-zinc-900/50">
                                        <div>
                                            <span className="text-[7px] font-black text-zinc-700 uppercase block">Ticket #</span>
                                            <span className="text-[10px] font-mono text-zinc-500">{trade.ticket}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[7px] font-black text-zinc-700 uppercase block">Entry Price</span>
                                            <span className="text-[10px] font-mono text-zinc-500">${trade.entryPrice.toLocaleString()}</span>
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
