'use strict';

const srt = require('./srt');

function cancellationError() {
  const error = new Error('번역을 취소했어. 새 결과 파일은 만들지 않았어.');
  error.code = 'ABORTED';
  return error;
}

// Small AbortSignal implementation also works inside older CEP Node runtimes.
function createCancellation() {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener: function (event, callback) { if (event === 'abort') listeners.add(callback); },
    removeEventListener: function (event, callback) { if (event === 'abort') listeners.delete(callback); }
  };
  return {
    signal: signal,
    abort: function () {
      if (signal.aborted) return;
      signal.aborted = true;
      Array.from(listeners).forEach(function (callback) { try { callback(); } catch (_) {} });
      listeners.clear();
    }
  };
}

function checkCancellation(signal) {
  if (signal && signal.aborted) throw cancellationError();
}

async function translateDocument(document, translateBatch, options) {
  options = options || {};
  checkCancellation(options.signal);
  const batches = srt.makeBatches(document.cues);
  const items = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (let i = 0; i < batches.length; i += 1) {
    checkCancellation(options.signal);
    const batch = batches[i];
    const payload = batch.map(function (cue) { return { id: cue.id, text: cue.text }; });
    const response = await translateBatch(payload, { signal: options.signal, onRetry: options.onRetry });
    checkCancellation(options.signal);
    const validated = srt.validateTranslations(batch, response && response.items);
    Array.prototype.push.apply(items, validated);
    if (response.usage) {
      ['inputTokens', 'outputTokens'].forEach(function (name) {
        const value = response.usage[name];
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[name] += value;
      });
    }
    if (options.onProgress) options.onProgress({ completed: items.length, total: document.cues.length, batch: i + 1, batches: batches.length });
  }
  checkCancellation(options.signal);
  const output = srt.renderSrt(document, items);
  return { output: output, items: items, usage: usage, count: items.length, batchCount: batches.length };
}

module.exports = { createCancellation: createCancellation, translateDocument: translateDocument };
