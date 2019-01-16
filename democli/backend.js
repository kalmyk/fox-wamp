// AUTOBAHN_DEBUG = true;
var autobahn = require('autobahn');
var program = require('commander');

program
   .option('-s, --server <server>', 'Server URI address','ws://127.0.0.1:9000/wamp')
   .parse(process.argv);

console.log('connect to server:', program.server);

var user = "joe";
var key = "joe-secret";

// this callback is fired during authentication
function onchallenge (session, method, extra) {
   if (method === "ticket") {
      return key;
   } else {
      throw "don't know how to authenticate using '" + method + "'";
   }
}

var connection = new autobahn.Connection({
   url: program.server,
   realm: 'realm1',
   authmethods: ["ticket", "wampcra"],
   authid: user,
   onchallenge: onchallenge
});

connection.onopen = function (session) {

   var reg = null;
   var reg2 = null;

   function utcprogress(args, kwargs, options) {
      console.log("Someone is calling utc function", args, kwargs, options);
      if (options.progress) {
          var now = new Date();
          options.progress([now.toISOString()]);
          setTimeout(function () {
              var now = new Date();
              options.progress([now.toISOString()]);
          }, 100);
          return new Promise((resolve, reject) => {
              setTimeout(function () {
                  var now = new Date();
                  resolve([now.toISOString()]);
              }, 200);
          });
      }
      else {
          var now = new Date();
          return now.toISOString();
      }
   }

   session.register('com.timeservice.now', utcprogress).then(
      function (registration) {
         console.log("Procedure registered:", registration.id);
         reg = registration;
      },
      function (error) {
         console.log("Registration failed:", error);
      }
   );

   function echo(args,kwargs) {
     console.log("args",args,"kwargs",kwargs);
     return new autobahn.Result(args, kwargs);
   }

   session.register('com.echoservice.echo', echo).then(
      function (registration) {
         console.log("Procedure echo registered:", registration.id);
         reg2 = registration;
      },
      function (error) {
         console.log("Registration failed:", error);
      }
   );

    // Define an event handler
   function onEvent(publishArgs, kwargs, opts) {
      console.log('Event', opts.topic, 'received args', publishArgs, 'kwargs ',kwargs);
   }

   // Subscribe to a topic
   session.subscribe('com.myapp.topic1', onEvent).then(
      function(subscription) {
         console.log("subscription successfull", subscription.topic);
      },
      function(error) {
         console.log("subscription failed", error);
      }
   );

   session.subscribe('wamp.session.on_join', onEvent).then(
      function(subscription) {
         console.log("subscription successfull", subscription.topic);
      },
      function(error) {
         console.log("subscription failed", error);
      }
   );

   session.subscribe('wamp.session.on_leave', onEvent).then(
      function(subscription) {
         console.log("subscription successfull", subscription.topic);
      },
      function(error) {
         console.log("subscription failed", error);
      }
   );

  setTimeout(function() {
      console.log("Unregistration");
      session.unregister(reg);
      session.unregister(reg2);
    },
    20000
  );
};

connection.open();
