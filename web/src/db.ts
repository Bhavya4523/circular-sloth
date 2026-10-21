import Dexie, { type Table } from "dexie";

export type Language = "en" | "hi" | "mr";
export type ItemType = "wear" | "bring" | "pay" | "sign" | "attend" | "holiday" | "deadline" | "info";
export type ItemStatus = "todo" | "done" | "dismissed";

export interface Profile {
  id: "family";
  ui_language: Language;
  reply_language: "english" | "hindi" | "marathi" | "hinglish";
  reminder_time: string;
  last_backup_at: string | null;
  first_run_at: string;
  changes_since_backup: number;
  pin_hash?: string;
  pin_salt?: string;
  storage_persisted?: boolean;
}

export interface Child {
  id: string;
  nickname?: string;
  class_label: string;
  school?: string;
}

export interface Circular {
  id: string;
  received_at: string;
  source: "share" | "paste" | "image" | "pdf" | "chat";
  title: string;
  text: string;
}

export interface Item {
  id: string;
  circular_id: string;
  type: ItemType;
  title: string;
  details: string;
  date: string | null;
  end_date: string | null;
  time: string | null;
  amount: number | null;
  audience: string;
  child_ids: string[];
  status: ItemStatus;
  confidence: number;
  source_text: string;
}

export interface BackupData {
  format: "circular-sloth-backup";
  version: 1;
  exported_at: string;
  profile: Profile | null;
  children: Child[];
  circulars: Circular[];
  items: Item[];
}

class FamilyDatabase extends Dexie {
  profile!: Table<Profile, string>;
  children!: Table<Child, string>;
  circulars!: Table<Circular, string>;
  items!: Table<Item, string>;

  constructor() {
    super("circular-sloth-family");
    this.version(1).stores({
      profile: "id",
      children: "id, class_label",
      circulars: "id, received_at, source",
      items: "id, circular_id, type, date, status, *child_ids",
    });
  }
}

export const db = new FamilyDatabase();

export async function noteLocalChange(amount = 1): Promise<void> {
  const profile = await db.profile.get("family");
  if (profile) await db.profile.update("family", { changes_since_backup: profile.changes_since_backup + amount });
}

export async function getBackupData(): Promise<BackupData> {
  const [profile, children, circulars, items] = await Promise.all([
    db.profile.get("family"), db.children.toArray(), db.circulars.toArray(), db.items.toArray(),
  ]);
  return { format: "circular-sloth-backup", version: 1, exported_at: new Date().toISOString(), profile: profile ?? null, children, circulars, items };
}

export function isBackupData(value: unknown): value is BackupData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<BackupData>;
  return data.format === "circular-sloth-backup" && data.version === 1 &&
    (data.profile === null || (!!data.profile && data.profile.id === "family")) &&
    Array.isArray(data.children) && Array.isArray(data.circulars) && Array.isArray(data.items);
}

export async function restoreBackup(data: BackupData, mode: "replace" | "merge"): Promise<void> {
  await db.transaction("rw", db.profile, db.children, db.circulars, db.items, async () => {
    if (mode === "replace") {
      await Promise.all([db.profile.clear(), db.children.clear(), db.circulars.clear(), db.items.clear()]);
    }
    if (data.profile) await db.profile.put({ ...data.profile, changes_since_backup: 0 });
    await Promise.all([
      db.children.bulkPut(data.children),
      db.circulars.bulkPut(data.circulars),
      db.items.bulkPut(data.items),
    ]);
  });
}
