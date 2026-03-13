import React from 'react';

const SignalCard: React.FC<{ signal: any, onSend: any, sending: boolean, userRiskCap: number, isActive: boolean, isSystemLocked: boolean }> = ({ signal, onSend, sending, userRiskCap, isActive, isSystemLocked }) => {
    return <div className="p-6 bg-zinc-900 rounded-2xl border border-zinc-800">
        <h4 className="text-white font-black">{signal.asset}</h4>
        <button onClick={() => onSend(signal)} disabled={sending || isSystemLocked} className="bg-amber-500 text-black px-4 py-2 rounded-lg">Execute</button>
    </div>;
};

export default SignalCard;
