module.exports = {

  REALM_CREATED : 'realm.created',
  SESSION_JOIN  : 'session.join',
  SESSION_LEAVE : 'session.leave',

  //  TRANSANT(WATCH  if the key changes)
  //      each command could have related transact ID
  //  REDUCE
  //  LOCK key

  REQUEST_TASK  :'TASK',
  REQUEST_EVENT :'EVENT',

  RESULT_ACK  :'ACK',   // send subscribed (started)
  RESULT_OK   :'OK',   // done subscription or command
  RESULT_ERR  :'ERR',   // final status
  RESULT_EMIT :'EMIT',

};
