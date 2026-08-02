# Fork notes

Fork of [smithersai/smithers](https://github.com/smithersai/smithers).

| | |
|---|---|
| Upstream | `https://github.com/smithersai/smithers` (remote `upstream`) |
| Base commit | `28473094241d26bb3cd430a677f87a1027351617` (2026-08-01, v0.33.0) |
| Branch | `feat/claude-code-native-structured-output` |
| Tracking issue | FIN-26 |

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
`maxItems` and `maxLength` are just *text in the prompt* — a request. Under Claude
Code's native `--json-schema` they are *enforced*: a prompt asking for six detailed
items against a `maxItems: 2` schema returns two short ones. The schema beats the
prompt.

We rely on that difference: a review pipeline uses the prescan schema as a **context
budget**, and its output feeds the stable prefix of every downstream call. A budget
that can be talked out of is not a budget.

## What changed

Confined to `packages/agents` on purpose — declaring
`supportsNativeStructuredOutput = true` on the agent lands in a branch the engine
already has, so `packages/engine` needs no edit. Keeping the delta in one package is
what makes rebasing onto a fast-moving upstream cheap.

| File | Change |
|---|---|
| `packages/agents/src/ClaudeCodeAgentOptions.ts` | new `nativeStructuredOutput?: boolean` and `maxTurns?: number` options |
| `packages/agents/src/ClaudeCodeAgent.js` | sets `supportsNativeStructuredOutput` from the opt-in flag; wires the call's `outputSchema` into `--json-schema`; emits `--max-turns`; prefers `structured_output` over the `result` string |
| `packages/agents/src/zodToClaudeCodeSchema.js` | **new** — Zod → JSON Schema targeting **draft-07** |
| `packages/agents/src/index.js` | exports the new converter |
| `packages/agents/tests/claude-native-structured-output.test.js` | **new** — covers the above |

### Design notes

- **Opt-in, never default.** Existing pipelines are calibrated against the
  prompt-injection path, and it leaves the prompt untouched. Mirrors how `CodexAgent`
  gates the same capability.
- **The trade-off differs from Codex.** `codex exec --output-schema` constrains every
  token and makes the model refuse tool calls, which breaks agentic tasks. Claude Code
  delivers the value through a *tool call* instead, so the cost is turns, not tool
  access — hence `maxTurns` defaulting to 6 in native mode. The default is measured,
  not guessed: against a prompt asking for six long items under a
  `maxItems: 2` / `maxLength: 60` schema, 3 turns fails with `error_max_turns` and 4
  is exactly enough, so the default keeps headroom above that boundary.
- **draft-07 is load-bearing.** Zod's default conversion target is 2020-12 and Claude
  Code rejects that dialect; since 2.1.205 a rejected schema aborts the CLI instead of
  silently degrading. `zodToOpenAISchema` is deliberately not reused: it targets
  2020-12 and then applies `sanitizeForOpenAI`, whose rewrites encode OpenAI's
  dialect.
- **Result plumbing already existed.** `BaseCliAgent` derives `output` by parsing the
  answer text and passes it to `buildGenerateResult`, which the engine reads as
  `result.output`. The only gap was that an early stop can leave `result` null while
  `structured_output` holds the value, so the interpreter now prefers the latter and
  re-serializes it into the existing path.

## Rebasing onto upstream

```bash
git fetch upstream
git rebase upstream/main
pnpm install && pnpm --filter @smthrs/agents test
```

The delta touches four files in one package; conflicts should be confined to
`ClaudeCodeAgent.js` argument assembly and the options type.

## Upstreaming

The change is opt-in and additive, so it is a reasonable upstream PR. This fork exists
to unblock work now, not to diverge permanently — if the change lands upstream, the
fork collapses back to a plain dependency.
