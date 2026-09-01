# Agent delegation

- Route by semantic intent, even when the user does not explicitly mention agents or `task`.
- For industry best practices, external references, or open-source implementation comparisons, use `task` with `librarian`. For a specific library/framework/API, also use Context7 as required (`xd://mcp__context_resolve_library_id` → `xd://mcp__context_query_docs`).
- For broad, unfamiliar, or cross-module engineering-state analysis, use `task` with `scout` or `code-scout`; use direct tools only for narrow, known-location questions.
- When internal-state analysis and external-practice research are both requested, dispatch the independent `scout` and `librarian` slices in one parallel `task` batch.
- Explicit requests to parallelize, split work, or have multiple agents analyze MUST use `task`.
- Do not avoid delegation merely because the main assistant could perform the search directly; delegate when specialist context, broad exploration, or independent evidence materially improves coverage.
- Do not invent agent slices. Keep small, deterministic, known-location work on direct tools.

# OMP harness questions

- When a question concerns omp itself (configuration, agents, MCP, skills, extensions, tools, keybindings), ALWAYS consult the bundled docs first: `read omp://` lists all available docs; read the relevant `omp://<doc>` before answering.
- NEVER answer omp questions from memory or from other harnesses' conventions (Claude Code, Cursor, etc.) — verify against the omp docs.
---

# Git Hard Rules (global)

- Never run `git commit`, `git push`, `git pull`, or `git reset --hard` on your own initiative.
- To propose a commit: show the file list + the full commit message, then stop and wait.
- The ONLY trigger to execute a commit is an explicit commit directive from the user ("提交", "提交吧", "commit"). Vague replies ("可以", "行", "好的", "ok", "嗯") never authorize a commit — keep waiting for an explicit directive.
- `push` / `pull` are NEVER executed by default: only an explicit, emphatic request for that exact operation authorizes it (e.g. "推上去", "push", "务必 push", "现在就 pull"). Ambiguous or passing mentions ("记得 push", "回头推一下", "push / pull follow the same rule" style references) do NOT count — keep waiting for an explicit directive.
- Approving a plan is NOT approving a commit. "改完了" (done) and "验证过了" (verified) are not commit instructions.
- Sole exception: a one-time full authorization from the user (e.g. "直接提交并推送") covers that single authorized scope; no further confirmation needed within it.
# Browser tasks

- UI verification, web interaction, form filling, or scraping → drive the Orca embedded browser via the `orca` CLI (`tab create`, `snapshot`, `click`, `fill`, `eval`, `wait`). Full command reference: load the orca-cli skill (`orca skills get orca-cli` prints the version-matched guide). The browser is visible in Orca, keeps persistent login state (user logs in manually once; reuse that session, never ask for credentials), and snapshots are text — never judge a page from a screenshot unless the active model has vision.
- Confirm with the user before starting any browser automation, unless the user already explicitly asked for it.
- Static pages → `read` the URL directly; no browser needed.
- Never fall back to a headless browser for these tasks.
