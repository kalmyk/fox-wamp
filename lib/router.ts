import { EventEmitter } from 'events'
import { Session } from './session'
import { BaseRealm, BaseEngine } from './realm'
import { REALM_CREATED, SESSION_TX, SESSION_RX, SESSION_ALERT, SESSION_DEBUG } from './messages'
import * as tools from './tools'

const validate_realm_regex = /^[a-z0-9_]+$/

function validateRealmName(realmName: string): void {
  if (!realmName) {
    throw new Error('Realm name is empty')
  }
  if (typeof realmName !== 'string') {
    throw new Error('Realm name is not a string')
  }
  if (!validate_realm_regex.test(realmName)) {
    throw new Error('Realm name contains invalid characters (a-z, 0-9, _)')
  }
}

export class Router extends EventEmitter {
  _realms: Map<string, BaseRealm>
  _sessions: Map<string, Session>
  _id: string

  constructor() {
    super()
    this._realms = new Map()
    this._sessions = new Map()

    // symbol name, perhaps host
    this._id = ''

    this.on(SESSION_TX, (session: Session, data: any) => {
      this.trace('[' + session.getSid() + '] >', data)
    })

    this.on(SESSION_RX, (session: Session, msg: any) => {
      this.trace('[' + session.getSid() + '] <', msg)
    })

    this.on(SESSION_DEBUG, (session: Session, msg: any) => {
      this.trace('[' + session.getSid() + '] DEBUG', msg)
    })

    this.on(SESSION_ALERT, (session: Session, msg: any, data: any) => {
      this.trace('[' + session.getSid() + ']', msg, data)
    })
    this.setLogTrace(false)
  }

  setId(id: string): void {
    this._id = id
  }

  getId(): string {
    return this._id
  }

  setLogTrace(trace: boolean): void {
    if (trace) {
      this.trace = function (...args: any[]) {
        console.log.apply(console, args);
      };
    } else {
      this.trace = function (...args: any[]) { };
    }
  }

  trace(...args: any[]): void { }

  makeSessionId(): string {
    return tools.randomId().toString()
  }

  createSession(): Session {
    const session = new Session(this.makeSessionId())
    this.registerSession(session)
    return session;
  }

  registerSession(session: Session): void {
    if (!this._sessions.has(session.sessionId)) {
      this._sessions.set(session.sessionId, session)
      this.emit('connection', session)
    } else {
      throw new Error('session id already registered ' + session.sessionId)
    }
  }

  removeSession(session: Session): void {
    session.cleanup()
    if (this._sessions.has(session.sessionId)) {
      this.emit('disconnection', session)
      this._sessions.delete(session.sessionId)
    }
  }

  getSession(sessionId: string): Session | undefined {
    return this._sessions.get(sessionId)
  }

  getRouterInfo(): any {
    let result: any = {}
    if (this._id) {
      result.id = this._id
    }
    return result
  }

  // to be overloaded to create custom engine
  createRealm(realmName: string): BaseRealm {
    return new BaseRealm(this, new BaseEngine())
  }

  async initRealm(realmName: string, realm: BaseRealm): Promise<void> {
    if (this._realms.has(realmName)) {
      throw Error('Realm "' + realmName + '" already set.')
    }
    this._realms.set(realmName, realm)
    await realm.getEngine().launchEngine(realmName)
    this.emit(REALM_CREATED, realm, realmName)
  }

  findRealm(realmName: string): BaseRealm | undefined {
    return this._realms.get(realmName)
  }

  async getRealm(realmName: string, callback?: (realm: BaseRealm) => void | Promise<void>): Promise<BaseRealm> {
    if (this._realms.has(realmName)) {
      const realm = this._realms.get(realmName)!
      if (typeof callback === 'function') {
        await callback(realm)
      }
      return realm
    } else {
      validateRealmName(realmName)
      const realm = this.createRealm(realmName)
      await this.initRealm(realmName, realm)
      if (typeof callback === 'function') {
        await callback(realm)
      }
      return realm
    }
  }
}


