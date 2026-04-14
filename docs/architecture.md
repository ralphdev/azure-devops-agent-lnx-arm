# Arquitectura del Sistema — Azure DevOps Agent Scaler

## Descripción general

Sistema serverless en AWS que escala automáticamente agentes self-hosted de Azure DevOps
sobre instancias EC2 Linux ARM64 (Graviton). Las instancias se crean bajo demanda cuando
Azure Pipelines tiene jobs encolados y se destruyen cuando llevan un tiempo sin actividad.

---

## Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AZURE DEVOPS                                                               │
│                                                                             │
│   Pipeline Job Queue                    Agent Pool (linux-arm)              │
│   ┌──────────────────┐                  ┌─────────────────────────────┐    │
│   │ job-001 (queued) │                  │ dummy-agent     (offline)   │    │
│   │ job-002 (queued) │                  │ i-0abc123       (online) ←──┼──┐ │
│   │ job-003 (running)│                  │ i-0def456       (online) ←──┼──┤ │
│   └──────────────────┘                  └─────────────────────────────┘  │ │
│           │                                                               │ │
│           │ Service Hook (POST)            Azure DevOps REST API          │ │
│           │ build.queued                   GET /pools/{id}/agents         │ │
└───────────┼───────────────────────────────────────────────────────────────┼─┘
            │                                                               │
            ▼                                                               │
┌───────────────────────────────────────────────────────────────────────────┼─┐
│  AWS                                              registers as agent      │  │
│                                                                           │  │
│  API Gateway                                                              │  │
│  POST /trigger ──► Lambda: webhookTrigger ──────────────────────────┐    │  │
│                                                                      │    │  │
│  EventBridge (schedule)                                              │    │  │
│  rate(1 min) ────► Lambda: generateAgents ◄─────────────────────────┘    │  │
│                           │                                               │  │
│                           ├── DynamoDB (job cache anti-duplicados)        │  │
│                           │   Table: agents-monitor-lnx-arm               │  │
│                           │                                               │  │
│                           └── EC2: RunInstances ──────────────────────────┼──┘
│                               Launch Template: linux-arm-agent-dynamic-lt │
│                               Subnet: aleatoria de SUBNET_LIST_ID         │
│                                                                            │
│  rate(30 min) ───► Lambda: terminateAgents                                │
│                           │                                               │
│                           ├── Azure API: getAgents (con capabilities)     │
│                           ├── Azure API: deleteAgent (expirados)          │
│                           ├── EC2: TerminateInstances                     │
│                           └── Azure API: updateDummy (sync capabilities)  │
│                                                                            │
│  rate(60 min) ───► Lambda: cleanUpAgents                                  │
│                           │                                               │
│                           ├── Azure API: getAgents                        │
│                           └── EC2: TerminateInstances (huérfanos)         │
│                                                                            │
│  Secrets Manager                                                           │
│  secret: {token: "PAT"}  ◄── todas las Lambdas (via singleton)            │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Tres flujos principales

### Flujo 1: generateAgents (cada 1 min + webhook)

```
¿Hay jobs pendientes en Azure?
        │
       NO ──► Limpiar caché DynamoDB ──► FIN
        │
       SÍ
        │
        ▼
Para cada job pendiente:
  ¿Ya está el jobId en el caché DynamoDB?
          │
         SÍ ──► Saltar (ya se lanzó EC2 para este job)
          │
         NO
          │
          ▼
  ¿Hay agentes online disponibles sin asignación?
          │
         SÍ ──► Saltar (Azure asignará un agente existente)
          │
         NO
          │
          ▼
  ¿Instancias EC2 actuales < MAX_EC2_INSTANCES?
          │
         NO ──► Log "límite alcanzado" ──► Saltar
          │
         SÍ
          │
          ▼
  EC2 RunInstances (Launch Template, subnet aleatoria)
  DynamoDB PutItem (agregar jobId al caché)
```

### Flujo 2: terminateAgents (cada 30 min)

