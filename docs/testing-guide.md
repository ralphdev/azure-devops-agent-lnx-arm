# Guía de Testing — Azure DevOps Agent Scaler

## Niveles de testing disponibles

```
Nivel 1: TypeScript compile check   → sin dependencias externas
Nivel 2: serverless-offline         → simula API Gateway + Lambda localmente
Nivel 3: LocalStack                 → emula DynamoDB, EC2, Secrets Manager
Nivel 4: Azure DevOps real          → prueba completa end-to-end
```

---

## Nivel 1 — Verificar que el proyecto compila

```bash
npm run build
```

Salida esperada: ningún error. Los archivos `dist/` se generan correctamente.

---

## Nivel 2 — Probar Lambdas con serverless-offline

`serverless-offline` simula API Gateway y Lambda localmente sin necesidad de AWS.

### Pre-requisitos

```bash
# 1. Copiar variables de entorno
cp .env.local .env

# 2. Compilar
npm run build
```

### Iniciar el servidor local

```bash
npm run deploy:local
# o directamente:
npx serverless offline start --stage local
```

Salida esperada:
```
┌────────────────────────────────────────────────────┐
│   POST | http://localhost:3000/local/trigger        │
└────────────────────────────────────────────────────┘
Server ready: http://localhost:3000
```

### Probar el endpoint webhook (linuxWebhookTrigger)

**Con curl — payload de Azure DevOps simulado:**

```bash
curl -X POST "http://localhost:3000/local/trigger?secret=mi-secreto-local-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "ms.vss-pipelines.run-state-changed-event",
    "resource": {
      "id": "abc-123",
      "run": {
        "id": 456,
        "name": "pipeline-test-run"
      }
    }
  }'
```

Respuesta esperada:
```json
{ "message": "Agent generation triggered", "eventType": "ms.vss-pipelines.run-state-changed-event", "resourceId": "abc-123" }
```

**Probar con secret incorrecto (debe retornar 401):**

```bash
curl -X POST "http://localhost:3000/local/trigger?secret=wrong" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta esperada:
```json
{ "message": "Unauthorized" }
```

**Probar sin body (debe funcionar sin crash):**

```bash
curl -X POST "http://localhost:3000/local/trigger?secret=mi-secreto-local-12345" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Invocar Lambdas scheduled directamente (sin API Gateway)

```bash
# Invocar generateAgents localmente
npx serverless invoke local --function linuxGenerateAgents --stage local

# Invocar terminateAgents localmente
npx serverless invoke local --function linuxTerminateAgents --stage local

# Invocar cleanUpAgents localmente
npx serverless invoke local --function linuxCleanUpAgents --stage local

# Invocar webhook con evento simulado
npx serverless invoke local --function linuxWebhookTrigger --stage local \
  --data '{
    "queryStringParameters": { "secret": "mi-secreto-local-12345" },
    "body": "{\"eventType\":\"build.queued\",\"resource\":{\"id\":\"test-123\"}}"
  }'
```

---

## Nivel 3 — Testing con LocalStack (DynamoDB + Secrets Manager reales locales)

LocalStack emula los servicios AWS para que el código se ejecute sin tocar AWS real.

### Arrancar LocalStack

```bash
npm run localstack:up
# Esperar ~20 segundos
npm run localstack:status
```

Salida esperada del status:
```json
{
  "services": {
    "dynamodb": "running",
    "ec2": "running",
    "secretsmanager": "running"
  }
}
```

### Verificar que los recursos se crearon

```bash
# Ver tabla DynamoDB
npm run localstack:dynamo:scan

# Ver el secreto creado
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws secretsmanager get-secret-value \
  --secret-id devops-azure-pat-test \
  --endpoint-url http://localhost:4566 \
  --region us-east-1
```

### Ejecutar serverless-offline apuntando a LocalStack

Con LocalStack corriendo y el `.env` configurado con `AWS_ENDPOINT_URL=http://localhost:4566`:

