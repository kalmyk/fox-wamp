
module.exports = {

// header TAGs
PKG_STACK      :'S',    // scenario stack: +!~ => array(...)

// header PAGE stuff
PKG_SEGMENT    :'E',    // current generated messages id segment

//  TRANSANT(WATCH  if the key changes)
//      each command could have related transact ID
//  REDUCE
//  LOCK key

// response qualifier
RES_ACK  :'.',   // send subscribed (started)
RES_OK   :'+',   // done subscription or command
RES_ERR  :'!',   // final status
RES_EMIT :'~',
RES_TASK :'@',
RES_EVENT:'$',

// body queue error codes
ERROR_HEADER_IS_NOT_COMPLETED  :107,
ERROR_ALREADY_QUEUED           :108,
ERROR_REGISTRATION_NOT_FOUND   :109,
ERROR_TRASE_NOT_FOUND          :110
};
