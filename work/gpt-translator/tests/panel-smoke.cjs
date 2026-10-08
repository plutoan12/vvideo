'use strict';

// Dependency-free integration smoke test. DOM, CEP, and the translator are
// SIMULATED. app.js and the files/jobs/srt modules are real, as is local file IO.
// This does not test a browser layout, Premiere, or an OpenAI API connection.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const url = require('node:url');
const packageRoot = path.resolve(__dirname, '..');
const extension = path.join(packageRoot, 'GPT_Translator');
const fakeKey = 'SIMULATED-KEY-DO-NOT-USE-panel-smoke-2026';
const networkAttempts = [];
const persistenceAttempts = [];

function forbiddenNetwork(api) {
  return function () {
    networkAttempts.push(api);
    throw new Error('Network access is forbidden in this simulated test: ' + api);
  };
}

function blockNodeNetwork() {
  const restore = [];
  [
    ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
    ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
    ['node:dgram', ['createSocket']]
  ].forEach(([name, methods]) => {
    const module = require(name);
    methods.forEach(method => {
      const original = module[method];
      module[method] = forbiddenNetwork(name + '.' + method);
      restore.push(() => { module[method] = original; });
    });
  });
  if (typeof globalThis.fetch === 'function') {
    const original = globalThis.fetch;
    globalThis.fetch = forbiddenNetwork('global.fetch');
    restore.push(() => { globalThis.fetch = original; });
  }
  return () => restore.reverse().forEach(reset => reset());
}

class SimulatedEvents {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(listener);
  }
  async invoke(type) {
    const event = { type, target: this, currentTarget: this, preventDefault() {} };
    for (const listener of this.listeners.get(type) || []) await listener.call(this, event);
  }
}

class SimulatedElement extends SimulatedEvents {
  constructor(tag, ownerDocument, attributes) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = attributes || {};
    this.id = this.attributes.id || '';
    this.className = this.attributes.class || '';
    this.children = [];
    this.parentElement = null;
    this.hidden = Object.prototype.hasOwnProperty.call(this.attributes, 'hidden');
    this.disabled = Object.prototype.hasOwnProperty.call(this.attributes, 'disabled');
    this._text = '';
    this._value = this.attributes.value || '';
    this._selectedIndex = null;
    this.max = Number(this.attributes.max || 1);
    this.title = this.attributes.title || '';
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) {
    this.children.forEach(child => { child.parentElement = null; });
    this.children = [];
    this._text = String(value);
  }
  get innerHTML() { throw new Error('innerHTML is forbidden; the preview must use textContent.'); }
  set innerHTML(_) {
    this.ownerDocument.unsafeHtmlAttempts++;
    throw new Error('innerHTML is forbidden; the preview must use textContent.');
  }
  insertAdjacentHTML() {
    this.ownerDocument.unsafeHtmlAttempts++;
    throw new Error('HTML insertion is forbidden; the preview must use textContent.');
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  focus() { this.ownerDocument.activeElement = this; }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get selectedIndex() {
    if (this._selectedIndex !== null) return this._selectedIndex;
    const selected = this.options.findIndex(option => Object.prototype.hasOwnProperty.call(option.attributes, 'selected'));
    return selected >= 0 ? selected : (this.options.length ? 0 : -1);
  }
  set selectedIndex(value) { this._selectedIndex = Number(value); }
  get value() {
    if (this.tagName === 'SELECT') {
      const option = this.options[this.selectedIndex];
      return option ? option.value : '';
    }
    return this._value;
  }
  set value(value) {
    if (this.tagName === 'SELECT') this.selectedIndex = this.options.findIndex(option => option.value === String(value));
    else this._value = this.tagName === 'PROGRESS' ? Number(value) : String(value);
  }
  get effectivelyDisabled() {
    if (this.disabled) return true;
    for (let ancestor = this.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'FIELDSET' && ancestor.disabled) return true;
    }
    return false;
  }
}

