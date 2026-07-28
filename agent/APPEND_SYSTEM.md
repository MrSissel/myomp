# Agent delegation

- Route by semantic intent, even when the user does not explicitly mention agents or `task`.
- For industry best practices, external references, or open-source implementation comparisons, use `task` with `librarian`. For a specific library/framework/API, also use Context7 as required.
- For broad, unfamiliar, or cross-module engineering-state analysis, use `task` with `scout` or `code-scout`; use direct tools only for narrow, known-location questions.
- When internal-state analysis and external-practice research are both requested, dispatch the independent `scout` and `librarian` slices in one parallel `task` batch.
- Explicit requests to parallelize, split work, or have multiple agents analyze MUST use `task`.
- Do not avoid delegation merely because the main assistant could perform the search directly; delegate when specialist context, broad exploration, or independent evidence materially improves coverage.
- Do not invent agent slices. Keep small, deterministic, known-location work on direct tools.