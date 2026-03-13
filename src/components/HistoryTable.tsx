import React from 'react';

const HistoryTable: React.FC<{ trades: any[] }> = ({ trades }) => {
    return <div className="p-6 bg-zinc-900 rounded-2xl border border-zinc-800">
        <h3 className="text-white font-black">History</h3>
    </div>;
};

export default HistoryTable;
