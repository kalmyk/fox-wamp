import { promises as fsp } from 'fs'
import { TOTAL_SHARDS_COUNT } from './netengine'
import { defaultParse, match } from '../topic_pattern'

// A dbNodes.<id>.storage entry is "<realm>:<key-pattern>", split on the first ':'.
// realm is matched exact-or-'*'; key-pattern is parsed/matched with the same
// defaultParse()/match() functions already used for projection uri_pattern matching
// (see openspec/changes/add-kv-node-topology/design.md Decision 2) — no second
// pattern-matching implementation for this concept.
export function parseStoragePattern (pattern: string): { realm: string; keyPattern: string[] } {
  const idx = pattern.indexOf(':')
  const realm = idx === -1 ? pattern : pattern.slice(0, idx)
  const keyPatternStr = idx === -1 ? '' : pattern.slice(idx + 1)
  return { realm, keyPattern: defaultParse(keyPatternStr) }
}

export class Config {
  private config: any = {}

  async loadConfigFile (configFileName: string) {
    return fsp
      .readFile(configFileName)
      .then(body => {
        this.config = JSON.parse(body.toString())
      })
  }

  // get(key: string) {
  //   return this.config[key]
  // }

  // set(key: string, value) {
  //   this.config[key] = value
  // }

  getEntryNodes () {
    return this.config.entryNodes
  }

  getSyncNodes () {
    return this.config.syncNodes
  }

  getSyncById (nodeId: string) {
    const result = this.config.syncNodes[nodeId]
    if (!result) {
      throw Error('Sync node with id ' + nodeId + ' not found')
    }
    return result
  }

  getGateById (nodeId: string) {
    const result = this.config.entryNodes[nodeId]
    if (!result) {
      throw Error('Entry node with id ' + nodeId + ' not found')
    }
    return result
  }

  getSyncQuorum () {
    return this.config.syncQuorum || 2
  }

  getEventNodes (): { [nodeId: string]: any } | undefined {
    return this.config.eventNodes
  }

  findShardsForNode (nodeId: string): number[] {
    const eventNodes = this.config.eventNodes
    if (!eventNodes) return []
    const node = eventNodes[nodeId]
    if (!node || !Array.isArray(node.shards)) return []
    return node.shards
  }

  validateShardsForNode (nodeId: string): void {
    for (const shard of this.findShardsForNode(nodeId)) {
      if (!Number.isInteger(shard) || shard < 0 || shard >= TOTAL_SHARDS_COUNT) {
        throw Error(`eventNodes.${nodeId}: shard ${shard} out of range [0, ${TOTAL_SHARDS_COUNT - 1}]`)
      }
    }
  }

  getDbNodes (): { [nodeId: string]: any } | undefined {
    return this.config.dbNodes
  }

  getDbNodeById (nodeId: string) {
    const result = this.config.dbNodes && this.config.dbNodes[nodeId]
    if (!result) {
      throw Error('Db node with id ' + nodeId + ' not found')
    }
    return result
  }

  findStoragePatternsForNode (nodeId: string): string[] {
    const dbNodes = this.config.dbNodes
    if (!dbNodes) return []
    const node = dbNodes[nodeId]
    if (!node || !Array.isArray(node.storage)) return []
    return node.storage
  }

  // Node-level storage responsibility gate (see add-kv-node-topology spec delta,
  // "Node-Level Storage Responsibility Gate"): does any of this node's configured
  // storage patterns cover the given realm+URI combination.
  nodeOwnsRealmAndUri (nodeId: string, realmName: string, uriParts: string[]): boolean {
    for (const pattern of this.findStoragePatternsForNode(nodeId)) {
      const { realm, keyPattern } = parseStoragePattern(pattern)
      if (realm !== '*' && realm !== realmName) {
        continue
      }
      if (match(uriParts, keyPattern)) {
        return true
      }
    }
    return false
  }

  // Ids of dbNodes that declare an exact (non-wildcard) realm pattern for this realm. Used to let
  // an explicit owner take a realm's first registration ahead of a node that only covers it via '*'.
  findExactRealmOwners (realmName: string): string[] {
    const dbNodes = this.config.dbNodes
    if (!dbNodes) return []
    const owners: string[] = []
    for (const nodeId of Object.keys(dbNodes)) {
      for (const pattern of this.findStoragePatternsForNode(nodeId)) {
        if (parseStoragePattern(pattern).realm === realmName) {
          owners.push(nodeId)
          break
        }
      }
    }
    return owners
  }

  validateStorageForNode (nodeId: string): void {
    for (const pattern of this.findStoragePatternsForNode(nodeId)) {
      const idx = pattern.indexOf(':')
      if (idx === -1) {
        throw Error(`dbNodes.${nodeId}: storage pattern "${pattern}" is missing the realm:key-pattern separator`)
      }
      const realm = pattern.slice(0, idx)
      const keyPatternStr = pattern.slice(idx + 1)
      if (realm.length === 0) {
        throw Error(`dbNodes.${nodeId}: storage pattern "${pattern}" has an empty realm segment`)
      }
      if (keyPatternStr.length === 0) {
        throw Error(`dbNodes.${nodeId}: storage pattern "${pattern}" has an empty key-pattern segment`)
      }
    }
  }
}

let configInstance: Config | undefined = undefined

export function getConfigInstance (): Config {
  if (!configInstance) {
    configInstance = new Config()
  }
  return configInstance
}

export function setConfigInstance (config: Config): void {
  configInstance = config
}
