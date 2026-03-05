import { mean, std } from 'mathjs';

export const dataPipeline = {
    // WebSocket connection to Deribit
    connectToDeribit: (instrument: string) => {
        try {
            const ws = new WebSocket(`wss://www.deribit.com/ws/api/v2`);
            ws.onopen = () => {
                ws.send(JSON.stringify({
                    "jsonrpc": "2.0",
                    "method": "public/subscribe",
                    "params": { "channels": [`ticker.${instrument}.raw`, `book.${instrument}.raw`] },
                    "id": 1
                }));
            };
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // Handle data
                } catch (e) {
                    console.error("Error parsing WebSocket message:", e);
                }
            };
            ws.onerror = (error) => {
                console.error("WebSocket Error:", error);
            };
            ws.onclose = () => {
                console.log("WebSocket connection closed");
            };
            return ws;
        } catch (e) {
            console.error("Failed to create WebSocket:", e);
            return null;
        }
    },
    // Robust data cleaning: Outlier removal and imputation
    cleanData: (data: number[]) => {
        const mu = Number(mean(data));
        const sigma = Number(std(data));
        // Remove outliers (Z-score > 3) and interpolate missing
        return data.map((x, i) => {
            if (Math.abs(x - mu) > 3 * sigma) return mu; // Outlier imputation
            if (isNaN(x)) return mu; // Missing data imputation
            return x;
        });
    },
    // Data cleaning and normalization
    normalize: (data: number[]) => {
        const clean = dataPipeline.cleanData(data); // Using the internal cleaner
        const mu = Number(mean(clean));
        const sigma = Number(std(clean));
        return clean.map(x => (Number(x) - mu) / sigma);
    },
    // Historical data storage
    storeHistoricalData: (data: any) => {
        // Database logic
    }
};
