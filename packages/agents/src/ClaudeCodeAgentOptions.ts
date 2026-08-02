import type { BaseCliAgentOptions } from "./BaseCliAgent/BaseCliAgentOptions";

export type ClaudeCodeAgentOptions = BaseCliAgentOptions & {
  addDir?: string[];
  agent?: string;
  agents?: Record<string, { description?: string; prompt?: string }> | string;
  allowDangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  appendSystemPrompt?: string;
  /**
   * Path to an isolated Claude Code config directory. Sets `CLAUDE_CONFIG_DIR`
   * on the spawned process so this invocation uses the credentials stored at
   * `<configDir>/.credentials.json` (instead of the user's default `~/.claude/`).
   *
   * Use this to run multiple Claude Code subscriptions side-by-side. Set up
   * the directory by running `CLAUDE_CONFIG_DIR=<path> claude` once and
   * completing `/login` interactively.
   */
  configDir?: string;
  /**
   * Anthropic API key for billing this invocation against the API instead of
   * a Claude Pro/Max subscription. When set, ClaudeCodeAgent stops unsetting
   * `ANTHROPIC_API_KEY` (which it normally clears so subscription auth wins).
   */
  apiKey?: string;
  betas?: string[];
  chrome?: boolean;
  continue?: boolean;
  dangerouslySkipPermissions?: boolean;
  debug?: boolean | string;
  debugFile?: string;
  disableSlashCommands?: boolean;
  disallowedTools?: string[];
  fallbackModel?: string;
  file?: string[];
  forkSession?: boolean;
  fromPr?: string;
  ide?: boolean;
  includePartialMessages?: boolean;
  inputFormat?: "text" | "stream-json";
  jsonSchema?: string;
  maxBudgetUsd?: number;
  /**
   * Cap on agent turns (`--max-turns`). Unset by default: the CLI imposes no
   * restrictive limit of its own, and exhausting a cap surfaces as an opaque
   * failure. Note that `1` starves native structured output, which is delivered
   * through a tool call.
   */
  maxTurns?: number;
  mcpConfig?: string[];
  mcpDebug?: boolean;
  model?: string;
  /**
   * Opt in to Claude Code's native structured output (`--json-schema`) for the
   * task's output schema, instead of the engine's prompt-injection fallback.
   *
   * Off by default: the fallback is what every existing pipeline is calibrated
   * against, and it leaves the prompt untouched. Turn this on when schema
   * constraints must be *enforced* rather than requested — under
   * prompt-injection, `maxItems` / `maxLength` are only text in the prompt.
   */
  nativeStructuredOutput?: boolean;
  noChrome?: boolean;
  noSessionPersistence?: boolean;
  outputFormat?: "text" | "json" | "stream-json";
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default" | "delegate" | "dontAsk" | "plan";
  pluginDir?: string[];
  replayUserMessages?: boolean;
  resume?: string;
  sessionId?: string;
  settingSources?: string;
  settings?: string;
  strictMcpConfig?: boolean;
  systemPrompt?: string;
  tools?: string[] | "default" | "";
  verbose?: boolean;
};
