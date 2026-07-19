/**
 * Mail provider seam (design §5): the kernel defines the interface; the
 * transport is the INSTANCE's business (N2 — the transformers.js pattern).
 * "log" is the zero-dep default so dev/CI never need SMTP.
 */

export function mailProvider(config = {}, root = process.cwd()) {
    const kind = config.mail?.provider ?? "log"
    if (kind === "smtp") {
        let nodemailer
        try {
            const { createRequire } = process.getBuiltinModule("module")
            const { join } = process.getBuiltinModule("path")
            nodemailer = createRequire(join(root, "package.json"))("nodemailer")
        } catch {
            throw new Error("E_PROVIDER: the smtp provider needs nodemailer — run: npm install nodemailer")
        }
        const transport = nodemailer.createTransport(config.mail?.smtp ?? {})
        return { send: async (mail) => { const info = await transport.sendMail({ from: config.mail?.from, ...mail }); return { id: info.messageId } } }
    }
    return { send: async ({ to, subject }) => { console.log(`mail(log): to=${to} subject=${subject}`); return { id: "log-" + Date.now() } } }
}

export default { mailProvider }
