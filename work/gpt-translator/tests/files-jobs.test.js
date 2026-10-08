'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const srt = require('../GPT_Translator/lib/srt');
const files = require('../GPT_Translator/lib/files');
const jobs = require('../GPT_Translator/lib/jobs');

function sourceFor(count, eol) {
  eol = eol || '\r\n';
  return Array.from({ length: count }, (_, i) => [
    String(i * 3 + 7).padStart(3, '0'),
    '00:00:01,001 --> 00:00:03,999',
    '원문 ' + (i + 1),
    '둘째 줄'
  ].join(eol)).join(eol + eol) + eol + eol;
}

function translations(cues) {
  return cues.map((cue, i) => ({ id: cue.id, text: 'Translation ' + i + '\nSecond line' }));
}

async function fixture(t, source, encoding) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gpt-translator-test-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, '원본 100% # 한글.srt');
  await fs.promises.writeFile(input, files.encode(source || sourceFor(3), encoding || 'utf-8'));
  const snapshot = await files.readSource(input);
  return { dir, input, snapshot };
}

test('120 cues run sequentially as 50 + 50 + 20 and send only text/ID', async () => {
  const document = srt.parseSrt(sourceFor(120));
  const sizes = []; const progress = []; let active = 0;
  const result = await jobs.translateDocument(document, async (batch) => {
    active++; assert.equal(active, 1); sizes.push(batch.length);
    batch.forEach(cue => assert.deepEqual(Object.keys(cue), ['id', 'text']));
    assert.equal(JSON.stringify(batch).includes('-->'), false);
    await Promise.resolve(); active--;
    return { items: translations(batch), usage: { inputTokens: 10, outputTokens: 20 } };
  }, { onProgress: p => progress.push(p.completed) });
  assert.deepEqual(sizes, [50, 50, 20]); assert.deepEqual(progress, [50, 100, 120]);
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 60 });
  const out = srt.parseSrt(result.output);
  assert.deepEqual(out.cues.map(c => [c.indexLine, c.timingLine]), document.cues.map(c => [c.indexLine, c.timingLine]));
  assert.equal(document.source, sourceFor(120));
});

test('later batch failure does not return partial output or create any output file', async t => {
  const {dir, input, snapshot} = await fixture(t, sourceFor(70));
  const before = await fs.promises.readFile(input);
  let calls = 0;
  await assert.rejects(jobs.translateDocument(snapshot.document, async batch => {
    if (++calls === 2) throw Object.assign(new Error('Simulated incomplete API response'), {code:'INCOMPLETE'});
    return {items: translations(batch)};
  }), {code:'INCOMPLETE'});
  assert.equal(calls, 2);
  assert.deepEqual(await fs.promises.readdir(dir), [path.basename(input)]);
  assert.deepEqual(await fs.promises.readFile(input), before);
});

test('same count with reordered IDs is rejected by complete pipeline', async () => {
  const document = srt.parseSrt(sourceFor(4));
  await assert.rejects(jobs.translateDocument(document, async batch => ({items:translations(batch).reverse()})));
});

test('pre-cancelled and mid-request cancelled jobs never publish a result', async () => {
  const document = srt.parseSrt(sourceFor(3));
  const before = jobs.createCancellation(); before.abort(); let calls = 0;
  await assert.rejects(jobs.translateDocument(document, async () => {calls++;}, {signal:before.signal}), {code:'ABORTED'});
  assert.equal(calls, 0);
  const during = jobs.createCancellation();
  await assert.rejects(jobs.translateDocument(document, async batch => {
    during.abort(); return {items:translations(batch)};
  }, {signal:during.signal}), {code:'ABORTED'});
});

test('cancellation notifies each active listener once and removes listeners', () => {
  const controller = jobs.createCancellation(); let observed = 0;
  const removed = () => {observed += 100;};
  controller.signal.addEventListener('abort', removed);
  controller.signal.removeEventListener('abort', removed);
  controller.signal.addEventListener('abort', () => {observed++;});
  controller.abort(); controller.abort(); assert.equal(observed, 1);
});

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(encoding + ' preserves BOM, Unicode, timings and original bytes through save', async t => {
    const source = '\ufeff' + sourceFor(3);
    const {dir, input, snapshot} = await fixture(t, source, encoding);
    const before = await fs.promises.readFile(input);
    assert.equal(snapshot.encoding, encoding); assert.equal(snapshot.document.source, source);
    const output = srt.renderSrt(snapshot.document, translations(snapshot.document.cues));
    const target = path.join(dir, '번역.en.srt');
    const saved = await files.writeTranslatedCopy(snapshot, target, output);
    const actual = await fs.promises.readFile(target);
    assert.equal(saved.sha256, crypto.createHash('sha256').update(actual).digest('hex'));
    assert.equal(files.decode(actual).source, output);
    assert.equal(files.decode(actual).encoding, encoding);
    assert.deepEqual(await fs.promises.readFile(input), before);
    assert.equal((await fs.promises.readdir(dir)).some(name => name.endsWith('.tmp')), false);
  });
}

