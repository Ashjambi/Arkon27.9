import { mean, std } from 'mathjs';

export const simulationEngine = {
    runMonteCarlo: (numSimulations: number, steps: number) => {
        console.log(`Running ${numSimulations} Monte Carlo simulations...`);
        const results = [];
        
        for (let i = 0; i < numSimulations; i++) {
            // Simulate price path (Geometric Brownian Motion)
            let price = 50000;
            const path = [price];
            for (let j = 0; j < steps; j++) {
                price *= (1 + (Math.random() - 0.5) * 0.02);
                path.push(price);
            }
            results.push(path[path.length - 1]);
        }
        
        return {
            meanFinalPrice: mean(results) as unknown as number,
            stdFinalPrice: std(results) as unknown as number,
            minPrice: Math.min(...results),
            maxPrice: Math.max(...results)
        };
    }
};

// --- Execution ---
async function runSimulation() {
    console.log("--- Starting Monte Carlo Simulation (BTC/ETH) ---");
    
    const result = simulationEngine.runMonteCarlo(1000, 100);
    
    console.log("Simulation Results:");
    console.log(`Mean Final Price: ${result.meanFinalPrice.toFixed(2)}`);
    console.log(`Std Dev: ${result.stdFinalPrice.toFixed(2)}`);
    console.log("--- Simulation Complete ---");
}

runSimulation().catch(console.error);
