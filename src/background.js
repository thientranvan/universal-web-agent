const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
  maxSteps: 8,
  enableVision: true,
  allowPageControl: true,
  allowScriptExecution: true,
  allowAutopilot: true,
  allowNetwork: true
};

const AUTOPILOT_STORAGE_KEY = "webAgentAutopilotTasksV1";
const QUICK_QUIZ_PROMPT = "Đọc các câu hỏi, tick vào đáp án đúng và điền nội dung vào các câu trả lời nếu có";
const runningAutopilotTasks = new Set();
let panelConnectionCount = 0;
let lastOverlayTabId = null;

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "page_read",
      description: "Read the current page: title, URL, selected text, visible body text, headings, links, images, and form controls.",
      parameters: {
        type: "object",
        properties: {
          maxTextChars: {
            type: "integer",
            description: "Maximum characters of page text to return.",
            default: 30000
          },
          includeHidden: {
            type: "boolean",
            description: "Whether to include hidden form controls and invisible links/images.",
            default: false
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_get_images",
      description: "Return image URLs currently present on the page, including visible <img>/<picture> resources and CSS background images.",
      parameters: {
        type: "object",
        properties: {
          visibleOnly: {
            type: "boolean",
            default: true
          },
          limit: {
            type: "integer",
            default: 100
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_extract_links",
      description: "Return links from the current page with text, href, title, and visibility metadata.",
      parameters: {
        type: "object",
        properties: {
          visibleOnly: {
            type: "boolean",
            default: true
          },
          limit: {
            type: "integer",
            default: 200
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_query",
      description: "Inspect elements matching a CSS selector.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector to inspect."
          },
          limit: {
            type: "integer",
            default: 20
          }
        },
        required: ["selector"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_click",
      description: "Click an element on the page by CSS selector or by visible text/label.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string"
          },
          text: {
            type: "string",
            description: "Visible text or accessible label to match when selector is not supplied."
          },
          index: {
            type: "integer",
            description: "Zero-based index when multiple matches are found.",
            default: 0
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_fill",
      description: "Fill an input, textarea, select, or contenteditable element by selector or label.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string"
          },
          label: {
            type: "string",
            description: "Label, placeholder, aria-label, name, or nearby text to match when selector is not supplied."
          },
          value: {
            type: "string"
          },
          index: {
            type: "integer",
            default: 0
          }
        },
        required: ["value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_check",
      description: "Check or uncheck a checkbox/radio input by selector, label, or value.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string"
          },
          label: {
            type: "string"
          },
          value: {
            type: "string"
          },
          checked: {
            type: "boolean",
            default: true
          },
          index: {
            type: "integer",
            default: 0
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_select",
      description: "Select an option in a <select> element by selector/label and option value/text.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string"
          },
          label: {
            type: "string"
          },
          value: {
            type: "string"
          },
          text: {
            type: "string"
          },
          index: {
            type: "integer",
            default: 0
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_dom_set",
      description: "Edit a matched element in the live DOM, similar to changing it in DevTools Elements.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string"
          },
          mode: {
            type: "string",
            enum: ["text", "html", "value", "style", "attribute"]
          },
          value: {
            type: "string"
          },
          attribute: {
            type: "string",
            description: "Attribute name when mode is attribute."
          },
          index: {
            type: "integer",
            default: 0
          }
        },
        required: ["selector", "mode", "value"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "page_run_script",
      description: "Run arbitrary JavaScript in the active tab. Use this for broad web automation when the dedicated tools are not enough. The code is the body of an async function receiving an args object; return serializable data when useful.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "JavaScript body for async function(args). Example: \"const links = [...document.links].map(a => a.href); return links;\""
          },
          args: {
            type: "object",
            description: "JSON-serializable arguments passed to the script as args."
          },
          world: {
            type: "string",
            enum: ["MAIN", "ISOLATED"],
            default: "MAIN",
            description: "MAIN runs in the page JavaScript world, closer to DevTools. ISOLATED runs in the extension isolated world."
          },
          timeoutMs: {
            type: "integer",
            default: 5000,
            description: "Timeout for async scripts. Synchronous infinite loops can still freeze the page."
          }
        },
        required: ["code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "screenshot_visible",
      description: "Capture the visible area of the active tab and attach it for vision-capable models.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "http_request",
      description: "Send an HTTP request from the extension background context.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string"
          },
          method: {
            type: "string",
            default: "GET"
          },
          headers: {
            type: "object",
            additionalProperties: {
              type: "string"
            }
          },
          body: {
            type: "string"
          }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agent_autopilot_start",
      description: "Start a periodic autonomous task for the current tab. Use only when the user explicitly asks the agent to keep watching and continue acting, such as checking a chat every N seconds and replying.",
      parameters: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description: "The user's autonomous task instruction, including style, goals, boundaries, and when to stop."
          },
          intervalSeconds: {
            type: "integer",
            default: 10,
            description: "How often to check the current tab."
          },
          maxTurns: {
            type: "integer",
            default: 30,
            description: "Maximum autonomous checks before stopping."
          }
        },
        required: ["instruction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agent_autopilot_stop",
      description: "Stop autonomous periodic tasks for this tab, or a specific task id.",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string"
          },
          reason: {
            type: "string"
          }
        }
      }
    }
  }
];

