
import React from 'react';
import { MarketAnalysisState } from '../types';

interface MarketStatsProps {
  state: MarketAnalysisState | null;
  title: string;
}

const MarketStats: React.FC<MarketStatsProps> = ({ state, title }) => {
  if (!state) return <div className="glass-card rounded-[1.5rem] p-6 h-[420px] animate-pulse bg-zinc-900/20"></div>;

  const isUp = state.trendDirection === 'UP';
  const isHunterReady = state.qualityScore > 80;

  return (
    <div className="glass-card rounded-[2rem] overflow-hidden border border-zinc-800 flex flex-col h-full min-h-[450px] relative group transition-all" dir="ltr">
      
      {/* MTF ALIGNMENT BAR */}
      <div className="absolute top-0 left-0 right-0 h-1 flex">
          <div className={`flex-1 ${state.mtfStatus.dailyTrend === 'UP' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
          <div className={`flex-1 ${state.regime !== 'CHOPPY/NOISE' ? 'bg-indigo-500' : 'bg-zinc-800'}`}></div>
          <div className={`flex-1 ${state.mtfStatus.m15Trigger ? 'bg-amber-500' : 'bg-zinc-800'}`}></div>
      </div>

      <div className="p-6 border-b border-zinc-800/60 bg-zinc-900/40">
          <div className="flex justify-between items-start">
              <div>
                  <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Quantum Radar</span>
                      <i className="fas fa-crosshairs text-[10px] text-zinc-600"></i>
                  </div>
                  <h3 className="text-3xl font-black text-white tracking-tighter">{title}</h3>
              </div>
              <div className="text-right">
                  <div className="text-[9px] font-black text-zinc-500 uppercase mb-1">Daily Trend</div>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black ${isUp ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                      {state.mtfStatus.dailyTrend}
                  </span>
              </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-mono font-bold text-white">${state.price.toLocaleString()}</span>
              <span className="text-xs text-zinc-500 font-mono">USD</span>
          </div>
      </div>

      <div className="flex-1 p-6 space-y-6">
          {/* HUNTER GAUGE */}
          <div className="bg-black/40 rounded-3xl p-5 border border-zinc-800/50 relative overflow-hidden">
              <div className="flex justify-between items-center mb-4 relative z-10">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Hunter Precision</span>
                  <span className={`text-xl font-black ${isHunterReady ? 'text-amber-500' : 'text-zinc-600'}`}>{Math.round(state.qualityScore)}%</span>
              </div>
              <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden relative z-10">
                  <div className={`h-full transition-all duration-1000 ${isHunterReady ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-zinc-700'}`} style={{width: `${state.qualityScore}%`}}></div>
              </div>
              <div className="mt-3 flex justify-between text-[8px] font-black text-zinc-600 uppercase tracking-tighter">
                  <span>Searching</span>
                  <span>Locked</span>
                  <span>Execution</span>
              </div>
          </div>

          {/* MTF SUMMARY */}
          <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-all">
                  <span className="text-[8px] font-black text-zinc-500 uppercase block mb-1">Hurst Exponent</span>
                  <span className="text-lg font-mono font-bold text-indigo-400">{state.hurst.toFixed(2)}</span>
              </div>
              <div className="p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-all">
                  <span className="text-[8px] font-black text-zinc-500 uppercase block mb-1">Volatility (DVOL)</span>
                  <span className="text-lg font-mono font-bold text-purple-400">{state.dvol.toFixed(1)}</span>
              </div>
          </div>

          {/* REAL-TIME LOGIC FEED */}
          <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                  <i className="fas fa-check-circle text-emerald-500"></i>
                  <span>1D SMA-50: {state.mtfStatus.dailyTrend}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                  <i className={`fas fa-${state.mtfStatus.m15Trigger ? 'check-circle text-emerald-500' : 'circle text-zinc-800'}`}></i>
                  <span>M15 Z-Score: {state.zScore.toFixed(2)}σ</span>
              </div>
          </div>
      </div>

      <div className={`p-4 text-center font-black text-[10px] tracking-widest transition-all ${isHunterReady ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-500'}`}>
          {isHunterReady ? 'HUNTER PROTOCOL: ACTIVE 🎯' : 'SCANNING FOR ALIGNMENT 🛰️'}
      </div>
    </div>
  );
};

export default MarketStats;
