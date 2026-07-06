// launcher.ts — the family's launcher conventions, in code.
//
// The packs that open a standalone modal from the app chrome each hand-wrote
// the same three registerExtension fields (commands / menuCommands /
// actionBarButtons) with drifting conventions: three command-id casings,
// three icon systems, and per-pack menu paths. makeLauncher builds those
// fields from one declaration so the conventions can't drift (ADR-0002):
//
// - ONE shared submenu (FAMILY_MENU_PATH) so the family's commands share a
//   single home under Extensions. The frontend merges same-path menuCommands
//   from different extensions by label.
// - Kebab command ids ("<pack-short-name>.<action>") — non-conforming ids get
//   a console.warn, never a throw (additive rule).
// - PrimeIcons ("pi pi-*") — the only icon format guaranteed to render for
//   runtime-loaded extensions on all three surfaces.
// - A safe-open wrapper: never let an opener failure bubble into ComfyUI's
//   command/menu/button dispatch; surface it as a copyable error toast.
//
// Pure per-bundle — no kit-global state. The returned fields are structurally
// assignable to the frontend's ComfyExtension fields; a pack pinning an older
// @comfyorg/comfyui-frontend-types may need a cast at the registration
// boundary.

import { notify } from "./modal-notify.js";

/** The family's shared submenu under the app's Extensions menu. */
export const FAMILY_MENU_PATH: readonly string[] = ["Extensions", "Touch Tools"];

const KEBAB_COMMAND_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Options for {@link makeLauncher}. */
export interface LauncherOptions {
  /** Command id, kebab `"<pack-short-name>.<action>"` (e.g. `"image-browser.open"`). */
  id: string;
  /** Command palette / menu label. */
  label: string;
  /** PrimeIcons class (e.g. `"pi pi-images"`). */
  icon: string;
  /** Action-bar tooltip. Falls back to `label`. */
  tooltip?: string;
  /** The raw opener. Wrapped in the safe-open guard. */
  open: () => void;
  /** Error-toast headline when `open` throws. Defaults to `Could not open ${label}`. */
  failSummary?: string;
  /** Menu placement. Defaults to {@link FAMILY_MENU_PATH}. */
  menuPath?: string[];
  /** false = no action-bar button; an object overrides its label/tooltip. Defaults to true. */
  actionBar?: boolean | { label?: string; tooltip?: string };
}

/** The registerExtension fields built by {@link makeLauncher}. */
export interface LauncherFields {
  commands: Array<{ id: string; label: string; icon: string; function: () => void }>;
  menuCommands: Array<{ path: string[]; commands: string[] }>;
  actionBarButtons?: Array<{ icon: string; label?: string; tooltip?: string; onClick: () => void }>;
}

/**
 * Build consistent `commands` / `menuCommands` / `actionBarButtons` fields for
 * `app.registerExtension` from one declaration:
 *
 * ```ts
 * app.registerExtension({
 *   name: "comfy.image-browser",
 *   ...makeLauncher({ id: "image-browser.open", label: "Image Browser",
 *                     icon: "pi pi-images", open: openImageBrowser }),
 * });
 * ```
 */
export function makeLauncher(opts: LauncherOptions): LauncherFields {
  if (!KEBAB_COMMAND_ID.test(opts.id)) {
    console.warn(
      `[comfy-modal-kit] launcher id "${opts.id}" does not match the family convention "<pack-short-name>.<action>" (kebab-case)`,
    );
  }

  const safeOpen = (): void => {
    try {
      opts.open();
    } catch (e) {
      console.error(`[comfy-modal-kit] launcher "${opts.id}" open failed`, e);
      // Surface the tapped-action failure via a copyable popup, not just the
      // devtools trail. Guard notify() itself so a rendering failure can't
      // bubble past this defensive boundary.
      try {
        notify({
          severity: "error",
          summary: opts.failSummary ?? `Could not open ${opts.label}`,
          detail: String(e),
        });
      } catch (notifyErr) {
        console.warn(`[comfy-modal-kit] notify failed`, notifyErr);
      }
    }
  };

  const fields: LauncherFields = {
    commands: [{ id: opts.id, label: opts.label, icon: opts.icon, function: safeOpen }],
    menuCommands: [{ path: [...(opts.menuPath ?? FAMILY_MENU_PATH)], commands: [opts.id] }],
  };

  if (opts.actionBar !== false) {
    const bar = typeof opts.actionBar === "object" ? opts.actionBar : {};
    fields.actionBarButtons = [
      {
        icon: opts.icon,
        ...(bar.label !== undefined ? { label: bar.label } : {}),
        tooltip: bar.tooltip ?? opts.tooltip ?? opts.label,
        onClick: safeOpen,
      },
    ];
  }

  return fields;
}