const WRITE_TOOLS = new Set([
  "page_click",
  "page_fill",
  "page_check",
  "page_select",
  "page_dom_set"
]);

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel?.open && tab?.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    restartAutopilotsForTab(tabId).catch(() => {});
    syncOverlayForTab(tabId).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateOverlayForActiveTab(activeInfo.tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopAutopilotsForRemovedTab(tabId).catch(() => {});
  if (lastOverlayTabId === tabId) {
    lastOverlayTabId = null;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "uwa-panel") {
    return;
  }

  panelConnectionCount += 1;
  updateOverlayForActiveTab().catch(() => {});

  port.onDisconnect.addListener(() => {
    panelConnectionCount = Math.max(0, panelConnectionCount - 1);
    updateOverlayForActiveTab().catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "chrome-agent-background") {
    return false;
  }

  (async () => {
    switch (message.type) {
      case "getSettings":
        sendResponse({ ok: true, settings: await getSettings() });
        break;
      case "saveSettings":
        await saveSettings(message.settings || {});
        sendResponse({ ok: true, settings: await getSettings() });
        break;
      case "runAgent":
        sendResponse(await runAgent(message));
        break;
      case "autopilotTick":
        sendResponse(await handleAutopilotTick(message.taskId, sender.tab?.id));
        break;
      case "runOutfocusPatch":
        sendResponse(await executeOutfocusPatch(sender.tab?.id));
        break;
      case "runQuickPrompt":
        sendResponse(await runQuickPrompt(sender.tab?.id));
        break;
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: normalizeError(error) });
  });

  return true;
});

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(settings) {
  const normalized = {};

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      normalized[key] = settings[key];
    }
  }

  if (typeof normalized.baseUrl === "string") {
    normalized.baseUrl = normalized.baseUrl.trim().replace(/\/+$/, "");
  }

  if (typeof normalized.model === "string") {
    normalized.model = normalized.model.trim();
  }

  if (typeof normalized.apiKey === "string") {
    normalized.apiKey = normalized.apiKey.trim();
  }

  if (typeof normalized.temperature === "string") {
    normalized.temperature = Number(normalized.temperature);
  }

  if (typeof normalized.maxSteps === "string") {
    normalized.maxSteps = Number.parseInt(normalized.maxSteps, 10);
  }

  if (!Number.isFinite(normalized.temperature)) {
    delete normalized.temperature;
  }

  if (!Number.isFinite(normalized.maxSteps)) {
    delete normalized.maxSteps;
  }

  await chrome.storage.local.set(normalized);
}

