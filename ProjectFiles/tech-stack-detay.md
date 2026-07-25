# Tech Stack ve Kurulum Detayları
### Kişisel Sağlık/Fitness Verisi Ajan Pazarı — Hedera Track

Bu belge, projedeki her bileşen için gerçek paket adlarını, repo/dokümantasyon linklerini ve kurulum sırasını içerir. Araştırma Temmuz 2026 itibarıyla güncel kaynaklardan derlenmiştir.

---

## 1. Hedera Ağı ve Testnet Hesabı

Hedera bir blockchain değil, Hashgraph konsensüsü kullanan bir DAG ağı; EVM uyumlu (Solidity/Hardhat/Foundry çalışır) ama native servisleri (HTS, HCS) akıllı sözleşme gerektirmeden SDK üzerinden kullanılabiliyor. Testnet ücretsiz, ortalama işlem ücreti ~$0.0001, finality 3-5 saniye.

Testnet hesabı [portal.hedera.com/dashboard](https://portal.hedera.com/dashboard) üzerinden ücretsiz açılıyor; hesap açılınca `ACCOUNT_ID` (`0.0.xxxxx` formatında) ve bir private key (ECDSA ya da ED25519) veriliyor. HBAR musluğu (faucet) testnet hesabına otomatik test HBAR yüklüyor.

Kaynak: [Getting Started with Hedera](https://docs.hedera.com/hedera/getting-started) · [Hedera Portal](https://portal.hedera.com/dashboard)

---

## 2. Hedera SDK (native işlemler için temel katman)

Paket: `@hiero-ledger/sdk` (Hedera SDK, Linux Foundation'ın Hiero projesi altında; eski `@hashgraph/sdk` adı hâlâ geçerli/takma ad olarak duruyor). Bu SDK ile client kurulumu:

```ts
import { Client, PrivateKey } from '@hiero-ledger/sdk';

const client = Client.forTestnet().setOperator(
  process.env.ACCOUNT_ID!,
  PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!)
);
```

Dört native servis: **HTS** (Token Service — token/NFT oluşturma, smart contract gerektirmez), **HCS** (Consensus Service — sıralı, zaman damgalı, doğrulanabilir mesaj/topic — audit trail için ideal), **Smart Contracts (EVM)** — Solidity/Hardhat/Foundry/Remix ile tam uyumlu, **HFS** (File Service).

Kaynak: [Getting Started](https://docs.hedera.com/hedera/getting-started) · [HCS: Create a Topic](https://docs.hedera.com/native/consensus/create-topic) · [HTS Docs](https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service)

---

## 3. Hedera Agent Kit — projenin omurgası

Repo: [github.com/hashgraph/hedera-agent-kit-js](https://github.com/hashgraph/hedera-agent-kit-js) (monorepo, v4). Stripe Agent Toolkit'ten ilham alınarak tasarlanmış; AI ajanlarına Hedera üzerinde konuşarak işlem yaptırma katmanı.

**Paketler:**

| Paket | Ne işe yarar |
|---|---|
| `@hashgraph/hedera-agent-kit` | Çekirdek SDK + plugin sistemi |
| `@hashgraph/hedera-agent-kit-langchain` | LangChain adaptörü (StructuredTools) — satıcı/alıcı ajanları LangChain ile kuracaksak bu |
| `@hashgraph/hedera-agent-kit-ai-sdk` | Vercel AI SDK adaptörü |
| `@hashgraph/hedera-agent-kit-mcp` | MCP server toolkit — Hedera işlemlerini bir MCP server olarak expose eder |
| `create-hedera-agent` | Next.js iskelet CLI'ı |

**Hazır tool'lar (plugin bazlı):** HBAR transferi (Core Account Plugin), Topic oluşturma + mesaj gönderme (Core Consensus Plugin — HCS), Fungible/NFT token oluşturma + airdrop (Core Token Plugin), sorgu plugin'leri (bakiye, token bilgisi, transaction kaydı).

**İki çalışma modu:** `AgentMode.AUTONOMOUS` (ajan işlemi kendi imzalayıp gönderiyor — bizim satıcı/alıcı ajan senaryomuz bu) ve `AgentMode.RETURN_BYTES` (işlem imzalanmadan dönüyor, kullanıcı/cüzdan imzalıyor — non-custodial senaryolar için).

**60 saniyelik kurulum:**

```bash
npm install @hiero-ledger/sdk @hashgraph/hedera-agent-kit @hashgraph/hedera-agent-kit-langchain langchain @langchain/openai dotenv
```

```ts
import { Client, PrivateKey } from '@hiero-ledger/sdk';
import { AgentMode } from '@hashgraph/hedera-agent-kit';
import { allCorePlugins } from '@hashgraph/hedera-agent-kit/plugins';
import { HederaLangchainToolkit } from '@hashgraph/hedera-agent-kit-langchain';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';

const client = Client.forTestnet().setOperator(process.env.ACCOUNT_ID!, PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!));

const toolkit = new HederaLangchainToolkit({
  client,
  configuration: { plugins: allCorePlugins, context: { mode: AgentMode.AUTONOMOUS } },
});

const agent = createAgent({
  model: new ChatOpenAI({ model: 'gpt-4o-mini' }),
  tools: toolkit.getTools(),
  systemPrompt: 'You are a helpful assistant with access to Hedera blockchain tools',
});
```

Önemli bir bonus özellik: **Hooks & Policies** sistemi — her tool çağrısına önce/sonra kanca takılabiliyor. Örnek hazır hook: `HCSAuditTrailHook` (her aksiyonu bir HCS topic'ine otomatik loglar — bizim "verifiable payment audit trail" bonus maddesini bununla neredeyse hazır alıyoruz). Ayrıca satıcı ajanın politikasını ("sadece araştırma şirketlerine, min 2$") bir **Policy** olarak kodlamak da bu sistemle mümkün.

Kaynak: [hedera-agent-kit-js README](https://github.com/hashgraph/hedera-agent-kit-js) · [Hooks & Policies Docs](https://github.com/hashgraph/hedera-agent-kit-js/blob/main/docs/HOOKS_AND_POLICIES.md) · [Plugins Docs](https://github.com/hashgraph/hedera-agent-kit-js/blob/main/docs/PLUGINS.md)

---

## 4. x402 — pay-per-request ödeme katmanı

x402, HTTP 402 durum koduna dayanan açık bir ödeme standardı: sunucuya `paymentMiddleware` ekleniyor, ödemesiz istek geldiğinde 402 dönüyor, istemci öder ve tekrar dener — hepsi tek bir HTTP round-trip mantığında.

```ts
app.use(paymentMiddleware({
  "GET /data/cohort-insight": { accepts: [...], description: "Kohort bazlı fitness verisi" },
}));
```

**Hedera'da x402 nasıl çalışıyor:** Ödeme doğrulama/settlement işini bir **facilitator** yapıyor (blockchain mantığını iş mantığından ayırıyor) — geliştirici sadece facilitator URL'i ve `PAY_TO_ACCOUNT` (alıcı hesap) belirtiyor, kendi anahtarını server'da tutmak zorunda kalmıyor. Hedera testnet için çalışan bir facilitator: **blocky402** (BlockyDevs'in açık kaynak x402 facilitator'ı, `hedera:testnet` ağını destekliyor). HBAR native token asset ID `0.0.0` ile, miktarlar tinybar cinsinden (1 HBAR = 10⁸ tinybar) temsil ediliyor.

**Referans örnek repo:** [matevszm/x402-hedera-example](https://github.com/matevszm/x402-hedera-example) — Hedera testnette çalışan uçtan uca bir x402 kaynak sunucusu. Mimarisi bizim projeye doğrudan şablon olabilir: `src/core/provider.ts` (veri sağlayıcı arayüzü — bizde bu kohort agregatörü olur), `src/server/` (Hono tabanlı: pre-validation → paymentMiddleware → handler), `scripts/x402-sign.ts` (bir ajanın private key'i kendi context'ine hiç sokmadan ödeme imzalaması — tam olarak "otonom ajan ödeme yapıyor ama anahtar ajanın eline geçmiyor" ilkesi). Fiyat kataloğu `GET /catalog` ile expose ediliyor, ödeme sonucu `payment-response` header'ında dönüyor (Hedera transaction ID dahil).

**Resmi Hedera şablonu:** [scaffold-hbar/templates/x402-pay-per-use](https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use) — Hedera'nın kendi resmi x402 pay-per-use iskeleti, sıfırdan başlamak yerine bunu fork edip özelleştirmek muhtemelen en hızlı yol.

Kaynak: [x402.org](https://www.x402.org/) · [x402 Docs](https://docs.x402.org) · [Hedera and x402 (resmi blog)](https://hedera.com/blog/hedera-and-the-x402-payment-standard/) · [x402-hedera-example](https://github.com/matevszm/x402-hedera-example) · [scaffold-hbar x402 template](https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use)

---

## 5. A2A Protokolü — ajanlar arası müzakere

Resmi paket: `@a2a-js/sdk` ([a2aproject/a2a-js](https://github.com/a2aproject/a2a-js), Apache 2.0, 552 star). A2A Protocol Specification v0.3'ü implemente ediyor (v1.0 alpha da mevcut). JSON-RPC, HTTP+JSON/REST ve gRPC transport'larının hepsini destekliyor.

```bash
npm install @a2a-js/sdk express
```

**Server tarafı (satıcı ajan):** Bir `AgentCard` tanımlanıyor (isim, açıklama, endpoint URL, skills, capabilities — bizim durumda "veri erişim müzakeresi" bir skill oluyor), bir `AgentExecutor` sınıfı ajan mantığını taşıyor (`execute()` metodu, gelen mesajı işleyip cevap/task üretiyor), `DefaultRequestHandler` ile Express'e bağlanıyor.

**Client tarafı (alıcı ajan):** `ClientFactory` ile `factory.createFromUrl('http://satici-ajan-url')` diyerek satıcı ajanın agent card'ını (`/.well-known/agent-card.json`) otomatik keşfediyor, `client.sendMessage(...)` ile müzakere mesajı gönderiyor.

**Task modeli:** Uzun süren/durumlu işlemler için ajan bir `Task` oluşturabiliyor (`submitted` → `working` → `completed` state'leri, `Artifact` üretebiliyor) — bizim senaryoda "kohort sorgusu değerlendiriliyor → onaylandı/reddedildi → ödeme bekleniyor → tamamlandı" akışı bu Task modeliyle doğal şekilde temsil edilebilir. Streaming (SSE) desteği de var — müzakere adımlarını gerçek zamanlı göstermek için demoda kullanılabilir.

Kaynak: [a2a-js README](https://github.com/a2aproject/a2a-js) · [A2A Protocol Spec](https://a2a-protocol.org/v0.3.0/specification)

---

## 6. ERC-8004 — onchain ajan kimliği, reputation, validation

**Kritik bulgu: ERC-8004 registry'leri Hedera Testnet'te zaten deploy edilmiş durumda**, kendi sözleşmemizi deploy etmemize gerek yok:

- **IdentityRegistry:** `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- **ReputationRegistry:** `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- HashScan üzerinden doğrulanabilir: [IdentityRegistry](https://hashscan.io/testnet/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) · [ReputationRegistry](https://hashscan.io/testnet/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)

Referans implementasyon repo: [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) (227 star, resmi 8004 ekibi tarafından küratörlüğü yapılıyor). ABI'ler `abis/` klasöründe hazır — Hedera EVM üzerinde standart bir `ethers.js`/`viem` Contract nesnesiyle doğrudan çağrılabilir.

**Identity Registry akışı:** `register(agentURI, metadata)` çağrısı bir ERC-721 NFT mint ediyor ve bir `agentId` dönüyor. `agentURI`, agent'ın "registration file"ına işaret ediyor (JSON, IPFS/HTTPS/data-URI olabilir) — bu dosyada agent'ın adı, açıklaması, ve **services** listesi var (A2A endpoint'i, MCP endpoint'i, ENS ismi, email — hepsi buraya eklenebilir). `agentWallet` metadata alanı, ödemenin gideceği cüzdanı EIP-712 imzasıyla doğrulanmış şekilde tutuyor.

**Reputation Registry akışı:** `giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)` — value/valueDecimals ikilisi ondalıklı bir skoru temsil ediyor (örn. value=87, decimals=0 → 87/100 puan). Feedback dosyasında **x402 ödeme kanıtını** (`proofOfPayment`: fromAddress, toAddress, chainId, txHash) taşıyabiliyor — yani bizim x402 ödemesini doğrudan reputation feedback'ine bağlayabiliyoruz, spec bunu örnek olarak öneriyor.

**Validation Registry akışı:** `validationRequest(validatorAddress, agentId, requestURI, requestHash)` ile bir validator'dan doğrulama istenir, validator `validationResponse(requestHash, response, ...)` ile 0-100 arası bir skor döner. Bizim senaryoda: alıcı ajanın "gerçekten araştırma kurumu" olduğuna dair uyum attestasyonu burada tutulur (validator rolünü hackathon demosunda biz simüle ederiz).

Not: Spec resmi olarak "Draft" aşamasında ve Validation Registry kısmı "TEE topluluğuyla hâlâ tartışılıyor" diye işaretli — bu bizim için sorun değil, demo amaçlı kullanmaya yeterli derecede stabil.

Kaynak: [EIP-8004 (resmi spec)](https://eips.ethereum.org/EIPS/eip-8004) · [erc-8004-contracts README + ABI'ler](https://github.com/erc-8004/erc-8004-contracts) · [8004.org](https://www.8004.org)

---

## 7. Özet Kurulum Sırası

1. [portal.hedera.com/dashboard](https://portal.hedera.com/dashboard) üzerinden testnet hesabı aç, `ACCOUNT_ID` + private key al, faucet'ten test HBAR al.
2. `npm install @hiero-ledger/sdk @hashgraph/hedera-agent-kit @hashgraph/hedera-agent-kit-langchain @a2a-js/sdk express langchain @langchain/openai dotenv` ile proje iskeletini kur.
3. Hedera Agent Kit quick-start koduyla "merhaba Hedera" testini geçir (bakiye sorgulama).
4. [x402-hedera-example](https://github.com/matevszm/x402-hedera-example) ya da [scaffold-hbar x402 template](https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use)'ı fork edip kohort-sorgu endpoint'ini x402 middleware ile sar, blocky402 facilitator'a bağla.
5. `@a2a-js/sdk` ile satıcı ajan için bir `AgentExecutor` + `AgentCard` yaz, alıcı ajan için `ClientFactory` ile bağlan.
6. `erc-8004-contracts` ABI'lerini kullanarak ethers.js/viem ile Hedera testnetteki hazır IdentityRegistry/ReputationRegistry adreslerine bağlan; her iki ajanı `register()` ile kaydet, agent card'larına A2A endpoint'lerini yaz.
7. Hedera Agent Kit'in `HCSAuditTrailHook`'unu aç — her müzakere/ödeme adımı otomatik olarak bir HCS topic'ine loglansın (bonus: verifiable audit trail).
8. Uçtan uca demo akışını test et: satıcı ajan politika alır → alıcı ajan sorgu gönderir (A2A) → satıcı ajan ERC-8004 kimliğini kontrol eder → kabul → x402 ödemesi Hedera testnette geçer → HashScan'de görünür → HCS'te kanıt kaydı oluşur.

---

## Tüm Kaynak Linkleri

- [Hedera Getting Started](https://docs.hedera.com/hedera/getting-started)
- [Hedera Portal (testnet hesap)](https://portal.hedera.com/dashboard)
- [Hedera Agent Kit (JS/TS)](https://github.com/hashgraph/hedera-agent-kit-js)
- [Hedera Agent Kit — Hooks & Policies](https://github.com/hashgraph/hedera-agent-kit-js/blob/main/docs/HOOKS_AND_POLICIES.md)
- [HCS: Create a Topic](https://docs.hedera.com/native/consensus/create-topic)
- [HTS: Token Service Docs](https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service)
- [x402.org](https://www.x402.org/)
- [x402 Docs](https://docs.x402.org)
- [Hedera x x402 (resmi blog yazısı)](https://hedera.com/blog/hedera-and-the-x402-payment-standard/)
- [x402-hedera-example (çalışan referans repo)](https://github.com/matevszm/x402-hedera-example)
- [scaffold-hbar — x402-pay-per-use template](https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use)
- [A2A JS SDK](https://github.com/a2aproject/a2a-js)
- [A2A Protocol Spec v0.3](https://a2a-protocol.org/v0.3.0/specification)
- [ERC-8004 Spec (EIP-8004)](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Reference Contracts + ABIs](https://github.com/erc-8004/erc-8004-contracts)
- [ERC-8004 Hedera Testnet — IdentityRegistry (HashScan)](https://hashscan.io/testnet/address/0x8004A818BFB912233c491871b3d84c89A494BD9e)
- [ERC-8004 Hedera Testnet — ReputationRegistry (HashScan)](https://hashscan.io/testnet/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)
