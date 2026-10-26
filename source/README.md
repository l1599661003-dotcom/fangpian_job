# 方片人才管理系统（原项目还原）

本工作区由用户于 2026-08-21 上传的原始交付包还原而成。还原原则是保留原页面、交互、业务数据和素材，仅增加 ARP Studio 所需的单端口启动层。

## 运行入口

- `/`：企业内部人才管理系统（原 `方片招聘网站界面.html`）
- `/方片招聘网站原型.html` 或 `/candidate`：候选人招聘官网
- `/会议室预订原型.html` 或 `/meeting-room`：会议室预订原型

## 目录

- `source-app/`：原始可运行页面、JS、CSS、Excel 数据与图片/PDF 素材
- `project-docs/`：原方案、配置清单、渲染稿和招聘 Agent 技能包
- `tools/`：原方案生成脚本
- `dist/client/`：`pnpm run build` 生成的静态发布目录
- `server.mjs`：同一端口提供全部前端文件的 Studio 启动服务

## Studio 契约

- 构建：`pnpm run build`
- 开发启动：`pnpm start:dev`
- 监听端口：`process.env.PORT`

主界面原有的两处内嵌 base64 Logo 与随包的 `fangpian-wordmark.png` 内容完全相同。构建阶段将它们改为静态文件引用，避免重复内嵌，同时保持原图不变。
