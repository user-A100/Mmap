// ==================== HTTPS 静态文件服务器 ====================
// 运行：node server.js
// 手机浏览器访问 https://你的电脑IP:8443

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 8443;
const CERT_DIR = path.join(__dirname, '.certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const CNF_PATH = path.join(CERT_DIR, 'openssl.cnf');

function ensureCert() {
    if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
        return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
    }

    console.log('🔐 正在生成自签名证书...');

    // 创建最小化 openssl 配置文件
    fs.writeFileSync(CNF_PATH, `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no
[req_distinguished_name]
CN = localhost
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
`);

    const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 365 -nodes -subj "/CN=localhost" -config "${CNF_PATH}"`;
    execSync(cmd, { stdio: 'pipe' });
    console.log('✅ 证书已生成');
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
};

const tls = ensureCert();
const server = https.createServer(tls, (req, res) => {
    let urlPath = req.url.split('?')[0].replace(/\.\./g, '').replace(/~/g, '');
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(__dirname, urlPath);
    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const nets = os.networkInterfaces();
    let ip = '127.0.0.1';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }
        }
    }
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  🔒 HTTPS 服务器已启动                       ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  手机访问: https://${ip}:8443     ║`);
    console.log('║                                              ║');
    console.log('║  ⚠ 安全警告操作步骤:                          ║');
    console.log('║  1. 看到「不是私密连接」→ 点「高级」           ║');
    console.log('║  2. 点「继续前往(不安全)」                     ║');
    console.log('║  3. 允许位置权限 → 开始记录轨迹               ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
});