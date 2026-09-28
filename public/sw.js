self.addEventListener("push", (event) => {
  if (!event.data) return;

  event.waitUntil((async () => {
    let payload;
    try {
      payload = event.data.json();
    } catch {
      payload = { title: "MRH-POSTBOX", body: event.data.text() };
    }

    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((client) => client.visibilityState === "visible")) {
      for (const client of windows) client.postMessage({ type: "PUSH_MESSAGE", payload });
      return;
    }

    await self.registration.showNotification(payload.title || "MRH-POSTBOX", {
      body: payload.body || "You received a new message.",
      tag: `conversation:${payload.conversationId || "messages"}`,
      data: { url: payload.url || "/chat" },
      renotify: false,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/chat", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appWindow = windows.find((client) => client.url.startsWith(self.location.origin));
    if (appWindow) {
      await appWindow.navigate(target);
      await appWindow.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});