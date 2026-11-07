// make-icons.js — app/icons/*.svg 원본으로 PWA용 PNG 아이콘을 만든다 (헤드리스 크롬으로 그림).
// 아이콘 원본(SVG)을 고쳤을 때만 다시 돌리면 된다:  node app/test/make-icons.js
// (이 파일은 app/test 안이라 배포에는 안 나간다 — .vercelignore)

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ICONS = path.join(__dirname, '..', 'icons');
const PORT = 9334;

// [원본 SVG, 결과 PNG, 크기]
const JOBS = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180], // iOS가 알아서 모서리를 깎으므로 꽉 찬 버전
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const profile = path.join(os.tmpdir(), 'lotto-make-icons-chrome-profile');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 50 && !(targets && targets.length); i++) {
    await sleep(200);
    try { targets = await (await fetch(`http://localhost:${PORT}/json`)).json(); } catch (e) { /* 대기 */ }
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  for (const [src, out, size] of JOBS) {
    const svg = fs.readFileSync(path.join(ICONS, src), 'utf8');
    // 투명 배경 위에 SVG를 정확히 size×size로 그린다 (둥근 모서리 바깥은 투명으로 남김)
    const html = `<!doctype html><html><body style="margin:0;background:transparent">` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" ` +
      `width="${size}" height="${size}" style="display:block"></body></html>`;
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    await sleep(500);
    const r = await send('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
    });
    fs.writeFileSync(path.join(ICONS, out), Buffer.from(r.result.data, 'base64'));
    console.log('만듦:', out, `${size}x${size}`);
  }

  ws.close();
  chrome.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
