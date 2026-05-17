# AI Team Sidecar

Local dashboard and auditor for AI-assisted coding teams.

AI Team Sidecar watches conversations from tools like Claude Code and Codex CLI, groups them by local repository, and evaluates execution quality like a lightweight startup operating system:

- Company / founder operating health
- Project PMO health
- Product / RD / QA / Tech Lead role quality
- Prompt and delivery quality with explainability
- Token, tool, and lifecycle cost
- Sidecar audit findings and rule feedback for project `.md` files

Everything runs locally by default. Conversation data is stored in your local SQLite database and is not uploaded.

## Quick Start

```bash
npm install
npm run start
```

Open:

```text
http://localhost:4041
```

That is enough for Codex CLI data: the dashboard reads local Codex sessions from the default Codex state path when available and groups them by repository `cwd`.

Claude Code collection is optional because it requires adding hooks to Claude Code settings:

```bash
npm run install:claude-hooks
```

The command prints the settings snippet to add. After that, keep `npm run start` running while you use Claude Code.

Optional checks:

```bash
npm run doctor
```

You only need to edit `~/.ai-team-sidecar/config.json` if you want to restrict monitoring to specific repositories. With the default empty `projects` list, Sidecar accepts every project `cwd` it sees.

## Configuration

Default config path:

```text
~/.ai-team-sidecar/config.json
```

Example:

```json
{
  "dataDir": "~/.ai-team-sidecar/data",
  "dashboardPort": 4041,
  "projects": [
    {
      "name": "my-app",
      "path": "~/repos/my-app"
    }
  ],
  "agents": {
    "claudeCode": true,
    "codexCli": true
  },
  "privacy": {
    "storeRawPayload": false,
    "storeToolOutput": false
  }
}
```

If `projects` is empty, Sidecar accepts all project `cwd` values it sees. Add project paths to restrict monitoring.

You can also set:

```bash
SIDECAR_CONFIG=/path/to/config.json
DATA_DIR=/path/to/data
PORT=4041
```

## Data Storage

Data is local-first. The repository should contain source code only; runtime databases and transcripts stay outside git.

Default data directory:

```text
~/.ai-team-sidecar/data
```

Main database:

```text
~/.ai-team-sidecar/data/feedback.db
```

Core tables:

- `sessions`: one Claude/Codex conversation session, grouped by `cwd`.
- `events`: raw agent events.
- `turns`: user prompt, assistant response, duration, token fields.
- `tool_calls`: tool name, input, output, estimated tool tokens.
- `episodes`: task-level slices built from turns.
- `role_evaluations`: Product / Engineer / QA / Tech Lead scores.
- `ceo_reports`, `project_reports`, `company_audit_reports`, `project_audit_reports`: derived reports.
- `rule_feedback_items`: Sidecar recommendations for project rules.

## Claude Code

Claude Code is collected through hooks.

Generate hook scripts:

```bash
npm run install:claude-hooks
```

The command prints a Claude Code settings snippet. Add the generated hook commands to your Claude Code settings.

Runtime flow:

```text
Claude Code hook event
  -> sidecar-hook
  -> ~/.ai-team-sidecar/data/feedback-pipe
  -> collector daemon
  -> SQLite
  -> analysis engine
  -> dashboard
```

Supported Claude events:

- `SessionStart`
- `UserPromptSubmit`
- `PostToolUse`
- `Stop`

Claude token usage is estimated because Claude Code hooks do not consistently expose billable model token usage. Sidecar estimates:

```text
ceil((visible text chars + tool input/output chars) / 4)
```

Use this as a management signal, not a billing source of truth.

## Codex CLI

Codex CLI is synchronized from local Codex state:

```text
~/.codex/state_5.sqlite
~/.codex/sessions/**/*.jsonl
```

Manual sync:

```bash
npm run sync:codex
```

Sync a single project:

```bash
npm run sync:codex -- ~/repos/my-app
```

Codex token usage uses actual local token counters when available:

- session-level `threads.tokens_used`
- rollout `token_count.total_token_usage`
- turn-level deltas derived from cumulative token counts

## Backfill Claude Transcripts

Import historical Claude transcript files:

```bash
npm run backfill:claude
```

Claude transcripts are read from:

```text
~/.claude/projects
```

If `projects` is configured, only matching project transcript folders are imported.

## Dashboard Views

Overview:

- Company health
- Founder operating score
- Project portfolio
- Capital/token efficiency
- Focus and execution velocity

Project PMO:

- Project management health
- Sidecar project audit
- Lifecycle and resource cost
- Agent mix and top token conversations

Diagnostics:

- Team health
- Product / Engineer / QA / Tech Lead scores
- Prompt Quality and Delivery Quality with explainability
- Episode table and conversation drilldown

## Rule Feedback

Sidecar can propose changes to project rules such as:

- `CLAUDE.md`
- `项目规则.md`
- `docs/ITERATION-PROCESS.md`
- `docs/MVP-CHECKLIST.md`

By default it only proposes patches. Applying patches is explicit through the local API:

```text
POST /api/rule-feedback/apply
```

Applied patches are appended to the target file. Sidecar does not silently overwrite user rules.

## Privacy Notes

This tool may store prompts, assistant responses, tool inputs, and tool outputs locally.

Default privacy settings avoid storing duplicate raw hook payloads and tool outputs:

```json
{
  "privacy": {
    "storeRawPayload": false,
    "storeToolOutput": false
  }
}
```

The `turns` table still stores prompt and assistant text because the dashboard needs it for local diagnostics. Do not commit the data directory. Run this before publishing or pushing:

```bash
npm run doctor
git status --short
```

Open-source safety checklist:

- Keep `~/.ai-team-sidecar/data` or any custom `DATA_DIR` out of the repository.
- Keep `.env`, SQLite files, JSONL transcripts, Claude exports, and Codex exports untracked.
- Prefer configuring `projects` so Sidecar only observes intended repositories.
- Enable `privacy.storeRawPayload` or `privacy.storeToolOutput` only when you explicitly need deeper local diagnostics.

Disabling tool output storage reduces token visibility and diagnostic accuracy.

## Development

```bash
npm run build
npm run doctor
npm run dashboard
npm run daemon
```

Useful API checks:

```text
/api/overview
/api/projects
/api/company-audit
/api/project-management-report?project_path=<path>
/api/project-resource-report?project_path=<path>
/api/startup-audit?project_path=<path>
/api/rule-feedback?project_path=<path>
```

## License

MIT
