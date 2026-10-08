/* sw.js — Service Worker (ab 20.2.0): nur für Push-Nachrichten.
   Kein Zwischenspeicher: Die App lädt ihre Dateien weiter normal aus dem
   Netz (Versionen über ?v=… in index.html). Muss im Hauptverzeichnis
   liegen, damit er für die ganze App gilt. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", ev => ev.waitUntil(self.clients.claim()));

/* Nachricht vom Morgenlauf: { title, body, url, tag } */
self.addEventListener("push", ev => {
  let d = {};
  try{ d = ev.data ? ev.data.json() : {}; }catch(e){ d = { body: ev.data ? ev.data.text() : "" }; }
  const titel = d.title || "Werkstatt";
  ev.waitUntil(self.registration.showNotification(titel, {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-72.png",
    tag: d.tag || "werkstatt",
    renotify: true,
    data: { url: d.url || "./" }
  }));
});

/* Antippen: offene App nach vorn holen und dorthin springen, sonst öffnen. */
self.addEventListener("notificationclick", ev => {
  ev.notification.close();
  const ziel = new URL((ev.notification.data && ev.notification.data.url) || "./", self.registration.scope).href;
  ev.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for(const f of fenster){
      if(f.url.indexOf(self.registration.scope) !== 0) continue;
      try{ await f.focus(); }catch(e){}
      try{ await f.navigate(ziel); return; }catch(e){}
      f.postMessage({ art: "ziel", url: ziel });
      return;
    }
    await self.clients.openWindow(ziel);
  })());
});
