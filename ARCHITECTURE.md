# Nexus — Kiến trúc

> **Nexus** là một meta-framework thuần web: định nghĩa Model bằng dữ liệu, sinh form/query/permission/API từ metadata, cho phép build app trên nó — như Frappe, nhưng cài trong một lệnh, chạy trên mọi OS, không phụ thuộc runtime nào, và được thiết kế để không bao giờ phá vỡ app chạy trên nó.

Tài liệu này là bản thiết kế nền tảng, viết **trước khi có dòng code nào**. Mọi quyết định trong đây đều được kiểm chứng bằng nghiên cứu nguồn thật (mã nguồn/tài liệu của Frappe, Strapi, Directus, NocoDB, Kysely, Knex, SQLite, ZEN) — không phải cảm tính. Chỗ nào là suy luận sẽ ghi rõ.

---

## 1. Vì sao Nexus tồn tại

### 1.1. Bài toán

Frappe là meta-framework mạnh nhất hiện nay ở tổ hợp: DocType (model định nghĩa bằng JSON), Form Builder, Report Builder, permission sâu, app system. Nhưng:

- **Cài đặt địa ngục**: `bench start` kéo theo Gunicorn + 3 instance Redis riêng + Node socketio + MariaDB ≥10.6.6 (không phải MySQL bất kỳ) + NGINX + Supervisor + wkhtmltopdf bản Qt-patched. Không có Windows native — mọi hướng dẫn đều đi qua WSL/Docker.
- **Chậm**: Python WSGI đa tiến trình, kiến trúc nhiều tầng phục vụ.
- **Khoá vào một DB**: MariaDB (Postgres hỗ trợ hạng hai).

Các đối thủ khác đều thiếu một mảnh:

| | Meta-model | Query UI sâu | Form Builder | Permission sâu | DB tuỳ chọn | Cài dễ | Local-first | Giấy phép |
|---|---|---|---|---|---|---|---|---|
| **Frappe** | ✅ DocType | ⚠️ phẳng + 1 tầng OR | ✅ | ✅ | ❌ MariaDB | ❌ | ❌ | MIT |
| **Strapi** | ✅ Content-Type | ❌ | ⚠️ | ⚠️ | ✅ Knex | ✅ | ❌ | MIT (core) |
| **Directus** | ✅ Collections | ✅ AST đệ quy | ⚠️ | ✅ Policies | ✅ Knex | ✅ | ❌ | ❌ BSL → MSCL |
| **NocoDB** | ⚠️ | ⚠️ giới hạn 5 tầng | ❌ | ⚠️ | ✅ | ✅ | ❌ | AGPL |
| **akao** | ❌ | ❌ | ❌ | ⚠️ PEN | ⚠️ SQLite WASM | ✅ | ✅ | MIT |
| **Nexus** | ✅ | ✅ vô hạn tầng | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ MIT |

**Phát hiện quan trọng từ nghiên cứu**: UI filter của Frappe core (List View / Report Builder) thực chất là danh sách phẳng `[field, operator, value]` AND với nhau, cộng đúng **một** tầng OR tuỳ chọn (`["or", [...], [...]]`) — cái "query sâu vô hạn" chỉ tồn tại ở `frappe.qb` phía server (Pypika, dev dùng trong Python) và ở Frappe Insights (sản phẩm riêng). Nghĩa là Nexus làm được UI filter lồng vô hạn tầng thì **không phải bắt kịp Frappe — mà vượt qua nó ở chính điểm nó được tiếng là mạnh nhất**.

Directus vừa rời open source (GPL → BSL 1.1 → MSCL, thu phí trên $5M revenue, cộng đồng phàn nàn enforcement). Nexus MIT là khoảng trống chiến lược.

### 1.2. Nexus là gì / không là gì

- **Là**: framework thuần (như Frappe framework), để build app trên nó.
- **Không là**: một ERP (không phải ERPNext), không là CMS đóng gói sẵn.
- **Kế thừa akao**: Web Components thuần, zero runtime dependency, isomorphic (browser + Node), offline-first, đa ngôn ngữ build-time, multi-tenant, multi-thread.
- **Giấy phép**: MIT, cam kết vĩnh viễn — đối trọng trực tiếp với Directus (BSL/MSCL) và NocoDB (AGPL).

---

## 2. Nguyên tắc thiết kế — để sống hàng trăm năm

Đây là các cam kết bất biến, học từ những phần mềm đã chứng minh tuổi thọ:

### N1. Chuẩn web trước, phát minh sau (bài học akao)
Web Components, ES Modules, Worker, OPFS, WebAuthn, WebCrypto — nền tảng duy nhất được cam kết backward-compat vô hạn bởi chính các trình duyệt. Framework JS chết theo chu kỳ 5 năm; chuẩn web chưa từng phá code cũ. Core Nexus **không dùng framework nào**.

