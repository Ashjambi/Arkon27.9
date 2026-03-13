import * as ss from 'simple-statistics';

// Factor Backtester: Evaluates performance of specific risk factors
export const factorBacktester = {
    // Test factor significance (e.g., t-statistic)
    testFactor: (returns: number[], factorReturns: number[]) => {
        const corr = ss.sampleCorrelation(returns, factorReturns);
        return { tStat: corr * Math.sqrt((returns.length - 2) / (1 - corr * corr)) };
    }
};
