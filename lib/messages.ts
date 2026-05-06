export const REALM_CREATED   = 'realm.created'
export const SESSION_JOIN    = 'session.join'   // (session)
export const SESSION_LEAVE   = 'session.leave'  // (session)
export const SESSION_RX      = 'session.Rx'
export const SESSION_TX      = 'session.Tx'
export const SESSION_ALERT   = 'session.alert'
export const SESSION_DEBUG   = 'session.debug'

export const ON_SUBSCRIBED   = 'on.topic.subscribed'
export const ON_UNSUBSCRIBED = 'on.topic.unsubscribed'
export const ON_REGISTERED   = 'on.rpc.registered'
export const ON_UNREGISTERED = 'on.rpc.unregistered'

export const REQUEST_TASK    = 'TASK'
export const REQUEST_EVENT   = 'EVENT'
export const RESULT_ACK      = 'ACK'   // send subscribed (started)
export const RESULT_OK       = 'OK'    // done subscription or command
export const RESULT_ERR      = 'ERR'   // final status
export const RESULT_EMIT     = 'EMIT'
