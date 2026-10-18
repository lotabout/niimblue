"""NiimBlue shared label library. Python 3.11+, no third-party dependencies."""
from contextlib import contextmanager
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import stat
import time
import uuid
import zlib
from border_storage import BorderError, MAX_BORDER_BYTES, validate_border_upload
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

MAX_BODY = 20 * 1024 * 1024
LABEL_PATH = re.compile(r"^/api/v1/labels/([a-f0-9-]{36})$")
FONT_PATH = re.compile(r"^/api/v1/fonts/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$")
BORDER_PATH = re.compile(r"^/api/v1/borders/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$")
MAX_FONT_BYTES = 32 * 1024 * 1024
USER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


def configured_users(token="", users=None):
    """Stable user IDs own the data; rotating their token does not move labels."""
    if users is None:
        users = {}
    if not isinstance(users, dict):
        raise ValueError("NIIMBLUE_STORAGE_USERS must be a JSON object mapping user IDs to tokens")
    result = dict(users)
    if token:
        if "default" in result:
            raise ValueError("Configure default in either NIIMBLUE_STORAGE_TOKEN or NIIMBLUE_STORAGE_USERS, not both")
        result["default"] = token
    if not result:
        raise ValueError("Set NIIMBLUE_STORAGE_TOKEN or NIIMBLUE_STORAGE_USERS")
    token_hashes = {}
    for user_id, value in result.items():
        if not isinstance(user_id, str) or not USER_ID.fullmatch(user_id):
            raise ValueError("User IDs must be 1–64 ASCII letters, digits, dots, underscores or hyphens, starting with a letter or digit")
        if not isinstance(value, str) or len(value) < 24 or not value.isascii() or any(c.isspace() for c in value):
            raise ValueError(f"Token for user {user_id} must contain at least 24 non-whitespace ASCII characters")
        digest = hashlib.sha256(value.encode()).digest()
        if digest in token_hashes:
            raise ValueError("Each user must have a distinct token")
        token_hashes[digest] = user_id
    return token_hashes


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def validate_label(data):
    if not isinstance(data, dict):
        raise APIError(400, "Invalid label")
    props, canvas = data.get("label"), data.get("canvas")
    if not isinstance(props, dict) or not isinstance(canvas, dict):
        raise APIError(400, "Label and canvas are required")
    size = props.get("size")
    if not isinstance(size, dict) or props.get("printDirection") not in ("left", "top"):
        raise APIError(400, "Invalid label properties")
    for axis in ("width", "height"):
        value = size.get(axis)
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise APIError(400, "Invalid label size")
    for key, allowed in {
        "shape": ("rect", "rounded_rect", "circle"),
        "split": ("none", "vertical", "horizontal"),
        "tailPos": ("right", "bottom", "left", "top"),
        "mirror": ("none", "copy", "flip"),
    }.items():
        if key in props and props[key] not in allowed:
            raise APIError(400, f"Invalid {key}")
    for key in ("dpmm", "splitParts", "tailLength"):
        if key not in props:
            continue
        value = props[key]
        if type(value) not in (int, float) or not math.isfinite(value):
            raise APIError(400, f"Invalid {key}")
        if (key == "dpmm" and value <= 0) or (key == "splitParts" and value < 1):
            raise APIError(400, f"Invalid {key}")
    if "offset" in props:
        offset = props["offset"]
        if not isinstance(offset, dict) or offset.get("offsetType") not in ("inner", "outer"):
            raise APIError(400, "Invalid offset")
        for axis in ("x", "y"):
            value = offset.get(axis)
            if type(value) not in (int, float) or not math.isfinite(value):
                raise APIError(400, "Invalid offset")
    if not isinstance(canvas.get("version"), str) or not isinstance(canvas.get("objects"), list):
        raise APIError(400, "Invalid canvas")
    if any(not isinstance(obj, dict) for obj in canvas["objects"]):
        raise APIError(400, "Invalid canvas object")
    for key in ("title", "thumbnailBase64"):
        if key in data and not isinstance(data[key], str):
            raise APIError(400, f"Invalid {key}")
    if "csv" in data and (not isinstance(data["csv"], dict) or not isinstance(data["csv"].get("data"), str)):
        raise APIError(400, "Invalid CSV")
    if "timestamp" in data and (type(data["timestamp"]) not in (int, float) or not math.isfinite(data["timestamp"]) or data["timestamp"] <= 0):
        raise APIError(400, "Invalid timestamp")
    result = {key: data[key] for key in ("label", "canvas", "title", "thumbnailBase64", "csv") if key in data}
    result["timestamp"] = int(time.time())
    return result


def valid_revision(body):
    revision = body.get("revision")
    if type(revision) is not int or revision < 1:
        raise APIError(400, "A positive revision is required")
    return revision


