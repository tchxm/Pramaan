from pathlib import Path
import asyncio,json,re
import edge_tts
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'packages/web/qa/submission-audit/film'
WORK.mkdir(parents=True,exist_ok=True)
text=(Path(__file__).parent/'VOICEOVER.md').read_text(encoding='utf-8')
parts=re.split(r'\*\*\d\d:\d\d[–-]\d\d:\d\d\*\*',text)[1:]
parts[0]='Coffee: seven ninety-nine. At payment: eight eighty-seven. Who chose the extras?'
parts[7]='Pramaan. The agent proposes. The engine decides. Find the deception. Check the fix. Show the proof.'
async def narrate(i,part):
    boundaries=[]
    audio=WORK/f'voice-{i}.mp3'
    if audio.exists() and (WORK/f'voice-{i}.json').exists() and json.loads((WORK/f'voice-{i}.json').read_text(encoding='utf-8'))['text']==part.strip(): return
    voice=edge_tts.Communicate(part.strip().replace('PRAMAAN','Pramaan'),'en-IN-PrabhatNeural',rate='+0%',boundary='WordBoundary')
    with audio.open('wb') as out:
        async for chunk in voice.stream():
            if chunk['type']=='audio':out.write(chunk['data'])
            elif chunk['type']=='WordBoundary':boundaries.append({'text':chunk['text'],'start':chunk['offset']/1e7,'end':(chunk['offset']+chunk['duration'])/1e7})
    (WORK/f'voice-{i}.json').write_text(json.dumps({'text':part.strip(),'words':boundaries},ensure_ascii=False,indent=2),encoding='utf-8')
    print('Narrated',i,flush=True)
async def main():
    # Two concurrent synthesis streams; rendering remains local.
    for first in range(0,len(parts),2):await asyncio.gather(*(narrate(i,parts[i]) for i in range(first,min(first+2,len(parts)))))
asyncio.run(main())
