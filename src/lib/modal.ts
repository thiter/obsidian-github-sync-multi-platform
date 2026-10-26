import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
  private titleText: string;
  private message: string;
  private confirmText: string;
  private cancelText: string;
  private onConfirm: () => void;

  constructor(
    app: App,
    titleText: string,
    message: string,
    confirmText: string,
    onConfirm: () => void,
    cancelText: string = "取消"
  ) {
    super(app);
    this.titleText = titleText;
    this.message = message;
    this.confirmText = confirmText;
    this.cancelText = cancelText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.titleText });
    contentEl.createEl("p", { text: this.message, cls: "mod-warning" });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(this.cancelText).onClick(() => {
          this.close();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
