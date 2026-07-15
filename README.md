# Nexus ⬡

**A pure-web meta-framework: define your models as data, get forms, queries, permissions, and APIs generated from metadata — then build apps on top.**

Like Frappe, but: installs in one command, runs natively on every OS, has zero runtime dependencies in its kernel, and is engineered to never break the apps that run on it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Design](https://img.shields.io/badge/Status-Design%20Phase-orange.svg)](ARCHITECTURE.md)
[![Web Components](https://img.shields.io/badge/Web-Components-29ABE2.svg)](https://www.webcomponents.org/)

## Why

Frappe is the most powerful meta-framework in its class — and nearly impossible to install (Gunicorn + 3 Redis instances + MariaDB-specific + NGINX + Supervisor + patched wkhtmltopdf, no native Windows). Strapi forbids schema editing in production and broke its entire plugin ecosystem between major versions. Directus left open source. Nobody ships local-first.

Nexus combines what each got right and refuses what each got wrong:

- **Universal Query AST** — one recursive filter structure (infinite AND/OR nesting) that drives queries, permissions, validations, and the visual query builder. Frappe core's own filter UI is actually flat; Nexus goes past it.
- **Meta-model** — entities defined in versioned YAML/JSON; forms, list views, APIs, and migrations derive from schema. Customize without forking.
- **Deep permissions** — role/policy matrix, field-level levels, row-level rules written in the same AST as queries.
- **Your database** — SQLite, libSQL, PostgreSQL, MySQL/MariaDB, tested as equals; plus SQLite WASM fully in the browser.
- **Dual runtime** — the same app schema runs on a single-process Node server *or* 100% locally in the browser (OPFS persistence, P2P sync over ZEN), with super-peers as accelerators, never as dependencies.
- **Semantic layer** — schema-aware full-text + vector search with local-first embeddings. Nexus doesn't just record data; it understands it.
- **Built to last** — zero-dependency kernel, frozen data formats, "never break userspace" compatibility policy, spec-as-conformance-tests. Lessons taken from SQLite, Linux, TeX, and Go.

## Status

**Design phase.** The full architectural plan — grounded in source-level research of Frappe, Strapi, Directus, NocoDB, Kysely, and SQLite's longevity practices — lives in [ARCHITECTURE.md](ARCHITECTURE.md) (currently in Vietnamese). No production code exists yet; per our TDD discipline, Phase 0 is writing the conformance test suites that *define* the Query AST, Model Schema, and Permission semantics.

## Lineage

Nexus builds on the architecture of [akao](https://github.com/akaoio/akao) — pure Web Components, isomorphic threads, SQLite WASM + OPFS, build-time i18n, multi-tenant sites — and [ZEN](https://github.com/akaoio/zen) for cryptographic identity, CRDT sync, and policy enforcement.

## License

MIT — permanently.
