#!/usr/bin/env bun
/**
 * Turn eval result files into something you can act on.
 *
 *   bun evals/report.ts evals/results/<runId>.json          # score the run
 *   bun evals/report.ts --compare base.json candidate.json  # A/B a change
 *
 * Two questions get answered. "Which model is enough?" — the model table
 * ranks by score and by cost-per-point, so a cheap model that fails half the
 * grid stops looking cheap. "Did my harness change actually help?" — the
 * compare mode judges each task against a 2σ noise floor built from the
 * repeats, because a single run of a stochastic agent proves nothing.
 *
 * A baseline run (`run.ts --baseline`, no agent) is scored too: any task a
 * do-nothing agent already passes is flagged as measuring nothing.
 */
import type { CellResult } from "./score.core"
import {
  costPerPoint,
  mean,
  scoreOf,
  summariseByModel,
  summariseByTask,
  trivialTasks,
  verdictOf,
} from "./score.core"

interface RunFile {
  readonly runId: string
  readonly label?: string
  readonly suite: string
  readonly models: ReadonlyArray<string>
  readonly repeats: number
  readonly baseline?: boolean
  readonly ref?: string
  readonly permissionMode?: string
  readonly cells: ReadonlyArray<CellResult>
}

const argv = Bun.argv.slice(2)

const readRun = async (path: string): Promise<RunFile> =>
  JSON.parse(await Bun.file(path).text()) as RunFile

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`
const usd = (value: number): string => `$${value.toFixed(3)}`
const mins = (ms: number): string => `${(ms / 60_000).toFixed(1)}m`

const row = (cells: ReadonlyArray<string>): string => `| ${cells.join(" | ")} |`

const table = (input: {
  readonly headers: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
}): string =>
  [
    row(input.headers),
    row(input.headers.map(() => "---")),
    ...input.rows.map((cells) => row(cells)),
  ].join("\n")

const modelSection = (cells: ReadonlyArray<CellResult>): string => {
  const summaries = [...summariseByModel(cells)].sort((a, b) => b.meanScore - a.meanScore)
  return table({
    headers: ["model", "cells", "fully green", "mean score", "±σ", "$/cell", "$/point", "min/cell"],
    rows: summaries.map((summary) => [
      summary.model,
      String(summary.cells),
      pct(summary.passRate),
      summary.meanScore.toFixed(3),
      summary.scoreStdev.toFixed(3),
      usd(summary.meanCostUsd),
      Number.isFinite(costPerPoint(summary)) ? usd(costPerPoint(summary)) : "∞",
      mins(summary.meanDurationMs),
    ]),
  })
}

const matrixSection = (cells: ReadonlyArray<CellResult>): string => {
  const rows = summariseByTask(cells)
  const models = [...new Set(cells.map((cell) => cell.model))]
  const taskIds = [...new Set(cells.map((cell) => cell.taskId))]
  return table({
    headers: ["task", "archetype", ...models],
    rows: taskIds.map((taskId) => {
      const forTask = rows.filter((entry) => entry.taskId === taskId)
      return [
        taskId,
        forTask.at(0)?.archetype ?? "",
        ...models.map((model) => {
          const entry = forTask.find((candidate) => candidate.model === model)
          return entry === undefined
            ? "–"
            : `${entry.meanScore.toFixed(2)} (${pct(entry.passRate)})`
        }),
      ]
    }),
  })
}

const failureSection = (cells: ReadonlyArray<CellResult>): string => {
  const rows = summariseByTask(cells).filter((entry) => entry.failedChecks.length > 0)
  if (rows.length === 0) return "_No failing checks._"
  return table({
    headers: ["task", "model", "failed checks"],
    rows: rows.map((entry) => [entry.taskId, entry.model, entry.failedChecks.join("<br>")]),
  })
}

const errorSection = (cells: ReadonlyArray<CellResult>): string => {
  const errored = cells.filter((cell) => cell.agentError !== null)
  if (errored.length === 0) return ""
  return `\n## Agent errors\n\n${table({
    headers: ["task", "model", "error"],
    rows: errored.map((cell) => [cell.taskId, cell.model, cell.agentError ?? ""]),
  })}\n`
}

const trivialSection = (run: RunFile): string => {
  const flagged = trivialTasks({ baseline: run.cells })
  if (!run.baseline) return ""
  if (flagged.length === 0) {
    return "\n**Baseline check: every task fails without an agent — the grid measures real work.**\n"
  }
  return `\n**Baseline check: these tasks score >=0.75 with NO agent — sharpen their asserts.**\n\n${table(
    {
      headers: ["task", "no-op score"],
      rows: flagged.map((task) => [task.taskId, task.noOpScore.toFixed(2)]),
    },
  )}\n`
}

const headline = (run: RunFile): string => {
  const suffix = run.baseline ? " · **BASELINE (no agent)**" : ""
  return `suite \`${run.suite}\` · ${run.cells.length} cells · repeats ${run.repeats} · ref \`${run.ref ?? "?"}\` · permission \`${run.permissionMode ?? "?"}\`${suffix}`
}

