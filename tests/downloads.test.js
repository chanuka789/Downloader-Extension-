const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../extension');
require('../extension/shared/download-tools');
const D = globalThis.MHDownloadTools;

test('quality policy respects portrait resolution, caps, and smallest fallback', () => {
  const list = [{ width: 2160, height: 3840 }, { width: 1080, height: 1920 }, { width: 720, height: 1280 }];
  assert.equal(D.choose(list, '1080').width, 1080);
  assert.equal(D.choose(list, 'best').width, 2160);
  assert.equal(D.choose(list, 'smallest').width, 720);
  assert.equal(D.choose(list, '240').width, 720);
  assert.equal(D.choose([], 'best'), undefined);
});
test('naming prevents path traversal and reserved Windows file names', () => {
  const name = D.template('{creator}/{date}/{post-id}_{index}', { creator: '../../CON', date: '2026-11-26', 'post-id': 'foo/bar', index: 2 });
  assert.equal(name, '_.._CON/2026-11-26/foo_bar_2');
  assert.equal(D.component('CON.txt'), '_CON.txt');
  assert.equal(D.template('../../{creator}', { creator: '../x' }).includes('../'), false);
});
test('site preferences override only the selected host and keep global values', () => {
  const s = { folder: 'global', maxConcurrent: 2, sitePreferences: { 'example.com': { folder: 'local', quality: '720' } } };
  assert.equal(D.effective(s, 'https://www.example.com/p').folder, 'local');
  assert.equal(D.effective(s, 'https://elsewhere.com').folder, 'global');
  assert.equal(D.effective(s, 'https://example.com').maxConcurrent, 2);
});
test('errors provide recovery guidance; metadata keeps unavailable fields empty', () => {
  assert.match(D.error('SERVER_UNAUTHORIZED'), /sign in/);
  assert.match(D.error('NETWORK_FAILED'), /connection/);
  assert.match(D.error('Unsupported manifest'), /another available quality/);
  assert.equal(D.metadata({ url: 'https://media/a' }, { url: 'https://source/p' }).creator, '');
});
test('ZIP stores binary and UTF-8 entries with valid CRC and directory', async () => {
  const zip = D.zip([{ name: 'café.jpg', bytes: new Uint8Array([0, 1, 255]) }, { name: 'info.json', bytes: new TextEncoder().encode('{"ok":true}') }]);
  const dir = fs.mkdtempSync('/tmp/mh-zip-test-');
  const file = path.join(dir, 'test.zip'); fs.writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
  require('node:child_process').execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("café.jpg")==bytes([0,1,255]); assert z.read("info.json")==b\'{"ok":true}\'', file]);
  fs.rmSync(dir, { recursive: true });
});

