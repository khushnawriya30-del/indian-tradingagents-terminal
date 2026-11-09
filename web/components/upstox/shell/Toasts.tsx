"use client";

import { useApp } from "../AppProvider";
import { CloseIcon } from "../icons";

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`} role="status">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div className="grow">
              <div className="toast-title">{toast.title}</div>
              {toast.message && <div className="toast-msg">{toast.message}</div>}
            </div>
            <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
              <CloseIcon size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
