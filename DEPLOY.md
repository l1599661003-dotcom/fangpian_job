# 人才管理系统 · 部署说明

本说明根据导出时的源码自动生成, 仅供参考; 应用在平台外运行前请先通读源码。

## 一、本地运行

1. 准备环境变量: 把 `config/env.example` 复制为 `source/.env`, 按实际填写各项的值(导出包里的值已脱敏)。
2. 安装 Node.js(建议 20 及以上), 在 `source/` 下执行 `pnpm install`。
3. 开发模式运行 `pnpm dev`; 生产构建看 `package.json` 的 `scripts`(通常是 build / start)。

## 二、私有化部署

源码自带 `Dockerfile`, 可直接构建镜像:

```bash
cd source
docker build -t r5vd-1031 .
docker run -d -p 8080:8080 --env-file .env r5vd-1031
```

端口以 Dockerfile 里 `EXPOSE` / 启动命令为准。

## 三、离开平台后需要改造的部分

- **数据库**: 应用在平台上使用平台托管的数据库。离开平台后需要自建数据库, 用 `database/` 里每张表的 CSV / JSON 导入,并把源码里调用平台数据库接口的地方改成直连自己的数据库。
- **平台接口与登录**: `config/env.example` 末尾列出的平台变量(如 `ARP_API_TOKEN`、`STUDIO_PLATFORM_URL`)离开平台后不存在, 依赖它们的登录、身份、平台接口调用需要替换。
- **上传文件**: 包内只有下载地址清单(`files/manifest.csv`, 有效期有限), 请在有效期内把需要的文件下载下来, 迁到自己的存储。