### N2. Zero runtime dependency trong kernel (bài học SQLite)
SQLite cam kết hỗ trợ đến **2050**, và liệt kê "không phụ thuộc thư viện ngoài" là chiến lược sống còn số một ([sqlite.org/lts.html](https://sqlite.org/lts.html)). Dependency churn là nguyên nhân tử vong lớn nhất của dự án JS. Quy tắc Nexus:
- Kernel: **0** dependency ngoài. ZEN và các module kế thừa từ akao là **first-party** — cùng hệ sinh thái, tự chủ toàn bộ mã nguồn (bản thân ZEN cũng zero-dependency trong browser) — không tính là dependency ngoài.
- Data plane: các dependency được **vendor** (copy vào cây nguồn, pin version, bọc sau interface nội bộ) — hiện chỉ có Kysely (bản thân Kysely cũng 0 dependency) và driver DB do người dùng chọn. Kysely nằm **sau** ranh giới compile của Query AST: nếu 30 năm nữa Kysely chết, chỉ viết lại một module compiler, không app nào biết.

### N3. Không bao giờ phá app (bài học Linux + Go)
Linux: *"regression trong hành vi userspace-visible là bug của kernel, kể cả khi hành vi cũ là sai"*. Go 1 (2012): *chương trình viết theo spec Go 1 chạy mãi mãi; câu trả lời cho "bao giờ Go 2 phá Go 1?" là "never"*. Áp vào Nexus:
- **App API v1 là lời hứa vĩnh viễn.** App viết đúng theo App API v1 phải chạy được trên mọi bản Nexus tương lai.
- Thay đổi hành vi ship kèm **công tắc opt-out** (như GODEBUG của Go), không bao giờ thay im lặng.
- Phản ví dụ phải tránh: Strapi v4→v5 gỡ `helper-plugin` làm chết gần như toàn bộ plugin admin, đổi response shape, đổi `id` thành `documentId` — codemod chỉ vá được một phần ([tài liệu breaking changes chính thức](https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes)).

### N4. Format dữ liệu đóng băng, tiến hoá bằng version (bài học SQLite + TeX)
File format SQLite không đổi từ 2004. TeX đóng băng core từ v3.0, đẩy toàn bộ tiến hoá lên tầng trên (LaTeX). Áp vào Nexus: **ba format là hợp đồng công khai, mỗi format có số version tường minh trong file**:
1. **Model Schema format** (JSON/YAML định nghĩa Entity — bao gồm cả khối `semantic:` §4.6c và permission policy §4.3, vì chúng cùng họ format này)
2. **Query AST format** (JSON cây truy vấn)
3. **App Manifest format** (khai báo app + tương thích)

Core đọc được **mọi** version cũ mãi mãi (auto-upgrader một chiều, có test). Tính năng mới = version mới + upgrader, không bao giờ sửa nghĩa field cũ.

### N5. Core tối giản, sức mạnh ở tầng trên (bài học TeX)
Mọi thứ có thể làm ở tầng app/extension thì **không** đưa vào kernel. Kernel càng nhỏ càng ít lý do để đổi, càng ít đổi càng ít phá.

### N6. Test là đặc tả (TDD)
Spec của Nexus **là** bộ conformance test, không phải văn bản chết. Chi tiết ở §9.

---

## 3. Kiến trúc tầng

```
┌─────────────────────────────────────────────────────────────┐
│  L4 · APPS          app của bên thứ ba (schema + UI + hooks)│
│      SITES          multi-tenant: site = tổ hợp app + config│
├─────────────────────────────────────────────────────────────┤
│  L3 · STUDIO        Schema Designer · Form Builder          │
│      (Web Components) Query Builder UI · Permission Manager │
│                     List/Report View · App Manager · CLI    │
├─────────────────────────────────────────────────────────────┤
│  L2 · DATA PLANE    Model (meta-schema) · Query AST         │
│                     Permission Engine · Migration Engine    │
│                     Semantic (FTS · Vector · RRF fusion)    │
│                     Adapter: Kysely dialects + capabilities │
│                     (sqlite-wasm │ better-sqlite3 │ Turso   │
│                      │ Postgres │ MySQL/MariaDB)            │
├─────────────────────────────────────────────────────────────┤
│  L1 · KERNEL        UI engine (html/render) · States/Context│
│      (từ akao)      Threads (isomorphic) · Router · Events  │
│                     FS/OPFS/IDB · SQL worker · HMR · Test   │
│                     ZEN (identity · CRDT sync · PEN policy) │
├─────────────────────────────────────────────────────────────┤
│  L0 · PLATFORM      Web standards (browser) │ Node.js ≥18   │
└─────────────────────────────────────────────────────────────┘
```

**Quy tắc phụ thuộc**: tầng trên chỉ gọi xuống tầng dưới, qua public API của tầng đó. Không tầng nào với ngang hoặc xuyên tầng. App (L4) **chỉ** thấy L2 + L3 public API — không bao giờ thấy Kysely, dialect, hay nội bộ kernel. Đây là ranh giới giúp N3 khả thi: nội bộ đổi tự do, hợp đồng không đổi.

**Một cơ chế cho một việc (hệ quả của N5)**: kernel có đúng **một** hệ phản ứng — `States` (reactive theo key, per-component hoặc global qua `Context`) + `Events` (pub/sub). Không có hệ phản ứng thứ hai (signals tự chế, observable tự chế…) — bài học rút từ chính akao: `signals.js` được thêm vào song song với States khiến 2/31 component rẽ khỏi pattern chuẩn, tạo drift "hai cách làm một việc". `signals.js` **không** được tách vào kernel Nexus. Ngoại lệ duy nhất trong tương lai: nếu TC39 Signals thành chuẩn và ship native trong engine — khi đó dùng chuẩn platform theo N1, không bao giờ dùng bản tự chế.

---

## 4. Data Plane — trái tim của Nexus

### 4.1. Model (meta-schema, tương đương DocType)

Một **Entity** định nghĩa bằng YAML/JSON, là dữ liệu chứ không phải code:

```yaml
# apps/crm/models/customer.yaml
schemaVersion: 1
name: customer
label:
  en: Customer
  vi: Khách hàng          # i18n ngay trong schema — build-time như akao
fields:
  - name: full_name
    type: text
    required: true
  - name: tier
    type: select
    options: [bronze, silver, gold]
  - name: owner
    type: link            # quan hệ — như Link field của Frappe
    target: user
  - name: contacts
    type: table           # child table — như Frappe, compile ra bảng con + FK
    target: customer_contact
indexes:
  - fields: [tier, owner]
permissions: ...           # xem §4.3
```

Nguyên tắc:
- **Schema là hợp đồng versioned** (N4). Field types là tập đóng, được định nghĩa trong spec kèm mapping sang từng dialect SQL — thêm type mới cần version mới.
- Quan hệ/child-table compile ra **bảng phẳng + khoá ngoại thường** trên mọi engine (bài học Strapi: không có gì engine-specific trong schema thì mới đa engine thật).
- **Customize không fork** (bài học hay nhất của Frappe): app khác hoặc site có thể thêm `CustomField` và `PropertyOverride` (tương đương Custom Field + Property Setter của Frappe) — lưu tách khỏi schema gốc của app, merge lúc runtime. App gốc update không đè mất customization.
- **File/media**: field type `file` — metadata (tên, hash, MIME, size) nằm trong DB như field thường (query/permission như mọi field), nội dung nhị phân đi qua **FS abstraction của kernel** (OPFS browser / disk server), có sẵn đường P2P transfer qua RTC/Torrent của akao. Chi tiết storage backend (S3...) là adapter đời sau, không vào core v1.

### 4.2. Query AST — universal, một cấu trúc dùng mọi nơi

Cấu trúc đã được kiểm chứng bởi Directus (không giới hạn độ sâu) và NocoDB (giới hạn 5 tầng chỉ vì UX, không phải kỹ thuật):

```jsonc
// astVersion: 1
{
  "op": "and",                        // node logic: "and" | "or" | "not"
  "children": [
    { "field": "tier", "operator": "in", "value": ["gold", "silver"] },
    {
      "op": "or",
      "children": [
        { "field": "owner", "operator": "eq", "value": "$CURRENT_USER" },
        {
          "op": "and",
          "children": [
            { "field": "created_at", "operator": "gte", "value": "$NOW(-30d)" },
            { "field": "contacts.email", "operator": "like", "value": "%@corp.com" }
          ]
        }
      ]
    }
  ]
}
```

**Bất biến của AST** (invariant — có property-based test bảo vệ):
1. Node là **logic** (`op` + `children`, lồng nhau vô hạn) hoặc **leaf** (`field` + `operator` + `value`) — không bao giờ lai (quy tắc Directus đã chứng minh sạch).
2. Tập `operator` là tập đóng, versioned theo `astVersion`.
3. Biến động (`$CURRENT_USER`, `$NOW`, `$CURRENT_ROLES`...) resolve **trước** khi compile — compiler chỉ thấy giá trị tĩnh.
4. `field` có thể xuyên quan hệ (`contacts.email`) — compiler tự sinh join; độ sâu path do spec giới hạn (mặc định 3, config được).

**Một AST — bốn bộ compile** (đây là điểm hợp nhất kiến trúc quan trọng nhất):

| Target | Dùng cho | Cơ chế |
|---|---|---|
| **Kysely expression** | Query server + local | Đệ quy `eb.and([...])` / `eb.or([...])` — Kysely tự sinh SQL đúng dialect. Không bao giờ tự nối chuỗi SQL. |
| **Permission injection** | Row-level security | Permission rule cũng là AST → AND vào AST của mọi query (mô hình `db_query.py` của Frappe, nhưng tường minh) |
| **PEN bytecode** | Enforce write P2P | Compile rule sang policy VM của ZEN — peer verify không cần tin nhau |
| **JS predicate** | Validation client-side, filter dữ liệu in-memory, hiển thị lại trên UI | Interpreter thuần JS, zero-dep |

**Vì sao Kysely chứ không Knex** (đã kiểm chứng): Knex gắn chặt driver Node — chạy trên SQLite WASM trong browser là issue cộng đồng mở nhiều năm chưa ai làm được (knex#799, knex#5592). Kysely tách "sinh SQL" khỏi "thực thi" bằng dialect như extension point chính thức; đã có thư viện thật chạy Kysely trên `sql.js`/`wa-sqlite`/`@sqlite.org/sqlite-wasm` (SQLocal, kysely-sqlite-tools). Turso tương thích SQLite ở mức SQL dialect nên đi qua chính họ dialect SQLite của Kysely, chỉ đổi driver (`@tursodatabase/database`). Kysely 0 dependency — vendor được theo N2.

### 4.3. Permission Engine

Học hình dạng từ Frappe + mô hình policy của Directus v11, hợp nhất trên AST:

- **Policy** = đơn vị cấp quyền, gắn được vào role **hoặc** user trực tiếp (Directus v11), **cộng dồn** (union — nhiều policy thì OR các rule).
- Mỗi policy khai báo trên một Entity: các quyền `read / write / create / delete / submit / cancel / amend` (giữ vòng đời document của Frappe vì nó đã đúng cho nghiệp vụ).
- **Row-level**: rule của policy là một Query AST (§4.2) — *cùng cú pháp, cùng UI builder, cùng compiler* với filter thường. Directus đã xác nhận cách này chạy tốt trong sản xuất ("filters are used in permissions, validations, and automations").
- **Field-level**: mỗi field có `permlevel` (0–9, như Frappe) — policy cấp quyền theo permlevel; UI tự ẩn/khoá field, server tự cắt field khỏi SELECT/UPDATE.
- **if_owner** + **document sharing** (cấp quyền ad-hoc từng bản ghi) — giữ từ Frappe.
- **Enforce hai điểm**: (a) chèn AST vào mọi query SQL (server + local); (b) compile sang PEN cho write đi qua đồng bộ P2P — không có đường nào ghi dữ liệu mà không qua một trong hai cổng.

### 4.4. Migration Engine — hybrid (đã chốt)

Phản ví dụ cần tránh (đều có tài liệu): Strapi **cấm** sửa content-type ở production (phải sửa ở dev rồi redeploy — issue #4798, #2072); `strapi import` **xoá toàn bộ dữ liệu** trước khi restore. Frappe thì ngược lại — hot-sync mọi thứ theo hash, structural change áp im lặng không có bước xác nhận.

Nexus đi giữa:

| Loại thay đổi | Cơ chế | Ví dụ |
|---|---|---|
| **Additive an toàn** | Hot DDL ngay tại runtime, qua UI Studio | Thêm field nullable, thêm index, đổi label/help/UI-only property |
| **Structural** | Bắt buộc qua migration file versioned + dry-run + xác nhận | Đổi kiểu field, đổi tên bảng/cột, xoá field, đổi quan hệ |

- Migration file sinh tự động từ diff schema, người dùng review được trước khi áp (như bạn review một PR).
- **Patch ledger** (bài học `patches.txt` của Frappe): mỗi migration/data-patch được ghi sổ đã-chạy trong DB, không bao giờ chạy lại, replay được trên instance mới.
- **Dry-run bắt buộc + rollback**: structural migration chạy thử trong transaction/bản sao trước, báo cáo tác động (mất dữ liệu? bao nhiêu row ảnh hưởng?), rồi mới áp thật.
- Chính **core update của Nexus cũng đi qua đúng cơ chế này** — không có đường tắt riêng cho core (N3).
- **Export/import round-trip là hợp đồng**: dump một site (schema + data + customization + patch ledger) rồi import vào instance mới phải cho ra hệ tương đương, **không bao giờ xoá dữ liệu có sẵn để nhường chỗ** (phản ví dụ: `strapi import` xoá toàn bộ dữ liệu đích). Có conformance test round-trip riêng.

### 4.5. Adapter & đa engine ngang hàng (đã chốt)

- Engine hỗ trợ từ v1, ngang hàng: **SQLite** (better-sqlite3 server / `@sqlite.org/sqlite-wasm` browser), **Turso Database** (`@tursodatabase/database` — rewrite SQLite từ đầu bằng Rust, async-native, MVCC concurrent writes; hướng tương lai của họ SQLite), **PostgreSQL**, **MySQL/MariaDB**.
- **Ghi chú Turso** (đã kiểm chứng từ README chính thức): chưa 1.0 — "under active development" — nhưng đã chạy production ở nhiều tổ chức. Tương thích SQLite ở **cả ba mức: SQL dialect, file format, C API** (chưa 100%, full compat là điều kiện bắt buộc cho 1.0). Chính tương thích file format là van an toàn của quyết định này: **đường lùi về SQLite thuần luôn mở, cùng file DB, không mất dữ liệu** — chỉ đổi driver sau ranh giới dialect, không app nào biết. Local mode v1 vẫn dùng `@sqlite.org/sqlite-wasm` (đã chạy production trong akao); bản browser của Turso (WASM + OPFS + SharedArrayBuffer) là ứng viên thay thế khi chín — cũng đổi không chạm app.
- **Conformance matrix**: mọi tính năng data plane phải pass cùng bộ test trên **cả 4 engine × 2 runtime**. Tính năng không đồng nhất được (đã biết: filter trên JSON field — mỗi engine một kiểu, không chuẩn SQL) thì hoặc có shim theo dialect, hoặc bị loại khỏi core và đánh dấu engine-specific extension. **Không bao giờ** âm thầm khác hành vi giữa engine.

### 4.6. Tầng ngữ nghĩa — Nexus phải *hiểu* dữ liệu, không chỉ ghi chép

Mục tiêu: mọi Entity đều tìm được theo **nghĩa** (semantic/vector), theo **chữ** (full-text/BM25), và **lai** cả hai — với permission enforce y hệt query thường. Không framework meta-model nào hiện có mảnh này ở dạng local-first (NocoDB phải glue webhook + n8n + OpenAI; Directus chưa có; chỉ SurrealDB có provider layer nhưng không phải meta-framework) — đây là khoảng trống định vị thứ hai của Nexus sau MIT license.

**a) Vector & FTS là *adapter capability*, không phải core SQL** (cùng phận với JSON filtering — không chuẩn SQL, mỗi engine một kiểu):

| Engine | Vector | FTS | Ghi chú |
|---|---|---|---|
| SQLite (server + WASM) | **sqlite-vec** (C thuần, zero-dep, chạy được trong WASM) | FTS5 + `bm25()` native | Cần **custom build sqlite-wasm** compile kèm cả FTS5 lẫn sqlite-vec (bundle mặc định không có cả hai — một build giải quyết cả hai). sqlite-vec từng có giai đoạn ngưng bảo trì (có fork cộng đồng vì "tác giả vắng mặt") — đã hồi lại (v0.1.9, 3/2026, sponsor Mozilla/Turso) nhưng phải theo dõi; ANN của nó còn mới, coi brute-force là baseline. |
| Turso | **Vector native trong core**: exact search đã có; **ANN index còn trên roadmap** | FTS **experimental** (tantivy — không phải FTS5) | Vector exact dùng được ngay (đủ cho corpus vừa); ANN + FTS coi là capability "đang chín" — chỉ bật trong ma trận khi pass conformance suite, không hứa trước. |
| Postgres | **pgvector** — chuẩn production, HNSW/IVFFlat | tsvector/tsquery (ts_rank, không phải BM25 thật) | pgvector 0.8.0 có iterative index scan — quan trọng vì Nexus **luôn** kèm permission-AST filter vào vector search (bài toán overfiltering). |
| MySQL / MariaDB | ⚠️ **Bẫy**: MySQL 9 Community có VECTOR *type* nhưng **không có index, thậm chí không có hàm DISTANCE** (phải mua HeatWave). **MariaDB 11.8 LTS** mới có VECTOR INDEX thật (HNSW-variant, benchmark thắng pgvector về QPS) | FULLTEXT (mô hình relevance yếu) | Tier semantic của "MySQL" thực chất = **MariaDB ≥11.8**. Ghi rõ trong ma trận capability, không hứa mờ. |

Conformance test cho semantic chỉ khẳng định được **hình dạng hợp đồng + đúng đắn exact-KNN** — không thể đòi ranking ANN giống hệt nhau giữa engine (mỗi ANN một trade-off recall). Đây là ngoại lệ có chủ đích của quy tắc "không âm thầm khác hành vi": khác biệt ranking được **tuyên bố** trong spec.

**b) Embedding = provider layer cắm được, mặc định local-first.** Sinh embedding cần model — Transformers.js + ONNX Runtime là dependency nặng, **cấm vào kernel** (N2); nó sống ở một provider package tuỳ chọn, chạy trong **Threads** (WebGPU trên browser — ~70% coverage, fallback WASM; Node cùng codebase). Ứng viên mặc định: **EmbeddingGemma** (308M, 100+ ngôn ngữ, <200MB RAM quantized — khớp bản sắc đa ngôn ngữ của Nexus) hoặc multilingual-e5-small cho máy yếu. Provider API (Voyage/OpenAI/Google...) là lựa chọn thay thế cùng interface. Embedding là **dữ liệu dẫn xuất**: cột vector gắn tag `model+version`, peer tự tính lại được từ dữ liệu gốc — **không sync vector qua ZEN**, chỉ sync dữ liệu nguồn; đổi model = job re-index.

**c) Schema-aware serialization — lợi thế độc quyền của meta-model.** Vì Nexus *biết* schema, việc "biến một row thành văn bản để embed" là **metadata khai báo trong Entity schema**, không phải code:

```yaml
semantic:
  embed:
    - field: full_name
      weight: 2
    - field: contacts.email
  template:                    # per-locale — dùng chính label i18n của schema
    vi: "Khách hàng {full_name}, hạng {tier}"
    en: "Customer {full_name}, tier {tier}"
  reindex: on_update           # trigger job trong Threads, async
```

Không tool nào hiện có spec serialization schema-aware kiểu này (NocoDB/SurrealDB đều hard-code hoặc glue tay) — với Nexus nó chỉ là thêm một khối YAML vào format đã versioned.

**d) Hybrid search: RRF trong core.** Reciprocal Rank Fusion (`score = Σ 1/(60 + rank)`, chuẩn Cormack 2009) chạy ở tầng ứng dụng trên hai danh sách ranked — thuần JS, không đụng engine, nên **fusion nằm trong core** dù FTS/vector là adapter capability. Điểm quan trọng: RRF chỉ dùng rank, không dùng score — né hẳn bài toán chuẩn hoá điểm BM25 vs cosine.

