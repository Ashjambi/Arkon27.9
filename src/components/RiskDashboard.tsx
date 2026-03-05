import React, { useState, useEffect } from 'react';

interface RiskMetrics {
  var95: number;
  drawdown: number;
}

export const RiskDashboard: React.FC<{ balanceHistory: number[] }> = ({ balanceHistory }) => {
  const [metrics, setMetrics] = useState<RiskMetrics>({ var95: 0, drawdown: 0 });

  useEffect(() => {
    if (balanceHistory.length < 2) return;

    // Calculate Drawdown
    let peak = -Infinity;
    let maxDrawdown = 0;
    balanceHistory.forEach(b => {
      peak = Math.max(peak, b);
      const dd = (peak - b) / peak;
      maxDrawdown = Math.max(maxDrawdown, dd);
    });

    // Calculate VaR 95% (Historical)
    const returns = balanceHistory.slice(1).map((b, i) => (b - balanceHistory[i]) / balanceHistory[i]);
    returns.sort((a, b) => a - b);
    const varIndex = Math.floor(returns.length * 0.05);
    const var95 = Math.abs(returns[varIndex] || 0);

    setMetrics({ var95, drawdown: maxDrawdown });
  }, [balanceHistory]);

  return (
    <div className="p-4 bg-zinc-900 text-white rounded-xl shadow-md border border-zinc-700">
      <h2 className="text-lg font-semibold mb-4">Risk Dashboard</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-zinc-800 rounded-lg">
          <p className="text-xs text-zinc-400">VaR (95%)</p>
          <p className="text-xl font-mono">{(metrics.var95 * 100).toFixed(2)}%</p>
        </div>
        <div className="p-3 bg-zinc-800 rounded-lg">
          <p className="text-xs text-zinc-400">Max Drawdown</p>
          <p className="text-xl font-mono">{(metrics.drawdown * 100).toFixed(2)}%</p>
        </div>
      </div>
    </div>
  );
};
