'use strict'

const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const MSG = require('../lib/messages')
const Router = require('../lib/router')
const {BaseRealm, BaseEngine} = require('../lib/realm')
const {QuorumEdge} = require('../lib/allot/quorum_edge')
const WampGate = require('../lib/wamp/gate')
const WampServer = require('../lib/wamp/transport')
const {mergeMin, MakeId} = require('../lib/allot/makeid')

const makeId = new MakeId()
const app = new Router()
const realm = new BaseRealm(app, new BaseEngine())
app.addRealm('ctrl', realm)
const api = realm.foxApi()
/*const server = */new WampServer(new WampGate(app), { port: conf_wamp_port })
console.log('Listening WAMP port:', conf_wamp_port)

makeId.update(new Date())
setInterval(()=>{makeId.update(new Date())}, 7000)

const mkQuorum = new QuorumEdge((applicantId, value) => {
  const id = makeId.makeId()
  console.log('CREATE-ID!', applicantId, '=>', id)
  api.publish(['runId'], {kv: {applicantId, runId: id}})
}, () => null)

const syncQuorum = new QuorumEdge((applicantId, value) => {
  console.log('QSYNC!', applicantId, '=>', value)
  api.publish(['readyId'], {kv: {applicantId, readyId: value}})
}, mergeMin)

realm.on(MSG.SESSION_JOIN, (session) => {
  mkQuorum.addMember(session.getSid())
  syncQuorum.addMember(session.getSid())
})

realm.on(MSG.SESSION_LEAVE, (session) => {
  mkQuorum.delMember(session.getSid())
  syncQuorum.delMember(session.getSid())
})

api.subscribe(['mkSegmentId'], (data, opt) => {
  console.log('MAKE-ID', data, opt)
  mkQuorum.vote(opt.sid, data.kwargs.applicantId, null)
})

api.subscribe(['syncId'], (data, opt) => {
  console.log('SYNC-ID', data, opt)
  makeId.shift(data.kwargs.maxId)
  syncQuorum.vote(opt.sid, data.kwargs.applicantId, data.kwargs.syncId)
})
