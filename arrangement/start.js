const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { homedir } = require('node:os');
const { spawn } = require('node:child_process');

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/sound.js', ['sound.js', 'text/javascript; charset=utf-8']],
  ['/visuals.js', ['visuals.js', 'text/javascript; charset=utf-8']],
  ['/guidance.js', ['guidance.js', 'text/javascript; charset=utf-8']],
  ['/turntable-plinth.webp', ['turntable-plinth.webp', 'image/webp']],
  ['/turntable-vinyl.webp', ['turntable-vinyl.webp', 'image/webp']],
  ['/turntable-plinth-clean.webp', ['turntable-plinth-clean.webp', 'image/webp']],
  ['/turntable-tonearm.webp', ['turntable-tonearm.webp', 'image/webp']],
  ['/turntable.js', ['turntable.js', 'text/javascript; charset=utf-8']],
  ['/hand-cursor.js', ['hand-cursor.js', 'text/javascript; charset=utf-8']],
]);
for (const id of ['drum', 'bass', 'synth', 'vocal']) {
  const file = `음악/${id}.wav`;
  files.set(`/${file}`, [file, 'audio/wav']);
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  const entry = files.get(pathname);
  if (!entry) {
    response.writeHead(pathname === '/favicon.ico' ? 204 : 404).end();
    return;
  }

  const [file, type] = entry;
  const stream = fs.createReadStream(path.join(__dirname, file));
  stream.once('open', () => {
    response.setHeader('Content-Type', type);
    stream.pipe(response);
  });
  stream.once('error', () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(404).end();
  });
  response.once('close', () => stream.destroy());
});

const handsFree = process.argv.includes('--hands-free');
const openBrowser = handsFree || process.argv.includes('--open');

server.listen(handsFree ? 57000 : 0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`What’s Missing? ${url}`);
  if (!openBrowser) return;

  let chrome = 'google-chrome';
  if (process.platform === 'darwin') chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32') {
    chrome = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  }
  const options = handsFree ? [
    `--user-data-dir=${path.join(homedir(), '.whats-missing-chrome')}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
  ] : [];
  const browser = spawn(chrome, [...options, '--new-window', url], { detached: true, stdio: 'ignore' });
  browser.once('error', () => console.log('Chrome could not open automatically. Open the address above in Chrome.'));
  browser.unref();
});
