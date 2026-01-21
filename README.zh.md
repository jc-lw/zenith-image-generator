<div align="center">

# Zenith Image Generator

**现代化 AI 文生图 Web 应用**

支持多 AI 提供商的深色模式图片生成器，<br/>
批量生成，一键部署到 Cloudflare Pages。

[English](./README.md) · [更新日志](./docs/CHANGELOG.md) · [在线演示](https://zenith-image-generator.pages.dev)

![Dark Mode UI](https://img.shields.io/badge/UI-Dark%20Mode-1a1a1a)
![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020)
![React](https://img.shields.io/badge/React-19-61DAFB)
![Hono](https://img.shields.io/badge/Hono-4-E36002)

</div>

---

## 功能特性

- **多 AI 提供商** - Gitee AI、HuggingFace Spaces、ModelScope
- **图片转视频** - 从图片生成视频 (Gitee AI)
- **深色模式 UI** - Gradio 风格毛玻璃效果
- **灵活尺寸** - 多种宽高比 (1:1, 16:9, 9:16, 4:3 等)
- **4x 放大** - RealESRGAN 集成
- **安全存储** - API Key 使用 AES-256-GCM 加密
- **Token 轮询** - 多 API Key 自动切换，遇到限流自动换用下一个
- **历史记录（轻量）** - 仅存元数据（URL + 参数）到 localStorage，24 小时自动过期清理
- **Flow 模式** - 可视化批量生成画布 (实验性)

## Token 轮询

支持为每个服务商配置多个 API Token，遇到限流错误 (429) 时自动切换。

### 使用方法

在 API 设置中输入多个 Token，用**英文逗号** (`,`) 分隔：

```
token_1, token_2, token_3
```

> **注意**：必须使用英文逗号 (`,`)，中文逗号 (`，`) 无效。

### 工作原理

1. 优先使用第一个可用的 Token 发起请求
2. 遇到 429 (限流) 错误时，自动切换到下一个 Token
3. 已耗尽的 Token 会被记录，当天不再使用
4. Token 状态每天 UTC 00:00 自动重置
5. 界面实时显示 Token 统计 (总数/可用/已耗尽)

## 快速开始

### 前置要求

- Node.js 18+ / pnpm 9+
- [Gitee AI API Key](https://ai.gitee.com)

### 一键部署

[![部署到 Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?style=for-the-badge&logo=cloudflare)](https://dash.cloudflare.com)

> 连接 GitHub 仓库 → 设置 root 为 `apps/web` → 部署！

### 本地开发

```bash
git clone https://github.com/WuMingDao/zenith-image-generator.git
cd zenith-image-generator
pnpm install

# 配置环境变量
cp apps/web/.env.example apps/web/.env

# 终端 1
pnpm dev:api

# 终端 2
pnpm dev:web
```

打开 `http://localhost:5173`

📖 **[完整开发指南](./docs/zh/CONTRIBUTING.md)**

## 文档

| 文档                                  | 描述                             |
| ------------------------------------- | -------------------------------- |
| [贡献指南](./docs/zh/CONTRIBUTING.md) | 本地配置、局域网访问、开发       |
| [部署指南](./docs/zh/DEPLOYMENT.md)   | Cloudflare、Vercel、Netlify 教程 |
| [API 参考](./docs/zh/API.md)          | 接口、参数、代码示例             |

补充说明：

- 接口返回的是**原始图片 URL**（例如 HuggingFace Space 的 `gradio_api/file=...`）。
- 部分 URL 是**临时文件**（HF Space 通常 24 小时左右会失效）。
- 如需绕过 CORS 下载，可使用代理接口：`GET /api/proxy-image?url=...`。

## 安全性

### API Key 如何被保护

```
浏览器 ──HTTPS──→ Cloudflare Workers ──HTTPS──→ AI 服务商 (Gitee/HuggingFace)
  ↑                      ↑
AES-256-GCM          代理层
加密存储            (你的部署实例)
```

- **本地加密**：API Key 使用 AES-256-GCM 加密后存储在 localStorage
- **传输安全**：所有通信使用 HTTPS 加密
- **代理架构**：你的 Key 发送到你自己的 Workers，而非直接发给 AI 服务商

### ⚠️ 第三方部署警告

> **重要提示**：如果你使用他人部署的实例，部署者可能有能力获取你的 API Key。

原因如下：

1. 部署者可以添加日志代码来捕获请求头中的 Key
2. 你无法验证实际部署的代码是否与开源代码一致
3. Cloudflare 提供了 `wrangler tail` 等工具可以实时查看请求

**安全建议**：

| 场景 | 风险等级 | 建议 |
|------|----------|------|
| 自己部署 | ✅ 安全 | 完全掌控你的 Key |
| 第三方实例 | ⚠️ 有风险 | 仅使用一次性或低额度的 Key |
| 来源不明 | ❌ 不安全 | 不要输入有价值的 API Key |

**为了最大程度保障安全，请始终部署自己的实例。**

## 技术栈

| 层级 | 技术                                    |
| ---- | --------------------------------------- |
| 前端 | React 19, Vite, Tailwind CSS, shadcn/ui |
| 后端 | Hono (TypeScript)                       |
| 部署 | Cloudflare Pages + Functions            |

## star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=WuMingDao/zenith-image-generator&type=date&legend=top-left)](https://www.star-history.com/#WuMingDao/zenith-image-generator&type=date&legend=top-left)

## 许可证

MIT

## 致谢

- [Gitee AI](https://ai.gitee.com) - z-image-turbo 模型
- [shadcn/ui](https://ui.shadcn.com) - UI 组件
- [Hono](https://hono.dev) - Web 框架
