// hub.ts — the family's ONE action-bar button, and the chooser behind it.
//
// Each pack that opens a standalone modal from the app chrome used to add its
// own topbar button. On a phone that is a row of 28px icons competing for the
// same scarce corner. This module collapses them into a single "Touch Tools"
// button: whichever inlined kit copy calls installHubButton() first claims it
// for the whole page, and every pack contributes a ROW to the chooser it opens
// (see hub-registry.ts).
//
// Three shapes here, and the split between them is load-bearing:
//
//   makeHubEntry()      per-pack: command + Extensions>Touch Tools menu item,
//                       and the chooser row object. NO action-bar button.
//   installHubButton()  page-global: the one button. Returns ONLY
//                       `actionBarButtons`, so the two results are KEY-DISJOINT
//                       and a pack can spread them as siblings:
//                           ...entry,
//                           ...installHubButton(),
//                       If this function also returned `commands` /
//                       `menuCommands`, the later spread would win those keys
//                       and silently orphan the pack's command: the menu row
//                       vanishes (`menuItemStore.ts:90-97` filters
//                       menuCommand.commands against extension.commands ids)
//                       and a user keybinding on the orphaned id is re-added at
//                       boot with NO isRegistered gate
//                       (`keybindingService.ts:116-124`), squatting its combo
//                       and throwing on press (`commandStore.ts:110`).
//   openTouchToolsHub() the chooser modal itself.
//
// WHERE ROWS ARE REGISTERED. A pack calls registerHubEntry() from its
// extension's setup(), NOT at module evaluation. `invokeExtensionsAsync`
// iterates `enabledExtensions` (`extensionService.ts:214`), but
// `registerExtension` runs for every loaded extension and every extension file
// is imported regardless of the disable list (`extensionService.ts:55-67`,
// `extensionStore.ts:67-72`). Registering at module evaluation would therefore
// list packs the user has DISABLED. Registering in setup() drops them
// automatically.
//
// The surviving asymmetry, accepted and documented: the hub BUTTON still
// renders even when its owning extension is disabled, because
// `actionBarButtonStore` reads `extensions`, not `enabledExtensions`
// (`actionBarButtonStore.ts:11-13`). That is harmless — the chooser is inlined
// kit code and works regardless of which pack owns the button, and the disabled
// pack's own row is absent because rows register in setup().
//
// CSS IS A CROSS-VERSION CONTRACT. `ensureStyleOnce` dedupes by DOM id, so on a
// page running mixed kit versions the FIRST loaded copy's chooser CSS styles
// everyone's chooser. Keep the id stable at `cmk-hub-style` and treat the
// `.cmk-hub-*` class names as additive-only — do not casually rename
// `.cmk-hub-row`.

import { installBackGuard } from "./back-guard.js";
import { getHubEntries, getHubToggles, type HubEntry } from "./hub-registry.js";
import { getKit } from "./kit-global.js";
import type { LauncherFields, LauncherOptions } from "./launcher.js";
import { makeLauncher } from "./launcher.js";
import { notify } from "./modal-notify.js";
import { type ModalShellController, openModalShell } from "./modal-shell.js";
import { ensureStyleOnce } from "./style-inject.js";

/** The family's one action-bar button label, and the chooser's title. */
export const HUB_LABEL = "Touch Tools";
/** The family's one action-bar button icon (PrimeIcons; `.pi-mobile` ships in primeicons.css). */
export const HUB_ICON = "pi pi-mobile";

const HUB_STYLE_ID = "cmk-hub-style";

/** The core command that opens ComfyUI's own settings dialog. */
const SETTINGS_COMMAND = "Comfy.ShowSettingsDialog";

