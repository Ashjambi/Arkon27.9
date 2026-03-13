import yahooFinance from 'yahoo-finance2';

export async function getStockData(symbol: string, period1: string) {
    const queryOptions = { period1 };
    const result: any[] = await yahooFinance.historical(symbol, queryOptions);
    return Array.isArray(result) ? result.map(r => r.close) : [];
}