**e) Semantic không phá bất biến của Query AST.** Semantic là **nguồn xếp hạng**, không phải predicate boolean — không thêm operator "semantic" vào AST (giữ AST boolean-pure, N4). API tách bạch: `search(entity, { query: "...", filter: <AST>, mode: text|vector|hybrid, k })` — AST lọc ứng viên (kèm permission như mọi khi), semantic xếp hạng phần còn lại. Permission đi trước ranking: kết quả không bao giờ chứa row mà query thường không được thấy, và **vector index nằm trong cùng DB per-site** (embedding cũng lộ nội dung như dữ liệu gốc — không có đường rò rỉ qua index dùng chung).

**f) Xa hơn — "biết" dữ liệu.** Vì Query AST là spec đóng và schema là dữ liệu, tầng sau này (app chính chủ, không phải kernel — N5) có thể dịch **ngôn ngữ tự nhiên → Query AST**: LLM provider sinh AST, validate theo schema, thực thi qua đúng pipeline permission. Người dùng hỏi "khách hàng vàng nào 30 ngày chưa tương tác?" → một AST kiểm chứng được, không phải một câu SQL sinh mù. RAG trên dữ liệu có cấu trúc cũng đi cùng đường: retrieval = hybrid search §4.6d, context = row serialize theo template §4.6c. Đây là đích "hệ thống hiểu và biết dữ liệu" — nhưng nó là **tầng trên của một nền đã đúng**, không phải thứ nhét vào kernel.

