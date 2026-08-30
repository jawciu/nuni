"""Isolation server. Runs inside a Daytona GPU sandbox with the weights already baked in.

One process, models resident, so every cut-out after the first is sub-second.
POST /isolate {image_b64, model} -> {png_b64}
"""
import base64, io, os, time
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

DEV = "cuda" if torch.cuda.is_available() else "cpu"
REPOS = {
    "birefnet": "ZhengPeng7/BiRefNet",
    "birefnet-matting": "ZhengPeng7/BiRefNet-matting",
}
_loaded = {}

def get(name):
    name = name if name in REPOS else "birefnet"
    if name not in _loaded:
        m = AutoModelForImageSegmentation.from_pretrained(REPOS[name], trust_remote_code=True)
        m.to(DEV).eval()
        if DEV == "cuda":
            m.half()
        _loaded[name] = m
    return _loaded[name]

TF = transforms.Compose([
    transforms.Resize((1024, 1024)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

app = FastAPI()

class Job(BaseModel):
    image_b64: str
    model: str = "birefnet"
    trim: bool = True

@app.get("/health")
def health():
    return {"ok": True, "device": DEV, "loaded": list(_loaded), "models": list(REPOS)}

@app.post("/isolate")
def isolate(job: Job):
    t0 = time.perf_counter()
    im = Image.open(io.BytesIO(base64.b64decode(job.image_b64))).convert("RGB")
    m = get(job.model)
    x = TF(im).unsqueeze(0).to(DEV)
    if DEV == "cuda":
        x = x.half()
    with torch.no_grad():
        pred = m(x)[-1].sigmoid().cpu()[0].squeeze()
    mask = transforms.ToPILImage()(pred).resize(im.size)
    # the mask is applied to HER pixels; nothing is redrawn
    out = im.copy().convert("RGBA")
    out.putalpha(mask)
    if job.trim:
        # cut-outs carry faint semi-transparent edge pixels that read as a dotted
        # rectangle once projected, so bin anything under a hard threshold and crop
        import numpy as np
        a = np.array(out)
        a[..., 3] = np.where(a[..., 3] < 26, 0, a[..., 3])
        out = Image.fromarray(a)
        bb = out.getbbox()
        if bb:
            out = out.crop(bb)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return {
        "png_b64": base64.b64encode(buf.getvalue()).decode(),
        "ms": round((time.perf_counter() - t0) * 1000),
        "model": job.model,
        "size": list(out.size),
    }

@app.on_event("startup")
def warm():
    get("birefnet")
