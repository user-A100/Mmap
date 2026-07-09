#!/bin/bash
# ==================== 轨迹记录器 - 一键安装脚本 ====================
# 在 Termux 中运行：bash install.sh
# 自动完成：存储权限、Node.js 安装、项目定位、启动脚本创建

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   📱 轨迹记录器 - 一键安装脚本              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# 检查是否在 Termux 环境中
if [ -z "$TERMUX_VERSION" ] && [ ! -d "/data/data/com.termux" ]; then
    echo -e "${YELLOW}⚠ 未检测到 Termux 环境${NC}"
    echo -e "  此脚本专为 Termux 设计"
    echo -e "  如果你在其他环境运行，请手动安装 Node.js"
    echo ""
    read -p "是否继续？(y/n) " -n 1 -r
    echo ""
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

# ==================== 第一步：设置存储权限 ====================
echo -e "${GREEN}【1/6】设置存储权限...${NC}"
if [ ! -d "$HOME/storage" ]; then
    echo -e "${YELLOW}  ℹ 首次使用，需要授权存储权限${NC}"
    echo -e "${YELLOW}  ⚠ 手机会弹出权限请求，请点击「允许」${NC}"
    echo ""
    termux-setup-storage
    # 等待权限设置完成
    sleep 3
    if [ -d "$HOME/storage" ]; then
        echo -e "${GREEN}  ✅ 存储权限已设置${NC}"
    else
        echo -e "${RED}  ❌ 存储权限设置失败${NC}"
        echo -e "${YELLOW}  请手动执行：termux-setup-storage${NC}"
        echo -e "${YELLOW}  然后重新运行此脚本${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}  ℹ 存储权限已存在${NC}"
fi
echo ""

# ==================== 第二步：更新包管理器 ====================
echo -e "${GREEN}【2/6】更新包管理器...${NC}"
pkg update -y 2>/dev/null || true
echo -e "${GREEN}  ✅ 包管理器已更新${NC}"
echo ""

# ==================== 第三步：安装 Node.js 和 openssl ====================
echo -e "${GREEN}【3/6】安装 Node.js 和 openssl...${NC}"
if command -v node &> /dev/null; then
    echo -e "${YELLOW}  ℹ Node.js 已安装: $(node -v)${NC}"
else
    pkg install -y nodejs
    echo -e "${GREEN}  ✅ Node.js 已安装: $(node -v)${NC}"
fi

if command -v openssl &> /dev/null; then
    echo -e "${YELLOW}  ℹ openssl 已安装${NC}"
else
    pkg install -y openssl-tool
    echo -e "${GREEN}  ✅ openssl 已安装${NC}"
fi
echo ""

# ==================== 第四步：定位项目文件 ====================
echo -e "${GREEN}【4/6】定位项目文件...${NC}"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
TARGET_DIR=""

# 定义所有可能的搜索路径（按优先级排序）
SEARCH_PATHS=(
    "$SCRIPT_DIR"
    "$HOME/storage/shared/Mmap"
    "$HOME/storage/shared/Download/Mmap"
    "$HOME/storage/shared/downloads/Mmap"
    "$HOME/storage/downloads/Mmap"
    "$HOME/storage/shared/文档/Mmap"
    "$HOME/storage/shared/Documents/Mmap"
    "$HOME/storage/shared/手机存储/Mmap"
    "/sdcard/Mmap"
    "/sdcard/Download/Mmap"
    "/sdcard/downloads/Mmap"
    "/storage/emulated/0/Mmap"
    "/storage/emulated/0/Download/Mmap"
    "/storage/emulated/0/downloads/Mmap"
)

# 遍历搜索路径
for path in "${SEARCH_PATHS[@]}"; do
    if [ -n "$path" ] && [ -f "$path/phone-server.js" ]; then
        TARGET_DIR="$path"
        break
    fi
done

# 如果没找到，尝试在常见目录下搜索
if [ -z "$TARGET_DIR" ]; then
    echo -e "${YELLOW}  ℹ 正在搜索项目文件...${NC}"
    # 在 storage/shared 下搜索 Mmap 文件夹
    if [ -d "$HOME/storage/shared" ]; then
        FOUND=$(find "$HOME/storage/shared" -maxdepth 3 -name "phone-server.js" -type f 2>/dev/null | head -1)
        if [ -n "$FOUND" ]; then
            TARGET_DIR="$(dirname "$FOUND")"
        fi
    fi
