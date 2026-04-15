import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { bootstrapGoogleAccountStorageState } from "@/lib/google-auth-state";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

type CapturedCaption = {
  speaker: string;
  text: string;
};

type GoogleMeetBotConfig = {
  displayName: string;
  headless: boolean;
  allowManualLogin: boolean;
  manualLoginTimeoutMs: number;
  firstCaptionTimeoutMs: number;
  captureDurationMs: number;
  pollIntervalMs: number;
  idleTimeoutMs: number;
  email?: string;
  password?: string;
  storageStatePath?: string;
  executablePath?: string;
};

declare global {
  interface Window {
    __meetScribeBuffer?: Array<{
      key: string;
      speaker: string;
      text: string;
    }>;
    __meetScribeSeenKeys?: Record<string, true>;
    __meetScribeScan?: () => void;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function toNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGoogleMeetBotConfig(): GoogleMeetBotConfig {
  return {
    displayName: process.env.MEET_BOT_NAME?.trim() || "Meet AI Scribe",
    headless: toBoolean(process.env.MEET_BOT_HEADLESS, true),
    allowManualLogin: toBoolean(process.env.MEET_ALLOW_MANUAL_LOGIN, true),
    manualLoginTimeoutMs: toNumber(process.env.MEET_MANUAL_LOGIN_TIMEOUT_MS, 180_000),
    firstCaptionTimeoutMs: toNumber(process.env.MEET_FIRST_CAPTION_TIMEOUT_MS, 45_000),
    captureDurationMs: toNumber(process.env.MEET_CAPTION_CAPTURE_MS, 90_000),
    pollIntervalMs: toNumber(process.env.MEET_CAPTION_POLL_MS, 1_500),
    idleTimeoutMs: toNumber(process.env.MEET_CAPTION_IDLE_TIMEOUT_MS, 15_000),
    email: process.env.GOOGLE_ACCOUNT_EMAIL?.trim(),
    password: process.env.GOOGLE_ACCOUNT_PASSWORD?.trim(),
    storageStatePath: process.env.GOOGLE_ACCOUNT_STORAGE_STATE_PATH?.trim(),
    executablePath: process.env.CHROME_EXECUTABLE_PATH?.trim(),
  };
}

function ensureStorageDir(storageStatePath?: string) {
  if (!storageStatePath) {
    return;
  }

  mkdirSync(dirname(storageStatePath), { recursive: true });
}

function hasSavedStorageState(storageStatePath?: string) {
  return storageStatePath ? existsSync(storageStatePath) : false;
}

function isGoogleLoginUrl(url: string) {
  return /accounts\.google\.com|google\.com\/signin|ServiceLogin/i.test(url);
}

async function isVisible(page: Page, selector: string) {
  try {
    return await page.locator(selector).first().isVisible({ timeout: 1_000 });
  } catch {
    return false;
  }
}

async function getButtonLabel(button: Locator) {
  return ((await button.getAttribute("aria-label").catch(() => null)) ??
    (await button.textContent().catch(() => "")) ??
    "")
    .replace(/\s+/g, " ")
    .trim();
}

async function isButtonEnabled(button: Locator) {
  const disabledAttribute = await button.getAttribute("disabled").catch(() => null);
  const ariaDisabled = await button.getAttribute("aria-disabled").catch(() => null);
  const dataDisabled = await button.getAttribute("data-is-disabled").catch(() => null);
  const enabled = await button.isEnabled().catch(() => false);

  return (
    enabled &&
    disabledAttribute === null &&
    ariaDisabled !== "true" &&
    dataDisabled !== "true"
  );
}

async function clickFirstMatchingButton(
  page: Page,
  patterns: RegExp[],
  options?: {
    allowDisabled?: boolean;
  },
) {
  const buttons = page.getByRole("button");
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);

    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    const label = await getButtonLabel(button);

    if (!label) {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(label))) {
      if (!options?.allowDisabled && !(await isButtonEnabled(button))) {
        continue;
      }

      await button.click();
      return true;
    }
  }

  return false;
}

async function waitForEnabledButton(
  page: Page,
  patterns: RegExp[],
  timeoutMs = 30_000,
) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const buttons = page.getByRole("button");
    const count = await buttons.count();

    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);

      if (!(await button.isVisible().catch(() => false))) {
        continue;
      }

      const label = await getButtonLabel(button);

      if (!label) {
        continue;
      }

      if (patterns.some((pattern) => pattern.test(label)) && (await isButtonEnabled(button))) {
        return true;
      }
    }

    await wait(500);
  }

  return false;
}

