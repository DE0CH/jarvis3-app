// What a tool call is called in the chat: a short step in plain words ("Searched the web", "Ran a
// command"), as the Claude app shows them, instead of the tool's own name. Present tense while the
// step runs. Used by Paseo's ToolCall in this variant (components/message.tsx) and by the chat's
// history view. Tested in steps.test.ts.

export interface StepInput {
  toolName: string;
  /** Paseo's ToolCallDetail.type, when the call has one. */
  detailType?: string | null;
  /** For a search: which kind (Paseo's detail.toolName). */
  searchKind?: string | null;
  running?: boolean;
}

interface StepWords {
  done: string;
  running: string;
}

const words = (done: string, running: string): StepWords => ({ done, running });

const COMMAND = words("Ran a command", "Running a command");
const READ = words("Read a file", "Reading a file");
const EDIT = words("Edited a file", "Editing a file");
const WRITE = words("Created a file", "Creating a file");
const FILE_SEARCH = words("Searched files", "Searching files");
const WEB_SEARCH = words("Searched the web", "Searching the web");
const FETCH = words("Read a web page", "Reading a web page");
const SUB_AGENT = words("Ran a helper agent", "Running a helper agent");
const PLAN = words("Updated the plan", "Updating the plan");
const POST = words("Posted to the channel", "Posting to the channel");
const WAKEUP = words("Set a wakeup", "Setting a wakeup");
const APPROVAL = words("Asked for approval", "Asking for approval");
const QUESTION = words("Asked an admin", "Asking an admin");
const ACCESS = words("Asked an admin for access", "Asking an admin for access");
const REMEMBER = words("Saved a note", "Saving a note");
const FILES = words("Used your files", "Using your files");

const BY_TOOL: Record<string, StepWords> = {
  bash: COMMAND,
  shell: COMMAND,
  terminal: COMMAND,
  read: READ,
  view: READ,
  edit: EDIT,
  multiedit: EDIT,
  patch: EDIT,
  apply_patch: EDIT,
  write: WRITE,
  glob: FILE_SEARCH,
  grep: FILE_SEARCH,
  list: FILE_SEARCH,
  ls: FILE_SEARCH,
  web_search: WEB_SEARCH,
  websearch: WEB_SEARCH,
  web_fetch: FETCH,
  webfetch: FETCH,
  fetch: FETCH,
  task: SUB_AGENT,
  todowrite: PLAN,
  todoread: PLAN,
  jarvis_post: POST,
  jarvis_wakeup: WAKEUP,
  jarvis_action: APPROVAL,
  jarvis_ask_boss: QUESTION,
  jarvis_request_access: ACCESS,
  jarvis_remember: REMEMBER,
  jarvis_files: FILES,
};

const BY_DETAIL: Record<string, StepWords> = {
  shell: COMMAND,
  read: READ,
  edit: EDIT,
  write: WRITE,
  fetch: FETCH,
  sub_agent: SUB_AGENT,
};

function normalise(name: string): string {
  // OpenCode and MCP tools may arrive prefixed ("jarvis.jarvis_post", "mcp__x__web_search").
  const last = name.split(/__|\.|\//).pop() ?? name;
  return last.trim().toLowerCase();
}

/** The step's words, or null for a tool this list doesn't know (the caller keeps its own label). */
export function stepLabel(input: StepInput): string | null {
  const tool = normalise(input.toolName);
  let found: StepWords | undefined;
  if (input.detailType === "search") {
    found = input.searchKind === "web_search" || tool.includes("web") ? WEB_SEARCH : FILE_SEARCH;
  } else {
    found = BY_TOOL[tool] ?? (input.detailType ? BY_DETAIL[input.detailType] : undefined);
  }
  if (!found) return null;
  return input.running ? `${found.running}…` : found.done;
}
