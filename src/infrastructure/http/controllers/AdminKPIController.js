const os = require('os');
const pool = require('../../database/postgresPool');

class AdminKPIController {
  async getServerMetrics(req, res) {
    try {
      // Cálculo simple de CPU y RAM
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const ramUsage = (((totalMem - freeMem) / totalMem) * 100).toFixed(2);
      const cpuUsage = (os.loadavg()[0] * 100 / os.cpus().length).toFixed(2);

      // Registrar métrica en PostgreSQL (Windows)
      await pool.query(
        'INSERT INTO kpi_registros (cpu_usage, ram_usage, disk_usage) VALUES ($1, $2, $3)',
        [cpuUsage, ramUsage, 0.00]
      );

      // Auditar alerta si supera el 80% de CPU
      if (parseFloat(cpuUsage) > 80.0) {
        await pool.query(
          `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen) 
           VALUES ($1, $2, $3, $4)`,
          ['ALERTA_CPU', `Uso de CPU elevado detectado: ${cpuUsage}%`, 'CRITICAL', req.ip]
        );
      }

      return res.json({
        cpuUsage: `${cpuUsage}%`,
        ramUsage: `${ramUsage}%`,
        uptime: `${Math.floor(os.uptime() / 60)} minutos`,
        status: 'ONLINE'
      });
    } catch (error) {
      console.error('Error al obtener métricas:', error);
      return res.status(500).json({ error: 'Error al consultar métricas del servidor.' });
    }
  }
}

module.exports = new AdminKPIController();