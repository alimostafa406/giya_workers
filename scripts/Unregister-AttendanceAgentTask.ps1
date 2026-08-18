param(
  [string] $TaskName = 'WorkersHikvisionAttendanceAgent'
)

# This removes only the named local Windows Task Scheduler entry. It does not
# change Hikvision, Supabase, attendance records, or the local configuration.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Unregistered $TaskName."
} else {
  Write-Host "Task not found: $TaskName"
}
