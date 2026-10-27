self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: '神念', body: event.data.text(), data: {} }
  }

  const { title = '神念', body = '新消息', data = {} } = payload

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/logo-192.png',
      badge: '/logo-192.png',
      data,
      tag: data.sessionId ?? 'shennian',
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const sessionId = event.notification.data?.sessionId
  const url = sessionId ? `/app/chat/${sessionId}` : '/app'

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus()
            client.postMessage({ type: 'navigate', url })
            return
          }
        }
        return clients.openWindow(url)
      }),
  )
})
