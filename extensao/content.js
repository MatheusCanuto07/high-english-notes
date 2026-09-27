(function () {
  "use strict";

  const STORAGE_KEY = "englishNotes";
  const HIGHLIGHT_CLASS = "english-notes-highlight";
  const EDITING_CLASS = "english-notes-highlight--editing";
  const POPOVER_CLASS = "english-notes-popover";
  const ADD_BUTTON_CLASS = "english-notes-add-button";
  const POPOVER_TEXTAREA_MIN_HEIGHT_PX = 150;
  const POPOVER_CLOSE_DELAY_MS = 180;
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "BUTTON",
    "IFRAME",
    "CANVAS",
    "SVG",
    "NOSCRIPT"
  ]);

  let notes = {};
  let popover = null;
  let addButton = null;
  let activeHighlight = null;
  let activeRange = null;
  let pendingSelection = null;
  let saveTimer = null;
  let rescanTimer = null;
  let closePopoverTimer = null;

  init();

  async function init() {
    notes = await loadNotes();
    highlightSavedNotes();

    document.addEventListener("mouseup", handleSelectionMouseup, true);
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("click", handleDocumentClick, true);
    chrome.storage.onChanged.addListener(handleStorageChange);

    const observer = new MutationObserver(scheduleHighlightSavedNotes);
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function loadNotes() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || {});
      });
    });
  }

  function saveNotes() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: notes }, resolve);
    });
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    const nextNotes = changes[STORAGE_KEY].newValue || {};
    for (const text of Object.keys(notes)) {
      if (!nextNotes[text]) {
        removeHighlightsForText(text);
      }
    }

    notes = nextNotes;
    scheduleFullRescan();
  }

  function findNoteKey(text) {
    if (notes[text]) {
      return text;
    }

    const lowerText = text.toLowerCase();
    return Object.keys(notes).find((key) => key.toLowerCase() === lowerText) || null;
  }

  function handleSelectionMouseup(event) {
    if (
      (popover && popover.contains(event.target)) ||
      (addButton && addButton.contains(event.target))
    ) {
      return;
    }

    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }

      const selectedText = normalizeText(selection.toString());
      if (!selectedText) {
        return;
      }

      const range = selection.getRangeAt(0);
      if (!canUseRange(range)) {
        closeAddButton();
        return;
      }

      pendingSelection = {
        text: selectedText,
        range: range.cloneRange(),
        anchorRect: range.getBoundingClientRect()
      };
      openAddButton(pendingSelection.anchorRect);
    }, 0);
  }

  function handleHighlightMouseenter(event) {
    const highlight = event.currentTarget;
    const text = highlight.dataset.englishNotesText;
    if (!text) {
      return;
    }

    openPopover({
      text,
      annotation: notes[text]?.annotation || "",
      anchorRect: highlight.getBoundingClientRect(),
      highlight,
      range: null
    });
  }

  function handleDocumentClick(event) {
    if (!popover && !addButton) {
      return;
    }

    if (popover?.contains(event.target) || addButton?.contains(event.target)) {
      return;
    }

    if (event.target.closest && event.target.closest(`.${HIGHLIGHT_CLASS}`)) {
      return;
    }

    closePopover();
    closeAddButton();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closePopover();
      closeAddButton();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
    }
  }

  function openAddButton(anchorRect) {
    closePopover();
    if (addButton) {
      addButton.remove();
      addButton = null;
    }

    addButton = document.createElement("button");
    addButton.className = ADD_BUTTON_CLASS;
    addButton.type = "button";
    addButton.textContent = "Adicionar Marcação";
    addButton.addEventListener("mousedown", (event) => event.preventDefault());
    addButton.addEventListener("click", handleAddButtonClick);

    document.documentElement.appendChild(addButton);
    positionFloatingElement(addButton, anchorRect);
  }

  function handleAddButtonClick() {
    if (!pendingSelection) {
      closeAddButton();
      return;
    }

    const { range } = pendingSelection;
    const text = findNoteKey(pendingSelection.text) || pendingSelection.text;
    const highlight = wrapRange(range, text);
    if (!highlight) {
      closeAddButton();
      return;
    }

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    closeAddButton();
    openPopover({
      text,
      annotation: notes[text]?.annotation || "",
      anchorRect: highlight.getBoundingClientRect(),
      highlight,
      range: null
    });
  }

  function openPopover({ text, annotation, anchorRect, highlight, range }) {
    closePopover();
    closeAddButton();

    activeHighlight = highlight || null;
    activeRange = range || null;
    if (activeHighlight) {
      activeHighlight.classList.add(EDITING_CLASS);
    }

    popover = document.createElement("div");
    popover.className = POPOVER_CLASS;
    popover.innerHTML = `
      <p class="english-notes-popover__text"></p>
      <textarea class="english-notes-popover__textarea" maxlength="500" placeholder="Digite sua anotação"></textarea>
      <div class="english-notes-popover__actions">
        <button class="english-notes-popover__button english-notes-popover__button--delete" type="button">Apagar</button>
        <button class="english-notes-popover__button english-notes-popover__button--save" type="button">Enviar</button>
      </div>
    `;

    const textPreview = popover.querySelector(".english-notes-popover__text");
    const textarea = popover.querySelector(".english-notes-popover__textarea");
    const saveButton = popover.querySelector(".english-notes-popover__button--save");
    const deleteButton = popover.querySelector(".english-notes-popover__button--delete");

    textPreview.textContent = text;
    textarea.value = annotation;
    textarea.style.minHeight = `${POPOVER_TEXTAREA_MIN_HEIGHT_PX}px`;
    resizeTextareaToContent(textarea);
    saveButton.addEventListener("click", () => saveAnnotation(text, textarea.value));
    deleteButton.addEventListener("click", () => deleteAnnotation(text));
    deleteButton.hidden = !notes[text];
    popover.addEventListener("mouseenter", cancelScheduledPopoverClose);
    popover.addEventListener("mouseleave", schedulePopoverClose);
    textarea.addEventListener("input", () => resizeTextareaToContent(textarea));
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        saveAnnotation(text, textarea.value);
      }
    });

    document.documentElement.appendChild(popover);
    positionPopover(anchorRect);
    focusTextarea(textarea);
  }

  function focusTextarea(textarea) {
    const applyFocus = () => {
      if (!textarea.isConnected || document.activeElement === textarea) {
        return;
      }

      textarea.focus({ preventScroll: true });
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    };

    applyFocus();
    window.requestAnimationFrame(applyFocus);
    window.setTimeout(applyFocus, 50);
  }

  async function saveAnnotation(text, annotation) {
    const now = new Date().toISOString();
    const previous = notes[text];

    notes[text] = {
      text,
      annotation: annotation.trim(),
      createdAt: previous?.createdAt || now,
      updatedAt: now
    };

    await saveNotes();

    if (activeHighlight) {
      activeHighlight.dataset.englishNotesText = text;
      activeHighlight.addEventListener("mouseenter", handleHighlightMouseenter);
    } else if (activeRange) {
      wrapRange(activeRange, text);
    }

    closePopover();
    scheduleHighlightSavedNotes();
  }

  async function deleteAnnotation(text) {
    delete notes[text];
    await saveNotes();
    removeHighlightsForText(text);
    closePopover();
  }

  function closePopover() {
    cancelScheduledPopoverClose();

    if (activeHighlight) {
      activeHighlight.classList.remove(EDITING_CLASS);
    }

    if (popover) {
      popover.remove();
    }

    popover = null;
    activeHighlight = null;
    activeRange = null;
  }

  function closeAddButton() {
    if (addButton) {
      addButton.remove();
    }

    addButton = null;
    pendingSelection = null;
  }

  function schedulePopoverClose() {
    cancelScheduledPopoverClose();
    closePopoverTimer = window.setTimeout(() => {
      if (popover?.matches(":hover") || activeHighlight?.matches(":hover")) {
        return;
      }

      closePopover();
    }, POPOVER_CLOSE_DELAY_MS);
  }

  function cancelScheduledPopoverClose() {
    window.clearTimeout(closePopoverTimer);
    closePopoverTimer = null;
  }

  function resizeTextareaToContent(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, POPOVER_TEXTAREA_MIN_HEIGHT_PX)}px`;
  }

  function positionPopover(anchorRect) {
    positionFloatingElement(popover, anchorRect);
  }

  function positionFloatingElement(element, anchorRect) {
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const width = element.offsetWidth;
    const viewportWidth = document.documentElement.clientWidth;

    let left = anchorRect.left + scrollX;
    left = Math.max(8 + scrollX, Math.min(left, scrollX + viewportWidth - width - 8));

    const top = anchorRect.bottom + scrollY + 10;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function scheduleHighlightSavedNotes() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(highlightSavedNotes, 250);
  }

  function scheduleFullRescan() {
    window.clearTimeout(rescanTimer);
    rescanTimer = window.setTimeout(() => {
      if (!popover) {
        removeAllHighlights();
      }

      highlightSavedNotes();
    }, 250);
  }

  function highlightSavedNotes() {
    const savedTexts = Object.keys(notes)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((text) => ({ text, lower: text.toLowerCase() }));

    if (savedTexts.length === 0 || !document.body) {
      return;
    }

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!canProcessTextNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const node of textNodes) {
      highlightTextNode(node, savedTexts);
    }
  }

  function highlightTextNode(textNode, savedTexts) {
    const value = textNode.nodeValue;
    const matches = findMatches(value, savedTexts);
    if (matches.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const match of matches) {
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(value.slice(cursor, match.start)));
      }

      const span = createHighlight(value.slice(match.start, match.end), match.text);
      fragment.appendChild(span);
      cursor = match.end;
    }

    if (cursor < value.length) {
      fragment.appendChild(document.createTextNode(value.slice(cursor)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  function findMatches(value, savedTexts) {
    const matches = [];
    let index = 0;

    while (index < value.length) {
      let found = null;

      for (const { text, lower } of savedTexts) {
        if (
          value.substr(index, text.length).toLowerCase() === lower &&
          hasExactTextBoundaries(value, index, text)
        ) {
          found = text;
          break;
        }
      }

      if (found) {
        matches.push({
          text: found,
          start: index,
          end: index + found.length
        });
        index += found.length;
      } else {
        index += 1;
      }
    }

    return matches;
  }

  function hasExactTextBoundaries(value, start, text) {
    const end = start + text.length;
    const previous = start > 0 ? value[start - 1] : "";
    const next = end < value.length ? value[end] : "";

    return !isWordCharacter(previous) && !isWordCharacter(next);
  }

  function isWordCharacter(character) {
    return /^[A-Za-z0-9_]$/.test(character);
  }

  function wrapRange(range, text) {
    if (range.collapsed) {
      return null;
    }

    try {
      const span = createHighlight(range.toString(), text);
      range.surroundContents(span);
      return span;
    } catch (error) {
      const fragment = range.extractContents();
      const span = createHighlight(fragment.textContent || text, text);
      span.textContent = "";
      span.appendChild(fragment);
      range.insertNode(span);
      return span;
    }
  }

  function createHighlight(displayText, savedText) {
    const span = document.createElement("span");
    span.className = HIGHLIGHT_CLASS;
    span.dataset.englishNotesText = savedText;
    span.textContent = displayText;
    span.addEventListener("mouseenter", handleHighlightMouseenter);
    span.addEventListener("mouseleave", schedulePopoverClose);
    return span;
  }

  function removeHighlightsForText(text) {
    const highlights = Array.from(document.querySelectorAll(`.${HIGHLIGHT_CLASS}`));

    for (const highlight of highlights) {
      if (highlight.dataset.englishNotesText !== text) {
        continue;
      }

      unwrapHighlight(highlight);
    }
  }

  function removeAllHighlights() {
    const highlights = Array.from(document.querySelectorAll(`.${HIGHLIGHT_CLASS}`));
    for (const highlight of highlights) {
      unwrapHighlight(highlight);
    }
  }

  function unwrapHighlight(highlight) {
    const parent = highlight.parentNode;
    if (!parent) {
      return;
    }

    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    highlight.remove();
    parent.normalize();
  }

  function canUseRange(range) {
    const commonAncestor = range.commonAncestorContainer;
    const element =
      commonAncestor.nodeType === Node.ELEMENT_NODE
        ? commonAncestor
        : commonAncestor.parentElement;

    if (!element) {
      return false;
    }

    return canProcessElement(element);
  }

  function canProcessTextNode(node) {
    const parent = node.parentElement;
    if (!parent) {
      return false;
    }

    return canProcessElement(parent);
  }

  function canProcessElement(element) {
    if (!element || element.closest(`.${POPOVER_CLASS}`)) {
      return false;
    }

    if (element.closest(`.${HIGHLIGHT_CLASS}`)) {
      return false;
    }

    for (let current = element; current; current = current.parentElement) {
      if (SKIP_TAGS.has(current.tagName)) {
        return false;
      }

      if (current.isContentEditable) {
        return false;
      }
    }

    return true;
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }
})();
