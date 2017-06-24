//
// This is authenticate router example
//

WAMPRT_TRACE = true;

var WampRouter = require('../lib/fox-wamp');
var program = require('commander');

program
    .option('-p, --port <port>', 'Server IP port', 9000)
    .parse(process.argv);

console.log('Listening port:', program.port);

var Auth = function () {
    this.authenticate = function (realmName, secureDetails, secret, callback) {
        console.log('AUTH:', secureDetails, secret);
        if (secureDetails.authid+'-secret' === secret)
            callback();
        else
            callback('authorization_failed');
    };
};

//
// WebSocket server
//
var app = new WampRouter(
    {port: program.port},
    new Auth()
);
