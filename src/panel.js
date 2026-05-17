const elements = {
  tabLine: document.querySelector("#tabLine"),
  hostLine: document.querySelector("#hostLine"),
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsPanel: document.querySelector("#settingsPanel"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelInput: document.querySelector("#modelInput"),
  temperatureInput: document.querySelector("#temperatureInput"),
  maxStepsInput: document.querySelector("#maxStepsInput"),
  visionInput: document.querySelector("#visionInput"),
  pageControlInput: document.querySelector("#pageControlInput"),
  scriptInput: document.querySelector("#scriptInput"),
  networkInput: document.querySelector("#networkInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  settingsStatus: document.querySelector("#settingsStatus"),
  threadSelect: document.querySelector("#threadSelect"),
  newThreadButton: document.querySelector("#newThreadButton"),
  resetThreadButton: document.querySelector("#resetThreadButton"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton")
};

const CONVERSATION_STORAGE_KEY = "webAgentConversationGroupsV1";
const MAX_MESSAGES_PER_THREAD = 60;
const MAX_THREADS_PER_HOST = 30;

let conversationGroups = {};
let currentHostKey = "";
let currentHostLabel = "";
let currentThreadId = "";
let isRunning = false;

init();

async function init() {
  bindEvents();
  await loadSettings();
  await loadConversationGroups();
  await refreshActiveTabContext({ forceRender: true });
}

function bindEvents() {
  elements.settingsToggle.addEventListener("click", () => {
    elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
  });

  elements.saveSettingsButton.addEventListener("click", saveSettings);

  elements.threadSelect.addEventListener("change", async () => {
    const group = ensureCurrentGroup();
    group.activeThreadId = elements.threadSelect.value;
    currentThreadId = group.activeThreadId;
    renderThreadList();
    renderCurrentThread();
    await persistConversationGroups();
  });

  elements.newThreadButton.addEventListener("click", async () => {
    const thread = createThread("Hội thoại mới");
    const group = ensureCurrentGroup();
    group.threads.unshift(thread);
    trimThreads(group);
    group.activeThreadId = thread.id;
    currentThreadId = thread.id;
    renderThreadList();
    renderCurrentThread();
    await persistConversationGroups();
    elements.promptInput.focus();
  });

  elements.resetThreadButton.addEventListener("click", async () => {
    const thread = ensureCurrentThread();
    thread.messages = [];
    thread.title = "Hội thoại mới";
    thread.updatedAt = Date.now();
    renderThreadList();
    renderCurrentThread();
    await persistConversationGroups();
  });

  elements.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendPrompt();
  });

  elements.promptInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      await sendPrompt();
    }
  });

  elements.promptInput.addEventListener("input", resizePromptInput);

  chrome.tabs.onActivated?.addListener(() => {
    refreshActiveTabContext();
  });

  chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.url || changeInfo.status === "complete") {
      refreshActiveTabContext();
    }
  });
}

async function refreshActiveTabContext(options = {}) {
  const tab = await getActiveTab();
  const context = hostContextFromUrl(tab?.url || "");
  const hostChanged = context.key !== currentHostKey;

  elements.tabLine.textContent = tab?.title || tab?.url || "Không có tab active";
  elements.hostLine.textContent = context.label;
  currentHostLabel = context.label;

  if (!hostChanged && !options.forceRender) {
    return;
  }

  currentHostKey = context.key;
  const group = ensureCurrentGroup();
  currentThreadId = group.activeThreadId;
  renderThreadList();
  renderCurrentThread();
}

async function loadSettings() {
  let response;

  try {
    response = await sendBackground({ type: "getSettings" });
  } catch (error) {
    response = { ok: false, error: normalizeError(error) };
  }

  if (!response.ok) {
    showSettingsStatus(response.error || "Không đọc được cài đặt.", true);
    return;
  }

  const settings = response.settings;
  elements.baseUrlInput.value = settings.baseUrl || "";
  elements.apiKeyInput.value = settings.apiKey || "";
  elements.modelInput.value = settings.model || "";
  elements.temperatureInput.value = settings.temperature ?? 0.2;
  elements.maxStepsInput.value = settings.maxSteps ?? 8;
  elements.visionInput.checked = Boolean(settings.enableVision);
  elements.pageControlInput.checked = Boolean(settings.allowPageControl);
  elements.scriptInput.checked = Boolean(settings.allowScriptExecution);
  elements.networkInput.checked = Boolean(settings.allowNetwork);
}

