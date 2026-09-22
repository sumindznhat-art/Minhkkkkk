// ============================================================
// server.js — Tài Xỉu MD5 API + Giao diện HTML
// Seed: 7058706 (1-4-6 TÀI), 7058707 (4-6-5 TÀI)
// Tự sinh: 7058708, 7058709, ...
// Serve index.html tại route /
// ============================================================

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

/* ==================== CONFIG ==================== */
const PORT = process.env.PORT || 3000;
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS) || 30000;
const HISTORY_SIZE = parseInt(process.env.HISTORY_SIZE) || 500;
const START_SESSION = parseInt(process.env.START_SESSION) || 7058708;

/* ==================== SEED ==================== */
const SEED = [
  { session: '7058706', dice: [1, 4, 6] },  // sum 11 → TÀI
  { session: '7058707', dice: [4, 6, 5] },  // sum 15 → TÀI
];

let sessionCounter = START_SESSION;
const sessions = [];

/* ==================== HELPERS ==================== */
function rand6() { return Math.ceil(Math.random() * 6); }
function randomDice() { return [rand6(), rand6(), rand6()]; }

function computeResult(dice) {
  const sum = dice.reduce((a, b) => a + b, 0);
  const result = sum >= 11 ? 'tài' : 'xỉu';
  const type = sum >= 11 ? 'tai' : 'xiu';
  return { sum, result, type };
}

function buildRecord(session, dice, seeded = false) {
  const { sum, result, type } = computeResult(dice);
  return {
    session: String(session),
    dice,
    sum,
    result,
    type,
    time: new Date().toISOString(),
    seeded
  };
}

/* ==================== SEED ==================== */
function loadSeed() {
  const baseTime = Date.now() - SEED.length * INTERVAL_MS;
  SEED.forEach((s, i) => {
    const rec = buildRecord(s.session, s.dice, true);
    rec.time = new Date(baseTime + i * INTERVAL_MS).toISOString();
    sessions.push(rec);
  });
  console.log('📌 Seed:');
  sessions.forEach(s => console.log(`   #${s.session}: ${s.dice.join('-')} = ${s.sum} → ${s.result.toUpperCase()}`));
}

/* ==================== GENERATE ==================== */
function generateSession() {
  const session = String(sessionCounter++);
  const dice = randomDice();
  const rec = buildRecord(session, dice, false);
  sessions.push(rec);
  if (sessions.length > HISTORY_SIZE) sessions.shift();
  const time = new Date().toLocaleTimeString('vi-VN');
  console.log(`[${time}] Phiên ${session}: ${dice.join('-')} = ${rec.sum} → ${rec.result.toUpperCase()}`);
  return rec;
}

/* ==================== PREDICT ==================== */
function predict() {
  const w = sessions.slice(-10);
  if (!w.length) return { prediction: 'tài', confidence: 0.5, based_on: 0, breakdown: { tai: 0, xiu: 0 }, reason: 'no_data' };
  let tai = 0, xiu = 0;
  w.forEach(s => s.type === 'tai' ? tai++ : xiu++);
  const total = tai + xiu;
  let prediction, confidence, reason;
  const last = w[w.length - 1], prev = w[w.length - 2];
  if (prev && last && prev.type === last.type) {
    prediction = last.type === 'tai' ? 'xỉu' : 'tài';
    confidence = 0.75;
    reason = `break_streak_${last.type}`;
  } else if (tai > xiu) {
    prediction = 'xỉu';
    confidence = Math.min(0.5 + (tai - xiu) / total, 0.95);
    reason = 'follow_majority_xiu';
  } else if (xiu > tai) {
    prediction = 'tài';
    confidence = Math.min(0.5 + (xiu - tai) / total, 0.95);
    reason = 'follow_majority_tai';
  } else {
    prediction = last.type === 'tai' ? 'xỉu' : 'tài';
    confidence = 0.55;
    reason = 'tie_break';
  }
  return { prediction, confidence: Math.round(confidence * 100) / 100, based_on: total, breakdown: { tai, xiu }, reason };
}

/* ==================== CORS + JSON ==================== */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS });
  res.end(JSON.stringify(data, null, 2));
}
function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

/* ==================== SERVE STATIC FILES ==================== */
function serveStatic(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', ...CORS });
  res.end(content);
  return true;
}

