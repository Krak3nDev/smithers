/** @jsxImportSource smthrs */
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Task, Workflow, runWorkflow } from "smthrs";
import { ClaudeCodeAgent } from "@smthrs/agents";
import { createTestSmithers } from "../../smithers/tests/helpers.js";
import { outputSchemas } from "../../smithers/tests/schema.js";

// These use a REAL ClaudeCodeAgent so the flag under test comes from the actual
// constructor, and stub only `generate` so no CLI is spawned. What is being
// verified is the seam between the agent's declared capability and the engine's
// prompt-injection fallback -- see the `does not support native structured
// output` branch in engine.js.

/**
 * @param {boolean} native
 */
function makeAgent(native) {
  const agent = new ClaudeCodeAgent(native ? { model: "m", nativeStructuredOutput: true } : { model: "m" });
  const prompts = [];
  agent.generate = async (args) => {
    prompts.push(args.prompt);
    return {
      text: JSON.stringify({ value: 42 }),
      output: { value: 42 },
      response: { messages: [{ role: "assistant", content: "done" }] },
    };
  };
  return { agent, prompts };
}

/**
 * @param {any} agent
 * @param {string} runId
 */
async function run(agent, runId) {
  const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);
  try {
    const workflow = smithers(() => (
      <Workflow name="claude-native-structured-output">
        <Task id="plan" output={outputs.outputA} agent={agent}>
          produce a value
        </Task>
      </Workflow>
    ));
    const result = await Effect.runPromise(runWorkflow(workflow, { input: {}, runId }));
    return result;
  } finally {
    cleanup();
  }
}

test("opted in, ClaudeCodeAgent skips the engine's prompt-injection fallback", async () => {
  const { agent, prompts } = makeAgent(true);
  expect(agent.supportsNativeStructuredOutput).toBe(true);

  const result = await run(agent, "claude-native-on");

  expect(result.status).toBe("finished");
  // The prompt reaches the agent verbatim: no REQUIRED OUTPUT block, no schema
  // shape appended. Under the fallback the engine rewrites it.
  expect(prompts).toEqual(["produce a value"]);
  expect(prompts[0]).not.toContain("REQUIRED OUTPUT");
});

test("not opted in, the engine still prompt-injects the schema (unchanged behaviour)", async () => {
  const { agent, prompts } = makeAgent(false);
  expect(agent.supportsNativeStructuredOutput).toBe(false);

  const result = await run(agent, "claude-native-off");

  expect(result.status).toBe("finished");
  // Backward compatibility: without the opt-in the prompt is still rewritten,
  // which is exactly what existing pipelines are calibrated against.
  expect(prompts[0]).toContain("REQUIRED OUTPUT");
});
