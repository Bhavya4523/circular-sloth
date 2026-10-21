import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { db, type Child, type Profile } from "./db";
import { FirstRun } from "./FirstRun";
import { Icon } from "./Icons";
import { ReaderStatus } from "./ReaderStatus";
import { Settings } from "./Settings";
import { t } from "./i18n";
import { pinRetryDelay, verifyPin } from "./security";
import { Intake } from "./Intake";
import { WeekSlip } from "./WeekSlip";
import { Tomorrow } from "./Tomorrow";
export default function App() {
 const [profile,setProfile]=useState<Profile|null|undefined>(); const [children,setChildren]=useState<Child[]>([]); const [locked,setLocked]=useState(false); const [pin,setPin]=useState(""); const [wrong,setWrong]=useState(0); const [waitUntil,setWaitUntil]=useState(0); const [remaining,setRemaining]=useState(0); const [error,setError]=useState("");
 const refresh=useCallback(async()=>{const p=await db.profile.get("family");setProfile(p??null);setChildren(await db.children.toArray());},[]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{if(profile)document.documentElement.lang=profile.ui_language;},[profile?.ui_language]);
 useEffect(()=>{let timer=0;const v=()=>{if(document.visibilityState==="hidden")timer=window.setTimeout(()=>{if(document.visibilityState==="hidden"&&profile?.pin_hash)setLocked(true);},300000);else window.clearTimeout(timer);};document.addEventListener("visibilitychange",v);return()=>{document.removeEventListener("visibilitychange",v);window.clearTimeout(timer);};},[profile]);
 useEffect(()=>{if(!waitUntil)return;const tick=()=>setRemaining(Math.max(0,Math.ceil((waitUntil-Date.now())/1000)));tick();const id=window.setInterval(tick,250);return()=>window.clearInterval(id);},[waitUntil]);
 const finish=async(p:Profile,kids:Child[])=>{await db.transaction("rw",db.profile,db.children,async()=>{await db.profile.put(p);await db.children.bulkPut(kids);});setProfile(p);setChildren(kids);};
 const unlock=async()=>{if(!profile?.pin_hash||!profile.pin_salt||Date.now()<waitUntil)return;if(await verifyPin(pin,profile.pin_hash,profile.pin_salt)){setLocked(false);setPin("");setWrong(0);setError("");}else{const n=wrong+1;setWrong(n);setPin("");const delay=pinRetryDelay(n);if(delay)setWaitUntil(Date.now()+delay);setError(t(profile.ui_language,"pinWrong"));}};
 if(profile===undefined)return <main className="loading-screen">Circular Sloth</main>;
 if(!profile)return <FirstRun onComplete={finish}/>;
 if(locked&&profile.pin_hash)return <main className="lock-screen"><form className="lock-sheet" onSubmit={e=>{e.preventDefault();void unlock();}}><p className="eyebrow">Circular Sloth</p><h1>{t(profile.ui_language,"pinUnlock")}</h1><label htmlFor="unlock-pin" className="field-label">PIN</label><input id="unlock-pin" autoFocus type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))}/><button className="button button--primary" disabled={remaining>0}>{remaining?t(profile.ui_language,"pinWait",{seconds:remaining}):t(profile.ui_language,"unlock")}</button>{error&&<p role="alert" className="form-error">{error}</p>}</form></main>;
 return <BrowserRouter><Shell profile={profile} children={children} onProfileChange={setProfile} refresh={refresh}/></BrowserRouter>;
}
function Shell({profile,children,onProfileChange,refresh}:{profile:Profile;children:Child[];onProfileChange:(p:Profile)=>void;refresh:()=>Promise<void>}) {
 const lang=profile.ui_language;
 return <div className="app-shell"><header className="topbar"><NavLink to="/" className="brand"><img src="/sloth-mark.svg" alt=""/><span>{t(lang,"appTitle")}</span></NavLink><ReaderStatus language={lang}/><NavLink className="mobile-settings" to="/settings"><Icon name="settings"/><span>{t(lang,"settings")}</span></NavLink></header><div className="layout"><nav className="side-nav" aria-label="Main navigation"><Navigation language={lang}/></nav><main className="main-content"><Routes><Route path="/" element={<Tomorrow profile={profile} children={children}/>}/><Route path="/add" element={<Intake profile={profile} children={children} refresh={refresh}/>}/><Route path="/week" element={<WeekSlip profile={profile} children={children}/>}/><Route path="/settings" element={<Settings profile={profile} onProfileChange={onProfileChange}/>}/><Route path="*" element={<Tomorrow profile={profile} children={children}/>}/></Routes></main></div><nav className="bottom-nav" aria-label="Main navigation"><div className="bottom-nav__items"><Navigation language={lang}/></div></nav></div>;
}
function Navigation({language}:{language:Profile["ui_language"]}){return <><NavLink to="/" end className={({isActive})=>"nav-link "+(isActive?"is-active":"")}><Icon name="tomorrow"/><span>{t(language,"tomorrow")}</span></NavLink><NavLink to="/add" className={({isActive})=>"nav-link "+(isActive?"is-active":"")}><Icon name="add"/><span>{t(language,"add")}</span></NavLink><NavLink to="/week" className={({isActive})=>"nav-link "+(isActive?"is-active":"")}><Icon name="week"/><span>{t(language,"week")}</span></NavLink><NavLink to="/settings" className={({isActive})=>"nav-link "+(isActive?"is-active":"")}><Icon name="settings"/><span>{t(language,"settings")}</span></NavLink></>;}

