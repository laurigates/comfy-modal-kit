// modal-shell.ts — reusable modal dialog shell for ComfyUI custom-node packs.
//
// A bare modal shell, not a picker: backdrop + centered dialog with header
// (title + close), optional toolbar slot, optional search input, scrollable
// body, optional footer. The consumer fills `bodyEl` with whatever DOM and
// event wiring it wants; the shell handles CSS injection, keyboard ESC,
// single-modal-at-a-time discipline, focus, and touch-friendly dismiss.
//
// Single-sourced into @laurigates/comfy-modal-kit. The public surface here
// (the openModalShell options shape + the controller returned) is the
// contract. Keep it stable.
//
// CSS is namespaced under `.cmp-*` ("Comfy Modal Picker"). All ids on
// elements outside the cmp- prefix are explicitly avoided.

import {
  type ActiveModalHandle,
  dismissActiveModal,
  getActiveModal,
  setActiveModal,
} from "./modal-coordinator.js";
import { ensureStyleOnce } from "./style-inject.js";

const STYLE_ID = "cmp-shell-style";

// Single-modal-at-a-time is enforced by the shared modal-coordinator (the
// `activeModal` slot on getKit()), NOT a module-local singleton. Because each
// pack inlines its own copy of this kit, a module-local `let ACTIVE` would be
// per-pack; the coordinator's shared slot makes any pack's open dismiss
// whatever is truly on screen. See modal-coordinator.ts.

const CSS = `
.cmp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 9998;
    backdrop-filter: blur(2px);
    touch-action: manipulation;
}
.cmp-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9999;
    width: min(960px, calc(100vw - 24px));
    max-height: min(85vh, 800px);
    touch-action: manipulation;
    display: flex;
    flex-direction: column;
    background: #1a1a1f;
    color: #e8e8ea;
    border: 1px solid #3a3a44;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    overflow: hidden;
}
.cmp-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid #2a2a32;
    background: #21212a;
    flex-shrink: 0;
}
.cmp-title {
    flex: 1;
    font-weight: 600;
    color: #9ec6ff;
    font-size: 14px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cmp-subtitle {
    color: #888;
    font-weight: 400;
    font-size: 12px;
    margin-left: 6px;
}
.cmp-close {
    background: transparent;
    color: #aaa;
    border: 1px solid #3a3a44;
    border-radius: 4px;
    width: 36px;
    height: 36px;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
}
.cmp-close:hover {
    background: #2a2a32;
    color: #fff;
}
.cmp-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 14px;
    border-bottom: 1px solid #2a2a32;
    background: #1f1f26;
    flex-shrink: 0;
}
.cmp-toolbar:empty {
    display: none;
}
.cmp-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid #2a2a32;
    flex-shrink: 0;
}
.cmp-search {
    flex: 1;
    background: #12121a;
    border: 1px solid #3a3a44;
    border-radius: 4px;
    color: #e8e8ea;
    padding: 8px 12px;
    /* 16px prevents iOS auto-zoom on focus. */
    font-size: 16px;
    font-family: inherit;
    outline: none;
    min-width: 0;
}
.cmp-search:focus {
    border-color: #6ba6ff;
}
.cmp-status {
    color: #888;
    font-size: 12px;
    white-space: nowrap;
}
.cmp-body {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 8px;
    position: relative;
}
.cmp-body.is-busy {
    opacity: 0.5;
    pointer-events: none;
}
.cmp-footer {
    padding: 8px 14px;
    border-top: 1px solid #2a2a32;
    color: #777;
    font-size: 11px;
    background: #1f1f26;
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    gap: 12px;
}
.cmp-footer:empty {
    display: none;
}
.cmp-footer kbd {
    background: #2a2a36;
    border: 1px solid #3a3a44;
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: #b8b8c0;
}
`;

/** Options for {@link openModalShell}. All fields are optional. */
export interface ModalShellOptions {
  /** Header title text. */
  title?: string;
  /** Greyed-out suffix in the header (e.g. widget name). */
  subtitle?: string;
  /** Search input placeholder. Falls back to "Filter…". */
  placeholder?: string;
  /** Show the search row. Defaults to true. */
  showSearch?: boolean;
  /** Show the footer row. Defaults to true. */
  showFooter?: boolean;
  /** Inner HTML for the footer's left cell. */
  footerLeftHTML?: string;
  /** Inner HTML for the footer's right cell. */
  footerRightHTML?: string;
  /** CSS for `.cmp-dialog` width. Overrides default. */
  width?: string;
  /** CSS for `.cmp-dialog` max-height. Overrides default. */
  height?: string;
  /** Forwarded after the shell handles ESC. */
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Called once after dismiss (both user- and programmatic-close). */
  onClose?: () => void;
}

/** Controller returned by {@link openModalShell}. */
export interface ModalShellController {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  headerEl: HTMLElement;
  toolbarEl: HTMLElement;
  searchEl: HTMLInputElement;
  statusEl: HTMLElement;
  bodyEl: HTMLElement;
  footerEl: HTMLElement;
  /** Toggle the body's busy (dimmed, non-interactive) state. */
  setBusy: (b: boolean) => void;
  /** Set the status text shown next to the search input. */
  setStatus: (s: string) => void;
  /** Programmatically close this shell. */
  close: () => void;
  /** @internal Keydown handler reference, used for teardown. */
  _onKey: (e: KeyboardEvent) => void;
  /** The options the shell was opened with. */
  opts: ModalShellOptions;
}

