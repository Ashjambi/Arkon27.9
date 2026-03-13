// Alpha Signal Lab: Research and validate new trading signals
const erf = (x: number) => {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
};

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
