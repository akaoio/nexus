# Nexus ⬡

**A pure-web meta-framework: define your models as data, get forms, queries, permissions, and APIs generated from metadata — then build apps on top.**

Like Frappe, but: installs in one command, runs natively on every OS, has zero runtime dependencies in its kernel, and is engineered to never break the apps that run on it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Design](https://img.shields.io/badge/Status-Design%20Phase-orange.svg)](ARCHITECTURE.md)
[![Web Components](https://img.shields.io/badge/Web-Components-29ABE2.svg)](https://www.webcomponents.org/)

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
| **Schema changes in production** | ⚠️ hot-synced silently, no confirmation | ❌ **disabled by design** — edit in dev, redeploy ² | ✅ | ✅ | ✅ hybrid: additive = instant; structural = reviewed migration + dry-run + rollback |
| **Installation** | ❌ bench + Redis ×3 + NGINX + Supervisor + wkhtmltopdf; WSL/Docker only on Windows | ✅ npx | ✅ npm/Docker | ✅ | ✅ one command, Node ≥18, self-served HTTPS — no NGINX, no Redis, no Supervisor |
| **CLI** | ✅ bench — powerful but heavy, Linux-only | ✅ polished DX | ⚠️ | ⚠️ | ✅ `nexus` — Strapi-grade polish, bench-grade coverage, zero-dep, dry-run by default, `--json` everywhere |
| **Runs 100% in the browser (offline)** | ❌ | ❌ | ❌ | ❌ | ✅ SQLite WASM + OPFS, same app schema as server mode |
| **P2P sync / no central server required** | ❌ | ❌ | ❌ | ❌ | ✅ signed CRDT event log (ZEN); super-peers accelerate, never required |
| **Identity** | password sessions | password/JWT | password/SSO | password | ✅ WebAuthn passkey → deterministic keypair; no passwords stored |
| **Semantic + full-text search built in** | ❌ | ❌ | ❌ | ⚠️ external glue (webhooks + n8n + OpenAI) ³ | ✅ schema-aware FTS + vector + RRF hybrid, **local-first embeddings** |
| **Update safety for apps** | ⚠️ no public/private API boundary | ❌ v4→v5 broke the plugin ecosystem ⁴ | ⚠️ major-version migration pain | ⚠️ | ✅ enumerated public API, deprecation windows, behavior switches, core updates go through the same migration engine |
| **i18n** | ⚠️ runtime | ⚠️ plugin | ⚠️ | ⚠️ | ✅ build-time static routes per locale (SEO-grade), translations in schema |
| **Multi-tenancy** | ✅ bench sites | ❌ | ⚠️ | ⚠️ | ✅ sites with **isolated databases**, domain-mapped |
| **Kernel dependencies** | Python stack | Node + Knex stack | Node + Knex stack | Node stack | ✅ **zero** external runtime deps (vendored Kysely behind the AST boundary) |
| **License** | MIT | MIT (core) | ❌ BSL → MSCL (left open source) | AGPL | ✅ MIT, permanently |

† The Nexus column describes the design contract in [ARCHITECTURE.md](ARCHITECTURE.md) — not shipped code yet. Every claim is backed by a conformance test before implementation (see Status).

¹ Frappe core's list-view/report filters are a flat `[field, operator, value]` list ANDed together, plus a single optional `["or", …]` level. Arbitrary nesting exists only in the server-side Python API (`frappe.qb`) and in Frappe Insights, a separate product.
² Strapi's Content-Type Builder is disabled in production ([strapi/strapi#4798](https://github.com/strapi/strapi/issues/4798)); `strapi import` deletes all existing data at the destination before restoring.
³ Documented community pattern: NocoDB semantic search requires wiring webhooks through n8n to OpenAI and pgvector by hand.
⁴ Strapi v5 removed `helper-plugin`, changed the response shape, and replaced `id` with `documentId` — most v4 plugins required manual rewrites ([official breaking-changes list](https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes)).

Nexus combines what each got right and refuses what each got wrong:

- **Universal Query AST** — one recursive filter structure (infinite AND/OR nesting) that drives queries, permissions, validations, and the visual query builder. Frappe core's own filter UI is actually flat; Nexus goes past it.
- **Meta-model** — entities defined in versioned YAML/JSON; forms, list views, APIs, and migrations derive from schema. Customize without forking.
- **Deep permissions** — role/policy matrix, field-level levels, row-level rules written in the same AST as queries.
- **Your database** — SQLite, [Turso](https://github.com/tursodatabase/turso) (the async-native Rust rewrite of SQLite — file-format compatible, so the exit path back to plain SQLite always stays open), PostgreSQL, MySQL/MariaDB, tested as equals; plus SQLite WASM fully in the browser.
- **Dual runtime** — the same app schema runs on a single-process Node server *or* 100% locally in the browser (OPFS persistence, P2P sync over ZEN), with super-peers as accelerators, never as dependencies.
- **Semantic layer** — schema-aware full-text + vector search with local-first embeddings. Nexus doesn't just record data; it understands it.
- **Built to last** — zero-dependency kernel, frozen data formats, "never break userspace" compatibility policy, spec-as-conformance-tests. Lessons taken from SQLite, Linux, TeX, and Go.

## Status

**Phase 0 complete — spec triad implemented, 168/168 green.** The full architectural plan — grounded in source-level research of Frappe, Strapi, Directus, NocoDB, Kysely, and SQLite's longevity practices — lives in [ARCHITECTURE.md](ARCHITECTURE.md) (currently in Vietnamese).

Per our TDD discipline, the spec was written as executable conformance tests *before* any implementation — **168 numbered, immutable clauses** (`npm test`), every one earned green without a single test edited: Query AST v1 ([src/ast/AST.js](src/ast/AST.js), 83), Model Schema v1 ([src/model/Model.js](src/model/Model.js), 54), Permission v1 ([src/permission/Permission.js](src/permission/Permission.js), 31 — composing the other two: its filters are AST documents validated and resolved by the AST module itself):

- **[Query AST v1](test/conformance/ast/)** (83): structure invariants incl. unlimited logic nesting, all 13 operator semantics (incl. SQL null semantics), dynamic variables with an injected clock, the JS predicate reference target, permission injection with the never-widen security invariant, versioning, and seeded property-based laws (De Morgan, double negation, injection narrowing).
- **[Model Schema v1](test/conformance/model/)** (54): entity envelope, the closed 10-type field set with per-type rules, additive-vs-structural change classification (the hybrid Migration Engine's safety boundary), customize-without-forking merge semantics with the update-safety property, and versioning.
- **[Permission v1](test/conformance/permission/)** (31): deny-by-default, the frozen 7-action lifecycle, additive policy union returning a fully-resolved AST filter, ifOwner, Frappe-faithful permlevel field access, and per-user/per-action document sharing.

## Lineage

Nexus builds on the architecture of [akao](https://github.com/akaoio/akao) — pure Web Components, isomorphic threads, SQLite WASM + OPFS, build-time i18n, multi-tenant sites — and [ZEN](https://github.com/akaoio/zen) for cryptographic identity, CRDT sync, and policy enforcement.

## License

MIT — permanently.
