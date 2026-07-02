// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ProviderIcon } from "./ProviderIcons";

describe("ProviderIcon", () => {
  it("renders the right icon per provider id", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProviderIcon id="claude" />));
    expect(container.querySelector("svg title")?.textContent).toBe("Claude");
    act(() => root.render(<ProviderIcon id="codex" />));
    expect(container.querySelector("svg title")?.textContent).toBe("Codex");
    act(() => root.render(<ProviderIcon id="zai" />));
    expect(container.querySelector("svg title")?.textContent).toBe("Z.ai");
    act(() => root.unmount());
    container.remove();
  });

  it("forwards extra props (e.g. className) to the underlying svg", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProviderIcon id="claude" className="my-icon" />));
    expect(container.querySelector("svg")?.getAttribute("class")).toBe("my-icon");
    act(() => root.unmount());
    container.remove();
  });
});
