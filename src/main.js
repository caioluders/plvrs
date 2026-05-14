const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const WORD_REGEX = /\p{L}+/gu;
const TOKEN_REGEX = /(\p{L}+|[^\p{L}]+)/gu;
const MAX_DICTIONARY_RESULTS = 400;
const RULE_LABELS = {
  manual: "atalho manual",
  edge: "forma direta",
  collision: "colisão resolvida",
  original: "sem compressão"
};

const state = {
  meta: null,
  phrases: [],
  chunks: new Map(),
  lookups: new Map(),
  dictionaryEntries: new Map(),
  allChunksLoaded: false,
  mode: "compress",
  currentOutput: "",
  dictionaryLetter: "all",
  dictionaryRule: "all",
  converterRunId: 0,
  dictionaryRunId: 0,
  toastTimer: 0,
  phraseByCompressedExact: new Map(),
  phraseByCompressedNormalized: new Map()
};

const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const mastheadMeta = document.querySelector("#masthead-meta");
const heroMetrics = document.querySelector("#hero-metrics");
const heroTicker = document.querySelector("#hero-ticker");
const heroStrapline = document.querySelector("#hero-strapline");
const sourceText = document.querySelector("#source-text");
const resultRendered = document.querySelector("#result-rendered");
const inputChars = document.querySelector("#input-chars");
const outputChars = document.querySelector("#output-chars");
const inputLabel = document.querySelector("#input-label");
const outputLabel = document.querySelector("#output-label");
const modeCompress = document.querySelector("#mode-compress");
const modeExpand = document.querySelector("#mode-expand");
const clearInput = document.querySelector("#clear-input");
const copyResult = document.querySelector("#copy-result");
const reuseOutput = document.querySelector("#reuse-output");
const compressionFill = document.querySelector("#compression-fill");
const compressionPct = document.querySelector("#compression-pct");
const savedCount = document.querySelector("#saved-count");
const converterExamples = document.querySelector("#converter-examples");
const converterStatus = document.querySelector("#converter-status");
const dictionarySearch = document.querySelector("#dictionary-search");
const dictionaryClear = document.querySelector("#dictionary-clear");
const dictionaryAlpha = document.querySelector("#dictionary-alpha");
const dictionaryRuleFilters = document.querySelector("#dictionary-rule-filters");
const dictionaryCount = document.querySelector("#dictionary-count");
const dictionaryChunkLabel = document.querySelector("#dictionary-chunk-label");
const dictionaryResults = document.querySelector("#dictionary-results");
const dictionaryStatus = document.querySelector("#dictionary-status");
const statCharsSaved = document.querySelector("#stat-chars-saved");
const statTotalWords = document.querySelector("#stat-total-words");
const statCompressionRate = document.querySelector("#stat-compression-rate");
const statManualTotal = document.querySelector("#stat-manual-total");
const ruleBreakdown = document.querySelector("#rule-breakdown");
const topSavingsList = document.querySelector("#top-savings-list");
const letterDistribution = document.querySelector("#letter-distribution");
const manualRuleCount = document.querySelector("#manual-rule-count");
const manualShortcutsTable = document.querySelector("#manual-shortcuts-table");
const methodologyList = document.querySelector("#methodology-list");
const footerMetaLeft = document.querySelector("#footer-meta-left");
const footerMetaRight = document.querySelector("#footer-meta-right");
const toast = document.querySelector("#toast");
const toastText = document.querySelector("#toast-text");

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeWord(value) {
  return normalizeText(value).replace(/[^a-z]/g, "");
}

function toLowerCasePreservingAccents(value) {
  return value.toLocaleLowerCase("pt-BR");
}

function countAccents(value) {
  return [...value].reduce((total, char) => {
    return total + (normalizeText(char) !== char.toLowerCase() ? 1 : 0);
  }, 0);
}

function getCaseStyle(value) {
  if (value.toUpperCase() === value) {
    return "upper";
  }

  if (value[0] && value[0].toUpperCase() === value[0] && value.slice(1).toLowerCase() === value.slice(1)) {
    return "capitalized";
  }

  return "lower";
}

