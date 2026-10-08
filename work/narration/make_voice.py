from pathlib import Path
import subprocess,json
root=Path.cwd();out=root/'outputs/Movie_Narrated';work=root/'work/narration'
ff=root/'work/link-import/LinkImport/bin/ffmpeg';fp=root/'work/link-import/LinkImport/bin/ffprobe'
texts=(out/'나레이션_대본.txt').read_text().strip().splitlines();rows=[]
for i,text in enumerate(texts):
 p=work/f'part-{i}.txt';p.write_text(text)
 audio=work/f'part-{i}.aiff'
 subprocess.run(['say','-v','Yuna','-r','205','-f',str(p),'-o',str(audio)],check=True)
 duration=float(subprocess.check_output([str(fp),'-v','error','-show_entries','format=duration','-of','csv=p=0',str(audio)]))
 rows.append(dict(text=text,path=str(audio),duration=duration))
(work/'voice-parts.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2));print('TOTAL',sum(r['duration'] for r in rows));print([r['duration'] for r in rows])
