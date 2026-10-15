#!/usr/bin/env python3
"""Signed GitHub CI webhook with one durable, coalescing deployment queue."""
import fcntl
import hashlib
import hmac
import http.server
import json
import logging
import os
from pathlib import Path
import re
import socketserver
import subprocess
import threading

LOG = logging.getLogger("cert-app-deploy")


def deployment_event(event, payload, repository, branch):
    if event != "workflow_run" or payload.get("action") != "completed":
        return None
    run = payload.get("workflow_run", {})
    if (payload.get("repository", {}).get("full_name") != repository
            or run.get("head_repository", {}).get("full_name") != repository
            or run.get("event") != "push" or run.get("head_branch") != branch
            or run.get("conclusion") != "success" or run.get("status") != "completed"
            or run.get("path") != ".github/workflows/ci.yml"):
        return None
    sha, number = run.get("head_sha", ""), run.get("run_number")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        return None
    if not isinstance(number, int) or isinstance(number, bool) or number < 1:
        return None
    return {"sha": sha, "number": number}


def valid_signature(body, signature, secret):
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), signature.encode())


class Queue:
    def __init__(self, directory):
        self.directory = directory
        self.condition = threading.Condition()
        self.path = directory / "state.json"
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {}

    def save(self):
        temporary = self.directory / "state.tmp"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(self.state, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, self.path)
        fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def accept(self, job):
        with self.condition:
            if job["number"] <= self.state.get("last_run_number", 0):
                return False
            self.state["last_run_number"] = job["number"]
            # A rerun of already deployed code also needs no deployment.
            self.state["pending"] = None if job["sha"] == self.state.get("deployed_sha") else job
            self.save()
            self.condition.notify_all()
            return True

    def work(self, repository):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.state.get("pending") is not None)
                job = dict(self.state["pending"])
            LOG.info("Deploying %s (CI run %s)", job["sha"], job["number"])
            try:
                result = subprocess.run(
                    ["bash", str(repository / "deploy/update-main.sh"), job["sha"]],
                    check=False, timeout=3600,
                )
                code = result.returncode
            except (OSError, subprocess.TimeoutExpired):
                LOG.exception("Deployment process failed")
                code = 1
            with self.condition:
                if code == 0:
                    self.state["deployed_sha"] = job["sha"]
                    self.state.pop("last_error", None)
                elif code != 75:
                    self.state["last_error"] = {"sha": job["sha"], "exit_code": code}
                if self.state.get("pending") == job:
                    if code in (0, 75):
                        self.state["pending"] = None
                    else:
                        LOG.error("Deployment failed (%s); retrying in 60 seconds", code)
                self.save()
                if code not in (0, 75) and self.state.get("pending") == job:
                    self.condition.wait(timeout=60)


def make_handler(queue, secret, repository, branch):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/_deploy/github":
                self.reply(404, "not found")
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                size = 0
            if not 0 < size <= 1024 * 1024:
                self.reply(413, "invalid body size")
                return
            self.connection.settimeout(10)
            body = self.rfile.read(size)
            if not valid_signature(body, self.headers.get("X-Hub-Signature-256", ""), secret):
                self.reply(401, "invalid signature")
                return
            try:
                payload = json.loads(body)
                if not isinstance(payload, dict):
                    raise ValueError("expected an object")
                job = deployment_event(self.headers.get("X-GitHub-Event"), payload, repository, branch)
            except (ValueError, AttributeError, TypeError):
                self.reply(400, "invalid payload")
                return
            if job is None:
                self.reply(200, "ignored")
                return
            self.reply(202 if queue.accept(job) else 200, "accepted or already handled")

        def reply(self, status, message):
            body = (message + "\n").encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            LOG.info(format, *args)

    return Handler


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    # BaseHTTPRequestHandler's default formatter expects a TCP client address.
    def finish_request(self, request, client_address):
        self.RequestHandlerClass(request, ("local", 0), self)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    repository = Path(os.environ["DEPLOY_REPO"]).resolve()
    secret = os.environ["GITHUB_WEBHOOK_SECRET"]
    if len(secret) < 32:
        raise ValueError("GITHUB_WEBHOOK_SECRET must contain at least 32 characters")
    directory = repository / ".runtime/deploy"
    directory.mkdir(parents=True, exist_ok=True)
    # Fail on a second receiver before touching its socket or shared state.
    with (directory / "receiver.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        queue = Queue(directory)
        socket = directory / "webhook.sock"
        socket.unlink(missing_ok=True)
        handler = make_handler(queue, secret, os.environ["GITHUB_REPOSITORY"], "main")
        with Server(str(socket), handler) as server:
            socket.chmod(0o660)
            threading.Thread(target=queue.work, args=(repository,), daemon=True).start()
            LOG.info("Listening on %s", socket)
            server.serve_forever()


if __name__ == "__main__":
    main()
