const express = require('express');
const path = require('path');
const sqlInjectionGuard = require('./infrastructure/http/middlewares/SqlInjectionMiddleware');
const app = express();

// 1. Middlewares para procesar JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Firewall de Aplicación (Detección y Bloqueo de Inyección SQL)
app.use(sqlInjectionGuard);

// 3. Archivos estáticos y vistas EJS
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'infrastructure/http/views'));

// 4. Importación de Rutas
const authRoutes = require('./infrastructure/http/routes/authRoutes');
const adminRoutes = require('./infrastructure/http/routes/adminRoutes');
const inventoryRoutes = require('./infrastructure/http/routes/inventoryRoutes');

// 5. Registro de Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', inventoryRoutes);

app.get('/', (req, res) => {
  res.render('index', { title: 'Sistema de Inventarios UNACH' });
});

// 6. Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` Servidor ejecutándose en http://localhost:${PORT}`);
});
