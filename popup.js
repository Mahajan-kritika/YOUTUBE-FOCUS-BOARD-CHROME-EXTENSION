const DEFAULT_SETTINGS = {
  shorts: true,
  recommendations: true,
  comments: true,
};

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatMinutes = (totalMs) => {
  const totalMinutes = Math.max(0, Math.floor(totalMs / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minutes`;
};

const formatRemainingUnlock = (expiryMs) => {
  if (!expiryMs || Number(expiryMs) <= Date.now()) {
    return 'No active session';
  }

  const remainingMs = Math.max(0, Number(expiryMs) - Date.now());
  const totalMinutes = Math.ceil(remainingMs / 60000);

  if (totalMinutes <= 0) {
    return 'Session ending';
  }

  if (totalMinutes < 60) {
    return `${totalMinutes} min left`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h left`;
  }

  return `${hours}h ${minutes}m left`;
};

const getCurrentVideoId = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return null;
    }

    const result = await chrome.tabs.sendMessage(tab.id, { type: 'getVideoMeta' });
    return result && result.id ? result.id : null;
  } catch (error) {
    return null;
  }
};

const renderStudyList = (items) => {
  const container = document.getElementById('study-list');
  container.innerHTML = '';

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<div class="empty-state">No saved videos yet.</div>';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'study-item';
    row.innerHTML = `
      <div class="meta">
        <strong>${item.title || 'Untitled video'}</strong>
        <span>${item.completed ? 'Completed' : 'Pending'}</span>
      </div>
      <div>
        <button data-open="${item.url}">Open</button>
        <button data-toggle-complete="${item.id}">${item.completed ? 'Undo' : 'Done'}</button>
        <button data-remove="${item.id}">Remove</button>
      </div>
    `;

    row.querySelector('[data-open]').addEventListener('click', () => {
      chrome.tabs.create({ url: item.url });
    });

    row.querySelector('[data-toggle-complete]').addEventListener('click', async () => {
      const saved = await chrome.storage.local.get({ studyList: [] });
      const list = Array.isArray(saved.studyList) ? saved.studyList : [];
      const next = list.map((entry) => entry.id === item.id ? { ...entry, completed: !entry.completed } : entry);
      await chrome.storage.local.set({ studyList: next });
      renderDashboard();
    });

    row.querySelector('[data-remove]').addEventListener('click', async () => {
      const saved = await chrome.storage.local.get({ studyList: [] });
      const list = Array.isArray(saved.studyList) ? saved.studyList : [];
      const next = list.filter((entry) => entry.id !== item.id);
      await chrome.storage.local.set({ studyList: next });
      renderDashboard();
    });

    container.appendChild(row);
  });
};

const renderNotes = async () => {
  const container = document.getElementById('notes-list');
  const result = await chrome.storage.local.get({ notesByVideo: {} });
  const videoId = await getCurrentVideoId();
  const notes = videoId && result.notesByVideo[videoId] ? result.notesByVideo[videoId] : [];

  container.innerHTML = '';

  if (!notes.length) {
    container.innerHTML = '<div class="empty-state">No notes for the current video yet.</div>';
    return;
  }

  notes.forEach((note) => {
    const row = document.createElement('div');
    row.className = 'note-item';
    row.innerHTML = `
      <div class="meta">
        <strong>${note.timestampLabel || '00:00'}</strong>
        <span>${note.text}</span>
      </div>
      <div>
        <button data-seek="${note.timestamp}">Jump</button>
        <button data-edit="${note.id}">Edit</button>
        <button data-delete="${note.id}">Delete</button>
      </div>
    `;

    row.querySelector('[data-seek]').addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'seekTimestamp', timestamp: Number(note.timestamp) });
      }
    });

    row.querySelector('[data-edit]').addEventListener('click', async () => {
      const updatedText = window.prompt('Edit note', note.text);
      if (updatedText === null) {
        return;
      }

      const trimmed = updatedText.trim();
      if (!trimmed) {
        return;
      }

      const saved = await chrome.storage.local.get({ notesByVideo: {} });
      const nextNotes = (saved.notesByVideo[videoId] || []).map((item) => item.id === note.id ? { ...item, text: trimmed } : item);
      saved.notesByVideo[videoId] = nextNotes;
      await chrome.storage.local.set({ notesByVideo: saved.notesByVideo });
      renderNotes();
    });

    row.querySelector('[data-delete]').addEventListener('click', async () => {
      const saved = await chrome.storage.local.get({ notesByVideo: {} });
      const nextNotes = (saved.notesByVideo[videoId] || []).filter((item) => item.id !== note.id);
      saved.notesByVideo[videoId] = nextNotes;
      await chrome.storage.local.set({ notesByVideo: saved.notesByVideo });
      renderNotes();
    });

    container.appendChild(row);
  });
};

