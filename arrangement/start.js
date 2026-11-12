const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/sound.js', ['sound.js', 'text/javascript; charset=utf-8']],
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

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`What’s Missing? ${url}`);
  if (!process.argv.includes('--open')) return;

  const chrome = path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
  const browser = spawn(chrome, ['--new-window', url], { detached: true, stdio: 'ignore' });
  browser.once('error', () => console.log('Open the address above in Chrome.'));
  browser.unref();
});
