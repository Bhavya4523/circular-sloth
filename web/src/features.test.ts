import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, restoreBackup, type BackupData, type Item } from "./db";
import { decryptBackup, encryptBackup, hashPin, pinRetryDelay, verifyPin } from "./security";
import { draftReplyFallback, makeCalendar, matchesAudience, parseWhatsAppExport, summaryFallback } from "./features";
import { readFile } from "node:fs/promises";
import { consumePendingShare, peekPendingShare } from "./share";

describe("WhatsApp export parser", () => {
  it("reads both exported header formats, multi-line bodies, media and system lines", () => {
    const messages = parseWhatsAppExport("12/10/26, 9:41 am - Asha: Friday bring a chart\nsecond line\n12/10/2026, 21:41:05 - Ravi: <Media omitted>\nMessages and calls are end-to-end encrypted\n[13/10/2026, 21:41:05] Asha: Rs 200 by Monday");
    expect(messages.map((m) => m.sender)).toEqual(["Asha", "System", "Asha"]);
    expect(messages[0]?.text).toContain("second line");
    expect(messages[2]?.text).toContain("Rs 200");
  });
});
describe("class matching", () => {
  it("matches 5B to Class 5 and 5B but not Class 7", () => {
    expect(matchesAudience("Class 5", ["5B"])).toBe(true);
    expect(matchesAudience("5B", ["Class 5"])).toBe(true);
    expect(matchesAudience("Class 7", ["5B"])).toBe(false);
  });
});
const item=(patch:Partial<Item>={}):Item=>({id:"stable-uid",circular_id:"c",type:"pay",title:"Picnic fee",details:"Bring cash",date:"2026-10-25",end_date:null,time:null,amount:200,audience:"5B",child_ids:["kid"],status:"todo",confidence:.9,source_text:"Rs 200",...patch});
describe("calendar and weekly slip data",()=>{
 it("generates stable UIDs, two alarms, escapes content and supports all-day and timed items",()=>{
  const calendar=makeCalendar([item({title:"Pay, fee; today\nplease"}),item({id:"timed",date:"2026-10-26",time:"10:30"})],"19:00");
  expect(calendar).toContain("UID:stable-uid@circular-sloth");
  expect(calendar).toContain("SUMMARY:Pay\\, fee\\; today\\nplease");
  expect(calendar.match(/BEGIN:VALARM/g)).toHaveLength(4);
  expect(calendar).toContain("DTSTART;VALUE=DATE:20261025");
  expect(calendar).toContain("DTSTART:20261026T103000");
 });
 it("provides local summaries and replies",()=>{
  expect(summaryFallback([item()],"2026-10-19")).toHaveLength(3);
  expect(draftReplyFallback("We will attend","english")).toContain("We will attend");
 });
});
describe("encrypted backups and local lock",()=>{
 const data:BackupData={format:"circular-sloth-backup",version:1,exported_at:"2026-10-21T00:00:00.000Z",profile:null,children:[],circulars:[],items:[]};
 it("round-trips an encrypted backup and rejects a wrong passphrase",async()=>{
  const file=await encryptBackup(data,"correct horse");
  expect(await decryptBackup(file,"correct horse")).toEqual(data);
  await expect(decryptBackup(file,"wrong password")).rejects.toThrow();
 });
 it("merges by stable UUID without duplicating records and enforces PIN retry delays",async()=>{
  await db.open();await db.items.clear();await db.items.put(item());
  await restoreBackup({...data,items:[item(),item({id:"new-uid",title:"Permission slip"})]},"merge");
  expect(await db.items.count()).toBe(2);
  const hash=await hashPin("1234");expect(await verifyPin("1234",hash.hash,hash.salt)).toBe(true);expect(await verifyPin("1111",hash.hash,hash.salt)).toBe(false);
  expect(pinRetryDelay(4)).toBe(0);expect(pinRetryDelay(5)).toBeGreaterThan(0);
 });
});
describe("share target service worker",()=>{
 it("stores a simulated shared POST temporarily and redirects to Add",async()=>{
  const handlers:Record<string,(event:any)=>void>={};
  const selfMock:any={__WB_MANIFEST:[],location:{origin:"https://sloth.test"},addEventListener:(name:string,handler:(event:any)=>void)=>{handlers[name]=handler;}};
  const cacheMock:any={open:async()=>({addAll:async()=>{},match:async()=>null,put:async()=>{}}),keys:async()=>[]};
  const source=await readFile(new URL("./sw.js",import.meta.url),"utf8");
  new Function("self","caches","indexedDB",source)(selfMock,cacheMock,indexedDB);
  const file=new File(["hello"],"notice.txt",{type:"text/plain"});
  let response:Promise<Response>|undefined;
  handlers.fetch?.({request:{method:"POST",url:"https://sloth.test/share-target",formData:async()=>({get:(key:string)=>key==="title"?"School note":null,getAll:()=>[file]})},respondWith:(value:Promise<Response>)=>{response=value;}});
  const result=await response!;
  expect(result.status).toBe(303);
  expect((await peekPendingShare())?.title).toBe("School note");
  expect((await consumePendingShare())?.files[0]?.name).toBe("notice.txt");
  expect(await peekPendingShare()).toBeNull();
 });
});
beforeEach(async()=>{await db.delete();});