---

## 5. Dual runtime — một schema, hai thế giới (đã chốt)

```
                    ┌──────────── App (schema + UI + hooks) ────────────┐
                    │        chỉ nói chuyện với Data Plane API           │
                    └────────────────────┬───────────────────────────────┘
                                         │  cùng một Model + Query AST
              ┌──────────────────────────┴──────────────────────────┐
              ▼                                                     ▼
   SERVER MODE (như Frappe/Strapi)                    LOCAL MODE (như akao)
   Node.js ≥18, một process duy nhất                  100% trong browser
   Kysely → better-sqlite3/turso/pg/mysql             Kysely → sqlite-wasm + OPFS
   HTTPS tự cấp (mô hình dev.js/prod.js akao —        (SQL worker sẵn có của akao)
   không NGINX, không Redis, không Supervisor)        ZEN sync P2P giữa các peer
```

- **Cài đặt = một lệnh** trên mọi OS có Node ≥18 (kể cả Windows native — akao đã kiểm tra `process.platform === "win32"`). Đây là đòn trực diện vào điểm yếu nhất của Frappe.
- **HTTP API tự sinh từ schema** (ngang hàng Frappe/Strapi/Directus): server mode tự expose CRUD + `search()` + một endpoint nhận **Query AST** cho mọi Entity, permission enforce sẵn ở Data Plane nên transport không có logic riêng. Hợp đồng API thuộc App API v1 (chịu N3, versioned trong URL). App nội bộ và client ngoài (mobile, integration) dùng **cùng một hợp đồng** — không có API "nội bộ nhanh hơn". Realtime subscription đi qua ZEN (thay socketio + Redis của Frappe).
- **Trust boundary phải nói thẳng**: local mode không có trọng tài — DB nằm trong máy user. Permission ở local mode chỉ có nghĩa với dữ liệu cá nhân; dữ liệu multi-party cần điểm authoritative: hoặc một server mode instance, hoặc enforce bằng PEN tại điểm nhận write P2P (§6).
- Job nền, cache, socket — dùng **Threads** isomorphic của akao (Web Worker/browser, worker_threads/Node) thay cho 3 instance Redis + worker process riêng của Frappe.

