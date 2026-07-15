# Nexus Sync — ZEN event log → SQL projection

> Tài liệu thiết kế cho tầng đồng bộ của local mode (ARCHITECTURE.md §6), giải quyết rủi ro #3: *"CRDT log → SQL projection — thứ tự replay, schema migration trên log cũ, compaction log."* Theo kỷ luật N6, tài liệu này kết thúc bằng danh sách điều khoản conformance SYNC-* — **không dòng code sync nào được viết trước khi các điều khoản đó tồn tại dưới dạng test đỏ.**

Nguyên tắc chỉ đạo, nhắc lại từ §6: **ZEN mang sự thật về "điều gì đã xảy ra" (event log đã ký); SQL mang sự thật về "trạng thái hiện tại là gì" (projection).** SQL không bao giờ thấy xung đột — nó chỉ thấy kết quả fold. Mọi peer fold cùng một tập event phải ra cùng một trạng thái SQL, từng byte.

---

## 1. Mô hình tổng quát

```
  GHI (local, optimistic)                      NHẬN (từ peer khác)
  ─────────────────────────                    ─────────────────────────
  UI/App gọi Data Plane API                    ZEN subscription bắn event mới
        │                                             │
  Permission.resolve (local check)             [Cổng 1] chữ ký hợp lệ?
        │                                      [Cổng 2] id = hash(canonical)?
  build Event v1 + ký (ZEN keypair)            [Cổng 3] PEN policy pass?
        │                                      [Cổng 4] schema/permission Nexus?
  ┌─────┴──────────┐                                  │ fail → QUARANTINE
  ▼                ▼                                  ▼ pass
  append vào       fold ngay vào              lưu event vào graph local
  ZEN graph        SQLite local                       │
  (local-first,    (optimistic)               REFOLD row bị ảnh hưởng
  tự replicate                                        │
  ra peer sau)                                UPSERT/DELETE vào SQLite
```

Hai đường vào, **một đường xuống SQL duy nhất**: mọi thay đổi SQL đều đi qua fold. Không có code path nào ghi thẳng SQL mà không sinh event (trừ server mode thuần — xem §10.5).

---

## 2. Event v1 — format đóng băng (N4)

```jsonc
{
  "eventVersion": 1,
  "id": "<base62 SHA-256 của canonical form, không gồm id và sig>",
  "site": "<site id>",
  "entity": "customer",
  "schemaVersion": 1,          // version schema mà NGƯỜI GHI đang dùng
  "op": "create" | "update" | "delete",
  "rowId": "<ULID — sinh phía người ghi>",
  "data": { "tier": "gold" },  // create: row đầy đủ; update: CHỈ field đổi; delete: {}
  "group": "<ULID|null>",      // gom nhiều event một thao tác UI (audit — xem §10.2)
  "author": "<ZEN pub key 45 ký tự>",
  "ts": { "millis": 1784102400000, "counter": 3 },  // HLC — xem §4.1
  "sig": "<chữ ký ZEN trên canonical form>"
}
```

Quyết định cứng:

1. **Event là bất biến và content-addressed.** `id` = hash của dạng canonical (JSON với key sắp xếp, không `id`/`sig`). Không ai — kể cả tác giả — sửa được event mà không đổi id và vỡ chữ ký. Đây là nền của mọi bảo đảm phía sau.
2. **Từ vựng `op` tối thiểu: create/update/delete.** Vòng đời document (submit/cancel/amend) **không** phải op riêng — nó là `update` lên field hệ thống `docstatus`; ánh xạ transition → action permission xảy ra ở Cổng 4 (§5). Giữ từ vựng wire-format nhỏ nhất có thể vì nó đóng băng vĩnh viễn.
3. **`update` chỉ mang field đổi** (delta). Điều này cho phép LWW mức field khi fold (§4.2) — hai người sửa hai field khác nhau của cùng row không bao giờ đè nhau.
4. **`rowId` là ULID sinh phía client** — không autoincrement (không có điểm cấp phát trung tâm), sắp thứ tự được theo thời gian, không va chạm.
5. **`schemaVersion` của người ghi nằm trong event** — điều kiện tiên quyết cho §7.

## 3. Bố trí trong graph ZEN

| Soul | Nội dung | Tính chất |
|---|---|---|
| `nexus/<site>/log/<entity>/<eventId>` | event node | write-once, PEN chặn overwrite |
| `nexus/<site>/rows/<entity>/<rowId>` | set các eventId của row | index để refold một row không quét cả log |
| `nexus/<site>/checkpoints/<n>` | checkpoint đã ký (§8) | chỉ key được site config chỉ định ghi được |

