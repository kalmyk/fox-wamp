module.exports = {
  REALM_CREATED   : 'realm.created',
  SESSION_JOIN    : 'session.join',   // (session)
  SESSION_LEAVE   : 'session.leave',  // (session)
  SESSION_RX      : 'session.Rx',
  SESSION_TX      : 'session.Tx',
  SESSION_WARNING : 'session.warning',
  ON_SUBSCRIBED   : 'on.topic.subscribed',
  ON_UNSUBSCRIBED : 'on.topic.unsubscribed',
  ON_REGISTERED   : 'on.rpc.registered',
  ON_UNREGISTERED : 'on.rpc.unregistered',

  //  TRANSANT(WATCH  if the key changes)
  //      each command could have related transact ID
  //  REDUCE
  //  LOCK key

  REQUEST_TASK  : 'TASK',
  REQUEST_EVENT : 'EVENT',

  RESULT_ACK    : 'ACK',   // send subscribed (started)
  RESULT_OK     : 'OK',    // done subscription or command
  RESULT_ERR    : 'ERR',   // final status
  RESULT_EMIT   : 'EMIT'
}