function applyCase(style, value) {
  if (style === "upper") {
    return value.toUpperCase();
  }

  if (style === "capitalized") {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  return value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInt(value) {
  return value.toLocaleString("pt-BR");
}

function formatPct(value) {
  return `${String(value).replace(".", ",")}%`;
}

function classifyRule(kind, reason) {
  if (kind === "manual-word" || kind === "manual-phrase") {
    return "manual";
  }

  if (kind === "original") {
    return "original";
  }

  if (reason.toLowerCase().includes("colis")) {
    return "collision";
  }

  return "edge";
}

function ruleLabel(rule) {
  return RULE_LABELS[rule] ?? rule;
}

function showToast(message) {
  toastText.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function debounce(fn, delay = 120) {
  let timeoutId = 0;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}`);
  }
  return response.json();
}

async function loadChunk(letter) {
  if (!letter || state.chunks.has(letter)) {
    return state.chunks.get(letter) ?? null;
  }

  const chunk = await fetchJson(`./data/chunks/${letter}.json`);
  state.chunks.set(letter, chunk);
  return chunk;
}

async function loadAllChunks() {
  if (state.allChunksLoaded) {
    return;
  }

  await Promise.all(LETTERS.map((letter) => loadChunk(letter)));
  state.allChunksLoaded = true;
}

function preparePhrases(phrases) {
  state.phrases = phrases.map((phrase) => ({
    ...phrase,
    rule: "manual",
    sourceWords: phrase.source.split(/\s+/),
    sourceExact: toLowerCasePreservingAccents(phrase.source),
    sourceNormalized: normalizeText(phrase.source).replace(/\s+/g, " ").trim(),
    compressedExact: toLowerCasePreservingAccents(phrase.compressed),
    compressedNormalized: normalizeWord(phrase.compressed)
  }));

  state.phraseByCompressedExact.clear();
  state.phraseByCompressedNormalized.clear();

  for (const phrase of state.phrases) {
    state.phraseByCompressedExact.set(phrase.compressedExact, phrase);
    state.phraseByCompressedNormalized.set(phrase.compressedNormalized, phrase);
  }
}

function selectCompressionEntry(entries) {
  return [...entries].sort((left, right) => {
    const compressedLengthDiff = normalizeWord(left.compressed).length - normalizeWord(right.compressed).length;
    if (compressedLengthDiff !== 0) {
      return compressedLengthDiff;
    }

    const accentDiff = countAccents(left.compressed) - countAccents(right.compressed);
    if (accentDiff !== 0) {
      return accentDiff;
    }

    const manualDiff = Number(right.rule === "manual") - Number(left.rule === "manual");
    if (manualDiff !== 0) {
      return manualDiff;
    }

    return left.compressed.localeCompare(right.compressed, "pt-BR");
  })[0];
}

function selectExpansionEntry(entries) {
  return [...entries].sort((left, right) => {
    const manualDiff = Number(right.rule === "manual") - Number(left.rule === "manual");
    if (manualDiff !== 0) {
      return manualDiff;
    }

    const accentDiff = countAccents(left.source) - countAccents(right.source);
    if (accentDiff !== 0) {
      return accentDiff;
    }

    const sourceLengthDiff = normalizeWord(left.source).length - normalizeWord(right.source).length;
    if (sourceLengthDiff !== 0) {
      return sourceLengthDiff;
    }

    return left.source.localeCompare(right.source, "pt-BR");
  })[0];
}

function buildLookup(letter) {
  if (state.lookups.has(letter)) {
    return state.lookups.get(letter);
  }

  const chunk = state.chunks.get(letter);
  const emptyLookup = {
    bySourceExact: new Map(),
    bySourceNormalized: new Map(),
    byCompressedExact: new Map(),
    byCompressedNormalized: new Map(),
    preferredSourceNormalized: new Map(),
    preferredCompressedNormalized: new Map()
  };

  if (!chunk) {
    state.lookups.set(letter, emptyLookup);
    return emptyLookup;
  }

  for (const [source, compressed, kind, reason] of chunk.entries) {
    const entry = {
      source,
      compressed,
      kind,
      reason,
      rule: classifyRule(kind, reason),
      sourceExact: toLowerCasePreservingAccents(source),
      sourceNormalized: normalizeWord(source),
      compressedExact: toLowerCasePreservingAccents(compressed),
      compressedNormalized: normalizeWord(compressed)
    };

    emptyLookup.bySourceExact.set(entry.sourceExact, entry);

    if (!emptyLookup.bySourceNormalized.has(entry.sourceNormalized)) {
      emptyLookup.bySourceNormalized.set(entry.sourceNormalized, []);
    }
    emptyLookup.bySourceNormalized.get(entry.sourceNormalized).push(entry);

    if (!emptyLookup.byCompressedExact.has(entry.compressedExact)) {
      emptyLookup.byCompressedExact.set(entry.compressedExact, []);
    }
    emptyLookup.byCompressedExact.get(entry.compressedExact).push(entry);

    if (!emptyLookup.byCompressedNormalized.has(entry.compressedNormalized)) {
      emptyLookup.byCompressedNormalized.set(entry.compressedNormalized, []);
    }
    emptyLookup.byCompressedNormalized.get(entry.compressedNormalized).push(entry);
  }

  for (const [sourceNormalized, entries] of emptyLookup.bySourceNormalized.entries()) {
    emptyLookup.preferredSourceNormalized.set(sourceNormalized, selectCompressionEntry(entries));
  }

  for (const [compressedNormalized, entries] of emptyLookup.byCompressedNormalized.entries()) {
    emptyLookup.preferredCompressedNormalized.set(compressedNormalized, selectExpansionEntry(entries));
  }

  state.lookups.set(letter, emptyLookup);
  return emptyLookup;
}

function lookupWordToken(token, mode) {
  const exactKey = toLowerCasePreservingAccents(token);
  const normalizedKey = normalizeWord(token);
  if (!normalizedKey) {
    return null;
  }

  const lookup = buildLookup(normalizedKey[0]);

  if (mode === "compress") {
    const exactEntry = lookup.bySourceExact.get(exactKey);
    if (exactEntry) {
      return exactEntry;
    }
    return lookup.preferredSourceNormalized.get(normalizedKey) ?? null;
  }

  const exactEntries = lookup.byCompressedExact.get(exactKey);
  if (exactEntries?.length) {
    return selectExpansionEntry(exactEntries);
  }
  return lookup.preferredCompressedNormalized.get(normalizedKey) ?? null;
}

function tokenizeText(text) {
  const matches = text.match(TOKEN_REGEX);
  if (!matches) {
    return [];
  }

  return matches.map((token) => ({
    kind: /^\p{L}+$/u.test(token) ? "word" : "sep",
    text: token
  }));
}

function applyPhraseRules(text, mode) {
  if (mode === "compress") {
    const phrases = [...state.phrases].sort((left, right) => right.source.length - left.source.length);
    let output = text;

    for (const phrase of phrases) {
      const escaped = phrase.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^\\p{L}])(${escaped})(?=$|[^\\p{L}])`, "giu");
      output = output.replace(pattern, (fullMatch, boundary, matchedPhrase) => {
        return `${boundary}${applyCase(getCaseStyle(matchedPhrase), phrase.compressed)}`;
      });
    }

    return output;
  }

  const phrases = [...state.phrases].sort((left, right) => right.compressed.length - left.compressed.length);
  let output = text;

  for (const phrase of phrases) {
    const escaped = phrase.compressed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^\\p{L}])(${escaped})(?=$|[^\\p{L}])`, "giu");
    output = output.replace(pattern, (fullMatch, boundary, matchedPhrase) => {
      return `${boundary}${applyCase(getCaseStyle(matchedPhrase), phrase.source)}`;
    });
  }

  return output;
}

async function ensureChunksForText(text, mode = state.mode) {
  const uniqueLetters = new Set();

  for (const token of text.match(WORD_REGEX) ?? []) {
    const firstLetter = normalizeWord(token)[0];
    if (firstLetter) {
      uniqueLetters.add(firstLetter);
    }
  }

  if (mode === "expand") {
    for (const phrase of state.phrases) {
      if (text.toLowerCase().includes(phrase.compressedExact)) {
        uniqueLetters.add(phrase.compressedNormalized[0]);
      }
    }
  }

  await Promise.all(Array.from(uniqueLetters).map((letter) => loadChunk(letter)));
}

function compressString(text) {
  const prepared = applyPhraseRules(text, "compress");
  return prepared.replace(WORD_REGEX, (token) => {
    const entry = lookupWordToken(token, "compress");
    if (!entry) {
      return token;
    }
    return applyCase(getCaseStyle(token), entry.compressed);
  });
}

function expandString(text) {
  const prepared = applyPhraseRules(text, "expand");
  return prepared.replace(WORD_REGEX, (token) => {
    const entry = lookupWordToken(token, "expand");
    if (!entry) {
      return token;
    }
    return applyCase(getCaseStyle(token), entry.source);
  });
}

function describeCompressedToken(token) {
  const exact = toLowerCasePreservingAccents(token);
  const normalized = normalizeWord(token);
  const phrase = state.phraseByCompressedExact.get(exact) ?? state.phraseByCompressedNormalized.get(normalized);
  if (phrase) {
    return {
      changed: true,
      original: phrase.source,
      rule: "manual"
    };
  }

  const entry = lookupWordToken(token, "expand");
  if (!entry) {
    return { changed: false, original: token, rule: "original" };
  }

  return {
    changed: normalizeWord(entry.source) !== normalizeWord(entry.compressed),
    original: entry.source,
    rule: entry.rule
  };
}

function renderOutputHtml(input, output, mode) {
  if (!output) {
    return '<span class="conv-placeholder">a saída aparece aqui em tempo real…</span>';
  }

  const inputWords = (input.match(WORD_REGEX) ?? []).map((word) => toLowerCasePreservingAccents(word));
  let inputWordIndex = 0;

  return tokenizeText(output)
    .map((part) => {
      if (part.kind === "sep") {
        return escapeHtml(part.text);
      }

      if (mode === "compress") {
        const info = describeCompressedToken(part.text);
        if (!info.changed) {
          return `<span class="tok">${escapeHtml(part.text)}</span>`;
        }

        return `<span class="tok changed">${escapeHtml(part.text)}<span class="tip">${escapeHtml(info.original)} · ${escapeHtml(
          ruleLabel(info.rule)
        )}</span></span>`;
      }

      const currentInput = inputWords[inputWordIndex] ?? "";
      const changed = currentInput !== toLowerCasePreservingAccents(part.text);
      const compressedEntry = lookupWordToken(part.text, "compress");
      const originalHint = currentInput || compressedEntry?.compressed || part.text;
      const hintRule = compressedEntry?.rule ?? "manual";
      inputWordIndex += 1;

      if (!changed) {
        return `<span class="tok">${escapeHtml(part.text)}</span>`;
      }

      return `<span class="tok changed">${escapeHtml(part.text)}<span class="tip">${escapeHtml(originalHint)} · ${escapeHtml(
        ruleLabel(hintRule)
      )}</span></span>`;
    })
    .join("");
}

function updateConverterExamples() {
  const examples =
    state.mode === "compress"
      ? [
          "Por favor me manda mensagem qualquer hora.",
          "Você também vai amanhã?",
          "Tudo bem, valeu mesmo.",
          "Obrigado pela mensagem.",
          "Sem problemas, qualquer ajuste eu vejo amanhã."
        ]
      : [
          "pfvr me manda msg qlqr hora.",
          "vc tbm vai amn?",
          "tdbm, vlw msm.",
          "obgd pela msg.",
          "smpblms, qlqr ajste eu vejo amn."
        ];

  converterExamples.innerHTML = examples
    .map((example) => `<button class="chip" type="button" data-example="${escapeHtml(example)}">${escapeHtml(example)}</button>`)
    .join("");

  converterExamples.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      sourceText.value = button.dataset.example;
      convertAndRender().catch(handleError);
    });
  });
}

function updateModeUi() {
  const compressActive = state.mode === "compress";
  modeCompress.classList.toggle("active", compressActive);
  modeExpand.classList.toggle("active", !compressActive);
  inputLabel.textContent = compressActive ? "português" : "cmprmd";
  outputLabel.textContent = compressActive ? "comprimido" : "português";
  sourceText.placeholder = compressActive ? "digite uma frase em pt-br…" : "digite uma frase cmprmd…";
  updateConverterExamples();
}

async function convertAndRender() {
  const input = sourceText.value;
  const runId = ++state.converterRunId;
  inputChars.textContent = formatInt(input.length);

  if (!input.trim()) {
    state.currentOutput = "";
    outputChars.textContent = "0";
    resultRendered.innerHTML = renderOutputHtml("", "", state.mode);
    compressionFill.style.width = "0%";
    compressionPct.textContent = "0%";
    savedCount.textContent = "0";
    converterStatus.textContent = "pronto para converter.";
    return;
  }

  converterStatus.textContent = "carregando blocos necessários…";
  await ensureChunksForText(input, state.mode);
  if (runId !== state.converterRunId) {
    return;
  }

  const output = state.mode === "compress" ? compressString(input) : expandString(input);
  state.currentOutput = output;
  outputChars.textContent = formatInt(output.length);
  resultRendered.innerHTML = renderOutputHtml(input, output, state.mode);

  const saved = Math.max(0, input.length - output.length);
  const pct = input.length > 0 ? Math.round((saved / input.length) * 100) : 0;
  compressionFill.style.width = `${pct}%`;
  compressionPct.textContent = `${pct}%`;
  savedCount.textContent = formatInt(saved);
  converterStatus.textContent = state.mode === "compress" ? "texto comprimido ao vivo." : "texto expandido ao vivo.";
}

function getDictionaryEntryObjects(letter) {
  if (state.dictionaryEntries.has(letter)) {
    return state.dictionaryEntries.get(letter);
  }

  const chunk = state.chunks.get(letter);
  if (!chunk) {
    return [];
  }

  const entries = chunk.entries.map(([source, compressed, kind, reason]) => {
    const sourceNormalized = normalizeWord(source);
    const compressedNormalized = normalizeWord(compressed);
    return {
      source,
      compressed,
      kind,
      reason,
      rule: classifyRule(kind, reason),
      sourceNormalized,
      compressedNormalized,
      pct:
        sourceNormalized.length > 0
          ? Math.max(0, Math.round((1 - compressedNormalized.length / sourceNormalized.length) * 100))
          : 0
    };
  });

  state.dictionaryEntries.set(letter, entries);
  return entries;
}

function getManualPhraseEntries() {
  return state.phrases.map((phrase) => ({
    source: phrase.source,
    compressed: phrase.compressed,
    kind: "manual-phrase",
    reason: phrase.reason,
    rule: "manual",
    sourceNormalized: normalizeWord(phrase.source),
    compressedNormalized: normalizeWord(phrase.compressed),
    pct:
      normalizeWord(phrase.source).length > 0
        ? Math.max(0, Math.round((1 - normalizeWord(phrase.compressed).length / normalizeWord(phrase.source).length) * 100))
        : 0
  }));
}

function getManualDictionaryEntries() {
  return state.meta.manualEntries.map((entry) => ({
    source: entry.source,
    compressed: entry.compressed,
    kind: entry.kind,
    reason: entry.reason,
    rule: "manual",
    sourceNormalized: normalizeWord(entry.source),
    compressedNormalized: normalizeWord(entry.compressed),
    pct:
      normalizeWord(entry.source).length > 0
        ? Math.max(0, Math.round((1 - normalizeWord(entry.compressed).length / normalizeWord(entry.source).length) * 100))
        : 0
  }));
}

function renderDictionarySkeleton(rows = 6) {
  dictionaryResults.innerHTML = Array.from({ length: rows })
    .map(
      () => `
        <div class="skeleton-row">
          <div class="sk" style="width: 42%"></div>
          <div class="sk" style="width: 60px"></div>
          <div class="sk" style="width: 140px"></div>
        </div>
      `
    )
    .join("");
}

function renderDictionaryEntries(entries) {
  if (entries.length === 0) {
    dictionaryResults.innerHTML = `
      <div class="empty-state">
        <div class="glyph">∅</div>
        <div class="msg">nenhum verbete encontrado</div>
      </div>
    `;
    return;
  }

  dictionaryResults.innerHTML = entries
    .map((entry) => {
      return `
        <div class="entry">
          <div class="entry-word">
            <span class="entry-orig">${escapeHtml(entry.source)}</span>
            <span class="entry-arrow">→</span>
            <span class="entry-comp">${escapeHtml(entry.compressed)}</span>
          </div>
          <div class="entry-pct"><span class="num">−${entry.pct}%</span></div>
          <div class="entry-rule">${escapeHtml(ruleLabel(entry.rule))}</div>
          <div class="entry-reason">"${escapeHtml(entry.reason)}"</div>
        </div>
      `;
    })
    .join("");
}

function getPreviewEntries() {
  const shortcuts = getManualPhraseEntries().slice(0, 5);
  const savings = state.meta.stats.topSavings.slice(0, 9).map((entry) => ({
    source: entry.source,
    compressed: entry.compressed,
    kind: "auto",
    reason: "uma das maiores economias observadas no corpus completo",
    rule: "edge",
    sourceNormalized: normalizeWord(entry.source),
    compressedNormalized: normalizeWord(entry.compressed),
    pct: entry.ratio
  }));
  return [...shortcuts, ...savings];
}

async function searchDictionary() {
  const runId = ++state.dictionaryRunId;
  const query = dictionarySearch.value.trim();
  dictionaryClear.hidden = !query;

  if (!query && state.dictionaryLetter === "all" && state.dictionaryRule === "all") {
    dictionaryCount.innerHTML = "prévia editorial do léxico";
    dictionaryChunkLabel.textContent = "chunk: prévia";
    dictionaryStatus.textContent = "use a busca, uma letra ou um filtro para abrir o léxico.";
    renderDictionaryEntries(getPreviewEntries());
    return;
  }

  if (!query && state.dictionaryLetter === "all" && state.dictionaryRule === "manual") {
    const manualEntries = getManualDictionaryEntries();
    dictionaryCount.innerHTML = `exibindo <span class="ct">${formatInt(manualEntries.length)}</span> atalhos manuais`;
    dictionaryChunkLabel.textContent = "chunk: manual";
    dictionaryStatus.textContent = "regras fixas carregadas sem precisar abrir todos os chunks.";
    renderDictionaryEntries(manualEntries);
    return;
  }

  renderDictionarySkeleton();
  dictionaryStatus.textContent = "carregando verbetes…";

  let sourceEntries = [];
  if (state.dictionaryLetter === "all") {
    await loadAllChunks();
    if (runId !== state.dictionaryRunId) {
      return;
    }
    sourceEntries = LETTERS.flatMap((letter) => getDictionaryEntryObjects(letter));
    dictionaryChunkLabel.textContent = "chunk: todos";
  } else {
    await loadChunk(state.dictionaryLetter);
    if (runId !== state.dictionaryRunId) {
      return;
    }
    sourceEntries = getDictionaryEntryObjects(state.dictionaryLetter);
    dictionaryChunkLabel.textContent = `chunk: data/chunks/${state.dictionaryLetter}.json`;
  }

  let entries = sourceEntries;
  if (state.dictionaryRule !== "all") {
    entries = entries.filter((entry) => entry.rule === state.dictionaryRule);
  }

  const normalizedQuery = normalizeText(query).replace(/\s+/g, " ").trim();
  const normalizedWord = normalizeWord(query);
  if (query) {
    entries = entries.filter((entry) => {
      return (
        entry.sourceNormalized.includes(normalizedWord) ||
        entry.compressedNormalized.includes(normalizedWord) ||
        normalizeText(entry.source).includes(normalizedQuery)
      );
    });
  }

  const phraseEntries = getManualPhraseEntries().filter((entry) => {
    if (state.dictionaryLetter !== "all" && entry.sourceNormalized[0] !== state.dictionaryLetter) {
      return false;
    }

    if (state.dictionaryRule !== "all" && entry.rule !== state.dictionaryRule) {
      return false;
    }

    if (!query) {
      return true;
    }

    return (
      entry.sourceNormalized.includes(normalizedWord) ||
      entry.compressedNormalized.includes(normalizedWord) ||
      normalizeText(entry.source).includes(normalizedQuery)
    );
  });

  const mergedEntries = [...phraseEntries, ...entries];
  const displayedEntries = mergedEntries.slice(0, MAX_DICTIONARY_RESULTS);

  dictionaryCount.innerHTML = `exibindo <span class="ct">${formatInt(displayedEntries.length)}</span> de <span class="ct">${formatInt(mergedEntries.length)}</span> verbetes locais`;
  dictionaryStatus.textContent =
    mergedEntries.length > MAX_DICTIONARY_RESULTS
      ? `a lista foi limitada aos primeiros ${formatInt(MAX_DICTIONARY_RESULTS)} resultados para manter a interface rápida.`
      : "busca concluída.";

  renderDictionaryEntries(displayedEntries);
}

function renderHero() {
  const manualTotal = state.meta.manualEntries.length;
  const tickerEntries = [
    ...state.meta.manualEntries.slice(0, 10).map((entry) => `${entry.source} → <span class="red">${entry.compressed}</span>`),
    `★`,
    ...state.meta.manualEntries.slice(0, 10).map((entry) => `${entry.source} → <span class="red">${entry.compressed}</span>`),
    `★`
  ];

  heroStrapline.innerHTML = `<span class="marker">vc, pfvr, msg, qlqr</span> — e mais ${formatInt(
    state.meta.stats.totalWords - 4
  )} verbetes, comprimidos pela regra atual.`;

  heroMetrics.innerHTML = [
    metricCell(formatInt(state.meta.stats.totalWords), "vrbts"),
    metricCell(formatPct(state.meta.stats.compressionRate), "cmprsão méd"),
    metricCell(formatInt(state.meta.stats.charsSaved), "crctrs ppds"),
    metricCell(String(manualTotal), "atlh mnls")
  ].join("");

  heroTicker.innerHTML = tickerEntries.map((entry) => `<span>${entry}</span>`).join("");
}

function metricCell(value, label) {
  return `
    <div class="cell">
      <div class="v">${value}</div>
      <div class="k">${label}</div>
    </div>
  `;
}

function renderDictionaryFilters() {
  dictionaryAlpha.innerHTML = [
    `<button class="${state.dictionaryLetter === "all" ? "active" : ""}" data-letter="all" type="button">tds</button>`,
    ...LETTERS.map(
      (letter) =>
        `<button class="${state.dictionaryLetter === letter ? "active" : ""}" data-letter="${letter}" type="button">${letter}</button>`
    )
  ].join("");

  dictionaryAlpha.querySelectorAll("[data-letter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dictionaryLetter = button.dataset.letter;
      renderDictionaryFilters();
      searchDictionary().catch(handleError);
    });
  });

  const manualTotal = state.meta.manualEntries.length;
  const ruleCounts = [
    { id: "all", label: "todos", count: state.meta.stats.totalWords + state.meta.stats.totalPhrases },
    { id: "manual", label: "atalho manual", count: manualTotal },
    { id: "edge", label: "forma direta", count: state.meta.stats.skeletonOnly },
    { id: "collision", label: "colisão resolvida", count: state.meta.stats.collisionResolved },
    { id: "original", label: "sem compressão", count: state.meta.stats.keptOriginal }
  ];

  dictionaryRuleFilters.innerHTML = ruleCounts
    .map(
      (rule) => `
        <button class="${state.dictionaryRule === rule.id ? "active" : ""}" data-rule="${rule.id}" type="button">
          <span>${rule.label}</span>
          <span class="ct">${formatInt(rule.count)}</span>
        </button>
      `
    )
    .join("");

  dictionaryRuleFilters.querySelectorAll("[data-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dictionaryRule = button.dataset.rule;
      renderDictionaryFilters();
      searchDictionary().catch(handleError);
    });
  });
}

function renderStats() {
  const stats = state.meta.stats;
  const manualTotal = state.meta.manualEntries.length;

  statCharsSaved.innerHTML = `<span>${formatInt(stats.charsSaved)}</span>`;
  statTotalWords.innerHTML = `<span>${formatInt(stats.totalWords)}</span>`;
  statCompressionRate.innerHTML = `<span>${formatPct(stats.compressionRate)}</span>`;
  statManualTotal.innerHTML = `<span>${formatInt(manualTotal)}</span>`;

  const ruleRows = [
    { rule: "manual", label: "atalho manual", count: manualTotal },
    { rule: "edge", label: "forma direta", count: stats.skeletonOnly },
    { rule: "collision", label: "colisão resolvida", count: stats.collisionResolved },
    { rule: "original", label: "sem compressão", count: stats.keptOriginal }
  ].map((item) => ({
    ...item,
    pct: Number(((item.count / stats.totalWords) * 100).toFixed(2))
  }));

  ruleBreakdown.innerHTML = ruleRows
    .map(
      (row) => `
        <div class="rule-row ${row.rule === "manual" ? "red" : ""}">
          <div class="lbl">${row.label}</div>
          <div class="bar"><div class="fl" style="width:${Math.max(0.5, row.pct)}%"></div></div>
          <div class="v">${formatInt(row.count)} · ${formatPct(row.pct)}</div>
        </div>
      `
    )
    .join("");

  topSavingsList.innerHTML = stats.topSavings
    .map(
      (entry, index) => `
        <div class="row">
          <div class="rnk">${String(index + 1).padStart(2, "0")}</div>
          <div class="w">${escapeHtml(entry.source)} <span style="font-family: var(--f-mono); font-size: 12px; color: var(--red); margin-left: 6px">→</span> <span class="c" style="margin-left: 2px">${escapeHtml(entry.compressed)}</span></div>
          <div class="p" style="color: var(--muted)">−${entry.saved}</div>
          <div class="p">−${formatPct(entry.ratio)}</div>
        </div>
      `
    )
    .join("");

  const maxLetterCount = Math.max(...Object.values(stats.byLetter));
  letterDistribution.innerHTML = Object.entries(stats.byLetter)
    .map(([letter, count]) => {
      const height = maxLetterCount === 0 ? 0 : (count / maxLetterCount) * 100;
      return `
        <div class="dist-bar" style="height:${height}%">
          <span class="pop">${formatInt(count)}</span>
          <span class="lbl">${letter}</span>
        </div>
      `;
    })
    .join("");
}

function renderMethod() {
  const manualEntries = state.meta.manualEntries;
  manualRuleCount.textContent = formatInt(manualEntries.length);

  manualShortcutsTable.innerHTML = manualEntries
    .map(
      (entry) => `
        <div class="row">
          <div class="from">${escapeHtml(entry.source)}</div>
          <div class="ar">→</div>
          <div class="to">${escapeHtml(entry.compressed)}</div>
        </div>
      `
    )
    .join("");

  methodologyList.innerHTML = state.meta.methodology
    .map(
      (step, index) => `
        <div class="row">
          <div class="from">${String(index + 1).padStart(2, "0")}</div>
          <div class="ar">→</div>
          <div class="to">${escapeHtml(step)}</div>
        </div>
      `
    )
    .join("");
}

function renderFooter() {
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  mastheadMeta.innerHTML = `ed. ${today}<br />v.1.0 — pt-br`;
  footerMetaLeft.innerHTML = `${formatInt(state.meta.stats.totalWords)} verbetes<br />${state.meta.manualEntries.length} atalhos manuais`;
  footerMetaRight.innerHTML = `ed. ${today}<br />static build · pt-br`;
}

function setupNav() {
  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) {
        return;
      }
      const top = target.getBoundingClientRect().top + window.scrollY - 60;
      window.scrollTo({ top, behavior: "smooth" });
    });
  });

  const updateActiveNav = () => {
    const y = window.scrollY + 120;
    let current = "conversor";
    for (const id of ["conversor", "dicionario", "estatisticas", "metodo"]) {
      const section = document.getElementById(id);
      if (section && section.offsetTop <= y) {
        current = id;
      }
    }

    navLinks.forEach((link) => {
      link.classList.toggle("active", link.dataset.nav === current);
    });
  };

  window.addEventListener("scroll", updateActiveNav, { passive: true });
  updateActiveNav();
}

function setupActions() {
  sourceText.addEventListener("input", debounce(() => convertAndRender().catch(handleError)));
  modeCompress.addEventListener("click", () => {
    state.mode = "compress";
    updateModeUi();
    convertAndRender().catch(handleError);
  });
  modeExpand.addEventListener("click", () => {
    state.mode = "expand";
    updateModeUi();
    convertAndRender().catch(handleError);
  });
  clearInput.addEventListener("click", () => {
    sourceText.value = "";
    convertAndRender().catch(handleError);
  });
  copyResult.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.currentOutput);
      showToast("copiado para a área de transferência");
    } catch (error) {
      showToast("não foi possível copiar");
    }
  });
  reuseOutput.addEventListener("click", () => {
    sourceText.value = state.currentOutput;
    showToast("saída movida para a entrada");
    convertAndRender().catch(handleError);
  });

  dictionarySearch.addEventListener("input", debounce(() => searchDictionary().catch(handleError)));
  dictionaryClear.addEventListener("click", () => {
    dictionarySearch.value = "";
    searchDictionary().catch(handleError);
  });
}

function handleError(error) {
  console.error(error);
  converterStatus.textContent = "falha ao processar o conversor.";
  dictionaryStatus.textContent = "falha ao carregar o dicionário.";
}

async function init() {
  const [meta, phrases] = await Promise.all([fetchJson("./data/meta.json"), fetchJson("./data/phrases.json")]);
  state.meta = meta;
  preparePhrases(phrases);

  renderHero();
  renderDictionaryFilters();
  renderStats();
  renderMethod();
  renderFooter();
  updateModeUi();
  setupNav();
  setupActions();

  sourceText.value = "Por favor me manda a mensagem amanhã porque você também falou com a galera e qualquer ajuste valeu.";
  await convertAndRender();
  await searchDictionary();
}

init().catch(handleError);