fi

if [ -n "$TARGET_DIR" ]; then
    echo -e "${GREEN}  ✅ 找到项目文件:${NC}"
    echo -e "${CYAN}     $TARGET_DIR${NC}"
    echo ""
    
    # 检查必要文件
    REQUIRED_FILES=("index.html" "app.js" "styles.css" "phone-server.js" "manifest.json" "sw.js")
    MISSING=0
    for f in "${REQUIRED_FILES[@]}"; do
        if [ ! -f "$TARGET_DIR/$f" ]; then
            echo -e "${RED}  ❌ 缺少文件: $f${NC}"
            MISSING=1
        fi
    done
    
    if [ $MISSING -eq 1 ]; then
        echo -e "${RED}  ❌ 缺少必要文件，请重新复制 Mmap 文件夹到手机${NC}"
        exit 1
    fi
    echo -e "${GREEN}  ✅ 所有必要文件齐全${NC}"
    
    # ══════════════════════════════════════════════════════
    # 关键步骤：复制到 Termux 私有目录
    # Android 共享存储（/storage/emulated/0/...）的 FUSE 文件系统
    # 不支持标准 Unix 权限，chmod 对它无效，导致 Node.js
    # 出现 "permission denied" 错误。
    # 必须把文件复制到 Termux 内部目录才能正常运行。
    # ══════════════════════════════════════════════════════
    TERMUX_HOME_MAP="$HOME/Mmap"
    
    if [ "$TARGET_DIR" != "$TERMUX_HOME_MAP" ]; then
        echo -e "${YELLOW}  ℹ 正在复制到 Termux 内部目录...${NC}"
        echo -e "${CYAN}     源: $TARGET_DIR${NC}"
        echo -e "${CYAN}     目标: $TERMUX_HOME_MAP${NC}"
        
        # 删除旧副本（如果存在）
        if [ -d "$TERMUX_HOME_MAP" ]; then
            rm -rf "$TERMUX_HOME_MAP" 2>/dev/null || true
        fi
        
        # 复制整个项目
        cp -r "$TARGET_DIR" "$TERMUX_HOME_MAP" 2>/dev/null
        
        if [ -d "$TERMUX_HOME_MAP" ] && [ -f "$TERMUX_HOME_MAP/phone-server.js" ]; then
            # 复制成功后，后续使用 Termux 内部目录
            TARGET_DIR="$TERMUX_HOME_MAP"
            # fix 权限（现在 chmod 才真正生效）
            chmod -R 755 "$TARGET_DIR" 2>/dev/null || true
            if [ -d "$TARGET_DIR/.certs" ]; then
                chmod -R 755 "$TARGET_DIR/.certs" 2>/dev/null || true
            fi
            echo -e "${GREEN}  ✅ 已复制到 Termux 内部目录，权限正常${NC}"
        else
            echo -e "${RED}  ❌ 复制失败！尝试在原目录运行...${NC}"
            echo -e "${YELLOW}  ⚠ 原目录在共享存储上，可能仍有权限问题${NC}"
            chmod -R 755 "$TARGET_DIR" 2>/dev/null || true
        fi
    else
        # 已在 Termux 内部，直接修复权限
        echo -e "${YELLOW}  ℹ 修复文件权限...${NC}"
        chmod -R 755 "$TARGET_DIR" 2>/dev/null || true
        if [ -d "$TARGET_DIR/.certs" ]; then
            chmod -R 755 "$TARGET_DIR/.certs" 2>/dev/null || true
        fi
        echo -e "${GREEN}  ✅ 文件权限已修复${NC}"
    fi
else
    echo -e "${RED}  ❌ 未找到项目文件！${NC}"
    echo ""
    echo -e "${YELLOW}  📁 请按以下步骤操作：${NC}"
    echo -e "  1. 把整个 Mmap 文件夹复制到手机存储"
    echo -e "     推荐位置：手机内部存储的 Download 文件夹下"
    echo -e "     即路径为：Download/Mmap/"
    echo -e ""
    echo -e "  2. 复制完成后，重新运行此脚本："
    echo -e "     ${CYAN}bash install.sh${NC}"
    echo ""
    echo -e "${YELLOW}  💡 提示：你也可以手动指定路径${NC}"
    echo -e "     ${CYAN}export MMAP_DIR=/你的/实际/路径/Mmap${NC}"
    echo -e "     ${CYAN}bash install.sh${NC}"
    echo ""
    
    # 检查是否有环境变量指定路径
    if [ -n "$MMAP_DIR" ] && [ -f "$MMAP_DIR/phone-server.js" ]; then
        TARGET_DIR="$MMAP_DIR"
        echo -e "${GREEN}  ✅ 从环境变量找到: $TARGET_DIR${NC}"
    else
        exit 1
    fi
