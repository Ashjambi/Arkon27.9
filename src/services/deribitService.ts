import { DeribitBookSummary, DeribitCandleData, DeribitOrderBook } from '../types';

const DERIBIT_BASE_URL = 'https://www.deribit.com/api/v2/public';

const fetchFromDeribit = async (url: string) => {
  const response = await fetch(`/api/deribit?url=${encodeURIComponent(url)}`);
  return await response.json();
};

export const deribitService = {
  async getBookSummary(instrument: string) {
    try {
      const data = await fetchFromDeribit(`${DERIBIT_BASE_URL}/get_book_summary_by_instrument?instrument_name=${instrument}`);
      return data.result[0];
    } catch (e) {
      console.error(`Error fetching book summary for ${instrument}:`, e);
      return null;
    }
  },
  async getCandles(instrument: string, timeframe: string) {
    try {
      // Note: Deribit historical data requires specific start/end times, simplifying for now
      const end = Math.floor(Date.now() / 1000);
      const start = end - (24 * 60 * 60); // Last 24 hours
      // Using '60' for 1 hour resolution as per Deribit API docs
      const resolution = timeframe === '1H' ? '60' : timeframe;
      const data = await fetchFromDeribit(`${DERIBIT_BASE_URL}/get_tradingview_chart_data?instrument_name=${instrument}&start_timestamp=${start}&end_timestamp=${end}&resolution=${resolution}`);
      return data.result;
    } catch (e) {
      console.error(`Error fetching candles for ${instrument}:`, e);
      return null;
    }
  },
  async getOrderBook(instrument: string) {
    try {
      const data = await fetchFromDeribit(`${DERIBIT_BASE_URL}/get_order_book?instrument_name=${instrument}`);
      return data.result;
    } catch (e) {
      console.error(`Error fetching order book for ${instrument}:`, e);
      return null;
    }
  }
};
