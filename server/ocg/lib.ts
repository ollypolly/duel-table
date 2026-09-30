// The YGOPro rules core (ocgcore compiled to WASM, via koishipro-core.js) and
// its data: card scripts and the card database, from `npm run fetch-ocg`.
//
// Both packages are loaded through require: the ESM build of the WASM loader
// breaks under Node, and message classes are checked with instanceof, so
// everything must share the CommonJS copy of ygopro-msg-encode.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as CoreModule from 'koishipro-core.js'
import type * as MsgModule from 'ygopro-msg-encode'
import type { Database } from 'sql.js'

const require = createRequire(import.meta.url)
export const Core: typeof CoreModule = require('koishipro-core.js')
export const M: typeof MsgModule = require('ygopro-msg-encode')
const initSqlJs: typeof import('sql.js').default = require('sql.js')

export type Msg = MsgModule.YGOProMsgBase
export type PromptMsg = MsgModule.YGOProMsgResponseBase
export type OcgWrapper = CoreModule.OcgcoreWrapper

// Locations and positions as the core numbers them.
export const LOC = { deck: 0x01, hand: 0x02, mzone: 0x04, szone: 0x08, grave: 0x10, removed: 0x20, extra: 0x40, overlay: 0x80 } as const
export const POS = { faceUpAtk: 0x1, faceDownAtk: 0x2, faceUpDef: 0x4, faceDownDef: 0x8 } as const
export const QUERY = { code: 0x1, position: 0x2, attack: 0x100, defense: 0x200, baseAttack: 0x400, baseDefense: 0x800, overlay: 0x10000 } as const
export const TYPE_TOKEN = 0x4000

export type CardData = { code: number; alias: number; setcode: bigint; name: string; type: number; race: number; attribute: number; atk: number; def: number; strings: string[] }

export type Ocg = {
  wrapper: OcgWrapper
  card(code: number): CardData | undefined
  cards(): Iterable<CardData>
  // The text for a core description: a card's effect string (code << 4 | n)
  // or a system string, from strings.conf.
  describe(desc: number): string | undefined
  system(n: number): string | undefined
  scriptErrors: string[] // the most recent script errors, newest last
  scripts: Map<string, string> // scripts we write, like a position's monsters, by path
}

export const ocgDataDir = () => process.env.OCG_DATA_DIR ?? 'data/ocg'

let loading: Promise<Ocg> | undefined

// Loaded once per process. Rejects with a readable error if the data is missing.
export function loadOcg(dir = ocgDataDir()): Promise<Ocg> {
  return (loading ??= load(dir).catch((e) => {
    loading = undefined
    throw e
  }))
}

async function load(dir: string): Promise<Ocg> {
  const cdb = join(dir, 'cards.cdb')
  if (!existsSync(cdb) || !existsSync(join(dir, 'scripts'))) {
    throw new Error(`the rules engine's data isn't in ${dir}: run \`npm run fetch-ocg\``)
  }
  const SQL = await initSqlJs()
  const db: Database = new SQL.Database(readFileSync(cdb))
  const cards = new Map<number, CardData>()
  const strs = Array.from({ length: 16 }, (_, i) => `t.str${i + 1}`).join(', ')
  const rows = db.exec(`select d.id, d.alias, d.setcode, t.name, d.type, d.race, d.attribute, d.atk, d.def, ${strs} from datas d join texts t on t.id = d.id`)[0]?.values ?? []
  type Row = [number, number, number, string, number, number, number, number, number, ...string[]]
  for (const [code, alias, setcode, name, type, race, attribute, atk, def, ...strings] of rows as Row[]) {
    cards.set(code, { code, alias, setcode: BigInt(setcode), name, type, race, attribute, atk, def, strings })
  }

  const system = new Map<number, string>()
  const conf = join(dir, 'strings.conf')
  if (existsSync(conf)) {
    for (const line of readFileSync(conf, 'utf8').split('\n')) {
      const m = /^!system (\d+) (.+)$/.exec(line.trim())
      if (m) system.set(Number(m[1]), m[2])
    }
  }
  const describe = (desc: number) => {
    if (desc < 0x10000) return system.get(desc)
    return cards.get(desc >> 4)?.strings[desc & 0xf] || undefined
  }

  const scriptErrors: string[] = []
  const wrapper = await Core.createOcgcoreWrapper()
  const scripts = new Map<string, string>()
  wrapper.setScriptReader(Core.DirScriptReader(join(dir, 'scripts')))
  wrapper.setScriptReader(Core.MapScriptReader(scripts))
  wrapper.setCardReader(Core.SqljsCardReader(db))
  wrapper.setMessageHandler((_duel, message, type) => {
    if (type !== Core.OcgcoreMessageType.ScriptError) return
    scriptErrors.push(String(message))
    if (scriptErrors.length > 50) scriptErrors.shift()
  })
  return { wrapper, card: (code) => cards.get(code), cards: () => cards.values(), describe, system: (n) => system.get(n), scriptErrors, scripts }
}
