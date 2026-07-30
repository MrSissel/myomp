// @orca-managed-pi-extension
// ponytail — lazy senior dev mode for OMP.
//
// Why: Ponytail ships an equivalent runtime at
// .claude/plugins/cache/ponytail/ponytail/<v>/pi-extension/index.js, but that
// targets the upstream pi CLI's extension host, not OMP's. OMP auto-loads any
// @orca-managed-pi-extension-marked .ts file from ~/.omp/agent/extensions/.
//
// Why before_provider_request (not before_agent_start): per
// claude-auto-memory.ts, "OMP's internal tool-signature rebuild can overwrite
// systemPrompt changes made in before_agent_start. before_provider_request
// fires at the wire boundary, so the injection survives." The Claude Code
// pi-extension uses before_agent_start because upstream pi has no
// before_provider_request hook; OMP exposes both, and the latter is the only
// one whose return value actually reaches the model.
//
// Why reuse hooks/: the instruction text and config resolution are versioned
// alongside the skill bodies. Vendoring them by re-requiring keeps the OMP
// extension byte-identical with the Claude Code one at any ponytail version.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

type PonytailMode = 'off' | 'lite' | 'full' | 'ultra' | 'review'

interface PonytailConfig {
  DEFAULT_MODE: PonytailMode
  getDefaultMode: () => PonytailMode
  normalizeMode: (m: unknown) => PonytailMode | null
  normalizeConfigMode: (m: unknown) => PonytailMode | null
  normalizePersistedMode: (m: unknown) => PonytailMode | null
  isDeactivationCommand: (text: string) => boolean
  writeDefaultMode: (m: string) => PonytailMode | null
}

interface PonytailInstructions {
  getPonytailInstructions: (mode: PonytailMode) => string
}

interface PonytailSessionEntry {
  type?: string
  customType?: string
  data?: { mode?: unknown }
}

interface PiUI {
  setStatus?: (name: string, text: string) => void
  setEditorText?: (text: string) => void
  theme?: {
    fg?: (color: string, text: string) => string
    bg?: (color: string, text: string) => string
    icon?: { auto?: string; fast?: string; search?: string }
  }
  notify?: (message: string, level: string) => void
}

interface PiSessionManager {
  getBranch?: () => PonytailSessionEntry[]
  getEntries?: () => PonytailSessionEntry[]
}

interface PiContext {
  ui?: PiUI
  sessionManager?: PiSessionManager
  isIdle?: () => boolean
}

interface ProviderSystemBlock {
  type: string
  text?: string
}

interface PiProviderPayload {
  instructions?: string
  system?: string | ProviderSystemBlock[]
  messages?: Array<Record<string, unknown>>
  [key: string]: unknown
}

function injectLadder(payload: PiProviderPayload, block: string): PiProviderPayload {
  const cloned: PiProviderPayload = { ...payload }

  // ponytail: omp's default provider (OpenAI Responses API) puts the system
  // prompt in `instructions`, not `system` or `messages`. Handle the three
  // shapes so the injection works regardless of the active provider.
  if (typeof cloned.instructions === 'string') {
    cloned.instructions = `${cloned.instructions}\n\n${block}`
  } else if (Array.isArray(cloned.system)) {
    cloned.system = [...cloned.system, { type: 'text', text: block }]
  } else if (typeof cloned.system === 'string') {
    cloned.system = `${cloned.system}\n\n${block}`
  } else if (Array.isArray(cloned.messages)) {
    const msgs = [...cloned.messages] as Array<Record<string, unknown>>
    const sysEntry = { role: 'system', content: block }
    const firstSysIdx = msgs.findIndex((m) => m.role === 'system')
    if (firstSysIdx >= 0) {
      msgs.splice(firstSysIdx + 1, 0, sysEntry)
    } else {
      msgs.unshift(sysEntry)
    }
    cloned.messages = msgs
  }

  return cloned
}

type CommandParsed =
  | { type: 'set-mode'; mode: PonytailMode }
  | { type: 'set-default'; mode: PonytailMode }
  | { type: 'status' }
  | { type: 'invalid'; reason: string; mode?: string }

