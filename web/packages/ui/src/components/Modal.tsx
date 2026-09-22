import { useEffect, useId, useRef, type ReactNode } from "react";
import s from "./Modal.module.css";

// A native <dialog> opened with showModal(): the browser makes the rest of the
// page inert, traps focus and hands it back to the opener on close.
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: let the parent's `open` stay the only source of truth.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The panel fills the dialog, so a click landing on the dialog itself is the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={s.panel}>
        <h2 id={titleId} className={s.title}>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
