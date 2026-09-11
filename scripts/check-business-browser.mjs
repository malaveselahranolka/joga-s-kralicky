import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const executablePath = process.env.BUSINESS_CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.BUSINESS_TEST_URL || 'http://localhost:3000/business.html?demo=1';
const profile = await mkdtemp(join(tmpdir(), 'jsk-business-chrome-'));
const chrome = spawn(executablePath, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitForPort() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      return port;
    } catch {
      if (chrome.exitCode !== null) throw new Error(`Chrome skončil s kódem ${chrome.exitCode}.`);
      await pause(100);
    }
  }
  throw new Error('Chrome nezpřístupnil DevTools port.');
}

async function openProtocol() {
  const port = await waitForPort();
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result);
      return;
    }
    for (const listener of events.get(message.method) || []) listener(message.params);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, listener) => events.set(method, [...(events.get(method) || []), listener]);
  return { socket, send, on };
}

const protocol = await openProtocol();
const errors = [];
protocol.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(exceptionDetails.text));
protocol.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') errors.push(entry.text); });

async function evaluate(expression) {
  const result = await protocol.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, message, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await pause(80);
  }
  throw new Error(message);
}

async function navigate(url) {
  await protocol.send('Page.navigate', { url });
  await waitFor('document.readyState === "complete" && Boolean(document.querySelector("#viewContent:not([hidden])"))', `Stránka ${url} se nenačetla.`);
}

try {
  await protocol.send('Page.enable');
  await protocol.send('Runtime.enable');
  await protocol.send('Log.enable');
  await protocol.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await navigate(base);
  assert(await evaluate('document.querySelector("#viewTitle")?.textContent === "Přehled"'), 'Přehled se nenačetl.');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobilní přehled přetéká vodorovně.');
  await evaluate('document.querySelector("[data-action=chart-mode][data-mode=revenue]").click()');
  assert(await evaluate('document.querySelector("[data-mode=revenue]").getAttribute("aria-pressed") === "true"'), 'Přepnutí grafu nefunguje.');

  for (const view of ['finance', 'marketing', 'audience', 'plan', 'reports', 'sources', 'settings']) {
    await navigate(`${base}&view=${view}`);
    assert(await evaluate('document.querySelector("#viewContent").textContent.trim().length > 40'), `Sekce ${view} je prázdná.`);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `Sekce ${view} na mobilu přetéká vodorovně.`);
  }

  await navigate(`${base}&view=reports`);
  await evaluate('document.querySelector("[data-action=save-view]").click()');
  await waitFor('document.querySelector("#toast")?.textContent.includes("Pohled uložen")', 'Uložený pohled nebyl potvrzen.');
  assert(await evaluate('JSON.parse(localStorage.getItem("jsk:business-demo:v1")).savedViews.length === 2'), 'Uložený pohled nepřetrval.');

  await navigate(`${base}&view=finance`);
  await evaluate(`(() => {
    document.querySelector('[data-action=open-cost]').click();
    const set = (selector, value) => {
      const node = document.querySelector(selector);
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#costName', 'Testovací náklad');
    set('#costAmount', '123');
    set('#costRecurrence', 'once');
    set('#costDate', '2026-09-12');
    const attachment = new DataTransfer();
    attachment.items.add(new File(['doklad'], 'doklad.pdf', { type: 'application/pdf' }));
    document.querySelector('#costAttachment').files = attachment.files;
    document.querySelector('#saveCost').click();
  })()`);
  await waitFor('document.querySelector("#toast")?.textContent.includes("Náklad uložen")', 'Náklad nebyl potvrzen.');
  await pause(800);
  assert(await evaluate('JSON.parse(localStorage.getItem("jsk:business-demo:v1")).costRules.some((row) => row.name === "Testovací náklad")'), 'Pravidlo nákladu se neuložilo.');
  assert(await evaluate('JSON.parse(localStorage.getItem("jsk:business-demo:v1")).costRules.some((row) => row.attachment_path === "demo/doklad.pdf")'), 'Odkaz na doklad se neuložil.');
  assert(await evaluate('JSON.parse(localStorage.getItem("jsk:business-demo:v1")).occurrences.some((row) => row.amount_minor === 12300)'), 'Výskyt nákladu se nevygeneroval.');
  await evaluate(`(() => {
    document.querySelector('[data-action=open-import]').click();
    const input = document.querySelector('#csvFile');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['datum;částka;typ;popis;id\\n12.9.2026;50;poplatek;Test;row-1'], 'test.csv', { type: 'text/csv' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor('!document.querySelector("#runImport").disabled', 'CSV import se nepřipravil.');
  await evaluate('document.querySelector("#runImport").click()');
  await waitFor('document.querySelector("#toast")?.textContent.includes("Import:")', 'CSV import nebyl potvrzen.');
  assert(await evaluate('JSON.parse(localStorage.getItem("jsk:business-demo:v1")).ledger.some((row) => row.external_id === "row-1")'), 'CSV pohyb se neuložil.');
  assert(errors.length === 0, `Chyby v konzoli: ${errors.join(' | ')}`);
  console.log('✓ Business prohlížeč: 8 sekcí, graf, mobil, uložený pohled, náklad a CSV import prošly.');
} finally {
  protocol.socket.close();
  chrome.kill();
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