async function runAgent(message) {
  const settings = await getSettings();
  const tabId = message.tabId;

  if (!settings.apiKey) {
    return { ok: false, error: "Chưa cấu hình API key." };
  }

  if (!settings.model) {
    return { ok: false, error: "Chưa cấu hình model." };
  }

  if (!tabId) {
    return { ok: false, error: "Không tìm thấy tab đang active." };
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(settings) },
    ...normalizeHistory(message.history || []),
    { role: "user", content: String(message.prompt || "") }
  ];

  const toolLog = [];
  const maxSteps = clamp(Number(settings.maxSteps) || DEFAULT_SETTINGS.maxSteps, 1, 20);
  const tools = message.disableAutopilotTools
    ? TOOL_DEFINITIONS.filter((tool) => !tool.function?.name?.startsWith("agent_autopilot_"))
    : TOOL_DEFINITIONS;

  for (let step = 0; step < maxSteps; step += 1) {
    const assistantMessage = await callChatCompletion(settings, messages, tools);
    const toolCalls = assistantMessage.tool_calls || [];

    if (!toolCalls.length) {
      return {
        ok: true,
        answer: assistantMessage.content || "",
        toolLog
      };
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content || "",
      tool_calls: toolCalls
    });

    const screenshotAttachments = [];

    for (const toolCall of toolCalls) {
      const name = toolCall.function?.name;
      const args = parseToolArgs(toolCall.function?.arguments);
      const result = await executeTool(name, args, { tabId, settings });
      toolLog.push({
        name,
        args,
        ok: result.ok !== false,
        summary: summarizeToolResult(result)
      });

      if (name === "screenshot_visible" && result.ok && result.imageDataUrl && settings.enableVision) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name,
          content: JSON.stringify({
            ok: true,
            width: result.width,
            height: result.height,
            note: "Screenshot captured. The image is attached in the next user message."
          })
        });
        screenshotAttachments.push(result.imageDataUrl);
      } else {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name,
          content: clipJsonForModel(result)
        });
      }
    }

    if (screenshotAttachments.length) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "Visible-tab screenshot captured for the previous screenshot tool call(s). Use it to continue the user's task."
          },
          ...screenshotAttachments.map((imageDataUrl) => ({
            type: "image_url",
            image_url: { url: imageDataUrl }
          }))
        ]
      });
    }
  }

  messages.push({
    role: "user",
    content: "You reached the tool step limit. Provide the best concise final answer from the information already gathered."
  });

  const finalMessage = await callChatCompletion(settings, messages, []);
  return {
    ok: true,
    answer: finalMessage.content || "Đã đạt giới hạn số bước nhưng model không trả về câu trả lời cuối.",
    toolLog,
    hitStepLimit: true
  };
}

