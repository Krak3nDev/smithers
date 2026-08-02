import { assertZodV4 } from "@smthrs/errors/assertZodV4";
/**
 * Convert a Zod schema to a JSON Schema for Claude Code's `--json-schema`.
 *
 * Claude Code validates the schema against JSON Schema **draft-07**. Zod's
 * default conversion target is draft 2020-12, and a schema declaring the newer
 * dialect is rejected. Since Claude Code 2.1.205 a rejected schema aborts the
 * CLI instead of silently falling back to unstructured output, so the target is
 * load-bearing at run time rather than cosmetic.
 *
 * Deliberately does not reuse `zodToOpenAISchema`: that helper targets 2020-12
 * and then applies `sanitizeForOpenAI`, whose rewrites encode OpenAI's
 * structured-output dialect and do not apply here.
 *
 * Caveat worth knowing when the schema is used as a budget: `unrepresentable:
 * "any"` means types with no JSON Schema equivalent degrade to `{}` rather than
 * failing loudly -- `z.date()` becomes an unconstrained field. The property
 * stays required, but its constraint silently disappears. Prefer types that
 * survive conversion (e.g. an ISO string with a `format`/`pattern`) for fields
 * whose shape is load-bearing.
 *
 * Usage:
 * ```ts
 * import { zodToClaudeCodeSchema } from "./zodToClaudeCodeSchema";
 * const jsonSchema = await zodToClaudeCodeSchema(myZodSchema);
 * ```
 *
 * @param {import("zod").ZodTypeAny} zodSchema
 * @returns {Promise<Record<string, unknown>>}
 */
export async function zodToClaudeCodeSchema(zodSchema) {
  // z.toJSONSchema() reads Zod v4 internals; a v3 schema throws a cryptic
  // `schema._zod.def` TypeError. Surface a clear, actionable error instead.
  assertZodV4(zodSchema);
  const { z } = await import("zod");
  // `io: "input"` matches zodToOpenAISchema: structured-output providers consume
  // the input shape, and the default output conversion collapses
  // transforms/refinements into unconstrained `any`.
  return z.toJSONSchema(zodSchema, {
    unrepresentable: "any",
    io: "input",
    target: "draft-7",
  });
}
