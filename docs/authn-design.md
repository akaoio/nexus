# AuthN — thiết kế xác thực (rủi ro #11)

> Identity của Nexus là **ZEN keypair** (ARCHITECTURE §6): user = public key, không có bảng password. Tài liệu này chốt đường đi từ keypair đến HTTP request, và tầng interim chạy được ngay hôm nay.

## 1. Ba tầng danh tính

| Tầng | Ai dùng | Cơ chế |
|---|---|---|
| **ZEN keypair** (đích) | Người dùng thật (browser, local mode) | WebAuthn passkey → hash → keypair xác định (akao có sẵn). Đăng nhập server mode = ký challenge: server phát nonce, client ký bằng ZEN key, server `ZEN.recover(sig)` → pub = user. Đổi lấy **token ngắn hạn** (ký HMAC bởi site key, TTL cấu hình, mang `{user: pub, roles, exp}`) — request sau chỉ cần `Authorization: Bearer <token>`. |
| **API key** (interim + integration) | Máy-với-máy, CI, và là tầng interim trước khi ZEN flow ship | Khai trong `nexus.config.json`: `api_keys: [{ key, user, roles }]`. Request mang `Authorization: Bearer <key>` hoặc `x-nexus-key`. Key là bí mật do site cấp — đúng vai "API key per-integration" của rủi ro #11. |
| **DEV identity** | `nexus dev` khi **chưa** cấu hình `api_keys` | Như hiện tại: user `dev` (override `x-nexus-user`), policy toàn quyền, khai to trên banner. **Bật `api_keys` là tắt DEV identity** — không có chế độ nửa vời. |

## 2. Assignment: từ danh tính đến policy

Policy sống trong `apps/<app>/permissions/*.json` (mỗi file một mảng policy — đúng shape Permission v1, kèm annotation `roles`):

- Policy **có `roles`**: áp cho user mang ít nhất một role giao nhau.
- Policy **không có `roles`**: áp cho **mọi user đã xác thực** (baseline của app — ví dụ ai cũng đọc được `task` của mình qua `ifOwner`).
- Không policy nào khớp → deny-by-default của engine tự lo phần còn lại.

Resolver: `policiesFor(user, roles) = policies.filter(p => !p.roles || p.roles.some(r => roles.includes(r)))` — thuần, một dòng, test được.

## 3. Hợp đồng HTTP

- Thiếu/sai credential khi site yêu cầu auth → **401** `{ ok: false, error: { code: "E_AUTH" } }` — trước khi chạm Data Plane.
- Mọi enforce còn lại (403/404/không-rò-tồn-tại) giữ nguyên ở Data Plane — tầng auth chỉ trả lời "bạn là ai", không bao giờ trả lời "bạn được làm gì".

## 4. Trạng thái triển khai

- ✅ Interim API keys + role assignment + policies loading (kèm tài liệu này).
- ⏳ ZEN challenge-sign flow + HMAC token: ship cùng tích hợp ZEN (Phase 5 mở rộng) — cần vendor ZEN crypto; seam đã sẵn (`context(req)` resolver của `createApi` là điểm cắm duy nhất, mọi flow mới chỉ thay resolver).
