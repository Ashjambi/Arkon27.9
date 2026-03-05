export const MQL5_CODE = `//+------------------------------------------------------------------+
//|                                           ArkonGuardian_v40.0.mq5|
//|          ARKON APEX v40.0 - FULL SYNC PROTOCOL                   |
//+------------------------------------------------------------------+
#property copyright "ARKON QUANT LAB"
#property version   "40.0"
#property strict

#include <Trade\\Trade.mqh>

input string   BridgeUrl   = "http://127.0.0.1:3000"; 
input long     MagicNum    = 888888;                  
input double   DefaultLots = 0.01; 
input string   BtcSymbol   = "BTCUSD"; 
input string   EthSymbol   = "ETHUSD"; 

CTrade trade;
uint lastSync = 0;

int OnInit() {
   trade.SetExpertMagicNumber((ulong)MagicNum);
   trade.SetDeviationInPoints(100); 
   trade.SetAsyncMode(false);
   
   EventSetTimer(1); 
   Print("🏛️ ARKON GUARDIAN v40.0: SYNC PROTOCOL ACTIVE.");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() {
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) return;
   
   // 1. Fetch Signals (High Frequency)
   FetchNextSignal(); 
   
   // 2. Sync State (Medium Frequency - every 3 seconds)
   uint now = GetTickCount();
   if (now - lastSync > 3000) { 
      ReportOpenPositions(); 
      lastSync = now; 
   }
}

// --- SYNC LOGIC ---
void ReportOpenPositions() {
   string jsonArr = "[";
   int total = PositionsTotal();
   int count = 0;
   
   for(int i = total - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket)) {
         if(PositionGetInteger(POSITION_MAGIC) == MagicNum) {
            if(count > 0) jsonArr += ",";
            
            string sym = PositionGetString(POSITION_SYMBOL);
            long type = PositionGetInteger(POSITION_TYPE); // 0=Buy, 1=Sell
            double vol = PositionGetDouble(POSITION_VOLUME);
            double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
            double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
            double sl = PositionGetDouble(POSITION_SL);
            double tp = PositionGetDouble(POSITION_TP);
            double profit = PositionGetDouble(POSITION_PROFIT);
            string comment = PositionGetString(POSITION_COMMENT); // Contains Signal ID
            
            // Extract pure ID from comment if format is "ARKON:ID"
            string signalId = comment;
            int splitIdx = StringFind(comment, ":");
            if(splitIdx > 0) signalId = StringSubstr(comment, splitIdx + 1);

            string dir = (type == POSITION_TYPE_BUY) ? "LONG" : "SHORT";
            
            // Build JSON Object
            string obj = StringFormat(
               "{\\"ticket\\":%d,\\"asset\\":\\"%s\\",\\"direction\\":\\"%s\\",\\"entryPrice\\":%f,\\"currentPrice\\":%f,\\"volume\\":%f,\\"pnl\\":%f,\\"sl\\":%f,\\"tp\\":%f,\\"signalId\\":\\"%s\\"}",
               ticket, sym, dir, openPrice, currentPrice, vol, profit, sl, tp, signalId
            );
            
            jsonArr += obj;
            count++;
         }
      }
   }
   jsonArr += "]";
   
   // Send to Bridge
   string payload = "{\\"type\\":\\"SYNC_STATE\\", \\"positions\\":" + jsonArr + "}";
   char data[]; StringToCharArray(payload, data, 0, StringLen(payload));
   char res_data[]; string res_headers;
   WebRequest("POST", BridgeUrl, "Content-Type: application/json\\r\\n", 500, data, res_data, res_headers);
}

// --- SIGNAL EXECUTION LOGIC ---
void FetchNextSignal() {
   string url = BridgeUrl + "/signal";
   char data[], res_data[]; string res_headers;
   int res = WebRequest("GET", url, "Content-Type: application/json\\r\\n", 500, data, res_data, res_headers);
   
   if(res != 200) return;
   string json = CharArrayToString(res_data);
   if (StringLen(json) < 5) return; 

   string id = ExtractJson(json, "id");
   if(id == "") return;
   
   string action = ExtractJson(json, "action_type");
   string rawSymbol = ExtractJson(json, "symbol");
   string tradeSymbol = MapSymbol(rawSymbol);

   if(action == "SECURE") { 
       double secureAmt = StringToDouble(ExtractJson(json, "secure_amount"));
       double partPct = StringToDouble(ExtractJson(json, "partial_percent"));
       ForceSecure(tradeSymbol, secureAmt, partPct); 
       return; 
   }
   
   if(action == "EXIT" || action == "FLIP") { 
       CloseSym(tradeSymbol); 
       if (action == "EXIT") return; 
   }
   
   ProcessEntry(json, tradeSymbol, id);
}

void ProcessEntry(string json, string symbol, string id) {
   // Prevent re-opening same ID if already open
   if (IsTradeExists(symbol, id)) return;

   SymbolSelect(symbol, true); // Ensure symbol is selected in Market Watch

   string type = ExtractJson(json, "type");
   string action = ExtractJson(json, "action_type");
   double tp = StringToDouble(ExtractJson(json, "tp"));
   double sl = StringToDouble(ExtractJson(json, "sl")); 
   double lots = StringToDouble(ExtractJson(json, "lot_size"));

   ENUM_ORDER_TYPE ordType = (type == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double price = (type == "buy") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   
   if (price <= 0) {
       Print("❌ Price is 0 for ", symbol, ". Check Market Watch.");
       return;
   }
   
   double finalLots = (lots > 0) ? lots : DefaultLots;
   finalLots = NormalizeLot(symbol, finalLots);

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if (sl > 0) sl = NormalizeDouble(sl, digits);
   if (tp > 0) tp = NormalizeDouble(tp, digits);

   int filling = (int)SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((filling & SYMBOL_FILLING_FOK) != 0) trade.SetTypeFilling(ORDER_FILLING_FOK);
   else if((filling & SYMBOL_FILLING_IOC) != 0) trade.SetTypeFilling(ORDER_FILLING_IOC);
   else trade.SetTypeFilling(ORDER_FILLING_RETURN);

   Print("ARKON: Launching ", action, " on ", symbol, " | Lots: ", finalLots, " | Price: ", price, " | SL: ", sl, " | TP: ", tp);

   if(trade.PositionOpen(symbol, ordType, finalLots, price, sl, tp, "ARKON:"+id)) {
      Print("✅ ORDER OK");
   } else {
      Print("❌ ORDER FAIL: ", GetLastError());
   }
}

void ForceSecure(string symbol, double usdAmount, double percentToClose) {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == symbol) {
         ulong ticket = PositionGetTicket(i);
         if(PositionSelectByTicket(ticket)) {
            if(PositionGetInteger(POSITION_MAGIC) == MagicNum) {
               double profit = PositionGetDouble(POSITION_PROFIT);
               if(profit >= usdAmount) {
                  if(percentToClose >= 100.0) {
                     trade.PositionClose(ticket, 100); 
                     continue; 
                  }
                  if(percentToClose > 0.0) {
                     double volToClose = NormalizeLot(symbol, PositionGetDouble(POSITION_VOLUME) * (percentToClose/100.0));
                     if(volToClose > 0.0) trade.PositionClosePartial(ticket, volToClose, 100);
                  }
                  if(PositionSelectByTicket(ticket)) {
                     double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
                     trade.PositionModify(ticket, openPrice, PositionGetDouble(POSITION_TP)); // Move SL to BE
                  }
               }
            }
         }
      }
   }
}

bool IsTradeExists(string symbol, string id) {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(PositionGetSymbol(i) == symbol) {
         ulong ticket = PositionGetTicket(i);
         if(PositionSelectByTicket(ticket)) {
            if(PositionGetInteger(POSITION_MAGIC) == MagicNum) {
               string comment = PositionGetString(POSITION_COMMENT);
               string expectedComment = "ARKON:" + id;
               if(StringFind(comment, expectedComment) == 0) return true;
            }
         }
      }
   }
   return false;
}

string MapSymbol(string in) { 
   if (StringFind(in, "BTC") >= 0) return BtcSymbol;
   if (StringFind(in, "ETH") >= 0) return EthSymbol;
   return in; 
}

void CloseSym(string s) { 
   for(int i=PositionsTotal()-1; i>=0; i--) { 
      if(PositionGetSymbol(i) == s) {
         ulong ticket = PositionGetTicket(i); 
         if(PositionSelectByTicket(ticket)) {
            if(PositionGetInteger(POSITION_MAGIC) == MagicNum) {
               trade.PositionClose(ticket, 100);
            }
         }
      }
   } 
}

double NormalizeLot(string sym, double lot) {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(step <= 0) return lot;
   double res = NormalizeDouble(MathFloor(lot/step)*step, 2);
   double min = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double max = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if (res < min) res = min;
   if (res > max) res = max;
   return res;
}

string ExtractJson(string json, string key) {
   string search = "\\\"" + key + "\\\":";
   int start = StringFind(json, search);
   if(start == -1) {
      // Try with space after colon just in case
      search = "\\\"" + key + "\\\" :";
      start = StringFind(json, search);
      if(start == -1) return "";
   }
   start += StringLen(search);
   while(start < StringLen(json) && StringSubstr(json, start, 1) == " ") start++;
   if(StringSubstr(json, start, 1) == "\\\"") {
      start++; int end = StringFind(json, "\\\"", start);
      if(end == -1) return "";
      return StringSubstr(json, start, end - start);
   }
   int end = start;
   while(end < StringLen(json) && StringSubstr(json, end, 1) != "," && StringSubstr(json, end, 1) != "}") end++;
   return StringSubstr(json, start, end - start);
}
`;