function blockedStorage(name) {
  const blocked = () => {
    persistenceAttempts.push(name);
    throw new Error('Credential persistence is forbidden in this test: ' + name);
  };
  return new Proxy({ length: 0, getItem: () => null, key: () => null, setItem: blocked, removeItem: blocked, clear: blocked }, {
    set: blocked, defineProperty: blocked, deleteProperty: blocked
  });
}

function makeDocument(html) {
  const elements = new Map();
  const document = {
    activeElement: null,
    unsafeHtmlAttempts: 0,
    createElement(tag) { return new SimulatedElement(tag, document); },
    getElementById(id) { return elements.get(id) || null; }
  };
  Object.defineProperty(document, 'cookie', {
    get: () => '',
    set: () => { persistenceAttempts.push('document.cookie'); throw new Error('Cookie persistence is forbidden.'); }
  });
  const root = document.createElement('document');
  const stack = [root];
  const voidTags = new Set(['META', 'LINK', 'INPUT', 'BR', 'HR', 'IMG']);
  // Read the actual static HTML defaults and fieldset ancestry. This tiny
  // tokenizer is intentionally limited to this panel, not a browser emulator.
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<(?:(?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (token.startsWith('<')) {
      const match = /^<([a-z][\w-]*)\b([\s\S]*?)\/?\s*>$/i.exec(token);
      if (!match) throw new Error('Unsupported test HTML token: ' + token);
      const attributes = {};
      const expression = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attribute;
      while ((attribute = expression.exec(match[2]))) {
        attributes[attribute[1]] = attribute[2] === undefined ? (attribute[3] === undefined ? (attribute[4] || '') : attribute[3]) : attribute[2];
      }
      const element = new SimulatedElement(match[1], document, attributes);
      if (element.id) {
        assert.equal(elements.has(element.id), false, 'Duplicate HTML ID: ' + element.id);
        elements.set(element.id, element);
      }
      stack[stack.length - 1].appendChild(element);
      if (!voidTags.has(element.tagName) && !token.endsWith('/>')) stack.push(element);
    } else {
      stack[stack.length - 1].appendChild({ textContent: token, parentElement: null });
    }
  }
  return document;
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + description);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

async function withinDeadline(operation, description) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out during ' + description)), 5000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function descendants(element) {
  return element.children.flatMap(child => child.tagName ? [child].concat(descendants(child)) : []);
}

