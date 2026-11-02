"use client";

import { useApp, useAppApi } from "@/store/app-store";
import { Icon, Modal } from "@/components/common/ui";

/** The app's own confirmation dialog. Anything that used to call window.confirm() uses app.ask() instead. */
export function ConfirmHost() {
  const asking = useApp((s) => s.asking);
  const api = useAppApi();
  const answer = (ok: boolean) => api.getState().answer(ok);
  return (
    <Modal open={!!asking} onClose={() => answer(false)} label={asking?.title ?? "Confirm"} variant="alert">
      {asking && (
        <form
          className="confirm"
          onSubmit={(e) => {
            e.preventDefault();
            answer(true);
          }}
        >
          <span className="confirm-ico" data-tone={asking.tone ?? "primary"} aria-hidden>
            <Icon n={asking.tone === "danger" ? "alert" : "check"} size={22} />
          </span>
          <div className="confirm-text">
            <h2>{asking.title}</h2>
            {asking.body && <p>{asking.body}</p>}
          </div>
          <div className="dlg-actions">
            <button type="button" className="btn subtle" onClick={() => answer(false)}>Cancel</button>
            <button className={`btn ${asking.tone === "danger" ? "danger" : "primary"}`} autoFocus>
              {asking.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
