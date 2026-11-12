const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../database/postgresPool');
const { notificarAlertaSeguridad } = require('../../scripts/alertMonitor');

const login = async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos.' });
  }

  try {
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.password_hash AS password, r.nombre AS rol_nombre
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE LOWER(u.email) = LOWER($1)`,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      await notificarAlertaSeguridad(
        'LOGIN_FALLIDO',
        `Intento de acceso con usuario inexistente: ${cleanEmail}`,
        'WARNING',
        ip,
        null
      );
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const usuario = result.rows[0];
    const dbPassword = (usuario.password || '').trim();

    let validPassword = (cleanPassword === dbPassword);

    if (!validPassword && dbPassword.startsWith('$2')) {
      try {
        validPassword = await bcrypt.compare(cleanPassword, dbPassword);
      } catch (err) {
        validPassword = false;
      }
    }

    if (!validPassword) {
      await notificarAlertaSeguridad(
        'LOGIN_FALLIDO',
        `Contraseña incorrecta ingresada para la cuenta: ${cleanEmail}`,
        'WARNING',
        ip,
        usuario.id
      );
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const secretKey = process.env.JWT_SECRET || 'unach_secret_key_2026';
    const token = jwt.sign(
      { userId: usuario.id, role: usuario.rol_nombre, email: usuario.email },
      secretKey,
      { expiresIn: '8h' }
    );

    await pool.query(
      `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id)
       VALUES ($1, $2, $3, $4, $5)`,
      ['LOGIN_EXITOSO', `Inicio de sesión exitoso de ${usuario.email} (${usuario.rol_nombre})`, 'INFO', ip, usuario.id]
    );

    return res.json({
      mensaje: 'Autenticación exitosa',
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol_nombre
      }
    });

  } catch (err) {
    console.error('Error en el login:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

module.exports = { login };