### 5.1. Super-peer — có server nhưng không lệ thuộc server

Giữa hai cực "server-first" (Frappe/Strapi — mất server là chết) và "P2P thuần" (khó làm multi-party data + tìm kiếm nặng), Nexus chọn topo **hybrid có nguyên tắc**: super-peer là một Nexus instance server-mode gánh thêm **vai trò**, và mọi vai trò đều là *tăng tốc/trọng tài* chứ không phải *điều kiện sống*.

**Nền có sẵn trong ZEN**: peer đối xứng về giao thức (node nào cũng relay được), relay chạy systemd service, tự khám phá (STUN → quét index domain → PEX), AXE/MOB redirect khi quá tải, RTT-aware pruning. Nghĩa là tầng *mạng* đã hybrid sẵn — thiết kế Nexus chỉ cần định nghĩa **vai trò tầng dữ liệu** của super-peer:

| Vai trò | Nội dung | Khi vắng super-peer |
|---|---|---|
| **relay** | Chuyển tiếp sync ZEN, signaling WebRTC | Peer bắt cặp trực tiếp (PEX/QR/manual) — chậm hơn, vẫn chạy |
| **arbiter** | Điểm authoritative cho dữ liệu multi-party của một site (giải quyết trust boundary §5) | Dữ liệu cá nhân không cần; multi-party rơi về hội tụ CRDT + PEN — chấp nhận được với app không tranh chấp |
| **archive** | Bản sao always-on để peer offline lâu ngày hội tụ lại | Hội tụ khi các peer cùng online |
| **indexer** | ANN index tập trung cho corpus lớn, re-index embedding | Local brute-force vector trên dữ liệu cục bộ (sqlite-vec) — đủ cho vài chục nghìn row |
| **embedder** | Sinh embedding hộ thiết bị yếu (điện thoại cũ không WebGPU) | Model nhỏ hơn chạy WASM local, hoặc bỏ qua semantic |

**Nguyên tắc ràng buộc:**
1. **Capability negotiation**: peer quảng bá vai trò của mình qua ZEN graph (ký bằng key của site); client khám phá và dùng cái gì có, **degrade từng nấc** khi thiếu — không có chế độ "offline = lỗi".
2. **Super-peer không thể giả mạo**: mọi write vẫn ký bằng key user, PEN verify tại mọi điểm nhận — super-peer chỉ *sắp thứ tự, lưu trữ, phục vụ*, không tạo được dữ liệu thay ai. Quyền arbiter được **khai báo trong site config đã ký** — không tự phong.
3. **Đường thăng cấp phẳng**: một peer local-mode "trở thành" super-peer chỉ bằng bật server-mode + bật vai trò — cùng codebase (dual runtime §5 bảo đảm điều này bằng thiết kế, không phải lời hứa).
4. Một site có thể có **nhiều** super-peer (vai trò tách được — máy này relay, máy kia indexer), tránh single point of failure ngay trong chính tầng "server".

### 5.2. CLI — đẹp như Strapi, mạnh như bench, và không phản bội kernel

`nexus` là bộ mặt vận hành của framework. Chuẩn tham chiếu kép: **độ bóng DX của Strapi CLI** (interactive, màu sắc, scaffold một lệnh) + **độ phủ vận hành của Frappe bench** (site, app, migrate, update, doctor) — nhưng không kế thừa khuyết tật của cả hai.

**Bốn nguyên tắc ràng buộc:**
1. **CLI là shell mỏng trên public API** — cùng Data Plane/App API mà HTTP và Studio dùng, không có "đường riêng vào nội bộ". CLI vì thế không bao giờ lệch hành vi so với API, và chính nó là contract test sống cho public API (dogfooding, N3/N5).
2. **Zero-dependency như kernel** — không commander/chalk/inquirer; ANSI, spinner, prompt tự viết (Test.js của akao đã tự làm colored output — cùng DNA). Bench nặng nề vì kéo cả hệ sinh thái Python; `nexus` không lặp lại điều đó.
3. **Đẹp có kỷ luật** — TTY: interactive + màu + bảng; không TTY (CI): plain text, mọi input qua flags, và **mọi lệnh có `--json`** với output shape là hợp đồng versioned (thuộc App API v1, chịu N3).
4. **An toàn mặc định** — lệnh có khả năng phá hủy (`migrate`, `update`, `restore`) mặc định chạy **preview/dry-run**, chỉ `--apply`/`--yes` mới chạy thật. CLI không được phép đi tắt qua Migration Engine §4.4.

