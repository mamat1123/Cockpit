// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentProvider } from "../layout/paneLayout";
import { ProviderPicker } from "./ProviderPicker";

describe("ProviderPicker", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function mount(onPick: (p: AgentProvider) => void, onCancel: () => void) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<ProviderPicker context={{ kind: "split" }} onPick={onPick} onCancel={onCancel} />);
    });
    return container;
  }

  it("renders one card per provider, Z.ai disabled", () => {
    const c = mount(() => {}, () => {});
    const cards = Array.from(c.querySelectorAll(".provider-picker__card")) as HTMLButtonElement[];
    expect(cards).toHaveLength(3);
    expect(cards[0].disabled).toBe(false); // claude
    expect(cards[1].disabled).toBe(false); // codex
    expect(cards[2].disabled).toBe(true);  // zai
  });

  it("clicking an enabled card confirms it immediately", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const cards = Array.from(c.querySelectorAll(".provider-picker__card")) as HTMLButtonElement[];
    act(() => cards[1].click());
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith("codex");
  });

  it("clicking the disabled Z.ai card does nothing", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const cards = Array.from(c.querySelectorAll(".provider-picker__card")) as HTMLButtonElement[];
    act(() => cards[2].click());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Escape cancels without picking", () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const c = mount(onPick, onCancel);
    const panel = c.querySelector(".provider-picker__panel") as HTMLElement;
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("pressing 2 confirms Codex directly", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const panel = c.querySelector(".provider-picker__panel") as HTMLElement;
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
    expect(onPick).toHaveBeenCalledWith("codex");
  });

  it("backdrop click cancels", () => {
    const onCancel = vi.fn();
    const c = mount(() => {}, onCancel);
    const backdrop = c.querySelector(".provider-picker") as HTMLElement;
    act(() => backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("ArrowRight moves focus and Enter confirms the focused card", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const panel = c.querySelector(".provider-picker__panel") as HTMLElement;

    // Claude starts focused (focusIdx = 0)
    let focused = c.querySelector(".provider-picker__card.is-focused") as HTMLElement;
    expect(focused.classList.contains("provider-claude")).toBe(true);

    // ArrowRight moves focus to Codex
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    focused = c.querySelector(".provider-picker__card.is-focused") as HTMLElement;
    expect(focused.classList.contains("provider-codex")).toBe(true);

    // Enter confirms Codex
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onPick).toHaveBeenCalledWith("codex");
  });

  it("ArrowRight does not navigate past the last enabled card to Z.ai", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const panel = c.querySelector(".provider-picker__panel") as HTMLElement;

    // Move from Claude to Codex
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    let focused = c.querySelector(".provider-picker__card.is-focused") as HTMLElement;
    expect(focused.classList.contains("provider-codex")).toBe(true);

    // Try to move past Codex (should stay on Codex, not go to Z.ai)
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    focused = c.querySelector(".provider-picker__card.is-focused") as HTMLElement;
    expect(focused.classList.contains("provider-codex")).toBe(true);
    expect(focused.classList.contains("provider-zai")).toBe(false);

    // Verify Z.ai card never gets is-focused (even though it exists)
    const zaiCard = c.querySelector(".provider-picker__card.provider-zai") as HTMLElement;
    expect(zaiCard.classList.contains("is-focused")).toBe(false);
  });

  it("pressing digit 3 is a no-op (Z.ai is disabled, not in enabled list)", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const panel = c.querySelector(".provider-picker__panel") as HTMLElement;

    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true })));
    expect(onPick).not.toHaveBeenCalled();
  });
});
