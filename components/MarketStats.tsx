
import React from 'react';
import { MarketAnalysisState } from '../types';

interface MarketStatsProps {
  state: MarketAnalysisState | null;
  title: string;
}

const MarketStats: React.FC<MarketStatsProps> = ({ state, title }) => {
  if (!state) return (
    <div className="glass-card rounded-[2.5rem] p-10 h-[480px] border border-zinc-800 bg-zinc-950/20 flex flex-col justify-center items-center text-center gap-6">
        <div className="w-20 h-20 rounded-full border-4 border-zinc-900 border-t-amber-500 animate-spin flex items-center justify-center">
            <i className="fas fa-satellite-dish text-2xl text-amber-500/50"></i>
        </div>
        <div>
            <h3 className="text-zinc-600 font-black text-lg uppercase tracking-[0.3em] mb-2">{title}</h3>
            <p className="text-[10px] text-zinc-800 font-bold uppercase tracking-widest">جاري سحب بيانات دفتر الأوامر والسيولة...</p>
        </div>
    </div>
  );

  const isUp = state.trendDirection === 'UP';
  const isHunterReady = state.qualityScore > 80;

  return (
    <div className="glass-card rounded-[3rem] overflow-hidden border border-zinc-800 flex flex-col h-full min-h-[480px] relative group transition-all hover:border-amber-500/20" dir="ltr">
      
      {/* MTF ALIGNMENT BAR */}
      <div className="absolute top-0 left-0 right-0 h-1.5 flex p-[1px] bg-zinc-900">
          <div className={`flex-1 rounded-l-full transition-all duration-700 ${state.mtfStatus.dailyTrend === 'UP' ? 'bg-emerald-500' : 'bg-rose-500'} opacity-80`}></div>
          <div className={`flex-1 transition-all duration-700 ${state.regime !== 'CHOPPY/NOISE' ? 'bg-indigo-500' : 'bg-zinc-800'} opacity-80`}></div>
          <div className={`flex-1 rounded-r-full transition-all duration-700 ${state.mtfStatus.m15Trigger ? 'bg-amber-500' : 'bg-zinc-800'} opacity-80`}></div>
      </div>

      <div className="p-8 border-b border-zinc-900/60 bg-zinc-900/20">
          <div className="flex justify-between items-start mb-6">
              <div>
                  <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-black text-amber-500 uppercase tracking-[0.3em] bg-amber-500/5 border border-amber-500/10 px-3 py-1 rounded-md">Quantum Radar</span>
                  </div>
                  <h3 className="text-4xl font-black text-white tracking-tighter uppercase">{title}</h3>
              </div>
              <div className="text-right">
                  <div className="text-[10px] font-black text-zinc-600 uppercase mb-2 tracking-widest">Current Trend</div>
                  <span className={`px-4 py-2 rounded-xl text-[11px] font-black border uppercase tracking-widest ${isUp ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-500' : 'bg-rose-500/5 border-rose-500/20 text-rose-500'}`}>
                      {state.mtfStatus.dailyTrend}
                  </span>
              </div>
          </div>
          <div className="flex items-baseline gap-3">
              <span className="text-5xl font-mono font-black text-white tracking-tighter">${state.price.toLocaleString(undefined, {minimumFractionDigits: 1})}</span>
              <span className="text-xs text-zinc-600 font-bold uppercase tracking-widest">USD SPOT</span>
          </div>
      </div>

      <div className="flex-1 p-8 space-y-8">
          {/* HUNTER GAUGE */}
          <div className="bg-black/40 rounded-[2rem] p-8 border border-zinc-800/50 relative overflow-hidden group/gauge">
              <div className="flex justify-between items-center mb-5 relative z-10">
                  <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">Hunter Accuracy Score</span>
                  <span className={`text-2xl font-mono font-black ${isHunterReady ? 'text-amber-500' : 'text-zinc-700'}`}>{Math.round(state.qualityScore)}%</span>
              </div>
              <div className="h-3 w-full bg-zinc-900 rounded-full overflow-hidden relative z-10 border border-zinc-800 p-[2px]">
                  <div className={`h-full transition-all duration-1000 rounded-full ${isHunterReady ? 'bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-zinc-800'}`} style={{width: `${state.qualityScore}%`}}></div>
              </div>
              <div className="mt-5 flex justify-between text-[9px] font-black text-zinc-600 uppercase tracking-widest">
                  <span className={state.qualityScore < 40 ? 'text-zinc-400' : ''}>Idle</span>
                  <span className={state.qualityScore >= 40 && state.qualityScore < 80 ? 'text-zinc-400' : ''}>Scanning</span>
                  <span className={state.qualityScore >= 80 ? 'text-amber-500 animate-pulse' : ''}>Target Locked</span>
              </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
              <div className="p-6 rounded-3xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col gap-1">
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Statistical Hurst</span>
                  <span className="text-xl font-mono font-bold text-indigo-400">{state.hurst.toFixed(3)}</span>
                  <p className="text-[8px] text-zinc-700 font-black uppercase mt-1">Fractal Efficiency</p>
              </div>
              <div className="p-6 rounded-3xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col gap-1">
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Volatility Index</span>
                  <span className="text-xl font-mono font-bold text-purple-400">{state.dvol.toFixed(2)}</span>
                  <p className="text-[8px] text-zinc-700 font-black uppercase mt-1">Real-time DVOL</p>
              </div>
          </div>
      </div>

      <div className={`p-5 text-center font-black text-[11px] tracking-[0.4em] transition-all uppercase ${isHunterReady ? 'bg-amber-500 text-black shadow-[0_-10px_30px_rgba(245,158,11,0.2)]' : 'bg-zinc-900 text-zinc-700'}`}>
          {isHunterReady ? 'SIGNAL ACQUIRED: READY FOR EXECUTION' : 'SCANNING FOR MTF ALIGNMENT...'}
      </div>
    </div>
  );
};

export default MarketStats;
