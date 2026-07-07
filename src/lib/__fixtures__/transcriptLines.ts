// Representative Claude Code transcript lines, captured from a real session log
// on 2026-06-22 (Task 1 schema spike). Used by completion.test.ts.
//
// REAL SHAPE vs. brief's guess:
//   - `timestamp` is ISO 8601 at top level — matches brief ✓
//   - `message.stop_reason` distinguishes turn-end from mid-loop — matches brief ✓
//   - `type` is "assistant" / "user" — matches brief ✓
//   - EXTRA top-level fields exist in real logs that the brief omitted:
//       `parentUuid`, `isSidechain`, `requestId`, `uuid`, `userType`, `entrypoint`,
//       `cwd`, `sessionId`, `version`, `gitBranch`
//     These are irrelevant to turn-end detection but are preserved here so tests
//     cover realistic payloads (parseTurnEnd must not break on unknown keys).
//   - `message` also carries `model`, `id`, `stop_sequence`, `stop_details`, `usage`,
//     `diagnostics` — all omitted in the brief, included here on the end_turn fixture.
//   - `message.content` is always an array (brief showed array form — matches ✓).
//   - User `message.content` can be a plain string (human prompt) OR an array of
//     tool-result objects; both forms captured below.

/** Assistant message that ENDED the turn — this is a Completion. */
export const ASSISTANT_END_TURN = JSON.stringify({
  parentUuid: "8b009c8b-60db-44f9-876b-a8171e4953d9",
  isSidechain: false,
  message: {
    model: "claude-opus-4-8",
    id: "msg_REDACTED",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2,
      cache_read_input_tokens: 293885,
      output_tokens: 819,
    },
    diagnostics: null,
  },
  requestId: "req_REDACTED",
  type: "assistant",
  uuid: "41d1a92f-820f-44d2-b374-1ce8f24eb703",
  timestamp: "2026-06-22T08:30:00.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** Assistant message mid-loop (about to call a tool) — NOT a Completion. */
export const ASSISTANT_TOOL_USE = JSON.stringify({
  parentUuid: "11b4033f-cb47-4faf-936b-e0cb9bfaf98f",
  isSidechain: false,
  message: {
    model: "claude-opus-4-8",
    id: "msg_REDACTED2",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_REDACTED",
        name: "Bash",
        input: { command: "ls ." },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2,
      cache_read_input_tokens: 293276,
      output_tokens: 183,
    },
    diagnostics: null,
  },
  requestId: "req_REDACTED2",
  type: "assistant",
  uuid: "5f02189c-45db-4fc7-8b22-4b5f65f7b65e",
  timestamp: "2026-06-22T09:54:36.932Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** A user line (human prompt) — NOT a Completion. */
export const USER_LINE = JSON.stringify({
  parentUuid: "325b7d77-0202-401d-a1af-c54a755807bc",
  isSidechain: false,
  promptId: "cf89ef9f-6d69-484c-9a5f-5e3f6381b4e1",
  type: "user",
  message: {
    role: "user",
    content: "fix the bug",
  },
  uuid: "cfbb91f3-c5a0-4a44-b211-a163713ae85e",
  timestamp: "2026-06-22T08:29:00.000Z",
  permissionMode: "bypassPermissions",
  origin: { kind: "human" },
  promptSource: "typed",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** A user line carrying a tool result (not a human prompt) — NOT a Completion. */
export const USER_TOOL_RESULT = JSON.stringify({
  parentUuid: "5f02189c-45db-4fc7-8b22-4b5f65f7b65e",
  isSidechain: false,
  promptId: "37653a1b-764b-4ec8-bca0-07cbe658c058",
  type: "user",
  message: {
    role: "user",
    content: [
      {
        tool_use_id: "toolu_REDACTED",
        type: "tool_result",
        content: "exit code 0",
      },
    ],
  },
  uuid: "630d02ed-b531-44b6-83c5-64009f41f6ad",
  timestamp: "2026-06-22T09:54:38.507Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** Assistant message calling AskUserQuestion — the session is now WAITING on the user.
 *  Shape verified against a real transcript (2026-07-02 schema check). */
export const ASSISTANT_ASK = JSON.stringify({
  parentUuid: "41d1a92f-820f-44d2-b374-1ce8f24eb703",
  isSidechain: false,
  message: {
    model: "claude-fable-5",
    id: "msg_ASK1",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_ASK1",
        name: "AskUserQuestion",
        input: { questions: [{ question: "Which auth method should the API use?", header: "Auth", options: [], multiSelect: false }] },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 290000, output_tokens: 120 },
    diagnostics: null,
  },
  requestId: "req_ASK1",
  type: "assistant",
  uuid: "a1a1a1a1-0000-4000-8000-000000000001",
  timestamp: "2026-07-02T10:00:00.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** A parallel tool_use block of the SAME assistant message (same message.id), written as
 *  its own JSONL record — observed in a real log. Must NOT clear waiting. */
export const ASSISTANT_ASK_SIBLING = JSON.stringify({
  parentUuid: "a1a1a1a1-0000-4000-8000-000000000001",
  isSidechain: false,
  message: {
    model: "claude-fable-5",
    id: "msg_ASK1",
    type: "message",
    role: "assistant",
    content: [
      { type: "tool_use", id: "toolu_OTHER1", name: "mcp__designer__designer_session", input: { action: "status" } },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 290000, output_tokens: 40 },
    diagnostics: null,
  },
  requestId: "req_ASK1",
  type: "assistant",
  uuid: "a1a1a1a1-0000-4000-8000-000000000002",
  timestamp: "2026-07-02T10:00:00.300Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** The user answered the question — tool_result matching the ask's tool_use_id. Clears waiting. */
export const USER_ASK_ANSWER = JSON.stringify({
  parentUuid: "a1a1a1a1-0000-4000-8000-000000000001",
  isSidechain: false,
  promptId: "b2b2b2b2-0000-4000-8000-000000000001",
  type: "user",
  message: {
    role: "user",
    content: [{ tool_use_id: "toolu_ASK1", type: "tool_result", content: "User selected: JWT" }],
  },
  uuid: "a1a1a1a1-0000-4000-8000-000000000003",
  timestamp: "2026-07-02T10:01:50.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** A sidechain (subagent) assistant line with a DIFFERENT message id — must NOT clear waiting. */
export const SIDECHAIN_ASSISTANT = JSON.stringify({
  parentUuid: "c3c3c3c3-0000-4000-8000-000000000001",
  isSidechain: true,
  message: {
    model: "claude-fable-5",
    id: "msg_SIDE1",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "subagent output" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 1000, output_tokens: 10 },
    diagnostics: null,
  },
  requestId: "req_SIDE1",
  type: "assistant",
  uuid: "a1a1a1a1-0000-4000-8000-000000000004",
  timestamp: "2026-07-02T10:00:30.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** Malformed / non-JSON line. */
export const GARBAGE = "not json {";

/** Assistant message with PARALLEL tool_use blocks (Edit + Read) written as one
 *  record — the activity feed must surface both. Same real shape as ASSISTANT_TOOL_USE. */
export const ASSISTANT_EDIT = JSON.stringify({
  parentUuid: "5f02189c-45db-4fc7-8b22-4b5f65f7b65e",
  isSidechain: false,
  message: {
    model: "claude-fable-5",
    id: "msg_EDIT1",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_EDIT1",
        name: "Edit",
        input: { file_path: "/Users/example/project/src/components/CanvasView.tsx", old_string: "a", new_string: "b" },
      },
      {
        type: "tool_use",
        id: "toolu_READ1",
        name: "Read",
        input: { file_path: "/Users/example/project/src/components/dragMath.ts" },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 290000, output_tokens: 90 },
    diagnostics: null,
  },
  requestId: "req_EDIT1",
  type: "assistant",
  uuid: "d4d4d4d4-0000-4000-8000-000000000001",
  timestamp: "2026-07-07T04:00:00.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});
