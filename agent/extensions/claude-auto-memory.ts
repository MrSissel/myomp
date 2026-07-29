// Claude Code Auto Memory bridge for OMP
//
// Injects ~/.claude/projects/<encoded-cwd>/memory/MEMORY.md into the
// provider request payload, matching Claude Code's auto-memory behavior:
//   - Only MEMORY.md is loaded (topic files are read on demand)
//   - Capped at 200 lines or 25KB, whichever comes first
//   - Includes write guidance so the agent can update MEMORY.md via edit/write tools
//
// Uses before_provider_request (not before_agent_start) because OMP's
// internal tool-signature rebuild can overwrite systemPrompt changes made
// in before_agent_start. before_provider_request fires at the wire boundary,
// so the injection survives.

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_LINES = 200;
const MAX_BYTES = 25_000;
// Claude Code writes a reminder when the file approaches the cap; we mirror that at 80 % so the agent has room to shorten before truncation.
const NEAR_LIMIT_LINES = 160;
const NEAR_LIMIT_BYTES = 20_000;

interface ExtensionContext {
	cwd: string;
}

interface ProviderPayload {
	system?: unknown;
	messages?: unknown[];
	[key: string]: unknown;
}

interface ExtensionApi {
	setLabel(label: string): void;
	on(
		event: "before_provider_request",
		handler: (event: { type: "before_provider_request"; payload: unknown }, ctx: ExtensionContext) => Promise<unknown | void>,
	): void;
}

/** Cached memory content keyed by resolved path; invalidated on file change via mtime. */
let cachedPath: string | undefined;
let cachedMtime = 0;
let cachedContent: string | undefined;

/**
 * Walk from cwd upward to home, returning the first existing MEMORY.md under
 * ~/.claude/projects/<encoded>/memory/. This mirrors Claude Code's git-repo
 * scoping: subdirs resolve to the same repo-level memory directory.
 *
 * Claude Code encodes project paths by replacing "/" with "-". Some directory
 * names contain "_" (e.g. "04-workspace_jpstar"), and Claude's encoding also
 * turns those into "-", so we try both variants.
 */
async function findMemoryMd(cwd: string): Promise<string | undefined> {
	const projectsDir = join(homedir(), ".claude", "projects");

	// Prefer the git repository root: Claude Code derives <project> from the
	// git repo, so all worktrees/subdirs share one memory directory. This is
	// essential for worktrees whose cwd sits on a different filesystem branch
	// than the main repo — a cwd walk-up could never reach it.
	//
	// `git rev-parse --git-common-dir` points at the shared .git directory; in
	// a worktree that is the main repo's .git, whose parent is the main work
	// tree — the path Claude Code encodes for project memory.
	let gitRoot: string | undefined;
	try {
		const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
		if (r.status === 0 && r.stdout) {
			const gitDir = r.stdout.trim();
			if (gitDir) gitRoot = dirname(resolve(cwd, gitDir));
		}
	} catch {
		// git unavailable — fall through to cwd walk-up
	}

	if (gitRoot) {
		for (const encoded of [
			gitRoot.replaceAll("/", "-"),
			gitRoot.replaceAll(/[/_]/g, "-"),
		]) {
			const candidate = join(projectsDir, encoded, "memory", "MEMORY.md");
			try {
				await stat(candidate);
				return candidate;
			} catch {
				// try next variant
			}
		}
	}

	// Fallback: walk cwd upward to home (covers non-git dirs and git failures).
	let current = resolve(cwd);
	const home = homedir();

	for (;;) {
		const variants = [
			current.replaceAll("/", "-"),
			current.replaceAll(/[/_]/g, "-"),
		];
		for (const encoded of variants) {
			const candidate = join(projectsDir, encoded, "memory", "MEMORY.md");
			try {
				await stat(candidate);
				return candidate;
			} catch {
				// try next variant
			}
		}
		const parent = dirname(current);
		if (parent === current || current === home) return undefined;
		current = parent;
	}
}

/**
 * Read MEMORY.md with Claude Code's load limits:
 * first 200 lines or first 25KB, whichever comes first.
 */
async function loadMemoryMd(filePath: string): Promise<string> {
	const raw = await readFile(filePath, "utf8");
	const bytes = Buffer.byteLength(raw, "utf8");
	if (bytes <= MAX_BYTES) {
		const lines = raw.split("\n");
		return lines.length <= MAX_LINES ? raw : lines.slice(0, MAX_LINES).join("\n");
	}
	return Buffer.from(raw, "utf8").subarray(0, MAX_BYTES).toString("utf8");
}

async function measureMemorySize(filePath: string): Promise<{ lineCount: number; byteCount: number }> {
	const raw = await readFile(filePath, "utf8");
	return {
		lineCount: raw ? raw.split("\n").length : 0,
		byteCount: Buffer.byteLength(raw, "utf8"),
	};
}

/** Read with mtime cache so repeated requests don't re-read the file. */
async function getMemoryContent(cwd: string): Promise<string | undefined> {
	const memoryPath = await findMemoryMd(cwd);
	if (!memoryPath) return undefined;

	try {
		const s = await stat(memoryPath);
		const mtime = s.mtimeMs;
		if (memoryPath === cachedPath && mtime === cachedMtime && cachedContent !== undefined) {
			return cachedContent;
		}
		const content = await loadMemoryMd(memoryPath);
		if (!content.trim()) return undefined;
		cachedPath = memoryPath;
		cachedMtime = mtime;
		cachedContent = content;
		return content;
	} catch {
		return undefined;
	}
}

