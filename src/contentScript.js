(() => {
  if (window.__UNIVERSAL_WEB_AGENT_CONTENT__) {
    return;
  }

  window.__UNIVERSAL_WEB_AGENT_CONTENT__ = true;
  const autopilotIntervals = new Map();
  let overlayHost = null;
  let overlayVisible = false;
  let overlayStatusTimer = null;

  setupOverlayMenu();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== "chrome-agent-content") {
      return false;
    }

    Promise.resolve()
      .then(() => handleMessage(message))
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));

    return true;
  });

  async function handleMessage(message) {
    const args = message.args || {};

    switch (message.type) {
      case "page_read":
        return readPage(args);
      case "page_get_images":
        return {
          ok: true,
          images: collectImages(Boolean(args.visibleOnly ?? true), args.limit || 100)
        };
      case "page_extract_links":
        return {
          ok: true,
          links: collectLinks(Boolean(args.visibleOnly ?? true), args.limit || 200)
        };
      case "page_query":
        return queryElements(args);
      case "page_click":
        return clickElement(args);
      case "page_fill":
        return fillElement(args);
      case "page_check":
        return checkElement(args);
      case "page_select":
        return selectOption(args);
      case "page_dom_set":
        return setDomValue(args);
      case "autopilot_start":
        return startAutopilotTimer(args);
      case "autopilot_stop":
        return stopAutopilotTimer(args);
      case "overlay_set_visible":
        return setOverlayVisible(Boolean(args.visible));
      default:
        return { ok: false, error: `Unknown content command: ${message.type}` };
    }
  }

  function setupOverlayMenu() {
    window.addEventListener("keydown", handleOverlayShortcut, true);
    document.addEventListener("fullscreenchange", mountOverlay, true);
    ensureOverlay();
    setOverlayVisible(false);
  }

  function ensureOverlay() {
    if (overlayHost) {
      return overlayHost;
    }

    overlayHost = document.createElement("div");
    overlayHost.id = "uwa-page-menu-host";
    overlayHost.style.position = "fixed";
    overlayHost.style.top = "10px";
    overlayHost.style.right = "10px";
    overlayHost.style.zIndex = "2147483647";
    overlayHost.style.display = "none";
    overlayHost.style.pointerEvents = "auto";
    overlayHost.style.contain = "layout style paint";

    const shadow = overlayHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .bar {
        align-items: center;
        background: rgba(12, 18, 28, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 8px;
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.28);
        display: flex;
        gap: 6px;
        padding: 6px;
        pointer-events: auto;
        user-select: none;
      }
      button {
        background: #ffffff;
        border: 0;
        border-radius: 6px;
        color: #111827;
        cursor: pointer;
        font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        min-height: 30px;
        padding: 6px 9px;
        white-space: nowrap;
      }
      button:hover { background: #e8eef6; }
      button:disabled {
        cursor: wait;
        opacity: 0.68;
      }
      .status {
        color: #d1d5db;
        font: 500 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;

    const bar = document.createElement("div");
    bar.className = "bar";

    const disableCatchButton = document.createElement("button");
    disableCatchButton.type = "button";
    disableCatchButton.textContent = "Disable catch event";
    disableCatchButton.title = "Shift+1";

    const quickPromptButton = document.createElement("button");
    quickPromptButton.type = "button";
    quickPromptButton.textContent = "Auto answer";
    quickPromptButton.title = "Shift+2";

    const status = document.createElement("span");
    status.className = "status";
    status.textContent = "";

    for (const button of [disableCatchButton, quickPromptButton]) {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      }, true);
    }

    disableCatchButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runOutfocusPatchFromOverlay(disableCatchButton);
    });

    quickPromptButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runQuickPromptFromOverlay(quickPromptButton);
    });

    bar.append(disableCatchButton, quickPromptButton, status);
    shadow.append(style, bar);
    overlayHost.__setStatus = setOverlayStatus.bind(null, status);
    mountOverlay();

    return overlayHost;
  }

  function mountOverlay() {
    if (!overlayHost) {
      return;
    }

    const parent = document.fullscreenElement || document.body || document.documentElement;

    if (parent && overlayHost.parentNode !== parent) {
      parent.append(overlayHost);
    }
  }

  function setOverlayVisible(visible) {
    overlayVisible = visible;
    ensureOverlay();
    mountOverlay();
    overlayHost.style.display = visible ? "block" : "none";

    return {
      ok: true,
      action: visible ? "overlay menu shown" : "overlay menu hidden"
    };
  }

  function handleOverlayShortcut(event) {
    if (!overlayVisible || event.repeat || !event.shiftKey) {
      return;
    }

    const isFirst = event.code === "Digit1" || event.key === "!";
    const isSecond = event.code === "Digit2" || event.key === "@";

    if (!isFirst && !isSecond) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    if (isFirst) {
      runOutfocusPatchFromOverlay();
    } else {
      runQuickPromptFromOverlay();
    }
  }

  async function runOutfocusPatchFromOverlay(button = null) {
    await runOverlayAction(button, "Patching...", "runOutfocusPatch");
  }

  async function runQuickPromptFromOverlay(button = null) {
    await runOverlayAction(button, "Running prompt...", "runQuickPrompt");
  }

  async function runOverlayAction(button, pendingText, type) {
    ensureOverlay();
    overlayHost.__setStatus(pendingText);

    if (button) {
      button.disabled = true;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        target: "chrome-agent-background",
        type
      });

      if (!response?.ok) {
        overlayHost.__setStatus(response?.error || "Failed");
        return;
      }

      overlayHost.__setStatus(response.action || "Done");
    } catch (error) {
      overlayHost.__setStatus(normalizeError(error));
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  function setOverlayStatus(statusNode, text) {
    statusNode.textContent = text;

    if (overlayStatusTimer) {
      clearTimeout(overlayStatusTimer);
    }

    if (text && text !== "Running prompt..." && text !== "Patching...") {
      overlayStatusTimer = setTimeout(() => {
        statusNode.textContent = "";
      }, 4500);
    }
  }

  function startAutopilotTimer(args) {
    const taskId = String(args.taskId || "");

    if (!taskId) {
      return { ok: false, error: "Missing autopilot taskId." };
    }

    const intervalMs = clamp(Number(args.intervalMs) || 10000, 5000, 3600000);
    stopAutopilotTimer({ taskId });

    const timer = setInterval(() => {
      chrome.runtime.sendMessage({
        target: "chrome-agent-background",
        type: "autopilotTick",
        taskId
      }).catch(() => {});
    }, intervalMs);

    autopilotIntervals.set(taskId, timer);

    return {
      ok: true,
      action: `content autopilot timer started every ${Math.round(intervalMs / 1000)}s`,
      taskId
    };
  }

  function stopAutopilotTimer(args) {
    const taskId = args?.taskId ? String(args.taskId) : "";

    if (taskId) {
      const timer = autopilotIntervals.get(taskId);

      if (timer) {
        clearInterval(timer);
        autopilotIntervals.delete(taskId);
      }

      return {
        ok: true,
        action: `content autopilot timer stopped`,
        taskId
      };
    }

    for (const timer of autopilotIntervals.values()) {
      clearInterval(timer);
    }

    const count = autopilotIntervals.size;
    autopilotIntervals.clear();

    return {
      ok: true,
      action: `stopped ${count} content autopilot timer(s)`
    };
  }

  function readPage(args) {
    const maxTextChars = clamp(Number(args.maxTextChars) || 30000, 1000, 120000);
    const includeHidden = Boolean(args.includeHidden);
    const text = document.body?.innerText || "";
    const selectedText = String(window.getSelection?.() || "");

    return {
      ok: true,
      url: location.href,
      title: document.title,
      language: document.documentElement.lang || null,
      metaDescription: getMetaDescription(),
      selection: selectedText.slice(0, 10000),
      text: text.slice(0, maxTextChars),
      textTruncated: text.length > maxTextChars,
      headings: collectHeadings(),
      links: collectLinks(!includeHidden, 120),
      images: collectImages(!includeHidden, 80),
      forms: collectFormControls(includeHidden, 160)
    };
  }

  function collectHeadings() {
    return Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(isVisible)
      .slice(0, 80)
      .map((element) => ({
        level: element.tagName.toLowerCase(),
        text: cleanText(element.innerText).slice(0, 500),
        selector: selectorFor(element)
      }));
  }

  function collectLinks(visibleOnly = true, limit = 200) {
    return Array.from(document.querySelectorAll("a[href]"))
      .filter((element) => !visibleOnly || isVisible(element))
      .slice(0, limit)
      .map((element) => ({
        text: cleanText(element.innerText || element.getAttribute("aria-label") || ""),
        href: element.href,
        title: element.title || "",
        visible: isVisible(element),
        selector: selectorFor(element)
      }));
  }

  function collectImages(visibleOnly = true, limit = 100) {
    const images = [];
    const seen = new Set();

    for (const element of document.images) {
      if (visibleOnly && !isVisible(element)) {
        continue;
      }

      const src = element.currentSrc || element.src;

      if (!src || seen.has(src)) {
        continue;
      }

      seen.add(src);
      images.push({
        type: "img",
        src,
        alt: element.alt || "",
        title: element.title || "",
        width: element.naturalWidth || element.width || null,
        height: element.naturalHeight || element.height || null,
        rendered: rectInfo(element),
        visible: isVisible(element),
        selector: selectorFor(element)
      });

      if (images.length >= limit) {
        return images;
      }
    }

    const elements = Array.from(document.querySelectorAll("body *"));

    for (const element of elements) {
      if (visibleOnly && !isVisible(element)) {
        continue;
      }

      const background = getComputedStyle(element).backgroundImage;
      const urls = extractCssUrls(background);

      for (const src of urls) {
        if (seen.has(src)) {
          continue;
        }

        seen.add(src);
        images.push({
          type: "background",
          src,
          alt: element.getAttribute("aria-label") || cleanText(element.innerText).slice(0, 160),
          title: element.title || "",
          width: null,
          height: null,
          rendered: rectInfo(element),
          visible: isVisible(element),
          selector: selectorFor(element)
        });

        if (images.length >= limit) {
          return images;
        }
      }
    }

    return images;
  }

  function collectFormControls(includeHidden = false, limit = 160) {
    const selector = "input, textarea, select, button, [contenteditable='true'], [role='textbox'], [role='button'], [role='checkbox'], [role='radio']";

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => includeHidden || isVisible(element))
      .slice(0, limit)
      .map((element, index) => ({
        index,
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || element.getAttribute("role") || "",
        label: labelFor(element),
        text: cleanText(element.innerText || element.value || "").slice(0, 500),
        value: valueOf(element),
        checked: "checked" in element ? Boolean(element.checked) : null,
        disabled: Boolean(element.disabled),
        visible: isVisible(element),
        selector: selectorFor(element)
      }));
  }

  function queryElements(args) {
    if (!args.selector) {
      return { ok: false, error: "Missing selector." };
    }

    const elements = safeQueryAll(args.selector);
    const limit = clamp(Number(args.limit) || 20, 1, 100);

    return {
      ok: true,
      count: elements.length,
      elements: elements.slice(0, limit).map((element, index) => ({
        index,
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        classes: Array.from(element.classList || []).slice(0, 12),
        label: labelFor(element),
        text: cleanText(element.innerText || element.value || "").slice(0, 1000),
        value: valueOf(element),
        checked: "checked" in element ? Boolean(element.checked) : null,
        visible: isVisible(element),
        rect: rectInfo(element),
        selector: selectorFor(element)
      }))
    };
  }

  function clickElement(args) {
    const element = resolveActionElement(args, clickableCandidates(), ["text"]);

    if (!element) {
      return { ok: false, error: "No clickable element matched." };
    }

    scrollIntoView(element);
    element.focus?.({ preventScroll: true });
    dispatchPointerSequence(element);
    element.click?.();

    return {
      ok: true,
      action: `clicked ${describeElement(element)}`,
      selector: selectorFor(element),
      text: cleanText(element.innerText || element.value || "").slice(0, 300)
    };
  }

  function fillElement(args) {
    if (typeof args.value !== "string") {
      return { ok: false, error: "Missing string value." };
    }

    const element = resolveActionElement(args, fieldCandidates(), ["label"]);

    if (!element) {
      return { ok: false, error: "No fillable element matched." };
    }

    scrollIntoView(element);
    element.focus?.({ preventScroll: true });
    setElementValue(element, args.value);

    return {
      ok: true,
      action: `filled ${describeElement(element)}`,
      selector: selectorFor(element),
      value: args.value
    };
  }

  function checkElement(args) {
    const candidates = Array.from(document.querySelectorAll("input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='radio']"));
    const element = resolveActionElement(args, candidates, ["label", "value"]);

    if (!element) {
      return { ok: false, error: "No checkbox/radio element matched." };
    }

    const desired = args.checked !== false;
    scrollIntoView(element);
    element.focus?.({ preventScroll: true });

    if ("checked" in element) {
      if (element.checked !== desired) {
        element.checked = desired;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else {
      element.setAttribute("aria-checked", String(desired));
      dispatchPointerSequence(element);
      element.click?.();
    }

    return {
      ok: true,
      action: `${desired ? "checked" : "unchecked"} ${describeElement(element)}`,
      selector: selectorFor(element)
    };
  }

  function selectOption(args) {
    const element = resolveActionElement(args, Array.from(document.querySelectorAll("select")), ["label"]);

    if (!element) {
      return { ok: false, error: "No select element matched." };
    }

    const options = Array.from(element.options);
    const expectedValue = normalize(args.value || "");
    const expectedText = normalize(args.text || args.value || "");
    const option = options.find((item) => normalize(item.value) === expectedValue)
      || options.find((item) => normalize(item.textContent) === expectedText)
      || options.find((item) => normalize(item.textContent).includes(expectedText));

    if (!option) {
      return {
        ok: false,
        error: "No option matched.",
        options: options.map((item) => ({ value: item.value, text: cleanText(item.textContent) })).slice(0, 50)
      };
    }

    scrollIntoView(element);
    element.value = option.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return {
      ok: true,
      action: `selected ${option.textContent} in ${describeElement(element)}`,
      selector: selectorFor(element),
      value: option.value
    };
  }

  function setDomValue(args) {
    if (!args.selector) {
      return { ok: false, error: "Missing selector." };
    }

    const elements = safeQueryAll(args.selector);
    const element = elements[Number(args.index) || 0];

    if (!element) {
      return { ok: false, error: "No element matched selector." };
    }

    const mode = args.mode;
    const value = String(args.value ?? "");

    switch (mode) {
      case "text":
        element.textContent = value;
        break;
      case "html":
        element.innerHTML = value;
        break;
      case "value":
        setElementValue(element, value);
        break;
      case "style":
        element.style.cssText = value;
        break;
      case "attribute":
        if (!args.attribute) {
          return { ok: false, error: "Missing attribute for attribute mode." };
        }
        element.setAttribute(String(args.attribute), value);
        break;
      default:
        return { ok: false, error: `Unsupported mode: ${mode}` };
    }

    return {
      ok: true,
      action: `set ${mode} on ${describeElement(element)}`,
      selector: selectorFor(element)
    };
  }

  function resolveActionElement(args, candidates, textKeys) {
    if (args.selector) {
      const elements = safeQueryAll(args.selector);
      return elements[Number(args.index) || 0] || null;
    }

    const needle = normalize(textKeys.map((key) => args[key]).find(Boolean) || args.text || args.label || args.value || "");

    if (!needle) {
      return candidates[Number(args.index) || 0] || null;
    }

    const matches = candidates.filter((element) => {
      const haystacks = [
        labelFor(element),
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("name"),
        element.getAttribute("value"),
        element.value,
        element.innerText,
        element.textContent
      ].map(normalize);

      return haystacks.some((text) => text === needle || text.includes(needle));
    });

    return matches[Number(args.index) || 0] || null;
  }

  function clickableCandidates() {
    const selector = [
      "button",
      "a[href]",
      "input[type='button']",
      "input[type='submit']",
      "input[type='reset']",
      "label",
      "summary",
      "[role='button']",
      "[role='link']",
      "[onclick]",
      "[tabindex]"
    ].join(",");

    return Array.from(document.querySelectorAll(selector)).filter(isVisible);
  }

  function fieldCandidates() {
    const selector = "input:not([type='button']):not([type='submit']):not([type='reset']), textarea, select, [contenteditable='true'], [role='textbox']";
    return Array.from(document.querySelectorAll(selector)).filter(isVisible);
  }

  function setElementValue(element, value) {
    if (element.isContentEditable || element.getAttribute("role") === "textbox") {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return;
    }

    const tagName = element.tagName.toLowerCase();

    if (tagName === "select") {
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchPointerSequence(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y
    };

    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const EventClass = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventClass(type, eventInit));
    }
  }

  function safeQueryAll(selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function selectorFor(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.tagName.toLowerCase();
      const classes = Array.from(current.classList || []).filter(Boolean).slice(0, 2);

      if (classes.length) {
        part += `.${classes.map(cssEscape).join(".")}`;
      }

      const parent = current.parentElement;

      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);

        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      current = parent;

      if (parts.length >= 5) {
        break;
      }
    }

    return parts.join(" > ");
  }

  function labelFor(element) {
    const values = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.getAttribute("title")
    ];

    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) {
        values.push(label.innerText);
      }
    }

    const closestLabel = element.closest("label");
    if (closestLabel) {
      values.push(closestLabel.innerText);
    }

    const describedBy = element.getAttribute("aria-describedby");
    if (describedBy) {
      for (const id of describedBy.split(/\s+/)) {
        const description = document.getElementById(id);
        if (description) {
          values.push(description.innerText);
        }
      }
    }

    return cleanText(values.filter(Boolean).join(" "));
  }

  function valueOf(element) {
    if (element instanceof HTMLInputElement) {
      if (element.type === "password") {
        return "[password]";
      }

      return element.value || "";
    }

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return element.value || "";
    }

    if (element.isContentEditable) {
      return cleanText(element.innerText || "");
    }

    return "";
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    const label = labelFor(element) || cleanText(element.innerText || element.value || "").slice(0, 80);
    return label ? `${tag} "${label}"` : tag;
  }

  function scrollIntoView(element) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const style = getComputedStyle(element);

    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function rectInfo(element) {
    const rect = element.getBoundingClientRect();

    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function extractCssUrls(value) {
    if (!value || value === "none") {
      return [];
    }

    const urls = [];
    const regex = /url\((['"]?)(.*?)\1\)/g;
    let match;

    while ((match = regex.exec(value))) {
      try {
        urls.push(new URL(match[2], location.href).href);
      } catch {
        urls.push(match[2]);
      }
    }

    return urls;
  }

  function getMetaDescription() {
    return document.querySelector("meta[name='description'], meta[property='og:description']")?.content || "";
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalize(value) {
    return cleanText(value).toLowerCase();
  }

  function cssEscape(value) {
    return CSS.escape(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeError(error) {
    return error?.message || String(error);
  }
})();