const HUB_CSS = `
.cmk-hub-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px;
}
.cmk-hub-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    /* >=44px is the family's D02 touch-target floor; 48 for comfort. */
    min-height: 48px;
    padding: 8px 12px;
    background: #21212a;
    color: #e8e8ea;
    border: 1px solid #3a3a44;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    font: inherit;
    touch-action: manipulation;
}
.cmk-hub-row:hover {
    background: #2a2a36;
    border-color: #4a4a58;
}
.cmk-hub-icon {
    font-size: 18px;
    color: #9ec6ff;
    flex-shrink: 0;
    width: 20px;
    text-align: center;
}
.cmk-hub-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.cmk-hub-label {
    font-weight: 600;
    font-size: 14px;
}
.cmk-hub-desc {
    color: #9a9aa4;
    font-size: 12px;
}
.cmk-hub-sep {
    height: 1px;
    background: #2a2a32;
    margin: 8px 4px;
}
.cmk-hub-state {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    background: #2a2a32;
    color: #9a9aa4;
}
.cmk-hub-row[aria-checked="true"] .cmk-hub-state {
    background: #24406b;
    color: #9ec6ff;
}
.cmk-hub-empty {
    color: #9a9aa4;
    font-size: 13px;
    padding: 10px 12px;
}
.cmk-hub-note {
    color: #777;
    font-size: 11px;
    line-height: 1.4;
    padding: 10px 12px 4px;
}
`;

/** makeLauncher's options minus the action-bar knob, plus the hub row's fields. */
export interface HubEntryOptions extends Omit<LauncherOptions, "actionBar"> {
  /** One-line row subtitle in the chooser. */
  description?: string;
  /** Chooser sort priority; higher first, ties keep registration order. */
  priority?: number;
}

/**
 * A pack's family entry point: command + Extensions>Touch Tools menu item.
 * Emits NO action-bar button — the family has exactly one, owned by
 * {@link installHubButton}. Does NOT register the chooser row; call
 * {@link registerHubEntry} from the pack's `setup()` (see the header comment
 * for why setup() and not module evaluation).
 *
 * ```ts
 * const entry = makeHubEntry({ id: "image-browser.open", label: "Image Browser",
 *                              icon: "pi pi-images", open: openImageBrowser });
 * app.registerExtension({
 *   name: "comfy.image-browser",
 *   ...entry,                 // commands + menuCommands
 *   ...installHubButton(),    // actionBarButtons — key-disjoint, safe to spread
 *   setup() { registerHubEntry(entry.hubEntry); },
 * });
 * ```
 */
export function makeHubEntry(opts: HubEntryOptions): LauncherFields & { hubEntry: HubEntry } {
  const fields = makeLauncher({ ...opts, actionBar: false });
  // Reuse the launcher's own guarded safeOpen so the chooser row, the command
  // and the menu entry all share ONE defensive boundary (a throwing opener
  // becomes a copyable error toast, never an exception in ComfyUI's dispatch).
  const hubEntry: HubEntry = {
    id: opts.id,
    label: opts.label,
    icon: opts.icon,
    description: opts.description,
    priority: opts.priority,
    open: fields.commands[0]?.function ?? opts.open,
  };
  return { ...fields, hubEntry };
}

/**
 * Claim the single family action-bar button for this inlined copy.
 *
 * Returns ONLY `actionBarButtons` (or `{}` for every later caller), so the
 * result is key-disjoint from {@link makeHubEntry}'s and the two can be spread
 * as siblings without colliding. Call at MODULE EVALUATION time, before
 * `app.registerExtension` — actionBarButtons must be static at registration.
 *
 * The election is nondeterministic first-caller-wins: extension files are
 * imported with `Promise.all` over an unordered list
 * (`extensionService.ts:55-67`). Every behaviour of this button is therefore
 * owner-independent by construction; do not add tie-breaking, there is nothing
 * stable to break the tie on.
 */