const renderDashboard = async () => {
  const stored = await chrome.storage.local.get({
    focusSettings: DEFAULT_SETTINGS,
    studyList: [],
    studyIntention: '',
    unlockExpiration: 0,
    dailyUsage: {},
  });

  const todayKey = getLocalDateKey();
  const usageSeconds = Number((stored.dailyUsage && stored.dailyUsage[todayKey]) || 0);
  const usageDisplay = document.getElementById('usage-display');
  const intentionDisplay = document.getElementById('intention-display');
  const unlockDisplay = document.getElementById('unlock-display');

  usageDisplay.textContent = formatMinutes(usageSeconds);
  intentionDisplay.textContent = stored.studyIntention || 'No intention set';
  unlockDisplay.textContent = formatRemainingUnlock(stored.unlockExpiration);

  document.getElementById('toggle-shorts').checked = Boolean(stored.focusSettings.shorts);
  document.getElementById('toggle-recommendations').checked = Boolean(stored.focusSettings.recommendations);
  document.getElementById('toggle-comments').checked = Boolean(stored.focusSettings.comments);

  document.getElementById('study-count').textContent = `${Array.isArray(stored.studyList) ? stored.studyList.length : 0} saved`;
  renderStudyList(stored.studyList || []);
  renderNotes();
};

const persistSetting = async (key, value) => {
  const current = await chrome.storage.local.get({ focusSettings: DEFAULT_SETTINGS });
  const next = { ...DEFAULT_SETTINGS, ...(current.focusSettings || {}) };
  next[key] = value;
  await chrome.storage.local.set({ focusSettings: next });
};

const addCurrentVideo = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return;
  }

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'getVideoMeta' });
    if (!result || !result.id) {
      return;
    }

    const stored = await chrome.storage.local.get({ studyList: [] });
    const list = Array.isArray(stored.studyList) ? stored.studyList : [];
    const existing = list.some((item) => item.id === result.id || item.url === result.url);
    if (existing) {
      renderDashboard();
      return;
    }

    list.unshift({
      id: result.id,
      title: result.title,
      url: result.url,
      thumbnail: result.thumbnail,
      completed: false,
      createdAt: Date.now(),
    });

    await chrome.storage.local.set({ studyList: list });
    renderDashboard();
  } catch (error) {
    console.error('Failed to save current video', error);
  }
};

const saveCurrentNote = async () => {
  const input = document.getElementById('note-input');
  const text = input.value.trim();
  if (!text) {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return;
  }

  const meta = await chrome.tabs.sendMessage(tab.id, { type: 'getVideoMeta' });
  if (!meta || !meta.id) {
    return;
  }

  const saved = await chrome.storage.local.get({ notesByVideo: {} });
  const notes = Array.isArray(saved.notesByVideo[meta.id]) ? saved.notesByVideo[meta.id] : [];
  const now = Date.now();
  const seconds = Number(meta.currentTime || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  const timestampLabel = `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;

  notes.unshift({
    id: `${meta.id}-${now}`,
    text,
    timestamp: seconds,
    timestampLabel,
    createdAt: now,
  });

  saved.notesByVideo[meta.id] = notes;
  await chrome.storage.local.set({ notesByVideo: saved.notesByVideo });
  input.value = '';
  renderNotes();
};

const endStudySession = async () => {
  await chrome.storage.local.set({
    studyIntention: '',
    unlockExpiration: 0,
  });
  renderDashboard();
};

document.getElementById('toggle-shorts').addEventListener('change', (event) => {
  persistSetting('shorts', event.target.checked);
});
document.getElementById('toggle-recommendations').addEventListener('change', (event) => {
  persistSetting('recommendations', event.target.checked);
});
document.getElementById('toggle-comments').addEventListener('change', (event) => {
  persistSetting('comments', event.target.checked);
});

document.getElementById('add-video').addEventListener('click', addCurrentVideo);
document.getElementById('save-note').addEventListener('click', saveCurrentNote);
document.getElementById('end-session').addEventListener('click', endStudySession);
document.getElementById('open-study-list').addEventListener('click', () => {
  const panel = document.getElementById('study-list');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
document.getElementById('view-notes').addEventListener('click', () => {
  const panel = document.getElementById('notes-list');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

chrome.storage.onChanged.addListener(() => {
  renderDashboard();
});

renderDashboard();
