const express = require('express');
const router = express.Router();
const authorize = require('../middlewares/RoleMiddleware');
const { getKpis, getLiveKpis } = require('../controllers/KpiController');
const pool = require('../../database/postgresPool');

// Snapshot guardado en PostgreSQL + Auditoría
router.get('/kpis', authorize(['ADMINISTRADOR']), getKpis);

// Lectura rápida en tiempo real (cada 2 segundos)
router.get('/kpis/live', authorize(['ADMINISTRADOR']), getLiveKpis);

// Bitácora de auditoría
router.get('/bitacora', authorize(['ADMINISTRADOR']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bitacora_eventos ORDER BY id DESC LIMIT 20'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error al consultar bitácora:', err);
    return res.status(500).json({ error: 'Error al consultar la bitácora.' });
  }
});

module.exports = router;