function findPonytailRoot(): string | null {
  const bases: string[] = []
  if (process.env.PONYTAIL_INSTALL_PATH) bases.push(process.env.PONYTAIL_INSTALL_PATH)
  bases.push(path.join(os.homedir(), '.claude', 'plugins', 'cache', 'ponytail', 'ponytail'))

  for (const base of bases) {
    let versions: string[] = []
    try {
      versions = fs
        .readdirSync(base)
        .filter((d): d is string => /^\d+\.\d+\.\d+$/.test(d))
    } catch {
      continue
    }
    if (versions.length === 0) continue
    versions.sort().reverse()
    for (const v of versions) {
      const root = path.join(base, v)
      if (fs.existsSync(path.join(root, 'hooks', 'ponytail-config.js'))) {
        return root
      }
    }
  }
  return null
}

const ponytailRoot = findPonytailRoot()

if (!ponytailRoot) {
  // ponytail: silent skip rather than a hard failure on every OMP startup.
  // The skills are still loaded by OMP's skill scan; only the always-on
  // injection and slash command are unavailable.
  console.warn('ponytail: hooks/ not found under ~/.claude/plugins/cache; extension inactive.')
}

// ponytail: typing the require() result as the known vendor shape. The
// module's exports are a stable CJS interface owned by this same plugin
// family; the assignment is a typed bind, not an escape hatch.
const configModule: PonytailConfig = ponytailRoot
  ? (require(path.join(ponytailRoot, 'hooks', 'ponytail-config.js')) as PonytailConfig)
  : {
      DEFAULT_MODE: 'full',
      getDefaultMode: () => 'full',
      normalizeMode: () => null,
      normalizeConfigMode: () => null,
      normalizePersistedMode: () => null,
      isDeactivationCommand: () => false,
      writeDefaultMode: () => null,
    }

const instructionsModule: PonytailInstructions = ponytailRoot
  ? (require(path.join(ponytailRoot, 'hooks', 'ponytail-instructions.js')) as PonytailInstructions)
  : {
      getPonytailInstructions: (mode) =>
        `PONYTAIL MODE ACTIVE — level: ${mode}. (ponytail hooks not loaded; install via Claude Code marketplace to restore full instructions.)`,
    }

const { DEFAULT_MODE, getDefaultMode, normalizeMode, normalizeConfigMode,
        normalizePersistedMode, writeDefaultMode } = configModule
const { getPonytailInstructions } = instructionsModule



function resolveSessionMode(
  entries: PonytailSessionEntry[] | null | undefined,
  fallbackMode: PonytailMode,
): PonytailMode {
  const fallback = normalizePersistedMode(fallbackMode) || DEFAULT_MODE
  if (!Array.isArray(entries)) return fallback
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry?.type !== 'custom' || entry?.customType !== 'ponytail-mode') continue
    const mode = normalizePersistedMode(entry?.data?.mode)
    if (mode) return mode
  }
  return fallback
}

function parsePonytailCommand(text: string, defaultMode: PonytailMode): CommandParsed {
  const fallback = normalizePersistedMode(defaultMode) || DEFAULT_MODE
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) {
    return { type: 'set-mode', mode: fallback === 'off' ? 'full' : fallback }
  }
  const parts = normalized.split(/\s+/)
  const primary = parts[0]
  const secondary = parts[1]
  if (primary === 'status') return { type: 'status' }
  if (primary === 'default') {
    const mode = normalizeConfigMode(secondary)
    return mode
      ? { type: 'set-default', mode }
      : { type: 'invalid', reason: 'invalid-default-mode' }
  }
  const mode = normalizeMode(primary)
  return mode
    ? { type: 'set-mode', mode }
    : { type: 'invalid', reason: 'invalid-mode', mode: primary }
}

// ponytail: labels + OMP theme icons (auto/fast/search) — monospace-safe,
// follow the active symbol preset (unicode/nerd/ascii). Claude Code's hooks
// use plant/bolt/fire glyphs; OMP has no equivalents, so we map by intent.
const MODE_META: Record<PonytailMode, { label: string; icon: 'auto' | 'fast' | 'search' }> = {
  lite: { label: 'LITE', icon: 'auto' },
  full: { label: 'FULL', icon: 'auto' },
  ultra: { label: 'ULTRA', icon: 'fast' },
  off: { label: 'OFF', icon: 'auto' },
  review: { label: 'REVIEW', icon: 'search' },
}

