'use strict'

const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const MSG = require('../lib/messages')
const Router = require('../lib/router')
const {BaseRealm, BaseEngine} = require('../lib/realm')
const {QuorumEdge} = require('../lib/allot/quorum_edge')
const WampGate = require('../lib/wamp/gate')
const WampServer = require('../lib/wamp/transport')
const {mergeMin, keyDate, MakeId} = require('../lib/allot/makeid')

const makeId = new MakeId(() => keyDate(new Date()))
const app = new Router()
const realm = new BaseRealm(app, new BaseEngine())
app.addRealm('ctrl', realm)
const api = realm.foxApi()
/*const server = */new WampServer(new WampGate(app), { port: conf_wamp_port })
console.log('Listening WAMP port:', conf_wamp_port)

makeId.update()
setInterval(()=>{makeId.update()}, 7000)

const makeQuorum = new QuorumEdge((applicantId, value) => {
  const id = makeId.makeIdRec(value)
  console.log('draftSegmentId:', value, applicantId, '=>', id)
  api.publish(['draftSegmentId'], {kv: {applicantId, runId: id}})
}, (a,b) => Math.max(a,b))

const syncQuorum = new QuorumEdge((advanceSegment, value) => {
  console.log('QSYNC!', advanceSegment, '=>', value)
  api.publish(['commitSegment'], {kv: {advanceSegment, readyId: value}})
}, mergeMin)

realm.on(MSG.SESSION_JOIN, (session) => {
  makeQuorum.addMember(session.getSid())
  syncQuorum.addMember(session.getSid())
})

realm.on(MSG.SESSION_LEAVE, (session) => {
  makeQuorum.delMember(session.getSid())
  syncQuorum.delMember(session.getSid())
})

api.subscribe(['makeSegmentId'], (data, opt) => {
  console.log('MAKE-ID', opt.sid, data.kwargs)
  makeQuorum.vote(opt.sid, data.kwargs.advanceSegment, data.kwargs.step)
})

api.subscribe(['syncId'], (data, opt) => {
  console.log('SYNC-ID', data, opt)
  makeId.reconcilePos(data.kwargs.maxId.dt, data.kwargs.maxId.id)
  syncQuorum.vote(opt.sid, data.kwargs.advanceSegment, data.kwargs.syncId)
})
