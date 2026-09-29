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
export const QUERY = { code: 0x1, position: 0x2, attack: 0x100, defense: 0x200, baseAttack: 0x400, baseDefense: 0x800 } as const
export const TYPE_TOKEN = 0x4000

export type CardData = { code: number; name: string; type: number; atk: number; def: number }

export type Ocg = {
  wrapper: OcgWrapper
  card(code: number): CardData | undefined
  scriptErrors: string[] // the most recent script errors, newest last
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
  const rows = db.exec('select d.id, t.name, d.type, d.atk, d.def from datas d join texts t on t.id = d.id')[0]?.values ?? []
  for (const [code, name, type, atk, def] of rows as [number, string, number, number, number][]) cards.set(code, { code, name, type, atk, def })

  const scriptErrors: string[] = []
  const wrapper = await Core.createOcgcoreWrapper()
  wrapper.setScriptReader(Core.DirScriptReader(join(dir, 'scripts')))
  wrapper.setCardReader(Core.SqljsCardReader(db))
  wrapper.setMessageHandler((_duel, message, type) => {
    if (type !== Core.OcgcoreMessageType.ScriptError) return
    scriptErrors.push(String(message))
    if (scriptErrors.length > 50) scriptErrors.shift()
  })
  return { wrapper, card: (code) => cards.get(code), scriptErrors }
}