- Toàn bộ cây `nexus/<site>/log` và `rows` gắn **PEN policy** sinh từ permission AST của site: ZEN từ chối write không hợp lệ **ngay tại tầng graph**, trước khi Nexus nhìn thấy. Đây là cổng 3 — chạy ở mọi peer trung gian kể cả peer không cài Nexus (relay thuần ZEN vẫn enforce).
- Peer đăng ký `map().on()` trên `log/<entity>` của các entity mà site nó phục vụ — không kéo log của site khác.

## 4. Fold — projection tất định

### 4.1. Thứ tự toàn phần

Mọi event được sắp bằng khoá ba tầng, so sánh từ trái sang:

```
(ts.millis, ts.counter, author, id)
```

`ts` là **Hybrid Logical Clock**: `millis` = max(đồng hồ vật lý, millis lớn nhất từng thấy); `counter` tăng khi millis trùng. HLC cho thứ tự gần-đúng-thời-gian-thực nhưng **tất định tuyệt đối**: hai peer bất kỳ so sánh hai event bất kỳ luôn ra cùng kết quả, không phụ thuộc đồng hồ máy ai đúng. `author` và `id` là tiebreaker cuối — không tồn tại hai event "bằng nhau".

### 4.2. Refold mức row — trả lời câu hỏi "thứ tự replay"

Khi một event của row `r` đến (bất kể sớm, muộn, lặp, đảo thứ tự):

```
1. events(r) = toàn bộ event đã biết của r (tra index rows/, gồm event vừa đến)
2. sort theo khoá §4.1
3. fold từ rỗng:  create đặt nền → mỗi update đè các field nó mang → delete đặt tombstone
4. kết quả ≠ null  → UPSERT row vào SQLite
   kết quả = null → DELETE khỏi SQLite (tombstone giữ trong log tới checkpoint §8)
5. ghi eventId vào bảng sổ cái _nexus_applied
```

Hệ quả cấu trúc, không cần cơ chế thêm:

- **Hội tụ (confluence)**: trạng thái SQL chỉ phụ thuộc *tập* event, không phụ thuộc *thứ tự đến* — vì lần fold nào cũng sort lại từ đầu. Đây là bất biến quan trọng nhất, có property test riêng (SYNC-Q01).
- **Idempotent**: event đã có trong `_nexus_applied` → bỏ qua (echo của chính mình, gửi lặp, gossip trùng — cùng một nhánh code).
- **LWW mức field**: update là delta, fold đè theo thứ tự → field nào người sửa sau (theo HLC) thắng field đó; hai người sửa hai field khác nhau → cả hai đều sống. Trùng đúng ngữ nghĩa HAM của ZEN, nhưng thực hiện ở tầng fold để kết quả tất định trên tập event bất biến.
- **update tới trước create** (mạng đảo thứ tự): fold ra row thiếu nền → row tạm ở trạng thái "partial" không ghi SQL; khi create đến, refold ra đủ. Không cần buffer/hàng đợi riêng.
- Chi phí: O(số event của row) mỗi lần refold — chấp nhận được vì checkpoint (§8) chặn trên số event phải giữ, và fold chỉ đụng một row.

### 4.3. Fold và child table

Child row (field `type: table`) là **row của entity con với event riêng** (`entity: customer_contact`, có field `parent` trỏ rowId cha). Fold từng entity độc lập; ràng buộc FK trong SQLite local được declare `DEFERRABLE` hoặc enforce ở tầng fold (chọn khi implement — SYNC-S13 sẽ ghim). Không có event "lồng nhau".

## 5. Bốn cổng xác minh & quarantine

| Cổng | Kiểm tra | Chạy ở đâu | Khi fail |
|---|---|---|---|
| 1 | `ZEN.verify(sig)` — author đúng là người ký | mọi peer (ZEN core) | vứt bỏ, không lưu |
| 2 | `id == hash(canonical(event))` | mọi peer | vứt bỏ |
| 3 | PEN policy trên soul | mọi peer ZEN, kể cả relay không cài Nexus | ZEN từ chối write |
| 4 | Nexus: `eventVersion` biết; entity tồn tại; `Model.validate` data theo schema (sau khi upgrade §7); `Permission.resolve(author)` cho phép op — kể cả ánh xạ docstatus→submit/cancel/amend | peer Nexus, lúc fold | **quarantine** |

**Quarantine**: event qua cổng 1–3 nhưng trượt cổng 4 được **lưu nhưng không fold**, đánh dấu lý do, hiện trong `nexus doctor`. Không vứt — vì cổng 4 phụ thuộc trạng thái local (schema chưa update, policy vừa đổi): event hợp lệ có thể trượt tạm thời và được **re-try tự động sau mỗi lần migrate schema/policy**. Vứt event hợp lệ = mất dữ liệu vĩnh viễn; giữ event rác = tốn đĩa. Chọn tốn đĩa.

