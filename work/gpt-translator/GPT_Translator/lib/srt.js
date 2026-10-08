'use strict';

/*
 * Lossless SRT structure handling. Only caption spans may be replaced.
 * This module deliberately has no file, network, or Adobe dependencies and
 * uses syntax supported by Node.js 12 and later.
 */

var HARD_MAX_CUES = 50;
var HARD_MAX_CHARS = 12000;
var parsedDocuments = new WeakMap();
var BLANK_LINE = /^[^\S\r\n]*$/;
var INDEX_LINE = /^[^\S\r\n]*[0-9]+[^\S\r\n]*$/;
var TIMING_LINE = /^[^\S\r\n]*(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})[^\S\r\n]*-->[^\S\r\n]*(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})([^\S\r\n]+[^\r\n]*)?$/;

function fail(code, message, details) {
  var error = new Error(message);
  error.code = code;
  if (details) {
    Object.keys(details).forEach(function (key) {
      error[key] = details[key];
    });
  }
  throw error;
}

function normalizeNewlines(text) {
  return text.replace(/\r\n|\r/g, '\n');
}

function scanLines(source, start) {
  var lines = [];
  var position = start;
  while (position < source.length) {
    var contentEnd = position;
    while (contentEnd < source.length && source[contentEnd] !== '\r' && source[contentEnd] !== '\n') {
      contentEnd += 1;
    }
    var ending = '';
    if (source[contentEnd] === '\r') {
      ending = source[contentEnd + 1] === '\n' ? '\r\n' : '\r';
    } else if (source[contentEnd] === '\n') {
      ending = '\n';
    }
    lines.push({
      content: source.slice(position, contentEnd),
      start: position,
      contentEnd: contentEnd,
      eol: ending
    });
    position = contentEnd + ending.length;
  }
  return lines;
}

function milliseconds(parts, offset, lineNumber) {
  var value = Number(parts[offset]) * 3600000 +
    Number(parts[offset + 1]) * 60000 +
    Number(parts[offset + 2]) * 1000 +
    Number(parts[offset + 3]);
  if (!Number.isSafeInteger(value)) {
    fail('SRT_TIME_RANGE', '시간 코드가 안전하게 처리할 수 있는 범위를 초과했습니다. (' + lineNumber + '행)', {
      lineNumber: lineNumber
    });
  }
  return value;
}

function readTiming(line, lineNumber) {
  var match = TIMING_LINE.exec(line);
  if (!match || line.indexOf('-->', line.indexOf('-->') + 3) !== -1) {
    fail('SRT_TIMING', '올바르지 않은 시간 코드입니다. HH:MM:SS,mmm --> HH:MM:SS,mmm 형식을 확인하세요. (' + lineNumber + '행)', {
      lineNumber: lineNumber
    });
  }
  var startMs = milliseconds(match, 1, lineNumber);
  var endMs = milliseconds(match, 5, lineNumber);
  if (endMs < startMs) {
    fail('SRT_TIME_ORDER', '자막의 종료 시간이 시작 시간보다 빠릅니다. (' + lineNumber + '행)', {
      lineNumber: lineNumber
    });
  }
  return { startMs: startMs, endMs: endMs };
}

