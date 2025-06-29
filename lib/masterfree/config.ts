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

  getMajorLimit () {
    return this.config.majorLimit || 2
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
