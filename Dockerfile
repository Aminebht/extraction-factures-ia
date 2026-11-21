# Pipeline + interface dans un seul conteneur : au démarrage, traite les factures puis sert l'interface.
#   docker compose up --build        → http://localhost:5173
FROM node:24-slim

WORKDIR /app

# Dépendances d'abord (couche mise en cache tant que les package.json ne changent pas).
COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/web/package.json packages/web/
COPY eval/package.json eval/
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 5173

# La clé API n'est jamais dans l'image : elle arrive au lancement par env_file (.env).
# --host 0.0.0.0 rend le serveur de l'interface accessible depuis l'hôte.
CMD ["sh", "-c", "npm run pipeline && npm run dev -w @juwa/web -- --host 0.0.0.0"]