function checkCaptionText(value, cueId, isSource) {
  var prefix = isSource ? 'SRT' : 'TRANSLATION';
  if (typeof value !== 'string') {
    fail(prefix + '_TEXT_TYPE', '자막 ' + cueId + '의 본문은 문자열이어야 합니다.', { cueId: cueId });
  }
  var normalized = normalizeNewlines(value);
  if (!normalized.trim()) {
    fail(prefix + '_EMPTY_TEXT', '자막 ' + cueId + '의 본문이 비어 있습니다.', { cueId: cueId });
  }
  if (normalized.indexOf('\u0000') !== -1 || normalized.indexOf('\uFEFF') !== -1) {
    fail(prefix + '_UNSAFE_TEXT', '자막 ' + cueId + '의 본문에 허용되지 않는 NUL 또는 BOM 문자가 있습니다.', { cueId: cueId });
  }
  if (normalized.indexOf('-->') !== -1) {
    fail(isSource ? 'SRT_AMBIGUOUS' : 'TRANSLATION_UNSAFE_TEXT',
      '자막 ' + cueId + '의 본문에 시간 코드 화살표(-->)가 있습니다. 자막 구분선 누락 또는 잘못된 본문을 확인하세요.',
      { cueId: cueId });
  }
  if (normalized.split('\n').some(function (line) { return BLANK_LINE.test(line); })) {
    fail(prefix + '_BLANK_LINE', '자막 ' + cueId + '의 본문에 빈 줄이 있습니다. 빈 줄은 자막 구분선으로 해석되므로 저장할 수 없습니다.', {
      cueId: cueId
    });
  }
  return normalized;
}

function markupTokens(text) {
  // Preserve HTML-style tokens and ASS override blocks, including {\an8}.
  // A combined expression retains the order between the two token types.
  return normalizeNewlines(text).match(/<[^<>]*>|\{\\[^{}]*\}/g) || [];
}

function checkCues(cues) {
  if (!Array.isArray(cues)) {
    fail('SRT_CUES', '검증할 자막 목록은 배열이어야 합니다.');
  }
  var ids = new Set();
  cues.forEach(function (cue, position) {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue) ||
      typeof cue.id !== 'string' || !cue.id || typeof cue.text !== 'string' || !cue.text.trim()) {
      fail('SRT_CUES', '원본 자막 목록의 ' + (position + 1) + '번째 항목에 유효한 ID와 본문이 필요합니다.');
    }
    if (ids.has(cue.id)) {
      fail('SRT_CUES', '원본 자막 목록에 중복된 내부 ID가 있습니다: ' + cue.id, { cueId: cue.id });
    }
    ids.add(cue.id);
  });
  return ids;
}

/**
 * Parse an SRT without normalizing its source. A single initial UTF-8 BOM
 * represented by U+FEFF is allowed. Duplicate/nonsequential numeric indices,
 * overlaps, and zero-duration cues are allowed. Cue IDs come from position,
 * never from the editable/possibly duplicated numeric index.
 *
 * textStart/textEnd are UTF-16 offsets into source. textEnd excludes the final
 * line ending of the caption, leaving separators entirely outside the span.
 */
