// ==================== 轨迹记录器 - 核心逻辑 ====================
const STATE = {
    tracking: false, paused: false,
    scheduleEnabled: false, schedules: [],
    positions: [], watchId: null,
    startTime: null, pausedDuration: 0, pauseStartTime: null,
    totalDistance: 0, intervalSeconds: 5,
    accuracyLevel: 'high', minDistanceFilter: 3,
};

let map, currentMarker, trackPolyline;
let allPolylines = [], allMarkers = [];
let searchMarker, searchDebounce;

// ---------- 地图 ----------
function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: false })
        .setView([39.9088, 116.3974], 14);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: ['1', '2', '3', '4'], maxZoom: 18, minZoom: 3
    }).addTo(map);
    L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}&scl=1&ltype=4', {
        subdomains: ['1', '2', '3', '4'], maxZoom: 18, minZoom: 3
    }).addTo(map);
    map.on('locationfound', onLocationFound);
    map.on('locationerror', onLocationError);
}

// ---------- WGS84 -> GCJ02 ----------
function wgs84ToGcj02(lat, lng) {
    const PI = Math.PI, a = 6378245.0, ee = 0.00669342162296594323;
    function tLat(x, y) {
        let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
        r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
        r += (20*Math.sin(y*PI) + 40*Math.sin(y/3*PI))*2/3;
        r += (160*Math.sin(y/12*PI) + 320*Math.sin(y*PI/30))*2/3;
        return r;
    }
    function tLng(x, y) {
        let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
        r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
        r += (20*Math.sin(x*PI) + 40*Math.sin(x/3*PI))*2/3;
        r += (150*Math.sin(x/12*PI) + 300*Math.sin(x*PI/30))*2/3;
        return r;
    }
    const dLat = tLat(lng - 105, lat - 35);
    const dLng = tLng(lng - 105, lat - 35);
    const radLat = lat / 180 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sM = Math.sqrt(magic);
    return {
        lat: lat + (dLat*180)/((a*(1-ee))/(magic*sM)*PI),
        lng: lng + (dLng*180)/(a/sM*Math.cos(radLat)*PI)
    };
}

