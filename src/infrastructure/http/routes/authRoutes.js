const express = require('express');
const router = express.Router();
const { login } = require('../controllers/AuthController');

router.post('/login', login);

module.exports = router;