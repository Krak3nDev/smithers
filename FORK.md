# Fork notes

Fork of [smithersai/smithers](https://github.com/smithersai/smithers).

|                |                                                                  |
| -------------- | ---------------------------------------------------------------- |
| Upstream       | `https://github.com/smithersai/smithers` (remote `upstream`)     |
| Base commit    | `28473094241d26bb3cd430a677f87a1027351617` (2026-08-01, v0.33.0) |
| Branch         | `feat/claude-code-native-structured-output`                      |
| Tracking issue | FIN-26                                                           |

## Why this fork exists

Smithers enforces a Task's output schema differently per agent. `ClaudeCodeAgent` did
not declare `supportsNativeStructuredOutput`, so the engine fell back to
prompt-injection + text JSON extraction (`packages/engine/src/engine.js`, the
`does not support native structured output` branch): it appends a
`**REQUIRED OUTPUT** — You MUST return ONLY a raw JSON object matching this schema: …`
block to the prompt, greps JSON out of the reply, `safeParse`s it, and re-asks up to
three times. The engine's own log calls this a fallback and warns that
"schema validity does not guarantee meaningful output".

That is weaker than it looks. Under prompt-injection, schema constraints such as
`maxItems` and `maxLength` are just _text in the prompt_ — a request. Under Claude
Code's native `--json-schema` they are _enforced_: a prompt asking for six detailed
items against a `maxItems: 2` schema returns two short ones. The schema beats the
prompt.

We rely on that difference: a review pipeline uses the prescan schema as a **context
budget**, and its output feeds the stable prefix of every downstream call. A budget
that can be talked out of is not a budget.

## What changed

No `packages/engine` **source** is modified — declaring
`supportsNativeStructuredOutput = true` on the agent lands in a branch the engine
already has. That is what keeps rebasing onto a fast-moving upstream cheap. One test
file is _added_ under `packages/engine/tests`, which costs nothing at rebase time
(no upstream counterpart to conflict with) and is the only place the agent↔engine
seam can actually be observed.

| File                                                                  | Change                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agents/src/ClaudeCodeAgentOptions.ts`                       | new `nativeStructuredOutput?: boolean` and `maxTurns?: number` options                                                                                                                                               |
| `packages/agents/src/ClaudeCodeAgent.js`                              | sets `supportsNativeStructuredOutput` from the opt-in flag; wires the call's `outputSchema` into `--json-schema`; passes through `maxTurns`; prefers `structured_output` over the `result` string (native mode only) |
| `packages/agents/src/zodToClaudeCodeSchema.js`                        | **new** — Zod → JSON Schema targeting **draft-07**                                                                                                                                                                   |
| `packages/agents/src/index.js`                                        | exports the new converter                                                                                                                                                                                            |
| `packages/agents/src/index.d.ts`                                      | regenerated (`pnpm -C packages/agents run build`) — committed declarations are checked in CI by `scripts/check-dts.mjs`, and TS consumers cannot reach the new options without it                                    |
| `packages/agents/tests/claude-native-structured-output.test.js`       | **new** — options, argv, schema conversion, result handling                                                                                                                                                          |
| `packages/engine/tests/claude-code-native-structured-output.test.jsx` | **new** — asserts both directions of the engine's fallback branch with a real agent instance                                                                                                                         |

### Design notes

- **Opt-in, never default.** Existing pipelines are calibrated against the
  prompt-injection path, and it leaves the prompt untouched. Mirrors how `CodexAgent`
  gates the same capability.
- **The trade-off differs from Codex.** `codex exec --output-schema` constrains every
  token and makes the model refuse tool calls, which breaks agentic tasks. Claude Code
  delivers the value through a _tool call_ instead, so the cost is a few turns rather
  than tool access.
- **No default turn cap.** An earlier revision defaulted `--max-turns` in native mode.
  That was wrong: the CLI imposes no restrictive limit of its own (verified — the same
  constrained schema completes without the flag, using 4 turns), so the default solved
  nothing while capping long agentic runs, and exhausting it surfaces as an opaque
  "Claude run failed" with no mention of turn exhaustion. `maxTurns` is now an option
  with no default. A value of `1` starves the schema tool call.
- **draft-07 is load-bearing.** Zod's default conversion target is 2020-12 and Claude
  Code rejects that dialect; since 2.1.205 a rejected schema aborts the CLI instead of
  silently degrading. `zodToOpenAISchema` is deliberately not reused: it targets
  2020-12 and then applies `sanitizeForOpenAI`, whose rewrites encode OpenAI's
  dialect.
- **`additionalProperties` is the schema author's call, not the converter's.** A plain
  `z.object({...})` converts without `additionalProperties`; `.strict()` converts to
  `additionalProperties: false`. The converter passes that through rather than forcing
  strictness, which would override the author and could reject otherwise-valid output.
  So a schema used as a context budget should bound both shape (`.strict()`) and size
  (`maxItems` / `maxLength`).
- **Result plumbing already existed.** `BaseCliAgent` derives `output` by parsing the
  answer text and passes it to `buildGenerateResult`, which the engine reads as
  `result.output`. The only gap was that an early stop can leave `result` null while
  `structured_output` holds the value, so the interpreter now prefers the latter and
  re-serializes it into the existing path.

## Rebasing onto upstream

```bash
git fetch upstream
git rebase upstream/main
pnpm install
pnpm -C packages/agents run build   # regenerate committed .d.ts, or CI's check-dts fails
pnpm -C packages/agents test
node scripts/check-dts.mjs
```

Only three upstream files are _modified_ (`ClaudeCodeAgent.js`,
`ClaudeCodeAgentOptions.ts`, `index.js`) plus the generated `index.d.ts`; everything
else is added. Conflicts should be confined to the argument assembly in
`ClaudeCodeAgent.js` and the options type.

## Upstreaming

The change is opt-in and additive, so it is a reasonable upstream PR. This fork exists
to unblock work now, not to diverge permanently — if the change lands upstream, the
fork collapses back to a plain dependency.
