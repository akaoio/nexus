/**
 * Config control-plane conformance (CONFIG-*) — `nexus config`, the bench-style
 * general editor for nexus.config.json. Pure dot-path ops, CLI get/set/unset,
 * value coercion, and secret redaction.
 */

import { fileURLToPath } from "url"
import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { getPath, setPath, unsetPath, coerce, redact, isSecretPath } from "../../src/core/App/config.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

Test.describe("Config control-plane (CONFIG)", () => {
    Test.it("CONFIG-01 pure dot-path ops + coercion + redaction", () => {
        const cfg = { site: { name: "S" }, database: { engine: "sqlite" } }
        assert.equal(getPath(cfg, "database.engine"), "sqlite")
        assert.equal(getPath(cfg, "nope.deep"), undefined)
        const set = setPath(cfg, "semantic.model", "gemma") // creates parents
        assert.equal(set.semantic.model, "gemma")
        assert.equal(cfg.semantic, undefined) // pure — original untouched
        assert.equal(getPath(unsetPath(set, "semantic.model"), "semantic.model"), undefined)
        assert.equal(coerce("42"), 42)
        assert.equal(coerce("true"), true)
        assert.equal(coerce("turso"), "turso")
        assert.equal(coerce("42", true), "42") // forceString
        assert.equal(redact({ token_secret: "s", api_keys: [{ key: "k", user: "u" }] }).token_secret, "***")
        assert.equal(redact({ api_keys: [{ key: "k", user: "u" }] }).api_keys[0].key, "***")
        assert.equal(isSecretPath("token_secret"), true)
        assert.equal(isSecretPath("site.name"), false)

        // mail.* — spec §5 claims mail config is redacted; the smtp block (host/user/pass)
        // must mask the same way api_keys[].key does, while provider/from stay readable.
        const mailCfg = { mail: { provider: "smtp", from: "x@y.z", smtp: { host: "h", auth: { user: "u", pass: "s3cret" } } } }
        const redactedMail = redact(mailCfg)
        assert.equal(redactedMail.mail.provider, "smtp")
        assert.equal(redactedMail.mail.from, "x@y.z")
        assert.equal(redactedMail.mail.smtp, "***")
        assert.equal(isSecretPath("mail.smtp"), true)
        assert.equal(isSecretPath("mail.smtp.auth.pass"), true)
        assert.equal(isSecretPath("mail.smtp.auth.user"), true)
        assert.equal(isSecretPath("mail.provider"), false)
        assert.equal(isSecretPath("mail.from"), false)
    })

    Test.it("CONFIG-02 CLI get/set/unset writes the config with coercion", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-cfg-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const cwd = join(scratch, "shop")
        const run = (args) => spawnSync(process.execPath, [BIN, "config", ...args], { cwd, encoding: "utf8" })
        const read = () => JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8"))

        assert.equal(run(["get", "database.engine"]).stdout.trim(), "sqlite")
        run(["set", "database.engine", "turso"])
        assert.equal(read().database.engine, "turso")
        run(["set", "foo.count", "42"]) // JSON-coerced to a number
        assert.equal(read().foo.count, 42)
        run(["set", "foo.ver", "42", "--string"]) // forced string
        assert.equal(read().foo.ver, "42")
        run(["unset", "foo.count"])
        assert.equal("count" in read().foo, false)
        // usage errors
        assert.equal(spawnSync(process.execPath, [BIN, "config", "set", "onlykey", "--json"], { cwd, encoding: "utf8" }).status, 2)
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("CONFIG-03 secrets are masked in list/get unless --show-secrets", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-cfgs-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const cwd = join(scratch, "shop")
        const run = (args) => spawnSync(process.execPath, [BIN, "config", ...args, "--json"], { cwd, encoding: "utf8" })
        spawnSync(process.execPath, [BIN, "config", "set", "token_secret", "topsecret"], { cwd })

        assert.equal(JSON.parse(run(["list"]).stdout).config.token_secret, "***")
        assert.equal(JSON.parse(run(["get", "token_secret"]).stdout).value, "***")
        assert.equal(JSON.parse(run(["get", "token_secret", "--show-secrets"]).stdout).value, "topsecret")
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
})
