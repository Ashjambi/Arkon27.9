import * as ss from 'simple-statistics';

export const statArb = {
    // Check cointegration using correlation
    checkCointegration: (priceA: number[], priceB: number[]) => {
        const corr = ss.sampleCorrelation(priceA, priceB);
        return {
            isCointegrated: corr > 0.8,
            correlation: corr
        };
    },
    
    // Z-Score signal generation
    calculateZScore: (spread: number[], currentSpread: number) => {
        const meanSpread = ss.mean(spread);
        const stdSpread = ss.standardDeviation(spread);
        return (currentSpread - meanSpread) / stdSpread;
    },
    
    calculateSpread: (priceA: number, priceB: number) => {
        return priceA - priceB;
    }
};
