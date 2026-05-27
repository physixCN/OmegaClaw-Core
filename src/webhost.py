import html
import hashlib
import hmac
import json
import mimetypes
import os
import pathlib
import re
import secrets
import subprocess
import sys
import threading
import time
import http.client
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
MEMORY_DIR = ROOT / "memory"
PUBLIC_DIR = pathlib.Path(os.environ.get("OMEGACLAW_WEB_PUBLIC_DIR", ROOT / "memory" / "web" / "public"))
OMEGA_OS_DIST_DIR = PUBLIC_DIR / "os"
OMEGA_OS_DIST_INDEX = OMEGA_OS_DIST_DIR / "index.html"
ADMIN_TOKEN_FILE = pathlib.Path(os.environ.get("OMEGACLAW_WEB_ADMIN_TOKEN_FILE", ROOT / "memory" / "web" / "admin_token.txt"))
USERS_FILE = pathlib.Path(os.environ.get("OMEGACLAW_WEB_USERS_FILE", ROOT / "memory" / "web" / "users.json"))
SESSIONS_FILE = pathlib.Path(os.environ.get("OMEGACLAW_WEB_SESSIONS_FILE", ROOT / "memory" / "web" / "sessions.json"))
INVITES_FILE = pathlib.Path(os.environ.get("OMEGACLAW_WEB_INVITES_FILE", ROOT / "memory" / "web" / "family_invites.txt"))
SESSION_COOKIE = "omega_session"
GALLERY_DIR = PUBLIC_DIR / "gallery"
GALLERY_META = PUBLIC_DIR / "gallery.json"
HOST = os.environ.get("OMEGACLAW_WEB_HOST", "127.0.0.1")
PORT = int(os.environ.get("OMEGACLAW_WEB_PORT", "8088"))
PUBLIC_BASE_URL = os.environ.get("OMEGACLAW_PUBLIC_WEB_BASE", "https://omega.groveybaby.family").rstrip("/")
AGENTVERSE_SUBMIT_PROXY_PORT = int(os.environ.get("OMEGACLAW_AGENTVERSE_PORT", "8101"))
BRAIN_CACHE_TTL_SECONDS = 4.0
_BRAIN_CACHE = {}
_BRAIN_CACHE_LOCK = threading.Lock()
ALLOWED_SUFFIXES = {".html", ".css", ".js", ".json", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mp3", ".m4a", ".wav", ".ogg", ".opus", ".flac", ".aac", ".pdf"}
GALLERY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mp3", ".m4a", ".wav", ".ogg", ".opus", ".flac", ".aac"}
RESERVED_WEB_PAGES = {"index.html", "admin.html", "diagnostics.html"}
FAMILY_SECTIONS = ("General", "Dad", "Lydia", "Anna", "Suzie", "Jon", "Omega")
ACCOUNT_MEMBERS = ("Dad", "Lydia", "Anna", "Suzie", "Jon")
FAMILY_ALIASES = {
    "": "General",
    "general": "General",
    "family": "General",
    "all": "General",
    "everyone": "General",
    "dad": "Dad",
    "father": "Dad",
    "lydia": "Lydia",
    "anna": "Anna",
    "suzie": "Suzie",
    "suzy": "Suzie",
    "bingbing": "Suzie",
    "jon": "Jon",
    "omega": "Omega",
}
PAGE_MEMBER_HINTS = {
    "family.html": "General",
    "activities.html": "General",
    "chinese-phrases.html": "Suzie",
    "conversation-framework.html": "Omega",
}
ARTIFACT_ROOTS = {
    "inbox": MEMORY_DIR / "inbox",
    "outbox": MEMORY_DIR / "outbox",
    "web": PUBLIC_DIR,
}
LOG_TARGETS = {
    "terminal": MEMORY_DIR / "web" / "terminal.log",
    "omega": MEMORY_DIR / "omega.log",
    "history": MEMORY_DIR / "history.metta",
    "prompt": MEMORY_DIR / "prompt.txt",
    "persistent": MEMORY_DIR / "persistent.metta",
    "webhost": "journal:omegaclaw-webhost.service",
    "cloudflared": "journal:cloudflared.service",
}
SECRET_PATTERNS = [
    re.compile(r"sk-or-v1-[A-Za-z0-9_-]+"),
    re.compile(r"xai-[A-Za-z0-9_-]+"),
    re.compile(r"(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+", re.I),
    re.compile(r"(\btoken[\"'=:\s]+)[A-Za-z0-9._:-]+", re.I),
]


def _web_control():
    channels_dir = ROOT / "channels"
    if str(channels_dir) not in sys.path:
        sys.path.insert(0, str(channels_dir))
    import web_control

    return web_control


def os_chat_recent(limit="80"):
    try:
        count = max(1, min(300, int(limit)))
    except Exception:
        count = 80
    return {"messages": _web_control().recent_messages(limit=count), "now": time.strftime("%Y-%m-%d %H:%M:%S")}


def os_chat_send(text, author="Jon"):
    result = _web_control().enqueue_user_message(text, author=author)
    return {**result, "now": time.strftime("%Y-%m-%d %H:%M:%S")}

FAMILY_HOME_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Omega for Grovey Baby</title>
  <style>
    :root {
      --bg: #f6f4ef;
      --ink: #18211d;
      --muted: #66716b;
      --line: #d9d6cc;
      --panel: #fffdf7;
      --green: #2f7d5f;
      --blue: #365f91;
      --shadow: 0 18px 45px rgba(28, 32, 27, .12);
    }
    * { box-sizing: border-box; }
    html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--void);
    }
    html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--void);
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      min-height: 76vh;
      display: grid;
      align-items: end;
      padding: 26px clamp(18px, 5vw, 70px) 42px;
      border-bottom: 1px solid var(--line);
      background:
        linear-gradient(180deg, rgba(246,244,239,.3), var(--bg)),
        url("https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80") center/cover;
    }
    nav {
      position: fixed;
      z-index: 5;
      top: 14px;
      left: clamp(14px, 4vw, 46px);
      right: clamp(14px, 4vw, 46px);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      color: #fffdf7;
      text-shadow: 0 1px 18px rgba(0,0,0,.55);
    }
    nav a {
      color: #fffdf7;
      text-decoration: none;
      font-weight: 720;
      border: 1px solid rgba(255,255,255,.55);
      border-radius: 7px;
      padding: 8px 10px;
      backdrop-filter: blur(10px);
    }
    .brand { font-weight: 820; font-size: 18px; }
    .hero {
      color: #fffdf7;
      text-shadow: 0 2px 22px rgba(0,0,0,.62);
      max-width: 840px;
    }
    body.member-page header {
      min-height: 38vh;
      background:
        linear-gradient(180deg, rgba(246,244,239,.82), var(--bg)),
        url("https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80") center/cover;
    }
    body.member-page .hero {
      color: var(--ink);
      text-shadow: none;
    }
    body.member-page nav {
      color: var(--ink);
      text-shadow: none;
    }
    body.member-page nav a {
      color: var(--ink);
      border-color: color-mix(in srgb, var(--ink) 35%, transparent);
      background: rgba(255,253,247,.76);
    }
    h1 {
      margin: 0;
      font-size: clamp(48px, 10vw, 118px);
      line-height: .9;
      letter-spacing: 0;
    }
    .lead {
      margin: 18px 0 0;
      max-width: 56ch;
      font-size: clamp(17px, 2.1vw, 24px);
      line-height: 1.45;
    }
    main {
      padding: 34px clamp(18px, 5vw, 70px) 56px;
      display: grid;
      gap: 34px;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
      border-bottom: 1px solid var(--line);
      padding-bottom: 12px;
    }
    h2 {
      margin: 0;
      font-size: clamp(24px, 4vw, 42px);
      letter-spacing: 0;
    }
    .hint { color: var(--muted); max-width: 48ch; line-height: 1.5; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .family-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .family-card {
      min-height: 150px;
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .family-card[aria-current="page"] {
      border-color: var(--green);
      outline: 2px solid color-mix(in srgb, var(--green) 32%, transparent);
    }
    .media-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .card {
      display: grid;
      align-content: space-between;
      min-height: 190px;
      padding: 18px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      text-decoration: none;
      color: var(--ink);
    }
    .card:hover { border-color: var(--ink); }
    .media {
      display: block;
      overflow: hidden;
      min-height: 230px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--ink);
      text-decoration: none;
      box-shadow: var(--shadow);
    }
    .thumb {
      width: 100%;
      aspect-ratio: 4 / 3;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: #111815;
    }
    .thumb img, .thumb video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .media-info { padding: 12px; }
    .media-info h3 {
      margin: 0;
      font-size: 17px;
      letter-spacing: 0;
    }
    .media-info p {
      margin: 7px 0 0;
      color: var(--muted);
      line-height: 1.4;
      font-size: 14px;
    }
    .card h3 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0;
    }
    .card p {
      margin: 10px 0 22px;
      color: var(--muted);
      line-height: 1.5;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      border-top: 1px solid var(--line);
      padding-top: 10px;
    }
    .member-detail {
      display: grid;
      gap: 18px;
    }
    .member-title {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 22px;
      color: var(--muted);
      background: rgba(255,253,247,.65);
    }
    footer {
      padding: 20px clamp(18px, 5vw, 70px) 34px;
      color: var(--muted);
      border-top: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    footer a { color: var(--muted); }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .family-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .media-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      header { min-height: 70vh; }
    }
    @media (max-width: 620px) {
      .grid { grid-template-columns: 1fr; }
      .family-grid { grid-template-columns: 1fr; }
      .media-grid { grid-template-columns: 1fr; }
      .section-head { display: block; }
      nav { align-items: flex-start; }
    }
  </style>
</head>
<body>
  <nav>
    <div class="brand">Omega</div>
    <a href="/admin.html">Admin</a>
  </nav>
  <header>
    <div class="hero">
      <h1 id="pageTitle">Grovey Baby</h1>
      <p class="lead" id="pageLead">A family shelf for things Omega makes: pages, phrasebooks, little tools, media, and shared memories worth keeping close.</p>
    </div>
  </header>
  <main>
    <section>
      <div class="section-head">
        <h2 id="sectionTitle">Family Shelves</h2>
        <p class="hint">Omega chooses where each public page, image, video, or file belongs. Private inbox files, diagnostics, and logs stay behind Jon's token.</p>
      </div>
      <div class="family-grid" id="families"></div>
      <div class="member-detail" id="memberDetail"></div>
    </section>
  </main>
  <footer>
    <span>Omega for the Grovey Baby family</span>
    <span id="updated">Loading</span>
  </footer>
  <script>
    const families = document.getElementById('families');
    const memberDetail = document.getElementById('memberDetail');
    const updated = document.getElementById('updated');
    const pageTitle = document.getElementById('pageTitle');
    const pageLead = document.getElementById('pageLead');
    const sectionTitle = document.getElementById('sectionTitle');
    let sections = [];
    let selected = selectedMemberFromLocation();
    const isMemberPage = /^\/family\/[^/]+\/?$/.test(location.pathname);
    if (isMemberPage) document.body.classList.add('member-page');
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
    function selectedMemberFromLocation() {
      const familyMatch = location.pathname.match(/^\/family\/([^/]+)\/?$/);
      if (familyMatch) return decodeURIComponent(familyMatch[1]);
      const query = new URLSearchParams(location.search).get('member');
      return query || 'General';
    }
    function renderFamilies() {
      families.innerHTML = sections.map(section => `
        <a class="card family-card" href="/family/${encodeURIComponent(section.member)}" aria-current="${section.member === selected ? 'page' : 'false'}">
          <div>
            <h3>${esc(section.member)}</h3>
            <p>${esc(section.summary)}</p>
          </div>
          <div class="meta"><span>${section.count} item${section.count === 1 ? '' : 's'}</span><span>${esc(section.latest || 'Waiting')}</span></div>
        </a>
      `).join('');
    }
    function pageCard(page) {
      return `
        <a class="card" href="${esc(page.url)}">
          <div>
            <h3>${esc(page.title)}</h3>
            <p>${esc(page.summary)}</p>
          </div>
          <div class="meta"><span>${esc(page.kind)}</span><span>${esc(page.modified)}</span></div>
        </a>
      `;
    }
    function mediaCard(item) {
      return `
        <a class="media" href="${esc(item.url)}">
          <div class="thumb">${item.kind === 'Video' ? `<video src="${esc(item.url)}" muted playsinline></video>` : `<img alt="" src="${esc(item.url)}">`}</div>
          <div class="media-info">
            <h3>${esc(item.title)}</h3>
            <p>${esc(item.caption)}</p>
          </div>
        </a>
      `;
    }
    function renderMember() {
      const section = sections.find(item => item.member === selected) || sections[0];
      if (!section) {
        memberDetail.innerHTML = '<div class="empty">Omega has not published anything yet.</div>';
        return;
      }
      const pages = section.pages || [];
      const gallery = section.gallery || [];
      if (isMemberPage) {
        document.title = `${section.member} - Omega for Grovey Baby`;
        pageTitle.textContent = section.member;
        pageLead.textContent = `${section.summary} Omega keeps this shelf for pages, images, videos, audio, and useful things made or saved for this part of the family.`;
        sectionTitle.textContent = 'Family Directory';
      }
      memberDetail.innerHTML = `
        <div class="member-title">
          <h2>${esc(section.member)}</h2>
          <p class="hint">${section.count ? `${section.count} public item${section.count === 1 ? '' : 's'} on this shelf.` : 'Nothing here yet.'}</p>
        </div>
        ${pages.length ? `<div class="grid">${pages.map(pageCard).join('')}</div>` : ''}
        ${gallery.length ? `<div class="media-grid">${gallery.map(mediaCard).join('')}</div>` : ''}
        ${!pages.length && !gallery.length ? '<div class="empty">Omega has not placed anything on this shelf yet.</div>' : ''}
      `;
    }
    async function loadFamilySections() {
      try {
        const res = await fetch('/api/family-sections', { cache: 'no-store' });
        const data = await res.json();
        sections = data.sections || [];
        if (!sections.some(item => item.member === selected)) selected = 'General';
        updated.textContent = `Updated ${data.now}`;
        renderFamilies();
        renderMember();
      } catch (err) {
        families.innerHTML = '<div class="empty">Could not load Omega shelves.</div>';
        memberDetail.innerHTML = '';
        updated.textContent = 'Offline';
      }
    }
    loadFamilySections();
  </script>
