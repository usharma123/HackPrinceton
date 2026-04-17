import requests
import time

ngrok_url = "https://coconut-sublevel-pennant.ngrok-free.dev"
image_path = r"C:\Users\stringbot\Documents\Github\ShapeUp-HackPrinceton\server\imgs\ethan1.png"

headers = {
    "ngrok-skip-browser-warning": "true",
    "User-Agent": "python-requests/2.31.0"
}

# Submit the job
with open(image_path, 'rb') as f:
    files = {'image': (image_path, f, 'image/png')}
    response = requests.post(f"{ngrok_url}/process_image", files=files, headers=headers)

print("Submitted:", response.json())
job_id = response.json()['job_id']

# Poll until done
while True:
    status = requests.get(f"{ngrok_url}/status/{job_id}", headers=headers).json()
    print("Status:", status['status'])
    if status['status'] == 'success':
        download = requests.get(f"{ngrok_url}/download/{job_id}", headers=headers)
        with open("../public/output.ply", "wb") as f:
            f.write(download.content)
        print("Downloaded output.ply")
        break
    elif status['status'] == 'error':
        print("Error processing job", status['error'], job_id)
    time.sleep(5)