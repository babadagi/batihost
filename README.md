# BatiHost · Minecraft Sunucu Kontrol

Java, Bedrock ve PocketMine sunucuları için online/oyuncu/sürüm/ping kontrol sitesi.

```
npm start      # http://localhost:3000  (PORT ile değiştirilebilir)
npm test       # sahte sunucularla RakNet + Query + Java ping testi
```

- Bağımlılık yok (Node 18+).
- **Bedrock/PocketMine** (UDP, 19132): MOTD, oyuncu, sürüm, protokol, dünya, oyun modu, portlar, GUID, ping. PocketMine'da `query.enable: true` ise oyuncu isimleri ve eklentiler de gösterilir.
- **Java** (TCP, 25565): Server List Ping + `_minecraft._tcp` SRV kaydı. MOTD (JSON/hex renkli), oyuncu sayısı ve örnek isimler, sürüm, protokol, ping, sunucu ikonu, güvenli sohbet, Forge modları. `enable-query=true` ise eklenti/harita da gelir.
- Özel/yerel IP'ler (SSRF) engellenir; IP başına dakikada 30 istek sınırı vardır.
