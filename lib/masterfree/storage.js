'use strict'

class StorageTask {
  constructor (sysRealm) {
    this.realm = sysRealm
    this.maxId = makeEmpty(new Date())
  }

  getMaxId () {
    return this.maxId
  }
}

exports.StorageTask = StorageTask
