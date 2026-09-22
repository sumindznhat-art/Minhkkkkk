// server.js — Tài Xỉu MD5 API + HTML
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS) || 30000;
const HISTORY_SIZE = 500;
const START_SESSION = parseInt(process.env.START_SESSION) || 7058708;

const SEED = [
  { session: '7058706', dice: [1, 4, 6] },
  { session: '7058707', dice: [4, 6, 5] },
];

let sessionCounter = START_SESSION;
const sessions = [];

function rand6() { return Math.ceil(Math.random() * 6); }
function randomDice() { return [rand6(), rand6(), rand6()]; }
function computeResult(dice) {
  const sum = dice.reduce((a, b) => a + b, 0);
  return { sum, result: sum >= 11 ? 'tài' : 'xỉu', type: sum >= 11 ? 'tai' : 'xiu' };
}
function buildRecord(session, dice, seeded = false) {
  const { sum, result, type } = computeResult(dice);
  return { session: String(session), dice, sum, result, type, time: new Date().toISOString(), seeded };
}

function loadSeed() {
  const base = Date.now() - SEED.length * INTERVAL_MS;
  SEED.forEach((s, i) => {
    const r = buildRecord(s.session, s.dice, true);
    r.time = new Date(base + i * INTERVAL_MS).toISOString();
    sessions.push(r);
  });
  console.log('📌 Seed:'); sessions.forEach(s => console.log(`   #${s.session}: ${s.dice.join('-')} = ${s.sum} → ${s.result.toUpperCase()}`));
}

function generateSession() {
  const session = String(sessionCounter++);
  const dice = randomDice();
  const rec = buildRecord(session, dice, false);
  sessions.push(rec);
  if (sessions.length > HISTORY_SIZE) sessions.shift();
  console.log(`[${new Date().toLocaleTimeString('vi-VN')}] #${session}: ${dice.join('-')} = ${rec.sum} → ${rec.result.toUpperCase()}`);
  return rec;
}

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
    prediction = 'xỉu'; confidence = Math.min(0.5 + (tai - xiu) / total, 0.95); reason = 'majority_xiu';
  } else if (xiu > tai) {
    prediction = 'tài'; confidence = Math.min(0.5 + (xiu - tai) / total, 0.95); reason = 'majority_tai';
  } else {
    prediction = last.type === 'tai' ? 'xỉu' : 'tài'; confidence = 0.55; reason = 'tie_break';
  }
  return { prediction, confidence: Math.round(confidence * 100) / 100, based_on: total, breakdown: { tai, xiu }, reason };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
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
function serveStatic(res, fp, ct) {
  if (!fs.existsSync(fp)) return false;
  res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache', ...CORS });
  res.end(fs.readFileSync(fp));
  return true;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname, q = parsed.query;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (p === '/' || p === '/index.html') {
    if (serveStatic(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8')) return;
    return json(res, { error: 'index.html not found' }, 404);
  }
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

  if (p === '/api') {
    return json(res, { name: 'Tài Xỉu MD5 API', status: 'running', next_session: sessionCounter, total: sessions.length });
  }
  if (p === '/api/health') {
    return json(res, { status: 'ok', time: new Date().toISOString(), next_session: sessionCounter });
  }
  if (p === '/api/current') {
    const cur = sessions[sessions.length - 1];
    if (!cur) return json(res, { error: 'no_data' }, 404);
    const pred = predict();
    return json(res, { ...cur, next_session: sessionCounter, prediction: pred.prediction, confidence: pred.confidence });
  }
  if (p === '/api/history') {
    const limit = Math.min(parseInt(q.limit) || 50, HISTORY_SIZE);
    return json(res, { current_session: sessions[sessions.length - 1]?.session || '', next_session: sessionCounter, total: sessions.length, history: sessions.slice(-limit).reverse() });
  }
  if (p === '/api/predict') {
    const pred = predict();
    return json(res, { ...pred, current_session: sessions[sessions.length - 1]?.session || '', next_session: sessionCounter, time: new Date().toISOString() });
  }
  if (p === '/api/generate' && req.method === 'POST') {
    const rec = generateSession();
    return json(res, { success: true, record: rec, prediction: predict() });
  }
  if (p === '/api/webhook' && req.method === 'POST') {
    const body = await readBody(req);
    const dice = body.dice || body.result;
    const session = body.session || body.id;
    if (!Array.isArray(dice) || dice.length !== 3) return json(res, { error: 'need_dice_array' }, 400);
    const clean = dice.map(Number);
    if (clean.some(n => isNaN(n) || n < 1 || n > 6)) return json(res, { error: 'dice_1_to_6' }, 400);
    const useSession = session ? String(session) : String(sessionCounter++);
    const rec = buildRecord(useSession, clean, false);
    sessions.push(rec); if (sessions.length > HISTORY_SIZE) sessions.shift();
    return json(res, { success: true, record: rec, prediction: predict() });
  }
  if (p === '/api/reset' && req.method === 'POST') {
    sessions.length = 0; sessionCounter = START_SESSION; loadSeed(); generateSession();
    return json(res, { success: true });
  }
  return json(res, { error: 'not_found', path: p }, 404);
});

loadSeed();
generateSession();
setInterval(generateSession, INTERVAL_MS);

server.listen(PORT, () => {
  console.log('\n════════════════════════════════════════════');
  console.log('🎲 Tài Xỉu MD5 API');
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   Interval: ${INTERVAL_MS / 1000}s`);
  console.log(`   Seed: 7058706, 7058707`);
  console.log(`   Sinh tiếp: 7058708, ...`);
  console.log('════════════════════════════════════════════\n');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
