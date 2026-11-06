const DEFAULT_SETTINGS = {
  shorts: true,
  recommendations: true,
  comments: true,
};

const YOUTUBE_GATE_ID = 'youtube-focus-board-gate';
const YOUTUBE_STYLE_ID = 'youtube-focus-board-style';

const formatTimestamp = (seconds) => {
  const safeSeconds = Number.isFinite(seconds) ? Number(seconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const formatCountdown = (remainingMs) => {
  const safeMs = Math.max(0, Number(remainingMs) || 0);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const readStorage = async (defaults) => chrome.storage.local.get(defaults);

const getVideoMeta = () => {
  const video = document.querySelector('video');
  const titleMeta = document.querySelector('meta[property="og:title"]');
  const currentTitle = titleMeta ? titleMeta.getAttribute('content') : document.title;
  const pageTitle = currentTitle ? currentTitle.replace(' - YouTube', '').trim() : 'Study video';
  const pathMatch = /(?:v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/i.exec(window.location.href);
  const videoId = pathMatch ? pathMatch[1] : '';
  const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const url = window.location.href;
  const thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';

  return {
    id: videoId,
    title: pageTitle,
    url,
    thumbnail,
    currentTime,
  };
};

const getStorageState = async () => {
  const stored = await readStorage({
    focusSettings: DEFAULT_SETTINGS,
    studyIntention: '',
    unlockExpiration: 0,
    studyList: [],
    notesByVideo: {},
  });

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...(stored.focusSettings && typeof stored.focusSettings === 'object' ? stored.focusSettings : {}),
    },
    intention: typeof stored.studyIntention === 'string' ? stored.studyIntention : '',
    unlockExpiration: Number(stored.unlockExpiration) || 0,
    studyList: Array.isArray(stored.studyList) ? stored.studyList : [],
    notesByVideo: stored.notesByVideo && typeof stored.notesByVideo === 'object' ? stored.notesByVideo : {},
  };
};

const generateFilterCSS = (settings) => {
  const rules = [];

  if (settings.shorts) {
    rules.push(`
      ytd-reel-shelf-renderer,
      ytd-rich-shelf-renderer,
      ytd-rich-grid-slim-media[is-short],
      ytd-video-renderer:has(a[href*="/shorts/"]),
      a[href*="/shorts/"],
      ytd-mini-guide-entry-renderer[aria-label*="Shorts"],
      ytd-rich-item-renderer:has(a[href*="/shorts/"]) {
        display: none !important;
      }
    `);
  }

  if (settings.recommendations) {
    rules.push(`
      ytd-watch-next-secondary-results-renderer,
      #related,
      ytd-item-section-renderer[has-item][id="related"],
      ytd-compact-video-renderer,
      ytd-rich-grid-renderer {
        display: none !important;
      }
    `);
  }

  if (settings.comments) {
    rules.push(`
      ytd-comments,
      #comments,
      .comments-app {
        display: none !important;
      }
    `);
  }

  return rules.join('\n');
};

const applyFilters = async () => {
  const { settings } = await getStorageState();
  const styleEl = document.getElementById(YOUTUBE_STYLE_ID) || document.createElement('style');
  styleEl.id = YOUTUBE_STYLE_ID;
  styleEl.textContent = generateFilterCSS(settings);

  if (!document.head) {
    return;
  }

  if (!styleEl.parentNode) {
    document.head.appendChild(styleEl);
  }
};

const ensureGate = () => {
  let gate = document.getElementById(YOUTUBE_GATE_ID);
  if (gate) {
    return gate;
  }

  gate = document.createElement('div');
  gate.id = YOUTUBE_GATE_ID;
  gate.innerHTML = `
    <div class="youtube-focus-board-overlay">
      <div class="youtube-focus-board-card">
        <p class="youtube-focus-board-kicker">Before you start</p>
        <h2>Why are you here?</h2>
        <p class="youtube-focus-board-subtitle">Set your intention before entering YouTube.</p>
        <p id="youtube-focus-board-timer" class="youtube-focus-board-timer">60:00 remaining</p>
        <form id="youtube-focus-board-form">
          <label for="focus-intention" class="sr-only">Your study goal</label>
          <input id="focus-intention" type="text" list="focus-intention-suggestions" placeholder="Revising thermodynamics" maxlength="120" required />
          <datalist id="focus-intention-suggestions">
            <option value="Revising thermodynamics"></option>
            <option value="Watching a programming lecture"></option>
            <option value="Learning cybersecurity"></option>
            <option value="Completing an assignment"></option>
            <option value="Researching a topic"></option>
          </datalist>
          <button type="submit">Start Studying – 60 Minutes</button>
        </form>
        <button id="youtube-focus-board-end-session" type="button" class="secondary-action">End session early</button>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #${YOUTUBE_GATE_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: none;
      background: rgba(8, 15, 29, 0.74);
      backdrop-filter: blur(10px);
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: "Segoe UI", sans-serif;
    }

    #${YOUTUBE_GATE_ID}[data-visible="true"] {
      display: flex;
    }

    .youtube-focus-board-overlay {
      width: min(520px, 100%);
    }

    .youtube-focus-board-card {
      background: rgba(255, 255, 255, 0.98);
      border-radius: 24px;
      box-shadow: 0 20px 55px rgba(19, 38, 64, 0.2);
      padding: 32px 28px 26px;
      border: 1px solid rgba(84, 124, 196, 0.15);
      text-align: center;
    }

    .youtube-focus-board-kicker {
      margin: 0 0 14px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #4c7fe8;
      font-size: 11px;
      font-weight: 700;
    }

    .youtube-focus-board-card h2 {
      margin: 0;
      font-size: clamp(2rem, 4vw, 2.6rem);
      color: #10213a;
    }

    .youtube-focus-board-subtitle {
      margin: 12px 0 8px;
      font-size: 1.02rem;
      color: #53698d;
    }

    .youtube-focus-board-timer {
      margin: 0 0 18px;
      font-size: 0.9rem;
      font-weight: 700;
      color: #2c8b5d;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    #youtube-focus-board-form {
      display: grid;
      gap: 16px;
    }

    #focus-intention {
      width: 100%;
      border: 1px solid #d9e5ff;
      background: #f6f9ff;
      color: #10213a;
      border-radius: 14px;
      padding: 16px 18px;
      font-size: 1rem;
      outline: none;
      box-shadow: inset 0 0 0 1px rgba(79, 121, 221, 0.04);
    }

    #focus-intention:focus {
      border-color: #67a3ff;
      box-shadow: 0 0 0 4px rgba(96, 146, 255, 0.12);
    }

    #youtube-focus-board-form button {
      border: none;
      border-radius: 14px;
      background: linear-gradient(135deg, #3b8dff, #58b8ff);
      color: white;
      padding: 15px 18px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s ease;
    }

    #youtube-focus-board-form button:hover,
    #youtube-focus-board-end-session:hover {
      transform: translateY(-1px);
    }

    #youtube-focus-board-end-session {
      margin-top: 12px;
      width: 100%;
      border: 1px solid rgba(62, 86, 142, 0.18);
      border-radius: 14px;
      background: #f1f6ff;
      color: #34569d;
      padding: 12px 18px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `;

  gate.appendChild(style);
  const form = gate.querySelector('#youtube-focus-board-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = gate.querySelector('#focus-intention');
    const value = (input.value || '').trim();

    if (!value) {
      input.focus();
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    const expiresAt = Date.now() + 60 * 60 * 1000;
    await chrome.storage.local.set({ studyIntention: value, unlockExpiration: expiresAt });
    updateGateState();
  });

  const endSessionButton = gate.querySelector('#youtube-focus-board-end-session');
  endSessionButton.addEventListener('click', async () => {
    await chrome.storage.local.set({ studyIntention: '', unlockExpiration: 0 });
    updateGateState();
  });

  document.body.appendChild(gate);
  return gate;
};

const updateGateState = async () => {
  const gate = ensureGate();
  const stored = await readStorage({ studyIntention: '', unlockExpiration: 0 });
  const expiry = Number(stored.unlockExpiration) || 0;
  const hasActiveSession = expiry > Date.now();
  const timerNode = gate.querySelector('#youtube-focus-board-timer');

  if (timerNode) {
    const remainingMs = Math.max(0, expiry - Date.now());
    timerNode.textContent = hasActiveSession ? `${formatCountdown(remainingMs)} remaining` : '60:00 remaining';
  }

  if (!hasActiveSession) {
    gate.setAttribute('data-visible', 'true');
    const input = gate.querySelector('#focus-intention');
    if (input) {
      const currentValue = (stored.studyIntention || '').trim();
      if (currentValue) {
        input.value = currentValue;
      } else {
        input.value = '';
      }
    }
  } else {
    gate.setAttribute('data-visible', 'false');
    gate.style.display = 'none';
  }
};

const updateSession = async () => {
  await applyFilters();
  await updateGateState();
};

const seekVideoToTimestamp = (timestamp) => {
  const video = document.querySelector('video');
  if (!video) {
    return false;
  }

  const safeTime = Number(timestamp) || 0;
  video.currentTime = Math.max(0, safeTime);
  video.play();
  return true;
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') {
    return;
  }

  if (changes.focusSettings || changes.unlockExpiration || changes.studyIntention) {
    updateSession();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    sendResponse({ ok: false });
    return;
  }

  if (message.type === 'getVideoMeta') {
    sendResponse(getVideoMeta());
    return;
  }

  if (message.type === 'seekTimestamp') {
    const success = seekVideoToTimestamp(message.timestamp);
    sendResponse({ ok: success });
    return;
  }

  if (message.type === 'saveNote') {
    const meta = getVideoMeta();
    const text = String(message.text || '').trim();
    if (!text) {
      sendResponse({ ok: false });
      return;
    }

    chrome.storage.local.get({ notesByVideo: {} }, (result) => {
      const notes = Array.isArray(result.notesByVideo[meta.id]) ? result.notesByVideo[meta.id] : [];
      const timestampLabel = formatTimestamp(meta.currentTime);
      notes.unshift({
        id: `${meta.id}-${Date.now()}`,
        text,
        timestamp: Number(meta.currentTime) || 0,
        timestampLabel,
        createdAt: Date.now(),
      });
      result.notesByVideo[meta.id] = notes;
      chrome.storage.local.set({ notesByVideo: result.notesByVideo }, () => {
        sendResponse({ ok: true, notes });
      });
    });
    return;
  }

  if (message.type === 'endStudySession') {
    chrome.storage.local.set({ studyIntention: '', unlockExpiration: 0 }, () => {
      updateSession();
      sendResponse({ ok: true });
    });
    return;
  }

  sendResponse({ ok: false });
});

const observePageChanges = () => {
  const observer = new MutationObserver(() => {
    applyFilters();
    updateGateState();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'src', 'href'],
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    updateSession();
    observePageChanges();
    setInterval(updateGateState, 1000);
  });
} else {
  updateSession();
  observePageChanges();
  setInterval(updateGateState, 1000);
}
