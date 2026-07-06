import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Modal } from "../components/Modal";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setState({ options, resolve })),
    [],
  );

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.options.title ?? "Please confirm"} onClose={() => close(false)} width={440}>
          <p style={{ marginTop: 0, color: "var(--muted)", lineHeight: 1.5 }}>{state.options.message}</p>
          <div className="modal-actions">
            <button onClick={() => close(false)}>{state.options.cancelLabel ?? "Cancel"}</button>
            <button className={state.options.danger ? "danger-btn" : "primary"} onClick={() => close(true)}>
              {state.options.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
