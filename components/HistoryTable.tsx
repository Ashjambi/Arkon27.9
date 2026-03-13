
import React from 'react';
import { HistoricalTrade, SignalDirection } from '../types';

interface HistoryTableProps {
  trades: HistoricalTrade[];
}

const HistoryTable: React.FC<HistoryTableProps> = ({ trades }) => {
  const formatTime = (ts: number) => new Date(ts).toLocaleString('ar-EG', { hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });

  return (
    <div className="glass-card rounded-[3rem] border border-zinc-800/50 overflow-hidden shadow-2xl" dir="rtl">
      <div className="p-10 border-b border-zinc-800/50 flex justify-between items-center bg-zinc-900/20">
        <div>
           <h3 className="text-2xl font-black text-white uppercase tracking-tighter">سجل الأداء <span className="text-zinc-500">الكمي</span></h3>
           <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">الأرشيف الكامل للعمليات المنفذة عبر الجسر</p>
        </div>
        <div className="flex gap-8">
             <div className="text-center">
                 <span className="text-[9px] text-zinc-600 font-black uppercase block mb-1">نسبة النجاح</span>
                 <span className="text-2xl font-mono font-black text-emerald-400">
                    {trades.length > 0 ? ((trades.filter(t => t.outcome === 'WIN').length / trades.length) * 100).toFixed(1) : 0}%
                 </span>
             </div>
             <div className="text-center pr-8 border-r border-zinc-800">
                 <span className="text-[9px] text-zinc-600 font-black uppercase block mb-1">إجمالي الصفقات</span>
                 <span className="text-2xl font-mono font-black text-white">{trades.length}</span>
             </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-right">
          <thead>
            <tr className="bg-black/40 text-[10px] uppercase font-black text-zinc-500 tracking-wider">
              <th className="px-8 py-6">التاريخ والوقت</th>
              <th className="px-8 py-6">الأصل</th>
              <th className="px-8 py-6">الاتجاه</th>
              <th className="px-8 py-6">سعر الدخول</th>
              <th className="px-8 py-6">سعر الخروج</th>
              <th className="px-8 py-6">الربح/الخسارة (نقطة)</th>
              <th className="px-8 py-6">النتيجة النهائية</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-8 py-20 text-center text-zinc-700 uppercase font-black tracking-widest text-xs">
                   لا توجد بيانات تاريخية مسجلة حالياً
                </td>
              </tr>
            ) : (
              trades.sort((a,b) => b.timestamp - a.timestamp).map((trade) => (
                <tr key={trade.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-8 py-5 text-[11px] font-mono text-zinc-500">
                    {formatTime(trade.timestamp)}
                  </td>
                  <td className="px-8 py-5 text-sm font-black text-white">
                    {trade.asset.split('-')[0]}
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase border ${
                      trade.direction === SignalDirection.LONG ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' : 'border-rose-500/20 bg-rose-500/5 text-rose-400'
                    }`}>
                      {trade.direction === SignalDirection.LONG ? 'شراء' : 'بيع'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-xs font-mono text-zinc-400">
                    ${trade.entryPrice.toLocaleString()}
                  </td>
                  <td className="px-8 py-5 text-xs font-mono text-zinc-400">
                    ${trade.exitPrice.toLocaleString()}
                  </td>
                  <td className="px-8 py-5 text-sm font-mono font-black">
                    <span className={trade.pnlPoints >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {trade.pnlPoints >= 0 ? '+' : ''}{trade.pnlPoints.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${trade.outcome === 'WIN' ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : trade.outcome === 'LOSS' ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]' : 'bg-zinc-500'}`}></div>
                        <span className={`text-[10px] font-black uppercase ${
                            trade.outcome === 'WIN' ? 'text-emerald-500' :
                            trade.outcome === 'LOSS' ? 'text-rose-500' :
                            'text-zinc-500'
                        }`}>
                            {trade.outcome === 'WIN' ? 'ربح' : trade.outcome === 'LOSS' ? 'خسارة' : 'تعادل'}
                        </span>
                    </div>
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
