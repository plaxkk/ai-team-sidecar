# AI Team Sidecar

Local dashboard and auditor for AI-assisted coding teams.

AI Team Sidecar watches conversations from tools like Claude Code and Codex CLI, groups them by local repository, and evaluates execution quality like a lightweight startup operating system:

```text
Founder / CEO
|
+-- Company Portfolio
|   |
|   +-- Local Repo Project
|       |
|       +-- AI Agent Sessions
|       |   +-- Codex CLI
|       |   +-- Claude Code
|       |
|       +-- Role Quality Lens
|       |   +-- Product
|       |   +-- Engineer
|       |   +-- QA
|       |   +-- Tech Lead
|       |
|       +-- Project PMO Health
|           +-- Input quality
|           +-- Process health
|           +-- Output quality
|           +-- Delivery confidence
|
+-- AI Team Sidecar
    |
    +-- Collector -> Local SQLite -> Analysis Engine -> Dashboard
    +-- Audit Findings -> Rule Feedback -> Project .md files -> Next execution loop
```

- Company / founder operating health
- Project PMO health
- Product / RD / QA / Tech Lead role quality
- Prompt and delivery quality with explainability
- Token, tool, and lifecycle cost
- Sidecar audit findings and rule feedback for project `.md` files

Everything runs locally by default. Conversation data is stored in your local SQLite database and is not uploaded.

## Quick Start

```bash
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

## Operating Flywheel

AI Team Sidecar is designed for a solo founder who wants to run an AI-native company with local AI agents as the project team. The founder stays responsible for direction and judgment; Sidecar turns the agent conversation trail into an operating system for better management.

```text
                         +----------------------+
                         | 1. Founder Intent    |
                         | goal / pain / P0 /   |
                         | acceptance criteria  |
                         +----------+-----------+
                                    |
                                    v
+----------------------+   +-------+--------+   +----------------------+
| 7. Better Next Loop  |<--| 6. Rules Improve|<--| 5. Founder Decides  |
| stronger operating   |   | CLAUDE.md /     |   | keep / stop / scope |
| system for agents    |   | project rules   |   | verify / change     |
+----------+-----------+   +-------+--------+   +----------+-----------+
           ^                       ^                       ^
           |                       |                       |
           |                       |                       |
           |              +--------+---------+             |
           |              | 4. Sidecar Audit |-------------+
           |              | company / PMO /  |
           |              | roles / delivery |
           |              +--------+---------+
           |                       ^
           |                       |
+----------+-----------+   +-------+--------+
| 2. AI Agents Execute |-->| 3. Sidecar      |
| Codex / Claude plan, |   | Observes        |
| code, test, ship     |   | sessions/tokens |
+----------------------+   +----------------+
```

The flywheel works because every AI work session creates management data. Instead of only asking whether the code changed, Sidecar asks whether the company is operating better: Are inputs sharper? Is scope controlled? Are Product, Engineer, QA, and Tech Lead behaviors showing up? Is delivery backed by evidence? Are tokens buying useful progress?

Use it as a weekly or daily operating cadence:

- Start work from a concrete founder brief: goal, user, pain, P0 scope, constraints, and go/no-go criteria.
- Let agents execute inside the repo while Sidecar runs in the background.
- Review the dashboard by project, not by chat transcript: PMO score, risks, role quality, confidence, and cost.
- Accept only rule feedback that would make the next execution loop clearer or stricter.
- Push accepted lessons back into project `.md` files so the AI team becomes easier to manage over time.

The goal is not to automate the CEO away. The goal is to make one founder behave like a tighter company: clearer inputs, smaller loops, better review habits, explicit quality bars, and a compounding rule system that improves every future AI agent run.

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
