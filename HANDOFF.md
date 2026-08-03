# Vessel — Hand-off (2026-08-03)

## Contract-settlement checkpoint (2026-08-03)

**Current decision: NO-GO for public deployment.** The historical Phantom demo
described later in this hand-off is not the new contract settlement release.

Completed and committed:

- Shared Ed25519 `QuoteV1` signing and receipt-bound verification for Aptos Move
  and the Solana Vessel Program.
- Contract-only upload/recovery UI. A saved transaction is checked again after a
  reload without automatically asking the wallet to pay twice.
- Removal of the direct treasury authorization routes and helpers.
- Mocked 7-day Aptos and 30-day Solana DAA end-to-end acceptance flows.
- Local gates: Node 152/152 plus bundles, Move 25/25, Solana Rust 6/6, Anchor
  integration 9/9.

Release blocker:

- `deployments/vessel-settlement.testnet.json` still contains zero/System Program
  placeholders.
- Aptos verification lacks the real multisig address and three public owners.
- Solana verification lacks three public Squads members and a finalized
  autonomous Squads deployment.
- There is no real public-chain settlement/upload evidence for either chain.

Do not enable settlement contracts or redeploy Vercel with placeholder values.
Continue from `docs/verification/contract-settlement-release-checklist.md`. The
next operator step requires three real public owner/member addresses per chain,
then the corresponding 2-of-3 approvals and 24-hour timelocks.

Bàn giao trạng thái dự án **Vessel** (wallet-native hot storage trên Shelby qua DAA).
Đọc kèm: `CLAUDE.md` (hiến pháp), `NOTES.md` (ground-truth signatures + breakthroughs), `README.md`.

---

## 1. TL;DR — đang ở đâu

**Demo Cách B (sponsored + USDC) đã CHẠY THẬT end-to-end, LIVE trên Vercel, test bằng Phantom thật.**

- 🌐 Live: **https://vessel-sage.vercel.app**
- 📦 GitHub (public): **https://github.com/duclucky/Vessel**
- ⛓️ Mạng: Shelby **testnet** (Solana DAA) + Solana **devnet** (USDC). Aptos gas station tài trợ phí.

Luồng đã xác minh live (real Phantom, trên bản deploy):
connect Phantom → **derive DAA account `0xec2ac6…e9491d`** → báo giá USDC → **trả 0.0106 USDC**
(paySig `2CyvFqq6…`) → server verify → **ký sponsored register bằng Phantom** → server submit qua
gas station → byte-upload → **blob thuộc tài khoản khách**, đọc lại **HTTP 200, PNG byte-exact 60426B**:
`https://api.testnet.shelby.xyz/shelby/v1/blobs/0xec2ac6…/media/c7bc0eae…png`

---

## 2. Kiến trúc (Cách B) — bảo mật đúng hiến pháp

Chỉ **chữ ký ví** ở client; mọi secret (Shelby API key, gas station key, private key, PAY_SECRET) ở server.

1. **Client (Phantom)**: derive DAA account; trả USDC (SPL transfer + memo) tới treasury; ký
   `register_blob_with_sponsor` (multi-agent) làm **sender** qua `signAptosTransactionWithSolana`;
   serialize txn+senderAuth → POST `/api/sponsor/submit`; byte-upload trực tiếp lên Shelby RPC.
2. **Server**: `/api/pay/quote` (HMAC stateless) → khách trả USDC → `/api/pay/verify` (đọc tx Solana:
   đúng số tiền + treasury + memo) cấp `uploadToken` → `/api/sponsor/submit` (verify token → deserialize
   → **gas station** co-sign fee-payer + ShelbyUSD sponsor → submit). Gas station key KHÔNG ra browser.

Recipe đầy đủ + 2 "bức tường sync/async" đã gỡ: **`NOTES.md` §5j**.

---

## 3. Đã CHẠY (verified live) ✅ / Hạn chế đã biết ⚠️

| Hạng mục | Trạng thái |
|---|---|
| Landing / Identity / Upload / Gallery / Latency / Metadata render | ✅ (giữ nguyên visual Stitch) |
| Phantom connect + **DAA derivation** (Solana→Aptos) | ✅ live |
| **USDC payment** qua Phantom (on-chain devnet) + server verify + uploadToken | ✅ live |
| **Sponsored register** (multi-agent, Phantom ký sender, gas station submit) | ✅ live |
| Clay erasure-coding **WASM** trong browser | ✅ (fix `import.meta.url`→origin, serve `/clay.wasm`) |
| **Byte-upload** → blob thuộc DAA account khách, đọc byte-exact | ✅ live |
| Backend serverless trên Vercel | ✅ (fix `ERR_REQUIRE_ESM`: override `rpc-websockets`→`uuid@9`) |

