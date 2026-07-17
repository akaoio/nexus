# Nexus — User Guide

A practical walkthrough of everything that works today. Every feature here is
covered by a passing conformance clause; the honest boundaries are called out
where they exist. See [STATUS.md](../STATUS.md) for the full done/deferred ledger
and [ARCHITECTURE.md](../ARCHITECTURE.md) for the design contract (N1–N6).

> Requirements: Node ≥ 18 (the built-in sqlite engine needs Node ≥ 22; other
> engines resolve their driver from your instance). No Redis, no NGINX, no
> Supervisor, no system services.

---

## 1. Create and run an instance

```bash
node bin/nexus.js create my-app --site "My App"   # scaffold (starter schema validated by the Model API)
cd my-app
node ../bin/nexus.js dev                            # serve it — one self-contained process
# open http://localhost:8080
```

A scaffolded instance is just files:

```
my-app/
  nexus.config.json     # site + database engine + (optional) auth
  apps/
    starter/
      manifest.json      # app metadata (engines-gated)
      models/task.json   # a Model Schema v1 document
      hooks.js           # optional extension points
```

`nexus dev` loads and **validates** every schema before serving — a broken
schema is refused, never served.

---

## 2. The Studio (`nexus dev` → http://localhost:8080)

A live, self-hosted Studio with five tabs, each dogfooding a real component
against the auto-generated HTTP API:

| Tab | What it does |
|---|---|
| **Data** | Build an unlimited-depth filter in `<nx-query-builder>`, or type plain language into **Ask → AST** (NL→AST); results render in `<nx-list-view>`. |
| **Form** | `<nx-form>` renders the entity's fields; submit creates a row via `POST /api/v1/:entity`. |
| **Search** | `<nx-search>` runs text/vector/hybrid search across entities (ranks inside permission). |
| **Schema** | `<nx-schema-designer>` shows a live additive-vs-structural diff as you edit, and emits a real Model Schema v1 document. |
| **Permissions** | `<nx-permission-manager>` builds Permission v1 policies (row rules reuse the query builder). |

---

## 3. Models (Model Schema v1)

A model is a JSON document. Field types are a closed set (text, integer, number,
boolean, date, datetime, select, link, table, …). Example:

```json
{
  "name": "task",
  "schemaVersion": 1,
  "fields": [
    { "name": "title", "type": "text", "required": true },
    { "name": "done", "type": "boolean", "default": false },
    { "name": "priority", "type": "select", "options": ["low", "medium", "high"] },
    { "name": "points", "type": "integer" }
  ]
}
```

Every entity also gets system columns automatically: `id` (ULID, client-generated),
`owner` (the ZEN pubkey of the creator), `created_at`, `updated_at`.

**Migrations** are hybrid: additive changes (add a nullable column, add an index)
apply hot; structural changes produce a reviewable migration document with a
dry-run by default (it reports rows copied and per-column data loss, then rolls
back) and human-declared renames. `nexus migrate` drives it.

---

## 4. The HTTP API (auto-generated)

Every entity is exposed under `/api/v1/:entity` with zero permission logic in the
transport (the Data Plane enforces it):

| Method + path | Purpose |
|---|---|
| `GET /api/v1/:entity` | list (query params: `limit`, `offset`, `orderBy`) |
| `POST /api/v1/:entity` | create |
| `GET/PATCH/DELETE /api/v1/:entity/:id` | read / update / delete |
| `POST /api/v1/:entity/query` | list with a full **Query AST** document |
| `POST /api/v1/:entity/search` | text/vector/hybrid search `{ query, mode }` |
| `POST /api/v1/:entity/ask` | **natural language** → validated AST → list |
| `GET /_health` | liveness probe `{ status, entities, engine, uptime }` |

The **Query AST** is the universal filter: logic nodes `{op: and|or|not, children}`
and leaves `{field, operator, value}`, nesting to any depth. The same AST compiles
to SQL, to a permission filter, to a JS predicate, and to ZEN PEN bytecode — and
the compiled SQL is proven row-for-row equal to the reference predicate on real
sqlite, Turso, and Postgres.

```bash
curl -X POST localhost:8080/api/v1/task/query -H 'content-type: application/json' \
  -d '{"filter":{"astVersion":1,"root":{"op":"and","children":[
        {"field":"done","operator":"eq","value":false},
        {"field":"points","operator":"gt","value":3}]}},"limit":20}'
```

---

## 5. Choosing a database engine

Set `database.engine` in `nexus.config.json`:

```json
{ "site": { "name": "My App" }, "database": { "engine": "sqlite" } }
```

| Engine | Driver | Notes |
|---|---|---|
| `sqlite` | built into Node ≥ 22 | zero-install default; persists to `.nexus/data.db` |
| `turso` | `@tursodatabase/database` | in-process, SQLite-compatible |
| `postgres` | `pg` (server) **or** `@electric-sql/pglite` (in-process WASM) | real Postgres with no server via PGlite |
| `mysql` | `mysql2` | needs a real MySQL/MariaDB server |

A missing driver fails loudly with the exact `npm install …` command. The golden
invariant (compiled SQL ≡ reference predicate) is proven live on sqlite, Turso,
and Postgres on a plain dev box.

