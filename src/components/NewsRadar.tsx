import React from 'react';

const NewsRadar: React.FC<{ events: any[], isPaused: boolean, activeEvent: any, newsStatus: any }> = ({ events, isPaused, activeEvent, newsStatus }) => {
    return <div className="p-6 bg-zinc-900 rounded-2xl border border-zinc-800">
        <h3 className="text-white font-black">News Radar</h3>
    </div>;
};

export default NewsRadar;
