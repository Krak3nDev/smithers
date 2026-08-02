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
  test("targets draft-07, not 2020-12", async () => {
    const schema = await zodToClaudeCodeSchema(OUTPUT_SCHEMA);
    // Claude Code validates against draft-07 and (since 2.1.205) aborts on a
    // schema it rejects, so a newer dialect is a run-time failure, not a nit.
    expect(String(schema.$schema ?? "")).not.toContain("2020-12");
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

  test("wires the task schema into --json-schema and reserves turns for it", async () => {
    const command = await new ClaudeCodeAgent({ model: "m", nativeStructuredOutput: true }).buildCommand(call);

    expect(command.args).toContain("--json-schema");
    const emitted = JSON.parse(flagValue(command.args, "--json-schema"));
    expect(emitted.properties.items.maxItems).toBe(2);

    // --json-schema is delivered through a tool call: one turn starves it, and
    // 3 was measured to fail with error_max_turns on a constrained schema.
    expect(Number(flagValue(command.args, "--max-turns"))).toBeGreaterThan(3);
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

  test("an explicit maxTurns wins over the native-mode default", async () => {
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
    const interp = new ClaudeCodeAgent({ model: "m" }).createOutputInterpreter();
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
    const interp = new ClaudeCodeAgent({ model: "m" }).createOutputInterpreter();
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

  test("falls back to the result string when there is no structured_output", () => {
    const interp = new ClaudeCodeAgent({ model: "m" }).createOutputInterpreter();
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
