// Drives the built UI against a running hive (live mode) and saves screenshots.
//   HIVE_URL=http://127.0.0.1:8700 HIVE_PASSWORD=... node scripts/live-check.mjs
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.env.HIVE_URL ?? 'http://127.0.0.1:8700'
const PASSWORD = process.env.HIVE_PASSWORD ?? 'pw'
const OUT = new URL('../screenshots/live/', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, init = {}) {
  const token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
  })).json()).token
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } })
  return res.json()
}

const agents = await api('/api/agents')
const byName = Object.fromEntries(agents.map((a) => [a.name, a]))
const swarm = (await api('/api/swarms')).find((s) => s.name === 'Aurora')

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const errors = []
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  const tag = viewport.width < 768 ? 'mobile' : 'desktop'
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: viewport.width < 768 })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`))
  const shot = (name) => page.screenshot({ path: `${OUT}${name}-${tag}.png` })

  await page.goto(`${BASE}/?sim=0#/`)
  await page.waitForSelector('form[aria-label="Operator login"]')
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.locator('input[type="password"]').press('Enter')
  await page.waitForSelector('canvas')
  await sleep(4000)
  await shot('01-live-hive')

  const vega = byName.Vega
  await page.evaluate((h) => (window.location.hash = h), `#/dot/${vega.id}`)
  await sleep(1500)
  const box = page.getByPlaceholder('Message Vega…')
  await box.fill(`hello from the ${tag} UI`)
  await box.press('Enter')
  await page.getByText(`I hear you - "hello from the ${tag} UI"`).first().waitFor({ timeout: 60000 })
  await box.fill('believe (--> sky blue) 0.9 0.8')
  await box.press('Enter')
  await sleep(6000)
  await shot('02-live-chat')

  if (tag === 'mobile') {
    // the rest of the swarm weighs in through the API while the UI watches
    await api(`/api/agents/${byName.Lyra.id}/messages`, { method: 'POST', body: JSON.stringify({ text: 'believe (--> sky blue) 0.95 0.7' }) })
    await api(`/api/agents/${byName.Orion.id}/messages`, { method: 'POST', body: JSON.stringify({ text: 'believe (--> sky blue) 0.1 0.6' }) })
    await sleep(8000)
  }
  await page.evaluate((h) => (window.location.hash = h), `#/swarms/${swarm.id}?b=${encodeURIComponent('(--> sky blue)')}`)
  await sleep(3000)
  await shot('03-live-provenance')
  await page.close()
}
await browser.close()
const belief = await api(`/api/swarms/${swarm.id}/beliefs/detail?statement=${encodeURIComponent('(--> sky blue)')}`)
console.log('belief', JSON.stringify(belief.tv), belief.assertions.map((a) => a.outcome).join(','))
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors')
