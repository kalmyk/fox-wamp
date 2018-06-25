var dnode = require('./dnode');
var net = require('net');
var util = require('util');

exports = module.exports = function (cons, opts) {
    return new D(cons, opts);
};

exports.listen = function () {
    var d = new D();
    return d.listen.apply(d, arguments);
};

util.inherits(D, dnode);
function D (cons, opts) {
    var self = this;
    if (!opts) opts = {};

    return dnode.call(self, cons, opts);
}

dnode.prototype.listen = function (port, host) {
    var self = this;
    
    // just copy over the opts and cons, the rest will need to be re-created
    var cons = self.cons, opts = self.opts;
    self.cons = function () {};
    self.end();
    
    var server = net.createServer(function (stream) {
        var d = new dnode(cons, opts);
        do { d.id = randomId() }
        while (server.sessions[d.id]);
        
        server.sessions[d.id] = d;
        d.on('end', function () {
            delete server.sessions[d.id];
        });
        
        d.on('local', function (ref) {
            server.emit('local', ref, d);
        });
        
        d.on('remote', function (remote) {
            server.emit('remote', remote, d);
        });
        
        stream.on('error', function (err) {
            if (err && err.code === 'EPIPE') return; // eat EPIPEs
            d.emit('error', err);
        });
        
        d.stream = stream;
        stream.pipe(d);
        d.pipe(stream);
    });
    
    server.sessions = {};
    server.listen(port, host);

    return server;
};

function randomId () {
    var s = '';
    for (var i = 0; i < 4; i++) {
        s += Math.random().toString(16).slice(2);
    }
    return s;
}
