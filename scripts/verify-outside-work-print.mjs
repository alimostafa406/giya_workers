// Run after OUTSIDE_WORK_PRINT_FIXTURES=tmp/pdfs/outside-work-print Vitest fixtures.
// Isolated headless Chrome, no authenticated browser or production data.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const output = resolve('tmp/pdfs/outside-work-print')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(output, 'chrome-'))
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
let socket, call
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  let port
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await pause(100) }
  }
  assert(port, 'Chrome did not start')
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let seq = 0
  const pending = new Map()
  socket.onmessage = event => {
    const result = JSON.parse(event.data), task = pending.get(result.id)
    if (!task) return
    pending.delete(result.id)
    if (result.error) task.reject(Error(JSON.stringify(result.error))); else task.resolve(result.result)
  }
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
  })
  await call('Page.enable')
  await call('Emulation.setEmulatedMedia', { media: 'print' })
  await call('Emulation.setDeviceMetricsOverride', { width: 1070, height: 741, deviceScaleFactor: 1, mobile: false })
  for (const language of ['ar', 'fr']) {
    await call('Page.navigate', { url: pathToFileURL(join(output, `three-dates-${language}.html`)).href })
    for (let i = 0; i < 100; i++) {
      const ready = await call('Runtime.evaluate', { expression: "document.readyState==='complete' && !!document.querySelector('.outside-work-print')", returnByValue: true })
      if (ready.result.value) break
      await pause(50)
    }
    const metrics = await call('Runtime.evaluate', { expression: `(async()=>{await document.fonts.ready; const root=document.querySelector('.outside-work-print'), bounds=root.getBoundingClientRect(); return {direction:getComputedStyle(root).direction,dates:root.querySelectorAll('.outside-report-day').length,rows:root.querySelectorAll('tbody tr').length,left:bounds.left,right:bounds.right,width:bounds.width,height:bounds.height,overflow:[...root.querySelectorAll('table,tr,td,th')].some(el=>{const r=el.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1||el.scrollWidth>el.clientWidth+1})}})()`, awaitPromise: true, returnByValue: true })
    assert.equal(metrics.result.value.dates, 3)
    assert.equal(metrics.result.value.rows, 9)
    assert.equal(metrics.result.value.overflow, false, 'Clipped/overflowing table')
    assert(metrics.result.value.left >= -1 && metrics.result.value.right <= 1071, 'Report outside printable viewport')
    assert.equal(metrics.result.value.direction, language === 'ar' ? 'rtl' : 'ltr')
    const pdf = Buffer.from((await call('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })).data, 'base64')
    await writeFile(join(output, `three-dates-${language}.pdf`), pdf)
    const text = pdf.toString('latin1'), pages = [...text.matchAll(/\/Type\s*\/Page\b/g)].length
    const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/)
    assert(box && Number(box[1]) > Number(box[2]), 'PDF is not landscape')
    const png = await call('Page.captureScreenshot', { captureBeyondViewport: false })
    await writeFile(join(output, `three-dates-${language}-print-preview.png`), Buffer.from(png.data, 'base64'))
    console.log(JSON.stringify({ language, pages, mediaBox: box.slice(1), ...metrics.result.value }))
    assert.equal(pages, 1, `${language}: expected one PDF page`)
  }
} finally { if (call) await call('Browser.close').catch(() => {}); socket?.close(); browser.kill() }