function parseSrt(source) {
  if (typeof source !== 'string') {
    fail('SRT_SOURCE_TYPE', 'SRT 원본은 문자열이어야 합니다.');
  }
  if (!source.length) {
    fail('SRT_EMPTY', 'SRT 파일이 비어 있습니다.');
  }
  var hasBom = source.charCodeAt(0) === 0xFEFF;
  var initialOffset = hasBom ? 1 : 0;
  if (source.indexOf('\u0000') !== -1) {
    fail('SRT_NUL', 'SRT 파일에 NUL 문자가 있습니다. 파일 인코딩을 확인하세요.');
  }
  if (source.indexOf('\uFEFF', initialOffset) !== -1) {
    fail('SRT_BOM', 'BOM 문자는 SRT 파일의 맨 앞에 한 번만 올 수 있습니다.');
  }
  var lines = scanLines(source, initialOffset);
  var firstEnding = '\n';
  for (var endingIndex = 0; endingIndex < lines.length; endingIndex += 1) {
    if (lines[endingIndex].eol) {
      firstEnding = lines[endingIndex].eol;
      break;
    }
  }
  var cues = [];
  var records = [];
  var position = 0;
  while (position < lines.length) {
    while (position < lines.length && BLANK_LINE.test(lines[position].content)) {
      position += 1;
    }
    if (position === lines.length) {
      break;
    }

    var index = lines[position];
    var indexNumber = position + 1;
    if (!INDEX_LINE.test(index.content)) {
      fail('SRT_INDEX', '자막 번호는 숫자여야 하며 각 자막 사이에는 빈 줄이 필요합니다. (' + indexNumber + '행)', {
        lineNumber: indexNumber
      });
    }
    position += 1;
    if (position >= lines.length || BLANK_LINE.test(lines[position].content)) {
      fail('SRT_TIMING', '자막 번호 다음에 시간 코드가 없습니다. (' + indexNumber + '행)', {
        lineNumber: indexNumber
      });
    }
    var timing = lines[position];
    var timingValues = readTiming(timing.content, position + 1);
    position += 1;
    var captionFirstLine = position;
    while (position < lines.length && !BLANK_LINE.test(lines[position].content)) {
      position += 1;
    }
    var id = 'c' + String(cues.length + 1).padStart(6, '0');
    if (captionFirstLine === position) {
      fail('SRT_EMPTY_TEXT', '자막 ' + id + '의 본문이 없거나 파일이 중간에 끝났습니다.', { cueId: id });
    }
    var textStart = lines[captionFirstLine].start;
    var textEnd = lines[position - 1].contentEnd;
    var caption = source.slice(textStart, textEnd);
    checkCaptionText(caption, id, true);
    var cueEnding = lines[captionFirstLine].eol || timing.eol || firstEnding;
    var interiorEndings = [];
    for (var lineIndex = captionFirstLine; lineIndex < position - 1; lineIndex += 1) {
      interiorEndings.push(lines[lineIndex].eol);
    }
    cues.push(Object.freeze({
      id: id,
      indexLine: index.content,
      timingLine: timing.content,
      text: caption,
      textStart: textStart,
      textEnd: textEnd,
      startMs: timingValues.startMs,
      endMs: timingValues.endMs,
      eol: cueEnding
    }));
    records.push(Object.freeze({
      textStart: textStart,
      textEnd: textEnd,
      eol: cueEnding,
      interiorEndings: Object.freeze(interiorEndings)
    }));
  }
  if (!cues.length) {
    fail('SRT_EMPTY', 'SRT 파일에 유효한 자막이 없습니다.');
  }
  var document = Object.freeze({
    source: source,
    cues: Object.freeze(cues),
    eol: firstEnding,
    bom: hasBom
  });
  parsedDocuments.set(document, Object.freeze(records));
  return document;
}

/**
 * Validate all IDs before accepting any text. Results must be in the exact
 * expected order; sorting an untrusted response is intentionally forbidden.
 * Returned items are new objects and use LF internally. No input is mutated.
 */
function validateTranslations(expectedCues, items) {
  var expectedIds = checkCues(expectedCues);
  if (!Array.isArray(items)) {
    fail('TRANSLATION_FORMAT', '번역 결과는 ID와 본문을 가진 항목의 배열이어야 합니다.');
  }
  if (items.length !== expectedCues.length) {
    fail('TRANSLATION_COUNT', '번역 결과의 개수가 원본과 다릅니다. 원본 ' + expectedCues.length + '개, 결과 ' + items.length + '개입니다.');
  }
  var receivedIds = new Set();
  items.forEach(function (item, position) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id) {
      fail('TRANSLATION_ID', '번역 결과의 ' + (position + 1) + '번째 항목에 유효한 ID가 없습니다.');
    }
    if (receivedIds.has(item.id)) {
      fail('TRANSLATION_DUPLICATE_ID', '번역 결과에 중복된 ID가 있습니다: ' + item.id, { cueId: item.id });
    }
    if (!expectedIds.has(item.id)) {
      fail('TRANSLATION_UNKNOWN_ID', '번역 결과에 원본에 없는 ID가 있습니다: ' + item.id, { cueId: item.id });
    }
    receivedIds.add(item.id);
  });
  return items.map(function (item, position) {
    var expected = expectedCues[position];
    if (item.id !== expected.id) {
      fail('TRANSLATION_ORDER', '번역 결과의 ID 순서가 원본과 다릅니다. ' + (position + 1) + '번째 항목은 ' + expected.id + '이어야 합니다.', {
        cueId: item.id,
        expectedId: expected.id
      });
    }
    var normalized = checkCaptionText(item.text, item.id, false);
    var originalMarkup = markupTokens(expected.text);
    var translatedMarkup = markupTokens(normalized);
    if (originalMarkup.length !== translatedMarkup.length ||
      originalMarkup.some(function (token, tokenIndex) { return token !== translatedMarkup[tokenIndex]; })) {
      fail('TRANSLATION_MARKUP', '자막 ' + item.id + '의 서식 태그 또는 ASS 위치 표기가 변경되었습니다. 토큰의 내용, 개수, 순서를 그대로 유지해야 합니다.', {
        cueId: item.id
      });
    }
    return { id: item.id, text: normalized };
  });
}