</body>
</html>
"""


OMEGA_OS_PORTAL_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Omega</title>
  <style>
    :root {
      --void: #010304;
      --ink: #f6f4eb;
      --muted: #aeb8ad;
      --line: rgba(218, 228, 214, .14);
      --glass: rgba(4, 8, 9, .70);
      --green: #8df2a8;
      --blue: #82d8e7;
      --amber: #f2c96d;
      --rose: #f0748e;
      --deep-red: #d54335;
      --shadow: 0 42px 160px rgba(0, 0, 0, .76);
      --convex: -18px -18px 44px rgba(180, 220, 198, .055), 24px 30px 70px rgba(0,0,0,.72);
      --concave: inset 18px 18px 44px rgba(0,0,0,.62), inset -12px -12px 32px rgba(180,220,198,.045);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      color: var(--ink);
      background:
        radial-gradient(circle at 50% 46%, rgba(141,242,168,.075), transparent 30%),
        radial-gradient(circle at 78% 18%, rgba(213,67,53,.06), transparent 27%),
        linear-gradient(160deg, #010304, #050707 46%, #0b0806 100%);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      z-index: 10;
      pointer-events: none;
      background:
        radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,.58) 100%),
        linear-gradient(180deg, rgba(255,255,255,.035), transparent 16%, transparent 78%, rgba(0,0,0,.34)),
        repeating-linear-gradient(180deg, rgba(255,255,255,.012) 0 1px, transparent 1px 7px);
      mix-blend-mode: screen;
      opacity: .36;
    }
    .arrival {
      position: relative;
      min-height: 100vh;
      perspective: 2200px;
      perspective-origin: 50% 46%;
      isolation: isolate;
      overflow: hidden;
    }
    .room {
      position: absolute;
      inset: -18vh -18vw;
      z-index: 2;
      transform-style: preserve-3d;
      overflow: hidden;
      transform: translateZ(180px) rotateX(1deg);
      opacity: .58;
    }
    .wall {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 48% 43%, rgba(141,242,168,.12), transparent 22%),
        radial-gradient(circle at 18% 62%, rgba(130,216,231,.065), transparent 30%),
        radial-gradient(circle at 84% 30%, rgba(213,67,53,.055), transparent 26%),
        linear-gradient(180deg, rgba(246,244,235,.045), transparent 22%, rgba(0,0,0,.42)),
        rgba(1, 5, 6, .88);
      border: 1px solid rgba(218,228,214,.055);
      opacity: .54;
      animation: wall-breathe 8.2s ease-in-out infinite;
      box-shadow: inset 0 0 220px rgba(141,242,168,.035), inset 0 0 280px rgba(130,216,231,.030);
    }
    .wall::before, .wall::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, transparent, rgba(246,244,235,.11), transparent),
        linear-gradient(180deg, transparent, rgba(141,242,168,.09), transparent);
      background-size: 900px 100%, 100% 780px;
      mix-blend-mode: screen;
      opacity: .08;
      animation: thought-sweep 13s linear infinite;
    }
    .wall::after {
      animation-duration: 12s;
      animation-direction: reverse;
      opacity: .07;
    }
    .back { transform: translateZ(-1650px) scale(4.2); }
    .left { transform-origin: left center; transform: rotateY(78deg) translateX(-5vw) translateZ(-220px) scaleX(2.8); }
    .right { transform-origin: right center; transform: rotateY(-78deg) translateX(5vw) translateZ(-220px) scaleX(2.8); }
    .floor {
      transform-origin: center bottom;
      transform: rotateX(82deg) translateY(33vh) translateZ(-360px) scale(3.1);
      background-size: 60px 60px, 60px 60px, auto, auto;
      opacity: .62;
      mask-image: linear-gradient(0deg, #000 6%, transparent 94%);
    }
    .ceiling {
      transform-origin: center top;
      transform: rotateX(-80deg) translateY(-38vh) translateZ(-420px) scale(3);
      opacity: .35;
      mask-image: linear-gradient(180deg, #000 4%, transparent 82%);
    }
    @keyframes wall-breathe {
      0%, 100% { filter: brightness(.72) saturate(.95); }
      50% { filter: brightness(1.08) saturate(1.18); }
    }
    @keyframes thought-sweep {
      from { background-position: -720px 0, 0 -680px; }
      to { background-position: 720px 0, 0 680px; }
    }
    .thought-stream {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      transform-style: preserve-3d;
    }
    .mind-map {
      position: absolute;
      inset: 0;
      z-index: 2;
      width: 100%;
      height: 100%;
      pointer-events: none;
      transform-origin: 50% 50%;
      opacity: .74;
      mix-blend-mode: screen;
      filter: drop-shadow(0 0 24px rgba(141,242,168,.16));
    }
    .mind-back {
      transform: translateZ(-1450px) scale(3.3);
      opacity: .88;
    }
    .mind-left {
      transform-origin: left center;
      transform: rotateY(78deg) translateX(-5vw) translateZ(-180px) scaleX(2.45);
      opacity: .42;
    }
    .mind-right {
      transform-origin: right center;
      transform: rotateY(-78deg) translateX(5vw) translateZ(-180px) scaleX(2.45);
      opacity: .42;
    }
    .mind-floor {
      inset: -6vh -6vw;
      width: 112vw;
      height: 112vh;
      transform: translateZ(-620px) rotateX(62deg) scale(2.45);
      opacity: .56;
      mask-image: linear-gradient(0deg, transparent 2%, #000 18%, #000 74%, transparent 100%);
    }
    .mind-path {
      fill: none;
      stroke: var(--stroke, rgba(116,220,148,.42));
      stroke-width: var(--weight, 1.4);
      stroke-linecap: round;
      stroke-dasharray: 1 22;
      animation: pathway-flow calc(var(--flow, 4.8s) / max(var(--thought-speed, 1), .45)) linear infinite;
      opacity: var(--alpha, .46);
    }
    .mind-path.backbone {
      stroke-dasharray: 90 540;
      stroke-width: calc(var(--weight, 1.4) + .45);
      opacity: calc(var(--alpha, .46) + .08);
    }
    .mind-path.secondary {
      stroke-dasharray: 1 26;
      opacity: .20;
    }
    .mind-node {
      fill: rgba(2, 6, 7, .72);
      stroke: rgba(141,242,168,.42);
      stroke-width: 1;
      filter: drop-shadow(0 0 14px rgba(141,242,168,.28));
    }
    .mind-node.hot {
      fill: rgba(116,220,148,.20);
      stroke: rgba(116,220,148,.82);
      animation: node-thought 2.6s ease-in-out infinite;
    }
    .mind-pulse {
      fill: rgba(246,244,235,.78);
      filter: drop-shadow(0 0 16px rgba(141,242,168,.82));
      animation: node-thought calc(1.9s / max(var(--thought-speed, 1), .55)) ease-in-out infinite;
    }
    .thought-packet {
      fill: rgba(246,244,235,.76);
      filter: drop-shadow(0 0 10px rgba(141,242,168,.55));
      opacity: .68;
      animation: packet-breathe calc(1.7s / max(var(--thought-speed, 1), .55)) ease-in-out infinite;
    }
    @keyframes pathway-flow {
      from { stroke-dashoffset: 80; filter: brightness(.8); }
      50% { filter: brightness(1.75); }
      to { stroke-dashoffset: 0; filter: brightness(.85); }
    }
    @keyframes node-thought {
      0%, 100% { opacity: .42; transform: scale(.82); }
      50% { opacity: 1; transform: scale(1.18); }
    }
    @keyframes packet-breathe {
      0%, 100% { opacity: .34; transform: scale(.8); }
      50% { opacity: .96; transform: scale(1.15); }
    }
    .thought-line {
      position: absolute;
      left: var(--x);
      top: var(--y);
      width: var(--w);
      height: var(--h);
      background: linear-gradient(90deg, transparent, var(--c), transparent);
      opacity: var(--o);
      transform: translateZ(var(--z)) rotateY(var(--ry)) rotateX(var(--rx)) rotateZ(var(--r));
      animation: drift var(--d) linear infinite, thought-pulse var(--p) ease-in-out infinite;
      box-shadow: 0 0 18px color-mix(in srgb, var(--c) 52%, transparent);
    }
    @keyframes drift {
      0% { translate: -12vw 0; opacity: .06; }
      40% { opacity: .42; }
      100% { translate: 112vw 0; opacity: .02; }
    }
    @keyframes thought-pulse {
      0%, 100% { filter: brightness(.85); scale: 1 .72; }
      50% { filter: brightness(1.6); scale: 1 1.25; }
    }
    .omega-core {
      position: absolute;
      z-index: 5;
      left: 50%;
      top: 45%;
      width: min(23vw, 280px);
      aspect-ratio: 1;
      transform: translate(-50%, -50%) rotateX(62deg) rotateZ(45deg) translateZ(120px);
      transform-style: preserve-3d;
      display: grid;
      place-items: center;
      filter: drop-shadow(0 44px 96px rgba(0,0,0,.76));
      cursor: pointer;
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .core-ring {
      position: absolute;
      inset: var(--inset);
      border: 1px solid color-mix(in srgb, var(--green) var(--mix), transparent);
      box-shadow: 0 0 54px rgba(141,242,168,.13), inset 0 0 40px rgba(130,216,231,.10);
      animation: breathe var(--speed) ease-in-out infinite;
    }
    .core-ring:nth-child(2n) {
      border-color: color-mix(in srgb, var(--blue) var(--mix), transparent);
      transform: rotateZ(22deg) translateZ(18px);
    }
    .core-center {
      position: absolute;
      inset: 42%;
      transform: rotateZ(-45deg) rotateX(-58deg) translateZ(70px);
      border: 1px solid rgba(185,205,184,.22);
      background:
        radial-gradient(circle at 32% 24%, rgba(246,244,235,.20), transparent 38%),
        linear-gradient(145deg, rgba(141,242,168,.16), rgba(130,216,231,.12)),
        rgba(4, 8, 10, .82);
      backdrop-filter: blur(18px);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 20px 60px rgba(0,0,0,.42);
      animation: core-glow 3.8s ease-in-out infinite;
    }
    @keyframes core-glow {
      0%, 100% { opacity: .62; transform: rotateZ(-45deg) rotateX(-58deg) translateZ(48px) scale(.9); }
      50% { opacity: 1; transform: rotateZ(-45deg) rotateX(-58deg) translateZ(92px) scale(1.08); }
    }
    @keyframes breathe {
      0%, 100% { transform: rotateZ(0deg) translateZ(0) scale(.96); opacity: .52; }
      50% { transform: rotateZ(12deg) translateZ(34px) scale(1.04); opacity: .95; }
    }
    .portal-access { display: none; }
    .particle-layer {
      position: absolute;
      inset: 0;
      z-index: 8;
      pointer-events: none;
      overflow: hidden;
    }
    .fluid-canvas {
      position: absolute;
      inset: 0;
      z-index: 3;
      width: 100%;
      height: 100%;
      pointer-events: none;
      mix-blend-mode: screen;
      opacity: .92;
    }
    .status {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(3, 6, 8, .58);
      backdrop-filter: blur(18px);
      padding: 10px 11px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
    }
    .status b { display: block; color: var(--green); margin-bottom: 3px; }
    .status span { color: var(--muted); font-size: 13px; }
    .chat-plane,
    .login-plane {
      position: absolute;
      z-index: 6;
      left: min(18vw, 220px);
      top: auto;
      bottom: clamp(18px, 5vh, 52px);
      width: min(860px, calc(100vw - 28px));
      min-width: min(360px, calc(100vw - 28px));
      min-height: 128px;
      transform: translateY(28px) scale(.96);
      opacity: 0;
      pointer-events: none;
      transition: opacity .34s ease, transform .34s ease, filter .34s ease, visibility 0s linear .34s;
      display: grid;
      gap: 10px;
      visibility: hidden;
      border: 1px solid rgba(246,244,235,.14);
      border-radius: 24px;
      padding: 14px;
      background:
        radial-gradient(circle at 14% 0%, rgba(246,244,235,.09), transparent 30%),
        linear-gradient(145deg, rgba(28, 40, 38, .52), rgba(1, 4, 5, .74)),
        rgba(3, 6, 8, .68);
      backdrop-filter: blur(32px) saturate(1.18);
      box-shadow: var(--shadow), var(--convex), var(--concave), 0 0 0 1px rgba(141,242,168,.035);
    }
    .login-plane {
      width: min(520px, calc(100vw - 28px));
      min-height: 0;
      z-index: 7;
    }
    body.chat-open .chat-plane,
    body.login-open .login-plane {
      transform: translateY(0) scale(1);
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
      transition-delay: 0s;
    }
    .chat-plane[data-dragging="true"],
    .login-plane[data-dragging="true"] { transition: none; }
    .window-drag {
      position: absolute;
      inset: 0 0 auto;
      height: 34px;
      cursor: grab;
      z-index: 2;
    }
    .window-drag:active { cursor: grabbing; }
    .login-copy {
      margin: 2px 4px 4px;
      color: rgba(246,244,235,.72);
      line-height: 1.45;
      font-size: 15px;
    }
    .login-grid {
      display: grid;
      gap: 9px;
      padding: 12px;
      border: 1px solid rgba(185,205,184,.12);
      border-radius: 20px;
      background:
        linear-gradient(145deg, rgba(0,0,0,.20), rgba(120,190,160,.025)),
        rgba(3, 6, 8, .58);
      box-shadow: var(--concave), inset 0 0 34px rgba(141,242,168,.025);
    }
    .login-grid label {
      display: grid;
      gap: 6px;
      color: rgba(246,244,235,.72);
      font-size: 12px;
      font-weight: 780;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .login-grid input {
      width: 100%;
      min-height: 44px;
      border: 1px solid rgba(116,220,148,.16);
      border-radius: 16px;
      outline: 0;
      padding: 8px 10px;
      color: var(--ink);
      background:
        linear-gradient(145deg, rgba(18, 34, 30, .72), rgba(2, 5, 6, .78)),
        rgba(3, 6, 8, .72);
      box-shadow: var(--concave);
      font: 16px/1.2 ui-sans-serif, system-ui, sans-serif;
    }
    .login-actions {
      display: flex;
      gap: 9px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-top: 3px;
    }
    .login-actions button,
    .login-actions a {
      min-height: 44px;
      border: 1px solid rgba(116,220,148,.24);
      border-radius: 16px;
      padding: 10px 14px;
      background:
        linear-gradient(145deg, rgba(34, 60, 46, .72), rgba(5, 12, 10, .78));
      color: var(--green);
      font: inherit;
      font-weight: 850;
      text-decoration: none;
      box-shadow: -10px -10px 24px rgba(180,220,198,.045), 12px 16px 34px rgba(0,0,0,.52), inset 0 1px 0 rgba(255,255,255,.05);
      cursor: pointer;
    }
    .transcript {
      max-height: min(42vh, 420px);
      overflow: auto;
      display: grid;
      gap: 9px;
      padding: 12px;
      border: 1px solid rgba(185,205,184,.12);
      border-radius: 20px;
      background:
        linear-gradient(145deg, rgba(0,0,0,.18), rgba(120,190,160,.025)),
        rgba(3, 6, 8, .50);
      backdrop-filter: blur(22px);
      box-shadow: var(--concave), inset 0 0 34px rgba(141,242,168,.025);
    }
    .transcript:empty { display: none; }
    .message {
      max-width: 82%;
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      border: 1px solid rgba(185,205,184,.14);
      border-radius: 18px;
      background:
        linear-gradient(145deg, rgba(22, 34, 31, .70), rgba(3, 7, 8, .74));
      box-shadow: -10px -10px 24px rgba(180,220,198,.035), 12px 14px 30px rgba(0,0,0,.48);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .message.inbound {
      justify-self: end;
      border-color: rgba(112,200,216,.28);
      background:
        linear-gradient(145deg, rgba(40, 70, 75, .48), rgba(3, 8, 10, .70));
    }
    .message.outbound {
      justify-self: start;
      border-color: rgba(116,220,148,.30);
      background:
        linear-gradient(145deg, rgba(38, 70, 48, .44), rgba(3, 8, 8, .70));
    }
    .meta {
      color: var(--muted);
      font-size: 11px;
      font-weight: 780;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .input-wrap {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 9px;
      padding: 10px;
      border: 1px solid rgba(116,220,148,.16);
      border-radius: 22px;
      background:
        linear-gradient(145deg, rgba(18, 34, 30, .74), rgba(2, 5, 6, .78)),
        rgba(3, 6, 8, .72);
      backdrop-filter: blur(24px);
      box-shadow: var(--concave), inset 0 1px 0 rgba(255,255,255,.05);
    }
    textarea {
      min-height: 54px;
      max-height: 180px;
      resize: vertical;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ink);
      font: 18px/1.35 ui-sans-serif, system-ui, sans-serif;
      padding: 6px 8px;
    }
    textarea::placeholder { color: rgba(244,247,239,.42); }
    .input-wrap button {
      min-width: 64px;
      border: 1px solid rgba(116,220,148,.28);
      border-radius: 18px;
      background:
        linear-gradient(145deg, rgba(34, 60, 46, .72), rgba(5, 12, 10, .78));
      color: var(--green);
      font: inherit;
      font-weight: 900;
      cursor: pointer;
      position: relative;
      box-shadow: -10px -10px 24px rgba(180,220,198,.045), 12px 16px 34px rgba(0,0,0,.52), inset 0 1px 0 rgba(255,255,255,.05);
    }
    .resize-handle {
      position: absolute;
      right: 5px;
      bottom: 5px;
      width: 28px;
      height: 28px;
      border-radius: 10px;
      cursor: nwse-resize;
      background:
        linear-gradient(135deg, transparent 50%, rgba(116,220,148,.30) 50% 56%, transparent 56% 63%, rgba(112,200,216,.20) 63% 68%, transparent 68%);
      opacity: .7;
    }
    .particle {
      position: absolute;
      left: 0;
      top: 0;
      z-index: 9;
      width: var(--s);
      height: var(--s);
      border-radius: 999px;
      pointer-events: none;
      background: var(--c);
      box-shadow: 0 0 18px var(--c);
      animation: materialize var(--t) ease-out forwards;
    }
    .particle.trail {
      mix-blend-mode: screen;
      filter: blur(.2px);
    }
    @keyframes materialize {
      from { opacity: 1; transform: translate(var(--x0), var(--y0)) scale(1); }
      to { opacity: 0; transform: translate(var(--x1), var(--y1)) scale(.08); }
    }
    .input-wrap button::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 18px;
      height: 18px;
      border-top: 2px solid var(--green);
      border-right: 2px solid var(--green);
      transform: translate(-65%, -50%) rotate(45deg);
      filter: drop-shadow(0 0 9px rgba(116,220,148,.42));
    }
    @media (max-width: 760px) {
      .omega-core { width: min(72vw, 360px); top: 46%; }
      .chat-plane { bottom: 12px; }
      .mind-left, .mind-right { opacity: .22; }
      .mind-back { transform: translateZ(-1280px) scale(3.8); }
      .transcript { max-height: 36vh; }
      .input-wrap { grid-template-columns: 1fr; }
      .input-wrap button { min-height: 46px; }
    }
  </style>
</head>
<body>
  <main class="arrival" id="arrival">
    <div class="room" aria-hidden="true">
      <div class="wall back"></div>
      <div class="wall left"></div>
      <div class="wall right"></div>
      <div class="wall floor"></div>
      <div class="wall ceiling"></div>
      <svg class="mind-map mind-back" id="mindMap" viewBox="0 0 1000 620" aria-hidden="true"></svg>
      <svg class="mind-map mind-left" id="mindMapLeft" viewBox="0 0 1000 620" aria-hidden="true"></svg>
      <svg class="mind-map mind-right" id="mindMapRight" viewBox="0 0 1000 620" aria-hidden="true"></svg>
      <svg class="mind-map mind-floor" id="mindMapFloor" viewBox="0 0 1000 620" aria-hidden="true"></svg>
      <div class="thought-stream" id="thoughtStream"></div>
    </div>
    <div class="particle-layer" id="particleLayer" aria-hidden="true"></div>
    <canvas class="fluid-canvas" id="mindCanvas" aria-hidden="true"></canvas>
    <nav class="portal-access" aria-label="Omega hidden navigation">
      <button type="button" id="openChat" aria-label="Open chat"></button>
      <a href="/workbench" aria-label="Workbench"></a>
      <a href="/admin.html" aria-label="Admin"></a>
      <a href="/family/General" aria-label="Family"></a>
    </nav>
    <button class="omega-core" id="core" type="button" aria-label="Open Omega chat">
      <span class="core-ring" style="--inset: 3%; --mix: 76%; --speed: 5.5s"></span>
      <span class="core-ring" style="--inset: 12%; --mix: 68%; --speed: 6.4s"></span>
      <span class="core-ring" style="--inset: 22%; --mix: 58%; --speed: 7.2s"></span>
      <span class="core-ring" style="--inset: 32%; --mix: 48%; --speed: 8.1s"></span>
      <span class="core-center" aria-hidden="true"></span>
    </button>
    <section class="chat-plane" id="chatWindow" aria-label="Omega chat">
      <div class="window-drag" aria-hidden="true"></div>
      <div class="transcript" id="transcript"></div>
      <form class="input-wrap" id="chatForm">
        <textarea id="chatInput" rows="2" aria-label="Message Omega"></textarea>
        <button type="submit" aria-label="Send message"></button>
      </form>
      <div class="resize-handle" aria-hidden="true"></div>
    </section>
    <section class="login-plane" id="loginWindow" aria-label="Omega sign in">
      <div class="window-drag" aria-hidden="true"></div>
      <p class="login-copy">Sign in to speak with Omega from this room.</p>
      <form class="login-grid" method="post" action="/login">
        <label>Name<input name="username" autocomplete="username"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password"></label>
        <div class="login-actions">
          <button type="submit">Enter</button>
          <a href="/login">Create account</a>
        </div>
      </form>
      <div class="resize-handle" aria-hidden="true"></div>
    </section>
  </main>
  <script>
    const $ = id => document.getElementById(id);
    const token = new URLSearchParams(location.search).get('token') || localStorage.getItem('omegaAdminToken') || '';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const SVG_NS = 'http://www.w3.org/2000/svg';
    let latestBrain = null;
    let authState = token ? true : null;
    let lastFluidAt = 0;
    let lastTrailAt = 0;
    const authPath = path => {
      if (!token) return path;
      const url = new URL(path, location.origin);
      url.searchParams.set('token', token);
      return `${url.pathname}${url.search}`;
    };
    function request(method, path, payload) {
      const target = authPath(path);
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, target, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`${xhr.status} ${xhr.statusText}`));
            return;
          }
          try { resolve(JSON.parse(xhr.responseText || '{}')); }
          catch (err) { reject(err); }
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.send(payload ? JSON.stringify(payload) : null);
      });
    }
    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
    function particleBurst(x, y, count = 46) {
      const layer = $('particleLayer');
      const colors = ['rgba(116,220,148,.9)', 'rgba(112,200,216,.82)', 'rgba(239,201,111,.72)'];
      for (let i = 0; i < count; i += 1) {
        const p = document.createElement('span');
        p.className = 'particle';
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 180;
        const size = 2 + Math.random() * 5;
        p.style.setProperty('--s', `${size}px`);
        p.style.setProperty('--c', colors[i % colors.length]);
        p.style.setProperty('--x0', `${x}px`);
        p.style.setProperty('--y0', `${y}px`);
        p.style.setProperty('--x1', `${x + Math.cos(angle) * dist}px`);
        p.style.setProperty('--y1', `${y + Math.sin(angle) * dist}px`);
        p.style.setProperty('--t', `${650 + Math.random() * 760}ms`);
        layer.appendChild(p);
        setTimeout(() => p.remove(), 1600);
      }
    }
    function pointerTrail(x, y) {
      const now = performance.now();
      if (now - lastTrailAt < 32) return;
      lastTrailAt = now;
      const layer = $('particleLayer');
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i += 1) {
        const p = document.createElement('span');
        const drift = 18 + Math.random() * 54;
        const angle = Math.random() * Math.PI * 2;
        const size = 1.5 + Math.random() * 3.5;
        p.className = 'particle trail';
        p.style.setProperty('--s', `${size}px`);
        p.style.setProperty('--c', i % 3 === 0 ? 'rgba(246,244,235,.62)' : (i % 2 ? 'rgba(141,242,168,.74)' : 'rgba(130,216,231,.62)'));
        p.style.setProperty('--x0', `${x + (Math.random() - .5) * 12}px`);
        p.style.setProperty('--y0', `${y + (Math.random() - .5) * 12}px`);
        p.style.setProperty('--x1', `${x + Math.cos(angle) * drift}px`);
        p.style.setProperty('--y1', `${y + Math.sin(angle) * drift}px`);
        p.style.setProperty('--t', `${420 + Math.random() * 420}ms`);
        layer.appendChild(p);
        setTimeout(() => p.remove(), 950);
      }
    }
    function summonWindow(win, event, preferredWidth = 520, preferredHeight = 220) {
      const width = Math.min(preferredWidth, window.innerWidth - 28);
      const height = Math.max(preferredHeight, win.getBoundingClientRect().height || preferredHeight);
      if (event && event.clientX != null) {
        win.style.left = `${clamp(event.clientX - width * .36, 14, window.innerWidth - width - 14)}px`;
        win.style.top = `${clamp(event.clientY - 42, 14, window.innerHeight - height - 14)}px`;
        particleBurst(event.clientX, event.clientY);
      } else {
        win.style.left = `${Math.max(14, (window.innerWidth - width) / 2)}px`;
        win.style.top = `${Math.max(14, window.innerHeight - height - 52)}px`;
        particleBurst(window.innerWidth / 2, window.innerHeight * .56, 34);
      }
      win.style.bottom = 'auto';
      win.style.width = `${width}px`;
    }
    function openChat(event) {
      const win = $('chatWindow');
      summonWindow(win, event, 860, 220);
      document.body.classList.remove('login-open');
      document.body.classList.add('chat-open');
      setTimeout(() => $('chatInput').focus(), 80);
    }
    function openLogin(event) {
      const win = $('loginWindow');
      summonWindow(win, event, 520, 220);
      document.body.classList.remove('chat-open');
      document.body.classList.add('login-open');
      setTimeout(() => win.querySelector('input[name="username"]').focus(), 80);
    }
    async function ensureAuth() {
      if (authState === true) return true;
      try {
        const session = await request('GET', '/api/os/session');
        authState = Boolean(session.admin);
        return authState;
      } catch (err) {
        authState = false;
        return false;
      }
    }
    async function enterOmega(event) {
      if (document.body.classList.contains('chat-open') || document.body.classList.contains('login-open')) return;
      const ok = await ensureAuth();
      if (ok) openChat(event);
      else openLogin(event);
    }
    function makeWindowDynamic(win) {
      const drag = win.querySelector('.window-drag');
      const resize = win.querySelector('.resize-handle');
      if (drag) {
        drag.addEventListener('pointerdown', event => {
          event.preventDefault();
          win.dataset.dragging = 'true';
          const box = win.getBoundingClientRect();
          const dx = event.clientX - box.left;
          const dy = event.clientY - box.top;
          const move = next => {
            win.style.left = `${clamp(next.clientX - dx, 8, window.innerWidth - box.width - 8)}px`;
            win.style.top = `${clamp(next.clientY - dy, 8, window.innerHeight - box.height - 8)}px`;
            win.style.bottom = 'auto';
          };
          const up = () => {
            win.dataset.dragging = 'false';
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
      if (resize) {
        resize.addEventListener('pointerdown', event => {
          event.preventDefault();
          const box = win.getBoundingClientRect();
          const startX = event.clientX;
          const startY = event.clientY;
          const move = next => {
            win.style.width = `${clamp(box.width + next.clientX - startX, 320, window.innerWidth - box.left - 8)}px`;
            win.style.height = `${clamp(box.height + next.clientY - startY, 146, window.innerHeight - box.top - 8)}px`;
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
    }
    function renderThoughtLines() {
      const colors = ['rgba(116,220,148,.82)', 'rgba(112,200,216,.78)', 'rgba(239,201,111,.58)', 'rgba(239,127,157,.48)'];
      $('thoughtStream').innerHTML = Array.from({ length: 86 }, (_, i) => {
        const x = `${Math.round(Math.random() * 90)}vw`;
        const y = `${Math.round(2 + Math.random() * 96)}vh`;
        const w = `${Math.round(140 + Math.random() * 520)}px`;
        const z = `${Math.round(-1800 + Math.random() * 1800)}px`;
        const r = `${Math.round(-18 + Math.random() * 36)}deg`;
        const ry = `${Math.round(-52 + Math.random() * 104)}deg`;
        const rx = `${Math.round(-22 + Math.random() * 44)}deg`;
        const d = `${Math.round(8 + Math.random() * 24)}s`;
        const p = `${Math.round(3 + Math.random() * 8)}s`;
        const h = `${Math.random() > .72 ? 2 : 1}px`;
        const o = `${(0.12 + Math.random() * 0.38).toFixed(2)}`;
        const c = colors[i % colors.length];
        return `<span class="thought-line" style="--x:${x};--y:${y};--w:${w};--z:${z};--r:${r};--ry:${ry};--rx:${rx};--d:${d};--p:${p};--h:${h};--o:${o};--c:${c}"></span>`;
      }).join('');
    }
    function setupOmegaMindSurface() {
      const canvas = $('mindCanvas');
      document.body.dataset.renderer = 'starting-webgl';
      const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'high-performance' })
        || canvas.getContext('experimental-webgl', { alpha: true, antialias: false });
      if (!gl) {
        window.omegaRenderer = 'svg-fallback-no-webgl';
        document.body.dataset.renderer = 'svg-fallback-no-webgl';
        canvas.style.display = 'none';
        return;
      }
      const vertexSource = `
        attribute vec2 a_position;
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `;
      const fragmentSource = `
        precision highp float;
        uniform vec2 u_resolution;
        uniform vec2 u_pointer;
        uniform float u_time;
        uniform float u_pointer_age;
        uniform float u_thought_speed;
        uniform float u_activity;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = mat2(1.62, 1.18, -1.18, 1.62) * p + 7.1;
            a *= 0.48;
          }
          return v;
        }
        float lineField(vec2 p, float angle, float spacing, float width) {
          vec2 dir = vec2(cos(angle), sin(angle));
          float d = abs(fract(dot(p, dir) * spacing) - 0.5);
          return smoothstep(width, 0.0, d);
        }
        float node(vec2 p, vec2 c, float r) {
          float d = length(p - c);
          return smoothstep(r, r * 0.58, d);
        }
        float stream(vec2 p, vec2 a, vec2 b, float width) {
          vec2 pa = p - a;
          vec2 ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          float d = length(pa - ba * h);
          float packet = smoothstep(0.98, 0.72, abs(fract(h * 2.0 - u_time * (.13 + u_thought_speed * .045)) - .5));
          return smoothstep(width, 0.0, d) * (0.24 + packet * 0.76);
        }
        void main() {
          vec2 frag = gl_FragCoord.xy;
          vec2 uv = (frag * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
          vec2 suv = frag / u_resolution.xy;
          vec2 p = uv;

          float t = u_time * (0.42 + u_thought_speed * 0.22);
          vec2 pointer = (u_pointer * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
          float pointerLife = exp(-u_pointer_age * 1.65);
          float pd = length(p - pointer);
          float ripple = sin(pd * 28.0 - u_time * 7.0) * exp(-pd * 3.4) * pointerLife;

          float chamber = smoothstep(1.55, 0.12, length(vec2(uv.x * .82, uv.y * 1.08)));
          float depth = pow(max(0.0, 1.0 - abs(uv.y + .10)), 2.0);
          float liquid = fbm(p * 2.25 + vec2(t * .18, -t * .12) + ripple * .18);
          float liquid2 = fbm(p * 5.5 - vec2(t * .12, t * .20) - ripple * .10);

          float grid = 0.0;
          grid += lineField(p + vec2(t * .022, 0.0), 0.35, 6.0, .030) * .16;
          grid += lineField(p - vec2(0.0, t * .018), 2.48, 7.5, .026) * .12;
          grid *= chamber;

          float graph = 0.0;
          vec2 c = vec2(0.0, -0.02);
          vec2 n1 = vec2(-0.74, -0.38);
          vec2 n2 = vec2(-0.52, 0.32);
          vec2 n3 = vec2(0.58, 0.24);
          vec2 n4 = vec2(0.72, -0.44);
          vec2 n5 = vec2(0.05, 0.46);
          graph += stream(p, c, n1, .010);
          graph += stream(p, c, n2, .008);
          graph += stream(p, c, n3, .009);
          graph += stream(p, c, n4, .010);
          graph += stream(p, c, n5, .007);
          graph += stream(p, n2, n3, .006) * .58;
          graph += stream(p, n1, n4, .006) * .42;
          graph += node(p, c, .07) * 1.2;
          graph += node(p, n1, .04);
          graph += node(p, n2, .035);
          graph += node(p, n3, .05);
          graph += node(p, n4, .035);
          graph += node(p, n5, .03);
          graph *= 0.55 + u_activity * .65;

          float core = node(p, c + vec2(0.0, sin(u_time * 0.7) * .012), .16);
          float halo = smoothstep(.62, .02, length(p - c)) * .18;
          float wallSweep = smoothstep(.018, .0, abs(fract((p.x + p.y * .22 + t * .11) * 1.35) - .5)) * .12 * chamber;
          float glow = graph + grid + core * .34 + halo + wallSweep + max(0.0, ripple) * .28;

          vec3 voidColor = vec3(0.004, 0.010, 0.012);
          vec3 deep = vec3(0.018, 0.040, 0.038);
          vec3 green = vec3(0.36, 1.00, 0.58);
          vec3 cyan = vec3(0.30, 0.80, 0.92);
          vec3 amber = vec3(1.00, 0.66, 0.24);
          vec3 red = vec3(0.72, 0.16, 0.10);

          vec3 color = mix(voidColor, deep, chamber * (.45 + liquid * .32));
          color += green * graph * .42;
          color += cyan * (grid + liquid2 * .045) * .38;
          color += amber * max(0.0, sin((p.x - p.y) * 4.0 + t * 1.4)) * .035 * chamber;
          color += red * smoothstep(.68, .08, length(p - vec2(.72, .36))) * .035;
          color += vec3(0.95, 0.96, 0.84) * glow * .18;
          color *= 0.72 + depth * .34;
          color = color / (1.0 + color * 0.82);
          color = pow(color, vec3(0.86));

          float vignette = smoothstep(1.42, .18, length(uv * vec2(.86, 1.05)));
          color *= .34 + vignette * .90;
          gl_FragColor = vec4(color, 0.92);
        }
      `;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      let program;
      try {
        program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      } catch (err) {
        window.omegaRenderer = 'svg-fallback-webgl-error';
        document.body.dataset.renderer = 'svg-fallback-webgl-error';
        canvas.style.display = 'none';
        return;
      }
      window.omegaRenderer = 'webgl-shader';
      document.body.dataset.renderer = 'webgl-shader';
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const loc = {
        position: gl.getAttribLocation(program, 'a_position'),
        resolution: gl.getUniformLocation(program, 'u_resolution'),
        pointer: gl.getUniformLocation(program, 'u_pointer'),
        time: gl.getUniformLocation(program, 'u_time'),
        pointerAge: gl.getUniformLocation(program, 'u_pointer_age'),
        thoughtSpeed: gl.getUniformLocation(program, 'u_thought_speed'),
        activity: gl.getUniformLocation(program, 'u_activity'),
      };
      const state = {
        pointerX: window.innerWidth * .5,
        pointerY: window.innerHeight * .52,
        pointerAt: performance.now() - 9000,
        thoughtSpeed: 1,
        activity: .42,
      };
      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
        canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        gl.viewport(0, 0, canvas.width, canvas.height);
      };
      const pushTrace = event => {
        state.pointerX += (event.clientX - state.pointerX) * .72;
        state.pointerY += (event.clientY - state.pointerY) * .72;
        state.pointerAt = performance.now();
        pointerTrail(event.clientX, event.clientY);
      };
      const draw = () => {
        const now = performance.now();
        const speed = Number(getComputedStyle(document.documentElement).getPropertyValue('--thought-speed') || 1);
        state.thoughtSpeed += (speed - state.thoughtSpeed) * .035;
        const recent = latestBrain?.spaces || [];
        const activeSpaces = recent.filter(space => Number(space.recent_activity || 0) > 0).length;
        const targetActivity = Math.min(1, .22 + activeSpaces * .08);
        state.activity += (targetActivity - state.activity) * .035;
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(loc.position);
        gl.vertexAttribPointer(loc.position, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(loc.resolution, canvas.width, canvas.height);
        gl.uniform2f(loc.pointer, state.pointerX * (canvas.width / window.innerWidth), (window.innerHeight - state.pointerY) * (canvas.height / window.innerHeight));
        gl.uniform1f(loc.time, now / 1000);
        gl.uniform1f(loc.pointerAge, Math.min(10, (now - state.pointerAt) / 1000));
        gl.uniform1f(loc.thoughtSpeed, state.thoughtSpeed);
        gl.uniform1f(loc.activity, state.activity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(draw);
      };
      resize();
      window.addEventListener('resize', resize);
      window.addEventListener('pointermove', pushTrace, { passive: true });
      requestAnimationFrame(draw);
    }
    function svgEl(name, attrs = {}) {
      const el = document.createElementNS(SVG_NS, name);
      Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
      return el;
    }
    function appendMindDefs(svg, suffix = '') {
      const defs = svgEl('defs');
      const glow = svgEl('filter', { id: `mindGlow${suffix}`, x: '-40%', y: '-40%', width: '180%', height: '180%' });
      glow.appendChild(svgEl('feGaussianBlur', { stdDeviation: '3.4', result: 'soft' }));
      const merge = svgEl('feMerge');
      merge.appendChild(svgEl('feMergeNode', { in: 'soft' }));
      merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
      glow.appendChild(merge);
      defs.appendChild(glow);
      svg.appendChild(defs);
    }
    function renderMindGraph(brain) {
      const architecture = brain?.architecture || {};
      const nodes = architecture.nodes || [];
      const flows = architecture.flows || [];
      const spaces = brain?.spaces || [];
      if (!nodes.length) return;
      const hot = new Set(spaces.filter(space => Number(space.recent_activity || 0) > 0).map(space => space.name));
      const nodeMap = new Map();
      nodes.forEach((node, index) => {
        const ring = Math.floor(index / 6);
        const slot = index % 6;
        const angle = (Math.PI * 2 * slot / 6) + ring * .38;
        const radius = 120 + ring * 92;
        const x = 500 + Math.cos(angle) * radius;
        const y = 310 + Math.sin(angle) * radius * .62;
        nodeMap.set(node.id, { ...node, x, y });
      });
      document.querySelectorAll('.mind-map').forEach((svg, layerIndex) => {
        svg.innerHTML = '';
        appendMindDefs(svg, layerIndex);
        flows.forEach((flow, index) => {
          const a = nodeMap.get(flow.from);
          const b = nodeMap.get(flow.to);
          if (!a || !b) return;
          const midx = (a.x + b.x) / 2 + Math.sin(index + layerIndex) * (42 + layerIndex * 9);
          const midy = (a.y + b.y) / 2 - 46 + Math.cos(index * .7 + layerIndex) * (32 + layerIndex * 6);
          const active = hot.has(a.id) || hot.has(b.id) || ['metta', 'skills', 'spaces', 'provider', 'loop'].includes(a.id);
          const assumeFlow = flow.to === 'assume' || flow.from === 'assume' || flow.to === 'fabric' || flow.from === 'fabric';
          const color = assumeFlow ? 'rgba(242,201,109,.74)' : (flow.to === 'provider' ? 'rgba(130,216,231,.76)' : (flow.to === 'actions' ? 'rgba(213,67,53,.58)' : 'rgba(141,242,168,.74)'));
          const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${midx.toFixed(1)} ${midy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
          svg.appendChild(svgEl('path', {
            class: `mind-path backbone ${active ? '' : 'secondary'}`,
            d,
            'data-flow': `${flow.from || ''}->${flow.to || ''}`,
            filter: `url(#mindGlow${layerIndex})`,
            style: `--stroke:${color};--flow:${(5.8 + (index % 9) * .55 + layerIndex * .7).toFixed(1)}s;--weight:${active ? 1.05 : .62};--alpha:${active ? .40 : .14}`
          }));
          if (active && layerIndex < 2) {
            const packet = svgEl('circle', {
              class: 'thought-packet',
              r: assumeFlow ? '3.8' : '3.0',
            });
            const animate = svgEl('animateMotion', {
              dur: `${(3.6 + (index % 5) * .7).toFixed(1)}s`,
              repeatCount: 'indefinite',
              begin: `${(index % 6) * .18}s`,
              path: d,
            });
            packet.appendChild(animate);
            svg.appendChild(packet);
          }
        });
        nodeMap.forEach(node => {
          const active = hot.has(node.id) || ['loop', 'metta', 'spaces', 'skills', 'provider'].includes(node.id);
          svg.appendChild(svgEl('circle', {
            class: `mind-node ${active ? 'hot' : ''}`,
            cx: node.x.toFixed(1),
            cy: node.y.toFixed(1),
            r: active ? 7 : 4.5,
            'data-node': node.id,
          }));
          if (active) {
            svg.appendChild(svgEl('circle', {
              class: 'mind-pulse',
              cx: node.x.toFixed(1),
              cy: node.y.toFixed(1),
              r: 2.6,
            }));
          }
        });
      });
    }
    function renderChat(messages) {
      const rows = (messages || []).slice(-80).map(message => {
        const direction = message.direction === 'outbound' ? 'outbound' : 'inbound';
        const who = direction === 'outbound' ? 'Omega' : (message.from || 'Jon');
        return `<div class="message ${direction}"><div class="meta">${esc(who)} | ${esc(message.at || '')}</div><div>${esc(message.text || '')}</div></div>`;
      }).join('');
      $('transcript').innerHTML = rows;
      $('transcript').scrollTop = $('transcript').scrollHeight;
    }
    function summon(title, html) {
      return { title, html };
    }
    async function refresh() {
      try {
        const overview = await request('GET', '/api/workbench/overview');
        authState = true;
        document.documentElement.style.setProperty('--thought-speed', overview.omega?.running ? '1' : '.45');
      } catch (err) {
        if (!token) authState = false;
        document.documentElement.style.setProperty('--thought-speed', '.3');
      }
      try {
        latestBrain = await request('GET', '/api/workbench/brain');
        renderMindGraph(latestBrain);
      } catch (err) {}
      try {
        await request('GET', '/api/workbench/resources');
      } catch (err) {}
      try {
        const chat = await request('GET', '/api/os/chat');
        renderChat(chat.messages || []);
      } catch (err) {}
    }
    async function send(text) {
      await request('POST', '/api/os/chat', { text });
      await refresh();
    }
    $('openChat').addEventListener('click', openChat);
    $('arrival').addEventListener('pointerdown', event => {
      if (event.target.closest('.chat-plane') || event.target.closest('.login-plane') || event.target.closest('.portal-access')) return;
      enterOmega(event);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !document.body.classList.contains('chat-open') && !document.body.classList.contains('login-open')) {
        event.preventDefault();
        enterOmega();
      }
    });
    $('chatInput').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('chatForm').requestSubmit();
      }
    });
    $('chatForm').addEventListener('submit', async event => {
      event.preventDefault();
      const text = $('chatInput').value.trim();
      if (!text) return;
      $('chatInput').value = '';
      try { await send(text); }
      catch (err) { renderChat([{ direction: 'outbound', from: 'Omega OS', at: '', text: err.message }]); }
    });
    makeWindowDynamic($('chatWindow'));
    makeWindowDynamic($('loginWindow'));
    setupOmegaMindSurface();
    renderThoughtLines();
    refresh();
    setInterval(refresh, 3500);
  </script>
</body>
</html>
"""


