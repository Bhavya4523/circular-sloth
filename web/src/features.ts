import type { Item, ItemType } from "./db";

export interface ChatMessage { timestamp: string; sender: string; text: string; }
const headerOne = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)\]?\s+-\s+([^:]+):\s?(.*)$/i;
const headerTwo = /^\[(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}:\d{2})\]\s+([^:]+):\s?(.*)$/;
export function parseWhatsAppExport(source: string): ChatMessage[] {
 const result:ChatMessage[]=[];let current:ChatMessage|null=null;
 for(const line of source.replace(/^\uFEFF/,"").split(/\r?\n/)){
  const m=headerOne.exec(line)||headerTwo.exec(line);
  if(m){if(current)result.push(current);current={timestamp:m[1]+" "+m[2],sender:m[3].trim(),text:m[4].trim()};continue;}
  if(/^<Media omitted>$/i.test(line.trim()))continue;
  if(/^(?:Messages and calls are end-to-end encrypted|.+ (?:changed the (?:subject|group description|group icon)|added .+|removed .+|left|joined using this group(?:'s|’s) invite link))$/i.test(line.trim())){if(current){result.push(current);current=null;}result.push({timestamp:"",sender:"System",text:line.trim()});continue;}
  if(!current){if(line.trim())result.push({timestamp:"",sender:"System",text:line.trim()});continue;}
  current.text+="\n"+line;
 }
 if(current)result.push(current);
 return result.filter(m=>m.text.trim()&&m.text.trim()!=="<Media omitted>");
}
export function matchesAudience(audience:string,classes:string[]):boolean {
 if(!audience||/^all$/i.test(audience.trim()))return true;
 const normalize=(text:string)=>text.toLocaleLowerCase().replace(/^(?:class|grade|std\.?|standard)\s*/,"").replace(/\s+/g," ").trim();
 const a=normalize(audience);const audienceParts=/^(\d+)\s*([a-z]?)$/.exec(a);
 return classes.some(label=>{const c=normalize(label);if(!c)return false;if(a===c)return true;const classParts=/^(\d+)\s*([a-z]?)$/.exec(c);if(classParts&&audienceParts)return classParts[1]===audienceParts[1]&&(!classParts[2]||!audienceParts[2]||classParts[2]===audienceParts[2]);return false;});
}
export function formatRupees(amount:number|null|undefined,locale="en-IN"):string{return amount==null?"":new Intl.NumberFormat(locale,{style:"currency",currency:"INR",maximumFractionDigits:0}).format(amount);}
export function escapeIcs(value:string):string{return value.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");}
function utcStamp(date:Date):string{return date.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");}
export function makeCalendar(items:Item[],reminderTime="19:00"):string{
 const valid=items.filter(item=>item.status!=="dismissed"&&item.date);
 const events=valid.map(item=>{const date=item.date!.replaceAll("-","");const timed=!!item.time;const start=timed?date+"T"+item.time!.replace(":","")+"00":date;const end=timed?date+"T"+String(Number(item.time!.slice(0,2))+1).padStart(2,"0")+item.time!.slice(3,5)+"00":addDate(date,1);const previous=new Date(item.date+"T"+reminderTime+":00+05:30");const morning=new Date(item.date+"T08:00:00+05:30");return ["BEGIN:VEVENT","UID:"+escapeIcs(item.id)+"@circular-sloth","DTSTAMP:"+utcStamp(new Date()),"SUMMARY:"+escapeIcs(item.title),"DESCRIPTION:"+escapeIcs(item.details+(item.amount!=null?" · "+formatRupees(item.amount):"")),"DTSTART"+(timed?":":";VALUE=DATE:")+start,"DTEND"+(timed?":":";VALUE=DATE:")+end,"BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+escapeIcs(item.title),"TRIGGER;VALUE=DATE-TIME:"+utcStamp(previous),"END:VALARM","BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+escapeIcs(item.title),"TRIGGER;VALUE=DATE-TIME:"+utcStamp(morning),"END:VALARM","END:VEVENT"].join("\r\n");});
 return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Circular Sloth//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",...events,"END:VCALENDAR",""].join("\r\n");
}
function addDate(yyyymmdd:string,days:number):string{const y=Number(yyyymmdd.slice(0,4)),m=Number(yyyymmdd.slice(4,6)),d=Number(yyyymmdd.slice(6,8));const next=new Date(Date.UTC(y,m-1,d+days));return next.toISOString().slice(0,10).replaceAll("-","");}
export function summaryFallback(items:Item[],weekStart:string):string[]{const date=new Date(weekStart+"T00:00:00");const end=new Date(date);end.setDate(end.getDate()+6);const relevant=items.filter(i=>i.status==="todo"&&(!i.date||(i.date>=weekStart&&i.date<=end.toISOString().slice(0,10))));const pay=relevant.filter(i=>i.type==="pay");const bring=relevant.filter(i=>i.type==="bring"||i.type==="wear");return [relevant.length+" school reminder"+(relevant.length===1?"":"s")+" this week.",bring.length?bring.length+" things to wear or bring.":"No clothes or supplies to prepare.",pay.length?pay.length+" payment"+(pay.length===1?"":"s")+" to remember.":"No payments listed."];}
export function draftReplyFallback(intent:string,language:string):string{if(language==="hindi")return "नमस्ते, "+intent+"। धन्यवाद।";if(language==="marathi")return "नमस्कार, "+intent+"। धन्यवाद.";return "Hello, "+intent+". Thank you.";}
export function createItemId():string{return crypto.randomUUID();}
export const itemTypes:ItemType[]=["wear","bring","pay","sign","attend","holiday","deadline","info"];

