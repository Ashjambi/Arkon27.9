
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMarketSummary, fetchCandles, fetchDVOL, fetchOptionsVolume, fetchOrderBook, fetchHistoricalContext } from './services/deribitService';
import { generateSignal } from './services/tradingAlgo';
import { sendToWebhook, checkBridgeStatus, fetchBridgeState } from './services/webhookService';
import { sendTestMessage, sendSignalToTelegram } from './services/telegramService';
import { getIncomingHighImpactEvents, checkNewsImpactStatus } from './services/newsService';
import { TradingSignal, AppConfig, LogEntry, LogType, MarketAnalysisState, EconomicEvent } from './types';
import { MQL5_CODE } from './utils/mqlCode';
import MarketStats from './components/MarketStats';
import TradeLog from './components/TradeLog';

const CURRENT_VERSION = '27.9.0'; 
const MIN_SCORE_THRESHOLD = 75; 

const DEFAULT_CONFIG: AppConfig = {
  telegramBotToken: '',
  telegramChatId: '',
  webhookUrl: 'http://127.0.0.1:3000',
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
  globalProfitTargetUSD: 500,
  perTradeProfitTargetUSD: 100
};

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(() => {
    const vCurrent = localStorage.getItem(`arkon_config_v${CURRENT_VERSION}`);
    if (vCurrent) return JSON.parse(vCurrent);
    return DEFAULT_CONFIG;
  });

  const [activeSignals, setActiveSignals] = useState<{[key: string]: TradingSignal}>({});
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
  const [copied, setCopied] = useState(false);
  
  const sendingRef = useRef<Record<string, boolean>>({});
  const sentSignalsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((message: string, type: LogType = 'INFO', details?: string | object) => {
      setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), type, message, details }, ...prev].slice(150)); 
  }, []);

  useEffect(() => {
    localStorage.setItem(`arkon_config_v${CURRENT_VERSION}`, JSON.stringify(config));
  }, [config]);

  const handleCopyMQL = () => {
    navigator.clipboard.writeText(MQL5_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    addLog("تم نسخ كود Expert Advisor إلى الحافظة", "INFO");
  };

  const handleTestTelegram = async () => {
      setIsTestingTg(true);
      const res = await sendTestMessage(config.telegramBotToken, config.telegramChatId, config.webhookUrl);
      if (res.success) addLog("Telegram test message sent successfully", "INFO");
      else addLog(`Telegram test failed: ${res.error}`, "ERROR");
      setIsTestingTg(false);
  };

  const handleSendSignal = async (signal: TradingSignal, overrideAction?: any): Promise<boolean> => {
    if (!overrideAction && signal.qualityScore < MIN_SCORE_THRESHOLD) return false;
    const assetPure = signal.asset.split('-')[0];
    let actionType: any = overrideAction || 'ENTRY';

    if (sendingRef.current[signal.id]) return false;
    sendingRef.current[signal.id] = true;

    try {
        const result = await sendToWebhook(signal, config.webhookUrl, 0.0, actionType, config.maxAllocationPerTrade);
        if (result.success) {
            if (config.telegramBotToken && config.telegramChatId) {
                sendSignalToTelegram(signal, config.telegramChatId, config.telegramBotToken, actionType, signal.reasoning, config.webhookUrl).catch(() => {});
            }
            if (!overrideAction) sentSignalsRef.current.add(signal.id);
            addLog(`✅ EXEC: ${actionType} ${assetPure}`, 'EXEC');
            return true;
        } 
    } catch (err: any) { addLog(`Bridge Link Failed`, 'ERROR'); }
    finally { sendingRef.current[signal.id] = false; }
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
               setActiveSignals(prev => ({ ...prev, [asset]: signal }));
               if (config.autoExecution && signal.qualityScore >= MIN_SCORE_THRESHOLD && !newsGuard.isPaused) handleSendSignal(signal);
          }
      }
    } catch (e: any) { addLog(`Feed Error: ${asset}`, 'ERROR'); }
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

  return (
    <div className="min-h-screen pb-12 px-6 pt-8 max-w-[1920px] mx-auto space-y-6 text-right font-sans" dir="rtl">
      
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in zoom-in duration-300">
          <div className="glass-card w-full max-w-6xl rounded-[3rem] border-zinc-800 p-0 shadow-2xl relative overflow-hidden text-right flex flex-col md:flex-row h-[90vh]" dir="rtl">
             
             {/* LEFT Sidebar (Navigation) */}
             <div className="w-full md:w-80 border-l border-zinc-800 bg-zinc-950/80 p-8 flex flex-col justify-between overflow-y-auto">
                <div>
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                            <i className="fas fa-microchip text-black text-xl"></i>
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white leading-none">إعدادات المحرك</h2>
                            <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-1">ARKON CORE v{CURRENT_VERSION}</p>
                        </div>
                    </div>

                    <nav className="space-y-2">
                        {[
                            {id: 'DASHBOARD', label: 'نظرة عامة', icon: 'th-large'},
                            {id: 'CONN', label: 'الجسر والاتصال', icon: 'link'},
                            {id: 'EA', label: 'كود الميتا (MQL5)', icon: 'code'},
                            {id: 'NOTIF', label: 'التليجرام والإشعارات', icon: 'paper-plane'},
                            {id: 'NEWS', label: 'درع الأخبار', icon: 'newspaper'},
                            {id: 'PROT', label: 'بروتوكولات القنص', icon: 'shield-alt'},
                            {id: 'RISK', label: 'إدارة المخاطر والأهداف', icon: 'chart-pie'},
                            {id: 'SYSTEM', label: 'إعدادات النظام', icon: 'terminal'}
                        ].map(tab => (
                            <button 
                                key={tab.id} 
                                onClick={() => setActiveTab(tab.id as any)} 
                                className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-xs font-black transition-all ${activeTab === tab.id ? 'bg-amber-500 text-black shadow-xl shadow-amber-500/10' : 'text-zinc-500 hover:bg-white/5'}`}
                            >
                                <i className={`fas fa-${tab.icon} w-5 text-center`}></i>
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                <div className="pt-8 border-t border-zinc-900 mt-4">
                    <div className="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[10px] font-black text-zinc-500 uppercase">اكتمال الضبط</span>
                            <span className="text-[10px] font-black text-amber-500">{calculateSetupProgress()}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 transition-all duration-1000" style={{width: `${calculateSetupProgress()}%`}}></div>
                        </div>
                    </div>
                </div>
             </div>

             {/* RIGHT Content Area */}
             <div className="flex-1 bg-zinc-900/20 p-10 overflow-y-auto custom-scrollbar relative">
                <button onClick={() => setIsSettingsOpen(false)} className="absolute top-8 left-8 text-zinc-500 hover:text-white transition-colors z-10">
                    <i className="fas fa-times text-2xl"></i>
                </button>

                {activeTab === 'DASHBOARD' && (
                    <div className="space-y-8 animate-in slide-in-from-left duration-500 text-right">
                        <header>
                            <h3 className="text-3xl font-black text-white mb-2 tracking-tighter">لوحة التحكم المركزية</h3>
                            <p className="text-zinc-500 text-sm">مرحباً بك في مركز قيادة ARKON. إليك حالة الأنظمة والوصول السريع للإعدادات.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex items-center gap-6">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${bridgeStatus ? 'bg-emerald-500 border-emerald-400 text-black shadow-lg shadow-emerald-500/20' : 'bg-zinc-900 border-zinc-800 text-zinc-600'}`}>
                                    <i className="fas fa-link text-2xl"></i>
                                </div>
                                <div>
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">حالة الجسر</h4>
                                    <p className={`text-xl font-black ${bridgeStatus ? 'text-emerald-500' : 'text-rose-500'}`}>{bridgeStatus ? 'متصل' : 'غير متصل'}</p>
                                </div>
                            </div>
                            <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex items-center gap-6">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${config.telegramBotToken ? 'bg-indigo-500 border-indigo-400 text-black' : 'bg-zinc-900 border-zinc-800 text-zinc-600'}`}>
                                    <i className="fas fa-paper-plane text-2xl"></i>
                                </div>
                                <div>
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">تليجرام</h4>
                                    <p className={`text-xl font-black ${config.telegramBotToken ? 'text-indigo-400' : 'text-zinc-500'}`}>{config.telegramBotToken ? 'مفعل' : 'معطل'}</p>
                                </div>
                            </div>
                            <div className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex items-center gap-6">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${newsGuard.isPaused ? 'bg-amber-500 border-amber-400 text-black' : 'bg-zinc-900 border-zinc-800 text-zinc-600'}`}>
                                    <i className="fas fa-shield-alt text-2xl"></i>
                                </div>
                                <div>
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">درع الأخبار</h4>
                                    <p className={`text-xl font-black ${newsGuard.isPaused ? 'text-amber-500' : 'text-emerald-500'}`}>{newsGuard.isPaused ? 'مؤمن (توقف)' : 'نشط (تداول)'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'EA' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500 text-right">
                        <header>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tighter">كود الـ Expert Advisor (MQL5)</h3>
                            <p className="text-zinc-500 text-sm">قم بنسخ هذا الكود ولصقه في محرر MetaEditor داخل منصة MT5 لربط ARKON بحسابك الحقيقي.</p>
                        </header>
                        
                        <div className="relative group">
                            <div className="absolute top-6 left-6 flex items-center gap-3">
                                <button 
                                    onClick={handleCopyMQL}
                                    className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl ${copied ? 'bg-emerald-500 text-black' : 'bg-amber-500 text-black hover:bg-amber-400'}`}
                                >
                                    <i className={`fas fa-${copied ? 'check' : 'copy'} mr-2`}></i>
                                    {copied ? 'تم النسخ!' : 'نسخ الكود بالكامل'}
                                </button>
                            </div>
                            <div className="bg-black/80 rounded-[2rem] p-10 border border-zinc-800 font-mono text-xs text-zinc-400 overflow-x-auto custom-scrollbar max-h-[60vh] text-left" dir="ltr">
                                <pre className="whitespace-pre">{MQL5_CODE}</pre>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {[
                                {icon: 'file-code', title: '1. إنشاء ملف', desc: 'افتح MetaEditor وأنشئ Expert Advisor جديد باسم ArkonGuardian.'},
                                {icon: 'paste', title: '2. لصق الكود', desc: 'امسح كل شيء في الملف الجديد ثم الصق الكود المنسوج أعلاه.'},
                                {icon: 'play', title: '3. تفعيل', desc: 'اضغط Compile ثم اسحب الاكسبيرت إلى أي شارت وفعل Algo Trading.'}
                            ].map((step, idx) => (
                                <div key={idx} className="p-6 bg-zinc-950/50 rounded-3xl border border-zinc-800 flex items-start gap-5">
                                    <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                                        <i className={`fas fa-${step.icon} text-amber-500`}></i>
                                    </div>
                                    <div>
                                        <h4 className="text-white font-black text-sm mb-1">{step.title}</h4>
                                        <p className="text-[10px] text-zinc-500 leading-relaxed font-bold">{step.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'CONN' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tighter">رابط الجسر (Local Bridge)</h3>
                            <p className="text-zinc-500 text-sm">هذا الرابط يربط واجهة ARKON بمحطة MT5 الخاصة بك. القيمة الافتراضية هي Localhost.</p>
                        </header>
                        <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-6">
                            <label className="block">
                                <span className="text-[11px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">عنوان الـ Webhook الخاص بالجسر</span>
                                <input 
                                    type="text" 
                                    value={config.webhookUrl} 
                                    onChange={(e)=>setConfig({...config, webhookUrl: e.target.value})} 
                                    placeholder="http://127.0.0.1:3000"
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500/50 font-mono text-lg" 
                                />
                            </label>
                            <div className="flex items-center gap-4 p-4 bg-amber-500/5 rounded-2xl border border-amber-500/10">
                                <i className="fas fa-info-circle text-amber-500"></i>
                                <p className="text-[10px] text-zinc-400 font-bold">تأكد من تشغيل ملف <code className="text-amber-500">arkon-bridge.js</code> على جهازك لاستقبال الإشارات.</p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'NOTIF' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tighter">إعدادات تليجرام (Telegram Bot)</h3>
                            <p className="text-zinc-500 text-sm">استقبل إشارات التداول وتنبيهات الأمان مباشرة على هاتفك.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-8">
                                <label className="block">
                                    <span className="text-[11px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">Bot Token</span>
                                    <input 
                                        type="password" 
                                        value={config.telegramBotToken} 
                                        onChange={(e)=>setConfig({...config, telegramBotToken: e.target.value})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500/50 font-mono" 
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">Chat ID</span>
                                    <input 
                                        type="text" 
                                        value={config.telegramChatId} 
                                        onChange={(e)=>setConfig({...config, telegramChatId: e.target.value})} 
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-white outline-none focus:border-amber-500/50 font-mono" 
                                    />
                                </label>
                            </div>
                            <div className="p-10 bg-indigo-500/5 rounded-[3rem] border border-indigo-500/10 flex flex-col justify-center items-center text-center">
                                <i className="fab fa-telegram text-5xl text-indigo-500 mb-6"></i>
                                <h4 className="text-white font-black mb-2">اختبار الربط</h4>
                                <p className="text-[10px] text-zinc-500 mb-8 px-6 uppercase font-bold tracking-widest">اضغط لإرسال رسالة تجريبية للجهاز للتأكد من صحة المفاتيح.</p>
                                <button 
                                    onClick={handleTestTelegram}
                                    disabled={isTestingTg}
                                    className="px-10 py-4 bg-indigo-500 text-black rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-400 transition-all disabled:opacity-50"
                                >
                                    {isTestingTg ? 'جاري الإرسال...' : 'إرسال رسالة تجربة'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'NEWS' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tighter">درع الأخبار (News Shield)</h3>
                            <p className="text-zinc-500 text-sm">تحكم في فترات تجميد التداول التلقائي أثناء صدور البيانات الاقتصادية الكبرى.</p>
                        </header>
                        <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 grid grid-cols-1 md:grid-cols-2 gap-10">
                            <label className="block">
                                <span className="text-[11px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">دقائق التوقف قبل الخبر</span>
                                <input 
                                    type="number" 
                                    value={config.newsBypassMinutes} 
                                    onChange={(e)=>setConfig({...config, newsBypassMinutes: parseInt(e.target.value) || 0})} 
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500/50 font-mono text-2xl text-center" 
                                />
                            </label>
                            <label className="block">
                                <span className="text-[11px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">دقائق التوقف بعد الخبر</span>
                                <input 
                                    type="number" 
                                    value={config.newsCooldownMinutes} 
                                    onChange={(e)=>setConfig({...config, newsCooldownMinutes: parseInt(e.target.value) || 0})} 
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500/50 font-mono text-2xl text-center" 
                                />
                            </label>
                        </div>
                    </div>
                )}

                {activeTab === 'PROT' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tighter">بروتوكولات القنص (Execution Logic)</h3>
                            <p className="text-zinc-500 text-sm">تخصيص السلوك الذكي للمحرك عند اكتشاف إشارات قوية.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {[
                                {key: 'autoExecution', label: 'التنفيذ التلقائي (Auto-Trade)', desc: 'فتح الصفقات فوراً بمجرد تخطي الإشارة حاجز الـ 80%.'},
                                {key: 'autoHedgeEnabled', label: 'الهيدج الديناميكي (Dynamic Hedge)', desc: 'تحويل المراكز المعاكسة لهيدج بدلاً من الإغلاق في السوق المتذبذب.'},
                                {key: 'hunterMode', label: 'وضع الصياد (Hunter Mode)', desc: 'تفعيل خوارزمية البحث عن السيولة المختبئة (Hidden Liquidity).'},
                                {key: 'enableTrailing', label: 'ملاحقة الربح (Trailing Stop)', desc: 'تحريك وقف الخسارة تلقائياً لتأمين الأرباح المحققة.'}
                            ].map(item => (
                                <div key={item.key} className="p-8 bg-zinc-950/50 rounded-[2.5rem] border border-zinc-800 flex justify-between items-center group hover:border-amber-500/30 transition-all">
                                    <div>
                                        <h4 className="text-white font-black text-sm mb-1">{item.label}</h4>
                                        <p className="text-[10px] text-zinc-500 font-bold">{item.desc}</p>
                                    </div>
                                    <button 
                                        onClick={() => setConfig({...config, [item.key]: !config[item.key as keyof AppConfig]})}
                                        className={`w-14 h-8 rounded-full relative transition-all ${config[item.key as keyof AppConfig] ? 'bg-amber-500' : 'bg-zinc-800'}`}
                                    >
                                        <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${config[item.key as keyof AppConfig] ? 'right-7' : 'right-1'}`}></div>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'RISK' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tighter flex items-center gap-3">
                                <i className="fas fa-chart-pie text-amber-500"></i>
                                إدارة المخاطر والأهداف (Risk Protocols)
                            </h3>
                            <p className="text-zinc-500 text-xs">التحكم في أحجام التداول وأهداف الربح اللحظية بدقة رياضية.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            <div className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 space-y-10">
                                <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-4">إعدادات العقد</h4>
                                <label className="block">
                                    <span className="text-[11px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">حجم اللوت الافتراضي (Lot Size)</span>
                                    <input type="number" step="0.01" value={config.maxAllocationPerTrade} onChange={(e)=>setConfig({...config, maxAllocationPerTrade: parseFloat(e.target.value) || 0.01})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500/50 font-mono text-2xl text-center" />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-black text-zinc-500 uppercase block mb-4 tracking-widest">نسبة الـ RR (Risk Reward)</span>
                                    <input type="number" step="0.1" value={config.riskRewardRatio} onChange={(e)=>setConfig({...config, riskRewardRatio: parseFloat(e.target.value) || 2.5})} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-white outline-none focus:border-amber-500/50 font-mono text-2xl text-center" />
                                </label>
                            </div>

                            <div className="p-10 bg-amber-500/5 rounded-[3rem] border border-amber-500/10 space-y-10">
                                <h4 className="text-xs font-black text-amber-500 uppercase tracking-widest border-b border-amber-500/10 pb-4">أهداف الربح العائم (USD)</h4>
                                <label className="block">
                                    <span className="text-[11px] font-black text-zinc-400 uppercase block mb-4 tracking-widest">الهدف الكلي (Global PnL Target)</span>
                                    <div className="flex items-center gap-6">
                                        <div className="text-zinc-600 font-black text-xl">$</div>
                                        <input type="number" value={config.globalProfitTargetUSD} onChange={(e)=>setConfig({...config, globalProfitTargetUSD: parseFloat(e.target.value) || 0})} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-emerald-400 outline-none focus:border-emerald-500/50 font-mono text-2xl text-center" />
                                    </div>
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-black text-zinc-400 uppercase block mb-4 tracking-widest">هدف الصفقة (Per-Trade Target)</span>
                                    <div className="flex items-center gap-6">
                                        <div className="text-zinc-600 font-black text-xl">$</div>
                                        <input type="number" value={config.perTradeProfitTargetUSD} onChange={(e)=>setConfig({...config, perTradeProfitTargetUSD: parseFloat(e.target.value) || 0})} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-8 py-5 text-emerald-400 outline-none focus:border-emerald-500/50 font-mono text-2xl text-center" />
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'SYSTEM' && (
                    <div className="space-y-10 animate-in slide-in-from-left duration-500">
                        <header>
                            <h3 className="text-2xl font-black text-white mb-2 tracking-tighter">صيانة النظام والبيانات</h3>
                            <p className="text-zinc-500 text-sm">إدارة الحالة المحلية وتصدير التقارير الفنية للمحرك.</p>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <button 
                                onClick={() => { localStorage.clear(); window.location.reload(); }}
                                className="p-10 bg-rose-500/5 rounded-[3rem] border border-rose-500/10 text-center hover:bg-rose-500/10 transition-all group"
                            >
                                <i className="fas fa-trash-alt text-3xl text-rose-500 mb-4 group-hover:scale-110 transition-transform"></i>
                                <h4 className="text-white font-black mb-2">مسح كافة البيانات</h4>
                                <p className="text-[10px] text-zinc-500 uppercase font-bold">سيتم استعادة الإعدادات المصنعية وإعادة تشغيل التطبيق.</p>
                            </button>
                            <button 
                                onClick={() => {
                                    const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a'); a.href = url; a.download = 'arkon-config.json'; a.click();
                                }}
                                className="p-10 bg-zinc-950/50 rounded-[3rem] border border-zinc-800 text-center hover:bg-white/5 transition-all group"
                            >
                                <i className="fas fa-download text-3xl text-white mb-4 group-hover:translate-y-1 transition-transform"></i>
                                <h4 className="text-white font-black mb-2">تصدير الإعدادات</h4>
                                <p className="text-[10px] text-zinc-500 uppercase font-bold">حفظ نسخة احتياطية من ملف الإعدادات الحالي.</p>
                            </button>
                        </div>
                    </div>
                )}
             </div>

             {/* Footer Save Area */}
             <div className="absolute bottom-0 left-0 right-0 p-12 bg-gradient-to-t from-black to-transparent pointer-events-none flex justify-end items-center gap-10">
                <span className="text-[11px] text-zinc-500 uppercase font-black tracking-[0.2em]">سيتم حفظ التغييرات تلقائياً</span>
                <button 
                    onClick={() => setIsSettingsOpen(false)} 
                    className="pointer-events-auto px-20 py-6 bg-white text-black rounded-[2rem] text-xs font-black uppercase tracking-[0.3em] shadow-2xl hover:scale-105 active:scale-95 transition-all"
                >
                    إغلاق الإعدادات
                </button>
             </div>
          </div>
        </div>
      )}

      {/* Main Header */}
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 glass-card rounded-2xl flex items-center justify-center border-amber-500/40 bg-zinc-900/50 shadow-lg shadow-amber-500/10">
              <i className="fas fa-cube text-3xl text-amber-500 animate-pulse"></i>
          </div>
          <div>
              <h1 className="text-5xl font-black text-white uppercase tracking-tighter">ARKON <span className="text-amber-500 text-2xl font-mono">V{CURRENT_VERSION}</span></h1>
              <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.4em] mt-1">QUANT TRADING TERMINAL | INSTITUTIONAL HUB</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
            <button onClick={() => setIsSettingsOpen(true)} className="px-8 py-4 bg-zinc-900 border border-zinc-800 rounded-2xl font-black text-zinc-400 text-[11px] uppercase hover:bg-white hover:text-black transition-all flex items-center gap-4 shadow-2xl">
                لوحة الضبط والتحكم <i className="fas fa-cog text-amber-500"></i>
            </button>
        </div>
      </header>

      {/* Main Grid View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8 flex flex-col gap-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <MarketStats state={btcAnalysis} title="BITCOIN" />
                <MarketStats state={ethAnalysis} title="ETHEREUM" />
              </div>
              <div className="h-[450px] shadow-2xl">
                  <TradeLog logs={logs} activeTradesCount={managedTrades.length} managedTrades={managedTrades} onCloseTrade={() => {}} />
              </div>
          </div>
          
          <div className="lg:col-span-4 flex flex-col gap-10">
              {/* Position Exposure Monitor */}
              <div className="glass-card rounded-[3.5rem] p-10 border border-zinc-800 bg-zinc-950/50 min-h-[500px] shadow-2xl">
                  <h3 className="text-sm font-black text-white uppercase tracking-[0.3em] mb-8 border-b border-zinc-800 pb-6 flex justify-between items-center">
                      <span>المركز الحالي (PnL: ${managedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0).toFixed(2)})</span>
                      <div className="flex items-center gap-2">
                          <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full text-emerald-500 font-mono">TARGET: ${config.globalProfitTargetUSD}</span>
                      </div>
                  </h3>
                  <div className="space-y-6 overflow-y-auto max-h-[600px] custom-scrollbar pl-2">
                      {managedTrades.length === 0 && (
                          <div className="text-center text-zinc-800 text-[11px] py-24 font-black uppercase tracking-[0.2em]">
                              <i className="fas fa-layer-group block text-5xl mb-6 opacity-10"></i>
                              لا توجد عقود نشطة حالياً
                          </div>
                      )}
                      {managedTrades.map((trade: any) => (
                          <div key={trade.ticket} className="p-8 rounded-[2.5rem] bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-all group relative overflow-hidden">
                              <div className="flex justify-between items-center mb-5 relative z-10">
                                  <div className="flex items-center gap-4">
                                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg ${trade.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                          <i className={`fas fa-arrow-${trade.direction === 'LONG' ? 'up' : 'down'}`}></i>
                                      </div>
                                      <div>
                                          <span className="text-lg font-black text-white tracking-tighter block">{trade.asset.replace('USD','')}</span>
                                          <span className={`text-[9px] font-black px-3 py-1 rounded-lg uppercase ${trade.direction === 'LONG' ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'bg-rose-500 text-black shadow-lg shadow-rose-500/20'}`}>
                                              {trade.direction}
                                          </span>
                                      </div>
                                  </div>
                                  <div className="text-right">
                                      <span className={`text-2xl font-mono font-black ${trade.pnl && trade.pnl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          {trade.pnl && trade.pnl > 0 ? '+' : ''}${trade.pnl?.toFixed(2)}
                                      </span>
                                      <p className="text-[8px] text-zinc-600 uppercase font-black">UNREALIZED PNL</p>
                                  </div>
                              </div>
                              <div className="w-full bg-black/40 h-2.5 rounded-full overflow-hidden border border-zinc-800 relative z-10">
                                  <div className={`h-full transition-all duration-1000 ${trade.direction === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{width: (trade.pnl && trade.pnl > 0) ? Math.min((trade.pnl / config.perTradeProfitTargetUSD) * 100, 100) : 0 + '%'}}></div>
                              </div>
                              <div className="flex justify-between mt-5 text-[10px] font-mono text-zinc-500 uppercase font-black">
                                  <span>Entry: ${trade.entryPrice?.toLocaleString()}</span>
                                  <span className="text-zinc-700">|</span>
                                  <span>Target: ${config.perTradeProfitTargetUSD}</span>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
};

export default App;
