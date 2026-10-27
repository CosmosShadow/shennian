# 第三方组件与素材

神念自己的使用条款不替代第三方许可证。安装的 npm 包、原生依赖和容器基础组件仍适用各自的条款；重新分发时应保留随包提供的 LICENSE、NOTICE 与源代码获取信息。

## 随源码直接附带的浏览器资源

`packages/app/public/vditor/` 的静态资源与 Vditor 3.11.2 npm 包中的对应文件逐字节核对；该目录用于离线加载编辑器，不应误删为普通构建缓存。

- Vditor：MIT，[许可文本](vditor-LICENSE.txt)，上游 [B3log/vditor](https://github.com/Vanessa219/vditor)。其捆绑的 Lute、语言和图标资源仍需保留上游的权利声明。
- 捆绑 Highlight.js 11.7.0：BSD-3-Clause，[许可文本](highlightjs-LICENSE.txt)。它与依赖解析器安装的其他 Highlight.js 版本不是同一个制品。
- KaTeX、Expo 图标等从各自 npm 包构建，保留安装包中的许可证和字体声明。

## 构建与分发边界

依赖清单不是法律审核结论。尤其要检查 LGPL（例如 MariaDB Node.js 驱动、libvips）、MPL（例如 Lightning CSS、Web Push）及 CC-BY 数据等组件的分发、修改和署名义务。Docker 中引用的 MariaDB、Redis、Node.js 与操作系统组件，iOS CocoaPods 和 Android Maven 依赖也需按实际制品另行核对，不能用 JavaScript 工作区清单替代。

神念品牌图标与界面截图不因第三方组件使用宽松许可而自动获得去品牌授权。不要删除第三方版权声明，也不要把神念的商业授权解释为第三方许可证豁免。
