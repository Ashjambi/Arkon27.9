
import React from 'react';
import { HistoricalTrade, SignalDirection } from '../types';

interface HistoryTableProps {
  trades: HistoricalTrade[];
}

const HistoryTable: React.FC<HistoryTableProps> = ({ trades }) => {
  const formatTime = (ts: number) => new Date(ts).toLocaleString('en-US', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute:'2-digit' });

  return (
    <div className="glass-card rounded-[2.5rem] border border-zinc-800/50 overflow-hidden" dir="rtl">
      <div className="p-6 border-b border-zinc-800/50 flex justify-between items-center bg-zinc-900/40">
        <div>
           <h3 className="text-lg font-black text-white uppercase tracking-tighter">PERFORMANCE <span className="text-zinc-500">LEDGER</span></h3>
           <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">CLOSED POSITIONS & OUTCOMES</p>
        </div>
        <div className="flex gap-4">
             <div className="text-center">
                 <span className="text-[7px] text-zinc-600 font-black uppercase block">WIN RATE</span>
                 <span className="text-xs font-mono font-bold text-green-400">
                    {trades.length > 0 ? ((trades.filter(t => t.outcome === 'WIN').length / trades.length) * 100).toFixed(1) : 0}%
                 </span>
             </div>
             <div className="text-center pl-4 border-l border-zinc-800">
                 <span className="text-[7px] text-zinc-600 font-black uppercase block">TOTAL TRADES</span>
                 <span className="text-xs font-mono font-bold text-zinc-300">{trades.length}</span>
             </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-right">
          <thead>
            <tr className="bg-zinc-950/50 text-[8px] uppercase font-black text-zinc-500 tracking-wider">
              <th className="px-6 py-4 text-left">Time</th>
              <th className="px-6 py-4">Asset</th>
              <th className="px-6 py-4">Direction</th>
              <th className="px-6 py-4">Entry</th>
              <th className="px-6 py-4">Exit</th>
              <th className="px-6 py-4">PnL</th>
              <th className="px-6 py-4">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/30">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-[10px] text-zinc-600 font-mono uppercase tracking-widest">
                   No historical data recorded yet
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr key={trade.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-3 text-[9px] font-mono text-zinc-500 text-left">
                    {formatTime(trade.timestamp)}
                  </td>
                  <td className="px-6 py-3 text-[10px] font-black text-zinc-300">
                    {trade.asset.split('-')[0]}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${
                      trade.direction === SignalDirection.LONG ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {trade.direction}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[10px] font-mono text-zinc-400">
                    ${trade.entryPrice.toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-[10px] font-mono text-zinc-400">
                    ${trade.exitPrice.toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-[10px] font-mono font-bold">
                    <span className={trade.pnlPoints >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {trade.pnlPoints >= 0 ? '+' : ''}{trade.pnlPoints.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-[8px] font-black px-2 py-1 rounded-md uppercase border ${
                        trade.outcome === 'WIN' ? 'border-green-500/20 bg-green-500/10 text-green-400' :
                        trade.outcome === 'LOSS' ? 'border-red-500/20 bg-red-500/10 text-red-400' :
                        'border-zinc-500/20 bg-zinc-500/10 text-zinc-400'
                    }`}>
                        {trade.outcome}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default HistoryTable;
