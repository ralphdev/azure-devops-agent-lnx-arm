# Referencia de Módulos — Código fuente src/

## Índice

- [handler.ts](#handlertss) — Entry points de las Lambdas
- [utils/constants.ts](#utilsconstantsts) — Variables de entorno
- [api/axiosConfigSingleton.ts](#apiaXiosConfigSingletonts) — Autenticación HTTP
- [api/secrects-manager.ts](#apisecrects-managerts) — AWS Secrets Manager
- [api/azure-agents.ts](#apiazure-agentsts) — API REST de Azure DevOps
- [api/aws-ec2-agent.ts](#apiaws-ec2-agentts) — EC2 y DynamoDB
- [api/monitor.ts](#apimonitorts) — Orquestación principal

---

## handler.ts

**Rol**: Entry points de las cuatro funciones Lambda. Es la capa más delgada del sistema —
solo delega a `monitor.ts` o maneja la request HTTP del webhook.

```typescript
import * as monitor from './api/monitor';
import { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { WEBHOOK_SECRET } from './utils/constants';
```

### Funciones exportadas

#### `generateAgents: Handler`
Lambda schedule (cada 1 min). Delega directamente a `monitor.generateAgents()`.
No maneja errores aquí — los errores se propagan y Lambda los registra en CloudWatch.

#### `terminateAgents: Handler`
Lambda schedule (cada 30 min). Delega a `monitor.terminateAgents()`.

#### `cleanUpAgents: Handler`
Lambda schedule (cada 60 min). Delega a `monitor.cleanUpAgents()`.

#### `webhookTrigger: Handler<APIGatewayProxyEvent, APIGatewayProxyResult>`
Lambda HTTP (POST /trigger). Única función que devuelve una respuesta HTTP estructurada.

**Flujo interno:**
1. Lee `event.queryStringParameters?.secret`
2. Compara con `WEBHOOK_SECRET` — si no coincide, retorna `401`
3. Parsea `event.body` como JSON para extraer `eventType` y `resourceId` (solo para logging)
4. Llama `monitor.generateAgents()`
5. Retorna `200` con el eventType confirmado
6. En caso de error, retorna `500`

**Por qué el secret en query param y no en header:**
Azure DevOps Service Hooks permite configurar la URL completa. Es la forma más simple
de autenticación sin necesidad de un custom authorizer en API Gateway.

---

## utils/constants.ts

**Rol**: Centraliza todas las variables de entorno con sus valores por defecto.
Exporta constantes tipadas que el resto del código importa directamente.

```typescript
export const AZURE_URL: string = 'https://dev.azure.com/banistmo';
```

**Nota importante**: `AZURE_URL` está hardcodeada. En un ambiente multi-tenant o
multi-organización habría que moverla a variable de entorno.

### Variables numéricas

```typescript
export const MAX_EC2_INSTANCES: number =
  (process.env.MAX_EC2_INSTANCES == undefined) ? 16 : Number(process.env.MAX_EC2_INSTANCES);
```

El patrón `== undefined ? default : Number(env)` evita que el string vacío `""` se convierta
en `0`, lo que bajaría el límite a 0 instancias accidentalmente.

### Todas las constantes

| Constante | Env Var | Default | Descripción |
|---|---|---|---|
| `AZURE_URL` | — | `'https://dev.azure.com/banistmo'` | URL base de la organización Azure |
| `SECRECT_ID` | `SECRECT_ID` | `''` | Nombre del secreto en Secrets Manager |
| `USER_OWNER` | `USER_OWNER` | `''` | Usuario para Basic Auth de Azure |
| `REGION` | `region` | `'us-east-1'` | Región AWS (nota: env var en minúsculas) |
| `MAX_EC2_INSTANCES` | `MAX_EC2_INSTANCES` | `16` | Límite máximo de EC2 simultáneas |
| `DELETE_AGENT_INTERVAL` | `DELETE_AGENT_INTERVAL` | `900` | Segundos de inactividad para expirar |
| `CLEANUP_EC2_INTERVAL` | `CLEANUP_EC2_INTERVAL` | `1200` | Segundos para limpiar EC2 sin conectar |
| `POOL_ID` | `POOL_ID` | `''` | ID numérico del pool de Azure DevOps |
| `SG_ID` | `SG_ID` | `''` | ID del Security Group para las EC2 |
| `SUBNET_LIST_ID` | `SUBNET_LIST_ID` | `''` | Lista de subnets separadas por coma |
| `LUNCH_TEMPLATE_NAME` | `LUNCH_TEMPLATE_NAME` | `''` | Nombre del EC2 Launch Template |
| `AGENT_NAME` | `AGENT_NAME` | `''` | Prefijo para identificar agentes por tag |
| `DUMMY_AGENT_NAME` | `DUMMY_AGENT_NAME` | `'dummy'` | Nombre del agente dummy |
| `FAILED_MESSAGE` | `FAILED_MESSAGE` | `'=====> FAILED:'` | Prefijo para logs de error |
| `SUCCESS_MESSAGE` | `SUCCESS_MESSAGE` | `'=====> SUCCESS:'` | Prefijo para logs de éxito |
| `MAX_EC2_MESSAGE` | `MAX_EC2_MESSAGE` | `'===> MAX_EC2_INSTANCES_REACHED:'` | Prefijo para límite alcanzado |
| `MONITOR_TABLE` | `MONITOR_TABLE` | `'agents-monitor-win'` | Nombre de la tabla DynamoDB |
| `WEBHOOK_SECRET` | `WEBHOOK_SECRET` | `''` | Secret para validar webhooks de Azure |

**Atención**: Si `WEBHOOK_SECRET` es string vacío `''`, la validación del webhook se
omite (cualquier request pasa). Siempre configurar en producción.

---

## api/axiosConfigSingleton.ts

**Rol**: Singleton que encapsula la autenticación Basic Auth para todas las llamadas
a la API REST de Azure DevOps.

### Patrón Singleton async

```typescript
export class AxiosConfig {
    private static instance: AxiosConfig;  // instancia única de clase
    private authToken: string;             // token codificado en base64

    private constructor(token: string) {
        const buffer = Buffer.from(USER_OWNER + ':' + token);
        this.authToken = buffer.toString('base64');
    }

    static async getInstance(): Promise<AxiosConfig> {
        if (!AxiosConfig.instance) {
            // Solo llama a Secrets Manager la PRIMERA vez
            AxiosConfig.instance = new AxiosConfig(await getAzureToken());
        }
        return AxiosConfig.instance;
    }
}
```

**Por qué Singleton en Lambda:**
En Lambda, el contenedor puede reutilizarse entre invocaciones (warm start). El singleton
persiste mientras el contenedor esté vivo, evitando una llamada a Secrets Manager en
cada invocación. En cold start, se obtiene el token una vez por ciclo de vida del contenedor.

**Codificación del token:**
```
base64("user:PAT") → "dXNlcjpQQVQ="
Authorization: Basic dXNlcjpQQVQ=
```

### `getConfig()`

Retorna el objeto de configuración de Axios:
```typescript
{
  headers: {
    Authorization: `Basic ${this.authToken}`,
    contentType: "application/json"
  }
}
```

**Nota**: `contentType` debería ser `Content-Type` (capital C). El header actual no
funciona como content-type real — Azure DevOps infiere JSON del payload.

---

## api/secrects-manager.ts

**Rol**: Única función que interactúa con AWS Secrets Manager para obtener el PAT de Azure.

```typescript
export async function getAzureToken(): Promise<string>
```

### Flujo

1. Crea un cliente `SecretsManager` con la región de `REGION`
2. Si `AWS_ENDPOINT_URL` está definido (LocalStack), lo usa como endpoint
3. Llama `getSecretValue({ SecretId: SECRECT_ID })`
4. Parsea el JSON del secreto: `JSON.parse(response.SecretString!)`
5. Retorna `secret.token`

**Estructura esperada del secreto en AWS:**
```json
{ "token": "tu-azure-devops-PAT-aqui" }
```

**Manejo de errores**: Si falla, lanza `Error("Error when obtaining Azure PAT ${SECRECT_ID}")`.
Este error se propaga hasta el handler y Lambda lo registra en CloudWatch.

---

## api/azure-agents.ts

**Rol**: Todas las operaciones contra la API REST v6.0 de Azure DevOps para gestionar
agentes del pool.

### Inicialización

```typescript
const axiosInstance = AxiosConfig.getInstance()
```

**Importante**: Esta línea ejecuta al cargar el módulo, no al llamar la función.
`getInstance()` es async, pero se llama sin `await` aquí. El resultado es una Promise
que se resuelve cuando se necesita el token.

---

### `getAgents(assignedRequest, lastCompletedRequest, capabilities)`

**Endpoint**: `GET /_apis/distributedtask/pools/{poolId}/agents`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `assignedRequest` | boolean | Incluir el job actualmente asignado al agente |
| `lastCompletedRequest` | boolean | Incluir el último job completado (para calcular expiración) |
| `capabilities` | boolean | Incluir systemCapabilities (caro, solo cuando se necesita) |

**Reintentos manuales**: La función usa el patrón catch-waitFor-retry anidado:
```
Intento 1 → falla → esperar 2s → Intento 2 → falla → esperar 3s → Intento 3 → falla → throw
```
Este patrón se repite en todas las funciones de este módulo (candidato a refactor con `axios-retry`).

**Retorna**: Array de objetos agente con la estructura de Azure DevOps.

---

### `getAvailableAgents()`

Filtra el resultado de `getAgents(true, false, false)` para obtener solo agentes que pueden
recibir un nuevo job ahora mismo.

**Criterios de disponibilidad:**
- `enabled === true` — el agente no está deshabilitado manualmente
- `status.toLowerCase().includes('online')` — el agente está conectado
- `assignedRequest === undefined` — no tiene un job actualmente asignado

**Uso en generateAgents**: Si hay agentes disponibles, no se lanza una nueva EC2 —
Azure los asignará directamente.

---

### `getDummyAgent()`

Busca el agente cuyo nombre incluye `DUMMY_AGENT_NAME` ('dummy' por defecto).

**Retorna**: Array con un único elemento (el dummy) o vacío si no existe.

---

### `createDummyAgent()`

**Endpoint**: `POST /_apis/distributedtask/pools/{poolId}/agents`

Crea el agente dummy con estos valores fijos:
```typescript
{
  maxParallelism: 1,
  name: DUMMY_AGENT_NAME,
  version: "2.202.0",
  status: "offline"
}
```

**Nota**: Esta función existe pero no se llama automáticamente en el código actual.
Debe ejecutarse manualmente una vez al configurar el pool por primera vez.

---

### `updateDummyCapabilities(agents)`

Sincroniza las `systemCapabilities` del último agente real al dummy.

**Lógica:**
```typescript
let lastAgent = agents[agents.length - 1];  // último en el array
if (!lastAgent.name.includes(DUMMY_AGENT_NAME)) {
    let dummyAgent = await getDummyAgent()[0];
    dummyAgent.systemCapabilities = lastAgent.systemCapabilities;
    await replaceAgent(dummyAgent);  // PUT (replace completo, no PATCH)
}
```

**Por qué el último agente**: El array de Azure viene ordenado por ID (más reciente al final).
El último agente real tuvo las capabilities más actualizadas.

---

### `getExpiredAgents(agents, tiempoDeExpiracionSegundos)`

Identifica agentes que deben ser terminados.

**Un agente expira si cumple TODOS estos criterios:**
1. `!name.includes(DUMMY_AGENT_NAME)` — no es el dummy
2. `!name.includes("static")` — no es un agente fijo de larga duración
3. `!name.includes("linux-agent")` — no es otro agente fijo
4. `enabled === true`
5. `status === 'online'`
6. `assignedRequest === undefined` — sin job activo
7. `pendingUpdate === undefined` — sin actualización en curso
8. Si tiene `lastCompletedRequest`: tiempo desde `finishTime` > intervalo
9. Si NO tiene `lastCompletedRequest`: tiempo desde `createdOn` > intervalo

**Caso 9 explicado**: Un agente que arrancó pero nunca completó un job
(ej: se lanzó pero no había job compatibe) expira desde su `createdOn`.

---

### `deleteExpiredAgents(expiredAgents)`

Llama `deleteAgent()` en loop para cada agente expirado.

**Endpoint interno**: `DELETE /_apis/distributedtask/pools/{poolId}/agents/{agentId}`

---

### `getDifferenceInMinutes(date1, date2)`

```typescript
export function getDifferenceInMinutes(date1: Date, date2: Date): number {
    const diffInMs = Math.abs(date1.getTime() - date2.getTime());
    return diffInMs / (1000 * 60);
}
```

Función utilitaria pura. Usa `Math.abs` para que el orden de las fechas no importe.

---

## api/aws-ec2-agent.ts

**Rol**: Todas las operaciones contra AWS (EC2 y DynamoDB).

### Clientes AWS

```typescript
const localEndpoint = process.env.AWS_ENDPOINT_URL;

export var ec2Client = new AWS.EC2({
    apiVersion: '2016-11-15',
    ...(localEndpoint && { endpoint: localEndpoint })
});

export var dynamoDbClient = new AWS.DynamoDB({
    ...(localEndpoint && { endpoint: localEndpoint })
});
```

Los clientes se exportan (`var`, no `const`) para facilitar el mocking en tests.
Si `AWS_ENDPOINT_URL` está definido (LocalStack), los clientes apuntan ahí.

---

### `createEC2Instance()`

**Lógica de subnet aleatoria:**
```typescript
let subnetlist: string[] = SUBNET_LIST_ID.split(',')
let subnetId = subnetlist[Math.floor(Math.random() * subnetlist.length)]
```
Distribuye las instancias entre subnets (distintas AZs) para alta disponibilidad.

**Parámetros de lanzamiento:**
```typescript
{
    MaxCount: 1,
    MinCount: 1,
    LaunchTemplate: { LaunchTemplateName: LUNCH_TEMPLATE_NAME },
    NetworkInterfaces: [{
        AssociatePublicIpAddress: true,
        DeleteOnTermination: true,
        DeviceIndex: 0,
        Groups: [SG_ID],
        SubnetId: subnetId
    }]
}
```

**Por qué AssociatePublicIpAddress=true**: El agente necesita salida a internet para
conectarse a Azure DevOps. En una arquitectura más segura se usaría NAT Gateway.

---

### `getEC2Instance()`

Obtiene todas las EC2 del pool activo.

**Filtro por tags:**
```typescript
tagsList.find(tag => tag.Value?.includes(AGENT_NAME) && tag.Key?.includes('Name')) &&
tagsList.find(tag => tag.Value?.includes(POOL_ID) && tag.Key?.includes('PoolId')) &&
(stateName.includes('running') || stateName.includes('pending'))
```

`pending` se incluye porque una EC2 recién lanzada aún no está `running` pero ya
cuenta contra el límite `MAX_EC2_INSTANCES`.

---

### `disableExpiredEc2Agents(expiredAgents, instances)`

Correlaciona agentes Azure expirados con instancias EC2 para terminarlas.

```typescript
// La correlación: el nombre del agente en Azure ES el instanceId de EC2
if (instanceId?.includes(expiredAgent.name)) {
    ec2ToDelete.push(instanceId);
}
```

Llama `ec2Client.terminateInstances({ InstanceIds: ec2ToDelete })`.

---

### Cache DynamoDB — Tres funciones

La tabla tiene una sola fila con `PK = "LnxArmJobs"` y un atributo `jobsRequested: List<String>`.

#### `readRequestedJobs() → string[]`
Lee la lista de `requestId` ya procesados. Si el item no existe (tabla vacía),
retorna array vacío.

#### `addRequetedJobs(newJobId, jobsRequested)`
Construye la lista nueva = lista existente + newJobId y hace PutItem (sobrescribe).

#### `cleanRequetedJobs()`
Hace PutItem con lista vacía. Se llama cuando no hay jobs pendientes en Azure,
lo que indica que todos los jobs del ciclo anterior terminaron.

---

### `getEC2InstanceNotConnAzure(agents, tiempoDeExpiracionSegundos)`

Detecta instancias EC2 que arrancaron pero no lograron registrarse como agentes.

**Criterios para marcar como huérfano:**
1. Tiene los tags correctos (Name + PoolId)
2. Estado `running`
3. Tiempo desde lanzamiento > `CLEANUP_EC2_INTERVAL`
4. No existe ningún agente Azure cuyo nombre incluya el instanceId
   **ó** existe pero su status es `offline`

**Nota sobre `UsageOperationUpdateTime`**: Se usa para calcular el tiempo desde el
lanzamiento. En rigor, `LaunchTime` sería más preciso, pero `UsageOperationUpdateTime`
funciona como aproximación.

---

## api/monitor.ts

**Rol**: Capa de orquestación. Combina las operaciones de Azure y AWS para implementar
los tres flujos de negocio.

### Imports circulares (¡atención!)

```typescript
// monitor.ts importa azure-agents.ts
// azure-agents.ts importa monitor.ts (para la función waitFor)
```

Este ciclo funciona en Node.js por cómo resuelve los módulos CommonJS (lazy binding),
pero es un code smell. Lo correcto sería mover `waitFor` a `utils/`.

---

### `getJobs()`

**Endpoint**: `GET /_apis/distributedtask/pools/{poolId}/jobrequests`

Retorna **todos** los jobs del pool (no solo los pendientes). El filtrado se hace en
`getPendingJobs()`.

Usa el mismo patrón de reintentos manuales (2s → 3s → throw).

---

### `getPendingJobs()`

Filtra el resultado de `getJobs()` para obtener solo los no asignados:

```typescript
if (!job.assignTime) {
    pendingJobs.push(job);
}
```

`assignTime` se establece cuando Azure asigna el job a un agente. Si es `undefined`,
el job aún no tiene agente.

---

### `generateAgents()`

El flujo más complejo. Ver diagrama en `architecture.md`.

**Punto clave — orden de verificaciones:**
```typescript
// 1. ¿El job ya está en caché? (anti-duplicado)
if (!requestedJobs.includes(jobId)) {

    // 2. ¿Hay agentes disponibles? (evitar lanzar EC2 innecesaria)
    let readyAgents = await azureAgent.getAvailableAgents();

    if (!(readyAgents.length > 0)) {

        // 3. ¿Estamos bajo el límite de EC2?
        if (currentEc2instances.length <= MAX_EC2_INSTANCES) {
            await AWS.createEC2Instance();
            await AWS.addRequetedJobs(jobId, requestedJobs);
        }
    }
}
```

**Bug potencial**: `currentEc2instances` se obtiene una vez fuera del loop sobre
`pendingJobs`. Si hay 3 jobs pendientes y se lanza el primero, los siguientes
no verán la instancia recién lanzada en el conteo. Esto puede llevar a lanzar
más instancias de lo esperado en un mismo ciclo.

---

### `terminateAgents()`

```typescript
let agents = await azureAgent.getAgents(true, true, true);  // TODAS las props
let expiredAgents = await azureAgent.getExpiredAgents(agents, DELETE_AGENT_INTERVAL);
await azureAgent.updateDummyCapabilities(agents);  // siempre actualizar dummy
if (expiredAgents.length > 0) {
    await azureAgent.deleteExpiredAgents(expiredAgents);
    let currentEc2instances = await AWS.getEC2Instance();
    await AWS.disableExpiredEc2Agents(expiredAgents, currentEc2instances);
}
```

**Nota**: `updateDummyCapabilities` corre aunque no haya expirados. Esto asegura
que el dummy siempre tenga capabilities actualizadas.

---

### `cleanUpAgents()`

```typescript
let agents = await azureAgent.getAgents(false, false, false);  // mínimas props
let ec2InstanceNotConnected = await AWS.getEC2InstanceNotConnAzure(agents, CLEANUP_EC2_INTERVAL);
if (ec2InstanceNotConnected.length > 0) {
    await AWS.deleteEc2Instances(ec2InstanceNotConnected);
}
```

Solo pide las propiedades mínimas de los agentes (sin requests ni capabilities) porque
solo necesita el nombre para correlacionar con el instanceId.

---

### `waitFor(timeInMilliseconds)`

```typescript
export const waitFor = async (timeInMilliseconds: number) => {
    await new Promise(f => setTimeout(f, timeInMilliseconds));
}
```

Sleep async simple. Se usa en los reintentos de las llamadas a Azure API.
Está en `monitor.ts` pero `azure-agents.ts` lo importa de aquí (causa el ciclo).
