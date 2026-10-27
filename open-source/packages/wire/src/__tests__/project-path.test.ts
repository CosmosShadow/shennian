// @covers open-source/packages/wire/src/project-path.ts
import { describe, expect, it } from 'vitest'
import { normalizeProjectMatchPath, projectSessionPathCandidates } from '../project-path'

describe('project path matching', () => {
  it('matches Windows drive and UNC separators without changing case', () => {
    expect(normalizeProjectMatchPath('C:\\Users\\simpl\\')).toBe('C:/Users/simpl')
    expect(normalizeProjectMatchPath('\\\\host\\share\\dir')).toBe('//host/share/dir')
    expect(normalizeProjectMatchPath('C:\\')).toBe('C:')
  })
  it('preserves POSIX literal backslashes and case', () => {
    expect(normalizeProjectMatchPath('/home/a\\b')).toBe('/home/a\\b')
    expect(normalizeProjectMatchPath('/home/A')).not.toBe(normalizeProjectMatchPath('/home/a'))
  })
  it('queries both persisted Windows spellings with one pagination boundary', () => {
    expect(projectSessionPathCandidates('C:\\Users\\simpl')).toEqual([
      'C:/Users/simpl', 'C:/Users/simpl/', 'C:/Users/simpl\\',
      'C:\\Users\\simpl', 'C:\\Users\\simpl/', 'C:\\Users\\simpl\\',
    ])
    expect(projectSessionPathCandidates('/')).toEqual(['/'])
  })
})
