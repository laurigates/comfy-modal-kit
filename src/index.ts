// @laurigates/comfy-modal-kit — shared modal primitives for ComfyUI packs.
//
// Single source of truth for the modal-shell + modal-fuzzy primitives that
// were previously vendored byte-identically across several ComfyUI custom-node
// packs. Consuming packs `bun add @laurigates/comfy-modal-kit` and import from
// here; their `bun build` inlines the code into their served web/dist bundle.

export { installBackGuard } from "./back-guard.js";
export { escapeHTML } from "./escape-html.js";
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
  type GalleryFile,
  isValidSort,
  SORT_OPTIONS,
  type SortOption,
  sortFiles,
} from "./gallery-file.js";
export {
  HUB_ICON,
  HUB_LABEL,
  type HubEntryOptions,
  installHubButton,
  makeHubEntry,
  openTouchToolsHub,
} from "./hub.js";
export {
  getHubEntries,
  getHubToggles,
  type HubEntry,
  type HubToggle,
  registerHubEntry,
  registerHubToggle,
} from "./hub-registry.js";
export {
  FAMILY_MENU_PATH,
  FAMILY_SETTINGS_CATEGORY,
  type LauncherFields,
  type LauncherOptions,
  makeLauncher,
} from "./launcher.js";
export { installLazyMedia, type LazyMediaOptions } from "./lazy-media.js";
export {
  type ActiveModalHandle,
  claimPointer,
  dismissActiveModal,
  getActiveModal,
  installPointerGuard,
  isModalActive,
  isModalChrome,
  type PointerPatchableWidget,
  patchWidgetPointer,
  registerModalChrome,
  setActiveModal,
  unregisterModalChrome,
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
export {
  getModelPickers,
  type ModelPicker,
  type ModelPickerControl,
  type ModelPickerRequest,
  type ModelSummaryRequest,
  registerModelPicker,
  resolveModelPicker,
} from "./model-picker-registry.js";
export {
  ensureSafeViewStyle,
  isSafeViewActive,
  isSensitive,
  makeRevealButton,
  makeRevealSet,
  notifySafeViewChange,
  onSafeViewChange,
  type PromptVerdict,
  parseKeywords,
  type RevealButtonOptions,
  type RevealSet,
  readSafeViewConfig,
  registerSafeViewHubToggle,
  SAFE_VIEW_BLUR_CLASS,
  SAFE_VIEW_DEFAULT_KEYWORDS,
  SAFE_VIEW_DEFAULTS,
  SAFE_VIEW_GLYPH_OFF,
  SAFE_VIEW_GLYPH_ON,
  SAFE_VIEW_SETTINGS,
  SAFE_VIEW_SPOILER_CLASS,
  type SafeViewConfig,
  type SafeViewSettingHost,
  type SafeViewSettingParam,
  type SafeViewTarget,
  safeViewSettingHost,
  safeViewSettings,
  setBlurred,
  setSpoilered,
  toggleSafeView,
  tokenize,
} from "./safe-view.js";
export {
  type ConfirmInShellOptions,
  confirmInShell,
  openShellOverlay,
  type PromptInShellOptions,
  promptInShell,
  type ShellOverlayHandle,
} from "./shell-overlay.js";
export { ensureStyleOnce } from "./style-inject.js";
export { appendButtonWidget, type ButtonWidgetHost } from "./widget-button.js";
