import pathlib,urllib.request,json,hashlib,gzip,zipfile,io,concurrent.futures
root=pathlib.Path('work/link-import/LinkImport');(root/'bin').mkdir(parents=True,exist_ok=True);(root/'licenses').mkdir(exist_ok=True)
ff=json.load(urllib.request.urlopen('https://api.github.com/repos/eugeneware/ffmpeg-static/releases/latest'))
items=[]
for name in ['yt-dlp','deno']:
 d=json.loads(pathlib.Path('work/link-import/'+name+'-release.json').read_text())
 for a in d['assets']:
  if a['name']=='SHA2-256SUMS':continue
  items.append((name,a['url'],a.get('digest'),d['version']))
for name in ['ffmpeg','ffprobe']:
 a=next(a for a in ff['assets'] if a['name']==name+'-darwin-arm64.gz')
 items.append((name,a['browser_download_url'],a.get('digest'),ff['tag_name']))
def get(item):
 name,url,digest,version=item
 data=urllib.request.urlopen(url,timeout=120).read()
 if digest:assert hashlib.sha256(data).hexdigest()==digest.split(':')[1]
 if name=='deno':data=zipfile.ZipFile(io.BytesIO(data)).read('deno')
 elif name in ['ffmpeg','ffprobe']:data=gzip.decompress(data)
 p=root/'bin'/name;p.write_bytes(data);p.chmod(0o755)
 print(name,version,len(data),flush=True)
 return {'name':name,'version':version,'source':url,'sha256':hashlib.sha256(data).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: result=list(pool.map(get,items))
(root/'engines.json').write_text(json.dumps(result,indent=2))
for name,url in [('FFmpeg-LICENSE','https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/darwin-arm64.LICENSE'),('FFmpeg-README','https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/darwin-arm64.README'),('yt-dlp-LICENSE','https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE'),('yt-dlp-THIRD-PARTY','https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/THIRD_PARTY_LICENSES.txt'),('Deno-LICENSE','https://raw.githubusercontent.com/denoland/deno/main/LICENSE.md')]:
 try:(root/'licenses'/name).write_bytes(urllib.request.urlopen(url).read())
 except Exception as e:print(name,type(e).__name__)
