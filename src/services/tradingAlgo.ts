export const generateSignal = (asset: any, perp: any, summaries: any, candles: any, dailyCandles: any, orderBook: any, dvol: any, optVol: any) => {
    return {
        signal: null,
        analysis: {
            isNewsPaused: false,
            activeEvent: null
        }
    };
};