/* ==================== HTTP SERVER ==================== */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;
  const q = parsed.query;

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  /* ====== SERVE HTML + STATIC ====== */
  if (p === '/' || p === '/index.html') {
    if (serveStatic(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8')) return;
    return json(res, { error: 'index.html not found' }, 404);
  }
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

  /* ====== API ROUTES ====== */
  if (p === '/api') {
    return json(res, {
      name: 'Tài Xỉu MD5 API',
      status: 'running',
      interval_ms: INTERVAL_MS,
      start_session: START_SESSION,
      next_session: sessionCounter,
      current_session: sessions[sessions.length - 1]?.session || '',
      total_sessions: sessions.length,
      endpoints: [
        'GET /api/health', 'GET /api/current', 'GET /api/history?limit=50',
        'GET /api/predict', 'GET /api/config', 'POST /api/generate',
        'POST /api/webhook', 'POST /api/reset'
      ]
    });
  }

  if (p === '/api/health') {
    return json(res, { status: 'ok', time: new Date().toISOString(), uptime: Math.floor(process.uptime()), next_session: sessionCounter });
  }

  if (p === '/api/current') {
    const cur = sessions[sessions.length - 1];
    if (!cur) return json(res, { error: 'no_data' }, 404);
    const pred = predict();
    return json(res, { ...cur, next_session: sessionCounter, prediction: pred.prediction, confidence: pred.confidence });
  }

  if (p === '/api/history') {
    const limit = Math.min(parseInt(q.limit) || 50, HISTORY_SIZE);
    return json(res, {
      current_session: sessions[sessions.length - 1]?.session || '',
      next_session: sessionCounter,
      total: sessions.length,
      history: sessions.slice(-limit).reverse()
    });
  }

  if (p === '/api/predict') {
    const pred = predict();
    return json(res, {
      ...pred,
      current_session: sessions[sessions.length - 1]?.session || '',
      next_session: sessionCounter,
      last_2_sessions: sessions.slice(-2).map(s => ({ session: s.session, dice: s.dice, sum: s.sum, result: s.result })),
      time: new Date().toISOString()
    });
  }

  if (p === '/api/config') {
    const cur = sessions[sessions.length - 1] || null;
    const pred = predict();
    return json(res, {
      game_info: {
        current_session: cur?.session || '',
        next_session: sessionCounter,
        last_result: cur,
        game_url: 'https://lc79b.bet',
        interval_ms: INTERVAL_MS,
        total: sessions.length,
        start_session: START_SESSION
      },
      strategy_params: { analysis_window: 10, balance_threshold: 6 },
      system_status: { last_prediction: pred.prediction, confidence: pred.confidence, reason: pred.reason, last_updated: cur?.time || '' }
    });
  }

  if (p === '/api/generate' && req.method === 'POST') {
    const rec = generateSession();
    return json(res, { success: true, record: rec, prediction: predict() });
  }

  if (p === '/api/webhook' && req.method === 'POST') {
    const body = await readBody(req);
    const dice = body.dice || body.result || body.xuc_xac;
    const session = body.session || body.id || body.ma_phien;
    if (!Array.isArray(dice) || dice.length !== 3) return json(res, { error: 'need_dice_array_3_numbers' }, 400);
    const clean = dice.map(Number);
    if (clean.some(n => isNaN(n) || n < 1 || n > 6)) return json(res, { error: 'dice_must_be_1_to_6' }, 400);
    const useSession = session ? String(session) : String(sessionCounter++);
    const rec = buildRecord(useSession, clean, false);
    sessions.push(rec);
    if (sessions.length > HISTORY_SIZE) sessions.shift();
    return json(res, { success: true, record: rec, prediction: predict() });
  }

  if (p === '/api/reset' && req.method === 'POST') {
    sessions.length = 0;
    sessionCounter = START_SESSION;
    loadSeed();
    generateSession();
    return json(res, { success: true, message: 'reset_to_seed' });
  }

  return json(res, { error: 'not_found', path: p }, 404);
});

/* ==================== START ==================== */
loadSeed();
generateSession();
setInterval(generateSession, INTERVAL_MS);

server.listen(PORT, () => {
  console.log('\n════════════════════════════════════════════');
  console.log('🎲 Tài Xỉu MD5 API + HTML');
  console.log(`   URL       : http://localhost:${PORT}`);
  console.log(`   Interval  : ${INTERVAL_MS / 1000}s / phiên`);
  console.log(`   Seed      : 7058706, 7058707`);
  console.log(`   Sinh tiếp : 7058708, 7058709, ...`);
  const p = predict();
  console.log(`   Dự đoán   : ${p.prediction.toUpperCase()} (${Math.round(p.confidence * 100)}%)`);
  console.log('════════════════════════════════════════════\n');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
