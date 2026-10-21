"""Evaluate the real configured open-weight provider on synthetic circulars only.

Set provider credentials through environment/.env. Repeat --model to compare model names;
the provider adapter, retry behavior and Pydantic schema validation are shared with the API.
"""
from __future__ import annotations
import argparse, asyncio, json, os, statistics, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv()
from app.main import READ_SYSTEM_PROMPT
from app.models import Chunk, ReadRequest, ReadResult
from app.provider import provider

def normalize(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())

def class_match(actual: str, expected: str) -> bool:
    a=actual.lower().replace("class","").strip()
    e=expected.lower().replace("class","").strip()
    if a=="all" or e=="all": return a==e
    return a==e or (a[:1].isdigit() and e[:1].isdigit() and a[0]==e[0] and (len(a)==1 or len(e)==1 or a[-1:]==e[-1:]))

async def evaluate(name: str, examples: list[dict], today: str, pause: float) -> dict:
    os.environ["MODEL_NAME"]=name
    recall=hallucinated=date_hits=amount_hits=audience_hits=0
    date_total=amount_total=audience_total=0
    latencies=[]
    errors=0
    for index, example in enumerate(examples):
        request=ReadRequest(today=today, language_hint=example["language"], chunks=[Chunk(id=example["id"],text=example["text"])])
        prompt=f"today={request.today.isoformat()}; language_hint={request.language_hint}\nchunks={request.model_dump_json(include={'chunks'})}"
        started=time.perf_counter()
        try:
            result=await provider.generate(READ_SYSTEM_PROMPT,prompt,ReadResult)
            output=[item.model_dump(mode="json") for item in result.items]
        except Exception as exc:
            errors+=1
            output=[]
            print(f"{name}: {example['id']} failed ({type(exc).__name__})",file=sys.stderr)
        latencies.append(time.perf_counter()-started)
        used=set()
        for expected in example["expected"]:
            fragment=normalize(expected["title_fragment"])
            found=next((i for j,i in enumerate(output) if j not in used and i["type"]==expected["type"] and fragment in normalize(i["title"]+" "+i.get("details","")+" "+i.get("source_text",""))),None)
            if found is None: continue
            used.add(output.index(found));recall+=1
            if expected["date"] is not None:
                date_total+=1;date_hits+=found.get("date")==expected["date"]
            if expected["amount"] is not None:
                amount_total+=1;amount_hits+=found.get("amount")==expected["amount"]
            audience_total+=1;audience_hits+=class_match(found.get("audience","all"),expected["audience"])
        hallucinated+=len(output)-len(used)
        if index+1<len(examples) and pause: await asyncio.sleep(pause)
    expected_total=sum(len(x["expected"]) for x in examples)
    return {"model":name,"recall":recall/expected_total if expected_total else 0,"matched":recall,"expected":expected_total,"hallucinated":hallucinated,"date":date_hits/date_total if date_total else 0,"amount":amount_hits/amount_total if amount_total else 0,"audience":audience_hits/audience_total if audience_total else 0,"median":statistics.median(latencies) if latencies else 0,"errors":errors}

async def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--model",action="append",dest="models",help="model name; repeat for comparison")
    parser.add_argument("--data",default="eval/circulars.json")
    parser.add_argument("--delay",type=float,default=2.0)
    args=parser.parse_args()
    data=json.loads(Path(args.data).read_text(encoding="utf-8"))
    models=args.models or [os.getenv("MODEL_NAME","")]
    if not all(models): parser.error("Provide --model or configure MODEL_NAME.")
    print("Using provider="+os.getenv("LLM_PROVIDER","openai_compat")+" with "+str(len(data["examples"]))+" synthetic examples.")
    print("| Model | Item recall | Hallucinated | Date accuracy | Amount accuracy | Audience accuracy | Median latency | Errors |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|")
    for model in models:
        result=await evaluate(model,data["examples"],data["today"],args.delay)
        print(f"| {model} | {result['matched']}/{result['expected']} ({result['recall']:.0%}) | {result['hallucinated']} | {result['date']:.0%} | {result['amount']:.0%} | {result['audience']:.0%} | {result['median']:.1f}s | {result['errors']} |")
    await provider.close()

if __name__=="__main__": asyncio.run(main())
