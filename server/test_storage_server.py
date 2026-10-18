import copy
import gzip
import os
import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import quote
from unittest.mock import patch

from storage_server import StorageServer, configured_users, MAX_FONT_BYTES

TOKEN = "test-token-for-niimblue-storage-123456"
ORIGIN = "https://labels.example.com"
ALICE_TOKEN = "alice-test-token-niimblue-123456789"
BOB_TOKEN = "bob-test-token-niimblue-987654321"
ROTATED_TOKEN = "bob-rotated-token-niimblue-111111"


def label(title="Cable"):
    return {"title": title, "label": {"size": {"width": 240, "height": 96}, "printDirection": "left"}, "canvas": {"version": "7.4.0", "objects": [{"type": "Textbox", "text": "你好"}]}, "csv": {"data": "name\nAda"}}


class StorageAPITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "labels.sqlite3"
        self.default_token = TOKEN
        self.users = {"alice": ALICE_TOKEN, "bob": BOB_TOKEN}
        self.start_server()

    def start_server(self):
        self.server = StorageServer(("127.0.0.1", 0), self.db_path, self.default_token, [ORIGIN], users=self.users)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()

    def tearDown(self):
        self.stop_server()
        self.temp.cleanup()

    def request(self, method, path="/labels", body=None, token=TOKEN, origin=ORIGIN, extra_headers=None):
        client = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        if origin is not None:
            headers["Origin"] = origin
        headers.update(extra_headers or {})
        client.request(method, "/api/v1" + path, body=body if isinstance(body, bytes) else json.dumps(body) if body is not None else None, headers=headers)
        response = client.getresponse()
        payload = response.read()
        result = response.status, (payload if response.getheader("Content-Type") in ("application/gzip", "image/png") else json.loads(payload)) if payload else None, dict(response.getheaders())
        client.close()
        return result

    def create(self, data=None):
        status, saved, _ = self.request("POST", body={"data": data or label()})
        self.assertEqual(status, 201)
        return saved

    def upload_font(self, family="测试字体", token=TOKEN, raw=None, mime="text/ttf"):
        compressed = gzip.compress(raw if raw is not None else b"\x00\x01\x00\x00" + b"font fixture" * 20)
        result = self.request("POST", "/fonts", compressed, token=token, extra_headers={
            "Content-Type": "application/gzip", "X-Font-Family": quote(family), "X-Font-Type": mime,
        })
        return result, compressed

    def test_fonts_use_binary_files_with_small_sqlite_metadata_and_survive_restart(self):
        # Incompressible data exercises a real multi-megabyte request and response.
        raw = b"\x00\x01\x00\x00" + os.urandom(12 * 1024 * 1024)
        (status, saved, _), compressed = self.upload_font(raw=raw)
        self.assertEqual(status, 201)
        self.assertEqual(saved["family"], "测试字体")
        file_path = self.server.font_dir / (saved["id"] + ".gz")
        self.assertEqual(file_path.read_bytes(), compressed)
        with self.server.connect() as db:
            self.assertEqual({row["name"] for row in db.execute("PRAGMA table_info(fonts)")}, {"id", "owner_id", "family", "mime_type"})
            self.assertLess(db.execute("PRAGMA page_count").fetchone()[0] * db.execute("PRAGMA page_size").fetchone()[0], 1024 * 1024)
        self.assertEqual(self.request("GET", "/fonts")[1], [saved])
        self.stop_server()
        self.start_server()
        status, downloaded, headers = self.request("GET", "/fonts/" + saved["id"])
        self.assertEqual((status, downloaded), (200, compressed))
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.request("DELETE", "/fonts/" + saved["id"])[0], 204)
        self.assertFalse(file_path.exists())
        self.assertEqual(self.request("GET", "/fonts")[1], [])
        self.assertEqual(self.request("GET", "/fonts/" + saved["id"])[0], 404)

    def test_font_list_download_and_delete_are_authenticated_and_user_scoped(self):
        (status, alice, _), compressed = self.upload_font(token=ALICE_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(self.upload_font(token=BOB_TOKEN)[0][0], 201)
        self.assertEqual(self.request("GET", "/fonts", token=TOKEN)[1], [])
        self.assertEqual(self.request("GET", "/fonts", token=ALICE_TOKEN)[1], [alice])
        path = "/fonts/" + alice["id"]
        for token in (None, "wrong"):
            for method in ("GET", "DELETE"):
                self.assertEqual(self.request(method, path, token=token)[0], 401)
            self.assertEqual(self.request("GET", "/fonts", token=token)[0], 401)
        for token in (BOB_TOKEN, TOKEN):
            for method in ("GET", "DELETE"):
                self.assertEqual(self.request(method, path, token=token)[0], 404)
        self.assertEqual(self.request("GET", path, token=ALICE_TOKEN)[1], compressed)
        self.assertEqual(self.request("GET", path, token=ALICE_TOKEN, origin="https://untrusted.example")[0], 403)
        self.assertEqual(self.request("OPTIONS", "/fonts", token=None)[2]["Access-Control-Allow-Headers"], "Authorization, Content-Type, X-Font-Family, X-Font-Type")

    def test_font_urls_cannot_download_arbitrary_files_or_follow_symlinks(self):
        secret = Path(self.temp.name) / "secret.txt"
        secret.write_bytes(b"private file never downloadable")
        for path in ("/fonts/../secret.txt", "/fonts/%2e%2e/secret.txt", "/fonts/%2e%2e%2fsecret.txt", "/fonts/..%5csecret.txt", "/fonts//etc/passwd", "/fonts/" + str(secret), "/fonts/" + "-" * 36, "/fonts/00000000-0000-0000-0000-000000000000.gz", "/files/secret.txt"):
            status, payload, _ = self.request("GET", path)
            self.assertEqual(status, 404, path)
            self.assertNotIn("private file", repr(payload))
        (_, saved, _), _ = self.upload_font()
        path = "/fonts/" + saved["id"]
        font_path = self.server.font_dir / (saved["id"] + ".gz")
        font_path.unlink()
        font_path.symlink_to(secret)
        self.assertEqual(self.request("GET", path)[0], 404)
        self.assertEqual(self.request("GET", path + "?file=" + str(secret))[0], 404)
        self.assertEqual(secret.read_bytes(), b"private file never downloadable")

    def test_fonts_reject_invalid_compression_formats_names_and_oversized_data(self):
        for family in ("", " ", "a" * 201, "bad\nname"):
            self.assertEqual(self.upload_font(family=family)[0][0], 400)
        self.assertEqual(self.upload_font(mime="text/html")[0][0], 400)
        self.assertEqual(self.upload_font(raw=b"<html>not a font</html>")[0][0], 400)
        self.assertEqual(self.upload_font(mime="text/woff2")[0][0], 400)
        self.assertEqual(self.upload_font(mime="font/woff2", raw=b"wOF2" + b"x" * 20)[0][0], 201)
        headers = {"Content-Type": "application/gzip", "X-Font-Family": "Bad", "X-Font-Type": "text/ttf"}
        for body in (b"not gzip", gzip.compress(b"\x00\x01\x00\x00" + b"x" * 20)[:-1], gzip.compress(b"\x00\x01\x00\x00" + b"x" * 20) + b"trailing"):
            self.assertEqual(self.request("POST", "/fonts", body, extra_headers=headers)[0], 400)
        with patch("storage_server.MAX_FONT_BYTES", 1024):
            self.assertEqual(self.upload_font(raw=b"\x00\x01\x00\x00" + b"x" * 1025)[0][0], 413)
        client = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        client.request("POST", "/api/v1/fonts", headers={**headers, "Authorization": "Bearer " + TOKEN, "Content-Length": str(MAX_FONT_BYTES + 65537)})
        response = client.getresponse()
        self.assertEqual(response.status, 413)
        response.read()
        client.close()

    def test_simultaneous_same_name_font_uploads_do_not_overwrite_or_leave_files(self):
        statuses = []
        barrier = threading.Barrier(2)
        def upload():
            barrier.wait()
            statuses.append(self.upload_font()[0][0])
        workers = [threading.Thread(target=upload) for _ in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        self.assertEqual(sorted(statuses), [201, 409])
        self.assertEqual(len(list(self.server.font_dir.iterdir())), 1)
        saved = self.request("GET", "/fonts")[1][0]
        self.request("DELETE", "/fonts/" + saved["id"])
        replacement = self.upload_font()[0][1]
        self.assertNotEqual(saved["id"], replacement["id"])
        self.assertEqual(self.request("DELETE", "/fonts/" + saved["id"])[0], 404)
        self.assertEqual(self.request("GET", "/fonts/" + replacement["id"])[0], 200)

    def test_auth_cors_and_health(self):
        self.assertEqual(self.request("GET", token=None)[0], 401)
        self.assertEqual(self.request("GET", token="wrong")[0], 401)
        status, _, headers = self.request("OPTIONS", token=None)
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        status, _, headers = self.request("OPTIONS", origin="https://untrusted.example")
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request("POST", body={"data": label()}, origin="https://untrusted.example")[0], 403)
        status, health, _ = self.request("GET", "/health")
        self.assertEqual((status, health), (200, {"apiVersion": 1, "storage": "sqlite", "userId": "default"}))
        self.assertEqual(self.request("GET", origin=None)[0], 200)

    def test_cross_device_updates_and_deletes_require_current_revision(self):
        saved = self.create()
        path = f"/labels/{saved['id']}"
        status, mobile, _ = self.request("GET", path)
        self.assertEqual(status, 200)
        edited = copy.deepcopy(mobile["data"])
        edited["canvas"]["objects"][0]["text"] = "Changed on phone"
        status, updated, _ = self.request("PUT", path, {"revision": 1, "data": edited})
        self.assertEqual((status, updated["revision"]), (200, 2))
        self.assertEqual(self.request("PUT", path, {"revision": 1, "data": label("Stale computer")})[0], 409)
        self.assertEqual(self.request("DELETE", path, {"revision": 1})[0], 409)
        self.assertEqual(self.request("GET", path)[1]["data"]["canvas"]["objects"][0]["text"], "Changed on phone")
        self.assertEqual(self.request("PUT", path, {"data": label()})[0], 400)
        self.assertEqual(self.request("DELETE", path, {"revision": 2})[0], 204)
        self.assertEqual(self.request("GET", path)[0], 404)
        self.assertEqual(self.request("PUT", path, {"revision": 2, "data": label()})[0], 404)

    def test_simultaneous_saves_only_one_wins(self):
        saved = self.create()
        statuses = []
        barrier = threading.Barrier(2)
        def save(title):
            barrier.wait()
            statuses.append(self.request("PUT", f"/labels/{saved['id']}", {"revision": 1, "data": label(title)})[0])
        workers = [threading.Thread(target=save, args=(title,)) for title in ("Phone", "Desktop")]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        self.assertEqual(sorted(statuses), [200, 409])

    def test_import_is_atomic_and_uses_new_ids(self):
        original = self.create()
        invalid = label()
        invalid["label"]["size"]["width"] = -1
        self.assertEqual(self.request("POST", "/labels/import", {"labels": [label("Valid"), invalid]})[0], 400)
        self.assertEqual(len(self.request("GET")[1]), 1)
        imported = {**original["data"], "id": original["id"]}
        self.assertEqual(self.request("POST", "/labels/import", {"labels": [imported, imported]})[0], 201)
        labels = self.request("GET")[1]
        self.assertEqual(len({item["id"] for item in labels}), 3)
        self.assertEqual(self.request("POST", body={"data": invalid})[0], 400)
        self.assertEqual(self.request("DELETE", f"/labels/{original['id']}", {"revision": True})[0], 400)

    def test_invalid_optional_properties_cannot_corrupt_the_shared_library(self):
        for key, value in [("shape", "unknown"), ("dpmm", 0), ("splitParts", 0), ("tailLength", "bad"), ("offset", {"x": 0, "y": 0})]:
            invalid = label()
            invalid["label"][key] = value
            self.assertEqual(self.request("POST", body={"data": invalid})[0], 400)
        self.assertEqual(self.request("GET")[1], [])

    def test_users_have_isolated_list_read_update_delete_and_import(self):
        status, alice_label, _ = self.request("POST", body={"data": label("Alice's label")}, token=ALICE_TOKEN)
        self.assertEqual(status, 201)
        status, bob_label, _ = self.request("POST", body={"data": {**label("Bob's label"), "owner_id": "alice"}}, token=BOB_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(self.request("GET", token=TOKEN)[1], [])
        self.assertEqual([item["id"] for item in self.request("GET", token=ALICE_TOKEN)[1]], [alice_label["id"]])
        self.assertEqual([item["id"] for item in self.request("GET", token=BOB_TOKEN)[1]], [bob_label["id"]])
        for owner_token, other_label in [(ALICE_TOKEN, bob_label), (BOB_TOKEN, alice_label), (TOKEN, alice_label)]:
            path = f"/labels/{other_label['id']}"
            self.assertEqual(self.request("GET", path, token=owner_token)[0], 404)
            for revision in (1, 999):
                self.assertEqual(self.request("PUT", path, {"revision": revision, "data": label("Hijacked")}, token=owner_token)[0], 404)
                self.assertEqual(self.request("DELETE", path, {"revision": revision}, token=owner_token)[0], 404)
        self.assertEqual(self.request("POST", "/labels/import", {"labels": [{**alice_label["data"], "id": alice_label["id"]}]}, token=BOB_TOKEN)[0], 201)
        self.assertEqual(len(self.request("GET", token=BOB_TOKEN)[1]), 2)
        self.assertEqual(len(self.request("GET", token=ALICE_TOKEN)[1]), 1)
        self.assertEqual(self.request("GET", "/health", token=ALICE_TOKEN)[1]["userId"], "alice")
        self.assertEqual(self.request("GET", "/health", token=BOB_TOKEN)[1]["userId"], "bob")

    def test_rotation_keeps_user_data_and_removing_a_user_revokes_access(self):
        saved = self.request("POST", body={"data": label("Bob's saved work")}, token=BOB_TOKEN)[1]
        self.stop_server()
        self.users = {"bob": ROTATED_TOKEN}
        self.start_server()
        self.assertEqual(self.request("GET", token=BOB_TOKEN)[0], 401)
        self.assertEqual(self.request("GET", token=ALICE_TOKEN)[0], 401)
        self.assertEqual(self.request("GET", f"/labels/{saved['id']}", token=ROTATED_TOKEN)[1], saved)

    def test_users_only_configuration_does_not_require_default_token(self):
        self.stop_server()
        self.default_token = ""
        self.start_server()
        self.assertEqual(self.request("GET", token=TOKEN)[0], 401)
        self.assertEqual(self.request("GET", token=ALICE_TOKEN)[0], 200)

    def test_existing_database_migrates_to_default_user_without_changing_labels(self):
        self.stop_server()
        legacy_id = "01234567-89ab-cdef-0123-456789abcdef"
        with sqlite3.connect(self.db_path) as db:
            db.execute("DROP TABLE labels")
            db.execute("CREATE TABLE labels (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)")
            db.execute("INSERT INTO labels VALUES (?, ?, ?)", (legacy_id, 7, json.dumps(label("Legacy"))))
        self.start_server()
        loaded = self.request("GET", f"/labels/{legacy_id}")[1]
        self.assertEqual((loaded["id"], loaded["revision"], loaded["data"]["title"]), (legacy_id, 7, "Legacy"))
        self.assertEqual(self.request("GET", token=ALICE_TOKEN)[1], [])
        self.assertEqual(self.request("GET", f"/labels/{legacy_id}", token=ALICE_TOKEN)[0], 404)
        self.assertEqual(self.request("PUT", f"/labels/{legacy_id}", {"revision": 7, "data": label("Updated legacy")})[0], 200)
        self.stop_server()
        self.start_server()
        self.assertEqual(self.request("GET", f"/labels/{legacy_id}")[1]["revision"], 8)

    def test_saved_label_keeps_template_properties_without_a_template_library(self):
        document = label("Custom size")
        document["label"].update({"shape": "rounded_rect", "dpmm": 8, "mirror": "flip", "offset": {"x": 2, "y": 3, "offsetType": "inner"}})
        saved = self.create(document)
        loaded = self.request("GET", f"/labels/{saved['id']}")[1]["data"]
        self.assertEqual(loaded["label"], document["label"])
        self.assertEqual(loaded["canvas"], document["canvas"])
        self.assertNotIn("templateId", loaded)

    def test_database_survives_restart_and_preserves_unicode_and_csv(self):
        original = self.create()
        self.stop_server()
        self.start_server()
        loaded = self.request("GET", f"/labels/{original['id']}")[1]
        self.assertEqual(loaded, original)
        self.assertEqual(loaded["data"]["canvas"]["objects"][0]["text"], "你好")
        self.assertEqual(loaded["data"]["csv"]["data"], "name\nAda")


class UserConfigurationTest(unittest.TestCase):
    def test_invalid_or_ambiguous_user_configuration_fails_before_startup(self):
        for token, users in [
            ("", {}), ("", []), ("", {"bad user": ALICE_TOKEN}),
            ("", {"alice": "short"}), ("", {"alice": ALICE_TOKEN, "bob": ALICE_TOKEN}),
            (TOKEN, {"default": ALICE_TOKEN}), (TOKEN, {"alice": TOKEN}),
        ]:
            with self.assertRaises(ValueError):
                configured_users(token, users)
        hashes = configured_users("", {"alice": ALICE_TOKEN})
        self.assertEqual(list(hashes.values()), ["alice"])
        self.assertNotIn(ALICE_TOKEN, repr(hashes))
        self.assertEqual(list(configured_users("", {"default": TOKEN}).values()), ["default"])


if __name__ == "__main__":
    unittest.main()