---

## 6. Permissions

Deny-by-default. A policy is `{ entity, actions, rule, permlevel, ifOwner }`;
`rule` is a Query AST document (row-level). Policies union additively into one
resolved AST filter that is injected into **every** query — there is no code path
that reads or writes data without passing the gate. `permlevel` gates fields;
`ifOwner` compares `owner` to the caller.

---

## 7. Sync (offline-first, P2P) — optional

The SQL database is a **projection** of an immutable, secp256k1-signed event log.
This layer is opt-in; a single-process app never needs it.

- **Events** are content-addressed and signed. Order is total (HLC). Row-level
  **refold** makes convergence structural: any arrival order → byte-identical tables.
- **Four gates**: signature (1), content address (2), **PEN policy at the graph
  layer** (3, opt-in — permission compiled to real ZEN PEN bytecode), full Nexus
  permission + schema (4, with quarantine-and-heal).
- **Real ZEN mesh transport**: two engines converge over WebSocket gossip.
- **Checkpoint & compaction**: an arbiter-signed checkpoint (Merkle state root)
  lets peers prune the log once their refold matches; a fresh peer bootstraps
  from the signed snapshot. No configured arbiter → never prune.

Honest boundaries (stated in the design): no cross-row transactions in pure P2P;
`unique` is soft (needs an arbiter or detect-and-flag); row rules referencing
*other* rows are not absolute without an arbiter.

---

## 8. Semantic search & NL→AST

- **Serialization** is declared in the schema (`semantic:` block: a per-locale
  template + weighted embed fields).
- **Embeddings** come from a pluggable provider. The real default is
  **EmbeddingGemma-300m** (768-dim, with query/document task prompts);
  `all-MiniLM-L6-v2` is the fast option; a deterministic lexical `hashProvider`
  is the offline fallback. Providers are the instance's dependency, never the
  kernel's. Embeddings are derived data — recomputed per peer, never synced.
- **Search** does text, vector (sqlite-vec ANN or brute force), and hybrid
  (RRF k=60) — always ranking **inside** permission (the over-fetch cannot leak).
- **NL→AST** (`/ask`): a rule parser by default, or embedding-retrieval over an
  intent library; whatever a provider returns is validated against the schema, so
  it can never invent a field or reach a forbidden row.

---

## 9. Authentication

- **API keys**: `api_keys` in `nexus.config.json` → the key is required (401
  otherwise), stamps identity, and roles map to app policies.
- **ZEN challenge-sign**: `POST /api/v1/_auth/challenge` → sign the nonce →
  `POST /api/v1/_auth/verify` → an HMAC session token.
- **WebAuthn PRF → identity**: a credential's PRF secret is hashed to a seed and
  `ZEN.pair(seed)` derives a keypair deterministically — the same credential
  always gives the same public key, no private key stored. The derivation is
  proven hardware-free; reading the PRF output needs a real authenticator.

Configuring `api_keys` or `identities` makes auth **required** — there are no
half-modes. With neither configured, `nexus dev` uses a loud, wide-open DEV
identity (never use that facing a network).

---

## 10. CLI reference

| Command | Purpose |
|---|---|
| `nexus create <dir> --site "<name>"` | scaffold a new instance |
| `nexus dev [--port N]` | dev server + Studio (DEV identity unless auth configured) |
| `nexus start [--port N] [--insecure]` | **production server**, self-served TLS — refuses to run without auth or TLS (see §11) |
| `nexus test` | validate the instance's schemas (CI-ready exit codes) |
| `nexus migrate` | plan/apply migrations (dry-run by default) |
| `nexus site` | site operations incl. additive `restore` (never deletes destination data) |
| `nexus app` | app operations |
| `nexus doctor` | environment + instance checks |

Every command supports `--json` (a versioned, stable output contract) and uses
exit codes 0 / 1 / 2. Apps register their own subcommands via the `commands`
extension point.

---

## 11. Production notes (read before deploying)

Nexus is **spec-complete and conformance-green**, but it is early (`0.1.0`, alpha).

Use **`nexus start`** for production, not `nexus dev`. It enforces the security
contract by construction (proven by the START-* clauses):

- **No god-mode.** It refuses to run (`E_NO_AUTH`) unless the instance configures
  `api_keys` or `identities` — it will never serve the wide-open DEV identity.
- **TLS required.** It reads a key+cert from `SSL_KEY`/`SSL_CERT` (or
  `<root>/.certs/{key,cert}.pem`) and serves HTTPS; without certs it refuses
  (`E_NO_TLS`) unless you pass `--insecure` (for localhost or behind a
  TLS-terminating proxy).
- **No Studio, no framework source.** It serves only the API, the auth handshake,
  `/_health`, and your `public/` assets — never `/_nexus/src` or an admin UI.

```bash
# provide certs (or use --insecure behind a proxy), configure api_keys, then:
SSL_KEY=/path/key.pem SSL_CERT=/path/cert.pem nexus start --port 443
```

You still own the rest of production hardening (the live engine actually
provisioned, backups, monitoring, secrets management). Treat today's build as a
strong alpha: excellent for building apps, demos, and local-first tools.
