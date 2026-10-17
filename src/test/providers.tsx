import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { SaveStatusProvider, ConnectedSaveChip } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";

// The app's providers around a screen, plus the top-bar chip so tests can see save status.
export function renderInApp(ui: ReactElement) {
  return render(
    <ToastProvider>
      <SaveStatusProvider>
        <ConnectedSaveChip />
        {ui}
      </SaveStatusProvider>
    </ToastProvider>,
  );
}