(async () => {
  const restoreNetwork = blockNodeNetwork();
  let dir;
  try {
    const files = require(path.join(extension, 'lib/files.js'));
    const jobs = require(path.join(extension, 'lib/jobs.js'));
    const srt = require(path.join(extension, 'lib/srt.js'));
    const html = await fs.promises.readFile(path.join(extension, 'index.html'), 'utf8');
    const app = await fs.promises.readFile(path.join(extension, 'js/app.js'), 'utf8');
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gpt-panel-모의 100% #-'));
    const input = path.join(dir, '촬영 100% # 원본.srt');
    const selectedOutput = path.join(dir, '번역 100% # 결과'); // The app must add .srt.
    const output = selectedOutput + '.srt';
    const source = '\uFEFF0007 \r\n \t00:00:01,001 --> 00:00:02,999 X1:0 X2:100\r\n원문 <i>그대로 보존</i>\r\n둘째 줄\r\n \t\r\n' +
      '7\r\n00:00:03,125 --> 00:00:04,999\r\n원문 <img src=x onerror="window.PWNED=true">\r\n\r\n';
    const expectedOutput = source.replace(/원문/g, 'Translation');
    await fs.promises.writeFile(input, source, 'utf8');
    const originalBytes = await fs.promises.readFile(input);
    const control = { mode: 'ok', input, output: selectedOutput, calls: [], opens: [], saves: [], requireNames: [], active: new Set(), aborted: 0 };
    const mockProvider = {
      createOpenAITranslator(options) {
        if (!options.apiKey) throw Object.assign(new Error('OpenAI API 키를 입력해 줘.'), { code: 'INVALID_API_KEY' });
        assert.equal(options.apiKey, fakeKey, 'Only the explicitly fabricated test key may reach the mock provider.');
        assert.equal(options.model, 'gpt-4.1-mini');
        return async function (batch, context) {
          control.calls.push(batch.map(cue => ({ ...cue })));
          if (control.mode === 'pending') {
            return new Promise((resolve, reject) => {
              const pending = {};
              control.active.add(pending);
              const onAbort = () => {
                context.signal.removeEventListener('abort', onAbort);
                control.active.delete(pending);
                control.aborted++;
                reject(Object.assign(new Error('SIMULATED cancellation'), { code: 'ABORTED', name: 'AbortError' }));
              };
              context.signal.addEventListener('abort', onAbort);
              if (context.signal.aborted) onAbort();
            });
          }
          const items = batch.map(cue => ({ id: cue.id, text: cue.text.replace(/원문/g, 'Translation') }));
          if (control.mode === 'reorder') items.reverse();
          return { items, usage: { inputTokens: 12, outputTokens: 20 } };
        };
      }
    };

    function boot(withCep) {
      const document = makeDocument(html);
      const events = new SimulatedEvents();
      const sandbox = {
        document,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        localStorage: blockedStorage('localStorage'),
        sessionStorage: blockedStorage('sessionStorage'),
        fetch: forbiddenNetwork('window.fetch'),
        XMLHttpRequest: forbiddenNetwork('XMLHttpRequest'),
        WebSocket: forbiddenNetwork('WebSocket'),
        EventSource: forbiddenNetwork('EventSource'),
        navigator: { sendBeacon: forbiddenNetwork('navigator.sendBeacon') }
      };
      sandbox.window = sandbox;
      if (withCep) {
        const modules = new Map([
          ['path', path], ['url', url], ['process', process],
          [path.join(extension, 'lib/files.js'), files],
          [path.join(extension, 'lib/jobs.js'), jobs],
          [path.join(extension, 'lib/srt.js'), srt],
          [path.join(extension, 'lib/openai.js'), mockProvider]
        ]);
        sandbox.cep_node = { require(name) {
          control.requireNames.push(name);
          if (!modules.has(name)) throw new Error('Unexpected require in simulated panel: ' + name);
          return modules.get(name);
        } };
        sandbox.__adobe_cep__ = {
          getSystemPath(kind) { assert.equal(kind, 'extension'); return url.pathToFileURL(extension).href; },
          getHostEnvironment() { return JSON.stringify({ appName: 'PPRO', appVersion: 'SIMULATED (no Adobe host)' }); }
        };
        sandbox.cep = { fs: {
          showOpenDialogEx(...args) { control.opens.push(args); return { err: 0, data: [control.input] }; },
          showSaveDialogEx(...args) { control.saves.push(args); return { err: 0, data: control.output }; }
        } };
      }
      const context = vm.createContext(sandbox, { name: 'SIMULATED DOM and CEP', codeGeneration: { strings: false, wasm: false } });
      vm.runInContext(app, context, { filename: path.join(extension, 'js/app.js'), timeout: 2000 });
      return {
        document, context,
        element(id) { const result = document.getElementById(id); assert.ok(result, 'Missing actual HTML element: ' + id); return result; },
        click(id) {
          const element = this.element(id);
          return element.effectivelyDisabled ? Promise.resolve() : withinDeadline(element.invoke('click'), id + ' handler');
        },
        unload() { return withinDeadline(events.invoke('beforeunload'), 'beforeunload handler'); }
      };
    }

    const fallback = boot(false);
    assert.equal(fallback.element('translate').effectivelyDisabled, true);
    assert.equal(fallback.element('open-file').effectivelyDisabled, true);
    assert.match(fallback.element('status').textContent, /Install_Mac/);
    assert.match(fallback.element('error').textContent, /일반 브라우저/);
    assert.equal(fallback.element('error').hidden, false);

    const panel = boot(true);
    const element = id => panel.element(id);
    assert.match(element('runtime').textContent, /SIMULATED/);
    assert.equal(element('open-file').effectivelyDisabled, false);
    assert.equal(element('api-key').effectivelyDisabled, false);
    assert.equal(element('translate').effectivelyDisabled, true);
    assert.equal(element('save').effectivelyDisabled, true);
    assert.ok(control.requireNames.includes('url'), 'The real extension file URL must take the fileURLToPath branch.');
    assert.equal(control.requireNames.includes(path.join(extension, 'lib/files.js')), true);
    assert.equal(control.requireNames.includes(path.join(extension, 'lib/jobs.js')), true);

    await panel.click('open-file');
    await waitFor(() => !element('open-file').disabled && element('source-name').textContent === path.basename(input), 'real asynchronous source file read');
    assert.match(element('source-meta').textContent, /2개 자막/);
    assert.equal(element('source-name').title, input);
    assert.equal(element('translate').effectivelyDisabled, false);
    assert.deepEqual(Array.from(control.opens[0].slice(0, 2)), [false, false]);
    assert.deepEqual(Array.from(control.opens[0][4]), ['srt']);
    assert.match(element('preview').textContent, /<img src=x onerror=/);
    assert.equal(descendants(element('preview')).some(node => node.tagName === 'IMG'), false);
    assert.equal(panel.context.PWNED, undefined);

    await panel.click('translate');
    assert.match(element('error').textContent, /API 키/);
    assert.equal(control.calls.length, 0);
    assert.equal(element('save').effectivelyDisabled, true);

    element('api-key').value = fakeKey;
    await panel.click('translate');
    assert.match(element('status').textContent, /^번역 완료/);
    assert.equal(element('save').effectivelyDisabled, false);
    assert.equal(element('cancel').effectivelyDisabled, true);
    assert.match(element('preview').textContent, /Translation/);
    assert.equal(Number(element('progress').value), 2);
    const successfulPreview = element('preview').textContent;

    await panel.click('save');
    assert.equal(element('saved-path').hidden, false);
    assert.equal(element('saved-path').textContent, output);
    assert.equal(await fs.promises.readFile(output, 'utf8'), expectedOutput);
    assert.deepEqual(await fs.promises.readFile(input), originalBytes);
    assert.equal(control.saves[0][1], dir);
    assert.deepEqual(Array.from(control.saves[0][2]), ['srt']);
    assert.equal(control.saves[0][3], '촬영 100% # 원본.en.srt');
    assert.deepEqual(srt.parseSrt(expectedOutput).cues.map(cue => [cue.indexLine, cue.timingLine]),
      srt.parseSrt(source).cues.map(cue => [cue.indexLine, cue.timingLine]));

    await panel.click('save');
    assert.equal(element('error').hidden, false);
    assert.match(element('error').textContent, /같은 이름/);
    assert.equal(await fs.promises.readFile(output, 'utf8'), expectedOutput);
    assert.deepEqual(await fs.promises.readFile(input), originalBytes);

    element('target-language').value = 'Japanese';
    control.mode = 'reorder';
    await panel.click('translate');
    assert.match(element('status').textContent, /^번역을 중단/);
    assert.match(element('error').textContent, /순서/);
    assert.match(element('result-meta').textContent, /이전/);
    assert.equal(element('save').effectivelyDisabled, false);
    assert.equal(element('preview').textContent, successfulPreview);
    control.output = path.join(dir, '실패 후 보존.srt');
    await panel.click('save');
    assert.equal(await fs.promises.readFile(control.output, 'utf8'), expectedOutput);
    assert.equal(control.saves[control.saves.length - 1][3], '촬영 100% # 원본.en.srt', 'An unsuccessful new target must not rename the previous English result.');

    control.mode = 'pending';
    const cancelledTranslation = panel.click('translate');
    await waitFor(() => control.active.size === 1, 'mock request to enter its cancellable pending state');
    assert.equal(element('open-file').effectivelyDisabled, true);
    assert.equal(element('save').effectivelyDisabled, true);
    assert.equal(element('target-language').effectivelyDisabled, true, 'Disabled fieldset must disable its controls.');
    assert.equal(element('clear-key').effectivelyDisabled, true);
    assert.equal(element('cancel').effectivelyDisabled, false);
    const opensBeforeBusyClick = control.opens.length;
    await panel.click('open-file');
    await panel.click('clear-key');
    assert.equal(control.opens.length, opensBeforeBusyClick);
    assert.equal(element('api-key').value, fakeKey);
    await panel.click('cancel');
    await cancelledTranslation;
    assert.equal(control.active.size, 0);
    assert.equal(control.aborted, 1);
    assert.match(element('status').textContent, /^취소했어/);
    assert.match(element('status').textContent, /사용료/);
    assert.equal(element('save').effectivelyDisabled, false);
    assert.equal(element('cancel').effectivelyDisabled, true);
    assert.equal(element('preview').textContent, successfulPreview);
    assert.match(element('result-meta').textContent, /이전/);
    control.output = path.join(dir, '취소 후 보존.srt');
    await panel.click('save');
    assert.equal(await fs.promises.readFile(control.output, 'utf8'), expectedOutput);

    await panel.click('clear-key');
    assert.equal(element('api-key').value, '');
    assert.equal(panel.document.activeElement, element('api-key'));
    element('api-key').value = fakeKey;
    const unloadedTranslation = panel.click('translate');
    await waitFor(() => control.active.size === 1, 'mock request before unload');
    await panel.unload();
    assert.equal(element('api-key').value, '');
    await unloadedTranslation;
    assert.equal(control.active.size, 0);
    assert.equal(control.aborted, 2);

    for (const batch of control.calls) {
      for (const cue of batch) assert.deepEqual(Object.keys(cue), ['id', 'text']);
      assert.equal(JSON.stringify(batch).includes(fakeKey), false);
      assert.equal(JSON.stringify(batch).includes('-->'), false);
      assert.equal(JSON.stringify(batch).includes(input), false);
    }
    const names = (await fs.promises.readdir(dir)).sort();
    assert.deepEqual(names, [path.basename(input), path.basename(output), '실패 후 보존.srt', '취소 후 보존.srt'].sort());
    for (const name of names) assert.equal((await fs.promises.readFile(path.join(dir, name), 'utf8')).includes(fakeKey), false);
    assert.deepEqual(await fs.promises.readFile(input), originalBytes);
    assert.equal(require.cache[path.join(extension, 'lib/openai.js')], undefined, 'The real OpenAI provider must never load in this smoke test.');
    assert.equal(panel.document.unsafeHtmlAttempts, 0);
    assert.equal(fallback.document.unsafeHtmlAttempts, 0);
    assert.equal(descendants(element('preview')).some(node => node.tagName === 'IMG'), false);
    assert.equal(panel.context.PWNED, undefined);
    assert.equal(panel.context.localStorage.length + panel.context.sessionStorage.length, 0);
    assert.deepEqual(persistenceAttempts, []);
    assert.deepEqual(networkAttempts, []);

    console.log('PASS: no-CEP fallback; simulated boot; native dialog result shapes; missing key; successful translation; exact source/timing/EOL preservation; exclusive save; reordered IDs; cancellation; previous-result preservation; key clear/unload; text-only preview; no credential persistence.');
    console.log('Scope: SIMULATED DOM/CEP + mock translator, with REAL app.js, files/jobs/srt modules, and local file IO.');
    console.log('No browser layout, Premiere session, or OpenAI API was tested. HTTP/network access was blocked; no external dependencies or downloads were used.');
  } finally {
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true });
    restoreNetwork();
  }
})().catch(error => {
  console.error('FAIL: SIMULATED panel smoke test:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