async function fillFirstMatchingInput(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    if (await isVisible(page, selector)) {
      await page.locator(selector).first().fill(value);
      return true;
    }
  }

  return false;
}

async function maybeDismissInterstitials(page: Page) {
  await clickFirstMatchingButton(page, [
    /accept all/i,
    /reject all/i,
    /got it/i,
    /understood/i,
    /dismiss/i,
  ]).catch(() => false);
}

async function clickSignInIfPresent(page: Page) {
  const signInClicked = await clickFirstMatchingButton(page, [/^sign in$/i, /sign in/i]);

  if (signInClicked) {
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
    await page.waitForTimeout(1_500);
  }
}

async function isSignInVisible(page: Page) {
  return clicklessButtonExists(page, [/^sign in$/i, /sign in/i]);
}

async function waitForManualAuthentication(page: Page, meetUrl: string, config: GoogleMeetBotConfig) {
  if (config.headless || !config.allowManualLogin) {
    return false;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < config.manualLoginTimeoutMs) {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => null);

    if (!isGoogleLoginUrl(page.url())) {
      const signInVisible = await isSignInVisible(page);

      if (!signInVisible) {
        return true;
      }
    }

    if (!/meet\.google\.com/i.test(page.url()) && !isGoogleLoginUrl(page.url())) {
      await page.goto(meetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(
        () => null,
      );
    }

    await wait(1_000);
  }

  return false;
}

async function loginToGoogleIfNeeded(page: Page, config: GoogleMeetBotConfig) {
  if (!isGoogleLoginUrl(page.url())) {
    return;
  }

  if (!config.email || !config.password) {
    throw new Error(
      "Google login is required, but GOOGLE_ACCOUNT_EMAIL or GOOGLE_ACCOUNT_PASSWORD is missing.",
    );
  }

  await page.waitForLoadState("domcontentloaded");

  const emailFilled = await fillFirstMatchingInput(
    page,
    ['input[type="email"]', 'input[autocomplete="username"]'],
    config.email,
  );

  if (!emailFilled) {
    throw new Error("Could not find the Google email input.");
  }

  await clickFirstMatchingButton(page, [/^next$/i, /continue/i]);
  await page.waitForTimeout(2_000);

  const passwordFilled = await fillFirstMatchingInput(
    page,
    ['input[type="password"]', 'input[autocomplete="current-password"]'],
    config.password,
  );

  if (!passwordFilled) {
    throw new Error(
      "Could not find the Google password input. The account may require an interactive verification step.",
    );
  }

  await clickFirstMatchingButton(page, [/^next$/i, /sign in/i, /continue/i]);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(2_000);

  if (isGoogleLoginUrl(page.url())) {
    throw new Error(
      "Google sign-in did not finish. The account may require 2-step verification or an additional challenge.",
    );
  }
}

async function typeGuestNameIfNeeded(page: Page, displayName: string) {
  await fillFirstMatchingInput(
    page,
    [
      'input[aria-label*="Your name"]',
      'input[placeholder*="Your name"]',
      'input[placeholder*="name"]',
    ],
    displayName,
  ).catch(() => false);
}

async function ensureDeviceOff(
  page: Page,
  deviceName: string,
  offPatterns: RegExp[],
  onPatterns: RegExp[],
  shortcutKeys: string[],
) {
  if (await clicklessButtonExists(page, offPatterns)) {
    return true;
  }

  const toggled = await clickFirstMatchingButton(page, onPatterns).catch(() => false);

  if (toggled) {
    await wait(800);
  }

  if (await clicklessButtonExists(page, offPatterns)) {
    return true;
  }

  for (const shortcutKey of shortcutKeys) {
    await page.keyboard.press(shortcutKey).catch(() => null);
    await wait(800);

    if (await clicklessButtonExists(page, offPatterns)) {
      return true;
    }
  }

  if (await clicklessButtonExists(page, onPatterns)) {
    console.warn(`Could not confirm that the bot ${deviceName} is off before joining.`);
  }

  return false;
}

