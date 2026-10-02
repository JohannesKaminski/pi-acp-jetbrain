# pi-acp-jetbrain

[![npm version](https://img.shields.io/npm/v/pi-acp-jetbrain)](https://www.npmjs.com/package/pi-acp-jetbrain)
[![npm downloads](https://img.shields.io/npm/dm/pi-acp-jetbrain)](https://www.npmjs.com/package/pi-acp-jetbrain)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![check](https://github.com/ryan-brosas/pi-acp-jetbrain/actions/workflows/check.yml/badge.svg)](https://github.com/ryan-brosas/pi-acp-jetbrain/actions/workflows/check.yml)

An Agent Client Protocol (ACP) adapter for the pi coding agent. JetBrains IntelliJ is the primary host. Other ACP clients work with partial coverage.

The adapter runs as an ACP server over stdio. Each ACP session starts one `pi --mode rpc` subprocess. The adapter translates messages between the client and pi.

npm package: `pi-acp-jetbrain` (see the version badge for the current release). GitHub Actions publishes each release with signed provenance over npm OIDC; no npm token is needed on CI.

## In action

![pi-acp-jetbrain serving a live session in IntelliJ](assets/pi-acp-jetbrain-demo.gif)

![pi-acp-jetbrain session in IntelliJ](assets/pi-acp-jetbrain-ide.png)

## Install

You need Node.js 22.19 or newer and pi 1.0.0 or newer with a working model (run `pi` once in a terminal to check).

The adapter loads its bundled pi extensions (IDE bridge, tool approval, file access) into every pi session it starts, so installing the adapter is enough. `pi install` additionally registers the IDE bridge as a pi package; it is optional.

### From npm (released versions)

The shortest setup: let `npx` fetch and run a pinned release. Replace `<version>` with the current release (see the badge):

```json
"pi-acp-jetbrain": {
  "command": "npx",
  "args": ["-y", "pi-acp-jetbrain@<version>"],
  "env": {}
}
```

Or install the `pi-acp` command globally and use `"command": "pi-acp"`:

```bash
npm install -g pi-acp-jetbrain
```

The package name is `pi-acp-jetbrain`. The installed command is `pi-acp`.

### From GitHub (unreleased branches and tags)

`npx` can install straight from a GitHub repository, without an npm release. npm clones the ref, installs the build tools, and builds `dist/` through the `prepare` script:

```json
"pi-acp-jetbrain": {
  "command": "npx",
  "args": ["-y", "--allow-git=all", "github:<owner>/pi-acp-jetbrain#<tag-or-commit>"],
  "env": {}
}
```

- npm 12 refuses git installs unless you opt in with `--allow-git=all`. Older npm versions ignore the flag.
- `npx` caches by ref. A branch name can keep running an older build after new pushes; pin a tag or commit hash per version you want to test.

### From a tarball (another machine, no publishing)

Pack the adapter on a machine with the repository:

```bash
npm install
npm pack        # writes pi-acp-jetbrain-<version>.tgz
```

Copy the tarball to the other machine and install it with pi:

```bash
pi install npm:/full/path/to/pi-acp-jetbrain-<version>.tgz
```

pi installs the adapter and its dependencies under `~/.pi/agent/npm/`. Point IntelliJ at that copy with `"command": "<home>/.pi/agent/npm/node_modules/.bin/pi-acp"`, written out as an absolute path (`echo ~` prints your home folder, e.g. `/home/<you>` on Linux or `/Users/<you>` on macOS). Keep the tarball where you installed it from: pi records that path. To update, copy a new tarball over it, run the same `pi install` again, and restart the IDE. `npm install -g ./pi-acp-jetbrain-<version>.tgz` works too and puts `pi-acp` on your PATH.

The package version does not change between local builds. The startup block and `initialize` report the build revision (git commit), which tells builds apart.

### From source

```bash
npm install     # also builds dist/
```

Use `"command": "node"` with `"args": ["/path/to/pi-acp-jetbrain/dist/index.js"]`.

### Register the adapter in IntelliJ

In the AI Chat tool window, open the menu in the upper-right corner and choose **Add Custom Agent**. IntelliJ creates `~/.jetbrains/acp.json` (the file and folder do not exist before) and opens it. A complete example; replace the placeholders with the absolute paths from `which pi-acp`, `which node`, and `which pi`:

```json
{
  "default_mcp_settings": {
    "use_idea_mcp": true,
    "use_custom_mcp": true
  },
  "agent_servers": {
    "pi-acp-jetbrain": {
      "command": "/path/to/pi-acp",
      "args": [],
      "env": { "PATH": "/folder/of/node:/folder/of/pi:/usr/local/bin:/usr/bin:/bin" }
    }
  }
}
```

- `use_idea_mcp` is off by default in IntelliJ. Without it IntelliJ sends no IDE tools, and the IDE bridge has nothing to expose.
- `pi-acp`, `npx`, and pi's launcher all start with `#!/usr/bin/env node`, so the agent process needs the folders of both `node` and `pi` on its PATH. Depending on how the IDE was started (desktop launcher, Dock, JetBrains Toolbox), it may not see the PATH your shell sets up in `.bashrc`, `.zshrc`, or `.profile`. Setting `PATH` in `env` makes it explicit, but it replaces the inherited PATH rather than adding to it: list every folder the adapter needs. A missing folder shows up as "ACP process exited unexpectedly. Exit code 127".
- Typical folders: `/usr/local/bin` or `/usr/bin` for system packages, `/opt/homebrew/bin` for Homebrew on Apple silicon, and `~/.nvm/versions/node/<version>/bin` (written out absolutely) for nvm; other version managers have similar versioned folders.
- Without relying on PATH: use the full path to `node` as `command`, the adapter's `dist/index.js` as the argument, and set `PI_ACP_PI_COMMAND` to the full path of `pi`.
- Restart the IDE after changing `acp.json`, and open a new chat after updating the adapter. IntelliJ reuses running agent processes and caches some agent UI until it restarts.

A development profile with a conservative IDE tool subset:

```json
{
  "agent_servers": {
    "pi-acp-jetbrain": {
      "command": "/path/to/pi-acp-jetbrain/dist/index.js",
      "args": [],
      "env": {
        "PI_ACP_PI_COMMAND": "/path/to/pi",
        "PI_ACP_DEBUG_BRIDGE": "1"
      },
      "idea_mcp_allowed_tools": [
        "search_symbol",
        "get_symbol_info",
        "analyze_calls",
        "search_text",
        "search_regex",
        "get_file_problems",
        "lint_files",
        "build_project",
        "execute_run_configuration",
        "git_status",
        "get_repositories",
        "get_project_modules",
        "get_project_dependencies",
        "list_directory_tree",
        "read_file",
        "search_file",
        "open_file_in_editor",
        "get_all_open_file_paths",
        "skill_search"
      ]
    }
  }
}
```

`idea_mcp_allowed_tools` acts as a deny-all mask plus the named tools. Add tools as you need them.

## Features

### Sessions

The adapter covers the session surface: `session/new`, `session/prompt`, `session/cancel`, `session/list`, `session/load`, `session/fork`, `session/resume`, `session/close`, `session/delete`. Pi keeps its own session files. The adapter keeps a small map at `~/.pi/pi-acp/session-map.json` so a load can reattach to the stored session.

Reopening a chat (IntelliJ uses `session/load`) replays the history from pi's stored session, tool calls included, with the same titles and kinds as live.

Each session starts with a startup block (adapter build, pi version, loaded context, skills, prompts, and extensions). It follows pi's `quietStartup` setting: `true` hides it, and `"header"` keeps the version lines and hides the listing. An update notice and IDE bridge problems still show.

### Session settings

Each session offers these options next to the chat input or in the model dialog:

| Setting       | Values                                                              | Default            | Environment default                    |
| ------------- | ------------------------------------------------------------------- | ------------------ | -------------------------------------- |
| Model         | pi's available models                                               | pi's default       |                                        |
| Thinking      | the levels the current model supports                               | pi's default       |                                        |
| Tool approval | Off, Ask for edits & commands, Ask for everything                   | Off                | `PI_ACP_TOOL_APPROVAL=off\|edits\|all` |
| File access   | Through the editor, Disk (only with client file read/write support) | Through the editor | `PI_ACP_FILE_ACCESS=disk\|editor`      |

IntelliJ applies setting changes right before the next prompt.

**Thinking** is a `thought_level` config option. It is not sent as session modes, so clients show one thinking selector; `session/set_mode` still accepts a level for older clients. The model selector works through a mapping from pi models to ACP provider info. Pi keeps provider credentials outside the RPC surface.

**Tool approval.** pi has no approval step of its own. A bundled pi extension pauses each tool call that needs approval and asks the client through `session/request_permission`, attached to that tool call, with Allow, Always allow (that tool, for the rest of the session), and Reject. A rejected tool does not run. "Ask for edits & commands" lets read, grep, find, and ls run without asking.

**File access.** Through the editor, pi's read, edit, and write tools go through the client's `fs/read_text_file` and `fs/write_text_file`: pi sees unsaved changes, and its edits land in the editor, where you can undo them. In IntelliJ these writes also reach the disk, so later shell commands see them. Writing a file through the editor saves that file, including unsaved changes you had in it. Search tools (grep, find, ls), shell commands, and images keep using the disk.

### Streaming and tool calls

Assistant text streams as `agent_message_chunk`. Reasoning streams as `agent_thought_chunk` when the provider sends it. Every chunk carries a `messageId`: the thinking and text of one pi reply share one, and each adapter notice and replayed message gets its own.

Tool runs map to `tool_call` and `tool_call_update` with the pi tool `name`, an ACP kind, and a readable title built from the arguments: `Read src/a.ts (lines 10–14)`, `Search for "TODO" in src`, `List src`, `Edit README.md`. Bash calls use the command as the title and stream their output as a terminal. Extension and IDE tools keep their pi name as the title.

pi enables only read, bash, edit, and write by default. Add `"defaultTools": ["+grep", "+find", "+ls"]` to `~/.pi/agent/settings.json` for dedicated search tools; otherwise pi searches through bash.

Edit events carry a file location when pi reports a path. The adapter resolves relative paths against the session working directory. For text edits it finds the changed line from one unique match and reports a structured diff.

### Turn outcomes

A turn ends with `max_tokens` when the model hit its output limit and `cancelled` when it was stopped. A failed turn (provider error, pi crash) returns a JSON-RPC error with pi's message; IntelliJ shows it above the input box. Errors pi retries on its own, and context overflows it recovers from by compacting, don't end the turn: the chat shows retry and compaction notices instead.

### Usage and cost

When a turn settles the adapter makes one `get_session_stats` call and reports two things from it. Context window occupancy from pi `contextUsage`, with the cumulative session cost in USD, goes out as an ACP `usage_update` before the prompt resolves. Cumulative token use and cost go on the unstable `usage` field of the prompt response. The call waits at most 1 second. If it fails or times out, the turn still ends and both reports are left out. A turn that ends without settling (pi error, process exit) fetches the stats once for the `usage` field only.

The adapter also sends `usage_update` on `session/new` and `session/load`, and after a model switch. Right after compaction pi has no trusted token count, so the client keeps the previous value.

### Input requests

Text input requests from pi extensions use ACP elicitation when the client declares form elicitation in `initialize`; otherwise they are cancelled with a visible notice. Requests that fit permissions route through ACP permissions. An editor request shows a cancellation notice because elicitation forms hold primitive fields only.

### Slash commands

Slash commands load file-based prompts from pi and a set of built-ins: `/compact`, `/export`, `/session`, `/name`, `/queue`, `/changelog`, `/steering`, `/follow-up`. Skills appear as `/skill:<name>` when enabled in pi settings. `/compact` on a session too small to compact answers in the chat.

The local tree carries pi developer tooling: 9 prompt commands, 101 skill files (91 leaves in 10 packs), and 12 format templates under `.pi/`. These checks run in the development tree and skip on clean CI checkouts.

## JetBrains IDE bridge

IntelliJ sends its built-in MCP server descriptor with each chat (with `use_idea_mcp` enabled). The adapter exposes those IDE tools to pi as `ide_<server>_<tool>` extension tools.

The bridge opens a direct MCP-over-SSE client against `http://127.0.0.1:<IJ_MCP_SERVER_PORT>/sse` when the descriptor carries that port. It starts the stdio child only when that endpoint is unreachable.

Two allowlists guard the IDE tools. The IDE side reads `idea_mcp_allowed_tools` from `~/.jetbrains/acp.json`. An omitted key means AllowAll in the installed build. The adapter side deny-lists `execute_tool` and every `xdebug_*` name. Set `PI_ACP_IDE_EXTRA_TOOLS` with a comma separated list of remote names to re-allow tools you reviewed.

The session catalog never changes. After you edit IntelliJ MCP settings or the allowlist, open a new chat.

## Environment variables

| Variable                                | Effect                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PI_ACP_PI_COMMAND`                     | Path to the pi executable. Default: `pi`.                                                                                                            |
| `PI_ACP_TOOL_APPROVAL=off\|edits\|all`  | Default tool approval mode for new sessions. Default: `off`.                                                                                         |
| `PI_ACP_FILE_ACCESS=disk\|editor`       | Default file access for read/edit/write in new sessions, for clients with fs support. Default: `editor`.                                             |
| `PI_ACP_DEBUG_ACP=1` or a file path     | Log incoming ACP requests and outgoing errors to `~/.pi/pi-acp/acp-debug.log` (or the given file). Prompt text, images, env and headers are omitted. |
| `PI_ACP_DEBUG_BRIDGE=1`                 | Log the sanitized `session/new` MCP descriptor to stderr. IntelliJ writes that stderr into `idea.log`.                                               |
| `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true`   | Advertise `embeddedContext` support.                                                                                                                 |
| `PI_ACP_ENFORCE_IDE_INSPECT=0`          | Disable the inspection gate that runs after each turn.                                                                                               |
| `PI_ACP_ENFORCE_IDE_MUTATIONS=0`        | Disable the mutation provenance gate. See the IntelliJ-first coding mode section.                                                                    |
| `PI_ACP_IDE_MODE=off\|prefer\|required` | IntelliJ-first coding mode for the session. Default: `off`. See the IntelliJ-first coding mode section.                                              |
| `PI_ACP_IDE_INSPECT_DIR`                | Move inspection reports out of the project tree.                                                                                                     |
| `PI_ACP_SESSION_MAP`                    | Override the session map path. Default: `~/.pi/pi-acp/session-map.json`.                                                                             |
| `PI_ACP_IDE_EXTRA_TOOLS`                | Re-allow deny-listed IDE tools. Comma separated remote names.                                                                                        |

## IntelliJ-first coding mode

Set `PI_ACP_IDE_MODE` to control how the session uses IntelliJ for normal coding work. Pi still generates every implementation; IntelliJ opens, reads, searches, applies, renames, reformats, and validates.

- `off` (default) keeps the current behavior: IDE tools are exposed alongside native tools, nothing is removed, no extra prompt guidance.
- `prefer` removes the native `read`, `edit`, `write`, `grep`, `find`, and `ls` tools from the active set when the required IDE capabilities register. If the IDE bridge degrades, those tools come back and the session gets an explicit fallback notice.
- `required` removes the same native tools immediately and keeps them removed if the IDE bridge is missing or loses connection. The session reports that the task is blocked until a new healthy chat starts.

Required capabilities: `read_file`, `open_file_in_editor`, `apply_patch`, `create_new_file`, one search tool, and one inspection tool. Tool names are discovered from the live catalog, never guessed.

In active modes, mutations run through IntelliJ and open the affected files: existing files open before `apply_patch`, created and moved files open after. Patch targets and path arguments are confined to the ACP project root; paths outside it are rejected, including symlink escapes. Structured path fields in search and inspection results are checked against the project root. In `prefer`, results naming files outside the root are diagnosed on the result; in `required`, they are rejected. Unstructured result text is passed through unchanged: generic text scanning is not a safe discriminator, so per-tool structured adapters remain the boundary (an upstream limitation).

Bash stays available in `prefer` for Git, tests, builds, and diagnostics. Unrestricted bash can still mutate files, so this mode is policy enforcement for normal coding tools, not a filesystem sandbox. Do not rely on it as a security boundary.

In `prefer` and `required` with an active catalog, direct Fabric/Schema file mutations (`schema.commit`, `pi.write`, `pi.edit` inside `fabric_exec`) are blocked before execution by a `tool_call` gate. Mutations must flow through the IDE tools (`ide_idea_apply_patch`, `ide_idea_create_new_file`, rename, reformat), which open affected files and confine patch/path arguments to the project root. Read-only Fabric code (`pi.read`, `pi.grep`, IDE tool calls) is unaffected. This closes the extension-tool bypass of the active-set filter; Bash remains an intentional, documented exception.

A second layer runs after each turn: the extension reports paths applied by successful IDE mutation tools over the authenticated IPC (`mutations_applied`), and the adapter compares those against files changed during the turn (git status merged with turn-touched tool paths). Files that changed without an IDE mutation event are surfaced as `Mutation provenance` violations in the chat and recorded under `PromptResponse._meta.piAcp.mutationViolations`. Disable with `PI_ACP_ENFORCE_IDE_MUTATIONS=0`. Deleted files and files committed mid-turn by an external auto-commit watcher are not detected by this layer (same git-status semantics as the inspection gate).

The File access setting is the protocol-standard way to route pi's read, edit, and write through the editor in any ACP client; this mode goes further and replaces pi's native tools with IntelliJ's MCP tools.

Set the variable for the adapter process, for example in `~/.jetbrains/acp.json`:

```json
{
  "agent_servers": {
    "pi-acp-jetbrain": {
      "command": "/path/to/pi-acp/dist/index.js",
      "env": { "PI_ACP_IDE_MODE": "prefer", "PI_ACP_PI_COMMAND": "/path/to/pi" }
    }
  }
}
```

## Authentication

The adapter advertises terminal auth metadata. Run this command for interactive provider login:

```bash
pi-acp --terminal-login
```

ACP clients can start the same command from their auth UI.

## Development

```bash
npm install          # also builds dist/
npm run dev          # run from src with tsx
npm run build
npm run lint
npm run test         # unit, component, and end-to-end tests
npm run typecheck
npm run format
npm run check:pack   # pack, install into a clean prefix, check the installed adapter starts
npm run smoke        # core stdio smoke tests against your real pi and model
npm run smoke:full   # full matrix; run this before a release
node scripts/check.mjs
```

Code layout:

- `src/acp/` holds the ACP server and translation.
- `src/pi-rpc/` holds the pi subprocess wrapper.
- `src/pi-extension/` holds the pi extensions the adapter loads into each session: the IDE bridge, tool approval, and editor file access.

Tests:

- `test/e2e/` runs the real adapter against the real pi binary from `node_modules`, with a scripted model (pi-ai's faux provider, loaded by `test/e2e/fixtures/scripted-model.ts`). Scenarios script text, thinking, tool calls, stop reasons, and errors; no network or API keys. Start a fix with a failing scenario here.
- `test/component/` and `test/unit/` cover edge cases with a fake pi process. Its events are type-checked against pi's exported event types, so a renamed pi event fails `npm run typecheck`.
- `npm run smoke:full` uses your own pi providers and is for release checks.

To see what a client actually sends, set `PI_ACP_DEBUG_ACP=1` and read `~/.pi/pi-acp/acp-debug.log`.

CI: `check.yml` runs the canonical check, tests, lint, typecheck, build, and the packaging check on Node 22 and 24. `qodana_code_quality.yml` runs a Qodana Cloud scan and needs a `QODANA_TOKEN` repository secret. CI runs on Linux. Windows paths exist in the code and stay untested.

## Releasing

Each release publishes to npm from GitHub Actions with signed provenance. No interactive npm 2FA on CI.

Start a release with:

```bash
gh workflow run Release -f version=<next-version>
```

Workflow `Release` (file `release.yml`) validates the version, bumps the package files, runs the gates, commits, tags, pushes, publishes, and creates a GitHub release.

Workflow `Publish Package` (file `npm-publish.yml`) runs on a `v*` tag push. It verifies the tag matches the package version and that npm lacks the version. Then it publishes and creates a GitHub release.

One-time setup for the package owner: on npmjs.com open the package Settings and the GitHub Cloud CI/CD form. Authorize `ryan-brosas/pi-acp-jetbrain`, branch `main`, with workflow filenames `npm-publish.yml` and `release.yml`.

## Limitations

### Trust boundary

The adapter trusts its ACP host. The host supplies the session working directory and
client-provided MCP descriptors; stdio MCP servers named in a descriptor are spawned with
the adapter's process environment in that working directory. Run the adapter only with
hosts and MCP configurations you control. Do not expose it as a service to untrusted clients
or place unnecessary secrets in the adapter environment.

`PI_ACP_IDE_MODE=prefer|required` is policy enforcement for normal coding tools, not a
filesystem sandbox: unrestricted Bash stays available, and the post-turn gates report
violations without rolling back changes.

Tool approval covers tool calls pi makes. Calls one tool makes on behalf of another (pi's optional codemode) carry ids the client never sees as tool calls, so their approval prompt is not attached to a visible call.

### Protocol coverage

- Terminals: the adapter does not delegate shell commands to the client (IntelliJ declares no terminal support). Pi runs commands locally.
- File access through the editor covers read, edit, and write only; search tools and shell commands use the disk.
- `providers/set` and `providers/disable` return a method-not-found error. Pi configures providers outside the RPC surface.
- No plan updates: pi has no plan concept.
- No `logout` and no additional workspace roots: pi's RPC surface has neither.
- The IDE bridge speaks the MCP-over-ACP protocol generation with `mcp/connect`. ACP SDK 1.x defines a newer, stateless one; current IntelliJ builds accept the older form.

Debugger tools register only while an IDE debug session is live. Start a debug session and open a new chat to see them.

After you rebuild the adapter, open a new chat. Node keeps the old files loaded, and IntelliJ reuses running agent processes.

## License

MIT. See [LICENSE](LICENSE).
