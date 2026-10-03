// Notifications with the app closed: shows what the server pushes, and a tap
// opens the game (in the app's window if it's open).
self.addEventListener('push', (event) => {
  const n = event.data ? event.data.json() : { title: 'Duel Table', body: '', url: '/' }
  event.waitUntil(self.registration.showNotification(n.title, { body: n.body, tag: n.tag, renotify: !!n.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: n.url } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      return open ? open.navigate(url).then((w) => (w ?? open).focus()) : self.clients.openWindow(url)
    }),
  )
})
