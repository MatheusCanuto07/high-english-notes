(function () {
  "use strict";

  const STORAGE_KEY = "englishNotes";

  const listView = document.getElementById("list-view");
  const addView = document.getElementById("add-view");
  const searchInput = document.getElementById("search-input");
  const openAddButton = document.getElementById("open-add-button");
  const notesList = document.getElementById("notes-list");
  const emptyState = document.getElementById("empty-state");
  const notesCount = document.getElementById("notes-count");
  const addForm = document.getElementById("add-form");
  const addTextInput = document.getElementById("add-text-input");
  const addAnnotationInput = document.getElementById("add-annotation-input");
  const cancelAddButton = document.getElementById("cancel-add-button");

  let storedNotes = {};
  let notes = [];

  init();

  async function init() {
    await refreshNotes();
    showListView();

    searchInput.addEventListener("input", () => renderNotes(searchInput.value));
    openAddButton.addEventListener("click", showAddView);
    cancelAddButton.addEventListener("click", showListView);
    addForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveNewNote();
    });
    addAnnotationInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        addForm.requestSubmit();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !addView.hidden) {
        event.preventDefault();
        showListView();
      }
    });
  }

  function showListView() {
    addView.hidden = true;
    listView.hidden = false;
    renderNotes(searchInput.value);
    searchInput.focus();
  }

  function showAddView() {
    addForm.reset();
    listView.hidden = true;
    addView.hidden = false;
    addTextInput.focus();
  }

  async function saveNewNote() {
    const typedText = normalizeWhitespace(addTextInput.value);
    if (!typedText) {
      addTextInput.focus();
      return;
    }

    const lowerText = typedText.toLowerCase();
    const text =
      Object.keys(storedNotes).find((key) => key.toLowerCase() === lowerText) || typedText;
    const now = new Date().toISOString();
    const previous = storedNotes[text];

    storedNotes[text] = {
      text,
      annotation: addAnnotationInput.value.trim(),
      createdAt: previous?.createdAt || now,
      updatedAt: now
    };

    await saveNotes();
    await refreshNotes();
    searchInput.value = "";
    showListView();
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
      chrome.storage.local.set({ [STORAGE_KEY]: storedNotes }, resolve);
    });
  }

  async function refreshNotes() {
    storedNotes = await loadNotes();
    notes = Object.values(storedNotes).sort((a, b) => {
      const aTime = a.updatedAt || a.createdAt || "";
      const bTime = b.updatedAt || b.createdAt || "";
      return bTime.localeCompare(aTime);
    });
  }

  function renderNotes(query) {
    const filtered = filterNotes(notes, query);
    const total = notes.length;

    notesCount.textContent =
      total === 0 ? "0 salvas" : `${filtered.length} de ${total}`;

    notesList.replaceChildren();

    if (total === 0) {
      notesList.hidden = true;
      emptyState.hidden = false;
      emptyState.textContent =
        "Nenhuma palavra salva ainda. Selecione um texto em qualquer página para anotar.";
      return;
    }

    if (filtered.length === 0) {
      notesList.hidden = true;
      emptyState.hidden = false;
      emptyState.textContent = "Nenhum resultado para essa busca.";
      return;
    }

    emptyState.hidden = true;
    notesList.hidden = false;

    const fragment = document.createDocumentFragment();
    for (const note of filtered) {
      fragment.appendChild(createNoteItem(note));
    }
    notesList.appendChild(fragment);
  }

  function filterNotes(list, query) {
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) {
      return list;
    }

    return list.filter((note) => {
      const text = normalizeForSearch(note.text || "");
      const annotation = normalizeForSearch(note.annotation || "");
      return text.includes(normalizedQuery) || annotation.includes(normalizedQuery);
    });
  }

  function createNoteItem(note) {
    const item = document.createElement("li");
    item.className = "note-item";

    const text = document.createElement("p");
    text.className = "note-item__text";
    text.textContent = note.text || "";

    const annotation = document.createElement("p");
    annotation.className = "note-item__annotation";
    if (note.annotation && note.annotation.trim()) {
      annotation.textContent = note.annotation;
    } else {
      annotation.classList.add("note-item__annotation--empty");
      annotation.textContent = "Sem anotação";
    }

    item.append(text, annotation);
    return item;
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeForSearch(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }
})();