test('invalid UTF-8 and UTF-16 without a BOM are rejected without text replacement', () => {
  assert.throws(() => files.decode(Buffer.from([0xff, 0x80])), {code:'ENCODING'});
  assert.throws(() => files.decode(Buffer.from('1\n00:00:00,000 --> 00:00:01,000\ntext', 'utf16le')), {code:'ENCODING'});
  assert.throws(() => files.decode(Buffer.from([0xff,0xfe,0x00])), {code:'ENCODING'});
});

test('existing original, existing output, symlinks and hardlinks are never overwritten', async t => {
  const {dir, input, snapshot} = await fixture(t);
  const output = srt.renderSrt(snapshot.document, translations(snapshot.document.cues));
  const existing = path.join(dir, 'exists.srt'); await fs.promises.writeFile(existing, 'previous result');
  const symlink = path.join(dir, 'alias.srt'); await fs.promises.symlink(input, symlink);
  const hardlink = path.join(dir, 'hardlink.srt'); await fs.promises.link(input, hardlink);
  const before = await fs.promises.readFile(input);
  for (const target of [input, existing, symlink, hardlink]) {
    await assert.rejects(files.writeTranslatedCopy(snapshot, target, output), {code:'OUTPUT_EXISTS'});
  }
  assert.equal(await fs.promises.readFile(existing,'utf8'), 'previous result');
  assert.deepEqual(await fs.promises.readFile(input), before);
});

test('concurrent attempts to save the same output produce one complete file and no replacement', async t => {
  const {dir, snapshot} = await fixture(t);
  const target = path.join(dir, 'concurrent.srt');
  const textA = srt.renderSrt(snapshot.document, translations(snapshot.document.cues));
  const textB = srt.renderSrt(snapshot.document, snapshot.document.cues.map(c => ({id:c.id,text:'A different translation'})));
  const outcomes = await Promise.allSettled([
    files.writeTranslatedCopy(snapshot, target, textA), files.writeTranslatedCopy(snapshot, target, textB)
  ]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(r => r.status === 'rejected'); assert.equal(rejected.reason.code, 'OUTPUT_EXISTS');
  const content = await fs.promises.readFile(target,'utf8'); assert.ok(content === textA || content === textB);
  assert.equal((await fs.promises.readdir(dir)).some(name => name.endsWith('.tmp')), false);
});

test('changed source is detected before creating an output', async t => {
  const {dir, input, snapshot} = await fixture(t);
  const output = srt.renderSrt(snapshot.document, translations(snapshot.document.cues));
  await fs.promises.appendFile(input, '\r\n');
  await assert.rejects(files.writeTranslatedCopy(snapshot, path.join(dir,'new.srt'),output),{code:'SOURCE_CHANGED'});
  assert.deepEqual(await fs.promises.readdir(dir), [path.basename(input)]);
});

test('save rejects changed timing and separator layout even with the right caption count', async t => {
  const {dir,snapshot} = await fixture(t);
  const output = srt.renderSrt(snapshot.document, translations(snapshot.document.cues));
  await assert.rejects(files.writeTranslatedCopy(snapshot,path.join(dir,'bad-time.srt'),output.replace('00:00:01,001','00:00:01,002')),{code:'OUTPUT_STRUCTURE'});
  await assert.rejects(files.writeTranslatedCopy(snapshot,path.join(dir,'bad-eol.srt'),output.replace(/\r\n/g,'\n')),{code:'OUTPUT_STRUCTURE'});
  assert.deepEqual(await fs.promises.readdir(dir), [snapshot.filename]);
});

test('file type, size and safe filename rules are enforced', async t => {
  const {dir,snapshot} = await fixture(t);
  await assert.rejects(files.readSource(path.join(dir,'bad.txt')),{code:'FILE_TYPE'});
  const large = path.join(dir,'large.srt'); const handle = await fs.promises.open(large,'w');
  await handle.truncate(files.MAX_SOURCE_BYTES+1); await handle.close();
  await assert.rejects(files.readSource(large),{code:'FILE_TOO_LARGE'});
  assert.equal(files.suggestedName(snapshot, '../en'), '원본 100% # 한글.en.srt');
});

test('valid translation larger than the source size limit can still be saved', async t => {
  const {dir, input, snapshot} = await fixture(t, sourceFor(1));
  const original = await fs.promises.readFile(input);
  const output = srt.renderSrt(snapshot.document, [{id:snapshot.document.cues[0].id,text:'한'.repeat(Math.ceil(files.MAX_SOURCE_BYTES / 3) + 1)}]);
  const target = path.join(dir,'longer.srt');
  const saved = await files.writeTranslatedCopy(snapshot,target,output);
  assert.ok(saved.bytes > files.MAX_SOURCE_BYTES);
  assert.equal((await fs.promises.stat(target)).size, saved.bytes);
  assert.deepEqual(await fs.promises.readFile(input), original);
});
