AUTOBAHN_DEBUG = true;
var autobahn = require('autobahn');
var program = require('commander');

program
    .option('-p, --port <port>', 'Server IP port', 9000)
    .option('-i, --ip <ip>', 'Server IP address','127.0.0.1')
    .parse(process.argv);

var connectUrl = 'ws://' + program.ip + ':' + program.port + '/ws';
console.log('connectUrl:', connectUrl);

var connection = new autobahn.Connection({
    url: connectUrl,
    realm: 'realm1',
});

connection.onopen = function (session, details) {

   session.log("Session open.");

   session.call('wamp.registration.get').then(
      function (result) {
         session.log("registration.get =", typeof(result), result);
      },
      function (error) {
         console.log("Call failed:", error);
      });

   session.call('wamp.session.count').then(
      function (result) {
         session.log("count =", typeof(result), result);
      },
      function (error) {
         console.log("Call failed:", error);
      });

    var sessions = null;
    session.call('wamp.session.list').then(
       function (result) {
          sessions = result;
          session.log("list =", typeof(result), result);

          session.call('wamp.session.get', [sessions[0]]).then(
             function (result) {
                session.log("get =", typeof(result), result);
             },
             function (error) {
                console.log("Call failed:", error);
             });
       },
       function (error) {
          console.log("Call failed:", error);
       });
};

connection.onclose = function (reason, details) {
   console.log("close connection:", reason, details);
};

connection.open();
