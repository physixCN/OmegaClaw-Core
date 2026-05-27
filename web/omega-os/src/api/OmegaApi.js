const token = new URLSearchParams(location.search).get('token') || localStorage.getItem('omegaAdminToken') || ''

function authPath(path) {
  if (!token) return path
  const url = new URL(path, location.origin)
  url.searchParams.set('token', token)
  return `${url.pathname}${url.search}`
}

async function request(method, path, payload) {
  const response = await fetch(authPath(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

export class OmegaApi {
  constructor() {
    this.hasToken = Boolean(token)
  }

  async session() {
    return request('GET', '/api/os/session')
  }

  async overview() {
    return request('GET', '/api/workbench/overview')
  }

  async brain() {
    return request('GET', '/api/os/brain')
  }

  async atomLabel(id) {
    return request('GET', `/api/workbench/atom-label?id=${encodeURIComponent(id)}`)
  }

  async chat() {
    return request('GET', '/api/os/chat')
  }

  async send(text) {
    return request('POST', '/api/os/chat', { author: 'Jon', text })
  }
}
