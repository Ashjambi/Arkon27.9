import { DeribitBookSummary, DeribitCandleData, DeribitOrderBook } from '../../types';

const DERIBIT_API_BASE = '/api/deribit';

async function fetchFromProxy(targetPath: string, params: Record<string, string> = {}): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const url = `${DERIBIT_API_BASE}/${targetPath}?${query}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    return data;
  } catch (err) {
    console.error(`[ARKON] Feed Error (${targetPath}):`, err);
    throw err;
  }
}

export async function testConnection() {
  try {
    await fetchFromProxy('test');
    return true;
  } catch (error) {
    console.error("Deribit connection test failed:", error);
    return false;
  }
}

export const fetchMarketSummary = async (currency: 'BTC' | 'ETH'): Promise<DeribitBookSummary[]> => {
  try {
    const data = await fetchFromProxy('get_book_summary_by_currency', { currency, kind: 'future' });
    if (data?.result && Array.isArray(data.result)) {
      return data.result.map((item: any) => ({
        ...item,
        funding_8h: item.funding_8h || 0,
        _data_age_ms: 0
      }));
    }
    return [];
  } catch (error) { return []; }
};

export const fetchDVOL = async (currency: 'BTC' | 'ETH'): Promise<number> => {
  try {
    const data = await fetchFromProxy('get_volatility_index_data', { 
        currency, 
        resolution: '60', 
        start_timestamp: (Date.now() - 3600000).toString(), 
        end_timestamp: Date.now().toString() 
    });
    if (data?.result?.data?.length > 0) {
      const lastPoint = data.result.data[data.result.data.length - 1];
      return lastPoint[4]; 
    }
    return 0;
  } catch { return 0; }
};

export const fetchCandles = async (instrument: string, resolution: string = '15'): Promise<DeribitCandleData | null> => {
  try {
    const end = Date.now();
    const start = end - (1000 * 60 * 60 * 12); 
    const data = await fetchFromProxy('get_tradingview_chart_data', { 
        instrument_name: instrument, 
        start_timestamp: start.toString(), 
        end_timestamp: end.toString(), 
        resolution 
    });
    return (data?.result?.status === 'ok') ? data.result : null;
  } catch { return null; }
};

export const fetchHistoricalContext = async (instrument: string): Promise<DeribitCandleData | null> => {
    try {
        const end = Date.now();
        const start = end - (1000 * 60 * 60 * 24 * 365 * 1);
        const data = await fetchFromProxy('get_tradingview_chart_data', { 
            instrument_name: instrument, 
            start_timestamp: start.toString(), 
            end_timestamp: end.toString(), 
            resolution: '1D' 
        });
        return (data?.result?.status === 'ok') ? data.result : null;
    } catch { return null; }
};

export const fetchOptionsVolume = async (currency: 'BTC' | 'ETH'): Promise<number> => {
  try {
    const data = await fetchFromProxy('get_book_summary_by_currency', { currency, kind: 'option' });
    if (data?.result && Array.isArray(data.result)) {
      return data.result.reduce((acc: number, item: any) => acc + (item.volume || 0), 0);
    }
    return 0;
  } catch { return 0; }
};

export const fetchOrderBook = async (instrument: string): Promise<DeribitOrderBook | null> => {
    try {
        const data = await fetchFromProxy('get_order_book', { instrument_name: instrument, depth: '10' });
        if (data?.result) {
            return data.result;
        }
        return null;
    } catch { return null; }
};
