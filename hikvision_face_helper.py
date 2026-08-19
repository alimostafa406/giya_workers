"""Loopback-only, read-only Hikvision registered-face helper.

The dashboard requests one employeeNo at a time from this helper. It performs only
GET requests against Hikvision and caches successful images outside the repository.
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote
from datetime import date as date_type, datetime

import requests
from requests.auth import HTTPDigestAuth
from hikvision_attendance_sync import (
    RequestDiagnostics,
    SupabaseReadClient,
    attendance_apply_blocked_reason,
    apply_biometric_attendance,
    hikvision_events_with_devices,
    load_resolution_data,
    local_now,
    plan_attendance,
    write_summary,
)
from hikvision_user_sync import sync_users_dataset
from hikvision_local_config import load_local_hikvision_config, require_local_settings
from hikvision_devices import configured_devices

try:
    load_local_hikvision_config()
    configured_devices()
except RuntimeError as error:
    raise SystemExit(f"Local Hikvision Helper configuration error: {error}") from error

PRIMARY_DEVICE = configured_devices()[0]
DEVICE_IP = PRIMARY_DEVICE.ip
USERNAME = PRIMARY_DEVICE.username
PASSWORD = PRIMARY_DEVICE.password
CACHE_DIR = Path(os.environ.get("HIKVISION_FACE_CACHE_DIR", Path.home() / ".workers_attendance_faces"))
USERS_FILE = Path(os.environ.get("HIKVISION_USERS_FILE", Path(__file__).parent / "hikvision_raw" / "hikvision_users_ALL.json"))
HOST, PORT = "127.0.0.1", 8765
ATTENDANCE_TEST_ONLY_DATE = date_type(2026, 8, 10)
HEALTH_CACHE_SECONDS = 5
HEALTH_CACHE = {"checked_at": 0.0, "result": {"helper_connected": True, "hikvision_reachable": False, "error": "not_checked"}}
HEALTH_CACHE_LOCK = threading.Lock()
LOCAL_DASHBOARD_ORIGINS = {
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}


def helper_timestamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


class UserSyncJob:
    """One asynchronous inventory sync shared by all loopback Helper requests."""

    def __init__(self, sync_function):
        self.sync_function = sync_function
        self.lock = threading.Lock()
        self.state = {
            "status": "idle", "started_at": None, "finished_at": None,
            "progress": None, "result": None, "error": None,
        }

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self):
        with self.lock:
            if self.state["status"] == "running":
                return False, dict(self.state)
            self.state = {
                "status": "running", "started_at": helper_timestamp(), "finished_at": None,
                "progress": "reading_hikvision_users", "result": None, "error": None,
            }
            snapshot = dict(self.state)
        threading.Thread(target=self._run, name="hikvision-user-sync", daemon=True).start()
        return True, snapshot

    def _run(self):
        try:
            result = self.sync_function()
            if not isinstance(result, dict) or result.get("status") != "ok":
                raise RuntimeError("Hikvision user synchronization did not return a valid result.")
            with self.lock:
                self.state.update({"status": "success", "finished_at": helper_timestamp(), "progress": None, "result": result})
        except Exception as error:
            # Do not expose a device URL, request headers, or credentials to the browser.
            with self.lock:
                self.state.update({
                    "status": "failed", "finished_at": helper_timestamp(), "progress": None,
                    "error": f"{type(error).__name__}: Hikvision user synchronization failed locally.",
                })


USER_SYNC_JOB = UserSyncJob(sync_users_dataset)

CACHE_DIR.mkdir(parents=True, exist_ok=True)
def helper_session():
    """Each threaded Helper request owns its Digest session."""
    session = requests.Session()
    session.auth = HTTPDigestAuth(USERNAME, PASSWORD)
    return session

def diagnostic(code, message, http_status=None):
    return {"code": code, "message": message, "hikvision_status": http_status}

def face_result(employee_no):
    safe_no = "".join(char for char in employee_no if char.isalnum() or char in "-_")
    if not safe_no:
        return None, None, diagnostic("invalid_employee_no", "رقم الموظف غير صالح.")
    cached = next(iter(CACHE_DIR.glob(f"{safe_no}.*")), None)
    if cached:
        content_type = "image/png" if cached.suffix == ".png" else "image/jpeg"
        return cached.read_bytes(), content_type, {"code": "registered_face_cached", "message": "تمت قراءة الصورة المسجلة من التخزين المحلي."}

    url = f"http://{DEVICE_IP}/ISAPI/AccessControl/UserInfo/Face?format=json&employeeNo={quote(safe_no)}"
    session = helper_session()
    try:
        response = session.get(url, timeout=20)
    except requests.ConnectionError:
        return None, None, diagnostic("device_unreachable", "لا يمكن الوصول إلى جهاز Hikvision على الشبكة المحلية.")
    except requests.Timeout:
        return None, None, diagnostic("device_unreachable", "انتهت مهلة الاتصال بجهاز Hikvision.")
    except requests.RequestException as error:
        return None, None, diagnostic("helper_request_error", f"فشل طلب الجهاز: {error}")
    finally:
        session.close()

    content_type = response.headers.get("content-type", "").lower()
    if response.ok and content_type.startswith("image/"):
        suffix = ".png" if "png" in content_type else ".jpg"
        (CACHE_DIR / f"{safe_no}{suffix}").write_bytes(response.content)
        return response.content, content_type, {"code": "registered_face_retrieved", "message": "تم جلب الصورة المسجلة من الجهاز."}

    body = response.text[:500].lower()
    if response.status_code in (401, 403):
        result = diagnostic("authentication_failure", "رفض جهاز Hikvision بيانات اعتماد المساعد المحلي.", response.status_code)
    elif response.status_code in (405, 501) or "unsupported" in body or "not support" in body or "invalidoperation" in body:
        result = diagnostic("endpoint_unsupported", "هذا الجهاز أو إصدار البرنامج لا يدعم نقطة قراءة الوجه المسجل.", response.status_code)
    elif response.status_code == 404 and ("notfound" in body or "no face" in body or "face not" in body):
        result = diagnostic("no_registered_face", "لا توجد صورة وجه مسجلة لهذا الرقم على الجهاز.", response.status_code)
    else:
        result = diagnostic("hikvision_response_error", "استجاب جهاز Hikvision بدون صورة مسجلة قابلة للقراءة.", response.status_code)
    result["response_excerpt"] = response.text[:300]
    return None, None, result


def device_health():
    """Return a short-lived cached, lightweight device probe for browser health checks."""
    now = time.monotonic()
    with HEALTH_CACHE_LOCK:
        if now - HEALTH_CACHE["checked_at"] < HEALTH_CACHE_SECONDS:
            return dict(HEALTH_CACHE["result"])
        try:
            session = helper_session()
            try:
                response = session.get(f"http://{DEVICE_IP}/ISAPI/System/capabilities", timeout=2)
                result = {"helper_connected": True, "hikvision_reachable": response.ok, "hikvision_status": response.status_code}
            finally:
                session.close()
        except requests.Timeout:
            result = {"helper_connected": True, "hikvision_reachable": False, "error": "device_timeout"}
        except requests.RequestException:
            result = {"helper_connected": True, "hikvision_reachable": False, "error": "device_unreachable"}
        HEALTH_CACHE["checked_at"] = now
        HEALTH_CACHE["result"] = result
        return dict(result)


def parse_request_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    try:
        payload = json.loads(handler.rfile.read(length).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("invalid_json") from error
    return payload if isinstance(payload, dict) else {}


def run_attendance_operation(payload, apply=False):
    requested_date = str(payload.get("date") or "").strip()
    target_date = date_type.fromisoformat(requested_date)
    if target_date == ATTENDANCE_TEST_ONLY_DATE:
        raise ValueError("testing_date_not_allowed")
    if target_date < local_now().date():
        raise ValueError("historical_date_not_allowed")
    diagnostics = RequestDiagnostics(False)
    events, device_reads = hikvision_events_with_devices(target_date, diagnostics)
    apply_blocked_reason = attendance_apply_blocked_reason(device_reads)
    if apply and apply_blocked_reason:
        raise RuntimeError(apply_blocked_reason)
    client = SupabaseReadClient(diagnostics)
    # Preview needs the same source/override fields as apply so it can accurately
    # identify manual-protected attendance without proposing a future overwrite.
    resolution = load_resolution_data(client, target_date, for_apply=True)
    plans, counters = plan_attendance(events, resolution, target_date)
    preflight = write_summary(plans, resolution["existing_attendance"], counters)
    special_staff = sum(1 for plan in plans if plan.get("classification") == "special_staff")
    result = {
        "status": "ok",
        "date": target_date.isoformat(),
        "mode": "apply" if apply else "preview",
        "helper_connected": True,
        "hikvision_reachable": True,
        "device_reads": device_reads,
        "apply_blocked_reason": apply_blocked_reason,
        "counts": {
            "present": counters.get("present", 0),
            "half_day": counters.get("half_day", 0),
            "absent": counters.get("absent", 0),
            "pending": counters.get("pending", 0),
            "unmapped": counters.get("unmapped", 0),
            "needs_review": counters.get("needs_review", 0),
            "manual_protected": preflight.get("skipped_manual_protected", 0),
            "special_staff": special_staff,
        },
        "write_preflight": preflight,
        "proposals": plans,
    }
    if apply:
        write_result = apply_biometric_attendance(client, plans, resolution["existing_attendance"])
        result["write_results"] = {
            "inserted": write_result.get("inserted", 0),
            "updated": write_result.get("updated", 0),
            "skipped_manual_protected": write_result.get("skipped_manual_protected", 0),
            "unmapped": counters.get("unmapped", 0),
            "needs_review": counters.get("needs_review", 0),
            "errors": write_result.get("errors", 0),
        }
    return result


def today_identity_activity():
    """Read today's real device events and merge activity by employeeNo only."""
    events, device_reads = hikvision_events_with_devices(local_now().date(), RequestDiagnostics(False))
    failed_reads = [result for result in device_reads.values() if result.get('state') == 'failed']
    if failed_reads and len(failed_reads) == len(configured_devices()):
        raise RuntimeError('All configured Hikvision devices failed while reading today events.')
    identities = {}
    for event in events:
        employee_no = str(event.get('employeeNoString') or '').strip()
        if not employee_no:
            continue
        activity = identities.setdefault(employee_no, {
            'employeeNo': employee_no,
            'name': str(event.get('name') or '').strip() or 'بدون اسم',
            'first_punch_today': None,
            'last_punch_today': None,
            'today_event_count': 0,
            'devices_seen_today': set(),
        })
        event_time = str(event.get('time') or '')
        if event_time and (activity['first_punch_today'] is None or event_time < activity['first_punch_today']):
            activity['first_punch_today'] = event_time
        if event_time and (activity['last_punch_today'] is None or event_time > activity['last_punch_today']):
            activity['last_punch_today'] = event_time
        activity['today_event_count'] += 1
        if event.get('_device_id'):
            activity['devices_seen_today'].add(event['_device_id'])
    return {
        'status': 'ok',
        'date': local_now().date().isoformat(),
        'events': len(events),
        'identities': [{
            **activity,
            'devices_seen_today': sorted(activity['devices_seen_today']),
        } for activity in sorted(identities.values(), key=lambda item: item['first_punch_today'] or '')],
        'device_reads': device_reads,
        # Preserve the prior health field for existing local-dashboard callers,
        # while device_reads supplies the complete/partial distinction.
        'device_failures': {
            device_id: result.get('error')
            for device_id, result in device_reads.items()
            if result.get('state') != 'complete'
        },
    }