## 6. Permission trong P2P — ranh giới trung thực

Cùng một permission AST compile ra hai target (§4.2 ARCHITECTURE), nhưng ngữ cảnh thực thi khác nhau về bản chất, và tài liệu này nói thẳng:

| Loại rule | P2P enforce được? | Cơ chế |
|---|---|---|
| Entity-level (action × entity) | ✅ | PEN + cổng 4 |
| Field-level (permlevel) | ✅ | cổng 4 cắt field trái phép khỏi `data` |
| `ifOwner` | ✅ | so `author` với `owner` của row (fold state) |
| Row-rule chỉ tham chiếu field của chính row | ✅ | đánh giá JS-predicate trên post-image (create/update) / pre-image (delete) |
| Row-rule tham chiếu **row khác** (path xuyên quan hệ) | ⚠️ **KHÔNG tuyệt đối** | peer đánh giá trên projection local — có thể stale. Enforce tuyệt đối cần **arbiter** (§5.1 ARCHITECTURE): site khai arbiter thì event của entity đó chỉ được coi là chấp nhận sau khi arbiter ký xác nhận |
| Cross-row invariant (unique, số dư không âm…) | ❌ trong P2P thuần | bản chất CRDT: hai peer offline cùng tạo email trùng — không ai sai lúc ghi. Cần arbiter, hoặc chấp nhận phát hiện-và-sửa (flag conflict cho user) |

Quy tắc thiết kế rút ra: **schema có thể khai `sync: authoritative` trên entity** — entity đó chỉ ghi được khi liên lạc được arbiter (mất tính offline cho riêng entity đó, đổi lấy ràng buộc tuyệt đối). Mặc định là `sync: crdt` (offline-first, ràng buộc mềm). Người thiết kế app chọn theo nghiệp vụ — framework không chọn hộ và không giả vờ có cả hai cùng lúc.

## 7. Schema migration trên log cũ

Event là bất biến và đã ký — **không bao giờ rewrite log khi schema đổi** (rewrite = vỡ chữ ký = vỡ mọi thứ). Thay vào đó, upgrade lúc fold:

- Migration file structural (§4.4 ARCHITECTURE) khai thêm hàm thuần `upgradeRow(data, fromVersion) → data` cho bước version đó (cùng chỗ với DDL, cùng review).
- Fold pipeline: event mang `schemaVersion: k`, schema hiện tại là `n` → `data` đi qua chuỗi `upgradeRow` k→k+1→…→n **trước khi** validate và áp.
- Chuỗi upgrader là **vĩnh viễn và bất biến** như chính log — xoá upgrader cũ = không đọc được event cũ = vi phạm N4. Conformance test giữ chuỗi này sống (SYNC-S17).
- Event từ tương lai (`schemaVersion > n` — peer kia đã migrate trước): quarantine, tự re-try sau khi local migrate. Đây là hành vi đúng: không đoán schema chưa biết.

## 8. Compaction & checkpoint

Log không bị chặn sẽ lớn vô hạn; nhưng trong P2P không có ai đủ thẩm quyền tuyên bố "quá khứ trước điểm X không cần nữa". Thiết kế:

- **Checkpoint** = `{ checkpointVersion, site, upto: <khoá HLC §4.1>, stateRoot: <merkle root của toàn bộ row đã fold tới upto>, snapshotRef: <content-address của snapshot blob> , sig }` — ký bởi key giữ vai trò **arbiter/archive** khai trong site config (ký bằng site key). Snapshot blob phân phối qua tầng file P2P sẵn có (Torrent/RTC của akao).
- Peer nhận checkpoint: **tự fold lại tới `upto` và so `stateRoot`** — khớp thì được phép prune event ≤ upto (giữ lại tombstone trong snapshot); lệch thì báo động đỏ (một trong hai bên có log khác — không prune, hiện trong doctor).
- **Không có arbiter/archive → không prune.** Đĩa rẻ hơn dữ liệu. Đây là default an toàn, ghi rõ để không ai "tiện tay" thêm auto-prune.
- Event đến muộn hơn checkpoint đã prune (peer offline rất lâu): so HLC với `upto` — nếu ≤ upto và không có trong snapshot → xung đột lịch sử, quarantine + báo user (hiếm, nhưng phải có đường xử lý thay vì im lặng nuốt).

## 9. Bootstrap peer mới

