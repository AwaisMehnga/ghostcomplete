// Enhanced TypeScript autocomplete with proper multi-field support
(function () {
  'use strict';

  interface AutocompleteConfig {
    MAX_WORDS: number;
    MAX_PATTERNS: number;
    MAX_SUGGESTIONS: number;
    MAX_STABLE: number;
    MAX_TOTAL: number;
    DEBOUNCE_DELAY: number;
    STORAGE_SYNC_DELAY: number;
    IDLE_CLEANUP_DELAY: number;
    classes?: {
      popupContainer?: string;
      popupRow?: string;
      popupRowSelected?: string;
      popupHint?: string;
    };
  }

  interface WordBounds {
    start: number;
    end: number;
    word: string;
  }

  interface CaretCoords {
    left: number;
    top: number;
    height: number;
  }

  interface StorageKeys {
    wordsKey: string;
    patternsKey: string;
  }

  interface PatternCache {
    [context: string]: { [word: string]: number };
  }

  interface PendingStorage {
    words: Set<string>;
    patterns: Set<string>;
  }

  const DEFAULT_CONFIG: AutocompleteConfig = {
    MAX_WORDS: 300,
    MAX_PATTERNS: 100,
    MAX_SUGGESTIONS: 5,
    MAX_STABLE: 10,
    MAX_TOTAL: 15,
    DEBOUNCE_DELAY: 160,
    STORAGE_SYNC_DELAY: 600,
    IDLE_CLEANUP_DELAY: 2000
  };

  const groupConfigs: { [key: string]: AutocompleteConfig } = Object.create(null);

  // Get or create group configuration
  function getGroupConfig(group = ""): AutocompleteConfig {
    if (!groupConfigs[group]) {
      groupConfigs[group] = { ...DEFAULT_CONFIG };
    }
    return groupConfigs[group];
  }

  // Update group configuration with new parameters and classes
  function updateGroupConfig(group = "", params: Partial<AutocompleteConfig> = {}, classes: any = {}): void {
    if (!groupConfigs[group]) {
      groupConfigs[group] = { ...DEFAULT_CONFIG };
    }
    Object.assign(groupConfigs[group], params);
    if (classes) {
      groupConfigs[group].classes = { ...groupConfigs[group].classes, ...classes };
    }
  }

  // Parse element configuration from data attributes
  function parseElementConfig(element: HTMLElement): string {
    const group = element.dataset.autocomplete || "";
    let params: any = {};
    let classes: any = {};
    
    if (element.dataset.autocompleteParams) {
      try {
        params = JSON.parse(element.dataset.autocompleteParams);
      } catch (e) {}
    }
    
    if (element.dataset.autocompleteClasses) {
      try {
        classes = JSON.parse(element.dataset.autocompleteClasses);
      } catch (e) {}
    }
    
    if (Object.keys(params).length > 0 || Object.keys(classes).length > 0) {
      updateGroupConfig(group, params, classes);
    }
    
    return group;
  }

  let ghost: HTMLDivElement | null = null;
  let popup: HTMLDivElement | null = null;
  let mirror: HTMLDivElement | null = null;

  // Per-element state tracking
  const elementStates = new Map<HTMLElement, {
    group: string;
    suggestions: string[];
    selectedIndex: number;
    isComposing: boolean;
    debounceTimer: number | null;
    rafId: number | null;
  }>();

  const wordsCacheMap: { [key: string]: string[] } = Object.create(null);
  const patternsCacheMap: { [key: string]: PatternCache } = Object.create(null);
  const trieMap: { [key: string]: Trie } = Object.create(null);
  const pendingStorage: PendingStorage = { words: new Set(), patterns: new Set() };
  const elementWordCount = new WeakMap<HTMLElement, number>();

  // Generate storage keys for a group
  function getStorageKeys(group: string): StorageKeys {
    const base = group ? `_${group}` : "";
    return {
      wordsKey: `custom_autocomplete_words${base}_v1`,
      patternsKey: `custom_autocomplete_patterns${base}_v1`,
    };
  }

  class TrieNode {
    children: { [key: string]: TrieNode } = Object.create(null);
    isWord = false;
  }

  class Trie {
    root = new TrieNode();

    // Insert word into trie
    insert(word: string): void {
      if (!word) return;
      let node = this.root;
      const lower = word.toLowerCase();
      for (let i = 0; i < lower.length; i++) {
        const ch = lower[i];
        if (!node.children[ch]) node.children[ch] = new TrieNode();
        node = node.children[ch];
      }
      node.isWord = true;
    }

    // Search for words with given prefix
    search(prefix: string, limit = DEFAULT_CONFIG.MAX_SUGGESTIONS): string[] {
      const res: string[] = [];
      if (!prefix) return res;
      const lower = prefix.toLowerCase();
      let node = this.root;
      for (let i = 0; i < lower.length; i++) {
        const ch = lower[i];
        node = node.children[ch];
        if (!node) return res;
      }
      this._collect(node, prefix.slice(0, prefix.length), res, limit);
      return res;
    }

    private _collect(node: TrieNode, prefix: string, acc: string[], limit: number): void {
      if (acc.length >= limit) return;
      if (node.isWord) acc.push(prefix);
      if (acc.length >= limit) return;
      for (const ch in node.children) {
        if (!(ch in node.children)) continue;
        this._collect(node.children[ch], prefix + ch, acc, limit);
        if (acc.length >= limit) return;
      }
    }
  }

  // Load words from localStorage for a group
  function loadWords(group = ""): string[] {
    if (wordsCacheMap[group]) return wordsCacheMap[group].slice();
    const { wordsKey } = getStorageKeys(group);
    const config = getGroupConfig(group);
    try {
      const raw = localStorage.getItem(wordsKey);
      const arr = raw ? JSON.parse(raw) : [];
      wordsCacheMap[group] = Array.isArray(arr) ? arr.slice(0, config.MAX_WORDS) : [];
      rebuildTrieForGroup(group);
      return wordsCacheMap[group].slice();
    } catch (e) {
      wordsCacheMap[group] = [];
      trieMap[group] = new Trie();
      return [];
    }
  }

  // Load patterns from localStorage for a group
  function loadPatterns(group = ""): PatternCache {
    if (patternsCacheMap[group]) return patternsCacheMap[group];
    const { patternsKey } = getStorageKeys(group);
    try {
      const raw = localStorage.getItem(patternsKey);
      const obj = raw ? JSON.parse(raw) : {};
      patternsCacheMap[group] = obj && typeof obj === 'object' ? obj : {};
      return patternsCacheMap[group];
    } catch (e) {
      patternsCacheMap[group] = {};
      return patternsCacheMap[group];
    }
  }

  // Rebuild trie from cached words for a group
  function rebuildTrieForGroup(group = ""): void {
    const arr = wordsCacheMap[group] || loadWords(group);
    const trie = new Trie();
    for (let i = arr.length - 1; i >= 0; i--) {
      trie.insert(arr[i]);
    }
    trieMap[group] = trie;
  }

  // Queue words for saving to localStorage
  function queueSaveWords(group = ""): void {
    pendingStorage.words.add(group);
    scheduleStorageSync();
  }

  // Queue patterns for saving to localStorage
  function queueSavePatterns(group = ""): void {
    pendingStorage.patterns.add(group);
    scheduleStorageSync();
  }

  let storageSyncTimer: number | null = null;

  // Schedule storage synchronization
  function scheduleStorageSync(): void {
    const config = getGroupConfig("");
    if (storageSyncTimer) clearTimeout(storageSyncTimer);
    storageSyncTimer = window.setTimeout(flushStorageSync, config.STORAGE_SYNC_DELAY);
  }

  // Flush pending storage operations
  function flushStorageSync(): void {
    pendingStorage.words.forEach((group) => {
      const { wordsKey } = getStorageKeys(group);
      const config = getGroupConfig(group);
      try {
        const arr = wordsCacheMap[group] || [];
        localStorage.setItem(wordsKey, JSON.stringify(arr.slice(0, config.MAX_WORDS)));
      } catch (e) {}
    });
    pendingStorage.patterns.forEach((group) => {
      const { patternsKey } = getStorageKeys(group);
      try {
        const obj = patternsCacheMap[group] || {};
        localStorage.setItem(patternsKey, JSON.stringify(obj));
      } catch (e) {}
    });
    pendingStorage.words.clear();
    pendingStorage.patterns.clear();
    storageSyncTimer = null;
  }

  // Save pattern with context and next word
  function savePattern(context: string, nextWord: string, group = ""): void {
    if (!context || !nextWord) return;
    
    if (!patternsCacheMap[group]) {
      loadPatterns(group);
    }
    
    const config = getGroupConfig(group);
    const patterns = patternsCacheMap[group];
    const key = context.toLowerCase().trim();
    const word = nextWord.toLowerCase().trim();

    if (!patterns[key]) {
      patterns[key] = {};
    }

    patterns[key][word] = (patterns[key][word] || 0) + 1;

    const entries = Object.entries(patterns[key]);

    if (entries.length > config.MAX_TOTAL) {
      entries.sort((a, b) => b[1] - a[1]);
      const top15 = entries.slice(0, config.MAX_TOTAL);
      const bufferZone = top15.slice(config.MAX_STABLE);
      const minFreqInBuffer = bufferZone.length > 0 ? bufferZone[bufferZone.length - 1][1] : 0;
      const stableWords = top15.slice(0, config.MAX_STABLE);
      const rebuilt = stableWords.concat(bufferZone);

      if (stableWords.some(([w, freq]) => freq > minFreqInBuffer)) {
        patterns[key] = Object.fromEntries(top15);
      } else {
        patterns[key] = Object.fromEntries(rebuilt);
      }
    }

    const keys = Object.keys(patterns);
    if (keys.length > config.MAX_PATTERNS) {
      const sortedKeys = keys.sort((a, b) => {
        const aSum = Object.values(patterns[a]).reduce((sum, count) => sum + count, 0);
        const bSum = Object.values(patterns[b]).reduce((sum, count) => sum + count, 0);
        return aSum - bSum;
      });

      const toRemove = Math.floor(config.MAX_PATTERNS * 0.2);
      for (let i = 0; i < toRemove; i++) {
        delete patterns[sortedKeys[i]];
      }
    }

    patternsCacheMap[group] = patterns;
    queueSavePatterns(group);
  }

  // Save word to cache and trie
  function saveWord(word: string, group = ""): void {
    word = (word || "").trim();
    if (!word) return;
    if (!wordsCacheMap[group]) loadWords(group);

    const config = getGroupConfig(group);
    const arr = wordsCacheMap[group];
    const lower = word.toLowerCase();
    let replacedIndex = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].toLowerCase() === lower) {
        replacedIndex = i;
        break;
      }
    }
    if (replacedIndex >= 0) arr.splice(replacedIndex, 1);
    arr.unshift(word);
    if (arr.length > config.MAX_WORDS) arr.length = config.MAX_WORDS;

    if (!trieMap[group]) rebuildTrieForGroup(group);
    trieMap[group].insert(word);

    queueSaveWords(group);
  }

  // Get context words from text at caret position
  function getContextWords(text: string, caretPos: number): string[] {
    const before = text.slice(0, caretPos);
    const words = before.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const contexts: string[] = [];
    if (words.length >= 1) contexts.push(words.slice(-1).join(' '));
    if (words.length >= 2) contexts.push(words.slice(-2).join(' '));
    if (words.length >= 3) contexts.push(words.slice(-3).join(' '));
    return contexts;
  }

  // Predict next words based on context patterns
  function predictNextWords(contexts: string[], group = ""): string[] {
    if (!patternsCacheMap[group]) loadPatterns(group);
    const config = getGroupConfig(group);
    const patterns = patternsCacheMap[group];
    const suggestions: { [key: string]: number } = Object.create(null);

    contexts.forEach((context, priority) => {
      const key = context.toLowerCase();
      const ctxObj = patterns[key];
      if (!ctxObj) return;
      for (const w in ctxObj) {
        if (!(w in ctxObj)) continue;
        const count = ctxObj[w] || 0;
        const weight = count * (3 - priority);
        suggestions[w] = (suggestions[w] || 0) + weight;
      }
    });

    const sorted = Object.entries(suggestions)
      .sort(([, a], [, b]) => b - a)
      .map(([word]) => word)
      .slice(0, config.MAX_SUGGESTIONS);

    return sorted;
  }

  // Analyze text incrementally for pattern learning
  function analyzeIncremental(element: HTMLElement, group = ""): void {
    try {
      const val = (element as HTMLInputElement | HTMLTextAreaElement).value || "";
      const words = val.split(/\s+/).filter(Boolean);
      const lastCount = elementWordCount.get(element) || 0;
      if (words.length <= lastCount) {
        elementWordCount.set(element, words.length);
        return;
      }
      
      for (let i = Math.max(1, lastCount); i < words.length; i++) {
        savePattern(words[i - 1], words[i], group);
        if (i >= 2) savePattern(words.slice(i - 2, i).join(' '), words[i], group);
        if (i >= 3) savePattern(words.slice(i - 3, i).join(' '), words[i], group);
      }
      elementWordCount.set(element, words.length);
    } catch (e) {
      elementWordCount.set(element, ((element as HTMLInputElement | HTMLTextAreaElement).value || "").split(/\s+/).filter(Boolean).length);
    }
  }

  // Create mirror element for caret position measurement
  function ensureMirror(): HTMLDivElement {
    if (mirror) return mirror;
    mirror = document.createElement("div");
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.top = "0";
    mirror.style.left = "-9999px";
    mirror.style.zIndex = "-1";
    document.body.appendChild(mirror);
    return mirror;
  }

  // Copy styles from source to target element
  function copyStyles(source: HTMLElement, target: HTMLElement): void {
    const cs = getComputedStyle(source);
    const props = [
      "boxSizing", "width", "height", "fontSize", "fontFamily", "fontWeight",
      "fontStyle", "letterSpacing", "textTransform", "textIndent",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "lineHeight", "wordSpacing", "whiteSpace", "verticalAlign", "textAlign",
      "direction", "unicodeBidi"
    ];
    props.forEach(p => { 
      try { 
        (target.style as any)[p] = (cs as any)[p]; 
      } catch (e) {} 
    });
    
    // Ensure exact same dimensions and positioning
    target.style.width = cs.width;
    target.style.height = cs.height;
    target.style.margin = "0";
    target.style.border = cs.border;
    target.style.padding = cs.padding;
    
    if (source.tagName.toLowerCase() === "input") {
      target.style.whiteSpace = "pre";
      target.style.overflow = "hidden";
      target.style.display = "block";
    }
  }

  // Get caret position in element
  function getCaretPosition(el: HTMLElement): number {
    try {
      return (el as HTMLInputElement | HTMLTextAreaElement).selectionStart || 0;
    } catch {
      return ((el as HTMLInputElement | HTMLTextAreaElement).value || "").length;
    }
  }

  // Get caret coordinates relative to viewport
  function getCaretCoords(el: HTMLElement, caretPos: number): CaretCoords {
    const m = ensureMirror();
    copyStyles(el, m);

    const value = (el as HTMLInputElement | HTMLTextAreaElement).value || "";
    const before = value.slice(0, caretPos);
    const after = value.slice(caretPos);

    function esc(s: string): string {
      return s.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    m.innerHTML = esc(before) +
      "<span id='__caret_marker__' style='display:inline-block; width:1px;'>​</span>" +
      esc(after || " ");

    const marker = document.getElementById("__caret_marker__");
    const elRect = el.getBoundingClientRect();

    if (!marker) {
      return { left: elRect.left + window.scrollX + 4, top: elRect.top + window.scrollY + elRect.height, height: elRect.height };
    }
    
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = m.getBoundingClientRect();

    // Account for input scrolling (horizontal)
    const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
    const scrollLeft = inputEl.scrollLeft || 0;
    const scrollTop = inputEl.scrollTop || 0;

    // Calculate relative position within the mirror (no padding/border adjustments)
    const relativeLeft = markerRect.left - mirrorRect.left;
    const relativeTop = markerRect.top - mirrorRect.top;

    // Calculate final position - use element's content area directly
    const left = elRect.left + window.scrollX + relativeLeft - scrollLeft;
    const top = elRect.top + window.scrollY + relativeTop - scrollTop;

    return { left, top, height: markerRect.height || elRect.height };
  }

  // Create ghost text element for inline preview
  function createGhost(): HTMLDivElement {
    if (ghost) return ghost;
    ghost = document.createElement("div");
    ghost.style.position = "absolute";
    ghost.style.pointerEvents = "none";
    ghost.style.fontFamily = "inherit";
    ghost.style.fontSize = "inherit";
    ghost.style.lineHeight = "inherit";
    ghost.style.color = "color-mix(in srgb, currentColor 35%, transparent)";
    ghost.style.whiteSpace = "pre";
    ghost.style.zIndex = "99998";
    ghost.style.userSelect = "none";
    ghost.style.overflow = "hidden";
    ghost.style.textOverflow = "clip";
    ghost.style.margin = "0";
    ghost.style.padding = "0";
    ghost.style.border = "none";
    ghost.style.background = "transparent";
    // Fallback for browsers that don't support color-mix
    ghost.style.setProperty("color", "rgba(128, 128, 128, 0.6)", "important");
    // Use CSS custom properties for better theme compatibility
    if (CSS.supports("color", "color-mix(in srgb, currentColor 35%, transparent)")) {
      ghost.style.setProperty("color", "color-mix(in srgb, currentColor 35%, transparent)", "important");
    }
    document.body.appendChild(ghost);
    return ghost;
  }

  // Create popup element for suggestions
  function createPopup(): HTMLDivElement {
    if (popup) return popup;
    popup = document.createElement("div");
    popup.className = "autocomplete-popup";
    popup.style.position = "absolute";
    popup.style.zIndex = "99999";
    popup.style.background = "light-dark(#ffffff, #2d2d2d)";
    popup.style.border = "1px solid light-dark(rgba(0,0,0,0.12), rgba(255,255,255,0.12))";
    popup.style.boxShadow = "0 6px 18px light-dark(rgba(0,0,0,0.12), rgba(0,0,0,0.4))";
    popup.style.borderRadius = "6px";
    popup.style.padding = "6px 8px";
    popup.style.fontSize = "13px";
    popup.style.cursor = "default";
    popup.style.userSelect = "none";
    popup.style.minWidth = "120px";
    popup.style.maxWidth = "300px";
    popup.style.backdropFilter = "blur(8px)";
    popup.style.setProperty("-webkit-backdrop-filter", "blur(8px)");
    popup.style.color = "light-dark(#000000, #ffffff)";
    popup.setAttribute('role', 'listbox');

    // Fallback for browsers that don't support light-dark()
    if (!CSS.supports("color", "light-dark(#ffffff, #2d2d2d)")) {
      // Check if user prefers dark mode
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      popup.style.background = prefersDark ? "#2d2d2d" : "#ffffff";
      popup.style.border = prefersDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,0,0,0.12)";
      popup.style.boxShadow = prefersDark ? "0 6px 18px rgba(0,0,0,0.4)" : "0 6px 18px rgba(0,0,0,0.12)";
      popup.style.color = prefersDark ? "#ffffff" : "#000000";
    }

    popup.addEventListener('mousedown', (ev) => {
      const target = ev.target as HTMLElement;
      const row = target.closest && target.closest('[data-sugg-index]') as HTMLElement;
      if (!row) return;
      ev.preventDefault();
      const idx = parseInt(row.dataset.suggIndex!, 10);
      if (!Number.isFinite(idx)) return;
      
      const activeEl = document.activeElement as HTMLElement;
      if (!activeEl || !elementStates.has(activeEl)) return;
        
      const state = elementStates.get(activeEl)!;
      state.selectedIndex = idx;
      acceptSuggestion(activeEl);
      try { activeEl.focus(); } catch {}
    }, true);

    popup.addEventListener('mouseover', (ev) => {
      const target = ev.target as HTMLElement;
      const row = target.closest && target.closest('[data-sugg-index]') as HTMLElement;
      if (!row) return;
      const idx = parseInt(row.dataset.suggIndex!, 10);
      if (!Number.isFinite(idx)) return;
      
      const activeEl = document.activeElement as HTMLElement;
      if (!activeEl || !elementStates.has(activeEl)) return;
      
      const state = elementStates.get(activeEl)!;
      state.selectedIndex = idx;
      updatePopupSelection(activeEl);
    }, true);

    document.body.appendChild(popup);
    return popup;
  }

  // Remove UI elements for specific element
  function removeUIForElement(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!state) return;
    
    if (ghost) ghost.style.display = "none";
    if (popup) popup.style.display = "none";
    state.suggestions = [];
    state.selectedIndex = 0;
  }

  // Find suggestions for token using trie
  function findSuggestionsForToken(token: string, group = ""): string[] {
    if (!token) return [];
    if (!trieMap[group]) loadWords(group);
    const config = getGroupConfig(group);
    const trie = trieMap[group];
    if (!trie) return [];
    const results = trie.search(token, config.MAX_SUGGESTIONS);
    const filtered = results.filter(w => w.toLowerCase() !== token.toLowerCase());
    return filtered.slice(0, config.MAX_SUGGESTIONS);
  }

  // Schedule UI update for specific element
  function scheduleUIUpdate(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!state) return;
    
    const config = getGroupConfig(state.group);
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => {
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(() => {
        state.rafId = null;
        updateUI(element);
      });
    }, config.DEBOUNCE_DELAY);
  }

  let lastPopupPos = { left: -1, top: -1 };

  // Main UI update function for specific element
  function updateUI(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!state) return;
    
    const pos = getCaretPosition(element);
    const vb = getWordBoundsAtCaret((element as HTMLInputElement | HTMLTextAreaElement).value, pos);
    const token = vb.word;
    const config = getGroupConfig(state.group);

    let suggestions: string[] = [];
    let suggestionType = "";

    if (token) {
      suggestions = findSuggestionsForToken(token, state.group);
      if (suggestions.length > 0) suggestionType = "completion";
    } else {
      const contexts = getContextWords((element as HTMLInputElement | HTMLTextAreaElement).value, pos);
      const predicted = predictNextWords(contexts, state.group);
      if (predicted.length > 0) {
        suggestions = predicted;
        suggestionType = "prediction";
      }
    }

    if (suggestions.length === 0) {
      state.suggestions = [];
      state.selectedIndex = 0;
      if (ghost) ghost.style.display = "none";
      if (popup) popup.style.display = "none";
      return;
    }

    const prevSuggestions = state.suggestions.join('|');
    state.suggestions = suggestions.slice(0, config.MAX_SUGGESTIONS);
    if (state.suggestions.join('|') !== prevSuggestions) state.selectedIndex = 0;

    const primarySuggestion = state.suggestions[0];
    const appended = suggestionType === "completion"
      ? primarySuggestion.slice(token.length)
      : primarySuggestion;

    const coords = getCaretCoords(element, pos);

    const g = createGhost();
    g.style.display = "block";
    const cs = getComputedStyle(element);
    
    // Copy exact font properties for perfect alignment
    g.style.fontFamily = cs.fontFamily;
    g.style.fontSize = cs.fontSize;
    g.style.fontWeight = cs.fontWeight;
    g.style.fontStyle = cs.fontStyle;
    g.style.lineHeight = cs.lineHeight;
    g.style.letterSpacing = cs.letterSpacing;
    g.style.wordSpacing = cs.wordSpacing;
    g.style.textTransform = cs.textTransform;
    
    g.style.left = `${coords.left}px`;
    g.style.top = `${coords.top}px`;
    g.textContent = appended;

    const p = createPopup();
    p.style.display = "block";

    const existingRows = Array.from(p.querySelectorAll('[data-sugg-index]'));
    let needsRebuild = false;
    if (existingRows.length !== state.suggestions.length) needsRebuild = true;
    else {
      for (let i = 0; i < existingRows.length; i++) {
        if (existingRows[i].textContent !== state.suggestions[i]) { 
          needsRebuild = true; 
          break; 
        }
      }
    }

    if (needsRebuild) {
      p.innerHTML = '';
      
      if (config.classes && config.classes.popupContainer) {
        p.className = config.classes.popupContainer;
      } else {
        p.className = '';
      }
      
      const frag = document.createDocumentFragment();
      state.suggestions.forEach((suggestion, index) => {
        const row = document.createElement('div');
        row.textContent = suggestion;
        row.setAttribute('data-sugg-index', String(index));
        row.style.padding = "4px 6px";
        row.style.borderRadius = "4px";
        row.style.cursor = "pointer";
        row.style.whiteSpace = "nowrap";
        
        if (config.classes && config.classes.popupRow) {
          row.className = config.classes.popupRow;
        }
        
        frag.appendChild(row);
      });

      const hint = document.createElement('div');
      const typeLabel = suggestionType === "prediction" ? "AI prediction" : "completion";
      const navHint = state.suggestions.length > 1 ? " • ↑↓ to navigate" : "";
      hint.textContent = `${typeLabel} • Tab / → to accept${navHint}`;
      hint.style.fontSize = "11px";
      hint.style.color = "rgba(0,0,0,0.5)";
      hint.style.marginTop = "6px";
      
      if (config.classes && config.classes.popupHint) {
        hint.className = config.classes.popupHint;
      }
      
      frag.appendChild(hint);
      p.appendChild(frag);
    }

    updatePopupSelection(element);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    // Get popup dimensions (force layout if needed)
    p.style.visibility = "hidden";
    p.style.display = "block";
    const popupRect = p.getBoundingClientRect();
    const popupWidth = popupRect.width || Math.min(300, Math.max(120, p.offsetWidth));
    const popupHeight = popupRect.height || 140;
    p.style.visibility = "";

    let popupLeft = coords.left;
    let popupTop = coords.top + coords.height + 6;

    const elRect = element.getBoundingClientRect();
    const inputLeft = elRect.left + scrollX;
    const inputRight = inputLeft + elRect.width;
    const inputTop = elRect.top + scrollY;
    const inputBottom = inputTop + elRect.height;
    
    // Horizontal positioning - prefer alignment with input start, but keep within bounds
    popupLeft = Math.max(inputLeft, popupLeft);
    
    // If popup extends beyond input right edge, align to right edge
    if (popupLeft + popupWidth > inputRight) {
      popupLeft = Math.max(inputLeft, inputRight - popupWidth);
    }
    
    // Ensure popup stays within viewport with margins
    const marginLeft = 10;
    const marginRight = 10;
    if (popupLeft + popupWidth > viewportWidth + scrollX - marginRight) {
      popupLeft = viewportWidth + scrollX - popupWidth - marginRight;
    }
    if (popupLeft < scrollX + marginLeft) {
      popupLeft = scrollX + marginLeft;
    }

    // Vertical positioning - try below first, then above if no space
    const spaceBelow = (viewportHeight + scrollY) - (coords.top + coords.height);
    const spaceAbove = coords.top - scrollY;
    const preferredGap = 6;
    
    if (spaceBelow >= popupHeight + preferredGap) {
      // Show below
      popupTop = coords.top + coords.height + preferredGap;
    } else if (spaceAbove >= popupHeight + preferredGap) {
      // Show above
      popupTop = coords.top - popupHeight - preferredGap;
    } else {
      // Show in direction with more space, adjust height if needed
      if (spaceBelow > spaceAbove) {
        popupTop = coords.top + coords.height + preferredGap;
        const maxHeight = spaceBelow - preferredGap - 10;
        if (popupHeight > maxHeight) {
          p.style.maxHeight = `${maxHeight}px`;
          p.style.overflowY = "auto";
        }
      } else {
        const maxHeight = spaceAbove - preferredGap - 10;
        popupTop = coords.top - Math.min(popupHeight, maxHeight) - preferredGap;
        if (popupHeight > maxHeight) {
          p.style.maxHeight = `${maxHeight}px`;
          p.style.overflowY = "auto";
        }
      }
    }

    // Apply positioning only if changed to avoid unnecessary reflows
    if (lastPopupPos.left !== popupLeft || lastPopupPos.top !== popupTop) {
      p.style.left = `${popupLeft}px`;
      p.style.top = `${popupTop}px`;
      lastPopupPos.left = popupLeft;
      lastPopupPos.top = popupTop;
    }
  }

  // Update popup selection highlighting
  function updatePopupSelection(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!popup || !state || state.suggestions.length === 0) return;
    
    const config = getGroupConfig(state.group);
    const rows = Array.from(popup.querySelectorAll('[data-sugg-index]'));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLElement;
      if (i === state.selectedIndex) {
        // Use CSS custom properties for better theme compatibility
        row.style.background = "light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.12))";
        row.style.setProperty("background", "light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.12))", "important");
        
        // Fallback for browsers without light-dark support
        if (!CSS.supports("color", "light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.12))")) {
          const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          row.style.background = prefersDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
        }
        
        if (config.classes && config.classes.popupRowSelected) {
          row.classList.add(config.classes.popupRowSelected);
        }
      } else {
        row.style.background = "transparent";
        if (config.classes && config.classes.popupRowSelected) {
          row.classList.remove(config.classes.popupRowSelected);
        }
      }
    }

    if (ghost && state.suggestions[state.selectedIndex]) {
      const pos = getCaretPosition(element);
      const vb = getWordBoundsAtCaret((element as HTMLInputElement | HTMLTextAreaElement).value, pos);
      const token = vb.word;
      const selectedSuggestion = state.suggestions[state.selectedIndex];
      const appended = token && selectedSuggestion.toLowerCase().startsWith((token || '').toLowerCase())
        ? selectedSuggestion.slice(token.length)
        : selectedSuggestion;
      ghost.textContent = appended;
    }
  }

  // Get word boundaries at caret position
  function getWordBoundsAtCaret(text: string, caretIndex: number): WordBounds {
    if (!text) return { start: 0, end: 0, word: "" };
    let start = caretIndex;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    let end = caretIndex;
    while (end < text.length && !/\s/.test(text[end])) end++;
    return { start, end, word: text.slice(start, end) };
  }

  // Scroll element to ensure caret is visible
  function scrollToCaretPosition(element: HTMLElement): void {
    const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
    const caretPos = getCaretPosition(element);
    
    // For textarea elements, we need to scroll to make the caret visible
    if (inputEl.tagName === 'TEXTAREA') {
      // Create a temporary element to measure text dimensions
      const temp = document.createElement('div');
      temp.style.position = 'absolute';
      temp.style.visibility = 'hidden';
      temp.style.whiteSpace = 'pre-wrap';
      temp.style.wordWrap = 'break-word';
      temp.style.fontFamily = getComputedStyle(inputEl).fontFamily;
      temp.style.fontSize = getComputedStyle(inputEl).fontSize;
      temp.style.lineHeight = getComputedStyle(inputEl).lineHeight;
      temp.style.width = inputEl.clientWidth + 'px';
      
      document.body.appendChild(temp);
      
      // Get text up to caret position
      const textUpToCaret = inputEl.value.substring(0, caretPos);
      temp.textContent = textUpToCaret;
      
      // Calculate which line the caret is on
      const lineHeight = parseInt(getComputedStyle(inputEl).lineHeight) || parseInt(getComputedStyle(inputEl).fontSize);
      const caretTop = temp.offsetHeight;
      
      document.body.removeChild(temp);
      
      // Scroll to ensure caret line is visible
      const scrollTop = inputEl.scrollTop;
      const clientHeight = inputEl.clientHeight;
      
      if (caretTop < scrollTop) {
        // Caret is above visible area
        inputEl.scrollTop = Math.max(0, caretTop - lineHeight);
      } else if (caretTop > scrollTop + clientHeight - lineHeight) {
        // Caret is below visible area
        inputEl.scrollTop = caretTop - clientHeight + lineHeight;
      }
    } else {
      // For input elements, scroll horizontally to caret
      const textUpToCaret = inputEl.value.substring(0, caretPos);
      
      // Create temporary span to measure text width
      const temp = document.createElement('span');
      temp.style.position = 'absolute';
      temp.style.visibility = 'hidden';
      temp.style.fontFamily = getComputedStyle(inputEl).fontFamily;
      temp.style.fontSize = getComputedStyle(inputEl).fontSize;
      temp.style.whiteSpace = 'pre';
      temp.textContent = textUpToCaret;
      
      document.body.appendChild(temp);
      const caretLeft = temp.offsetWidth;
      document.body.removeChild(temp);
      
      // Scroll horizontally to ensure caret is visible
      const scrollLeft = inputEl.scrollLeft;
      const clientWidth = inputEl.clientWidth;
      
      if (caretLeft < scrollLeft) {
        // Caret is to the left of visible area
        inputEl.scrollLeft = Math.max(0, caretLeft - 20);
      } else if (caretLeft > scrollLeft + clientWidth - 20) {
        // Caret is to the right of visible area
        inputEl.scrollLeft = caretLeft - clientWidth + 40;
      }
    }
  }

  // Replace current token with selected suggestion
  function replaceTokenWithSuggestion(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!state || state.suggestions.length === 0) return;
    
    const currentSuggestion = state.suggestions[state.selectedIndex];
    const pos = getCaretPosition(element);
    const vb = getWordBoundsAtCaret((element as HTMLInputElement | HTMLTextAreaElement).value, pos);
    const inputEl = element as HTMLInputElement | HTMLTextAreaElement;

    let before: string, after: string, rebuilt: string, newCaret: number;

    if (vb.word) {
      before = inputEl.value.slice(0, vb.start);
      after = inputEl.value.slice(vb.end);
      rebuilt = before + currentSuggestion + after;
      newCaret = vb.start + currentSuggestion.length;
    } else {
      before = inputEl.value.slice(0, pos);
      after = inputEl.value.slice(pos);
      const needsSpace = before.length > 0 && !/\s$/.test(before);
      rebuilt = before + (needsSpace ? ' ' : '') + currentSuggestion + after;
      newCaret = before.length + (needsSpace ? 1 : 0) + currentSuggestion.length;
    }

    inputEl.value = rebuilt;
    try { inputEl.setSelectionRange(newCaret, newCaret); } catch {}
    
    // Auto-scroll to ensure the caret is visible after accepting suggestion
    scrollToCaretPosition(element);
    
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    saveWord(currentSuggestion, state.group);
    elementWordCount.set(element, (inputEl.value || "").split(/\s+/).filter(Boolean).length);
  }

  // Accept current suggestion
  function acceptSuggestion(element: HTMLElement): void {
    replaceTokenWithSuggestion(element);
    const state = elementStates.get(element);
    if (state) {
      state.suggestions = [];
      state.selectedIndex = 0;
    }
    removeUIForElement(element);
    try { element.focus(); } catch {}
  }

  // Handle focus event on autocomplete elements
  function onFocus(e: Event): void {
    const target = e.target as HTMLElement;
    if (!target || !target.dataset || target.dataset.autocomplete === undefined) return;
    
    const group = parseElementConfig(target);
    
    // Initialize state for this element
    if (!elementStates.has(target)) {
      elementStates.set(target, {
        group,
        suggestions: [],
        selectedIndex: 0,
        isComposing: false,
        debounceTimer: null,
        rafId: null
      });
    } else {
      const state = elementStates.get(target)!;
      state.group = group; // Update group in case it changed
    }

    try {
      const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
      inputEl.setAttribute("autocomplete", "off");
      inputEl.setAttribute("spellcheck", "false");
      inputEl.setAttribute("autocorrect", "off");
    } catch (err) {}

    loadWords(group);
    loadPatterns(group);

    elementWordCount.set(target, ((target as HTMLInputElement | HTMLTextAreaElement).value || "").split(/\s+/).filter(Boolean).length);

    scheduleUIUpdate(target);
  }

  // Handle input event
  function onInput(e: Event): void {
    const target = e.target as HTMLElement;
    const state = elementStates.get(target);
    if (!state || state.isComposing) return;
    
    scheduleUIUpdate(target);
  }

  // Handle keydown events for navigation and acceptance
  function onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const state = elementStates.get(target);
    if (!state || state.isComposing) return;

    if (state.suggestions.length > 1) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.selectedIndex = (state.selectedIndex + 1) % state.suggestions.length;
        updatePopupSelection(target);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        state.selectedIndex = state.selectedIndex === 0 ? state.suggestions.length - 1 : state.selectedIndex - 1;
        updatePopupSelection(target);
        return;
      }
    }

    if ((e.key === "Tab" || e.key === "ArrowRight") && state.suggestions.length > 0) {
      e.preventDefault();
      acceptSuggestion(target);
      return;
    }

    if (e.key === " " || e.key === "Enter") {
      const pos = getCaretPosition(target);
      const vb = getWordBoundsAtCaret((target as HTMLInputElement | HTMLTextAreaElement).value, pos);
      const w = vb.word && vb.word.trim();
      if (w) saveWord(w, state.group);

      analyzeIncremental(target, state.group);

      state.suggestions = [];
      state.selectedIndex = 0;
      removeUIForElement(target);
      return;
    }

    if (e.key === "Escape") {
      state.suggestions = [];
      state.selectedIndex = 0;
      removeUIForElement(target);
      return;
    }
  }

  // Handle blur event
  function onBlur(e: Event): void {
    const target = e.target as HTMLElement;
    if (!target || !target.dataset || target.dataset.autocomplete === undefined) return;
    
    setTimeout(() => {
      try {
        const pos = getCaretPosition(target);
        const vb = getWordBoundsAtCaret((target as HTMLInputElement | HTMLTextAreaElement).value, pos);
        const w = vb.word && vb.word.trim();
        const group = parseElementConfig(target);
        if (w) saveWord(w, group);
        analyzeIncremental(target, group);
      } catch (err) {}
      
      const state = elementStates.get(target);
      if (state) {
        state.suggestions = [];
        state.selectedIndex = 0;
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        if (state.rafId) cancelAnimationFrame(state.rafId);
      }
      removeUIForElement(target);
    }, 150);
  }

  // Handle composition start
  function onCompositionStart(e: Event): void {
    const target = e.target as HTMLElement;
    const state = elementStates.get(target);
    if (state) state.isComposing = true;
  }

  // Handle composition end
  function onCompositionEnd(e: Event): void {
    const target = e.target as HTMLElement;
    const state = elementStates.get(target);
    if (state) {
      state.isComposing = false;
      scheduleUIUpdate(target);
    }
  }

  // Handle document clicks to close popup
  function onDocClick(e: Event): void {
    if (!popup) return;
    const target = e.target as HTMLElement;
    
    // Find if click is on an autocomplete element
    let autocompleteEl: HTMLElement | null = null;
    if (target.dataset && target.dataset.autocomplete !== undefined) {
      autocompleteEl = target;
    } else {
      autocompleteEl = target.closest('[data-autocomplete]') as HTMLElement;
    }
    
    if (autocompleteEl && elementStates.has(autocompleteEl)) return;
    if (popup.contains(target)) return;
    
    // Clear all element states
    elementStates.forEach((state, element) => {
      state.suggestions = [];
      state.selectedIndex = 0;
      removeUIForElement(element);
    });
  }

  // Attach event listeners
  document.addEventListener("focusin", onFocus, true);
  document.addEventListener("input", onInput, { capture: true, passive: true });
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("blur", onBlur, true);
  document.addEventListener("compositionstart", onCompositionStart, true);
  document.addEventListener("compositionend", onCompositionEnd, true);
  document.addEventListener("click", onDocClick, true);

  // Inject minimal styles
  const style = document.createElement("style");
  style.textContent = `
    /* Autocomplete input styling */
    input[data-autocomplete], textarea[data-autocomplete] {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }
    
    /* Popup suggestion row styling */
    [data-sugg-index] { 
      padding: 6px 8px; 
      border-radius: 4px; 
      cursor: pointer; 
      white-space: nowrap; 
      transition: background-color 0.15s ease;
      color: inherit;
    }
    
    /* Hover effect for suggestion rows */
    [data-sugg-index]:hover {
      background-color: light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.08)) !important;
    }
    
    /* Theme-aware scrollbar for popup */
    .autocomplete-popup {
      scrollbar-width: thin;
      scrollbar-color: light-dark(rgba(0,0,0,0.2), rgba(255,255,255,0.2)) transparent;
    }
    
    .autocomplete-popup::-webkit-scrollbar {
      width: 6px;
    }
    
    .autocomplete-popup::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .autocomplete-popup::-webkit-scrollbar-thumb {
      background-color: light-dark(rgba(0,0,0,0.2), rgba(255,255,255,0.2));
      border-radius: 3px;
    }
    
    .autocomplete-popup::-webkit-scrollbar-thumb:hover {
      background-color: light-dark(rgba(0,0,0,0.3), rgba(255,255,255,0.3));
    }
    
    /* Fallback for browsers without light-dark support */
    @media (prefers-color-scheme: dark) {
      [data-sugg-index]:hover {
        background-color: rgba(255,255,255,0.08) !important;
      }
      
      .autocomplete-popup {
        scrollbar-color: rgba(255,255,255,0.2) transparent;
      }
      
      .autocomplete-popup::-webkit-scrollbar-thumb {
        background-color: rgba(255,255,255,0.2);
      }
      
      .autocomplete-popup::-webkit-scrollbar-thumb:hover {
        background-color: rgba(255,255,255,0.3);
      }
    }
    
    @media (prefers-color-scheme: light) {
      [data-sugg-index]:hover {
        background-color: rgba(0,0,0,0.05) !important;
      }
      
      .autocomplete-popup {
        scrollbar-color: rgba(0,0,0,0.2) transparent;
      }
      
      .autocomplete-popup::-webkit-scrollbar-thumb {
        background-color: rgba(0,0,0,0.2);
      }
      
      .autocomplete-popup::-webkit-scrollbar-thumb:hover {
        background-color: rgba(0,0,0,0.3);
      }
    }
  `;
  document.head.appendChild(style);

  // Cleanup and maintenance
  function idleCleanup(): void {
    for (const group in wordsCacheMap) {
      if (!(group in wordsCacheMap)) continue;
      const config = getGroupConfig(group);
      const arr = wordsCacheMap[group];
      if (arr && arr.length > config.MAX_WORDS) wordsCacheMap[group] = arr.slice(0, config.MAX_WORDS);
    }
    for (const group in patternsCacheMap) {
      if (!(group in patternsCacheMap)) continue;
      const config = getGroupConfig(group);
      const patterns = patternsCacheMap[group];
      for (const key in patterns) {
        if (!(key in patterns)) continue;
        const entries = Object.entries(patterns[key]);
        if (entries.length > config.MAX_TOTAL) {
          entries.sort((a, b) => b[1] - a[1]);
          patterns[key] = Object.fromEntries(entries.slice(0, config.MAX_TOTAL));
        }
      }
    }
    for (const group in wordsCacheMap) {
      if (!trieMap[group]) rebuildTrieForGroup(group);
    }
    flushStorageSync();
  }

  if ('requestIdleCallback' in window) {
    setInterval(() => {
      requestIdleCallback(() => idleCleanup());
    }, DEFAULT_CONFIG.IDLE_CLEANUP_DELAY);
  } else {
    setInterval(idleCleanup, DEFAULT_CONFIG.IDLE_CLEANUP_DELAY * 2);
  }

  // Public API
  const GhostComplete = {
    // Initialize autocomplete on a specific element
    init: function(element: HTMLElement | string, group = "default") {
      const el = typeof element === 'string' ? document.querySelector(element) as HTMLElement : element;
      if (!el) return false;
      
      // Set the data attribute for autocomplete
      el.setAttribute('data-autocomplete', group);
      
      // Initialize the element if it's not already initialized
      if (!elementStates.has(el)) {
        // Trigger focus to initialize
        const currentFocus = document.activeElement;
        el.focus();
        if (currentFocus && currentFocus !== el) {
          (currentFocus as HTMLElement).focus();
        }
      }
      
      return true;
    },
    
    // Initialize autocomplete on all input/textarea elements
    initAll: function(group = "default") {
      const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="url"], input:not([type]), textarea');
      let count = 0;
      
      inputs.forEach(input => {
        if (this.init(input as HTMLElement, group)) {
          count++;
        }
      });
      
      return count;
    },
    
    setGroupConfig: function(group = "", params: Partial<AutocompleteConfig> = {}, classes: any = {}) {
      updateGroupConfig(group, params, classes);
    },
    getGroupConfig: function(group = "") {
      return getGroupConfig(group);
    },
    clearWords: function (group = "") {
      const { wordsKey } = getStorageKeys(group);
      localStorage.removeItem(wordsKey);
      wordsCacheMap[group] = [];
      trieMap[group] = new Trie();
    },
    clearPatterns: function (group = "") {
      const { patternsKey } = getStorageKeys(group);
      localStorage.removeItem(patternsKey);
      patternsCacheMap[group] = {};
    },
    clearAll: function (group = "") {
      this.clearWords(group);
      this.clearPatterns(group);
    },
    listWords: function (group = "") {
      return loadWords(group);
    },
    listPatterns: function (group = "") {
      return loadPatterns(group);
    },
    getStats: function (group = "") {
      const patterns = loadPatterns(group);
      const words = loadWords(group);
      return {
        totalWords: words.length,
        totalPatterns: Object.keys(patterns).length,
        totalAssociations: Object.values(patterns)
          .reduce((sum, p) => sum + Object.keys(p).length, 0)
      };
    },
    
    // Version info
    version: "2.0.0"
  };

  // Expose the API globally
  (window as any).GhostComplete = GhostComplete;
  (window as any).__customAutocomplete = GhostComplete; // Keep backward compatibility

  // Export for module systems
  try {
    if (typeof (globalThis as any).module !== 'undefined' && (globalThis as any).module.exports) {
      (globalThis as any).module.exports = GhostComplete;
    }
  } catch (e) {
    // Ignore module export errors in browser environment
  }
  
  // Export for ES modules and AMD
  if (typeof window !== 'undefined' && (window as any).define && (window as any).define.amd) {
    (window as any).define('ghostcomplete', [], function() {
      return GhostComplete;
    });
  }

})();