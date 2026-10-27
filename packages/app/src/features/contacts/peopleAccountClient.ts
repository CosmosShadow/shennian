import { authApi } from '../../config/api'
import type { ContactAvatar } from './contactAccountClient'

export type PersonProfile = {
  userId: string
  displayName: string
  description: string
  avatar: ContactAvatar
  savedContactId?: string | null
}

export type PersonProfileResponse = {
  person: PersonProfile
  shareUrl: string
  qrPayload: string
}

export const peopleAccountClient = {
  getMine() { return authApi<PersonProfileResponse>('/people/me') },
  updateMine(description: string) {
    return authApi<PersonProfileResponse>('/people/me', {
      method: 'PATCH', body: JSON.stringify({ description }),
    })
  },
  get(userId: string) {
    return authApi<PersonProfileResponse>(`/people/${encodeURIComponent(userId)}`)
  },
}
