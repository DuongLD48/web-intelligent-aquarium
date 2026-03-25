// ================================================================
// chart-panel.js — Intelligent Aquarium v7.2
// Vẽ 3 biểu đồ đường (Nhiệt độ, pH, TDS) bằng Chart.js.
// Nhận điểm mới qua addPoint() và tự cập nhật realtime.
// Fix: trục X luôn hiển thị đúng cửa sổ 12h thực tế.
// ================================================================

// Chart.js được load qua <script> tag trong HTML (CDN)

// ── Design tokens ────────────────────────────────────────────────
const COLORS = {
    temp: { line: '#f59e0b', fill: 'rgba(245,158,11,0.10)' },
    ph: { line: '#2dd4bf', fill: 'rgba(45,212,191,0.10)' },
    tds: { line: '#a78bfa', fill: 'rgba(167,139,250,0.10)' },
};

const Y_RANGE = {
    temp: { min: 15, max: 40 },
    ph: { min: 4.0, max: 8.5 },
    tds: { min: 0, max: 3000 },
};

// ── Constants ────────────────────────────────────────────────────
const WINDOW_12H_MS = 12 * 60 * 60 * 1000;

/**
 * Tính min/max trục X dựa trên data thực tế:
 * - Nếu không có data → cửa sổ 12h tính từ hiện tại
 * - min = timestamp nhỏ nhất trong tất cả sensor
 * - max = max(timestamp lớn nhất, min + 12h)
 *   → nếu data đủ 12h thì max = điểm cuối + khoảng nhỏ
 *   → nếu data ít hơn 12h thì max = min + 12h (giữ trục rộng)
 * Thực ra yêu cầu: min=đầu data, max=cuối data (tối đa 12h)
 */
function _calcXRange() {
    let minTs = Infinity;
    let maxTs = -Infinity;

    for (const sensor of['temp', 'ph', 'tds']) {
        for (const pt of _data[sensor]) {
            if (pt.x < minTs) minTs = pt.x;
            if (pt.x > maxTs) maxTs = pt.x;
        }
    }

    // Không có data → dùng 12h tính từ hiện tại
    if (minTs === Infinity) {
        const now = Date.now();
        return { min: now - WINDOW_12H_MS, max: now };
    }

    // Có data: min = điểm đầu, max = điểm cuối
    // Nếu khoảng data < 12h thì giữ nguyên (chỉ hiện vùng có data)
    return { min: minTs, max: maxTs };
}

// ── State ────────────────────────────────────────────────────────
const _charts = {};
const _data = { temp: [], ph: [], tds: [] };
const MAX_PTS = 720; // 12h × 60 phút

// ── Init ─────────────────────────────────────────────────────────

export function initCharts() {
    _buildChart('temp', 'chart-temp', '°C', COLORS.temp, Y_RANGE.temp);
    _buildChart('ph', 'chart-ph', 'pH', COLORS.ph, Y_RANGE.ph);
    _buildChart('tds', 'chart-tds', 'ppm', COLORS.tds, Y_RANGE.tds);
}

/**
 * Nạp dữ liệu lịch sử ban đầu (sau fetchHistory).
 */
export function loadHistory(history) {
    for (const sensor of['temp', 'ph', 'tds']) {
        _data[sensor] = (history[sensor] || []).map(p => ({ x: p.ts, y: p.v }));
    }
    // Refresh tất cả cùng lúc để min/max tính từ toàn bộ data
    _refreshAllCharts();
}

/**
 * Thêm 1 điểm mới vào biểu đồ realtime.
 */
export function addPoint(sensor, value, ts) {
    if (!_data[sensor]) return;
    _data[sensor].push({ x: ts, y: value });
    if (_data[sensor].length > MAX_PTS) _data[sensor].shift();

    // Refresh tất cả chart để trục X đồng bộ khi có điểm mới
    _refreshAllCharts();

    const el = document.getElementById('chart-last-update');
    if (el) el.textContent = 'Cập nhật lúc ' + _fmtTime(ts);
}

// ── Export CSV ───────────────────────────────────────────────────

export function exportCSV() {
    const allTs = new Set();
    for (const s of['temp', 'ph', 'tds']) _data[s].forEach(p => allTs.add(p.x));
    const sorted = Array.from(allTs).sort((a, b) => a - b);

    const rows = [
        ['Thời gian', 'Nhiệt độ (°C)', 'pH', 'TDS (ppm)']
    ];
    const lookup = sensor => {
        const map = new Map(_data[sensor].map(p => [p.x, p.y]));
        return ts => { const v = map.get(ts); return v !== undefined ? v : ''; };
    };
    const getTemp = lookup('temp');
    const getPh = lookup('ph');
    const getTds = lookup('tds');

    sorted.forEach(ts => rows.push([_fmtDateFull(ts), getTemp(ts), getPh(ts), getTds(ts)]));

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aquarium_' + _fmtFilename(Date.now()) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

window.exportChartCSV = exportCSV;

// ── Internal ─────────────────────────────────────────────────────

function _buildChart(sensor, canvasId, unit, colors, yRange) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) { console.warn('[chart] canvas not found:', canvasId); return; }

    const ctx = canvas.getContext('2d');

    _charts[sensor] = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                data: [],
                borderColor: colors.line,
                backgroundColor: colors.fill,
                borderWidth: 1.8,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: colors.line,
                tension: 0.3,
                fill: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#ffffff',
                    borderColor: 'rgba(0,0,0,0.10)',
                    borderWidth: 1,
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    padding: 10,
                    callbacks: {
                        title: items => _fmtTime(items[0].parsed.x),
                        label: item => `${item.parsed.y} ${unit}`,
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    // min/max được tính động theo data thực tế — xem _refreshChart
                    min: Date.now() - WINDOW_12H_MS,
                    max: Date.now(),
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 7,
                        callback: v => _fmtTime(v),
                    },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
                y: {
                    min: yRange.min,
                    max: yRange.max,
                    ticks: {
                        color: '#94a3b8',
                        callback: v => v + ' ' + unit,
                    },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
            },
        },
    });
}

function _refreshChart(sensor) {
    const chart = _charts[sensor];
    if (!chart) return;

    // Tính range từ data thực tế (tất cả sensor)
    const { min, max } = _calcXRange();
    chart.options.scales.x.min = min;
    chart.options.scales.x.max = max;

    chart.data.datasets[0].data = _data[sensor];
    chart.update('none');
}

/**
 * Refresh tất cả chart cùng lúc (dùng sau loadHistory để min/max đồng bộ).
 */
function _refreshAllCharts() {
    for (const sensor of['temp', 'ph', 'tds']) {
        _refreshChart(sensor);
    }
}

function _fmtTime(epochMs) {
    const d = new Date(epochMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
}

function _fmtDateFull(epochMs) {
    const d = new Date(epochMs);
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mo} ${hh}:${mm}`;
}

function _fmtFilename(epochMs) {
    const d = new Date(epochMs);
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
        '_',
        String(d.getHours()).padStart(2, '0'),
        String(d.getMinutes()).padStart(2, '0'),
    ].join('');
}