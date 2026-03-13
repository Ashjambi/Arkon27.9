
import React, { useState, useEffect } from 'react';
import { TradingSignal, SignalDirection } from '../types';

interface SignalCardProps {
  signal: TradingSignal;
  onSend: (sig: TradingSignal, overrideAction?: 'ENTRY' | 'FLIP' | 'HEDGE' | 'BOOST' | 'EXIT' | 'SECURE') => Promise<boolean> | void;
  sending: boolean;
  userRiskCap: number;
  isActive: boolean;
  isSystemLocked?: boolean;
}

const SignalCard: React.FC<SignalCardProps> = ({ signal, onSend, sending, userRiskCap, isActive, isSystemLocked }) => {
  const [executed, setExecuted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [timeAgo, setTimeAgo] = useState<string>('Now');
  
  const isLong = signal.direction === SignalDirection.LONG;
  const mainColor = isLong ? 'emerald' : 'rose';
  const borderColor = isLong ? 'border-emerald-500/20' : 'border-rose-500/20';
  const bgGradient = isLong ? 'from-emerald-500/5' : 'from-rose-500/5';

  useEffect(() => { if (isActive) setExecuted(true); }, [isActive]);

  useEffect(() => {
    const interval = setInterval(() => {
        const seconds = Math.floor((Date.now() - signal.timestamp) / 1000);
        if (seconds < 60) setTimeAgo(`${seconds}s`);
        else setTimeAgo(`${Math.floor(seconds / 60)}m`);
    }, 1000);
    return () => clearInterval(interval);
  }, [signal.timestamp]);

  const handleExecute = async (e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (sending || executed || isActive) return;
    const success = await onSend(signal, 'ENTRY');
    if (success) setExecuted(true);
  };

  const toggleExpand = (e: React.MouseEvent) => {
      setExpanded(!expanded);
  };

  const tags = [];
  if (Math.abs(signal.details.zScore) > 2) tags.push(`Z:${signal.details.zScore.toFixed(1)}`);
  if (signal.details.volumeMultiplier > 1.2) tags.push(`Vol:${signal.details.volumeMultiplier.toFixed(1)}x`);

  const isButtonDisabled = sending || executed || isActive;

  return (
    <div 
        className={`relative w-full rounded-xl bg-zinc-950 border ${executed ? 'border-zinc-800 opacity-70' : 'border-zinc-700 hover:border-zinc-500'} transition-all duration-200 overflow-hidden cursor-pointer group`}
        onClick={toggleExpand}
    >
      {/* System Lock Badge */}
      {isSystemLocked && !executed && !isActive && (
        <div className="absolute top-2 left-2 z-10 bg-rose-500 text-black text-[7px] font-black px-1.5 py-0.5 rounded uppercase flex items-center gap-1 shadow-lg shadow-rose-500/20">
          <i className="fas fa-lock text-[6px]"></i> NEWS LOCK
        </div>
      )}

      {/* HEADER */}
      <div className={`px-4 py-3 bg-gradient-to-r ${bgGradient} to-transparent border-b border-zinc-800/50 flex justify-between items-center`}>
          <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded bg-black/50 border ${borderColor} flex items-center justify-center`}>
                 <i className={`fab fa-${signal.asset.includes('BTC') ? 'bitcoin' : 'ethereum'} text-lg text-white`}></i>
              </div>
              <div>
                  <h3 className="text-sm font-black text-white leading-none flex items-center gap-2">
                      {signal.asset.split('-')[0]}
                      <span className={`text-[9px] px-1 rounded-sm border border-${mainColor}-500/30 bg-${mainColor}-500/10 text-${mainColor}-400 font-mono`}>
                          {signal.direction}
                      </span>
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] font-mono text-zinc-500">{timeAgo}</span>
                      {tags.map((t,i) => <span key={i} className="text-[8px] bg-zinc-900 border border-zinc-800 text-zinc-400 px-1 rounded">{t}</span>)}
                  </div>
              </div>
          </div>
          <div className="text-right">
               <span className="block text-[8px] text-zinc-500 font-black uppercase">CONFIDENCE</span>
               <span className={`text-lg font-black ${signal.qualityScore > 80 ? 'text-white' : 'text-zinc-400'}`}>{signal.qualityScore}%</span>
          </div>
      </div>

      {/* METRICS ROW */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2 bg-black/20">
          <div>
              <span className="text-[8px] text-zinc-600 font-black uppercase block">Entry</span>
              <span className="text-xs font-mono font-bold text-white">${signal.entry.toLocaleString()}</span>
          </div>
          <div className="text-center">
              <span className="text-[8px] text-zinc-600 font-black uppercase block">Target</span>
              <span className={`text-xs font-mono font-bold text-${mainColor}-400`}>${signal.takeProfit.toLocaleString()}</span>
          </div>
          <div className="text-right">
              <span className="text-[8px] text-zinc-600 font-black uppercase block">Kelly</span>
              <span className="text-xs font-mono font-bold text-pink-400">{Math.min(signal.details.kellyBet || 0, userRiskCap)}%</span>
          </div>
      </div>

      {/* EXPANDED DETAILS & GATES */}
      {expanded && (
          <div className="px-4 py-3 bg-zinc-900/50 border-t border-zinc-800 space-y-3 cursor-default" onClick={(e) => e.stopPropagation()}>
              
              {/* LOGIC GATES VISUALIZATION */}
              <div className="bg-black/30 rounded-lg p-2 border border-zinc-800/50">
                  <span className="text-[8px] font-black text-zinc-500 uppercase block mb-2">PROTOCOL GATES (CRITERIA)</span>
                  <div className="space-y-1.5">
                      {signal.gates && signal.gates.length > 0 ? (
                          signal.gates.map((gate) => (
                              <div key={gate.id} className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                      <i className={`fas fa-${gate.status === 'PASS' ? 'check-circle text-emerald-500' : 'times-circle text-rose-500'} text-[10px]`}></i>
                                      <span className="text-[9px] text-zinc-300 font-bold">{gate.name}</span>
                                  </div>
                                  <div className="text-[9px] font-mono text-zinc-500">
                                      <span className={gate.status === 'PASS' ? 'text-emerald-400' : 'text-rose-400'}>{gate.value}</span> 
                                      <span className="text-zinc-700 mx-1">/</span> 
                                      {gate.threshold}
                                  </div>
                              </div>
                          ))
                      ) : (
                          <div className="text-[9px] text-zinc-600 italic">No specific gates recorded.</div>
                      )}
                  </div>
              </div>

              <div className="pt-1">
                  <p className="text-[10px] text-zinc-400 font-mono mb-3 border-l-2 border-indigo-500 pl-2">
                      <span className="text-indigo-400 font-bold">LOGIC:</span> {signal.reasoning}
                  </p>
                  
                  {/* IMPROVED INTERACTIVE BUTTON */}
                  <button
                    onClick={handleExecute}
                    disabled={isButtonDisabled}
                    className={`
                        w-full py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-200 flex items-center justify-center gap-2
                        ${isButtonDisabled 
                            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700' 
                            : isSystemLocked 
                              ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30 hover:bg-rose-500 hover:text-black' 
                              : 'bg-white text-black hover:bg-zinc-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-white/10'
                        }
                    `}
                >
                    {sending ? (
                        <>
                            <i className="fas fa-circle-notch animate-spin text-indigo-500"></i>
                            <span>TRANSMITTING...</span>
                        </>
                    ) : (executed || isActive) ? (
                        <>
                            <i className="fas fa-check-circle text-emerald-500"></i>
                            <span>ACTIVE / EXECUTED</span>
                        </>
                    ) : isSystemLocked ? (
                        <>
                            <i className="fas fa-shield-alt"></i>
                            <span>FORCE EXECUTE (BYPASS LOCK)</span>
                        </>
                    ) : (
                        <>
                            <i className="fas fa-bolt text-indigo-600"></i>
                            <span>EXECUTE SIGNAL</span>
                        </>
                    )}
                </button>
              </div>
          </div>
      )}
      {!expanded && (
           <div className="h-1 w-full bg-zinc-900">
               <div className={`h-full bg-${mainColor}-500 opacity-20`} style={{width: `${signal.qualityScore}%`}}></div>
           </div>
      )}
    </div>
  );
};

export default SignalCard;
