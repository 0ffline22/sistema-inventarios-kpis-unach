require('dotenv').config();
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
const pool = require('../database/postgresPool');

const UMBRALES = {
  CPU_MAX: 80.0,
  RAM_MAX: 85.0,
  DISK_MAX: 85.0
};

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

const enviarTelegram = (mensaje) => {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return resolve(false);

    const data = JSON.stringify({
      chat_id: chatId,
      text: mensaje,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  });
};

const enviarGmail = async (asunto, cuerpoHtml) => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return false;
  try {
    await mailTransporter.sendMail({
      from: `"Monitor KPIs UNACH" <${process.env.GMAIL_USER}>`,
      to: process.env.ALERT_EMAIL_TO || process.env.GMAIL_USER,
      subject: asunto,
      html: cuerpoHtml
    });
    return true;
  } catch (err) {
    console.error('Error Gmail:', err.message);
    return false;
  }
};

const verificarServicios = async () => {
  let sshActivo = false;
  try {
    const out = execSync('systemctl is-active ssh || systemctl is-active sshd').toString().trim();
    sshActivo = (out === 'active');
  } catch {
    sshActivo = false;
  }

  let pgActivo = false;
  try {
    await pool.query('SELECT 1');
    pgActivo = true;
  } catch {
    pgActivo = false;
  }

  return {
    ssh: sshActivo ? 'ACTIVO' : 'CAÍDO',
    api_node: 'ACTIVO',
    postgresql_win: pgActivo ? 'CONECTADO' : 'DESCONECTADO'
  };
};

const recolectarTodosLosKpis = async () => {
  const cpus = os.cpus().length;
  const loadAvg1m = os.loadavg()[0];
  const cpuUsage = parseFloat(Math.min(((loadAvg1m / cpus) * 100), 100).toFixed(2));

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsage = parseFloat((((totalMem - freeMem) / totalMem) * 100).toFixed(2));

  let diskUsage = 0;
  try {
    const dfOutput = execSync("df -h / | awk 'NR==2 {print $5}'").toString().trim();
    diskUsage = parseFloat(dfOutput.replace('%', ''));
  } catch {
    diskUsage = 0;
  }

  const servicios = await verificarServicios();

  const uptimeSec = os.uptime();
  const dias = Math.floor(uptimeSec / 86400);
  const horas = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const uptimeTexto = `${dias}d ${horas}h ${mins}m`;

  let conexionesActivas = 0;
  try {
    const ssOut = execSync("ss -tun state established | tail -n +2 | wc -l").toString().trim();
    conexionesActivas = parseInt(ssOut, 10) || 0;
  } catch {
    conexionesActivas = 0;
  }

  let stockBajo = [];
  try {
    const resStock = await pool.query(
      'SELECT codigo, nombre, stock, stock_minimo FROM productos WHERE stock <= stock_minimo'
    );
    stockBajo = resStock.rows;
  } catch {
    stockBajo = [];
  }

  return {
    hostname: os.hostname(),
    cpuUsage,
    loadAvg1m: loadAvg1m.toFixed(2),
    ramUsage,
    diskUsage,
    servicios,
    uptimeTexto,
    conexionesActivas,
    stockBajo
  };
};

