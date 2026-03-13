import React from 'react';

const TradeLog: React.FC<{ logs: any[], activeTradesCount: number, managedTrades: any[], onCloseTrade: any }> = ({ logs, activeTradesCount, managedTrades, onCloseTrade }) => {
    return <div className="space-y-2">
        {logs.map((log: any) => <div key={log.id} className="text-xs text-zinc-500">{log.message}</div>)}
    </div>;
};

export default TradeLog;