DIAGNOSTICS_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Omega Admin</title>
  <style>
    :root {
      --bg: #f6f4ef;
      --ink: #17201c;
      --muted: #67716b;
      --line: #d9d6cc;
      --panel: #fffdf7;
      --panel-2: #eef4f2;
      --green: #2f7d5f;
      --blue: #365f91;
      --red: #a6423a;
      --amber: #a46b22;
      --shadow: 0 18px 45px rgba(28, 32, 27, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      padding: 28px clamp(18px, 4vw, 56px) 18px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--panel) 86%, transparent);
      position: sticky;
      top: 0;
      z-index: 5;
      backdrop-filter: blur(14px);
    }
    .topbar {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 18px;
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 52px);
      line-height: 0.95;
      font-weight: 760;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: 10px;
      color: var(--muted);
      font-size: 15px;
    }
    .auth {
      display: flex;
      gap: 8px;
      align-items: center;
      min-width: min(100%, 440px);
    }
    input, select, button {
      height: 38px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 7px;
      padding: 0 11px;
      font: inherit;
    }
    input { min-width: 0; flex: 1; }
    button {
      cursor: pointer;
      font-weight: 680;
    }
    button.primary {
      background: var(--ink);
      color: #fffdf7;
      border-color: var(--ink);
    }
    .nav-link {
      height: 38px;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 7px;
      padding: 0 11px;
      font-weight: 680;
      text-decoration: none;
      white-space: nowrap;
    }
    main {
      padding: 24px clamp(18px, 4vw, 56px) 46px;
      display: grid;
      gap: 20px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .metric {
      padding: 16px;
      min-height: 108px;
    }
    .metric-label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .metric-value {
      margin-top: 12px;
      font-size: 26px;
      font-weight: 760;
      overflow-wrap: anywhere;
    }
    .metric-detail {
      margin-top: 7px;
      color: var(--muted);
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(340px, .8fr);
      gap: 20px;
      align-items: start;
    }
    .panel {
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }
    h2 {
      margin: 0;
      font-size: 16px;
      letter-spacing: 0;
    }
    .panel-body { padding: 14px; }
    .service-list, .artifact-list {
      display: grid;
      gap: 8px;
    }
    .activity-list {
      display: grid;
      gap: 8px;
      max-height: 520px;
      overflow: auto;
    }
    .service, .artifact {
      display: grid;
      grid-template-columns: 12px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 10px;
      background: #fffefa;
    }
    .activity {
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 10px;
      background: #fffefa;
    }
    .activity-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
    }
    .activity-kind {
      font-weight: 760;
      color: var(--blue);
    }
    .wide {
      grid-column: 1 / -1;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 99px;
      background: var(--muted);
    }
    .dot.ok { background: var(--green); }
    .dot.bad { background: var(--red); }
    .dot.warn { background: var(--amber); }
    .name {
      font-weight: 710;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
      overflow-wrap: anywhere;
    }
    .pill {
      border-radius: 99px;
      border: 1px solid var(--line);
      padding: 4px 8px;
      color: var(--muted);
      font-size: 12px;
      background: var(--panel);
      white-space: nowrap;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    pre {
      margin: 0;
      padding: 14px;
      min-height: 420px;
      max-height: 62vh;
      overflow: auto;
      background: #111815;
      color: #e8efe9;
      border-radius: 7px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .preview {
      border: 1px solid var(--line);
      border-radius: 7px;
      min-height: 320px;
      background: #111815;
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .preview img, .preview video {
      max-width: 100%;
      max-height: 520px;
      display: block;
    }
    .preview iframe {
      width: 100%;
      height: 520px;
      border: 0;
      background: white;
    }
    .empty {
      color: var(--muted);
      padding: 18px;
    }
    .hidden { display: none; }
    @media (max-width: 980px) {
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
      .topbar { align-items: stretch; flex-direction: column; }
      .auth { width: 100%; }
    }
    @media (max-width: 560px) {
      .metrics { grid-template-columns: 1fr; }
      .auth { flex-wrap: wrap; }
      input { flex-basis: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <h1>Omega Admin</h1>
        <div class="subtitle" id="clock">Waiting for telemetry</div>
      </div>
      <div class="auth">
        <a class="nav-link" href="/">Home</a>
        <a class="nav-link" href="/workbench">Workbench</a>
        <input id="token" type="password" autocomplete="off" placeholder="Admin token">
        <button class="primary" id="saveToken">Unlock</button>
        <button id="refresh">Refresh</button>
      </div>
    </div>
  </header>
  <main>
    <section class="metrics">
      <div class="metric"><div class="metric-label">Omega</div><div class="metric-value" id="omegaState">-</div><div class="metric-detail" id="omegaPid">-</div></div>
      <div class="metric"><div class="metric-label">Webhost</div><div class="metric-value" id="webState">-</div><div class="metric-detail">omega.groveybaby.family</div></div>
      <div class="metric"><div class="metric-label">Tunnel</div><div class="metric-value" id="tunnelState">-</div><div class="metric-detail">Cloudflare named tunnel</div></div>
      <div class="metric"><div class="metric-label">Artifacts</div><div class="metric-value" id="artifactCount">-</div><div class="metric-detail" id="diskState">-</div></div>
    </section>
    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <h2>Artifacts</h2>
          <div class="toolbar">
            <select id="artifactFilter">
              <option value="all">All</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="html">Pages</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div class="panel-body">
          <div class="artifact-list" id="artifacts"></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Preview</h2>
          <span class="pill" id="previewName">none</span>
        </div>
        <div class="panel-body">
          <div class="preview" id="preview"><div class="empty">Select an artifact</div></div>
        </div>
      </div>
    </section>
    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <h2>Services</h2>
          <span class="pill" id="updatedAt">-</span>
        </div>
        <div class="panel-body"><div class="service-list" id="services"></div></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Activity Summary</h2>
          <span class="pill" id="activityCount">-</span>
        </div>
        <div class="panel-body"><div class="activity-list" id="activity"></div></div>
      </div>
    </section>
    <section>
      <div class="panel wide">
        <div class="panel-head">
          <h2>Terminal Output</h2>
          <div class="toolbar">
            <select id="logTarget">
              <option value="terminal">live terminal</option>
              <option value="omega">omega.log</option>
              <option value="history">history.metta</option>
              <option value="webhost">webhost service</option>
              <option value="cloudflared">cloudflared</option>
              <option value="persistent">persistent memory</option>
            </select>
            <button id="loadLog">Load</button>
            <button id="toggleFollow">Following</button>
          </div>
        </div>
        <div class="panel-body"><pre id="log">Unlock diagnostics</pre></div>
      </div>
    </section>
  </main>
  <script>
    const els = Object.fromEntries([...document.querySelectorAll('[id]')].map(el => [el.id, el]));
    let artifacts = [];
    let followLog = true;
    let followActivity = true;
    let logTimer = null;
    let statusTimer = null;
    const token = () => localStorage.getItem('omegaAdminToken') || els.token.value.trim();
    const headers = () => ({ 'X-Omega-Admin-Token': token() });
    function setToken() {
      if (els.token.value.trim()) localStorage.setItem('omegaAdminToken', els.token.value.trim());
      loadAll();
    }
    async function api(path) {
      const res = await fetch(path, { headers: headers(), cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    }
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }
    function stateDot(state) {
      if (state === 'active' || state === true) return 'ok';
      if (state === 'inactive' || state === false) return 'bad';
      return 'warn';
    }
    function typeOf(item) {
      const ext = item.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return 'image';
      if (['mp4','webm'].includes(ext)) return 'video';
      if (['html','htm'].includes(ext)) return 'html';
      return 'other';
    }
    function renderServices(status) {
      els.services.innerHTML = status.services.map(s => `
        <div class="service">
          <span class="dot ${stateDot(s.state)}"></span>
          <div><div class="name">${s.name}</div><div class="meta">${s.detail || ''}</div></div>
          <span class="pill">${s.state}</span>
        </div>`).join('');
    }
    function renderActivity(items) {
      els.activityCount.textContent = `${items.length} events`;
      els.activity.innerHTML = items.map(item => `
        <div class="activity">
          <div class="activity-top">
            <div class="activity-kind">${esc(item.kind)}</div>
            <span class="pill">${esc(item.time)}</span>
          </div>
          <div class="meta">${esc(item.detail)}</div>
        </div>`).join('') || '<div class="empty">No recent loop activity</div>';
      if (followActivity) {
        els.activity.scrollTop = els.activity.scrollHeight;
      }
    }
    function renderArtifacts() {
      const filter = els.artifactFilter.value;
      const visible = artifacts.filter(a => filter === 'all' || typeOf(a) === filter);
      els.artifacts.innerHTML = visible.map(a => `
        <button class="artifact" data-id="${a.id}">
          <span class="dot ${a.exists ? 'ok' : 'bad'}"></span>
          <div><div class="name">${a.name}</div><div class="meta">${a.group} | ${a.size_human} | ${a.modified}</div></div>
          <span class="pill">${typeOf(a)}</span>
        </button>`).join('') || '<div class="empty">No artifacts</div>';
      document.querySelectorAll('.artifact').forEach(btn => {
        btn.addEventListener('click', () => preview(artifacts.find(a => a.id === btn.dataset.id)));
      });
    }
    function artifactUrl(a) {
      return `/artifact/${encodeURIComponent(a.group)}/${a.path.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token())}`;
    }
    function preview(a) {
      if (!a) return;
      els.previewName.textContent = a.name;
      const url = artifactUrl(a);
      const kind = typeOf(a);
      if (kind === 'image') els.preview.innerHTML = `<img alt="" src="${url}">`;
      else if (kind === 'video') els.preview.innerHTML = `<video src="${url}" controls playsinline></video>`;
      else if (kind === 'html') els.preview.innerHTML = `<iframe src="${url}"></iframe>`;
      else els.preview.innerHTML = `<div class="empty"><a href="${url}" target="_blank" rel="noreferrer">Open ${a.name}</a></div>`;
    }
    async function loadStatus() {
      const status = await api('/api/status');
      els.clock.textContent = status.now;
      els.updatedAt.textContent = status.now_short;
      els.omegaState.textContent = status.omega.running ? 'running' : 'stopped';
      els.omegaPid.textContent = status.omega.detail;
      els.webState.textContent = status.webhost;
      els.tunnelState.textContent = status.cloudflared;
      els.diskState.textContent = status.disk;
      renderServices(status);
    }
    async function loadArtifacts() {
      const data = await api('/api/artifacts');
      artifacts = data.artifacts;
      els.artifactCount.textContent = artifacts.length;
      renderArtifacts();
    }
    async function loadActivity() {
      const nearBottom = els.activity.scrollHeight - els.activity.scrollTop - els.activity.clientHeight < 80;
      const data = await api('/api/activity?limit=90');
      renderActivity(data.events || []);
      if (followActivity || nearBottom) {
        els.activity.scrollTop = els.activity.scrollHeight;
      }
    }
    async function loadLog() {
      try {
        const nearBottom = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 80;
        const target = encodeURIComponent(els.logTarget.value);
        const data = await api(`/api/logs?target=${target}&lines=900`);
        els.log.textContent = data.text || '';
        if (followLog || nearBottom) {
          els.log.scrollTop = els.log.scrollHeight;
        }
      } catch (err) {
        els.log.textContent = `Log unavailable: ${err.message}`;
      }
    }
    async function loadAll() {
      try {
        await Promise.all([loadStatus(), loadArtifacts(), loadActivity()]);
        await loadLog();
      } catch (err) {
        els.log.textContent = `Diagnostics locked or unavailable: ${err.message}`;
      }
    }
    els.saveToken.addEventListener('click', setToken);
    els.refresh.addEventListener('click', loadAll);
    els.artifactFilter.addEventListener('change', renderArtifacts);
    els.loadLog.addEventListener('click', loadLog);
    els.log.addEventListener('scroll', () => {
      followLog = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 80;
      els.toggleFollow.textContent = followLog ? 'Following' : 'Paused';
    });
    els.activity.addEventListener('scroll', () => {
      followActivity = els.activity.scrollHeight - els.activity.scrollTop - els.activity.clientHeight < 80;
    });
    els.toggleFollow.addEventListener('click', () => {
      followLog = !followLog;
      els.toggleFollow.textContent = followLog ? 'Following' : 'Paused';
      if (followLog) {
        els.log.scrollTop = els.log.scrollHeight;
      }
    });
    els.logTarget.addEventListener('change', () => {
      followLog = true;
      els.toggleFollow.textContent = 'Following';
      loadLog();
    });
    els.token.value = localStorage.getItem('omegaAdminToken') || '';
    loadAll();
    logTimer = setInterval(loadLog, 2500);
    setInterval(() => loadActivity().catch(() => {}), 2500);
    statusTimer = setInterval(() => {
      loadStatus().catch(() => {});
      loadArtifacts().catch(() => {});
    }, 10000);
  </script>
</body>
</html>
"""

WORKBENCH_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Omega Workbench</title>
  <style>
    :root {
      --bg: #080a0d;
      --ink: #f3f6ee;
      --muted: #9da79e;
      --line: rgba(181, 198, 177, .2);
      --panel: rgba(16, 22, 23, .78);
      --panel-2: rgba(31, 38, 36, .72);
      --glass: rgba(7, 11, 13, .74);
      --glass-2: rgba(18, 28, 28, .58);
      --green: #72d58f;
      --blue: #6fb7c8;
      --rose: #e56f91;
      --amber: #e7bd62;
      --red: #f06a64;
      --violet: #b89cff;
      --copper: #d39258;
      --shadow: 0 28px 80px rgba(0, 0, 0, .46);
      --edge: inset 0 1px 0 rgba(255,255,255,.07), 0 32px 90px rgba(0,0,0,.45);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        linear-gradient(90deg, rgba(114,213,143,.035) 1px, transparent 1px),
        linear-gradient(180deg, rgba(111,183,200,.032) 1px, transparent 1px),
        linear-gradient(135deg, #05070a, #0d1312 42%, #17120e 100%);
      background-size: 64px 64px, 64px 64px, auto;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 42% -18% -18%;
      z-index: -2;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(111,183,200,.15) 1px, transparent 1px),
        linear-gradient(0deg, rgba(114,213,143,.13) 1px, transparent 1px);
      background-size: 90px 90px;
      transform: perspective(780px) rotateX(62deg) translateY(80px);
      transform-origin: 50% 0;
      opacity: .34;
      mask-image: linear-gradient(180deg, transparent, #000 18%, #000 68%, transparent);
    }
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(255,255,255,.035), transparent 12%, transparent 76%, rgba(0,0,0,.32)),
        repeating-linear-gradient(180deg, rgba(255,255,255,.018) 0 1px, transparent 1px 4px);
      mix-blend-mode: screen;
      opacity: .5;
    }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 236px minmax(0, 1fr);
    }
    aside {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 24px 15px;
      display: flex;
      flex-direction: column;
      gap: 22px;
      border-right: 1px solid rgba(181,198,177,.18);
      background:
        linear-gradient(180deg, rgba(255,255,255,.045), transparent 18%),
        rgba(3, 6, 8, .78);
      backdrop-filter: blur(24px);
      box-shadow: inset -1px 0 0 rgba(255,255,255,.04);
    }
    .brand {
      display: grid;
      gap: 8px;
      padding: 6px 6px 14px;
      border-bottom: 1px solid var(--line);
    }
    .brand h1 {
      margin: 0;
      font-size: 32px;
      letter-spacing: 0;
      line-height: 1;
      text-shadow: 0 0 22px rgba(114,213,143,.2);
    }
    .brand h1::after {
      content: " OS";
      color: var(--green);
      font-size: 12px;
      vertical-align: super;
      margin-left: 5px;
      letter-spacing: .12em;
    }
    .brand p { margin: 0; color: var(--muted); line-height: 1.45; font-size: 13px; }
    nav { display: grid; gap: 6px; }
    nav button, nav a {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 12px 10px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-weight: 720;
      text-decoration: none;
      cursor: pointer;
    }
    nav button[aria-current="page"] {
      border-color: color-mix(in srgb, var(--green) 45%, var(--line));
      background:
        linear-gradient(90deg, rgba(114,213,143,.18), rgba(114,213,143,.04)),
        rgba(255,255,255,.02);
      color: var(--green);
      box-shadow: inset 0 0 18px rgba(114,213,143,.08);
    }
    .side-foot { margin-top: auto; display: grid; gap: 8px; color: var(--muted); font-size: 12px; }
    main { min-width: 0; padding: 14px clamp(18px, 3vw, 34px) 36px; }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      margin-bottom: 12px;
      padding: 8px 0 2px;
    }
    .headline h2 {
      margin: 0;
      font-size: clamp(34px, 4.4vw, 62px);
      line-height: .9;
      letter-spacing: 0;
      max-width: 12ch;
      text-shadow: 0 18px 70px rgba(114,213,143,.16);
    }
    .headline p { margin: 9px 0 0; color: var(--muted); max-width: 58ch; line-height: 1.45; }
    .top-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: end; }
    .omega-desktop {
      position: relative;
      min-height: 560px;
      margin: 0 0 14px;
      border: 1px solid rgba(181,198,177,.18);
      border-radius: 8px;
      overflow: hidden;
      background:
        radial-gradient(circle at 18% 18%, rgba(114,213,143,.12), transparent 24%),
        radial-gradient(circle at 78% 28%, rgba(111,183,200,.14), transparent 26%),
        linear-gradient(135deg, rgba(255,255,255,.045), transparent 24%),
        rgba(5, 8, 10, .66);
      box-shadow: var(--edge);
    }
    .omega-desktop::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(114,213,143,.12) 1px, transparent 1px),
        linear-gradient(180deg, rgba(111,183,200,.10) 1px, transparent 1px);
      background-size: 44px 44px;
      opacity: .22;
      mask-image: linear-gradient(180deg, #000, transparent 82%);
    }
    .summon-dock {
      position: absolute;
      z-index: 9;
      left: 16px;
      right: 16px;
      bottom: 14px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 9px;
      border: 1px solid rgba(181,198,177,.18);
      border-radius: 8px;
      background: rgba(3, 6, 8, .76);
      backdrop-filter: blur(18px);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
    }
    .summon-dock button {
      border: 1px solid rgba(181,198,177,.2);
      border-radius: 999px;
      background: rgba(255,255,255,.045);
      color: var(--ink);
      padding: 8px 11px;
      font: inherit;
      font-size: 12px;
      font-weight: 820;
      cursor: pointer;
    }
    .summon-dock button[data-active="true"] {
      color: var(--green);
      border-color: rgba(114,213,143,.55);
      background: rgba(114,213,143,.11);
    }
    .os-window {
      position: absolute;
      z-index: 2;
      left: var(--x, 24px);
      top: var(--y, 24px);
      width: var(--w, 420px);
      height: var(--h, 360px);
      min-width: 280px;
      min-height: 220px;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      border: 1px solid rgba(181,198,177,.22);
      border-radius: 8px;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255,255,255,.075), transparent 28%),
        rgba(6, 10, 12, .82);
      box-shadow: 0 26px 78px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05);
      backdrop-filter: blur(18px);
    }
    .os-window[data-minimized="true"] { display: none; }
    .os-window[data-front="true"] {
      z-index: 8;
      border-color: rgba(114,213,143,.42);
      box-shadow: 0 34px 92px rgba(0,0,0,.52), 0 0 0 1px rgba(114,213,143,.08), inset 0 1px 0 rgba(255,255,255,.06);
    }
    .window-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 42px;
      padding: 9px 11px;
      border-bottom: 1px solid rgba(181,198,177,.16);
      background: linear-gradient(90deg, rgba(114,213,143,.14), rgba(111,183,200,.07), transparent);
      cursor: grab;
      user-select: none;
    }
    .window-bar:active { cursor: grabbing; }
    .window-title { display: flex; align-items: center; gap: 8px; font-weight: 880; }
    .window-title::before {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 16px rgba(114,213,143,.64);
    }
    .window-tools { display: flex; gap: 6px; }
    .window-tools button {
      width: 25px;
      height: 25px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(181,198,177,.18);
      border-radius: 999px;
      background: rgba(255,255,255,.035);
      color: var(--muted);
      cursor: pointer;
    }
    .window-body {
      min-height: 0;
      padding: 12px;
      overflow: auto;
    }
    .window-resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 22px;
      height: 22px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, rgba(114,213,143,.46) 50%, rgba(114,213,143,.46) 58%, transparent 58%);
    }
    .chat-window { --x: 22px; --y: 22px; --w: min(470px, calc(100% - 44px)); --h: 472px; }
    .summon-window { --x: min(520px, 44vw); --y: 54px; --w: min(620px, calc(100% - 550px)); --h: 384px; }
    .gallery-window { --x: min(700px, 55vw); --y: 178px; --w: min(420px, calc(100% - 730px)); --h: 292px; }
    .chat-log {
      height: calc(100% - 76px);
      min-height: 220px;
      display: grid;
      align-content: end;
      gap: 9px;
      overflow: auto;
      padding-right: 4px;
    }
    .chat-message {
      max-width: 92%;
      display: grid;
      gap: 4px;
      padding: 10px 11px;
      border: 1px solid rgba(181,198,177,.16);
      border-radius: 8px;
      background: rgba(255,255,255,.045);
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .chat-message.outbound {
      justify-self: start;
      border-color: rgba(114,213,143,.26);
      background: rgba(114,213,143,.08);
    }
    .chat-message.inbound {
      justify-self: end;
      border-color: rgba(111,183,200,.28);
      background: rgba(111,183,200,.08);
    }
    .chat-meta { color: var(--muted); font-size: 11px; font-weight: 760; text-transform: uppercase; letter-spacing: .04em; }
    .chat-form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      margin-top: 10px;
    }
    .chat-form textarea {
      min-height: 58px;
      max-height: 140px;
      resize: vertical;
      border: 1px solid rgba(181,198,177,.22);
      border-radius: 8px;
      background: rgba(0,0,0,.24);
      color: var(--ink);
      padding: 10px;
      font: inherit;
    }
    .chat-form button {
      border: 1px solid rgba(114,213,143,.44);
      border-radius: 8px;
      background: rgba(114,213,143,.13);
      color: var(--green);
      font: inherit;
      font-weight: 860;
      padding: 0 16px;
      cursor: pointer;
    }
    .summon-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px;
    }
    .summon-card {
      min-height: 96px;
      display: grid;
      align-content: space-between;
      gap: 9px;
      border: 1px solid rgba(181,198,177,.16);
      border-radius: 8px;
      padding: 11px;
      background: rgba(255,255,255,.035);
      cursor: pointer;
    }
    .summon-card strong { font-size: 15px; }
    .gallery-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .gallery-tile {
      aspect-ratio: 1;
      border: 1px solid rgba(181,198,177,.16);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(255,255,255,.045);
    }
    .gallery-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .gallery-strip .empty { grid-column: 1 / -1; }
    .chip, button.action {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(5, 8, 10, .78);
      padding: 9px 12px;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
    }
    button.action { color: var(--ink); cursor: pointer; font-weight: 760; }
    button.action[data-active="true"] {
      color: var(--green);
      border-color: rgba(114,213,143,.62);
      background: rgba(114,213,143,.12);
    }
    .mode-banner {
      margin-bottom: 14px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      padding: clamp(16px, 2.4vw, 24px);
      border: 1px solid rgba(114,213,143,.28);
      border-radius: 8px;
      position: relative;
      overflow: hidden;
      background:
        linear-gradient(92deg, rgba(114,213,143,.16), rgba(111,183,200,.08) 42%, transparent),
        linear-gradient(180deg, rgba(255,255,255,.055), transparent),
        rgba(5, 9, 11, .78);
      box-shadow: var(--edge);
    }
    .mode-banner::before {
      content: "";
      position: absolute;
      left: 16px;
      right: 16px;
      top: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(114,213,143,.88), rgba(111,183,200,.48), transparent);
    }
    .mode-banner::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px),
        linear-gradient(180deg, rgba(255,255,255,.03) 1px, transparent 1px);
      background-size: 82px 82px;
      opacity: .24;
    }
    .mode-kicker {
      position: relative;
      z-index: 1;
      color: var(--green);
      font-size: 12px;
      font-weight: 880;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .mode-title {
      position: relative;
      z-index: 1;
      margin-top: 4px;
      font-size: clamp(38px, 5vw, 78px);
      line-height: .84;
      font-weight: 880;
      overflow-wrap: anywhere;
      max-width: 12ch;
    }
    .mode-detail {
      position: relative;
      z-index: 1;
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.45;
      overflow-wrap: anywhere;
      max-width: 86ch;
    }
    .mode-stats {
      position: relative;
      z-index: 1;
      min-width: 230px;
      display: grid;
      gap: 8px;
    }
    .grid { display: grid; gap: 14px; }
    .observatory {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) minmax(330px, .48fr);
      gap: 14px;
      margin-bottom: 16px;
    }
    .field {
      min-height: clamp(620px, 68vh, 780px);
      position: relative;
      overflow: hidden;
      perspective: 1100px;
      background:
        linear-gradient(125deg, rgba(114,213,143,.09), transparent 34%),
        linear-gradient(238deg, rgba(111,183,200,.12), transparent 45%),
        linear-gradient(330deg, rgba(184,156,255,.08), transparent 48%),
        rgba(8, 12, 14, .82);
    }
    .field::before {
      content: "";
      position: absolute;
      inset: 14px;
      border: 1px solid rgba(114,213,143,.24);
      border-radius: 8px;
      pointer-events: none;
      box-shadow: inset 0 0 56px rgba(114,213,143,.055);
    }
    .field::after {
      content: "";
      position: absolute;
      left: -12%;
      right: -12%;
      bottom: 108px;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(111,183,200,.46), rgba(231,189,98,.32), transparent);
      transform: rotateX(64deg);
      transform-origin: center;
      pointer-events: none;
    }
    .field-head {
      position: absolute;
      z-index: 2;
      top: 18px;
      left: 18px;
      right: 18px;
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 14px;
      pointer-events: none;
    }
    .field-head > div:first-child {
      max-width: min(520px, 58%);
      padding: 12px 13px;
      border: 1px solid rgba(181,198,177,.14);
      border-radius: 8px;
      background: rgba(5, 8, 10, .62);
      backdrop-filter: blur(12px);
    }
    .field-head h3 {
      margin: 0;
      font-size: clamp(22px, 3vw, 34px);
      line-height: .95;
      letter-spacing: 0;
      max-width: 16ch;
    }
    .field-head p {
      margin: 8px 0 0;
      color: var(--muted);
      max-width: 58ch;
      line-height: 1.45;
    }
    .field-state {
      min-width: 128px;
      text-align: right;
      color: var(--green);
      font-weight: 860;
      letter-spacing: .08em;
      text-transform: uppercase;
      font-size: 12px;
    }
    #cognitiveField {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      transform: rotateX(5deg) translateY(4px);
      transform-origin: 50% 58%;
    }
    .cycle-rail {
      position: absolute;
      z-index: 3;
      left: 18px;
      right: 18px;
      bottom: 18px;
      display: grid;
      grid-template-columns: repeat(8, minmax(0, 1fr));
      gap: 7px;
      padding: 9px;
      border: 1px solid rgba(181,198,177,.2);
      border-radius: 8px;
      background: rgba(5, 8, 10, .72);
      backdrop-filter: blur(14px);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.045);
    }
    .cycle-step {
      min-height: 58px;
      display: grid;
      align-content: space-between;
      gap: 6px;
      border: 1px solid rgba(181,198,177,.16);
      border-radius: 7px;
      padding: 8px;
      background: rgba(255,255,255,.035);
      color: var(--muted);
      overflow: hidden;
    }
    .cycle-step[data-active="true"] {
      border-color: rgba(114,213,143,.62);
      color: var(--ink);
      background: linear-gradient(180deg, rgba(114,213,143,.18), rgba(255,255,255,.035));
      box-shadow: inset 0 0 18px rgba(114,213,143,.08);
    }
    .cycle-step strong {
      font-size: 12px;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }
    .cycle-step span {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .replay {
      display: grid;
      gap: 10px;
      margin-bottom: 16px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.055), transparent),
        rgba(8, 12, 14, .72);
    }
    .replay-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .replay-strip {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(168px, 1fr);
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .cycle-card {
      min-height: 118px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.05), transparent),
        rgba(255,255,255,.035);
      color: var(--ink);
      padding: 10px;
      text-align: left;
      font: inherit;
      cursor: pointer;
      display: grid;
      align-content: space-between;
      gap: 8px;
    }
    .cycle-card[aria-current="true"] {
      border-color: rgba(114,213,143,.7);
      background: linear-gradient(180deg, rgba(114,213,143,.15), rgba(255,255,255,.045));
    }
    .cycle-card:hover {
      border-color: rgba(111,183,200,.62);
    }
    .cycle-card strong {
      font-size: 13px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .cycle-card span {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .phase-dots {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .phase-dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      border: 1px solid rgba(181,198,177,.28);
      background: rgba(255,255,255,.06);
    }
    .phase-dot[data-on="true"] { background: var(--green); border-color: var(--green); box-shadow: 0 0 10px rgba(114,213,143,.42); }
    .cycle-detail {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, .48fr);
      gap: 10px;
    }
    .phase-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .phase {
      min-height: 92px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px;
      background: rgba(255,255,255,.035);
      display: grid;
      align-content: space-between;
      gap: 8px;
    }
    .phase[data-active="true"] {
      border-color: rgba(114,213,143,.55);
      background: rgba(114,213,143,.09);
    }
    .phase strong { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .phase span { color: var(--muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .transform-stack {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .transform-card {
      min-height: 132px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 11px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.055), transparent),
        rgba(255,255,255,.035);
      display: grid;
      align-content: space-between;
      gap: 10px;
    }
    .transform-card[data-active="true"] {
      border-color: rgba(114,213,143,.6);
      background: linear-gradient(180deg, rgba(114,213,143,.12), rgba(255,255,255,.04));
    }
    .transform-card strong {
      font-size: 12px;
      color: var(--green);
      text-transform: uppercase;
      letter-spacing: .05em;
    }
    .transform-card span {
      color: var(--ink);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .delta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .delta-chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
      background: rgba(255,255,255,.04);
    }
    .delta-chip[data-on="true"] {
      color: var(--green);
      border-color: rgba(114,213,143,.46);
      background: rgba(114,213,143,.09);
    }
    .field-plane {
      fill: none;
      stroke: rgba(157,167,158,.14);
      stroke-width: 1.2;
      stroke-dasharray: 8 16;
      vector-effect: non-scaling-stroke;
    }
    .field-plane-label {
      fill: rgba(243,246,238,.58);
      font-size: 12px;
      font-weight: 820;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .field-link {
      stroke: rgba(157,167,158,.24);
      stroke-width: 1.4;
      vector-effect: non-scaling-stroke;
    }
    .field-link[data-layer="memory"], .field-link[data-layer="persistence"] { stroke: rgba(231,189,98,.28); }
    .field-link[data-layer="voice"], .field-link[data-layer="senses"] { stroke: rgba(111,183,200,.3); }
    .field-link[data-layer="prediction"] { stroke: rgba(184,156,255,.3); }
    .field-link[data-layer="immune"] { stroke: rgba(229,111,145,.3); }
    .field-link[data-active="true"] {
      stroke: rgba(114,213,143,.48);
      stroke-width: 2;
      filter: drop-shadow(0 0 7px rgba(114,213,143,.36));
      animation: flowWake 1.6s ease-in-out infinite;
    }
    .field-pulse {
      stroke: var(--green);
      stroke-width: 2.4;
      stroke-linecap: round;
      opacity: .8;
      filter: drop-shadow(0 0 8px rgba(114,213,143,.6));
      animation: dash 3.2s linear infinite;
    }
    @keyframes dash { to { stroke-dashoffset: -120; } }
    @keyframes flowWake {
      0%, 100% { opacity: .45; }
      45% { opacity: 1; stroke-width: 3; }
    }
    .field-node {
      cursor: pointer;
    }
    .field-node circle {
      fill: rgba(14, 19, 20, .82);
      stroke: var(--green);
      stroke-width: 2;
      filter: drop-shadow(0 0 10px rgba(114,213,143,.32));
      vector-effect: non-scaling-stroke;
    }
    .field-node[data-active="true"] circle {
      fill: rgba(114,213,143,.12);
      stroke-width: 3;
    }
    .field-node[data-pressure="medium"] circle { stroke: var(--amber); filter: drop-shadow(0 0 10px rgba(231,189,98,.34)); }
    .field-node[data-pressure="high"] circle { stroke: var(--rose); filter: drop-shadow(0 0 12px rgba(229,111,145,.42)); }
    .field-node[data-layer="immune"] circle { stroke: var(--rose); }
    .field-node[data-layer="prediction"] circle { stroke: var(--violet); }
    .field-node[data-layer="memory"] circle,
    .field-node[data-layer="persistence"] circle { stroke: var(--amber); }
    .field-node[data-layer="senses"] circle,
    .field-node[data-layer="voice"] circle { stroke: var(--blue); }
    .field-node text {
      fill: var(--ink);
      font-size: 13px;
      font-weight: 780;
      text-anchor: middle;
      pointer-events: none;
    }
    .field-node .node-sub {
      fill: var(--muted);
      font-size: 10px;
      font-weight: 640;
    }
    .field-node[data-active="true"] .node-sub {
      fill: rgba(243,246,238,.82);
    }
    .field-node[data-selected="true"] circle {
      stroke-width: 3;
      filter: drop-shadow(0 0 18px rgba(114,213,143,.72));
    }
    .omega-core circle {
      fill: rgba(114,213,143,.1);
      stroke: var(--ink);
      filter: drop-shadow(0 0 24px rgba(114,213,143,.7));
    }
    .inspector {
      display: grid;
      gap: 14px;
    }
    .inspector-main {
      min-height: 300px;
      padding: 18px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.08), transparent),
        rgba(7,12,13,.78);
    }
    .inspector-kicker {
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .inspector-title {
      margin: 14px 0 0;
      font-size: clamp(28px, 3vw, 42px);
      line-height: .95;
      font-weight: 870;
      overflow-wrap: anywhere;
    }
    .inspector-copy {
      margin: 18px 0 0;
      color: var(--muted);
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    .provenance {
      display: grid;
      gap: 8px;
    }
    .provenance-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,.035);
      padding: 10px 11px;
      color: var(--muted);
      font-size: 13px;
    }
    .provenance-row strong {
      color: var(--ink);
      font-weight: 780;
      overflow-wrap: anywhere;
    }
    .presence {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(300px, .85fr);
      gap: 14px;
      margin-bottom: 14px;
    }
    .presence-main {
      position: relative;
      min-height: 330px;
      display: grid;
      align-content: space-between;
      padding: clamp(22px, 4vw, 36px);
      overflow: hidden;
    }
    .presence-main::before {
      content: "";
      position: absolute;
      inset: 18px;
      border: 1px solid rgba(45,124,97,.18);
      border-radius: 8px;
      pointer-events: none;
    }
    .presence-kicker {
      position: relative;
      z-index: 1;
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .presence-title {
      position: relative;
      z-index: 1;
      margin: 12px 0 0;
      max-width: 12ch;
      font-size: clamp(54px, 9vw, 112px);
      line-height: .88;
      letter-spacing: 0;
      font-weight: 880;
    }
    .presence-detail {
      position: relative;
      z-index: 1;
      max-width: 72ch;
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    .presence-focus {
      position: relative;
      z-index: 1;
      margin-top: 22px;
      padding: 13px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,.045);
      font-weight: 760;
      overflow-wrap: anywhere;
    }
    .presence-side {
      display: grid;
      gap: 14px;
    }
    .signal-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .signal {
      min-height: 118px;
      display: grid;
      align-content: space-between;
      gap: 9px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.06), transparent),
        rgba(8,12,14,.7);
    }
    .signal-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 820;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .signal-value {
      font-weight: 820;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .evidence-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .evidence-strip span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 9px;
      color: var(--muted);
      background: rgba(255,255,255,.045);
      font-size: 12px;
      font-weight: 720;
    }
    .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 14px; }
    .layout { grid-template-columns: minmax(0, 1.25fr) minmax(320px, .75fr); }
    .panel {
      min-width: 0;
      border: 1px solid rgba(181,198,177,.16);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.045), transparent 36%),
        var(--panel);
      box-shadow: var(--edge);
      overflow: hidden;
      backdrop-filter: blur(18px);
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 14px 15px;
      border-bottom: 1px solid var(--line);
    }
    .panel h3 { margin: 0; font-size: 16px; letter-spacing: 0; }
    .panel-body { padding: 14px; }
    .metric {
      min-height: 116px;
      display: grid;
      align-content: space-between;
      gap: 10px;
      padding: 15px;
    }
    .metric-label { color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .metric-value { font-size: clamp(22px, 3vw, 34px); line-height: 1; font-weight: 850; overflow-wrap: anywhere; }
    .metric-detail { color: var(--muted); font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    .timeline, .cards, .kanban-preview { display: grid; gap: 10px; }
    .event, .goal, .loop, .assume-card, .resource-row {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,.045);
      padding: 11px;
    }
    .event {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }
    .event-time, .meta { color: var(--muted); font-size: 12px; }
    .event-kind { font-weight: 820; color: var(--blue); }
    .event-summary, .goal-title { font-weight: 740; overflow-wrap: anywhere; }
    .event-source { color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 3px 7px; font-size: 12px; }
    .brain {
      position: relative;
      min-height: 360px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      align-items: stretch;
    }
    .organ {
      position: relative;
      display: grid;
      align-content: space-between;
      min-height: 104px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: linear-gradient(145deg, rgba(255,255,255,.06), rgba(255,255,255,.025));
      overflow: hidden;
    }
    .organ[data-active="true"]::after {
      content: "";
      position: absolute;
      inset: -35%;
      background: radial-gradient(circle, rgba(45,124,97,.23), transparent 42%);
      animation: pulse 2.2s ease-in-out infinite;
    }
    .organ-name { position: relative; z-index: 1; font-weight: 850; }
    .organ-detail { position: relative; z-index: 1; color: var(--muted); font-size: 12px; line-height: 1.4; }
    @keyframes pulse { 0%,100% { transform: scale(.72); opacity: .25; } 50% { transform: scale(1); opacity: .9; } }
    .goal { display: grid; gap: 7px; }
    .goal-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .status {
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 760;
      border: 1px solid var(--line);
      color: var(--muted);
      background: rgba(255,255,255,.045);
    }
    .status.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 42%, var(--line)); }
    .status.warn { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 42%, var(--line)); }
    .status.bad { color: var(--red); border-color: color-mix(in srgb, var(--red) 42%, var(--line)); }
    .open-loop-list { display: grid; gap: 9px; }
    .loop { border-left: 4px solid var(--amber); }
    .loop.high { border-left-color: var(--red); }
    .loop.low { border-left-color: var(--green); }
    .resource-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }
    .bar {
      height: 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.09);
      overflow: hidden;
      margin-top: 7px;
    }
    .bar span { display: block; height: 100%; background: var(--green); border-radius: inherit; }
    .bar span.warn { background: var(--amber); }
    .bar span.bad { background: var(--red); }
    .empty { color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; padding: 14px; }
    .page { display: none; }
    .page.active { display: grid; gap: 14px; }
    .columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .column { min-width: 0; display: grid; align-content: start; gap: 10px; }
    .column h4 { margin: 0; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .pre {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      border-radius: 8px;
      background: #050708;
      color: #e7eee8;
      padding: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    @media (max-width: 1080px) {
      .shell { grid-template-columns: 1fr; }
      aside { position: static; height: auto; padding-bottom: 12px; }
      nav { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .layout, .metrics, .columns, .presence, .observatory, .mode-banner { grid-template-columns: 1fr; }
      .brain { grid-template-columns: repeat(2, 1fr); }
      .topbar { align-items: stretch; flex-direction: column; }
      .top-actions { justify-content: start; }
      .omega-desktop { min-height: 940px; }
      .os-window {
        position: relative;
        left: auto;
        top: auto;
        width: auto;
        height: auto;
        min-height: 300px;
        margin: 14px;
      }
      .chat-window, .summon-window, .gallery-window { --w: auto; --h: auto; }
      .chat-log { height: 320px; }
      .mode-stats { min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .mode-title { max-width: none; }
    }
    @media (max-width: 620px) {
      main { padding: 14px; }
      aside { padding: 14px; }
      nav { grid-template-columns: 1fr; }
      .brain { grid-template-columns: 1fr; }
      .event { grid-template-columns: 1fr; }
      .presence-title { font-size: 52px; }
      .signal-grid { grid-template-columns: 1fr; }
      .field { min-height: 560px; }
      .field-head { position: relative; }
      .field-head > div:first-child { max-width: none; }
      #cognitiveField { position: relative; min-height: 410px; }
      .cycle-rail { position: relative; left: auto; right: auto; bottom: auto; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0 14px 14px; }
      .cycle-detail, .phase-grid, .transform-stack, .mode-stats { grid-template-columns: 1fr; }
      .summon-grid, .chat-form { grid-template-columns: 1fr; }
      .gallery-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .replay-strip { grid-auto-columns: minmax(220px, 86vw); }
    }
    @media (min-width: 1500px) {
      .shell { grid-template-columns: 268px minmax(0, 1fr); }
      .observatory { grid-template-columns: minmax(0, 1.78fr) minmax(400px, .48fr); }
      .field { min-height: 780px; }
      .layout { grid-template-columns: minmax(0, 1.45fr) minmax(380px, .55fr); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand">
        <h1>Omega</h1>
        <p>Spatial interface for conversation, instruments, memory, prediction, and care.</p>
      </div>
      <nav>
        <button data-page="command" aria-current="page">Now <span>live</span></button>
        <button data-page="goals">Goals <span id="navGoalCount">-</span></button>
        <button data-page="brain">Brain <span id="navPulseCount">-</span></button>
        <button data-page="assume">Assume <span id="navAssumeCount">-</span></button>
        <button data-page="resources">Resources <span id="navResourceState">-</span></button>
        <a href="/admin.html">Diagnostics <span>raw</span></a>
        <a href="/">Family <span>home</span></a>
      </nav>
      <div class="side-foot">
        <span id="sessionState">Omega OS surface</span>
        <span id="lastUpdated">Waiting for data</span>
      </div>
    </aside>
    <main>
      <div class="topbar">
        <div class="headline">
          <h2>Omega Observatory</h2>
          <p>Spatial operating surface over Omega's real body, traces, goals, prediction substrate, and web-control channel. It gives Omega another place to hear and answer.</p>
        </div>
        <div class="top-actions">
          <span class="chip" id="omegaChip">Omega -</span>
          <span class="chip" id="energyChip">Energy -</span>
          <button class="action" id="liveMode" data-active="true">Live</button>
          <button class="action" id="replayMode">Replay latest</button>
          <button class="action" id="refresh">Refresh</button>
        </div>
      </div>

      <section class="omega-desktop" id="omegaDesktop" aria-label="Omega OS desktop">
        <section class="os-window chat-window" id="window-chat" data-window-id="chat" data-front="true">
          <div class="window-bar">
            <div class="window-title">Omega Chat</div>
            <div class="window-tools">
              <button type="button" data-window-close="chat" aria-label="Hide chat">-</button>
            </div>
          </div>
          <div class="window-body">
            <div class="chat-log" id="osChatLog">
              <div class="empty">Opening a real web-control channel into Omega's receive loop.</div>
            </div>
            <form class="chat-form" id="osChatForm">
              <textarea id="osChatText" rows="2" placeholder="Talk to Omega from the OS..."></textarea>
              <button type="submit">Send</button>
            </form>
          </div>
          <div class="window-resize" aria-hidden="true"></div>
        </section>

        <section class="os-window summon-window" id="window-summon" data-window-id="summon">
          <div class="window-bar">
            <div class="window-title">Summon Surface</div>
            <div class="window-tools">
              <button type="button" data-window-close="summon" aria-label="Hide summon surface">-</button>
            </div>
          </div>
          <div class="window-body">
            <div class="summon-grid">
              <button class="summon-card" type="button" data-page-jump="command"><strong>Architecture</strong><span class="meta">Loop, provider, MeTTa, skills, spaces, Assume.</span></button>
              <button class="summon-card" type="button" data-page-jump="goals"><strong>Goals</strong><span class="meta">Agenda board and current intentions.</span></button>
              <button class="summon-card" type="button" data-page-jump="assume"><strong>Assume</strong><span class="meta">Prediction graphs and evidence traces.</span></button>
              <button class="summon-card" type="button" data-page-jump="resources"><strong>Body</strong><span class="meta">VM, process, cost, and resource state.</span></button>
            </div>
          </div>
          <div class="window-resize" aria-hidden="true"></div>
        </section>

        <section class="os-window gallery-window" id="window-gallery" data-window-id="gallery">
          <div class="window-bar">
            <div class="window-title">Family Artifacts</div>
            <div class="window-tools">
              <button type="button" data-window-close="gallery" aria-label="Hide artifacts">-</button>
            </div>
          </div>
          <div class="window-body">
            <div class="gallery-strip" id="osGallery">
              <div class="empty">Artifacts appear here when the gallery index is available.</div>
            </div>
          </div>
          <div class="window-resize" aria-hidden="true"></div>
        </section>

        <div class="summon-dock">
          <button type="button" data-os-summon="chat" data-active="true">Chat</button>
          <button type="button" data-os-summon="summon" data-active="true">Summon</button>
          <button type="button" data-os-summon="gallery" data-active="true">Artifacts</button>
          <button type="button" data-page-jump="command">Circuit</button>
          <button type="button" data-page-jump="goals">Goals</button>
          <button type="button" data-page-jump="resources">Resources</button>
        </div>
      </section>

      <section class="page active" id="page-command">
        <div class="mode-banner" id="modeBanner">
          <div>
            <div class="mode-kicker" id="modeKicker">Live substrate</div>
            <div class="mode-title" id="modeTitle">Watching Omega now</div>
            <div class="mode-detail" id="modeDetail">The circuit follows recent loop activity. Select a cycle below to replay one exact history trace.</div>
          </div>
          <div class="mode-stats" id="modeStats"></div>
        </div>
        <div class="observatory">
          <div class="panel field">
            <div class="field-head">
              <div>
                <h3>Architecture Circuit</h3>
                <p id="fieldCaption">Loading OmegaClaw loop, cognition provider, MeTTa substrate, skills, spaces, and body apps.</p>
              </div>
              <div class="field-state" id="fieldState">syncing</div>
            </div>
            <svg id="cognitiveField" viewBox="0 0 1000 620" role="img" aria-label="Omega cognitive field"></svg>
            <div class="cycle-rail" id="cycleRail" aria-label="OmegaClaw live loop phases"></div>
          </div>
          <div class="inspector">
            <div class="panel inspector-main">
              <div class="inspector-kicker" id="inspectorKind">Selected substrate</div>
              <div class="inspector-title" id="inspectorTitle">Omega</div>
              <p class="inspector-copy" id="inspectorCopy">The field is built from live spaces, history pulses, process state, and Assume graph summaries.</p>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Provenance</h3><span class="status">real data</span></div>
              <div class="panel-body"><div class="provenance" id="provenanceRows"></div></div>
            </div>
          </div>
        </div>
        <div class="panel replay">
          <div class="panel-head">
            <h3>Cycle Replay</h3>
            <div class="replay-actions">
              <span class="status" id="cycleCount">history trace</span>
              <button class="action" id="clearReplay">Return live</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="transform-stack" id="transformStack"></div>
            <div class="delta-row" id="cycleDeltas"></div>
            <div class="replay-strip" id="cycleReplay"></div>
            <div class="cycle-detail">
              <div class="phase-grid" id="cyclePhases"></div>
              <div class="provenance" id="cycleEvidence"></div>
            </div>
          </div>
        </div>
        <div class="presence">
          <div class="panel presence-main">
            <div>
              <div class="presence-kicker">Omega now</div>
              <div class="presence-title" id="presenceState">Waiting</div>
              <p class="presence-detail" id="presenceDetail">Loading Omega's live state from the substrate.</p>
            </div>
            <div>
              <div class="presence-focus" id="presenceFocus">No current focus loaded yet.</div>
              <div class="evidence-strip" id="evidenceStrip"></div>
            </div>
          </div>
          <div class="presence-side">
            <div class="panel">
              <div class="panel-head"><h3>Needs Jon</h3><span class="status" id="needStatus">checking</span></div>
              <div class="panel-body"><div class="goal-title" id="presenceNeed">Checking open loops.</div></div>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Sense - Reason - Act - Remember</h3><span class="status">trace</span></div>
              <div class="panel-body"><div class="signal-grid" id="signalRow"></div></div>
            </div>
          </div>
        </div>
        <div class="grid metrics" id="metrics"></div>
        <div class="grid layout">
          <div class="panel">
            <div class="panel-head"><h3>Live Timeline</h3><span class="status" id="timelineCount">-</span></div>
            <div class="panel-body"><div class="timeline" id="timeline"></div></div>
          </div>
          <div class="grid">
            <div class="panel">
              <div class="panel-head"><h3>Open Loops</h3><span class="status warn" id="openLoopCount">-</span></div>
              <div class="panel-body"><div class="open-loop-list" id="openLoops"></div></div>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Current Goals</h3><span class="status" id="goalCount">-</span></div>
              <div class="panel-body"><div class="cards" id="goalPreview"></div></div>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Assume Snapshot</h3><span class="status" id="assumeCount">-</span></div>
              <div class="panel-body"><div class="cards" id="assumePreview"></div></div>
            </div>
          </div>
        </div>
      </section>

      <section class="page" id="page-goals">
        <div class="panel">
          <div class="panel-head"><h3>Agenda Kanban</h3><span class="status">from &agenda</span></div>
          <div class="panel-body"><div class="columns" id="kanban"></div></div>
        </div>
      </section>

      <section class="page" id="page-brain">
        <div class="panel">
          <div class="panel-head"><h3>Living Brain</h3><span class="status">real pulses only</span></div>
          <div class="panel-body"><div class="brain" id="brain"></div></div>
        </div>
      </section>

      <section class="page" id="page-assume">
        <div class="panel">
          <div class="panel-head"><h3>Prediction Lab</h3><span class="status">read-only</span></div>
          <div class="panel-body"><div class="cards" id="assumeLab"></div></div>
        </div>
      </section>

      <section class="page" id="page-resources">
        <div class="panel">
          <div class="panel-head"><h3>Resource Body</h3><span class="status">VM-local</span></div>
          <div class="panel-body"><div class="cards" id="resources"></div></div>
        </div>
      </section>
    </main>
  </div>
  <script>
    const state = { overview: null, timeline: [], agenda: null, brain: null, assume: null, resources: null, cycles: [], chat: [], gallery: [] };
    let selectedCycleId = null;
    const $ = id => document.getElementById(id);
    const adminToken = new URLSearchParams(location.search).get('token') || localStorage.getItem('omegaAdminToken') || '';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const pct = value => Math.max(0, Math.min(100, Number(value || 0)));
    const statusClass = value => value === 'ok' || value === 'active' || value === true ? 'ok' : (value === 'bad' || value === 'inactive' || value === false ? 'bad' : 'warn');
    function authPath(path) {
      if (!adminToken) return path;
      const url = new URL(path, location.origin);
      url.searchParams.set('token', adminToken);
      return `${url.pathname}${url.search}`;
    }
    async function api(path) {
      const target = authPath(path);
      if (typeof fetch === 'function') {
        const res = await fetch(target, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return await res.json();
      }
      if (typeof XMLHttpRequest === 'function') {
        return await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', target, true);
          xhr.setRequestHeader('Cache-Control', 'no-store');
          xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
              reject(new Error(`${xhr.status} ${xhr.statusText}`));
              return;
            }
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (err) { reject(err); }
          };
          xhr.onerror = () => reject(new Error('network error'));
          xhr.send();
        });
      }
      return await new Promise((resolve, reject) => {
        const callback = `omegaJsonp${Date.now()}${Math.floor(Math.random() * 100000)}`;
        const url = new URL(target, location.origin);
        url.searchParams.set('callback', callback);
        const script = document.createElement('script');
        const cleanup = () => {
          delete window[callback];
          script.remove();
        };
        window[callback] = payload => {
          cleanup();
          resolve(payload);
        };
        script.onerror = () => {
          cleanup();
          reject(new Error('script transport error'));
        };
        script.src = `${url.pathname}${url.search}`;
        document.head.appendChild(script);
      });
    }
    async function postApi(path, payload) {
      const target = authPath(path);
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload || {})
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    }
    function metric(label, value, detail, status='') {
      return `<div class="panel metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-detail">${esc(detail || '')}</div></div>`;
    }
    const latestEvent = predicate => [...(state.timeline || [])].reverse().find(predicate) || null;
    function shortEvent(event, fallback) {
      if (!event) return fallback;
      const detail = event.summary || event.detail || event.kind || fallback;
      return detail.length > 96 ? `${detail.slice(0, 95).trim()}...` : detail;
    }
    function renderSignals() {
      const sense = latestEvent(item => ['senses', 'channels'].includes(item.source) || item.kind === 'Inbound');
      const reason = latestEvent(item => ['assume', 'attention', 'memory'].includes(item.source) || /Assume|Memory|MeTTa|Reason|Attention|ECAN/.test(item.kind || ''));
      const act = latestEvent(item => /Send|Generation|Web Page|Mutation|House|File/.test(item.kind || ''));
      const remember = latestEvent(item => /Memory Write|Promote|Demote|Event|Remember/.test(item.kind || '') || item.source === 'memory');
      const signals = [
        ['Sense', shortEvent(sense, 'No recent sensory pulse loaded.')],
        ['Reason', shortEvent(reason, 'No recent reasoning pulse loaded.')],
        ['Act', shortEvent(act, 'No recent action pulse loaded.')],
        ['Remember', shortEvent(remember, 'No recent memory pulse loaded.')],
      ];
      $('signalRow').innerHTML = signals.map(([label, value]) => `
        <div class="signal"><div class="signal-label">${esc(label)}</div><div class="signal-value">${esc(value)}</div></div>
      `).join('');
    }
    function setInspector(item) {
      const title = item?.title || 'Omega';
      const kind = item?.kind || 'Selected substrate';
      const copy = item?.copy || 'The field is built from live spaces, history pulses, process state, and Assume graph summaries.';
      const rows = item?.rows || [];
      $('inspectorKind').textContent = kind;
      $('inspectorTitle').textContent = title;
      $('inspectorCopy').textContent = copy;
      $('provenanceRows').innerHTML = rows.map(([key, value]) => `
        <div class="provenance-row"><span>${esc(key)}</span><strong>${esc(value)}</strong></div>
      `).join('') || '<div class="empty">No provenance loaded.</div>';
    }
    function projectNode(node) {
      const z = Number(node.z || 0);
      const scale = 0.82 + (z * 0.075);
      const cx = 500, cy = 310;
      return {
        x: cx + (Number(node.x || cx) - cx) * scale,
        y: cy + (Number(node.y || cy) - cy) * scale,
        r: Math.max(22, (Number(node.r || 34) + Math.min(16, Number(node.activity || 0) * 2)) * scale),
        scale,
      };
    }
    function renderCycleRail(nodes, flows) {
      const rail = $('cycleRail');
      if (!rail) return;
      const nodeMap = Object.fromEntries(nodes.map(node => [node.id, node]));
      const phasePairs = [
        ['receive', 'context'],
        ['context', 'provider'],
        ['provider', 'syntax'],
        ['syntax', 'metta'],
        ['metta', 'skills'],
        ['metta', 'spaces'],
        ['metta', 'assume'],
        ['sleep', 'loop'],
      ];
      const flowMap = Object.fromEntries(flows.map(flow => [`${flow.from}->${flow.to}`, flow]));
      rail.innerHTML = phasePairs.map(([from, to]) => {
        const flow = flowMap[`${from}->${to}`] || {};
        const source = nodeMap[to]?.source || nodeMap[from]?.source || 'runtime';
        const label = `${nodeMap[from]?.label || from} -> ${nodeMap[to]?.label || to}`;
        return `<div class="cycle-step" data-active="${flow.active ? 'true' : 'false'}">
          <strong>${esc(label)}</strong>
          <span>${esc(source)}</span>
        </div>`;
      }).join('');
    }
    function selectedCycle() {
      const cycles = state.cycles || [];
      if (!selectedCycleId) return null;
      return cycles.find(item => item.id === selectedCycleId) || null;
    }
    function latestCycle() {
      const cycles = state.cycles || [];
      return cycles[cycles.length - 1] || null;
    }
    function setReplayMode(cycleId) {
      selectedCycleId = cycleId || null;
      renderAll();
    }
    function renderModeBanner() {
      const cycle = selectedCycle();
      const live = !cycle;
      const ov = state.overview || {};
      $('liveMode').dataset.active = live ? 'true' : 'false';
      $('replayMode').dataset.active = live ? 'false' : 'true';
      $('clearReplay').dataset.active = live ? 'true' : 'false';
      $('modeKicker').textContent = live ? 'Live substrate' : `Replaying ${cycle.time}`;
      $('modeTitle').textContent = live ? 'Watching Omega now' : `Cycle ${cycle.index}: ${cycle.delta?.primary || cycle.summary}`;
      $('modeDetail').textContent = live
        ? (ov.omega?.current_focus || 'The circuit follows recent loop activity. Select a cycle below to replay one exact history trace.')
        : (cycle.summary || 'Replaying one committed history segment.');
      $('modeStats').innerHTML = [
        ['mode', live ? 'LIVE' : 'REPLAY'],
        ['cycle', live ? (ov.omega?.cycle || '-') : cycle.index],
        ['flows', live ? (state.brain?.architecture?.flows || []).filter(flow => flow.active).length : (cycle.flows || []).length],
        ['commands', live ? '-' : ((cycle.commands || []).join(', ') || 'none')],
      ].map(([key, value]) => `<div class="provenance-row"><span>${esc(key)}</span><strong>${esc(value)}</strong></div>`).join('');
    }
    function renderCognitiveField() {
      const svg = $('cognitiveField');
      if (!svg) return;
      const ns = 'http://www.w3.org/2000/svg';
      svg.textContent = '';
      const spaces = state.brain?.spaces || [];
      const pulses = state.brain?.pulses || [];
      const architecture = state.brain?.architecture || {};
      const ov = state.overview || {};
      const processes = state.resources?.processes || [];
      const assumeGraphs = state.assume?.graphs || [];
      const add = (tag, attrs = {}, parent = svg) => {
        const el = document.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
        parent.appendChild(el);
        return el;
      };
      const defs = add('defs');
      const glow = add('filter', { id: 'fieldGlow', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
      add('feGaussianBlur', { stdDeviation: '3', result: 'blur' }, glow);
      const merge = add('feMerge', {}, glow);
      add('feMergeNode', { in: 'blur' }, merge);
      add('feMergeNode', { in: 'SourceGraphic' }, merge);
      const marker = add('marker', { id: 'flowArrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' }, defs);
      add('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'rgba(157,167,158,.46)' }, marker);
      const fallbackCenter = { id: 'loop', name: 'loop', label: 'loop.metta', layer: 'body', x: 500, y: 82, z: 3, r: 38, pressure: ov.health?.status === 'ok' ? 'low' : 'medium', activity: pulses.length, source: 'src/loop.metta', role: 'recursive autonomous loop' };
      const fallbackNodes = [
        fallbackCenter,
        { id: 'receive', label: 'receive', layer: 'senses', x: 178, y: 166, z: 2, r: 32, source: 'receive()', role: 'messages enter cognition' },
        { id: 'context', label: 'getContext', layer: 'mind', x: 372, y: 186, z: 2, r: 32, source: 'src/loop.metta:getContext', role: 'build prompt context' },
        { id: 'provider', label: 'LLM provider', layer: 'cognition', x: 626, y: 186, z: 2, r: 32, source: 'lib_llm_ext.callProvider', role: 'replaceable cognition provider' },
        { id: 'syntax', label: 'syntax membrane', layer: 'immune', x: 822, y: 166, z: 2, r: 32, source: 'helper.signature_balance_parentheses', role: 'clean command surface' },
        { id: 'metta', label: 'MeTTa eval', layer: 'reason', x: 500, y: 294, z: 3, r: 42, source: 'sread/eval/collapse', role: 'symbolic execution' },
        { id: 'skills', label: 'skills', layer: 'hands', x: 278, y: 394, z: 2, r: 32, source: 'src/skills.metta', role: 'modular affordances' },
        { id: 'spaces', label: '&spaces', layer: 'memory', x: 500, y: 430, z: 2, r: 38, source: '&persistent &agenda &beliefs &world &events', role: 'durable symbolic state' },
        { id: 'assume', label: 'Assume/Fabric', layer: 'prediction', x: 722, y: 394, z: 2, r: 32, source: '&assume + FabricPC', role: 'bounded prediction membrane' },
        { id: 'channels', label: 'channels', layer: 'voice', x: 145, y: 506, z: 1, r: 28, source: 'WhatsApp + Telegram', role: 'social surfaces' },
        { id: 'habitat', label: 'habitat', layer: 'world', x: 340, y: 536, z: 1, r: 28, source: 'home/glucose/webcam/vision/audio', role: 'environment apps' },
        { id: 'export', label: 'export', layer: 'persistence', x: 660, y: 536, z: 1, r: 28, source: 'bound-space! export!', role: 'persist spaces' },
        { id: 'sleep', label: 'sleep/recurse', layer: 'body', x: 855, y: 506, z: 1, r: 28, source: 'sleep + omegaclaw(+1)', role: 'cadence and next cycle' },
      ];
      const nodes = (architecture.nodes && architecture.nodes.length ? architecture.nodes : fallbackNodes).map(node => ({
        ...node,
        id: node.id || node.name,
        name: node.name || node.id,
        r: node.r || (node.id === 'metta' ? 42 : 32),
        pressure: node.pressure || 'low',
        activity: Number(node.activity || node.recent_activity || 0),
      }));
      let flows = architecture.flows || [
        ['loop','receive'], ['receive','context'], ['context','provider'], ['provider','syntax'],
        ['syntax','metta'], ['metta','skills'], ['metta','spaces'], ['metta','assume'],
        ['skills','channels'], ['skills','habitat'], ['spaces','export'], ['assume','export'],
        ['export','sleep'], ['channels','sleep'], ['habitat','sleep'], ['sleep','loop'],
      ].map(([from, to], order) => ({ from, to, order, active: false }));
      const replay = selectedCycle();
      if (replay?.flows?.length) {
        const replayFlows = new Set(replay.flows.map(flow => `${flow.from}->${flow.to}`));
        flows = flows.map(flow => ({ ...flow, active: replayFlows.has(`${flow.from}->${flow.to}`) }));
      }
      const nodeMap = Object.fromEntries(nodes.map(node => [node.id, node]));
      const replayNodes = new Set(replay?.nodes || []);
      const planes = [
        ['senses / voice', 500, 300, 880, 430, -8],
        ['cognition / MeTTa', 500, 300, 650, 300, 0],
        ['memory / prediction', 500, 392, 520, 210, 8],
        ['action / persistence', 500, 508, 760, 150, 16],
      ];
      planes.forEach(([label, cx, cy, rx, ry, dy]) => {
        add('ellipse', { cx, cy: cy + dy, rx, ry, class: 'field-plane' });
        add('text', { x: cx - rx + 22, y: cy + dy - ry + 24, class: 'field-plane-label' }).textContent = label;
      });
      flows.forEach(flow => {
        const from = nodeMap[flow.from];
        const to = nodeMap[flow.to];
        if (!from || !to) return;
        const a = projectNode(from);
        const b = projectNode(to);
        add('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          class: 'field-link',
          'data-layer': to.layer || from.layer || 'runtime',
          'data-active': flow.active ? 'true' : 'false',
          'marker-end': 'url(#flowArrow)',
          style: flow.active ? `animation-delay:${(Number(flow.order || 0) % 8) * 0.12}s` : '',
        });
      });
      flows.filter(flow => flow.active).slice(-18).forEach((flow, index) => {
        const from = nodeMap[flow.from];
        const to = nodeMap[flow.to];
        if (!from || !to) return;
        const a = projectNode(from);
        const b = projectNode(to);
        add('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          class: 'field-pulse',
          'stroke-dasharray': '20 100',
          'stroke-dashoffset': String(index * 13),
          style: `animation-delay:${index * 0.08}s`,
        });
      });
      const drawNode = node => {
        const p = projectNode(node);
        const active = replay ? replayNodes.has(node.id) : node.activity > 0;
        const group = add('g', { class: `field-node ${node.id === 'metta' ? 'omega-core' : ''}`, 'data-pressure': node.pressure || 'low', 'data-layer': node.layer || 'substrate', 'data-active': active ? 'true' : 'false' });
        add('circle', { cx: p.x, cy: p.y, r: p.r }, group);
        add('text', { x: p.x, y: p.y - 2 }, group).textContent = node.label;
        add('text', { x: p.x, y: p.y + 16, class: 'node-sub' }, group).textContent = `${node.layer || 'node'} | ${node.activity || 0}`;
        group.addEventListener('click', () => {
          svg.querySelectorAll('.field-node').forEach(el => el.removeAttribute('data-selected'));
          group.setAttribute('data-selected', 'true');
          setInspector({
            kind: `${node.layer || 'substrate'} node`,
            title: node.label,
            copy: node.role || 'Architecture node from OmegaClaw runtime topology.',
            rows: [
              ['source', node.source || 'runtime topology'],
              ['activity', node.activity || 0],
              ['pressure', node.pressure || 'low'],
              ['depth', node.z ?? 0],
            ],
          });
        });
      };
      nodes.sort((a, b) => Number(a.z || 0) - Number(b.z || 0)).forEach(drawNode);
      renderCycleRail(nodes, flows);
      $('fieldState').textContent = ov.health?.status || 'unknown';
      $('fieldCaption').textContent = replay
        ? `Replaying ${replay.time}: ${replay.summary}`
        : `${nodes.length} real OmegaClaw architecture nodes, ${flows.filter(flow => flow.active).length} live flow pulses, ${spaces.length} spaces, ${assumeGraphs.length} Assume graphs, ${processes.filter(proc => proc.state === 'active').length} active processes.`;
      setInspector({
        kind: replay ? 'Cycle replay' : 'Live architecture',
        title: replay ? `Cycle ${replay.index}` : (ov.omega?.running ? 'OmegaClaw circuit is awake' : 'OmegaClaw circuit is offline'),
        copy: replay ? replay.summary : (ov.omega?.current_focus || 'Select any node to inspect the real loop function, file, or substrate it represents.'),
        rows: [
          ['time', replay?.time || ov.now || '-'],
          ['active flows', flows.filter(flow => flow.active).length],
          ['commands', replay?.commands?.join(', ') || '-'],
          ['evidence', replay ? 'history.metta segment' : 'live history + process state'],
        ],
      });
    }
    function renderCycleReplay() {
      const cycles = state.cycles || [];
      const phaseOrder = ['receive', 'provider', 'syntax', 'metta', 'skills', 'memory', 'outbound', 'sleep'];
      $('cycleCount').textContent = `${cycles.length} cycles`;
      $('cycleReplay').innerHTML = cycles.slice(-28).map(cycle => `
        <button class="cycle-card" data-cycle="${esc(cycle.id)}" aria-current="${cycle.id === selectedCycleId ? 'true' : 'false'}">
          <strong>${esc(cycle.time)} · ${esc(cycle.summary)}</strong>
          <span>${esc((cycle.commands || []).join(', ') || 'no command label')}</span>
          <div class="phase-dots">${phaseOrder.map(name => `<i class="phase-dot" title="${esc(name)}" data-on="${cycle.phases?.[name] ? 'true' : 'false'}"></i>`).join('')}</div>
        </button>
      `).join('') || '<div class="empty">No replayable cycles found in history.</div>';
      document.querySelectorAll('.cycle-card[data-cycle]').forEach(card => {
        card.addEventListener('click', () => {
          setReplayMode(card.dataset.cycle);
        });
      });
      const cycle = selectedCycle();
      if (!cycle) {
        const latest = latestCycle();
        $('transformStack').innerHTML = ['Sense', 'Command', 'Result', 'Consequence'].map(label => `
          <div class="transform-card"><strong>${esc(label)}</strong><span>${esc(latest ? 'Select a cycle to replay this layer.' : 'No trace loaded yet.')}</span></div>
        `).join('');
        $('cycleDeltas').innerHTML = '<span class="delta-chip">live mode</span><span class="delta-chip">select a cycle for replay</span>';
        $('cyclePhases').innerHTML = '<div class="empty">Live mode. Select a cycle to inspect exact history evidence.</div>';
        $('cycleEvidence').innerHTML = '';
        return;
      }
      const transforms = cycle.transforms || {};
      const transformRows = [
        ['Sense', transforms.sense, cycle.phases?.receive],
        ['Command', transforms.command, cycle.phases?.syntax],
        ['Result', transforms.result, cycle.phases?.metta],
        ['Consequence', transforms.consequence, cycle.delta?.primary || cycle.summary],
      ];
      $('transformStack').innerHTML = transformRows.map(([label, value, active]) => `
        <div class="transform-card" data-active="${active ? 'true' : 'false'}">
          <strong>${esc(label)}</strong>
          <span>${esc(value || 'No explicit evidence in this segment.')}</span>
        </div>
      `).join('');
      $('cycleDeltas').innerHTML = (cycle.delta?.chips || []).map(chip => `
        <span class="delta-chip" data-on="${chip.on ? 'true' : 'false'}">${esc(chip.label)}</span>
      `).join('') || '<span class="delta-chip">no explicit delta</span>';
      $('cyclePhases').innerHTML = phaseOrder.map(name => `
        <div class="phase" data-active="${cycle.phases?.[name] ? 'true' : 'false'}">
          <strong>${esc(name)}</strong>
          <span>${esc(cycle.evidence?.[name] || 'No explicit trace in this segment.')}</span>
        </div>
      `).join('');
      $('cycleEvidence').innerHTML = [
        ['time', cycle.time],
        ['source', cycle.source || 'history.metta'],
        ['nodes', (cycle.nodes || []).join(' -> ')],
        ['flows', (cycle.flows || []).map(flow => `${flow.from}->${flow.to}`).join(' | ')],
      ].map(([key, value]) => `
        <div class="provenance-row"><span>${esc(key)}</span><strong>${esc(value || '-')}</strong></div>
      `).join('');
    }
    function renderOverview() {
      const ov = state.overview || {};
      const res = state.resources || {};
      const running = Boolean(ov.omega?.running);
      const mode = ov.omega?.energy_mode || 'unknown';
      const loops = ov.open_loops || [];
      const stateWord = running ? (mode === 'focused' || mode === 'creative' ? 'Working' : (mode === 'listening' ? 'Listening' : 'Awake')) : 'Offline';
      $('presenceState').textContent = stateWord;
      $('presenceDetail').textContent = running
        ? `Omega is ${mode}. ${ov.counts?.active_goals ?? 0} active goals, ${ov.counts?.assume_graphs ?? 0} Assume graphs, ${ov.counts?.recent_errors ?? 0} recent errors.`
        : 'Omega runtime is not currently visible to the workbench.';
      $('presenceFocus').textContent = ov.omega?.current_focus || ov.omega?.detail || 'No current pin or focus found.';
      $('needStatus').textContent = loops.length ? `${loops.length} open` : 'clear';
      $('needStatus').className = `status ${loops.some(loop => loop.severity === 'high') ? 'bad' : (loops.length ? 'warn' : 'ok')}`;
      $('presenceNeed').textContent = loops.length ? `${loops[0].title}: ${loops[0].detail}` : 'No obvious request for Jon. Omega can continue from her own attention and goals.';
      $('evidenceStrip').innerHTML = [
        `source: history + spaces`,
        `updated: ${ov.now || 'waiting'}`,
        `health: ${ov.health?.status || 'unknown'}`,
        `token: ${adminToken ? 'admin' : 'none'}`
      ].map(item => `<span>${esc(item)}</span>`).join('');
      $('omegaChip').textContent = `Omega ${running ? 'running' : 'stopped'}`;
      $('energyChip').textContent = ov.omega?.energy_mode ? `Energy ${ov.omega.energy_mode}` : 'Energy unknown';
      $('lastUpdated').textContent = ov.now ? `Updated ${ov.now}` : 'Waiting for data';
      $('navGoalCount').textContent = ov.counts?.active_goals ?? '-';
      $('navAssumeCount').textContent = ov.counts?.assume_graphs ?? '-';
      $('navResourceState').textContent = ov.health?.status ?? '-';
      $('metrics').innerHTML = [
        metric('Omega', ov.omega?.running ? 'running' : 'stopped', ov.omega?.detail || ''),
        metric('Cycle / Energy', ov.omega?.cycle || '-', ov.omega?.energy_mode || 'unknown'),
        metric('Today Cost', res.omega?.spent_today ?? '-', res.omega?.budget_detail || ''),
        metric('VM Body', res.vm?.ram_percent != null ? `${res.vm.ram_percent}% RAM` : '-', res.vm?.disk || '')
      ].join('');
      $('openLoopCount').textContent = `${loops.length} loops`;
      $('openLoops').innerHTML = loops.map(loop => `
        <div class="loop ${esc(loop.severity || '')}">
          <div class="goal-title">${esc(loop.title)}</div>
          <div class="meta">${esc(loop.detail)}</div>
        </div>`).join('') || '<div class="empty">No obvious open loops.</div>';
    }
    function renderTimeline() {
      const items = state.timeline || [];
      $('timelineCount').textContent = `${items.length} events`;
      $('timeline').innerHTML = items.slice(-70).map(item => `
        <div class="event">
          <div class="event-time">${esc(item.time)}</div>
          <div><div class="event-kind">${esc(item.kind)}</div><div class="event-summary">${esc(item.summary || item.detail)}</div></div>
          <span class="event-source">${esc(item.source || 'trace')}</span>
        </div>`).join('') || '<div class="empty">No recent trace events.</div>';
    }
    function goalCard(goal) {
      return `<div class="goal">
        <div class="goal-top"><div class="goal-title">${esc(goal.name)}</div><span class="status ${statusClass(goal.status)}">${esc(goal.status)}</span></div>
        <div class="meta">${esc(goal.next_step || 'No next step')}</div>
        <div class="meta">priority ${esc(goal.priority || '-')} | ${esc(goal.source || '&agenda')}</div>
      </div>`;
    }
    function renderAgenda() {
      const columns = state.agenda?.columns || {};
      const order = state.agenda?.order || Object.keys(columns);
      const active = [...(columns.active || []), ...(columns.practicing || [])].slice(0, 5);
      $('goalCount').textContent = `${state.agenda?.total || 0} goals`;
      $('goalPreview').innerHTML = active.map(goalCard).join('') || '<div class="empty">No active agenda goals found.</div>';
      $('kanban').innerHTML = order.map(name => `
        <div class="column">
          <h4>${esc(name)} (${(columns[name] || []).length})</h4>
          ${(columns[name] || []).map(goalCard).join('') || '<div class="empty">Empty</div>'}
        </div>`).join('');
    }
    function assumeCard(graph) {
      const prediction = graph.latest_prediction ? `${graph.latest_prediction.action} (${graph.latest_prediction.score})` : 'No prediction trace';
      return `<div class="assume-card">
        <div class="goal-top"><div class="goal-title">${esc(graph.id)}</div><span class="status ${statusClass(graph.status)}">${esc(graph.status)}</span></div>
        <div class="meta">features ${esc(graph.features)} | actions ${esc(graph.actions)} | edges ${esc(graph.edges)}</div>
        <div class="meta">evidence ${esc(graph.outcomes)} outcomes / ${esc(graph.errors)} errors</div>
        <div class="meta">latest: ${esc(prediction)}</div>
      </div>`;
    }
    function renderAssume() {
      const graphs = state.assume?.graphs || [];
      $('assumeCount').textContent = `${graphs.length} graphs`;
      $('assumePreview').innerHTML = graphs.slice(0, 3).map(assumeCard).join('') || '<div class="empty">No Assume graphs found.</div>';
      $('assumeLab').innerHTML = graphs.map(assumeCard).join('') || '<div class="empty">No Assume graphs found.</div>';
    }
    function renderBrain() {
      const spaces = state.brain?.spaces || [];
      $('navPulseCount').textContent = state.brain?.pulses?.length ?? '-';
      $('brain').innerHTML = spaces.map(space => `
        <div class="organ" data-active="${space.recent_activity > 0}">
          <div class="organ-name">${esc(space.name)}</div>
          <div class="organ-detail">${esc(space.atoms_estimate)} atoms/lines<br>${esc(space.pressure)} pressure<br>${esc(space.recent_activity)} recent pulses</div>
        </div>`).join('');
    }
    function renderResources() {
      const data = state.resources || {};
      const rows = [
        ['RAM', data.vm?.ram_percent, data.vm?.ram_detail],
        ['Disk', data.vm?.disk_percent, data.vm?.disk],
        ['Load', data.vm?.load_percent, data.vm?.loadavg],
      ];
      $('resources').innerHTML = rows.map(([name, value, detail]) => {
        const cls = value > 85 ? 'bad' : (value > 70 ? 'warn' : '');
        return `<div class="resource-row"><div><div class="goal-title">${esc(name)}</div><div class="bar"><span class="${cls}" style="width:${pct(value)}%"></span></div><div class="meta">${esc(detail || '')}</div></div><span class="status ${cls || 'ok'}">${esc(value ?? '-')}%</span></div>`;
      }).join('') + (data.processes || []).map(proc => `
        <div class="resource-row"><div><div class="goal-title">${esc(proc.name)}</div><div class="meta">${esc(proc.detail || '')}</div></div><span class="status ${statusClass(proc.state)}">${esc(proc.state)}</span></div>
      `).join('');
    }
    function renderChat() {
      const messages = state.chat || [];
      $('osChatLog').innerHTML = messages.slice(-80).map(message => {
        const direction = message.direction === 'outbound' ? 'outbound' : 'inbound';
        const who = direction === 'outbound' ? 'Omega' : (message.from || 'Jon');
        return `<div class="chat-message ${direction}">
          <div class="chat-meta">${esc(who)} | ${esc(message.at || '')}</div>
          <div>${esc(message.text || '')}</div>
        </div>`;
      }).join('') || '<div class="empty">No OS chat messages yet.</div>';
      $('osChatLog').scrollTop = $('osChatLog').scrollHeight;
    }
    function renderGallery() {
      const items = state.gallery || [];
      const media = items.filter(item => /\.(png|jpe?g|gif|webp|svg)$/i.test(item.url || item.path || '')).slice(0, 9);
      $('osGallery').innerHTML = media.map(item => `
        <a class="gallery-tile" href="${esc(item.url || item.path)}" target="_blank" rel="noreferrer">
          <img src="${esc(item.url || item.path)}" alt="${esc(item.title || item.name || 'artifact')}">
        </a>`).join('') || '<div class="empty">No image artifacts available to this session.</div>';
    }
    function renderAll() {
      renderOverview(); renderTimeline(); renderAgenda(); renderAssume(); renderBrain(); renderResources(); renderSignals(); renderModeBanner(); renderCycleReplay(); renderCognitiveField(); renderChat(); renderGallery();
    }
    async function refresh() {
      const endpoints = [
        ['overview', '/api/workbench/overview'],
        ['timeline', '/api/workbench/timeline'],
        ['agenda', '/api/workbench/agenda'],
        ['brain', '/api/workbench/brain'],
        ['cycles', '/api/workbench/cycles'],
        ['assume', '/api/workbench/assume'],
        ['resources', '/api/workbench/resources'],
        ['chat', '/api/os/chat'],
        ['gallery', '/api/public-gallery']
      ];
      const results = await Promise.allSettled(endpoints.map(([, path]) => api(path)));
      const failed = [];
      results.forEach((result, index) => {
        const [key] = endpoints[index];
        if (result.status === 'fulfilled') {
          if (key === 'timeline') state.timeline = result.value.events || [];
          else if (key === 'cycles') state.cycles = result.value.cycles || [];
          else if (key === 'chat') state.chat = result.value.messages || [];
          else if (key === 'gallery') state.gallery = result.value.items || result.value.gallery || [];
          else state[key] = result.value;
        } else {
          failed.push(`${key}: ${result.reason?.message || result.reason}`);
        }
      });
      if (failed.length) {
        $('sessionState').textContent = `Partial data: ${failed.join(' | ')}`;
      } else {
        $('sessionState').textContent = 'Omega OS surface';
      }
      try {
        renderAll();
      } catch (err) {
        $('sessionState').textContent = `Render issue: ${err.message}`;
      }
    }
    function showPage(name) {
      const btn = document.querySelector(`nav button[data-page="${name}"]`);
      if (btn) {
        document.querySelectorAll('nav button[data-page]').forEach(item => item.removeAttribute('aria-current'));
        btn.setAttribute('aria-current', 'page');
      }
      document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
      const page = document.getElementById(`page-${name}`);
      if (page) page.classList.add('active');
      document.querySelector('.headline h2').textContent = name === 'command' ? 'Omega Observatory' : (btn ? btn.textContent.replace(/\s+.*/, '') : name);
      if (page) page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.querySelectorAll('nav button[data-page]').forEach(btn => {
      btn.addEventListener('click', () => showPage(btn.dataset.page));
    });
    document.querySelectorAll('[data-page-jump]').forEach(btn => {
      btn.addEventListener('click', () => showPage(btn.dataset.pageJump));
    });
    function bringWindowFront(win) {
      document.querySelectorAll('.os-window').forEach(item => item.removeAttribute('data-front'));
      win.setAttribute('data-front', 'true');
    }
    function initWindows() {
      document.querySelectorAll('.os-window').forEach(win => {
        const bar = win.querySelector('.window-bar');
        const grip = win.querySelector('.window-resize');
        win.addEventListener('pointerdown', () => bringWindowFront(win));
        if (bar) {
          bar.addEventListener('pointerdown', event => {
            if (window.matchMedia('(max-width: 1080px)').matches) return;
            event.preventDefault();
            bringWindowFront(win);
            const box = win.getBoundingClientRect();
            const parent = $('omegaDesktop').getBoundingClientRect();
            const offsetX = event.clientX - box.left;
            const offsetY = event.clientY - box.top;
            const move = next => {
              const x = Math.max(8, Math.min(parent.width - box.width - 8, next.clientX - parent.left - offsetX));
              const y = Math.max(8, Math.min(parent.height - box.height - 64, next.clientY - parent.top - offsetY));
              win.style.left = `${x}px`;
              win.style.top = `${y}px`;
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          });
        }
        if (grip) {
          grip.addEventListener('pointerdown', event => {
            if (window.matchMedia('(max-width: 1080px)').matches) return;
            event.preventDefault();
            bringWindowFront(win);
            const box = win.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const resize = next => {
              win.style.width = `${Math.max(280, box.width + next.clientX - startX)}px`;
              win.style.height = `${Math.max(220, box.height + next.clientY - startY)}px`;
            };
            const up = () => {
              window.removeEventListener('pointermove', resize);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', resize);
            window.addEventListener('pointerup', up);
          });
        }
      });
      document.querySelectorAll('[data-os-summon]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.osSummon;
          const win = document.getElementById(`window-${id}`);
          if (!win) return;
          const hidden = win.getAttribute('data-minimized') === 'true';
          if (hidden) win.removeAttribute('data-minimized');
          bringWindowFront(win);
          btn.dataset.active = 'true';
        });
      });
      document.querySelectorAll('[data-window-close]').forEach(btn => {
        btn.addEventListener('click', event => {
          event.stopPropagation();
          const id = btn.dataset.windowClose;
          const win = document.getElementById(`window-${id}`);
          if (win) win.setAttribute('data-minimized', 'true');
          const dock = document.querySelector(`[data-os-summon="${id}"]`);
          if (dock) dock.dataset.active = 'false';
        });
      });
    }
    $('osChatForm').addEventListener('submit', async event => {
      event.preventDefault();
      const textarea = $('osChatText');
      const text = textarea.value.trim();
      if (!text) return;
      textarea.value = '';
      try {
        const result = await postApi('/api/os/chat', { text });
        if (result.message) state.chat = [...state.chat, result.message];
        renderChat();
      } catch (err) {
        state.chat = [...state.chat, { direction: 'outbound', from: 'System', at: 'send failed', text: err.message }];
        renderChat();
      }
    });
    $('liveMode').addEventListener('click', () => setReplayMode(null));
    $('clearReplay').addEventListener('click', () => setReplayMode(null));
    $('replayMode').addEventListener('click', () => {
      const latest = latestCycle();
      if (latest) setReplayMode(latest.id);
    });
    $('refresh').addEventListener('click', refresh);
    initWindows();
    refresh();
    setInterval(refresh, 3500);
  </script>
</body>
</html>
"""


def _slug(value, default="index"):
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip(".-")
    if not slug:
        slug = default
    return slug[:120]


def _safe_relative_path(path, default_suffix=".html"):
    cleaned = _slug(path)
    rel = pathlib.PurePosixPath(cleaned)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("unsafe path")
    suffix = pathlib.Path(rel.name).suffix.lower()
    if not suffix:
        rel = rel.with_suffix(default_suffix)
        suffix = default_suffix
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"unsupported file type {suffix}")
    return rel


def _target(path, default_suffix=".html"):
    rel = _safe_relative_path(path, default_suffix=default_suffix)
    target = (PUBLIC_DIR / pathlib.Path(*rel.parts)).resolve()
    root = PUBLIC_DIR.resolve()
    if root not in target.parents and target != root:
        raise ValueError("path escaped public directory")
    return target, rel


def _ensure_public_dir():
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    ADMIN_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not ADMIN_TOKEN_FILE.exists():
        ADMIN_TOKEN_FILE.write_text(secrets.token_urlsafe(32) + "\n", encoding="utf-8")
        ADMIN_TOKEN_FILE.chmod(0o600)
    index = PUBLIC_DIR / "index.html"
    index.write_text(FAMILY_HOME_HTML, encoding="utf-8")
    admin = PUBLIC_DIR / "admin.html"
    admin.write_text(DIAGNOSTICS_HTML, encoding="utf-8")
    diagnostics = PUBLIC_DIR / "diagnostics.html"
    diagnostics.write_text(
        '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/admin.html">'
        '<title>Omega Admin</title><a href="/admin.html">Omega Admin</a>\n',
        encoding="utf-8",
    )
    _ensure_users()
    _claim_active_session_users()


def _admin_token():
    token = os.environ.get("OMEGACLAW_WEB_ADMIN_TOKEN", "").strip()
    if token:
        return token
    if ADMIN_TOKEN_FILE.exists():
        return ADMIN_TOKEN_FILE.read_text(encoding="utf-8", errors="replace").strip()
    return ""


def _hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), salt.encode("ascii"), 200000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def _verify_password(password, stored):
    try:
        scheme, salt, expected = str(stored or "").split("$", 2)
        if scheme != "pbkdf2_sha256":
            return False
        candidate = _hash_password(password, salt).split("$", 2)[2]
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False


def _load_users():
    if not USERS_FILE.exists():
        return {}
    try:
        return json.loads(USERS_FILE.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}


def _save_users(users):
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(users, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    USERS_FILE.chmod(0o600)


def _account_username(member):
    member = normalize_family_member(member)
    if member not in ACCOUNT_MEMBERS:
        return ""
    return member.lower()


def _ensure_users():
    if USERS_FILE.exists():
        return
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    users = {}
    invite_lines = [
        "Omega family site initial passwords",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
    ]
    for name in ("Jon", "Dad", "Lydia", "Anna", "Suzie"):
        password = secrets.token_urlsafe(10)
        role = "admin" if name == "Jon" else "family"
        users[name.lower()] = {
            "name": name,
            "role": role,
            "member": name,
            "password_hash": _hash_password(password),
            "claimed": False,
            "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        invite_lines.append(f"{name}: {password}")
    _save_users(users)
    INVITES_FILE.write_text("\n".join(invite_lines) + "\n", encoding="utf-8")
    INVITES_FILE.chmod(0o600)


def _load_sessions():
    if not SESSIONS_FILE.exists():
        return {}
    try:
        return json.loads(SESSIONS_FILE.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}


def _save_sessions(sessions):
    SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SESSIONS_FILE.write_text(json.dumps(sessions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SESSIONS_FILE.chmod(0o600)


def _active_session_usernames(sessions=None):
    sessions = sessions if sessions is not None else _load_sessions()
    now = int(time.time())
    return {
        str(item.get("username", "")).lower()
        for item in sessions.values()
        if int(item.get("expires", 0)) > now
    }


def _claimed_usernames(users=None, sessions=None):
    users = users if users is not None else _load_users()
    claimed = {
        username
        for username, user in users.items()
        if bool(user.get("claimed"))
    }
    claimed.update(_active_session_usernames(sessions))
    return claimed


def _available_account_members(users=None, sessions=None):
    users = users if users is not None else _load_users()
    claimed = _claimed_usernames(users, sessions)
    return [member for member in ACCOUNT_MEMBERS if _account_username(member) not in claimed]


def _mark_user_claimed(username, users=None):
    users = users if users is not None else _load_users()
    user = users.get(username)
    if not user:
        return False
    if not user.get("claimed"):
        user["claimed"] = True
        user["claimed_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        users[username] = user
        _save_users(users)
    return True


def _claim_active_session_users():
    users = _load_users()
    changed = False
    for username in _active_session_usernames():
        user = users.get(username)
        if user and not user.get("claimed"):
            user["claimed"] = True
            user["claimed_at"] = user.get("claimed_at") or time.strftime("%Y-%m-%d %H:%M:%S")
            users[username] = user
            changed = True
    if changed:
        _save_users(users)


def _claim_family_account(member, password):
    username = _account_username(member)
    if not username:
        return False, "Choose a family member from the list."
    password = str(password or "")
    if len(password) < 8:
        return False, "Use a password of at least 8 characters."
    users = _load_users()
    if username in _claimed_usernames(users):
        return False, "That family member already has an account on a device."
    canonical = normalize_family_member(member)
    role = "admin" if canonical == "Jon" else "family"
    existing = users.get(username, {})
    users[username] = {
        **existing,
        "name": canonical,
        "role": role,
        "member": canonical,
        "password_hash": _hash_password(password),
        "claimed": True,
        "claimed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "created": existing.get("created") or time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    _save_users(users)
    return True, username


def _create_session(username):
    sessions = _load_sessions()
    now = int(time.time())
    sessions = {
        token: item for token, item in sessions.items()
        if int(item.get("expires", 0)) > now
    }
    token = secrets.token_urlsafe(32)
    sessions[token] = {
        "username": username,
        "created": now,
        "expires": now + 60 * 60 * 24 * 30,
    }
    _save_sessions(sessions)
    return token


def _user_can_view_member(user, member):
    member = normalize_family_member(member)
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    return member == "General" or member == normalize_family_member(user.get("member"))


def _login_html(error=""):
    error_html = f'<p class="error">{html.escape(error)}</p>' if error else ""
    available = _available_account_members()
    options = "\n".join(
        f'        <option value="{_html_attr(member)}">{_html_text(member)}</option>'
        for member in available
    )
    create_html = (
        f"""
    <section class="create">
      <h2>Create account</h2>
      <p>Choose your family member once for this device. Taken names disappear from the list.</p>
      <form method="post" action="/create-account">
        <label for="member">Family member</label>
        <select id="member" name="member" autocomplete="name" required>
          <option value="">Choose...</option>
{options}
        </select>
        <label for="new-password">New password</label>
        <input id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" required>
        <label for="password2">Confirm password</label>
        <input id="password2" name="password2" type="password" autocomplete="new-password" minlength="8" required>
        <button type="submit">Create Account</button>
      </form>
    </section>"""
        if available else
        """
    <section class="create">
      <h2>Create account</h2>
      <p>All family member accounts have been taken. Sign in on an existing device account.</p>
    </section>"""
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Omega Family Sign In</title>
  <style>
    body {{ margin:0; min-height:100vh; display:grid; place-items:center; font-family:Inter,system-ui,sans-serif; background:#f6f4ef; color:#18211d; }}
    main {{ width:min(92vw, 520px); background:#fffdf7; border:1px solid #d9d6cc; border-radius:8px; padding:24px; box-shadow:0 18px 45px rgba(28,32,27,.12); }}
    h1 {{ margin:0 0 8px; font-size:34px; letter-spacing:0; }}
    h2 {{ margin:0 0 8px; font-size:22px; letter-spacing:0; }}
    p {{ color:#66716b; line-height:1.5; }}
    label {{ display:block; margin:14px 0 6px; font-weight:700; }}
    input, select {{ width:100%; padding:12px; border:1px solid #c8c4b8; border-radius:7px; font:inherit; background:white; }}
    button {{ margin-top:18px; width:100%; padding:12px; border:0; border-radius:7px; background:#2f7d5f; color:white; font:inherit; font-weight:800; cursor:pointer; }}
    .error {{ color:#8b1d1d; font-weight:700; }}
    .create {{ margin-top:24px; padding-top:22px; border-top:1px solid #d9d6cc; }}
  </style>
</head>
<body>
  <main>
    <h1>Omega</h1>
    <p>Sign in to the Grovey Baby family site.</p>
    {error_html}
    <form method="post" action="/login">
      <label for="username">Name</label>
      <input id="username" name="username" autocomplete="username" autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password">
      <button type="submit">Sign In</button>
    </form>
    {create_html}
  </main>
</body>
</html>"""


def _redact(text):
    redacted = str(text or "")
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub(lambda m: (m.group(1) if m.groups() else "") + "[REDACTED]", redacted)
    return redacted


def _human_size(size):
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def _run(cmd, timeout=8):
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def _service_state(name):
    try:
        _, out, err = _run(["systemctl", "is-active", name], timeout=4)
        return out or err or "unknown"
    except Exception:
        return "unknown"


def _pgrep(pattern):
    try:
        code, out, _ = _run(["pgrep", "-af", pattern], timeout=4)
        lines = [line for line in out.splitlines() if line.strip()]
        return code == 0 and bool(lines), lines
    except Exception:
        return False, []


def _tail_file(path, lines, max_bytes=300000):
    path = pathlib.Path(path)
    if not path.exists():
        return ""
    raw = _tail_chars(path, chars=max_bytes)
    data = raw.splitlines()
    return "\n".join(data[-lines:])


def _tail_chars(path, chars=500000):
    path = pathlib.Path(path)
    if not path.exists():
        return ""
    with path.open("rb") as f:
        try:
            f.seek(-chars, os.SEEK_END)
        except OSError:
            f.seek(0)
        return f.read().replace(b"\x00", b"").decode("utf-8", errors="replace")


def _journal_tail(unit, lines):
    try:
        code, out, err = _run(["journalctl", "-u", unit, "-n", str(lines), "--no-pager", "-o", "short-iso"], timeout=8)
        return out if code == 0 else err
    except Exception as exc:
        return f"journal unavailable: {exc}"


def _artifact_entry(group, root, path):
    rel = path.relative_to(root).as_posix()
    stat = path.stat()
    return {
        "id": f"{group}:{rel}",
        "group": group,
        "path": rel,
        "name": path.name,
        "size": stat.st_size,
        "size_human": _human_size(stat.st_size),
        "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
        "exists": True,
    }


def _load_gallery_meta():
    if not GALLERY_META.exists():
        return {}
    try:
        return json.loads(GALLERY_META.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}


def _save_gallery_meta(meta):
    GALLERY_DIR.mkdir(parents=True, exist_ok=True)
    GALLERY_META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _gallery_kind(path):
    suffix = pathlib.Path(path).suffix.lower()
    if suffix in {".mp4", ".webm"}:
        return "Video"
    if suffix in {".mp3", ".m4a", ".wav", ".ogg", ".opus", ".flac", ".aac"}:
        return "Audio"
    return "Image"


def normalize_family_member(value):
    key = re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())
    return FAMILY_ALIASES.get(key, "General")


def _resolve_artifact_id(artifact_id):
    raw = str(artifact_id or "").strip().strip('"')
    raw_path = pathlib.Path(raw).expanduser()
    if raw_path.is_absolute():
        resolved = raw_path.resolve()
        for group, root in ARTIFACT_ROOTS.items():
            if group == "web":
                continue
            root_resolved = root.resolve()
            if resolved == root_resolved or root_resolved in resolved.parents:
                rel = resolved.relative_to(root_resolved).as_posix()
                raw = f"{group}:{rel}"
                break
    if ":" not in raw:
        slash_path = pathlib.PurePosixPath(raw)
        if len(slash_path.parts) >= 2 and slash_path.parts[0] in ARTIFACT_ROOTS:
            raw = slash_path.parts[0] + ":" + pathlib.PurePosixPath(*slash_path.parts[1:]).as_posix()
        else:
            for group in ("outbox", "inbox"):
                root = ARTIFACT_ROOTS[group]
                matches = [path for path in root.rglob(slash_path.name) if path.is_file()] if root.exists() else []
                if len(matches) == 1:
                    rel = matches[0].relative_to(root).as_posix()
                    raw = f"{group}:{rel}"
                    break
    if ":" not in raw:
        raise ValueError("artifact_id must look like outbox:images/file.jpg, outbox/images/file.jpg, an absolute outbox/inbox path, or a unique filename")
    group, rel = raw.split(":", 1)
    root = ARTIFACT_ROOTS.get(group)
    if root is None or group == "web":
        raise ValueError("only private inbox/outbox artifacts can be published")
    rel_path = pathlib.PurePosixPath(rel)
    if rel_path.is_absolute() or ".." in rel_path.parts:
        raise ValueError("unsafe artifact path")
    source = (root / pathlib.Path(*rel_path.parts)).resolve()
    root_resolved = root.resolve()
    if root_resolved not in source.parents and source != root_resolved:
        raise ValueError("artifact escaped root")
    if not source.is_file():
        raise FileNotFoundError("artifact not found")
    if source.suffix.lower() not in GALLERY_SUFFIXES:
        raise ValueError("artifact type is not publishable media")
    return group, rel_path, source


def artifact_id_for_path(path):
    try:
        group, rel_path, _ = _resolve_artifact_id(path)
        return f"ARTIFACT-ID {group}:{rel_path.as_posix()}"
    except Exception as exc:
        return f"ARTIFACT-ID-FAILED {exc}"


def diagnostics_status():
    omega_running, omega_lines = _pgrep("swipl.*run.metta")
    bridge_running, bridge_lines = _pgrep("bridge.mjs")
    usage = os.statvfs(str(ROOT))
    free = usage.f_bavail * usage.f_frsize
    total = usage.f_blocks * usage.f_frsize
    artifacts = diagnostics_artifacts()["artifacts"]
    return {
        "now": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "now_short": time.strftime("%H:%M:%S"),
        "omega": {
            "running": omega_running,
            "detail": omega_lines[0] if omega_lines else "no swipl runtime",
        },
        "webhost": _service_state("omegaclaw-webhost.service"),
        "cloudflared": _service_state("cloudflared.service"),
        "disk": f"{_human_size(free)} free of {_human_size(total)}",
        "services": [
            {"name": "Omega runtime", "state": "active" if omega_running else "inactive", "detail": omega_lines[0] if omega_lines else ""},
            {"name": "WhatsApp bridge", "state": "active" if bridge_running else "inactive", "detail": bridge_lines[0] if bridge_lines else ""},
            {"name": "Family webhost", "state": _service_state("omegaclaw-webhost.service"), "detail": f"http://{HOST}:{PORT}"},
            {"name": "Cloudflare tunnel", "state": _service_state("cloudflared.service"), "detail": PUBLIC_BASE_URL},
        ],
        "artifact_count": len(artifacts),
    }


def diagnostics_artifacts():
    _ensure_public_dir()
    entries = []
    for group, root in ARTIFACT_ROOTS.items():
        if not root.exists():
            continue
        for path in sorted(root.rglob("*"), key=lambda p: p.stat().st_mtime if p.exists() and p.is_file() else 0, reverse=True):
            if not path.is_file():
                continue
            if path.suffix.lower() not in ALLOWED_SUFFIXES:
                continue
            entries.append(_artifact_entry(group, root, path))
    return {"artifacts": entries[:300]}


def _page_title(path):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")[:5000]
    except Exception:
        return pathlib.Path(path).stem.replace("-", " ").title()
    match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    if match:
        return html.unescape(re.sub(r"\s+", " ", match.group(1)).strip())
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.I | re.S)
    if h1:
        clean = re.sub(r"<[^>]+>", "", h1.group(1))
        return html.unescape(re.sub(r"\s+", " ", clean).strip())
    return pathlib.Path(path).stem.replace("-", " ").title()


def public_pages(user=None):
    _ensure_public_dir()
    pages = []
    summaries = {
        "family.html": "Family notes and introductions Omega has made for Grovey Baby.",
        "chinese-phrases.html": "A mobile Chinese-English phrasebook for Suzie and the family.",
        "conversation-framework.html": "Omega's working notes on when to join family conversation and when to listen.",
    }
    for path in sorted(PUBLIC_DIR.glob("*.html"), key=lambda p: p.stat().st_mtime, reverse=True):
        name = path.name
        if name in RESERVED_WEB_PAGES:
            continue
        stat = path.stat()
        member = normalize_family_member(PAGE_MEMBER_HINTS.get(name, "General"))
        if user is not None and not _user_can_view_member(user, member):
            continue
        pages.append({
            "title": _page_title(path),
            "url": f"/{name}",
            "slug": name,
            "kind": "Page",
            "summary": summaries.get(name, "A public page Omega made for the family."),
            "member": member,
            "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
        })
    return {"now": time.strftime("%H:%M"), "pages": pages[:60]}


def public_gallery(user=None):
    _ensure_public_dir()
    meta = _load_gallery_meta()
    items = []
    for path in sorted(GALLERY_DIR.glob("*"), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True):
        if not path.is_file() or path.suffix.lower() not in GALLERY_SUFFIXES:
            continue
        item = meta.get(path.name, {})
        stat = path.stat()
        title = item.get("title") or path.stem.replace("-", " ").replace("_", " ").title()
        member = normalize_family_member(item.get("member", "General"))
        if user is not None and not _user_can_view_member(user, member):
            continue
        items.append({
            "title": title,
            "caption": item.get("caption") or "Shared by Omega.",
            "url": f"/gallery/{path.name}",
            "slug": path.name,
            "kind": _gallery_kind(path),
            "member": member,
            "share_requested_by": item.get("share_requested_by"),
            "shared_to_general": bool(item.get("shared_to_general")),
            "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
        })
    return {"now": time.strftime("%H:%M"), "items": items[:80]}


def public_family_sections(user=None):
    pages = public_pages(user=user)["pages"]
    gallery = public_gallery(user=user)["items"]
    grouped = {member: {"member": member, "pages": [], "gallery": []} for member in FAMILY_SECTIONS}
    for page in pages:
        grouped[normalize_family_member(page.get("member"))]["pages"].append(page)
    for item in gallery:
        grouped[normalize_family_member(item.get("member"))]["gallery"].append(item)
    sections = []
    summaries = {
        "General": "Shared family things, group memories, and items meant for everyone.",
        "Dad": "Things Omega has made or saved for Dad.",
        "Lydia": "Things Omega has made or saved for Lydia.",
        "Anna": "Things Omega has made or saved for Anna.",
        "Suzie": "Things Omega has made or saved for Suzie.",
        "Jon": "Things Omega has made or saved for Jon.",
        "Omega": "Omega's own notes, pages, and self-made artifacts for the family.",
    }
    visible_members = FAMILY_SECTIONS if (user and user.get("role") == "admin") else ("General", normalize_family_member(user.get("member")) if user else "General")
    for member in FAMILY_SECTIONS:
        if member not in visible_members:
            continue
        section = grouped[member]
        items = section["pages"] + section["gallery"]
        latest = ""
        if items:
            latest = max((item.get("modified", "") for item in items), default="")
        sections.append({
            "member": member,
            "summary": summaries[member],
            "count": len(items),
            "latest": latest,
            "pages": section["pages"],
            "gallery": section["gallery"],
        })
    return {"now": time.strftime("%H:%M"), "sections": sections}


def _html_text(value):
    return html.escape(str(value or ""), quote=False)


def _html_attr(value):
    return html.escape(str(value or ""), quote=True)


def _family_card(section, selected=None):
    member = section["member"]
    href = f"/family/{urllib.parse.quote(member)}"
    current = ' aria-current="page"' if selected == member else ""
    return (
        f'<a class="card family-card" href="{href}"{current}>'
        f'<div><h3>{_html_text(member)}</h3><p>{_html_text(section["summary"])}</p></div>'
        f'<div class="meta"><span>{section["count"]} item{"s" if section["count"] != 1 else ""}</span>'
        f'<span>{_html_text(section["latest"] or "Waiting")}</span></div>'
        f'</a>'
    )


def _public_page_card(page):
    return (
        f'<a class="card" href="{_html_attr(page["url"])}">'
        f'<div><h3>{_html_text(page["title"])}</h3><p>{_html_text(page["summary"])}</p></div>'
        f'<div class="meta"><span>{_html_text(page["kind"])}</span><span>{_html_text(page["modified"])}</span></div>'
        f'</a>'
    )


def _public_media_card(item, user=None):
    url = _html_attr(item["url"])
    if item.get("kind") == "Video":
        thumb = f'<video src="{url}" muted playsinline controls></video>'
    elif item.get("kind") == "Audio":
        thumb = f'<div class="audio-tile"><div class="audio-icon">Audio</div><audio src="{url}" controls preload="metadata"></audio></div>'
    else:
        thumb = f'<img alt="" src="{url}">'
    share = ""
    if user and user.get("role") != "admin" and normalize_family_member(item.get("member")) == normalize_family_member(user.get("member")):
        share = (
            f'<form method="post" action="/share-to-general" class="share-form">'
            f'<input type="hidden" name="slug" value="{_html_attr(item["slug"])}">'
            f'<button type="submit">Share to General</button>'
            f'</form>'
        )
    return (
        '<div class="media-wrap">'
        f'<a class="media" href="{url}">'
        f'<div class="thumb">{thumb}</div>'
        f'<div class="media-info"><h3>{_html_text(item["title"])}</h3><p>{_html_text(item["caption"])}</p></div>'
        f'</a>{share}</div>'
    )


def render_family_page(member=None, user=None):
    data = public_family_sections(user=user)
    sections = data["sections"]
    selected = normalize_family_member(member) if member else None
    if selected and not _user_can_view_member(user, selected):
        selected = "General"
    selected_section = next((section for section in sections if section["member"] == selected), None)
    is_member_page = selected_section is not None
    page_title = f"{selected_section['member']} - Omega for Grovey Baby" if is_member_page else "Omega for Grovey Baby"
    hero_title = selected_section["member"] if is_member_page else "Grovey Baby"
    hero_lead = (
        f"{selected_section['summary']} Omega keeps this shelf for pages, images, videos, audio, and useful things made or saved for this part of the family."
        if is_member_page
        else "A family shelf for things Omega makes: pages, phrasebooks, little tools, media, and shared memories worth keeping close."
    )
    nav_cards = "\n".join(_family_card(section, selected=selected if is_member_page else None) for section in sections)
    content = ""
    section_title = "Family Directory" if is_member_page else "Family Shelves"
    section_hint = (
        "Choose another shelf, or open anything Omega has placed here."
        if is_member_page
        else "Choose a family member to see the pages, images, videos, audio, and files Omega has placed on that shelf."
    )
    directory_section = (
        '<section>'
        f'<div class="section-head"><h2>{_html_text(section_title)}</h2><p class="hint">{_html_text(section_hint)}</p></div>'
        f'<div class="family-grid">{nav_cards}</div>'
        '</section>'
    )
    if is_member_page:
        pages = selected_section["pages"]
        gallery = selected_section["gallery"]
        page_cards = "".join(_public_page_card(page) for page in pages)
        media_cards = "".join(_public_media_card(item, user=user) for item in gallery)
        page_block = f'<h2>Pages</h2><div class="grid">{page_cards}</div>' if page_cards else ""
        media_block = f'<h2>Artifacts</h2><div class="media-grid">{media_cards}</div>' if media_cards else ""
        empty = '<div class="empty">Omega has not placed anything on this shelf yet.</div>' if not pages and not gallery else ""
        content = (
            '<section class="member-detail">'
            f'<div class="member-title"><h2>{_html_text(selected_section["member"])}</h2>'
            f'<p class="hint">{selected_section["count"]} public item{"s" if selected_section["count"] != 1 else ""} on this shelf.</p></div>'
            f'{page_block}'
            f'{media_block}'
            f'{empty}</section>'
        )
    main_sections = f"{content}{directory_section}" if is_member_page else directory_section
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_html_text(page_title)}</title>
  <style>
    :root {{ --bg:#f6f4ef; --ink:#18211d; --muted:#66716b; --line:#d9d6cc; --panel:#fffdf7; --green:#2f7d5f; --shadow:0 18px 45px rgba(28,32,27,.12); }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; min-height:100vh; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--ink); }}
    header {{ min-height:{'38vh' if is_member_page else '76vh'}; display:grid; align-items:end; padding:26px clamp(18px,5vw,70px) 42px; border-bottom:1px solid var(--line); background:linear-gradient(180deg, rgba(246,244,239,{'.82' if is_member_page else '.3'}), var(--bg)), url("https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80") center/cover; }}
    nav {{ position:fixed; z-index:5; top:14px; left:clamp(14px,4vw,46px); right:clamp(14px,4vw,46px); display:flex; justify-content:space-between; align-items:center; gap:12px; color:{'var(--ink)' if is_member_page else '#fffdf7'}; text-shadow:{'none' if is_member_page else '0 1px 18px rgba(0,0,0,.55)'}; }}
    nav a {{ color:{'var(--ink)' if is_member_page else '#fffdf7'}; text-decoration:none; font-weight:720; border:1px solid {'color-mix(in srgb, var(--ink) 35%, transparent)' if is_member_page else 'rgba(255,255,255,.55)'}; border-radius:7px; padding:8px 10px; background:{'rgba(255,253,247,.76)' if is_member_page else 'transparent'}; backdrop-filter:blur(10px); }}
    .brand {{ font-weight:820; font-size:18px; }}
    .hero {{ color:{'var(--ink)' if is_member_page else '#fffdf7'}; text-shadow:{'none' if is_member_page else '0 2px 22px rgba(0,0,0,.62)'}; max-width:840px; }}
    h1 {{ margin:0; font-size:clamp(48px,10vw,118px); line-height:.9; letter-spacing:0; }}
    .lead {{ margin:18px 0 0; max-width:56ch; font-size:clamp(17px,2.1vw,24px); line-height:1.45; }}
    main {{ padding:34px clamp(18px,5vw,70px) 56px; display:grid; gap:34px; }}
    .section-head,.member-title {{ display:flex; justify-content:space-between; gap:16px; align-items:end; border-bottom:1px solid var(--line); padding-bottom:12px; flex-wrap:wrap; }}
    h2 {{ margin:0; font-size:clamp(24px,4vw,42px); letter-spacing:0; }}
    .hint {{ color:var(--muted); max-width:52ch; line-height:1.5; }}
    .family-grid,.grid,.media-grid {{ display:grid; gap:14px; }}
    .family-grid {{ grid-template-columns:repeat(4,minmax(0,1fr)); }}
    .grid {{ grid-template-columns:repeat(3,minmax(0,1fr)); }}
    .media-grid {{ grid-template-columns:repeat(4,minmax(0,1fr)); }}
    .card,.media {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow); text-decoration:none; color:var(--ink); overflow:hidden; }}
    .media-wrap {{ display:block; }}
    .card {{ min-height:150px; padding:18px; display:grid; align-content:space-between; }}
    .card:hover,.media:hover {{ border-color:var(--ink); }}
    .family-card[aria-current="page"] {{ border-color:var(--green); outline:2px solid color-mix(in srgb, var(--green) 32%, transparent); }}
    .card h3,.media h3 {{ margin:0; font-size:22px; letter-spacing:0; }}
    .card p,.media p {{ margin:10px 0 22px; color:var(--muted); line-height:1.5; }}
    .meta {{ color:var(--muted); font-size:13px; display:flex; justify-content:space-between; gap:10px; border-top:1px solid var(--line); padding-top:10px; }}
    .member-detail {{ display:grid; gap:18px; }}
    .thumb {{ width:100%; aspect-ratio:4/3; display:grid; place-items:center; overflow:hidden; background:#111815; }}
    .thumb img,.thumb video {{ width:100%; height:100%; object-fit:cover; display:block; }}
    .audio-tile {{ width:100%; height:100%; display:grid; align-content:center; gap:14px; padding:18px; color:#fffdf7; background:linear-gradient(135deg,#22382f,#1b2331); }}
    .audio-icon {{ font-size:22px; font-weight:820; }}
    .audio-tile audio {{ width:100%; }}
    .media-info {{ padding:12px; }}
    .media-info h3 {{ font-size:17px; }}
    .media-info p {{ font-size:14px; margin:7px 0 0; }}
    .share-form {{ margin:-8px 0 14px; padding:0 12px 12px; background:var(--panel); border:1px solid var(--line); border-top:0; border-radius:0 0 8px 8px; }}
    .share-form button {{ width:100%; padding:10px; border:1px solid var(--green); border-radius:7px; background:transparent; color:var(--green); font-weight:800; cursor:pointer; }}
    .empty {{ border:1px dashed var(--line); border-radius:8px; padding:22px; color:var(--muted); background:rgba(255,253,247,.65); }}
    footer {{ padding:20px clamp(18px,5vw,70px) 34px; color:var(--muted); border-top:1px solid var(--line); display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; }}
    @media (max-width:900px) {{ .family-grid,.grid,.media-grid {{ grid-template-columns:repeat(2,minmax(0,1fr)); }} header {{ min-height:{'34vh' if is_member_page else '70vh'}; }} }}
    @media (max-width:620px) {{ .family-grid,.grid,.media-grid {{ grid-template-columns:1fr; }} }}
  </style>
</head>
<body>
  <nav><a href="/">Omega</a><span><a href="/">Home</a> {'<a href="/admin.html">Admin</a>' if user and user.get("role") == "admin" else ''} <a href="/logout">Logout</a></span></nav>
  <header><div class="hero"><h1>{_html_text(hero_title)}</h1><p class="lead">{_html_text(hero_lead)}</p></div></header>
  <main>
    {main_sections}
  </main>
  <footer><span>Omega for the Grovey Baby family</span><span>Updated {_html_text(data["now"])}</span></footer>
</body>
</html>
"""


def publish_artifact(artifact_id, member="General", title=""):
    try:
        group, rel_path, source = _resolve_artifact_id(artifact_id)
        raw_member = str(member or "").strip()
        member = normalize_family_member(raw_member)
        if not title and raw_member and member == "General" and raw_member.lower() not in FAMILY_ALIASES:
            title = raw_member
        GALLERY_DIR.mkdir(parents=True, exist_ok=True)
        stem = _slug(title or source.stem, default=source.stem)
        target_name = f"{stem}{source.suffix.lower()}"
        target = GALLERY_DIR / target_name
        counter = 2
        while target.exists():
            target_name = f"{stem}-{counter}{source.suffix.lower()}"
            target = GALLERY_DIR / target_name
            counter += 1
        target.write_bytes(source.read_bytes())
        meta = _load_gallery_meta()
        meta[target.name] = {
            "title": str(title or source.stem.replace("_", " ").replace("-", " ")).strip(),
            "caption": f"Published from {group}:{rel_path.as_posix()}",
            "source": f"{group}:{rel_path.as_posix()}",
            "member": member,
            "published": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        _save_gallery_meta(meta)
        return f"PUBLISHED-ARTIFACT {member} {PUBLIC_BASE_URL}/gallery/{target.name}"
    except Exception as exc:
        return f"PUBLISH-ARTIFACT-FAILED {exc}"


def unpublish_artifact(slug):
    try:
        name = _slug(slug)
        target = (GALLERY_DIR / name).resolve()
        root = GALLERY_DIR.resolve()
        if root not in target.parents and target != root:
            raise ValueError("unsafe gallery slug")
        if target.exists():
            target.unlink()
        meta = _load_gallery_meta()
        meta.pop(name, None)
        _save_gallery_meta(meta)
        return f"UNPUBLISHED-ARTIFACT {name}"
    except Exception as exc:
        return f"UNPUBLISH-ARTIFACT-FAILED {exc}"


def list_published_artifacts():
    items = public_gallery()["items"]
    if not items:
        return "PUBLISHED-ARTIFACTS none"
    return "PUBLISHED-ARTIFACTS " + " | ".join(f"{item['member']} {item['slug']} {item['title']}" for item in items[:80])


def diagnostics_logs(target="omega", lines=200):
    try:
        lines = max(20, min(int(lines), 800))
    except Exception:
        lines = 200
    target = str(target or "omega")
    source = LOG_TARGETS.get(target)
    if source is None:
        return {"target": target, "text": "unknown log target"}
    if isinstance(source, pathlib.Path):
        max_bytes = 512000 if target == "terminal" else 300000
        text = _tail_file(source, lines, max_bytes=max_bytes)
    elif str(source).startswith("journal:"):
        text = _journal_tail(str(source).split(":", 1)[1], lines)
    else:
        text = ""
    return {"target": target, "text": _redact(text)}


def _decode_history_text(text):
    text = _redact(text)
    replacements = {
        "_newline_": "\n",
        "_quote_": '"',
        "_apostrophe_": "'",
        "\\n": "\n",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    return text


def _clean_event_detail(text, limit=280):
    text = _decode_history_text(text)
    text = re.sub(r"\s+", " ", text).strip(" ()\"")
    if len(text) > limit:
        text = text[:limit - 1].rstrip() + "..."
    return text


def _history_segments(limit=120):
    text = _tail_chars(MEMORY_DIR / "history.metta", chars=650000)
    starts = list(re.finditer(r'\("(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"', text))
    segments = []
    start_index = max(0, len(starts) - limit)
    for idx in range(start_index, len(starts)):
        match = starts[idx]
        end = starts[idx + 1].start() if idx + 1 < len(starts) else len(text)
        segments.append((match.group(1), text[match.start():end]))
    return segments


def diagnostics_activity(limit=80):
    try:
        limit = max(20, min(int(limit), 200))
    except Exception:
        limit = 80
    events = []
    command_labels = {
        "send": "Send",
        "send-whatsapp": "WhatsApp Send",
        "send-family": "WhatsApp Send",
        "send-telegram": "Telegram Send",
        "send-file": "File Send",
        "send-file-caption": "File Send",
        "send-whatsapp-file": "WhatsApp File",
        "send-whatsapp-file-caption": "WhatsApp File",
        "generate-image": "Image Generation",
        "generate-image-quality": "Image Generation",
        "generate-video": "Video Generation",
        "query": "Memory Query",
        "remember": "Memory Write",
        "pin": "Pin",
        "promote": "Promote",
        "demote": "Demote",
        "metta": "MeTTa",
        "shell": "Shell",
        "write-web-page": "Web Page",
        "list-inbox": "Inbox Check",
        "read-whatsapp-chat": "Inbox Read",
        "mark-whatsapp-read": "Inbox Read",
        "mark-whatsapp-unread": "Inbox Unread",
        "assume-predict": "Assume Prediction",
        "assume-observe-predict": "Assume Prediction",
        "assume-audit": "Assume Audit",
        "assume-outcome": "Assume Outcome",
        "assume-error": "Assume Error",
        "assume-review-growth": "Assume Review",
        "assume-review-adjustment": "Assume Review",
        "assume-accept-growth": "Assume Mutation",
        "assume-accept-adjustment": "Assume Mutation",
        "energy-status": "Energy Check",
        "attention-status": "Attention Check",
        "cycle-status": "Cycle Check",
        "body-status": "Body Check",
        "ecan-pass": "ECAN Pass",
        "attention-scan-persistent": "Attention Scan",
        "attention-review": "Attention Review",
        "space-count": "Space Check",
        "space-find": "Space Search",
    }
    command_re = re.compile(
        r"\((send-whatsapp-file-caption|send-whatsapp-file|send-file-caption|send-whatsapp|send-family|send-telegram|send-file|generate-image-quality|generate-image|generate-video|write-web-page|read-whatsapp-chat|mark-whatsapp-read|mark-whatsapp-unread|list-inbox|assume-observe-predict|assume-predict|assume-audit|assume-outcome|assume-error|assume-review-growth|assume-review-adjustment|assume-accept-growth|assume-accept-adjustment|energy-status|attention-status|cycle-status|body-status|ecan-pass|attention-scan-persistent|attention-review|space-count|space-find|remember|query|pin|promote|demote|metta|shell)\b([^)]{0,500})",
        re.S,
    )
    for timestamp, segment in _history_segments(limit=140):
        decoded = _decode_history_text(segment)
        if "HUMAN_MESSAGE:" in decoded:
            human = decoded.split("HUMAN_MESSAGE:", 1)[1].split("((", 1)[0]
            events.append({"time": timestamp, "kind": "Inbound", "detail": _clean_event_detail(human)})
        if "ERROR_FEEDBACK:" in decoded:
            error = decoded.split("ERROR_FEEDBACK:", 1)[1].split("\n", 1)[0]
            events.append({"time": timestamp, "kind": "Error", "detail": _clean_event_detail(error)})
        for match in command_re.finditer(segment):
            cmd = match.group(1)
            arg = match.group(2)
            detail = _clean_event_detail(arg)
            if cmd == "pin" and len(detail) > 0:
                detail = detail.replace("|", " | ")
            if cmd == "list-inbox":
                detail = "Checked incoming channel queues"
            events.append({"time": timestamp, "kind": command_labels.get(cmd, cmd), "detail": detail or cmd})
    events = events[-limit:]
    return {"events": events}


def _split_metta_tokens(text):
    tokens = []
    token = []
    in_quote = False
    escaped = False
    for ch in str(text or ""):
        if in_quote:
            if escaped:
                token.append({"n": "\n", "r": "\r", "t": "\t"}.get(ch, ch))
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_quote = False
                tokens.append("".join(token))
                token = []
            else:
                token.append(ch)
            continue
        if ch == '"':
            in_quote = True
        elif ch.isspace():
            if token:
                tokens.append("".join(token))
                token = []
        else:
            token.append(ch)
    if token:
        tokens.append("".join(token))
    return tokens


def _atom_rows(text, head):
    rows = []
    pattern = re.compile(r"\(" + re.escape(head) + r"\s+([^()]*)\)")
    for match in pattern.finditer(str(text or "")):
        rows.append(_split_metta_tokens(match.group(1)))
    return rows


def _read_memory_file(name, chars=700000):
    return _tail_chars(MEMORY_DIR / name, chars=chars)


def _read_jsonl(path, limit=200):
    path = pathlib.Path(path)
    if not path.exists():
        return []
    lines = _tail_file(path, limit, max_bytes=500000).splitlines()
    records = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except Exception:
            continue
    return records


def workbench_agenda():
    text = _read_memory_file("agenda.metta")
    columns = {name: [] for name in ("active", "practicing", "waiting", "blocked", "scheduled", "dormant", "remembered")}
    for row in _atom_rows(text, "Goal"):
        if len(row) < 4:
            continue
        name, status, priority = row[:3]
        next_step = " ".join(row[3:])
        key = status.lower()
        if key in {"complete", "completed", "done", "retired"}:
            key = "remembered"
        if key not in columns:
            key = "active"
        columns[key].append({
            "name": name,
            "status": status,
            "priority": priority,
            "next_step": next_step,
            "source": "&agenda",
        })
    order = ["active", "practicing", "waiting", "blocked", "scheduled", "dormant", "remembered"]
    return {"order": order, "columns": columns, "total": sum(len(items) for items in columns.values())}


def _latest_assume_predictions():
    text = _read_memory_file("history.metta", chars=900000)
    latest = {}
    for row in _atom_rows(text, "AssumePrediction"):
        if len(row) >= 4:
            domain, situation, action, score = row[:4]
            latest[f"{domain}::{situation}"] = {"action": action, "score": score}
    for row in _atom_rows(text, "AssumeBest"):
        if len(row) >= 4:
            domain, situation, action, score = row[:4]
            latest.setdefault(f"{domain}::{situation}", {"action": action, "score": score})
    return latest


def workbench_assume():
    text = _read_memory_file("assume.metta")
    trace_text = _read_memory_file("assume_trace.metta", chars=500000)
    latest = _latest_assume_predictions()
    graphs = {}

    def graph(domain, situation=""):
        gid = f"{domain}::{situation}" if situation else str(domain)
        item = graphs.setdefault(gid, {
            "id": gid,
            "domain": domain,
            "situation": situation,
            "features": 0,
            "actions": 0,
            "edges": 0,
            "outcomes": 0,
            "errors": 0,
            "mutations": 0,
            "status": "ok",
            "latest_prediction": None,
        })
        return item

    for row in _atom_rows(text, "AssumeSituation"):
        if len(row) >= 2:
            graph(row[0], row[1])
    for row in _atom_rows(text, "AssumeContextFeature"):
        if len(row) >= 3:
            graph(row[0], row[1])["features"] += 1
    for row in _atom_rows(text, "AssumeAction"):
        if len(row) >= 2:
            domain = row[0]
            for item in graphs.values():
                if item["domain"] == domain:
                    item["actions"] += 1
            if not any(item["domain"] == domain for item in graphs.values()):
                graph(domain)["actions"] += 1
    for row in _atom_rows(text, "AssumeFeatureEdge"):
        if len(row) >= 3:
            domain = row[0]
            matched = False
            for item in graphs.values():
                if item["domain"] == domain:
                    item["edges"] += 1
                    matched = True
            if not matched:
                graph(domain)["edges"] += 1
    for head, key in (("AssumeOutcome", "outcomes"), ("AssumeError", "errors")):
        for row in _atom_rows(text, head):
            if len(row) >= 2:
                graph(row[0], row[1])[key] += 1
    for row in _atom_rows(trace_text, "AssumeMutation"):
        if len(row) >= 3:
            graph(row[1], row[2])["mutations"] += 1
    for gid, prediction in latest.items():
        if gid in graphs:
            graphs[gid]["latest_prediction"] = prediction
    for item in graphs.values():
        if item["errors"] > item["outcomes"]:
            item["status"] = "warn"
        if item["features"] and item["actions"] and not item["edges"]:
            item["status"] = "warn"
    ordered = sorted(graphs.values(), key=lambda item: (item["status"] != "warn", item["id"]))[:80]
    return {"graphs": ordered, "trace_count": len(_atom_rows(trace_text, "AssumeMutation"))}


def _energy_summary():
    try:
        import energy
        raw = energy.energy_status()
    except Exception:
        raw = ""
    pairs = dict(re.findall(r"([a-zA-Z_]+)=([^ ]+)", raw))
    energy_mode = "unknown"
    history = _decode_history_text(_read_memory_file("history.metta", chars=500000))
    mode_matches = list(re.finditer(r'\(set-energy-mode\s+"?([A-Za-z0-9_-]+)"?', history))
    if mode_matches:
        energy_mode = mode_matches[-1].group(1)
    return {
        "raw": raw,
        "energy_mode": energy_mode,
        "spent_today": pairs.get("spent_today", "-"),
        "spent_week": pairs.get("spent_week", "-"),
        "spent_month": pairs.get("spent_month", "-"),
        "budget_detail": f"daily {pairs.get('daily_target', '-')} | monthly {pairs.get('monthly_target', '-')}",
    }


def _vm_resources():
    mem_total = mem_available = 0
    try:
        for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                mem_total = int(line.split()[1]) * 1024
            elif line.startswith("MemAvailable:"):
                mem_available = int(line.split()[1]) * 1024
    except Exception:
        pass
    ram_percent = 0
    if mem_total:
        ram_percent = round((1 - (mem_available / mem_total)) * 100)
    usage = os.statvfs(str(ROOT))
    total = usage.f_blocks * usage.f_frsize
    free = usage.f_bavail * usage.f_frsize
    disk_percent = round((1 - (free / total)) * 100) if total else 0
    try:
        load1, load5, load15 = os.getloadavg()
    except Exception:
        load1 = load5 = load15 = 0.0
    cores = os.cpu_count() or 1
    load_percent = round(min(100, (load1 / cores) * 100))
    return {
        "ram_percent": ram_percent,
        "ram_detail": f"{_human_size(mem_total - mem_available)} used of {_human_size(mem_total)}" if mem_total else "unknown",
        "disk_percent": disk_percent,
        "disk": f"{_human_size(free)} free of {_human_size(total)}",
        "load_percent": load_percent,
        "loadavg": f"{load1:.2f}, {load5:.2f}, {load15:.2f} on {cores} cores",
    }


def workbench_resources():
    omega_running, omega_lines = _pgrep("swipl.*run.metta")
    bridge_running, bridge_lines = _pgrep("bridge.mjs")
    assume_running, assume_lines = _pgrep("assume_fabricd.py")
    energy_info = _energy_summary()
    return {
        "vm": _vm_resources(),
        "omega": energy_info,
        "processes": [
            {"name": "Omega runtime", "state": "active" if omega_running else "inactive", "detail": omega_lines[0] if omega_lines else ""},
            {"name": "WhatsApp bridge", "state": "active" if bridge_running else "inactive", "detail": bridge_lines[0] if bridge_lines else ""},
            {"name": "Assume daemon", "state": "active" if assume_running else "inactive", "detail": assume_lines[0] if assume_lines else ""},
            {"name": "Family webhost", "state": _service_state("omegaclaw-webhost.service"), "detail": f"http://{HOST}:{PORT}"},
            {"name": "Cloudflare tunnel", "state": _service_state("cloudflared.service"), "detail": PUBLIC_BASE_URL},
        ],
    }


def workbench_timeline(limit=120):
    try:
        limit = max(20, min(int(limit), 240))
    except Exception:
        limit = 120
    raw = diagnostics_activity(limit=limit).get("events", [])
    source_map = {
        "Assume": "assume",
        "Memory": "memory",
        "WhatsApp": "channels",
        "Inbox": "channels",
        "Energy": "resources",
        "Attention": "attention",
        "ECAN": "attention",
        "Cycle": "loop",
        "Body": "body",
        "Send": "channels",
        "Error": "immune",
        "Inbound": "senses",
    }
    events = []
    for item in raw:
        kind = str(item.get("kind", "Event"))
        source = "trace"
        for prefix, mapped in source_map.items():
            if kind.startswith(prefix) or prefix in kind:
                source = mapped
                break
        events.append({
            "time": item.get("time", ""),
            "kind": kind,
            "source": source,
            "summary": item.get("detail", ""),
            "confidence": 1.0,
            "links": [],
        })
    return {"events": events[-limit:]}


WORKBENCH_CYCLE_COMMAND_RE = re.compile(
    r"\((send-whatsapp-file-caption|send-whatsapp-file|send-file-caption|send-whatsapp|send-family|send-telegram|send-file|generate-image-quality|generate-image|generate-video|write-web-page|read-whatsapp-chat|mark-whatsapp-read|mark-whatsapp-unread|list-inbox|assume-observe-predict|assume-predict|assume-audit|assume-outcome|assume-error|assume-review-growth|assume-review-adjustment|assume-accept-growth|assume-accept-adjustment|set-energy-mode|set-loop-energy|sleep-for|wake-for|wait|energy-status|attention-status|cycle-status|body-status|ecan-pass|attention-scan-persistent|attention-review|space-count|space-find|remember|query|pin|promote|demote|metta|shell|world-fact|belief-claim|agenda-goal|event-note)\b([^)]{0,700})",
    re.S,
)


def _first_after(text, marker, stop_markers=None, limit=180):
    if marker not in text:
        return ""
    tail = text.split(marker, 1)[1]
    stops = [tail.find(stop) for stop in (stop_markers or []) if stop in tail]
    if stops:
        tail = tail[: min(stops)]
    return _clean_event_detail(tail, limit=limit)


def _cycle_flow(src, dst):
    return {"from": src, "to": dst}


def workbench_cycles(limit=36):
    try:
        limit = max(8, min(int(limit), 80))
    except Exception:
        limit = 36
    cycles = []
    memory_commands = {"remember", "pin", "promote", "demote", "world-fact", "belief-claim", "agenda-goal", "event-note", "space-count", "space-find", "attention-scan-persistent", "attention-review", "ecan-pass"}
    outbound_commands = {"send-whatsapp", "send-family", "send-telegram", "send-file", "send-file-caption", "send-whatsapp-file", "send-whatsapp-file-caption"}
    assume_commands = {cmd for cmd in [
        "assume-observe-predict", "assume-predict", "assume-audit", "assume-outcome", "assume-error",
        "assume-review-growth", "assume-review-adjustment", "assume-accept-growth", "assume-accept-adjustment",
    ]}
    for index, (timestamp, segment) in enumerate(_history_segments(limit=limit * 3), start=1):
        decoded = _decode_history_text(segment)
        command_text = decoded.split('"RESULTS: "', 1)[0]
        command_names = []
        for match in WORKBENCH_CYCLE_COMMAND_RE.finditer(command_text):
            name = match.group(1)
            if name not in command_names:
                command_names.append(name)
        if not command_names and "RESULTS:" not in decoded and "HUMAN_MESSAGE:" not in decoded and "ERROR_FEEDBACK:" not in decoded:
            continue

        has_inbound = "HUMAN_MESSAGE:" in decoded
        has_results = "RESULTS:" in decoded
        has_error = "ERROR_FEEDBACK:" in decoded or "FORMAT_ERROR" in decoded or "FAILED" in decoded or "Error" in decoded
        has_memory = bool(memory_commands.intersection(command_names))
        has_outbound = bool(outbound_commands.intersection(command_names))
        has_assume = bool(assume_commands.intersection(command_names))
        has_sleep = bool({"wait", "sleep-for", "wake-for", "set-energy-mode", "set-loop-energy"}.intersection(command_names))
        has_habitat = any(cmd in command_names for cmd in ["generate-image", "generate-image-quality", "generate-video", "write-web-page"])

        phases = {
            "receive": has_inbound,
            "provider": bool(command_names or has_results),
            "syntax": bool(command_names),
            "metta": has_results or has_error,
            "skills": bool(command_names),
            "memory": has_memory,
            "outbound": has_outbound or has_habitat,
            "sleep": has_sleep,
        }
        nodes = ["loop"]
        flows = []
        if phases["receive"]:
            nodes.extend(["receive", "context"])
            flows.extend([_cycle_flow("loop", "receive"), _cycle_flow("receive", "context")])
        if phases["provider"]:
            nodes.extend(["context", "provider"])
            flows.append(_cycle_flow("context", "provider"))
        if phases["syntax"]:
            nodes.extend(["provider", "syntax"])
            flows.append(_cycle_flow("provider", "syntax"))
        if phases["metta"]:
            nodes.extend(["syntax", "metta"])
            flows.append(_cycle_flow("syntax", "metta"))
        if phases["skills"]:
            nodes.extend(["metta", "skills"])
            flows.append(_cycle_flow("metta", "skills"))
        if phases["memory"]:
            nodes.extend(["metta", "spaces"])
            flows.append(_cycle_flow("metta", "spaces"))
        if has_assume:
            nodes.extend(["metta", "assume"])
            flows.append(_cycle_flow("metta", "assume"))
        if has_outbound:
            nodes.extend(["skills", "channels"])
            flows.append(_cycle_flow("skills", "channels"))
        if has_habitat:
            nodes.extend(["skills", "habitat"])
            flows.append(_cycle_flow("skills", "habitat"))
        if phases["sleep"]:
            nodes.extend(["sleep"])
            flows.append(_cycle_flow("sleep", "loop"))
        if has_error:
            nodes.append("syntax")

        inbound = _first_after(decoded, "HUMAN_MESSAGE:", ['"((', "\n ("], limit=150)
        result = _first_after(decoded, '"RESULTS: "', ['"\n)'], limit=170)
        error = _first_after(decoded, "ERROR_FEEDBACK:", ["\n"], limit=150)
        summary = " | ".join(part for part in [
            inbound or "",
            ", ".join(command_names[:4]) if command_names else "",
            "error" if has_error else "",
        ] if part).strip()
        if not summary:
            summary = "quiet result cycle" if has_results else "trace cycle"
        evidence = {
            "receive": inbound,
            "provider": "LLM/provider output yielded command forms" if command_names else "",
            "syntax": ", ".join(command_names) if command_names else "",
            "metta": result or error,
            "skills": ", ".join(command_names) if command_names else "",
            "memory": ", ".join(cmd for cmd in command_names if cmd in memory_commands),
            "outbound": ", ".join(cmd for cmd in command_names if cmd in outbound_commands or cmd in {"generate-image", "generate-image-quality", "generate-video", "write-web-page"}),
            "sleep": ", ".join(cmd for cmd in command_names if cmd in {"wait", "sleep-for", "wake-for", "set-energy-mode", "set-loop-energy"}),
        }
        delta_chips = [
            {"label": "inbound", "on": has_inbound},
            {"label": f"{len(command_names)} command{'s' if len(command_names) != 1 else ''}", "on": bool(command_names)},
            {"label": "memory", "on": has_memory},
            {"label": "outbound", "on": has_outbound},
            {"label": "assume", "on": has_assume},
            {"label": "habitat", "on": has_habitat},
            {"label": "sleep", "on": has_sleep},
            {"label": "error", "on": has_error},
        ]
        primary_delta = "error" if has_error else (
            "outbound action" if has_outbound else (
                "memory update" if has_memory else (
                    "assumption work" if has_assume else (
                        "habitat action" if has_habitat else (
                            "sleep/wait" if has_sleep else "symbolic result"
                        )
                    )
                )
            )
        )
        transforms = {
            "sense": inbound or "No explicit inbound marker in this history segment.",
            "command": ", ".join(command_names) if command_names else "No command form captured before RESULTS.",
            "result": result or error or "No explicit result text extracted.",
            "consequence": primary_delta,
        }
        cycles.append({
            "id": f"{timestamp}-{len(cycles)}",
            "index": len(cycles) + 1,
            "time": timestamp,
            "summary": _clean_event_detail(summary, limit=150),
            "commands": command_names[:12],
            "phases": phases,
            "nodes": sorted(set(nodes), key=nodes.index),
            "flows": flows,
            "evidence": evidence,
            "transforms": transforms,
            "delta": {"primary": primary_delta, "chips": delta_chips},
            "source": "memory/history.metta",
            "raw_chars": len(decoded),
        })
    cycles = cycles[-limit:]
    for idx, cycle in enumerate(cycles, start=1):
        cycle["index"] = idx
    return {"cycles": cycles, "source": "history.metta", "phase_order": ["receive", "provider", "syntax", "metta", "skills", "memory", "outbound", "sleep"]}


ATOM_MAP_FULL_READ_LIMIT = 25_000_000
ATOM_MAP_PREVIEW_CHARS = 220


def _iter_top_level_atoms(text):
    """Yield top-level MeTTa atoms without evaluating or rewriting them."""
    start = None
    depth = 0
    in_string = False
    escaped = False
    for index, char in enumerate(text):
        if start is None:
            if char == "(":
                start = index
                depth = 1
            continue

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth <= 0:
                atom = text[start:index + 1].strip()
                if atom:
                    yield atom
                start = None
                depth = 0


def _metta_atom_kind(atom):
    match = re.match(r"\(\s*([^\s()]+)", atom)
    return match.group(1) if match else "Atom"


def _atom_preview(atom):
    compact = " ".join(atom.split())
    if len(compact) <= ATOM_MAP_PREVIEW_CHARS:
        return compact
    return compact[:ATOM_MAP_PREVIEW_CHARS - 1] + "…"


def _atom_map_files():
    files = {}
    for path in sorted(MEMORY_DIR.glob("*.metta")):
        files[path.stem] = path
    for name in ("persistent", "world", "beliefs", "events", "agenda", "assume", "attention", "activity", "history"):
        files.setdefault(name, MEMORY_DIR / f"{name}.metta")
    return files


def workbench_atom_map(include_preview=True, include_labels=False):
    files = _atom_map_files()

    atoms = []
    spaces = []
    complete = True
    for name, path in sorted(files.items()):
        size = path.stat().st_size if path.exists() else 0
        if not path.exists():
            spaces.append({"name": name, "atoms": 0, "bytes": 0, "complete": True, "groups": []})
            continue
        read_complete = size <= ATOM_MAP_FULL_READ_LIMIT
        complete = complete and read_complete
        text = path.read_text(encoding="utf-8", errors="replace") if read_complete else _tail_chars(path, chars=ATOM_MAP_FULL_READ_LIMIT)
        groups = {}
        atom_count = 0
        for atom in _iter_top_level_atoms(text):
            kind = _metta_atom_kind(atom)
            groups[kind] = groups.get(kind, 0) + 1
            atom_count += 1
            digest = hashlib.sha1(f"{name}\0{atom}".encode("utf-8", errors="replace")).hexdigest()[:16]
            record = {
                "id": digest,
                "space": name,
                "kind": kind,
                "chars": len(atom),
                "complete_source": read_complete,
            }
            if include_preview:
                record["preview"] = _atom_preview(atom)
            if include_labels:
                record["label"] = atom
            atoms.append(record)
        spaces.append({
            "name": name,
            "atoms": atom_count,
            "bytes": size,
            "complete": read_complete,
            "groups": [{"kind": kind, "count": count} for kind, count in sorted(groups.items())],
        })
    return {
        "atoms": atoms,
        "spaces": spaces,
        "complete": complete,
        "source": "memory/*.metta",
        "identity": "sha1(space + atom text), for UI continuity only",
    }


def workbench_atom_label(atom_id):
    atom_id = str(atom_id or "").strip()
    if not re.fullmatch(r"[0-9a-f]{16}", atom_id):
        return None
    for name, path in sorted(_atom_map_files().items()):
        if not path.exists():
            continue
        size = path.stat().st_size
        read_complete = size <= ATOM_MAP_FULL_READ_LIMIT
        text = path.read_text(encoding="utf-8", errors="replace") if read_complete else _tail_chars(path, chars=ATOM_MAP_FULL_READ_LIMIT)
        for atom in _iter_top_level_atoms(text):
            digest = hashlib.sha1(f"{name}\0{atom}".encode("utf-8", errors="replace")).hexdigest()[:16]
            if digest == atom_id:
                return {
                    "id": digest,
                    "space": name,
                    "kind": _metta_atom_kind(atom),
                    "chars": len(atom),
                    "label": atom,
                    "complete_source": read_complete,
                }
    return None


def _atom_trace_action(window):
    lower = window.lower()
    if "space-transform" in lower or "memory-merged" in lower:
        return "merge"
    if "remove-atom" in lower or "retire" in lower:
        return "remove"
    if "add-atom" in lower or "assimilate" in lower or "remember" in lower:
        return "write"
    if "match" in lower or "find" in lower or "space-atoms" in lower or "space-examples" in lower:
        return "read"
    return "touch"


def _native_activity_traces(atom_map):
    activity_path = MEMORY_DIR / "activity.metta"
    if not activity_path.exists():
        return []
    activity_text = activity_path.read_text(encoding="utf-8", errors="replace")
    activity_atoms = list(_iter_top_level_atoms(activity_text))[-160:]
    target_atoms = [
        atom for atom in atom_map.get("atoms", [])
        if atom.get("space") != "activity" and atom.get("label")
    ]
    traces = []
    seen = set()
    for order, trace_atom in enumerate(activity_atoms):
        action_match = re.match(r'\(\s*(AtomTouch|SpaceTouch|AtomMerge)\s+\S+\s+"?([^"\s)]+)"?', trace_atom)
        trace_type = action_match.group(1) if action_match else _metta_atom_kind(trace_atom)
        action = action_match.group(2) if action_match else _atom_trace_action(trace_atom)
        strength = round(0.46 + (order / max(1, len(activity_atoms))) * 0.52, 3)
        if trace_type == "SpaceTouch":
            space_match = re.match(r'\(\s*SpaceTouch\s+\S+\s+"?([^"\s)]+)"?\s+"?([^"\s)]+)"?', trace_atom)
            if space_match:
                traces.append({
                    "type": "SpaceTouch",
                    "space": space_match.group(2),
                    "kind": action,
                    "action": action,
                    "strength": strength,
                    "source": "activity.metta",
                    "reason": "native MeTTa space trace",
                })
            continue
        for atom in target_atoms:
            label = atom.get("label") or ""
            if len(label) < 8 or label not in trace_atom:
                continue
            key = (trace_atom, atom.get("id"), action)
            if key in seen:
                continue
            seen.add(key)
            traces.append({
                "type": "AtomTouch" if trace_type != "AtomMerge" else "AtomMerge",
                "atom_id": atom.get("id"),
                "space": atom.get("space"),
                "kind": atom.get("kind"),
                "action": "merge" if trace_type == "AtomMerge" else action,
                "strength": strength,
                "source": "activity.metta",
                "reason": "native MeTTa atom trace",
            })
    return traces


def workbench_atom_traces(atom_map=None, timeline=None):
    atom_map = atom_map or workbench_atom_map(include_preview=False, include_labels=True)
    timeline = timeline or workbench_timeline(limit=24)["events"]
    native_traces = _native_activity_traces(atom_map)
    history = _read_memory_file("history.metta", chars=360000)
    terminal = _tail_file(MEMORY_DIR / "web" / "terminal.log", 80, max_bytes=120000)
    recent = f"{history[-260000:]}\n{terminal}"
    recent_lower = recent.lower()
    traces = list(native_traces)
    seen = {trace.get("atom_id") for trace in native_traces if trace.get("atom_id")}
    for atom in atom_map.get("atoms", []):
        label = atom.get("label") or ""
        if len(label) < 18 or len(label) > 6000:
            continue
        kind = str(atom.get("kind") or "").lower()
        if kind and kind not in recent_lower:
            continue
        index = recent.find(label)
        if index < 0:
            compact = " ".join(label.split())
            if compact == label or len(compact) < 18:
                continue
            index = recent.find(compact)
            if index < 0:
                continue
        key = atom.get("id")
        if key in seen:
            continue
        seen.add(key)
        window = recent[max(0, index - 700): index + min(len(label), 1000) + 700]
        recency = index / max(1, len(recent))
        action = _atom_trace_action(window)
        traces.append({
            "type": "AtomTouch",
            "atom_id": key,
            "space": atom.get("space"),
            "kind": atom.get("kind"),
            "action": action,
            "strength": round(0.35 + recency * 0.65, 3),
            "source": "history-exact-atom-match",
            "reason": f"recent loop trace contains exact {atom.get('space')} atom label",
        })

    command_to_space = {
        "persistent-fact": "persistent",
        "persistent-note": "persistent",
        "persistent-expression": "persistent",
        "retire-persistent-expression": "persistent",
        "world-fact": "world",
        "belief-claim": "beliefs",
        "agenda-goal": "agenda",
        "event-note": "events",
        "assimilate-event": "events",
        "assimilate-world": "world",
        "assimilate-belief": "beliefs",
        "assimilate-persistent": "persistent",
        "space-find": "spaces",
        "space-count": "spaces",
        "space-examples": "spaces",
        "space-atoms": "spaces",
        "space-transform": "spaces",
        "ecan-pass": "attention",
        "attention-scan-persistent": "attention",
        "assume-predict": "assume",
        "assume-observe-predict": "assume",
        "assume-audit": "assume",
        "assume-outcome": "assume",
        "assume-error": "assume",
        "assume-accept-growth": "assume",
        "assume-accept-adjustment": "assume",
    }
    for event in timeline[-12:]:
        for command in event.get("commands", []):
            space = command_to_space.get(command)
            if not space:
                continue
            traces.append({
                "type": "SpaceTouch",
                "space": space,
                "kind": command,
                "action": "route",
                "strength": 0.42,
                "source": "history-command-route",
                "reason": f"recent command routed toward {space}",
            })
    return {
        "traces": traces[-220:],
        "source": "history.metta + terminal.log",
        "semantics": "native activity.metta traces first; exact history atom matches and command space routes as fallback",
    }


def _workbench_brain_uncached(public=False):
    timeline = workbench_timeline(limit=90)["events"]
    pulse_counts = {}
    for event in timeline:
        source = event.get("source") or "trace"
        pulse_counts[source] = pulse_counts.get(source, 0) + 1
    spaces = []
    files = {
        "persistent": MEMORY_DIR / "persistent.metta",
        "world": MEMORY_DIR / "world.metta",
        "beliefs": MEMORY_DIR / "beliefs.metta",
        "events": MEMORY_DIR / "events.metta",
        "agenda": MEMORY_DIR / "agenda.metta",
        "assume": MEMORY_DIR / "assume.metta",
        "attention": MEMORY_DIR / "attention.metta",
        "activity": MEMORY_DIR / "activity.metta",
        "history": MEMORY_DIR / "history.metta",
    }
    limits = {
        "persistent": 10000,
        "agenda": 20000,
        "beliefs": 50000,
        "world": 50000,
        "events": 50000,
        "assume": 1000000,
        "attention": 50000,
        "activity": 60000,
        "history": 500000000,
    }
    source_by_space = {"assume": "assume", "attention": "attention", "activity": "trace", "agenda": "trace", "events": "senses", "history": "trace"}
    for name, path in files.items():
        text = _tail_chars(path, chars=120000) if path.exists() else ""
        size = path.stat().st_size if path.exists() else 0
        atoms = len([line for line in text.splitlines() if line.strip().startswith("(")])
        limit = limits.get(name, 120000)
        ratio = size / max(limit, 1)
        pressure = "high" if ratio > 0.85 else ("medium" if ratio > 0.55 else "low")
        spaces.append({
            "name": name,
            "atoms_estimate": atoms,
            "bytes": size,
            "pressure": pressure,
            "recent_activity": pulse_counts.get(source_by_space.get(name, name), 0),
        })
    trace_atom_map = workbench_atom_map(include_preview=False, include_labels=True)
    visible_atom_map = workbench_atom_map(include_preview=not public, include_labels=False)
    pulses = [{"from": event.get("source"), "to": "events", "kind": event.get("kind"), "time": event.get("time")} for event in timeline[-24:]]
    return {
        "spaces": spaces,
        "pulses": pulses,
        "architecture": workbench_architecture(timeline=timeline, spaces=spaces),
        "atom_map": visible_atom_map,
        "atom_traces": workbench_atom_traces(atom_map=trace_atom_map, timeline=timeline),
    }


def workbench_brain(public=False):
    cache_key = "public" if public else "admin"
    now = time.monotonic()
    cached = _BRAIN_CACHE.get(cache_key)
    if cached and now - cached["time"] < BRAIN_CACHE_TTL_SECONDS:
        return cached["value"]
    with _BRAIN_CACHE_LOCK:
        now = time.monotonic()
        cached = _BRAIN_CACHE.get(cache_key)
        if cached and now - cached["time"] < BRAIN_CACHE_TTL_SECONDS:
            return cached["value"]
        value = _workbench_brain_uncached(public=public)
        _BRAIN_CACHE[cache_key] = {"time": time.monotonic(), "value": value}
        return value


def workbench_architecture(timeline=None, spaces=None):
    timeline = timeline or workbench_timeline(limit=90)["events"]
    spaces = spaces or []
    space_by_name = {space.get("name"): space for space in spaces}
    history = _read_memory_file("history.metta", chars=520000)
    terminal = _tail_file(MEMORY_DIR / "web" / "terminal.log", 120, max_bytes=160000)
    recent = f"{history[-220000:]}\n{terminal}"

    def count_any(*terms):
        return sum(recent.count(term) for term in terms)

    activity = {
        "loop": count_any("---------iteration", "(cycle-status", "CYCLE:"),
        "receive": sum(1 for event in timeline if event.get("kind") == "Inbound" or event.get("source") in {"senses", "channels"}),
        "context": count_any("PROMPT:", "HISTORY:", "MOST_PROMOTED_MEMORIES:", "CHARS_SENT:"),
        "provider": count_any("CHARS_SENT:", "ENERGY-STATUS", "cost-last-call"),
        "syntax": count_any("signature_balance_parentheses", "RESPONSE:", "MULTI_COMMAND_FAILURE", "SINGLE_COMMAND_FORMAT_ERROR"),
        "metta": count_any("sread", "COMMAND_RETURN:", "RESULTS:", "(metta "),
        "skills": len([event for event in timeline if event.get("kind") not in {"Inbound", "Error"}]),
        "spaces": sum(int(space.get("recent_activity") or 0) for space in spaces),
        "assume": sum(1 for event in timeline if event.get("source") == "assume" or "Assume" in event.get("kind", "")),
        "export": count_any("export!", "bound-space!", "SPACE-PRESSURE"),
        "channels": sum(1 for event in timeline if event.get("source") == "channels"),
        "habitat": sum(1 for event in timeline if re.search(r"House|Image|Audio|Glucose|Web Page|Generation", event.get("kind", ""))),
        "sleep": count_any("(wait ", "sleep", "genuine-silence"),
    }
    def max_pressure(values):
        rank = {"low": 0, "medium": 1, "high": 2}
        best = "low"
        for value in values:
            if rank.get(value, 0) > rank.get(best, 0):
                best = value
        return best

    pressure = {
        "spaces": max_pressure(space.get("pressure", "low") for space in spaces),
        "assume": space_by_name.get("assume", {}).get("pressure", "low"),
    }
    nodes = [
        {"id": "loop", "label": "loop.metta", "layer": "body", "x": 500, "y": 82, "z": 3, "activity": activity["loop"], "pressure": "low", "source": "src/loop.metta", "role": "recursive autonomous loop"},
        {"id": "receive", "label": "receive", "layer": "senses", "x": 178, "y": 166, "z": 2, "activity": activity["receive"], "pressure": "low", "source": "channels/router.py + channels.metta", "role": "messages and app senses enter cognition"},
        {"id": "context", "label": "getContext", "layer": "mind", "x": 372, "y": 186, "z": 2, "activity": activity["context"], "pressure": "low", "source": "src/loop.metta:getContext", "role": "prompt, skills, history, memories, time"},
        {"id": "provider", "label": "LLM provider", "layer": "cognition", "x": 626, "y": 186, "z": 2, "activity": activity["provider"], "pressure": "low", "source": "lib_llm_ext.callProvider", "role": "replaceable cognition engine"},
        {"id": "syntax", "label": "syntax membrane", "layer": "immune", "x": 822, "y": 166, "z": 2, "activity": activity["syntax"], "pressure": "medium" if "FORMAT_ERROR" in recent else "low", "source": "helper.signature_balance_parentheses", "role": "normalizes language into safe MeTTa command shape"},
        {"id": "metta", "label": "MeTTa eval", "layer": "reason", "x": 500, "y": 294, "z": 3, "activity": activity["metta"], "pressure": "low", "source": "sread/eval/collapse in src/loop.metta", "role": "symbolic execution substrate"},
        {"id": "skills", "label": "skills", "layer": "hands", "x": 278, "y": 394, "z": 2, "activity": activity["skills"], "pressure": "low", "source": "src/skills.metta + skill_signatures.metta", "role": "modular actions and affordances"},
        {"id": "spaces", "label": "&spaces", "layer": "memory", "x": 500, "y": 430, "z": 2, "activity": activity["spaces"], "pressure": pressure["spaces"], "source": "&persistent &agenda &beliefs &world &events", "role": "durable symbolic state"},
        {"id": "assume", "label": "Assume/Fabric", "layer": "prediction", "x": 722, "y": 394, "z": 2, "activity": activity["assume"], "pressure": pressure["assume"], "source": "&assume + assume_fabricd.py", "role": "bounded symbolic prediction membrane"},
        {"id": "channels", "label": "channels", "layer": "voice", "x": 145, "y": 506, "z": 1, "activity": activity["channels"], "pressure": "low", "source": "WhatsApp, Telegram, router", "role": "social send/receive surfaces"},
        {"id": "habitat", "label": "habitat", "layer": "world", "x": 340, "y": 536, "z": 1, "activity": activity["habitat"], "pressure": "low", "source": "home, glucose, webcam, vision, audio, webhost", "role": "house, health, media, publishing apps"},
        {"id": "export", "label": "export", "layer": "persistence", "x": 660, "y": 536, "z": 1, "activity": activity["export"], "pressure": "low", "source": "bound-space! and export!", "role": "writes spaces back to persistent files"},
        {"id": "sleep", "label": "sleep/recurse", "layer": "body", "x": 855, "y": 506, "z": 1, "activity": activity["sleep"], "pressure": "low", "source": "sleep, cut, gc, omegaclaw(+1)", "role": "cadence and next cycle"},
    ]
    flows = [
        ("loop", "receive"), ("receive", "context"), ("context", "provider"), ("provider", "syntax"),
        ("syntax", "metta"), ("metta", "skills"), ("metta", "spaces"), ("metta", "assume"),
        ("skills", "channels"), ("skills", "habitat"), ("spaces", "export"), ("assume", "export"),
        ("export", "sleep"), ("channels", "sleep"), ("habitat", "sleep"), ("sleep", "loop"),
    ]
    pulse_terms = {
        "receive": ["Inbound", "Inbox"],
        "provider": ["CHARS_SENT", "cost-last-call"],
        "syntax": ["RESPONSE", "FORMAT_ERROR"],
        "metta": ["RESULTS", "COMMAND_RETURN"],
        "skills": ["COMMAND_RETURN"],
        "spaces": ["remember", "world-fact", "belief-claim", "agenda-goal", "event-note"],
        "assume": ["Assume"],
        "channels": ["WhatsApp", "Telegram", "Send"],
        "habitat": ["House", "Glucose", "Image", "Audio", "Web Page"],
        "sleep": ["wait", "sleep"],
    }
    live_flows = []
    for index, (src, dst) in enumerate(flows):
        terms = pulse_terms.get(src, []) + pulse_terms.get(dst, [])
        active = any(term in recent[-120000:] for term in terms)
        live_flows.append({"from": src, "to": dst, "active": active, "order": index})
    return {
        "nodes": nodes,
        "flows": live_flows,
        "summary": {
            "recent_loop_iterations": activity["loop"],
            "provider_calls": activity["provider"],
            "metta_results": activity["metta"],
            "skill_events": activity["skills"],
        },
    }


def workbench_overview():
    status = diagnostics_status()
    resources = workbench_resources()
    agenda = workbench_agenda()
    assume = workbench_assume()
    timeline = workbench_timeline(limit=80)["events"]
    errors = [event for event in timeline if "Error" in event.get("kind", "")]
    active_goals = len(agenda["columns"].get("active", [])) + len(agenda["columns"].get("practicing", []))
    open_loops = []
    if errors:
        open_loops.append({"title": "Recent errors need review", "detail": errors[-1].get("summary", ""), "severity": "high"})
    warn_graphs = [graph for graph in assume["graphs"] if graph.get("status") == "warn"]
    if warn_graphs:
        open_loops.append({"title": "Assume graph wants attention", "detail": warn_graphs[0]["id"], "severity": "medium"})
    blocked = agenda["columns"].get("blocked", [])
    waiting = agenda["columns"].get("waiting", [])
    if blocked or waiting:
        open_loops.append({"title": "Agenda has waiting or blocked work", "detail": f"{len(waiting)} waiting, {len(blocked)} blocked", "severity": "medium"})
    omega = {
        "running": status["omega"]["running"],
        "detail": status["omega"]["detail"],
        "cycle": "-",
        "energy_mode": resources["omega"].get("energy_mode", "unknown"),
        "current_focus": "",
    }
    history = _read_memory_file("history.metta", chars=160000)
    cycle_match = list(re.finditer(r"CYCLE:?\s*([0-9]+)", history))
    if cycle_match:
        omega["cycle"] = cycle_match[-1].group(1)
    else:
        terminal = _tail_file(MEMORY_DIR / "web" / "terminal.log", 180, max_bytes=220000)
        iter_match = list(re.finditer(r"iteration\s+([0-9]+)", terminal))
        if iter_match:
            omega["cycle"] = iter_match[-1].group(1)
    pin_matches = list(re.finditer(r"\(pin\s+\"([^\"]{0,240})", history))
    if pin_matches:
        omega["current_focus"] = _clean_event_detail(pin_matches[-1].group(1), limit=160)
    return {
        "now": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "omega": omega,
        "health": {"status": "ok" if status["omega"]["running"] and not errors else "warn", "warnings": [loop["title"] for loop in open_loops]},
        "counts": {
            "active_goals": active_goals,
            "open_loops": len(open_loops),
            "recent_errors": len(errors),
            "assume_graphs": len(assume["graphs"]),
        },
        "open_loops": open_loops,
    }


def write_web_page(slug, html_content):
    try:
        _ensure_public_dir()
        target, rel = _target(slug, default_suffix=".html")
        if rel.as_posix() in RESERVED_WEB_PAGES:
            return f"WEB-PAGE-FAILED reserved page {rel.as_posix()} cannot be overwritten; choose a unique slug"
        target.parent.mkdir(parents=True, exist_ok=True)
        content = str(html_content or "")
        if "<html" not in content.lower():
            title = html.escape(pathlib.Path(rel.name).stem.replace("-", " ").title())
            body = content
            content = (
                "<!doctype html><html><head><meta charset=\"utf-8\">"
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                f"<title>{title}</title></head><body>{body}</body></html>\n"
            )
        target.write_text(content, encoding="utf-8")
        return f"WEB-PAGE-WRITTEN {PUBLIC_BASE_URL}/{rel.as_posix()}"
    except Exception as exc:
        return f"WEB-PAGE-FAILED {exc}"


def list_web_pages():
    _ensure_public_dir()
    files = []
    for path in sorted(PUBLIC_DIR.rglob("*")):
        if path.is_file() and path.suffix.lower() in ALLOWED_SUFFIXES:
            files.append(path.relative_to(PUBLIC_DIR).as_posix())
    if not files:
        return "WEB-PAGES none"
    return "WEB-PAGES " + " | ".join(files[:80])


def public_web_url(slug="index.html"):
    try:
        _, rel = _target(slug, default_suffix=".html")
        return f"{PUBLIC_BASE_URL}/{rel.as_posix()}"
    except Exception as exc:
        return f"WEB-URL-FAILED {exc}"


def webhost_status():
    _ensure_public_dir()
    try:
        proc = subprocess.run(
            ["systemctl", "is-active", "omegaclaw-webhost.service"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        state = proc.stdout.strip() or proc.stderr.strip()
    except Exception:
        state = "unknown"
    return f"WEBHOST {state} local http://{HOST}:{PORT} public {PUBLIC_BASE_URL}"


class QuietHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
    }

    def log_message(self, format, *args):
        return

    def list_directory(self, path):
        self.send_error(404, "No directory listing")
        return None

    def _parsed(self):
        return urllib.parse.urlparse(self.path)

    def _query(self):
        return urllib.parse.parse_qs(self._parsed().query)

    def _cookies(self):
        cookies = {}
        for part in self.headers.get("Cookie", "").split(";"):
            if "=" in part:
                key, value = part.strip().split("=", 1)
                cookies[key] = value
        return cookies

    def _current_user(self):
        token = self._cookies().get(SESSION_COOKIE, "")
        if not token:
            return None
        sessions = _load_sessions()
        session = sessions.get(token)
        if not session or int(session.get("expires", 0)) <= int(time.time()):
            return None
        users = _load_users()
        user = users.get(str(session.get("username", "")).lower())
        if not user:
            return None
        return dict(user, username=str(session.get("username", "")).lower())

    def _is_admin(self):
        user = self._current_user()
        return bool(user and user.get("role") == "admin") or self._authorized()

    def _authorized(self):
        expected = _admin_token()
        supplied = self.headers.get("X-Omega-Admin-Token", "").strip()
        if not supplied:
            supplied = (self._query().get("token") or [""])[0].strip()
        if bool(expected) and secrets.compare_digest(expected, supplied):
            return True
        user = self._current_user()
        return bool(user and user.get("role") == "admin")

    def _send_json(self, payload, status=200):
        callback = (self._query().get("callback") or [""])[0].strip()
        raw = json.dumps(payload, ensure_ascii=False)
        if callback and re.fullmatch(r"omegaJsonp[0-9]+", callback):
            data = f"{callback}({raw});".encode("utf-8")
            content_type = "application/javascript; charset=utf-8"
        else:
            data = raw.encode("utf-8")
            content_type = "application/json; charset=utf-8"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _proxy_agentverse_submit(self, method="GET", body=b""):
        headers = {}
        for name in ("Content-Type", "X-Uagents-Connection", "X-Uagents-Address"):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        try:
            conn = http.client.HTTPConnection("127.0.0.1", AGENTVERSE_SUBMIT_PROXY_PORT, timeout=20)
            conn.request(method, "/submit", body=body, headers=headers)
            response = conn.getresponse()
            data = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() in {"transfer-encoding", "connection", "server", "date"}:
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if method != "HEAD":
                self.wfile.write(data)
        except Exception as exc:
            self._send_json({"error": "agentverse listener unavailable", "detail": str(exc)}, status=502)
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _require_auth(self):
        if self._authorized():
            return True
        self._send_json({"error": "unauthorized"}, status=401)
        return False

    def _require_family_user(self):
        user = self._current_user()
        if user:
            return user
        if self._authorized():
            return {"name": "Jon", "role": "admin", "member": "Jon", "username": "jon"}
        return None

    def _redirect(self, location):
        self.send_response(303)
        self.send_header("Location", location)
        self.end_headers()

    def _session_cookie(self, token):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={60*60*24*30}{secure}"

    def _artifact_path(self):
        parsed = self._parsed()
        parts = pathlib.PurePosixPath(urllib.parse.unquote(parsed.path)).parts
        if len(parts) < 3 or parts[0] != "/" or parts[1] != "artifact":
            raise ValueError("bad artifact path")
        group = parts[2]
        root = ARTIFACT_ROOTS.get(group)
        if root is None:
            raise ValueError("unknown artifact group")
        rel = pathlib.PurePosixPath(*parts[3:])
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError("unsafe artifact path")
        target = (root / pathlib.Path(*rel.parts)).resolve()
        root_resolved = root.resolve()
        if root_resolved not in target.parents and target != root_resolved:
            raise ValueError("artifact escaped root")
        if not target.is_file() or target.suffix.lower() not in ALLOWED_SUFFIXES:
            raise FileNotFoundError("artifact not found")
        return target

    def _send_artifact(self):
        user = self._require_family_user()
        if not user:
            self.send_error(401, "Unauthorized")
            return
        try:
            target = self._artifact_path()
        except Exception:
            self.send_error(404, "Not found")
            return
        if GALLERY_DIR.resolve() in target.parents or target.parent.resolve() == GALLERY_DIR.resolve():
            meta = _load_gallery_meta().get(target.name, {})
            if not _user_can_view_member(user, meta.get("member", "General")):
                self.send_error(404, "Not found")
                return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_public_family(self, member=None, include_body=True):
        user = self._require_family_user()
        if not user:
            self._redirect("/login")
            return
        if member and not _user_can_view_member(user, member):
            self.send_error(404, "Not found")
            return
        data = render_family_page(member, user=user).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)

    def _send_os_portal(self, include_body=True):
        if OMEGA_OS_DIST_INDEX.exists():
            data = OMEGA_OS_DIST_INDEX.read_bytes()
        else:
            data = OMEGA_OS_PORTAL_HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)

    def _send_public_index(self, include_body=True):
        index = PUBLIC_DIR / "home.html"
        if not index.exists():
            index = PUBLIC_DIR / "index.html"
        if not index.exists():
            self.send_error(404, "Not found")
            return
        data = index.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)

    def do_HEAD(self):
        parsed = self._parsed()
        if parsed.path == "/submit":
            self._proxy_agentverse_submit(method="HEAD")
            return
        if parsed.path == "/login":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            return
        if parsed.path in {"/workbench", "/workbench.html"}:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            return
        if parsed.path in {"/", "/index.html"}:
            self._send_public_index(include_body=False)
            return
        family_match = re.match(r"^/family/([^/]+)/?$", parsed.path)
        if family_match:
            member = urllib.parse.unquote(family_match.group(1))
            self._send_public_family(member=member, include_body=False)
            return
        return super().do_HEAD()

    def do_GET(self):
        parsed = self._parsed()
        if parsed.path == "/submit":
            self._proxy_agentverse_submit(method="GET")
            return
        user = self._require_family_user()
        if parsed.path == "/login":
            data = _login_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/logout":
            self.send_response(303)
            self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")
            self.send_header("Location", "/login")
            self.end_headers()
            return
        if parsed.path in {"/", "/index.html"}:
            self._send_public_index()
            return
        if parsed.path.startswith("/os/"):
            return super().do_GET()
        if parsed.path == "/api/os/session":
            user_payload = None
            if user:
                user_payload = {
                    "name": user.get("name"),
                    "member": user.get("member"),
                    "role": user.get("role"),
                    "username": user.get("username"),
                }
            self._send_json({
                "authenticated": bool(user or self._authorized()),
                "admin": bool(self._authorized()),
                "user": user_payload,
            })
            return
        if parsed.path == "/api/os/brain":
            self._send_json(workbench_brain(public=not self._authorized()))
            return
        if parsed.path in {"/workbench", "/workbench.html"}:
            data = WORKBENCH_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        family_match = re.match(r"^/family/([^/]+)/?$", parsed.path)
        if family_match:
            member = urllib.parse.unquote(family_match.group(1))
            self._send_public_family(member=member)
            return
        if parsed.path == "/api/public-pages":
            if not user:
                self._send_json({"error": "unauthorized"}, status=401)
                return
            self._send_json(public_pages(user=user))
            return
        if parsed.path == "/api/public-gallery":
            if not user:
                self._send_json({"error": "unauthorized"}, status=401)
                return
            self._send_json(public_gallery(user=user))
            return
        if parsed.path == "/api/family-sections":
            if not user:
                self._send_json({"error": "unauthorized"}, status=401)
                return
            self._send_json(public_family_sections(user=user))
            return
        if parsed.path == "/api/status":
            if self._require_auth():
                self._send_json(diagnostics_status())
            return
        if parsed.path == "/api/artifacts":
            if self._require_auth():
                self._send_json(diagnostics_artifacts())
            return
        if parsed.path == "/api/activity":
            if self._require_auth():
                query = self._query()
                limit = (query.get("limit") or ["80"])[0]
                self._send_json(diagnostics_activity(limit=limit))
            return
        if parsed.path == "/api/logs":
            if self._require_auth():
                query = self._query()
                target = (query.get("target") or ["omega"])[0]
                lines = (query.get("lines") or ["200"])[0]
                self._send_json(diagnostics_logs(target=target, lines=lines))
            return
        if parsed.path == "/api/os/chat":
            if self._require_auth():
                query = self._query()
                limit = (query.get("limit") or ["80"])[0]
                self._send_json(os_chat_recent(limit=limit))
            return
        if parsed.path == "/api/workbench/overview":
            if self._require_auth():
                self._send_json(workbench_overview())
            return
        if parsed.path == "/api/workbench/timeline":
            if self._require_auth():
                query = self._query()
                limit = (query.get("limit") or ["120"])[0]
                self._send_json(workbench_timeline(limit=limit))
            return
        if parsed.path == "/api/workbench/agenda":
            if self._require_auth():
                self._send_json(workbench_agenda())
            return
        if parsed.path == "/api/workbench/brain":
            if self._require_auth():
                self._send_json(workbench_brain())
            return
        if parsed.path == "/api/workbench/atom-label":
            if self._require_auth():
                atom_id = (self._query().get("id") or [""])[0]
                label = workbench_atom_label(atom_id)
                self._send_json(label or {"error": "not found"}, status=200 if label else 404)
            return
        if parsed.path == "/api/workbench/cycles":
            if self._require_auth():
                query = self._query()
                limit = (query.get("limit") or ["36"])[0]
                self._send_json(workbench_cycles(limit=limit))
            return
        if parsed.path == "/api/workbench/assume":
            if self._require_auth():
                self._send_json(workbench_assume())
            return
        if parsed.path == "/api/workbench/resources":
            if self._require_auth():
                self._send_json(workbench_resources())
            return
        if parsed.path.startswith("/artifact/"):
            self._send_artifact()
            return
        if parsed.path.startswith("/gallery/"):
            if not user:
                self._redirect("/login")
                return
            name = pathlib.PurePosixPath(urllib.parse.unquote(parsed.path)).name
            meta = _load_gallery_meta().get(name, {})
            if not _user_can_view_member(user, meta.get("member", "General")):
                self.send_error(404, "Not found")
                return
            return super().do_GET()
        if parsed.path.endswith(".html") and parsed.path not in {"/admin.html", "/diagnostics.html"}:
            if not user:
                self._redirect("/login")
                return
            member = normalize_family_member(PAGE_MEMBER_HINTS.get(pathlib.PurePosixPath(parsed.path).name, "General"))
            if not _user_can_view_member(user, member):
                self.send_error(404, "Not found")
                return
            return super().do_GET()
        if parsed.path in {"/admin.html", "/diagnostics.html"} and not self._is_admin():
            self.send_error(403, "Forbidden")
            return
        if not user and parsed.path != "/favicon.ico":
            self._redirect("/login")
            return
        return super().do_GET()

    def do_POST(self):
        parsed = self._parsed()
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw_bytes = self.rfile.read(min(length, 100000))
        if parsed.path == "/submit":
            self._proxy_agentverse_submit(method="POST", body=raw_bytes)
            return
        raw = raw_bytes.decode("utf-8", errors="replace")
        form = {key: values[0] for key, values in urllib.parse.parse_qs(raw).items()}
        payload = {}
        if "application/json" in self.headers.get("Content-Type", "").lower():
            try:
                payload = json.loads(raw or "{}")
            except Exception:
                payload = {}
        else:
            payload = form
        if parsed.path == "/api/os/chat":
            user = self._require_family_user()
            if not user:
                self._send_json({"error": "unauthorized"}, status=401)
                return
            text = str(payload.get("text", "")).strip()
            author = str(user.get("name") or user.get("username") or "web").strip() or "web"
            result = os_chat_send(text, author=author)
            self._send_json(result, status=200 if result.get("ok") else 400)
            return
        if parsed.path == "/login":
            username = re.sub(r"[^a-z0-9]+", "", form.get("username", "").lower())
            password = form.get("password", "")
            users = _load_users()
            user = users.get(username)
            if user and _verify_password(password, user.get("password_hash")):
                _mark_user_claimed(username, users)
                token = _create_session(username)
                self.send_response(303)
                self.send_header("Set-Cookie", self._session_cookie(token))
                self.send_header("Location", "/")
                self.end_headers()
                return
            data = _login_html("Sign in failed").encode("utf-8")
            self.send_response(401)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/create-account":
            password = form.get("password", "")
            if password != form.get("password2", ""):
                data = _login_html("Passwords did not match").encode("utf-8")
                self.send_response(400)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            ok, result = _claim_family_account(form.get("member", ""), password)
            if ok:
                token = _create_session(result)
                self.send_response(303)
                self.send_header("Set-Cookie", self._session_cookie(token))
                self.send_header("Location", "/")
                self.end_headers()
                return
            data = _login_html(result).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/share-to-general":
            user = self._require_family_user()
            if not user:
                self._redirect("/login")
                return
            slug = _slug(form.get("slug", ""))
            meta = _load_gallery_meta()
            item = meta.get(slug)
            if not item:
                self.send_error(404, "Not found")
                return
            if user.get("role") != "admin" and normalize_family_member(item.get("member")) != normalize_family_member(user.get("member")):
                self.send_error(403, "Forbidden")
                return
            item["previous_member"] = item.get("member", "General")
            item["member"] = "General"
            item["shared_to_general"] = True
            item["share_requested_by"] = user.get("name")
            item["share_requested_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            meta[slug] = item
            _save_gallery_meta(meta)
            self._redirect("/family/General")
            return
        self.send_error(404, "Not found")


def serve():
    _ensure_public_dir()
    handler = partial(QuietHandler, directory=str(PUBLIC_DIR))
    httpd = ThreadingHTTPServer((HOST, PORT), handler)
    print(f"Serving {PUBLIC_DIR} at http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        serve()
    else:
        print(webhost_status())
