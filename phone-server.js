// ==================== 手机端 HTTPS 服务器 ====================
// 配合 Termux 使用，手机独立运行，无需电脑
// 首次运行：node phone-server.js
// 会自动生成证书，手机浏览器访问 https://localhost:8443

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HTTPS_PORT = 8443;
const HTTP_PORT = 8080;
const CERT_DIR = path.join(__dirname, '.certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

// ==================== 健壮性增强 ====================
// 捕获未处理的异常，防止服务器崩溃
process.on('uncaughtException', (err) => {
    console.error('⚠ 未捕获的异常（服务器继续运行）:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('⚠ 未处理的 Promise 拒绝（服务器继续运行）:', err);
});

/** 检测是否在 Android Termux 共享存储上运行（共享存储不响应 chmod） */
function isOnSharedStorage() {
    // Android 共享存储路径特征
    const sharedPaths = [
        '/storage/emulated/',
        '/sdcard/',
        'storage/shared/',  // Termux 中的挂载路径
    ];
    const dir = __dirname.replace(/\\/g, '/');
    return sharedPaths.some(p => dir.includes(p));
}

/** 修复文件或目录的权限（适配 Android Termux 环境） */
function fixPermissions(filePath) {
    // ⚠ chmod 在 Android 共享存储（FUSE/sdcardfs）上无效，直接跳过
    if (isOnSharedStorage()) return;
    try {
        const { execSync: es } = require('child_process');
        es(`chmod 644 "${filePath}"`, { stdio: 'pipe', timeout: 3000 });
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            es(`chmod 755 "${filePath}"`, { stdio: 'pipe', timeout: 3000 });
        }
    } catch (e) {
        // 权限修复失败不致命，后续读取时会给出明确报错
    }
}

function ensureCert() {
    // ═══════════════════════════════════════════════════════════
    // 关键检查：是否在共享存储上运行？
    // Android 共享存储使用 FUSE/sdcardfs，不响应 chmod，
    // 导致 Node.js 无法读取证书文件，报 permission denied。
    // ═══════════════════════════════════════════════════════════
    if (isOnSharedStorage()) {
        console.log('❌ 检测到项目在 Android 共享存储上运行！');
        console.log('   当前路径: ' + __dirname);
        console.log('   Android 共享存储不支持 Linux 文件权限，');
        console.log('   Node.js 无法读取证书文件。');
        console.log('');
        console.log('💡 解决方法：');
        console.log('   请将项目复制到 Termux 内部目录后运行：');
        console.log('');
        console.log('   cp -r "' + __dirname + '" ~/Mmap');
        console.log('   cd ~/Mmap');
        console.log('   node phone-server.js');
        console.log('');
        console.log('   或重新运行安装脚本：bash install.sh');
        process.exit(1);
    }

    // 修复项目目录权限（Android Termux 下可能因文件来源不同导致权限异常）
    try {
        if (!isOnSharedStorage()) {
            fixPermissions(__dirname);
            if (fs.existsSync(CERT_DIR)) fixPermissions(CERT_DIR);
        }
    } catch (_) {}

    if (!fs.existsSync(CERT_DIR)) {
        try {
            fs.mkdirSync(CERT_DIR, { recursive: true });
            fixPermissions(CERT_DIR);
        } catch (e) {
            console.error('❌ 无法创建 .certs 目录：', e.message);
            if (e.code === 'EACCES' || e.code === 'EPERM') {
                console.log('💡 权限不足，请尝试：');
                console.log('   1. 确认已执行 termux-setup-storage');
                console.log('   2. 重新运行安装脚本 bash install.sh');
                console.log('   3. 或手动: chmod -R 755 ' + __dirname);
            }
            process.exit(1);
        }
    }

    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
        // 修复已有证书的权限后再读取
        fixPermissions(KEY_PATH);
        fixPermissions(CERT_PATH);
        try {
            const key = fs.readFileSync(KEY_PATH);
            const cert = fs.readFileSync(CERT_PATH);
            console.log('✅ 使用已有证书');
            return { key, cert };
        } catch (e) {
            console.error('❌ 读取证书文件失败：', e.message);
            if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EIO') {
                console.log('');
                console.log('💡 这是文件权限问题，最常见的原因是：');
                console.log('   ① 项目在 Android 共享存储（/sdcard/ 等）上运行');
                console.log('   ② .certs 目录残留了 root 权限的文件');
                console.log('   ③ Termux 存储权限未授权');
                console.log('   ✅ 解决方法：');
                console.log('      rm -rf ' + CERT_DIR);
                console.log('      或 cp -r "' + __dirname + '" ~/Mmap && cd ~/Mmap && node phone-server.js');
            }
            // 尝试清理并重新生成证书
            console.log('');
            console.log('💡 正在尝试清理旧证书并重新生成...');
            try { fs.unlinkSync(KEY_PATH); } catch (_) {}
            try { fs.unlinkSync(CERT_PATH); } catch (_) {}
            try { fs.rmdirSync(CERT_DIR); } catch (_) {}
            // 直接生成新证书，不再递归（避免无限循环）
            console.log('🔐 正在重新生成自签名证书...');
            try {
                execSync(
                    `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 3650 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
                    { stdio: 'pipe' }
                );
                fixPermissions(KEY_PATH);
                fixPermissions(CERT_PATH);
                console.log('✅ 证书已重新生成');
                return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
            } catch (genErr) {
                console.error('❌ 重新生成证书也失败：', genErr.message);
                process.exit(1);
            }
        }
    }

    console.log('🔐 正在生成自签名证书（约 5 秒）...');
    try {
        execSync(
            `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 3650 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
            { stdio: 'pipe' }
        );
        // 生成后修复权限
        fixPermissions(KEY_PATH);
        fixPermissions(CERT_PATH);
        console.log('✅ 证书已生成（有效期 10 年）');
    } catch (e) {
        console.error('❌ 证书生成失败：', e.message);
        if (e.message.includes('EACCES') || e.message.includes('EPERM')) {
            console.log('💡 权限不足，请尝试：');
            console.log('   1. chmod -R 755 ' + __dirname);
            console.log('   2. 或在项目目录外运行：cp -r ' + __dirname + ' /data/data/com.termux/files/home/Mmap && cd ~/Mmap && node phone-server.js');
        } else {
            console.log('💡 请确保已安装 openssl：pkg install openssl-tool');
        }
        process.exit(1);
    }
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
};

function serveFile(req, res, rootDir) {
    try {
        let filePath = path.join(rootDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = path.join(rootDir, 'index.html');
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
            'Service-Worker-Allowed': '/',
        });
        res.end(content);
    } catch (e) {
        res.writeHead(404);
        res.end('404 Not Found');
    }
}

