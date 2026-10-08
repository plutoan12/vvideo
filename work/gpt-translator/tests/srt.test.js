'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const srt = require('../GPT_Translator/lib/srt');

function expectCode(callback, code) {
  assert.throws(callback, function (error) {
    assert.equal(error.code, code);
    assert.match(error.message, /[가-힣]/, 'Errors should explain the problem in Korean.');
    return true;
  });
}

function cueSource(text, index, start, end) {
  return String(index === undefined ? 1 : index) + '\n' +
    (start || '00:00:01,000') + ' --> ' + (end || '00:00:02,000') + '\n' + text;
}

function translated(document, values) {
  return document.cues.map(function (cue, index) {
    return { id: cue.id, text: values ? values[index] : cue.text };
  });
}

function fixtureCues(count, length) {
  return Array.from({ length: count }, function (_, index) {
    return { id: 'c' + String(index + 1).padStart(6, '0'), text: 'x'.repeat(length || 1) };
  });
}

test('CRLF source keeps BOM, exact numeric headers, timing suffixes, spacing, and separators', function () {
  const source = '\uFEFF\r\n\t0007  \r\n \t00:00:01,002\t--> 00:00:03,004 X1:0 X2:100 Y1:5 Y2:90  \r\n' +
    '<i>First line</i>\r\nSecond line\r\n \t\r\n\r\n7\r\n00:00:02,000 --> 00:00:02,000\r\n{\\an8}42\r\n\r\n';
  const document = srt.parseSrt(source);
  assert.equal(document.source, source);
  assert.equal(document.bom, true);
  assert.equal(document.eol, '\r\n');
  assert.equal(document.cues.length, 2);
  assert.deepEqual(document.cues.map(cue => cue.id), ['c000001', 'c000002']);
  assert.equal(document.cues[0].indexLine, '\t0007  ');
  assert.equal(document.cues[0].timingLine, ' \t00:00:01,002\t--> 00:00:03,004 X1:0 X2:100 Y1:5 Y2:90  ');
  assert.equal(document.cues[0].text, '<i>First line</i>\r\nSecond line');
  assert.equal(document.cues[0].startMs, 1002);
  assert.equal(document.cues[0].endMs, 3004);
  assert.equal(document.cues[0].eol, '\r\n');
  assert.equal(srt.renderSrt(document, translated(document)), source, 'Identity rendering must be character-exact.');
  const rendered = srt.renderSrt(document, translated(document, ['<i>첫째 줄</i>\n둘째 줄', '{\\an8}사십이']));
  const expected = source.replace('<i>First line</i>\r\nSecond line', '<i>첫째 줄</i>\r\n둘째 줄').replace('{\\an8}42', '{\\an8}사십이');
  assert.equal(rendered, expected);
  assert.deepEqual(srt.parseSrt(rendered).cues.map(cue => [cue.indexLine, cue.timingLine]),
    document.cues.map(cue => [cue.indexLine, cue.timingLine]));
});

test('each original internal line ending survives identity rendering, including mixed CR/LF/CRLF', function () {
  const source = '001\r00:00:01,000 --> 00:00:02,000\rA\nB\r\nC\r\r' +
    '9\n00:00:03,000 --> 00:00:04,000\nD\n\n';
  const document = srt.parseSrt(source);
  assert.equal(srt.renderSrt(document, translated(document)), source);
  assert.equal(srt.renderSrt(document, translated(document, ['가\r\n나\r다\n라', '마\n바'])),
    '001\r00:00:01,000 --> 00:00:02,000\r가\n나\r\n다\n라\r\r' +
    '9\n00:00:03,000 --> 00:00:04,000\n마\n바\n\n');
});

