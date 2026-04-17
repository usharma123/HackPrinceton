import os
import requests
import time

# HairStep server (hair strand reconstruction)
HAIRSTEP_URL = "https://coconut-sublevel-pennant.ngrok-free.dev"

# MICA server (head mesh reconstruction — run mica_server.py on Oscar/AWS)
# Replace with your ngrok URL after running: ngrok http 5001
MICA_URL = "https://oblivion-wriggly-landfill.ngrok-free.dev"

ngrok_url = MICA_URL  # swap to HAIRSTEP_URL for hair jobs
image_path = "/Users/ethanchen/ShapeUp-HackPrinceton/server/imgs/bruno1.png"

headers = {
    "ngrok-skip-browser-warning": "true",
    "User-Agent": "python-requests/2.31.0"
}

# Submit the job
with open(image_path, 'rb') as f:
    files = {'image': (os.path.basename(image_path), f, 'image/png')}
    response = requests.post(f"{ngrok_url}/process_image", files=files, headers=headers)

result = response.json()
print("Submitted:", result)
if 'job_id' not in result:
    print("Error from server:", result)
    exit(1)
job_id = result['job_id']

# Poll until done
while True:
    status = requests.get(f"{ngrok_url}/status/{job_id}", headers=headers).json()
    print("Status:", status['status'])
    if status['status'] == 'success':
        download = requests.get(f"{ngrok_url}/download/{job_id}", headers=headers)
        with open(os.path.join(os.path.dirname(__file__), "../public/output.ply"), "wb") as f:
            f.write(download.content)
        print("Downloaded output.ply")
        break
    elif status['status'] == 'error':
        print("Error processing job", status['error'], job_id)
    time.sleep(5)