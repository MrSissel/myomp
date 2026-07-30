// Claude Code .claude/rules/ bridge for omp.
//
// Discovers .claude/rules/*.md and *.mdc (Claude Code format) from cwd
// (walked up to home) and from ~/.claude/rules/, then injects matching
// rules into the provider request payload. Single source of truth for
// rule content — files under .claude/rules/ remain editable from either
// Claude Code or omp sessions.
//
// Why before_provider_request (not before_agent_start):
//   omp's internal tool-signature rebuild overwrites systemPrompt changes
//   made in before_agent_start. before_provider_request fires at the
//   wire boundary, so the injection survives. (Same rationale as
//   claude-auto-memory.ts in this directory.)
//
// Frontmatter fields read:
//   - paths | globs | applyTo  → file-match globs (merged)
//   - alwaysApply              → always inject regardless of cwd/files
//   - description              → metadata for /claude-rules listing
//
// Path matching heuristic — a rule is injected if ANY of:
//   - alwaysApply: true
//   - cwd is under any of the rule's globs
//   - a touched file (tracked via tool_call) matches any glob
//
// Token cap: 12 KB total per provider request (aligned with pi-rules).
// Zero external deps — hand-rolled frontmatter + glob to avoid yaml/picomatch.

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const MAX_BYTES = 12_000;
const MAX_RULE_BYTES = 6_000; // ponytail: per-rule ceiling so one giant file can't dominate

interface Rule {
	name: string;
	filePath: string;
	body: string;
	globs: string[];
	alwaysApply: boolean;
	description: string;
}

interface ProviderPayload {
	system?: unknown;
	messages?: unknown[];
	[key: string]: unknown;
}

interface ExtensionContext {
	cwd: string;
	ui: { notify(msg: string, level: string): void };
}

