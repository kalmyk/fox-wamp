/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

function Storage(listener) {
  let data = {};
  this.addKey = function(key, publicationId, sessionId, args, kwArgs) {
    return new Promise((resolve, reject) => {
      data[key] = [publicationId, sessionId, args, kwArgs];
      resolve();
    });
  };

  this.getKey = function(key) {
    return new Promise((resolve, reject) => {
      let value = data[key];
      if (value === undefined) {
        reject(undefined);
      }
      else {
        resolve(value);
      }
    });
  };

  this.removeKey = function(key) {
    delete data[key];
    listener.keyRemoved(key);
  };

  this.removeSession = function(sessionId) {
    let toRemove = [];
    for (let key in data) {
      let keySessionId = data[key][1];
      if (keySessionId === sessionId)
        toRemove.push(key);
    }

    for (let i = 0; i < toRemove.length; i++) {
      this.removeKey(toRemove[i]);
    }
  };
}

module.exports = Storage;
