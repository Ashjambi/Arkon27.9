import { erf } from 'mathjs';

// Alpha Signal Lab: Research and validate new trading signals
export const alphaSignalLab = {
    // Statistical significance check (p-value < 0.05)
    validateSignal: (data: number[], nullHypothesisMean: number) => {
        const n = data.length;
        const mean = data.reduce((a, b) => a + b, 0) / n;
        const stdDev = Math.sqrt(data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1));
        const tStat = (mean - nullHypothesisMean) / (stdDev / Math.sqrt(n));
        // Approximation of p-value for normal distribution
        const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(tStat) / Math.sqrt(2))));
        return p < 0.05;
    }
};