async function disableMicAndCamera(page: Page) {
  await ensureDeviceOff(
    page,
    "microphone",
    [
      /turn on microphone/i,
      /microphone off/i,
      /microphone muted/i,
      /mute is on/i,
      /you are muted/i,
    ],
    [
      /turn off microphone/i,
      /microphone on/i,
      /unmuted/i,
      /mute is off/i,
      /you are unmuted/i,
    ],
    ["Meta+d", "Control+d"],
  );

  await ensureDeviceOff(
    page,
    "camera",
    [
      /turn on camera/i,
      /camera off/i,
      /camera is off/i,
      /video is off/i,
    ],
    [
      /turn off camera/i,
      /camera on/i,
      /camera is on/i,
      /video is on/i,
      /start video/i,
      /stop video/i,
    ],
    ["Meta+e", "Control+e"],
  );
}

async function joinMeeting(page: Page) {
  const joinPatterns = [
    /^ask to join$/i,
    /^join now$/i,
    /^request to join$/i,
    /join/i,
  ];

  const ready = await waitForEnabledButton(page, joinPatterns, 45_000);

  if (!ready) {
    const signInVisible = await clicklessButtonExists(page, [/^sign in$/i, /sign in/i]);

    if (signInVisible) {
      throw new Error(
        "Meet is showing a Sign in prompt instead of an enabled join button. The bot account is not authenticated yet.",
      );
    }

    throw new Error(
      "Google Meet never exposed an enabled join button. The pre-join page may still be loading or may require a different login flow.",
    );
  }

  const clicked = await clickFirstMatchingButton(page, joinPatterns);

  if (!clicked) {
    throw new Error("Could not find a Google Meet join button.");
  }
}

async function inspectMeetingState(page: Page) {
  const buttonLabels = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button"))
      .map((button) => {
        const htmlButton = button as HTMLButtonElement;
        return (
          htmlButton.getAttribute("aria-label") ||
          htmlButton.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
      })
      .filter(Boolean)
      .slice(0, 16);
  }).catch(() => [] as string[]);

  const admittedSignals = await Promise.all([
    clicklessButtonExists(page, [
      /leave call/i,
      /end call/i,
      /captions/i,
      /turn on captions/i,
      /turn off captions/i,
      /present now/i,
      /raise hand/i,
      /show everyone/i,
      /chat with everyone/i,
      /more options/i,
      /activities/i,
    ]),
    page.locator('[role="region"][aria-label*="Caption"]').first().isVisible().catch(() => false),
    page.locator('[aria-label="Captions"]').first().isVisible().catch(() => false),
    page.locator('[data-self-name]').first().isVisible().catch(() => false),
    page.locator("text=/you joined|you are in the call|meeting details|chat with everyone/i")
      .first()
      .isVisible()
      .catch(() => false),
  ]);

  const waitingRoomVisible = await page
    .locator(
      "text=/asking to join|someone in the call should let you in soon|you'll be able to join in just a moment|waiting for someone to let you in/i",
    )
    .first()
    .isVisible()
    .catch(() => false);

  const blockedVisible = await page
    .locator("text=/can't join this call|denied|removed from the call/i")
    .first()
    .isVisible()
    .catch(() => false);

  return {
    buttonLabels,
    admitted: admittedSignals.some(Boolean),
    waitingRoomVisible,
    blockedVisible,
    url: page.url(),
  };
}

async function waitUntilAdmitted(
  page: Page,
  onDebug?: (message: string) => void | Promise<void>,
) {
  const start = Date.now();
  let lastDebugAt = 0;

  while (Date.now() - start < 60_000) {
    const state = await inspectMeetingState(page);

    if (state.admitted) {
      return;
    }

    if (state.blockedVisible) {
      throw new Error("The bot could not enter the meeting.");
    }

    if (onDebug && Date.now() - lastDebugAt > 8_000) {
      const stage = state.waitingRoomVisible ? "waiting-room" : "unknown";
      const labels = state.buttonLabels.join(" | ") || "none";
      await onDebug(
        `Admission check: stage=${stage} url=${state.url} buttons=${labels}`,
      );
      lastDebugAt = Date.now();
    }

    await wait(2_000);
  }

  throw new Error(
    "Timed out while waiting to be admitted to the meeting. The host may need to approve the bot account.",
  );
}

