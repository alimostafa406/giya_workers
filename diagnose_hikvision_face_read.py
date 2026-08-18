"""Read-only ISAPI diagnostic for one Hikvision employee face identity.

Requires HIKVISION_USERNAME and HIKVISION_PASSWORD. It performs only GET and POST
search/read requests and reports compact response diagnostics without credentials.
"""

import json
import os

import requests
from requests.auth import HTTPDigestAuth

DEVICE_IP = os.environ.get("HIKVISION_DEVICE_IP", "192.168.0.213")
USERNAME = os.environ.get("HIKVISION_USERNAME")
PASSWORD = os.environ.get("HIKVISION_PASSWORD")
EMPLOYEE_NO = "8"

if not USERNAME or not PASSWORD:
    raise SystemExit("Set HIKVISION_USERNAME and HIKVISION_PASSWORD.")

session = requests.Session()
session.auth = HTTPDigestAuth(USERNAME, PASSWORD)

def summarize(label, method, path, payload=None):
    url = f"http://{DEVICE_IP}{path}"
    try:
        response = session.request(method, url, json=payload, timeout=20)
    except requests.RequestException as error:
        print(json.dumps({"label": label, "method": method, "path": path, "error": str(error)}, ensure_ascii=False))
        return

    result = {
        "label": label,
        "method": method,
        "path": path,
        "http_status": response.status_code,
        "content_type": response.headers.get("content-type", ""),
        "is_image": response.headers.get("content-type", "").lower().startswith("image/"),
    }
    try:
        body = response.json()
        result["response_keys"] = list(body.keys()) if isinstance(body, dict) else ["array"]
        for key in ("statusCode", "statusString", "subStatusCode", "errorCode"):
            if key in body:
                result[key] = body[key]
        serialized = json.dumps(body, ensure_ascii=False)
        result["has_picture_reference"] = any(token in serialized.lower() for token in ("pictureurl", "faceurl", "faceimage", "facedata", "imageurl"))
        result["excerpt"] = serialized[:500]
    except ValueError:
        result["excerpt"] = response.text[:500]
        result["has_picture_reference"] = any(token in result["excerpt"].lower() for token in ("pictureurl", "faceurl", "imageurl"))
    print(json.dumps(result, ensure_ascii=False))

# Capability discovery.
for label, path in [
    ("system_capabilities", "/ISAPI/System/capabilities?format=json"),
    ("access_control_capabilities", "/ISAPI/AccessControl/capabilities?format=json"),
    ("user_info_capabilities", "/ISAPI/AccessControl/UserInfo/capabilities?format=json"),
    ("face_endpoint_capabilities", "/ISAPI/AccessControl/UserInfo/Face/capabilities?format=json"),
    ("fdlib_capabilities", "/ISAPI/Intelligent/FDLib/capabilities?format=json"),
    ("face_data_record_capabilities", "/ISAPI/Intelligent/FDLib/FaceDataRecord/capabilities?format=json"),
]:
    summarize(label, "GET", path)

# Known and candidate registered-face reads for employeeNo 8.
summarize("current_user_face_endpoint", "GET", f"/ISAPI/AccessControl/UserInfo/Face?format=json&employeeNo={EMPLOYEE_NO}")
summarize("user_face_without_format", "GET", f"/ISAPI/AccessControl/UserInfo/Face?employeeNo={EMPLOYEE_NO}")
summarize("face_data_record_by_pid", "GET", f"/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json&PID={EMPLOYEE_NO}")
summarize("face_data_record_by_employee", "GET", f"/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json&employeeNo={EMPLOYEE_NO}")

# Read/search only; no enrollment or face-data write operation is attempted.
summarize("face_data_record_search_pid", "POST", "/ISAPI/Intelligent/FDLib/FaceDataRecord/Search?format=json", {
    "FaceDataRecordSearchCond": {"searchID": "face-read-pid-8", "searchResultPosition": 0, "maxResults": 5, "PID": EMPLOYEE_NO}
})
summarize("face_data_record_search_fdid_pid", "POST", "/ISAPI/Intelligent/FDLib/FaceDataRecord/Search?format=json", {
    "FaceDataRecordSearchCond": {"searchID": "face-read-fdid-pid-8", "searchResultPosition": 0, "maxResults": 5, "FDID": "1", "PID": EMPLOYEE_NO}
})
summarize("user_info_search_employee", "POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", {
    "UserInfoSearchCond": {"searchID": "user-read-8", "searchResultPosition": 0, "maxResults": 1, "EmployeeNo": EMPLOYEE_NO}
})
