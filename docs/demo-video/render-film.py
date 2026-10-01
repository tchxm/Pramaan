"""Assemble an actual 120-second demo from local browser footage and narration.
Dependencies: imageio-ffmpeg, edge-tts (synthesis step), Pillow, numpy.
No application source is changed, and no recorded verdict is synthesized.
"""
from pathlib import Path
import json,re,subprocess,wave,html,math,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFont
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'packages/web/qa/submission-audit/film'
OUT=ROOT/'deliverables'
OUT.mkdir(exist_ok=True)
FF=imageio_ffmpeg.get_ffmpeg_exe()
FONT='C:/Windows/Fonts/segoeui.ttf'
BOLD='C:/Windows/Fonts/segoeuib.ttf'
IVORY='#f3f2e9'; MINT='#56e5c5'; MUTED='#a7b9b4'
SIZES=[8,15,12,20,20,20,15,10]
CHAPTERS=['THE PRICE CHANGED','FIND THE DECEPTION','UNDERSTAND THE SOURCE','THE AGENT PROPOSES','A BOUNDED EDIT','THE ENGINE DECIDES','SHOW THE PROOF','PRAMAAN']
TITLES=['Same coffee. Different price.','Find deceptive UI. Check the fix.','Evidence points to the actual source.','Real tools. A limited repair strategy.','One initial value. A choice restored.','Five checks. One independent verdict.','Inspect the result. Verify the record.','The agent proposes. The engine decides.']
caps=json.loads((WORK/'captures.json').read_text())

