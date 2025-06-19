exports.REALM_CREATED   = 'realm.created'
exports.SESSION_JOIN    = 'session.join'   // (session)
exports.SESSION_LEAVE   = 'session.leave'  // (session)
exports.SESSION_RX      = 'session.Rx'
exports.SESSION_TX      = 'session.Tx'
exports.SESSION_WARNING = 'session.warning'
exports.ON_SUBSCRIBED   = 'on.topic.subscribed'
exports.ON_UNSUBSCRIBED = 'on.topic.unsubscribed'
exports.ON_REGISTERED   = 'on.rpc.registered'
exports.ON_UNREGISTERED = 'on.rpc.unregistered'

exports.REQUEST_TASK  = 'TASK'
exports.REQUEST_EVENT = 'EVENT'

exports.RESULT_ACK    = 'ACK'   // send subscribed (started)
exports.RESULT_OK     = 'OK'    // done subscription or command
exports.RESULT_ERR    = 'ERR'   // final status
exports.RESULT_EMIT   = 'EMIT'