async function saveSettings() {
  elements.saveSettingsButton.disabled = true;
  showSettingsStatus("Đang lưu...");

  const settings = {
    baseUrl: elements.baseUrlInput.value,
    apiKey: elements.apiKeyInput.value,
    model: elements.modelInput.value,
    temperature: Number(elements.temperatureInput.value),
    maxSteps: Number.parseInt(elements.maxStepsInput.value, 10),
    enableVision: elements.visionInput.checked,
    allowPageControl: elements.pageControlInput.checked,
    allowScriptExecution: elements.scriptInput.checked,
    allowNetwork: elements.networkInput.checked
  };

  let response;

  try {
    response = await sendBackground({ type: "saveSettings", settings });
  } catch (error) {
    response = { ok: false, error: normalizeError(error) };
  }

  elements.saveSettingsButton.disabled = false;

  if (!response.ok) {
    showSettingsStatus(response.error || "Lưu thất bại.", true);
    return;
  }

  showSettingsStatus("Đã lưu.");
}

async function sendPrompt() {
  const prompt = elements.promptInput.value.trim();

  if (!prompt || isRunning) {
    return;
  }

  const tab = await getActiveTab();

  if (!tab?.id) {
    appendRenderedMessage("error", "Không tìm thấy tab đang active.");
    return;
  }

  isRunning = true;
  elements.sendButton.disabled = true;
  elements.newThreadButton.disabled = true;
  elements.resetThreadButton.disabled = true;
  elements.threadSelect.disabled = true;
  elements.promptInput.value = "";
  resizePromptInput();

  const runHostKey = currentHostKey;
  const runThreadId = currentThreadId;
  const historyBeforePrompt = modelHistoryForThread(getThread(runHostKey, runThreadId));
  addMessageToThread(runHostKey, runThreadId, "user", prompt);
  renderCurrentThread();
  const pending = appendRenderedMessage("assistant", "Đang xử lý...");
  await persistConversationGroups();

  let response;

  try {
    response = await sendBackground({
      type: "runAgent",
      tabId: tab.id,
      prompt,
      history: historyBeforePrompt
    });
  } catch (error) {
    response = { ok: false, error: normalizeError(error) };
  }

  pending.remove();

  if (!response.ok) {
    addMessageToThread(runHostKey, runThreadId, "error", response.error || "Agent gặp lỗi.");

    if (runHostKey === currentHostKey && runThreadId === currentThreadId) {
      renderCurrentThread();
    }
  } else {
    addMessageToThread(runHostKey, runThreadId, "assistant", response.answer || "(Không có nội dung trả về)", response.toolLog || []);

    if (runHostKey === currentHostKey && runThreadId === currentThreadId) {
      renderCurrentThread();
    }
  }

  await persistConversationGroups();
  isRunning = false;
  elements.sendButton.disabled = false;
  elements.newThreadButton.disabled = false;
  elements.resetThreadButton.disabled = false;
  elements.threadSelect.disabled = false;
  elements.promptInput.focus();
}

function resizePromptInput() {
  elements.promptInput.style.height = "auto";
  const nextHeight = Math.min(elements.promptInput.scrollHeight, 112);
  elements.promptInput.style.height = `${Math.max(nextHeight, 38)}px`;
}

