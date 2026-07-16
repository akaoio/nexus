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
import { validate } from "../../model/Model.js"

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
    const dir = args[0]
    if (!dir) {
        out.error("Missing target directory: nexus create <dir>", { code: "E_USAGE" })
        process.exitCode = 2
        return
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
    const site = typeof flags.site === "string" && flags.site ? flags.site : name

    const files = {
        "package.json": {
            name,
            private: true,
            type: "module",
            scripts: { dev: "nexus dev", test: "nexus test" }
        },
        "nexus.config.json": {
            configVersion: 1,
            site: { name: site, locale: "en" }
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

    out.print(`${out.green("✓")} Created Nexus instance ${out.bold(site)} in ${out.cyan(dir)}`)
    out.print("")
    for (const file of created) out.print(`  ${out.dim("+")} ${file}`)
    out.print("")
    out.print(`${out.bold("Next steps")}`)
    out.print(`  cd ${dir}`)
    out.print(`  nexus test    ${out.dim("validate the starter schemas")}`)
    out.print(`  nexus dev     ${out.dim("serve the instance")}`)
    out.emit({ ok: true, site, dir, created })
}
