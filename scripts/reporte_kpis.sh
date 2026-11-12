#!/bin/bash
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /var/www/inventario-unach || exit 1
/usr/bin/node src/infrastructure/scripts/alertMonitor.js --reporte >> /var/log/unach_reportes.log 2>&1