async function clicklessButtonExists(page: Page, patterns: RegExp[]) {
  const buttons = page.getByRole("button");
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);

    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    const label = ((await button.getAttribute("aria-label").catch(() => null)) ??
      (await button.textContent().catch(() => "")) ??
      "")
      .replace(/\s+/g, " ")
      .trim();

    if (patterns.some((pattern) => pattern.test(label))) {
      return true;
    }
  }

  return false;
}

async function enableCaptions(page: Page) {
  const captionsEnabled = await clicklessButtonExists(page, [
    /turn off captions/i,
    /captions on/i,
  ]);

  if (captionsEnabled) {
    return true;
  }

  const clicked = await clickFirstMatchingButton(page, [/turn on captions/i, /captions/i]);

  if (!clicked) {
    await page.keyboard.press("c").catch(() => null);
  }

  await wait(1_000);

  const enabledAfterClick = await clicklessButtonExists(page, [
    /turn off captions/i,
    /captions on/i,
  ]);

  if (enabledAfterClick) {
    return true;
  }

  await page.keyboard.press("c").catch(() => null);
  await wait(1_000);

  const enabledAfterShortcut = await clicklessButtonExists(page, [
    /turn off captions/i,
    /captions on/i,
  ]);

  return enabledAfterShortcut;
}

