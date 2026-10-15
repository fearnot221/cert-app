import hashlib
import hmac
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest

from webhook import Queue, Server, deployment_event, make_handler, valid_signature


REPOSITORY = "fearnot221/cert-app"
SECRET = "test-only-webhook-secret-32-characters"
SHA = "a" * 40


def payload(number=10, sha=SHA):
    return {
        "action": "completed", "repository": {"full_name": REPOSITORY},
        "workflow_run": {
            "head_repository": {"full_name": REPOSITORY}, "head_branch": "main",
            "event": "push", "conclusion": "success", "status": "completed",
            "path": ".github/workflows/ci.yml", "head_sha": sha, "run_number": number,
        },
    }


class WebhookTests(unittest.TestCase):
    def test_only_successful_main_push_ci_can_deploy(self):
        expected = {"sha": SHA, "number": 10}
        self.assertEqual(deployment_event("workflow_run", payload(), REPOSITORY, "main"), expected)
        for key, value in [("head_branch", "feature"), ("conclusion", "failure"),
                           ("status", "in_progress"), ("event", "pull_request"),
                           ("path", ".github/workflows/other.yml"),
                           ("head_sha", ";touch /tmp/injected"), ("run_number", True),
                           ("head_repository", {"full_name": "attacker/fork"})]:
            with self.subTest(key=key):
                event = payload()
                event["workflow_run"][key] = value
                self.assertIsNone(deployment_event("workflow_run", event, REPOSITORY, "main"))
        event = payload()
        event["repository"]["full_name"] = "another/repo"
        self.assertIsNone(deployment_event("workflow_run", event, REPOSITORY, "main"))
        self.assertIsNone(deployment_event("push", payload(), REPOSITORY, "main"))

    def test_signature_covers_raw_bytes(self):
        body = json.dumps(payload()).encode()
        signature = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        self.assertTrue(valid_signature(body, signature, SECRET))
        self.assertFalse(valid_signature(body + b" ", signature, SECRET))
        self.assertFalse(valid_signature(body, signature, SECRET + "other"))
        self.assertFalse(valid_signature(body, "", SECRET))
        self.assertFalse(valid_signature(body, "sha256=non-ascii-中文字", SECRET))

    def test_queue_survives_restart_and_ignores_duplicates_and_out_of_order_events(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            queue = Queue(path)
            self.assertTrue(queue.accept({"sha": SHA, "number": 10}))
            self.assertFalse(queue.accept({"sha": SHA, "number": 10}))
            self.assertFalse(queue.accept({"sha": "b" * 40, "number": 9}))
            self.assertEqual(Queue(path).state["pending"]["sha"], SHA)
            self.assertTrue(queue.accept({"sha": "b" * 40, "number": 11}))
            queue.state["deployed_sha"] = "b" * 40
            queue.save()
            self.assertTrue(queue.accept({"sha": "b" * 40, "number": 12}))
            self.assertIsNone(Queue(path).state["pending"])
            self.assertEqual([p.name for p in path.iterdir()], ["state.json"])
            self.assertEqual(path.joinpath("state.json").stat().st_mode & 0o777, 0o600)

    def test_http_rejects_unsigned_and_persists_signed_event_before_accepting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            queue = Queue(path)
            handler = make_handler(queue, SECRET, REPOSITORY, "main")
            sock_path = str(path / "hook.sock")
            with Server(sock_path, handler) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    def post(body, signature, url="/_deploy/github"):
                        connection = http.client.HTTPConnection("localhost")
                        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                        connection.sock.connect(sock_path)
                        connection.request("POST", url, body, {
                            "X-Hub-Signature-256": signature, "X-GitHub-Event": "workflow_run",
                        })
                        response = connection.getresponse()
                        status = response.status
                        response.read()
                        connection.close()
                        return status

                    body = json.dumps(payload()).encode()
                    signature = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
                    self.assertEqual(post(body, ""), 401)
                    self.assertFalse(queue.path.exists())
                    self.assertEqual(post(body, signature, "/wrong"), 404)
                    self.assertEqual(post(body, signature), 202)
                    self.assertEqual(Queue(path).state["pending"]["sha"], SHA)
                    self.assertEqual(post(body, signature), 200)
                    self.assertEqual(post(b"", signature), 413)
                finally:
                    server.shutdown()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
