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
    Z_SCORE_ENTRY: 2.0, // الدخول عند انحراف معياري 2
    Z_SCORE_EXIT: 0.5,  // الخروج عند العودة بالقرب من المتوسط
    STOP_LOSS_Z: 3.5, // وقف الخسارة عند انحراف معياري 3.5
    KELLY_FRACTION: 0.15,
    COMMISSION_RATE: 0.001,
    SLIPPAGE_RATE: 0.0005
};

const strategyArchitect = {
    generateSignal: (spreads: number[]) => {
        const n = spreads.length;
        if (n < 30) return 'HOLD';
        
        const currentSpread = spreads[n - 1];
        const meanSpread = Number(mean(spreads.slice(n - 30, n)));
        const stdSpread = Number(std(spreads.slice(n - 30, n)));
        
        const zScore = (currentSpread - meanSpread) / (stdSpread || 1);
        
        // DEBUG:
        if (Math.random() < 0.01) console.log(`Spread: ${currentSpread.toFixed(2)}, Mean: ${meanSpread.toFixed(2)}, Std: ${stdSpread.toFixed(2)}, Z: ${zScore.toFixed(2)}`);
        
        if (zScore > BEST_SETTINGS.Z_SCORE_ENTRY) return 'SELL_SPREAD'; // بيع الفارق (بيع A، شراء B)
        if (zScore < -BEST_SETTINGS.Z_SCORE_ENTRY) return 'BUY_SPREAD';  // شراء الفارق (شراء A، بيع B)
        if (Math.abs(zScore) < BEST_SETTINGS.Z_SCORE_EXIT) return 'EXIT';
        return 'HOLD';
    }
};

export const backtestingEngine = {
    runBacktest: (dataA: number[], dataB: number[]) => {
        let balance = 100000;
        let spreadPositions = 0; 
        let entrySpread = 0;
        
        const spreads = dataA.map((a, i) => a - dataB[i]);
        
        for (let i = 30; i < spreads.length; i++) {
            const currentSpread = spreads[i];
            const meanSpread = Number(mean(spreads.slice(i - 30, i)));
            const stdSpread = Number(std(spreads.slice(i - 30, i))) || 1;
            const zScore = (currentSpread - meanSpread) / stdSpread;
            
            const signal = strategyArchitect.generateSignal(spreads.slice(0, i));
            
            // إدارة المخاطر: وقف الخسارة
            if (spreadPositions !== 0 && Math.abs(zScore) > BEST_SETTINGS.STOP_LOSS_Z) {
                console.log(`[RISK] Stop-loss triggered at Z=${zScore.toFixed(2)}`);
                const profit = (currentSpread - entrySpread) * spreadPositions * 1000;
                balance += profit;
                spreadPositions = 0;
                continue;
            }
            
            // تحديد حجم الصفقة (Position Sizing)
            const tradeSize = (balance * BEST_SETTINGS.KELLY_FRACTION) / 1000;
            
            if (signal === 'BUY_SPREAD' && spreadPositions === 0) {
                spreadPositions = 1;
                entrySpread = currentSpread;
                console.log(`[TRADE] Opened LONG spread at ${entrySpread.toFixed(2)} with size ${tradeSize.toFixed(2)}`);
            } else if (signal === 'SELL_SPREAD' && spreadPositions === 0) {
                spreadPositions = -1;
                entrySpread = currentSpread;
                console.log(`[TRADE] Opened SHORT spread at ${entrySpread.toFixed(2)} with size ${tradeSize.toFixed(2)}`);
            } else if (signal === 'EXIT' && spreadPositions !== 0) {
                const profit = (currentSpread - entrySpread) * spreadPositions * 1000 * tradeSize;
                balance += profit;
                console.log(`[TRADE] Closed spread at ${currentSpread.toFixed(2)}, Profit: ${profit.toFixed(2)}, Balance: ${balance.toFixed(2)}`);
                spreadPositions = 0;
            }
        }
        return { finalBalance: balance, totalReturn: ((balance - 100000) / 100000) * 100 };
    }
};

async function runSimulation() {
    console.log("--- Starting Cointegration Pairs Trading Simulation (Mean-Reverting) ---");
    
    // توليد فارق (Spread) يعود للمتوسط (Ornstein-Uhlenbeck process approximation)
    const spreads: number[] = [];
    let currentSpread = 0;
    const meanSpread = 0;
    const speed = 0.05; // سرعة العودة للمتوسط
    
    for(let i=0; i<1000; i++) {
        // dSpread = speed * (mean - spread) * dt + noise
        currentSpread += speed * (meanSpread - currentSpread) + (Math.random() - 0.5) * 2;
        spreads.push(currentSpread);
    }
    
    // محاكاة سعرين بناءً على الفارق
    const dataA = spreads.map(s => 50000 + s/2);
    const dataB = spreads.map(s => 50000 - s/2);
    
    const result = backtestingEngine.runBacktest(dataA, dataB);

    console.log("Simulation Results:");
    console.log(`Final Balance: ${result.finalBalance.toFixed(2)}`);
    console.log(`Total Return: ${result.totalReturn.toFixed(2)}%`);
    console.log("--- Simulation Complete ---");
}

runSimulation().catch(console.error);
