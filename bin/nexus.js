#!/usr/bin/env node
// silence vendored ZEN's "No localStorage" notice before any module pulls it in
process.env.ZEN_SILENCE_TEST_WARNINGS ??= "1"
const { main } = await import("../src/cli/main.js")

main(process.argv.slice(2))
