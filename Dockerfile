# Imagen base: Node 20 slim (sin Chromium - usamos CloudConvert para PDF)
FROM node:20-slim

# Skip Puppeteer Chromium download - usamos CloudConvert API
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiamos package.json y package-lock.json (si existe)
COPY package*.json ./

# Instalamos TODAS las dependencias (prod + dev, para poder compilar TypeScript)
RUN npm install

# Copiamos la config de TypeScript y el código fuente
COPY tsconfig.json ./
COPY src ./src

# Compilamos TypeScript → dist/
RUN npm run build

# Copiar templates y assets explícitamente (el script de npm puede fallar en Docker)
RUN cp -r src/templates dist/templates || true
RUN cp -r src/assets dist/assets || true

# Verificar que se copiaron correctamente
RUN ls -la dist/templates || echo "WARNING: templates directory not found"
RUN ls -la dist/assets || echo "WARNING: assets directory not found"

# Creamos carpeta de almacenamiento para contratos y firmas
RUN mkdir -p /app/storage

# Variables de entorno por defecto (Railway luego inyecta PORT real)
ENV NODE_ENV=production
ENV PORT=8080

# Comando de arranque del servidor
CMD ["node", "dist/server.js"]
