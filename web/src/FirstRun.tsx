import { useState } from "react";
import type { Child, Language, Profile } from "./db";
import { hashPin } from "./security";
import { t } from "./i18n";

interface Draft { nickname: string; class_label: string; school: string; }
const emptyChild = (): Draft => ({ nickname: "", class_label: "", school: "" });

export function FirstRun({ onComplete }: { onComplete: (profile: Profile, children: Child[]) => Promise<void> }) {
  const [language, setLanguage] = useState<Language>("en");
  const [step, setStep] = useState(0);
  const [children, setChildren] = useState<Draft[]>([emptyChild()]);
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [storagePersisted, setStoragePersisted] = useState<boolean | undefined>();
  const [error, setError] = useState("");

  const requestPersist = async () => {
    try {
      const persisted = await navigator.storage?.persist?.() ?? false;
      setStoragePersisted(persisted);
    } catch {
      setStoragePersisted(false);
    }
  };

  const finish = async () => {
    setError("");
    if (children.some((child) => !child.class_label.trim())) {
      setError(t(language, "classRequired")); setStep(1); return;
    }
    if (pin || pinAgain) {
      if (!/^\d{4}$/.test(pin)) { setError(t(language, "pinInvalid")); setStep(2); return; }
      if (pin !== pinAgain) { setError(t(language, "pinMismatch")); setStep(2); return; }
    }
    const profile: Profile = {
      id: "family", ui_language: language,
      reply_language: language === "hi" ? "hindi" : language === "mr" ? "marathi" : "english",
      reminder_time: "19:00", last_backup_at: null, first_run_at: new Date().toISOString(),
      changes_since_backup: 0, ...(storagePersisted === undefined ? {} : { storage_persisted: storagePersisted }),
    };
    if (pin) {
      const protectedPin = await hashPin(pin);
      profile.pin_hash = protectedPin.hash;
      profile.pin_salt = protectedPin.salt;
    }
    const savedChildren: Child[] = children.map((child) => ({
      id: crypto.randomUUID(), class_label: child.class_label.trim(),
      ...(child.nickname.trim() ? { nickname: child.nickname.trim() } : {}),
      ...(child.school.trim() ? { school: child.school.trim() } : {}),
    }));
    await onComplete(profile, savedChildren);
  };

  return <main className="onboarding-wrap">
    <section className="onboarding-sheet" aria-labelledby="welcome-title">
      <div className="paper-tape" aria-hidden="true" />
      <p className="eyebrow">{t(language, "appTitle")}</p>
      <h1 id="welcome-title">{step === 0 ? t(language, "firstHeading") : step === 1 ? t(language, "childrenTitle") : step === 2 ? t(language, "protectTitle") : t(language, "installTitle")}</h1>
      {step === 0 && <>
        <p>{t(language, "firstLead")}</p>
        <label className="field-label" htmlFor="first-language">{t(language, "language")}</label>
        <select id="first-language" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
          <option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option>
        </select>
        <button className="button button--primary" onClick={() => setStep(1)}>{t(language, "continue")}</button>
      </>}

      {step === 1 && <>
        <p>{t(language, "childHelp")}</p>
        <div className="child-fields">
          {children.map((child, index) => <fieldset className="child-fieldset" key={index}>
            <legend>{t(language, "children")} {index + 1}</legend>
            <label className="field-label" htmlFor={`nickname-${index}`}>{t(language, "nickname")}</label>
            <input id={`nickname-${index}`} value={child.nickname} onChange={(event) => setChildren((list) => list.map((entry, row) => row === index ? { ...entry, nickname: event.target.value } : entry))} />
            <label className="field-label" htmlFor={`class-${index}`}>{t(language, "classLabel")} *</label>
            <input id={`class-${index}`} required value={child.class_label} onChange={(event) => setChildren((list) => list.map((entry, row) => row === index ? { ...entry, class_label: event.target.value } : entry))} />
            <label className="field-label" htmlFor={`school-${index}`}>{t(language, "school")}</label>
            <input id={`school-${index}`} value={child.school} onChange={(event) => setChildren((list) => list.map((entry, row) => row === index ? { ...entry, school: event.target.value } : entry))} />
            {children.length > 1 && <button type="button" className="button button--plain" onClick={() => setChildren((list) => list.filter((_, row) => row !== index))}>{t(language, "removeChild")}</button>}
          </fieldset>)}
        </div>
        <button type="button" className="button button--plain" onClick={() => setChildren((list) => [...list, emptyChild()])}>{t(language, "addChild")}</button>
        <div className="button-row"><button className="button button--plain" onClick={() => setStep(0)}>{t(language, "cancel")}</button><button className="button button--primary" onClick={() => children.every((child) => child.class_label.trim()) ? setStep(2) : setError(t(language, "classRequired"))}>{t(language, "continue")}</button></div>
      </>}

      {step === 2 && <>
        <p>{t(language, "ownership")}</p>
        <div className="privacy-note"><strong>{t(language, "persistTitle")}</strong><p>{t(language, "persistHelp")}</p><button className="button button--secondary" onClick={() => void requestPersist()}>{t(language, "requestPersist")}</button>
          {storagePersisted !== undefined && <p role="status">{t(language, storagePersisted ? "persistGranted" : "persistDenied")}</p>}
        </div>
        <label className="field-label" htmlFor="pin">{t(language, "pinLabel")}</label>
        <input id="pin" inputMode="numeric" autoComplete="new-password" type="password" maxLength={4} pattern="[0-9]{4}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} />
        {pin && <><label className="field-label" htmlFor="pin-again">{t(language, "pinConfirm")}</label><input id="pin-again" inputMode="numeric" autoComplete="new-password" type="password" maxLength={4} value={pinAgain} onChange={(event) => setPinAgain(event.target.value.replace(/\D/g, ""))} /><p className="hint">{t(language, "pinHelp")}</p></>}
        <div className="button-row"><button className="button button--plain" onClick={() => setStep(1)}>{t(language, "cancel")}</button><button className="button button--primary" onClick={() => setStep(3)}>{t(language, "continue")}</button></div>
      </>}

      {step === 3 && <>
        <p>{t(language, "installHelp")}</p>
        <p className="ownership-copy">{t(language, "ownership")}</p>
        <div className="button-row"><button className="button button--plain" onClick={() => setStep(2)}>{t(language, "cancel")}</button><button className="button button--primary" onClick={() => void finish()}>{t(language, "startUsing")}</button></div>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="step-dots" aria-label={`Step ${step + 1} of 4`}>{[0, 1, 2, 3].map((entry) => <span key={entry} className={entry === step ? "is-current" : ""} />)}</div>
    </section>
  </main>;
}
