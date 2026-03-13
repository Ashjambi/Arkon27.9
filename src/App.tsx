import React, { useEffect, useState } from 'react';
import { deribitService } from './services/deribitService';
import { tradingEngine } from './services/tradingEngine';
import { alphaSignalLab } from './quant/alphaSignalLab';
import { backtestingEngine } from './quant/backtestingEngine';
import { SettingsTab, SettingsSection, InputField } from './components/SettingsComponents';
import { AppConfig, defaultConfig } from './types';

export default function App() {
  const [prices, setPrices] = useState<{ BTC: number | null, ETH: number | null }>({ BTC: null, ETH: null });
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [config, setConfig] = useState<AppConfig>(() => {
    const saved = localStorage.getItem('arkon-config');
    return saved ? JSON.parse(saved) : defaultConfig;
  });

  const [equity] = useState(50000); 
  const [openTrades] = useState(0);

  useEffect(() => {
    localStorage.setItem('arkon-config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    const fetchPrices = async () => {
      const btcSummary = await deribitService.getBookSummary('BTC-PERPETUAL');
      const ethSummary = await deribitService.getBookSummary('ETH-PERPETUAL');
      
      setPrices({
        BTC: btcSummary?.last || null,
        ETH: ethSummary?.last || null
      });
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, []);

  const runBacktest = async () => {
    const data = await deribitService.getCandles('BTC-PERPETUAL', '1H');
    if (!data || !data.close) return;

    // تحويل بيانات Deribit إلى تنسيق { price }
    const historicalData = data.close.map((price: number) => ({ price }));
    const strategy = {
      generateSignal: (prices: number[]) => alphaSignalLab.generateBollingerSignal(prices)
    };

    const result = backtestingEngine.runBacktest(strategy, historicalData);
    setBacktestResult(result);
  };

  const updateConfig = (section: keyof AppConfig, key: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: value }
    }));
  };

  const status = tradingEngine.isTradingAllowed(config, openTrades, equity);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <div className="flex justify-between items-center">
        <h1 className="text-4xl font-bold">Arkon Quant Terminal</h1>
        <div className="flex gap-4">
          <button 
            onClick={runBacktest}
            className="bg-indigo-600 px-6 py-3 rounded-xl font-bold hover:bg-indigo-500 transition"
          >
            Run Backtest
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="bg-zinc-800 px-6 py-3 rounded-xl font-bold hover:bg-zinc-700 transition"
          >
            Settings
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-4">
        <div className="p-4 bg-zinc-900 rounded-xl">
          <h2 className="text-xl">Bitcoin (BTC)</h2>
          <p className="text-3xl font-mono">{prices.BTC ? `$${prices.BTC.toLocaleString()}` : 'Loading...'}</p>
        </div>
        <div className="p-4 bg-zinc-900 rounded-xl">
          <h2 className="text-xl">Ethereum (ETH)</h2>
          <p className="text-3xl font-mono">{prices.ETH ? `$${prices.ETH.toLocaleString()}` : 'Loading...'}</p>
        </div>
        <div className={`p-4 rounded-xl ${status.allowed ? 'bg-emerald-900' : 'bg-red-900'}`}>
          <h2 className="text-xl">Trading Status</h2>
          <p className="text-xl font-bold">{status.allowed ? 'ACTIVE' : 'HALTED'}</p>
          <p className="text-xs text-zinc-300">{status.reason}</p>
        </div>
      </div>

      {backtestResult && (
        <div className="mt-8 p-6 bg-zinc-900 rounded-xl">
          <h2 className="text-2xl font-bold">Backtest Results (BTC-PERPETUAL)</h2>
          <p className="text-xl mt-2">Final Balance: ${backtestResult.finalBalance.toLocaleString(undefined, {maximumFractionDigits: 2})}</p>
          <p className="text-xl">Total Return: {backtestResult.totalReturn.toFixed(2)}%</p>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50">
          <div className="bg-zinc-950 w-full max-w-4xl h-[80vh] rounded-3xl border border-zinc-800 flex overflow-hidden">
            <div className="w-64 bg-zinc-900 p-6 space-y-4">
              <SettingsTab active={activeTab === 'general'} onClick={() => setActiveTab('general')} label="General" icon="cog" />
              <SettingsTab active={activeTab === 'risk'} onClick={() => setActiveTab('risk')} label="Risk Mgmt" icon="shield" />
              <SettingsTab active={activeTab === 'profit'} onClick={() => setActiveTab('profit')} label="Profit Securing" icon="lock" />
              <SettingsTab active={activeTab === 'telegram'} onClick={() => setActiveTab('telegram')} label="Telegram" icon="paper-plane" />
              <SettingsTab active={activeTab === 'news'} onClick={() => setActiveTab('news')} label="News Filter" icon="newspaper" />
              <button onClick={() => setShowSettings(false)} className="mt-auto text-zinc-500 hover:text-white">Close</button>
            </div>
            <div className="flex-1 p-12 overflow-y-auto">
              {activeTab === 'general' && (
                <SettingsSection title="General Settings">
                  <InputField label="Auto Execution" value={config.general.autoExecution} onChange={(v) => updateConfig('general', 'autoExecution', v)} type="checkbox" />
                  <InputField label="Hunter Mode" value={config.general.hunterMode} onChange={(v) => updateConfig('general', 'hunterMode', v)} type="checkbox" />
                  <InputField label="Cooldown Hours" value={config.general.cooldownHours} onChange={(v) => updateConfig('general', 'cooldownHours', v)} type="number" />
                </SettingsSection>
              )}
              {activeTab === 'risk' && (
                <SettingsSection title="Risk Management">
                  <InputField label="Max Allocation (%)" value={config.risk.maxAllocation} onChange={(v) => updateConfig('risk', 'maxAllocation', v)} type="number" />
                  <InputField label="Max Open Trades" value={config.risk.maxOpenTrades} onChange={(v) => updateConfig('risk', 'maxOpenTrades', v)} type="number" />
                </SettingsSection>
              )}
              {activeTab === 'profit' && (
                <SettingsSection title="Profit Securing">
                  <InputField label="Secure Threshold (%)" value={config.profit.secureThreshold} onChange={(v) => updateConfig('profit', 'secureThreshold', v)} type="number" />
                </SettingsSection>
              )}
              {activeTab === 'telegram' && (
                <SettingsSection title="Telegram Notifications">
                  <InputField label="Bot Token" value={config.telegram.botToken} onChange={(v) => updateConfig('telegram', 'botToken', v)} />
                  <InputField label="Chat ID" value={config.telegram.chatId} onChange={(v) => updateConfig('telegram', 'chatId', v)} />
                </SettingsSection>
              )}
              {activeTab === 'news' && (
                <SettingsSection title="News Filtering">
                  <InputField label="Bypass Minutes" value={config.news.bypassMinutes} onChange={(v) => updateConfig('news', 'bypassMinutes', v)} type="number" />
                </SettingsSection>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
