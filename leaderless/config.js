'use strict'

const fsp = require('fs').promises

class Config {
  constructor () {
    this.config = {}
  }

  async loadConfigFile (configFileName) {
    return fsp
      .readFile(configFileName)
      .then(body => {
        this.config = JSON.parse(body)
      })
  }

  // get(key) {
  //   return this.config[key];
  // }

  // set(key, value) {
  //   this.config[key] = value;
  // }

  getEntryNodes () {
    return this.config.entryNodes
  }

  getSyncNodes () {
    return this.config.syncNodes
  }
}

let configInstance = null

function getInstance () {
  if (!configInstance) {
    configInstance = new Config()
  }
  return configInstance
}

function setInstance (config) {
  configInstance = config
}

exports.Config = Config
exports.getInstance = getInstance
exports.setInstance = setInstance
