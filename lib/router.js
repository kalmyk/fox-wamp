/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var
    tools = require('./tools'),
    EventEmitter = require('events').EventEmitter;

var trace = function () {};

class Router extends EventEmitter {

    constructor () {
        super();

        this.on('session.Tx', function (session, data) {
            this.trace("["+session.sessionId+"] TX > "+data);
        });
      
        this.on('session.Rx', function (session, msg) {
//console.log(this.sessionId, '>', msg);
            this.trace("["+session.sessionId+"] RX > "+msg);
        });
      
        this.on('session.debug', function (session, msg) {
            this.trace("["+session.sessionId+"] "+msg);
        });
      
        this.on('session.warning', function (session, msg, data) {
            this.trace("["+session.sessionId+"] "+msg+' '+data);
        });
        this.setLogTrace(false);
    }
    
    setLogTrace(trace) {
        if (trace) {
            this.trace = function () {
                console.log.apply(console, arguments);
            };
        }
        else {
            this.trace = function () {};
        }
    }

    makeSessionId() {
        return tools.randomId();
    }
}

module.exports = Router;
