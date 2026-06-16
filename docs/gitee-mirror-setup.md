# Gitee 国内镜像加速设置指南

本文档说明如何为 NyaTerm 设置 Gitee 作为国内下载镜像，提升中国大陆用户的下载速度。

## 方案概述

- **GitHub Release**：国际用户下载（标准源）
- **Gitee Release**：中国大陆用户加速下载
- **自动同步**：GitHub Actions 自动将 Release 同步到 Gitee

## 配置步骤

### 1. 在 Gitee 创建镜像仓库

1. 登录 [Gitee](https://gitee.com)
2. 创建新仓库（可以是镜像仓库或独立仓库）
   - 仓库名称：`nyaterm`
   - 是否开源：公开
   - 克隆方式（可选）：从 GitHub 导入（`https://github.com/nyakang/nyaterm`）

### 2. 生成 Gitee 访问令牌

1. 进入 Gitee 设置 → [私人令牌](https://gitee.com/profile/personal_access_tokens)
2. 点击"生成新令牌"
3. 权限选择：
   - ✅ `projects` (读写项目)
   - ✅ `pull_requests` (读写 Pull Request)
   - ✅ `releases` (读写发行版)
4. 复制生成的 Token（只显示一次）

### 3. 配置 GitHub Secrets

在 GitHub 仓库设置中添加以下 Secrets：

- `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

添加两个 Secrets：

| Name | Value | 说明 |
|------|-------|------|
| `GITEE_TOKEN` | `你的Gitee令牌` | 第 2 步生成的 Token |
| `GITEE_REPO` | `owner/repo` | 例如：`nyakang/nyaterm` |

### 4. 启用 Workflow

已创建的 workflow 文件：`.github/workflows/sync-to-gitee.yml`

该 workflow 会在以下情况自动运行：
- ✅ 每次发布新的 GitHub Release
- ✅ 手动触发（Actions 页面选择 workflow 点击 "Run workflow"）

### 5. 修改应用配置支持双源

#### 方案 A：根据用户地区自动选择（推荐）

修改 `src-tauri/tauri.conf.json`：

```json
"updater": {
  "pubkey": "...",
  "endpoints": [
    "https://gitee.com/nyakang/nyaterm/releases/latest/download/latest.json",
    "https://github.com/nyakang/nyaterm/releases/latest/download/latest.json"
  ],
  "windows": {
    "installMode": "passive"
  }
}
```

Tauri 会按顺序尝试，第一个失败才会尝试第二个。将 Gitee 放在前面，国内用户会优先使用。

#### 方案 B：根据语言设置选择

在 `src/lib/updater.ts` 中根据用户语言选择源：

```typescript
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const language = await getLanguage(); // 从设置读取
  
  // 中文用户使用 Gitee，其他用户使用 GitHub
  const endpoint = language === 'zh-CN' 
    ? 'https://gitee.com/nyakang/nyaterm/releases/latest/download/latest.json'
    : 'https://github.com/nyakang/nyaterm/releases/latest/download/latest.json';
  
  // 使用自定义 endpoint 检查更新
  // ...
}
```

#### 方案 C：在设置中让用户选择

在应用设置中添加"更新源"选项：
- 🌐 国际源（GitHub）
- 🇨🇳 中国大陆源（Gitee）
- 🔄 自动选择（根据速度）

### 6. 测试同步

发布测试版本验证同步流程：

```bash
# 创建测试 tag
git tag v1.1.7-test
git push origin v1.1.7-test

# 在 GitHub Actions 查看：
# 1. build-release workflow 完成后
# 2. sync-to-gitee workflow 自动触发
# 3. 检查 Gitee Release 是否同步成功
```

或手动触发同步：
1. 进入 GitHub Actions
2. 选择 "Sync Release to Gitee"
3. 点击 "Run workflow"
4. 输入要同步的 tag（如 `v1.1.6`）

## 验证

### 检查 Gitee Release

访问 `https://gitee.com/你的用户名/nyaterm/releases` 查看：
- ✅ Release tag 已创建
- ✅ 所有安装包已上传
- ✅ `latest.json` 已上传
- ✅ URL 指向 Gitee 下载地址

### 测试更新功能

```bash
# 测试 Gitee 源
curl https://gitee.com/nyakang/nyaterm/releases/latest/download/latest.json

# 验证 JSON 格式
{
  "version": "1.1.6",
  "platforms": {
    "windows-x86_64": {
      "url": "https://gitee.com/nyakang/nyaterm/releases/download/v1.1.6/..."
    }
  }
}
```

## 常见问题

### Q1: Gitee 有文件大小限制吗？
A: 单个文件不能超过 **100MB**（免费版）。如果安装包超过限制：
- 使用 Gitee 企业版（付费）
- 将大文件拆分上传
- 仅同步小文件，大文件仍用 GitHub

### Q2: 同步失败怎么办？
A: 检查以下内容：
1. `GITEE_TOKEN` 是否正确且有足够权限
2. `GITEE_REPO` 格式是否正确（`owner/repo`）
3. Gitee 仓库是否存在且可访问
4. 查看 GitHub Actions 日志排查错误

### Q3: 可以只同步部分文件吗？
A: 可以，修改 workflow 中的上传逻辑：

```bash
for file_path in release-assets/*; do
  filename=$(basename "$file_path")
  
  # 跳过便携版（太大）
  if [[ "$filename" == *"portable"* ]]; then
    echo "Skipping large file: $filename"
    continue
  fi
  
  # 只上传到 Gitee
done
```

### Q4: 如何回滚或删除同步的 Release？
在 Gitee 仓库页面手动删除，或使用 Gitee API：

```bash
curl -X DELETE "https://gitee.com/api/v5/repos/owner/repo/releases/:id?access_token=TOKEN"
```

## 优化建议

1. **设置自动同步代码**：在 Gitee 使用"仓库镜像"功能定期同步代码
2. **README 中注明**：告知用户中国大陆可从 Gitee 下载
3. **监控流量**：定期查看 Gitee Release 下载量
4. **考虑 CDN**：如果预算允许，使用七牛云/阿里云 OSS + CDN 更稳定

## 成本对比

| 方案 | 费用 | 速度（国内） | 稳定性 | 维护成本 |
|------|------|-------------|--------|---------|
| GitHub Release | 免费 | ⭐⭐ | ⭐⭐⭐⭐⭐ | 低 |
| Gitee Release | 免费 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 低 |
| Cloudflare R2 | 免费（有限额） | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 中 |
| 七牛云 CDN | 按量付费 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 中 |

## 相关链接

- [Gitee OpenAPI 文档](https://gitee.com/api/v5/swagger)
- [Tauri Updater 文档](https://v2.tauri.app/plugin/updater/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
