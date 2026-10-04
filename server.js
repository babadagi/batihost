'use strict';
// Bağımlılıksız Minecraft Bedrock / PocketMine durum kontrol sunucusu.
// Tarayıcılar UDP konuşamadığı için kontrol bu arka uçta yapılır.
const http = require('http');
const dgram = require('dgram');
const dns = require('dns').promises;
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1'; // sadece test için
const TIMEOUT_MS = 4000;
const RAKNET_MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Yardımcılar ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

async function resolveHost(host) {
  if (net.isIP(host)) {
    if (!ALLOW_PRIVATE && isPrivateIp(host)) throw httpError(400, 'Özel/yerel ağ adreslerine izin verilmiyor.');
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  let res;
  try { res = await dns.lookup(host); }
  catch { throw httpError(404, 'Alan adı çözümlenemedi (DNS kaydı bulunamadı).'); }
  if (!ALLOW_PRIVATE && isPrivateIp(res.address)) throw httpError(400, 'Özel/yerel ağ adreslerine izin verilmiyor.');
  return res;
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

// Tek paket gönder, ilk cevabı bekle.
function udpRequest(address, family, port, packet, timeout = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, timeout);
    sock.once('message', (msg) => { clearTimeout(timer); sock.close(); resolve(msg); });
    sock.once('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.send(packet, port, address, (e) => { if (e) { clearTimeout(timer); sock.close(); reject(e); } });
  });
}

// ---------- RakNet Unconnected Ping (Bedrock + PocketMine) ----------
async function raknetPing(address, family, port) {
  const pkt = Buffer.alloc(33);
  pkt[0] = 0x01;
  pkt.writeBigInt64BE(BigInt(Date.now()), 1);
  RAKNET_MAGIC.copy(pkt, 9);
  crypto.randomBytes(8).copy(pkt, 25);
  const start = process.hrtime.bigint();
  const msg = await udpRequest(address, family, port, pkt);
  const latency = Number((process.hrtime.bigint() - start) / 1000n) / 1000;
  if (msg[0] !== 0x1c) throw new Error('Geçersiz RakNet cevabı');
  const guid = msg.readBigInt64BE(9).toString();
  const len = msg.readUInt16BE(33);
  const str = msg.subarray(35, 35 + len).toString('utf8');
  const f = str.split(';');
  const num = (v) => (v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  return {
    edition: f[0] || null,
    motd: f[1] || '',
    protocol: num(f[2]),
    version: f[3] || null,
    playersOnline: num(f[4]) ?? 0,
    playersMax: num(f[5]) ?? 0,
    serverId: f[6] || guid,
    levelName: f[7] || null,
    gamemode: f[8] || null,
    gamemodeId: num(f[9]),
    portV4: num(f[10]),
    portV6: num(f[11]),
    guid,
    latency: Math.round(latency * 10) / 10,
    raw: str,
  };
}

// ---------- GS4 Query (PocketMine query.enable: true ise) ----------
async function gs4Query(address, family, port) {
  const sid = crypto.randomBytes(4).readUInt32BE(0) & 0x0f0f0f0f;
  const head = Buffer.from([0xfe, 0xfd, 0x09]);
  const sidBuf = Buffer.alloc(4); sidBuf.writeUInt32BE(sid);
  const hs = await udpRequest(address, family, port, Buffer.concat([head, sidBuf]), 2500);
  const token = parseInt(hs.subarray(5).toString('latin1').replace(/\0.*$/, ''), 10);
  if (isNaN(token)) throw new Error('token yok');
  const tok = Buffer.alloc(4); tok.writeInt32BE(token);
  const req = Buffer.concat([Buffer.from([0xfe, 0xfd, 0x00]), sidBuf, tok, Buffer.alloc(4)]);
  const res = await udpRequest(address, family, port, req, 2500);
  const body = res.subarray(5);
  const marker = body.indexOf(Buffer.from('\x00\x01player_\x00\x00', 'latin1'));
  const kvPart = body.subarray(11, marker < 0 ? undefined : marker);
  const parts = kvPart.toString('utf8').split('\0');
  const kv = {};
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) kv[parts[i]] = parts[i + 1];
  const players = marker < 0 ? [] :
    body.subarray(marker + 10).toString('utf8').split('\0').filter(Boolean);
  const out = { players, raw: kv };
  if (kv.plugins) {
    const [software, list] = kv.plugins.split(': ');
    out.software = software || null;
    out.plugins = list ? list.split('; ').map((p) => p.trim()).filter(Boolean) : [];
  }
  out.map = kv.map || null;
  out.hostname = kv.hostname || null;
  out.gametype = kv.gametype || null;
  out.version = kv.version || null;
  return out;
}

// ---------- Basit hız sınırı ----------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 30;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some((t) => n - t < 60000)) hits.delete(k); }, 60000).unref();

// ---------- Kontrol ----------
async function check(host, port, type) {
  const { address, family } = await resolveHost(host);
  const result = { host, port, type, ip: address, ipVersion: family, checkedAt: new Date().toISOString() };
  try {
    const ping = await raknetPing(address, family, port);
    Object.assign(result, { online: true }, ping);
  } catch (e) {
    return Object.assign(result, {
      online: false,
      error: e.message === 'timeout'
        ? 'Sunucu cevap vermedi (kapalı, port yanlış, UDP engelli veya IP/port hatalı olabilir).'
        : e.message,
    });
  }
  // Yazılım tahmini
  result.software = type === 'pocketmine' ? 'PocketMine-MP' : (ping_isBDS(result) ? 'Bedrock Dedicated Server' : 'Bedrock uyumlu');
  // Query: PocketMine'da eklenti/oyuncu listesi; Bedrock'ta da dener (nadiren açık)
  try {
    const q = await gs4Query(address, family, port);
    result.query = q;
    if (q.software) result.software = q.software;
  } catch { result.query = null; }
  if (type === 'pocketmine' && result.edition && result.edition !== 'MCPE') {
    result.warning = 'Sunucu "MCPE" yerine "' + result.edition + '" olarak cevap verdi; PocketMine olmayabilir.';
  }
  return result;
}
function ping_isBDS(r) { return r.edition === 'MCPE' && r.levelName !== null; }

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }, headers));
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/check') {
    const ip = req.socket.remoteAddress;
    if (rateLimited(ip)) return send(res, 429, { error: 'Çok fazla istek. Lütfen biraz bekleyin.' });
    try {
      let host = (url.searchParams.get('host') || '').trim();
      let port = url.searchParams.get('port');
      const type = url.searchParams.get('type') === 'pocketmine' ? 'pocketmine' : 'bedrock';
      // host:port biçimini destekle
      const m = host.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/);
      if (m) { host = m[1] || m[2]; port = port || m[3]; }
      host = host.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
      port = port ? Number(port) : 19132;
      if (!host || host.length > 253 || !/^[a-zA-Z0-9.\-:_]+$/.test(host)) throw httpError(400, 'Geçersiz sunucu adresi.');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw httpError(400, 'Port 1-65535 arasında olmalı.');
      send(res, 200, await check(host, port, type), { 'Cache-Control': 'no-store' });
    } catch (e) {
      send(res, e.status || 500, { error: e.status ? e.message : 'Beklenmeyen hata.' });
    }
    return;
  }
  // statik dosyalar
  let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Yasak', { 'Content-Type': 'text/plain' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Bulunamadı', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Minecraft Checker http://localhost:${PORT}`));
}
module.exports = { server, raknetPing, gs4Query };
