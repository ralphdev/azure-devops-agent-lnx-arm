# Documentación técnica — Azure DevOps Agent Scaler

## Índice de documentación

| Documento | Descripción |
|---|---|
| [architecture.md](./architecture.md) | Arquitectura del sistema, componentes, flujos principales y seguridad |
| [modules.md](./modules.md) | Referencia detallada de cada módulo TypeScript en `src/` |
| [data-flow.md](./data-flow.md) | Diagramas de secuencia, estructura de datos y ciclo de vida EC2 |
| [known-issues.md](./known-issues.md) | Issues conocidos, bugs y deuda técnica priorizados |
| [testing-guide.md](./testing-guide.md) | Guía de testing en 4 niveles: compile, offline, LocalStack, AWS real |

---

## Mapa del código fuente

```
src/
├── handler.ts                    ← Entry points Lambda (generateAgents, terminateAgents,
│                                   cleanUpAgents, webhookTrigger)
├── utils/
│   └── constants.ts              ← Todas las variables de entorno tipadas con defaults
└── api/
    ├── monitor.ts                ← Orquestación de los 3 flujos principales
    ├── azure-agents.ts           ← API REST Azure DevOps (agentes, pool, dummy)
    ├── aws-ec2-agent.ts          ← AWS EC2 (lanzar/terminar) + DynamoDB (caché jobs)
    ├── axiosConfigSingleton.ts   ← Singleton de autenticación Basic Auth para Azure
    └── secrects-manager.ts       ← Obtiene PAT de Azure desde AWS Secrets Manager
```

---

## Inicio rápido para nuevo desarrollador

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno locales
cp .env.local .env

# 3. Compilar TypeScript
npm run build

# 4. Levantar LocalStack (Docker requerido)
npm run localstack:up

# 5. Iniciar servidor local
npm run deploy:local

# 6. Probar el webhook
curl -X POST "http://localhost:3000/local/trigger?secret=mi-secreto-local-12345" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"build.queued","resource":{"id":"test-job-1"}}'
```

---

## Decisiones de diseño importantes

| Decisión | Razón |
|---|---|
| EC2 ARM64 (Graviton) | ~40% más barato que x86 equivalente |
| Scale-to-zero (no agentes permanentes) | Costo $0 cuando no hay pipelines activos |
| DynamoDB como caché de jobs | Evitar lanzar 2 EC2 para el mismo job |
| Agente dummy siempre en el pool | Azure necesita evaluar capabilities aunque no haya agentes online |
| Nombre agente = instanceId EC2 | Correlación directa sin tabla de mapeo adicional |
| PAT en Secrets Manager | Seguridad: nunca en variables de entorno del Lambda |
| Subnet aleatoria | Distribución entre AZs para alta disponibilidad |