function buildSystemPrompt(settings) {
  return [
    "You are Universal Web Agent, a Chrome extension agent running in the user's current tab.",
    "Operate in execution-first mode. You are not a passive advisor. For any request involving the current web page, inspect the page, run tools, execute actions, observe results, and continue until the task is done or a real blocker is found.",
    "You are a general-purpose browser automation agent for extraction, analysis, page control, messaging workflows, debugging, data cleanup, DOM editing, navigation, and repetitive web work. Do not frame yourself as only a homework helper.",
    "You can inspect page text, links, images, forms, visible screenshots, send HTTP requests, mutate the live DOM, and run JavaScript in the page through tools.",
    "Default page strategy: use page_run_script first for non-trivial web tasks. Write a compact JavaScript script, execute it, return concise serializable results, then decide the next action from those results. Do not merely print a script for the user when you can run it.",
    "If a script fails, use the error/result to revise and run another script. Use page_read/page_query/click/fill/check/select when they are more reliable or when script execution is disabled.",
    "For DOM/form/chat automation, scripts should query relevant elements, read visible state, perform clicks/fills with proper input/change events, and return a summary of what happened. Avoid infinite loops, huge result payloads, and broad destructive mutations.",
    "Do not give generic refusal text for ordinary browser automation. If a request is allowed and tools are enabled, act. Ask follow-up questions only when the missing detail blocks execution.",
    "If the user explicitly asks you to keep watching, auto-chat, auto-reply, check periodically, or continue a browser workflow without further approval, use agent_autopilot_start after doing any immediate first action.",
    "For user-authorized messaging in web chat apps, fill and send messages on behalf of the user when they clearly ask you to. Do not require per-message approval after the user explicitly asks for autonomous chat. Keep messages within the user's stated goal and style. Do not spam, threaten, harass, deceive about material facts, or continue if the recipient declines or asks to stop.",
    "Live DOM edits are temporary and may be overwritten by the website.",
    "Hard stops: do not submit payments, credentials, irreversible account changes, destructive deletes, malware, credential theft, evasion, or illegal actions unless the user explicitly confirms the exact legitimate action and it is safe to perform. If a hard stop applies, state the blocker briefly and offer the nearest safe automation.",
    "For quiz-like pages, do not ask permission just because the page is timed, graded, or exam-like. When the user says to read questions and choose/check/fill answers, inspect every question and option, solve internally, select the best answers with page tools, and report what you selected.",
    "Only ask before clicking a final Submit/Finish/Turn in button if the user's request did not explicitly include submitting. If the user explicitly says to submit/nộp, do it after checking required fields.",
    "If the user writes Vietnamese, answer in Vietnamese. Keep final answers concise and actionable.",
    `Page control is ${settings.allowPageControl ? "enabled" : "disabled"}.`,
    `Arbitrary page script execution is ${settings.allowScriptExecution ? "enabled" : "disabled"}.`,
    `Autopilot periodic automation is ${settings.allowAutopilot ? "enabled" : "disabled"}.`,
    `HTTP request tool is ${settings.allowNetwork ? "enabled" : "disabled"}.`
  ].join("\n");
}

function normalizeHistory(history) {
  return history
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-12)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").slice(0, 12000)
    }));
}

async function callChatCompletion(settings, messages, tools) {
  const endpoint = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: settings.model,
    messages,
    temperature: settings.temperature
  };

  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || text || response.statusText;
    throw new Error(`LLM request failed (${response.status}): ${detail}`);
  }

  const message = data?.choices?.[0]?.message;

  if (!message) {
    throw new Error("LLM response missing choices[0].message.");
  }

  return message;
}

