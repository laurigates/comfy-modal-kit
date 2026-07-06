// shell-overlay.ts — lightweight overlays INSIDE an open modal shell
// (confirm / text prompt / custom card).
//
// The kit enforces single-modal discipline: opening a second openModalShell
// would dismiss the first. So secondary prompts (delete confirm, rename input,
// a destination picker) render as an absolutely positioned overlay INSIDE the
// shell's dialog element, self-contained and touch-first (16px inputs, big
// tap targets). Extracted from comfyui-image-browser's overlay module; also
// replaces comfyui-touch-manager's window-capture confirm variant (that one
// suppressed OTHER extensions' window-level key handling — rejected, see
// ADR-0002).
//
// While an overlay is up we SUSPEND the shell's own ESC handler: the shell
// binds `document` keydown in the capture phase at open time, so it would
// otherwise fire first and close the whole shell instead of just the overlay.
// We remove `controller._onKey` on open and restore it on close.
//
// CSS is namespaced under `.cmp-ov-*`, injected via ensureStyleOnce.

import type { ModalShellController } from "./modal-shell.js";
import { ensureStyleOnce } from "./style-inject.js";

const STYLE_ID = "cmp-overlay-style";

const CSS = `
.cmp-ov-backdrop {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    touch-action: manipulation;
}
.cmp-ov-card {
    background: #1c1c24;
    border: 1px solid #33333f;
    border-radius: 10px;
    padding: 18px;
    width: min(520px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.cmp-ov-title { font-size: 15px; font-weight: 600; color: #e8e8ec; }
.cmp-ov-msg { font-size: 13px; color: #b8b8c0; line-height: 1.5; word-break: break-word; }
.cmp-ov-input {
    font-size: 16px;
    padding: 10px 12px;
    background: #12121a;
    border: 1px solid #3a3a44;
    border-radius: 6px;
    color: #e8e8ec;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
.cmp-ov-input:focus { outline: none; border-color: #6ba6ff; }
.cmp-ov-err { font-size: 12px; color: #ff7a7a; min-height: 14px; }
.cmp-ov-actions { display: flex; justify-content: flex-end; gap: 8px; }
.cmp-ov-btn {
    font-size: 13px;
    padding: 9px 16px;
    border-radius: 6px;
    border: 1px solid #3a3a44;
    background: #2a2a36;
    color: #d8d8dc;
    cursor: pointer;
    font-family: inherit;
    min-height: 38px;
}
.cmp-ov-btn:hover { background: #3a3a4a; color: #fff; }
.cmp-ov-primary { background: #2f3a52; color: #9ec6ff; border-color: #4a5878; }
.cmp-ov-primary:hover { background: #3a4868; color: #fff; }
.cmp-ov-danger { background: #4a2230; color: #ff9eb0; border-color: #78384a; }
.cmp-ov-danger:hover { background: #5c2a3c; color: #fff; }
`;

/** Handle returned by {@link openShellOverlay}. */
export interface ShellOverlayHandle {
  /** The card element to append custom content into. */
  card: HTMLElement;
  /** Tear down the overlay (restores the shell's ESC handler). */
  close: () => void;
}

/**
 * Open a bare overlay over the shell's dialog and return its content card +
 * a closer. ESC and a backdrop tap both invoke `onDismiss` (if given) then
 * close. The shell's own ESC handler is suspended while the overlay is up.
 */
export function openShellOverlay(
  shell: ModalShellController,
  opts: { onDismiss?: () => void } = {},
): ShellOverlayHandle {
  ensureStyleOnce(STYLE_ID, CSS);
  const backdrop = document.createElement("div");
  backdrop.className = "cmp-ov-backdrop";

  const card = document.createElement("div");
  card.className = "cmp-ov-card";
  backdrop.appendChild(card);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    }
  };

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    // Restore the shell's ESC handler (suspended below while we were up).
    document.addEventListener("keydown", shell._onKey, true);
    backdrop.remove();
  }
  function dismiss(): void {
    opts.onDismiss?.();
    close();
  }

  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) dismiss();
  });
  document.removeEventListener("keydown", shell._onKey, true);
  document.addEventListener("keydown", onKey, true);

  shell.dialog.appendChild(backdrop);
  return { card, close };
}

/** Options for {@link confirmInShell}. */
export interface ConfirmInShellOptions {
  title: string;
  message: string;
  /** Confirm button text. Defaults to "OK". */
  confirmLabel?: string;
  /** Cancel button text. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as destructive (`.cmp-ov-danger`). */
  danger?: boolean;
  /** Let Enter (anywhere in the overlay) resolve true. Defaults to false. */
  enterConfirms?: boolean;
}

/**
 * Ask a yes/no question in an in-shell overlay. Resolves true on confirm,
 * false on cancel or dismiss (ESC / backdrop tap).
 */
export function confirmInShell(
  shell: ModalShellController,
  opts: ConfirmInShellOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    const ov = openShellOverlay(shell, { onDismiss: () => resolve(false) });
    const h = document.createElement("div");
    h.className = "cmp-ov-title";
    h.textContent = opts.title;
    const p = document.createElement("div");
    p.className = "cmp-ov-msg";
    p.textContent = opts.message;
    const row = document.createElement("div");
    row.className = "cmp-ov-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cmp-ov-btn";
    cancel.textContent = opts.cancelLabel || "Cancel";
    cancel.addEventListener("click", () => {
      ov.close();
      resolve(false);
    });

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = opts.danger ? "cmp-ov-btn cmp-ov-danger" : "cmp-ov-btn cmp-ov-primary";
    ok.textContent = opts.confirmLabel || "OK";
    const confirm = () => {
      ov.close();
      resolve(true);
    };
    ok.addEventListener("click", confirm);
    if (opts.enterConfirms) {
      ov.card.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          confirm();
        }
      });
    }

    row.append(cancel, ok);
    ov.card.append(h, p, row);
    ok.focus();
  });
}

/** Options for {@link promptInShell}. */
export interface PromptInShellOptions {
  title: string;
  /** aria-label for the input. */
  label?: string;
  /** Prefill value (selected on focus). */
  value?: string;
  /** Confirm button text. Defaults to "OK". */
  confirmLabel?: string;
  /** Return an error string to block submit, or null when valid. */
  validate?: (v: string) => string | null;
}

/**
 * Ask for a line of text in an in-shell overlay. Resolves the trimmed value
 * on confirm, or null on cancel / dismiss. An empty value (or a `validate`
 * error) blocks submit and shows the error inline.
 */
export function promptInShell(
  shell: ModalShellController,
  opts: PromptInShellOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = openShellOverlay(shell, { onDismiss: () => resolve(null) });
    const h = document.createElement("div");
    h.className = "cmp-ov-title";
    h.textContent = opts.title;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "cmp-ov-input";
    input.value = opts.value || "";
    if (opts.label) input.setAttribute("aria-label", opts.label);

    const errEl = document.createElement("div");
    errEl.className = "cmp-ov-err";

    const row = document.createElement("div");
    row.className = "cmp-ov-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cmp-ov-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      ov.close();
      resolve(null);
    });
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "cmp-ov-btn cmp-ov-primary";
    ok.textContent = opts.confirmLabel || "OK";

    function submit(): void {
      const v = input.value.trim();
      const err = opts.validate?.(v) ?? (v ? null : "Value required");
      if (err) {
        errEl.textContent = err;
        return;
      }
      ov.close();
      resolve(v);
    }
    ok.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    row.append(cancel, ok);
    ov.card.append(h, input, errEl, row);
    input.focus();
    input.select();
  });
}
