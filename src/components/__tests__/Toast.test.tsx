// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toast } from "@/components/Toast";
import { ToastContainer } from "@/components/ToastContainer";

describe("Toast", () => {
  it("renders the message", () => {
    render(<Toast message="Error occurred" type="error" onClose={() => {}} />);
    expect(screen.getByText("Error occurred")).toBeInTheDocument();
  });

  it("renders with error styling", () => {
    const { container } = render(
      <Toast message="Error" type="error" onClose={() => {}} />
    );
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain("border-red");
  });

  it("renders with success styling", () => {
    const { container } = render(
      <Toast message="Success" type="success" onClose={() => {}} />
    );
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain("border-green");
  });

  it("renders with info styling", () => {
    const { container } = render(
      <Toast message="Info" type="info" onClose={() => {}} />
    );
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain("border-blue");
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<Toast message="Test" type="info" onClose={onClose} />);

    const closeButton = screen.getByRole("button", { name: /닫기/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ToastContainer", () => {
  it("renders multiple toasts", () => {
    const toasts = [
      { id: "1", message: "First toast", type: "error" as const },
      { id: "2", message: "Second toast", type: "success" as const },
      { id: "3", message: "Third toast", type: "info" as const },
    ];

    render(<ToastContainer toasts={toasts} onRemove={() => {}} />);

    expect(screen.getByText("First toast")).toBeInTheDocument();
    expect(screen.getByText("Second toast")).toBeInTheDocument();
    expect(screen.getByText("Third toast")).toBeInTheDocument();
  });

  it("renders nothing when toasts array is empty", () => {
    const { container } = render(
      <ToastContainer toasts={[]} onRemove={() => {}} />
    );
    // Should render the container div but with no toast children
    expect(container.querySelectorAll("[role='alert']")).toHaveLength(0);
  });

  it("calls onRemove with correct ID when toast is closed", () => {
    const onRemove = vi.fn();
    const toasts = [
      { id: "toast-1", message: "Test", type: "error" as const },
    ];

    render(<ToastContainer toasts={toasts} onRemove={onRemove} />);

    const closeButton = screen.getByRole("button", { name: /닫기/i });
    fireEvent.click(closeButton);

    expect(onRemove).toHaveBeenCalledWith("toast-1");
  });
});
