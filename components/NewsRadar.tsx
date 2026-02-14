
import React, { useState, useEffect } from 'react';
import { EconomicEvent } from '../types';

interface NewsRadarProps {
  events: EconomicEvent[];
  isPaused: boolean;
  activeEvent?: EconomicEvent;
  newsStatus?: {
      reason: string;
      remainingMs: number;
  };
}

const NewsRadar: React.FC<NewsRadarProps> = ({ events, isPaused, activeEvent, newsStatus }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (ms: number) => {
    if (ms <= 0) return "0:00";
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isCooldown = newsStatus?.reason === 'POST_EVENT';

  return (
    <div className="glass-card rounded-[3rem] border border-zinc-900 bg-zinc-950/40 p-10 flex flex-col gap-8 shadow-2xl relative overflow-hidden" dir="ltr">
      {/* Background Glow */}
      {isPaused && (
        <div className={`absolute inset-0 ${isCooldown ? 'bg-amber-500/5' : 'bg-rose-500/5'} animate-pulse pointer-events-none`}></div>
      )}

      <div className="flex justify-between items-center relative z-10">
        <div>
          <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Economic <span className="text-zinc-700">Radar</span></h3>
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">High Impact Volatility Monitor</p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-3 ${
            isPaused 
                ? (isCooldown ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-rose-500/10 border-rose-500/20 text-rose-500') 
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
        }`}>
          <div className={`w-2 h-2 rounded-full ${isPaused ? (isCooldown ? 'bg-amber-500' : 'bg-rose-500 animate-ping') : 'bg-emerald-500'}`}></div>
          <span className="text-[10px] font-black uppercase tracking-widest">
            {isPaused ? (isCooldown ? 'RECOVERY COOLDOWN' : 'SIGNAL BLOCK ACTIVE') : 'MARKET STABLE'}
          </span>
        </div>
      </div>

      <div className="space-y-4 relative z-10 max-h-[320px] overflow-y-auto custom-scrollbar pr-2">
        {events.length === 0 ? (
          <div className="py-10 text-center text-zinc-700 text-[10px] font-black uppercase tracking-widest">
            Scanning Global Macro Cycles...
          </div>
        ) : (
          events.sort((a,b) => a.timestamp - b.timestamp).map((event) => {
            const isCurrentlyActive = activeEvent?.id === event.id;
            const isPast = event.timestamp < now;
            
            // حساب الوقت المتبقي للعرض
            let displayTime = event.timestamp - now;
            let statusLabel = isPast ? "ELAPSED" : "T-MINUS";

            if (isCurrentlyActive) {
                if (isCooldown) {
                    // في حالة التبريد، نحسب الوقت المتبقي من نهاية فترة التبريد الفعلية
                    // ملاحظة: نستخدم newsStatus.remainingMs المحدث من الـ Service
                    displayTime = newsStatus?.remainingMs || 0;
                    statusLabel = "UNLOCKING IN";
                } else if (newsStatus?.reason === 'PRE_EVENT') {
                    displayTime = newsStatus?.remainingMs || 0;
                    statusLabel = "LOCKDOWN IN";
                }
            }

            return (
              <div 
                key={event.id} 
                className={`p-5 rounded-3xl border transition-all flex justify-between items-center group ${
                  isCurrentlyActive 
                    ? (isCooldown ? 'bg-amber-500/10 border-amber-500/30' : 'bg-rose-500/10 border-rose-500/30') 
                    : 'bg-zinc-900/40 border-zinc-900 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-xs ${
                    event.impact === 'HIGH' 
                        ? (isCurrentlyActive && isCooldown ? 'bg-amber-500/20 text-amber-500' : 'bg-rose-500/20 text-rose-500') 
                        : 'bg-amber-500/20 text-amber-500'
                  }`}>
                    {event.currency}
                  </div>
                  <div>
                    <h4 className={`text-xs font-black uppercase tracking-tight ${
                        isCurrentlyActive 
                            ? (isCooldown ? 'text-amber-400' : 'text-rose-400') 
                            : 'text-zinc-300'
                    }`}>
                      {event.name}
                    </h4>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[9px] font-bold text-zinc-600 uppercase">{event.impact} IMPACT</span>
                      {isCurrentlyActive && (
                        <span className={`text-[8px] px-2 py-0.5 rounded font-black uppercase ${isCooldown ? 'bg-amber-500 text-black' : 'bg-rose-500 text-white'}`}>
                            {isCooldown ? 'COOLING' : 'LOCKED'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-mono font-black ${
                      isCurrentlyActive 
                        ? (isCooldown ? 'text-amber-500' : 'text-rose-500') 
                        : isPast ? 'text-zinc-600' : 'text-zinc-400'
                  }`}>
                    {isPast && !isCurrentlyActive ? "PASSED" : formatCountdown(Math.max(0, displayTime))}
                  </div>
                  <div className="text-[8px] font-black text-zinc-700 uppercase mt-0.5">{statusLabel}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {isPaused && (
        <div className={`pt-4 border-t ${isCooldown ? 'border-amber-500/20' : 'border-rose-500/20'}`}>
          <p className={`text-[9px] font-bold uppercase tracking-widest leading-relaxed ${isCooldown ? 'text-amber-400' : 'text-rose-400'}`}>
            <i className={`fas fa-${isCooldown ? 'clock' : 'shield-alt'} mr-2`}></i>
            {isCooldown 
                ? `ARKON Recovery: High volatility protection active. Resuming in ${formatCountdown(newsStatus?.remainingMs || 0)}.`
                : `ARKON Safeguard: Auto-execution is suspended until volatility subsides.`}
          </p>
        </div>
      )}
    </div>
  );
};

export default NewsRadar;
