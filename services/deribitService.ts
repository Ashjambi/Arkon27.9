
import { DeribitBookSummary, DeribitCandleData, DeribitOrderBook } from '../types';

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';

// Optimized Proxy List: Prioritizing raw proxies over wrapper proxies
const PROXY_NODES = [
  { url: 'https://api.codetabs.com/v1/proxy?quest=', type: 'direct' }, // Usually fastest/raw
  { url: 'https://api.allorigins.win/get?url=', type: 'wrapper' },     // Reliable but needs unwrapping
  { url: 'https://corsproxy.io/?url=', type: 'direct' }                 // Fallback
];

async function fetchWithProxy(targetUrl: string): Promise<any> {
  // Add aggressive cache busting
  const cacheBuster = `&_cb=${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const finalUrl = targetUrl.includes('?') ? `${targetUrl}${cacheBuster}` : `${targetUrl}?${cacheBuster}`;
  
  // Shuffle proxies to load balance, but keep track of failures
  const shuffledNodes = [...PROXY_NODES].sort(() => Math.random() - 0.5);

  for (const node of shuffledNodes) {
    const proxyUrl = `${node.url}${encodeURIComponent(finalUrl)}`;
    
    try {
      // Set a strict timeout (3 seconds) to prevent UI freezing
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const rawText = await response.text();
      let parsedData;

      try {
        parsedData = JSON.parse(rawText);
      } catch (e) {
        continue; // Failed to parse JSON
      }

      // HANDLE WRAPPER PROXIES (Like AllOrigins)
      if (node.type === 'wrapper' && parsedData.contents) {
         try {
             // The actual Deribit data is inside 'contents' as a string
             parsedData = JSON.parse(parsedData.contents);
         } catch(e) {
             continue; // Failed to parse inner content
         }
      }

      // VALIDATE STRUCTURE (Ensure it's actually Deribit data)
      if (parsedData && (parsedData.result !== undefined || parsedData.status === 'ok')) {
        const now = Date.now();
        // Calculate latency if timestamp exists
        const serverTime = parsedData.us ? (parsedData.us / 1000) : (parsedData.timestamp || now);
        return { ...parsedData, _ARKON_AGE_MS: Math.abs(now - serverTime) };
      }

    } catch (err: any) {
      // Silent fail to try next proxy
      continue;
    }
  }
  
  // If all proxies fail, return null to indicate connection loss
  throw new Error("DATA_FEED_UNREACHABLE");
}

export const fetchMarketSummary = async (currency: 'BTC' | 'ETH'): Promise<DeribitBookSummary[]> => {
  try {
    const url = `${DERIBIT_API_BASE}/public/get_book_summary_by_currency?currency=${currency}&kind=future`;
    const data = await fetchWithProxy(url);
    if (data?.result && Array.isArray(data.result)) {
      return data.result.map((item: any) => ({
        ...item,
        funding_8h: item.funding_8h || 0,
        _data_age_ms: data._ARKON_AGE_MS
      }));
    }
    return [];
  } catch (error) { 
    console.warn(`[ARKON] Feed Error (${currency}):`, error);
    return []; 
  }
};

export const fetchDVOL = async (currency: 'BTC' | 'ETH'): Promise<number> => {
  try {
    const url = `${DERIBIT_API_BASE}/public/get_volatility_index_data?currency=${currency}&resolution=60&start_timestamp=${Date.now() - 3600000}&end_timestamp=${Date.now()}`;
    const data = await fetchWithProxy(url);
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
    const url = `${DERIBIT_API_BASE}/public/get_tradingview_chart_data?instrument_name=${instrument}&start_timestamp=${start}&end_timestamp=${end}&resolution=${resolution}`;
    const data = await fetchWithProxy(url);
    return (data?.result?.status === 'ok') ? data.result : null;
  } catch { return null; }
};

export const fetchHistoricalContext = async (instrument: string): Promise<DeribitCandleData | null> => {
    try {
        const end = Date.now();
        const start = end - (1000 * 60 * 60 * 24 * 365 * 1); // Reduced to 1 year to prevent heavy payload timeout
        const url = `${DERIBIT_API_BASE}/public/get_tradingview_chart_data?instrument_name=${instrument}&start_timestamp=${start}&end_timestamp=${end}&resolution=1D`;
        const data = await fetchWithProxy(url);
        return (data?.result?.status === 'ok') ? data.result : null;
    } catch { return null; }
};

export const fetchOptionsVolume = async (currency: 'BTC' | 'ETH'): Promise<number> => {
  try {
    const url = `${DERIBIT_API_BASE}/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
    const data = await fetchWithProxy(url);
    if (data?.result && Array.isArray(data.result)) {
      return data.result.reduce((acc: number, item: any) => acc + (item.volume || 0), 0);
    }
    return 0;
  } catch { return 0; }
};

export const fetchOrderBook = async (instrument: string): Promise<DeribitOrderBook | null> => {
    try {
        const url = `${DERIBIT_API_BASE}/public/get_order_book?instrument_name=${instrument}&depth=10`;
        const data = await fetchWithProxy(url);
        if (data?.result) {
            return data.result;
        }
        return null;
    } catch { return null; }
};
