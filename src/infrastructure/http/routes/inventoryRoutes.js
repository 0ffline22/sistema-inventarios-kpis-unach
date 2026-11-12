const express = require('express');
const router = express.Router();
const authorize = require('../middlewares/RoleMiddleware');
const {
  getProductos,
  createProducto,
  updateProducto,
  deleteProducto
} = require('../controllers/ProductController');

// Consulta permitida para ambos roles autenticados
router.get('/productos', authorize(['ADMINISTRADOR', 'OPERADOR']), getProductos);

// Operaciones de escritura restringidas únicamente a ADMINISTRADOR
router.post('/productos', authorize(['ADMINISTRADOR']), createProducto);
router.put('/productos/:id', authorize(['ADMINISTRADOR']), updateProducto);
router.delete('/productos/:id', authorize(['ADMINISTRADOR']), deleteProducto);

module.exports = router;