export function installHubButton(): { actionBarButtons?: LauncherFields["actionBarButtons"] } {
  const kit = getKit();
  if (kit.hubLauncherInstalled) return {};
  kit.hubLauncherInstalled = true;
  return {
    actionBarButtons: [
      {
        icon: HUB_ICON,
        label: HUB_LABEL,
        // Not decoration: `ActionBarButtons.vue:10` maps tooltip to aria-label,
        // and :18 drops the visible label below 640px — so on a phone this is
        // the ONLY name assistive tech receives for this button.
        tooltip: "Touch Tools — open a touch-first tool",
        // VERIFIED: ActionBarButtons.vue:14 hard-codes `class="h-7 rounded-full"`
        // (28px) and drops the label below 640px (:18). The compiler folds the
        // static class and `:class="button.class"` (:11) into one normalizeClass
        // array, so tailwind-merge sees both in the same argument and plain
        // `h-11` is STRIPPED. `!h-11` survives the merge and wins the cascade
        // on !important. Measured against the real @comfyorg/tailwind-utils cn().
        class: "!h-11 !min-w-11",
        onClick: () => {
          // Single-entry short-circuit: with one tool registered, the hub must
          // not cost a tap. Read lazily — the click runs long after setup().
          const entries = getHubEntries();
          if (entries.length === 1) {
            try {
              entries[0]?.open();
            } catch (e) {
              console.error("[comfy-modal-kit] hub single-entry open failed", e);
            }
            return;
          }
          openTouchToolsHub();
        },
      },
    ],
  };
}

/** Execute a core command through the frontend's command manager. */
function executeCommand(id: string): void {
  const host = globalThis as {
    app?: { extensionManager?: { command?: { execute(id: string): unknown } } };
  };
  const command = host.app?.extensionManager?.command;
  if (!command) throw new Error(`command manager unavailable (cannot run "${id}")`);
  command.execute(id);
}

/** Build one chooser row. Text goes in via textContent — never innerHTML. */
function makeRow(icon: string, label: string, description: string | undefined): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "cmk-hub-row";

  const iconEl = document.createElement("i");
  iconEl.className = `cmk-hub-icon ${icon}`;

  const text = document.createElement("span");
  text.className = "cmk-hub-text";
  const labelEl = document.createElement("span");
  labelEl.className = "cmk-hub-label";
  labelEl.textContent = label;
  text.append(labelEl);
  if (description) {
    const descEl = document.createElement("span");
    descEl.className = "cmk-hub-desc";
    descEl.textContent = description;
    text.append(descEl);
  }

  row.append(iconEl, text);
  return row;
}

/**
 * Open the Touch Tools chooser. Reads the registry at open time, so a pack
 * whose `setup()` ran after the button was claimed still appears.
 */
