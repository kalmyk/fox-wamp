/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var
    tools = require('./tools'),
    EventEmitter = require('events').EventEmitter;

var trace = function () {};

if ('WAMPRT_TRACE' in global && WAMPRT_TRACE && 'console' in global) {  // jshint ignore:line
    trace = function () {
        console.log.apply(console, arguments);
    };
}

class Router extends EventEmitter {

    constructor () {
        super();

        this.on('session.Tx', function (session, data) {
            trace("["+session.sessionId+"] TX > "+data);
        });
      
        this.on('session.Rx', function (session, data) {
            trace("["+session.sessionId+"] RX > "+data);
        });
      
        this.on('session.debug', function (session, msg) {
            trace("["+session.sessionId+"] "+msg);
        });
      
        this.on('session.warning', function (session, msg, data) {
            trace("["+session.sessionId+"] "+msg+' '+data);
        });
    }

    makeSessionId() {
        return tools.randomId();
    }
}

module.exports = Router;