function appendRenderedMessage(role, content, toolLog = []) {
  const node = document.createElement("article");
  node.className = `message ${role}`;
  node.textContent = content;

  if (toolLog.length) {
    const logNode = document.createElement("div");
    logNode.className = "tool-log";

    for (const item of toolLog) {
      const line = document.createElement("div");
      line.textContent = `${item.ok ? "OK" : "ERR"} ${item.name}: ${item.summary}`;
      logNode.append(line);
    }

    node.append(logNode);
  }

  elements.messages.append(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;

  return node;
}

function renderCurrentThread() {
  elements.messages.replaceChildren();
  const thread = ensureCurrentThread();

  if (!thread.messages.length) {
    appendRenderedMessage("assistant", "Sẵn sàng. Hội thoại này thuộc nhóm domain hiện tại.");
    return;
  }

  for (const item of thread.messages) {
    appendRenderedMessage(item.role, item.content, item.toolLog || []);
  }
}

function renderThreadList() {
  const group = ensureCurrentGroup();
  elements.threadSelect.replaceChildren();

  for (const thread of group.threads) {
    const option = document.createElement("option");
    option.value = thread.id;
    option.textContent = thread.title || "Hội thoại mới";
    elements.threadSelect.append(option);
  }

  elements.threadSelect.value = group.activeThreadId;
}

function addMessageToThread(hostKey, threadId, role, content, toolLog = []) {
  const thread = getThread(hostKey, threadId);

  if (!thread) {
    return;
  }

  thread.messages.push({
    role,
    content,
    toolLog,
    createdAt: Date.now()
  });

  thread.messages = thread.messages.slice(-MAX_MESSAGES_PER_THREAD);
  thread.updatedAt = Date.now();

  if (role === "user" && (!thread.title || thread.title === "Hội thoại mới")) {
    thread.title = titleFromPrompt(content);
    renderThreadList();
  }
}

function modelHistoryForThread(thread) {
  if (!thread) {
    return [];
  }

  return thread.messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-20)
    .map((item) => ({
      role: item.role,
      content: item.content
    }));
}

async function loadConversationGroups() {
  const stored = await chrome.storage.local.get(CONVERSATION_STORAGE_KEY);
  conversationGroups = stored[CONVERSATION_STORAGE_KEY] || {};
}

async function persistConversationGroups() {
  await chrome.storage.local.set({
    [CONVERSATION_STORAGE_KEY]: conversationGroups
  });
}

function ensureCurrentGroup() {
  if (!currentHostKey) {
    const fallback = hostContextFromUrl("");
    currentHostKey = fallback.key;
    currentHostLabel = fallback.label;
  }

  if (!conversationGroups[currentHostKey]) {
    const thread = createThread("Hội thoại mới");
    conversationGroups[currentHostKey] = {
      label: currentHostLabel,
      activeThreadId: thread.id,
      threads: [thread],
      updatedAt: Date.now()
    };
  }

  const group = conversationGroups[currentHostKey];
  group.label = currentHostLabel || group.label || currentHostKey;

  if (!Array.isArray(group.threads) || !group.threads.length) {
    const thread = createThread("Hội thoại mới");
    group.threads = [thread];
    group.activeThreadId = thread.id;
  }

  if (!group.threads.some((thread) => thread.id === group.activeThreadId)) {
    group.activeThreadId = group.threads[0].id;
  }

  currentThreadId = group.activeThreadId;
  return group;
}

function ensureCurrentThread() {
  const group = ensureCurrentGroup();
  let thread = group.threads.find((item) => item.id === group.activeThreadId);

  if (!thread) {
    thread = createThread("Hội thoại mới");
    group.threads.unshift(thread);
    group.activeThreadId = thread.id;
    currentThreadId = thread.id;
  }

  return thread;
}

function getThread(hostKey, threadId) {
  const group = conversationGroups[hostKey];
  return group?.threads?.find((thread) => thread.id === threadId) || null;
}

function createThread(title) {
  const now = Date.now();

  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
}

function trimThreads(group) {
  group.threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  group.threads = group.threads.slice(0, MAX_THREADS_PER_HOST);
}

function titleFromPrompt(prompt) {
  const title = String(prompt || "").replace(/\s+/g, " ").trim();

  if (!title) {
    return "Hội thoại mới";
  }

  return title.length > 48 ? `${title.slice(0, 45)}...` : title;
}

function hostContextFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return {
        key: `host:${url.hostname.toLowerCase()}`,
        label: url.hostname.toLowerCase()
      };
    }

    if (url.protocol === "file:") {
      return {
        key: "host:file",
        label: "file://"
      };
    }

    return {
      key: `host:${url.protocol}`,
      label: url.protocol
    };
  } catch {
    return {
      key: "host:unknown",
      label: "Không rõ domain"
    };
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function sendBackground(payload) {
  return chrome.runtime.sendMessage({
    target: "chrome-agent-background",
    ...payload
  });
}

function showSettingsStatus(message, isError = false) {
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function normalizeError(error) {
  return error?.message || String(error);
}
