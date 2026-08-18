import requests
import json
from requests.auth import HTTPDigestAuth
from pathlib import Path

DEVICE_IP = "192.168.0.213"
USERNAME = "admin"
PASSWORD = "Admin12345"

url = f"http://{DEVICE_IP}/ISAPI/AccessControl/UserInfo/Search?format=json"

all_users = []
position = 0
batch_size = 30
search_id = "users-search-001"

print("Connecting to Hikvision...")

while True:
    payload = {
        "UserInfoSearchCond": {
            "searchID": search_id,
            "searchResultPosition": position,
            "maxResults": batch_size
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
        print("ERROR:")
        print(response.text)
        raise SystemExit()

    data = response.json()

    result = data.get("UserInfoSearch", {})
    users = result.get("UserInfo", [])

    if isinstance(users, dict):
        users = [users]

    all_users.extend(users)

    total = result.get("totalMatches")
    status = result.get("responseStatusStrg")

    print(
        "Fetched:", len(users),
        "| Position:", position,
        "| Total:", total,
        "| Status:", status
    )

    if status != "MORE":
        break

    if not users:
        break

    position += len(users)

Path("hikvision_raw").mkdir(exist_ok=True)

output_file = Path("hikvision_raw/hikvision_users_ALL.json")

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(all_users, f, ensure_ascii=False, indent=2)

print()
print("TOTAL USERS:", len(all_users))
print("--------------------------------")

for user in all_users:
    print(
        user.get("employeeNo"),
        "|",
        user.get("name"),
        "|",
        user.get("userType")
    )

print("--------------------------------")
print("Saved:", output_file)