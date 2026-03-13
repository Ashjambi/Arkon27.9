// Macro Strategist: Analyzes global economic regimes
export const macroStrategist = {
    // Regime detection using GDP, Inflation, and Interest Rates
    getRegime: (gdpGrowth: number, inflation: number, interestRates: number) => {
        if (gdpGrowth > 0.02 && inflation < 0.03) return 'GROWTH';
        if (gdpGrowth < 0.01 && inflation > 0.04) return 'STAGFLATION';
        if (interestRates > 0.05) return 'TIGHTENING';
        return 'NEUTRAL';
    }
};
