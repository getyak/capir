import sys,json,time,fcntl,importlib.util,contextlib,datetime
from pathlib import Path
release=Path(sys.argv[1]).resolve(strict=True)
expected=sys.argv[2]
out=Path(sys.argv[3])
state=Path.home()/"Library/Application Support/Talent Signal/web/active-release.json"
before=json.loads(state.read_text())
assert before["revision"]==expected,"Resident changed before activation; stop for reconciliation"
script=release/"scripts/deploy/install-web-launch-agent.py"
spec=importlib.util.spec_from_file_location("owned_verified_web_installer",script)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ExpectedPriorGuard:
 def __getattr__(self,name):return getattr(fcntl,name)
 def flock(self,file,operation):
  fcntl.flock(file,operation)
  if operation==(fcntl.LOCK_EX|fcntl.LOCK_NB):
   actual=json.loads(state.read_text())
   if actual["revision"]!=expected:raise SystemExit("Resident changed while acquiring installer lock; no activation performed")
module.fcntl=ExpectedPriorGuard()
sys.argv=[str(script),str(release)]
started=time.monotonic();status="failed";error=None
try:
 with out.with_suffix(".log").open("w") as log,contextlib.redirect_stdout(log),contextlib.redirect_stderr(log):module.main()
 status="passed"
except BaseException as exc:
 error=str(exc);raise
finally:
 after=json.loads(state.read_text()) if state.exists() else None
 result={"status":status,"finished_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"elapsed_seconds":round(time.monotonic()-started,2),"expected_prior_guard_after_installer_lock":expected,"before":before,"after":after,"error":error}
 out.write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps({"status":status,"elapsed_seconds":result["elapsed_seconds"],"active_revision":after.get("revision") if after else None,"error":error}))
