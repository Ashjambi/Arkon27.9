
import { TradingSignal, SignalDirection } from '../types';

export const checkBridgeStatus = async (url: string): Promise<boolean> => {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); 
    const response = await fetch(url, { method: 'GET', mode: 'cors', signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) { return false; }
};

export const clearRemoteBridge = async (url: string): Promise<boolean> => {
    try {
        await fetch(url, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'RESET_BRIDGE' })
        });
        return true;
    } catch (e) { return false; }
};

export const fetchBridgeState = async (url: string): Promise<{positions: any[], queue_depth: number} | null> => {
    if (!url) return null;
    try {
        const response = await fetch(`${url}/state`, {
            method: 'GET',
            mode: 'cors'
        });
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (e) { return null; }
};

export const sendToWebhook = async (
  signal: TradingSignal,
  url: string,
  executedRisk: number,
  actionType: 'ENTRY' | 'FLIP' | 'HEDGE' | 'BOOST' | 'EXIT' | 'UPDATE_SL' | 'SECURE' = 'ENTRY',
  lotSize: number = 0,
  secret: string = '' // إضافة مفتاح الأمان
): Promise<{success: boolean; error?: string}> => {
  if (!url) return { success: false, error: "URL missing" };
  
  const closeOpposite = actionType === 'FLIP';
  
  const secureAmount = (actionType === 'SECURE' && signal.details?.secureThreshold) 
                       ? signal.details.secureThreshold 
                       : 0;
  
  const partialPercent = (actionType === 'SECURE' && signal.details?.partialClosePercent)
                       ? signal.details.partialClosePercent
                       : 0;

  try {
    const response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: signal.id,
        symbol: signal.asset, 
        type: signal.direction === SignalDirection.LONG ? 'buy' : 'sell',
        price: signal.entry,
        sl: signal.stopLoss,
        tp: signal.takeProfit,
        risk_pct: executedRisk,
        lot_size: lotSize,
        action_type: actionType, 
        close_opposite: closeOpposite,
        secure_amount: secureAmount,
        partial_percent: partialPercent, 
        timestamp: Date.now(),
        secret: secret // إرسال مفتاح الأمان للتحقق
      })
    });
    return { success: response.ok };
  } catch (e) { return { success: false, error: "Bridge unreachable" }; }
};
