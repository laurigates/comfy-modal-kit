// @laurigates/comfy-modal-kit — shared modal primitives for ComfyUI packs.
//
// Single source of truth for the modal-shell + modal-fuzzy primitives that
// were previously vendored byte-identically across several ComfyUI custom-node
// packs. Consuming packs `bun add @laurigates/comfy-modal-kit` and import from
// here; their `bun build` inlines the code into their served web/dist bundle.

export {
  type FieldControl,
  type FieldControlContext,
  type FieldProvider,
  type FieldWidgetLike,
  getFieldProviders,
  registerFieldProvider,
  resolveFieldProvider,
} from "./field-registry.js";
export {
  type ActiveModalHandle,
  claimPointer,
  dismissActiveModal,
  getActiveModal,
  installPointerGuard,
  isModalActive,
  type PointerPatchableWidget,
  patchWidgetPointer,
  setActiveModal,
  type WidgetPointerOpener,
  type WidgetPointerPatch,
} from "./modal-coordinator.js";
export {
  type FuzzyRankResult,
  type FuzzyScoreResult,
  fuzzyRank,
  fuzzyScore,
  highlightMatches,
} from "./modal-fuzzy.js";
export {
  copyTextToClipboard,
  defaultCopyable,
  defaultLife,
  type NotifyController,
  type NotifyOptions,
  type NotifySeverity,
  notify,
  notifyClipboardText,
} from "./modal-notify.js";
export {
  applyStars,
  nextRating,
  postRating,
  type RatingAddress,
  ratingOf,
  ratingRequestBody,
  starsHTML,
  warnRating,
} from "./modal-rating.js";
export {
  closeModalShell,
  type ModalShellController,
  type ModalShellOptions,
  openModalShell,
} from "./modal-shell.js";
