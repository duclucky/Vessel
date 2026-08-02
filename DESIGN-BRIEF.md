# Vessel — Design Brief (gửi cho AI thiết kế)

> Cặp với `FRONTEND-INTEGRATION.md` (hợp đồng kỹ thuật). File này = bối cảnh sản phẩm +
> đề xuất phong cách. **Mọi gợi ý visual ở Mục 5 là đề xuất — designer toàn quyền quyết định.**

## 1. Tổng quan dự án
- **Vessel** là một *demo chứng minh năng lực* (không phải sản phẩm thương mại): cho phép một
  ví **Ethereum/Solana có sẵn** điều khiển **lưu trữ phi tập trung "nóng" (hot storage)** trên
  mạng **Shelby** — **không cần** tạo tài khoản mới, không seed phrase, không bridge.
- **Bài toán:** media của NFT/dApp hiện phải chọn 1 trong 3 dở: IPFS (chậm, phải pin),
  Arweave (vĩnh viễn nhưng *lạnh*/đọc chậm), AWS/CDN (nhanh nhưng tập trung, kiểm duyệt được).
  Không cái nào cho cả ba: **nhanh + phi tập trung + do chính ví người dùng kiểm soát.**
- **Giá trị cốt lõi (3 điểm khác biệt cần khoe):**
  1. **DAA** — ví ngoài chuỗi điều khiển tài khoản lưu trữ trên Aptos ("không cần ví mới").
  2. **Đọc nhanh dưới giây** — nhanh hơn IPFS thấy rõ (bằng chứng đo được).
  3. **Cross-chain** — cùng một kho, ví nào cũng dùng.
- **Khoảnh khắc "wow" của demo:** *Connect MetaMask → bạn vừa sở hữu kho lưu trữ phi tập trung
  → ảnh của bạn load nhanh hơn cùng ảnh đó trên IPFS.*
- **Định vị & sự trung thực (quan trọng):** đây là demo trên testnet **bị xóa ~hàng tuần**.
  Không nói "hãy host bộ sưu tập thật ở đây". Phải có dấu hiệu trung thực "dữ liệu tạm/ephemeral".
  Với giám khảo kỹ thuật, sự trung thực là điểm cộng; overclaim là mất uy tín.

## 2. Người dùng mục tiêu (Personas)
- **Chính — Giám khảo/reviewer chương trình builder Shelby/Aptos.** Dân kỹ thuật, crypto-native.
  Xem một lượt demo 60–90 giây (thường có video). Tâm lý: **hoài nghi, so sánh ngầm với
  Walrus/Filecoin/Arweave**, muốn "grok" ngay điểm độc nhất và **thấy con số đo được**. Ghét
  hype rỗng; đánh giá cao sự rõ ràng và thành thật về giới hạn.
- **Phụ (nhân vật kể chuyện) — NFT creator / dApp developer.** Muốn media phi tập trung + nhanh
  mà không bắt người dùng đổi chain/ví. Tâm lý: ngại rắc rối seed phrase, quan tâm tốc độ load thật.
- **Hành vi:** chủ yếu trên **desktop** (trình bày/quay demo), thao tác nhanh, mắt dồn vào 2 thứ:
  (a) khoảnh khắc *connect-ví-thành-chủ-kho*, (b) *số đo độ trễ Shelby vs IPFS*.

## 3. Cấu trúc màn hình / Luồng (App Flow)
Có thể là một trang cuộn dọc chia section, hoặc vài bước — nhưng phải làm bật 6 bước sau
(User Journey: **Connect → Xác lập danh tính → Upload → Gallery → Bằng chứng độ trễ → Metadata**):

1. **Landing / Connect** — hero 1 câu thông điệp + nút "Connect Wallet".
2. **Storage Identity (sau connect)** — hiện địa chỉ ví + "storage identity" (địa chỉ Aptos suy
   ra qua DAA) + giải thích ngắn + prompt ký ("Sign to prove ownership — no new wallet").
3. **Upload** — kéo-thả/chọn ảnh (video là stretch), tiến trình, kết quả.
4. **Gallery** — lưới media của ví đã upload, thumbnail, badge ephemeral.
5. **Latency Proof** — panel so sánh **Shelby vs IPFS** (số + bar/delta). *Đây là "money shot".*
6. **NFT Metadata** — sinh JSON metadata trỏ tới media, hiện URL `tokenURI`-ready (không mint).

## 4. Thành phần UI bắt buộc theo từng màn hình
**1. Landing/Connect:** logo/tên; headline + subline (định vị); **nút Connect Wallet** (ETH bắt
buộc, SOL tùy chọn); dải "3 điểm khác biệt"; banner nhỏ "demo · testnet · dữ liệu tạm".

**2. Storage Identity:** card hiển thị `wallet address` và `storage account (Aptos)` ở **font
mono**, nút copy; sơ đồ/nhãn ngắn "Wallet → controls → Shelby storage"; nút "Sign / Create
identity" + trạng thái ký (idle/signing/verified); tooltip giải thích DAA.

