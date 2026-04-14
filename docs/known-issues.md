# Issues conocidos y deuda técnica

Este documento registra los problemas identificados en el análisis del código actual,
ordenados por prioridad de impacto.

---

## Alta prioridad

### 1. Bug: conteo de EC2 no se actualiza dentro del loop

**Archivo**: `src/api/monitor.ts` — función `generateAgents()`, línea ~54

**Problema**:
```typescript
// currentEc2instances se obtiene UNA VEZ antes del loop
let currentEc2instances = await AWS.getEC2Instance();  // ← fuera del loop

for (let i = 0; i < pendingJobs.length; i++) {
    // ...
    if (currentEc2instances.length <= MAX_EC2_INSTANCES) {
        await AWS.createEC2Instance();
        // currentEc2instances NO se actualiza aquí
        // El siguiente job del mismo ciclo verá el mismo conteo viejo
    }
}
```

**Impacto**: Si hay 3 jobs pendientes y el límite es 2 EC2, pueden lanzarse 3 instancias
en lugar de 2 en un mismo ciclo de 1 minuto.

**Solución sugerida**:
```typescript
for (let i = 0; i < pendingJobs.length; i++) {
    let requestedJobs = await AWS.readRequestedJobs();
    let currentEc2instances = await AWS.getEC2Instance();  // ← dentro del loop
    // ...
}
```

---

### 2. Importación circular entre monitor.ts y azure-agents.ts

**Archivos**: `src/api/monitor.ts` ↔ `src/api/azure-agents.ts`

**Problema**:
- `azure-agents.ts` importa `waitFor` de `monitor.ts`
- `monitor.ts` importa funciones de `azure-agents.ts`

Esto es un ciclo de dependencias. Funciona en Node.js CommonJS pero es frágil y
dificulta el testing unitario.

**Solución**:
Mover `waitFor` a `src/utils/helpers.ts`:
```typescript
// src/utils/helpers.ts
export const waitFor = async (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms));
```

---

### 3. AWS SDK v2 (deprecated)

**Archivos**: `aws-ec2-agent.ts`, `secrects-manager.ts`

AWS deprecó el SDK v2. Soporte termina en 2025-09-25 para nuevas features.

**Impacto**: Sin nuevas features, posibles vulnerabilidades de seguridad sin parche,
mayor bundle size (tree-shaking no disponible en v2).

**Migración sugerida**:
```bash
npm uninstall aws-sdk
npm install @aws-sdk/client-ec2 @aws-sdk/client-dynamodb @aws-sdk/client-secrets-manager
```

```typescript
// Antes (v2)
import * as AWS from 'aws-sdk';
const ec2 = new AWS.EC2();

// Después (v3)
import { EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';
const ec2 = new EC2Client({ region: REGION });
await ec2.send(new RunInstancesCommand(params));
```

---

## Media prioridad

### 4. Reintentos HTTP duplicados en 8 lugares

**Archivos**: `monitor.ts`, `azure-agents.ts`

El patrón de retry está repetido manualmente en cada llamada:
```typescript
await axios.get(path, config).catch(async () => {
    await waitFor(2000);
    return axios.get(path, config).catch(async () => {
        await waitFor(3000);
        return axios.get(path, config).catch(async (error) => { throw error });
    });
});
```

**Solución**: Centralizar con `axios-retry`:
```bash
npm install axios-retry
```
```typescript
import axiosRetry from 'axios-retry';
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: axiosRetry.isNetworkOrIdempotentRequestError
});
```

---

### 5. Header `contentType` incorrecto

**Archivo**: `src/api/axiosConfigSingleton.ts`

```typescript
// Incorrecto — no es un header HTTP estándar
headers: { contentType: "application/json" }

// Correcto
headers: { 'Content-Type': "application/json" }
```

**Impacto**: Azure DevOps infiere el Content-Type del body automáticamente, por lo que
actualmente no causa errores. Pero es incorrecto y podría causar problemas si Azure
cambia su comportamiento.

---

### 6. AZURE_URL hardcodeada

**Archivo**: `src/utils/constants.ts`

```typescript
export const AZURE_URL: string = 'https://dev.azure.com/banistmo';
```

Debería ser una variable de entorno para:
- Reutilizar el sistema en otras organizaciones
- Testing más limpio (apuntar a un mock de Azure)

---

### 7. Logging no estructurado

**Todos los archivos**

Los `console.log` actuales generan strings no parseables:
```
=====> SUCCESS: EC2 Agent Requested for job: 12345
```

En CloudWatch Logs Insights es difícil hacer queries sobre esto. El formato JSON
permite filtrar y agregar métricas:
```typescript
// Recomendado
console.log(JSON.stringify({
    level: 'info',
    event: 'ec2_launched',
    jobId: '12345',
    instanceId: 'i-0abc123',
    timestamp: new Date().toISOString()
}));
```

---

### 8. `var` en lugar de `const` para los clientes AWS

**Archivo**: `src/api/aws-ec2-agent.ts`

```typescript
// Actual
export var ec2Client = new AWS.EC2({...});
export var dynamoDbClient = new AWS.DynamoDB();

// Recomendado
export const ec2Client = new AWS.EC2({...});
export const dynamoDbClient = new AWS.DynamoDB();
```

Se usó `var` para permitir reassignment en tests, pero la forma correcta es
exportar los clientes para mockearlos, no reassignarlos.

---

## Baja prioridad

### 9. Sin tests unitarios

`"test": "echo \"No Hay pruebas Unitarias\""` — el proyecto no tiene cobertura de tests.

Las funciones más críticas para testear:
- `getExpiredAgents` — lógica de negocio compleja con múltiples condiciones
- `getPendingJobs` — filtrado de jobs
- `generateAgents` — flujo principal
- `webhookTrigger` — validación de secret, manejo de errores

---

### 10. Typo en nombre de variables y archivos

| Actual | Correcto |
|---|---|
| `SECRECT_ID` | `SECRET_ID` |
| `LUNCH_TEMPLATE_NAME` | `LAUNCH_TEMPLATE_NAME` |
| `secrects-manager.ts` | `secrets-manager.ts` |
| `addRequetedJobs` | `addRequestedJobs` |
| `cleanRequetedJobs` | `cleanRequestedJobs` |

Cambiar ahora requiere actualizar `serverless.yml`, `.env.local` y la documentación.
Hacerlo en una sola PR para no fragmentar el historial.
