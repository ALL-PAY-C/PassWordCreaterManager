export interface Account {
  id: string;
  name: string;
  password: string;
  createdAt: number;
}

export interface VaultEntry {
  id: string;
  accountId: string;
  note?: string;
  site: string;
  url?: string;
  password: string;
  length: number;
  counter: number;
  symbols: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  id: "app";
  mode: "system" | "light" | "dark";
  accent: string | null;
  rememberDefault: boolean;
  defaultAccountId: string | null;
  activeAccountId: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  id: "app",
  mode: "system",
  accent: null,
  rememberDefault: true,
  defaultAccountId: null,
  activeAccountId: null,
};

export const DB_NAME = "PassWordCreaterManager";
const DB_VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("accounts")) db.createObjectStore("accounts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t =
          mode === "readwrite"
            ? db.transaction(store, mode, { durability: "strict" })
            : db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listAccounts(): Promise<Account[]> {
  const all = await tx<Account[]>("accounts", "readonly", (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export const putAccount = (a: Account) => tx("accounts", "readwrite", (s) => s.put(a));
export const removeAccount = (id: string) => tx("accounts", "readwrite", (s) => s.delete(id));

export async function listEntries(): Promise<VaultEntry[]> {
  const all = await tx<VaultEntry[]>("entries", "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const putEntry = (e: VaultEntry) => tx("entries", "readwrite", (s) => s.put(e));
export const removeEntry = (id: string) => tx("entries", "readwrite", (s) => s.delete(id));

export async function getSettings(): Promise<Settings> {
  const found = await tx<Settings | undefined>("settings", "readonly", (s) => s.get("app"));
  return { ...DEFAULT_SETTINGS, ...(found ?? {}) };
}

export const putSettings = (s: Settings) => tx("settings", "readwrite", (s2) => s2.put(s));

export const newId = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Drops the whole local database so the app starts clean. */
export function wipeDatabase(): Promise<void> {
  if (dbp) {
    dbp.then((db) => db.close()).catch(() => undefined);
    dbp = null;
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}


/** Creates an account and returns it. The name and password are both inputs to the KDF. */
export async function createAccount(name: string, password: string): Promise<Account> {
  const acc: Account = { id: newId(), name, password, createdAt: Date.now() };
  await putAccount(acc);
  return acc;
}

/** Removes an account together with every entry that belongs to it. */
export async function deleteAccount(id: string): Promise<void> {
  const all = await listEntries();
  await Promise.all(all.filter((e) => e.accountId === id).map((e) => removeEntry(e.id)));
  await removeAccount(id);
}