const notificarAlerta = async (tipoEvento, descripcion, severidad) => {
  const check = await pool.query(
    `SELECT id FROM bitacora_eventos 
     WHERE tipo_evento = $1 AND descripcion = $2 
       AND creado_en > NOW() - INTERVAL '10 minutes'`,
    [tipoEvento, descripcion]
  );

  if (check.rows.length === 0) {
    await pool.query(
      `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [tipoEvento, descripcion, severidad, '127.0.0.1 (cron)', null]
    );

    const msgTelegram = `🚨 <b>ALERTA DE SISTEMA [${severidad}]</b>\n` +
      `<b>Tipo:</b> ${tipoEvento}\n` +
      `<b>Detalle:</b> ${descripcion}\n` +
      `<b>Fecha:</b> ${new Date().toLocaleString('es-MX')}`;

    const htmlGmail = `
      <div style="font-family: Arial, sans-serif; border-left: 5px solid #dc3545; padding: 15px;">
        <h2 style="color: #dc3545; margin-top: 0;">🚨 Alerta de Sistema [${severidad}]</h2>
        <p><strong>Evento:</strong> ${tipoEvento}</p>
        <p><strong>Descripción:</strong> ${descripcion}</p>
        <p><strong>Servidor:</strong> ${os.hostname()}</p>
        <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-MX')}</p>
      </div>
    `;

    await Promise.all([
      enviarTelegram(msgTelegram),
      enviarGmail(`🚨 [${severidad}] ${tipoEvento} - Servidor UNACH`, htmlGmail)
    ]);
    console.log(`[${new Date().toISOString()}] Alerta enviada (TG+Gmail): ${tipoEvento}`);
  }
};

const ejecutarRevisionAlertas = async () => {
  try {
    const kpis = await recolectarTodosLosKpis();

    if (kpis.cpuUsage >= UMBRALES.CPU_MAX) {
      await notificarAlerta('ALERTA_CPU', `CPU en ${kpis.cpuUsage}% (Load: ${kpis.loadAvg1m})`, 'CRITICAL');
    }
    if (kpis.ramUsage >= UMBRALES.RAM_MAX) {
      await notificarAlerta('ALERTA_RAM', `Memoria RAM crítica al ${kpis.ramUsage}%`, 'CRITICAL');
    }
    if (kpis.diskUsage >= UMBRALES.DISK_MAX) {
      await notificarAlerta('ALERTA_DISCO', `Partición raíz (/) al ${kpis.diskUsage}% de capacidad`, 'CRITICAL');
    }
    if (kpis.servicios.ssh === 'CAÍDO') {
      await notificarAlerta('ALERTA_SERVICIO', `Servicio SSH detenido en ${kpis.hostname}`, 'CRITICAL');
    }
    for (const prod of kpis.stockBajo) {
      await notificarAlerta(
        'ALERTA_STOCK',
        `Stock bajo en [${prod.codigo}] ${prod.nombre}: ${prod.stock} uds (Mínimo: ${prod.stock_minimo})`,
        prod.stock === 0 ? 'CRITICAL' : 'WARNING'
      );
    }
    return kpis;
  } catch (err) {
    console.error('Error en revisión de alertas:', err.message);
    return null;
  }
};

const enviarReporteCompleto = async () => {
  const kpis = await recolectarTodosLosKpis();

  const listaStock = kpis.stockBajo.length > 0
    ? kpis.stockBajo.map(p => `• [${p.codigo}] ${p.nombre}: ${p.stock}/${p.stock_minimo}`).join('\n')
    : '• Todo el inventario en niveles óptimos';

  const reporteTg =
    `📊 <b>REPORTE DE KPIs - SERVIDOR ${kpis.hostname.toUpperCase()}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🖥 <b>CPU:</b> ${kpis.cpuUsage}% (Load avg: ${kpis.loadAvg1m})\n` +
    `🧠 <b>RAM:</b> ${kpis.ramUsage}%\n` +
    `💾 <b>Disco (/):</b> ${kpis.diskUsage}%\n` +
    `⏱ <b>Uptime:</b> ${kpis.uptimeTexto}\n` +
    `🔌 <b>Conexiones activas:</b> ${kpis.conexionesActivas}\n` +
    `⚙️ <b>Servicios:</b> SSH [${kpis.servicios.ssh}] | Node [${kpis.servicios.api_node}] | PG [${kpis.servicios.postgresql_win}]\n` +
    `📦 <b>Alertas Inventario:</b>\n${listaStock}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 ${new Date().toLocaleString('es-MX')}`;

  const reporteHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
      <h2 style="color: #0d6efd; border-bottom: 2px solid #0d6efd; padding-bottom: 8px;">📊 Reporte de KPIs - Servidor ${kpis.hostname}</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Uso de CPU:</strong></td><td>${kpis.cpuUsage}% (Load: ${kpis.loadAvg1m})</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Uso de RAM:</strong></td><td>${kpis.ramUsage}%</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Espacio en Disco (/):</strong></td><td>${kpis.diskUsage}%</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Uptime:</strong></td><td>${kpis.uptimeTexto}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Conexiones Activas:</strong></td><td>${kpis.conexionesActivas}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Estado de Servicios:</strong></td><td>SSH: ${kpis.servicios.ssh} | Node: ${kpis.servicios.api_node} | PostgreSQL: ${kpis.servicios.postgresql_win}</td></tr>
      </table>
      <h4>📦 Estado de Inventario (Propuesta KPI)</h4>
      <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px;">${listaStock}</pre>
      <small style="color: #6c757d;">Generado automáticamente vía cron el ${new Date().toLocaleString('es-MX')}</small>
    </div>
  `;

  await Promise.all([
    enviarTelegram(reporteTg),
    enviarGmail(`📊 Reporte Periódico de KPIs - ${kpis.hostname}`, reporteHtml)
  ]);

  console.log(`[${new Date().toISOString()}] Reporte completo enviado a Telegram y Gmail.`);
};

if (require.main === module) {
  if (process.argv.includes('--reporte')) {
    enviarReporteCompleto().then(() => process.exit(0));
  } else {
    ejecutarRevisionAlertas().then(() => process.exit(0));
  }
}

module.exports = { ejecutarRevisionAlertas, recolectarTodosLosKpis, enviarReporteCompleto, UMBRALES };