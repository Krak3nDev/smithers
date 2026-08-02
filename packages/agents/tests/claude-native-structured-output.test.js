import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ClaudeCodeAgent } from "../src/ClaudeCodeAgent.js";
import { zodToClaudeCodeSchema } from "../src/zodToClaudeCodeSchema.js";

/**
 * @param {string[]} args
 * @param {string} flag
 */
function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const OUTPUT_SCHEMA = z.object({
  items: z
    .array(
      z.object({
        name: z.string().max(30),
        note: z.string().max(60),
      }),
    )
    .max(2),
});

const call = { cwd: "/tmp/project", prompt: "list findings", options: { outputSchema: OUTPUT_SCHEMA } };

describe("zodToClaudeCodeSchema", () => {
  test("declares the draft-07 dialect exactly", async () => {
    const schema = await zodToClaudeCodeSchema(OUTPUT_SCHEMA);
    // Claude Code validates against draft-07 and (since 2.1.205) aborts on a
    // schema it rejects, so a newer dialect is a run-time failure, not a nit.
    // Pinned by equality on purpose: a "not 2020-12" assertion also passes for
    // any other dialect, and for no $schema at all.
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
  });

  test("preserves the constraints that make the schema a budget", async () => {
    const schema = await zodToClaudeCodeSchema(OUTPUT_SCHEMA);
    const items = schema.properties.items;
    expect(items.maxItems).toBe(2);
    expect(items.items.properties.name.maxLength).toBe(30);
    expect(items.items.properties.note.maxLength).toBe(60);
  });

  test("rejects a Zod v3 schema with an actionable error instead of a cryptic TypeError", async () => {
    // A plain object stands in for a v3 schema: it lacks the v4 `_zod` internals
    // that z.toJSONSchema() reads. The guard must fire in the test, not at run time.
    await expect(zodToClaudeCodeSchema(/** @type {any} */ ({ parse: () => {} }))).rejects.toThrow();
  });
});

describe("ClaudeCodeAgent native structured output", () => {
  test("is opt-in: off by default, on when requested", () => {
    expect(new ClaudeCodeAgent({ model: "m" }).supportsNativeStructuredOutput).toBe(false);
    expect(new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).supportsNativeStructuredOutput).toBe(true);
  });

  test("wires the task schema into --json-schema", async () => {
    const command = await new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).buildCommand(call);

    expect(command.args).toContain("--json-schema");
    const emitted = JSON.parse(flagValue(command.args, "--json-schema"));
    expect(emitted.properties.items.maxItems).toBe(2);
  });

  test("imposes no turn cap of its own", async () => {
    // Verified against the real CLI: --json-schema completes without --max-turns
    // (4 turns used). A default here would cap long agentic runs, and exhausting
    // it surfaces as an opaque "Claude run failed".
    const command = await new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).buildCommand(call);
    expect(command.args).not.toContain("--max-turns");
  });

  test("leaves the command untouched when the caller did not opt in", async () => {
    const command = await new ClaudeCodeAgent({ model: "m" }).buildCommand(call);
    expect(command.args).not.toContain("--json-schema");
    expect(command.args).not.toContain("--max-turns");
  });

  test("an explicit jsonSchema wins over the task schema", async () => {
    const explicit = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
    const command = await new ClaudeCodeAgent({
      model: "m",
      nativeStructuredOutput: true,
      jsonSchema: explicit,
    }).buildCommand(call);
    expect(flagValue(command.args, "--json-schema")).toBe(explicit);
  });

  test("an explicit maxTurns is passed through in native mode", async () => {
    const command = await new ClaudeCodeAgent({
      model: "m",
      nativeStructuredOutput: true,
      maxTurns: 9,
    }).buildCommand(call);
    expect(flagValue(command.args, "--max-turns")).toBe("9");
  });

  test("maxTurns is honoured without native mode too", async () => {
    const command = await new ClaudeCodeAgent({ model: "m", maxTurns: 5 }).buildCommand(call);
    expect(flagValue(command.args, "--max-turns")).toBe("5");
    expect(command.args).not.toContain("--json-schema");
  });

  test("omits --json-schema when opted in but the call carries no schema", async () => {
    const command = await new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).buildCommand({
      cwd: "/tmp/project",
      prompt: "no schema here",
      options: {},
    });
    expect(command.args).not.toContain("--json-schema");
  });
});

describe("ClaudeCodeAgent structured_output result handling", () => {
  test("prefers structured_output over the result string", () => {
    const interp = new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).createOutputInterpreter();
    const events = interp.onStdoutLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ignored prose",
        structured_output: { items: [{ name: "a", note: "b" }] },
        session_id: "sess-1",
      }),
    );
    const completed = events.find((e) => e.type === "completed");
    // Re-serialized so BaseCliAgent recovers it through text -> tryParseJson -> output.
    expect(JSON.parse(completed.answer)).toEqual({ items: [{ name: "a", note: "b" }] });
  });

  test("recovers the value when the run left result null", () => {
    const interp = new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).createOutputInterpreter();
    const events = interp.onStdoutLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: null,
        structured_output: { items: [] },
        session_id: "sess-2",
      }),
    );
    const completed = events.find((e) => e.type === "completed");
    expect(JSON.parse(completed.answer)).toEqual({ items: [] });
  });

  test("ignores structured_output entirely when not opted in", () => {
    // Callers who only set `jsonSchema` predate this feature; their result
    // interpretation must stay byte for byte what it was.
    const interp = new ClaudeCodeAgent({ model: "m" }).createOutputInterpreter();
    const events = interp.onStdoutLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "plain prose",
        structured_output: { items: [{ name: "a", note: "b" }] },
        session_id: "sess-4",
      }),
    );
    const completed = events.find((e) => e.type === "completed");
    expect(completed.answer).toBe("plain prose");
  });

  test("flags the case where a schema was sent but the tool was never called", async () => {
    // tool_choice is null on the wire, so StructuredOutput is offered rather than
    // forced and the model may decline -- observed on prompts unrelated to the
    // schema. That degradation must not be silent.
    const agent = new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true });
    await agent.buildCommand(call);
    expect(agent.sentNativeSchema).toBe(true);

    const interp = agent.createOutputInterpreter();
    const events = interp.onStdoutLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Here is a poem about the sea instead.",
        session_id: "sess-5",
      }),
    );
    const completed = events.find((e) => e.type === "completed");
    // Still surfaced as a successful answer -- the engine's own safeParse decides
    // what to do about it. The warning is the signal, not a control-flow change.
    expect(completed).toMatchObject({ ok: true, answer: "Here is a poem about the sea instead." });
  });

  test("does not flag a run where no schema was ever sent", async () => {
    const agent = new ClaudeCodeAgent({ model: "m" });
    await agent.buildCommand(call);
    expect(agent.sentNativeSchema).toBe(false);
  });

  test("falls back to the result string when there is no structured_output", () => {
    const interp = new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).createOutputInterpreter();
    const events = interp.onStdoutLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "all done",
        session_id: "sess-3",
      }),
    );
    const completed = events.find((e) => e.type === "completed");
    expect(completed).toMatchObject({ ok: true, answer: "all done", resume: "sess-3" });
  });
});