function renderStatus(mode: PonytailMode): string {
  if (mode === 'off') return ''
  return `ponytail:${MODE_META[mode].label}`
}
interface PiBeforeProviderRequestEvent {
  type?: 'before_provider_request'
  payload?: unknown
}

interface PiCommandDef {
  description: string
  handler: (args: string, ctx: PiContext | null) => Promise<void> | void
}

interface PiHost {
  registerCommand: (name: string, def: PiCommandDef) => void
  sendUserMessage: (message: string, opts?: { deliverAs?: string }) => void
  appendEntry: (type: string, data: unknown) => void
  on: (event: string, handler: (...args: unknown[]) => unknown) => void
}

export default function ponytailExtension(pi: PiHost) {
  let currentMode: PonytailMode = DEFAULT_MODE
  let configuredDefaultMode: PonytailMode = getDefaultMode()
  let isActive = false
  let lastCtx: PiContext | null = null

  function syncStatus(ctx: PiContext | null) {
    if (ctx) lastCtx = ctx
    const target = ctx || lastCtx
    const setStatus = target?.ui?.setStatus
    if (!setStatus) return
    const raw = renderStatus(currentMode)
    if (!raw) {
      setStatus('ponytail', '')
      return
    }
    const theme = target?.ui?.theme
    if (!theme?.fg) {
      setStatus('ponytail', raw)
      return
    }
    const icon = theme.icon?.[MODE_META[currentMode].icon] ?? ''
    const labeled = icon ? `${icon} ${raw}` : raw
    const colored = theme.fg(isActive ? 'accent' : 'dim', labeled)
    setStatus('ponytail', theme.bg ? theme.bg('statusLineBg', colored) : colored)
  }

  function setMode(mode: PonytailMode, ctx: PiContext | null): void {
    const normalized = normalizePersistedMode(mode)
    if (!normalized) return
    currentMode = normalized
    try {
      pi.appendEntry('ponytail-mode', { mode: normalized })
    } catch {
      // ponytail: appendEntry may be unavailable in some hosts; mode still
      // applies for the current session, just not persisted across restarts.
    }
    syncStatus(ctx)
    ctx?.ui?.notify?.(`Ponytail mode set to ${normalized}.`, 'info')
  }

  pi.registerCommand('ponytail', {
    description: 'Set or report Ponytail mode',
    handler: async (args, ctx) => {
      const parsed = parsePonytailCommand(args || '', configuredDefaultMode)
      if (parsed.type === 'status') {
        ctx?.ui?.notify?.(
          `Ponytail: current ${currentMode} • default ${configuredDefaultMode}`,
          'info',
        )
        return
      }
      if (parsed.type === 'set-default') {
        const written = writeDefaultMode(parsed.mode)
        if (!written) return
        configuredDefaultMode = getDefaultMode()
        const message =
          configuredDefaultMode === written
            ? `Default Ponytail mode set to ${written}.`
            : `Saved default ${written}, but env override keeps default at ${configuredDefaultMode}.`
        ctx?.ui?.notify?.(message, 'info')
        return
      }
      if (parsed.type === 'set-mode') {
        setMode(parsed.mode, ctx)
        return
      }
      ctx?.ui?.notify?.('Unknown or unsupported /ponytail mode.', 'warning')
    },
  })

  pi.on('session_start', (_rawEvent, rawCtx) => {
    const ctx = rawCtx as PiContext | undefined
    const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || []
    configuredDefaultMode = getDefaultMode()
    currentMode = resolveSessionMode(entries, configuredDefaultMode)
    syncStatus(ctx ?? null)
    ctx?.ui?.notify?.(`Ponytail loaded: ${currentMode}`, 'info')
  })

  pi.on('agent_start', (_rawEvent, rawCtx) => {
    isActive = true
    syncStatus(rawCtx as PiContext | null)
  })

  pi.on('agent_end', (_rawEvent, rawCtx) => {
    isActive = false
    syncStatus(rawCtx as PiContext | null)
  })

  pi.on('before_provider_request', (rawEvent) => {
    const event = rawEvent as PiBeforeProviderRequestEvent | undefined
    if (!currentMode || currentMode === 'off') return
    const payload = event?.payload
    if (!payload || typeof payload !== 'object') return
    const block = getPonytailInstructions(currentMode)
    return injectLadder(payload as PiProviderPayload, block)
  })
}