```bash
npm run build && npm run deploy:local
```

Ahora cuando el webhook recibe un POST, las llamadas a DynamoDB y Secrets Manager irán a LocalStack.

**Flujo completo de prueba:**

```bash
# 1. Verificar tabla vacía antes
npm run localstack:dynamo:scan

# 2. Disparar el webhook
curl -X POST "http://localhost:3000/local/trigger?secret=mi-secreto-local-12345" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"build.queued","resource":{"id":"job-999"}}'

# 3. Ver si se escribió el job en DynamoDB
npm run localstack:dynamo:scan
```

---

## Nivel 4 — Testing en AWS real (staging)

### Deploy a ambiente de staging

```bash
npm run build

npx serverless deploy \
  --stage staging \
  --region us-east-1 \
  --param="accountId=TU_ACCOUNT_ID" \
  --param="poolId=TU_POOL_ID" \
  --param="poolName=linux-arm-pool" \
  --param="secrectName=tu-secreto-azure" \
  --param="monitorTable=agents-monitor-lnx-arm-staging" \
  --param="maxec2instances=2" \
  --param="deleteagentinterval=900" \
  --param="cleanupec2interval=1200" \
  --param="agentsSubnet=subnet-xxxx" \
  --param="agentsname=linux-arm-agent-staging" \
  --param="lunchTemplateName=linux-arm-agent-dynamic-lt" \
  --param="webhookSecret=TU_SECRET_SEGURO" \
  --param="vpcId=vpc-xxxx" \
  --param="vpcLambda=vpc-xxxx" \
  --param="agentsRoleName=tu-rol-ec2"
```

### Obtener la URL del webhook después del deploy

```bash
npx serverless info --stage staging --region us-east-1
```

Buscar la línea:
```
POST - https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/staging/trigger
```

### Probar el endpoint en AWS

```bash
curl -X POST "https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/staging/trigger?secret=TU_SECRET_SEGURO" \
  -H "Content-Type: application/json" \
  -d '{"eventType":"build.queued","resource":{"id":"test-from-curl"}}'
```

### Ver los logs en CloudWatch

```bash
# Logs del webhook
npx serverless logs --function linuxWebhookTrigger --stage staging --tail

# Logs del generateAgents
npx serverless logs --function linuxGenerateAgents --stage staging --tail
```

---

## Configurar Azure DevOps Service Hook

Una vez que tienes la URL del endpoint en AWS:

1. Ir a **Azure DevOps** → tu proyecto → **Project Settings**
2. Ir a **Service hooks** → **+** (Crear nueva suscripción)
3. Seleccionar **Web Hooks**
4. Evento: **Run state changed** (o **Build queued** si aparece)
5. Filtros opcionales: pipeline específico, rama
6. URL: `https://TU_ENDPOINT.execute-api.us-east-1.amazonaws.com/staging/trigger?secret=TU_SECRET`
7. Método HTTP: POST
8. Content type: `application/json`
9. Hacer clic en **Test** — Azure DevOps enviará un payload de prueba
10. Verificar respuesta 200 OK

---

## Tabla de errores comunes

| Error | Causa probable | Solución |
|---|---|---|
| `Cannot find module '../util/...'` | Path incorrecto | Verificar que los imports usan `../utils/` |
| `401 Unauthorized` en webhook | Secret incorrecto | Revisar `WEBHOOK_SECRET` en `.env` |
| `Error obtaining Azure PAT` | Secrets Manager no accesible | Verificar que LocalStack corre o que el secreto existe en AWS |
| `ValidationException` en DynamoDB | Tabla no existe | Correr `localstack-init/01-setup.sh` manualmente |
| Lambda timeout | Azure DevOps API lenta | El timeout es 60s, suficiente para 3 reintentos |
| `serverless offline` no arranca | Plugin no instalado | `npm install --save-dev serverless-offline --legacy-peer-deps` |