const titleOf = (run: RunFile): string =>
  `# Eval run ${run.runId}${run.label === undefined || run.label === "" ? "" : ` — ${run.label}`}`

const single = async (path: string): Promise<string> => {
  const run = await readRun(path)
  const overall = mean(run.cells.map((cell) => scoreOf(cell.checks)))
  const spend = run.cells.reduce((sum, cell) => sum + cell.costUsd, 0)
  return [
    titleOf(run),
    "",
    headline(run),
    "",
    `**mean score ${overall.toFixed(3)} · total spend ${usd(spend)}**`,
    trivialSection(run),
    "\n## By model\n",
    modelSection(run.cells),
    "\n## Task × model\n",
    matrixSection(run.cells),
    "\n## What failed\n",
    failureSection(run.cells),
    errorSection(run.cells),
  ].join("\n")
}

const scoresFor = (input: {
  readonly cells: ReadonlyArray<CellResult>
  readonly taskId: string
}): ReadonlyArray<number> =>
  input.cells.filter((cell) => cell.taskId === input.taskId).map((cell) => scoreOf(cell.checks))

const signed = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`

const ADVICE: Record<string, string> = {
  noise:
    "_Inside the noise floor: keep the change only if it is right on its own merits, and add repeats before claiming a win._",
  improved: "_Real improvement: keep it and ratchet the floor._",
  regressed: "_Real regression: revert the harness change._",
}

const named = (run: RunFile): string =>
  `\`${run.runId}\`${run.label === undefined || run.label === "" ? "" : ` (${run.label})`}`

const compare = async (input: {
  readonly basePath: string
  readonly candidatePath: string
}): Promise<string> => {
  const base = await readRun(input.basePath)
  const candidate = await readRun(input.candidatePath)
  const taskIds = [...new Set([...base.cells, ...candidate.cells].map((cell) => cell.taskId))]
  const compared = taskIds.map((taskId) => ({
    taskId,
    baseScores: scoresFor({ cells: base.cells, taskId }),
    candidateScores: scoresFor({ cells: candidate.cells, taskId }),
  }))
  // A task only one side ran is not a regression — it is missing data.
  const bothRan = compared.filter(
    (entry) => entry.baseScores.length > 0 && entry.candidateScores.length > 0,
  )
  const skipped = compared
    .filter((entry) => entry.baseScores.length === 0 || entry.candidateScores.length === 0)
    .map((entry) => entry.taskId)
  const perTask = bothRan.map((entry) => {
    const verdict = verdictOf({ base: entry.baseScores, candidate: entry.candidateScores })
    return [
      entry.taskId,
      mean(entry.baseScores).toFixed(2),
      mean(entry.candidateScores).toFixed(2),
      signed(verdict.delta),
      `±${verdict.threshold.toFixed(2)}`,
      verdict.label,
    ]
  })
  const comparableIds = bothRan.map((entry) => entry.taskId)
  const overall = verdictOf({
    base: base.cells
      .filter((cell) => comparableIds.includes(cell.taskId))
      .map((cell) => scoreOf(cell.checks)),
    candidate: candidate.cells
      .filter((cell) => comparableIds.includes(cell.taskId))
      .map((cell) => scoreOf(cell.checks)),
  })
  return [
    "# Eval comparison",
    "",
    `base ${named(base)} → candidate ${named(candidate)}`,
    "",
    `**overall ${signed(overall.delta)} against a ±${overall.threshold.toFixed(3)} noise floor → ${overall.label.toUpperCase()}**`,
    "",
    ADVICE[overall.label] ?? "",
    "",
    table({
      headers: ["task", "base", "candidate", "delta", "noise floor", "verdict"],
      rows: perTask,
    }),
    skipped.length === 0 ? "" : `\n_Not compared (only one side ran): ${skipped.join(", ")}._`,
  ].join("\n")
}

/** `--score` prints the bare mean score — the number a hill-climbing loop reads. */
const scoreOnly = async (path: string): Promise<string> => {
  const run = await readRun(path)
  return mean(run.cells.map((cell) => scoreOf(cell.checks))).toFixed(4)
}

const compareAt = argv.indexOf("--compare")
const comparison = async (): Promise<string> =>
  compare({
    basePath: argv[compareAt + 1] ?? "",
    candidatePath: argv[compareAt + 2] ?? "",
  })

const oneRun = async (): Promise<string> =>
  argv.includes("--score") ? scoreOnly(argv[0] ?? "") : single(argv[0] ?? "")

const text = compareAt === -1 ? await oneRun() : await comparison()

const outAt = argv.indexOf("--out")
if (outAt === -1) await Bun.write(Bun.stdout, `${text}\n`)
else await Bun.write(argv[outAt + 1] ?? "report.md", `${text}\n`)
