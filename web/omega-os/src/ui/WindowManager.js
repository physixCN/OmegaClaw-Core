const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[ch]))

export class WindowManager {
  constructor(api, scene) {
    this.api = api
    this.scene = scene
    this.login = document.querySelector('#login-panel')
    this.chat = document.querySelector('#chat-panel')
    this.atom = document.querySelector('#atom-panel')
    this.atomMeta = document.querySelector('#atom-meta')
    this.atomLabel = document.querySelector('#atom-label')
    this.transcript = document.querySelector('#transcript')
    this.form = document.querySelector('#chat-form')
    this.input = document.querySelector('#chat-input')
    this.authState = api.hasToken ? true : null
    this.bind()
    this.publishInputState('idle')
  }

  bind() {
    document.querySelector('#omega-os').addEventListener('pointerup', event => {
      if (event.target.closest('.summon-panel')) return
      if (this.scene?.lastGestureDragged) return
      const atom = this.scene?.pickAtom?.(event)
      if (atom) {
        this.inspectAtom(atom, event)
        return
      }
      this.enter(event)
    })
    document.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !this.anyOpen()) {
        event.preventDefault()
        this.enter()
      }
    })
    this.form.addEventListener('submit', event => {
      event.preventDefault()
      this.send()
    })
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        this.form.requestSubmit()
      }
    })
    this.input.addEventListener('focus', () => this.publishInputState('chat'))
    this.input.addEventListener('input', () => {
      this.markInk()
      this.publishInputState('chat')
    })
    this.login.querySelectorAll('input').forEach(input => {
      input.addEventListener('focus', () => this.publishInputState('login'))
      input.addEventListener('input', () => this.publishInputState('login'))
    })
    this.makeDraggable(this.login)
    this.makeDraggable(this.chat)
    this.makeDraggable(this.atom)
  }

  anyOpen() {
    return !this.login.hidden || !this.chat.hidden || !this.atom.hidden
  }

  async enter(event) {
    if (this.anyOpen()) return
    const isAdmin = await this.ensureAdmin()
    if (isAdmin) {
      this.scene?.focusNode?.('provider', event)
      this.scene?.openSurface?.('chat')
      this.summonRipple(event)
      this.summonParticles(event, true)
      window.setTimeout(() => this.open(this.chat, event, 480), 170)
    } else {
      this.scene?.openSurface?.('login')
      this.summonRipple(event)
      this.summonParticles(event, false)
      this.open(this.login, event, 420)
    }
  }

  async ensureAdmin() {
    if (this.authState === true) return true
    try {
      const session = await this.api.session()
      this.authState = Boolean(session.admin)
      return this.authState
    } catch {
      this.authState = false
      return false
    }
  }

  open(panel, event, preferredWidth) {
    this.login.hidden = panel !== this.login
    this.chat.hidden = panel !== this.chat
    this.atom.hidden = panel !== this.atom
    const width = Math.min(preferredWidth, window.innerWidth - 28)
    const estimatedHeight = panel === this.chat ? 78 : (panel === this.login ? 244 : 340)
    const left = Math.max(14, (window.innerWidth - width) * .5)
    const floorTop = window.innerHeight - estimatedHeight - 28
    const top = Math.max(14, Math.min(Math.max(14, window.innerHeight - estimatedHeight - 14), floorTop))
    panel.style.width = `${width}px`
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
    panel.dataset.surface = 'room-floor-plinth'
    if (panel === this.chat) {
      this.transcript.innerHTML = ''
      this.publishInputState('chat')
      setTimeout(() => {
        this.input.focus()
        this.publishInputState('chat')
      }, 80)
    } else {
      this.publishInputState(panel === this.login ? 'login' : 'atom')
      setTimeout(() => {
        panel.querySelector('input')?.focus()
        this.publishInputState(panel === this.login ? 'login' : 'atom')
      }, 80)
    }
  }

  async inspectAtom(atom, event) {
    const isAdmin = await this.ensureAdmin()
    if (!isAdmin) {
      this.summonParticles(event, false)
      this.open(this.login, event, 520)
      return
    }
    this.atomMeta.innerHTML = `${esc(atom.space)} | ${esc(atom.kind)} | ${esc(atom.id)} | ${Number(atom.chars || 0)} chars`
    this.atomLabel.textContent = atom.preview || 'loading atom label...'
    this.summonParticles(event, true)
    this.open(this.atom, event, 680)
    try {
      const label = await this.api.atomLabel(atom.id)
      this.atomMeta.innerHTML = `${esc(label.space)} | ${esc(label.kind)} | ${esc(label.id)} | ${Number(label.chars || 0)} chars`
      this.atomLabel.textContent = label.label || atom.preview || ''
    } catch (err) {
      this.atomLabel.textContent = atom.preview || err.message
    }
  }

  summonParticles(event, fromCognition) {
    const root = document.querySelector('#ui-root')
    if (!root) return
    const x = event?.clientX ?? window.innerWidth / 2
    const y = event?.clientY ?? window.innerHeight / 2
    const count = fromCognition ? 38 : 22
    for (let i = 0; i < count; i += 1) {
      const particle = document.createElement('i')
      particle.className = 'summon-particle'
      const angle = Math.PI * 2 * (i / count) + Math.random() * .6
      const distance = 34 + Math.random() * (fromCognition ? 128 : 72)
      particle.style.left = `${x}px`
      particle.style.top = `${y}px`
      particle.style.setProperty('--dx', `${Math.cos(angle) * distance}px`)
      particle.style.setProperty('--dy', `${Math.sin(angle) * distance}px`)
      particle.style.setProperty('--delay', `${Math.random() * 120}ms`)
      root.appendChild(particle)
      window.setTimeout(() => particle.remove(), 980)
    }
  }

  summonRipple(event) {
    const root = document.querySelector('#ui-root')
    if (!root) return
    const x = event?.clientX ?? window.innerWidth / 2
    const y = event?.clientY ?? window.innerHeight / 2
    const ripple = document.createElement('i')
    ripple.className = 'summon-ripple'
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`
    root.appendChild(ripple)
    window.setTimeout(() => ripple.remove(), 920)
  }

  makeDraggable(panel) {
    const drag = panel.querySelector('.drag-zone')
    drag.addEventListener('pointerdown', event => {
      event.preventDefault()
      const box = panel.getBoundingClientRect()
      const dx = event.clientX - box.left
      const dy = event.clientY - box.top
      panel.classList.add('dragging')
      const move = next => {
        panel.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, next.clientX - dx))}px`
        panel.style.top = `${Math.max(8, Math.min(window.innerHeight - box.height - 8, next.clientY - dy))}px`
      }
      const up = () => {
        panel.classList.remove('dragging')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    })
  }

  renderChat(messages) {
    this.transcript.innerHTML = (messages || []).slice(-80).map(message => {
      const direction = message.direction === 'outbound' ? 'outbound' : 'inbound'
      const who = direction === 'outbound' ? 'Omega' : (message.from || 'Jon')
      return `<div class="message ${direction}"><div class="meta">${esc(who)} | ${esc(message.at || '')}</div><div>${esc(message.text || '')}</div></div>`
    }).join('')
    this.transcript.scrollTop = this.transcript.scrollHeight
  }

  async refreshChat() {
    try {
      const chat = await this.api.chat()
      this.renderChat(chat.messages || [])
    } catch (err) {
      this.renderChat([{ direction: 'outbound', from: 'Omega OS', at: '', text: err.message }])
    }
  }

  async send() {
    const text = this.input.value.trim()
    if (!text) return
    this.input.value = ''
    this.markInk()
    this.publishInputState('chat')
    try {
      await this.api.send(text)
      await this.refreshChat()
    } catch (err) {
      this.renderChat([{ direction: 'outbound', from: 'Omega OS', at: '', text: err.message }])
    }
  }

  markInk() {
    const hasInk = Boolean(this.input.value.trim())
    this.chat.classList.toggle('has-ink', hasInk)
    this.input.classList.remove('ink-pulse')
    // Restart the glyph-settle animation for each small writing burst.
    void this.input.offsetWidth
    if (hasInk) this.input.classList.add('ink-pulse')
  }

  publishInputState(kind = 'idle') {
    const focused = document.activeElement
    let text = ''
    let focus = 'none'
    if (kind === 'chat') {
      text = this.input.value
      focus = 'message'
    } else if (kind === 'login') {
      const username = this.login.querySelector('input[name="username"]')
      const password = this.login.querySelector('input[name="password"]')
      if (focused === password) {
        text = password.value ? '*'.repeat(Math.min(password.value.length, 18)) : ''
        focus = 'passcode'
      } else {
        text = username.value
        focus = 'name'
      }
    }
    window.dispatchEvent(new CustomEvent('omegaos:input', {
      detail: {
        kind,
        focus,
        text: String(text || '').slice(0, 120)
      }
    }))
  }
}