⚠️ **Hạn chế / mainnet TODO:**
- **Phantom chặn `signMessage` challenge byte-upload** ("cannot sign solana transactions using sign
  message" — anti-phishing). Testnet KHÔNG enforce challenge (ghi ẩn danh) → client fallback ký bằng
  **ephemeral key**. Quyền sở hữu vẫn thật (register do Phantom ký on-chain). **Mainnet phải làm lại**
  bước này (server-relay byte-upload bằng api key, hoặc Shelby đổi challenge sang SIWS). Chi tiết `NOTES.md` §5k.
- **Ethereum DAA byte-upload = bất khả** ở mọi bản ethereum-kit (`NOTES.md` §5d). Solana/Phantom là đường DAA duy nhất chạy.
- Testnet Shelby là prototype, **có thể bị wipe** → mọi URL là ephemeral.

---

## 4. Việc CÒN LẠI (chưa xong)

1. **Test UI thật cho Gallery/Latency/Metadata**: upload live vừa rồi chạy qua harness JS (gọi thẳng
   `window.VesselSolana`), CHƯA đi qua `app.js doUpload` nên **chưa ghi vào `localStorage` ledger**
   (`vessel_mine`, `vessel_selected_key`). Gallery/Latency/Metadata đọc từ localStorage → cần 1 lần
   upload qua **UI thật** (kéo-thả/Select File) để 3 màn này có dữ liệu. Cơ chế đã wire đúng, chỉ chưa chạy qua UI.
   - Lưu ý test tự động: `file_upload` của Chrome-tool bị chặn path scratchpad; đã workaround bằng tiêm
     File qua `DataTransfer` (JS). Popup phê duyệt Phantom là cửa sổ extension — tool không click được,
     nhưng thực tế Phantom **tự chạy** được (đã trả USDC + ký register thành công). Nếu popup kẹt "disconnected
     port" (lỗi tạm của Phantom) thì thử lại.
2. **Lỗi cosmetic — Tailwind config JSON sai** trong `<script id="tailwind-config">` của **mọi** file
   `public/*.html` (mảng `data-lg`/`data-xl` đóng bằng `}` thay vì `]`, ví dụ `identity.html:158`).
   Gây `SyntaxError` console (không chặn app), nên sửa cho sạch (đổi `}` → `]`).
3. **Landing "Connect Wallet"** (top-right + CTA) vẫn gọi `connectWallet()` (cần MetaMask/`window.ethereum`).
   Máy demo có Petra+Phantom, không MetaMask → nút này lỗi. Nên đổi CTA landing sang **Phantom** hoặc điều
   hướng thẳng `/identity.html` (luồng thật nằm ở Identity/Upload).
4. **`PUBLIC_BASE` trên Vercel**: đang fallback `VERCEL_URL` (URL deploy-hash). tokenUri metadata trỏ về
   proxy server — chấp nhận được cho demo. Muốn đẹp thì set env `PUBLIC_BASE=https://vessel-sage.vercel.app`.
5. **Quay video demo** (deliverable theo `CLAUDE.md` §5) — network có thể wipe, nên quay sớm.

---

## 5. Vận hành

**Local:**
```bash
cd app/server
npm install
# .env đã có (KHÔNG commit). Xem .env.example để biết biến.
npm run build:client   # bundle vessel-solana.js + copy clay.wasm -> public/
npm start              # http://localhost:8787
```

**Deploy Vercel** (đã link project `duckys-projects-bc83c6a0/vessel`, root = `app/server`):
```bash
cd app/server && vercel deploy --prod --yes
```
- 16 env var đã set ở **production** (secrets). `VERCEL=1` tự tắt `app.listen`.
- `vercel.json`: `/api/*`→serverless (`api/index.js` re-export Express app); còn lại→`public/`.
- ⚠️ **Deployment Protection đã TẮT** (user tự tắt) để demo public. Nếu redeploy tạo project mới, nhớ tắt lại.
- Đổi bundle client → phải `npm run build:client` **trước** khi deploy (Vercel serve `public/` as-is, không build).

**Xem log serverless:** `vercel logs https://vessel-sage.vercel.app`

---

## 6. File chính

- `app/server/src/index.js` — Express: `/api/config`, `/api/pay/{quote,verify}`, `/api/sponsor/submit`,
  `/api/latency`, `/api/metadata`, `/api/health`. Export app + guard listen cho Vercel.
- `app/server/src/lib/payments.js` — PaymentManager (HMAC stateless: quote/verify/uploadToken).
- `app/server/src/lib/sponsor.js` — SponsorManager (deserialize txn+auth → gas station submit).
- `app/server/client-src/vessel-solana.js` — **client Phantom**: connect/derive, `payUSDC`,
  `uploadSponsored` (2 override: register→server submit; challenge→ephemeral fallback). Bundle → `public/vessel-solana.js`.
- `app/server/public/app.js` — wiring 6 màn: `initUpload` (quote→pay→verify→sponsored), gallery(localStorage), latency, metadata.
- `app/server/build-client.mjs` — esbuild + fix wasm (`import.meta.url`→`globalThis.__vesselBase`, copy clay.wasm).
- `NOTES.md` §5g–5k, §11 — mọi breakthrough + deploy notes. **§5j = recipe sponsored, §5k = giới hạn Phantom challenge.**

## 7. Test artifacts (scratchpad, không commit)
`…/scratchpad/vessel-tn-sol/`: `phantom-sponsor.mjs` (proof Phantom-shaped sponsored),
`dummy-chal-test.mjs` (proof testnet ghi ẩn danh — challenge sig giả vẫn upload OK).
Ví test (đã faucet): xem `.env` (server/treasury) + các `*.json` trong scratchpad.
