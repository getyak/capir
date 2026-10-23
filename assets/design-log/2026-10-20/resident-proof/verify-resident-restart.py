import fcntl,json,os,re,subprocess,sys,time,urllib.request
from pathlib import Path
from datetime import datetime,timezone
expected,out=sys.argv[1:]
state=Path.home()/"Library/Application Support/Talent Signal/web"
lock=(state/"install.lock").open("a");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
before=json.loads((state/"active-release.json").read_text());assert before["revision"]==expected
release=Path(before["release"]);assert subprocess.check_output(["git","-C",str(release),"status","--porcelain"],text=True)==""
target=f"gui/{os.getuid()}/com.talentsignal.web"
def pid():
 s=subprocess.check_output(["launchctl","print",target],text=True);m=re.search(r"^\s*pid = (\d+)\s*$",s,re.M);return m.group(1) if m else None
old=pid();started_utc=datetime.now(timezone.utc).isoformat();started=time.monotonic();subprocess.run(["launchctl","kickstart","-k",target],check=True)
ready=False;attempts=0
while time.monotonic()-started<120:
 attempts+=1
 try:
  with urllib.request.urlopen("http://127.0.0.1:3000/api/auth/providers",timeout=2) as response:ready=response.status==200 and "password-account" in json.load(response)
 except Exception:ready=False
 if ready:break
 time.sleep(2)
after=json.loads((state/"active-release.json").read_text());new=pid()
https=subprocess.run(["curl","--max-time","20","--silent","--show-error","--output","/dev/null","--write-out","%{http_code} %{ssl_verify_result}","https://smile-m4-minimac-mini.tail25e61f.ts.net:10443/login"],capture_output=True,text=True,check=True).stdout
with urllib.request.urlopen("http://127.0.0.1:4317/health/ready",timeout=5) as r:api=json.load(r)
receipt={"revision":before["revision"],"buildID":before["buildID"],"started_utc":started_utc,"ready":ready,"elapsed_seconds":round(time.monotonic()-started,2),"attempts":attempts,"process_changed":old!=new,"active_receipt_unchanged":before==after,"https_login_http_and_certificate_verify":https,"api_readiness":api}
Path(out).write_text(json.dumps(receipt,indent=2)+"\n");print(json.dumps(receipt,indent=2));assert ready and old!=new and before==after and https=="200 0" and api["status"]=="ready"
