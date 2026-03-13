import express from "express";
import { createServer as createViteServer } from "vite";
import http from 'http';
import https from 'https';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // --- ARKON BRIDGE LOGIC ---
  let signalQueue = [];
  let activePositions = [];
  let tradeHistory = [];
  let accountBalance = 0;
  let processedIds = new Set();
  let lastHeartbeat = Date.now();

  app.use(express.json());

  // Helper to send to Telegram
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
                res.json({ status: 'sent', provider: 'bridge_direct' });
            } else {
                res.status(400).json({ status: 'error', details: data });
            }
        });
    });

    tgReq.on('error', (e) => {
        res.status(500).json({ status: 'error', details: e.message });
    });

    tgReq.write(payload);
    tgReq.end();
  };

  // Bridge API Routes
  app.post('/api/bridge', (req, res) => {
    const data = req.body;

    if (data.type === 'TELEGRAM') {
        relayToTelegram(data.botToken, data.chatId, data.text, res);
        return;
    }

    if (data.type === 'RESET_BRIDGE') {
        signalQueue = [];
        activePositions = [];
        processedIds.clear();
        res.json({ status: 'cleared' });
        return;
    }

    if (data.type === 'SYNC_STATE') {
        activePositions = data.positions || [];
        if (data.balance !== undefined) accountBalance = data.balance;
        lastHeartbeat = Date.now();
        res.json({ status: 'synced' });
        return;
    }

    if (data.type === 'HEARTBEAT') {
        lastHeartbeat = Date.now();
        res.json({ status: 'ack' });
        return;
    }

    if (data.id && processedIds.has(data.id)) {
        res.json({ status: 'ignored_duplicate' });
        return;
    }

    if (data.secret !== 'ARKON_SECURE_2025') {
        res.status(403).json({ error: 'Unauthorized' });
        return;
    }

    signalQueue.push({ ...data, queuedAt: Date.now() });
    if (data.id) processedIds.add(data.id);
    res.json({ status: 'queued', queueLength: signalQueue.length });
  });

  app.get('/api/bridge/signal', (req, res) => {
    const nextSignal = signalQueue.shift();
    res.json(nextSignal || {});
  });

  app.get('/api/bridge/state', (req, res) => {
    res.json({
        positions: activePositions,
        history: tradeHistory,
        balance: accountBalance,
        queue_depth: signalQueue.length,
        last_heartbeat: Date.now() - lastHeartbeat
    });
  });

  // Deribit API Proxy
  app.get('/api/deribit/:path*', async (req, res) => {
    const path = req.params.path;
    const query = new URLSearchParams(req.query as any).toString();
    const url = `https://www.deribit.com/api/v2/public/${path}?${query}`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch from Deribit' });
    }
  });

  // --- VITE MIDDLEWARE ---
  console.log("NODE_ENV:", process.env.NODE_ENV);
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve static files from dist
    app.use(express.static('dist'));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
