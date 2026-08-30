"""Bake the isolation snapshot: torch + CUDA + BiRefNet weights + the server.

Weights go IN the image. Nothing fetches from Hugging Face at runtime, because on venue
wifi a 1GB live pull is a dead demo.

    .venv/bin/python sandbox/build_snapshot.py
"""
import os, sys, time
from dotenv import load_dotenv
from daytona import CreateSnapshotParams, Daytona, DaytonaConfig, Image, Resources

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local"))
NAME = os.environ.get("NUNI_SNAPSHOT", "nuni-isolate-1")

d = Daytona(DaytonaConfig(api_key=os.environ["DAYTONA_API_KEY"]))

# torch is NOT pip-installable in a Daytona sandbox (pypi.nvidia.com is blocked), so start
# from an image that already carries torch + CUDA.
img = (
    Image.base("pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime")
    .run_commands(
        "apt-get update -qq && apt-get install -y -qq git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*",
        "pip install --no-cache-dir pillow numpy torchvision transformers timm einops kornia "
        "huggingface_hub accelerate fastapi 'uvicorn[standard]' pydantic opencv-python-headless",
        "python -c \"from transformers import AutoModelForImageSegmentation as M; "
        "M.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True); "
        "M.from_pretrained('ZhengPeng7/BiRefNet-matting', trust_remote_code=True); "
        "print('weights baked')\"",
    )
    .add_local_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py"), "/opt/server.py")
    .workdir("/opt")
)

t0 = time.perf_counter()
print(f"building snapshot {NAME} ...", flush=True)
d.snapshot.create(
    CreateSnapshotParams(
        name=NAME,
        image=img,
        resources=Resources(cpu=8, memory=16, disk=40),
    ),
    on_logs=lambda l: print(l, end="", flush=True),
    timeout=3600,
)
print(f"\ndone in {time.perf_counter()-t0:.0f}s -> {NAME}")
