import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { db, getBackupData, isBackupData, noteLocalChange, restoreBackup, type Child, type Language, type Profile } from "./db";
import { backupFilename, decryptBackup, encryptBackup, hashPin } from "./security";
import { t } from "./i18n";

interface Props { profile: Profile; onProfileChange: (profile: Profile) => void; }

export function Settings({ profile, onProfileChange }: Props) {
  const [children, setChildren] = useState<Child[]>([]);
  const [storage, setStorage] = useState<boolean | undefined>(profile.storage_persisted);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseAgain, setPassphraseAgain] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreData, setRestoreData] = useState<Awaited<ReturnType<typeof decryptBackup>> | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const language = profile.ui_language;

  useEffect(() => {
    void db.children.toArray().then(setChildren);
    if (storage === undefined) void navigator.storage?.persisted?.().then(setStorage).catch(() => setStorage(false));
  }, []);

  const updateProfile = async (next: Profile) => {
    await db.profile.put(next);
    await noteLocalChange();
    onProfileChange(next);
  };

  const requestPersistentStorage = async () => {
    try {
      const granted = await navigator.storage?.persist?.() ?? false;
      setStorage(granted);
      await updateProfile({ ...profile, storage_persisted: granted });
    } catch { setStorage(false); }
  };

  const saveChild = async (child: Child) => {
    if (!child.class_label.trim()) { setError(t(language, "classRequired")); return; }
    const clean = { ...child, class_label: child.class_label.trim(), nickname: child.nickname?.trim() || undefined, school: child.school?.trim() || undefined };
    await db.children.put(clean);
    await noteLocalChange();
    setChildren(await db.children.toArray());
    setNotice(t(language, "save")); setError("");
  };

  const addChild = async () => {
    const child: Child = { id: crypto.randomUUID(), class_label: "" };
    await db.children.add(child);
    setChildren(await db.children.toArray());
  };

  const removeChild = async (id: string) => {
    await db.children.delete(id);
    await noteLocalChange();
    setChildren(await db.children.toArray());
  };

  const makeBackup = async () => {
    setError(""); setNotice("");
    if (passphrase.length < 8 || passphrase !== passphraseAgain) { setError(t(language, "passphraseMismatch")); return; }
    try {
      const data = await getBackupData();
      const now = new Date().toISOString();
      if (data.profile) { data.profile.last_backup_at = now; data.profile.changes_since_backup = 0; }
      const blob = await encryptBackup(data, passphrase);
      const backupFile = new File([blob], backupFilename(), { type: blob.type });
      if (navigator.share && navigator.canShare?.({ files: [backupFile] })) await navigator.share({ files: [backupFile], title: "Circular Sloth backup" });
      else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = backupFilename(); anchor.click(); URL.revokeObjectURL(url);
      }
      const next = { ...profile, last_backup_at: now, changes_since_backup: 0 };
      await db.profile.put(next); onProfileChange(next);
      setNotice(t(language, "backupReady")); setPassphrase(""); setPassphraseAgain("");
    } catch { setError(t(language, "backupWrong")); }
  };

  const readBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setNotice("");
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("large");
      const data = await decryptBackup(file, restorePassphrase);
      if (!isBackupData(data)) throw new Error("invalid");
      setRestoreData(data);
    } catch { setError(t(language, "backupWrong")); setRestoreData(null); }
  };

  const restore = async (mode: "replace" | "merge") => {
    if (!restoreData) return;
    await restoreBackup(restoreData, mode);
    setRestoreData(null); setRestorePassphrase("");
    const next = await db.profile.get("family");
    if (next) onProfileChange(next);
    setChildren(await db.children.toArray());
    setNotice(t(language, "backupRestored"));
  };

  const savePin = async () => {
    setError("");
    if (!/^\d{4}$/.test(pin)) { setError(t(language, "pinInvalid")); return; }
    if (pin !== pinAgain) { setError(t(language, "pinMismatch")); return; }
    const result = await hashPin(pin);
    await updateProfile({ ...profile, pin_hash: result.hash, pin_salt: result.salt });
    setPin(""); setPinAgain(""); setNotice(t(language, "save"));
  };

  const removePin = async () => {
    const next = { ...profile };
    delete next.pin_hash; delete next.pin_salt;
    await updateProfile(next); setNotice(t(language, "save"));
  };

  const deleteAll = async () => {
    if (deleteText !== t(language, "deleteWord")) return;
    const shareDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("circular-sloth-share", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }).catch(() => null);
    if (shareDb) { shareDb.close(); indexedDB.deleteDatabase("circular-sloth-share"); }
    await db.delete(); window.location.assign("/");
  };

  const updateChildField = (id: string, field: keyof Child, value: string) => {
    setChildren((list) => list.map((child) => child.id === id ? { ...child, [field]: value } : child));
  };

  return <section className="page settings-page" aria-labelledby="settings-title">
    <header className="page-heading"><p className="eyebrow">{t(language, "appTitle")}</p><h1 id="settings-title">{t(language, "settingsTitle")}</h1></header>

    <section className="settings-section"><h2>{t(language, "children")}</h2>
      {children.map((child) => <div className="settings-child" key={child.id}>
        <label className="field-label" htmlFor={`child-class-${child.id}`}>{t(language, "classLabel")}</label>
        <input id={`child-class-${child.id}`} value={child.class_label} onChange={(event) => updateChildField(child.id, "class_label", event.target.value)} />
        <label className="field-label" htmlFor={`child-name-${child.id}`}>{t(language, "nickname")}</label>
        <input id={`child-name-${child.id}`} value={child.nickname ?? ""} onChange={(event) => updateChildField(child.id, "nickname", event.target.value)} />
        <label className="field-label" htmlFor={`child-school-${child.id}`}>{t(language, "school")}</label>
        <input id={`child-school-${child.id}`} value={child.school ?? ""} onChange={(event) => updateChildField(child.id, "school", event.target.value)} />
        <div className="button-row"><button className="button button--secondary" onClick={() => void saveChild(child)}>{t(language, "save")}</button><button className="button button--plain" onClick={() => void removeChild(child.id)}>{t(language, "removeChild")}</button></div>
      </div>)}
      <button className="button button--plain" onClick={() => void addChild()}>{t(language, "addChild")}</button>
    </section>

    <section className="settings-section settings-grid">
      <label className="field-label" htmlFor="ui-language">{t(language, "language")}</label>
      <select id="ui-language" value={profile.ui_language} onChange={(event) => void updateProfile({ ...profile, ui_language: event.target.value as Language })}>
        <option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option>
      </select>
      <label className="field-label" htmlFor="reply-language">{t(language, "replyLanguage")}</label>
      <select id="reply-language" value={profile.reply_language} onChange={(event) => void updateProfile({ ...profile, reply_language: event.target.value as Profile["reply_language"] })}>
        <option value="english">{t(language, "responseEnglish")}</option><option value="hindi">{t(language, "responseHindi")}</option><option value="marathi">{t(language, "responseMarathi")}</option><option value="hinglish">{t(language, "responseHinglish")}</option>
      </select>
      <label className="field-label" htmlFor="reminder-time">{t(language, "reminderTime")}</label>
      <input id="reminder-time" type="time" value={profile.reminder_time} onChange={(event) => void updateProfile({ ...profile, reminder_time: event.target.value })} />
    </section>

    <section className="settings-section"><h2>{t(language, "appLock")}</h2><p className="hint">{t(language, "pinHelp")}</p>
      {profile.pin_hash ? <><label className="field-label" htmlFor="new-pin">{t(language, "changePin")}</label><input id="new-pin" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /><label className="field-label" htmlFor="new-pin-again">{t(language, "pinConfirm")}</label><input id="new-pin-again" type="password" inputMode="numeric" maxLength={4} value={pinAgain} onChange={(event) => setPinAgain(event.target.value.replace(/\D/g, ""))} /><div className="button-row"><button className="button button--secondary" onClick={() => void savePin()}>{t(language, "save")}</button><button className="button button--plain" onClick={() => void removePin()}>{t(language, "removePin")}</button></div></> : <><label className="field-label" htmlFor="new-pin">{t(language, "pinLabel")}</label><input id="new-pin" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /><label className="field-label" htmlFor="new-pin-again">{t(language, "pinConfirm")}</label><input id="new-pin-again" type="password" inputMode="numeric" maxLength={4} value={pinAgain} onChange={(event) => setPinAgain(event.target.value.replace(/\D/g, ""))} /><button className="button button--secondary" onClick={() => void savePin()}>{t(language, "save")}</button></>}
    </section>

    <section className="settings-section"><h2>{t(language, "storageStatus")}</h2><p role="status">{storage ? t(language, "storageYes") : t(language, "storageNo")}</p><button className="button button--secondary" onClick={() => void requestPersistentStorage()}>{storage ? t(language, "requestAgain") : t(language, "requestPersist")}</button></section>

    <section className="settings-section"><h2>{t(language, "backupRestore")}</h2><p>{t(language, "backupHelp")}</p><p>{profile.last_backup_at ? t(language, "lastBackup", { days: Math.max(0, Math.floor((Date.now() - new Date(profile.last_backup_at).getTime()) / 86_400_000)) }) : t(language, "noBackup")}</p>
      <label className="field-label" htmlFor="backup-passphrase">{t(language, "passphrase")}</label><input id="backup-passphrase" autoComplete="new-password" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
      <label className="field-label" htmlFor="backup-passphrase-again">{t(language, "passphraseAgain")}</label><input id="backup-passphrase-again" autoComplete="new-password" type="password" value={passphraseAgain} onChange={(event) => setPassphraseAgain(event.target.value)} />
      <button className="button button--primary" onClick={() => void makeBackup()}>{t(language, "makeBackup")}</button>
      <label className="field-label" htmlFor="restore-passphrase">{t(language, "passphrase")}</label><input id="restore-passphrase" autoComplete="current-password" type="password" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} />
      <label className="field-label" htmlFor="restore-file">{t(language, "restoreFile")}</label><input id="restore-file" type="file" accept=".csb,application/vnd.circular-sloth.backup+json" onChange={(event) => void readBackup(event)} />
      {restoreData && <div className="button-row"><button className="button button--destructive" onClick={() => void restore("replace")}>{t(language, "restoreReplace")}</button><button className="button button--secondary" onClick={() => void restore("merge")}>{t(language, "restoreMerge")}</button></div>}
    </section>

    <section className="settings-section privacy-card"><h2>{t(language, "privacyCard")}</h2><p>{t(language, "privacyCopy")}</p></section>

    <section className="settings-section danger-zone"><h2>{t(language, "deleteAll")}</h2><p>{t(language, "deleteHelp")}</p><label className="field-label" htmlFor="delete-all">{t(language, "typeDelete")}</label><input id="delete-all" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} /><button className="button button--destructive" disabled={deleteText !== t(language, "deleteWord")} onClick={() => void deleteAll()}>{t(language, "deleteConfirm")}</button></section>

    {(error || notice) && <p className={error ? "form-error" : "form-success"} role={error ? "alert" : "status"}>{error || notice}</p>}
  </section>;
}
