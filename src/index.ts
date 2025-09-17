// Enhanced TypeScript autocomplete with improved design and efficiency
(function () {
  'use strict';

  interface AutocompleteConfig {
    MAX_WORDS: number;
    MAX_SUGGESTIONS: number;
    MAX_STABLE: number;
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

  interface WordEntry {
    lastUsed: number;
    frequency: number;
  }

  interface PendingStorage {
    words: Set<string>;
  }

  const DEFAULT_CONFIG: AutocompleteConfig = {
    MAX_WORDS: 300,
    MAX_SUGGESTIONS: 5,
    MAX_STABLE: 100,
    DEBOUNCE_DELAY: 160,
    STORAGE_SYNC_DELAY: 600,
    IDLE_CLEANUP_DELAY: 2000
  };

  let globalConfig = { ...DEFAULT_CONFIG };
  const groupConfigs: { [key: string]: AutocompleteConfig } = Object.create(null);

  function getGroupConfig(group = ""): AutocompleteConfig {
    return group ? (groupConfigs[group] || globalConfig) : globalConfig;
  }

  function updateGroupConfig(group = "", params: Partial<AutocompleteConfig> = {}, classes: any = {}): void {
    const target = group ? (groupConfigs[group] = groupConfigs[group] || { ...globalConfig }) : globalConfig;
    Object.assign(target, params);
    if (classes) target.classes = { ...target.classes, ...classes };
    if (!group) {
      // Update global config affects all groups without explicit config
      for (const g in groupConfigs) {
        if (groupConfigs[g] === globalConfig) {
          groupConfigs[g] = { ...globalConfig };
        }
      }
    }
  }

  function parseElementConfig(element: HTMLElement): string {
    const group = element.dataset.autocomplete || "";
    let params: any = {}, classes: any = {};
    
    try {
      if (element.dataset.autocompleteParams) params = JSON.parse(element.dataset.autocompleteParams);
      if (element.dataset.autocompleteClasses) classes = JSON.parse(element.dataset.autocompleteClasses);
    } catch (e) {}
    
    if (Object.keys(params).length > 0 || Object.keys(classes).length > 0) {
      updateGroupConfig(group, params, classes);
    }
    
    return group;
  }

  let ghost: HTMLDivElement | null = null;
  let popup: HTMLDivElement | null = null;
  let mirror: HTMLDivElement | null = null;

  const elementStates = new Map<HTMLElement, {
    group: string;
    suggestions: string[];
    selectedIndex: number;
    isComposing: boolean;
    debounceTimer: number | null;
    rafId: number | null;
  }>();

  const wordsCacheMap: { [key: string]: { words: string[], entries: { [word: string]: WordEntry } } } = Object.create(null);
  const trieMap: { [key: string]: Trie } = Object.create(null);
  const pendingStorage: PendingStorage = { words: new Set() };
  const elementWordCount = new WeakMap<HTMLElement, number>();

  function getStorageKeys(group: string) {
    const base = group ? `_${group}` : "";
    return {
      wordsKey: `ac_w${base}_v3`,
    };
  }

  class TrieNode {
    children: { [key: string]: TrieNode } = Object.create(null);
    isWord = false;
  }

  class Trie {
    root = new TrieNode();

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

    search(prefix: string, limit = 5): string[] {
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
        this._collect(node.children[ch], prefix + ch, acc, limit);
        if (acc.length >= limit) return;
      }
    }
  }

  function loadWords(group = ""): string[] {
    const cacheKey = group || "default";
    if (wordsCacheMap[cacheKey]) return wordsCacheMap[cacheKey].words.slice();
    
    const { wordsKey } = getStorageKeys(group);
    const config = getGroupConfig(group);
    
    try {
      const raw = localStorage.getItem(wordsKey);
      const data = raw ? JSON.parse(raw) : { words: [], entries: {} };
      
      // Ensure we have the right structure
      if (Array.isArray(data)) {
        // Migrate old format
        wordsCacheMap[cacheKey] = {
          words: data.slice(0, config.MAX_WORDS),
          entries: {}
        };
      } else {
        wordsCacheMap[cacheKey] = {
          words: (data.words || []).slice(0, config.MAX_WORDS),
          entries: data.entries || {}
        };
      }
      
      rebuildTrieForGroup(group);
      return wordsCacheMap[cacheKey].words.slice();
    } catch (e) {
      wordsCacheMap[cacheKey] = { words: [], entries: {} };
      trieMap[cacheKey] = new Trie();
      return [];
    }
  }

  function rebuildTrieForGroup(group = ""): void {
    const cacheKey = group || "default";
    const words = wordsCacheMap[cacheKey]?.words || loadWords(group);
    const trie = new Trie();
    for (let i = words.length - 1; i >= 0; i--) {
      trie.insert(words[i]);
    }
    trieMap[cacheKey] = trie;
  }

  function queueSaveWords(group = ""): void {
    pendingStorage.words.add(group);
    scheduleStorageSync();
  }

  let storageSyncTimer: number | null = null;

  function scheduleStorageSync(): void {
    const config = getGroupConfig("");
    if (storageSyncTimer) clearTimeout(storageSyncTimer);
    storageSyncTimer = window.setTimeout(flushStorageSync, config.STORAGE_SYNC_DELAY);
  }

  function flushStorageSync(): void {
    pendingStorage.words.forEach((group) => {
      const { wordsKey } = getStorageKeys(group);
      const config = getGroupConfig(group);
      const cacheKey = group || "default";
      try {
        const cache = wordsCacheMap[cacheKey];
        if (cache) {
          localStorage.setItem(wordsKey, JSON.stringify({
            words: cache.words.slice(0, config.MAX_WORDS),
            entries: cache.entries
          }));
        }
      } catch (e) {}
    });
    pendingStorage.words.clear();
    storageSyncTimer = null;
  }

  function saveWord(word: string, group = ""): void {
    word = (word || "").trim();
    if (!word || word.length < 3) return; // Enforce minimum 3 characters
    
    const cacheKey = group || "default";
    if (!wordsCacheMap[cacheKey]) loadWords(group);

    const config = getGroupConfig(group);
    const cache = wordsCacheMap[cacheKey];
    const lower = word.toLowerCase();
    const now = Date.now();
    
    // Update or create entry
    if (!cache.entries[lower]) {
      cache.entries[lower] = { lastUsed: now, frequency: 1 };
    } else {
      cache.entries[lower].lastUsed = now;
      cache.entries[lower].frequency++;
    }
    
    // Remove if already exists in words array
    let replacedIndex = -1;
    for (let i = 0; i < cache.words.length; i++) {
      if (cache.words[i].toLowerCase() === lower) {
        replacedIndex = i;
        break;
      }
    }
    if (replacedIndex >= 0) cache.words.splice(replacedIndex, 1);
    
    // Add to front
    cache.words.unshift(word);
    
    // Manage size with stable/buffer approach
    if (cache.words.length > config.MAX_WORDS) {
      // Keep most stable (frequent) words
      const wordsWithScore = cache.words.map(w => ({
        word: w,
        entry: cache.entries[w.toLowerCase()] || { lastUsed: 0, frequency: 0 },
        score: (cache.entries[w.toLowerCase()]?.frequency || 0) * 
               Math.max(0.1, 1 - (now - (cache.entries[w.toLowerCase()]?.lastUsed || 0)) / (7 * 24 * 60 * 60 * 1000))
      }));
      
      wordsWithScore.sort((a, b) => b.score - a.score);
      const kept = wordsWithScore.slice(0, config.MAX_STABLE);
      cache.words = kept.map(item => item.word);
      
      // Clean up entries for removed words
      const keptWords = new Set(cache.words.map(w => w.toLowerCase()));
      for (const key in cache.entries) {
        if (!keptWords.has(key)) {
          delete cache.entries[key];
        }
      }
    }

    if (!trieMap[cacheKey]) rebuildTrieForGroup(group);
    trieMap[cacheKey].insert(word);

    queueSaveWords(group);
  }  function analyzeIncremental(element: HTMLElement, group = ""): void {
    // Removed pattern analysis - only word-based autocomplete now
    try {
      const val = (element as HTMLInputElement | HTMLTextAreaElement).value || "";
      const words = val.split(/\s+/).filter(Boolean);
      elementWordCount.set(element, words.length);
    } catch (e) {
      elementWordCount.set(element, 0);
    }
  }

  function ensureMirror(): HTMLDivElement {
    if (mirror) return mirror;
    mirror = document.createElement("div");
    mirror.style.cssText = "position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;top:0;left:-9999px;z-index:-1";
    document.body.appendChild(mirror);
    return mirror;
  }

  function copyStyles(source: HTMLElement, target: HTMLElement): void {
    const cs = getComputedStyle(source);
    const props = ["boxSizing","width","height","fontSize","fontFamily","fontWeight","fontStyle","letterSpacing","textTransform","textIndent","paddingTop","paddingRight","paddingBottom","paddingLeft","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","lineHeight","wordSpacing","whiteSpace","verticalAlign","textAlign","direction","unicodeBidi"];
    props.forEach(p => { 
      try { 
        (target.style as any)[p] = (cs as any)[p]; 
      } catch (e) {} 
    });
    
    target.style.cssText += `width:${cs.width};height:${cs.height};margin:0;border:${cs.border};padding:${cs.padding}`;
    
    if (source.tagName.toLowerCase() === "input") {
      target.style.cssText += "white-space:pre;overflow:hidden;display:block";
    }
  }

  function getCaretPosition(el: HTMLElement): number {
    try {
      return (el as HTMLInputElement | HTMLTextAreaElement).selectionStart || 0;
    } catch {
      return ((el as HTMLInputElement | HTMLTextAreaElement).value || "").length;
    }
  }

  function getCaretCoords(el: HTMLElement, caretPos: number): CaretCoords {
    const m = ensureMirror();
    copyStyles(el, m);

    const value = (el as HTMLInputElement | HTMLTextAreaElement).value || "";
    const before = value.slice(0, caretPos);

    const esc = (s: string): string => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    m.innerHTML = esc(before) + "<span id='__caret_marker__' style='display:inline-block;width:1px;'>​</span>" + esc(value.slice(caretPos) || " ");

    const marker = document.getElementById("__caret_marker__");
    const elRect = el.getBoundingClientRect();

    if (!marker) {
      return { left: elRect.left + window.scrollX + 4, top: elRect.top + window.scrollY + elRect.height, height: elRect.height };
    }
    
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = m.getBoundingClientRect();
    const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
    const scrollLeft = inputEl.scrollLeft || 0;
    const scrollTop = inputEl.scrollTop || 0;

    const relativeLeft = markerRect.left - mirrorRect.left;
    const relativeTop = markerRect.top - mirrorRect.top;
    const left = elRect.left + window.scrollX + relativeLeft - scrollLeft;
    const top = elRect.top + window.scrollY + relativeTop - scrollTop;

    return { left, top, height: markerRect.height || elRect.height };
  }

  function createGhost(): HTMLDivElement {
    if (ghost) return ghost;
    ghost = document.createElement("div");
    ghost.style.cssText = "position:absolute;pointer-events:none;font-family:inherit;font-size:inherit;line-height:inherit;color:color-mix(in srgb, currentColor 35%, transparent);white-space:pre;z-index:99998;user-select:none;overflow:hidden;text-overflow:clip;margin:0;padding:0;border:none;background:transparent";
    
    // Fallback for browsers without color-mix support
    if (!CSS.supports("color", "color-mix(in srgb, currentColor 35%, transparent)")) {
      ghost.style.color = "rgba(128,128,128,0.6)";
    }
    
    document.body.appendChild(ghost);
    return ghost;
  }

  function createPopup(): HTMLDivElement {
    if (popup) return popup;
    popup = document.createElement("div");
    popup.className = "autocomplete-popup";
    popup.style.cssText = "position:absolute;z-index:99999;background:light-dark(#ffffff,#1e1e1e);border:1px solid light-dark(rgba(0,0,0,0.12),rgba(255,255,255,0.12));box-shadow:0 8px 32px light-dark(rgba(0,0,0,0.1),rgba(0,0,0,0.5));border-radius:8px;padding:8px;font-size:13px;cursor:default;user-select:none;min-width:140px;max-width:320px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:light-dark(#333,#e0e0e0);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    popup.setAttribute('role', 'listbox');

    // Fallback for browsers without light-dark support
    if (!CSS.supports("color", "light-dark(#ffffff, #1e1e1e)")) {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const darkStyles = "background:#1e1e1e;border:1px solid rgba(255,255,255,0.12);box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#e0e0e0";
      const lightStyles = "background:#ffffff;border:1px solid rgba(0,0,0,0.12);box-shadow:0 8px 32px rgba(0,0,0,0.1);color:#333";
      popup.style.cssText += (prefersDark ? darkStyles : lightStyles);
    }

    popup.addEventListener('mousedown', (ev) => {
      const target = ev.target as HTMLElement;
      const row = target.closest('[data-sugg-index]') as HTMLElement;
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
      const row = target.closest('[data-sugg-index]') as HTMLElement;
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

  function removeUIForElement(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!state) return;
    
    if (ghost) ghost.style.display = "none";
    if (popup) popup.style.display = "none";
    state.suggestions = [];
    state.selectedIndex = 0;
  }

  function findSuggestionsForToken(token: string, group = ""): string[] {
    if (!token) return []; // Allow suggestions from 1 character
    if (!trieMap[group]) loadWords(group);
    const config = getGroupConfig(group);
    const trie = trieMap[group];
    if (!trie) return [];
    const results = trie.search(token, config.MAX_SUGGESTIONS);
    return results.filter(w => w.toLowerCase() !== token.toLowerCase()).slice(0, config.MAX_SUGGESTIONS);
  }

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

  function updateUI(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!state) return;
    
    const pos = getCaretPosition(element);
    const val = (element as HTMLInputElement | HTMLTextAreaElement).value || "";
    const vb = getWordBoundsAtCaret(val, pos);
    const token = vb.word;
    const config = getGroupConfig(state.group);
    const elRect = element.getBoundingClientRect();

    let suggestions: string[] = [];
    let suggestionType = "";

    if (token) {
      suggestions = findSuggestionsForToken(token, state.group);
      if (suggestions.length > 0) suggestionType = "completion";
    }
    // Removed prediction functionality - only autocomplete when typing

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
    const appended = suggestionType === "completion" ? primarySuggestion.slice(token.length) : primarySuggestion;

    const coords = getCaretCoords(element, pos);

    // Enhanced ghost text positioning - constrain within input bounds
    const g = createGhost();
    g.style.display = "block";
    const cs = getComputedStyle(element);
    
    g.style.fontFamily = cs.fontFamily;
    g.style.fontSize = cs.fontSize;
    g.style.fontWeight = cs.fontWeight;
    g.style.fontStyle = cs.fontStyle;
    g.style.lineHeight = cs.lineHeight;
    g.style.letterSpacing = cs.letterSpacing;
    
    // Constrain ghost text within input boundaries
    const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
    const paddingLeft = parseInt(cs.paddingLeft) || 0;
    const paddingRight = parseInt(cs.paddingRight) || 0;
    const borderLeft = parseInt(cs.borderLeftWidth) || 0;
    const borderRight = parseInt(cs.borderRightWidth) || 0;
    
    const contentWidth = elRect.width - paddingLeft - paddingRight - borderLeft - borderRight;
    const maxGhostLeft = elRect.left + window.scrollX + contentWidth + paddingLeft + borderLeft;
    const ghostLeft = Math.min(coords.left, maxGhostLeft - 50); // Leave some margin
    
    g.style.left = `${ghostLeft}px`;
    g.style.top = `${coords.top}px`;
    g.style.maxWidth = `${Math.max(50, maxGhostLeft - ghostLeft)}px`;
    g.style.overflow = "hidden";
    g.style.textOverflow = "ellipsis";
    g.textContent = appended;

    // Enhanced popup with better design
    const p = createPopup();
    p.style.display = "block";

    const existingRows = Array.from(p.querySelectorAll('[data-sugg-index]'));
    let needsRebuild = existingRows.length !== state.suggestions.length;
    
    if (!needsRebuild) {
      for (let i = 0; i < existingRows.length; i++) {
        if (existingRows[i].textContent !== state.suggestions[i]) { 
          needsRebuild = true; 
          break; 
        }
      }
    }

    if (needsRebuild) {
      p.innerHTML = '';
      
      if (config.classes?.popupContainer) {
        p.className = config.classes.popupContainer;
      }
      
      const frag = document.createDocumentFragment();
      state.suggestions.forEach((suggestion, index) => {
        const row = document.createElement('div');
        row.textContent = suggestion;
        row.setAttribute('data-sugg-index', String(index));
        row.style.cssText = "padding:8px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:all 0.15s ease;font-weight:400;display:flex;align-items:center";
        
        if (config.classes?.popupRow) row.className = config.classes.popupRow;
        frag.appendChild(row);
      });

      const hint = document.createElement('div');
      const typeLabel = "complete";
      const navHint = state.suggestions.length > 1 ? " • ↑↓" : "";
      hint.textContent = `${typeLabel} • Tab/→${navHint}`;
      hint.style.cssText = "font-size:11px;opacity:0.6;margin-top:8px;padding:0 4px;border-top:1px solid light-dark(rgba(0,0,0,0.06),rgba(255,255,255,0.06))";
      
      if (config.classes?.popupHint) hint.className = config.classes.popupHint;
      frag.appendChild(hint);
      p.appendChild(frag);
    }

    updatePopupSelection(element);

    // Enhanced popup positioning with better collision detection
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    p.style.visibility = "hidden";
    p.style.display = "block";
    const popupRect = p.getBoundingClientRect();
    const popupWidth = Math.max(140, Math.min(320, popupRect.width));
    const popupHeight = popupRect.height;
    p.style.visibility = "";

    const inputLeft = elRect.left + scrollX;
    const inputRight = inputLeft + elRect.width;
    const inputTop = elRect.top + scrollY;
    const inputBottom = inputTop + elRect.height;
    
    // Smart horizontal positioning
    let popupLeft = Math.max(inputLeft, coords.left);
    if (popupLeft + popupWidth > inputRight) {
      popupLeft = Math.max(inputLeft, inputRight - popupWidth);
    }
    
    // Viewport boundary checks with margins
    const margin = 12;
    popupLeft = Math.max(scrollX + margin, Math.min(popupLeft, viewportWidth + scrollX - popupWidth - margin));

    // Smart vertical positioning
    const spaceBelow = (viewportHeight + scrollY) - (coords.top + coords.height);
    const spaceAbove = coords.top - scrollY;
    const gap = 8;
    
    let popupTop: number;
    if (spaceBelow >= popupHeight + gap) {
      popupTop = coords.top + coords.height + gap;
    } else if (spaceAbove >= popupHeight + gap) {
      popupTop = coords.top - popupHeight - gap;
    } else {
      if (spaceBelow > spaceAbove) {
        popupTop = coords.top + coords.height + gap;
        const maxHeight = spaceBelow - gap - margin;
        if (popupHeight > maxHeight) {
          p.style.maxHeight = `${maxHeight}px`;
          p.style.overflowY = "auto";
        }
      } else {
        const maxHeight = spaceAbove - gap - margin;
        popupTop = coords.top - Math.min(popupHeight, maxHeight) - gap;
        if (popupHeight > maxHeight) {
          p.style.maxHeight = `${maxHeight}px`;
          p.style.overflowY = "auto";
        }
      }
    }

    if (lastPopupPos.left !== popupLeft || lastPopupPos.top !== popupTop) {
      p.style.left = `${popupLeft}px`;
      p.style.top = `${popupTop}px`;
      lastPopupPos = { left: popupLeft, top: popupTop };
    }
  }

  function updatePopupSelection(element: HTMLElement): void {
    const state = elementStates.get(element);
    if (!popup || !state || state.suggestions.length === 0) return;
    
    const config = getGroupConfig(state.group);
    const rows = Array.from(popup.querySelectorAll('[data-sugg-index]')) as HTMLElement[];
    
    rows.forEach((row, i) => {
      if (i === state.selectedIndex) {
        row.style.background = "light-dark(rgba(59,130,246,0.1),rgba(59,130,246,0.2))";
        row.style.color = "light-dark(rgb(59,130,246),rgb(147,197,253))";
        row.style.transform = "translateX(2px)";
        
        if (!CSS.supports("color", "light-dark(rgba(59,130,246,0.1),rgba(59,130,246,0.2))")) {
          const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          row.style.background = prefersDark ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.1)";
          row.style.color = prefersDark ? "rgb(147,197,253)" : "rgb(59,130,246)";
        }
        
        if (config.classes?.popupRowSelected) row.classList.add(config.classes.popupRowSelected);
      } else {
        row.style.background = "transparent";
        row.style.color = "inherit";
        row.style.transform = "translateX(0)";
        if (config.classes?.popupRowSelected) row.classList.remove(config.classes.popupRowSelected);
      }
    });

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

  function getWordBoundsAtCaret(text: string, caretIndex: number): WordBounds {
    if (!text) return { start: 0, end: 0, word: "" };
    let start = caretIndex;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    let end = caretIndex;
    while (end < text.length && !/\s/.test(text[end])) end++;
    return { start, end, word: text.slice(start, end) };
  }

  function scrollToCaretPosition(element: HTMLElement): void {
    const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
    const caretPos = getCaretPosition(element);
    
    if (inputEl.tagName === 'TEXTAREA') {
      const temp = document.createElement('div');
      temp.style.cssText = "position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word";
      
      const cs = getComputedStyle(inputEl);
      temp.style.fontFamily = cs.fontFamily;
      temp.style.fontSize = cs.fontSize;
      temp.style.lineHeight = cs.lineHeight;
      temp.style.width = inputEl.clientWidth + 'px';
      
      document.body.appendChild(temp);
      temp.textContent = inputEl.value.substring(0, caretPos);
      
      const lineHeight = parseInt(cs.lineHeight) || parseInt(cs.fontSize);
      const caretTop = temp.offsetHeight;
      document.body.removeChild(temp);
      
      const scrollTop = inputEl.scrollTop;
      const clientHeight = inputEl.clientHeight;
      
      if (caretTop < scrollTop) {
        inputEl.scrollTop = Math.max(0, caretTop - lineHeight);
      } else if (caretTop > scrollTop + clientHeight - lineHeight) {
        inputEl.scrollTop = caretTop - clientHeight + lineHeight;
      }
    } else {
      const temp = document.createElement('span');
      temp.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      
      const cs = getComputedStyle(inputEl);
      temp.style.fontFamily = cs.fontFamily;
      temp.style.fontSize = cs.fontSize;
      temp.textContent = inputEl.value.substring(0, caretPos);
      
      document.body.appendChild(temp);
      const caretLeft = temp.offsetWidth;
      document.body.removeChild(temp);
      
      const scrollLeft = inputEl.scrollLeft;
      const clientWidth = inputEl.clientWidth;
      
      if (caretLeft < scrollLeft) {
        inputEl.scrollLeft = Math.max(0, caretLeft - 20);
      } else if (caretLeft > scrollLeft + clientWidth - 20) {
        inputEl.scrollLeft = caretLeft - clientWidth + 40;
      }
    }
  }

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
    
    scrollToCaretPosition(element);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    saveWord(currentSuggestion, state.group);
    elementWordCount.set(element, rebuilt.split(/\s+/).filter(Boolean).length);
  }

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

  function onFocus(e: Event): void {
    const target = e.target as HTMLElement;
    if (!target?.dataset || target.dataset.autocomplete === undefined) return;
    
    const group = parseElementConfig(target);
    
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
      elementStates.get(target)!.group = group;
    }

    try {
      const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
      inputEl.setAttribute("autocomplete", "off");
      inputEl.setAttribute("spellcheck", "false");
      inputEl.setAttribute("autocorrect", "off");
    } catch {}

    loadWords(group);
    elementWordCount.set(target, ((target as HTMLInputElement | HTMLTextAreaElement).value || "").split(/\s+/).filter(Boolean).length);
    scheduleUIUpdate(target);
  }

  function onInput(e: Event): void {
    const target = e.target as HTMLElement;
    const state = elementStates.get(target);
    if (!state || state.isComposing) return;
    scheduleUIUpdate(target);
  }

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
      const w = vb.word?.trim();
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

  function onBlur(e: Event): void {
    const target = e.target as HTMLElement;
    if (!target?.dataset || target.dataset.autocomplete === undefined) return;
    
    setTimeout(() => {
      try {
        const pos = getCaretPosition(target);
        const vb = getWordBoundsAtCaret((target as HTMLInputElement | HTMLTextAreaElement).value, pos);
        const w = vb.word?.trim();
        const group = parseElementConfig(target);
        if (w) saveWord(w, group);
        analyzeIncremental(target, group);
      } catch {}
      
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

  function onCompositionStart(e: Event): void {
    const state = elementStates.get(e.target as HTMLElement);
    if (state) state.isComposing = true;
  }

  function onCompositionEnd(e: Event): void {
    const state = elementStates.get(e.target as HTMLElement);
    if (state) {
      state.isComposing = false;
      scheduleUIUpdate(e.target as HTMLElement);
    }
  }

  function onDocClick(e: Event): void {
    if (!popup) return;
    const target = e.target as HTMLElement;
    
    let autocompleteEl: HTMLElement | null = target.dataset?.autocomplete !== undefined 
      ? target 
      : target.closest?.('[data-autocomplete]') as HTMLElement;
    
    if ((autocompleteEl && elementStates.has(autocompleteEl)) || popup.contains(target)) return;
    
    elementStates.forEach((state) => {
      state.suggestions = [];
      state.selectedIndex = 0;
    });
    
    if (ghost) ghost.style.display = "none";
    if (popup) popup.style.display = "none";
  }

  // Event listeners
  const events = [
    ["focusin", onFocus, true],
    ["input", onInput, { capture: true, passive: true }],
    ["keydown", onKeyDown, true],
    ["blur", onBlur, true],
    ["compositionstart", onCompositionStart, true],
    ["compositionend", onCompositionEnd, true],
    ["click", onDocClick, true]
  ] as const;

  events.forEach(([event, handler, options]) => {
    document.addEventListener(event, handler as EventListener, options);
  });

  // Inject optimized styles
  const style = document.createElement("style");
  style.textContent = `input[data-autocomplete],textarea[data-autocomplete]{font-family:inherit}[data-sugg-index]{padding:8px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:all .15s ease;color:inherit}[data-sugg-index]:hover{background:light-dark(rgba(59,130,246,.05),rgba(59,130,246,.15))!important}.autocomplete-popup{scrollbar-width:thin;scrollbar-color:light-dark(rgba(0,0,0,.2),rgba(255,255,255,.2)) transparent}.autocomplete-popup::-webkit-scrollbar{width:6px}.autocomplete-popup::-webkit-scrollbar-track{background:transparent}.autocomplete-popup::-webkit-scrollbar-thumb{background:light-dark(rgba(0,0,0,.2),rgba(255,255,255,.2));border-radius:3px}.autocomplete-popup::-webkit-scrollbar-thumb:hover{background:light-dark(rgba(0,0,0,.3),rgba(255,255,255,.3))}@media (prefers-color-scheme:dark){[data-sugg-index]:hover{background:rgba(59,130,246,.15)!important}.autocomplete-popup{scrollbar-color:rgba(255,255,255,.2) transparent}.autocomplete-popup::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2)}.autocomplete-popup::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.3)}}@media (prefers-color-scheme:light){[data-sugg-index]:hover{background:rgba(59,130,246,.05)!important}.autocomplete-popup{scrollbar-color:rgba(0,0,0,.2) transparent}.autocomplete-popup::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2)}.autocomplete-popup::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.3)}}`;
  document.head.appendChild(style);

  // Cleanup and maintenance
  function idleCleanup(): void {
    for (const group in wordsCacheMap) {
      const config = getGroupConfig(group);
      const cache = wordsCacheMap[group];
      if (cache?.words?.length > config.MAX_WORDS) {
        cache.words = cache.words.slice(0, config.MAX_WORDS);
      }
    }
    
    for (const group in wordsCacheMap) {
      if (!trieMap[group]) rebuildTrieForGroup(group);
    }
    flushStorageSync();
  }

  const cleanupInterval = 'requestIdleCallback' in window 
    ? setInterval(() => requestIdleCallback(idleCleanup), DEFAULT_CONFIG.IDLE_CLEANUP_DELAY)
    : setInterval(idleCleanup, DEFAULT_CONFIG.IDLE_CLEANUP_DELAY * 2);

  // Public API
  const GhostComplete = {
    init(element: HTMLElement | string, group = "default") {
      const el = typeof element === 'string' ? document.querySelector(element) as HTMLElement : element;
      if (!el) return false;
      
      el.setAttribute('data-autocomplete', group);
      
      if (!elementStates.has(el)) {
        const currentFocus = document.activeElement;
        el.focus();
        if (currentFocus && currentFocus !== el) {
          (currentFocus as HTMLElement).focus();
        }
      }
      
      return true;
    },
    
    initAll(group = "default") {
      const inputs = document.querySelectorAll('input[type="text"],input[type="search"],input[type="email"],input[type="url"],input:not([type]),textarea');
      let count = 0;
      
      inputs.forEach(input => {
        if (this.init(input as HTMLElement, group)) count++;
      });
      
      return count;
    },
    
    setGroupConfig(group = "", params: Partial<AutocompleteConfig> = {}, classes: any = {}) {
      updateGroupConfig(group, params, classes);
    },
    
    getGroupConfig(group = "") {
      return { ...getGroupConfig(group) };
    },
    
    clearWords(group = "") {
      const { wordsKey } = getStorageKeys(group);
      const cacheKey = group || "default";
      localStorage.removeItem(wordsKey);
      wordsCacheMap[cacheKey] = { words: [], entries: {} };
      trieMap[cacheKey] = new Trie();
    },
    
    clearAll(group = "") {
      this.clearWords(group);
    },
    
    listWords(group = "") {
      return [...loadWords(group)];
    },
    
    getStats(group = "") {
      const words = loadWords(group);
      const cacheKey = group || "default";
      const entries = wordsCacheMap[cacheKey]?.entries || {};
      return {
        totalWords: words.length,
        totalEntries: Object.keys(entries).length
      };
    },
    
    version: "2.1.0"
  };

  // Global exposure
  (window as any).GhostComplete = GhostComplete;
  (window as any).__customAutocomplete = GhostComplete;

  // Module exports
  try {
    if (typeof (globalThis as any).module?.exports !== 'undefined') {
      (globalThis as any).module.exports = GhostComplete;
    }
  } catch {}
  
  if (typeof window !== 'undefined' && (window as any).define?.amd) {
    (window as any).define('ghostcomplete', [], () => GhostComplete);
  }

})();