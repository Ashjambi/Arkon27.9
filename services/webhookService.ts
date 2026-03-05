
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

export const fetchBridgeState = async (url: string): Promise<{positions: any[], history?: any[], balance?: number, queue_depth: number} | null> => {
    if (!url) return null;
    try {
        const response = await fetch(`${url}/state`, { method: 'GET', mode: 'cors' });
        if (response.ok) return await response.json();
        return null;
    } catch (e) { return null; }
};

export const sendToWebhook = async (
  signal: any,
  url: string,
  executedRisk: number,
  actionType: 'ENTRY' | 'FLIP' | 'HEDGE' | 'BOOST' | 'EXIT' | 'UPDATE_SL' | 'SECURE' = 'ENTRY',
  lotSize: number = 0,
  secret: string = '',
  partialPercent: number = 50.0
): Promise<{success: boolean; error?: string}> => {
  if (!url) return { success: false, error: "URL missing" };
  
  // تأمين الربح (SECURE): إغلاق جزئي وتحويل الستوب لنقطة الدخول
  const isSecureAction = actionType === 'SECURE';
  
  /**
   * بروتوكول الصفر الصارم: 
   * إذا كانت قيمة sl أو stopLoss هي 0، يجب إرسالها كما هي 0.
   * لا نستخدم عامل || الذي يحول الصفر إلى القيمة المجاورة.
   */
  let finalSL = 0;
  if (signal.stopLoss !== undefined && signal.stopLoss !== null) {
      finalSL = signal.stopLoss;
  } else if (signal.sl !== undefined && signal.sl !== null) {
      finalSL = signal.sl;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: signal.id || signal.signalId,
        symbol: signal.asset, 
        type: (signal.direction === SignalDirection.LONG || signal.direction === 'LONG') ? 'buy' : 'sell',
        price: signal.entry || signal.entryPrice,
        sl: finalSL,
        tp: signal.takeProfit || signal.tp,
        risk_pct: executedRisk,
        lot_size: lotSize,
        action_type: actionType, 
        close_opposite: actionType === 'FLIP',
        secure_amount: isSecureAction ? 1.0 : 0, 
        partial_percent: isSecureAction ? partialPercent : 0, 
        timestamp: Date.now(),
        secret: secret
      })
    });
    return { success: response.ok };
  } catch (e) { return { success: false, error: "Bridge unreachable" }; }
};
