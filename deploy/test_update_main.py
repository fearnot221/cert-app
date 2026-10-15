import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("update-main.sh")
SHA = "a" * 40
FAKE = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["CALL_LOG"], "a") as f:
    f.write(json.dumps([name] + args) + "\\n")
if name == "git":
    if args[0] == "rev-parse":
        count = Path(os.environ["CALL_LOG"] + ".count")
        n = int(count.read_text()) + 1 if count.exists() else 1
        count.write_text(str(n))
        print("b" * 40 if os.environ.get("STALE") == "1" or (os.environ.get("STALE_AFTER_BUILD") == "1" and n > 1) else "a" * 40)
    if args[0] == "status" and os.environ.get("DIRTY") == "1":
        print(" M compose.production.yaml")
    if args[0] == "switch":
        public = Path(os.environ["DEPLOY_REPO"]) / "checkout-public"
        public.mkdir()
        (public / "favicon.svg").write_text("<svg/>")
if name == "docker":
    if "images" in args: print("oldimage")
    if args[:2] == ["image", "inspect"]: print("cert-app-production-api:latest")
    if "build" in args and os.environ.get("FAIL_BUILD") == "1": sys.exit(1)
'''


@unittest.skipUnless(sys.platform.startswith("linux"), "Deployment host requires Linux Bash and flock")
class DeployScriptTests(unittest.TestCase):
    def run_deploy(self, **settings):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binaries = root / "bin"
            binaries.mkdir()
            for name in ("git", "docker"):
                path = binaries / name
                path.write_text(FAKE)
                path.chmod(0o755)
            log = root / "calls.jsonl"
            secret = root / ".env"
            secret.write_text("private fixture")
            secret.chmod(0o600)
            env = dict(os.environ, PATH=str(binaries) + os.pathsep + os.environ["PATH"],
                       DEPLOY_REPO=directory, DEPLOY_PROJECT="cert-app-production",
                       CALL_LOG=str(log), **settings)
            result = subprocess.run(["bash", "-c", 'umask 0077; exec bash "$1" "$2"', "deployment-test", str(SCRIPT), SHA], env=env, capture_output=True, text=True)
            self.assertTrue(log.exists(), result.stderr)
            public = root / "checkout-public"
            if public.exists():
                self.assertEqual(public.stat().st_mode & 0o777, 0o755)
                self.assertEqual((public / "favicon.svg").stat().st_mode & 0o777, 0o644)
            self.assertEqual(secret.stat().st_mode & 0o777, 0o600)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            return result, calls

    def test_stable_project_shared_build_disposable_migration_and_safe_cleanup(self):
        result, calls = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        docker = [call for call in calls if call[0] == "docker"]
        compose = [call for call in docker if call[1] == "compose"]
        for call in compose:
            self.assertEqual(call[call.index("--project-name") + 1], "cert-app-production")
            self.assertEqual(call[call.index("-f") + 1], "compose.production.yaml")
        build = next(call for call in compose if "build" in call)
        self.assertEqual(build[-3:], ["build", "api", "web"])
        migration = next(call for call in compose if "run" in call)
        self.assertEqual(migration[-4:], ["run", "--rm", "--no-deps", "migrate"])
        self.assertTrue(any(call[-4:] == ["prune", "--force", "--keep-storage", "1GB"] for call in docker))
        self.assertIn(["docker", "image", "prune", "--force", "--filter", "label=io.cert-app.managed=true"], docker)
        self.assertFalse(any("down" in call or "--volumes" in call for call in docker))
        self.assertFalse(any(call[1:3] == ["volume", "prune"] for call in docker))

    def test_stale_event_never_checks_out_or_builds(self):
        result, calls = self.run_deploy(STALE="1")
        self.assertEqual(result.returncode, 75)
        self.assertFalse(any("switch" in call or "build" in call for call in calls))

    def test_new_push_during_build_never_migrates_or_restarts_services(self):
        result, calls = self.run_deploy(STALE_AFTER_BUILD="1")
        self.assertEqual(result.returncode, 75)
        self.assertFalse(any("run" in call or "up" in call for call in calls))

    def test_dirty_checkout_is_preserved(self):
        result, calls = self.run_deploy(DIRTY="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("switch" in call or "build" in call for call in calls))

    def test_build_failure_never_migrates_restarts_or_cleans_up(self):
        result, calls = self.run_deploy(FAIL_BUILD="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("run" in call or "up" in call or "prune" in call for call in calls))


if __name__ == "__main__":
    unittest.main()
