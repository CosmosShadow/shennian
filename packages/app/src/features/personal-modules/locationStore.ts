// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location-store.test.ts
import { useLocationTracking } from './locationTrackingState'
import * as SQLite from 'expo-sqlite'
import { locationDay, validPoint, type RoutePoint } from './locationModel'
type Binding = { account: string; session: string; start: number; heartbeat: number }
let opening: Promise<SQLite.SQLiteDatabase> | undefined
async function database() {
  if (!opening)
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync('recording-location.sqlite')
      await db.execAsync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS route_points(account TEXT NOT NULL, session TEXT NOT NULL, timestamp REAL NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account,session,timestamp));
      CREATE INDEX IF NOT EXISTS route_day ON route_points(account,day,timestamp);
      CREATE TABLE IF NOT EXISTS route_binding(id INTEGER PRIMARY KEY CHECK(id=1), account TEXT NOT NULL, session TEXT NOT NULL, start REAL NOT NULL, heartbeat REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS route_preferences(account TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS route_deleted(account TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(account,day));`)
      return db
    })().catch((e) => {
      opening = undefined
      throw e
    })
  return opening
}
export const locationStore = {
  async enabled(account: string) {
    return !!(
      await (
        await database()
      ).getFirstAsync<{ enabled: number }>(
        'SELECT enabled FROM route_preferences WHERE account=?',
        account,
      )
    )?.enabled
  },
  async preference(account: string, enabled: boolean) {
    await (
      await database()
    ).runAsync('INSERT OR REPLACE INTO route_preferences VALUES(?,?)', account, enabled ? 1 : 0)
  },
  async bind(account: string, session: string) {
    const now = Date.now()
    await (
      await database()
    ).runAsync('INSERT OR REPLACE INTO route_binding VALUES(1,?,?,?,?)', account, session, now, now)
  },
  async clear() {
    await (await database()).runAsync('DELETE FROM route_binding')
  },
  async heartbeat(account: string, session: string) {
    await (
      await database()
    ).runAsync(
      'UPDATE route_binding SET heartbeat=? WHERE account=? AND session=?',
      Date.now(),
      account,
      session,
    )
  },
  async append(samples: Omit<RoutePoint, 'session' | 'day'>[]) {
    const db = await database()
    let expired = false
    await db.withExclusiveTransactionAsync(async (tx) => {
      const binding = await tx.getFirstAsync<Binding>('SELECT * FROM route_binding WHERE id=1')
      if (!binding) {
        expired = true
        return
      }
      if (Date.now() - binding.heartbeat > 120000) {
        await tx.runAsync('DELETE FROM route_binding')
        expired = true
        return
      }
      for (const sample of samples) {
        const p: RoutePoint = {
          ...sample,
          session: binding.session,
          day: locationDay(sample.timestamp),
        }
        if (p.timestamp < binding.start || !validPoint(p)) continue
        if (
          await tx.getFirstAsync(
            'SELECT day FROM route_deleted WHERE account=? AND day=?',
            binding.account,
            p.day,
          )
        )
          continue
        await tx.runAsync(
          'INSERT OR IGNORE INTO route_points VALUES(?,?,?,?,?)',
          binding.account,
          p.session,
          p.timestamp,
          p.day,
          JSON.stringify(p),
        )
      }
    })
    return expired
  },
  async days(account: string) {
    return (
      await (
        await database()
      ).getAllAsync<{ day: string }>(
        'SELECT DISTINCT day FROM route_points WHERE account=? ORDER BY day DESC LIMIT 100',
        account,
      )
    ).map((r) => r.day)
  },
  async points(account: string, day: string): Promise<RoutePoint[]> {
    return (
      await (
        await database()
      ).getAllAsync<{ payload: string }>(
        'SELECT payload FROM route_points WHERE account=? AND day=? ORDER BY timestamp',
        account,
        day,
      )
    ).map((r) => JSON.parse(r.payload) as RoutePoint)
  },
  async deleteDay(account: string, day: string) {
    await (
      await database()
    ).withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT OR IGNORE INTO route_deleted VALUES(?,?)', account, day)
      await tx.runAsync('DELETE FROM route_points WHERE account=? AND day=?', account, day)
    })
    useLocationTracking.setState((s) => ({ revision: s.revision + 1 }))
  },
}