/**
 * Open a modal shell.
 *
 * @param opts Shell configuration. See {@link ModalShellOptions}.
 * @returns A controller exposing the shell's DOM elements and lifecycle.
 */
export function openModalShell(opts: ModalShellOptions = {}): ModalShellController {
  ensureStyleOnce(STYLE_ID, CSS);

  const backdrop = document.createElement("div");
  backdrop.className = "cmp-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "cmp-dialog";
  if (opts.width) dialog.style.width = opts.width;
  if (opts.height) dialog.style.maxHeight = opts.height;
  // Keep clicks inside the dialog from reaching the canvas.
  const stop = (e: Event) => e.stopPropagation();
  for (const ev of ["pointerdown", "pointerup", "click", "dblclick", "wheel"]) {
    dialog.addEventListener(ev, stop);
  }

  // Header
  const headerEl = document.createElement("div");
  headerEl.className = "cmp-header";
  const titleEl = document.createElement("div");
  titleEl.className = "cmp-title";
  titleEl.textContent = opts.title || "";
  if (opts.subtitle) {
    const sub = document.createElement("span");
    sub.className = "cmp-subtitle";
    sub.textContent = opts.subtitle;
    titleEl.appendChild(sub);
  }
  const closeBtn = document.createElement("button");
  closeBtn.className = "cmp-close";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.title = "Close (Esc)";
  headerEl.append(titleEl, closeBtn);

  // Toolbar (always present but hidden when empty via :empty selector)
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "cmp-toolbar";

  // Search row
  const searchRow = document.createElement("div");
  searchRow.className = "cmp-searchrow";
  const searchEl = document.createElement("input");
  searchEl.type = "search";
  searchEl.className = "cmp-search";
  searchEl.placeholder = opts.placeholder || "Filter…";
  searchEl.spellcheck = false;
  searchEl.autocomplete = "off";
  const statusEl = document.createElement("div");
  statusEl.className = "cmp-status";
  searchRow.append(searchEl, statusEl);
  if (opts.showSearch === false) searchRow.style.display = "none";

  // Body
  const bodyEl = document.createElement("div");
  bodyEl.className = "cmp-body";

  // Footer
  const footerEl = document.createElement("div");
  footerEl.className = "cmp-footer";
  if (opts.showFooter !== false) {
    const l = document.createElement("div");
    if (opts.footerLeftHTML) l.innerHTML = opts.footerLeftHTML;
    const r = document.createElement("div");
    if (opts.footerRightHTML) r.innerHTML = opts.footerRightHTML;
    footerEl.append(l, r);
  } else {
    footerEl.style.display = "none";
  }

  dialog.append(headerEl, toolbarEl, searchRow, bodyEl, footerEl);

  // Idempotent DOM teardown. The coordinator clears the shared activeModal
  // slot BEFORE invoking this, so teardown never re-enters the coordinator.
  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    try {
      backdrop.remove();
      dialog.remove();
      document.removeEventListener("keydown", onKey, true);
    } finally {
      try {
        opts.onClose?.();
      } catch (e) {
        console.warn("[modal-shell] onClose threw", e);
      }
    }
  };

  const handle: ActiveModalHandle = { id: "modal-shell", element: dialog, close: teardown };

  // User-initiated dismiss (backdrop tap, ESC, close button, public close()).
  // Route through the coordinator when this shell is the active modal so the
  // shared slot clears; otherwise it was already superseded, so tear down the
  // now-orphaned DOM directly.
  const requestClose = (): void => {
    if (getActiveModal() === handle) {
      dismissActiveModal();
    } else {
      teardown();
    }
  };

  // pointerdown, not click — on touch, the synthetic click that follows
  // touchend (~300ms) would re-fire on the just-mounted backdrop and dismiss
  // immediately. Pointerdown is not re-synthesized.
  backdrop.addEventListener("pointerdown", requestClose);
  closeBtn.addEventListener("click", requestClose);

  // Keyboard
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }
    try {
      opts.onKeyDown?.(e);
    } catch (err) {
      console.warn("[modal-shell] onKeyDown threw", err);
    }
  };
  document.addEventListener("keydown", onKey, true);

  document.body.append(backdrop, dialog);

  const controller: ModalShellController = {
    backdrop,
    dialog,
    headerEl,
    toolbarEl,
    searchEl,
    statusEl,
    bodyEl,
    footerEl,
    setBusy(b: boolean) {
      bodyEl.classList.toggle("is-busy", !!b);
    },
    setStatus(s: string) {
      statusEl.textContent = s || "";
    },
    close: requestClose,
    _onKey: onKey,
    opts,
  };

  // Register as the single active modal (dismisses any prior modal, across
  // packs, and installs the window pointer guard).
  setActiveModal(handle);

  // Defer focus until after the originating tap event settles, so iOS
  // doesn't fight with the soft keyboard.
  if (opts.showSearch !== false) {
    requestAnimationFrame(() => {
      // Re-check in case the caller closed synchronously.
      if (getActiveModal() === handle) searchEl.focus();
    });
  }

  return controller;
}

/** Programmatically close any currently-open shell. No-op if none. */
export function closeModalShell(): void {
  dismissActiveModal();
}
