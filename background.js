const DAILY_USAGE_KEY = 'dailyUsage';
const USAGE_TRACKER_KEY = 'usageTracker';
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

const normalizeUsageMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  Object.entries(value).forEach(([key, rawAmount]) => {
    const amount = Number(rawAmount);
    normalized[key] = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  });
  return normalized;
};

const ensureDefaults = async () => {
  const now = Date.now();
  const dateKey = getLocalDateKey(new Date(now));
  const stored = await chrome.storage.local.get({
    focusSettings: DEFAULT_SETTINGS,
    studyIntention: '',
    unlockExpiration: 0,
    studyList: [],
    notesByVideo: {},
    dailyUsage: {},
    usageTracker: {
      isCounting: false,
      lastUpdate: now,
      dateKey,
    },
  });

  const sanitizedSettings = {
    ...DEFAULT_SETTINGS,
    ...(stored.focusSettings && typeof stored.focusSettings === 'object' ? stored.focusSettings : {}),
  };

  await chrome.storage.local.set({
    focusSettings: sanitizedSettings,
    studyIntention: typeof stored.studyIntention === 'string' ? stored.studyIntention : '',
    unlockExpiration: Number(stored.unlockExpiration) || 0,
    studyList: Array.isArray(stored.studyList) ? stored.studyList : [],
    notesByVideo: stored.notesByVideo && typeof stored.notesByVideo === 'object' ? stored.notesByVideo : {},
    dailyUsage: normalizeUsageMap(stored.dailyUsage),
    usageTracker: {
      isCounting: Boolean(stored.usageTracker && stored.usageTracker.isCounting),
      lastUpdate: Number(stored.usageTracker && stored.usageTracker.lastUpdate) || now,
      dateKey: stored.usageTracker && typeof stored.usageTracker.dateKey === 'string'
        ? stored.usageTracker.dateKey
        : dateKey,
    },
  });
};

const getActiveYouTubeTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const [tab] = tabs;
  if (!tab || !tab.url) {
    return null;
  }

  const url = new URL(tab.url);
  if (!url.hostname.endsWith('youtube.com') && url.hostname !== 'youtube.com') {
    return null;
  }

  return tab;
};

const trackDailyUsage = async () => {
  const now = Date.now();
  const currentDateKey = getLocalDateKey(new Date(now));
  const stored = await chrome.storage.local.get({
    dailyUsage: {},
    usageTracker: {
      isCounting: false,
      lastUpdate: now,
      dateKey: currentDateKey,
    },
  });

  const usageMap = normalizeUsageMap(stored.dailyUsage);
  const tracker = stored.usageTracker && typeof stored.usageTracker === 'object'
    ? stored.usageTracker
    : { isCounting: false, lastUpdate: now, dateKey: currentDateKey };

  const idleState = await chrome.idle.queryState('active');
  const activeTab = await getActiveYouTubeTab();
  const shouldCount = Boolean(activeTab) && idleState === 'active';

  if (!shouldCount) {
    tracker.isCounting = false;
    tracker.lastUpdate = now;
    tracker.dateKey = currentDateKey;
    await chrome.storage.local.set({ usageTracker: tracker });
    return;
  }

  if (tracker.isCounting) {
    const deltaMs = Math.max(0, now - Number(tracker.lastUpdate || now));
    if (deltaMs > 0) {
      const previousValue = Number(usageMap[currentDateKey] || 0);
      usageMap[currentDateKey] = previousValue + deltaMs;
    }
  }

  tracker.isCounting = true;
  tracker.lastUpdate = now;
  tracker.dateKey = currentDateKey;

  await chrome.storage.local.set({
    dailyUsage: usageMap,
    usageTracker: tracker,
  });
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state !== 'active') {
    const stored = await chrome.storage.local.get({ usageTracker: { isCounting: false, lastUpdate: Date.now(), dateKey: getLocalDateKey() } });
    const tracker = stored.usageTracker && typeof stored.usageTracker === 'object'
      ? stored.usageTracker
      : { isCounting: false, lastUpdate: Date.now(), dateKey: getLocalDateKey() };
    tracker.isCounting = false;
    tracker.lastUpdate = Date.now();
    await chrome.storage.local.set({ usageTracker: tracker });
  }
});

(async () => {
  await ensureDefaults();
  setInterval(trackDailyUsage, 10000);
})();
