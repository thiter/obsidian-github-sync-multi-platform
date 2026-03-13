# GitHub API 规格说明 (Spec)

本项目将主要使用 GitHub REST API v3。以下是核心接口定义。

## 1. 认证 (Authentication)
使用 `Authorization: Bearer <YOUR_TOKEN>` 请求头。

## 2. 核心 Endpoint

### 2.1 获取文件内容 (Read)
- **Method**: `GET`
- **URL**: `/repos/{owner}/{repo}/contents/{path}`
- **Response**: 返回 Base64 编码的内容及当前文件的 `sha`。
- **用途**: 用于首次下载或检测远程修改。

### 2.2 创建/更新文件 (Create/Update)
- **Method**: `PUT`
- **URL**: `/repos/{owner}/{repo}/contents/{path}`
- **Body**:
  ```json
  {
    "message": "sync: update note",
    "content": "base64_encoded_content",
    "sha": "current_file_sha_on_github",
    "branch": "main"
  }
  ```
- **用途**: 修改笔记后自动推送到 GitHub。如果不带 `sha` 参数，GitHub 会报错（如果文件已存在），这起到了并发控制的作用。

### 2.3 删除文件 (Delete)
- **Method**: `DELETE`
- **URL**: `/repos/{owner}/{repo}/contents/{path}`
- **Body**:
  ```json
  {
    "message": "sync: delete note",
    "sha": "current_file_sha_on_github"
  }
  ```
- **用途**: 本地删除后同步到远端。

### 2.4 获取最新提交 (Check for updates)
- **Method**: `GET`
- **URL**: `/repos/{owner}/{repo}/commits?path={path}&page=1&per_page=1`
- **用途**: 检查整个仓库或特定文件的最新变更。

## 3. 速率限制 (Rate Limits)
- 个人访问令牌 (PAT) 通常限制为每小时 5000 次请求。
- 对于笔记同步（通常按需触发），该限制绰绰有余。
- **优化点**：使用 `If-None-Match` 请求头利用 GitHub 的缓存机制，减少请求消耗。

## 4. 移动端特殊考虑
- 移动端（尤其是 iOS）对网络连接较为敏感。
- 必须实现 **离线队列**：网络不通时将修改存入本地 IndexDB，恢复连接后按顺序重试。