async function executeTool(name, args, context) {
  if (!name) {
    return { ok: false, error: "Tool call missing name." };
  }

  if (WRITE_TOOLS.has(name) && !context.settings.allowPageControl) {
    return { ok: false, error: "Page control is disabled in settings." };
  }

  if (name === "page_run_script" && !context.settings.allowScriptExecution) {
    return { ok: false, error: "Page script execution is disabled in settings." };
  }

  if ((name === "agent_autopilot_start" || name === "agent_autopilot_stop") && !context.settings.allowAutopilot) {
    return { ok: false, error: "Autopilot is disabled in settings." };
  }

  if (name === "http_request" && !context.settings.allowNetwork) {
    return { ok: false, error: "HTTP request tool is disabled in settings." };
  }

  switch (name) {
    case "page_read":
      return sendToContent(context.tabId, { type: "page_read", args });
    case "page_get_images":
      return sendToContent(context.tabId, { type: "page_get_images", args });
    case "page_extract_links":
      return sendToContent(context.tabId, { type: "page_extract_links", args });
    case "page_query":
      return sendToContent(context.tabId, { type: "page_query", args });
    case "page_click":
      return sendToContent(context.tabId, { type: "page_click", args });
    case "page_fill":
      return sendToContent(context.tabId, { type: "page_fill", args });
    case "page_check":
      return sendToContent(context.tabId, { type: "page_check", args });
    case "page_select":
      return sendToContent(context.tabId, { type: "page_select", args });
    case "page_dom_set":
      return sendToContent(context.tabId, { type: "page_dom_set", args });
    case "page_run_script":
      return runPageScript(context.tabId, args);
    case "screenshot_visible":
      return captureVisibleScreenshot();
    case "http_request":
      return performHttpRequest(args);
    case "agent_autopilot_start":
      return startAutopilot(context.tabId, args);
    case "agent_autopilot_stop":
      return stopAutopilot(context.tabId, args);
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

async function runPageScript(tabId, args) {
  const code = String(args?.code || "");

  if (!code.trim()) {
    return { ok: false, error: "Missing script code." };
  }

  const world = args?.world === "ISOLATED" ? "ISOLATED" : "MAIN";
  const timeoutMs = clamp(Number(args?.timeoutMs) || 5000, 100, 15000);
  const scriptArgs = args?.args && typeof args.args === "object" ? args.args : {};

  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId },
      world,
      func: async (source, inputArgs, limitMs) => {
        function serialize(value, depth = 0, seen = new WeakSet()) {
          if (value === null || value === undefined) {
            return value;
          }

          const type = typeof value;

          if (type === "string") {
            return value.length > 20000 ? `${value.slice(0, 20000)}... [truncated]` : value;
          }

          if (type === "number" || type === "boolean") {
            return value;
          }

          if (type === "bigint") {
            return value.toString();
          }

          if (type === "function") {
            return `[Function ${value.name || "anonymous"}]`;
          }

          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: String(value.stack || "").slice(0, 4000)
            };
          }

          if (typeof Element !== "undefined" && value instanceof Element) {
            return {
              nodeType: "element",
              tagName: value.tagName.toLowerCase(),
              id: value.id || "",
              className: typeof value.className === "string" ? value.className : "",
              text: String(value.innerText || value.textContent || "").slice(0, 1000),
              outerHTML: String(value.outerHTML || "").slice(0, 4000)
            };
          }

          if (depth >= 4) {
            return "[MaxDepth]";
          }

          if (seen.has(value)) {
            return "[Circular]";
          }

          seen.add(value);

          if (Array.isArray(value)) {
            return value.slice(0, 200).map((item) => serialize(item, depth + 1, seen));
          }

          const output = {};
          const entries = Object.entries(value).slice(0, 80);

          for (const [key, item] of entries) {
            output[key] = serialize(item, depth + 1, seen);
          }

          return output;
        }

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const execute = async () => {
          const fn = new AsyncFunction("args", `"use strict";\n${source}`);
          return fn(inputArgs);
        };

        let timer = null;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            resolve({
              ok: false,
              error: `Script timed out after ${limitMs}ms`
            });
          }, limitMs);
        });

        try {
          const result = await Promise.race([
            execute().then((value) => ({
              ok: true,
              result: serialize(value)
            })),
            timeout
          ]);

          if (timer) {
            clearTimeout(timer);
          }

          return result;
        } catch (error) {
          if (timer) {
            clearTimeout(timer);
          }

          return {
            ok: false,
            error: error?.message || String(error),
            stack: String(error?.stack || "").slice(0, 4000)
          };
        }
      },
      args: [code, scriptArgs, timeoutMs]
    });

    return frames?.[0]?.result || { ok: false, error: "Script did not return a result." };
  } catch (error) {
    return {
      ok: false,
      error: `Không thể chạy script trong tab này: ${normalizeError(error)}`
    };
  }
}

