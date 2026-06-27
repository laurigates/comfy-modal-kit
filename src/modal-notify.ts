// modal-notify.ts — toast-style notifications with one-tap copy-to-clipboard.
//
// A self-contained, framework-free notification stack for ComfyUI custom-node
// packs. Unlike ComfyUI's PrimeVue toast (`app.extensionManager.toast.add`),
// which exposes no action-button slot, this renders its own DOM so that
// error/warning notifications carry a **one-tap Copy** button — the user can
// lift the full message (summary + detail) into the clipboard to paste into a
// bug report instead of retyping it.
//
// No ComfyUI dependency: pure DOM. Works on any frontend version and degrades
// to console when DOM is unavailable. CSS is namespaced under `.cmn-*`
// ("Comfy Modal Notify"); the stack sits at z-index 10000, above the modal
// shell's 9999 so a notification raised from inside a modal is still visible.

const STYLE_ID = "cmn-notify-style";
const CONTAINER_ID = "cmn-notify-container";

export type NotifySeverity = "success" | "info" | "warn" | "error";

/** Options for {@link notify}. */
export interface NotifyOptions {
  severity: NotifySeverity;
  /** Bold headline line. */
  summary: string;
  /** Optional secondary line (the detail copied alongside the summary). */
  detail?: string;
  /**
   * Milliseconds before auto-dismiss. `0` means sticky (manual close only).
   * Omit to use the per-severity default (see {@link defaultLife}).
   */
  life?: number;
  /**
   * Force the Copy button on/off. Omit to use the per-severity default:
   * shown for `warn`/`error`, hidden for `success`/`info`
   * (see {@link defaultCopyable}).
   */
  copyable?: boolean;
}

/** Handle returned by {@link notify}. */
export interface NotifyController {
  /** Dismiss this notification immediately. */
  close: () => void;
  /** The toast root element (for tests / advanced callers). */
  el: HTMLElement;
}

// ============================================================
// Pure helpers (DOM-free — unit-tested in the node env)
// ============================================================

/** Default auto-dismiss time per severity. Errors stick until dismissed. */
export function defaultLife(severity: NotifySeverity): number {
  switch (severity) {
    case "error":
      return 0; // sticky — the user needs time to read/copy it
    case "warn":
      return 8000;
    default:
      return 4000;
  }
}

/** Whether the Copy button shows by default for a severity. */
export function defaultCopyable(severity: NotifySeverity): boolean {
  return severity === "error" || severity === "warn";
}

/** The text the Copy button writes to the clipboard. */
export function notifyClipboardText(summary: string, detail?: string): string {
  return detail ? `${summary}\n${detail}` : summary;
}

// ============================================================
// Clipboard (secure-context-aware, with a legacy fallback)
// ============================================================

/**
 * Copy `text` to the clipboard. Uses the async Clipboard API when available
 * (secure contexts: https / localhost), else falls back to a hidden textarea +
 * `document.execCommand("copy")` — important because a ComfyUI served over
 * plain http on a LAN host is **not** a secure context, so `navigator.clipboard`
 * is undefined there.
 *
 * @returns true on success, false if both paths fail.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ============================================================
// DOM
// ============================================================

const CSS = `
.cmn-container {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(380px, calc(100vw - 24px));
    pointer-events: none;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.cmn-toast {
    pointer-events: auto;
    background: #1a1a1f;
    color: #e8e8ea;
    border: 1px solid #3a3a44;
    border-left-width: 4px;
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    line-height: 1.4;
    animation: cmn-in 0.16s ease-out;
}
@keyframes cmn-in {
    from { transform: translateY(-8px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
}
.cmn-toast.cmn-success { border-left-color: #4caf50; }
.cmn-toast.cmn-info    { border-left-color: #6ba6ff; }
.cmn-toast.cmn-warn    { border-left-color: #e0a83a; }
.cmn-toast.cmn-error   { border-left-color: #e0533a; }
.cmn-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
}
.cmn-text {
    flex: 1;
    min-width: 0;
    word-break: break-word;
}
.cmn-summary { font-weight: 600; }
.cmn-detail  { color: #b8b8c0; margin-top: 2px; white-space: pre-wrap; }
.cmn-close {
    background: transparent;
    color: #aaa;
    border: none;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
}
.cmn-close:hover { color: #fff; }
.cmn-actions { display: flex; gap: 8px; }
.cmn-copy {
    background: #2a2a36;
    color: #d8d8e0;
    border: 1px solid #3a3a44;
    border-radius: 5px;
    /* Touch-first: comfortable tap target, 13px text. */
    min-height: 32px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.cmn-copy:hover  { background: #34343f; color: #fff; }
.cmn-copy.cmn-copied { background: #2f4a30; border-color: #4caf50; color: #cfe8d0; }
`;

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function ensureContainer(): HTMLElement {
  let c = document.getElementById(CONTAINER_ID);
  if (!c) {
    c = document.createElement("div");
    c.id = CONTAINER_ID;
    c.className = "cmn-container";
    document.body.appendChild(c);
  }
  return c;
}

/**
 * Raise a notification toast. Error/warning toasts carry a one-tap Copy button
 * (summary + detail). No-op (logs to console) when DOM is unavailable.
 *
 * @param opts See {@link NotifyOptions}.
 * @returns A controller, or `null` if DOM is unavailable.
 */
export function notify(opts: NotifyOptions): NotifyController | null {
  const { severity, summary, detail } = opts;
  if (typeof document === "undefined" || !document.body) {
    console.info(`[notify] ${severity}: ${summary}${detail ? ` — ${detail}` : ""}`);
    return null;
  }
  ensureStyle();
  const container = ensureContainer();

  const life = opts.life ?? defaultLife(severity);
  const copyable = opts.copyable ?? defaultCopyable(severity);

  const toast = document.createElement("div");
  toast.className = `cmn-toast cmn-${severity}`;
  toast.setAttribute("role", severity === "error" ? "alert" : "status");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (timer) clearTimeout(timer);
    toast.remove();
    if (container.childElementCount === 0) container.remove();
  };

  // Row: text + close button
  const row = document.createElement("div");
  row.className = "cmn-row";
  const text = document.createElement("div");
  text.className = "cmn-text";
  const summaryEl = document.createElement("div");
  summaryEl.className = "cmn-summary";
  summaryEl.textContent = summary;
  text.appendChild(summaryEl);
  if (detail) {
    const detailEl = document.createElement("div");
    detailEl.className = "cmn-detail";
    detailEl.textContent = detail;
    text.appendChild(detailEl);
  }
  const closeBtn = document.createElement("button");
  closeBtn.className = "cmn-close";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.title = "Dismiss";
  closeBtn.addEventListener("click", close);
  row.append(text, closeBtn);
  toast.appendChild(row);

  // Copy action (warn/error by default)
  if (copyable) {
    const actions = document.createElement("div");
    actions.className = "cmn-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "cmn-copy";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(notifyClipboardText(summary, detail));
      copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
      copyBtn.classList.toggle("cmn-copied", ok);
      // Restore the label so a second copy is obvious.
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("cmn-copied");
      }, 1500);
    });
    actions.appendChild(copyBtn);
    toast.appendChild(actions);
  }

  container.appendChild(toast);

  if (life > 0) {
    timer = setTimeout(close, life);
  }

  return { close, el: toast };
}