export function openTouchToolsHub(): ModalShellController {
  ensureStyleOnce(HUB_STYLE_ID, HUB_CSS);

  let disposeBack: (opts?: { pop?: boolean }) => void = () => {};

  const controller = openModalShell({
    title: HUB_LABEL,
    showSearch: false,
    showFooter: false,
    width: "min(420px, calc(100vw - 24px))",
    // Default pop: the ✕ / ESC / backdrop paths must consume their own sentinel.
    onClose: () => {
      disposeBack();
    },
  });

  disposeBack = installBackGuard(() => {
    // Back dismisses the chooser itself. Returning false tells the guard the
    // sentinel is spent; the shell's onClose above disposes it.
    controller.close();
    return false;
  });

  /**
   * Every row goes through here, and the ORDER is the whole point.
   *
   * The kit's backdrop is `z-index: 9998` and its dialog `9999`
   * (modal-shell.ts:37,46), while PrimeVue is configured `modal: 1800,
   * overlay: 1800` (`main.ts:114-118`) over `MODAL_BASE_Z_INDEX = 1700`
   * (`useModalLiftedZIndex.ts:6`) — and both are fixed children of <body>. So a
   * row that opened ComfyUI's own settings dialog while the chooser was still
   * up would open it BEHIND our scrim: the tap would look like it did nothing.
   *
   * Closing first also means the chooser no longer depends on setActiveModal's
   * replace semantics, so HubEntry.open carries no "must open a kit shell"
   * contract and a row cannot stack a second dialog.
   */
  function runRow(action: () => void): void {
    // Hand-off, not a dismissal: popping here would queue a history traversal
    // that could land after the next modal's own pushState and eat its sentinel.
    disposeBack({ pop: false });
    controller.close(); // synchronous DOM detach — modal-shell.ts:333-335
    setTimeout(() => {
      // Next macrotask: nothing of ours is on screen, so whatever `action`
      // opens is not behind a z-9998 scrim.
      try {
        action();
      } catch (e) {
        console.error("[comfy-modal-kit] hub row action failed", e);
        try {
          notify({ severity: "error", summary: "Could not open that tool", detail: String(e) });
        } catch (n) {
          console.warn("[comfy-modal-kit] notify failed", n);
        }
      }
    }, 0);
  }

  const list = document.createElement("div");
  list.className = "cmk-hub-list";

  const entries = getHubEntries();
  for (const entry of entries) {
    const row = makeRow(entry.icon, entry.label, entry.description);
    row.addEventListener("click", () => runRow(entry.open));
    list.append(row);
  }

  /**
   * Toggle rows, BELOW the tools and deliberately not going through `runRow`.
   *
   * `runRow`'s close-before-act ordering exists because a row that opens
   * ComfyUI's own dialog would otherwise open it behind our z-9998 scrim. A
   * toggle opens nothing, so the reason does not apply — and closing the
   * chooser on every flip would be the worse interaction, since the user
   * flipping a filter is precisely the user who wants to see it flip. It
   * repaints itself in place instead, re-reading `get()` rather than assuming
   * the write took (the value round-trips through ComfyUI's setting store, and
   * a rejected or coerced write must show as unchanged, not as flipped).
   */
  for (const toggle of getHubToggles()) {
    const row = makeRow(toggle.icon, toggle.label, toggle.description);
    row.setAttribute("role", "switch");
    const state = document.createElement("span");
    state.className = "cmk-hub-state";
    row.append(state);

    const paint = (): void => {
      let on = false;
      try {
        on = toggle.get();
      } catch (e) {
        console.error(`[comfy-modal-kit] hub toggle "${toggle.id}" get failed`, e);
      }
      row.setAttribute("aria-checked", on ? "true" : "false");
      state.textContent = on ? "On" : "Off";
    };
    paint();

    row.addEventListener("click", () => {
      try {
        toggle.set(!toggle.get());
      } catch (e) {
        console.error(`[comfy-modal-kit] hub toggle "${toggle.id}" set failed`, e);
        try {
          notify({
            severity: "error",
            summary: `Could not change ${toggle.label}`,
            detail: String(e),
          });
        } catch (n) {
          console.warn("[comfy-modal-kit] notify failed", n);
        }
      }
      paint();
    });
    list.append(row);
  }

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cmk-hub-empty";
    empty.textContent = "No Touch Tools packs registered on this page yet.";
    list.append(empty);
  }

  const sep = document.createElement("div");
  sep.className = "cmk-hub-sep";
  list.append(sep);

  // The Settings row deliberately promises only WHERE the options are, not that
  // tapping jumps to them: `Comfy.ShowSettingsDialog` takes no arguments
  // (`useCoreCommands.ts:592-598` -> `settingsDialog.show()`),
  // `useSettingsDialog().show(panel?, settingId?)` is not reachable from an
  // extension, and `SettingPanelType` is a closed union that cannot name a
  // settings category. The dialog lands on the first core category, and below
  // 880px the category nav is collapsed behind a hamburger
  // (`BaseModalLayout.vue:185,190,201-206`).
  const settingsRow = makeRow(
    "pi pi-cog",
    "Settings",
    "All Touch Tools options, in ComfyUI settings",
  );
  settingsRow.addEventListener("click", () => runRow(() => executeCommand(SETTINGS_COMMAND)));
  list.append(settingsRow);

  const note = document.createElement("div");
  note.className = "cmk-hub-note";
  note.textContent =
    "Other Touch Tools packs work directly on the canvas and its widgets — their options are in Settings.";
  list.append(note);

  controller.bodyEl.append(list);
  return controller;
}
