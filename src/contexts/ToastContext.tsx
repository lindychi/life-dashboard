"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useToast, type ToastType } from "@/hooks/useToast";
import { ToastContainer } from "@/components/ToastContainer";

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, addToast, removeToast } = useToast();

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastContext must be used within a ToastProvider");
  }
  return context;
}
