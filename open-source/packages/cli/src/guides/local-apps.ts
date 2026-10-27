// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/feature-guides.test.ts
import type { FeatureGuide } from './types.js'

export const localAppsGuide: FeatureGuide = {
  id: 'local-apps', title: '开发、启动与排查自己的小应用',
  summary: '由本机 AI 编码，启动 loopback HTTP 服务，登记后从手机「我开发的应用」打开。',
  keywords: ['开发应用', '小应用', '本地服务', 'HTML', 'SDK', 'Codex', 'Claude Code', '端口', '通知', 'app'],
  execution: 'client-command',
  body: `# 开发自己的小应用

## 谁来开发，先确认什么

神念管家或用户已经安装、登录并授权的 Codex、Claude Code 等本机 AI 都可以按本指南开发，不强制某个 Provider。先问用途、最小页面与交互、要保存的数据、目标电脑及允许写入的目录。读目标目录已有的项目规则，保护已有文件。缺少第三方 AI 时不得替用户安装、登录；可由当前已有编码工具完成，或说明实际限制。

先查 shennian help local-apps，使用当前 Client 真实支持的命令。本文说明流程，不表示所有已安装手机、Server 和旧 Client 都已支持完整链路。命令不存在时说明需升级，不能伪造登记成功。

## 本地究竟要起什么

只需这个应用自己的 HTTP 服务：在同一个已登记端口同时提供 HTML、JS、CSS、图片与 /api/... 业务接口。纯静态应用不必有业务 API，也不必装数据库；需持久化时在用户确认的应用目录自行保存数据并处理并发。不是启动神念 Server、Relay、MySQL、Redis，也不是部署公网网站。

服务绑定 127.0.0.1，而不是 0.0.0.0；不开放防火墙、不建隧道、不做公网端口映射。Agent 选择一个可用端口，并确认启动进程、工作目录及停止方式。不要直接占用、停止或替换已有服务；重启后需要继续可用时先说明进程生命周期，再经用户同意安排启动方式，不自行创建常驻服务。

可以使用现有 Node/Python/项目框架。以 Node 单进程为例，先在用户确认的新应用目录准备 index.html 和 app.js，再编写 server.mjs（此处仅示意路由，业务按需求实现）：

    import { createServer } from 'node:http'
    import { readFile } from 'node:fs/promises'
    const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]])
    createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/api/status') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ready: true })); return
      }
      const asset = req.method === 'GET' && assets.get(url.pathname)
      if (!asset) { res.writeHead(404); res.end('Not found'); return }
      try {
        const bytes = await readFile(new URL(asset[0], import.meta.url))
        res.writeHead(200, { 'content-type': asset[1] }); res.end(bytes)
      } catch { res.writeHead(500); res.end('Unavailable') }
    }).listen(5173, '127.0.0.1')

index.html 使用 <script src="./app.js" defer></script>；在该目录启动 node server.mjs。5173 只是示例端口，实际需确认未被占用；不要启动后就退出并让子进程随宿主被杀却报告持续可用。此示例不读取任意 URL 对应的文件，避免路径穿越，也不返回异常正文。

## 前端资源和业务 API

资源用相对路径 ./app.js、./style.css、./images/...。Vite 等框架导出相对 base（例如 base: './'），通过本机 HTTP 提供构建后的静态资源。不要依赖 CDN、外部脚本、远程字体、WebSocket 或 HMR；手机只支持显式刷新。应用不能加载神念凭据、.env 或任意电脑文件。

手机网页的 localhost 指手机，不是电脑；普通 fetch('/api/...') 和直连 http://127.0.0.1 都不是受支持的业务桥。使用宿主注入的：

    const result = await window.shennian.personal.service(machineId, port, 'GET', '/api/status', {})
    if (result.status < 200 || result.status >= 300) throw new Error('request_failed')
    // result.body 是 JSON 对象或文本；result.headers 只含允许的响应头。

machineId 来自 shennian local-apps inspect <app-id>，port 是同一登记端口。Agent 可把这些非凭据目标常量写进应用，不要让用户手填内部参数；SDK 不提供读取账号 Token 的接口。支持 GET/POST/DELETE：GET 的 args 为查询参数，其他为 JSON body；不自动重试写请求，业务服务自行做校验与幂等。SDK 只在神念手机宿主中可用，普通电脑浏览器没有这个桥，不能把它报告为完整手机链路成功。

网页 HTML 与静态资源由受认证的 runtime 中转，SDK 由平台注入，不需要把平台源码拷入应用。只允许本人已配对且未暂停访问的机器、当前登记应用和端口，不继承共享电脑权限；不要伪造 appId、换端口或访问其他本机服务。每次响应最多 2 MiB、最多 8 个并发，本机超时 15 秒、宿主等待 22 秒；优化或拆分大资源，不向应用透传 Cookie/Authorization/Host、跟随重定向或暴露平台凭据。

## 登记、打开与更新

服务启动并完成本地检查后，由 Agent 执行（路径、标题和端口换成实际确认值）：

    shennian local-apps register --title "我的应用" --port 5173 --path / --directory /absolute/project
    shennian local-apps list
    shennian local-apps inspect <返回的精确app-id>
    shennian local-apps doctor <返回的精确app-id>

保留返回的精确 id。register 只登记元信息，既不编译代码、安装依赖，也不启动进程、上传 HTML 或部署网站。更新同一个应用时 register 带 --id <精确app-id>，不要每次改代码都新登记一份。

引导用户从手机 功能 → 我开发的应用 刷新列表并点击应用。正常流程由 AI 选端口、启动、登记；不要求用户手工连接端口或填配置。编辑后由服务提供新文件，用户刷新；业务数据如何保存由自己的服务实现。移除只用精确 app-id，且须用户明确要求：shennian local-apps remove <id> 只移除登记，不删除源码、业务数据或停止进程。

## 排错和验收

先 list 找真实登记，再 inspect 看元信息，再 doctor 做该登记入口的单次 GET。doctor 不扫描端口、不返回页面正文、不修复或重启；status=ready 仅代表本机入口 HTTP 成功，不等于 JS、API、Server/Relay 或手机功能都正常。

分层检查：1 服务仍在正确电脑和端口运行；2 HTML 和独立 JS/CSS 返回正确 MIME；3 本地业务 API 正确；4 同账号、本人机器、Client 在线且允许访问；5 手机打开并实际完成读写。不要把登记成功当功能完成。

电脑离线要检查连接；服务退出要经授权启动；不支持方法要检查 Client/手机/服务端版本；资源过大需拆分；鉴权失效走正常登录，不读取或打印 Token。网络或权限错误不自动扫描其他端口、扩大权限、上传目录或回退到公开分享。

## 通知、AI 任务与限制

本地应用 SDK 当前只有受限 HTTP 服务调用，没有任意通知、系统文件或通用 AI 执行 API。要定时让 AI 做工作，按 shennian guide schedules；手机到点通知按 shennian guide reminders。不要编造 window.shennian.notify 等方法，也不要把周期浏览器计时器当成可靠后台任务。

应用源文件和业务数据属于本人电脑；云端只做认证中转，不提供 HTML 版本、回滚、发布或公开分享。不要承诺关机可用、锁屏任意持续执行、别人免登录访问，或自动代办任何未经用户授权的高影响动作。`,
}
