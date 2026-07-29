import { AccountSettings, DEFAULT_SETTINGS, Trade } from "../types";

const DATABASE_NAME = "true-dtbp";
const STORE_NAME = "workspace";
const STATE_KEY = "primary";

export interface StoredState {
  settings: AccountSettings;
  trades: Trade[];
  updatedAt: string;
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const mergeSettings = (settings?: Partial<AccountSettings>): AccountSettings => ({
  ...DEFAULT_SETTINGS,
  ...settings,
  settlementHolidays: settings?.settlementHolidays ?? [],
});

export const localStore = {
  async load(): Promise<StoredState> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => {
        const state = request.result as StoredState | undefined;
        resolve({
          settings: mergeSettings(state?.settings),
          trades: state?.trades ?? [],
          updatedAt: state?.updatedAt ?? new Date(0).toISOString(),
        });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  },

  async save(settings: AccountSettings, trades: Trade[]) {
    const database = await openDatabase();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(
        { settings, trades, updatedAt: new Date().toISOString() } satisfies StoredState,
        STATE_KEY,
      );
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  },
};
