export type ComplexId = {
    dt: string
    id: number
}

export function keyComplexId(id: ComplexId): string {
  return id.dt + keyId(id.id)
}

export function keyDate(date: Date): string {
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const hour = date.getUTCHours()
  const minutes = date.getUTCMinutes()

  return date.getUTCFullYear().toString().substr(-2) +
    (month < 10 ? '0' + month : month) +
    (day < 10 ? '0' + day : day) +
    (hour < 10 ? '0' + hour : hour) +
    (minutes < 10 ? '0' + minutes : minutes)
}

export function keyId(id: number): string {
  const idStr = id.toString(36)
  return String.fromCharCode(idStr.length + 96) + idStr
}

export function mergeMax(a: ComplexId, b: ComplexId): ComplexId {
  if (a.dt > b.dt) {
    return a
  } else if (a.dt < b.dt) {
    return b
  } else {
    return { dt: a.dt, id: Math.max(a.id, b.id) }
  }
}

export function mergeMin(a: ComplexId, b: ComplexId): ComplexId {
  if (a.dt > b.dt) {
    return b
  } else if (a.dt < b.dt) {
    return a
  } else {
    return { dt: a.dt, id: Math.min(a.id, b.id) }
  }
}

export function makeEmpty(date: Date): ComplexId {
  return {
    dt: keyDate(date),
    id: 0,
  }
}

export class ProduceId {
  private prefix: string;
  private generator: number;
  private formatPrefix: (date: Date) => string;

  constructor(formatPrefix: (date: Date) => string) {
    this.prefix = ''
    this.generator = 0
    this.formatPrefix = formatPrefix
  }

  // @return true if position has been changed
  public reconcilePos(newPrefix: string, newPosition?: number): boolean {
    if (newPrefix > this.prefix) {
      this.prefix = newPrefix
      this.generator = newPosition !== undefined ? newPosition : 0
      return true
    }
    if (newPrefix === this.prefix) {
      this.generator = newPosition !== undefined ? Math.max(this.generator, newPosition) : this.generator
      return true
    }
    return false
  }

  public actualizePrefix(): boolean {
    return this.reconcilePos(this.formatPrefix(new Date()))
  }

  public generateIdRec(step?: number): ComplexId {
    this.generator += step !== undefined ? step : 1
    return {
      dt: this.prefix,
      id: this.generator,
    };
  }

  public generateIdStr(step?: number): string {
    const newId = this.generateIdRec(step);
    return newId.dt + keyId(newId.id);
  }

  public reconcileStrId(encodedId: string): void {
    const newDateStr = encodedId.substr(0, 10)
    const intLen = encodedId.charCodeAt(10) - 96
    const newId = parseInt(encodedId.substr(11, intLen), 36)
    this.reconcilePos(newDateStr, newId)
  }
}
