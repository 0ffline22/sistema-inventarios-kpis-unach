const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const pool = require('../../database/postgresPool');

// Estado previo en memoria para velocidad de red (KB/s) y uso real de CPU (%)
let prevNetStats = { rxBytes: null, txBytes: null, timestamp: null };
let prevCpuTimes = null;

const obtenerUsoCpuReal = () => {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }

  let cpuPercent = 0;
  if (prevCpuTimes !== null) {
    const idleDiff = idle - prevCpuTimes.idle;
    const totalDiff = total - prevCpuTimes.total;
    if (totalDiff > 0) {
      cpuPercent = (1 - idleDiff / totalDiff) * 100;
    }
  } else {
    const loadAvg = os.loadavg()[0];
    cpuPercent = Math.min((loadAvg / cpus.length) * 100, 100);
  }

  prevCpuTimes = { idle, total };
  return Math.max(0, Math.min(cpuPercent, 100)).toFixed(2);
};

const leerBytesRed = () => {
  try {
    const netData = fs.readFileSync('/proc/net/dev', 'utf8').split('\n');
    let seleccionada = null;

    for (const line of netData) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Inter-') || trimmed.startsWith('face') || trimmed.startsWith('lo:')) {
        continue;
      }

      const [ifaceRaw, rest] = trimmed.split(':');
      const iface = ifaceRaw.trim();
      const parts = rest.trim().split(/\s+/);
      const rxBytes = parseInt(parts[0], 10) || 0;
      const txBytes = parseInt(parts[8], 10) || 0;

      // Elegir siempre la interfaz física/virtual con mayor tráfico acumulado (ej. eth1, eth0, enp0s3)
      if (!seleccionada || (rxBytes + txBytes) > (seleccionada.rxBytes + seleccionada.txBytes)) {
        seleccionada = { iface, rxBytes, txBytes };
      }
    }

    return seleccionada || { iface: 'eth1', rxBytes: 0, txBytes: 0 };
  } catch (err) {
    return { iface: 'eth1', rxBytes: 0, txBytes: 0 };
  }
};

const obtenerMetricasServidor = () => {
  // 1. Uso de RAM
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsage = (((totalMem - freeMem) / totalMem) * 100).toFixed(2);

  // 2. Uso de CPU en tiempo real
  const cpuUsage = obtenerUsoCpuReal();

  // 3. Uso de Disco en (/)
  let diskUsage = '0.00';
  try {
    const dfOutput = execSync("df -h / | awk 'NR==2 {print $5}'").toString().trim();
    diskUsage = parseFloat(dfOutput.replace('%', '')).toFixed(2);
  } catch (err) {
    diskUsage = '0.00';
  }

  // 4. Tráfico de Red en tiempo real (KB/s) y total acumulado (MB)
  const now = Date.now();
  const actual = leerBytesRed();
  let rxKbps = 0;
  let txKbps = 0;

  if (prevNetStats.timestamp !== null && prevNetStats.rxBytes !== null) {
    const deltaSeconds = (now - prevNetStats.timestamp) / 1000;
    if (deltaSeconds > 0) {
      const deltaRx = Math.max(0, actual.rxBytes - prevNetStats.rxBytes);
      const deltaTx = Math.max(0, actual.txBytes - prevNetStats.txBytes);
      rxKbps = (deltaRx / 1024) / deltaSeconds;
      txKbps = (deltaTx / 1024) / deltaSeconds;
    }
  }

  prevNetStats = {
    rxBytes: actual.rxBytes,
    txBytes: actual.txBytes,
    timestamp: now
  };

  return {
    cpu_usage: parseFloat(cpuUsage),
    ram_usage: parseFloat(ramUsage),
    disk_usage: parseFloat(diskUsage),
    red: {
      interfaz: actual.iface,
      rx_kbps: rxKbps.toFixed(2),
      tx_kbps: txKbps.toFixed(2),
      rx_mb: (actual.rxBytes / (1024 * 1024)).toFixed(2),
      tx_mb: (actual.txBytes / (1024 * 1024)).toFixed(2)
    }
  };
};

// Telemetría en tiempo real (para refresco automático cada 2s sin inundar la bitácora)
const getLiveKpis = async (req, res) => {
  try {
    const metricas = obtenerMetricasServidor();
    return res.json({
      servidor: os.hostname(),
      lectura_actual: {
        cpu_usage: metricas.cpu_usage.toFixed(2),
        ram_usage: metricas.ram_usage.toFixed(2),
        disk_usage: metricas.disk_usage.toFixed(2)
      },
      red: metricas.red
    });
  } catch (err) {
    console.error('Error en telemetría live:', err);
    return res.status(500).json({ error: 'Error al leer métricas en vivo.' });
  }
};

// Obtener KPIs, persistir en PostgreSQL y registrar evento en bitácora
const getKpis = async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

  try {
    const metricas = obtenerMetricasServidor();

    const insertResult = await pool.query(
      `INSERT INTO kpi_registros (cpu_usage, ram_usage, disk_usage) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [metricas.cpu_usage, metricas.ram_usage, metricas.disk_usage]
    );

    const historyResult = await pool.query(
      'SELECT * FROM kpi_registros ORDER BY id DESC LIMIT 10'
    );

    await pool.query(
      `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'ACCESO_ADMIN',
        `Snapshot KPIs (CPU: ${metricas.cpu_usage}%, RAM: ${metricas.ram_usage}%, Disco: ${metricas.disk_usage}%, Red ${metricas.red.interfaz}: ${metricas.red.rx_kbps}KB/s ${metricas.red.tx_kbps}KB/s)`,
        'INFO',
        ip,
        req.user.userId
      ]
    );

    return res.json({
      servidor: os.hostname(),
      lectura_actual: insertResult.rows[0],
      red: metricas.red,
      historial: historyResult.rows
    });
  } catch (err) {
    console.error('Error al procesar KPIs:', err);
    return res.status(500).json({ error: 'Error interno al recolectar métricas del servidor.' });
  }
};

module.exports = { getKpis, getLiveKpis };