async function startAutopilot(tabId, args) {
  const instruction = String(args?.instruction || "").trim();

  if (!instruction) {
    return { ok: false, error: "Missing autopilot instruction." };
  }

  const intervalSeconds = clamp(Number(args?.intervalSeconds) || 10, 5, 3600);
  const maxTurns = clamp(Number(args?.maxTurns) || 30, 1, 500);
  const taskId = `autopilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tasks = await getAutopilotTasks();

  tasks[taskId] = {
    id: taskId,
    tabId,
    instruction,
    intervalMs: intervalSeconds * 1000,
    maxTurns,
    turns: 0,
    enabled: true,
    history: [],
    startedAt: Date.now(),
    updatedAt: Date.now()
  };

  await saveAutopilotTasks(tasks);
  const startResult = await sendToContent(tabId, {
    type: "autopilot_start",
    args: {
      taskId,
      intervalMs: intervalSeconds * 1000
    }
  });

  if (startResult.ok === false) {
    tasks[taskId].enabled = false;
    await saveAutopilotTasks(tasks);
    return startResult;
  }

  return {
    ok: true,
    taskId,
    action: `started autopilot every ${intervalSeconds}s for up to ${maxTurns} checks`
  };
}

async function stopAutopilot(tabId, args = {}) {
  const tasks = await getAutopilotTasks();
  const taskIds = args.taskId
    ? [args.taskId]
    : Object.values(tasks)
      .filter((task) => task.tabId === tabId && task.enabled)
      .map((task) => task.id);

  for (const taskId of taskIds) {
    if (tasks[taskId]) {
      tasks[taskId].enabled = false;
      tasks[taskId].stopReason = args.reason || "stopped";
      tasks[taskId].updatedAt = Date.now();
      runningAutopilotTasks.delete(taskId);
    }

    await sendToContent(tabId, {
      type: "autopilot_stop",
      args: { taskId }
    }).catch(() => {});
  }

  await saveAutopilotTasks(tasks);

  return {
    ok: true,
    action: `stopped ${taskIds.length} autopilot task(s)`
  };
}

async function handleAutopilotTick(taskId, senderTabId) {
  if (!taskId || runningAutopilotTasks.has(taskId)) {
    return { ok: true, skipped: true };
  }

  const tasks = await getAutopilotTasks();
  const task = tasks[taskId];

  if (!task || !task.enabled) {
    return { ok: true, skipped: true };
  }

  if (senderTabId && task.tabId !== senderTabId) {
    task.tabId = senderTabId;
  }

  if (task.turns >= task.maxTurns) {
    task.enabled = false;
    task.stopReason = "maxTurns reached";
    task.updatedAt = Date.now();
    await saveAutopilotTasks(tasks);
    await sendToContent(task.tabId, {
      type: "autopilot_stop",
      args: { taskId }
    }).catch(() => {});
    return { ok: true, stopped: true };
  }

  runningAutopilotTasks.add(taskId);

  try {
    const prompt = [
      "AUTOPILOT PERIODIC CHECK",
      `User instruction: ${task.instruction}`,
      `Check number: ${task.turns + 1} of ${task.maxTurns}.`,
      "Inspect the current tab before acting. If this is a chat, identify whether there is a new incoming message or a clear next conversational step.",
      "If action is needed, perform it with the available page tools. If sending a chat message, keep it natural, concise, and aligned with the user's style and goal.",
      "Do not send duplicate messages. Do not continue if the other person declines, asks to stop, or the conversation becomes inappropriate for the user's stated goal.",
      "If no action is needed yet, do not send anything; just return a short status."
    ].join("\n");

    const result = await runAgent({
      tabId: task.tabId,
      prompt,
      history: task.history || [],
      disableAutopilotTools: true
    });

    task.turns += 1;
    task.updatedAt = Date.now();
    task.history = [
      ...(task.history || []),
      { role: "user", content: prompt },
      { role: "assistant", content: result.ok ? result.answer : result.error }
    ].slice(-10);
    tasks[taskId] = task;
    await saveAutopilotTasks(tasks);

    return {
      ok: true,
      answer: result.ok ? result.answer : result.error,
      turns: task.turns
    };
  } finally {
    runningAutopilotTasks.delete(taskId);
  }
}

async function restartAutopilotsForTab(tabId) {
  const tasks = await getAutopilotTasks();

  for (const task of Object.values(tasks)) {
    if (task.tabId === tabId && task.enabled) {
      await sendToContent(tabId, {
        type: "autopilot_start",
        args: {
          taskId: task.id,
          intervalMs: task.intervalMs
        }
      }).catch(() => {});
    }
  }
}

async function stopAutopilotsForRemovedTab(tabId) {
  const tasks = await getAutopilotTasks();
  let changed = false;

  for (const task of Object.values(tasks)) {
    if (task.tabId === tabId && task.enabled) {
      task.enabled = false;
      task.stopReason = "tab removed";
      task.updatedAt = Date.now();
      runningAutopilotTasks.delete(task.id);
      changed = true;
    }
  }

  if (changed) {
    await saveAutopilotTasks(tasks);
  }
}

async function getAutopilotTasks() {
  const stored = await chrome.storage.local.get(AUTOPILOT_STORAGE_KEY);
  return stored[AUTOPILOT_STORAGE_KEY] || {};
}

async function saveAutopilotTasks(tasks) {
  await chrome.storage.local.set({
    [AUTOPILOT_STORAGE_KEY]: tasks
  });
}

async function runQuickPrompt(tabId) {
  if (!tabId) {
    return { ok: false, error: "Không tìm thấy tab để chạy quick prompt." };
  }

  const result = await runAgent({
    tabId,
    prompt: QUICK_QUIZ_PROMPT,
    history: []
  });

  return {
    ...result,
    action: result.ok ? "quick prompt completed" : undefined
  };
}

async function executeOutfocusPatch(tabId) {
  if (!tabId) {
    return { ok: false, error: "Không tìm thấy tab để chạy patch." };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: outfocusPatchScript
    });

    return {
      ok: true,
      action: "outfocus event catch disabled"
    };
  } catch (error) {
    return {
      ok: false,
      error: `Không thể chạy patch trên tab này: ${normalizeError(error)}`
    };
  }
}

function outfocusPatchScript() {
  (() => {
    const blocked = new Set([
      "blur",
      "focusout",
      "visibilitychange",
      "webkitvisibilitychange",
      "pagehide",
      "freeze"
    ]);

    const proto = EventTarget.prototype;

    if (!window.__uwa_outfocus_patch__) {
      window.__uwa_outfocus_patch__ = {
        add: proto.addEventListener,
        remove: proto.removeEventListener
      };
    }

    const origAdd = window.__uwa_outfocus_patch__.add;

    proto.addEventListener = function(type, listener, options) {
      if (blocked.has(String(type).toLowerCase())) {
        console.log("[patch] blocked listener:", type, "on", this);
        return;
      }

      return origAdd.call(this, type, listener, options);
    };

    for (const t of blocked) {
      window.addEventListener(
        t,
        (e) => {
          e.stopImmediatePropagation();
          e.stopPropagation();
        },
        true
      );

      document.addEventListener(
        t,
        (e) => {
          e.stopImmediatePropagation();
          e.stopPropagation();
        },
        true
      );
    }

    const defineGetter = (obj, prop, value) => {
      try {
        Object.defineProperty(obj, prop, {
          get: () => value,
          configurable: true
        });
      } catch (e) {}
    };

    defineGetter(Document.prototype, "hidden", false);
    defineGetter(Document.prototype, "visibilityState", "visible");
    defineGetter(Document.prototype, "webkitHidden", false);

    try {
      document.hasFocus = () => true;
    } catch (e) {}

    try {
      Document.prototype.hasFocus = function() {
        return true;
      };
    } catch (e) {}

    for (const k of ["onblur", "onfocusout", "onvisibilitychange", "onpagehide"]) {
      try {
        window[k] = null;
        document[k] = null;
      } catch (e) {}
    }

    if (!HTMLMediaElement.prototype.__outfocus_pause_patched__) {
      const originalPause = HTMLMediaElement.prototype.pause;

      Object.defineProperty(HTMLMediaElement.prototype, "__outfocus_pause_patched__", {
        value: true
      });

      HTMLMediaElement.prototype.pause = function(...args) {
        const stack = new Error().stack || "";

        if (/visibility|blur|focusout|hidden|pagehide|freeze/i.test(stack)) {
          console.log("[patch] blocked media pause due to outfocus:", this);
          return;
        }

        return originalPause.apply(this, args);
      };
    }

    document.querySelectorAll("video").forEach((v) => {
      if (v.paused) {
        v.play().catch(() => {});
      }
    });

    const FLAG = "__uwa_disable_out_focus_video_pause__";

    if (!window[FLAG]) {
      window[FLAG] = true;
      const nativePlay = HTMLMediaElement.prototype.play;

      const resume = () => {
        for (const v of document.querySelectorAll("video")) {
          if (v.paused && !v.ended && v.readyState > 1) {
            try {
              nativePlay.call(v).catch(() => {});
            } catch (e) {}
          }
        }
      };

      setInterval(resume, 1000);
    }

    console.log("[patch] outfocus video pause disabled");
  })();
}

async function updateOverlayForActiveTab(tabId = null) {
  const activeTabId = tabId || await getActiveTabId();

  if (lastOverlayTabId && lastOverlayTabId !== activeTabId) {
    await setOverlayVisibility(lastOverlayTabId, false);
  }

  lastOverlayTabId = activeTabId;

  if (activeTabId) {
    await setOverlayVisibility(activeTabId, panelConnectionCount > 0);
  }
}

async function syncOverlayForTab(tabId) {
  const activeTabId = await getActiveTabId();

  if (tabId === activeTabId) {
    await setOverlayVisibility(tabId, panelConnectionCount > 0);
  }
}

async function setOverlayVisibility(tabId, visible) {
  if (!tabId) {
    return;
  }

  await sendToContent(tabId, {
    type: "overlay_set_visible",
    args: { visible }
  }).catch(() => {});
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0]?.id || null;
}

async function sendToContent(tabId, payload) {
  const message = {
    target: "chrome-agent-content",
    ...payload
  };

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (firstError) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/contentScript.js"]
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (secondError) {
      return {
        ok: false,
        error: `Không thể truy cập tab này. Một số trang như chrome:// hoặc Chrome Web Store không cho extension inject content script. Chi tiết: ${normalizeError(secondError || firstError)}`
      };
    }
  }
}

