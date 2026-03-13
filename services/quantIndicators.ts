
export const calculateEMA = (prices: number[], period: number): number => {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
};

export const calculateMACD = (prices: number[], fast: number = 12, slow: number = 26, signal: number = 9) => {
    const fastEMA = calculateEMA(prices, fast);
    const slowEMA = calculateEMA(prices, slow);
    const macd = fastEMA - slowEMA;
    // Simplified signal line
    const signalLine = calculateEMA([macd], signal); 
    return { macd, signalLine };
};

export const calculateADX = (highs: number[], lows: number[], closes: number[], period: number = 14): number => {
    // Simplified ADX
    return 25; // Placeholder
};

export const calculateBollingerBands = (prices: number[], period: number = 20, stdDevMult: number = 2) => {
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
    return { upper: mean + stdDev * stdDevMult, lower: mean - stdDev * stdDevMult, middle: mean };
};

export const calculateWilliamsR = (highs: number[], lows: number[], closes: number[], period: number = 14): number => {
    const highestHigh = Math.max(...highs.slice(-period));
    const lowestLow = Math.min(...lows.slice(-period));
    const currentClose = closes[closes.length - 1];
    return -100 * (highestHigh - currentClose) / (highestHigh - lowestLow);
};
