'use strict'

const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const MSG = require('../lib/messages')
const Router = require('../lib/router')
const {BaseRealm, BaseEngine} = require('../lib/realm')
const {QuorumEdge} = require('../lib/allot/quorum_edge')
const { WampGate } = require('../lib/wamp/gate')
const WampServer = require('../lib/wamp/transport')
const {mergeMin, keyDate, MakeId} = require('../lib/allot/makeid')

const makeId = new MakeId(() => keyDate(new Date()))
const app = new Router()
const sysRealm = new BaseRealm(app, new BaseEngine())
app.addRealm('sys', sysRealm)
const api = sysRealm.api()
/*const server = */new WampServer(new WampGate(app), { port: conf_wamp_port })
console.log('Listening WAMP port:', conf_wamp_port)

makeId.update()
setInterval(()=>{makeId.update()}, 7000)

const makeQuorum = new QuorumEdge(
  (applicantId, value) => {
    const id = makeId.makeIdRec(value)
    console.log('makeQuorum:draftSegmentId', value, applicantId, '=>', id)
    api.publish('draftSegmentId', null, {headers: {applicantId, runId: id}})
  },
  (a,b) =>
    Math.max(a,b)
)

const syncQuorum = new QuorumEdge((advanceSegment, value) => {
  console.log('QSYNC!', advanceSegment, '=>', value)
  api.publish('commitSegment', null, {headers: {advanceSegment, readyId: value}})
}, mergeMin)

sysRealm.on(MSG.SESSION_JOIN, (session) => {
  makeQuorum.addMember(session.getSid())
  syncQuorum.addMember(session.getSid())
})

sysRealm.on(MSG.SESSION_LEAVE, (session) => {
  makeQuorum.delMember(session.getSid())
  syncQuorum.delMember(session.getSid())
})

api.subscribe('makeSegmentId', (data, opt) => {
  console.log('=> receive MAKE-ID', data, opt.headers)
  makeQuorum.vote(opt.sid, opt.headers.advanceSegment, opt.headers.step)
})

api.subscribe('syncId', (data, opt) => {
  console.log('SYNC-ID', data, opt)
  makeId.reconcilePos(opt.headers.maxId.dt, opt.headers.maxId.id)
  syncQuorum.vote(opt.sid, opt.headers.advanceSegment, opt.headers.syncId)
})