function worker(saved = {}, settings = {}) {
  const data = structuredClone(saved), changes = [], messages = [], started = []; let seq = 0;
  const event = () => ({ addListener: fn => changes.push(fn) });
  const chrome = {
    storage: { sync: { get: async () => ({ settings: { maxConcurrent: 1, ...settings } }) }, local: { get: async keys => keys === null ? data : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])), set: async patch => Object.assign(data, structuredClone(patch)), remove: async () => {} } },
    downloads: { download: async spec => { started.push(spec); return ++seq; }, search: async ({ id }) => saved.nativeDownloads?.[id] || [], pause: async () => {}, resume: async () => {}, cancel: async () => {}, onChanged: { addListener: fn => { chrome.changed = fn; } } },
    runtime: { id: 'test', onMessage: { addListener: fn => messages.push(fn) }, onConnect: event(), onInstalled: event(), onStartup: event(), sendMessage: async () => ({}), getURL: p => 'chrome-extension://test/' + p },
    webRequest: { onHeadersReceived: event() }, tabs: { onRemoved: event() }, action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }, contextMenus: { onClicked: event() }
  };
  const c = vm.createContext({ chrome, console, URL, setTimeout, clearTimeout, Blob, TextEncoder, self: null }); c.self = c;
  c.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c));
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), c);
  const run = code => vm.runInContext(code, c);
  const settle = async () => { await run('queueReady'); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
  const message = msg => new Promise(resolve => messages[0](msg, { id: 'test' }, resolve));
  return { c, run, data, chrome, started, settle, message };
}
async function seed(w) {
  await w.settle();
  w.run("tabs.set(7, {page:{url:'https://example.com/post',title:'Post'},items:new Map([['a',{id:'a',kind:'image',url:'https://example.com/a.jpg'}],['b',{id:'b',kind:'image',url:'https://example.com/b.jpg'}]]), seq:0})");
}
test('queue enforces concurrency, deduplicates, persists, and advances after completion', async () => {
  const w = worker(); await seed(w);
  await w.run("startDownloads(7,['a','b'])"); await w.settle();
  assert.equal(w.started.length, 1);
  assert.equal(w.data.downloadHistory.filter(j => j.status === 'queued').length, 1);
  const duplicate = await w.run("startDownloads(7,['a'])"); assert.equal(duplicate[0].duplicate, true);
  await w.chrome.changed({ id: 1, state: { current: 'complete' } }); await w.settle();
  assert.equal(w.started.length, 2);
  assert.equal(w.data.downloadHistory[0].status, 'running'); // active records precede finished records
  assert.equal(w.data.downloadHistory.find(j => j.itemId === 'a').status, 'done');
  assert.equal((await w.message({ type: 'history:list' })).records.length, 2);
});
test('queue pause survives restart and direct controls preserve state', async () => {
  const w = worker(); await seed(w);
  await w.message({ type: 'queue:pause', paused: true }); await w.run("startDownloads(7,['a'])"); await w.settle();
  assert.equal(w.started.length, 0);
  const restored = worker(w.data); await restored.settle(); assert.equal(restored.started.length, 0);
  await restored.message({ type: 'queue:pause', paused: false }); await restored.settle();
  assert.equal(restored.started.length, 1);
  const job = (await restored.message({ type: 'history:list' })).records[0];
  await restored.message({ type: 'download:control', jobId: job.id, action: 'pause' });
  assert.equal(restored.data.downloadHistory[0].status, 'paused');
  await restored.message({ type: 'download:control', jobId: job.id, action: 'resume' });
  assert.equal(restored.data.downloadHistory[0].status, 'running');
  await restored.message({ type: 'download:control', jobId: job.id, action: 'cancel' });
  assert.equal(restored.data.downloadHistory[0].status, 'canceled');
});
test('interrupted processing is recoverable from history without silently re-downloading', async () => {
  const w = worker({ downloadHistory: [{ id: 'old', itemId: 'a', tabId: 7, status: 'running', mode: 'dash', filename: 'movie.mp4', item: { kind: 'dash', url: 'https://example.com/v.mpd' } }] });
  await w.settle(); const result = await w.message({ type: 'history:list' });
  assert.equal(result.records[0].status, 'error'); assert.match(result.records[0].error, /Retry/);
  assert.equal(w.started.length, 0);
  await w.message({ type: 'history:clear' }); assert.equal(w.data.downloadHistory.length, 0);
});
test('retry creates a new attempt and preserves the original failure for late events', async () => {
  const w = worker({ queuePaused: true, downloadHistory: [{ id: 'failed', itemId: 'a', tabId: 7, status: 'error', error: 'Network interrupted', mode: 'native', filename: 'a.jpg', item: { kind: 'image', url: 'https://example.com/a.jpg' } }] });
  await w.settle();
  const result = await w.message({ type: 'download:control', jobId: 'failed', action: 'retry' });
  assert.equal(result.ok, true);
  const records = (await w.message({ type: 'history:list' })).records;
  assert.equal(records.find(j => j.id === 'failed').status, 'error');
  assert.equal(records.filter(j => j.status === 'queued').length, 1);
  assert.notEqual(records.find(j => j.status === 'queued').id, 'failed');
});
