//
// This is authenticate router example
//

WAMPRT_TRACE = true;

var Router = require('../index');
var program = require('commander');

program
    .option('-p, --port <port>', 'Server IP port', 9000)
    .parse(process.argv);

var Auth = function () {
    this.authenticate = function (realmName, secureDetails, secret, callback) {
        console.log('AUTH:', secureDetails, secret);
        if (secureDetails.authid+'-secret' === secret)
            callback();
        else
            callback('authorization_failed');
    };
};

console.log('Listening port:', program.port);

var app = new Router(new Auth());
app.listenWAMP({port: program.port});
