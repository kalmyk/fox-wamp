/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

function Storage(listener) {
  let db = {};
  this.addKey = function(key, sessionId, data) {
    return new Promise((resolve, reject) => {
      db[key] = [sessionId, data];
      resolve();
    });
  };

  this.getKey = function(key) {
    return new Promise((resolve, reject) => {
      let value = db[key];
      if (value === undefined) {
        reject(undefined);
      }
      else {
        resolve(value);
      }
    });
  };

  this.removeKey = function(key) {
    delete db[key];
    listener.keyRemoved(key);
  };

  this.removeSession = function(sessionId) {
    let toRemove = [];
    for (let key in db) {
      let keySessionId = db[key][0];
      if (keySessionId === sessionId)
        toRemove.push(key);
    }

    for (let i = 0; i < toRemove.length; i++) {
      this.removeKey(toRemove[i]);
    }
  };
}

module.exports = Storage;