/** Replace only the original caption spans, preserving every other character. */
function renderSrt(document, translations) {
  var records = document && typeof document === 'object' ? parsedDocuments.get(document) : undefined;
  if (!records) {
    fail('SRT_DOCUMENT', 'parseSrt로 검증한 원본 문서가 필요합니다.');
  }
  var validated = validateTranslations(document.cues, translations);
  var pieces = [];
  var sourcePosition = 0;
  records.forEach(function (record, index) {
    pieces.push(document.source.slice(sourcePosition, record.textStart));
    var translatedLines = validated[index].text.split('\n');
    var replacement = translatedLines[0];
    for (var lineIndex = 1; lineIndex < translatedLines.length; lineIndex += 1) {
      replacement += (record.interiorEndings[lineIndex - 1] || record.eol) + translatedLines[lineIndex];
    }
    pieces.push(replacement);
    sourcePosition = record.textEnd;
  });
  pieces.push(document.source.slice(sourcePosition));
  return pieces.join('');
}

/**
 * Return complete batches before callers start paid requests. Counts are hard
 * capped at 50 and text length at 12,000 UTF-16 code units (a conservative
 * character count for supplementary Unicode characters). Smaller limits are
 * accepted. A cue is never split, reordered, or modified.
 */
function makeBatches(cues, maxCount, maxChars) {
  checkCues(cues);
  var requestedCount = typeof maxCount === 'undefined' ? HARD_MAX_CUES : maxCount;
  var requestedChars = typeof maxChars === 'undefined' ? HARD_MAX_CHARS : maxChars;
  if (!Number.isInteger(requestedCount) || requestedCount < 1 ||
    !Number.isInteger(requestedChars) || requestedChars < 1) {
    fail('BATCH_OPTIONS', '묶음의 자막 수와 문자 수 제한은 1 이상의 정수여야 합니다.');
  }
  var countLimit = Math.min(requestedCount, HARD_MAX_CUES);
  var charLimit = Math.min(requestedChars, HARD_MAX_CHARS);
  var batches = [];
  var current = [];
  var currentChars = 0;
  cues.forEach(function (cue) {
    var length = cue.text.length;
    if (length > charLimit) {
      fail('BATCH_CUE_TOO_LARGE', '자막 ' + cue.id + '의 본문이 ' + length + '자로 묶음 제한 ' + charLimit + '자를 초과합니다. API 호출 전에 원본 자막을 나누어 주세요.', {
        cueId: cue.id,
        actualChars: length,
        maxChars: charLimit
      });
    }
    if (current.length && (current.length >= countLimit || currentChars + length > charLimit)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(cue);
    currentChars += length;
  });
  if (current.length) {
    batches.push(current);
  }
  return batches;
}

module.exports = {
  parseSrt: parseSrt,
  validateTranslations: validateTranslations,
  renderSrt: renderSrt,
  makeBatches: makeBatches
};
