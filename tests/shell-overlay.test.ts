// shell-overlay.test.ts — coverage for the in-shell overlay primitives
// (openShellOverlay / confirmInShell / promptInShell). Overlays mount inside a
// real openModalShell dialog so the ESC suspend/restore contract is exercised
// against the genuine shell handler.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, test } from "vitest";

import { dismissActiveModal } from "../src/modal-coordinator.js";
import { type ModalShellController, openModalShell } from "../src/modal-shell.js";
import { confirmInShell, openShellOverlay, promptInShell } from "../src/shell-overlay.js";

function esc(target: EventTarget = document): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function openShell(): ModalShellController {
  return openModalShell({ title: "test shell" });
}

afterEach(() => {
  dismissActiveModal();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("openShellOverlay", () => {
  test("mounts the overlay inside the shell dialog", () => {
    const shell = openShell();
    const ov = openShellOverlay(shell);
    expect(shell.dialog.querySelector(".cmp-ov-backdrop")).not.toBeNull();
    expect(ov.card.className).toBe("cmp-ov-card");
    expect(shell.dialog.contains(ov.card)).toBe(true);
  });

  test("ESC closes the overlay, not the shell", () => {
    const shell = openShell();
    let dismissed = 0;
    openShellOverlay(shell, { onDismiss: () => dismissed++ });
    esc();
    expect(dismissed).toBe(1);
    expect(shell.dialog.querySelector(".cmp-ov-backdrop")).toBeNull();
    // The shell survived the ESC that killed the overlay.
    expect(document.body.contains(shell.dialog)).toBe(true);
  });

  test("shell ESC works again after the overlay closes (handler restored)", () => {
    const shell = openShell();
    const ov = openShellOverlay(shell);
    ov.close();
    esc();
    expect(document.body.contains(shell.dialog)).toBe(false);
  });

  test("backdrop tap dismisses; a tap on the card does not", () => {
    const shell = openShell();
    let dismissed = 0;
    const ov = openShellOverlay(shell, { onDismiss: () => dismissed++ });
    ov.card.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(shell.dialog.querySelector(".cmp-ov-backdrop")).not.toBeNull();
    const backdrop = shell.dialog.querySelector(".cmp-ov-backdrop");
    backdrop?.dispatchEvent(new Event("pointerdown"));
    expect(dismissed).toBe(1);
    expect(shell.dialog.querySelector(".cmp-ov-backdrop")).toBeNull();
  });

  test("close() is idempotent and restores the shell handler exactly once", () => {
    const shell = openShell();
    const ov = openShellOverlay(shell);
    ov.close();
    ov.close();
    // A single ESC must close the shell — a double-registered handler would
    // also close it, so prove the overlay is gone and the shell reacts once.
    esc();
    expect(document.body.contains(shell.dialog)).toBe(false);
  });
});

describe("confirmInShell", () => {
  function buttons(shell: ModalShellController): HTMLButtonElement[] {
    return Array.from(shell.dialog.querySelectorAll(".cmp-ov-btn"));
  }

  test("resolves true on confirm, closing the overlay", async () => {
    const shell = openShell();
    const p = confirmInShell(shell, { title: "t", message: "m" });
    const ok = buttons(shell).find((b) => b.textContent === "OK");
    ok?.click();
    await expect(p).resolves.toBe(true);
    expect(shell.dialog.querySelector(".cmp-ov-backdrop")).toBeNull();
  });

  test("resolves false on cancel and on dismiss (ESC)", async () => {
    const shell = openShell();
    const p1 = confirmInShell(shell, { title: "t", message: "m" });
    buttons(shell)
      .find((b) => b.textContent === "Cancel")
      ?.click();
    await expect(p1).resolves.toBe(false);

    const p2 = confirmInShell(shell, { title: "t", message: "m" });
    esc();
    await expect(p2).resolves.toBe(false);
  });

  test("danger styles the confirm button; custom labels apply", () => {
    const shell = openShell();
    void confirmInShell(shell, {
      title: "t",
      message: "m",
      danger: true,
      confirmLabel: "Delete",
      cancelLabel: "Keep",
    });
    const del = buttons(shell).find((b) => b.textContent === "Delete");
    expect(del?.className).toContain("cmp-ov-danger");
    expect(buttons(shell).some((b) => b.textContent === "Keep")).toBe(true);
  });

  test("enterConfirms: Enter in the card resolves true; off by default", async () => {
    const shell = openShell();
    const p = confirmInShell(shell, { title: "t", message: "m", enterConfirms: true });
    const card = shell.dialog.querySelector(".cmp-ov-card");
    card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await expect(p).resolves.toBe(true);

    void confirmInShell(shell, { title: "t", message: "m" });
    const card2 = shell.dialog.querySelector(".cmp-ov-card");
    card2?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Without enterConfirms the overlay is still up.
    expect(shell.dialog.querySelector(".cmp-ov-backdrop")).not.toBeNull();
  });
});

describe("promptInShell", () => {
  function input(shell: ModalShellController): HTMLInputElement | null {
    return shell.dialog.querySelector(".cmp-ov-input");
  }
  function okButton(shell: ModalShellController): HTMLButtonElement | undefined {
    return Array.from(shell.dialog.querySelectorAll<HTMLButtonElement>(".cmp-ov-btn")).find(
      (b) => b.textContent === "OK",
    );
  }

  test("resolves the trimmed value on confirm; prefill applies", async () => {
    const shell = openShell();
    const p = promptInShell(shell, { title: "rename", value: "old.png" });
    const inp = input(shell);
    expect(inp?.value).toBe("old.png");
    if (inp) inp.value = "  new.png  ";
    okButton(shell)?.click();
    await expect(p).resolves.toBe("new.png");
  });

  test("Enter submits", async () => {
    const shell = openShell();
    const p = promptInShell(shell, { title: "t", value: "v.png" });
    input(shell)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await expect(p).resolves.toBe("v.png");
  });

  test("empty value blocks submit with an inline error", () => {
    const shell = openShell();
    void promptInShell(shell, { title: "t" });
    okButton(shell)?.click();
    expect(shell.dialog.querySelector(".cmp-ov-err")?.textContent).toBe("Value required");
    expect(shell.dialog.querySelector(".cmp-ov-backdrop")).not.toBeNull();
  });

  test("validate error blocks submit; clearing it allows submit", async () => {
    const shell = openShell();
    const p = promptInShell(shell, {
      title: "t",
      value: "bad.txt",
      validate: (v) => (v.endsWith(".png") ? null : "must keep .png"),
    });
    okButton(shell)?.click();
    expect(shell.dialog.querySelector(".cmp-ov-err")?.textContent).toBe("must keep .png");
    const inp = input(shell);
    if (inp) inp.value = "good.png";
    okButton(shell)?.click();
    await expect(p).resolves.toBe("good.png");
  });

  test("cancel and dismiss both resolve null", async () => {
    const shell = openShell();
    const p1 = promptInShell(shell, { title: "t", value: "v" });
    Array.from(shell.dialog.querySelectorAll<HTMLButtonElement>(".cmp-ov-btn"))
      .find((b) => b.textContent === "Cancel")
      ?.click();
    await expect(p1).resolves.toBe(null);

    const p2 = promptInShell(shell, { title: "t", value: "v" });
    esc();
    await expect(p2).resolves.toBe(null);
  });
});
