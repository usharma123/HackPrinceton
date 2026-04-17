"""
MICA head reconstruction server.

Deploy this on Oscar / AWS alongside your HairStep server.
Exposes the same job API contract as the existing pipeline:

    POST /process_image   { image: <file> }  → { job_id }
    GET  /status/<job_id>                    → { status, error? }
    GET  /download/<job_id>                  → <mesh.ply bytes>

Setup on the GPU server
-----------------------
1. Clone MICA and set up its conda env:
       git clone https://github.com/Zielon/MICA.git ~/MICA
       cd ~/MICA
       conda env create -f environment.yml
       conda activate mica

2. Download model weights (see MICA README):
       - MICA weights  → ~/MICA/data/pretrained/mica.tar
       - FLAME 2020    → ~/MICA/data/pretrained/FLAME2020/
       - antelopev2    → ~/.insightface/models/antelopev2/
       - buffalo_l     → ~/.insightface/models/buffalo_l/

3. Install Flask into the mica conda env:
       pip install flask

4. Set MICA_DIR if MICA is not at ~/MICA:
       export MICA_DIR=/path/to/MICA

5. Run (within the mica conda env):
       python mica_server.py

6. Expose via ngrok on port 5001:
       ngrok http 5001

Then update MICA_NGROK_URL in server/main.py to the new ngrok URL.
"""

import os
import uuid
import shutil
import tempfile
import threading
from pathlib import Path

from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

MICA_DIR = os.environ.get("MICA_DIR", str(Path.home() / "MICA"))
RESULTS_DIR = "/tmp/mica_results"
UPLOADS_DIR = "/tmp/mica_uploads"

# In-memory job store: job_id → {status, ply_path?, error?}
JOBS: dict = {}


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

def run_mica(job_id: str, image_path: str) -> None:
    tmp_input   = tempfile.mkdtemp()
    tmp_output  = tempfile.mkdtemp()
    tmp_arcface = tempfile.mkdtemp()

    try:
        # MICA demo.py expects a folder of images, not a single file
        ext = Path(image_path).suffix or ".png"
        shutil.copy(image_path, os.path.join(tmp_input, f"face{ext}"))

        import subprocess
        result = subprocess.run(
            [
                "python", "demo.py",
                "-i", tmp_input,
                "-o", tmp_output,
                "-a", tmp_arcface,
            ],
            cwd=MICA_DIR,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            JOBS[job_id] = {
                "status": "error",
                "error": result.stderr[-800:] or result.stdout[-400:],
            }
            return

        # MICA writes output/<image_stem>/<name>.ply
        ply_files = sorted(Path(tmp_output).rglob("*.ply"))
        if not ply_files:
            JOBS[job_id] = {"status": "error", "error": "MICA produced no .ply output"}
            return

        os.makedirs(RESULTS_DIR, exist_ok=True)
        out_path = os.path.join(RESULTS_DIR, f"{job_id}.ply")
        shutil.copy(str(ply_files[0]), out_path)

        JOBS[job_id] = {"status": "success", "ply_path": out_path}

    except Exception as exc:
        JOBS[job_id] = {"status": "error", "error": str(exc)}

    finally:
        shutil.rmtree(tmp_input,   ignore_errors=True)
        shutil.rmtree(tmp_output,  ignore_errors=True)
        shutil.rmtree(tmp_arcface, ignore_errors=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/process_image", methods=["POST"])
def process_image():
    if "image" not in request.files:
        return jsonify({"error": "No image field in request"}), 400

    f = request.files["image"]
    job_id = uuid.uuid4().hex[:16]

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    suffix = Path(f.filename).suffix if f.filename else ".png"
    img_path = os.path.join(UPLOADS_DIR, f"{job_id}{suffix}")
    f.save(img_path)

    JOBS[job_id] = {"status": "processing"}
    threading.Thread(target=run_mica, args=(job_id, img_path), daemon=True).start()

    return jsonify({"job_id": job_id})


@app.route("/status/<job_id>")
def status(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"status": "not_found"}), 404
    return jsonify(job)


@app.route("/download/<job_id>")
def download(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["status"] != "success":
        return jsonify({"error": f"Job status: {job['status']}"}), 404
    return send_file(job["ply_path"], mimetype="application/octet-stream")


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, threaded=True)