function calcDist(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ---------- 位置更新 ----------
function onPositionUpdate(pos) {
    if (!STATE.tracking || STATE.paused) return;
    const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
    const pt = { lat: gcj.lat, lng: gcj.lng, accuracy: pos.coords.accuracy, timestamp: pos.timestamp || Date.now() };
    if (STATE.positions.length > 0) {
        const last = STATE.positions[STATE.positions.length - 1];
        const d = calcDist(last.lat, last.lng, gcj.lat, gcj.lng);
        if (d < STATE.minDistanceFilter) return;
        STATE.totalDistance += d;
    }
    STATE.positions.push(pt);
    updateCurrentMarker(gcj.lat, gcj.lng);
    updateTrackLine();
    updateStats();
}

function onLocationFound(e) {
    const gcj = wgs84ToGcj02(e.latlng.lat, e.latlng.lng);
    if (!STATE.tracking || STATE.paused) updateCurrentMarker(gcj.lat, gcj.lng);
}
function onLocationError(e) { if (e.code === 1) showPermissionOverlay(); }

// ---------- 地图元素 ----------
function updateCurrentMarker(lat, lng) {
    if (currentMarker) { currentMarker.setLatLng([lat, lng]); }
    else {
        const h = '<div class="pulse-marker"><div class="pulse-ring"></div><div class="pulse-ring pulse-ring-2"></div><div class="pulse-dot"></div></div>';
        currentMarker = L.marker([lat, lng], {
            icon: L.divIcon({ className: 'pulse-marker-container', html: h, iconSize: [40, 40], iconAnchor: [20, 20] }),
            zIndexOffset: 1000
        }).addTo(map);
    }
    if (STATE.tracking && !STATE.paused) map.panTo([lat, lng], { animate: true, duration: 0.5 });
}

function updateTrackLine() {
    if (STATE.positions.length < 2) return;
    const coords = STATE.positions.map(p => [p.lat, p.lng]);
    if (trackPolyline) trackPolyline.setLatLngs(coords);
    else trackPolyline = L.polyline(coords, { color: '#1a73e8', weight: 4, opacity: 0.8, smoothFactor: 2 }).addTo(map);
}

// ---------- 记录控制 ----------
function startTracking() {
    if (STATE.tracking && !STATE.paused) return;
    if (STATE.paused) { resumeTracking(); return; }
    STATE.tracking = true; STATE.paused = false; STATE.positions = [];
    STATE.startTime = Date.now(); STATE.pausedDuration = 0; STATE.totalDistance = 0;
    if (trackPolyline) { map.removeLayer(trackPolyline); trackPolyline = null; }
    if (currentMarker) { map.removeLayer(currentMarker); currentMarker = null; }
    startWatching(); updateButtonStates(); updateStatus('recording'); updateRecordButton();
}
function pauseTracking() {
    if (!STATE.tracking || STATE.paused) return;
    STATE.paused = true; STATE.pauseStartTime = Date.now();
    stopWatching(); updateButtonStates(); updateStatus('paused'); updateRecordButton();
}
function resumeTracking() {
    if (!STATE.tracking || !STATE.paused) return;
    STATE.paused = false;
    if (STATE.pauseStartTime) { STATE.pausedDuration += Date.now() - STATE.pauseStartTime; STATE.pauseStartTime = null; }
    startWatching(); updateButtonStates(); updateStatus('recording'); updateRecordButton();
}
function stopTracking() {
    if (!STATE.tracking) return;
    STATE.tracking = false; STATE.paused = false;
    if (STATE.pauseStartTime) { STATE.pausedDuration += Date.now() - STATE.pauseStartTime; STATE.pauseStartTime = null; }
    stopWatching();
    if (STATE.positions.length >= 2) saveTrack();
    updateButtonStates(); updateStatus('inactive'); updateStats(); updateRecordButton();
}
function clearMapDisplay() {
    if (trackPolyline) { map.removeLayer(trackPolyline); trackPolyline = null; }
    allPolylines.forEach(p => map.removeLayer(p)); allPolylines = [];
    allMarkers.forEach(m => map.removeLayer(m)); allMarkers = [];
    if (currentMarker) { map.removeLayer(currentMarker); currentMarker = null; }
}

// ---------- 定位监控 ----------
function startWatching() {
    const opts = { enableHighAccuracy: STATE.accuracyLevel === 'high', timeout: STATE.intervalSeconds * 2000, maximumAge: STATE.intervalSeconds * 500 };
    navigator.geolocation.getCurrentPosition(pos => {
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        map.setView([gcj.lat, gcj.lng], 16);
        updateCurrentMarker(gcj.lat, gcj.lng);
    }, err => console.warn('初始位置失败:', err.message), opts);
    STATE.watchId = navigator.geolocation.watchPosition(onPositionUpdate, err => {
        if (err.code === 1) showPermissionOverlay();
    }, opts);
}
function stopWatching() { if (STATE.watchId !== null) { navigator.geolocation.clearWatch(STATE.watchId); STATE.watchId = null; } }

// ---------- UI 状态同步 ----------
function updateButtonStates() {
    const bs = document.getElementById('mnu-start'), bp = document.getElementById('mnu-pause'), bst = document.getElementById('mnu-stop');
    if (STATE.tracking && !STATE.paused) {
        bs.disabled = true; bp.disabled = false; bst.disabled = false;
        bs.textContent = '▶ 记录中'; bp.textContent = '⏸ 暂停'; bst.textContent = '⏹ 停止保存';
    } else if (STATE.tracking && STATE.paused) {
        bs.disabled = false; bp.disabled = true; bst.disabled = false;
        bs.textContent = '▶ 继续'; bp.textContent = '已暂停'; bst.textContent = '⏹ 停止保存';
    } else {
        bs.disabled = false; bp.disabled = true; bst.disabled = true;
        bs.textContent = '▶ 开始记录'; bp.textContent = '⏸ 暂停'; bst.textContent = '⏹ 停止保存';
    }
}
function updateStatus(s) {
    const d = document.getElementById('status-dot'), t = document.getElementById('status-text');
    d.className = 'dot'; t.textContent = s === 'recording' ? '记录中' : s === 'paused' ? '已暂停' : '未记录';
    d.classList.add(s === 'recording' ? 'active' : s === 'paused' ? 'paused' : 'inactive');
}
function updateStats() {
    document.getElementById('point-count').textContent = STATE.positions.length;
    document.getElementById('distance').textContent = (STATE.totalDistance / 1000).toFixed(2);
    let elapsed = 0;
    if (STATE.tracking && STATE.startTime) {
        elapsed = Date.now() - STATE.startTime - STATE.pausedDuration;
        if (STATE.pauseStartTime) elapsed -= (Date.now() - STATE.pauseStartTime);
    }
    const m = Math.floor(elapsed / 60000), s = Math.floor((elapsed % 60000) / 1000);
    document.getElementById('duration').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    // 同步弹窗数据
    document.getElementById('mnu-points').textContent = STATE.positions.length;
    document.getElementById('mnu-dist').textContent = (STATE.totalDistance / 1000).toFixed(2);
    document.getElementById('mnu-dur').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
setInterval(() => { if (STATE.tracking) updateStats(); updateClock(); }, 1000);

function updateClock() {
    document.getElementById('current-time').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    if (STATE.scheduleEnabled) checkSchedule(new Date());
}

// ---------- 定时调度 ----------
function updateSchedule() {
    STATE.scheduleEnabled = document.getElementById('schedule-enabled').checked;
    STATE.schedules = [{ start: document.getElementById('start-time').value, end: document.getElementById('end-time').value }];
    saveSettings();
    if (STATE.scheduleEnabled) checkSchedule(new Date());
}
function checkSchedule(now) {
    if (!STATE.scheduleEnabled || STATE.schedules.length === 0) return;
    const ct = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const s = STATE.schedules[0], inW = ct >= s.start && ct < s.end;
    if (inW && !STATE.tracking) startTracking();
    else if (!inW && STATE.tracking && !STATE.paused) pauseTracking();
}

// ---------- IndexedDB ----------
function openDB() {
    return new Promise((res, rej) => {
        const r = indexedDB.open('TrackRecorderDB', 1);
        r.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains('tracks')) { const s = db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true }); s.createIndex('date', 'date', { unique: false }); } };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
}
async function saveTrack() {
    const pts = [...STATE.positions]; if (pts.length < 2) return;
    const track = { date: new Date().toISOString(), startTime: STATE.startTime, endTime: Date.now(), points: pts, distance: STATE.totalDistance, pointCount: pts.length, schedule: STATE.schedules[0] || null };
    try {
        const db = await openDB(), tx = db.transaction('tracks', 'readwrite'), store = tx.objectStore('tracks');
        await new Promise((res, rej) => { const r = store.add(track); r.onsuccess = res; r.onerror = () => rej(r.error); });
        db.close();
        STATE.positions = []; STATE.totalDistance = 0; STATE.startTime = null; STATE.pausedDuration = 0;
        loadHistory(); alert('轨迹已保存!');
    } catch (e) { console.error(e); alert('保存失败'); }
}
async function loadHistory() {
    const el = document.getElementById('history-list');
    try {
        const db = await openDB(), tx = db.transaction('tracks', 'readonly'), store = tx.objectStore('tracks');
        const tracks = await new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        db.close();
        if (!tracks.length) { el.innerHTML = '<p class="empty-hint">暂无历史</p>'; return; }
        tracks.sort((a, b) => b.endTime - a.endTime);
        el.innerHTML = tracks.map(t => {
            const d = new Date(t.date);
            return `<div class="history-item"><div><div class="date">${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</div><div class="meta">${t.pointCount}点·${(t.distance/1000).toFixed(2)}km</div></div><div class="actions"><button class="btn-icon" onclick="viewTrack(${t.id})">查看</button><button class="btn-icon delete" onclick="deleteTrack(${t.id})">删除</button></div></div>`;
        }).join('');
    } catch (e) { el.innerHTML = '<p class="empty-hint">加载失败</p>'; }
}
async function viewTrack(id) {
    try {
        const db = await openDB(), tx = db.transaction('tracks', 'readonly'), store = tx.objectStore('tracks');
        const t = await new Promise((res, rej) => { const r = store.get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        db.close(); if (!t || !t.points || t.points.length < 2) return;
        clearMapDisplay();
        const coords = t.points.map(p => [p.lat, p.lng]);
        allPolylines.push(L.polyline(coords, { color: '#e53935', weight: 4, opacity: 0.8, smoothFactor: 2 }).addTo(map));
        const sp = t.points[0], ep = t.points[t.points.length - 1];
        allMarkers.push(L.marker([sp.lat, sp.lng], { icon: L.divIcon({ className: 'track-marker', html: '<div style="background:#43a047;color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;">起</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(map));
        allMarkers.push(L.marker([ep.lat, ep.lng], { icon: L.divIcon({ className: 'track-marker', html: '<div style="background:#e53935;color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;">终</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(map));
        map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
        switchTab('main');
    } catch (e) { alert('加载失败'); }
}
async function deleteTrack(id) {
    if (!confirm('确定删除？')) return;
    try {
        const db = await openDB(), tx = db.transaction('tracks', 'readwrite'), store = tx.objectStore('tracks');
        await new Promise((res, rej) => { const r = store.delete(id); r.onsuccess = res; r.onerror = () => rej(r.error); });
        db.close(); loadHistory();
    } catch (e) { alert('删除失败'); }
}

// ---------- 标签切换 ----------
function switchTab(name) {
    document.querySelectorAll('.btab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.btab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
    if (name === 'history') loadHistory();
}
document.querySelectorAll('.btab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ---------- 弹窗控制 ----------
function openMenu() { document.getElementById('menu-overlay').classList.remove('hidden'); updateStats(); updateButtonStates(); }
function closeMenu() { document.getElementById('menu-overlay').classList.add('hidden'); }
function focusSearch() { document.getElementById('search-input').focus(); }
function refreshApp() {
    if (STATE.tracking) {
        if (!confirm('正在记录轨迹，刷新将丢失当前未保存的数据。确定刷新？')) return;
    }
    location.reload();
}

// ---------- 搜索 ----------
function initSearch() {
    const inp = document.getElementById('search-input'), clr = document.getElementById('search-clear'), res = document.getElementById('search-results');
    inp.addEventListener('input', function () {
        const q = this.value.trim(); clr.classList.toggle('hidden', q === '');
        clearTimeout(searchDebounce);
        if (q.length < 2) { res.classList.add('hidden'); res.innerHTML = ''; return; }
        searchDebounce = setTimeout(() => searchPlace(q), 400);
    });
    inp.addEventListener('focus', function () { if (this.value.trim().length >= 2) res.classList.remove('hidden'); });
    map.on('click', () => res.classList.add('hidden'));
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { const f = res.querySelector('.search-result-item'); if (f) f.click(); } });
}
function searchPlace(query) {
    const res = document.getElementById('search-results');
    const q = query.toLowerCase();
    let items = [];

    // 优先搜索本地地标
    if (landmarks.length > 0) {
        const matched = landmarks.filter(l => l.name.toLowerCase().includes(q));
        matched.forEach(l => {
            items.push({
                lat: l.lat, lng: l.lng, name: l.name,
                address: '📌 我的地标 · ' + new Date(l.time).toLocaleString('zh-CN'),
                isLocal: true, id: l.id
            });
        });
    }

    // 同时搜索 Nominatim
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=' + (6 - Math.min(items.length, 3)) + '&accept-language=zh&q=' + encodeURIComponent(query), { headers: { 'User-Agent': 'Mmap-Tracker/1.0' } })
        .then(r => r.json()).then(data => {
            data.forEach((item, i) => {
                items.push({
                    lat: item.lat, lng: item.lon,
                    name: item.name || item.display_name.split(',')[0],
                    address: item.display_name || '',
                    isLocal: false
                });
            });
            renderSearchResults(items, res);
        }).catch(() => renderSearchResults(items, res));
}

function renderSearchResults(items, res) {
    if (!items.length) { res.innerHTML = '<div class="search-result-item" style="color:#999">未找到</div>'; res.classList.remove('hidden'); return; }
    res.innerHTML = items.slice(0, 8).map((item, i) => {
        const icon = item.isLocal ? '🏠' : (i === 0 && !items[0].isLocal ? '📍' : '📌');
        const addr = item.address;
        return `<div class="search-result-item" onclick="selectSearchResult(${item.lat},${item.lng},'${item.name.replace(/'/g,"\\'")}')">
            <span class="result-icon">${icon}</span>
            <div class="result-main"><div class="result-name">${item.name}</div><div class="result-addr">${addr}</div></div>
        </div>`;
    }).join('');
    res.classList.remove('hidden');
}
function selectSearchResult(lat, lng, name) {
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-input').value = name;
    document.getElementById('search-clear').classList.remove('hidden');
    if (searchMarker) map.removeLayer(searchMarker);
    const gcj = wgs84ToGcj02(parseFloat(lat), parseFloat(lng));
    searchMarker = L.marker([gcj.lat, gcj.lng], {
        icon: L.divIcon({ className: 'search-marker-container', html: '<div style="background:#e53935;color:#fff;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;font-size:12px;"><span style="transform:rotate(45deg)">📍</span></div>', iconSize: [24, 24], iconAnchor: [12, 24] })
    }).addTo(map);
    searchMarker.bindPopup('<b>' + name + '</b>', { closeButton: true }).openPopup();
    map.flyTo([gcj.lat, gcj.lng], 16, { duration: 1 });
}
function clearSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').classList.add('hidden');
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('search-results').innerHTML = '';
    if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
}

// ---------- 地标管理 ----------
let landmarks = [];
let landmarkMarkers = [];

function loadLandmarks() {
    try { landmarks = JSON.parse(localStorage.getItem('tracker-landmarks') || '[]'); } catch (e) { landmarks = []; }
}
function saveLandmarks() {
    localStorage.setItem('tracker-landmarks', JSON.stringify(landmarks));
    renderLandmarksUI();
    renderLandmarkMarkers();
}
function saveLandmark() {
    navigator.geolocation.getCurrentPosition(pos => {
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        const name = prompt('请输入地标名称:', `我的位置 ${new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}`);
        if (!name) return;
        landmarks.push({ id: Date.now(), name: name.trim(), lat: gcj.lat, lng: gcj.lng, time: Date.now() });
        saveLandmarks();
    }, () => alert('无法获取当前位置，请确保GPS已开启'), { enableHighAccuracy: true, timeout: 8000 });
}
function goToLandmark(id) {
    const lm = landmarks.find(l => l.id === id);
    if (!lm) return;
    map.flyTo([lm.lat, lm.lng], 16, { duration: 1 });
    // 脉冲高亮
    L.circleMarker([lm.lat, lm.lng], { radius: 12, color: '#ff6f00', fillColor: '#ff8f00', fillOpacity: 0.4, weight: 3 }).addTo(map)
        .on('click', function () { map.removeLayer(this); });
}
function deleteLandmark(id) {
    if (!confirm('删除此地标？')) return;
    landmarks = landmarks.filter(l => l.id !== id);
    saveLandmarks();
}
function renderLandmarksUI() {
    const bottomList = document.getElementById('landmark-list');
    const menuList = document.getElementById('menu-landmarks');
    const saveBtn = '<button class="menu-btn primary block" onclick="saveLandmark()" style="margin-bottom:8px;">➕ 保存当前位置为地标</button>';
    if (!landmarks.length) {
        if (bottomList) bottomList.innerHTML = saveBtn + '<p class="empty-hint">暂无地标</p>';
        if (menuList) menuList.innerHTML = '';
        return;
    }
    const html = landmarks.slice().reverse().map(l => `
        <div class="lm-item" onclick="goToLandmark(${l.id})">
            <div><div class="lm-name">📌 ${l.name}</div><div class="lm-meta">${new Date(l.time).toLocaleString('zh-CN')}</div></div>
            <div class="lm-actions"><button class="btn-icon delete" onclick="event.stopPropagation();deleteLandmark(${l.id})">✕</button></div>
        </div>`).join('');
    if (bottomList) bottomList.innerHTML = saveBtn + html;
    if (menuList) menuList.innerHTML = landmarks.slice().reverse().map(l => `
        <div class="lm-item-small" onclick="goToLandmark(${l.id})"><span class="lm-name-s">📌 ${l.name}</span><span class="lm-del" onclick="event.stopPropagation();deleteLandmark(${l.id})">✕</span></div>
    `).join('');
}
function renderLandmarkMarkers() {
    landmarkMarkers.forEach(m => map.removeLayer(m));
    landmarkMarkers = landmarks.map(l => {
        return L.marker([l.lat, l.lng], {
            icon: L.divIcon({ className: 'lm-map-marker', html: '<div style="background:#ff8f00;color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;box-shadow:0 1px 4px rgba(0,0,0,0.3);">📌</div>', iconSize: [20, 20], iconAnchor: [10, 20] })
        }).bindPopup('<b>' + l.name + '</b><br><small>' + new Date(l.time).toLocaleString('zh-CN') + '</small>', { closeButton: true }).addTo(map);
    });
}

// ---------- 快捷记录（一键开始/停止） ----------
function quickToggleRecord() {
    if (STATE.tracking && !STATE.paused) {
        // 正在记录 → 停止并保存
        stopTracking();
    } else if (STATE.tracking && STATE.paused) {
        // 已暂停 → 继续
        resumeTracking();
    } else {
        // 未记录 → 开始
        startTracking();
    }
    updateRecordButton();
}

function updateRecordButton() {
    const btn = document.getElementById('fab-record');
    const inner = document.getElementById('fab-record-inner');
    if (!btn || !inner) return;

    btn.classList.remove('recording');
    if (STATE.tracking && !STATE.paused) {
        btn.classList.add('recording');
        btn.title = '点击停止记录';
        inner.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    } else if (STATE.tracking && STATE.paused) {
        btn.title = '点击继续记录';
        inner.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="8,5 19,12 8,19"/></svg>';
    } else {
        btn.title = '点击开始记录';
        inner.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="8"/></svg>';
    }
}

// ---------- 定位 ----------
function locateMe() {
    const fab = document.getElementById('fab-locate');
    fab.classList.add('locating');

    navigator.geolocation.getCurrentPosition(pos => {
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        updateCurrentMarker(gcj.lat, gcj.lng);
        map.setView([gcj.lat, gcj.lng], 17, { animate: { duration: 0.6 } });
        fab.classList.remove('locating');
    }, err => {
        let msg = '无法获取位置';
        if (err.code === 1) {
            msg = '位置权限被拒绝\n\n请检查：\n① 手机GPS是否开启\n② Chrome是否有位置权限\n   设置→应用→Chrome→权限→位置→允许\n③ 地址栏左侧🔒→位置→允许\n\n如果通过局域网IP访问(192.168.x.x)，\nChrome会屏蔽定位！\n请改用localhost或HTTPS。';
        } else if (err.code === 2) {
            msg = '获取位置超时\n\n请在室外空旷处重试，确保GPS信号良好';
        } else if (err.code === 3) {
            msg = '获取位置超时\n\n请移动到GPS信号好的位置后重试';
        }
        alert(msg);
        fab.classList.remove('locating');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 });
}

// ---------- 设置 ----------
function updateAccuracy() {
    STATE.accuracyLevel = document.getElementById('accuracy-level').value;
    if (STATE.tracking && !STATE.paused) { stopWatching(); startWatching(); }
    saveSettings();
}
function updateInterval() {
    const sel = document.getElementById('update-interval');
    const custom = document.getElementById('custom-interval');
    if (sel.value === 'custom') {
        custom.style.display = 'block';
        const v = parseInt(custom.value);
        if (v && v > 0) {
            STATE.intervalSeconds = v;
            STATE.minDistanceFilter = Math.max(3, v * 0.6);
        }
    } else {
        custom.style.display = 'none';
        STATE.intervalSeconds = parseInt(sel.value);
        STATE.minDistanceFilter = 3;
    }
    if (STATE.tracking && !STATE.paused) { stopWatching(); startWatching(); }
    saveSettings();
}
function saveSettings() {
    localStorage.setItem('tracker-settings', JSON.stringify({
        scheduleEnabled: STATE.scheduleEnabled,
        startTime: document.getElementById('start-time').value,
        endTime: document.getElementById('end-time').value,
        accuracyLevel: STATE.accuracyLevel, intervalSeconds: STATE.intervalSeconds
    }));
}
function loadSettings() {
    const s = localStorage.getItem('tracker-settings'); if (!s) return;
    try {
        const o = JSON.parse(s);
        STATE.scheduleEnabled = o.scheduleEnabled || false; STATE.accuracyLevel = o.accuracyLevel || 'high'; STATE.intervalSeconds = o.intervalSeconds || 5;
        document.getElementById('schedule-enabled').checked = STATE.scheduleEnabled;
        document.getElementById('start-time').value = o.startTime || '08:00';
        document.getElementById('end-time').value = o.endTime || '18:00';
        document.getElementById('accuracy-level').value = STATE.accuracyLevel;
        const sel = document.getElementById('update-interval');
        const custom = document.getElementById('custom-interval');
        const presetVals = [3, 5, 10, 30, 60, 120, 300, 600, 900, 1800, 3600];
        if (presetVals.includes(STATE.intervalSeconds)) {
            sel.value = STATE.intervalSeconds;
            custom.style.display = 'none';
        } else {
            sel.value = 'custom';
            custom.style.display = 'block';
            custom.value = STATE.intervalSeconds;
        }
        if (STATE.scheduleEnabled) STATE.schedules = [{ start: o.startTime || '08:00', end: o.endTime || '18:00' }];
    } catch (e) {}
}

// ---------- 权限 ----------
function showPermissionOverlay() { document.getElementById('permission-overlay').classList.remove('hidden'); }
async function requestPermission() {
    try { const r = await navigator.permissions.query({ name: 'geolocation' }); if (r.state === 'denied') { alert('请在系统设置中允许位置权限'); document.getElementById('permission-overlay').classList.add('hidden'); return; } } catch (e) {}
    navigator.geolocation.getCurrentPosition(() => document.getElementById('permission-overlay').classList.add('hidden'), () => document.getElementById('permission-overlay').classList.add('hidden'), { enableHighAccuracy: true, timeout: 10000 });
}

// ---------- 初始化 ----------
function init() {
    initMap(); initSearch(); loadSettings(); loadLandmarks();
    renderLandmarksUI(); renderLandmarkMarkers();
    updateButtonStates(); updateStatus('inactive'); updateClock();

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

    // Chrome 手机版会屏蔽非安全上下文（不含 localhost）的 GPS 定位
    // window.isSecureContext 是浏览器官方的安全上下文判定
    if (!window.isSecureContext) {
        console.warn('⚠ 非安全上下文：Chrome 可能屏蔽 GPS 定位。请使用 localhost 或 HTTPS 访问。');
    }

    if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then(r => {
            if (r.state === 'denied') showPermissionOverlay();
            else if (r.state === 'prompt') navigator.geolocation.getCurrentPosition(() => {}, () => { if (!STATE.tracking) showPermissionOverlay(); }, { timeout: 5000 });
            r.addEventListener('change', () => { if (r.state === 'denied' && STATE.tracking) { stopTracking(); showPermissionOverlay(); } });
        }).catch(() => {});
    }

    window.addEventListener('beforeunload', () => { if (STATE.tracking) stopWatching(); });

    // 快捷键
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); focusSearch(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') { e.preventDefault(); openMenu(); return; }
        if (e.key === 'Escape') { closeMenu(); clearSearch(); }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) console.log('后台运行中');
        else { updateClock(); updateStats(); updateButtonStates(); }
    });
}

document.addEventListener('DOMContentLoaded', init);