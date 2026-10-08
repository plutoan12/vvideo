(function () {
  'use strict';
  var ids = ['runtime','open-file','open-sample','source-name','source-meta','settings','source-language','target-language','api-key','clear-key','model','tone','translate','cancel','progress','status','error','save','result-meta','saved-path','preview-section','preview'];
  var ui = {};
  ids.forEach(function (id) { ui[id] = document.getElementById(id); });
  var state = { ready: false, busy: false, snapshot: null, result: null, cancellation: null, savedLanguageCode: 'en' };
  var files, jobs, provider, nodePath, extensionPath, cep;

  function showError(error) {
    var message;
    var knownFileErrors = { EACCES: '폴더를 읽거나 쓸 권한이 없어. 다른 폴더를 선택해 줘.', EPERM: '파일 접근 권한을 확인해 줘.', ENOENT: '파일이나 폴더를 찾지 못했어. 다시 선택해 줘.', ENOSPC: '디스크 공간이 부족해. 공간을 확보한 뒤 다시 저장해 줘.', EISDIR: '폴더 대신 .srt 파일을 선택해 줘.', EMFILE: '열려 있는 파일이 너무 많아. 다른 작업을 닫고 다시 시도해 줘.' };
    if (error && knownFileErrors[error.code]) message = knownFileErrors[error.code];
    else if (error && error.code && typeof error.message === 'string') message = error.message;
    else message = '작업을 완료하지 못했어. 패널을 다시 열고 재시도해 줘.';
    var key = ui['api-key'].value;
    if (key) message = message.split(key).join('[숨김]');
    message = message.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[숨김]');
    ui.error.textContent = message;
    ui.error.hidden = false;
  }

  function clearMessages() {
    ui.error.hidden = true;
    ui.error.textContent = '';
    ui['saved-path'].hidden = true;
    ui['saved-path'].textContent = '';
  }

  function updateButtons() {
    ui['open-file'].disabled = !state.ready || state.busy;
    ui['open-sample'].disabled = !state.ready || state.busy;
    ui.settings.disabled = !state.ready || state.busy;
    ui.translate.disabled = !state.ready || state.busy || !state.snapshot;
    ui.cancel.disabled = !state.cancellation || state.cancellation.signal.aborted;
    ui.save.disabled = state.busy || !state.result;
  }

  function preview() {
    ui.preview.textContent = '';
    if (!state.snapshot) { ui['preview-section'].hidden = true; return; }
    ui['preview-section'].hidden = false;
    state.snapshot.document.cues.slice(0,5).forEach(function (cue, i) {
      var row = document.createElement('div'); row.className = 'cue';
      var timing = document.createElement('div'); timing.className = 'cue-timing';
      timing.textContent = cue.indexLine + '  ·  ' + cue.timingLine;
      var original = document.createElement('p'); original.className = 'cue-original'; original.textContent = cue.text;
      row.appendChild(timing); row.appendChild(original);
      if (state.result) {
        var translated = document.createElement('p'); translated.className = 'cue-translated';
        translated.textContent = state.result.items[i].text;
        row.appendChild(translated);
      }
      ui.preview.appendChild(row);
    });
  }

  async function loadFile(filePath) {
    if (state.busy) return;
    clearMessages(); state.busy = true; updateButtons();
    try {
      var snapshot = await files.readSource(filePath);
      state.snapshot = snapshot; state.result = null;
      ui['source-name'].textContent = snapshot.filename;
      ui['source-name'].title = snapshot.path;
      ui['source-meta'].textContent = snapshot.document.cues.length + '개 자막 · 기본 ' + snapshot.batchCount + '회 요청 · ' + snapshot.encoding.toUpperCase();
      ui.status.textContent = '번호·타임코드를 읽었어. 번역 언어와 API 키를 확인해 줘.';
      ui.progress.max = snapshot.document.cues.length; ui.progress.value = 0;
      ui['result-meta'].textContent = '최대 50개씩 처리해. 텍스트가 길면 더 작게 나눠.';
      preview();
    } catch (error) { showError(error); }
    finally { state.busy = false; updateButtons(); }
  }

  function getDialogPath(result, isOpen) {
    if (!result || (result.err && result.err !== 0)) {
      var error = new Error('파일 선택 창을 열지 못했어. Premiere를 다시 실행해 줘.'); error.code = 'DIALOG'; throw error;
    }
    var value = isOpen ? (result.data && result.data[0]) : result.data;
    return typeof value === 'string' ? value : '';
  }

  ui['open-file'].addEventListener('click', function () {
    try {
      var initial = state.snapshot ? nodePath.dirname(state.snapshot.path) : '';
      var result = cep.fs.showOpenDialogEx(false, false, '번역할 SRT 선택', initial, ['srt'], '', '열기');
      var selected = getDialogPath(result, true);
      if (selected) loadFile(selected);
    } catch (error) { showError(error); }
  });

  ui['open-sample'].addEventListener('click', function () {
    loadFile(nodePath.join(extensionPath, 'samples', 'sample_ko.srt'));
  });

  ui['clear-key'].addEventListener('click', function () { ui['api-key'].value = ''; ui['api-key'].focus(); });

  ui.translate.addEventListener('click', async function () {
    if (state.busy || !state.snapshot) return;
    clearMessages();
    var sourceLanguage = ui['source-language'].value;
    var targetLanguage = ui['target-language'].value;
    if (sourceLanguage === targetLanguage) {
      showError({ code: 'LANGUAGE', message: '원본과 다른 번역 언어를 선택해 줘.' }); return;
    }
    var translateBatch;
    try {
      translateBatch = provider.createOpenAITranslator({ apiKey: ui['api-key'].value.trim(), model: ui.model.value.trim(), sourceLanguage: sourceLanguage, targetLanguage: targetLanguage, tone: ui.tone.value.trim() });
    } catch (error) { showError(error); return; }
    state.busy = true; state.cancellation = jobs.createCancellation();
    ui.progress.value = 0;
    ui.status.textContent = '첫 묶음을 번역하고 있어…'; updateButtons();
    try {
      var result = await jobs.translateDocument(state.snapshot.document, translateBatch, {
        signal: state.cancellation.signal,
        onProgress: function (progress) {
          ui.progress.value = progress.completed;
          ui.status.textContent = progress.completed + ' / ' + progress.total + '개 검사 완료 · ' + progress.batch + ' / ' + progress.batches + '묶음';
        },
        onRetry: function () { ui.status.textContent = 'API의 일시적인 오류로 잠시 뒤 다시 요청할게…'; }
      });
      files.verifyOutput(state.snapshot, result.output);
      state.result = result;
      var selectedOption = ui['target-language'].options[ui['target-language'].selectedIndex];
      state.savedLanguageCode = selectedOption.getAttribute('data-code') || 'translated';
      ui.status.textContent = '번역 완료. ' + result.count + '개 자막의 번호·타임코드 보존 검사를 통과했어.';
      ui['result-meta'].textContent = '번역 내용을 확인하고 새 SRT로 저장해 줘. 원본부터 잘못된 싱크는 자동 교정하지 않아.';
      preview();
    } catch (error) {
      if (error && (error.code === 'ABORTED' || error.name === 'AbortError')) {
        ui.status.textContent = '취소했어. 새 결과 파일은 만들지 않았어. 이미 전송한 요청에는 사용료가 발생할 수 있어.';
      } else {
        ui.status.textContent = '번역을 중단했어. 새 결과 파일은 만들지 않았어.'; showError(error);
      }
      if (state.result) ui['result-meta'].textContent = '이전에 검사를 통과한 번역은 그대로 보관돼. 저장 버튼은 이전 결과를 저장해.';
    } finally {
      translateBatch = null; state.cancellation = null; state.busy = false; updateButtons();
    }
  });

  ui.cancel.addEventListener('click', function () {
    if (state.cancellation) {
      state.cancellation.abort(); ui.status.textContent = '취소 요청을 처리하고 있어…'; updateButtons();
    }
  });

  ui.save.addEventListener('click', async function () {
    if (state.busy || !state.result) return;
    clearMessages();
    var selected;
    try {
      var initial = nodePath.dirname(state.snapshot.path);
      var suggested = files.suggestedName(state.snapshot, state.savedLanguageCode);
      selected = getDialogPath(cep.fs.showSaveDialogEx('번역 SRT를 새 파일로 저장', initial, ['srt'], suggested, '', '저장', '파일 이름:'), false);
      if (!selected) return;
      if (nodePath.extname(selected).toLowerCase() !== '.srt') selected += '.srt';
    } catch (error) { showError(error); return; }
    state.busy = true; updateButtons();
    try {
      var saved = await files.writeTranslatedCopy(state.snapshot, selected, state.result.output);
      ui.status.textContent = '새 SRT를 저장했어. Premiere로 가져와서 확인해 줘.';
      ui['saved-path'].textContent = saved.path; ui['saved-path'].hidden = false;
      if (saved.cleanupWarning) ui['result-meta'].textContent = 'SRT 저장은 완료됐어. 같은 폴더에 임시 .tmp 파일이 남아 있을 수 있어.';
    } catch (error) { showError(error); }
    finally { state.busy = false; updateButtons(); }
  });

  window.addEventListener('beforeunload', function () {
    if (state.cancellation) state.cancellation.abort();
    ui['api-key'].value = '';
  });

  try {
    var bridge = window.__adobe_cep__;
    var nodeRequire = window.cep_node && window.cep_node.require;
    if (!nodeRequire && typeof require === 'function') nodeRequire = require;
    cep = window.cep;
    if (!bridge || !nodeRequire || !cep || !cep.fs) throw new Error('NO_CEP');
    nodePath = nodeRequire('path');
    var rawPath = bridge.getSystemPath('extension');
    extensionPath = /^file:/i.test(rawPath) ? nodeRequire('url').fileURLToPath(rawPath) : rawPath;
    if (!nodePath.isAbsolute(extensionPath)) throw new Error('EXTENSION_PATH');
    files = nodeRequire(nodePath.join(extensionPath, 'lib', 'files.js'));
    jobs = nodeRequire(nodePath.join(extensionPath, 'lib', 'jobs.js'));
    provider = nodeRequire(nodePath.join(extensionPath, 'lib', 'openai.js'));
    var host = JSON.parse(bridge.getHostEnvironment());
    var processInfo = nodeRequire('process');
    if (host.appName && host.appName !== 'PPRO') throw new Error('WRONG_HOST');
    ui.runtime.textContent = 'Premiere Pro ' + (host.appVersion || '') + ' · Node ' + processInfo.versions.node;
    state.ready = true; updateButtons();
  } catch (_) {
    ui.runtime.textContent = 'Premiere CEP 연결이 필요해';
    ui.status.textContent = 'Install_Mac.command로 설치한 뒤 Premiere의 창 → 확장 프로그램에서 GPT Translator를 열어 줘.';
    showError({ code: 'CEP_UNAVAILABLE', message: '일반 브라우저에서는 실행할 수 없어. Premiere에서도 이 메시지가 나오면 설치와 CEP 디버그 설정을 확인해 줘.' });
  }
}());
