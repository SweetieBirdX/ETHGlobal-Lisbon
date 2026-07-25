# Kişisel Sağlık/Fitness Verisi Ajan Pazarı
### ETHGlobal Lisbon 2026 — Hedera Track (full odak)

## Özet

Kullanıcılar (spor performansı, seans verisi, opsiyonel sağlık verisi) kendi verilerinin sahibi kalır. Ham veri hiçbir zaman dışarı çıkmaz ve zincire konmaz. Erişim isteyen taraf (araştırma şirketi) kendi otonom AI ajanı üzerinden, kullanıcının kişisel AI ajanıyla doğrudan müzakere eder; erişim karşılığında Hedera üzerinde x402 ile anlık mikro ödeme yapılır. Kullanıcı tek seferlik doğal dil talimatıyla politikasını belirler, gerisini ajan kendi adına yürütür.

Web2 veri komisyoncusu modelinin (kullanıcı verisini toplayıp üçüncü taraflara satan, kullanıcının hiç pay almadığı) tam tersi: satıcı da alıcı da birer otonom ajan, kullanıcı sadece kuralları koyar, gelir doğrudan kullanıcıya akar.

## Mimari

**Satıcı ajan (kullanıcının kişisel ajanı).** Kullanıcı doğal dille bir kere talimat verir: "sadece araştırma şirketlerine sat, pazarlama şirketlerine asla; sorgu başı en az 2$; sadece fitness performans verimi paylaş, sağlık verimi açma." Ajan bunu yapılandırılmış bir politika olarak saklar. ERC-8004 ile kendi kimliğini (agent card, A2A endpoint) onchain kaydeder.

**Alıcı ajan (araştırma şirketinin ajanı).** Aynı şekilde ERC-8004 ile kayıtlı. Reputation registry'nin yanında validation registry'de gerçek bir uyum attestasyonu taşır ("bu ajan X kurumuna ait, KYB doğrulamasından geçti") — satıcı ajan bu attestasyonu kontrol ederek alıcının gerçekten kim olduğunu insana sormadan doğrular.

**Müzakere (A2A protokolü).** Alıcı ajan satıcı ajanı keşfeder, "şu kritere uyan kohort verisi istiyorum, şu fiyatı öneriyorum" mesajı gönderir. Satıcı ajan bunu kullanıcı politikasıyla karşılaştırır (kategori uyumu, minimum fiyat, validation attestasyonu geçerliliği) ve kabul/gerekçeli ret döner.

**Veri katmanı — off-chain.** Kullanıcı verisi şifreli bir veritabanında durur (alan bazında şifreli, her kullanıcı kendi anahtarıyla). Ham veri asla zincire ya da herkese açık bir depoya konmaz; talep onaylandığında backend sadece agregatör bir sorgu çalıştırıp kohort bazlı içgörü döner (örn. "bu antrenman tipini yapan 40 kişide şu performans paterni görüldü"), tekil kayıt dışarı çıkmaz. Bu hem gizliliği korur hem de zincirin değiştirilemezliğiyle "veriyi silme hakkı" çelişkisini önler. Zincire giden tek şey veri değil, olayın kanıtıdır: HCS'e yazılan hash'lenmiş bir olay kaydı ("şu sorgu, şu zaman, şu fiyata, şu alıcıya yapıldı") — jüri gerçek veriye erişmeden bile işlemin gerçekten olduğunu HashScan üzerinden doğrulayabilir.

**Ödeme (x402 + Hedera).** Kabul edilen istekte erişim endpoint'i x402 middleware ile sarılıdır; alıcı ajan isteği attığı anda Hedera testnette anlık, kuruşun altında bir stablecoin/HBAR ödemesi gerçekleşir — fatura yok, abonelik yok, gerçek pay-as-you-go.

**Gelir dağıtımı.** Ödeme, o kohorta katkı sağlayan kullanıcılara otomatik/batch olarak dağıtılır.

**Geri bildirim döngüsü.** İşlem sonrası satıcı ajan, alıcı ajanın reputation registry'sine geri bildirim bırakır. Ağ büyüdükçe yeni kullanıcıların ajanları, hiç etkileşmedikleri bir alıcı ajanın güvenilirliğini toplu reputation üzerinden hızlıca değerlendirebilir.

## Teknoloji Bileşenleri

Hedera Agent Kit (JS/TS) — ajanların testnette token transferi/ödeme işlemlerini yürütmesi. A2A protokolü — satıcı/alıcı ajan müzakere mesajlaşması. x402 — pay-per-request ödeme middleware'i. ERC-8004 — identity, reputation, validation registry üçlüsü. HCS — geri bildirim ve işlem kanıtlarının değiştirilemez zaman damgalı kaydı. Şifreli off-chain veritabanı — asıl kullanıcı verisinin depolandığı yer.

## Hedera Track Kriterlerini Karşılama

Zorunlu şart olan "en az bir ödeme/finansal işlemi Hedera testnette gerçekleştiren AI ajanı" fazlasıyla karşılanıyor — ödemeyi tetikleyen taraf insan tıklaması değil, otonom karar veren bir ajan. Bonus maddelerden üçü doğrudan hedefleniyor: çoklu ajan müzakere ve settlement (A2A ile), x402 pay-per-request implementasyonu, ERC-8004 ile onchain ajan kimliği. Bu kombinasyon, sponsorun "ideas to get you started" listesindeki Agent-to-Agent Marketplace örneğiyle doğrudan örtüşüyor. İsterseniz HCS kullanımı sayesinde "verifiable payment audit trails" bonus maddesi de otomatik olarak karşılanmış oluyor.

## Demo Kapsamı (Hackathon MVP)

Zaman kısıtı ve hassasiyet nedeniyle demo sadece fitness performans verisi üzerinden kurgulanmalı; sağlık verisi (ilaç, regl döngüsü) konsept anlatımında bahsedilebilir ama canlı demoda kullanılmamalı. Demo akışı: (1) kullanıcı ajanına doğal dille politika veriyor, (2) örnek bir "araştırma ajanı" bir sorgu talebi gönderiyor, (3) satıcı ajan alıcının onchain kimliğini/validation attestasyonunu kontrol edip kabul/ret kararı veriyor, (4) kabul durumunda Hedera testnette x402 ödemesi gerçekleşiyor ve HashScan'de görülüyor, (5) kullanıcı panelinde kazanç ve hangi sorgunun buna sebep olduğu gösteriliyor.

## Notlar / Riskler

Gerçek ürüne dönüştürülürse ham sağlık verisi asla ham haliyle satışa açılmamalı, sadece agregat/anonim seviyede paylaşılmalı ve kullanıcı onayı granüler olmalı. Validation registry'deki uyum attestasyonu hackathon demosunda simüle edilebilir; gerçek dünyada bağımsız bir denetim kurumu tarafından verilmesi gerekir.