**Bảng lệnh v1:**

| Lệnh | Việc | Tương đương (và khác gì) |
|---|---|---|
| `npx nexus create <dir>` | scaffold instance mới, interactive | `create-strapi-app` / `bench init` — nhưng xong trong một lệnh, mọi OS |
| `nexus dev` | dev server + HMR | `strapi develop` / `bench start` |
| `nexus start` | production, HTTPS tự cấp | `bench setup production` — không NGINX/Supervisor/Redis |
| `nexus site new\|list\|backup\|restore` | multi-tenant sites | `bench new-site`; backup/restore theo hợp đồng round-trip §4.4 — **không bao giờ xoá dữ liệu đích** (phản–`strapi import`) |
| `nexus app new\|install\|remove\|list` | vòng đời app | `bench new-app` / `install-app` |
| `nexus migrate [--apply]` | preview diff schema → áp migration | `bench migrate` — nhưng dry-run là mặc định, không phải tuỳ chọn |
| `nexus update [--apply]` | update core qua Migration Engine, báo tác động từng app đã cài | `bench update` — nhưng có dry-run + rollback (§8.4.5) |
| `nexus test [filter]` | chạy conformance/test suite | `bench run-tests` |
| `nexus doctor` | chẩn đoán môi trường, site, engine | `bench doctor` |

App có thể đăng ký subcommand riêng qua extension point `commands` (§8.3) — sức mạnh "custom bench commands" của Frappe, nhưng qua hợp đồng versioned. CLI có conformance suite riêng (CLI-* clauses) khi implement: output `--json` và exit codes là spec, không phải chi tiết.

---

## 6. Vai trò của ZEN (đã chốt ở phiên thảo luận trước)

ZEN **không** phải một engine SQL và không bao giờ đứng trong danh sách engine của §4.5. Phân vai:

| Việc | Ai làm |
|---|---|
| Query/filter/report cấu trúc, AND/OR lồng sâu | Tầng SQL qua Kysely — **luôn luôn** |
| Định danh user (thay username/password) | ZEN keypair, derive từ WebAuthn passkey (deterministic, không seed phrase — cơ chế akao có sẵn) |
| Đồng bộ multi-device/multi-peer không server | ZEN HAM CRDT làm **event log đã ký**; SQLite local là **projection** replay từ log |
| Enforce permission tại write P2P | PEN (policy VM WASM) — compile từ cùng permission AST |
| Site config, app manifest, registry đa instance | ZEN graph (dữ liệu nhỏ, replicate rộng — đúng sở trường graph) |

Mô hình event-log-→-projection (giống ElectricSQL/PowerSync): ghi = commit optimistic vào SQLite local **và** append event ký vào ZEN; peer nhận → verify chữ ký + PEN → replay vào SQLite của nó qua đúng đường Model/permission. Xung đột hội tụ bằng HAM ở tầng log; tầng SQL không bao giờ thấy xung đột, chỉ thấy kết quả replay.

---

## 7. Studio (L3) — bộ builder UI

Toàn bộ là Web Components trên UI engine của akao (`html`/`render`, Shadow DOM, States):

- **`<nx-query-builder>`** — điểm khác biệt số một của Nexus. Component **đệ quy**: một group render các condition-row và các group con (chính nó) — độ sâu vô hạn tự nhiên theo cấu trúc component, đúng cách NocoDB làm (component Vue đệ quy) nhưng không giới hạn 5 tầng. Đọc/ghi trực tiếp Query AST §4.2. Cùng component này tái dùng ở: filter list view, report builder, **permission rule editor**, validation rule editor — một UI, học một lần, dùng mọi nơi.
- **`<nx-form-builder>`** — kéo-thả field, section, column, tab; output là chính Model schema YAML (form layout là thuộc tính của schema, như Frappe Form Builder v15). Form runtime render từ schema — không sinh code.
- **`<nx-schema-designer>`** — tạo/sửa Entity trực quan; thay đổi được phân loại tự động additive/structural theo §4.4.
- **`<nx-permission-manager>`** — ma trận role × entity × quyền như Frappe Role Permission Manager, nhúng `<nx-query-builder>` cho row-level rule.
- **`<nx-list-view>` / `<nx-report>`** — group-by, aggregate, sort, saved views; export.
- **`<nx-search>`** — ô tìm kiếm toàn cục: hybrid search (§4.6) trên mọi Entity user có quyền đọc, kết quả nhóm theo Entity, filter thêm bằng `<nx-query-builder>`.
- Studio cũng chỉ là **một app đặc quyền** chạy trên App API — nếu Studio làm được thì app bên thứ ba cũng làm được (dogfooding, N5).

---

## 8. App system & multi-tenant

### 8.1. App

```
apps/crm/
├── manifest.yaml        # name, version, manifestVersion, engines (dải core tương thích)
├── models/*.yaml        # Entity schemas
├── permissions/*.yaml   # policies mặc định
├── components/          # Web Components riêng của app
├── hooks.js             # đăng ký vào extension points (§8.3)
├── i18n/*.yaml          # dịch — cùng format akao (mỗi key một file, per-locale build)
└── migrations/          # structural migrations + data patches
```

### 8.2. Site (multi-tenant — kế thừa akao)

Một instance Nexus phục vụ nhiều site; mỗi site = danh sách app + config + theme + locale + **DB riêng** (isolation thật, không row-level tenancy). Map domain → site như `domains.yaml` của akao.

### 8.3. Extension points (học phân loại của Directus, giữ tối giản)

Server-side: `hooks` (trước/sau CRUD từng Entity, schedule, lifecycle) · `endpoints` (route API mới) · `jobs` (chạy trong Threads) · `commands` (subcommand CLI, §5.2).
Client-side: `interfaces` (widget nhập liệu cho field type) · `displays` (render giá trị) · `views` (layout list mới) · `pages` (màn hình mới).

Tất cả extension point là **hợp đồng versioned thuộc App API v1** — chịu N3.

### 8.4. Chính sách update-không-phá (trả lời trực tiếp yêu cầu "update không làm hỏng instance/app")

