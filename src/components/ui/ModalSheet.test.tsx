// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModalSheet } from "./ModalSheet";

function Harness({
  onClose = () => {},
  description,
}: {
  onClose?: () => void;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <ModalSheet
        open={open}
        title="Remove trip"
        description={description}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        actions={<button>Confirm</button>}
      >
        <input aria-label="Reason" />
      </ModalSheet>
    </>
  );
}

describe("ModalSheet", () => {
  it("renders nothing while closed", () => {
    render(
      <ModalSheet open={false} title="Hidden" onClose={() => {}}>
        x
      </ModalSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled modal dialog with an optional description", async () => {
    render(<Harness description="This can be undone." />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Remove trip" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("This can be undone.")).toBeTruthy();
  });

  it("omits aria-describedby without a description", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog").getAttribute("aria-describedby")).toBeNull();
  });

  it("moves focus in, locks scroll, and restores both on close", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText("Reason"));
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });

  it("copes with an opener that is not an HTML element (nothing to restore)", async () => {
    const view = render(
      <svg tabIndex={0} data-testid="svg-opener">
        <title>icon</title>
      </svg>,
    );
    (screen.getByTestId("svg-opener") as unknown as SVGElement).focus();
    expect(document.activeElement).toBe(screen.getByTestId("svg-opener"));
    const modal = (
      <ModalSheet open title="From icon" onClose={() => {}}>
        <button>Inside</button>
      </ModalSheet>
    );
    view.rerender(
      <>
        <svg tabIndex={0} data-testid="svg-opener">
          <title>icon</title>
        </svg>
        {modal}
      </>,
    );
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("focuses the dialog itself when it has nothing focusable", async () => {
    render(
      <ModalSheet open title="Empty" onClose={() => {}}>
        Just text
      </ModalSheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("keeps Tab inside the dialog in both directions", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const reason = screen.getByLabelText("Reason");
    const confirm = screen.getByRole("button", { name: "Confirm" });
    await userEvent.tab();
    expect(document.activeElement).toBe(confirm);
    await userEvent.tab();
    expect(document.activeElement).toBe(reason);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("wraps Shift+Tab from the dialog container to the last control", async () => {
    render(
      <ModalSheet open title="Edge" onClose={() => {}}>
        <button>Only</button>
      </ModalSheet>,
    );
    const dialog = screen.getByRole("dialog");
    dialog.focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Only" }));
  });

  it("swallows Tab when nothing inside is focusable", async () => {
    render(
      <ModalSheet open title="Static" onClose={() => {}}>
        text
      </ModalSheet>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("closes on a backdrop press but not on a press inside the dialog", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByLabelText("Reason"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores keys other than Escape and Tab", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.keyboard("a");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("makes the rest of the page inert while open, and restores it on close", async () => {
    render(
      <>
        <main data-testid="page">page</main>
        <Harness />
      </>,
    );
    const page = screen.getByTestId("page");
    const host = page.parentElement as HTMLElement;
    host.setAttribute("data-host", "1");
    expect(host.hasAttribute("inert")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(host.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(host.hasAttribute("inert")).toBe(false);
  });

  it("leaves anything that was already inert exactly as it was", async () => {
    const stray = document.createElement("div");
    stray.setAttribute("inert", "");
    document.body.appendChild(stray);
    try {
      render(<Harness />);
      await userEvent.click(screen.getByRole("button", { name: "Open" }));
      await userEvent.keyboard("{Escape}");
      expect(stray.hasAttribute("inert")).toBe(true);
    } finally {
      stray.remove();
    }
  });

  it("closes on a backdrop press by default, but not when dismissOnBackdrop is off (destructive confirms)", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalSheet open title="Remove" onClose={onClose}>
        <button>Inside</button>
      </ModalSheet>,
    );
    await userEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <ModalSheet open title="Remove" onClose={onClose} dismissOnBackdrop={false}>
        <button>Inside</button>
      </ModalSheet>,
    );
    screen.getByRole("button", { name: "Inside" }).focus();
    await userEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The ignored press leaves focus inside the dialog, so Escape still works.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders into the document body so it sits above everything", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("modal-backdrop").parentElement).toBe(document.body);
  });

  describe("showClose", () => {
    it("has no close button by default", () => {
      render(
        <ModalSheet open title="Plain" onClose={() => {}}>
          <input aria-label="Name" />
        </ModalSheet>,
      );
      expect(screen.queryByRole("button", { name: "Close dialog" })).toBeNull();
    });

    it("adds a labelled close button that closes, without taking the initial focus", async () => {
      const onClose = vi.fn();
      render(
        <ModalSheet open showClose title="Edit" onClose={onClose}>
          <input aria-label="Name" />
        </ModalSheet>,
      );
      expect(document.activeElement).toBe(screen.getByLabelText("Name"));
      await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("still focuses the dialog itself when the close button is all it holds", () => {
      render(
        <ModalSheet open showClose title="Empty" onClose={() => {}}>
          {null}
        </ModalSheet>,
      );
      expect(document.activeElement).toBe(screen.getByRole("dialog"));
    });
  });

  it("starts on a control that asks to be first, such as a checked radio, instead of the first control", () => {
    render(
      <ModalSheet open title="Pick" onClose={() => {}}>
        <input type="radio" name="x" aria-label="One" />
        <input type="radio" name="x" aria-label="Two" defaultChecked data-modal-autofocus="" />
      </ModalSheet>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Two"));
  });
});
