import * as chai from 'chai'
const { expect } = chai;
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import { RESULT_OK } from '../lib/messages'
import { WampGate, WampSocketWriterContext } from '../lib/wamp/gate'
import { Router }   from '../lib/router'
import { BaseRealm, BaseEngine } from '../lib/realm'
import { Session } from '../lib/session'
import { DbEngine } from '../lib/sqlite/dbengine'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { ProduceId, keyDate } from '../lib/masterfree/makeid'
import * as fs from 'fs'

const dbPath = './test-retained-sync.db'

async function mkDbEngine() {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath)
  }
  const idMill = new ProduceId((date: Date) => keyDate(date))
  const dbFactory = new DbFactory('./')
  await dbFactory.openMainDatabase(dbPath)
  const modKv = new SqliteKvFabric(dbFactory, idMill)
  return new DbEngine(idMill, modKv)
}

const runs = [
  {it: 'mem',  mkEngine: async () => new BaseEngine()},
  {it: 'sqlite', mkEngine: mkDbEngine},
]

describe('70.retained-sync', () => {
  runs.forEach(function (run) {
    describe('engine:' + run.it, function () {
      let
        socketHistory: any[],
        router: Router,
        gate: WampGate,
        socketMock: any,
        realm: BaseRealm,
        ctx: WampSocketWriterContext,
        session: Session
  
      beforeEach(async () => {
        socketHistory = []
        socketMock = {
          wampPkgWrite: (chai as any).spy((msg: any) => socketHistory.push(msg)),
          wampPkgClose: (chai as any).spy(() => {})
        }
        router = new Router()
        const engine = await run.mkEngine()
        realm = new BaseRealm(router, engine)
        await engine.launchEngine('testrealm')
        router.initRealm('testrealm', realm)

        gate = new WampGate(router)
        session = router.createSession()
        ctx = gate.createContext(session, socketMock)
        realm.joinSession(session)
      })
    
      afterEach(() => {
        session.cleanup()
        socketHistory = []
      })

      after(() => {
        if (run.it === 'sqlite' && fs.existsSync(dbPath)) {
          // fs.unlinkSync(dbPath)
        }
      })

      it('should receive retained state immediately if after_event_id is already reached', async () => {
        // 1. Publish something with retain: true
        ctx.setWampType(16) // PUBLISH
        await gate.handle(ctx, session, [16, 1, {acknowledge: true, retain: true}, ['topic1'], 'data1'])
        const pubMsg = socketHistory.find(m => m[0] === 17) // PUBLISHED
        expect(pubMsg, 'PUBLISHED message not found').to.not.be.undefined
        const eventId = pubMsg[2]

        // 2. Subscribe with after_event_id
        socketHistory = []
        ctx.setWampType(32) // SUBSCRIBE
        await gate.handle(ctx, session, [32, 2, {retained: true, after_event_id: eventId}, ['topic1']])
        
        // Should get SUBSCRIBED and EVENT (retained)
        expect(socketHistory.some(m => m[0] === 33), 'SUBSCRIBED message not found').to.be.true
        const eventMsg = socketHistory.find(m => m[0] === 36) // EVENT
        expect(eventMsg, 'EVENT message not found').to.not.be.undefined
        expect(eventMsg[2]).to.equal(eventId)
        expect(eventMsg[3].retained).to.be.true
      })

      it('should delay retained state until after_event_id is reached', async function(this: Mocha.Context) {
        const targetEventId = run.it === 'sqlite' ? '00000000000000010002' : 'r2'
        
        // 1. Subscribe with a future after_event_id
        ctx.setWampType(32) // SUBSCRIBE
        await gate.handle(ctx, session, [32, 2, {retained: true, after_event_id: targetEventId}, ['topic1']])
        
        // Should get SUBSCRIBED immediately, but NO EVENT yet
        expect(socketHistory.some(m => m[0] === 33)).to.be.true
        expect(socketHistory.some(m => m[0] === 36)).to.be.false

        // 2. Publish something else (not reaching target)
        ctx.setWampType(16) // PUBLISH
        await gate.handle(ctx, session, [16, 3, {acknowledge: true, retain: true}, ['topic1'], 'data-pre'])
        
        await new Promise(resolve => setTimeout(resolve, 200))
        expect(socketHistory.some(m => m[0] === 36), 'Should not have event yet').to.be.false

        // 3. Publish that reaches target
        ctx.setWampType(16) // PUBLISH
        await gate.handle(ctx, session, [16, 4, {acknowledge: true, retain: true}, ['topic1'], 'data-target'])
        
        await new Promise(resolve => setTimeout(resolve, 200))
        const eventMsg = socketHistory.find(m => m[0] === 36 && m[4][0] === 'data-target')
        expect(eventMsg, 'Target EVENT message not found').to.not.be.undefined
        expect(eventMsg[2]).to.equal(targetEventId)
      })

      it('should proceed after timeout if after_event_id is never reached', async function (this: Mocha.Context) {
        this.timeout(10000)
        const unreachableId = '99999999999999999999'
        
        // 1. Publish initial state
        ctx.setWampType(16) // PUBLISH
        await gate.handle(ctx, session, [16, 1, {acknowledge: true, retain: true}, ['topic1'], 'initial'])
        
        await new Promise(resolve => setTimeout(resolve, 200))
        socketHistory = []
        // 2. Subscribe with unreachable after_event_id
        ctx.setWampType(32) // SUBSCRIBE
        await gate.handle(ctx, session, [32, 2, {retained: true, after_event_id: unreachableId}, ['topic1']])
        
        expect(socketHistory.some(m => m[0] === 33)).to.be.true
        expect(socketHistory.some(m => m[0] === 36)).to.be.false

        await new Promise(resolve => setTimeout(resolve, 6000))
        // After 5s timeout, it should have fetched whatever is currently in retained
        const eventMsg = socketHistory.find(m => m[0] === 36)
        expect(eventMsg, 'EVENT message after timeout not found').to.not.be.undefined
        expect(eventMsg[4][0]).to.equal('initial')
      })

      it('should cleanup waiter on unsubscribe', async function(this: Mocha.Context) {
        const targetEventId = 'future-id'
        
        // 1. Subscribe
        ctx.setWampType(32) // SUBSCRIBE
        await gate.handle(ctx, session, [32, 2, {retained: true, after_event_id: targetEventId}, ['topic1']])
        const subMsg = socketHistory.find(m => m[0] === 33)
        const subscriptionId = subMsg[1]

        // 2. Unsubscribe before event arrives
        ctx.setWampType(34) // UNSUBSCRIBE
        await gate.handle(ctx, session, [34, 3, subscriptionId])
        
        // 3. Publish the target event
        ctx.setWampType(16) // PUBLISH
        await gate.handle(ctx, session, [16, 4, {acknowledge: true, retain: true}, ['topic1'], 'late-data'])

        await new Promise(resolve => setTimeout(resolve, 200))
        // Should NOT receive the event
        expect(socketHistory.some(m => m[0] === 36)).to.be.false
      })

      it('should reject non-string after_event_id', async function(this: Mocha.Context) {
        ctx.setWampType(32) // SUBSCRIBE
        await gate.handle(ctx, session, [32, 2, {retained: true, after_event_id: 123}, ['topic1']])
        
        const errorMsg = socketHistory.find(m => m[0] === 8 && m[1] === 32)
        expect(errorMsg).to.not.be.undefined
        expect(errorMsg[4]).to.equal('wamp.error.invalid_argument')
      })
    })
  })
})
