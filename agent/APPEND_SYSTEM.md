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