const { notificarAlertaSeguridad } = require('../../scripts/alertMonitor');

const PATRONES_SQLI = [
  /(\b(SELECT|UNION|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|EXEC|EXECUTE)\b.*\b(FROM|INTO|TABLE|DATABASE|WHERE|SET)\b)/i,
  /('|\")\s*(OR|AND)\s*('|\")?\d+('|\")?\s*=\s*('|\")?\d+/i,
  /('|\")\s*(OR|AND)\s+('|\")?[a-z0-9_]+('|\")?\s*=\s*('|\")?[a-z0-9_]+/i,
  /(--|#|\/\*|\*\/|;\s*(DROP|SELECT|INSERT|DELETE|UPDATE))/i,
  /(pg_sleep|information_schema|pg_catalog)/i
];

const contieneSqli = (valor) => {
  if (typeof valor === 'string') {
    return PATRONES_SQLI.some((regex) => regex.test(valor));
  }
  if (Array.isArray(valor)) {
    return valor.some((item) => contieneSqli(item));
  }
  if (valor && typeof valor === 'object') {
    return Object.values(valor).some((val) => contieneSqli(val));
  }
  return false;
};

const sqlInjectionGuard = async (req, res, next) => {
  const payload = { body: req.body, query: req.query, params: req.params };

  if (contieneSqli(payload)) {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const muestra = JSON.stringify(payload).slice(0, 180);

    await notificarAlertaSeguridad(
      'INTENTO_INYECCION_SQL',
      `Ataque SQL Injection bloqueado en [${req.method} ${req.originalUrl}] | Payload: ${muestra}`,
      'CRITICAL',
      ip,
      null
    );

    return res.status(403).json({
      error: 'Petición bloqueada por el sistema de seguridad (Posible Inyección SQL detectada).'
    });
  }

  next();
};

module.exports = sqlInjectionGuard;
