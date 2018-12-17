/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

class Storage {

    constructor() {
        this.db = {};
    }

    addKey(key, sessionId, data) {
        return new Promise((resolve, reject) => {
            this.db[key] = [sessionId, data];
            resolve();
        });
    }

    getKey(key) {
        return new Promise((resolve, reject) => {
            let value = this.db[key];
            if (value === undefined) {
                reject(undefined);
            }
            else {
                resolve(value);
            }
        });
    }

    removeKey(key) {
        delete this.db[key];
    }

    removeSession(sessionId) {
        let toRemove = [];
        for (let key in this.db) {
            let keySessionId = this.db[key][0];
            if (keySessionId === sessionId)
                toRemove.push(key);
        }

        for (let i = 0; i < toRemove.length; i++) {
            this.removeKey(toRemove[i]);
        }
    }
}

module.exports = Storage;
