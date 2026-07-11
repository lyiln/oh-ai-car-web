import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface FormModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function FormModal({ open, title, onClose, children }: FormModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="form-modal-backdrop" onClick={onClose}>
      <div
        className="form-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-modal-title"
      >
        <header className="form-modal-header">
          <h2 id="form-modal-title">{title}</h2>
          <button type="button" className="form-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="form-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
