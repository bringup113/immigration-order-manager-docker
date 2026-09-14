#!/usr/bin/env python3
"""Small, bounded MRZScanner sidecar for isolated resource testing.

The service deliberately accepts one image per request, spools it to a
temporary file, and runs exactly one two-stage inference worker. It does not
write a document archive and never logs MRZ text.
"""

from __future__ import annotations

import json
import os
import queue
import resource
import tempfile
import threading
import time
from collections import deque
from concurrent.futures import Future, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


HOST = os.environ.get("MRZ_HOST", "0.0.0.0")
PORT = int(os.environ.get("MRZ_PORT", "8080"))
MAX_FILE_BYTES = int(os.environ.get("MRZ_MAX_FILE_BYTES", str(20 * 1024 * 1024)))
MAX_WAITING = int(os.environ.get("MRZ_QUEUE_SIZE", "3"))
MAX_QUEUE_BYTES = int(os.environ.get("MRZ_MAX_QUEUE_BYTES", str(100 * 1024 * 1024)))
SCAN_TIMEOUT = float(os.environ.get("MRZ_SCAN_TIMEOUT_SECONDS", "60"))
# Match MRZScanner's documented defaults.  The caller supplies the complete
# passport page; center cropping can remove the MRZ on tall phone photos.
CENTER_CROP = os.environ.get("MRZ_CENTER_CROP", "0") not in {"0", "false", "no"}
POSTPROCESS = os.environ.get("MRZ_POSTPROCESS", "0") not in {"0", "false", "no"}
TEMP_ROOT = Path(os.environ.get("MRZ_TMP_DIR", "/tmp/mrz-sidecar"))
TEMP_ROOT.mkdir(parents=True, exist_ok=True)


def peak_rss_mb() -> float | None:
    try:
        value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        # Linux reports KiB; macOS reports bytes. The sidecar image is Linux,
        # but the fallback keeps this endpoint useful during local testing.
        if value > 10_000_000:
            return round(value / (1024 * 1024), 2)
        return round(value / 1024, 2)
    except (AttributeError, OSError):
        return None


class Metrics:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.accepted = 0
        self.completed = 0
        self.succeeded = 0
        self.failed = 0
        self.rejected = 0
        self.timed_out = 0
        self.processing_ms: list[float] = []
        self.queue_wait_ms: list[float] = []

    def record(self, *, ok: bool, processing_ms: float, queue_wait_ms: float) -> None:
        with self.lock:
            self.completed += 1
            self.succeeded += int(ok)
            self.failed += int(not ok)
            self.processing_ms.append(processing_ms)
            self.queue_wait_ms.append(queue_wait_ms)
            self.processing_ms = self.processing_ms[-100:]
            self.queue_wait_ms = self.queue_wait_ms[-100:]

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "accepted": self.accepted,
                "completed": self.completed,
                "succeeded": self.succeeded,
                "failed": self.failed,
                "rejected": self.rejected,
                "timed_out": self.timed_out,
                "processing_ms": self.processing_ms[-20:],
                "queue_wait_ms": self.queue_wait_ms[-20:],
            }


METRICS = Metrics()


@dataclass
class Job:
    path: Path
    content_type: str
    filename: str
    size: int
    submitted_at: float
    future: Future
    include_raw: bool = False


class BoundedJobQueue:
    def __init__(self, max_waiting: int, max_bytes: int) -> None:
        self.max_waiting = max(0, max_waiting)
        self.max_bytes = max(1, max_bytes)
        self.items: deque[Job] = deque()
        self.waiting_bytes = 0
        self.active = False
        self.condition = threading.Condition()

    def put(self, job: Job) -> bool:
        with self.condition:
            if len(self.items) >= self.max_waiting or self.waiting_bytes + job.size > self.max_bytes:
                return False
            self.items.append(job)
            self.waiting_bytes += job.size
            self.condition.notify()
            return True

    def get(self) -> Job:
        with self.condition:
            while not self.items:
                self.condition.wait()
            job = self.items.popleft()
            self.waiting_bytes -= job.size
            self.active = True
            return job

    def done(self) -> None:
        with self.condition:
            self.active = False

    def snapshot(self) -> dict[str, Any]:
        with self.condition:
            return {
                "waiting": len(self.items),
                "waiting_bytes": self.waiting_bytes,
                "active": self.active,
                "max_waiting": self.max_waiting,
                "max_bytes": self.max_bytes,
            }


JOBS = BoundedJobQueue(MAX_WAITING, MAX_QUEUE_BYTES)
READY = threading.Event()
STARTUP_ERROR: str | None = None
SCANNER: Any = None


def load_scanner() -> None:
    global SCANNER, STARTUP_ERROR
    try:
        from capybara import Backend
        from mrzscanner import MRZScanner, ModelType

        SCANNER = MRZScanner(backend=Backend.cpu, model_type=ModelType.two_stage)
        READY.set()
    except Exception as error:  # pragma: no cover - exercised in the container
        STARTUP_ERROR = f"{type(error).__name__}: {error}"
        print(f"MRZ sidecar startup failed: {STARTUP_ERROR}", flush=True)


def read_image(path: Path) -> Any:
    import cv2

    # OpenCV is already part of the Capybara/MRZScanner runtime.  Reading
    # directly as BGR avoids an unnecessary scikit-image dependency and keeps
    # the image in the format expected by MRZScanner.
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("无法读取图像文件")
    return image


