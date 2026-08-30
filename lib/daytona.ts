import { Daytona, GpuType } from "@daytonaio/sdk";

export const PORT = 8000;

export function client() {
  return new Daytona({ apiKey: process.env.DAYTONA_API_KEY! });
}

/** Everything the sandbox needs, written once and run detached.
 *
 *  torch is not pip-installable here (pypi.nvidia.com is blocked from Daytona's network),
 *  so the base image already carries torch + CUDA and we only add the model stack on top.
 */
export const SETUP_SH = `#!/usr/bin/env bash
set -euo pipefail
export HF_HOME=/opt/hf
mkdir -p /opt/hf
echo "STEP apt"
apt-get update -qq && apt-get install -y -qq git libgl1 libglib2.0-0 >/dev/null
echo "STEP pip"
pip install -q --no-cache-dir pillow numpy torchvision transformers timm einops kornia \
  huggingface_hub accelerate fastapi "uvicorn[standard]" pydantic opencv-python-headless
echo "STEP weights"
python - <<'PY'
from transformers import AutoModelForImageSegmentation as M
for r in ("ZhengPeng7/BiRefNet", "ZhengPeng7/BiRefNet-matting"):
    M.from_pretrained(r, trust_remote_code=True)
    print("baked", r, flush=True)
PY
echo "STEP serve"
cd /opt && nohup python -m uvicorn server:app --host 0.0.0.0 --port ${PORT} > /tmp/server.log 2>&1 &
sleep 1
echo "STEP done"
`;

export const GPU_PREFS: GpuType[] = [
  "RTX-4090" as GpuType,
  "RTX-5090" as GpuType,
  "RTX-PRO-6000" as GpuType,
];
