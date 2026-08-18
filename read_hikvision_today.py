import requests
import json
from requests.auth import HTTPDigestAuth
from pathlib import Path

DEVICE_IP = "192.168.0.213"
USERNAME = "admin"
PASSWORD = "Admin12345"

url = f"http://{DEVICE_IP}/ISAPI/AccessControl/AcsEvent?format=json"

all_events = []
position = 0
batch_size = 30

print("Connecting to Hikvision...")

while True:
    payload = {
        "AcsEventCond": {
            "searchID": "attendance-2026-08-10",
            "searchResultPosition": position,
            "maxResults": batch_size,
            "major": 0,
            "minor": 0,
            "startTime": "2026-08-10T00:00:00+01:00",
            "endTime": "2026-08-10T23:59:59+01:00"
        }
    }

    response = requests.post(
        url,
        json=payload,
        auth=HTTPDigestAuth(USERNAME, PASSWORD),
        timeout=30
    )

    print("HTTP:", response.status_code)

    if response.status_code != 200:
        print(response.text)
        raise SystemExit()

    data = response.json()
    acs = data.get("AcsEvent", {})
    events = acs.get("InfoList", [])

    all_events.extend(events)

    print(
        "Fetched:",
        len(events),
        "| Position:",
        position,
        "| Total:",
        acs.get("totalMatches")
    )

    if acs.get("responseStatusStrg") != "MORE":
        break

    position += len(events)

    if not events:
        break

Path("hikvision_raw").mkdir(exist_ok=True)

with open(
    "hikvision_raw/attendance_2026-08-10_ALL.json",
    "w",
    encoding="utf-8"
) as f:
    json.dump(all_events, f, ensure_ascii=False, indent=2)

valid_events = [
    e for e in all_events
    if e.get("major") == 5
    and e.get("minor") == 75
    and e.get("employeeNoString")
]

print()
print("ALL EVENTS:", len(all_events))
print("VALID ATTENDANCE EVENTS:", len(valid_events))
print("--------------------------------")

for e in valid_events:
    print(
        e.get("employeeNoString"),
        "|",
        e.get("name"),
        "|",
        e.get("time"),
        "|",
        e.get("currentVerifyMode")
    )

print("--------------------------------")
print("Saved full raw events.")