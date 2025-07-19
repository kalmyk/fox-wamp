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
