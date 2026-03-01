// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useRef } from "react";

describe("useClickOutside", () => {
  it("calls callback when clicking outside the ref element", () => {
    const callback = vi.fn();

    const container = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(container);
    document.body.appendChild(outside);

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useClickOutside(ref, callback);
      return ref;
    });

    // Click outside
    const event = new MouseEvent("mousedown", { bubbles: true });
    outside.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);

    // Cleanup
    unmount();
    document.body.removeChild(container);
    document.body.removeChild(outside);
  });

  it("does NOT call callback when clicking inside the ref element", () => {
    const callback = vi.fn();

    const container = document.createElement("div");
    const child = document.createElement("span");
    container.appendChild(child);
    document.body.appendChild(container);

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useClickOutside(ref, callback);
      return ref;
    });

    // Click inside
    const event = new MouseEvent("mousedown", { bubbles: true });
    child.dispatchEvent(event);

    expect(callback).not.toHaveBeenCalled();

    // Cleanup
    unmount();
    document.body.removeChild(container);
  });

  it("removes event listener on unmount", () => {
    const callback = vi.fn();

    const container = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(container);
    document.body.appendChild(outside);

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(container);
      useClickOutside(ref, callback);
      return ref;
    });

    unmount();

    // Click outside after unmount
    const event = new MouseEvent("mousedown", { bubbles: true });
    outside.dispatchEvent(event);

    expect(callback).not.toHaveBeenCalled();

    // Cleanup
    document.body.removeChild(container);
    document.body.removeChild(outside);
  });
});