```
Azure getAgents (con assignedRequest + lastCompletedRequest + capabilities)
        │
        ▼
Calcular agentes expirados:
  - enabled=true, status=online
  - NO tiene job asignado actualmente
  - NO está en pendingUpdate
  - NO es dummy ni static ni linux-agent (agentes fijos)
  - Tiempo desde lastCompletedRequest > DELETE_AGENT_INTERVAL
    (o tiempo desde createdOn si nunca completó un job)
        │
        ▼
Si hay expirados:
  Azure deleteAgent (uno por uno)
  EC2 TerminateInstances (correlacionar por instanceId ↔ agent.name)
        │
        ▼
Actualizar dummy agent:
  Copiar systemCapabilities del último agente real al dummy
  (para que Azure evalúe correctamente el pool sin agentes activos)
```

### Flujo 3: cleanUpAgents (cada 60 min)

```
Azure getAgents (sin capabilities, sin requests)
EC2 DescribeInstances (todas con tag Name=AGENT_NAME + PoolId=POOL_ID)
        │
        ▼
Para cada EC2 en estado running:
  ¿Han pasado > CLEANUP_EC2_INTERVAL minutos desde el lanzamiento?
          │
         NO ──► Saltar (aún dentro del período de gracia)
          │
         SÍ
          │
          ▼
  ¿Existe un agente Azure con nombre que contiene el instanceId?
          │
         NO ──► Marcar como huérfano (EC2 no logró registrarse)
          │
         SÍ
          ▼
  ¿El agente está offline?
         SÍ ──► Marcar como huérfano (se registró pero cayó)
          │
         NO ──► Saltar (EC2 está activo y conectado)
        │
        ▼
EC2 TerminateInstances (todos los huérfanos)
```

---

## Mecanismo anti-duplicados (DynamoDB)

El problema que resuelve: si `generateAgents` corre dos veces seguidas (por ejemplo,
el schedule de 1 min + un webhook simultáneo), podría lanzar dos EC2 para el mismo job.

```
DynamoDB Table: agents-monitor-lnx-arm
  PK: conditions = "LnxArmJobs"
  Atributo: jobsRequested = ["requestId-1", "requestId-2", ...]
```

- **Antes de lanzar EC2**: verificar que `requestId` no está en la lista
- **Después de lanzar EC2**: agregar `requestId` a la lista
- **Si no hay jobs pendientes**: limpiar la lista completa (reset del ciclo)

---

## Agente dummy

Azure DevOps evalúa si un job puede correr en un pool verificando las `systemCapabilities`
de los agentes registrados. Si no hay agentes online, Azure no puede asignar el job.

El dummy agent es un agente offline permanente que:
1. Siempre está registrado en el pool
2. Tiene copiadas las capabilities del último agente real que estuvo activo
3. Permite a Azure evaluar si el job es compatible con el pool incluso con 0 agentes reales

---

## Identificación EC2 ↔ Azure Agent

El nombre del agente en Azure DevOps es el `instanceId` de EC2 (ej: `i-0abc1234`).
Esto permite correlacionar directamente:

```
Azure Agent: { name: "i-0abc1234", status: "online" }
EC2 Instance: { InstanceId: "i-0abc1234", State: "running" }
```

La correlación se hace buscando si `instanceId.includes(agent.name)` en `aws-ec2-agent.ts`.

---

## Seguridad

| Componente | Mecanismo |
|---|---|
| Azure PAT | AWS Secrets Manager (nunca en variables de entorno planas) |
| Llamadas a Azure API | HTTP Basic Auth con `base64(user:PAT)` |
| Webhook endpoint | Shared secret en query param `?secret=` |
| DynamoDB | Cifrado en reposo con KMS (clave dedicada, rotación automática) |
| Lambda → AWS | IAM Role con permisos mínimos (solo las acciones necesarias) |
| EC2 networking | Security Group con IPs de Azure DevOps allowlisted |

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20.x |
| Lenguaje | TypeScript 5.4 |
| Framework IaC | Serverless Framework 3.x |
| AWS SDK | aws-sdk v2 (EC2, DynamoDB, Secrets Manager) |
| HTTP Client | Axios 1.x con reintentos manuales |
| Compute | AWS Lambda (x86_64) |
| Agentes | EC2 ARM64 (Graviton3) |
| Cache | DynamoDB (on-demand) |
| Secretos | AWS Secrets Manager |
| Plantilla EC2 | CloudFormation Launch Template |