export const BRIDGE_CODE = `
/**
 * ARKON QUANT BRIDGE v4.1 - TELEGRAM RELAY
 * ---------------------------------------------
 * Features:
 * - FIFO Queue for Signals
 * - STATE OF TRUTH: Holds exact MT5 open positions
 * - DIRECT TELEGRAM RELAY (Zero Latency)
 * 
 * Usage: node arkon-bridge.js
 */

import http from 'http';
import https from 'https'; // Required for Telegram API

let signalQueue = [];      // FIFO Queue (Frontend -> MT5)
let activePositions = [];  // STATE OF TRUTH (MT5 -> Frontend)
let tradeHistory = [];     // History of closed trades
let accountBalance = 0;    // Account balance from MT5
let processedIds = new Set(); 
let lastHeartbeat = Date.now();

// Clean up processed IDs every minute
setInterval(() => {
    processedIds.clear();
    console.log('[MAINTENANCE] 🧹 Processed IDs cache cleared.');
}, 60000);

// Helper to send to Telegram directly from Node.js
const relayToTelegram = (botToken, chatId, text, res) => {
    const payload = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: \`/bot\${botToken}/sendMessage\`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const tgReq = https.request(options, (tgRes) => {
        let data = '';
        tgRes.on('data', (chunk) => { data += chunk; });
        tgRes.on('end', () => {
            if (tgRes.statusCode === 200) {
                console.log('[TELEGRAM] ✅ Message Sent.');
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ status: 'sent', provider: 'bridge_direct' }));
            } else {
                console.error(\`[TELEGRAM] ❌ Error: \${data}\`);
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ status: 'error', details: data }));
            }
        });
    });

    tgReq.on('error', (e) => {
        console.error(\`[TELEGRAM] ❌ Network Error: \${e.message}\`);
        res.writeHead(500);
        res.end(JSON.stringify({ status: 'error', details: e.message }));
    });

    tgReq.write(payload);
    tgReq.end();
};

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // 1. POST REQUESTS (INCOMING DATA)
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);

                // A. TELEGRAM RELAY (NEW FEATURE)
                if (data.type === 'TELEGRAM') {
                    if (!data.botToken || !data.chatId || !data.text) {
                        res.writeHead(400); res.end(JSON.stringify({error: "Missing fields"}));
                        return;
                    }
                    relayToTelegram(data.botToken, data.chatId, data.text, res);
                    return;
                }

                // B. RESET COMMAND
                if (data.type === 'RESET_BRIDGE') {
                    signalQueue = [];
                    activePositions = [];
                    processedIds.clear();
                    console.log(\`[BRIDGE] 🧹 SYSTEM RESET.\`);
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ status: 'cleared' }));
                    return;
                }

                // C. STATE SYNC (FROM MT5)
                if (data.type === 'SYNC_STATE') {
                    const newPositions = data.positions || [];
                    if (data.balance !== undefined) accountBalance = data.balance;
                    
                    // Detect closed positions
                    const newTickets = new Set(newPositions.map(p => p.ticket));
                    activePositions.forEach(p => {
                        if (!newTickets.has(p.ticket)) {
                            tradeHistory.unshift({
                                id: p.ticket.toString(),
                                asset: p.asset,
                                direction: p.direction,
                                entryPrice: p.entryPrice,
                                exitPrice: p.currentPrice,
                                timestamp: Date.now(),
                                pnlPoints: p.pnl,
                                outcome: p.pnl > 0 ? 'WIN' : (p.pnl < 0 ? 'LOSS' : 'BE')
                            });
                        }
                    });
                    
                    if (tradeHistory.length > 200) tradeHistory = tradeHistory.slice(0, 200);
                    
                    activePositions = newPositions;
                    lastHeartbeat = Date.now();
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ status: 'synced' }));
                    return;
                }

                // D. MT5 HEARTBEAT
                if (data.type === 'HEARTBEAT') {
                    lastHeartbeat = Date.now();
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ status: 'ack' }));
                    return;
                }

                // E. NEW SIGNAL (FROM FRONTEND)
                if (data.id && processedIds.has(data.id)) {
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({ status: 'ignored_duplicate' }));
                    return;
                }

                signalQueue.push({ ...data, queuedAt: Date.now() });
                if (data.id) processedIds.add(data.id); 
                
                console.log(\`[SIGNAL] ➡️ QUEUED: \${data.symbol} | \${data.action_type}\`);
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ status: 'queued', queueLength: signalQueue.length }));

            } catch (e) {
                res.writeHead(400); res.end('Invalid JSON');
            }
        });
    } 
    // 2. GET REQUESTS (POLLING)
    else if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });

        if (req.url.includes('/signal')) {
            const nextSignal = signalQueue.shift(); 
            if (nextSignal) console.log(\`[BRIDGE] 📤 SENT TO MT5: \${nextSignal.symbol}\`);
            res.end(JSON.stringify(nextSignal || {})); 
            return;
        }

        if (req.url.includes('/state')) {
            res.end(JSON.stringify({
                positions: activePositions,
                history: tradeHistory,
                balance: accountBalance,
                queue_depth: signalQueue.length,
                last_heartbeat: Date.now() - lastHeartbeat
            }));
            return;
        }

        res.end(JSON.stringify({ 
            status: 'online', 
            version: '4.1',
            active_trades: activePositions.length,
            queue_depth: signalQueue.length
        }));
    } else {
        res.writeHead(405); res.end('Method Not Allowed');
    }
});

server.listen(3000, '0.0.0.0', () => {
    console.log(\`\nARKON BRIDGE v4.1 (TELEGRAM RELAY) RUNNING ON http://127.0.0.1:3000 🚀\n\`);
});
`;
