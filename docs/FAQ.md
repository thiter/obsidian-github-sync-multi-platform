# Frequently Asked Questions (FAQ) / 常见问题解答 / 常見問題解答

[English](#english) | [繁體中文](#繁體中文) | [简体中文](#简体中文)

---

## 繁體中文

### Q1. 雙向同步：當遠端倉庫有更新時，外掛是否支援從 GitHub 拉取變更？還是只能單向推送？

**支援完整的雙向同步。**

外掛的同步邏輯分為 **全量雙向同步** 和 **本地即時單向推送** 兩種機制：

1. **全量雙向同步**（拉取遠端變動 + 推送本地變動）：
   - **觸發時機**：
     - 在外掛啟動時（延遲 1.5 秒以等待 Obsidian 佈局初始化完成）。
     - 使用者點擊側邊欄的同步圖示。
     - 手動執行「同步全部筆記」指令。
   - **工作流程**：
     - **第一步（拉取遠端變更）**：透過 GitHub Tree 取得遠端檔案樹，比對 Git Blob SHA。如果遠端有新檔案或 SHA 改變，自動下載並覆寫/新建本地檔案。
     - **第二步（推送本地變更）**：掃描本地所有檔案，將遠端不存在的新檔案以及本地內容有修改的檔案推送至 GitHub。
2. **本地即時單向推送**：
   - **機制**：當使用者在本地編輯、建立、重新命名或刪除筆記時，外掛的 Watcher 會監聽這些事件（全量同步進行時會臨時關閉以防衝突），並透過 5 秒 Debounce 防抖機制自動將變更推送至 GitHub。

---

### Q2. 增量推送：外掛是否只同步有變更的檔案（增量同步），還是每次都會推送全部內容？

**外掛採用完全的增量同步策略。**

無論是拉取還是推送，外掛都會透過標準 Git Blob SHA-1 校驗來過濾未變更的檔案，絕不會每次重複推送或下載全部內容：

* **推送增量過濾**：外掛會精確計算本地檔案的標準 Git Blob SHA-1，並與 GitHub 遠端 SHA 進行比對。如果兩端 SHA 完全一致，直接跳過，零網路請求，不產生任何 Commit。
* **拉取增量過濾**：外掛透過 GitHub Tree 介面一次性獲取遠端所有檔案的 SHA 清單，僅對 SHA 改變或本地缺失的檔案發起具體下載請求（GET），不會重複下載未修改的檔案。

---

### Q3. 衝突與刪除處理：多裝置同步與檔案刪除如何運作？

外掛採用經典的 **三方狀態對齊（3-Way State Reconciliation）** 策略配合最終寫入者勝出機制：

* **雙向刪除對齊**：
  * 在本地刪除檔案或資料夾時，外掛會自動向 GitHub 發起批次刪除，不再殘留幽靈檔案；
  * 如果其他裝置在遠端刪除了檔案，全量同步時本地亦會同步清理，避免已刪除檔案「死而復生」。
* **多裝置衝突情境**：
  * 遇到並發修改時，外掛會透過最新 SHA 進行安全對齊。Obsidian 內建的「檔案復原 (File Recovery)」外掛亦會保留本地歷史版本，使用者可隨時找回被覆蓋的文字。

#### 💡 推薦的工作流程建議
1. **保持即時同步開啟**：編輯完成後，稍候幾秒鐘，確保當前裝置的修改已自動推送至 GitHub。
2. **切換裝置時先同步**：在另一台裝置開始編輯前，先開啟 Obsidian 讓其自動完成全量同步（或手動點擊同步按鈕），確保本地筆記為最新狀態再開始撰寫。

---

### Q4. 同步報錯怎麼看？（狀態碼速查 / Status codes）

右上角提示會**跟隨 Obsidian 介面語言自動切換中/英文**，並保留狀態碼數字方便查表；原始 JSON 只留在開發者控制台。完整實作說明見 `docs/internal/GITHUB_CONTENTS_API_SPEC.md` 第 7 節。

| 狀態碼 | 中文提示 | English hint | 該怎麼辦 |
|--------|----------|--------------|----------|
| 401 | 同步失敗（401）：令牌無效或已過期 | Sync failed (401): token is invalid or expired | 到 GitHub 重新產生 PAT 並重貼；留意複製時別帶空格或換行 |
| 422 | 同步衝突（422）：遠端剛被其他裝置更新 | Sync conflict (422): remote was just updated | 外掛已自動重試 3 次（200/400/800ms 退避）；仍失敗請稍後再同步一次 |
| 403 | 請求被限流 / 權限不足（403） | Rate limited / Access denied (403) | 稍後再試，或檢查 fine-grained PAT 是否已授權該倉庫與 Contents 權限 |
| 404 | 找不到倉庫或分支（404） | Repo or branch not found (404) | 檢查設定裡的 Owner / Repo / Branch |
| 409 | 遠端倉庫為空 | Git Repository is empty | 正常情況，外掛會建立第一個 commit |

**401 常見原因**：PAT 過期或被撤銷（GitHub 對滿 1 年未使用的 token 會自動撤銷）、複製貼上帶入空白字元、填成密碼或其他平台的令牌。令牌存在各裝置本地，**不會跨裝置同步**，每台都要單獨更新。

> 改完 token 後第一次同步偶爾會遇到 422，那是啟動自動同步、手動同步、5 秒防抖推送與其他裝置同時寫入造成的短暫競爭，再同步一次通常就成功；本次更新後這類衝突多數會在內部自愈。

---

## 简体中文

### Q1. 双向同步：当远程仓库有更新时，插件是否支持从 GitHub 拉取更改？还是只能单向推送？

**支持完整的双向同步。**

插件的同步逻辑分为 **全量双向同步** 和 **本地实时单向推送** 两种机制：

1. **全量双向同步**（拉取远端变动 + 推送本地变动）：
   - **触发时机**：
     - 在插件启动时（延迟 1.5 秒以等待 Obsidian 布局初始化完毕）。
     - 用户点击侧边栏的同步图标。
     - 手动执行“同步全部笔记”命令。
   - **工作流**：
     - **第一步（拉取远端变更）**：获取 GitHub 上的当前文件树，对比本地缓存的 SHA。如果远端有新文件，或远端的 SHA 与本地记录的 SHA 不一致，插件会通过 GitHub API 下载最新内容并覆盖/新建本地文件。
     - **第二步（推送本地变更）**：扫描本地的所有文件，将远端不存在的新文件以及本地内容发生变化的文件推送至 GitHub。
2. **本地实时单向推送**：
   - **机制**：当用户在本地编辑、创建、重命名或删除笔记时，插件的 Watcher 会监听到这些事件（在执行上述全量同步时，Watcher 会临时关闭以防产生冲突），并通过防抖机制（默认 5 秒防抖，避免高频请求触发 GitHub API 速率限制）自动将变更推送至 GitHub。

---

### Q2. 增量推送：插件是否只同步有变更的文件（增量同步），还是每次都会推送全部内容？

**插件采用完全的增量同步策略。**

无论是拉取还是推送，插件都会通过哈希（Hash）和 SHA 校验来过滤未变更的文件，绝不会每次推送或下载全部内容：

*   **推送增量过滤**：插件会计算本地文件的最新内容哈希值（Markdown 笔记采用内容 Hash，图片等二进制文件采用 `大小 + 修改时间` 组合 Hash），并与本地同步缓存数据 `syncData.files[path].hash` 进行比对。如果哈希值未发生变化，则直接跳过该文件。
*   **拉取增量过滤**：插件通过 GitHub Tree 接口一次性获取远端所有文件的 SHA 列表，仅对 SHA 发生改变或本地不存在的文件发起具体的内容下载请求（GET），不会重复下载未修改的文件。

---

### Q3. 冲突处理：如果多台设备同时编辑同一笔记，产生冲突时插件如何处理？

由于本插件**没有采用类似 Git 的本地三方合并逻辑（Merge）**，也**不会生成 `.conflict` 等冲突副本文件**，因此在发生冲突时，插件会采用 **“覆盖（Overwrite）/ 最终写入者胜出”** 的简易策略：

*   **场景 A：在未拉取最新远端更改的情况下，本地实时修改并触发推送**
    *   当设备 B 在本地修改了笔记 `X.md` 并触发实时推送时，它会携带本地旧的 SHA 试图更新 GitHub。
    *   因为设备 A 已经提前更新了 GitHub 上的该文件，GitHub 会返回 `409 Conflict`（冲突）或 `422` 错误。
    *   插件捕捉到 409/422 状态码后，会**自动请求获取远端最新的 SHA，然后直接使用新 SHA 再次发起推送**。
    *   **结果**：设备 B 的修改会强行覆盖 GitHub 上的内容（设备 A 提交的修改在 GitHub 上会被抹去）。
*   **场景 B：在未推送本地修改的情况下，触发了全量同步（例如重新打开软件或手动同步）**
    *   全量同步的第一步是**下拉远端变更**。插件检测到远端 SHA 发生改变，会直接下载远端内容并调用 Obsidian 的 `vault.modify` 覆写本地文件。
    *   **结果**：设备 B 本地尚未推送到远端的修改会被远端内容覆盖而丢失。不过，Obsidian 自带的 **“文件恢复 (File Recovery)”** 插件通常会保留本地历史记录，用户可以通过它找回被覆盖的内容。

#### 💡 推荐的工作流程建议
为了防止多设备协作时内容被意外覆写，建议用户：
1. **保持实时同步开启**：编辑完成后，稍微等待几秒钟，确保当前设备的修改已自动推送至 GitHub。
2. **切换设备时先同步**：在另一设备上开始编辑前，先打开 Obsidian 让其自动完成全量同步（或手动点击同步按钮），确保本地笔记是最新的，再开始撰写。

---

### Q4. 同步报错怎么看？（状态码速查 / Status codes）

右上角提示会**跟随 Obsidian 界面语言自动切换中/英文**，并保留状态码数字方便查表；原始 JSON 只留在开发者控制台。完整实现说明见 `docs/internal/GITHUB_CONTENTS_API_SPEC.md` 第 7 节。

| 状态码 | 中文提示 | English hint | 该怎么办 |
|--------|----------|--------------|----------|
| 401 | 同步失败（401）：令牌无效或已过期 | Sync failed (401): token is invalid or expired | 到 GitHub 重新生成 PAT 并重贴；留意复制时别带空格或换行 |
| 422 | 同步冲突（422）：远端刚被其他设备更新 | Sync conflict (422): remote was just updated | 插件已自动重试 3 次（200/400/800ms 退避）；仍失败请稍后再同步一次 |
| 403 | 请求被限流 / 权限不足（403） | Rate limited / Access denied (403) | 稍后再试，或检查 fine-grained PAT 是否已授权该仓库与 Contents 权限 |
| 404 | 找不到仓库或分支（404） | Repo or branch not found (404) | 检查设置里的 Owner / Repo / Branch |
| 409 | 远端仓库为空 | Git Repository is empty | 正常情况，插件会创建第一个 commit |

**401 常见原因**：PAT 过期或被撤销（GitHub 对满 1 年未使用的 token 会自动撤销）、复制粘贴带入空白字符、填成密码或其他平台的令牌。令牌存在各设备本地，**不会跨设备同步**，每台都要单独更新。

> 改完 token 后第一次同步偶尔会遇到 422，那是启动自动同步、手动同步、5 秒防抖推送与其他设备同时写入造成的短暂竞争，再同步一次通常就成功；本次更新后这类冲突多数会在内部自愈。

---

## English

### Q1. Two-way sync: When the remote repository has updates, does the plugin support pulling changes from GitHub? Or is it only one-way push?

**Yes, full two-way synchronization is supported.**

The sync logic is divided into **Full Two-Way Sync** and **Real-Time Local Push**:

1. **Full Two-Way Sync** (Pull Remote + Push Local):
   - **Trigger**:
     - At startup (delayed by 1.5 seconds to wait for Obsidian layout initialization).
     - Clicking the ribbon icon in the sidebar.
     - Executing the "Sync all files" command manually.
   - **Workflow**:
     - **Step 1 (Pull Remote)**: Gets the remote file tree from GitHub and compares remote SHAs with local cached SHAs. If a remote file is new or has a different SHA, it downloads the latest content and creates/modifies the local file.
     - **Step 2 (Push Local)**: Scans all local files and pushes new or modified files to GitHub.
2. **Real-Time Local Push**:
   - **Mechanism**: When you edit, create, rename, or delete a note locally, a file watcher intercepts the event (temporarily disabled during full sync to avoid race conditions) and automatically pushes the changes to GitHub with a 5-second debounce.

---

### Q2. Incremental Sync: Does the plugin only sync changed files, or does it push everything every time?

**The plugin uses a fully incremental sync strategy.**

Neither push nor pull operations will download or upload unchanged files:

*   **Push Incremental Filtering**: The plugin calculates the hash of the local file content. If it matches the cached hash (`syncData.files[path].hash`), the upload is skipped.
*   **Pull Incremental Filtering**: The plugin fetches the remote tree to check all file SHAs and only downloads files that have different SHAs or do not exist locally.

---

### Q3. Conflict Handling: If multiple devices edit the same note simultaneously, how does the plugin handle conflicts?

The plugin **does not perform Git-style 3-way merges** and **does not create `.conflict` files**. It uses a **"last write wins" (overwrite)** strategy:

*   **Scenario A: Editing and saving locally without pulling remote updates first**
    *   If Device B edits `X.md` and triggers a real-time push, it sends the old local SHA to GitHub.
    *   If Device A has already updated `X.md` on GitHub, GitHub returns an HTTP `409 Conflict` or `422` error.
    *   The plugin catches this error, fetches the fresh remote SHA, and retries the push with the updated SHA.
    *   **Result**: Device B's changes overwrite the remote version on GitHub (Device A's edits on GitHub are overwritten).
