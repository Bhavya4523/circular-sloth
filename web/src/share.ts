export interface PendingShare {
  id: "active";
  title: string;
  text: string;
  url: string;
  files: File[];
  received_at: number;
}

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("circular-sloth-share", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pending", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function peekPendingShare(): Promise<PendingShare | null> {
  const database = await openShareDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction("pending").objectStore("pending").get("active");
      request.onsuccess = () => resolve((request.result as PendingShare | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function consumePendingShare(): Promise<PendingShare | null> {
  const database = await openShareDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("pending", "readwrite");
      const store = transaction.objectStore("pending");
      const request = store.get("active");
      let value: PendingShare | null = null;
      request.onsuccess = () => {
        value = (request.result as PendingShare | undefined) ?? null;
        store.delete("active");
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
