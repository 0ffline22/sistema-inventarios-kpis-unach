const jwt = require('jsonwebtoken');
const pool = require('../../database/postgresPool');

const authorize = (rolesPermitidos = []) => {
  return async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

    if (!token) {
      await pool.query(
        `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
         VALUES ($1, $2, $3, $4, $5)`,
        ['ACCESO_DENEGADO', `Intento de acceso sin Token a: ${req.originalUrl}`, 'WARNING', ip, null]
      );
      return res.status(401).json({ error: 'Acceso denegado: Token no proporcionado.' });
    }

    try {
      const secretKey = process.env.JWT_SECRET || 'unach_secret_key_2026';
      const decoded = jwt.verify(token, secretKey);
      req.user = decoded;

      // Validar si el rol del usuario está permitido en la ruta
      if (rolesPermitidos.length > 0 && !rolesPermitidos.includes(decoded.role)) {
        await pool.query(
          `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          ['ROL_INSUFICIENTE', `Usuario ${decoded.email} con rol '${decoded.role}' intentó acceder a: ${req.originalUrl}`, 'WARNING', ip, decoded.userId]
        );
        return res.status(403).json({ error: 'Acceso denegado: Permisos insuficientes.' });
      }

      next();
    } catch (err) {
      await pool.query(
        `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
         VALUES ($1, $2, $3, $4, $5)`,
        ['TOKEN_INVALIDO', `Fallo al verificar Token en: ${req.originalUrl}`, 'WARNING', ip, null]
      );
      return res.status(403).json({ error: 'Token inválido o expirado.' });
    }
  };
};

module.exports = authorize;