
import React, { useRef, useEffect } from 'react';
import { LogEntry, LogType } from '../types';

interface TradeLogProps {
  logs: LogEntry[];
  activeTradesCount: number;
  managedTrades: any[]; 
  onCloseTrade: (asset: string) => void; 
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
};

const TradeLog: React.FC<TradeLogProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0; 
    }
  }, [logs]);

  return (
    <div className="glass-card rounded-[1.5rem] flex flex-col border border-zinc-800 overflow-hidden h-full min-h-[300px]" dir="ltr">
      {/* HEADER */}
      <div className="bg-zinc-950 p-3 border-b border-zinc-800 flex justify-between items-center">
        <div className="flex items-center gap-2">
           <i className="fas fa-terminal text-zinc-600 text-xs"></i>
           <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">System Kernel</h3>
        </div>
        <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-[9px] font-mono text-zinc-600">LIVE</span>
        </div>
      </div>

      {/* TERMINAL BODY */}
      <div 
        className="flex-1 overflow-y-auto custom-scrollbar bg-[#09090b] p-3 font-mono text-[10px]"
        ref={scrollRef}
      >
        <div className="flex flex-col gap-1">
            {logs.length === 0 && (
                <div className="text-zinc-700 text-center mt-10">_waiting for stream data...</div>
            )}
            {logs.map((log) => (
              <div key={log.id} className="flex gap-3 hover:bg-white/5 p-1 rounded-sm transition-colors group">
                  <span className="text-zinc-600 shrink-0">[{formatTime(log.timestamp)}]</span>
                  
                  <span className={`font-bold shrink-0 w-12 text-center uppercase border rounded-[2px] px-1 ${
                      log.type === 'EXEC' ? 'text-emerald-400 border-emerald-900 bg-emerald-900/10' :
                      log.type === 'ERROR' ? 'text-rose-400 border-rose-900 bg-rose-900/10' :
                      log.type === 'RISK' ? 'text-amber-400 border-amber-900 bg-amber-900/10' :
                      log.type === 'QUANT' ? 'text-indigo-400 border-indigo-900 bg-indigo-900/10' :
                      'text-zinc-400 border-zinc-800'
                  }`}>
                      {log.type}
                  </span>

                  <span className="text-zinc-300 break-all">
                      {log.message} 
                      {log.details && typeof log.details === 'string' && <span className="text-zinc-500 ml-2">// {log.details}</span>}
                  </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default TradeLog;
