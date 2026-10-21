const CACHE_NAME = "circular-sloth-shell-v1";
const PRECACHE = self.__WB_MANIFEST.map((entry) => typeof entry === "string" ? entry : entry.url);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("circular-sloth-shell-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await expireSharedData();
    await self.clients.claim();
  })());
});

function storeShare(value) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("circular-sloth-share", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("pending", { keyPath: "id" });
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction("pending", "readwrite");
      transaction.objectStore("pending").put(value);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  });
}

function expireSharedData() {
  return new Promise((resolve) => {
    const opening = indexedDB.open("circular-sloth-share", 1);
    opening.onerror = () => resolve();
    opening.onsuccess = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains("pending")) { database.close(); resolve(); return; }
      const transaction = database.transaction("pending", "readwrite");
      const store = transaction.objectStore("pending");
      const request = store.get("active");
      request.onsuccess = () => {
        if (request.result && Date.now() - request.result.received_at > 10 * 60 * 1000) store.delete("active");
      };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); resolve(); };
    };
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const files = form.getAll("files").filter((entry) => entry instanceof File && entry.size <= 12 * 1024 * 1024);
        await storeShare({
          id: "active",
          title: String(form.get("title") || ""),
          text: String(form.get("text") || ""),
          url: String(form.get("url") || ""),
          files,
          received_at: Date.now(),
        });
      } catch {
        // The Add screen gives the parent a calm fallback if the share could not be saved.
      }
      return Response.redirect(new URL("/add?shared=1", self.location.origin), 303);
    })());
    return;
  }
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/ocr/")) {
    event.respondWith((async () => {
      const cache = await caches.open("circular-sloth-ocr-v1");
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (request.mode === "navigate" && response.ok) await cache.put("/", response.clone());
      return response;
    } catch {
      if (request.mode === "navigate") return (await cache.match("/")) || (await cache.match("/index.html")) || Response.error();
      return Response.error();
    }
  })());
});
