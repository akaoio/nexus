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
import { validate } from "../../model/Model.js"
import { ENGINES } from "../../data/adapters.js"

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
        { name: "done", type: "boolean", default: false },
        { name: "due", type: "date" },
        { name: "priority", type: "select", options: ["low", "medium", "high"], default: "medium" }
    ]
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
            database: { engine }
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
        "README.md": `# ${site}\n\nA [Nexus](https://github.com/akaoio/nexus) instance.\n\n- \`nexus dev\` — serve locally\n- \`nexus test\` — validate schemas\n`
    }

    const created = []
    for (const [relative, content] of Object.entries(files)) {
        const path = join(target, relative)
        mkdirSync(join(path, ".."), { recursive: true })
        writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 4) + "\n")
        created.push(relative)
    }

    out.print(`${out.green("✓")} Created Nexus instance ${out.bold(site)} in ${out.cyan(dir)} ${out.dim(`· ${engine}`)}`)
    out.print("")
    for (const file of created) out.print(`  ${out.dim("+")} ${file}`)
    out.print("")
    out.print(`${out.bold("Next steps")}`)
    out.print(`  cd ${dir}`)
    if (engine !== "sqlite") out.print(`  npm install ${engine === "turso" ? "@tursodatabase/database" : engine === "postgres" ? "pg" : "mysql2"}   ${out.dim(`driver for ${engine}`)}`)
    out.print(`  nexus test    ${out.dim("validate the starter schemas")}`)
    out.print(`  nexus dev     ${out.dim("serve the instance")}`)
    out.emit({ ok: true, site, dir, engine, created })
}
