import base64
import os
import struct
import unittest
import zlib
from unittest.mock import patch

import test_storage_server as existing
from test_storage_server import TOKEN, ALICE_TOKEN, BOB_TOKEN, label


def png(width=16, height=8, raw=None):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    if raw is None:
        raw = (b"\0" + b"\xff\x20\x40\x80" * width) * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def uri(data):
    return "data:image/png;base64," + base64.b64encode(data).decode()


class BorderAPITest(unittest.TestCase):
    setUp = existing.StorageAPITest.setUp
    tearDown = existing.StorageAPITest.tearDown
    start_server = existing.StorageAPITest.start_server
    stop_server = existing.StorageAPITest.stop_server
    request = existing.StorageAPITest.request

    def upload(self, name="我的边框", token=TOKEN, image=None):
        return self.request("POST", "/borders", {"name": name, "image": uri(image or png()), "thumbnail": uri(png())}, token=token)

    def test_borders_persist_as_binary_files_with_metadata_and_survive_restart(self):
        pixels = b"".join(b"\0" + os.urandom(512 * 4) for _ in range(512))
        image = png(512, 512, pixels)
        status, summary, _ = self.upload(image=image)
        self.assertEqual(status, 201)
        self.assertEqual((summary["width"], summary["height"], summary["name"]), (512, 512, "我的边框"))
        path = self.server.border_dir / (summary["id"] + ".png")
        self.assertEqual(path.read_bytes(), image)
        with self.server.connect() as db:
            self.assertEqual({row["name"] for row in db.execute("PRAGMA table_info(borders)")}, {"id", "owner_id", "name", "width", "height", "thumbnail"})
        self.assertEqual(self.request("GET", "/borders")[1], [summary])
        self.stop_server()
        self.start_server()
        status, downloaded, headers = self.request("GET", "/borders/" + summary["id"])
        self.assertEqual((status, downloaded), (200, image))
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.request("DELETE", "/borders/" + summary["id"])[0], 204)
        self.assertFalse(path.exists())
        self.assertEqual(self.request("GET", "/borders")[1], [])
        self.assertEqual(self.request("GET", "/borders/" + summary["id"])[0], 404)

    def test_border_libraries_are_authenticated_and_isolated_by_user(self):
        status, alice, _ = self.upload(token=ALICE_TOKEN)
        self.assertEqual(status, 201)
        self.assertEqual(self.request("GET", "/borders", token=BOB_TOKEN)[1], [])
        self.assertEqual(self.upload(token=BOB_TOKEN)[0], 201)
        for method in ("GET", "DELETE"):
            self.assertEqual(self.request(method, "/borders/" + alice["id"], token=BOB_TOKEN)[0], 404)
        self.assertEqual(self.request("GET", "/borders", token=None)[0], 401)
        self.assertEqual(self.upload(token="wrong")[0], 401)
        self.assertEqual(self.request("GET", "/borders", token=ALICE_TOKEN)[1], [alice])

    def test_duplicate_names_do_not_overwrite_files_or_create_orphans(self):
        status, original, _ = self.upload()
        self.assertEqual(status, 201)
        self.assertEqual(self.upload()[0], 409)
        self.assertEqual(self.request("GET", "/borders")[1], [original])
        self.assertEqual(len(list(self.server.border_dir.iterdir())), 1)

    def test_border_validation_rejects_corrupt_images_and_excessive_dimensions(self):
        valid = {"name": "Frame", "image": uri(png()), "thumbnail": uri(png())}
        cases = [
            {"name": " "}, {"name": "bad\nname"}, {"name": "x" * 101},
            {"image": "data:image/svg+xml;base64,PHN2Zy8+"}, {"image": "data:image/png;base64,%%%"},
            {"image": uri(png()[:-1])}, {"image": uri(png() + b"extra")},
            {"image": uri(png()[:30] + b"wrong")},
            {"image": uri(png(8193, 1, b""))}, {"image": uri(png(4001, 4000, b""))},
            {"image": uri(png(1, 1, b"x" * 1000000))},
            {"thumbnail": uri(png(129, 1))}, {"thumbnail": "https://example.com/frame.png"},
        ]
        for invalid in cases:
            with self.subTest(invalid=list(invalid)):
                self.assertIn(self.request("POST", "/borders", {**valid, **invalid})[0], (400, 413))
        self.assertEqual(self.request("GET", "/borders")[1], [])
        self.assertEqual(list(self.server.border_dir.iterdir()), [])

    def test_failed_file_write_rolls_back_database_and_removes_partial_file(self):
        with patch("storage_server.os.fsync", side_effect=OSError("Disk full")):
            self.assertEqual(self.upload()[0], 500)
        self.assertEqual(self.request("GET", "/borders")[1], [])
        self.assertEqual(list(self.server.border_dir.iterdir()), [])

    def test_download_cannot_follow_symlinks_or_read_other_files(self):
        _, saved, _ = self.upload()
        path = self.server.border_dir / (saved["id"] + ".png")
        path.unlink()
        other = self.db_path.parent / "private.txt"
        other.write_bytes(b"private")
        path.symlink_to(other)
        self.assertEqual(self.request("GET", "/borders/" + saved["id"])[0], 404)
        self.assertEqual(self.request("DELETE", "/borders/" + saved["id"])[0], 204)
        self.assertEqual(other.read_bytes(), b"private")
        self.assertEqual(self.request("GET", "/borders/../../private.txt")[0], 404)

    def test_saved_label_copy_survives_deleting_its_library_border(self):
        _, saved, _ = self.upload()
        document = label("Frame label")
        document["canvas"]["objects"] = [{"type": "LabelBorder", "borderId": "user.border.example", "borderPackage": {"files": {"assets/frame.png": uri(png())}}}]
        status, stored, _ = self.request("POST", "/labels", {"data": document})
        self.assertEqual(status, 201)
        self.assertEqual(self.request("DELETE", "/borders/" + saved["id"])[0], 204)
        self.assertEqual(self.request("GET", "/labels/" + stored["id"])[1]["data"]["canvas"], document["canvas"])


if __name__ == "__main__":
    unittest.main()