fi
echo ""

# ==================== 第五步：创建启动脚本 ====================
echo -e "${GREEN}【5/6】创建一键启动脚本...${NC}"

# 创建 start.sh 启动脚本（在项目目录中）
cat > "$TARGET_DIR/start.sh" << 'STARTEOF'
#!/bin/bash
# ==================== 一键启动脚本 ====================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   📱 轨迹记录器 - 正在启动...            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ═════════════════════════════════════════════
# 强制清理旧进程（释放 8443 和 8080 端口）
# ═════════════════════════════════════════════
echo "ℹ 正在清理旧进程..."

# 方法1：用 pkill 杀掉旧的 node 进程
pkill -f "node phone-server.js" 2>/dev/null || true
pkill -f "node.*phone-server" 2>/dev/null || true
sleep 1

# 方法2：用 fuser 强制释放端口（Termux 中可用）
fuser -k 8443/tcp 2>/dev/null || true
fuser -k 8080/tcp 2>/dev/null || true
sleep 1

# 方法3：通过 ss 找 PID 再 kill（最后兜底）
for port in 8443 8080; do
    PID=$(ss -tlnp 2>/dev/null | grep ":$port " | sed -n 's/.*pid=\([0-9]*\).*/\1/p')
    if [ -n "$PID" ]; then
        echo "   发现占用端口 $port 的进程 PID=$PID，正在终止..."
        kill -9 "$PID" 2>/dev/null || true
    fi
done
sleep 1

echo "✅ 清理完成，正在启动服务器..."
echo ""

# 启动服务器
node phone-server.js

# 如果服务器异常退出，自动重启
EXIT_CODE=$?
while [ $EXIT_CODE -ne 0 ]; do
    echo ""
    echo "⚠ 服务器异常退出（退出码: $EXIT_CODE），3秒后自动重启..."
    echo "  按 Ctrl+C 取消"
    sleep 3
    node phone-server.js
    EXIT_CODE=$?
done
STARTEOF

chmod +x "$TARGET_DIR/start.sh"
echo -e "${GREEN}  ✅ 启动脚本已创建: $TARGET_DIR/start.sh${NC}"

# 在 HOME 目录创建快捷启动脚本
cat > "$HOME/start-tracker.sh" << EOF
#!/bin/bash
cd "$TARGET_DIR" && bash start.sh
EOF
chmod +x "$HOME/start-tracker.sh"
echo -e "${GREEN}  ✅ 快捷脚本已创建: ~/start-tracker.sh${NC}"
echo ""

# ==================== 第六步：完成 ====================
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ✅ 安装完成！                              ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║                                              ║${NC}"
echo -e "${BLUE}║   📌 日常启动方式（任选一种）：              ║${NC}"
echo -e "${BLUE}║                                              ║${NC}"
echo -e "${BLUE}║   方式一：快捷命令（推荐）                   ║${NC}"
echo -e "${BLUE}║     ~/start-tracker.sh                       ║${NC}"
echo -e "${BLUE}║                                              ║${NC}"
echo -e "${BLUE}║   方式二：进入目录运行                       ║${NC}"
echo -e "${BLUE}║     cd \"$TARGET_DIR\"                    ║${NC}"
echo -e "${BLUE}║     ./start.sh                               ║${NC}"
echo -e "${BLUE}║                                              ║${NC}"
echo -e "${BLUE}║   🌐 启动后用 Chrome 打开：                  ║${NC}"
echo -e "${BLUE}║     https://localhost:8443                   ║${NC}"
echo -e "${BLUE}║                                              ║${NC}"
echo -e "${BLUE}║   💡 防止后台被杀（建议执行）：              ║${NC}"
echo -e "${BLUE}║     termux-wake-lock                         ║${NC}"
echo -e "${BLUE}║                                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# 询问是否立即启动
read -p "是否立即启动服务器？(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$TARGET_DIR"
    ./start.sh
fi