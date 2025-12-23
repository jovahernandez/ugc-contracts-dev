# Imagen base: Node con soporte para Puppeteer
FROM node:20-slim

# Instalar dependencias para Puppeteer/Chrome (por si se necesita)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configurar Puppeteer para usar Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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

# Copiamos los templates (DOCX, HTML) al dist porque TypeScript no los copia
RUN cp -r src/templates dist/templates

# Creamos carpeta de almacenamiento para contratos y firmas
RUN mkdir -p /app/storage

# Variables de entorno por defecto (Railway luego inyecta PORT real)
ENV NODE_ENV=production
ENV PORT=3000

# Comando de arranque del servidor
CMD ["node", "dist/server.js"]