1. **Public API được liệt kê tường minh** — một file `API.md` + bộ test hợp đồng. Cái gì không có trong đó là nội bộ, đổi tự do. (Nguyên nhân WordPress/Frappe hay gãy: plugin thò tay vào nội bộ vì ranh giới không tồn tại.)
2. **Semver kỷ luật**: patch/minor tự update an toàn; major yêu cầu thao tác chủ động + migration guide. App khai `engines: nexus >=1 <3` trong manifest — core từ chối load app ngoài dải, thay vì load rồi crash.
3. **Deprecation window**: API bị thay giữ chạy song song ≥ 2 major version, có warning, có ngày gỡ công bố trước.
4. **Behavior switch** (mô hình GODEBUG của Go): sửa hành vi cũ-nhưng-sai → hành vi mới là default, hành vi cũ giữ được bằng config per-site, tối thiểu 2 năm.
5. **Update = migration**: core update đi qua đúng Migration Engine §4.4 — dry-run, báo cáo tác động lên từng app đã cài, rollback được.
6. **Conformance test theo version**: CI chạy bộ app mẫu (và app thật của cộng đồng, opt-in) trên ma trận core version trước mỗi release — breaking change bị phát hiện trước khi user gặp.

---

## 9. Chiến lược TDD

Test không phải việc làm sau — **spec của Nexus được viết dưới dạng test trước khi viết module**. Nền: `Test.js` của akao (runner zero-dep, chạy cả Node lẫn browser, đã có 632 test passing ở ZEN và bộ test build-first ở akao).

### 9.1. Kim tự tháp

| Tầng | Nội dung | Công cụ |
|---|---|---|
| **Spec/conformance** | Query AST spec, Model spec, Permission semantics — mỗi điều khoản spec = một test case, đánh số, bất biến theo version | Test.js |
| **Property-based** | Sinh AST ngẫu nhiên hợp lệ → compile 4 target → bất biến phải giữ (ví dụ: kết quả SQL filter ≡ kết quả JS predicate trên cùng dataset; permission-inject không bao giờ nới rộng tập kết quả) | Test.js + generator tự viết |
| **Golden/snapshot** | AST → SQL từng dialect: snapshot có review, đổi SQL sinh ra = phải giải thích trong PR | Test.js |
| **Matrix integration** | Toàn bộ suite data plane × 4 engine × 2 runtime | CI |
| **E2E** | Boot runtime thật (mô hình test-first-build-artifacts của akao: test chạy trên `build/`, không trên source), route `/test` trong browser, Playwright | akao pipeline sẵn có |
| **Contract** | App API: bộ app mẫu chạy trên ma trận core version (§8.4.6) | CI |

### 9.2. Chuẩn mực

- Data plane (L2) nhắm **branch coverage tiệm cận 100%** — noi SQLite, vì đây là phần phải sống trăm năm và là nơi mất dữ liệu nếu sai.
- Mỗi bug tìm thấy = một test tái hiện được thêm vĩnh viễn trước khi fix.
- Test là tài liệu: đọc conformance suite phải hiểu được spec mà không cần đọc văn bản.

### 9.3. Trình tự phát triển (spec-first)

Mỗi milestone bắt đầu bằng viết **spec test đỏ** cho hợp đồng của milestone đó, rồi mới implement cho xanh. Không có tính năng nào tồn tại nếu không có test định nghĩa nó.

---

## 10. Những gì Nexus lấy từ ai — tóm tắt

| Nguồn | Lấy | Tránh |
|---|---|---|
| **akao** | Web Components + UI engine, zero-dep, Threads isomorphic, offline-first (SQLite WASM + OPFS worker), i18n build-time per-locale, multi-tenant sites, HMR, Test.js, dev/prod server tự cấp HTTPS, WebAuthn→keypair | (akao là nền, không phải đối tượng tránh) |
| **Frappe** | DocType→Entity meta-model, vòng đời document (submit/cancel/amend), permlevel + if_owner + sharing, Customize-không-fork (Custom Field/Property Setter), patch ledger, Form Builder UX | bench + chuỗi dependency cài đặt, hot-sync structural im lặng, không ranh giới public/private API |
| **Strapi** | DB tuỳ chọn qua query-builder dialect, schema-as-file trong app source | cấm sửa schema ở production, import xoá dữ liệu, major version phá plugin |
| **Directus** | Một AST cho query + permission + validation, policy cộng dồn (v11), phân loại extension point | rời open source (BSL/MSCL) — Nexus cam kết MIT; Flows khó debug |
| **NocoDB** | Xác nhận filter-group đệ quy làm được bằng component đệ quy | giới hạn 5 tầng; semantic search phải glue webhook+n8n+OpenAI ngoài hệ thống |
| **SurrealDB** | Mô hình embedding-provider layer cắm được | (tham chiếu, không phải meta-framework) |
| **SQLite / Linux / TeX / Go** | Toàn bộ §2 (N2, N3, N4, N5) | — |

---

## 11. Rủi ro & câu hỏi mở

1. **JSON-field filtering đa engine** — không chuẩn SQL, mỗi engine một kiểu. Kế hoạch: shim theo dialect hoặc loại khỏi core v1. Quyết định khi viết conformance test.
2. **Tương đương ngữ nghĩa permission SQL vs PEN** — hai compiler từ một AST phải cho cùng kết quả cho phép/từ chối. Cần property-based test bắc cầu hai target. Đây là phần rủi ro kỹ thuật cao nhất.
3. **CRDT log → SQL projection** — thứ tự replay, schema migration trên log cũ, compaction log. **Đã có thiết kế: [docs/sync-design.md](docs/sync-design.md)** — event bất biến content-addressed + HLC total order + refold mức row (hội tụ theo cấu trúc), 4 cổng xác minh + quarantine, upgradeRow chain cho log cũ, checkpoint ký bởi arbiter (không arbiter = không prune), và ranh giới trung thực của permission P2P (`sync: crdt` vs `sync: authoritative` per entity). Code chỉ bắt đầu sau khi suite SYNC-* (§11 của tài liệu đó) viết xong và đỏ.
4. **Kysely vendor** — vendor thì phải theo được security fix upstream. Kế hoạch: script sync có kiểm tra diff, pin theo tag.
5. **Turso Database chưa 1.0** — giờ là engine ngang hàng trong ma trận (quyết định đã chốt), nên rủi ro phải quản trị chứ không né: tương thích SQLite chưa 100% (COMPAT.md của họ), vector-ANN còn trên roadmap, FTS còn experimental (tantivy). Van an toàn: tương thích file format = đường lùi về SQLite thuần không mất dữ liệu; pin version; conformance matrix chạy Turso ngang hàng sẽ bắt mọi lệch chuẩn trước khi user gặp; capability semantic của nó chỉ bật khi pass suite (§4.6a).
6. **Độ sâu path xuyên quan hệ trong AST** (`a.b.c.d...`) — mỗi tầng là một join; cần giới hạn + đo hiệu năng thực trước khi chốt default.
7. **Phạm vi v1 của Studio** — Form Builder + Query Builder + Permission Manager là lõi; Report nâng cao (pivot, chart) có thể là app chính chủ đời sau, không nhét vào core (N5).
8. **Custom sqlite-wasm build** (FTS5 + sqlite-vec) — Nexus phải tự maintain một bản build WASM thay vì dùng bundle chính chủ. Cần script build tái lập được + test integrity; theo dõi sát maintenance của sqlite-vec (đã từng stall một lần).
9. **Ranking ANN không đồng nhất giữa engine** — ngoại lệ được tuyên bố của quy tắc conformance (§4.6a); spec phải nói rõ user được hứa gì (top-K đúng theo exact-KNN trong test, ANN là xấp xỉ theo engine).
10. **Embedding model lifecycle** — model có đời (deprecate, license đổi); cột vector tag model+version và tái sinh được từ dữ liệu gốc là bắt buộc (đã thiết kế §4.6b), nhưng chi phí re-index corpus lớn trên thiết bị yếu cần đo thật; vai trò `indexer`/`embedder` của super-peer (§5.1) là van xả.
11. **AuthN cho HTTP API** — identity là ZEN keypair (không password), vậy external client xác thực bằng gì: signed request? token ngắn hạn phát từ chữ ký? Cần spec riêng trước Phase 4, phải cover cả client không giữ key (API key per-integration do site cấp).

