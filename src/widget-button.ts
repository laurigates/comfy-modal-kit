// widget-button.ts — the "Strategy B" button-widget helper.
//
// Every widget-intercepting pack keeps an explicit button widget as the
// guaranteed click path in case the version-sensitive onPointerDown hook
// breaks. The append logic was vendored verbatim across packs; it lives here
// now. Dedupe (add-at-most-once-per-node) stays caller-owned — packs already
// carry their own guard flags.
//
// WORKFLOW-CORRUPTION HAZARD — why the button must be LAST and serialize:false
// set on the widget itself:
//   The frontend serializes/restores `widgets_values` keyed on
//   `widget.serialize` (the flag ON the widget), NOT `widget.options.serialize`
//   (all the addWidget option sets). It must be set directly, or the button is
//   treated as serializable.
//   Even with serialize:false, the SAVE loop assigns `widgets_values[rawIndex]`
//   while the RESTORE loop is compacting — so a skipped (serialize:false)
//   widget placed BEFORE real widgets leaves a hole (a leading `null`) on save
//   that shifts every value by one on the next open. Keeping the button at the
//   END keeps the skipped slot past all real values, so the array stays dense
//   and workflows round-trip intact.

interface ButtonWidgetLike {
  serialize?: boolean;
}

/** The node subset {@link appendButtonWidget} touches (structural — the real
 *  LGraphNode interface is un-exported by the frontend). */
export interface ButtonWidgetHost {
  addWidget?: (
    type: "button",
    label: string,
    value: null,
    callback: () => void,
    options: { serialize: boolean },
  ) => ButtonWidgetLike | undefined;
  widgets?: ButtonWidgetLike[];
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void;
}

/**
 * Append a non-serialized button widget to `node`, kept as the LAST widget
 * (see the hazard note above). `onClick` failures and `addWidget` failures
 * are swallowed with a console.warn (prefixed with `opts.logPrefix`) — the
 * button is an additive safety net and must never break node creation.
 */
export function appendButtonWidget(
  node: ButtonWidgetHost,
  label: string,
  onClick: () => void,
  opts: { logPrefix?: string } = {},
): void {
  const prefix = opts.logPrefix ? `[${opts.logPrefix}]` : "[comfy-modal-kit]";
  try {
    const btn = node.addWidget?.(
      "button",
      label,
      null,
      () => {
        try {
          onClick();
        } catch (e) {
          console.warn(`${prefix} open from button failed`, e);
        }
      },
      { serialize: false },
    );
    if (btn) btn.serialize = false;
    if (btn && node.widgets) {
      const idx = node.widgets.indexOf(btn);
      if (idx !== -1 && idx !== node.widgets.length - 1) {
        node.widgets.splice(idx, 1);
        node.widgets.push(btn);
      }
    }
    node.setDirtyCanvas?.(true, true);
  } catch (e) {
    console.warn(`${prefix} addWidget(button) failed`, e);
  }
}
