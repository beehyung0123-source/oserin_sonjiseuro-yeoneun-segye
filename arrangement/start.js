const http = require('node:http');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const files = new Map([
  ['/', 'index.html'],
  ...[
    'index.html', 'style.css', 'reset.js', 'sound.js', 'visuals.js', 'guidance.js',
    'hand-cursor.js', 'turntable.js', 'glass-suits.png', 'turntable-plinth.webp',
    'turntable-plinth-clean.webp', 'turntable-tonearm.webp', 'turntable-vinyl.webp',
    '음악/drum.wav', '음악/bass.wav', '음악/synth.wav', '음악/vocal.wav',
  ].map(file => [`/${file}`, file]),
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  const file = files.get(pathname);
  if (!file) {
    response.writeHead(pathname === '/favicon.ico' ? 204 : 404).end();
    return;
  }

  const stream = fs.createReadStream(path.join(__dirname, file));
  stream.once('open', () => {
    response.setHeader('Content-Type', types[path.extname(file)]);
    stream.pipe(response);
  });
  stream.once('error', () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(404).end();
  });
  response.once('close', () => stream.destroy());
});

const host = '127.0.0.1';
const preferredPort = 4184;
const profileRoot = path.join(process.env.LOCALAPPDATA || os.homedir(), 'WhatsMissingHandTrackingDev');
const exhibitId = createHash('sha256').update(`${profileRoot}\0${__dirname}`.toLowerCase()).digest('hex').slice(0, 24);
const profile = path.join(profileRoot, exhibitId);
const controlPipe = `\\\\.\\pipe\\whats-missing-${exhibitId}`;

function startServer(ready, failed = () => {}) {
  let port = preferredPort;
  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && port === preferredPort) {
      port = 0;
      server.listen(port, host);
      return;
    }
    console.error('Could not start the local exhibit:', error.message);
    process.exitCode = 1;
    failed();
  });

  server.once('listening', () => {
    const url = `http://${host}:${server.address().port}/`;
    console.log(`What's Missing? ${url}`);
    ready(url);
  });
  server.listen(port, host);
}

function findChrome() {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map(directory => path.join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find(file => fs.existsSync(file));
}

function openPreview(url) {
  console.log('Keep this window open while using the exhibit.');
  if (!process.argv.includes('--open')) return;

  const chrome = findChrome();
  const showAddress = () => console.log('Open the address above in Chrome.');
  if (!chrome) {
    showAddress();
    return;
  }

  const browser = spawn(chrome, ['--new-window', url], { detached: true, stdio: 'ignore' });
  browser.once('error', showAddress);
  browser.unref();
}

function isRunning(browser) {
  return browser?.pid && browser.exitCode === null && browser.signalCode === null;
}

async function closeBrowser(browser) {
  if (!isRunning(browser)) return;

  const exited = once(browser, 'exit').then(() => true);
  const taskkill = flags => new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(browser.pid), ...flags], { windowsHide: true, timeout: 3000 }, () => resolve());
  });

  // Ask only the Chrome instance started with the exhibit profile to close.
  await taskkill([]);
  if (await Promise.race([exited, delay(1200, false, { ref: false })])) return;
  if (isRunning(browser)) await taskkill(['/T', '/F']);
  if (!await Promise.race([exited, delay(3000, false, { ref: false })])) {
    throw new Error('The exhibit Chrome window could not be closed.');
  }
}

function startExhibit() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('Google Chrome is required to start the exhibit.');
    process.exitCode = 1;
    return;
  }

  let browser;
  let stopping;
  const control = net.createServer(socket => {
    socket.on('error', () => {});
    socket.setTimeout(1000, () => socket.destroy());
    socket.once('data', command => {
      if (command.toString() !== 'stop') {
        socket.end();
        return;
      }

      socket.setTimeout(0);
      stopping ??= closeBrowser(browser).then(closeServers);
      stopping.then(() => socket.end('stopped')).catch(error => {
        stopping = undefined;
        socket.end(error.message);
      });
    });
  });

  function closeServers() {
    if (control.listening) control.close();
    server.close();
    server.closeAllConnections();
  }

  control.once('error', error => {
    if (error.code === 'EADDRINUSE') console.log('The exhibit is already running.');
    else {
      console.error('Could not start exhibit controls:', error.message);
      process.exitCode = 1;
    }
  });
  control.listen(controlPipe, () => startServer(url => {
    if (stopping) {
      closeServers();
      return;
    }
    console.log('Use the exhibit stop file to close this window and Chrome.');
    browser = spawn(chrome, [
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--disable-background-mode', '--autoplay-policy=no-user-gesture-required',
      '--start-maximized', '--new-window', url,
    ], { stdio: 'ignore' });
    browser.once('error', error => {
      console.error('Could not open exhibit Chrome:', error.message);
      process.exitCode = 1;
      closeServers();
    });
    browser.once('exit', closeServers);
  }, closeServers));
}

function stopExhibit() {
  let response = '';
  const socket = net.createConnection(controlPipe, () => socket.write('stop'));
  socket.setEncoding('utf8');
  socket.on('data', chunk => { response += chunk; });
  socket.once('end', () => {
    if (response === 'stopped') console.log('Exhibit stopped.');
    else {
      console.error(response || 'The exhibit did not confirm shutdown.');
      process.exitCode = 1;
    }
  });
  socket.setTimeout(12000, () => socket.destroy(new Error('Exhibit shutdown timed out.')));
  socket.once('error', error => {
    if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') console.log('The exhibit is not running.');
    else {
      console.error('Could not stop the exhibit:', error.message);
      process.exitCode = 1;
    }
  });
}

if (process.argv.includes('--exhibit')) startExhibit();
else if (process.argv.includes('--stop-exhibit')) stopExhibit();
else startServer(openPreview);
