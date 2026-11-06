// Runs only for people who said yes to pings. A push must always show something,
// because browsers take the permission away from sites that push silently.
const read = (data) => {
  try {
    return data?.json().notification ?? {};
  } catch {
    return {};
  }
};

/** Only a path on this site, whatever a payload says. */
const destination = (navigate) => {
  const url = new URL(typeof navigate === 'string' ? navigate : '/', self.location.origin);
  return url.origin === self.location.origin ? url.href : self.location.origin + '/';
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  const message = read(event.data);
  event.waitUntil(self.registration.showNotification(message.title ?? 'Stream2Gather', {
    body: message.body ?? '',
    icon: '/icons/192.png',
    data: { url: destination(message.navigate) },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? destination();
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const here = open.find((client) => client.url.split(/[?#]/)[0] === url);
    return here ? here.focus() : self.clients.openWindow(url);
  })());
});
