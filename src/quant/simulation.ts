// Simulation script with inlined dependencies
import { mean, std } from 'mathjs';

// --- Inlined dependencies ---
const dataPipeline = {
    cleanData: (data: number[]) => {
        const mu = Number(mean(data));
        const sigma = Number(std(data));
        return data.map((x, i) => {
            if (Math.abs(x - mu) > 3 * sigma) return mu;
            if (isNaN(x)) return mu;
            return x;
        });
    },
    normalize: (data: number[]) => {
        const clean = dataPipeline.cleanData(data);
        const mu = Number(mean(clean));
        const sigma = Number(std(clean));
        return clean.map(x => (Number(x) - mu) / sigma);
    }
};

// --- Best Settings ---
const BEST_SETTINGS = {
    BOLLINGER_STD: 1.5,
    POSITION_SIZE_PCT: 0.08,
    TAKE_PROFIT: 0.005
};

const strategyArchitect = {
    // Scalping: Buy at lower band, Sell at upper band
    generateSignal: (prices: number[]) => {
        const n = prices.length;
        const currentPrice = prices[n - 1];
        const meanPrice = Number(mean(prices.slice(n - 20, n)));
        const stdPrice = Number(std(prices.slice(n - 20, n)));
        const upperBand = meanPrice + (BEST_SETTINGS.BOLLINGER_STD * stdPrice);
        const lowerBand = meanPrice - (BEST_SETTINGS.BOLLINGER_STD * stdPrice);
        
        if (currentPrice < lowerBand) return 'BUY';
        if (currentPrice > upperBand) return 'SELL';
        return 'HOLD';
    }
};

const backtestingEngine = {
    runBacktest: (historicalData: any[], commissionRate: number = 0.001) => {
        let balance = 100000;
        let longPositions: { price: number, shares: number }[] = [];
        let shortPositions: { price: number, shares: number }[] = [];
        
        for (let i = 20; i < historicalData.length; i++) {
            const tick = historicalData[i];
            const prices = historicalData.slice(0, i).map((t: any) => t.price);
            const signal = strategyArchitect.generateSignal(prices);
            
            // Scalping: Using best settings
            const positionSize = balance * BEST_SETTINGS.POSITION_SIZE_PCT;
            const numShares = Math.max(1, Math.floor(positionSize / tick.price));
            
            if (signal === 'BUY') {
                longPositions.push({ price: tick.price, shares: numShares });
                balance -= (numShares * tick.price * (1 + commissionRate));
            } else if (signal === 'SELL') {
                shortPositions.push({ price: tick.price, shares: numShares });
                balance += (numShares * tick.price * (1 - commissionRate));
            }
            
            // Check Take Profit
            longPositions = longPositions.filter(pos => {
                if (tick.price >= pos.price * (1 + BEST_SETTINGS.TAKE_PROFIT)) {
                    balance += (pos.shares * tick.price * (1 - commissionRate));
                    return false;
                }
                return true;
            });
            shortPositions = shortPositions.filter(pos => {
                if (tick.price <= pos.price * (1 - BEST_SETTINGS.TAKE_PROFIT)) {
                    balance += (pos.shares * (pos.price * 2 - tick.price) * (1 - commissionRate));
                    return false;
                }
                return true;
            });
        }
        const finalValue = balance + (longPositions.reduce((sum, pos) => sum + pos.shares * historicalData[historicalData.length - 1].price, 0)) - (shortPositions.reduce((sum, pos) => sum + pos.shares * (pos.price * 2 - historicalData[historicalData.length - 1].price), 0));
        return { finalBalance: finalValue, totalReturn: ((finalValue - 100000) / 100000) * 100 };
    }
};

async function runSimulation() {
    console.log("--- Starting Stress Test Simulation (Random Walk + Black Swans) ---");
    let price = 50000;
    const syntheticData = Array.from({ length: 1000 }, () => {
        price += (Math.random() - 0.5) * 500;
        if (Math.random() < 0.01) price *= (1 + (Math.random() - 0.5) * 0.2);
        return { price };
    });
    
    const result = backtestingEngine.runBacktest(syntheticData);

    console.log("Simulation Results:");
    console.log(`Final Balance: ${result.finalBalance.toFixed(2)}`);
    console.log(`Total Return: ${result.totalReturn.toFixed(2)}%`);
    console.log("--- Simulation Complete ---");
}

runSimulation().catch(console.error);
