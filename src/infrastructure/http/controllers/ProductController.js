const pool = require('../../database/postgresPool');

// 1. Obtener todos los productos (Lectura: ADMINISTRADOR y OPERADOR)
const getProductos = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM productos ORDER BY id ASC');
    return res.json(result.rows);
  } catch (err) {
    console.error('Error al listar productos:', err);
    return res.status(500).json({ error: 'Error interno al consultar el inventario.' });
  }
};

// 2. Registrar un nuevo producto (Escritura: Solo ADMINISTRADOR)
const createProducto = async (req, res) => {
  const { codigo, nombre, categoria, stock, stock_minimo } = req.body;
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

  if (!codigo || !nombre || stock === undefined || stock_minimo === undefined) {
    return res.status(400).json({ error: 'Código, nombre, stock y stock_minimo son obligatorios.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO productos (codigo, nombre, categoria, stock, stock_minimo) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [codigo.trim(), nombre.trim(), categoria || 'General', parseInt(stock), parseInt(stock_minimo)]
    );

    const nuevoProducto = result.rows[0];

    // Auditar creación en bitácora
    await pool.query(
      `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'PRODUCTO_CREADO',
        `Producto creado: [${nuevoProducto.codigo}] ${nuevoProducto.nombre} (Stock inicial: ${nuevoProducto.stock})`,
        'INFO',
        ip,
        req.user.userId
      ]
    );

    return res.status(201).json({
      mensaje: 'Producto registrado exitosamente.',
      producto: nuevoProducto
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código de producto ya existe.' });
    }
    console.error('Error al crear producto:', err);
    return res.status(500).json({ error: 'Error interno al registrar el producto.' });
  }
};

// 3. Actualizar stock o datos de producto (Escritura: Solo ADMINISTRADOR)
const updateProducto = async (req, res) => {
  const { id } = req.params;
  const { nombre, categoria, stock, stock_minimo } = req.body;
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

  try {
    const result = await pool.query(
      `UPDATE productos 
       SET nombre = COALESCE($1, nombre),
           categoria = COALESCE($2, categoria),
           stock = COALESCE($3, stock),
           stock_minimo = COALESCE($4, stock_minimo)
       WHERE id = $5
       RETURNING *`,
      [nombre, categoria, stock !== undefined ? parseInt(stock) : null, stock_minimo !== undefined ? parseInt(stock_minimo) : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    const productoActualizado = result.rows[0];

    // Auditar modificación en bitácora
    await pool.query(
      `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'PRODUCTO_ACTUALIZADO',
        `Producto actualizado ID ${id}: [${productoActualizado.codigo}] Nuevo stock: ${productoActualizado.stock}`,
        'INFO',
        ip,
        req.user.userId
      ]
    );

    return res.json({
      mensaje: 'Producto actualizado correctamente.',
      producto: productoActualizado
    });
  } catch (err) {
    console.error('Error al actualizar producto:', err);
    return res.status(500).json({ error: 'Error interno al actualizar el producto.' });
  }
};

// 4. Eliminar producto (Escritura crítica: Solo ADMINISTRADOR)
const deleteProducto = async (req, res) => {
  const { id } = req.params;
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

  try {
    const result = await pool.query('DELETE FROM productos WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    const eliminado = result.rows[0];

    // Auditar eliminación en bitácora con severidad WARNING
    await pool.query(
      `INSERT INTO bitacora_eventos (tipo_evento, descripcion, nivel_severidad, ip_origen, usuario_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'PRODUCTO_ELIMINADO',
        `Producto eliminado del catálogo: [${eliminado.codigo}] ${eliminado.nombre}`,
        'WARNING',
        ip,
        req.user.userId
      ]
    );

    return res.json({ mensaje: 'Producto eliminado del inventario.' });
  } catch (err) {
    console.error('Error al eliminar producto:', err);
    return res.status(500).json({ error: 'Error interno al eliminar el producto.' });
  }
};

module.exports = {
  getProductos,
  createProducto,
  updateProducto,
  deleteProducto
};