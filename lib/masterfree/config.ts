import { promises as fsp } from 'fs'
import { TOTAL_SHARDS_COUNT } from './netengine'

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
