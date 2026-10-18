"""Validation for immutable, user-owned PNG border assets (no imaging dependency)."""
import base64
import binascii
import struct
import zlib

MAX_BORDER_BYTES = 10 * 1024 * 1024
MAX_BORDER_PIXELS = 16000000


class BorderError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def validate_png_uri(uri, thumbnail=False):
    limit = 49152 if thumbnail else MAX_BORDER_BYTES
    if not isinstance(uri, str) or len(uri) > (limit + 2) // 3 * 4 + 22:
        raise BorderError(413, "Border image is too large")
    if not uri.startswith("data:image/png;base64,"):
        raise BorderError(400, "Use a PNG image")
    try:
        png = base64.b64decode(uri[22:], validate=True)
    except (ValueError, binascii.Error):
        raise BorderError(400, "Invalid PNG encoding") from None
    if len(png) > limit:
        raise BorderError(413, "Border image is too large")
    if len(png) < 45 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise BorderError(400, "Invalid PNG")
    offset = 8
    width = height = None
    compressed = []
    ended = False
    while offset < len(png):
        if offset + 12 > len(png):
            raise BorderError(400, "Truncated PNG chunk")
        length = struct.unpack_from(">I", png, offset)[0]
        kind = png[offset + 4:offset + 8]
        if offset + 12 + length > len(png):
            raise BorderError(400, "Truncated PNG chunk")
        data = png[offset + 8:offset + 8 + length]
        checksum = struct.unpack_from(">I", png, offset + 8 + length)[0]
        if zlib.crc32(kind + data) & 0xffffffff != checksum:
            raise BorderError(400, "PNG checksum mismatch")
        if offset == 8 and kind != b"IHDR":
            raise BorderError(400, "Missing PNG header")
        if kind == b"IHDR":
            if offset != 8 or length != 13:
                raise BorderError(400, "Invalid PNG header")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", data)
            if not width or not height or width > 8192 or height > 8192 or width * height > MAX_BORDER_PIXELS:
                raise BorderError(413, "Border image exceeds the pixel limit")
            if thumbnail and (width > 128 or height > 64):
                raise BorderError(400, "Thumbnail exceeds 128 by 64 pixels")
            if (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                raise BorderError(400, "Use a non-interlaced RGBA PNG")
        elif kind == b"IDAT":
            compressed.append(data)
        elif kind == b"IEND":
            if length or offset + 12 != len(png):
                raise BorderError(400, "Invalid PNG end")
            ended = True
        elif kind in (b"acTL", b"fcTL", b"fdAT") or not kind[0] & 32 and kind != b"PLTE":
            raise BorderError(400, "Unsupported PNG chunk")
        offset += length + 12
    if not ended or not compressed or width is None:
        raise BorderError(400, "Incomplete PNG")
    row_size = width * 4 + 1
    expected = height * row_size
    try:
        decoder = zlib.decompressobj()
        raw = decoder.decompress(b"".join(compressed), expected + 1)
        if len(raw) != expected or not decoder.eof or decoder.unused_data:
            raise ValueError("Invalid PNG pixels")
        if any(raw[row * row_size] > 4 for row in range(height)):
            raise ValueError("Invalid PNG filter")
    except (ValueError, zlib.error):
        raise BorderError(400, "Invalid PNG pixel data") from None
    return png, width, height


def validate_border_upload(body):
    name = body.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or any(ord(c) < 32 for c in name):
        raise BorderError(400, "Invalid border name")
    png, width, height = validate_png_uri(body.get("image"))
    validate_png_uri(body.get("thumbnail"), thumbnail=True)
    return name.strip(), png, width, height, body["thumbnail"]