def run(args):
    p=subprocess.run([FF,'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True,text=True)
    if p.returncode:raise RuntimeError(p.stderr[-6000:])

def duration(file):
    p=subprocess.run([FF,'-hide_banner','-i',str(file)],capture_output=True,text=True)
    m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',p.stderr)
    if not m:raise RuntimeError('No duration: '+str(file))
    return int(m[1])*3600+int(m[2])*60+float(m[3])

def font(n,bold=False):return ImageFont.truetype(BOLD if bold else FONT,n)
def base(i):
    # Editorial graphics, with the existing product palette.
    yy,xx=np.mgrid[0:1080,0:1920]
    g=np.exp(-(((xx-1700)/1100)**2+((yy-200)/850)**2))*0.9
    rgb=np.stack([7+3*g,12+13*g,13+11*g],axis=-1).astype('uint8')
    im=Image.fromarray(rgb);d=ImageDraw.Draw(im)
    d.text((72,38),'PRAMAAN',font=font(30,True),fill=IVORY)
    d.text((280,48),f'{i+1:02d} / {CHAPTERS[i]}',font=font(20,True),fill=MINT)
    d.line((72,92,1848,92),fill='#263d36',width=2)
    d.text((72,111),TITLES[i],font=font(46,True),fill=IVORY)
    if 2<=i<=6:
        d.text((1210,48),'RECORDED LIVE RUN / PRM-2026-000115',font=font(19),fill=MUTED)
    else:d.text((1430,48),'DEVELOPER & AI  /  DrCode',font=font(19),fill=MUTED)
    # Caption area stays outside the product viewport.
    d.rectangle((0,973,1920,1080),fill='#060b0a')
    if i==0:
        d.text((88,284),'₹799',font=font(112,True),fill=IVORY)
        d.text((94,428),'ADVERTISED',font=font(22,True),fill=MUTED)
        d.text((94,492),'₹887',font=font(112,True),fill=MINT)
        d.text((94,636),'AT PAYMENT',font=font(22,True),fill=MUTED)
        d.text((94,728),'+ ₹49 preselected protection',font=font(29),fill=IVORY)
        d.text((94,783),'+ ₹39 disclosed late',font=font(29),fill=IVORY)
        d.text((94,915),'SAVED CHECKOUT ILLUSTRATION',font=font(20,True),fill=MUTED)
    elif i==4:
        d.text((114,905),'ORIGINAL → ISOLATED PATCHED PROJECT',font=font(22,True),fill=MINT)
    elif i==7:
        # A clean end card, rather than extra slides replacing the demo.
        for r in range(230,430,32):d.ellipse((1420-r,590-r,1420+r,590+r),outline='#1a584a',width=2)
        d.text((93,313),'PRAMAAN',font=font(126,True),fill=IVORY)
        d.text((100,499),'Find the deception.',font=font(46),fill=MINT)
        d.text((100,567),'Check the fix. Show the proof.',font=font(46),fill=IVORY)
        d.text((102,731),'DrCode  /  Mohammed Afnan · Shivam Kumar',font=font(27),fill=MUTED)
        d.text((102,792),'Developer & AI',font=font(25),fill=MUTED)
        d.text((102,898),'github.com/tchxm/Pramaan',font=font(25),fill=MINT)
    p=WORK/f'frame-{i}.png';im.save(p);return p

frames=[base(i) for i in range(8)]

def render_chunk(name,chapter,seconds,clips,notes=None):
    dest=WORK/(name+'.mp4')
    signature=hashlib.sha256(json.dumps([chapter,seconds,clips,notes]).encode()).hexdigest()
    cache=WORK/(name+'.signature')
    if dest.exists() and cache.exists() and cache.read_text()==signature:return dest
    args=['-loop','1','-framerate','30','-i',frames[chapter]]
    filters=['[0:v]format=yuv420p[bg]'];last='bg'
    for j,c in enumerate(clips,1):
        shot,rect,position=c
        clip=WORK/(shot+'.webm')
        skip=max(0,duration(clip)-caps[shot]['heldForMs']/1000)
        args+=['-ss',round(skip,3),'-i',clip]
        x,y,w,h=rect;dx,dy,dw,dh=position
        filters.append(f'[{j}:v]crop={w}:{h}:{x}:{y},scale={dw}:{dh}:flags=lanczos,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration={seconds},setpts=PTS-STARTPTS[v{j}]')
        label=f'b{j}'
        filters.append(f'[{last}][v{j}]overlay={dx}:{dy}:shortest=1[{label}]');last=label
    if notes:
        # Generated transparent editorial text, never a replacement product UI.
        layer=Image.new('RGBA',(1920,1080));d=ImageDraw.Draw(layer)
        for x,y,text in notes:d.text((x,y),text,font=font(25,True),fill=MINT)
        p=WORK/(name+'-notes.png');layer.save(p)
        args+=['-loop','1','-i',p]
        n=len(clips)+1;filters.append(f'[{last}][{n}:v]overlay=0:0:shortest=1[note]');last='note'
    filters.append(f'[{last}]fade=t=in:st=0:d=0.18,fade=t=out:st={seconds-0.18}:d=0.18[out]')
    run(args+['-filter_complex',';'.join(filters),'-map','[out]','-an','-t',seconds,'-r','30','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',dest])
    cache.write_text(signature)
    print('Rendered',name,flush=True);return dest

chunks=[]
chunks.append(render_chunk('c00',0,8,[('problem',(686,106,568,614),(1088,179,690,746))]))
chunks.append(render_chunk('c01a',1,5,[('hero',(0,74,1440,720),(160,190,1600,800))]))
chunks.append(render_chunk('c01b',1,10,[('findings',(152,74,1136,640),(293,200,1334,752))],[(293,927,'CCPA dark-pattern framework, 2023 · self-audit advisory, 2025')]))
chunks.append(render_chunk('c02',2,12,[('source',(16,74,1408,540),(72,238,1776,681))],[(72,194,'Single-finding test fixture · real source + detector evidence')]))
chunks.append(render_chunk('c03',3,20,[('tools',(16,128,1408,658),(184,220,1552,725))],[(72,184,'source.read → patch.propose → patch.apply → detector.verify')]))
chunks.append(render_chunk('c04a',4,9,[('diff',(324,310,714,260),(124,241,1672,610))],[(125,188,'ACTUAL DIFF / src/pages/Cart.tsx')]))
chunks.append(render_chunk('c04b',4,11,[('before',(0,20,450,260),(110,311,820,474)),('after',(0,20,450,260),(990,311,820,474))],[(110,241,'ORIGINAL · starts selected'),(990,241,'PATCHED · the shopper chooses')]))
# Collapse the prose guide for a clear, readable genuine gate matrix.
gate_img=ROOT/'packages/web/qa/submission-audit/live-footage/outcome.png'
# Use a held recorded frame for the matrix instead of inventing gate graphics.
run(['-loop','1','-framerate','30','-i',gate_img,'-vf','crop=910:720:265:100','-t','20','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','5',WORK/'matrix.webm'])
caps['matrix']={'heldForMs':20000}
chunks.append(render_chunk('c05',5,20,[('matrix',(0,0,910,720),(510,188,900,712))],[(90,332,'G1  Target cleared'),(90,420,'G2  Values preserved'),(90,508,'G3  Build passes'),(90,596,'G4  Browser checked'),(90,684,'G5  No regression'),(1480,467,'VERIFIED'),(1480,534,'1 finding → 0 open')]))
chunks.append(render_chunk('c06',6,15,[('proof',(492,128,620,682),(618,185,690,760))],[(85,352,'PACK HASH'),(85,414,'TRACE CHAIN'),(85,476,'TRACE HEAD'),(1390,733,'All three checks passed'),(85,838,'Technical self-audit evidence'),(85,882,'No legal certification')]))
chunks.append(render_chunk('c07',7,10,[]))

# Segment narration matches the exact chapter boundaries; pad natural pauses.
voice_files=[];timeline=[];cursor=0;timing=[]
for i,seconds in enumerate(SIZES):
    audio=WORK/f'voice-{i}.mp3';record=json.loads((WORK/f'voice-{i}.json').read_text(encoding='utf-8'))
    length=duration(audio); available=seconds-0.65
    speed=max(1.0,length/available)
    wav=WORK/f'voice-{i}.wav'
    run(['-i',audio,'-af',f'atempo={speed:.6f},adelay=300:all=1,apad,atrim=duration={seconds}','-ar','48000','-ac','2',wav])
    voice_files.append(wav);timing.append({'chapter':i,'seconds':seconds,'speechDuration':length,'speed':speed})
    words=record['words'];group=[];text_cursor=0
    for word in words:
        # Preserve written punctuation omitted by speech word-boundary events.
        match=re.search(re.escape(html.unescape(word['text'])),record['text'][text_cursor:],re.IGNORECASE)
        word['display']=html.unescape(word['text'])
        if match:
            text_cursor+=match.end()
            punctuation=re.match(r'[.,;:!?]+',record['text'][text_cursor:])
            if punctuation:word['display']+=punctuation[0];text_cursor+=len(punctuation[0])
    for j,word in enumerate(words):
        group.append(word)
        line=' '.join(x['display'] for x in group)
        if len(group)>=7 or len(line)>=43 or j==len(words)-1:
            start=cursor+0.3+group[0]['start']/speed
            end=min(cursor+seconds-0.05,cursor+0.3+group[-1]['end']/speed+0.18)
            timeline.append((start,max(start+0.3,end),line));group=[]
    cursor+=seconds

def ass_time(t):
    cs=int(round(t*100));return f'{cs//360000}:{cs//6000%60:02d}:{cs//100%60:02d}.{cs%100:02d}'
ass='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Segoe UI,34,&H00F3F2E9,&H00F3F2E9,&H000B100E,&H000B100E,-1,0,0,0,100,100,0,0,3,8,0,2,80,80,32,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
for index,(start,end,line) in enumerate(timeline):
    if index+1<len(timeline):end=min(end,timeline[index+1][0]-0.02)
    end=max(start+0.01,end)
    ass+=f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{{\\fad(60,60)}}{line}\n'
(WORK/'captions.ass').write_text(ass,encoding='utf-8-sig')
def srt_time(t):
    ms=int(round(t*1000));return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
srt=[]
for index,(start,end,line) in enumerate(timeline):
    if index+1<len(timeline):end=min(end,timeline[index+1][0]-0.02)
    srt.append(f'{index+1}\n{srt_time(start)} --> {srt_time(max(start+0.01,end))}\n{line}\n')
(OUT/'PRAMAAN_DrCode_2min_demo.srt').write_text('\n'.join(srt),encoding='utf-8')

# An original, low-volume instrumental bed: restrained pulses and soft chords.
rate=48000;t=np.arange(rate*120,dtype=np.float64)/rate
score=np.zeros_like(t)
for bar in range(30):
    a=bar*4;b=a+4;mask=(t>=a)&(t<b);local=t[mask]-a
    chord=[[146.83,220,293.66],[130.81,196,261.63],[174.61,220,349.23],[164.81,246.94,329.63]][bar%4]
    env=np.sin(np.pi*np.clip(local/4,0,1))**1.4
    for f in chord:score[mask]+=0.003*np.sin(2*np.pi*f*local)*env
beat=t%(60/78)
score+=0.007*np.sin(2*np.pi*(52*t-4*beat))*np.exp(-beat*15)
score*=np.minimum(t/2,1)*np.minimum((120-t)/3,1)
stereo=np.stack([score,score*0.96],axis=1)
music=WORK/'original-score.wav'
with wave.open(str(music),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(rate);f.writeframes((stereo*32767).astype('<i2').tobytes())

(WORK/'video-list.txt').write_text('\n'.join("file '"+p.as_posix()+"'" for p in chunks),encoding='utf-8')
(WORK/'voice-list.txt').write_text('\n'.join("file '"+p.as_posix()+"'" for p in voice_files),encoding='utf-8')
run(['-f','concat','-safe','0','-i',WORK/'voice-list.txt','-c:a','pcm_s16le',WORK/'narration.wav'])
run(['-f','concat','-safe','0','-i',WORK/'video-list.txt','-c:v','copy',WORK/'picture.mp4'])
output=OUT/'PRAMAAN_DrCode_2min_demo.mp4'
temporary=OUT/'PRAMAAN_DrCode_2min_demo.rendering.mp4'
# Render from the work directory to keep subtitle filter paths unambiguous.
cmd=[FF,'-hide_banner','-loglevel','error','-y','-i','picture.mp4','-i','narration.wav','-i','original-score.wav','-filter_complex',"[0:v]ass=captions.ass[v];[1:a][2:a]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]",'-map','[v]','-map','[a]','-t','120','-r','30','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(temporary)]
p=subprocess.run(cmd,cwd=WORK,capture_output=True,text=True)
if p.returncode:raise RuntimeError(p.stderr[-6000:])
temporary.replace(output)
(WORK/'render-manifest.json').write_text(json.dumps({'output':str(output),'duration':duration(output),'narration':'en-IN-PrabhatNeural (synthetic)','music':'Original procedural instrumental bed','timing':timing,'chapters':CHAPTERS,'videoSources':'Actual browser recordings; captured live audit PRM-2026-000115; opening is saved illustration'},indent=2),encoding='utf-8')
print('EXPORTED',output,'duration',duration(output),flush=True)
