/*jshint node: true */
'use strict';

// requires sender with
// sender.send(msg, callback)
// sender.close(code, reason)

function Session (gate, sender, sessionId) {

    this.realmName;
    this.secureDetails;
    this.realm = null;
    this.gate = gate;
    this.sender = sender;
    this.sessionId = sessionId;

    let simultaneousTaskLimit = 1;
    let tasksRequested = 0;

    /**
         trace commands
        [id] => actor
    */
    let sTrace = new Map();

    /**
         subscribtion commands
        [id] => actor
    */
    let sSub = new Map();

    this.taskResolved = function() {
        tasksRequested--;
    };

    this.taskRequested = function() {
        tasksRequested++;
    };

    this.isAble = function() {
        return (simultaneousTaskLimit - tasksRequested) > 0;
    };

    this.checkWaitTask = function(engine)
    {
        let found = false;
        if (this.isAble()) {
        for(let [key, subD] of sSub) {
            found = found || engine.checkTasks(subD);
            if (!this.isAble())
                return found;  // exit is worker got enough tasks
            }
        }
        return found;
    };

    this.addTrace = function(id, actor)
    {
        sTrace.set(id, actor);
    };

    this.removeTrace = function(engine, id) {

        let actor = false;
        if (sTrace.has(id)){
            actor = sTrace.get(id);
            sTrace.delete(id);
            engine.removeTrace(actor.uri, actor);
        }
        return actor;
    }

    this.cleanupTrace = function(engine) {
        let tmp = [];
        let deletedCount = 0;
        for (let [key, subD] of sTrace) {
            tmp.push(key);
            deletedCount++;
        }
        for (let i=0; i<tmp.length; i++) {
            this.removeTrace(engine, tmp[i]);
        }
        sTrace.clear();
        return deletedCount;
    }

    this.addSub = function(id, subD)
    {
        sSub.set(id, subD);
    };

    this.removeSub = function(engine, id) {
        let actor = false;
        if (sSub.has(id)){
            actor = sSub.get(id);
            sSub.delete(id);
            engine.removeSub(actor.uri, id);
        }
        return actor;
    }

    this.cleanupReg = function (engine) {

        let tmp = [];
        let deletedCount = 0;
        for(let [key, subD] of sSub) {
            tmp.push(key);
            deletedCount++;
        }
        for (let i=0; i<tmp.length; i++) {
            this.removeSub(engine, tmp[i]);
        }
        return deletedCount;
    }

    this.cleanup = function() {
        if (this.realm) {
            this.realm.cleanupSession(this);
        }
    };
}

module.exports = Session;
