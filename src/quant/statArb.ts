import * as ss from 'simple-statistics';

// Stat Arb: Exploits cointegration between assets
export const statArb = {
    // Check cointegration using correlation
    checkCointegration: (priceA: number[], priceB: number[]) => {
        const corr = ss.sampleCorrelation(priceA, priceB);
        return corr > 0.8; // Strong positive correlation
    },
    calculateSpread: (priceA: number, priceB: number) => {
        return priceA - priceB;
    }
};
