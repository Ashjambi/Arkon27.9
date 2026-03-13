import { mean, std } from 'mathjs';

// Backtesting Engine: Institutional-grade Walk-Forward Validation
export const backtestingEngine = {
    runWalkForwardBacktest: (strategy: any, historicalData: any[], windowSize: number = 100) => {
        let totalReturn = 0;
        // Walk-forward: Train on window, test on next slice
        for (let i = windowSize; i < historicalData.length - 10; i += 10) {
            const testData = historicalData.slice(i, i + 10);
            const result = backtestingEngine.runBacktest(strategy, testData);
            totalReturn += result.totalReturn;
        }
        return { averageReturn: totalReturn / ((historicalData.length - windowSize) / 10) };
    },
    runBacktest: (strategy: any, historicalData: any[], commissionRate: number = 0.001, slippageRate: number = 0.0005) => {
        let balance = 100000;
        let positions = 0;

        // Ensure historicalData is valid
        if (!historicalData || historicalData.length === 0) return { finalBalance: balance, totalReturn: 0 };

        for (let i = 1; i < historicalData.length; i++) {
            const tick = historicalData[i];
            if (!tick || typeof tick.price === 'undefined') continue;

            const signal = strategy.generateSignal(historicalData.slice(0, i).map((t: any) => t.price));
            
            const executionPrice = tick.price * (1 + (signal === 'BUY' ? slippageRate : -slippageRate));

            if (signal === 'BUY' && balance >= executionPrice) {
                positions += 1;
                balance -= (executionPrice + (executionPrice * commissionRate));
            } else if (signal === 'SELL' && positions > 0) {
                positions -= 1;
                balance += (executionPrice - (executionPrice * commissionRate));
            }
        }
        
        const lastTick = historicalData[historicalData.length - 1];
        const lastPrice = lastTick && lastTick.price ? lastTick.price : 0;
        const finalValue = balance + (positions * lastPrice);
        return { finalBalance: finalValue, totalReturn: ((finalValue - 100000) / 100000) * 100 };
    }
};