async function captureVisibleScreenshot() {
  const imageDataUrl = await chrome.tabs.captureVisibleTab(undefined, {
    format: "png"
  });

  return {
    ok: true,
    imageDataUrl,
    width: null,
    height: null
  };
}

async function performHttpRequest(args) {
  const method = String(args?.method || "GET").toUpperCase();
  const init = {
    method,
    headers: args?.headers || {}
  };

  if (!["GET", "HEAD"].includes(method) && typeof args?.body === "string") {
    init.body = args.body;
  }

  const response = await fetch(args.url, init);
  const text = await response.text();
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    body: text.slice(0, 50000),
    truncated: text.length > 50000
  };
}

function parseToolArgs(raw) {
  if (!raw) {
    return {};
  }

  if (typeof raw === "object") {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clipJsonForModel(value) {
  const text = JSON.stringify(value);
  const max = 60000;

  if (text.length <= max) {
    return text;
  }

  return JSON.stringify({
    ok: value?.ok !== false,
    truncated: true,
    preview: text.slice(0, max)
  });
}

function summarizeToolResult(result) {
  if (!result || result.ok === false) {
    return result?.error || "failed";
  }

  if (result.action) {
    return result.action;
  }

  if (result.taskId) {
    return `task ${result.taskId}`;
  }

  if (Array.isArray(result.images)) {
    return `${result.images.length} images`;
  }

  if (Array.isArray(result.links)) {
    return `${result.links.length} links`;
  }

  if (Object.prototype.hasOwnProperty.call(result, "result")) {
    const preview = typeof result.result === "string" ? result.result.slice(0, 80) : JSON.stringify(result.result).slice(0, 80);
    return preview ? `script result: ${preview}` : "script executed";
  }

  if (typeof result.text === "string") {
    return `${result.text.length} text chars`;
  }

  if (result.status) {
    return `HTTP ${result.status}`;
  }

  return "ok";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || String(error);
}
