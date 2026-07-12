# Mmap · 被动行程记录器

> 一个装在手机里、默默记下你每一段路的轻量轨迹记录器。

## 创作初衷

我有一个困扰很久的小毛病：**经常忘记自己的自行车停在了哪里。**

每次停好车去办事，出来后总是大脑一片空白——"车呢？"于是只能凭着模糊的回忆，沿着记忆里来时的路一步步往回倒退着找，有时找得到，有时要绕上好几圈。次数多了，我开始想：与其每次都靠脑子"倒带"，不如让手机替我把路记下来。

于是我做了 **Mmap**——一个可以**被动记录自己行程**的手机应用。它在你出行时安静地在后台画下你的轨迹，停好车、办完事，打开地图往回一顺，车在哪、来时怎么走的，一目了然。不需要主动操作，不需要动脑回忆。

> 名字 **Mmap** 取自 *Memory Map*——把记忆交给地图。

## 功能特性

- 🚲 **一键记录** —— 大圆形悬浮按钮，点一下开始 / 再点一下停止，零门槛。
- ⏰ **被动定时记录** —— 设置时段（如 08:00–18:00），进入时段自动开始记录，离开自动暂停，真正做到"被动"。
- 📌 **地标管理** —— 把常去的位置（车位、家门口、常去的店）保存为地标，随时一键导航回去。
- 🗺️ **历史轨迹回看** —— 所有轨迹本地存档，随时在地图上重绘，标注起点 / 终点，找回停错的车就靠它。
- 🔍 **地点搜索** —— 关键字搜索地点与已存地标，快速定位。
- 📊 **实时统计** —— 点数、里程（km）、时长，记录过程中实时更新。
- ⚙️ **精度与间隔可调** —— 高精度 / 平衡 / 省电三档；采样间隔从 3 秒到 1 小时，或自定义。
- 📴 **离线可用** —— Service Worker 缓存静态资源与地图瓦片，弱网 / 无网也能回看走过的路。
- 🔒 **完全本地** —— 轨迹存 IndexedDB、地标存 localStorage，数据不出手机，无云端、无账号。

## 三种使用方式

### 方式一：手机独立运行（Termux，推荐）

完全脱离电脑，手机自己当服务器。详见 [`使用说明.txt`](使用说明.txt)，核心步骤：

```bash
# 1. 安装 Termux（从 F-Droid，勿用 Play 商店旧版）
# 2. 把整个 Mmap 文件夹复制到手机 Download 目录
termux-setup-storage
cd ~/storage/shared/Download/Mmap
bash install.sh          # 自动装 Node.js / openssl，生成启动脚本

# 3. 启动
~/start-tracker.sh
# 4. Chrome 访问
#    https://localhost:8443   （首次点「高级」→「继续前往」，再允许定位）
```

防后台被杀：`termux-wake-lock`，并把 Termux 电池设为「无限制」。
装到桌面：Chrome 菜单 →「添加到主屏幕」，即得 PWA 图标。

### 方式二：电脑运行 + 手机访问（同一 WiFi）

```bash
node server.js
# 控制台会打印 https://你的电脑IP:8443
# 手机 Chrome 访问该地址即可（需与电脑同 WiFi）
```

适合临时使用，但依赖电脑开机。

### 方式三：直接安装 APK

每次推送到 `master`，GitHub Actions 会自动构建 Debug APK 并发布到 [Releases](https://github.com/user-A100/Mmap/releases)。下载安装即可，无需 Termux。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | 原生 HTML / CSS / JS，[Leaflet](https://leafletjs.com/) 地图 |
| 地图瓦片 | 高德地图（含 WGS84 → GCJ02 坐标转换） |
| 存储 | IndexedDB（轨迹）+ localStorage（地标） |
| 离线 | Service Worker（静态资源 Cache-First，瓦片 Network-First） |
| 服务器 | Node.js HTTPS（`phone-server.js` 手机端 / `server.js` 电脑端），openssl 自签名证书 |
| 原生壳 | Android WebView（`android/`，Gradle 构建） |
| CI | GitHub Actions，自动打包 APK 并发 Release |

## 项目结构

```
Mmap/
├── index.html / app.js / styles.css   # PWA 主体
├── leaflet.js / leaflet.css           # 地图库（本地化）
├── manifest.json / sw.js              # PWA 配置 + 离线缓存
├── icon-*.png                         # 各尺寸图标
├── phone-server.js                    # 手机端 HTTPS 服务器（配合 Termux）
├── server.js                          # 电脑端 HTTPS 服务器
├── install.sh                         # Termux 一键安装脚本
├── 使用说明.txt                       # 详细部署说明
└── android/                           # 原生 APK 壳（GitHub Actions 构建用）
```

## 隐私

这是一个**写给自己的工具**：所有轨迹与地标都只存在你的手机本地，不上传任何服务器，不连任何云端，不需要注册账号。地图瓦片由高德提供，除此之外没有第三方数据流向。

## License

个人自用项目，暂未设定开源协议。
