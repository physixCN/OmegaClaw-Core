// Screenshot + console-error audit of the built app in sim mode.
// Usage: npm run build && npm run shots   (starts `vite preview` itself)
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const PORT = 4179
const BASE = `http://localhost:${PORT}/?sim=1`
const OUT = new URL('../screenshots/', import.meta.url).pathname
const only = process.argv[2] // optional: "mobile" | "desktop"

await mkdir(OUT, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' })
server.stdout.resume()
server.stderr.resume()
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break
  } catch {
    /* not up yet */
  }
  if (i > 60) throw new Error('vite preview did not start')
  await new Promise((r) => setTimeout(r, 300))
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(name, viewport, opts) {
  const ctx = await browser.newContext({ viewport, ...opts })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`))
  const shot = async (label) => {
    const path = `${OUT}${label}-${name}.png`
    await page.screenshot({ path })
    console.log('saved', path)
  }
  const go = async (hash) => {
    await page.evaluate((h) => (window.location.hash = h), hash)
  }
  const mobile = viewport.width < 768

  await page.goto(`${BASE}#/`)
  await page.waitForSelector('canvas')
  await sleep(7000)
  await shot('01-hive')

  // dot panel with chat: send a message and wait for the streamed reply
  await go('#/dot/a_vega01')
  await sleep(1500)
  const box = page.getByPlaceholder('Message Vega…')
  await box.fill('What do you believe most?')
  await box.press('Enter')
  await sleep(6500)
  await shot('02-dot-chat')

  // swarm view with provenance open
  await go('#/swarms/s_lyra')
  await sleep(1800)
  await go(`#/swarms/s_lyra?b=${encodeURIComponent('(--> rr-lyrae variable)')}`)
  await sleep(2200)
  await shot('03-swarm-provenance')

  // create flow
  await go('#/new?swarm=s_kelp')
  await sleep(1000)
  await page.locator('#dot-name').fill('Lumen')
  await sleep(500)
  await shot('04-create')
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Continue' }).click()
    await sleep(450)
  }
  await page.getByRole('button', { name: /Bring Lumen to life/ }).click()
  await sleep(1300)
  await shot('05-birth')
  await sleep(1800)
  await shot('06-token')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Done' }).click()
  await sleep(400)

  // usage
  await go('#/usage')
  await sleep(2200)
  await shot('07-usage')

  // command palette
  await go('#/')
  await sleep(1200)
  if (mobile) await page.getByRole('button', { name: 'Search and commands' }).first().click()
  else await page.keyboard.press('Control+k')
  await sleep(400)
  await page.keyboard.type('wa')
  await sleep(500)
  await shot('08-palette')

  await ctx.close()
}

try {
  if (only !== 'desktop') await run('mobile', { width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  if (only !== 'mobile') await run('desktop', { width: 1440, height: 900 }, { deviceScaleFactor: 1 })
} finally {
  await browser.close()
  server.kill()
}

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`)
  for (const e of errors) console.log(' ', e)
  process.exitCode = 1
} else {
  console.log('\nNo console errors.')
}
