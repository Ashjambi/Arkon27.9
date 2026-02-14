
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
   trade.SetTypeFilling(ORDER_FILLING_IOC); 
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
               "{\\"ticket\\":%d,\\"asset\\":\\"%s\\",\\"direction\\":\\"%s\\",\\"entryPrice\\":%.2f,\\"currentPrice\\":%.2f,\\"volume\\":%.2f,\\"pnl\\":%.2f,\\"sl\\":%.2f,\\"tp\\":%.2f,\\"signalId\\":\\"%s\\"}",
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

   string type = ExtractJson(json, "type");
   string action = ExtractJson(json, "action_type");
   double tp = StringToDouble(ExtractJson(json, "tp"));
   double sl = StringToDouble(ExtractJson(json, "sl")); 
   double lots = StringToDouble(ExtractJson(json, "lot_size"));

   ENUM_ORDER_TYPE ordType = (type == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double price = (type == "buy") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   
   if (price <= 0) return;
   double finalLots = (lots > 0) ? lots : DefaultLots;
   finalLots = NormalizeLot(symbol, finalLots);

   Print("ARKON: Launching ", action, " on ", symbol);

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
               // Check if comment contains ID (handling "ARKON:" prefix)
               if(StringFind(comment, id) >= 0) return true;
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
   string search = "\\\"" + key + "\\\"";
   int start = StringFind(json, search);
   if(start == -1) return "";
   start += StringLen(search);
   while(start < StringLen(json) && (StringSubstr(json, start, 1) == ":" || StringSubstr(json, start, 1) == " ")) start++;
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
