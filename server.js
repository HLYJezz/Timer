/*
 * ฐานเวลา (Base Timer) — zero-dependency Node server.
 *
 *   node server.js            → http://localhost:3000
 *   PORT=8080 node server.js
 *   ADMIN_PIN=1234 node server.js   → lock the admin/round controls
 *
 * State lives in memory, is broadcast to every connected screen over
 * Server-Sent Events, and is mirrored to data/state.json so a restart
 * (or a laptop that went to sleep) does not lose the running round.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Reducer = require('./public/reducer.js');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');

// Actions only the control desk may send.
const ADMIN_ACTIONS = /^(round\/|config\/|announce$)/;

// ---------------------------------------------------------------- state

let state = load();

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = Reducer.migrate(JSON.parse(raw));
    console.log('โหลดสถานะเดิมจาก', DATA_FILE);
    return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('อ่าน state.json ไม่ได้ เริ่มใหม่:', err.message);
    return Reducer.defaultState();
  }
}

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('บันทึกสถานะไม่สำเร็จ:', err.message);
    }
  }, 300);
}

// ---------------------------------------------------------------- SSE

const clients = new Set();

function envelope() {
  return JSON.stringify({ serverNow: Date.now(), state });
}

function broadcast() {
  const payload = 'event: state\ndata: ' + envelope() + '\n\n';
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (_) {
      clients.delete(res);
    }
  }
}

// Heartbeat keeps proxies from closing the stream and re-syncs clocks.
setInterval(() => {
  const payload = 'event: ping\ndata: ' + JSON.stringify({ serverNow: Date.now() }) + '\n\n';
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (_) {
      clients.delete(res);
    }
  }
}, 15000).unref();

// ---------------------------------------------------------------- http

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload ใหญ่เกินไป'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Refuse anything that escapes public/.
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ไม่พบหน้านี้');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (pathname === '/api/state') {
    sendJson(res, 200, JSON.parse(envelope()));
    return;
  }

  if (pathname === '/api/config') {
    sendJson(res, 200, { pinRequired: !!ADMIN_PIN });
    return;
  }

  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    res.write('event: state\ndata: ' + envelope() + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (pathname === '/api/action') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'ต้องใช้ POST' });
      return;
    }
    let action;
    try {
      action = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { ok: false, error: 'อ่านคำสั่งไม่ได้' });
      return;
    }
    if (!action || typeof action.type !== 'string') {
      sendJson(res, 400, { ok: false, error: 'ไม่มี type' });
      return;
    }
    if (ADMIN_PIN && ADMIN_ACTIONS.test(action.type) && action.pin !== ADMIN_PIN) {
      sendJson(res, 403, { ok: false, error: 'PIN ไม่ถูกต้อง' });
      return;
    }
    const problem = Reducer.apply(state, action, Date.now());
    if (problem) {
      sendJson(res, 400, { ok: false, error: problem });
      return;
    }
    saveSoon();
    broadcast();
    sendJson(res, 200, { ok: true, serverNow: Date.now(), state });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('method not allowed');
    return;
  }

  serveStatic(req, res, pathname);
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  const urls = ['http://localhost:' + PORT].concat(
    lanAddresses().map((ip) => 'http://' + ip + ':' + PORT)
  );
  console.log('');
  console.log('  ⏱  ฐานเวลา — Base Timer');
  console.log('  ────────────────────────────────────');
  urls.forEach((u) => console.log('  เปิดที่:  ' + u));
  console.log('');
  console.log('  จอรวม (ฝ่ายกลาง)  ' + urls[urls.length - 1] + '/board.html');
  console.log('  พี่ประจำฐาน       ' + urls[urls.length - 1] + '/station.html');
  console.log('  ตั้งค่า            ' + urls[urls.length - 1] + '/admin.html');
  console.log(ADMIN_PIN ? '\n  ล็อกหน้าควบคุมด้วย PIN แล้ว' : '\n  (ไม่ได้ตั้ง PIN — ตั้งได้ด้วย ADMIN_PIN=1234 node server.js)');
  console.log('');
});