def scan_job(job: Job) -> None:
    queue_wait_ms = (time.perf_counter() - job.submitted_at) * 1000
    started = time.perf_counter()
    try:
        image = read_image(job.path)
        result = SCANNER(image, do_center_crop=CENTER_CROP, do_postprocess=POSTPROCESS)
        texts = result.get("mrz_texts") if isinstance(result, dict) else None
        polygon = result.get("mrz_polygon") if isinstance(result, dict) else None
        lines = [str(value) for value in texts] if isinstance(texts, (list, tuple)) else []
        message_value = result.get("msg") if isinstance(result, dict) else None
        message_text = getattr(message_value, "value", None) or (str(message_value) if message_value is not None else None)
        processing_ms = (time.perf_counter() - started) * 1000
        ok = bool(lines) and (message_text is None or message_text.lower() in {"no error", "no error."})
        payload: dict[str, Any] = {
            "ok": ok,
            "mrz_detected": bool(polygon is not None or lines),
            "line_lengths": [len(line) for line in lines],
            "message": message_text,
            "queue_wait_ms": round(queue_wait_ms, 2),
            "processing_ms": round(processing_ms, 2),
        }
        if job.include_raw:
            payload["mrz_lines"] = lines
        if isinstance(result, dict) and polygon is not None:
            payload["mrz_polygon"] = polygon.tolist() if hasattr(polygon, "tolist") else polygon
        METRICS.record(ok=ok, processing_ms=processing_ms, queue_wait_ms=queue_wait_ms)
        job.future.set_result(payload)
    except Exception as error:  # pragma: no cover - model/runtime dependent
        processing_ms = (time.perf_counter() - started) * 1000
        METRICS.record(ok=False, processing_ms=processing_ms, queue_wait_ms=queue_wait_ms)
        job.future.set_result({
            "ok": False,
            "mrz_detected": False,
            "error": f"{type(error).__name__}: {error}",
            "queue_wait_ms": round(queue_wait_ms, 2),
            "processing_ms": round(processing_ms, 2),
        })
    finally:
        try:
            job.path.unlink(missing_ok=True)
        finally:
            JOBS.done()


def worker() -> None:
    load_scanner()
    while True:
        job = JOBS.get()
        if not READY.is_set():
            job.future.set_result({"ok": False, "error": STARTUP_ERROR or "MRZScanner 尚未就绪。"})
            try:
                job.path.unlink(missing_ok=True)
            finally:
                JOBS.done()
            continue
        scan_job(job)


def json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "MIGRA-MRZSidecar/0.1"

    def log_message(self, _format: str, *_args: Any) -> None:
        # Never log request bodies, filenames, MRZ text, or query strings.
        return

    def respond(self, status: int, payload: dict[str, Any]) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            self.respond(200 if READY.is_set() else 503, {
                "ready": READY.is_set(),
                "service": "mrzscanner",
                "mode": "two_stage/cpu",
                "startup_error": STARTUP_ERROR,
            })
            return
        if path == "/metrics":
            self.respond(200, {
                "ready": READY.is_set(),
                "queue": JOBS.snapshot(),
                "metrics": METRICS.snapshot(),
                "peak_rss_mb": peak_rss_mb(),
            })
            return
        self.respond(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/scan":
            self.respond(404, {"error": "Not found"})
            return
        if not READY.is_set():
            self.respond(503, {"error": STARTUP_ERROR or "MRZScanner 尚未就绪。"})
            return
        content_length = self.headers.get("Content-Length")
        try:
            size = int(content_length or "-1")
        except ValueError:
            size = -1
        if size <= 0:
            self.respond(411, {"error": "需要 Content-Length。"})
            return
        if size > MAX_FILE_BYTES:
            self.respond(413, {"error": f"文件不能超过 {MAX_FILE_BYTES // (1024 * 1024)} MB。"})
            return
        content_type = (self.headers.get("Content-Type") or "application/octet-stream").split(";", 1)[0].lower()
        if content_type == "application/pdf" or self.headers.get("X-Filename", "").lower().endswith(".pdf"):
            self.respond(415, {"error": "sidecar PoC 接收图片；PDF 请先由现有 PDF 流程渲染为图片。"})
            return

        suffix = ".jpg" if content_type in {"image/jpeg", "image/jpg"} else ".png"
        fd, raw_path = tempfile.mkstemp(prefix="mrz-", suffix=suffix, dir=TEMP_ROOT)
        path = Path(raw_path)
        enqueued = False
        try:
            with os.fdopen(fd, "wb") as output:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("上传内容长度不足。")
                    output.write(chunk)
                    remaining -= len(chunk)
            future: Future = Future()
            job = Job(
                path=path,
                content_type=content_type,
                filename=os.path.basename(self.headers.get("X-Filename", "upload")),
                size=size,
                submitted_at=time.perf_counter(),
                future=future,
                include_raw=parse_qs(urlparse(self.path).query).get("include_raw") == ["1"],
            )
            if not JOBS.put(job):
                METRICS.rejected += 1
                self.respond(429, {"error": "识别队列已满，请稍后重试。", "queue": JOBS.snapshot()})
                return
            enqueued = True
            METRICS.accepted += 1
            try:
                result = future.result(timeout=SCAN_TIMEOUT)
            except FutureTimeoutError:
                METRICS.timed_out += 1
                self.respond(504, {"error": "识别超时，请稍后重试。"})
                return
            self.respond(200, result)
        except Exception as error:
            self.respond(400, {"error": f"上传失败：{error}"})
        finally:
            # Once queued, ownership moves to the worker. This also prevents
            # an HTTP timeout from deleting a file while inference is reading it.
            if not enqueued:
                path.unlink(missing_ok=True)


def main() -> None:
    threading.Thread(target=worker, name="mrz-worker", daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"MRZ sidecar listening on {HOST}:{PORT}; queue={MAX_WAITING}; mode=two_stage/cpu", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
