'use strict';
const $ = (s) => document.querySelector(s);
const form = $('#form'), hostEl = $('#host'), portEl = $('#port'), goBtn = $('#go'), out = $('#result');
let type = 'bedrock', timer = null, hist = [];

try { hist = JSON.parse(localStorage.getItem('mcc-history') || '[]'); } catch {}
const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Minecraft § renk/biçim kodları → HTML
const COLORS = { 0: '#000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff', g: '#ddd605' };
function mcToHtml(text) {
  let html = '', open = 0, st = { b: 0, i: 0, u: 0, s: 0 }, col = '';
  const flush = (chunk) => {
    if (!chunk) return;
    const css = [col && `color:${col}`, st.b && 'font-weight:bold', st.i && 'font-style:italic', (st.u || st.s) && `text-decoration:${[st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ')}`].filter(Boolean).join(';');
    html += css ? `<span style="${css}">${esc(chunk)}</span>` : esc(chunk);
  };
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '§' && i + 1 < text.length) {
      flush(buf); buf = '';
      const c = text[++i].toLowerCase();
      if (COLORS[c]) { col = COLORS[c]; st = { b: 0, i: 0, u: 0, s: 0 }; }
      else if (c === 'l') st.b = 1; else if (c === 'o') st.i = 1;
      else if (c === 'n') st.u = 1; else if (c === 'm') st.s = 1;
      else if (c === 'r') { col = ''; st = { b: 0, i: 0, u: 0, s: 0 }; }
    } else buf += text[i];
  }
  flush(buf);
  return html;
}
const stripMc = (t) => String(t || '').replace(/§./g, '');

// Tür seçimi
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  type = b.dataset.type;
  document.querySelectorAll('.tab').forEach((x) => { const a = x === b; x.classList.toggle('active', a); x.setAttribute('aria-selected', a); });
  store('mcc-type', type);
}));
try { const t = localStorage.getItem('mcc-type'); if (t) document.querySelector(`.tab[data-type=${t}]`)?.click(); } catch {}

function renderHistory() {
  $('#history').innerHTML = hist.map((h, i) => `<button type="button" data-i="${i}">${esc(h.host)}${h.port != 19132 ? ':' + esc(h.port) : ''}</button>`).join('');
}
$('#history').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const h = hist[b.dataset.i];
  hostEl.value = h.host; portEl.value = h.port;
  document.querySelector(`.tab[data-type=${h.type}]`)?.click();
  form.requestSubmit();
});
renderHistory();

function item(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="item"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function render(d) {
  if (d.error && d.online === undefined) { out.innerHTML = `<div class="card"><p class="err">⚠ ${esc(d.error)}</p></div>`; return; }
  const addr = `${d.host}:${d.port}`;
  if (!d.online) {
    out.innerHTML = `<div class="card"><div class="status"><span class="badge off"><i class="dot"></i>ÇEVRİMDIŞI</span><span class="addr">${esc(addr)} · ${esc(d.ip)}</span></div><p class="err">${esc(d.error)}</p>
      <p style="color:var(--mut);font-size:.9rem">İpucu: Sunucunun <b>UDP</b> portunun (TCP değil) güvenlik duvarında açık olduğundan emin ol.</p></div>`;
    return;
  }
  const pct = d.playersMax ? Math.min(100, Math.round((d.playersOnline / d.playersMax) * 100)) : 0;
  const q = d.query;
  const players = q?.players?.length ? `<h3>Oyuncular (${q.players.length})</h3><div class="chips">${q.players.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : '';
  const plugins = q?.plugins?.length ? `<h3>Eklentiler (${q.plugins.length})</h3><div class="chips">${q.plugins.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : '';
  const queryNote = !q ? `<p style="color:var(--mut);font-size:.85rem;margin-top:14px">Oyuncu isimleri ve eklenti listesi için sunucuda Query açık olmalı${d.type === 'pocketmine' ? ' (<code>pocketmine.yml</code> → <code>query.enable: true</code>)' : ''}.</p>` : '';
  out.innerHTML = `<div class="card">
    <div class="status"><span class="badge on"><i class="dot"></i>ÇEVRİMİÇİ</span><span class="addr">${esc(addr)} · ${esc(d.ip)}</span></div>
    ${d.warning ? `<p class="warn">⚠ ${esc(d.warning)}</p>` : ''}
    <div class="motd">${mcToHtml(d.motd) || '<span style="color:#888">(MOTD yok)</span>'}</div>
    <div class="pl"><span>👥 Oyuncular</span><span>${d.playersOnline} / ${d.playersMax} (%${pct})</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="grid">
      ${item('Gecikme (ping)', d.latency + ' ms')}
      ${item('Sürüm', d.version)}
      ${item('Protokol', d.protocol)}
      ${item('Yazılım', d.software)}
      ${item('Edisyon', d.edition)}
      ${item('Dünya adı', d.levelName)}
      ${item('Oyun modu', d.gamemode)}
      ${item('IPv4 / IPv6 portu', [d.portV4, d.portV6].filter(Boolean).join(' / '))}
      ${item('Çözülen IP', d.ip + ' (IPv' + d.ipVersion + ')')}
      ${item('Sunucu ID (GUID)', d.serverId)}
      ${item('Harita', q?.map)}
      ${item('Ana makine adı', q?.hostname && stripMc(q.hostname))}
      ${item('Oyun türü', q?.gametype)}
      ${item('Kontrol zamanı', new Date(d.checkedAt).toLocaleString('tr-TR'))}
    </div>
    ${players}${plugins}${queryNote}
    <div class="tools">
      <button type="button" id="copy">📋 Bilgileri kopyala</button>
      <button type="button" id="dl">⬇ JSON indir</button>
    </div>
    <details><summary>Ham sunucu cevabı</summary><pre>${esc(d.raw)}</pre></details>
  </div>`;
  $('#copy').onclick = () => navigator.clipboard?.writeText(
    `${addr} — ÇEVRİMİÇİ\n${stripMc(d.motd)}\nOyuncu: ${d.playersOnline}/${d.playersMax}\nSürüm: ${d.version} (protokol ${d.protocol})\nPing: ${d.latency} ms`).then(() => { $('#copy').textContent = '✓ Kopyalandı'; });
  $('#dl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    a.download = `${d.host}-${d.port}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
}

async function run(silent) {
  const host = hostEl.value.trim(); if (!host) return;
  goBtn.disabled = true;
  if (!silent) out.innerHTML = '<div class="spin">⏳ Sunucuya bağlanılıyor…</div>';
  try {
    const r = await fetch(`/api/check?${new URLSearchParams({ host, port: portEl.value || 19132, type })}`);
    const d = await r.json();
    if (!r.ok) out.innerHTML = `<div class="card"><p class="err">⚠ ${esc(d.error || 'Hata')}</p></div>`;
    else {
      render(d);
      hist = [{ host: d.host, port: d.port, type }, ...hist.filter((h) => !(h.host === d.host && h.port === d.port))].slice(0, 5);
      store('mcc-history', JSON.stringify(hist)); renderHistory();
    }
  } catch { out.innerHTML = '<div class="card"><p class="err">⚠ Kontrol servisine ulaşılamadı.</p></div>'; }
  goBtn.disabled = false;
}

form.addEventListener('submit', (e) => { e.preventDefault(); run(false); });
$('#auto').addEventListener('change', (e) => {
  clearInterval(timer);
  if (e.target.checked) timer = setInterval(() => run(true), 15000);
});