**3. Upload:** vùng **drag-&-drop** + nút chọn file; xem trước ảnh; **thanh tiến trình**; giới
hạn 25MB & loại file; kết quả = thẻ media (thumbnail, **URL dạng mono có nút copy**, kích thước,
hạn expire); trạng thái error + "retry" thân thiện (mạng có thể chập chờn).

**4. Gallery:** **lưới thumbnail** media của ví; mỗi item: preview, tên/key rút gọn, size, thời
hạn còn lại; trạng thái **empty / loading (skeleton) / error**; hành động: mở, copy URL, xóa.

**5. Latency Proof (điểm nhấn):** **biểu đồ so sánh** Shelby vs IPFS (2 thanh hoặc đối chiếu);
số **median/min/p90 ms** dạng mono lớn; nhãn "Shelby (hot)" vs "IPFS gateway"; nút "Re-run test";
**xử lý trạng thái IPFS = null** (khi chưa có số IPFS, hiện "n/a" gọn gàng, đừng vỡ layout).

**6. NFT Metadata:** form nhỏ (name, description; ảnh lấy từ item đã chọn); **preview JSON** (khối
code, font mono); ô **tokenURI** kết quả + copy; ghi chú "trỏ thẳng vào NFT contract".

*(Trạng thái chung cần có ở mọi nơi: loading, error/upstream-retry, empty — dữ liệu để backend
cung cấp; cách trình bày là của designer.)*

## 5. Phong cách thị giác & Thương hiệu (đề xuất — designer tự quyết)
- **Hướng đề xuất: Dark mode, "technical / crypto-native nhưng sạch", nghiêng Bold & Modern.**
  Lý do: audience là dân kỹ thuật crypto; nền tối làm **số liệu độ trễ và media nổi bật**, hợp
  trình bày/quay video; tinh thần "proof over hype".
- **Bảng màu gợi ý:**
  - *Background:* near-black / deep slate (vd `#0B0F14`–`#111826`), nhiều tầng bề mặt tối.
  - *Primary accent (Shelby / tốc độ / "hot"):* **electric cyan–teal** (vd `#22D3EE`/`#2DD4BF`) —
    dùng cho hành động chính, chỉ số Shelby, điểm "nhanh".
  - *Secondary / tương phản (IPFS chậm / cảnh báo):* xám nguội hoặc **amber/coral** (`#F59E0B`/
    `#FB7185`) để đối chiếu "Shelby nhanh ↔ IPFS chậm" trong panel độ trễ.
  - *Text:* trắng ngà + xám cho phụ; giữ contrast AA.
- **Typography:**
  - *Heading:* sans-serif hình học hiện đại (vd **Space Grotesk / General Sans / Geist**).
  - *Body:* sans dễ đọc (Inter / Geist).
  - *Mono (bắt buộc dùng nhiều):* **JetBrains Mono / Geist Mono** cho địa chỉ ví, hash, key, và
    **các số độ trễ** — nét kỹ thuật + đáng tin.
- **Tinh thần thương hiệu:** chính xác, nhanh, đáng tin, tối giản có chủ đích; ít hiệu ứng thừa,
  mỗi chuyển động phải có lý do (làm bật khoảnh khắc DAA và con số tốc độ).

## 6. Kỹ thuật & Thiết bị
- **Ưu tiên Desktop-first** (giám khảo xem/quay demo trên desktop; gallery + panel độ trễ cần
  không gian rộng). Responsive xuống tablet/mobile là điểm cộng, không bắt buộc.
- **Tương tác động: có chủ đích, không lạm dụng.** Cần vài điểm nhấn: hiệu ứng khoảnh khắc "connect
  → thành chủ kho", animation upload, và **số độ trễ đếm/animate + bar chart** trong panel proof.
  Nhưng ưu tiên **rõ ràng + tốc độ** hơn là hoa mỹ.
- **Hiệu năng là một phần thông điệp:** app đang khoe "nhanh" → **bản thân app phải load nhanh, nhẹ**
  (đừng nặng animation/asset). Tối ưu preview media.
- **Bền với mạng chập chờn:** mọi call có thể lỗi tạm thời → trạng thái retry mượt, không hiện
  stack trace. Có banner trung thực "demo · ephemeral".
- **Accessibility cơ bản:** contrast tốt trong dark mode, số liệu và địa chỉ đọc rõ, focus state
  cho bàn phím.

---
### Ghi chú kỹ thuật để designer không thiết kế nhầm (từ backend)
- Ảnh/video luôn hiển thị qua URL backend (`/api/media/:key`) — không phải URL Shelby thô.
- "Storage identity" = một địa chỉ Aptos (dài, hex) suy ra từ ví → cần chỗ hiển thị mono + copy.
- Panel độ trễ: số Shelby là thật; **số IPFS có thể chưa có (null)** → cần trạng thái "n/a".
