// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast } from "@/hooks/useToast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty toasts array", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("adds a toast with addToast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Test message", "error");
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Test message");
    expect(result.current.toasts[0].type).toBe("error");
  });

  it("defaults to info type when not specified", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Info message");
    });

    expect(result.current.toasts[0].type).toBe("info");
  });

  it("removes a toast with removeToast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Test message", "error");
    });

    const toastId = result.current.toasts[0].id;

    act(() => {
      result.current.removeToast(toastId);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("auto-dismisses toast after 3 seconds", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Auto dismiss", "success");
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("can hold multiple toasts", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("First", "error");
      result.current.addToast("Second", "success");
      result.current.addToast("Third", "info");
    });

    expect(result.current.toasts).toHaveLength(3);
  });

  it("assigns unique IDs to each toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("First", "error");
      result.current.addToast("Second", "success");
    });

    const ids = result.current.toasts.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
  });
});
