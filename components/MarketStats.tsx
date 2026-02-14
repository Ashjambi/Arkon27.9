
import React from 'react';
import { MarketAnalysisState } from '../types';

interface MarketStatsProps {
  state: MarketAnalysisState | null;
  title: string;
}

const MarketStats: React.FC<MarketStatsProps> = ({ state, title }) => {
  if (!state) return (
    <div className="glass-card rounded-[2.5rem] p-10 h-[520px] border border-zinc-800 bg-zinc-950/20 flex flex-col justify-center items-center text-center gap-6">
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
  const isHunterReady = state.qualityScore >= 80 && !state.isNewsPaused;
  const newsPaused = state.isNewsPaused;

  return (
    <div className={`glass-card rounded-[3rem] overflow-hidden border flex flex-col h-full min-h-[520px] relative group transition-all duration-500 ${newsPaused ? 'border-rose-500/30 shadow-[0_0_50px_rgba(244,63,94,0.1)]' : 'border-zinc-800 hover:border-amber-500/20'}`} dir="ltr">
      
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
                      <span className={`text-[10px] font-black uppercase tracking-[0.3em] border px-3 py-1 rounded-md ${newsPaused ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' : 'bg-amber-500/5 border-amber-500/10 text-amber-500'}`}>
                        {newsPaused ? 'News Lock Active' : 'Quantum Audit'}
                      </span>
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

      <div className="flex-1 p-8 space-y-6">
          {/* THE BIG 5 AUDIT GATES */}
          <div className="grid grid-cols-1 gap-2">
              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-2 px-1">Institutional Audit (The Big 5)</span>
              {state.gates.map((gate) => (
                  <div key={gate.id} className="flex items-center justify-between p-3 bg-zinc-900/30 rounded-2xl border border-zinc-800/50 group/gate hover:border-zinc-700 transition-all">
                      <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${gate.status === 'PASS' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'}`}></div>
                          <span className="text-[11px] font-black text-zinc-300 uppercase">{gate.name}</span>
                      </div>
                      <div className="text-right">
                          <span className={`text-[11px] font-mono font-black ${gate.status === 'PASS' ? 'text-emerald-400' : 'text-rose-400'}`}>{gate.value}</span>
                          <span className="text-[9px] text-zinc-600 font-bold ml-2">/ {gate.threshold}</span>
                      </div>
                  </div>
              ))}
          </div>

          <div className="grid grid-cols-2 gap-6">
              <div className="p-5 rounded-3xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col gap-1">
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Regime Strength</span>
                  <span className="text-xl font-mono font-bold text-indigo-400">{state.trendStrength.toFixed(1)}%</span>
                  <p className="text-[8px] text-zinc-700 font-black uppercase mt-1">{state.regime.replace('_', ' ')}</p>
              </div>
              <div className="p-5 rounded-3xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col gap-1">
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Funding Rate</span>
                  <span className={`text-xl font-mono font-bold ${state.fundingRate >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(state.fundingRate * 100).toFixed(4)}%</span>
                  <p className="text-[8px] text-zinc-700 font-black uppercase mt-1">8H APR</p>
              </div>
          </div>
      </div>

      <div className={`p-4 text-center font-black text-[10px] tracking-[0.4em] transition-all uppercase ${isHunterReady ? 'bg-amber-500 text-black shadow-[0_-10px_30px_rgba(245,158,11,0.2)]' : newsPaused ? 'bg-rose-500 text-white shadow-[0_-10px_30px_rgba(244,63,94,0.2)]' : 'bg-zinc-900 text-zinc-700'}`}>
          {newsPaused 
            ? `DANGER: HIGH IMPACT ${state.activeEvent?.currency} NEWS DETECTED` 
            : isHunterReady 
              ? 'TARGET ACQUIRED: INSTITUTIONAL FLOW DETECTED' 
              : 'AUDITING NETWORK SECTORS...'}
      </div>
    </div>
  );
};

export default MarketStats;