test('single-line and multiline captions preserve EOF and final separator exactly', function () {
  ['', '\n', '\n\n', '\n \t\n\n'].forEach(function (suffix) {
    const source = cueSource('Caption') + suffix;
    const document = srt.parseSrt(source);
    assert.equal(srt.renderSrt(document, translated(document, ['가\n나'])), cueSource('가\n나') + suffix);
    assert.equal(srt.renderSrt(document, translated(document)), source);
  });
});

test('long hours, nonsequential/duplicate indices, overlaps, and identical timestamps are valid', function () {
  const source = cueSource('하나', '0009', '123:59:59,999', '124:00:00,000') + '\n\n' +
    cueSource('둘', '2', '123:00:00,000', '125:00:00,000') + '\n\n' +
    cueSource('셋', '0009', '123:00:00,000', '123:00:00,000');
  const document = srt.parseSrt(source);
  assert.deepEqual(document.cues.map(cue => cue.indexLine), ['0009', '2', '0009']);
  assert.deepEqual(document.cues.map(cue => cue.id), ['c000001', 'c000002', 'c000003']);
  assert.equal(document.cues[0].startMs, 446399999);
  assert.equal(document.cues[0].endMs, 446400000);
  assert.equal(srt.renderSrt(document, translated(document)), source);
});

test('purely numeric text remains caption text and is never reinterpreted as an index', function () {
  const source = cueSource('123\n0002\n42') + '\n\n' + cueSource('2026', 2);
  const document = srt.parseSrt(source);
  assert.equal(document.cues[0].text, '123\n0002\n42');
  assert.equal(document.cues[1].text, '2026');
  assert.equal(srt.renderSrt(document, translated(document, ['987\n65', '1234'])),
    cueSource('987\n65') + '\n\n' + cueSource('1234', 2));
});

test('Unicode caption text, literal spacing, and UTF-16 offsets round-trip without mutation', function () {
  const source = cueSource('  한국어 😀 e\u0301 中文 العربية <b>強調</b>  ');
  const document = srt.parseSrt(source);
  const cue = document.cues[0];
  assert.equal(source.slice(cue.textStart, cue.textEnd), cue.text);
  const items = [{ id: cue.id, text: '  번역 😀 <b>강조</b>\r\n다음 줄  ' }];
  const snapshot = JSON.stringify(items);
  const normalized = srt.validateTranslations(document.cues, items);
  assert.equal(normalized[0].text, '  번역 😀 <b>강조</b>\n다음 줄  ');
  assert.notEqual(normalized, items);
  assert.notEqual(normalized[0], items[0]);
  assert.equal(JSON.stringify(items), snapshot);
  assert.ok(Object.isFrozen(document));
  assert.ok(Object.isFrozen(document.cues));
  assert.ok(Object.isFrozen(cue));
  assert.throws(() => { cue.timingLine = 'changed'; }, TypeError);
  assert.throws(() => { document.cues.push(cue); }, TypeError);
  srt.renderSrt(document, items);
  assert.equal(document.source, source);
  assert.equal(cue.text, '  한국어 😀 e\u0301 中文 العربية <b>強調</b>  ');
  assert.equal(JSON.stringify(items), snapshot);
});

test('missing separators and embedded SRT headers are rejected as ambiguous', function () {
  expectCode(() => srt.parseSrt(cueSource('First\n2\n00:00:03,000 --> 00:00:04,000\nSecond')), 'SRT_AMBIGUOUS');
  expectCode(() => srt.parseSrt(cueSource('An arrow --> in the body')), 'SRT_AMBIGUOUS');
  expectCode(() => srt.parseSrt(cueSource('First\n\nA second paragraph')), 'SRT_INDEX');
});

