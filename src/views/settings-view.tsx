import { dump } from "src/lib/helps";
import FastSync from "src/main";

import { $ } from "../lang/lang";


async function getClipboardContent(plugin: FastSync): Promise<void> {
  const clipboardReadTipSave = async (owner: string, repo: string, branch: string, token: string, tip: string) => {
    plugin.settings.githubOwner = owner
    plugin.settings.githubRepo = repo
    plugin.settings.githubBranch = branch
    plugin.settings.githubToken = token
    plugin.clipboardReadTip = tip

    await plugin.saveSettings()
    plugin.settingTab.display()

    setTimeout(() => {
      plugin.clipboardReadTip = ""
    }, 2000)
  }

  //
  const clipboardReadTipTipSave = async (tip: string) => {
    plugin.clipboardReadTip = tip

    await plugin.saveData(plugin.settings)
    plugin.settingTab.display()

    setTimeout(() => {
      plugin.clipboardReadTip = ""
    }, 2000)
  }

  try {
    // 检查浏览器是否支持 Clipboard API
    if (!navigator.clipboard) {
      return
    }

    // 获取剪贴板文本内容
    const text = await navigator.clipboard.readText()

    // 检查是否为 JSON 格式
    let parsedData = JSON.parse(text)

    // 检查是否为对象且包含 GitHub 配置
    if (typeof parsedData === "object" && parsedData !== null) {
      const hasOwner = "githubOwner" in parsedData || "owner" in parsedData
      const hasRepo = "githubRepo" in parsedData || "repo" in parsedData
      const hasToken = "githubToken" in parsedData || "token" in parsedData

      if (hasOwner && hasRepo && hasToken) {
        void clipboardReadTipSave(
          parsedData.githubOwner || parsedData.owner,
          parsedData.githubRepo || parsedData.repo,
          parsedData.githubBranch || parsedData.branch || "main",
          parsedData.githubToken || parsedData.token,
          $("接口配置信息已经粘贴到设置中!")
        )
        return
      }
    }
    void clipboardReadTipTipSave($("未检测到配置信息!"))
    return
  } catch (err) {
    dump(err)
    void clipboardReadTipTipSave($("未检测到配置信息!"))
    return
  }
}

const handleClipboardClick = (plugin: FastSync) => { getClipboardContent(plugin).catch(err => { dump(err); }); };

export const SettingsView = ({ plugin }: { plugin: FastSync }) => {
  return (
    <>
      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">{$("GitHub 同步配置")}</div>
          <div className="setting-item-description">{$("使用 GitHub API 进行同步")}</div>
        </div>
      </div>
      <div>
        <table className="obsidian-github-sync-multi-platform-settings-openapi">
          <thead>
            <tr>
              <th>{$("方式")}</th>
              <th>{$("说明")}</th>
              <th>{$("详情参考")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>GitHub</td>
              <td>{$("使用 GitHub 仓库存储和同步笔记")}</td>
              <td>
                <a href="https://github.com/settings/tokens">GitHub PAT Settings</a>
              </td>
            </tr>

          </tbody>
        </table>
      </div>
      <div className="clipboard-read">
        <button className="clipboard-read-button" onClick={() => handleClipboardClick(plugin)}>
          {$("粘贴的远端配置")}
        </button>
        <div className="clipboard-read-description">{plugin.clipboardReadTip}</div>
      </div>
    </>
  )
}
