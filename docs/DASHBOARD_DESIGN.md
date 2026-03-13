# Dashboard 设计文档：月度字数统计

## 1. 产品愿景
提供一个轻量、私密的 Web 界面，让用户在不打开 Obsidian 的情况下，通过 GitHub Pages 快速了解自己的笔记产出情况。

## 2. 核心功能：月度字数趋势
- **图表类型**：折线图 (Line Chart) 或 面积图 (Area Chart)。
- **横轴 (X-Axis)**：月份（如 2024-01, 2024-02 ...）。
- **纵轴 (Y-Axis)**：纯文字总字数。
- **计算逻辑**：
  1. 获取仓库所有 `.md` 文件列表。
  2. 读取文件 Metadata（`mtime`）。
  3. 对每个文件内容进行清洗：
     - 去除 Frontmatter (`--- ... ---`)。
     - 去除 Markdown 标记 (如 `##`, `**`, `[link](url)`)。
     - 去除空格和换行。
  4. 统计剩余字符数。

## 3. 技术实现 (技术栈：React + Tailwind CSS + Recharts)

### 3.1 数据抓取服务 (`githubService.ts`)
```typescript
export const fetchMonthlyStats = async (token: string, repo: string) => {
  // 1. 获取文件树
  const tree = await getRepoTree(token, repo);
  const mdFiles = tree.filter(f => f.path.endsWith('.md'));
  
  // 2. 并行获取内容并计算（注意控制并发，避免被 GitHub 限流）
  const stats = await Promise.all(mdFiles.map(async file => {
    const content = await getFileContent(token, repo, file.path);
    const wordCount = calculateCleanWords(content);
    return { month: formatDate(file.mtime), count: wordCount };
  }));
  
  // 3. 按月份聚合
  return aggregateByMonth(stats);
}
```

### 3.2 性能优化建议
由于直接通过 API 抓取成百上千个文件内容会导致页面加载缓慢：
- **方案 A (推荐)**：在 Obsidian 插件端每次同步成功后，自动更新仓库根目录下的一个隐藏文件 `.obsidian/sync-stats.json`。Dashboard 只需读取这一个文件即可。
- **方案 B**：利用浏览器 `IndexedDB` 缓存已抓取文件的字数。只有当文件 SHA 发生变化时才重新下载计算。

## 4. UI 界面草图
- **Header**：项目名称 + 仓库名 + 刷新按钮。
- **Hero Section**：总字数、本月新增字数、笔记总数（三个大数字卡片）。
- **Main Section**：占据屏幕 80% 的“月度字数增长趋势图”。
- **Footer**：最后同步时间 + 私密声明。

## 5. 安全与隐私
- **存储**：Token 仅保存在用户浏览器的 `LocalStorage` 中。
- **请求**：所有 API 请求直接发往 GitHub，不经过任何中间服务器。
- **清理**：提供“退出登录”按钮，一键清除所有本地缓存的 Token 和数据。
