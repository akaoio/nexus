# Nexus ⬡

**A pure-web meta-framework: define your models as data, get forms, queries, permissions, and APIs generated from metadata — then build apps on top.**

Like Frappe, but: installs in one command, runs natively on every OS, has zero runtime dependencies in its kernel, and is engineered to never break the apps that run on it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Conformance: 430 clauses, 0 red](https://img.shields.io/badge/Conformance-430%20clauses%2C%200%20red-success.svg)](test/)
[![Web Components](https://img.shields.io/badge/Web-Components-29ABE2.svg)](https://www.webcomponents.org/)

## Install (one line, GitHub is the source of truth)

```sh
curl -fsSL https://raw.githubusercontent.com/akaoio/nexus/main/install.sh | sh
```

Needs only Node >= 22. GitHub first, tarball fallback when git is missing —
npm is never required. Then:

```sh
nexus create my-app && cd my-app && nexus dev
nexus update      # self-update (git installs: fetch + hard reset, the access way)
nexus uninstall   # clean removal — never touches your instances
```

## Why

Frappe is the most powerful meta-framework in its class — and nearly impossible to install (Gunicorn + 3 Redis instances + MariaDB-specific + NGINX + Supervisor + patched wkhtmltopdf, no native Windows). Strapi forbids schema editing in production and broke its entire plugin ecosystem between major versions. Directus left open source. Nobody ships local-first.

### Nexus vs. the giants

| | **Frappe** | **Strapi** | **Directus** | **NocoDB** | **Nexus** † |
|---|---|---|---|---|---|
| **Meta-model** (models as data) | ✅ DocType (JSON) | ✅ Content-Types | ✅ Collections | ⚠️ table-centric | ✅ Entity (versioned YAML/JSON) |
| **Visual query builder depth** | ⚠️ flat list + one optional OR level ¹ | ❌ none | ✅ recursive `_and`/`_or` | ⚠️ capped at 5 nesting levels | ✅ unlimited recursive AND/OR/NOT |
| **One AST for query + permission + validation** | ❌ separate systems | ❌ | ✅ (validated the pattern) | ❌ | ✅ + compiled to SQL, P2P policy VM, and JS predicate |
| **Form builder** | ✅ drag-and-drop (v15) | ⚠️ basic Content-Type Builder | ⚠️ interfaces, no layout designer | ❌ | ✅ drag-and-drop → schema, no codegen |
| **Field-level permissions** | ✅ permlevel 0–9 | ⚠️ | ✅ per-field grants | ⚠️ | ✅ permlevel + policies |
| **Row-level permissions** | ✅ User Permissions | ⚠️ plugin | ✅ filter-rule policies | ⚠️ | ✅ rules written in the same query AST |
| **Customize without forking** | ✅ Custom Field / Property Setter | ❌ | ⚠️ | ❌ | ✅ CustomField / PropertyOverride, survives app updates |
| **Database choice** | ❌ MariaDB (Postgres second-class) | ✅ SQLite/PG/MySQL | ✅ SQLite/PG/MySQL/MSSQL… | ✅ | ✅ SQLite / Turso / PostgreSQL / MariaDB — **tested as equals**, incl. SQLite WASM in-browser |
| **Schema changes in production** | ⚠️ hot-synced silently, no confirmation | ❌ **disabled by design** — edit in dev, redeploy ² | ✅ | ✅ | ⚠️ **dev-and-deploy today** — the Studio's schema designer and config panels are dev-only (`nexus dev`); a production instance takes structural change through git + redeploy, same shape as Strapi. The **hybrid additive = instant / structural = reviewed migration + dry-run + rollback** behavior is real at the engine level in dev — it is the design contract †, not yet exposed as a production Studio operation |
| **Installation** | ❌ bench + Redis ×3 + NGINX + Supervisor + wkhtmltopdf; WSL/Docker only on Windows | ✅ npx | ✅ npm/Docker | ✅ | ✅ one command, Node ≥18, self-served HTTPS — no NGINX, no Redis, no Supervisor |
| **CLI** | ✅ bench — powerful but heavy, Linux-only | ✅ polished DX | ⚠️ | ⚠️ | ✅ `nexus` — Strapi-grade polish, bench-grade coverage, zero-dep, dry-run by default, `--json` everywhere |
| **Runs 100% in the browser (offline)** | ❌ | ❌ | ❌ | ❌ | ✅ SQLite WASM + OPFS, same app schema as server mode |
| **P2P sync — server optional for state** | ❌ | ❌ | ❌ | ❌ | ✅ signed CRDT event log (ZEN); super-peers accelerate state, never required for it ⁵ |
| **Identity** | password sessions | password/JWT | password/SSO | password | ✅ WebAuthn passkey → deterministic keypair; no passwords stored |
| **Semantic + full-text search built in** | ❌ | ❌ | ❌ | ⚠️ external glue (webhooks + n8n + OpenAI) ³ | ✅ schema-aware FTS + vector + RRF hybrid, **local-first embeddings** |
| **Update safety for apps** | ⚠️ no public/private API boundary | ❌ v4→v5 broke the plugin ecosystem ⁴ | ⚠️ major-version migration pain | ⚠️ | ✅ enumerated public API, deprecation windows, behavior switches, core updates go through the same migration engine |
| **i18n** | ⚠️ runtime | ⚠️ plugin | ⚠️ | ⚠️ | ✅ build-time static routes per locale (SEO-grade), translations in schema |
| **Multi-tenancy** | ✅ bench sites | ❌ | ⚠️ | ⚠️ | ✅ sites with **isolated databases**, domain-mapped |
| **Kernel dependencies** | Python stack | Node + Knex stack | Node + Knex stack | Node stack | ✅ **zero** external runtime deps — three tiers: kernel zero · vendored behind a boundary (Kysely) · instance-optional providers (DB drivers, transformers.js, nodemailer) |
| **License** | MIT | MIT (core) | ❌ BSL → MSCL (left open source) | AGPL | ✅ MIT, permanently |

† The Nexus column describes the design contract in [ARCHITECTURE.md](ARCHITECTURE.md) — not shipped code yet. Every claim is backed by a conformance test before implementation (see Status).

¹ Frappe core's list-view/report filters are a flat `[field, operator, value]` list ANDed together, plus a single optional `["or", …]` level. Arbitrary nesting exists only in the server-side Python API (`frappe.qb`) and in Frappe Insights, a separate product.
² Strapi's Content-Type Builder is disabled in production ([strapi/strapi#4798](https://github.com/strapi/strapi/issues/4798)); `strapi import` deletes all existing data at the destination before restoring.
³ Documented community pattern: NocoDB semantic search requires wiring webhooks through n8n to OpenAI and pgvector by hand.
⁴ Strapi v5 removed `helper-plugin`, changed the response shape, and replaced `id` with `documentId` — most v4 plugins required manual rewrites ([official breaking-changes list](https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes)).

⁵ Said precisely: **server optional for *state*, required for *effects*.** CRDT sync converges state — every replay order yields the same table. It cannot converge side-effects: a replayed "send the customer an email" sends twice. Coordinating effects (exactly one worker takes the job, acks on success, retries on failure) needs one owner of the queue, so jobs and webhooks are server-only entities that never sync. Data lives without a server; *acting on the outside world* does not.

Nexus combines what each got right and refuses what each got wrong:

- **Universal Query AST** — one recursive filter structure (infinite AND/OR nesting) that drives queries, permissions, validations, and the visual query builder. Frappe core's own filter UI is actually flat; Nexus goes past it.
- **Meta-model** — entities defined in versioned YAML/JSON; forms, list views, APIs, and migrations derive from schema. Customize without forking.
- **Deep permissions** — role/policy matrix, field-level levels, row-level rules written in the same AST as queries.
- **Your database** — SQLite, [Turso](https://github.com/tursodatabase/turso) (the async-native Rust rewrite of SQLite — file-format compatible, so the exit path back to plain SQLite always stays open), PostgreSQL, MySQL/MariaDB, tested as equals; plus SQLite WASM fully in the browser.
- **Dual runtime** — the same app schema runs on a single-process Node server *or* 100% locally in the browser (OPFS persistence, P2P sync over ZEN), with super-peers as accelerators of state, never as dependencies for it. Effects (jobs, webhooks, mail) are the honest exception: they need a server, and the design says so out loud.
- **Semantic layer** — schema-aware full-text + vector search with local-first embeddings. Nexus doesn't just record data; it understands it.
- **Built to last** — zero-dependency kernel, frozen data formats, "never break userspace" compatibility policy, spec-as-conformance-tests. Lessons taken from SQLite, Linux, TeX, and Go.

## Status

**Version 0.0.0 — pre-alpha, honestly.** The data/logic core (Query AST, Model,
Permission, Data Plane, Sync, engine adapters, kernel) is built spec-first and
green — every contract written as a red conformance clause *before* its code, 0
red across Node + a real headless Chromium. But the **Studio/UI layer is being
refactored** from a monolith into the systematic architecture in
[ARCHITECTURE.md §7.1](ARCHITECTURE.md) (interfaces/displays generated from the
schema, one module per concern). The CLI and UX must still beat Frappe bench and
match Strapi/Directus polish before this earns a 0.1. The meta-model data type is
called an **Entity** everywhere (not DocType / Content-Type). See
[STATUS.md](STATUS.md).

Try it now:

```bash
npx nexus create my-app --site "My App"   # scaffold (the starter schema is validated by the public Model API)
cd my-app
nexus dev                                 # serve it — one self-contained process, no NGINX/Redis/Supervisor
# open http://localhost:8080 — a live Studio: Data (query builder + NL→AST Ask),
# Form, Search, Schema designer, and Permissions — each wired to the real API
```

📖 **New here? Read the [User Guide](docs/GUIDE.md)** — a practical walkthrough of every feature that works today.

What is real and pinned end-to-end:

- **The universal Query AST** — validate/resolve/predicate/inject, and an **AST→Kysely compiler** proven row-for-row equal to the reference JS predicate on a real SQLite engine (including the three-valued-logic NOT trap and 120 seeded random documents).
- **The meta-model** — Model Schema v1, Model→DDL (entities become real tables, ULID identity), and a **hybrid Migration Engine** (hot DDL where a dialect truly can; the universal rebuild with dry-run-by-default, data-loss reports, human-declared renames and an idempotent ledger otherwise).
- **The Data Plane CRUD API** — every access chains validation, permission resolution, AST injection and post-image checks; missing and forbidden are indistinguishable; and it is exposed as an **auto-generated HTTP API** (`/api/v1/:entity`, `/:id`, `/query` accepting a full AST, `/search`) with zero permission logic in the transport.
- **Engine choice** — `database.engine` in `nexus.config.json` selects sqlite (built-in, zero-install default), turso, postgres or mysql; a missing driver fails with the exact `npm install …` command. The golden invariant (compiled SQL ≡ reference predicate) is proven live on **sqlite, Turso, and Postgres** on a dev box — Turso in-process and Postgres via PGlite (real Postgres in WASM), no server required.
- **Studio** — `<nx-query-builder>` (recursive, unlimited-depth, fuzzed in a real browser), `<nx-form-builder>`/`<nx-form>`, `<nx-schema-designer>` (live additive-vs-structural classification → a real migration document), `<nx-permission-manager>` (the first reuse of the query builder for row rules), `<nx-list-view>`, `<nx-search>`, and **saved views** persisted through the Data Plane as a system entity.
- **The app system** — versioned App Manifest (engines-gated), extension points (hooks/endpoints/commands into the Data Plane, HTTP and CLI), the full CLI (`create/dev/test/migrate/site/app/doctor`) with an additive `site restore` that never deletes destination data, and interim API-key auth plus **WebAuthn PRF → deterministic ZEN identity** (the derivation is proven hardware-free).
- **Sync** — the ZEN event log → SQL projection: content-addressed, secp256k1-signed events; HLC total order; row-level refold with **confluence proven** (any arrival order → byte-identical tables); four verification gates with quarantine-and-heal. Now over a **real ZEN mesh transport** (two engines converge over WebSocket gossip; idempotent; tamper-rejected), with **checkpoint & compaction** (arbiter-signed, Merkle state root, prune-on-match, snapshot bootstrap) and **gate 3** compiling permission to real ZEN **PEN** bytecode evaluated by ZEN's policy VM.
- **Semantic** — schema-declared serialization, a pluggable local-first embedding provider defaulting to real **EmbeddingGemma-300m** (with all-MiniLM as the fast option), real **sqlite-vec** ANN, and text/vector/hybrid search that ranks **inside** permission with RRF fusion in core. Plus **NL→AST** (rule + embedding-retrieval providers, validated against the schema).

**What is deliberately deferred** — and why — is two honest boundaries that need real infrastructure or hardware, not missing code (see [STATUS.md](STATUS.md)): the **live MySQL** matrix (there is no in-process WASM MySQL as there is for Turso/Postgres, so it is proven only against a real server in CI), and the **physical WebAuthn PRF read** (the key derivation is proven hardware-free; reading the PRF secret needs a real or virtual authenticator). A custom sqlite-wasm build with FTS5 for local-mode full-text remains optional. Every public format and API contract is frozen.

**Phase 0 complete — spec triad implemented, 168/168 green.** The full architectural plan — grounded in source-level research of Frappe, Strapi, Directus, NocoDB, Kysely, and SQLite's longevity practices — lives in [ARCHITECTURE.md](ARCHITECTURE.md) (currently in Vietnamese).

Per our TDD discipline, the spec was written as executable conformance tests *before* any implementation — **168 numbered, immutable clauses** (`npm test`), every one earned green without a single test edited: Query AST v1 ([src/core/AST.js](src/core/AST.js), 83), Model Schema v1 ([src/core/Model.js](src/core/Model.js), 54), Permission v1 ([src/core/Permission.js](src/core/Permission.js), 31 — composing the other two: its filters are AST documents validated and resolved by the AST module itself):

- **[Query AST v1](test/conformance/ast/)** (83): structure invariants incl. unlimited logic nesting, all 13 operator semantics (incl. SQL null semantics), dynamic variables with an injected clock, the JS predicate reference target, permission injection with the never-widen security invariant, versioning, and seeded property-based laws (De Morgan, double negation, injection narrowing).
- **[Model Schema v1](test/conformance/model/)** (54): entity envelope, the closed 10-type field set with per-type rules, additive-vs-structural change classification (the hybrid Migration Engine's safety boundary), customize-without-forking merge semantics with the update-safety property, and versioning.
- **[Permission v1](test/conformance/permission/)** (31): deny-by-default, the frozen 7-action lifecycle, additive policy union returning a fully-resolved AST filter, ifOwner, Frappe-faithful permlevel field access, and per-user/per-action document sharing.

## Lineage

Nexus builds on the architecture of [akao](https://github.com/akaoio/akao) — pure Web Components, isomorphic threads, SQLite WASM + OPFS, build-time i18n, multi-tenant sites — and [ZEN](https://github.com/akaoio/zen) for cryptographic identity, CRDT sync, and policy enforcement.

## License

MIT — permanently.
