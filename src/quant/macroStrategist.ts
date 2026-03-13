

export const macroStrategist = {
    // Regime detection using GDP, Inflation, and Interest Rates
    getRegime: (gdpGrowth: number, inflation: number, interestRates: number) => {
        // Growth/Inflation matrix
        if (gdpGrowth > 0.02 && inflation < 0.03) return 'GROWTH';
        if (gdpGrowth < 0.01 && inflation > 0.04) return 'STAGFLATION';
        if (gdpGrowth > 0.02 && inflation > 0.04) return 'REFLATION';
        if (gdpGrowth < 0.01 && inflation < 0.03) return 'DEFLATION';
        
        if (interestRates > 0.05) return 'TIGHTENING';
        return 'NEUTRAL';
    },
    
    // Tactical allocation based on regime
    getTacticalAllocation: (regime: string) => {
        const allocations: Record<string, { btc: number, eth: number }> = {
            'GROWTH': { btc: 0.6, eth: 0.4 },
            'STAGFLATION': { btc: 0.3, eth: 0.2 },
            'NEUTRAL': { btc: 0.5, eth: 0.5 }
        };
        return allocations[regime] || { btc: 0.5, eth: 0.5 };
    }
};
