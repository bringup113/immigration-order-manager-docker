# Docsaid 1.0.7's compatible Capybara releases publish the Linux ONNX
# Runtime dependency for amd64, not arm64. Compose sets this platform too;
# keeping it here makes standalone builds deterministic on Apple Silicon.
FROM --platform=linux/amd64 python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgl1 libglib2.0-0 libgomp1 libturbojpeg0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Capybara lazily downloads this font when the scanner is initialized.  Bake it
# into the image so the non-root runtime never needs to write site-packages or
# depend on outbound network access after startup.
RUN python - <<'PY'
from pathlib import Path
from urllib.request import Request, urlopen
import capybara

font_path = Path(capybara.__file__).parent / "vision" / "visualization" / "NotoSansMonoCJKtc-VF.ttf"
font_path.parent.mkdir(parents=True, exist_ok=True)
if not font_path.exists():
    request = Request(
        "https://github.com/googlefonts/noto-cjk/raw/main/Sans/Variable/TTF/Mono/NotoSansMonoCJKtc-VF.ttf",
        headers={"User-Agent": "MIGRA-MRZSidecar/0.1"},
    )
    with urlopen(request, timeout=120) as response:
        data = response.read()
    if len(data) < 1_000_000:
        raise RuntimeError("Downloaded CJK font is unexpectedly small")
    font_path.write_bytes(data)
PY

# MRZScanner also downloads its detector checkpoints on first construction.
# Prepare them while the image is being built (as root), so the non-root
# runtime never needs to create mrzscanner/det/ckpt or access the network.
RUN python - <<'PY'
from capybara import Backend
from mrzscanner import MRZScanner, ModelType

MRZScanner(backend=Backend.cpu, model_type=ModelType.two_stage)
PY

COPY app.py ./app.py

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin mrz \
    && mkdir -p /tmp/mrz-sidecar \
    && chown -R mrz:mrz /app /tmp/mrz-sidecar

USER mrz
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=12 \
  CMD python -c "import json,urllib.request; x=json.load(urllib.request.urlopen('http://127.0.0.1:8080/health')); raise SystemExit(0 if x.get('ready') else 1)"

ENTRYPOINT ["python", "/app/app.py"]
