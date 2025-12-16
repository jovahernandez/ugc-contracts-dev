# Imagen base: Node con npm incluido
FROM node:20-alpine

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

# Creamos carpeta de almacenamiento para contratos y firmas
RUN mkdir -p /app/storage

# Variables de entorno por defecto (Railway luego inyecta PORT real)
ENV NODE_ENV=production
ENV PORT=3000

# Comando de arranque del servidor
CMD ["node", "dist/server.js"]