async function attachCaptionCollector(page: Page) {
  await page.evaluate(() => {
    const ignoredPhrases = [
      "ask to join",
      "join now",
      "turn on captions",
      "turn off captions",
      "present now",
      "use companion mode",
      "meeting details",
      "raise hand",
      "leave call",
      "microphone",
      "camera",
    ];

    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

    const isVisible = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };

    const sanitizeCaptionText = (value: string) => {
      let clean = normalize(value)
        .replace(/arrow_downward\s*jump to bottom/gi, "")
        .replace(/jump to bottom/gi, "")
        .replace(/arrow_downward/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      const midpoint = Math.floor(clean.length / 2);
      const firstHalf = clean.slice(0, midpoint).trim();
      const secondHalf = clean.slice(midpoint).trim();

      if (
        firstHalf.length > 24 &&
        secondHalf.length > 24 &&
        (firstHalf === secondHalf || clean === `${firstHalf} ${firstHalf}`)
      ) {
        clean = firstHalf;
      }

      return clean;
    };

    const pushCandidate = (speaker: string, text: string) => {
      const cleanSpeaker = normalize(speaker || "Speaker");
      const cleanText = sanitizeCaptionText(text);

      if (!cleanText) {
        return;
      }

      const lowered = cleanText.toLowerCase();

      if (ignoredPhrases.some((phrase) => lowered.includes(phrase))) {
        return;
      }

      const key = `${cleanSpeaker}::${cleanText}`;
      const buffer = (window.__meetScribeBuffer ??= []);
      const seenKeys = (window.__meetScribeSeenKeys ??= {});

      if (seenKeys[key]) {
        return;
      }

      seenKeys[key] = true;

      buffer.push({
        key,
        speaker: cleanSpeaker,
        text: cleanText,
      });
    };

    const cleanLine = (value: string) =>
      sanitizeCaptionText(
        normalize(value)
        .replace(/^"+|"+$/g, "")
        .replace(/^'+|'+$/g, ""),
      );

    const parseLines = (value: string) => {
      const lines = value
        .split(/\n+/)
        .map((line) => cleanLine(line))
        .filter(Boolean);

      if (lines.length === 0) {
        return;
      }

      const colonLine = lines.find((line) => /^[^:]{1,80}:\s.+/.test(line));

      if (colonLine) {
        const [speaker, ...rest] = colonLine.split(":");
        pushCandidate(speaker, rest.join(":").trim());
        return;
      }

      if (lines.length >= 2 && lines[0].length <= 80) {
        pushCandidate(lines[0], lines.slice(1).join(" "));
        return;
      }

      if (lines.length >= 3 && lines[0].length <= 80) {
        pushCandidate(lines[0], lines.slice(1).join(" "));
        return;
      }

      if (lines.length === 1) {
        const single = lines[0];

        if (single.split(" ").length >= 4 && single.length <= 220) {
          pushCandidate("Speaker", single);
        }
      }
    };

    const readCaptionRegion = (region: Element) => {
      const descendants = Array.from(region.querySelectorAll("div, span, p"));
      const snippets = descendants
        .filter((element) => element.children.length === 0)
        .map((element) => cleanLine((element as HTMLElement).innerText || element.textContent || ""))
        .filter(Boolean)
        .filter((text) => text.length <= 320)
        .filter((text, index, array) => array.indexOf(text) === index);

      if (snippets.length === 0) {
        return;
      }

      if (snippets.length >= 2 && snippets[0].split(" ").length <= 4 && snippets[0].length <= 40) {
        pushCandidate(snippets[0], snippets.slice(1).join(" "));
        return;
      }

      pushCandidate("Speaker", snippets.join(" "));
    };

    window.__meetScribeScan = () => {
      const captionRegions = document.querySelectorAll(
        '[role="region"][aria-label*="Caption"], [role="region"][aria-label*="caption"], [aria-label="Captions"]',
      );

      captionRegions.forEach((region) => {
        readCaptionRegion(region);
      });

      const candidates = document.querySelectorAll(
        [
          '[role="region"][aria-label*="Caption"]',
          '[role="region"][aria-label*="caption"]',
          '[aria-label="Captions"]',
          '[aria-live="polite"]',
          '[aria-live="assertive"]',
          '[class*="caption"]',
          '[class*="subtitle"]',
          '[class*="transcript"]',
          '[role="listitem"]',
          '[data-self-name]',
        ].join(", "),
      );

      candidates.forEach((element) => {
        if (!isVisible(element)) {
          return;
        }

        const text = cleanLine((element as HTMLElement).innerText || element.textContent || "");

        if (!text || text.length > 500) {
          return;
        }

        parseLines(text);
      });
    };

    window.__meetScribeScan();

    const observer = new MutationObserver(() => {
      window.__meetScribeScan?.();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

async function readBufferedCaptions(page: Page): Promise<CapturedCaption[]> {
  return page.evaluate(() => {
    const buffer = window.__meetScribeBuffer ?? [];
    window.__meetScribeBuffer = [];
    return buffer.map(({ speaker, text }) => ({ speaker, text }));
  });
}

async function buildContext(config: GoogleMeetBotConfig): Promise<BrowserContext> {
  ensureStorageDir(config.storageStatePath);

  const browser = await chromium.launch({
    headless: config.headless,
    executablePath: config.executablePath || undefined,
    args: [
      "--mute-audio",
      "--disable-blink-features=AutomationControlled",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  return browser.newContext({
    viewport: { width: 1440, height: 960 },
    permissions: ["camera", "microphone", "notifications"],
    storageState: hasSavedStorageState(config.storageStatePath)
      ? config.storageStatePath
      : undefined,
  });
}

async function closeContext(context: BrowserContext) {
  const browser = context.browser();
  await context.close();
  await browser?.close();
}

async function saveStorageState(context: BrowserContext, storageStatePath?: string) {
  if (!storageStatePath) {
    return;
  }

  await context.storageState({ path: storageStatePath });
}

export async function captureGoogleMeetCaptions(
  meetUrl: string,
  onCaption: (caption: CapturedCaption) => void | Promise<void>,
  onDebug?: (message: string) => void | Promise<void>,
) {
  const config = getGoogleMeetBotConfig();
  const debug = async (message: string) => {
    if (onDebug) {
      await onDebug(message);
    }
  };
  const bootstrapResult = bootstrapGoogleAccountStorageState();

  if (bootstrapResult.bootstrapped) {
    await debug(`Bootstrapped Google auth storage state at ${bootstrapResult.path}.`);
  } else if (bootstrapResult.reason === "already-current") {
    await debug(`Using existing Google auth storage state at ${bootstrapResult.path}.`);
  }

  const context = await buildContext(config);
  const page = await context.newPage();

  async function inspectCaptionSurface() {
    return page.evaluate(() => {
      const selectors = [
        '[role="region"][aria-label*="Caption"]',
        '[role="region"][aria-label*="caption"]',
        '[aria-label="Captions"]',
        '[aria-live="polite"]',
        '[aria-live="assertive"]',
        '[class*="caption"]',
        '[class*="subtitle"]',
        '[class*="transcript"]',
        '[role="listitem"]',
        '[data-self-name]',
      ];

      const elements = Array.from(document.querySelectorAll(selectors.join(", ")));
      const visible = elements
        .map((element) => {
          const htmlElement = element as HTMLElement;
          const text = (htmlElement.innerText || htmlElement.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          const rect = htmlElement.getBoundingClientRect();
          return {
            text,
            tag: element.tagName.toLowerCase(),
            className: htmlElement.className || "",
            visible: rect.width > 0 && rect.height > 0,
          };
        })
        .filter((item) => item.visible && item.text)
        .slice(0, 5);

      const buttons = Array.from(document.querySelectorAll("button"))
        .map((button) => {
          const htmlButton = button as HTMLButtonElement;
          return (
            htmlButton.getAttribute("aria-label") ||
            htmlButton.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();
        })
        .filter(Boolean)
        .slice(0, 12);

      return {
        candidateCount: elements.length,
        samples: visible,
        buttons,
      };
    });
  }

  try {
    await debug("Opening Meet URL.");
    await page.goto(meetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await maybeDismissInterstitials(page);
    const hasSavedAuth = hasSavedStorageState(config.storageStatePath);
    const signInVisibleAtStart = await isSignInVisible(page);
    await debug(
      `Initial page ready. savedAuth=${hasSavedAuth ? "yes" : "no"} signInVisible=${signInVisibleAtStart ? "yes" : "no"}`,
    );

    if (signInVisibleAtStart && !hasSavedAuth && config.allowManualLogin && !config.headless) {
      await debug("Waiting for manual Google sign-in.");
      const signedInManually = await waitForManualAuthentication(page, meetUrl, config);

      if (!signedInManually) {
        throw new Error(
          "Timed out waiting for manual Google sign-in. Sign in once in the opened browser window, then retry.",
        );
      }
      await debug("Manual Google sign-in completed.");
    } else {
      await clickSignInIfPresent(page);
      await loginToGoogleIfNeeded(page, config);
      await debug("Automatic sign-in path completed.");
    }

    if (isGoogleLoginUrl(page.url())) {
      await page.goto(meetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }

    await page.waitForTimeout(2_000);
    await maybeDismissInterstitials(page);
    await typeGuestNameIfNeeded(page, config.displayName);
    await disableMicAndCamera(page);
    await debug("Pre-join device setup attempted.");
    await joinMeeting(page);
    await debug("Join button clicked.");
    await waitUntilAdmitted(page, debug);
    await debug("Bot admitted into meeting.");
    await disableMicAndCamera(page).catch(() => null);
    const captionsConfirmed = await enableCaptions(page);
    await debug(
      `Caption enable flow completed. confirmed=${captionsConfirmed ? "yes" : "no"}`,
    );
    await attachCaptionCollector(page);
    await debug("Caption collector attached.");
    await saveStorageState(context, config.storageStatePath);

    const startedAt = Date.now();
    let lastCaptionAt = Date.now();
    let totalCaptions = 0;
    let lastInspectionAt = 0;

    while (Date.now() - startedAt < config.captureDurationMs) {
      const captions = await readBufferedCaptions(page);

      if (captions.length > 0) {
        lastCaptionAt = Date.now();
        totalCaptions += captions.length;
      }

      for (const caption of captions) {
        await onCaption(caption);
      }

       if (Date.now() - lastInspectionAt > 5_000) {
        const inspection = await inspectCaptionSurface().catch(() => null);

        if (inspection) {
          const sampleText = inspection.samples.map((item) => item.text).join(" | ") || "none";
          await debug(
            `Caption surface check: candidates=${inspection.candidateCount} samples=${sampleText}`,
          );
        }

        lastInspectionAt = Date.now();
      }

      const noCaptionSeenYet = totalCaptions === 0;
      const waitedTooLongForFirstCaption =
        noCaptionSeenYet && Date.now() - startedAt > config.firstCaptionTimeoutMs;
      const idleAfterCaptions =
        !noCaptionSeenYet && Date.now() - lastCaptionAt > config.idleTimeoutMs;

      if (waitedTooLongForFirstCaption || idleAfterCaptions) {
        break;
      }

      await wait(config.pollIntervalMs);
    }

    if (totalCaptions === 0) {
      const inspection = await inspectCaptionSurface().catch(() => null);
      if (inspection) {
        const sampleText = inspection.samples.map((item) => item.text).join(" | ") || "none";
        await debug(
          `No captions captured. Final inspection: candidates=${inspection.candidateCount} samples=${sampleText}`,
        );
      }
      throw new Error(
        "The bot joined the meeting, but no captions were captured. Make sure Meet captions are available and that someone speaks after the bot joins.",
      );
    }
  } finally {
    await closeContext(context);
  }
}
