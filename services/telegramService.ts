
import { TradingSignal, SignalDirection, SignalStrength } from '../types';

const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Proxies as fallback only (Slow & Unreliable)
const PROXIES = [
    { url: 'https://api.codetabs.com/v1/proxy?quest=', encode: true },
    { url: 'https://corsproxy.io/?url=', encode: true }
];

export const sendSignalToTelegram = async (
  signal: TradingSignal,
  chatId: string,
  botToken: string,
  actionType: 'ENTRY' | 'FLIP' | 'HEDGE' | 'BOOST' | 'EXIT' | 'SECURE' = 'ENTRY',
  exitReason: string = '',
  bridgeUrl?: string 
): Promise<{success: boolean; error?: string}> => {
  if (!botToken || !chatId) return { success: false, error: "Missing botToken or chatId" };

  const isLong = signal.direction === SignalDirection.LONG;
  const assetName = signal.asset.split('-')[0]; 
  
  const sideEmoji = isLong ? '🟢' : '🔴';
  const sideText = isLong ? 'LONG (BUY)' : 'SHORT (SELL)';
  
  let headerTitle = "";
  let subHeader = "";
  let strategySection = "";
  
  // --- TEMPLATE LOGIC ---
  if (actionType === 'EXIT') {
      const isWin = !exitReason.includes('LOSS') && !exitReason.includes('STOP');
      const exitHeader = isWin ? '💰 GAINS SECURED' : '🏁 POSITION CLOSED';
      
      const message = `
<b>${exitHeader} | ${assetName}</b>
──────────────────────
<b>🆔 ID:</b> <code>#${signal.id.split('-')[1] || 'MANUAL'}</code>
<b>📅 DATE:</b> <i>${new Date().toLocaleDateString()}</i>

<b>🔻 CLOSE DETAILS:</b>
<b>• REASON:</b> ${exitReason}
<b>• DIRECTION:</b> ${sideText}
<b>• EXIT PRICE:</b> <i>Market Execution</i>

<b>📝 EXECUTION NOTE:</b>
<i>Position closed via ARKON Bridge. Check MT5 for realized PnL.</i>
──────────────────────
🤖 <b>ARKON QUANT TERMINAL</b>
      `;
      
      return await dispatchMessage(botToken, chatId, message, bridgeUrl);
  }

  switch (actionType) {
      case 'FLIP':
          headerTitle = `🔄 FLIP EXECUTED`;
          subHeader = `⚠️ <b>ACTION:</b> <i>Reverse & Open New</i>`;
          strategySection = `
<b>⚔️ STRATEGY: FLIP</b>
• Previous position closed.
• <b>${sideText}</b> Order Sent to MT5.
• <i>Reason: Momentum Shift > 1.5σ</i>`;
          break;

      case 'HEDGE':
          headerTitle = `🛡️ HEDGE ACTIVATED`;
          subHeader = `🔒 <b>ACTION:</b> <i>Defensive Layer Added</i>`;
          strategySection = `
<b>🛡️ STRATEGY: HEDGE</b>
• Original position remains OPEN.
• <b>${sideText}</b> Protection Sent to MT5.
• <i>Reason: Risk Offset Triggered.</i>`;
          break;

      case 'BOOST':
          headerTitle = `🚀 BOOST EXECUTED`;
          subHeader = `🔋 <b>ACTION:</b> <i>Adding to Winner</i>`;
          strategySection = `
<b>🚀 STRATEGY: PYRAMIDING</b>
• <b>${sideText}</b> Layer Sent to MT5.
• Trend Strength: ${signal.qualityScore}%
• <i>Reason: Compounding on Volume.</i>`;
          break;

      case 'SECURE':
          headerTitle = `🛡️ RISK SECURED`;
          subHeader = `🔒 <b>ACTION:</b> <i>Breakeven / Partial</i>`;
          strategySection = `
<b>🛡️ STRATEGY: SAFETY</b>
• Moved SL to Entry.
• Secured realized gains.
• <i>Reason: Price moved > Secure Threshold.</i>`;
          break;

      default: // STANDARD ENTRY
          headerTitle = `${sideEmoji} ORDER EXECUTED`;
          subHeader = `⚡ <b>STATUS:</b> <i>Sent to Bridge</i>`;
          strategySection = `
<b>🧠 QUANT ANALYSIS:</b>
• <b>Score:</b> ${signal.qualityScore}/100
• <b>Regime:</b> ${signal.details.quantRegime.replace('_', ' ')}
• <b>Logic:</b> ${signal.reasoning}`;
          break;
  }

  const message = `
<b>${headerTitle} | ${assetName}</b>
──────────────────────
${subHeader}

<b>🎯 EXECUTION DETAILS:</b>
<b>• ASSET:</b> #${assetName}
<b>• SIDE:</b> <b>${sideText}</b>
<b>• ENTRY:</b> <code>$${formatPrice(signal.entry)}</code>
<b>• TARGET:</b> <code>$${formatPrice(signal.takeProfit)}</code>
<b>• SAFETY:</b> <code>${signal.stopLoss === 0 ? 'Zero-SL (Hedge Mode)' : '$' + formatPrice(signal.stopLoss)}</code>

${strategySection}
──────────────────────
📡 <i>ARKON Guardian v27.0</i>
`;

  return await dispatchMessage(botToken, chatId, message, bridgeUrl);
};

// Helper function to send the request
const dispatchMessage = async (token: string, chat: string, text: string, bridgeUrl?: string) => {
    
    // 1. PRIMARY METHOD: Use Local Bridge (FASTEST & MOST RELIABLE)
    // The bridge now has a specific 'TELEGRAM' handler to bypass CORS and Latency
    if (bridgeUrl) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s Timeout
            
            const bridgeRes = await fetch(bridgeUrl, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'TELEGRAM', // New Handler in Bridge v4.1
                    botToken: token,
                    chatId: chat,
                    text: text
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (bridgeRes.ok) {
                const json = await bridgeRes.json();
                if (json.status === 'sent') return { success: true };
            }
            console.warn("Bridge Telegram Relay returned error, falling back...");
        } catch (e) {
            console.warn("Bridge unreachable for Telegram, falling back to Proxies...", e);
        }
    }

    // 2. FALLBACK METHOD: Public Proxies (SLOW)
    // Only used if Bridge is down or not configured
    const targetUrl = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chat}&text=${encodeURIComponent(text.trim())}&parse_mode=HTML&disable_web_page_preview=true`;
    let lastError = "";

    for (const proxy of PROXIES) {
        try {
            const finalUrl = `${proxy.url}${proxy.encode ? encodeURIComponent(targetUrl) : targetUrl}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const res = await fetch(finalUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const json = await res.json();
                if (json.ok || json.contents) return { success: true }; 
            }
        } catch (e: any) { 
            lastError = e.message;
            continue; 
        }
    }
    
    return { success: false, error: "All delivery methods failed. Check Bridge Connection." };
}

export const sendTestMessage = async (botToken: string, chatId: string, bridgeUrl?: string): Promise<{success: boolean; error?: string}> => {
  if (!botToken || !chatId) return { success: false, error: "Config missing" };
  const message = `
<b>🔔 ARKON SYSTEM HEARTBEAT</b>
──────────────────────
<b>✅ STATUS:</b> ONLINE
<b>📡 BRIDGE:</b> CONNECTED
<b>🚀 MODE:</b> TURBO RELAY

<i>Connection verified successfully.</i>
──────────────────────
  `;
  return await dispatchMessage(botToken, chatId, message, bridgeUrl);
};