test('empty, malformed, and truncated sources fail before a document can be rendered', function () {
  expectCode(() => srt.parseSrt(null), 'SRT_SOURCE_TYPE');
  ['', ' \r\n\t\n', '\uFEFF'].forEach(value => expectCode(() => srt.parseSrt(value), 'SRT_EMPTY'));
  ['1', '1\n', '1\n\n'].forEach(value => expectCode(() => srt.parseSrt(value), 'SRT_TIMING'));
  ['1\n00:00:01,000 --> 00:00:02,000', '1\n00:00:01,000 --> 00:00:02,000\n',
    '1\n00:00:01,000 --> 00:00:02,000\n \t\n'].forEach(value => expectCode(() => srt.parseSrt(value), 'SRT_EMPTY_TEXT'));
  expectCode(() => srt.parseSrt('one\n00:00:01,000 --> 00:00:02,000\nText'), 'SRT_INDEX');
  expectCode(() => srt.parseSrt(cueSource('Text') + '\n\n2\n00:00:03,000 -->'), 'SRT_TIMING');
  expectCode(() => srt.parseSrt(cueSource('Text') + '\n\n2\n00:00:03,000 --> 00:00:04,000'), 'SRT_EMPTY_TEXT');
  expectCode(() => srt.parseSrt(cueSource('Text\u0000')), 'SRT_NUL');
  expectCode(() => srt.parseSrt(cueSource('Text\uFEFF')), 'SRT_BOM');
  expectCode(() => srt.parseSrt('\uFEFF\uFEFF' + cueSource('Text')), 'SRT_BOM');
});

test('strict timestamp validation rejects malformed ranges and unsafe numeric magnitudes', function () {
  ['0:00:01,000', '00:60:01,000', '00:00:60,000', '00:00:01.000', '00:00:01,00',
    '00:00:01,0000', '-01:00:01,000', '00:0:01,000'].forEach(function (timestamp) {
    expectCode(() => srt.parseSrt(cueSource('Text', 1, timestamp, '01:00:00,000')), 'SRT_TIMING');
    expectCode(() => srt.parseSrt(cueSource('Text', 1, '00:00:00,000', timestamp)), 'SRT_TIMING');
  });
  expectCode(() => srt.parseSrt(cueSource('Text', 1, '00:00:02,000', '00:00:01,999')), 'SRT_TIME_ORDER');
  expectCode(() => srt.parseSrt(cueSource('Text', 1, '99999999999999:00:00,000', '99999999999999:00:00,001')), 'SRT_TIME_RANGE');
  expectCode(() => srt.parseSrt('1\n00:00:00,000 --> 00:00:01,000 --> 00:00:02,000\nText'), 'SRT_TIMING');
});

test('same-count reordering is rejected and never silently sorted', function () {
  const document = srt.parseSrt(cueSource('One') + '\n\n' + cueSource('Two', 1));
  const items = translated(document, ['하나', '둘']).reverse();
  expectCode(() => srt.validateTranslations(document.cues, items), 'TRANSLATION_ORDER');
  expectCode(() => srt.renderSrt(document, items), 'TRANSLATION_ORDER');
  assert.equal(document.source, cueSource('One') + '\n\n' + cueSource('Two', 1));
});

test('missing, duplicate, unknown, and invalid IDs all fail closed', function () {
  const document = srt.parseSrt(cueSource('One') + '\n\n' + cueSource('Two', 2));
  expectCode(() => srt.validateTranslations(document.cues, [{ id: 'c000001', text: '하나' }]), 'TRANSLATION_COUNT');
  expectCode(() => srt.validateTranslations(document.cues, [{ id: 'c000001', text: '하나' }, { id: 'c000001', text: '둘' }]), 'TRANSLATION_DUPLICATE_ID');
  expectCode(() => srt.validateTranslations(document.cues, [{ id: 'c000001', text: '하나' }, { id: 'c999999', text: '둘' }]), 'TRANSLATION_UNKNOWN_ID');
  expectCode(() => srt.validateTranslations(document.cues, [{ id: 'c000001', text: '하나' }, { text: '둘' }]), 'TRANSLATION_ID');
  expectCode(() => srt.validateTranslations(document.cues, [{ id: 1, text: '하나' }, { id: 'c000002', text: '둘' }]), 'TRANSLATION_ID');
  expectCode(() => srt.validateTranslations(document.cues, [{ id: 'c000001', text: '하나' }, null]), 'TRANSLATION_ID');
  expectCode(() => srt.validateTranslations(document.cues, { items: translated(document) }), 'TRANSLATION_FORMAT');
});

