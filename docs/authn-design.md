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

## 4. Test được không khi không có phần cứng WebAuthn?

Được — và đây là mấu chốt của cả thiết kế. WebAuthn không tự sinh keypair theo nghĩa ngẫu nhiên: nó tạo ra một **bí mật ổn định gắn với thiết bị** (credential, hoặc output của PRF extension). Nexus **hash bí mật đó thành một seed**, rồi `ZEN.pair(null, { seed })` **suy ra keypair một cách xác định** — cùng credential luôn cho cùng public key, không cần lưu private key ở đâu cả.

Hệ quả cho test: không có authenticator trong môi trường headless, nên **seed cố định đứng thay cho hash credential** — phần suy ra keypair y hệt production. Điều khoản **AUTH-04** chứng minh trên chính ZEN vendored: cùng seed → cùng pub (mọi lần), seed khác → pub khác, và `recover(sign(nonce)) === pub` (đúng vòng challenge-sign của §1). Đây cũng chính là cách akao DEV mode làm (`zen.pair(null, { seed: "seed" })`).

Vì vậy khi flow ZEN server-mode được implement, nó test được đầy đủ mà không cần phần cứng: tiêm seed cố định để mô phỏng "user X đăng nhập bằng passkey của họ".

## 5. Trạng thái triển khai

- ✅ Interim API keys + role assignment + policies loading.
- ✅ Chứng minh khả năng test key xác định từ seed (AUTH-04).
- ✅ **ZEN challenge-sign flow + HMAC token — HOÀN THÀNH** (`src/app/auth.js`, AUTH-05/06/07):
  - `POST /api/v1/_auth/challenge` → nonce (một lần, TTL 60s).
  - `POST /api/v1/_auth/verify` `{ pub, nonce, signature }` → server `recover(sig)===pub` **và** message ký === nonce → phát token HMAC-SHA256 (ký bởi `token_secret` của site, mang `{user: pub, roles, exp}`, TTL 1h).
  - Request sau: `Authorization: Bearer <token>` → `verifyToken` (HMAC constant-time + exp) → identity. Token tồn tại song song với API key (thử token trước, rồi key).
  - Role assignment: `config.identities = [{ pub, roles }]` ánh xạ ZEN pub → roles; pub không map = đã xác thực nhưng roles rỗng (baseline policies). Bật `api_keys` **hoặc** `identities` là tắt DEV identity.
  - Đã kiểm chứng e2e: replay nonce bị chặn (một lần), token forge (sai secret) → 401, identity chính là ZEN pub được chứng minh bằng mật mã.
- ⏳ Còn lại (cần tích hợp mạng/UI, không phải core): WebAuthn PRF binding phía client (browser tạo credential → hash → seed), và ZEN graph transport. Seam `context(req)` + `authState` đã sẵn.
