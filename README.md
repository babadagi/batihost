# BatiHost · Minecraft Sunucu Kontrol

Bedrock ve PocketMine sunucuları için online/oyuncu/sürüm/ping kontrol sitesi.

```
npm start      # http://localhost:3000  (PORT ile değiştirilebilir)
npm test       # sahte sunucuyla RakNet + Query testi
```

- Bağımlılık yok (Node 18+). UDP (RakNet) sorgusu `server.js` içinde yapılır.
- Bedrock/PocketMine: MOTD, oyuncu, sürüm, protokol, dünya, oyun modu, portlar, GUID, ping.
- PocketMine'da `query.enable: true` ise oyuncu isimleri ve eklenti listesi de gösterilir.
- Özel/yerel IP'ler (SSRF) engellenir; IP başına dakikada 30 istek sınırı vardır.