*   **Scenario B: A full sync is triggered before local changes are pushed**
    *   The full sync pulls remote changes first.
    *   Since the remote SHA is newer, the plugin overwrites the local file with the remote version.
    *   **Result**: Device B's unpushed local changes are overwritten. However, you can retrieve them via Obsidian's built-in **"File Recovery"** plugin.

#### 💡 Recommended Workflow
To avoid overwriting edits on multiple devices:
1. **Enable Real-Time Sync**: Wait a few seconds after finishing edits to let the plugin auto-push changes.
2. **Sync Before Editing**: When switching devices, open Obsidian and wait for the startup sync to complete (or click the sync button) to pull the latest edits before you start typing.

---

### Q4. How do I read a sync error? (Status codes / 状态码速查)

The top-right Notice **follows your Obsidian UI language** (Chinese or English) and always keeps the numeric status code so you can look it up. The raw GitHub JSON stays in the developer console. Full implementation notes: `docs/internal/GITHUB_CONTENTS_API_SPEC.md`, section 7.

| Status | 中文提示 | English hint | What to do |
|--------|----------|--------------|------------|
| 401 | 同步失败（401）：令牌无效或已过期 | Sync failed (401): token is invalid or expired | Regenerate the PAT on GitHub and paste it again; make sure no trailing space or newline was copied |
| 422 | 同步冲突（422）：远端刚被其他设备更新 | Sync conflict (422): remote was just updated | The plugin already retried 3 times with 200/400/800 ms backoff; if it persists, sync again shortly |
| 403 | 请求被限流 / 权限不足（403） | Rate limited / Access denied (403) | Try again later, or verify the fine-grained PAT has access to this repo with Contents permission |
| 404 | 找不到仓库或分支（404） | Repo or branch not found (404) | Check Owner / Repo / Branch in settings |
| 409 | 远端仓库为空 | Git Repository is empty | Expected for a brand-new repo; the plugin creates the first commit |

**Common causes of 401**: an expired or revoked PAT (GitHub auto-revokes tokens unused for a year), whitespace pasted along with the token, or a password / token from another platform. Tokens are stored locally per device and **are not synced across devices** — update every device separately.

> A 422 right after changing the token is usually a short race between the startup sync, a manual sync, the 5-second debounced push and another device writing at the same time. Syncing once more typically succeeds; after this update most of those conflicts are resolved automatically inside the plugin.