test('blank-line, BOM, NUL, and timing-header injection is rejected before rendering', function () {
  const document = srt.parseSrt(cueSource('Original'));
  ['', ' \t', '\r\n'].forEach(value => expectCode(() => srt.renderSrt(document, translated(document, [value])), 'TRANSLATION_EMPTY_TEXT'));
  ['hello\n\nworld', 'hello\r\n \t\r\nworld', '\nhello', 'hello\r', 'hello\n\u00a0\nworld'].forEach(value =>
    expectCode(() => srt.renderSrt(document, translated(document, [value])), 'TRANSLATION_BLANK_LINE'));
  ['hello\u0000world', '\uFEFFhello', 'hello\uFEFFworld',
    'hello\n2\n00:00:03,000 --> 00:00:04,000\nInjected', 'a --> b'].forEach(value =>
    expectCode(() => srt.renderSrt(document, translated(document, [value])), 'TRANSLATION_UNSAFE_TEXT'));
  [null, 42, ['text'], { text: 'text' }].forEach(value =>
    expectCode(() => srt.renderSrt(document, translated(document, [value])), 'TRANSLATION_TEXT_TYPE'));
  assert.equal(document.source, cueSource('Original'));
});

test('markup content, count, and combined token order are immutable per cue', function () {
  const document = srt.parseSrt(cueSource('{\\an8}<i>Hello</i> <font color="#fff">world</font>'));
  const good = '{\\an8}<i>안녕</i> <font color="#fff">세상</font>';
  assert.equal(srt.validateTranslations(document.cues, translated(document, [good]))[0].text, good);
  [
    '<i>안녕</i> <font color="#fff">세상</font>',
    '{\\an7}<i>안녕</i> <font color="#fff">세상</font>',
    '{\\an8}<b>안녕</b> <font color="#fff">세상</font>',
    '{\\an8}<i>안녕</i> <font color="#FFF">세상</font>',
    '<i>{\\an8}안녕</i> <font color="#fff">세상</font>',
    '{\\an8}<i>안녕</i> <font color="#fff">세상</font><i></i>',
    '{\\an8}</i>안녕<i> <font color="#fff">세상</font>'
  ].forEach(value => expectCode(() => srt.renderSrt(document, translated(document, [value])), 'TRANSLATION_MARKUP'));
  const plain = srt.parseSrt(cueSource('Plain'));
  ['<i>새 태그</i>', '{\\an8}새 위치', '{\\pos(1,2)}새 위치'].forEach(value =>
    expectCode(() => srt.renderSrt(plain, translated(plain, [value])), 'TRANSLATION_MARKUP'));
});

test('rendering requires a genuine frozen document created by this parser', function () {
  const document = srt.parseSrt(cueSource('Text'));
  expectCode(() => srt.renderSrt(null, []), 'SRT_DOCUMENT');
  expectCode(() => srt.renderSrt(JSON.parse(JSON.stringify(document)), translated(document)), 'SRT_DOCUMENT');
  expectCode(() => srt.renderSrt({ source: 'unsafe', cues: [] }, []), 'SRT_DOCUMENT');
});

test('batches never exceed 50 cues, preserve order/references, and respect smaller limits', function () {
  const cues = fixtureCues(121, 10);
  const snapshot = JSON.stringify(cues);
  const batches = srt.makeBatches(cues);
  assert.deepEqual(batches.map(batch => batch.length), [50, 50, 21]);
  assert.deepEqual(srt.makeBatches(cues, 5000).map(batch => batch.length), [50, 50, 21]);
  assert.deepEqual(srt.makeBatches(cues, 30).map(batch => batch.length), [30, 30, 30, 30, 1]);
  assert.deepEqual(batches.flat().map(cue => cue.id), cues.map(cue => cue.id));
  batches.flat().forEach((cue, index) => assert.equal(cue, cues[index]));
  assert.equal(JSON.stringify(cues), snapshot);
  assert.deepEqual(srt.makeBatches([]), []);
});

