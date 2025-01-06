'use strict'

// const fsp = require('fs').promises

class Config {
  constructor () {
    this.config = {}
  }

  // async loadConfigFile (configFileName) {
  //   return fsp
  //     .readFile(configFileName)
  //     .then(body => JSON.parse(body))
  // }

  // load(options = {}) {
  //   // Load configuration from various sources (e.g., files, environment variables)
  //   // ...
  // }

  // get(key) {
  //   return this.config[key];
  // }

  // set(key, value) {
  //   this.config[key] = value;
  // }

  getEntryNodes () {
    return [
      {nodeId:"E1", url:"ws://127.0.0.1:9031/wamp"},
      {nodeId:"E2", url:"ws://127.0.0.1:9032/wamp"},
      {nodeId:"E3", url:"ws://127.0.0.1:9033/wamp"}
    ]
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
