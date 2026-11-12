const express = require('express');
const path = require('path');
const app = express();

// 1. Middlewares para procesar JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Archivos estáticos y vistas EJS
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'infrastructure/http/views'));

// 3. Importación de Rutas (ajustadas desde la ubicación interna de src)
const authRoutes = require('./infrastructure/http/routes/authRoutes');
const adminRoutes = require('./infrastructure/http/routes/adminRoutes');
const inventoryRoutes = require('./infrastructure/http/routes/inventoryRoutes');

// 4. Registro de Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', inventoryRoutes);

app.get('/', (req, res) => {
  res.render('index', { title: 'Sistema de Inventarios UNACH' });
});

// 5. Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});