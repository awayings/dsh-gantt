// The dispatch manual as a packaged skill. `skills/gantt-dispatch-flow/SKILL.md`
// ships inside the plugin tarball, and this module registers the provider that
// serves it from the gantt-long-run preset's own skills layer: installing the
// package is the whole distribution step — no per-host copy into a skills
// directory — while the base composition's `dsh-tool-skill` consumer surfaces
// the catalog entry and the `skill` tool loads the body on demand. Only the
// gantt-long-run preset composes the plugin that registers this provider
// (`long-run.js`, the preset row's gantt-knowledge mount), so standard
// conversations and every other preset never list the manual; the host plugin
// never touches the skills seam. The packaged candidate carries the bundled
// rank, so a user or project copy of the same name always outranks the
// shipped manual. The packaged file stays
// the single source of both halves: its frontmatter supplies the catalog
// metadata, and the served body is that file with the frontmatter stripped,
// the same normalization the filesystem provider applies to local skills.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** The packaged manual, resolved against this module inside the shipped tree. */
const SKILL_URL = new URL('../../skills/gantt-dispatch-flow/SKILL.md', import.meta.url)

/** Registry-visible provider name; unique inside one scope layer. */
const PROVIDER_NAME = 'gantt-dispatch-skill'

/**
 * The bundled rank published by `@deepseek-ai/dsh-skill`
 * (`BUNDLED_SKILL_RANK = 600`): packaged skills lose duplicate-name races
 * against project, custom, and user copies, so a local override always wins.
 * Mirrored as a literal because the plugin imports nothing beyond Node
 * built-ins.
 * @type {number}
 */
const BUNDLED_SKILL_RANK = 600

/** The kebab-case grammar the skill registry enforces on every candidate name. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Both invocation surfaces: the dispatcher model loads it, the UI lists it. */
const INVOCATION = { modelInvocable: true, userInvocable: true }

/** The skill's directory, offered as the resource base for relative assets. */
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(new URL('.', SKILL_URL)) }

/** The packaged file's absolute path, reported for human-facing skill lists. */
const SKILL_PATH = fileURLToPath(SKILL_URL)

/**
 * Parse one packaged skill document: `name` and `description` from the
 * frontmatter, the markdown body after the closing delimiter.
 * @param {string} text - the whole packaged file.
 * @returns {{ name: string, description: string, content: string }} the parsed
 *   catalog metadata and the frontmatter-stripped body.
 * @throws {Error} when the frontmatter is missing or unterminated, or its name
 *   or description fails the registry's candidate rules.
 */
export function parseSkillDocument(text) {
  if (!text.startsWith('---\n')) throw new Error('the packaged dispatch skill must open with a frontmatter delimiter')
  const lines = text.split('\n')
  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      closing = index
      break
    }
  }
  if (closing === -1) throw new Error('the packaged dispatch skill has no closing frontmatter delimiter')
  let name = ''
  let description = ''
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index]
    if (line.startsWith('name:')) name = line.slice('name:'.length).trim()
    else if (line.startsWith('description:')) description = line.slice('description:'.length).trim()
  }
  if (!SKILL_NAME.test(name)) throw new Error(`the packaged dispatch skill has an invalid name: ${JSON.stringify(name)}`)
  if (description === '') throw new Error('the packaged dispatch skill has no description')
  return { name, description, content: lines.slice(closing + 1).join('\n') }
}

/** @type {Promise<{ name: string, description: string, content: string }> | undefined} */
let loaded

/** Read and parse the packaged manual once per process; the shipped asset is
 * immutable, so a rejected load keeps failing loudly until the next install. */
function loadSkill() {
  loaded ??= readFile(SKILL_URL, 'utf8').then(parseSkillDocument)
  return loaded
}

/** The immutable packaged-skill provider behind the preset's registration. */
const provider = {
  name: PROVIDER_NAME,
  async list() {
    const { name, description } = await loadSkill()
    return [{
      name,
      description,
      invocation: INVOCATION,
      provider: PROVIDER_NAME,
      source: 'bundled',
      path: SKILL_PATH,
      resourceBase: RESOURCE_BASE,
      rank: BUNDLED_SKILL_RANK,
      locator: SKILL_PATH,
    }]
  },
  async get() {
    const { name, description, content } = await loadSkill()
    return {
      name,
      description,
      invocation: INVOCATION,
      provider: PROVIDER_NAME,
      source: 'bundled',
      path: SKILL_PATH,
      resourceBase: RESOURCE_BASE,
      content,
    }
  },
}

/**
 * Register the packaged manual's provider on the scope's skills service. The
 * preset's standing composition supplies the service (the plugin entry names
 * it in `inject`); a harness or headless context without one skips the
 * registration, the same way the knowledge and dispatch tools degrade without
 * a tools service.
 * @param {{ get?: (name: string) => any, effect?: (fn: () => () => void, hint?: string) => unknown }} ctx
 * @returns {void}
 */
export function registerDispatchSkill(ctx) {
  const skills = /** @type {{ registerProvider?: (create: () => unknown) => () => void } | undefined} */ (
    typeof ctx.get === 'function' ? ctx.get('skills') : undefined
  )
  if (skills === undefined || skills === null || typeof skills.registerProvider !== 'function') return
  // SkillRegistry.registerProvider files into its own scope layers, so keep
  // the service as the receiver instead of detaching the method.
  const registerProvider = skills.registerProvider.bind(skills)
  const dispose = registerProvider(() => provider)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => dispose, 'gantt long-run: dispatch manual skill')
  }
}
