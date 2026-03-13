// @ts-ignore
import Deribit from 'deribit';

// Lazy initialization to prevent crashes if keys are missing
let deribitClient: any = null;

export function getDeribitClient() {
  if (!deribitClient) {
    const apiKey = process.env.DERIBIT_API_KEY;
    const apiSecret = process.env.DERIBIT_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      throw new Error('DERIBIT_API_KEY and DERIBIT_API_SECRET are required');
    }
    
    deribitClient = new Deribit({
      key: apiKey,
      secret: apiSecret,
      testnet: true // Paper trading mode
    });
  }
  return deribitClient;
}

export async function testConnection() {
  try {
    const client = getDeribitClient();
    const result = await client.public.test();
    console.log("Deribit connection test successful:", result);
    return true;
  } catch (error) {
    console.error("Deribit connection test failed:", error);
    return false;
  }
}
