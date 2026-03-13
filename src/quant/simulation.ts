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

// --- Realistic Institutional Settings ---
const BEST_SETTINGS = {
    BOLLINGER_STD: 2.0, // توسيع النطاق لتقليل الإشارات الخاطئة
    KELLY_FRACTION: 0.20, // تقليل المخاطرة
    TAKE_PROFIT: 0.005,
    COMMISSION_RATE: 0.0006, // زيادة العمولات
    SLIPPAGE_RATE: 0.0002    // زيادة الانزلاق السعري
};

const strategyArchitect = {
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
    runBacktest: (historicalData: any[]) => {
        let balance = 100000;
        let longPositions: { price: number, shares: number }[] = [];
        let shortPositions: { price: number, shares: number }[] = [];
        
        let winCount = 0, lossCount = 0, totalWin = 0, totalLoss = 0;
        
        for (let i = 20; i < historicalData.length; i++) {
            const tick = historicalData[i];
            const prices = historicalData.slice(0, i).map((t: any) => t.price);
            const signal = strategyArchitect.generateSignal(prices);
            
            // Apply slippage to entry price
            const entryPrice = signal === 'BUY' ? tick.price * (1 + BEST_SETTINGS.SLIPPAGE_RATE) : tick.price * (1 - BEST_SETTINGS.SLIPPAGE_RATE);
            
            let kellyFraction = 0.05;
            if (winCount + lossCount > 10) {
                const p = winCount / (winCount + lossCount);
                const b = (totalWin / (winCount || 1)) / (totalLoss / (lossCount || 1) || 1);
                const kelly = (p * b - (1 - p)) / b;
                kellyFraction = Math.max(0.01, Math.min(0.2, kelly * BEST_SETTINGS.KELLY_FRACTION));
            }
            
            const positionSize = balance * kellyFraction;
            const numShares = Math.max(1, Math.floor(positionSize / entryPrice));
            
            if (signal === 'BUY') {
                longPositions.push({ price: entryPrice, shares: numShares });
                balance -= (numShares * entryPrice * (1 + BEST_SETTINGS.COMMISSION_RATE));
            } else if (signal === 'SELL') {
                shortPositions.push({ price: entryPrice, shares: numShares });
                balance += (numShares * entryPrice * (1 - BEST_SETTINGS.COMMISSION_RATE));
            }
            
            // Check Take Profit with slippage
            const exitPrice = tick.price;
            longPositions = longPositions.filter(pos => {
                if (exitPrice >= pos.price * (1 + BEST_SETTINGS.TAKE_PROFIT)) {
                    const profit = (pos.shares * exitPrice * (1 - BEST_SETTINGS.COMMISSION_RATE)) - (pos.shares * pos.price * (1 + BEST_SETTINGS.COMMISSION_RATE));
                    if (profit > 0) { winCount++; totalWin += profit; } else { lossCount++; totalLoss += Math.abs(profit); }
                    balance += (pos.shares * exitPrice * (1 - BEST_SETTINGS.COMMISSION_RATE));
                    return false;
                }
                return true;
            });
            shortPositions = shortPositions.filter(pos => {
                if (exitPrice <= pos.price * (1 - BEST_SETTINGS.TAKE_PROFIT)) {
                    const profit = (pos.shares * pos.price * (1 - BEST_SETTINGS.COMMISSION_RATE)) - (pos.shares * exitPrice * (1 + BEST_SETTINGS.COMMISSION_RATE));
                    if (profit > 0) { winCount++; totalWin += profit; } else { lossCount++; totalLoss += Math.abs(profit); }
                    balance += (pos.shares * (pos.price * 2 - exitPrice) * (1 - BEST_SETTINGS.COMMISSION_RATE));
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
