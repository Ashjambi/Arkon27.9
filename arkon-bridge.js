
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
        path: `/bot${botToken}/sendMessage`,
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
                console.error(`[TELEGRAM] ❌ Error: ${data}`);
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ status: 'error', details: data }));
            }
        });
    });

    tgReq.on('error', (e) => {
        console.error(`[TELEGRAM] ❌ Network Error: ${e.message}`);
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
                    console.log(`[BRIDGE] 🧹 SYSTEM RESET.`);
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

                // SECURE: Validate secret
                if (data.secret !== 'ARKON_SECURE_2025') {
                    console.error(`[SECURITY] ❌ Unauthorized attempt with secret: ${data.secret}`);
                    res.writeHead(403);
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                signalQueue.push({ ...data, queuedAt: Date.now() });
                if (data.id) processedIds.add(data.id); 
                
                console.log(`[SIGNAL] ➡️ QUEUED: ${data.symbol} | ${data.action_type}`);
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
            if (nextSignal) console.log(`[BRIDGE] 📤 SENT TO MT5: ${nextSignal.symbol}`);
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
    console.log(`\nARKON BRIDGE v4.1 (TELEGRAM RELAY) RUNNING ON http://127.0.0.1:3000 🚀\n`);
});
