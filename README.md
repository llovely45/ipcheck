# 🌐 ipcheck - Static Version

**ipcheck** 是一个纯静态、零后端依赖的 IP 工具箱。它集成了 IP 分析、风控检测、实时延迟测速和浏览器指纹识别功能。

与原版不同，此版本**不需要 Cloudflare Workers**，所有数据均通过浏览器直接请求支持 CORS 的公共 API 获取。这意味着您可以将其部署在任何静态网页托管服务上（如 GitHub Pages、Cloudflare Pages、Vercel 等），且**不消耗服务器计算额度**。

## ✨ 特性

-   **🎨 极致 UI 设计**：采用玻璃拟态 (Glassmorphism) 风格，配合流畅的入场动画、动态网格背景和 SVG 呼吸光效。
-   **🌍 零后端 / 纯静态**：完全由前端 JavaScript 驱动，无服务器成本。
-   **🛡️ IP 风控判定**：使用无需密钥的 Blackbox API 返回综合允许/拦截建议；接口未提供分项数据时页面不会伪造 Proxy、VPN、Tor 或风险评分。
-   **⚡ 实时延迟测速**：内置 Bilibili, Google, GitHub, OpenAI 等 10+ 常用服务的延迟检测，配备 Sparkline 实时波形图展示网络波动。
-   **📍 多源数据**：
    -   主 IP/地理位置：优先使用 `ipwho.is`，失败时回退到 `ipapi.is` 和 `freeipapi.com`。
    -   国内出口：使用 `myip.ipip.net/json`；国外出口和双栈检测：使用 JSON 版 `ipify`。
    -   连接信息：读取 Cloudflare Trace 获取 TLS/HTTP 版本和边缘节点。
-   **🔁 双栈检测**：同时检测 IPv4 和 IPv6 连接能力。
-   **🕵️ 深度指纹识别**：检测 User Agent、Canvas Hash、GPU 渲染器、屏幕参数、内存估算等硬件指纹。

## � 快速开始

### 本地运行

1.  克隆或下载本项目。
2.  安装依赖（仅用于本地服务器）：
    ```bash
    npm install
    ```
3.  启动预览：
    ```bash
    npm run dev
    ```
4.  浏览器访问显示的地址（通常是 `http://127.0.0.1:8080`）。

### 部署

由于是纯静态页面，部署非常简单：

#### Cloudflare Pages (纯静态 - 推荐)
1.  进入 Cloudflare Dashboard -> **Workers & Pages** -> **Create Application** -> **Pages** -> **Connect to Git**。
2.  选择本仓库。
3.  **Build settings** (构建设置)：
    -   **Framework preset**: None (留空)
    -   **Build command**: (留空)
    -   **Output directory**: `.` (或者留空，即根目录)
4.  点击 **Save and Deploy**。

#### GitHub Pages / Vercel / Netlify
-   直接部署根目录即可。

## ⚠️ 注意事项
-   **风控接口限制**：`blackbox.ipinfo.app/api/v1/:ip` 是免费、无需认证的综合判定接口，只返回 `Y`（建议拦截）、`N`（允许）或 `E`（不可用），不提供数值风险评分及 Proxy/VPN/Tor 分项。
-   **地理信息回退**：`ipapi.is` 的匿名接口目前只提供 IP、归属组织、ASN 和地理信息；检测标记和信誉评分需要密钥，因此不会在前端写入密钥。
-   **API 限流**：公共接口均可能按来源 IP 限流；页面会检查 HTTP 状态并按顺序回退，避免把错误页当成 JSON 数据。
-   **CORS 策略**：部分数据（如 TLS 版本）依赖 `cloudflare.com/cdn-cgi/trace`，在某些浏览器或网络环境下可能被拦截，页面会自动降级处理，不影响主要的 IP 显示功能。
-   **AdGuard/广告拦截器**：拦截器可能阻止公共 IP 接口请求，导致对应卡片显示不可用；建议将本站加入白名单。

## 📄 开源协议
MIT License. 欢迎 Fork 和 Star！
