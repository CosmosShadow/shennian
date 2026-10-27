// @arch docs/architecture/app/modular-features.md
// @test packages/app/src/__tests__/native-runtime-polyfills.test.ts

type FlatMapper<T, U> = (value: T, index: number, array: T[]) => U | U[]

function flattenInto<T>(target: T[], source: unknown[], depth: number): void {
  for (const item of source) {
    if (depth > 0 && Array.isArray(item)) {
      flattenInto(target, item, depth - 1)
    } else {
      target.push(item as T)
    }
  }
}

if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, 'flat', {
    configurable: true,
    writable: true,
    value: function flat<T>(this: T[], depth = 1): T[] {
      const result: T[] = []
      const normalizedDepth = depth === Infinity ? Number.MAX_SAFE_INTEGER : Math.max(0, Number(depth) || 0)
      flattenInto(result, this, normalizedDepth)
      return result
    },
  })
}

if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value: function flatMap<T, U>(this: T[], mapper: FlatMapper<T, U>, thisArg?: unknown): U[] {
      if (typeof mapper !== 'function') throw new TypeError('flatMap mapper must be a function')
      const mapped: Array<U | U[]> = []
      for (let index = 0; index < this.length; index += 1) {
        mapped.push(mapper.call(thisArg, this[index]!, index, this))
      }
      const result: U[] = []
      flattenInto(result, mapped, 1)
      return result
    },
  })
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value: function at<T>(this: T[], index: number): T | undefined {
      const length = this.length
      const integer = Math.trunc(Number(index) || 0)
      const offset = integer < 0 ? length + integer : integer
      return offset >= 0 && offset < length ? this[offset] : undefined
    },
  })
}

if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, 'replaceAll', {
    configurable: true,
    writable: true,
    value: function replaceAll(this: string, search: string | RegExp, replacement: string): string {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll RegExp must be global')
        return this.replace(search, replacement)
      }
      return this.split(String(search)).join(replacement)
    },
  })
}

if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    configurable: true,
    writable: true,
    value: function hasOwn(object: object, key: PropertyKey): boolean {
      return Object.prototype.hasOwnProperty.call(object, key)
    },
  })
}
