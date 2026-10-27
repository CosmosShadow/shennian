// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-session-registry.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { getShennianDir } from '../config/index.js'

type RoomStateName = 'room-session-registry.json' | 'room-host-session-observations.json'

/** Docker tmpfs is suitable for sockets, but Room registrations must outlive container recreation. */
export function resolveRoomStateFile(name: RoomStateName, {
  stateDir = getShennianDir(),
  supervisor = process.env.SHENNIAN_DAEMON_SUPERVISOR,
}: { stateDir?: string; supervisor?: string } = {}): string {
  const runtimeFile = path.join(stateDir, 'runtime', name)
  if (supervisor !== 'docker') return runtimeFile

  const durableDir = path.join(stateDir, 'room-state')
  fs.mkdirSync(durableDir, { recursive: true, mode: 0o700 })
  const dirStat = fs.lstatSync(durableDir)
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('unsafe_room_state_directory')
  if (process.platform !== 'win32') fs.chmodSync(durableDir, 0o700)
  const durableFile = path.join(durableDir, name)
  if (!fs.existsSync(durableFile)) {
    try {
      const source = fs.lstatSync(runtimeFile)
      if (!source.isFile() || source.isSymbolicLink()) throw new Error('unsafe_legacy_room_state')
      fs.copyFileSync(runtimeFile, durableFile, fs.constants.COPYFILE_EXCL)
      if (process.platform !== 'win32') fs.chmodSync(durableFile, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' &&
          (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return durableFile
}
