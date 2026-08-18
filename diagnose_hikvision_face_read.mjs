// Read-only ISAPI face diagnostic for employeeNo 8. Uses only GET and POST search calls.
import http from 'node:http'
import crypto from 'node:crypto'

const host = process.env.HIKVISION_DEVICE_IP || '192.168.0.213'
const username = process.env.HIKVISION_USERNAME
const password = process.env.HIKVISION_PASSWORD
if (!username || !password) throw new Error('Set HIKVISION_USERNAME and HIKVISION_PASSWORD.')

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex')
const parseDigest = (value = '') => Object.fromEntries([...value.matchAll(/([\w]+)=(?:"([^"]*)"|([^,\s]+))/g)].map((match) => [match[1], match[2] ?? match[3]]))

const rawRequest = (method, path, headers = {}, body = '') => new Promise((resolve, reject) => {
  const request = http.request({ host, port: 80, method, path, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: 20000 }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
  })
  request.on('timeout', () => request.destroy(new Error('timeout')))
  request.on('error', reject)
  request.end(body)
})

const digestRequest = async (method, path, payload) => {
  const body = payload ? JSON.stringify(payload) : ''
  const challenge = await rawRequest(method, path, {}, body)
  const auth = parseDigest(challenge.headers['www-authenticate'])
  if (!auth.nonce || !auth.realm) return challenge
  const qop = String(auth.qop || 'auth').split(',')[0]
  const nc = '00000001'; const cnonce = crypto.randomBytes(12).toString('hex')
  const ha1 = md5(`${username}:${auth.realm}:${password}`)
  const ha2 = md5(`${method}:${path}`)
  const responseHash = md5(`${ha1}:${auth.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
  const authorization = `Digest username="${username}", realm="${auth.realm}", nonce="${auth.nonce}", uri="${path}", algorithm=${auth.algorithm || 'MD5'}, response="${responseHash}", qop=${qop}, nc=${nc}, cnonce="${cnonce}"${auth.opaque ? `, opaque="${auth.opaque}"` : ''}`
  return rawRequest(method, path, { Authorization: authorization }, body)
}

const test = async (label, method, path, payload) => {
  try {
    const response = await digestRequest(method, path, payload)
    const text = response.body.toString('utf8')
    let parsed = null
    try { parsed = JSON.parse(text) } catch {}
    const status = parsed || {}
    console.log(JSON.stringify({
      label, method, path, http_status: response.status,
      content_type: response.headers['content-type'] || '',
      is_image: String(response.headers['content-type'] || '').startsWith('image/'),
      statusCode: status.statusCode, statusString: status.statusString,
      subStatusCode: status.subStatusCode, errorCode: status.errorCode,
      has_image_reference: /pictureURL|faceURL|faceData|imageURL/i.test(text), excerpt: text.slice(0, 500),
    }))
  } catch (error) { console.log(JSON.stringify({ label, method, path, error: error.message })) }
}

const employeeNo = '8'
for (const [label, path] of [
  ['system_capabilities', '/ISAPI/System/capabilities?format=json'],
  ['access_control_capabilities', '/ISAPI/AccessControl/capabilities?format=json'],
  ['user_info_capabilities', '/ISAPI/AccessControl/UserInfo/capabilities?format=json'],
  ['face_endpoint_capabilities', '/ISAPI/AccessControl/UserInfo/Face/capabilities?format=json'],
  ['fdlib_capabilities', '/ISAPI/Intelligent/FDLib/capabilities?format=json'],
  ['face_data_record_capabilities', '/ISAPI/Intelligent/FDLib/FaceDataRecord/capabilities?format=json'],
  ['current_user_face_endpoint', `/ISAPI/AccessControl/UserInfo/Face?format=json&employeeNo=${employeeNo}`],
  ['face_data_record_by_pid', `/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json&PID=${employeeNo}`],
  ['face_data_record_by_employee', `/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json&employeeNo=${employeeNo}`],
]) await test(label, 'GET', path)

await test('face_data_record_search_pid', 'POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord/Search?format=json', { FaceDataRecordSearchCond: { searchID: 'face-read-pid-8', searchResultPosition: 0, maxResults: 5, PID: employeeNo } })
await test('face_data_record_search_fdid_pid', 'POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord/Search?format=json', { FaceDataRecordSearchCond: { searchID: 'face-read-fdid-pid-8', searchResultPosition: 0, maxResults: 5, FDID: '1', PID: employeeNo } })
await test('user_info_search_employee', 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', { UserInfoSearchCond: { searchID: 'user-read-8', searchResultPosition: 0, maxResults: 1, EmployeeNo: employeeNo } })
await test('user_info_search_employee_list', 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', { UserInfoSearchCond: { searchID: 'user-read-list-8', searchResultPosition: 0, maxResults: 1, EmployeeNoList: [{ employeeNo }] } })
