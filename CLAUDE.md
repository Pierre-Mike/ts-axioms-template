# CLAUDE.md — ts-axioms template

The canon is tool-neutral and lives in `AGENTS.md`; the import below loads it
into Claude Code, and every other agent reads `AGENTS.md` directly. Edit
`AGENTS.md`, never this file — `scripts/docs-sync.test.ts` fails the build if
this file stops being a plain redirect or grows its own copy of the rules.

@AGENTS.md