function startHTTPS() {
    const cert = ensureCert();
    const server = https.createServer(cert, (req, res) => serveFile(req, res, __dirname));
    
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ 端口 ${HTTPS_PORT} 被占用！`);
            console.log('💡 解决方法：输入 pkill node 结束占用进程，然后重新运行');
        } else {
            console.error('❌ 服务器错误:', err.message);
        }
        process.exit(1);
    });
    
    server.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log('');
        console.log('╔══════════════════════════════════════════╗');
        console.log('║   📱 轨迹记录器 - HTTPS 服务器已启动     ║');
        console.log('╠══════════════════════════════════════════╣');
        console.log('║                                          ║');
        console.log(`║   🔒 访问地址：                          ║`);
        console.log(`║   https://localhost:${HTTPS_PORT}              ║`);
        console.log(`║   或 https://127.0.0.1:${HTTPS_PORT}          ║`);
        console.log('║                                          ║');
        console.log('║   📌 在 Chrome 中打开上方地址             ║');
        console.log('║   📌 首次需点"高级"→"继续前往"           ║');
        console.log('║   📌 然后允许位置权限即可使用             ║');
        console.log('║                                          ║');
        console.log('║   ⚠ 按 Ctrl+C 停止服务器                 ║');
        console.log('╚══════════════════════════════════════════╝');
        console.log('');
        console.log('💡 提示：如需防止后台被杀，请运行 termux-wake-lock');
        console.log('');
    });
}

// 同时开一个 HTTP 端口做自动跳转
function startHTTPRedirect() {
    const httpServer = http.createServer((req, res) => {
        res.writeHead(301, { Location: `https://localhost:${HTTPS_PORT}${req.url}` });
        res.end();
    });

    httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`   ⚠ HTTP 端口 ${HTTP_PORT} 被占用（可能是上次未完全关闭），已忽略`);
        }
    });

    httpServer.listen(HTTP_PORT, () => {
        console.log(`   ℹ  HTTP 自动跳转: http://localhost:${HTTP_PORT} → HTTPS`);
    });
}

startHTTPS();
startHTTPRedirect();
