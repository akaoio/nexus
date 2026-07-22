/**
 * nexus create <dir> — scaffold a new Nexus instance.
 *
 * Safety by default (§5.2 rule 4): an existing non-empty directory is
 * refused, never overwritten. Dogfood (§5.2 rule 1): the scaffolded model
 * is validated through the public Model API before it is written — the CLI
 * cannot ship a starter schema the framework itself rejects.
 */

import { existsSync, readdirSync, mkdirSync, writeFileSync } from "fs"
import { resolve, basename, join } from "path"
import { createInterface } from "readline/promises"
import { validate } from "../../core/Model.js"
import { ENGINES } from "../../core/Data/adapters.js"
import { MODELS, NL_MODELS, pull } from "../../core/App/models.js"

/** Ask a free-text question with a default (TTY only). */
async function ask(question, def) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        const answer = (await rl.question(def ? `${question} (${def}): ` : `${question}: `)).trim()
        return answer || def
    } finally {
        rl.close()
    }
}

/** Ask the user to pick one of `options`, returning `def` on empty/invalid. */
async function choose(question, options, def) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        process.stdout.write(`${question}:\n`)
        options.forEach((o, i) => process.stdout.write(`  ${i + 1}) ${o}${o === def ? " (default)" : ""}\n`))
        const answer = (await rl.question(`Choose 1-${options.length} [${options.indexOf(def) + 1}]: `)).trim()
        const n = Number(answer)
        return Number.isInteger(n) && n >= 1 && n <= options.length ? options[n - 1] : def
    } finally {
        rl.close()
    }
}

const STARTER_MODEL = {
    schemaVersion: 1,
    name: "task",
    label: { en: "Task", vi: "Công việc" },
    fields: [
        { name: "title", type: "text", required: true, label: { en: "Title", vi: "Tiêu đề" } },
        { name: "done", type: "boolean", default: false, label: { en: "Done", vi: "Xong" } },
        { name: "due", type: "date", label: { en: "Due", vi: "Hạn chót" } },
        { name: "priority", type: "select", options: ["low", "medium", "high"], default: "medium", label: { en: "Priority", vi: "Ưu tiên" } }
    ],
    // A semantic block so search works the moment an AI model is configured
    // (§4.6c). Without this an Entity has nothing to embed — the reason search
    // "didn't work" out of the box.
    semantic: { embed: [{ field: "title", weight: 2 }], template: { en: "{title}", vi: "{title}" } },
    // Views are OPT-IN per entity (never automatic) — the starter declares both.
    views: ["list", "kanban"]
}

