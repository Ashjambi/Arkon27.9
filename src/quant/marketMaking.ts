// Market Making: Provides liquidity with inventory management
export const marketMaking = {
    // Spread calculation adjusted for inventory risk
    calculateSpread: (volatility: number, inventory: number) => {
        const baseSpread = volatility * 0.01;
        const inventoryRisk = inventory * 0.001;
        return baseSpread + inventoryRisk;
    }
};
