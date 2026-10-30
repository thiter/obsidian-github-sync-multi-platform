import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
  private titleText: string;
  private message: string;
  private confirmText: string;
  private cancelText: string;
  private onConfirm: () => void;
  private onCancel?: () => void;
  private isHandled: boolean = false;

  constructor(
    app: App,
    titleText: string,
    message: string,
    confirmText: string,
    onConfirm: () => void,
    cancelText: string = "取消",
    onCancel?: () => void
  ) {
    super(app);
    this.titleText = titleText;
    this.message = message;
    this.confirmText = confirmText;
    this.cancelText = cancelText;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.titleText });
    contentEl.createEl("p", { text: this.message, cls: "mod-warning" });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(this.cancelText).onClick(() => {
          this.isHandled = true;
          this.close();
          this.onCancel?.();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText)
          .setWarning()
          .onClick(() => {
            this.isHandled = true;
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    if (!this.isHandled) {
      this.isHandled = true;
      this.onCancel?.();
    }
  }
}

export function showConfirmModal(
  app: App,
  titleText: string,
  message: string,
  confirmText: string,
  cancelText: string = "取消"
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(
      app,
      titleText,
      message,
      confirmText,
      () => resolve(true),
      cancelText,
      () => resolve(false)
    );
    modal.open();
  });
}
