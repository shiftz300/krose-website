# KROSE preview

音色试听、MIDI 录制与编辑。纯静态 HTML / CSS / JavaScript，音频使用分块 Opus 资源，运行与构建均不依赖 KROSS 2 固件或原研究工程。

## 本地开发

需要 Node.js 22 或更新版本，无 npm 依赖需要安装。

```sh
npm test
npm run build
npm run dev
```

访问 http://localhost:8766/。端口可用 `PORT=8767 npm run dev` 修改。

- `public/`：直接编辑的网站源文件与部署资源；`catalog.json` 是冻结的音色、曲目及参数数据。
- `public/assets/`：带内容哈希的 Opus 音频包，直接保留在 Git 中，不使用 Git LFS。
- `scripts/`：本地服务器、JavaScript 检查与资源完整性校验。
- `tests/`：MIDI 导入导出、录音编辑、动态 AMS 回归测试及独立测试数据。

## Cloudflare Pages

在 Cloudflare Pages 中连接 `shiftz300/krose-website` GitHub 仓库：

| 设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm test && npm run build` |
| Build output directory | `public` |
| Root directory | 仓库根目录 |
| Node.js | `22`（`.node-version` 已提供） |

`wrangler.jsonc` 已声明项目名及静态输出目录。首次连接仓库仍需要在自己的 Cloudflare 账号中完成；仓库配置不会自动创建账号绑定。

也可在已配置 Cloudflare 登录的环境中使用 `npx wrangler pages deploy public --project-name=krose-website` 手动部署。

参考：[静态 HTML 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)、[Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。

## 资源维护

采样解码与固件分析不在此仓库。相关研究保留在相邻 `krose/research` 工程；重新导出目录与音频时，先在研究工程生成并验证，再将 `catalog.json` 和完整的 `assets/` 一起更新到 `public/`。不要混用不同版本目录和资源包。日常网页开发只改此仓库，无需运行研究脚本。

完整演示曲的来源及署名保留在 [music-credits.html](public/music-credits.html)，MIDI 测试文件沿用其中相应的来源和许可。采样源于个人持有设备的研究提取；本仓库未对原厂音色资源授予额外许可。
