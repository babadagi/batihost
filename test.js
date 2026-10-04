'use strict';
// Sahte bir PocketMine sunucusuyla (RakNet pong + GS4 query) uçtan uca test.
process.env.ALLOW_PRIVATE = '1';
const dgram = require('dgram');
const assert = require('assert');
const { raknetPing, gs4Query } = require('./server');
const MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');

const srv = dgram.createSocket('udp4');
srv.on('message', (m, r) => {
  if (m[0] === 0x01) {
    const s = Buffer.from('MCPE;§aBatiHost §lTest;685;1.21.50;7;100;1234567890;Dünya;Survival;1;19132;19133;');
    const len = Buffer.alloc(2); len.writeUInt16BE(s.length);
    const g = Buffer.alloc(8); g.writeBigInt64BE(1234567890n);
    srv.send(Buffer.concat([Buffer.from([0x1c]), m.subarray(1, 9), g, MAGIC, len, s]), r.port, r.address);
  } else if (m[0] === 0xfe && m[2] === 0x09) {
    srv.send(Buffer.concat([Buffer.from([0x09]), m.subarray(3, 7), Buffer.from('9513307\0')]), r.port, r.address);
  } else if (m[0] === 0xfe && m[2] === 0x00) {
    const kv = ['hostname', 'BatiHost', 'gametype', 'SMP', 'plugins', 'PocketMine-MP 5.20.0: Alpha 1.0; Beta 2.1', 'numplayers', '7'].join('\0') + '\0\0';
    srv.send(Buffer.concat([Buffer.from([0x00]), m.subarray(3, 7), Buffer.from('splitnum\0\x80\0', 'latin1'), Buffer.from(kv),
      Buffer.from('\x01player_\0\0', 'latin1'), Buffer.from('Ali\0Veli\0\0')]), r.port, r.address);
  }
});
srv.bind(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const p = await raknetPing('127.0.0.1', 4, port);
  assert.strictEqual(p.online, 7); assert.strictEqual(p.max, 100);
  assert.strictEqual(p.version, '1.21.50'); assert.strictEqual(p.levelName, 'Dünya'); assert.strictEqual(p.portV6, 19133);
  const q = await gs4Query('127.0.0.1', 4, port);
  assert.deepStrictEqual(q.players, ['Ali', 'Veli']);
  assert.deepStrictEqual(q.plugins, ['Alpha 1.0', 'Beta 2.1']);
  assert.strictEqual(q.software, 'PocketMine-MP 5.20.0');
  console.log('OK', p.motd, p.latency + 'ms', q.plugins);
  srv.close(); process.exit(0);
});
