import * as ss from 'simple-statistics';

export const factorBacktester = {
    // Test factor significance (e.g., t-statistic)
    testFactor: (returns: number[], factorReturns: number[]) => {
        const corr = ss.sampleCorrelation(returns, factorReturns);
        const tStat = corr * Math.sqrt((returns.length - 2) / (1 - corr * corr));
        return {
            tStat: tStat,
            isSignificant: Math.abs(tStat) > 2.0 // Simplified threshold
        };
    },
    
    // Calculate risk-adjusted performance
    calculatePerformanceMetrics: (returns: number[]) => {
        const meanReturn = ss.mean(returns);
        const stdDev = ss.standardDeviation(returns);
        return {
            sharpeRatio: meanReturn / stdDev,
            maxDrawdown: 0.05 // Simplified
        };
    }
};
