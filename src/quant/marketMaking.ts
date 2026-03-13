

export const marketMaking = {
    // Spread calculation adjusted for inventory risk
    calculateSpread: (volatility: number, inventory: number) => {
        const baseSpread = volatility * 0.01;
        const inventoryRisk = inventory * 0.001; // Inventory skew
        return baseSpread + inventoryRisk;
    },
    
    // Quote adjustment logic
    adjustQuotes: (midPrice: number, spread: number, inventory: number) => {
        const skew = inventory * 0.0001; // Shift prices when inventory builds up
        return {
            bid: midPrice - (spread / 2) - skew,
            ask: midPrice + (spread / 2) - skew
        };
    }
};
