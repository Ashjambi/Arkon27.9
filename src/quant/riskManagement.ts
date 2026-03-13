import { mean, std } from 'mathjs';

export const riskManagement = {
    // Fractional Kelly Criterion (e.g., 0.1 for conservative sizing)
    calculatePositionSize: (capital: number, winProbability: number, winLossRatio: number, fraction: number = 0.1) => {
        const kelly = winProbability - ((1 - winProbability) / winLossRatio);
        return capital * Math.max(0, kelly) * fraction;
    },
    // Expected Shortfall (CVaR) - more robust than VaR
    calculateCVaR: (returns: number[], confidenceLevel: number = 0.95) => {
        const sortedReturns = returns.sort((a, b) => a - b);
        const index = Math.floor((1 - confidenceLevel) * sortedReturns.length);
        const tailReturns = sortedReturns.slice(0, index);
        return Number(mean(tailReturns));
    },
    // Stress testing
    stressTest: (scenario: string, portfolioValue: number) => {
        // Institutional stress test logic (e.g., -20% shock)
        const shock = scenario === 'CRASH' ? -0.2 : -0.05;
        return portfolioValue * (1 + shock);
    }
};
