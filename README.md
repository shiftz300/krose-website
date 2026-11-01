# KROSE preview

音色试听、MIDI 录制与编辑。纯静态 HTML / CSS / JavaScript，音频使用分块 Opus 资源，运行与构建均不依赖 KROSS 2 固件或原研究工程。

## 本地开发

使用 Bun 1.4.4 管理依赖、运行构建与测试；Wrangler CLI 使用 Node.js 22（`.node-version` 已提供）。浏览器端没有运行依赖。

```sh
bun install --frozen-lockfile
bun run test
bun run build
bun run dev
```

访问 http://localhost:8766/。端口可用 `PORT=8767 bun run dev` 修改。

- `public/`：直接编辑的网站源文件与部署资源；`catalog.json` 是冻结的音色、曲目及参数数据。
- `public/assets/`：带内容哈希的 Opus 音频包，直接保留在 Git 中，不使用 Git LFS。
- `scripts/`：本地服务器、JavaScript 检查与资源完整性校验。
- `tests/`：MIDI 导入导出、录音编辑、动态 AMS 回归测试及独立测试数据。
- `bun.lock`：包含固定的 Wrangler 4.156.0 及其传递依赖；直接开发依赖为 Wrangler 和固定版本的 `ogg-opus-decoder`。

## Cloudflare Workers（当前部署入口）

默认 `wrangler.jsonc` 使用 Workers Static Assets：`assets.directory` 指向 `public`，不需要 Worker 脚本。未知路径返回 404。

Cloudflare 控制台连接仓库后设置：

| 设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Root directory | 仓库根目录 |
| Build command | `bun run test && bun run build` |
| Deploy command | `bun run deploy` |
| 环境变量 | `BUN_VERSION=1.4.4` |

提交的 `bun.lock` 用于安装 Bun 依赖。构建环境应安装开发依赖，不能设置 `NODE_ENV=production` 跳过 Wrangler。原部署命令 `npx wrangler deploy` 现在也能读取默认 Workers 配置，但建议换为上面的命令以使用项目内固定版本。

本地检查部署配置（不上传、不需要 Cloudflare 登录）：

```sh
bun run deploy:check
```

在已登录 Cloudflare 的环境中运行 `bun run deploy` 发布。

## Cloudflare Pages（可选）

如果改用 Pages 的 Git 集成，先用 `wrangler.pages.jsonc` 替换默认 `wrangler.jsonc`，再设置 Framework 为 `None`、Build command 为 `bun run test && bun run build`、输出目录为 `public`。不要在 Pages 项目里运行 Workers 的默认部署命令。

`wrangler.pages.jsonc` 是 Pages 配置模板。Pages CLI 不支持自定义 `--config` 路径，手动部署前也需先将此模板复制为默认配置：

```sh
cp wrangler.pages.jsonc wrangler.jsonc
bun run deploy:pages
```

仅在切换到 Pages 时执行；当前 Workers 部署保留默认配置。

参考：[Workers 静态资源配置](https://developers.cloudflare.com/workers/static-assets/binding/)、[构建环境](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

## 资源维护

采样解码与固件分析不在此仓库。相关研究保留在相邻 `krose/research` 工程；重新导出目录与音频时，先在研究工程生成并验证，再将 `catalog.json` 和完整的 `assets/` 一起更新到 `public/`。不要混用不同版本目录和资源包。日常网页开发只改此仓库，无需运行研究脚本。

完整演示曲的来源及署名保留在 [music-credits.html](public/music-credits.html)，MIDI 测试文件沿用其中相应的来源和许可。采样源于个人持有设备的研究提取；本仓库未对原厂音色资源授予额外许可。

## OASYS Piano

分类旁的采样库下拉框可切换板载与 OASYS Piano。OASYS Piano 包含 EXPCM001 的 32 个预置引用、272 个采样及其板载波形依赖，音频沿用分块 Opus 有损试听。预置以可选的源波形进行试听，释放包络与 AMS 读取原参数；未重建完整的多 OSC 叠加与原厂效果链。

离线导出入口保留在研究工程 `research/tools/export_oasys_web.py`，完整 PCM24 WAV 与导出记录位于 `research/output/OASYS_Piano_WAV/`。网站正常运行只需要本仓库资源。

## Safari / Opus 兼容

优先原生解码 Ogg Opus。失败后自动启动同源 Worker，通过 `ogg-opus-decoder` 1.7.5 的 WASM 解码，仍使用同一套 Opus 包。解码后进入现有 AudioBuffer 缓存，所有采样准备好之前继续显示加载进度。原生可解码的浏览器不请求解码器资源。

仅发布约 115 KiB 的基础解码器，不发布语音机器学习增强包。厂商 bundle 固定版本与 SHA-256，`bun run build` 从锁定依赖同步并校验。CSP 仅增加同源 Worker 与 WASM 编译权限。解码器及其依赖的许可见 `public/vendor/OPUS-LICENSES.txt`。

## 电脑键盘

默认可连续弹奏 C3–C6，共 37 个音。低音区用 Z–/ 行作白键、其上 S/D/G/H/J/L/; 作黑键；高音区用 Q–] 行作白键、数字行 2/3/4/6/7/9/0/− 作黑键，两组从 E4/F4 接续，没有重复分配。网页琴键显示对应键位。

←/↓ 降低八度，→/↑ 升高八度，空格保持延音。切换八度只影响随后按下的键；已按住的音、原音的松键事件、延音踏板、录音及预览播放继续运行。
