# Office laptop deployment

This folder runs the existing production Supabase-backed dashboard locally. It does not deploy to Vercel, store secrets in scripts, or change attendance rules.

## Required software

- Node.js LTS (`node --version`, `npm.cmd --version`)
- Python 3.13 or the approved installed Python (`python.exe --version`)
- Python package: `requests`
- Office-network access to both Hikvision devices and `*.supabase.co`

## Required local files

- Full project copy, including `package-lock.json`, `scripts/office/`, and the built `dist/` directory.
- `.env` before `npm.cmd run build`. It must contain the build-time public values `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Optional build-time values are `VITE_LOCAL_HIKVISION_HELPER_URL`, `VITE_SUPABASE_RPC_CREATE_SUPERVISOR`, and `VITE_SUPABASE_RPC_UPDATE_SUPERVISOR`.
- `.env.hikvision_sync` for the Agent only. It contains Hikvision and Supabase service credentials and must never be copied into source control or Task Scheduler arguments.

## First office setup

Run PowerShell in the copied project folder as the office Windows user:

```powershell
npm.cmd ci
npm.cmd run build
& 'C:\Path\To\python.exe' -m pip install requests
```

Copy `.env.hikvision_sync` securely, confirm the two device settings, and set `HIKVISION_AGENT_ENABLE_ATTENDANCE_WRITES=true` only after the approved production verification.

## Manual start and stop

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\office\Start-Dashboard.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\office\Start-AttendanceAgent.ps1 -PythonPath 'C:\Path\To\python.exe'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\office\Start-OfficeSystem.ps1 -PythonPath 'C:\Path\To\python.exe'
```

The dashboard is served from `dist` through `vite preview` at <http://127.0.0.1:4173>. It is not a Vite development server. Stop a manually launched server/agent using Task Manager or the owning PowerShell process. Scheduled tasks are removed with `Unregister-OfficeSystemTasks.ps1`.

## Automatic startup and shortcut

Do not run this registration on a development laptop. On the office laptop, once the build and `.env.hikvision_sync` are verified:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\office\Register-OfficeSystemTasks.ps1 -ProjectPath 'C:\Path\To\workers_react' -PythonPath 'C:\Path\To\python.exe'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\office\Create-OfficeDashboardShortcut.ps1
```

The dashboard task runs the production server in the foreground so Task Scheduler can restart it. The Agent task runs only one instance (`MultipleInstances Ignore`). The dashboard launcher also refuses to start a duplicate listener on port 4173.

## Updating the office copy

1. On the development laptop: update code, run tests and `npm.cmd run build`.
2. Copy the updated project files to the office laptop. Preserve the office `.env` and `.env.hikvision_sync` files.
3. Run `npm.cmd ci` only when `package-lock.json` changed; otherwise keep existing dependencies.
4. Run `npm.cmd run build` on the office laptop.
5. Restart the local dashboard Scheduled Task. Restart the Agent only when its Python code or configuration changed.

## Verification

After building, run `Start-Dashboard.ps1` and verify <http://127.0.0.1:4173/login> and a direct route such as <http://127.0.0.1:4173/attendance>. Then start the Agent in `--dry-run` mode for first-time connectivity verification; do not use an attendance apply solely to test this deployment.