function buildMemoryBlock(content: string, sourcePath: string, memoryDir: string): string {
	return [
		"<claude-auto-memory>",
		`Source: ${sourcePath}`,
		"Auto-generated project memory imported from Claude Code.",
		"Heuristic historical context — current instructions and repo state take precedence.",
		"",
		content.trimEnd(),
		"",
		"## Memory Management",
		"",
		`You can read this file at: ${sourcePath}`,
		`Topic files directory: ${memoryDir}`,
		"",
		"This MEMORY.md was written by previous Claude Code sessions. Treat entries as heuristic",
		"context, not authoritative configuration — your current task and repo state take precedence.",
		"",
		"### CLAUDE.md vs MEMORY.md",
		"",
		"- CLAUDE.md is the user's persistent instructions to you. Use it for: coding standards, workflows,",
		"  project architecture, \"always do X\" rules.",
		"- MEMORY.md is your own notebook about this project. Use it for: build commands you discovered,",
		"  debugging insights, architecture notes, preferences the user corrected you on.",
		"",
		"If the user says \"add this to CLAUDE.md\" or \"always do X\", write CLAUDE.md. If you discover a",
		"durable project fact, write MEMORY.md.",
		"",
		"### When to update MEMORY.md",
		"",
		"- The user says \"remember this\" or corrects your behavior (\"don't use X, use Y\").",
		"- You discover a durable project fact: a build command, a debugging fix, an architectural insight.",
		"- You finish a recurring task and want to capture the pattern.",
		"",
		"### How to update MEMORY.md",
		"",
		"1. Read MEMORY.md first to check existing entries — avoid duplicates and contradictions.",
"2. To add / update / delete an entry: read MEMORY.md, edit its text in place (append / modify / remove a line),",
"   then write the whole file back. MEMORY.md is an index kept under 200 lines / 25 KB, so full-file overwrite is fine.",
`3. To create a topic file, use write: path = ${memoryDir}/<topic>.md.`,
		"",
		"Keep MEMORY.md as an INDEX of topic files. Detailed notes go to topic files (debugging.md,",
		"patterns.md, etc.) referenced from MEMORY.md. Target under 200 lines / 25 KB.",
		"",
		"Index format:",
		"",
		"- debugging.md — CORS and webpack config fixes",
		"- patterns.md — build commands and code style preferences",
		"",
		"Frontmatter (YAML at top of file) and `<!-- HTML block comments -->` are stripped before the",
		"200-line / 25 KB limit is measured. Use them to mark `modified: <iso8601>` timestamps or to",
		"leave human-maintainer notes without spending tokens.",
		"",
		"### Subagent caveat",
		"",
		"Your MEMORY.md is NOT loaded into subagents you spawn (only into forks). Subagents that need",
		"this context must Read MEMORY.md themselves.",
		"",
		"### Do NOT save",
		"",
		"- Temporary debugging state (one-bug specifics).",
		"- Info derivable from the codebase (file paths, package lists, directory layouts).",
		"- Secrets (tokens, passwords, API keys, account IDs).",
		"- One-shot Q&A answers (\"this function returns X\").",
		"- Work-in-progress unstable facts (\"we're migrating to FastAPI\" while it is still changing).",
		"- Anything already in CLAUDE.md.",
		"</claude-auto-memory>",
	].join("\n");
}

function buildReminderBlock(lineCount: number, byteCount: number): string {
	return [
		"## MEMORY.md Size Warning",
		"",
		`MEMORY.md is now at ${lineCount} lines / ${byteCount} bytes, approaching the 200-line / 25 KB load limit.`,
		"",
		"- Keep one line per entry.",
		"- Move detailed notes to topic files (debugging.md, patterns.md, etc.) and reference them from the MEMORY.md index.",
		"- Merge or drop stale entries.",
		"- YAML frontmatter and <!-- HTML comments --> are stripped before the load limit is measured; use them freely.",
	].join("\n");
}

/**
 * Inject the memory block into the provider payload's system field.
 * Handles Anthropic-style (system as string or array of {type,text}) and
 * OpenAI-style (system role in messages array).
 */
function injectIntoPayload(payload: ProviderPayload, block: string): ProviderPayload {
	const cloned: ProviderPayload = { ...payload };

	if (Array.isArray(cloned.system)) {
		cloned.system = [...(cloned.system as unknown[]), { type: "text", text: block }];
	} else if (typeof cloned.system === "string") {
		cloned.system = cloned.system + "\n\n" + block;
	} else if (Array.isArray(cloned.messages)) {
		const msgs = [...cloned.messages] as Array<Record<string, unknown>>;
		const sysEntry = { role: "system", content: block };
		const firstSysIdx = msgs.findIndex(m => m.role === "system");
		if (firstSysIdx >= 0) {
			msgs.splice(firstSysIdx + 1, 0, sysEntry);
		} else {
			msgs.unshift(sysEntry);
		}
		cloned.messages = msgs;
	}

	return cloned;
}

export default function claudeAutoMemory(pi: ExtensionApi): void {
	pi.setLabel("Claude Auto Memory Bridge");

	pi.on("before_provider_request", async (event, ctx) => {
		const content = await getMemoryContent(ctx.cwd);
		if (!content || !cachedPath) return;

		let block = buildMemoryBlock(content, cachedPath, dirname(cachedPath));
		try {
			const { lineCount, byteCount } = await measureMemorySize(cachedPath);
			if (lineCount >= NEAR_LIMIT_LINES || byteCount >= NEAR_LIMIT_BYTES) {
				block += "\n\n" + buildReminderBlock(lineCount, byteCount);
			}
		} catch {
			// The file may disappear after loading; keep the memory injection without a size warning.
		}
		const payload = event.payload as ProviderPayload;
		return injectIntoPayload(payload, block);
	});
}