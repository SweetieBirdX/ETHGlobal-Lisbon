# Hackathon Roadmap — Sıralı Çalışma (2 Kişi, Vardiya Usulü)

Bu roadmap, aynı anda değil sırayla (vardiya usulü) çalışacağınız için tasarlandı: her blok bir öncekinin çıktısı üzerine inşa ediliyor, devralan kişi tam olarak nereden başlayacağını biliyor. ~48 saatlik tipik bir hackathon süresine göre 8 blok halinde bölündü. Süreler tahminidir, işin akışına göre esnetin — önemli olan sıra ve devir teslim netliği.

Roller sabit değil, işin niteliğine göre değişiyor; her blokta kim çalışıyorsa "Vardiyadaki Kişi", diğeri "Beklemede/İnceleyen" olarak geçiyor.

---

## Blok 0 — Ortak Kurulum (~1 saat, ikiniz birlikte)

Bunu ikiniz birlikte yapın, çünkü ikinizin de ortam bilgisine ihtiyacı olacak.

- [ ] GitHub'da public repo oluştur, README iskeletini aç
- [ ] [portal.hedera.com/dashboard](https://portal.hedera.com/dashboard) üzerinden **iki ayrı testnet hesabı** aç (biri satıcı ajan, biri alıcı ajan operatör hesabı olacak) — her ikisi de faucet'ten test HBAR alsın
- [ ] `.env.example` dosyasını oluştur: `SELLER_ACCOUNT_ID`, `SELLER_PRIVATE_KEY`, `BUYER_ACCOUNT_ID`, `BUYER_PRIVATE_KEY`, `OPENAI_API_KEY` (ya da tercih ettiğiniz LLM sağlayıcı)
- [ ] Proje iskeletini kur: `npm init -y`, `"type": "module"` ekle, temel bağımlılıkları yükle (`@hiero-ledger/sdk @hashgraph/hedera-agent-kit @hashgraph/hedera-agent-kit-langchain @a2a-js/sdk express langchain @langchain/openai dotenv`)
- [ ] Kim hangi bloklarda çalışacak, aşağıdaki sırayı görüşüp onaylayın (birinin gece, diğerinin gündüz çalışması gibi bir bölünme mantıklı olabilir)

**Devir teslim notu:** Blok 1'e geçen kişi `.env` dosyasının dolu ve `npx tsx` ile basit bir test scriptinin çalıştığından emin olsun.

---

## Blok 1 — Hedera Temel Altyapı (~4-5 saat, Kişi A)

**Hedef:** Satıcı ve alıcı ajan için ayrı Hedera client'ları kurulu, temel bir HBAR transferi ve bir HCS topic oluşturma testten geçmiş olsun.

- [ ] Hedera Agent Kit quick-start'ını çalıştır ("HBAR bakiyem ne?" sorusuna doğru cevap alana kadar)
- [ ] Satıcı ve alıcı için ayrı `Client` nesneleri kur (iki farklı operatör hesabı)
- [ ] Core Consensus Plugin ile bir test HCS topic'i oluştur, bir mesaj gönder, HashScan'de görüntüle
- [ ] `HCSAuditTrailHook`'u incele ve aktif et (bonus: her aksiyon otomatik loglanacak) — [docs/HOOKS_AND_POLICIES.md](https://github.com/hashgraph/hedera-agent-kit-js/blob/main/docs/HOOKS_AND_POLICIES.md)
- [ ] Basit bir HBAR transfer testi yap, HashScan'de transaction'ı doğrula

**Devir teslim notu (Kişi A → Kişi B):** Hangi HCS topic ID'sinin audit trail için kullanıldığını, iki hesabın adreslerini ve HashScan linklerini bir `NOTES.md` dosyasına yaz. Kişi B doğrudan x402 middleware'ini bu client'ların üzerine bağlayacak.

---

## Blok 2 — x402 Ödeme Katmanı (~4-5 saat, Kişi B)

**Hedef:** Kohort-sorgu endpoint'i x402 ile korunuyor, alıcı hesabından satıcı hesabına gerçek bir testnet ödemesi geçiyor.

- [ ] [x402-hedera-example](https://github.com/matevszm/x402-hedera-example) reposunu incele, mimarisini (`provider.ts`, `paymentMiddleware`, facilitator ayarı) referans al
- [ ] Basit bir Express/Hono endpoint'i (`GET /data/cohort-insight`) kur, henüz gerçek veri döndürmesin — mock JSON yeterli bu aşamada
- [ ] blocky402 facilitator'a bağlan, `PAY_TO_ACCOUNT` = satıcı hesabı olacak şekilde middleware'i yapılandır
- [ ] Alıcı tarafında `x402-sign.ts` mantığıyla (private key context dışında kalacak şekilde) `402 → sign → 200` akışını test et
- [ ] Gerçek bir testnet ödemesinin HashScan'de göründüğünü doğrula, `payment-response` header'ındaki transaction ID'yi not al

**Devir teslim notu (Kişi B → Kişi A):** Çalışan bir `curl` komutu veya test scripti bırak ki Kişi A ödeme akışını manuel tetikleyip A2A entegrasyonuna bağlarken referans alabilsin.

---

## Blok 3 — A2A Ajan İskeleti (~5-6 saat, Kişi A)

**Hedef:** Satıcı ajan (server) ve alıcı ajan (client) birbirini A2A üzerinden keşfedip mesajlaşabiliyor; henüz iş mantığı (politika kontrolü) basit/sabit olabilir.

- [ ] `@a2a-js/sdk` ile satıcı ajan için bir `AgentCard` tanımla (isim, açıklama, endpoint, skills: "veri-erişim-müzakeresi")
- [ ] Satıcı ajan için bir `AgentExecutor` yaz: gelen mesajı okuyup (şimdilik) sabit bir kabul/ret mantığıyla cevap versin
- [ ] Alıcı ajan tarafında `ClientFactory` ile satıcı ajanı keşfet, örnek bir sorgu mesajı gönder ("25-35 yaş, X antrenman tipi kohortu istiyorum, Y HBAR öneriyorum")
- [ ] Task modelini kullan: `submitted` → `working` → `completed` state geçişlerini uçtan uca test et
- [ ] Basit bir konsol logu ile müzakerenin adım adım göründüğünden emin ol (demo için faydalı olacak)

**Devir teslim notu (Kişi A → Kişi B):** Satıcı ajanın hangi portta çalıştığını, `AgentCard` şemasını ve örnek bir müzakere mesajının tam JSON'unu paylaş. Kişi B, ERC-8004 kimlik kontrolünü bu `AgentExecutor`'ın içine ekleyecek.

---

## Blok 4 — ERC-8004 Kimlik & Reputation (~4-5 saat, Kişi B)

**Hedef:** Her iki ajan da Hedera testnetteki hazır ERC-8004 registry'lerine kayıtlı; satıcı ajan, alıcı ajanın kimliğini kontrol edip karar veriyor.

- [ ] [erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) reposundan ABI'leri al, ethers.js/viem ile Hedera testnetteki adreslere bağlan (IdentityRegistry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`, ReputationRegistry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`)
- [ ] Satıcı ve alıcı ajan için `register()` çağır, her biri için bir `agentId` al
- [ ] Agent registration dosyalarını (JSON, basit bir `data:` URI ya da statik host) hazırla; `services` alanına Blok 3'teki A2A endpoint'ini yaz
- [ ] Satıcı ajanın `AgentExecutor`'ına ekle: gelen mesajdaki alıcı `agentId`'sini IdentityRegistry'den sorgula, (demo için) basit bir "onaylı alıcı listesi" ya da validation attestasyonu simülasyonuyla kabul/ret kararı ver
- [ ] Bir test feedback'i `giveFeedback()` ile gönder, `proofOfPayment` alanına Blok 2'deki x402 transaction hash'ini koy — reputation ile ödemeyi bu şekilde ilişkilendir

**Devir teslim notu (Kişi B → Kişi A):** `agentId`'leri ve registration dosyası URI'lerini `NOTES.md`'ye ekle. Kişi A artık tüm parçaları (A2A + x402 + ERC-8004) tek bir akışta birleştirecek.

---

## Blok 5 — Uçtan Uca Entegrasyon (~5-6 saat, Kişi A)

**Hedef:** Blok 1-4'teki tüm parçalar tek bir çalışan akışta birleşiyor: müzakere → kimlik kontrolü → kabul → x402 ödeme → HCS'e kanıt kaydı → reputation feedback.

- [ ] Satıcı ajanın `AgentExecutor`'ını güncelle: mesaj geldiğinde önce ERC-8004 kontrolü, sonra politika kontrolü (kategori/fiyat), kabul edilirse x402-korumalı endpoint'e yönlendirme
- [ ] Basit bir doğal dil politika ayrıştırıcı ekle (kullanıcının "sadece araştırma şirketlerine, min 2$" gibi cümlesini yapılandırılmış kurala çeviren küçük bir LLM çağrısı)
- [ ] Şifreli off-chain veri katmanını (basit bir SQLite/Postgres, alan bazlı şifreli) bağla — kabul edilen sorguda ham veri değil, agregatör kohort sonucu dönsün
- [ ] Reddedilen senaryoyu da test et (kategori uymuyor, fiyat düşük) — gerekçeli ret mesajının döndüğünü doğrula
- [ ] Tüm akışı baştan sona 3-4 kez çalıştır, hataları not al

**Devir teslim notu (Kişi A → Kişi B):** Çalışan uçtan uca akışın bir demo scripti/komutu olsun (`npm run demo`). Kişi B artık bunun üzerine arayüz ve sunum katmanını ekleyecek.

---

## Blok 6 — Kullanıcı Paneli / Demo Arayüzü (~4-5 saat, Kişi B)

**Hedef:** Jürinin izleyeceği görsel katman hazır — kullanıcı politikasını girdiği ekran, müzakere adımlarının canlı göründüğü log, kazanç/HashScan linklerinin listelendiği panel.

- [ ] Basit bir tek sayfalık arayüz (React/Next ya da düz HTML+JS yeterli): politika girişi, "sorgu gönder" simülasyon butonu, müzakere adımlarının canlı akışı (A2A Task state güncellemelerini SSE ile dinleyerek)
- [ ] Kazanç paneli: hangi sorgunun ne zaman, ne kadar ödediği, HashScan transaction linkiyle birlikte listelensin
- [ ] HCS audit trail'den gelen kayıtları basitçe göster ("şu sorgu şu zaman doğrulandı" listesi)
- [ ] README'yi doldur: kurulum adımları, mimari diyagram (basit bir ASCII ya da görsel), ödeme akışının nasıl çalıştığının açıklaması (Hedera track zorunlu gereksinimi)

**Devir teslim notu (Kişi B → ikiniz birlikte):** Arayüz Blok 5'teki backend ile tam konuşuyor olsun; ikiniz birlikte tam prova yapacaksınız.

---

## Blok 7 — Ortak Prova, Bug Fix, Demo Videosu (~4-5 saat, ikiniz birlikte)

- [ ] Tüm akışı sıfırdan (temiz ortam, sıfır bakiyeden HBAR yükleyerek) en az 2 kez çalıştırıp kırılan yerleri düzeltin
- [ ] ≤5 dakikalık demo videosunu çekin: politika girişi → müzakere → kabul/ret → x402 ödemesi HashScan'de görünüyor → kazanç paneli
- [ ] README'de "hangi Subgraph/endpoint/araç kullanıldığı" yerine "hangi Hedera servisleri (Agent Kit, x402, A2A, ERC-8004, HCS) nasıl kullanıldığı" bölümünü net yazın — zorunlu gereksinim
- [ ] Son commit geçmişini kontrol edin (tek seferlik dev commit'ler jüride kötü izlenim bırakır, düzenli commit history bırakın)

---

## Blok 8 — Gönderim (~1 saat, ikiniz birlikte)

- [ ] Public repo linkini, demo videosunu, canlı demo linkini (varsa) ETHGlobal submission formuna gir
- [ ] Hedera track'in zorunlu gereksinimlerini tek tek işaretleyin: en az bir ödeme/token transferi ✓, Agent Kit/x402/A2A kullanımı ✓, README mimari açıklaması ✓, demo videosu ✓
- [ ] Bonus maddelerden hangilerini karşıladığınızı README'de açıkça listeleyin (A2A çoklu ajan müzakeresi, x402 pay-per-request, ERC-8004 kimlik, HCS audit trail) — jüri bunları aramak zorunda kalmasın, siz gösterin

---

## Kritik Yol Özeti

Sıra şu şekilde zorunlu bir bağımlılık zinciri oluşturuyor: **Hedera client kurulumu (Blok 1) → x402 ödeme (Blok 2) → A2A müzakere (Blok 3) → ERC-8004 kimlik (Blok 4) → entegrasyon (Blok 5) → arayüz (Blok 6) → prova (Blok 7) → gönderim (Blok 8)**. Bir blok tıkanırsa bir sonrakine geçmeyin — vardiya değişse bile aynı bloğu bitirmeden ilerlemeyin, çünkü her blok bir öncekinin üzerine kuruluyor.

Zaman sıkışırsa ilk feda edilecekler sırasıyla: Blok 6'daki arayüz süslemesi (basit bir konsol logu bile jüriye yeterli olabilir), Blok 4'teki gerçek validation attestasyonu (simüle edilebilir), Blok 5'teki doğal dil politika ayrıştırıcı (sabit bir JSON politika ile değiştirilebilir). Asla feda edilmeyecekler: Blok 1-2-3 (ödeme + müzakere olmadan proje Hedera track'i karşılamaz) ve Blok 7'deki demo videosu.
