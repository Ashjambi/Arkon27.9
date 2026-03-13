import React from 'react';

const MarketStats: React.FC<{ title: string, state: any }> = ({ title, state }) => {
    return <div className="p-6 bg-zinc-900 rounded-2xl border border-zinc-800">
        <h3 className="text-white font-black">{title}</h3>
        {state ? (
            <div className="mt-4 text-xs text-zinc-400 font-mono">
                <p>News Paused: {state.isNewsPaused ? 'Yes' : 'No'}</p>
                <p>Active Event: {state.activeEvent ? state.activeEvent.title : 'None'}</p>
            </div>
        ) : (
            <p className="mt-4 text-xs text-zinc-600 font-mono">Loading data...</p>
        )}
    </div>;
};

export default MarketStats;