---

## 12. Lộ trình — trạng thái

Toàn bộ 6 phase lõi đã hoàn thành, giữ đúng kỷ luật spec-first (test đỏ trước, code sau) từ đầu đến cuối. Tổng: **430 điều khoản conformance, 0 đỏ** — 385 chạy trong Node, 45 chạy trong Chromium thật (45 điều khoản browser này hiển thị "browser-skipped" khi chạy Node, nên tổng riêng biệt là 430, không cộng dồn).

- ✅ **Phase 0 — Spec**: conformance suite Query AST v1 (83) + Model Schema v1 (54) + Permission v1 (31), tất cả viết đỏ trước. docs/sync-design.md + docs/authn-design.md.
- ✅ **Phase 1 — Kernel**: tách từ akao vào `src/kernel/` — UI engine (html/render/css/Component), States/Context, Threads (isomorphic, worker thật), Router, Events, FS (format registry)/OPFS/IDB, SQL worker, HMR, Test. Một hệ phản ứng duy nhất (§3). Browser runner qua CDP. CLI skeleton `create/dev/test`.
- ✅ **Phase 2 — Data plane**: Kysely vendored (ranh giới enforce tĩnh) → AST→Kysely compiler (**bất biến vàng: SQL ≡ JS predicate từng row** trên engine thật) → Model→DDL → Migration Engine (hybrid, dry-run mặc định, renames, ledger) → Data Plane CRUD (permission hai ảnh, không rò tồn tại) → HTTP API tự sinh → engine adapters (sqlite built-in + turso/pg/mysql resolve động).
- ✅ **Phase 3 — Studio**: `<nx-query-builder>` đệ quy (lồng vô hạn, fuzz), Form Builder + nx-form, Schema Designer (Model.diff sống → migration), Permission Manager (**lần tái dùng đầu tiên** của query-builder), List View. Index page dev = mini-Studio sống.
- ✅ **Phase 4 — App system**: App Manifest v1 (format N4 thứ ba, engines-gated §8.4.2), extension points (hooks/endpoints/commands vào Data Plane/HTTP/CLI), CLI đầy đủ (`site backup/restore` additive không xoá đích, `migrate`, `app`, `doctor`), AuthN (docs + API key interim + app policies loading).
- ✅ **Phase 5 — Sync**: ZEN event log → SQL projection — Event v1 content-addressed + ký secp256k1 (ZEN vendored first-party), HLC total order, refold mức row (**hội tụ chứng minh: k hoán vị → bảng giống byte**), 4 cổng + quarantine + retry, upgradeRow chain, two-peer bus.
- ✅ **Phase 6 — Semantic**: serialize schema-aware, embedding provider cắm được (local-first default), search text/vector/hybrid (**permission trước ranking**), RRF k=60 core, `<nx-search>`.

### Deferred — cần hạ tầng ngoài hoặc là lớp đời sau (ghi thẳng, không giấu)

Những mục sau **không** nằm trong lõi vì phụ thuộc dịch vụ/hạ tầng bên ngoài hoặc là tầng ứng dụng phía trên nền đã đúng — mỗi mục đã có seam sẵn để cắm vào mà không đổi ngữ nghĩa:

1. **Live multi-engine matrix** (turso/postgres/mysql chạy thật) — cần service thật trong CI. Adapter viết theo API công bố của driver; failure path (E_DRIVER kèm lệnh cài) pin hôm nay; sqlite pin đầy đủ. Compiler đã đa-dialect (VND/CMP/DDL pin khác biệt quoting/type per dialect).
2. **Custom sqlite-wasm build** (FTS5 + sqlite-vec) + **live ANN** (pgvector/Turso native) — capability nâng cấp per engine sau matrix; baseline brute-force cosine + text score đã portable và pin trên engine thật, sau cùng một `search()` contract.
3. **PEN graph gate** (cổng 3 của sync) + **ZEN graph/relay transport** — `onemit` là seam; cổng 4 đã re-check permission bất kể. Là tích hợp mạng, không đổi ngữ nghĩa fold.
4. **Checkpoint/pruning + super-peer roles** (§5.1, §8 sync-design) — cần vai trò arbiter + phân phối snapshot.
5. ✅ **ZEN keypair auth flow (challenge-sign → HMAC token) — ĐÃ HOÀN THÀNH** (`src/app/auth.js`, AUTH-05/06/07; docs/authn-design.md §5). Còn lại: WebAuthn PRF binding phía client + ZEN graph transport (tích hợp mạng/UI, không phải core).
6. **NL→AST** (§4.6f) — tầng LLM đời sau, dựng trên Query AST + hybrid search đã có; ngoài core (N5).
7. **Background jobs** (extension point `jobs`) + **client-side extension registries** (interfaces/displays/views/pages) — ride Threads / Studio integration.

*Nguyên tắc của danh sách này: không mục nào là "chưa làm được", tất cả là "cắm vào seam đã có" hoặc "cần dịch vụ CI thật" — nền tảng và mọi hợp đồng versioned đã đóng.*

---

*Tài liệu này là hợp đồng nền. Mọi thay đổi lên nó từ đây trở đi phải nói rõ: đổi gì, vì sao, và ảnh hưởng gì tới N1–N6.*
