// Strategy Architect: Designs institutional trading strategies
export const strategyArchitect = {
    // Signal generation using RSI
    generateSignal: (prices: number[]) => {
        const delta = prices.slice(1).map((p, i) => p - prices[i]);
        const gain = delta.filter(d => d > 0).reduce((a, b) => a + b, 0) / 14;
        const loss = Math.abs(delta.filter(d => d < 0).reduce((a, b) => a + b, 0)) / 14;
        const rsi = 100 - (100 / (1 + gain / loss));
        if (rsi < 30) return 'BUY';
        if (rsi > 70) return 'SELL';
        return 'HOLD';
    }
};