class Handler(BaseHTTPRequestHandler):
    def send_local_cors_headers(self):
        origin = self.headers.get("Origin")
        if origin in LOCAL_DASHBOARD_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def send_json(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_local_cors_headers()
            self.end_headers()
            self.wfile.write(encoded)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            print("[HELPER] client disconnected before response completed")

    def send_bytes(self, status, content_type, payload, **headers):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_local_cors_headers()
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            print("[HELPER] client disconnected before response completed")

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"code": "helper_available", "message": "Local helper is running.", **device_health()})
            return
        if self.path == "/today-events":
            try:
                self.send_json(200, today_identity_activity())
            except (requests.RequestException, RuntimeError, ValueError):
                self.send_json(502, diagnostic("today_events_unavailable", "تعذر تحميل بصمات اليوم من أجهزة Hikvision المحلية."))
            return
        if self.path == "/sync-users/status":
            self.send_json(200, USER_SYNC_JOB.snapshot())
            return
        if not self.path.startswith("/faces/"):
            self.send_json(404, diagnostic("route_not_found", "مسار غير معروف."))
            return
        image, content_type, result = face_result(unquote(self.path.removeprefix("/faces/")))
        if not image:
            self.send_json(502 if result["code"] == "device_unreachable" else 404, result)
            return
        self.send_bytes(200, content_type, image, **{"X-Face-Source": result["code"]})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_local_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if self.path in {"/attendance/preview", "/attendance/apply"}:
            try:
                payload = parse_request_json(self)
                if self.path == "/attendance/apply" and payload.get("confirm") is not True:
                    self.send_json(400, diagnostic("confirmation_required", "Attendance apply requires confirm=true."))
                    return
                self.send_json(200, run_attendance_operation(payload, apply=self.path == "/attendance/apply"))
            except ValueError as error:
                code = str(error)
                if code == "testing_date_not_allowed":
                    message = "2026-08-10 is a testing-only date and cannot be previewed or applied."
                elif code == "historical_date_not_allowed":
                    message = "Choose today or a future date."
                else:
                    message = "Invalid attendance request."
                self.send_json(400, diagnostic(code, message))
            except requests.Timeout:
                self.send_json(504, diagnostic("device_timeout", "Timed out while reading Hikvision attendance events."))
            except requests.ConnectionError:
                self.send_json(502, diagnostic("device_unreachable", "Hikvision is unreachable from this office laptop."))
            except requests.RequestException as error:
                self.send_json(502, diagnostic("attendance_operation_failed", f"Attendance operation failed: {error}"))
            except RuntimeError as error:
                self.send_json(500, diagnostic("local_configuration_error", str(error)))
            except Exception:
                # Keep the loopback API usable if an unexpected local error occurs,
                # while never leaking a traceback, credentials, or request headers.
                code = "attendance_apply_failed" if self.path == "/attendance/apply" else "attendance_preview_failed"
                self.send_json(500, {
                    "status": "error",
                    "code": code,
                    "message": "Attendance operation failed locally. Check the local helper logs.",
                })
            return
        if self.path not in {"/sync-users/start", "/sync-users"}:
            self.send_json(404, diagnostic("route_not_found", "Ù…Ø³Ø§Ø± ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ."))
            return
        created, job = USER_SYNC_JOB.start()
        self.send_json(202 if created else 200, {**job, "already_running": not created})
        return
        try:
            self.send_json(200, sync_users_dataset())
        except requests.Timeout:
            self.send_json(504, diagnostic("device_timeout", "Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© Ù‚Ø±Ø§Ø¡Ø© Ù…Ø³ØªØ®Ø¯Ù…ÙŠ Hikvision."))
        except requests.ConnectionError:
            self.send_json(502, diagnostic("device_unreachable", "Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø¬Ù‡Ø§Ø² Hikvision Ø¹Ù„Ù‰ Ø§Ù„Ø´Ø¨ÙƒØ© Ø§Ù„Ù…Ø­Ù„ÙŠØ©."))
        except requests.HTTPError as error:
            status = error.response.status_code if error.response is not None else None
            self.send_json(502, diagnostic("hikvision_response_error", "ÙØ´Ù„ Ø¬Ù„Ø¨ Ù‚Ø§Ø¦Ù…Ø© Ù…Ø³ØªØ®Ø¯Ù…ÙŠ Hikvision.", status))
        except (requests.RequestException, RuntimeError, ValueError) as error:
            self.send_json(500, diagnostic("sync_failed", f"ÙØ´Ù„Øª Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ø§Ù„Ù…Ø­Ù„ÙŠØ©: {error}"))

    def log_message(self, *_):
        pass

def main():
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
