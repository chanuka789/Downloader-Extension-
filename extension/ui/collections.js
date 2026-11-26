/* Local media bookmarks for the full-page manager. */
(function () {
  'use strict';

  const STORAGE_KEY = 'mediaCollections';
  const MAX_NAME = 80;
  const MAX_NOTE = 1000;

  async function readCollections() {
    return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || [];
  }

  function updateCollections(change) {
    // Each manager tab shares storage and this lock. Read inside the lock so edits compose.
    return navigator.locks.request(STORAGE_KEY, async () => {
      const collections = await readCollections();
      const result = change(collections);
      await chrome.storage.local.set({ [STORAGE_KEY]: collections });
      return { collections, result };
    });
  }

  function webUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function bookmark(item, pageUrl, title) {
    const sourceUrl = webUrl(pageUrl);
    const mediaUrl = webUrl(item.url);
    if (!sourceUrl && !mediaUrl) return null;
    return {
      key: JSON.stringify([sourceUrl, item.kind, mediaUrl || item.id]),
      title: title.slice(0, 240),
      kind: item.kind === 'image' ? 'Image' : 'Video',
      sourceUrl,
      mediaUrl,
      thumbnail: webUrl(item.thumb) || (item.kind === 'image' ? mediaUrl : ''),
      note: ''
    };
  }

  function addBookmarks(collection, pending) {
    const keys = new Set(collection.items.map(item => item.key));
    const newItems = pending.filter(item => {
      if (keys.has(item.key)) return false;
      keys.add(item.key);
      return true;
    });
    collection.items.unshift(...newItems.map(item => ({ ...item, id: crypto.randomUUID() })));
    return newItems.length;
  }

  function mount(container, displayName) {
    const dialog = document.createElement('dialog');
    dialog.id = 'collectionsDialog';
    dialog.className = 'bottom-sheet';
    dialog.setAttribute('aria-labelledby', 'collectionsTitle');
    dialog.innerHTML = `
      <section class="sheet">
        <div class="sheet-head">
          <h2 id="collectionsTitle">Collections</h2>
          <button type="button" class="btn ghost" id="closeCollections">Close</button>
        </div>
        <div class="sheet-body">
          <p class="hint">Bookmarks and notes stay in this browser. Media links can expire.</p>
          <p id="collectionStatus" role="status"></p>
          <form id="newCollection" class="collection-form">
            <div class="field">
              <label for="collectionName">New collection name</label>
              <input class="input" id="collectionName" maxlength="${MAX_NAME}" required>
            </div>
            <button class="btn ghost" id="createCollection">Create collection</button>
          </form>
          <div class="collection-form" id="collectionPicker" hidden>
            <div class="field">
              <label for="collectionChoice">Collection</label>
              <select class="select" id="collectionChoice"></select>
            </div>
            <button type="button" class="btn primary" id="addBookmarks">Add</button>
            <button type="button" class="btn ghost danger" id="deleteCollection">Delete collection</button>
          </div>
          <div id="collectionItems" aria-label="Saved media"></div>
        </div>
      </section>`;
    container.append(dialog);

    const $ = selector => dialog.querySelector(selector);
    const title = $('#collectionsTitle');
    const picker = $('#collectionPicker');
    const choice = $('#collectionChoice');
    const name = $('#collectionName');
    const create = $('#createCollection');
    const add = $('#addBookmarks');
    const remove = $('#deleteCollection');
    const status = $('#collectionStatus');
    const items = $('#collectionItems');
    let collections = [];
    let activeId = '';
    let pending = [];
    let busy = false;

    function showStatus(message) {
      status.textContent = message;
    }

    function current() {
      return collections.find(collection => collection.id === activeId);
    }

    function renderItems() {
      const collection = current();
      items.replaceChildren();
      if (!collection) return;
      if (!collection.items.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'This collection is empty. Select media in the manager to add it.';
        items.append(empty);
        return;
      }
      for (const item of collection.items) items.append(renderItem(collection.id, item));
    }

    function renderItem(collectionId, item) {
      const row = document.createElement('article');
      row.className = 'collection-item';
      row.innerHTML = `
        <div class="collection-preview"><span></span></div>
        <div class="collection-details">
          <strong></strong>
          <div class="collection-links"></div>
          <form class="collection-note">
            <label class="field">Note<textarea class="input" rows="2" maxlength="${MAX_NOTE}"></textarea></label>
            <button class="btn ghost">Save note</button>
            <button type="button" class="btn ghost danger">Remove</button>
          </form>
        </div>`;
      row.querySelector('strong').textContent = item.title;
      row.querySelector('.collection-preview span').textContent = item.kind;
      if (webUrl(item.thumbnail)) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = item.thumbnail;
        row.querySelector('.collection-preview').append(img);
      }
      const links = row.querySelector('.collection-links');
      for (const [label, url] of [['Open source page', item.sourceUrl], ['Open media', item.mediaUrl]]) {
        if (!webUrl(url)) continue;
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = label;
        links.append(link);
      }
      const form = row.querySelector('form');
      const note = form.querySelector('textarea');
      note.setAttribute('aria-label', `Note for ${item.title}`);
      note.value = item.note;
      form.onsubmit = event => {
        event.preventDefault();
        const value = note.value.trim();
        write(data => {
          const saved = findCollection(data, collectionId).items.find(entry => entry.id === item.id);
          if (!saved) throw new Error('This bookmark was removed in another window.');
          saved.note = value;
          return 'Note saved.';
        }, false);
      };
      form.querySelector('button[type="button"]').onclick = async () => {
        const removed = await write(data => {
          const board = findCollection(data, collectionId);
          board.items = board.items.filter(entry => entry.id !== item.id);
          return 'Bookmark removed.';
        }, false);
        if (removed) {
          row.remove();
          if (!current()?.items.length) renderItems();
          (items.querySelector('textarea') || choice).focus();
        }
      };
      return row;
    }

    function render() {
      if (!current()) activeId = collections[0]?.id || '';
      title.textContent = pending.length ? 'Add to collection' : 'Collections';
      create.textContent = pending.length ? 'Create and add' : 'Create collection';
      picker.hidden = !collections.length;
      choice.replaceChildren(...collections.map(board => new Option(board.name, board.id)));
      choice.value = activeId;
      add.hidden = !pending.length;
      add.textContent = `Add ${pending.length} ${pending.length === 1 ? 'bookmark' : 'bookmarks'}`;
      remove.hidden = !!pending.length;
      renderItems();
    }

    function findCollection(data, id) {
      const collection = data.find(board => board.id === id);
      if (!collection) throw new Error('This collection was removed in another window.');
      return collection;
    }

    async function write(change, redraw = true) {
      if (busy) return false;
      busy = true;
      try {
        const { collections: saved, result } = await updateCollections(change);
        collections = saved;
        if (redraw) render();
        showStatus(result);
        return true;
      } catch (error) {
        showStatus(error?.message || 'Could not save changes.');
        return false;
      } finally {
        busy = false;
      }
    }

    function addedMessage(count) {
      if (!count) return 'These bookmarks are already in this collection.';
      return `Added ${count} ${count === 1 ? 'bookmark' : 'bookmarks'}.`;
    }

    $('#closeCollections').onclick = () => dialog.close();
    choice.onchange = () => {
      if (busy) { choice.value = activeId; return; }
      activeId = choice.value;
      showStatus('');
      renderItems();
    };
    $('#newCollection').onsubmit = async event => {
      event.preventDefault();
      const label = name.value.trim();
      if (!label) { showStatus('Enter a collection name.'); return; }
      const id = crypto.randomUUID();
      const bookmarks = pending;
      if (await write(data => {
        if (data.some(board => board.name.toLowerCase() === label.toLowerCase())) {
          throw new Error('A collection with that name already exists.');
        }
        const board = { id, name: label, items: [] };
        const added = addBookmarks(board, bookmarks);
        data.push(board);
        return bookmarks.length ? addedMessage(added) : 'Collection created.';
      }, false)) {
        activeId = id;
        pending = [];
        name.value = '';
        render();
        choice.focus();
      }
    };
    add.onclick = async () => {
      const id = activeId;
      const bookmarks = pending;
      if (await write(data => addedMessage(addBookmarks(findCollection(data, id), bookmarks)), false)) {
        pending = [];
        render();
        choice.focus();
      }
    };
    remove.onclick = () => {
      const board = current();
      if (!board || !confirm(`Delete “${board.name}” and its bookmarks and notes?`)) return;
      write(data => {
        data.splice(data.indexOf(findCollection(data, board.id)), 1);
        return 'Collection deleted.';
      });
    };

    return {
      async open(selected = [], pageUrl = '') {
        if (busy || dialog.open) return;
        busy = true;
        const bookmarks = selected.map(item => bookmark(item, pageUrl, displayName(item))).filter(Boolean);
        try {
          collections = await readCollections();
          pending = bookmarks;
          render();
          name.value = '';
          const skipped = selected.length - bookmarks.length;
          showStatus(skipped ? `${skipped} selected ${skipped === 1 ? 'item has' : 'items have'} no bookmarkable link.` : '');
          dialog.showModal();
          (collections.length ? choice : name).focus();
        } catch {
          showStatus('Could not load collections. Close this window and try again.');
          dialog.showModal();
        } finally {
          busy = false;
        }
      }
    };
  }

  globalThis.MHCollections = { mount };
})();