export async function create(args, flags, out) {
    // Interactive only in a real terminal (never in --json, with --yes, or when
    // piped) — so CI and the conformance suite stay fully non-interactive.
    const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY && !flags.json && flags.yes !== true

    let dir = args[0]
    if (!dir && interactive) dir = await ask("Instance directory", "my-app")
    if (!dir) {
        out.error("Missing target directory: nexus create <dir>", { code: "E_USAGE" })
        process.exitCode = 2
        return
    }

    // Database engine — an explicit --engine wins (validated); otherwise prompt
    // in a TTY, else the zero-install default. Recorded in nexus.config.json so
    // the choice is real (Strapi-style DX, without the mandatory wizard).
    let engine = "sqlite"
    if (flags.engine !== undefined) {
        if (!ENGINES.includes(flags.engine)) {
            out.error(`Unknown engine "${flags.engine}" (choose: ${ENGINES.join(", ")})`, { code: "E_USAGE" })
            process.exitCode = 2
            return
        }
        engine = flags.engine
    } else if (interactive) {
        engine = await choose("Database engine", ENGINES, "sqlite")
    }

    // AI (embedding) model — first-class in Nexus (§4.6). --model sets it;
    // interactive picks from the curated list; "none" = keyword search only.
    let aiModel = null
    // typeof guards the trailing value-less flag (parseArgs falls back to boolean true)
    if (flags.model !== undefined) aiModel = typeof flags.model === "string" && flags.model !== "none" ? flags.model : null
    else if (interactive) {
        const opts = [...MODELS.map((m) => `${m.name} — ${m.note} (${m.size})`), "none — keyword search only"]
        const picked = await choose("Embedding / AI model", opts, opts[0])
        const idx = opts.indexOf(picked)
        aiModel = idx >= 0 && idx < MODELS.length ? MODELS[idx].id : null
    }

    // NL (function calling) model — tier 4 of NL→AST. --nl-model sets it;
    // the wizard defaults to FunctionGemma; without a TTY nothing is written
    // (CI never surprise-downloads ~300 MB of weights).
    let nlModel = null
    if (flags["nl-model"] !== undefined) nlModel = typeof flags["nl-model"] === "string" && flags["nl-model"] !== "none" ? flags["nl-model"] : null
    else if (interactive) {
        const opts = [...NL_MODELS.map((m) => `${m.name} — ${m.note} (${m.size})`), "none — rule/retrieval tiers only"]
        const picked = await choose("NL (function calling) model", opts, opts[0])
        const idx = opts.indexOf(picked)
        nlModel = idx >= 0 && idx < NL_MODELS.length ? NL_MODELS[idx].id : null
    }

    const target = resolve(process.cwd(), dir)
    if (existsSync(target) && readdirSync(target).length > 0) {
        out.error(`Directory not empty, refusing to overwrite: ${dir}`, { code: "E_NOT_EMPTY" })
        out.hint("Nexus never destroys existing data — pick a new directory")
        process.exitCode = 1
        return
    }

    // The scaffold must pass the framework's own validation — always.
    const result = validate(STARTER_MODEL)
    if (!result.valid) throw new Error(`internal: starter model invalid — ${JSON.stringify(result.errors)}`)

    const name = basename(target).toLowerCase().replace(/[^a-z0-9_-]/g, "-")
    const site = typeof flags.site === "string" && flags.site ? flags.site : interactive ? await ask("Site name", name) : name

    const files = {
        "package.json": {
            name,
            private: true,
            type: "module",
            scripts: { dev: "nexus dev", test: "nexus test" }
        },
        "nexus.config.json": {
            configVersion: 1,
            site: { name: site, locale: "en" },
            database: { engine },
            ...(aiModel || nlModel
                ? { semantic: { ...(aiModel ? { model: aiModel } : {}), ...(nlModel ? { nlModel } : {}) } }
                : {})
        },
        "apps/starter/manifest.json": {
            manifestVersion: 1,
            name: "starter",
            version: "0.1.0"
        },
        "apps/starter/models/task.json": STARTER_MODEL,
        "apps/starter/hooks.js": `/**
 * Starter extension points — hooks, an endpoint, a CLI command.
 * See the Nexus App API: hooks may mutate/veto, endpoints mount under
 * /api/v1/_/<path>, commands run as \`nexus <name>\`.
 */
export default ({ hook, endpoint, command }) => {
    hook("task", "before:create", (payload) => {
        if (typeof payload.data.title === "string") payload.data.title = payload.data.title.trim()
    })

    endpoint("GET", "stats", async ({ plane, ctx }) => {
        const rows = await plane.list("task", {}, ctx)
        return { total: rows.length, done: rows.filter((row) => row.done).length }
    })

    command("hello", {
        description: "Say hello from the starter app",
        run: ({ out }) => out.print("hello from starter")
    })
}
`,
        "README.md": `# ${site}\n\nA [Nexus](https://github.com/akaoio/nexus) instance.\n\n- \`nexus dev\` — serve locally\n- \`nexus test\` — validate schemas\n`,

        // Generated files, and only generated files. public/studio/ is the
        // built Studio this command is about to write — four hundred-odd
        // copied modules that are reproducible from `nexus studio build` and
        // have no business in a diff. It is listed here BECAUSE we build it:
        // the alternative was dropping that many artefacts into a directory
        // the user is about to `git init`.
        ".gitignore": [
            "# generated — reproducible with `nexus studio build`",
            "public/studio/",
            "",
            "# runtime",
            "*.db",
            "*.db-wal",
            "*.db-shm",
            ".data/",
            ".certs/",
            "",
            "# dependencies",
            "node_modules/",
            ""
        ].join("\n")
    }

    const created = []
    for (const [relative, content] of Object.entries(files)) {
        const path = join(target, relative)
        mkdirSync(join(path, ".."), { recursive: true })
        writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 4) + "\n")
        created.push(relative)
    }

    out.print(`${out.green("✓")} Created Nexus instance ${out.bold(site)} in ${out.cyan(dir)} ${out.dim(`· ${engine}${aiModel ? " · " + aiModel : ""}${nlModel ? " · " + nlModel : ""}`)}`)
    out.print("")
    for (const file of created) out.print(`  ${out.dim("+")} ${file}`)
    out.print("")

    // AI models: in a terminal, offer to install + download them right now.
    const downloads = [aiModel, nlModel].filter(Boolean)
    if (downloads.length && interactive) {
        const yes = await ask(`Download ${downloads.join(" + ")} now? installs @huggingface/transformers + weights [y/N]`, "N")
        if (/^y/i.test(yes)) {
            for (const id of downloads) {
                out.print(`${out.dim("↓")} pulling ${id} — this can take a while…`)
                try {
                    const pulled = await pull(target, id)
                    out.print(`${out.green("✓")} model ready${pulled.dims ? ` (${pulled.dims}d)` : ""}`)
                } catch (error) {
                    out.print(`${out.yellow("!")} pull failed: ${error.message} — run \`nexus model pull\` later`)
                }
            }
        }
    }

    out.print(`${out.bold("Next steps")}`)
    out.print(`  cd ${dir}`)
    if (engine !== "sqlite") out.print(`  npm install ${engine === "turso" ? "@tursodatabase/database" : engine === "postgres" ? "pg" : "mysql2"}   ${out.dim(`driver for ${engine}`)}`)
    if (aiModel || nlModel) out.print(`  nexus model pull   ${out.dim(`install + download ${[aiModel, nlModel].filter(Boolean).join(" + ")}`)}`)
    out.print(`  nexus test    ${out.dim("validate the starter schemas")}`)
    out.print(`  nexus dev     ${out.dim("serve the instance")}`)
    // NOT built for you, and not an oversight. `nexus start` serves the built
    // Studio at the SITE ROOT, before login, with every schema document baked
    // into its shell — field names, types, permlevels. That is a reconnaissance
    // surface worth having when you want an admin UI in production, and worth
    // NOT having by default. So it stays a decision, and this is the line that
    // makes the decision visible instead of leaving `nexus start` to 404 every
    // Studio route at someone who has no reason to know the command exists.
    out.print(`  nexus studio build   ${out.dim("optional · an admin UI under `nexus start` (dev already has one)")}`)
    out.emit({ ok: true, site, dir, engine, model: aiModel, nlModel, created })
}