def validate_font(family, mime, compressed):
    if not family.strip() or len(family) > 200 or any(ord(c) < 32 for c in family):
        raise APIError(400, "Invalid font family")
    if mime not in ("text/ttf", "text/woff2", "font/ttf", "font/woff2"):
        raise APIError(400, "Use a gzip-compressed TTF or WOFF2 font")
    try:
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = decoder.decompress(compressed, MAX_FONT_BYTES + 1)
        if len(raw) > MAX_FONT_BYTES:
            raise APIError(413, "Font exceeds 32 MiB after decompression")
        if not decoder.eof or decoder.unused_data:
            raise ValueError("Incomplete gzip or trailing data")
    except (ValueError, zlib.error):
        raise APIError(400, "Invalid compressed font") from None
    expected = b"wOF2" if mime.endswith("woff2") else b"\x00\x01\x00\x00"
    if len(raw) < 12 or raw[:4] != expected:
        raise APIError(400, "Font format does not match its MIME type")
    return family.strip()


class StorageServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, db_path, token, origins, users=None):
        self.token_hashes = configured_users(token, users)
        self.db_path = str(db_path)
        self.origins = set(origins)
        self.font_dir = Path(self.db_path).parent / "fonts"
        self.font_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.font_dir = self.font_dir.resolve()
        self.border_dir = Path(self.db_path).parent / "borders"
        self.border_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.border_dir = self.border_dir.resolve()
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT 'default')")
            # Upgrade the original single-library database without changing IDs or revisions.
            columns = {row["name"] for row in db.execute("PRAGMA table_info(labels)")}
            if "owner_id" not in columns:
                db.execute("ALTER TABLE labels ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'default'")
            db.execute("CREATE INDEX IF NOT EXISTS labels_owner ON labels(owner_id)")
            db.execute("CREATE TABLE IF NOT EXISTS fonts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, family TEXT NOT NULL, mime_type TEXT NOT NULL, UNIQUE(owner_id, family))")
            db.execute("CREATE TABLE IF NOT EXISTS borders (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, thumbnail TEXT NOT NULL, UNIQUE(owner_id, name))")
        super().__init__(address, Handler)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "NiimBlueStorage/1"

    def log_message(self, fmt, *args):
        # Never log headers, request bodies, access tokens, or label content.
        if args:
            print(f"{self.address_string()} {self.command} {urlsplit(self.path).path} {args[1] if len(args) > 1 else ''}", flush=True)

    def send_json(self, status, payload=None):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_bytes(status, data, "application/json; charset=utf-8")

    def send_bytes(self, status, data, content_type):
        self.send_headers(status, len(data), content_type)
        if data:
            self.wfile.write(data)

    def send_headers(self, status, length, content_type):
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Font-Family, X-Font-Type")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.end_headers()

    def send_font(self, font_id):
        # font_id is matched against FONT_PATH and its ownership was checked in
        # SQLite before reaching this function. No URL-supplied filesystem paths.
        path = self.server.font_dir / (font_id + ".gz")
        if path.is_symlink():
            raise APIError(404, "Font file is unavailable")
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        except OSError:
            raise APIError(404, "Font file is unavailable") from None
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FONT_BYTES + 65536:
                raise APIError(404, "Font file is unavailable")
            self.send_headers(200, info.st_size, "application/gzip")
            shutil.copyfileobj(source, self.wfile, length=65536)

    def read_body(self, max_length):
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "Use Content-Length")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise APIError(400, "Invalid content length") from None
        if not 0 < length <= max_length:
            raise APIError(413, "Request body is empty or too large")
        body = self.rfile.read(length)
        if len(body) != length:
            raise APIError(400, "Incomplete body")
        return body

    def send_border(self, border_id):
        path = self.server.border_dir / (border_id + ".png")
        if path.is_symlink():
            raise APIError(404, "Border image is unavailable")
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        except OSError:
            raise APIError(404, "Border image is unavailable") from None
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BORDER_BYTES:
                raise APIError(404, "Border image is unavailable")
            self.send_headers(200, info.st_size, "image/png")
            shutil.copyfileobj(source, self.wfile, length=65536)

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise APIError(415, "Use application/json")
        raw = self.read_body(MAX_BODY)
        try:
            def invalid_constant(value):
                raise ValueError(value)
            def finite_float(value):
                number = float(value)
                if not math.isfinite(number):
                    raise ValueError(value)
                return number
            body = json.loads(raw, parse_constant=invalid_constant, parse_float=finite_float)
        except (ValueError, UnicodeError):
            raise APIError(400, "Invalid JSON") from None
        if not isinstance(body, dict):
            raise APIError(400, "Expected a JSON object")
        return body

    @staticmethod
    def decode(row):
        return {"id": row["id"], "revision": row["revision"], "data": json.loads(row["data"])}

    def handle_api(self):
        self.connection.settimeout(30)
        try:
            origin = self.headers.get("Origin")
            if origin is not None and origin not in self.server.origins:
                raise APIError(403, "Origin is not allowed")
            if self.command == "OPTIONS":
                self.send_json(204)
                return
            authorization = self.headers.get("Authorization", "")
            token = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
            user_id = self.server.token_hashes.get(hashlib.sha256(token.encode()).digest()) if token else None
            if user_id is None:
                raise APIError(401, "Invalid access token")
            path = urlsplit(self.path).path
            if path == "/api/v1/health" and self.command == "GET":
                with self.server.connect() as db:
                    db.execute("SELECT 1 FROM labels LIMIT 1")
                self.send_json(200, {"apiVersion": 1, "storage": "sqlite", "userId": user_id})
                return
            with self.server.connect() as db:
                if path == "/api/v1/borders":
                    if self.command == "GET":
                        self.send_json(200, [dict(row) for row in db.execute("SELECT id, name, width, height, thumbnail FROM borders WHERE owner_id = ? ORDER BY name", (user_id,))])
                        return
                    if self.command == "POST":
                        name, png, width, height, thumbnail = validate_border_upload(self.read_json())
                        border_id = str(uuid.uuid4())
                        border_path = self.server.border_dir / (border_id + ".png")
                        created_file = False
                        try:
                            db.execute("INSERT INTO borders (id, owner_id, name, width, height, thumbnail) VALUES (?, ?, ?, ?, ?, ?)", (border_id, user_id, name, width, height, thumbnail))
                            fd = os.open(border_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                            created_file = True
                            with os.fdopen(fd, "wb") as output:
                                output.write(png)
                                output.flush()
                                os.fsync(output.fileno())
                            db.commit()
                        except sqlite3.IntegrityError:
                            if created_file:
                                border_path.unlink(missing_ok=True)
                            raise APIError(409, "A border with this name already exists") from None
                        except (sqlite3.Error, OSError):
                            if created_file:
                                border_path.unlink(missing_ok=True)
                            raise
                        self.send_json(201, {"id": border_id, "name": name, "width": width, "height": height, "thumbnail": thumbnail})
                        return
                border_match = BORDER_PATH.fullmatch(path)
                if border_match:
                    border_id = border_match[1]
                    if self.command == "GET":
                        if db.execute("SELECT 1 FROM borders WHERE id = ? AND owner_id = ?", (border_id, user_id)).fetchone() is None:
                            raise APIError(404, "Border no longer exists")
                        self.send_border(border_id)
                        return
                    if self.command == "DELETE":
                        if not db.execute("DELETE FROM borders WHERE id = ? AND owner_id = ?", (border_id, user_id)).rowcount:
                            raise APIError(404, "Border no longer exists")
                        db.commit()
                        (self.server.border_dir / (border_id + ".png")).unlink(missing_ok=True)
                        self.send_json(204)
                        return
                if path == "/api/v1/fonts":
                    if self.command == "GET":
                        # Poll metadata only; font bytes are downloaded once per immutable ID.
                        self.send_json(200, [{"id": row["id"], "family": row["family"], "mimeType": row["mime_type"]} for row in db.execute("SELECT id, family, mime_type FROM fonts WHERE owner_id = ? ORDER BY family", (user_id,))])
                        return
                    if self.command == "POST":
                        if self.headers.get_content_type() != "application/gzip":
                            raise APIError(415, "Use application/gzip")
                        compressed = self.read_body(MAX_FONT_BYTES + 65536)
                        family = unquote(self.headers.get("X-Font-Family", ""), errors="strict")
                        mime = self.headers.get("X-Font-Type", "")
                        family = validate_font(family, mime, compressed)
                        font_id = str(uuid.uuid4())
                        font_path = self.server.font_dir / (font_id + ".gz")
                        created_file = False
                        try:
                            # Insert first to arbitrate concurrent same-name uploads. The
                            # row is invisible until the complete file has been fsynced.
                            db.execute("INSERT INTO fonts (id, owner_id, family, mime_type) VALUES (?, ?, ?, ?)", (font_id, user_id, family, mime))
                            fd = os.open(font_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                            created_file = True
                            with os.fdopen(fd, "wb") as output:
                                output.write(compressed)
                                output.flush()
                                os.fsync(output.fileno())
                            db.commit()
                        except sqlite3.IntegrityError:
                            if created_file:
                                font_path.unlink(missing_ok=True)
                            raise APIError(409, "A font with this family already exists") from None
                        except (sqlite3.Error, OSError):
                            if created_file:
                                font_path.unlink(missing_ok=True)
                            raise
                        self.send_json(201, {"id": font_id, "family": family, "mimeType": mime})
                        return
                font_match = FONT_PATH.fullmatch(path)
                if font_match:
                    font_id = font_match[1]
                    if self.command == "GET":
                        row = db.execute("SELECT id FROM fonts WHERE id = ? AND owner_id = ?", (font_id, user_id)).fetchone()
                        if row is None:
                            raise APIError(404, "Font no longer exists")
                        self.send_font(font_id)
                        return
                    if self.command == "DELETE":
                        if not db.execute("DELETE FROM fonts WHERE id = ? AND owner_id = ?", (font_id, user_id)).rowcount:
                            raise APIError(404, "Font no longer exists")
                        db.commit()
                        (self.server.font_dir / (font_id + ".gz")).unlink(missing_ok=True)
                        self.send_json(204)
                        return
                if path == "/api/v1/labels":
                    if self.command == "GET":
                        self.send_json(200, [self.decode(row) for row in db.execute("SELECT * FROM labels WHERE owner_id = ? ORDER BY rowid DESC", (user_id,))])
                        return
                    if self.command == "POST":
                        data = validate_label(self.read_json().get("data"))
                        label_id = str(uuid.uuid4())
                        db.execute("INSERT INTO labels (id, revision, data, owner_id) VALUES (?, 1, ?, ?)", (label_id, json.dumps(data, allow_nan=False), user_id))
                        db.commit()
                        self.send_json(201, {"id": label_id, "revision": 1, "data": data})
                        return
                if path == "/api/v1/labels/import" and self.command == "POST":
                    labels = self.read_json().get("labels")
                    if not isinstance(labels, list) or not 1 <= len(labels) <= 1000:
                        raise APIError(400, "Import requires 1 to 1000 labels")
                    # Validate the entire batch before writing; the transaction is atomic.
                    validated = [validate_label(label) for label in labels]
                    for label in validated:
                        db.execute("INSERT INTO labels (id, revision, data, owner_id) VALUES (?, 1, ?, ?)", (str(uuid.uuid4()), json.dumps(label, allow_nan=False), user_id))
                    db.commit()
                    self.send_json(201, {"imported": len(validated)})
                    return
                match = LABEL_PATH.fullmatch(path)
                if match:
                    label_id = match[1]
                    if self.command == "GET":
                        row = db.execute("SELECT * FROM labels WHERE id = ? AND owner_id = ?", (label_id, user_id)).fetchone()
                        if row is None:
                            raise APIError(404, "Label no longer exists")
                        self.send_json(200, self.decode(row))
                        return
                    if self.command in ("PUT", "DELETE"):
                        body = self.read_json()
                        revision = valid_revision(body)
                        if self.command == "PUT":
                            data = validate_label(body.get("data"))
                            changed = db.execute("UPDATE labels SET data = ?, revision = revision + 1 WHERE id = ? AND owner_id = ? AND revision = ?", (json.dumps(data, allow_nan=False), label_id, user_id, revision)).rowcount
                        else:
                            changed = db.execute("DELETE FROM labels WHERE id = ? AND owner_id = ? AND revision = ?", (label_id, user_id, revision)).rowcount
                        if not changed:
                            exists = db.execute("SELECT 1 FROM labels WHERE id = ? AND owner_id = ?", (label_id, user_id)).fetchone()
                            raise APIError(409 if exists else 404, "Label changed on another device" if exists else "Label no longer exists")
                        db.commit()
                        if self.command == "PUT":
                            self.send_json(200, {"id": label_id, "revision": revision + 1, "data": data})
                        else:
                            self.send_json(204)
                        return
                raise APIError(404, "Unknown endpoint")
        except (APIError, BorderError) as error:
            self.send_json(error.status, {"error": error.message})
        except (sqlite3.Error, OSError, ValueError, RecursionError):
            self.send_json(500, {"error": "Storage request failed"})

    do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = handle_api


def main():
    origins = [origin.strip() for origin in os.environ.get("NIIMBLUE_STORAGE_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",") if origin.strip()]
    server = StorageServer(
        (os.environ.get("NIIMBLUE_STORAGE_HOST", "127.0.0.1"), int(os.environ.get("NIIMBLUE_STORAGE_PORT", "8787"))),
        os.environ.get("NIIMBLUE_STORAGE_DB", "server/data/labels.sqlite3"),
        os.environ.get("NIIMBLUE_STORAGE_TOKEN", ""), origins,
        users=json.loads(os.environ.get("NIIMBLUE_STORAGE_USERS") or "{}"),
    )
    print(f"NiimBlue storage listening on {server.server_address[0]}:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
