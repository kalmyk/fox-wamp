import { promises as fsp } from 'fs'

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

  // Returns all schemas a given node participates in, with their shardCount and the node's owned shards.
  findSchemasForNode (nodeId: string): Array<{ schemaName: string; shardCount: number; shards: number[] }> {
    const eventNodes = this.config.eventNodes
    if (!eventNodes) return []
    const result: Array<{ schemaName: string; shardCount: number; shards: number[] }> = []
    for (const schemaName of Object.keys(eventNodes)) {
      const schema = eventNodes[schemaName]
      const node = schema[nodeId]
      if (node && Array.isArray(node.shards)) {
        result.push({ schemaName, shardCount: schema.shardCount, shards: node.shards })
      }
    }
    return result
  }

  validateSchemasForNode (nodeId: string): void {
    const schemas = this.findSchemasForNode(nodeId)
    if (schemas.length === 0) return
    for (const { schemaName, shardCount, shards } of schemas) {
      for (const bucket of shards) {
        if (!Number.isInteger(bucket) || bucket < 0 || bucket >= shardCount) {
          throw Error(`eventNodes.${schemaName}.${nodeId}: shard ${bucket} out of range [0, ${shardCount - 1}]`)
        }
      }
    }
  }

  getEventSchemaNames (): string[] {
    return Object.keys(this.config.eventNodes || {})
  }

  getEventSchema (schemaName: string): { shardCount: number; [nodeId: string]: any } {
    const schema = this.config.eventNodes?.[schemaName]
    if (!schema) {
      throw Error('Event schema "' + schemaName + '" not found in config')
    }
    return schema
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