test('batch character caps are enforced atomically and a single oversized cue always fails', function () {
  const cues = fixtureCues(5, 6000);
  assert.deepEqual(srt.makeBatches(cues).map(batch => batch.length), [2, 2, 1]);
  assert.deepEqual(srt.makeBatches(cues, 1000, 999999).map(batch => batch.length), [2, 2, 1]);
  assert.deepEqual(srt.makeBatches(fixtureCues(5, 4), 50, 8).map(batch => batch.length), [2, 2, 1]);
  assert.equal(srt.makeBatches(fixtureCues(1, 12000))[0][0].text.length, 12000);
  expectCode(() => srt.makeBatches(fixtureCues(1, 12001)), 'BATCH_CUE_TOO_LARGE');
  expectCode(() => srt.makeBatches(fixtureCues(1, 12001), 999, 999999), 'BATCH_CUE_TOO_LARGE');
  expectCode(() => srt.makeBatches(fixtureCues(1, 9), 50, 8), 'BATCH_CUE_TOO_LARGE');
  expectCode(() => srt.makeBatches(fixtureCues(60, 1).concat([{ id: 'huge', text: 'x'.repeat(12001) }])), 'BATCH_CUE_TOO_LARGE');
  expectCode(() => srt.makeBatches([{ id: 'emoji', text: '😀'.repeat(6001) }]), 'BATCH_CUE_TOO_LARGE');
});

test('invalid batch options and malformed expected cue lists produce descriptive errors', function () {
  const cues = fixtureCues(2, 1);
  [0, -1, 1.5, NaN, Infinity, null, '50'].forEach(value => {
    expectCode(() => srt.makeBatches(cues, value), 'BATCH_OPTIONS');
    expectCode(() => srt.makeBatches(cues, 50, value), 'BATCH_OPTIONS');
  });
  expectCode(() => srt.makeBatches(null), 'SRT_CUES');
  expectCode(() => srt.makeBatches([{ id: 'c', text: '' }]), 'SRT_CUES');
  expectCode(() => srt.makeBatches([{ id: 'c', text: 'a' }, { id: 'c', text: 'b' }]), 'SRT_CUES');
  expectCode(() => srt.validateTranslations({}, []), 'SRT_CUES');
});

test('all non-text spans remain byte-for-byte identical after varied Unicode substitutions', function () {
  const endings = ['\n', '\r\n', '\r'];
  endings.forEach(function (eol) {
    const source = '\uFEFF' + [' 001 ', ' 00:00:00,000 --> 99:59:59,999 X1:1  ', 'one', 'two', ' \t', '',
      '001', '00:00:00,000 --> 00:00:00,000', 'three', '', ''].join(eol);
    const document = srt.parseSrt(source);
    const output = srt.renderSrt(document, translated(document, ['한글😀\n第二行\nthird', 'نص']));
    const reparsed = srt.parseSrt(output);
    let originalEnd = 0;
    let outputEnd = 0;
    document.cues.forEach(function (cue, index) {
      const outputCue = reparsed.cues[index];
      assert.equal(output.slice(outputEnd, outputCue.textStart), source.slice(originalEnd, cue.textStart));
      assert.equal(outputCue.indexLine, cue.indexLine);
      assert.equal(outputCue.timingLine, cue.timingLine);
      originalEnd = cue.textEnd;
      outputEnd = outputCue.textEnd;
    });
    assert.equal(output.slice(outputEnd), source.slice(originalEnd));
  });
});