1. Lấy site config + app manifest từ ZEN graph (đã ký site key).
2. Có checkpoint mới nhất → tải snapshot (Torrent/RTC), verify `stateRoot`, nạp thẳng vào SQLite, rồi subscribe log từ `upto` trở đi.
3. Không có checkpoint → subscribe log từ đầu, refold toàn bộ (chậm hơn, vẫn đúng).
4. Trong lúc bootstrap chưa xong, Data Plane trả cờ `syncing` — UI hiển thị trạng thái, không giả vờ dữ liệu đã đủ.

## 10. Những gì thiết kế này KHÔNG hứa (đọc trước khi mơ mộng)

1. **Không có cross-row transaction trong P2P mode.** Một event = một row op. Nghiệp vụ cần atomic đa-row tuyệt đối → entity `sync: authoritative` + arbiter, hoặc chạy server mode.
2. **`group` chỉ là audit, không phải atomicity.** Save một document kèm 5 child row = 6 event cùng `group`; peer khác có thể thấy 4/6 trong tích tắc trước khi đủ. Fold không chờ group đủ (chờ = treo vô hạn khi 1 event thất lạc). Cửa sổ bất nhất này là có thật và được chấp nhận công khai.
3. **Embedding/vector không đi qua log** (§4.6b ARCHITECTURE) — dữ liệu dẫn xuất, mỗi peer tự tính từ projection; fold chỉ trigger job re-embed local.
4. **Ràng buộc unique trong P2P là mềm** — phát hiện lúc fold (hai row cùng giá trị unique → flag conflict, giữ cả hai, UI bắt user xử) trừ khi entity là authoritative.
5. **Server mode thuần không cần tầng này** — một DB, không log, không fold. Nhưng server mode *tham gia site P2P* (vai trò arbiter/archive) thì chạy đúng pipeline này như mọi peer. Một codebase, hai cấu hình — không fork logic.

## 11. Điều khoản conformance SYNC-* (viết đỏ trước khi code — N6)

Phác thảo danh mục, đánh số chi tiết khi viết suite:

- **SYNC-E (event format)**: canonical form ổn định; id khớp hash; mutation bất kỳ làm vỡ id/sig; eventVersion lạ bị từ chối to tiếng; update chỉ chứa field đổi.
- **SYNC-O (ordering)**: khoá §4.1 là thứ tự toàn phần (phản xứng, bắc cầu, không hoà); HLC không lùi; tiebreak tất định.
- **SYNC-F (fold)**: create/update/delete cơ bản; LWW mức field; update-trước-create; delete rồi update-muộn-hơn; tombstone; child entity độc lập; kết quả fold validate được bằng `Model.validate`.
- **SYNC-Q (property, seeded)**: **hội tụ** — sinh N event ngẫu nhiên, giao cho k peer theo k hoán vị đến khác nhau → k projection giống nhau từng byte (điều khoản quan trọng nhất của cả tầng); idempotent khi gửi lặp; fold(events) ≡ fold(fold-từng-phần) — kết hợp được.
- **SYNC-V (verification)**: từng cổng fail đúng cách; quarantine giữ event và re-try sau migrate; field trái permlevel bị cắt; docstatus transition map đúng action.
- **SYNC-M (migration)**: event schemaVersion cũ fold qua chuỗi upgradeRow; event tương lai quarantine rồi tự hồi sau migrate; chuỗi upgrader không được thiếu bước.
- **SYNC-C (checkpoint)**: stateRoot khớp ↔ được prune; lệch → không prune + báo; event muộn hơn checkpoint xử lý đúng §8.
- **SYNC-P (permission P2P)**: bảng §6 — mỗi dòng ✅ một điều khoản enforce; dòng ⚠️/❌ một điều khoản chứng minh giới hạn (test khẳng định hành vi degrade đúng như tuyên bố, không âm thầm giả vờ enforce được).

## 12. Câu hỏi mở (chưa chốt, không chặn viết suite)

1. FK child-table trong SQLite local: `DEFERRABLE` hay enforce ở fold? (SYNC-S13 quyết.)
2. Ngưỡng gợi ý checkpoint (số event? dung lượng?) — cần số đo thật từ Phase 5.
3. Multi-arbiter (2-of-3 ký checkpoint?) — hoãn; v1 một arbiter key theo site config.
4. Nén delta của update (nhiều update nhỏ cùng author liên tiếp) — tối ưu, không đụng semantics, hoãn.

---

*Tài liệu này là con của ARCHITECTURE.md và chịu N1–N6. Event v1, khoá thứ tự §4.1, và ngữ nghĩa fold §4.2 là hợp đồng công khai sau khi suite SYNC-* xanh — từ đó trở đi chỉ tiến hoá bằng eventVersion mới.*
