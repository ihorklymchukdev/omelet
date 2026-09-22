# The build stage runs on the builder's own platform: its output is static
# files, identical for every target architecture.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
COPY packages/ui/package.json packages/ui/
COPY apps/console/package.json apps/console/
RUN npm ci
COPY . .
RUN npm run typecheck && npm test && npm run build && npm run check-offline

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.inc /etc/nginx/security-headers.inc
COPY --from=build /web/apps/console/dist /usr/share/nginx/html
EXPOSE 8080