interface ExtensionApi {
	setLabel(label: string): void;
	on(event: "session_start", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
	on(event: "session_switch" | "session_branch" | "session_tree", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
	on(event: "tool_call", handler: (event: { toolName: string; input: unknown }, ctx: ExtensionContext) => void): void;
	on(event: "before_provider_request", handler: (event: { type: "before_provider_request"; payload: unknown }, ctx: ExtensionContext) => Promise<unknown | void>): void;
	registerCommand(name: string, opts: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }): void;
}

// per-process session state (mirrors claude-auto-memory.ts pattern)
let rules: Rule[] = [];
let touchedFiles = new Set<string>();

const HOME = homedir();

function toArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
	if (typeof v === "string" && v.length) return [v];
	return [];
}
function parseFrontmatter(yaml: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const lines = yaml.split("\n");
	let i = 0;
	while (i < lines.length) {
		const m = lines[i].match(/^([\w-]+)\s*:\s*(.*)$/);
		if (!m) { i++; continue; }
		const [, k, raw] = m;
		const v = raw.trim();
		if (v === "") {
			const items: string[] = [];
			let j = i + 1;
			while (j < lines.length) {
				const it = lines[j].match(/^\s*-\s*(.*)$/);
				if (!it) break;
				items.push(it[1].trim().replace(/^["']|["']$/g, ""));
				j++;
			}
			out[k] = items.length > 0 ? items : "";
			i = j;
			continue;
		}
		if (v === "true") out[k] = true;
		else if (v === "false") out[k] = false;
		else if (v.startsWith("[") && v.endsWith("]")) out[k] = v.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
		else out[k] = v.replace(/^["']|["']$/g, "");
		i++;
	}
	return out;
}

/** Glob → RegExp. ** → .*, * → [^/]*. No picomatch dep. */
function globToRegex(pattern: string): RegExp {
	const re = "^" + pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "\0")
		.replace(/\*/g, "[^/]*")
		.replace(/\0/g, ".*")
		.replace(/\?/g, "[^/]") + "$";
	return new RegExp(re);
}

function matchGlob(filePath: string, pattern: string): boolean {
	const fp = filePath.replace(/^\.\//, "");
	const pat = pattern.replace(/^\.\//, "");
	if (globToRegex(pat).test(fp)) return true;
	const base = basename(fp);
	const patBase = basename(pat);
	return patBase !== pat && globToRegex(patBase).test(base);
}

async function parseRule(filePath: string): Promise<Rule | null> {
	let raw: string;
	try { raw = await readFile(filePath, "utf8"); } catch { return null; }
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	let fm: Record<string, unknown> = {};
	let body = raw;
	if (m) {
		fm = parseFrontmatter(m[1]);
		body = m[2].trim();
	}
	const globs = [
		...toArray(fm.paths),
		...toArray(fm.globs),
		...toArray(fm.applyTo),
	];
	return {
		name: basename(filePath).replace(/\.(md|mdc)$/, ""),
		filePath,
		body: body.length > MAX_RULE_BYTES ? body.slice(0, MAX_RULE_BYTES) + "\n\n[...truncated]" : body,
		globs,
		alwaysApply: fm.alwaysApply === true,
		description: typeof fm.description === "string" ? fm.description : "",
	};
}

async function scanRulesDir(dir: string, out: Rule[], seen: Set<string>): Promise<void> {
	if (!existsSync(dir)) return;
	let entries: string[];
	try { entries = await readdir(dir); } catch { return; }
	for (const name of entries) {
		if (!name.endsWith(".md") && !name.endsWith(".mdc")) continue;
		const fp = join(dir, name);
		if (seen.has(fp)) continue;
		seen.add(fp);
		const r = await parseRule(fp);
		if (r) out.push(r);
	}
}

/** Walk cwd up to HOME + scan user-home ~/.claude/rules/. */
async function discoverRules(cwd: string): Promise<Rule[]> {
	const out: Rule[] = [];
	const seen = new Set<string>();
	let dir = resolve(cwd);
	for (;;) {
		await scanRulesDir(join(dir, ".claude", "rules"), out, seen);
		const parent = dirname(dir);
		if (parent === dir || dir === HOME) break;
		dir = parent;
	}
	await scanRulesDir(join(HOME, ".claude", "rules"), out, seen);
	return out;
}

async function probeDirs(cwd: string): Promise<{ scanned: string[]; home: string }> {
	const scanned: string[] = [];
	let dir = resolve(cwd);
	for (;;) {
		scanned.push(join(dir, ".claude", "rules"));
		const parent = dirname(dir);
		if (parent === dir || dir === HOME) break;
		dir = parent;
	}
	scanned.push(join(HOME, ".claude", "rules"));
	return { scanned, home: HOME };
}

function selectRules(): Rule[] {
	const matched: Rule[] = [];
	for (const r of rules) {
		if (r.alwaysApply) { matched.push(r); continue; }
		if (r.globs.length === 0) continue;
		let hit = false;
		for (const f of touchedFiles) {
			for (const g of r.globs) {
				if (matchGlob(f, g)) { hit = true; break; }
			}
			if (hit) break;
		}
		if (hit) matched.push(r);
	}
	return matched;
}

/** Inject into payload.system — Anthropic array, OpenAI string, or messages[0]. */
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
		if (firstSysIdx >= 0) msgs.splice(firstSysIdx + 1, 0, sysEntry);
		else msgs.unshift(sysEntry);
		cloned.messages = msgs;
	}
	return cloned;
}

function buildBlock(matched: Rule[]): string {
	if (matched.length === 0) return "";
	const blocks: string[] = [];
	let used = 0;
	for (const r of matched) {
		const head = `<!-- claude-rules: ${r.filePath} -->`;
		const piece = `${head}\n${r.body}`;
		if (used + piece.length > MAX_BYTES) break;
		blocks.push(piece);
		used += piece.length;
	}
	if (blocks.length === 0) return "";
	return [
		"## Project Rules (auto-loaded from .claude/rules/)",
		"",
		"Rules below are auto-injected because your current task touches matching paths. Source of truth: `<repo>/.claude/rules/*.md`.",
		"",
		blocks.join("\n\n---\n\n"),
	].join("\n");
}

/** Pull file path from omp tool input (canonical field: `path`). */
function extractPaths(input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const obj = input as Record<string, unknown>;
	const v = obj.path;
	return typeof v === "string" && /[\w./]/.test(v) ? [v] : [];
}

let lastError: string | undefined;

export default function claudeRulesBridge(pi: ExtensionApi): void {
	const reload = async (cwd: string): Promise<void> => {
		try {
			rules = await discoverRules(cwd);
			touchedFiles.clear();
			lastError = undefined;
		} catch (e) {
			rules = [];
			lastError = (e as Error).message ?? String(e);
		}
	};

	pi.on("session_start", async (_e, ctx) => { await reload(ctx.cwd); });
	for (const evt of ["session_switch", "session_branch", "session_tree"] as const) {
		pi.on(evt, async (_e, ctx) => { await reload(ctx.cwd); });
	}

	pi.on("tool_call", event => {
		for (const p of extractPaths(event.input)) {
			const cleaned = p.replace(/^\.\//, "").trim();
			if (cleaned) touchedFiles.add(cleaned);
		}
	});

	pi.on("before_provider_request", async (event, ctx) => {
		if (rules.length === 0) return;
		const matched = selectRules();
		if (matched.length === 0) return;
		const block = buildBlock(matched);
		if (!block) return;
		return injectIntoPayload(event.payload as ProviderPayload, block);
	});

	pi.registerCommand("claude-rules", {
		description: "List .claude/rules/ files. Subcommand: reload",
		handler: async (args, ctx) => {
			const sub = (args ?? "").trim();
			if (sub === "reload") {
				await reload(ctx.cwd);
				ctx.ui.notify(`[claude-rules] reloaded — ${rules.length} rules`, "info");
				return;
			}
			if (rules.length === 0) {
				const probe = await probeDirs(ctx.cwd);
				ctx.ui.notify(`[claude-rules] no rules loaded\ncwd: ${ctx.cwd}\nscanned: ${probe.scanned.join(", ") || "(none)"}\nhome: ${probe.home}\n${lastError ? `error: ${lastError}` : "no .claude/rules/ in cwd walk-up or ~/.claude/rules/"}`, "info");
				return;
			}
			const lines = rules.map(r => {
				const flags = [
					r.alwaysApply ? "alwaysApply" : null,
					r.globs.length ? `globs=[${r.globs.join(",")}]` : null,
				].filter(Boolean).join(" ");
				return `- ${r.name}  ${flags}\n  ${r.filePath}`;
			});
			ctx.ui.notify(`[claude-rules] ${rules.length} rules:\n${lines.join("\n")}`, "info");
		},
	});
}