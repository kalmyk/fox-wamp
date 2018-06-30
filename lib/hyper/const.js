
module.exports = {

// header TAGs
PKG_CMD        :'^',    // command to be processed

PKG_STACK      :'S',    // scenario stack: +!~ => array(...)
PKG_QUEUE      :'q',    // qname in REG, UNREG, CALL
PKG_RETURN_ACK :'a',    // return ack to client of PUSH/PUBLISH

PKG_UN_REG     :'g',   // registration to unregister {uri,qid}
PKG_UN_TRASE   :'t',   // registration to unregister {uri,qid}

// header PAGE stuff
PKG_SEGMENT    :'E',    // current generated messages id segment
PKG_NEW_SEGMENT:'NS',   // new generator segment label
PKG_FID        :'F',    // server generated id for the PUSH/CALL messages
// header SETTLE stuff
PKG_RESPONSE   :'R',    // SETTLE stuff, response to delivery, lookup to RES_*
PKG_RES_CMD    :'v',    // original command in response package
PKG_OPTIONS    :'o',

// header CMD tag content   I immediate S stack, E with emit
CMD_ECHO   :'ECHO',       // I  echo the message content
//  TRANSANT(WATCH  if the key changes)
//      each command could have related transact ID
//  REDUCE
//  LOCK key

CMD_REG    :'REG',        // SE Register for remote call messages
CMD_UNREG  :'UNREG',      // I  unRegister from remote calls
CMD_TRACE  :'TRACE',      // SE trace the PUSH messages
CMD_UNTRACE:'UNTRACE',    // I  do not trace messages any more
CMD_CALL   :'CALL',       // SE dispatch message to one free worker, and send the worker response to the client
CMD_PUSH   :'PUSH',       // S  client asks send the message to all storages to keep, client receives the maker
CMD_SETTLE :'SETTLE',     // I  worker response about message/task result (CALL/PUSH)
CMD_STREAM :'STREAM',     // I  worker streaming request (CALL/PUSH)

// response qualifier
RES_ACK :'.',   // send subscribed (started)
RES_OK  :'+',   // done subscription or command
RES_ERR :'!',   // final status
RES_EMIT:'~',
RES_TASK:'@',

// body queue error codes
ERROR_UNKNOWN_FUNCTION         :100,
ERROR_NO_QUEUE_FOUND           :101,
ERROR_ALREADY_SUBSCRIBED       :102,
ERROR_SETTLE_NOT_FOUND         :103,
ERROR_MARK_GENERATOR_NOT_FOUND :104,
// :105,
// :106,
ERROR_HEADER_IS_NOT_COMPLETED  :107,
ERROR_ALREADY_QUEUED           :108,
ERROR_REGISTRATION_NOT_FOUND   :109,
ERROR_TRASE_NOT_FOUND          :110
};
