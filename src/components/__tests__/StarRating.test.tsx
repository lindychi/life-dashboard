// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StarRating from "@/components/StarRating";

describe("StarRating", () => {
  it("renders 5 stars", () => {
    render(<StarRating rating={0} />);
    const stars = screen.getAllByTestId(/^star-/);
    expect(stars).toHaveLength(5);
  });

  it("fills correct number of stars based on rating", () => {
    const { container } = render(<StarRating rating={3} readonly />);
    const svgs = container.querySelectorAll("svg");
    const filledCount = Array.from(svgs).filter((svg) =>
      svg.className.baseVal.includes("text-amber-400")
    ).length;
    const emptyCount = Array.from(svgs).filter((svg) =>
      svg.className.baseVal.includes("text-gray-700")
    ).length;
    expect(filledCount).toBe(3);
    expect(emptyCount).toBe(2);
  });

  it("fills all stars for rating 5", () => {
    const { container } = render(<StarRating rating={5} readonly />);
    const svgs = container.querySelectorAll("svg");
    const filledCount = Array.from(svgs).filter((svg) =>
      svg.className.baseVal.includes("text-amber-400")
    ).length;
    expect(filledCount).toBe(5);
  });

  it("fills no stars for rating 0", () => {
    const { container } = render(<StarRating rating={0} readonly />);
    const svgs = container.querySelectorAll("svg");
    const emptyCount = Array.from(svgs).filter((svg) =>
      svg.className.baseVal.includes("text-gray-700")
    ).length;
    expect(emptyCount).toBe(5);
  });

  it("calls onChange when star is clicked", () => {
    const onChange = vi.fn();
    render(<StarRating rating={0} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("star-3"));
    expect(onChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByTestId("star-5"));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("does not call onChange when readonly", () => {
    const onChange = vi.fn();
    render(<StarRating rating={3} onChange={onChange} readonly />);

    fireEvent.click(screen.getByTestId("star-4"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows hover cascade effect", () => {
    const onChange = vi.fn();
    const { container } = render(<StarRating rating={0} onChange={onChange} />);

    // Hover over star 4
    fireEvent.mouseEnter(screen.getByTestId("star-4"));

    const svgs = container.querySelectorAll("svg");
    const filledCount = Array.from(svgs).filter((svg) =>
      svg.className.baseVal.includes("text-amber-400")
    ).length;
    // Stars 1-4 should be filled on hover
    expect(filledCount).toBe(4);
  });

  it("clears hover state on mouse leave", () => {
    const onChange = vi.fn();
    const { container } = render(<StarRating rating={1} onChange={onChange} />);

    // Hover over star 4
    fireEvent.mouseEnter(screen.getByTestId("star-4"));

    // Leave the entire group
    const group = container.querySelector("[role='group']")!;
    fireEvent.mouseLeave(group);

    // Should revert to original rating of 1
    const svgs = container.querySelectorAll("svg");
    const filledCount = Array.from(svgs).filter((svg) =>
      svg.className.baseVal.includes("text-amber-400")
    ).length;
    expect(filledCount).toBe(1);
  });

  it("uses sm size class when size is sm", () => {
    const { container } = render(<StarRating rating={1} readonly size="sm" />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs[0].className.baseVal).toContain("w-4");
  });

  it("uses md size class by default", () => {
    const { container } = render(<StarRating rating={1} readonly />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs[0].className.baseVal).toContain("w-5");
  });

  it("has correct aria-label on the group", () => {
    render(<StarRating rating={4} readonly />);
    expect(screen.getByRole("group")).toHaveAttribute("aria-label", "별점 4점");
  });

  it("disables buttons in readonly mode", () => {
    render(<StarRating rating={3} readonly />);
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
