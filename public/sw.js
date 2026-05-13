/* eslint-disable no-restricted-globals — Service Worker global */
self.addEventListener("push", (event) => {
  let data = { titulo: "Arauco-Seam", cuerpo: "", url: "/dashboard" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        titulo: parsed.titulo ?? data.titulo,
        cuerpo: parsed.cuerpo ?? data.cuerpo,
        url: parsed.url ?? data.url,
      };
    }
  } catch {
    /* texto plano */
  }
  event.waitUntil(
    self.registration.showNotification(data.titulo, {
      body: data.cuerpo,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const origin = self.location.origin;
      const full = url.startsWith("http") ? url : `${origin}${url}`;
      for (const client of clientList) {
        if (client.url === full && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(full);
      }
      return undefined;
    }),
  );
});
