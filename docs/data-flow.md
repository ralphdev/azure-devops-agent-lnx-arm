# Flujos de datos detallados

## Secuencia completa: job encolado → agente EC2 activo

```
Azure DevOps          API Gateway         Lambda               DynamoDB        EC2           Secrets Mgr
     │                    │           generateAgents               │              │               │
     │                    │                  │                     │              │               │
     │──Service Hook────►│                  │                     │              │               │
     │  (build.queued)   │──POST /trigger──►│                     │              │               │
     │                    │                  │──getAzureToken()───────────────────────────────────►│
     │                    │                  │◄──── PAT ─────────────────────────────────────────│
     │                    │                  │                     │              │               │
     │                    │                  │──GET jobrequests───►│(Azure API)   │               │
     │◄──── jobs[] ───────────────────────-─│                     │              │               │
     │                    │                  │                     │              │               │
     │                    │                  │ (filtrar pendientes)│              │               │
     │                    │                  │                     │              │               │
     │                    │                  │──GetItem ──────────►│              │               │
     │                    │                  │◄── jobsRequested[] ─│              │               │
     │                    │                  │                     │              │               │
     │                    │                  │ (job no está en caché)              │               │
     │                    │                  │                     │              │               │
     │                    │                  │──GET agents ───────►│(Azure API)   │               │
     │◄──── agents[] ─────────────────────-─│                     │              │               │
     │                    │                  │                     │              │               │
     │                    │                  │ (no hay agentes disponibles)        │               │
     │                    │                  │                     │              │               │
     │                    │                  │──DescribeInstances──────────────────►│              │
     │                    │                  │◄──── instances[] ──────────────────-│              │
     │                    │                  │                     │              │               │
     │                    │                  │ (bajo límite MAX_EC2_INSTANCES)      │               │
     │                    │                  │                     │              │               │
     │                    │                  │──RunInstances ──────────────────────►│              │
     │                    │                  │◄──── instanceId ───────────────────-│              │
     │                    │                  │                     │              │               │
     │                    │                  │──PutItem (jobId) ──►│              │               │
     │                    │                  │◄──── OK ────────────│              │               │
     │                    │                  │                     │              │               │
     │                    │◄── 200 OK ───────│                     │              │               │
     │                    │                  │                     │              │               │
     │                    │     (3-5 minutos después — EC2 arrancando)             │               │
     │                    │                  │                     │              │               │
     │                    │                  │                    EC2 UserData ejecuta:            │
     │                    │                  │                    - instala agente Azure           │
     │                    │                  │                    - obtiene PAT ────────────────►│
     │◄─────────────────────────────────────────────────────────EC2 registra agente               │
     │  agent online                         │                     │              │               │
     │  name = instanceId                    │                     │              │               │
```

---

## Secuencia: terminación de agente expirado

```
EventBridge (30 min)    Lambda                  Azure DevOps         EC2
       │            terminateAgents                   │               │
       │                   │                          │               │
       │──schedule ───────►│                          │               │
       │                   │──GET agents (all props)─►│               │
       │                   │◄──── agents[] ───────────│               │
       │                   │                          │               │
       │                   │ calcular expirados...     │               │
       │                   │ (finishTime/createdOn + DELETE_AGENT_INTERVAL)
       │                   │                          │               │
       │                   │──DELETE agent/{id} ──────►│              │
       │                   │◄──── 200 ────────────────│               │
       │                   │                          │               │
       │                   │──DescribeInstances ────────────────────►│
       │                   │◄──── instances[] ──────────────────────-│
       │                   │                          │               │
       │                   │──TerminateInstances ───────────────────►│
       │                   │◄──── OK ───────────────────────────────-│
       │                   │                          │               │
       │                   │ (actualizar dummy)        │               │
       │                   │──PUT agent/{dummyId} ────►│               │
       │                   │  (systemCapabilities)     │               │
       │                   │◄──── 200 ────────────────│               │
```

---

## Secuencia: limpieza de EC2 huérfanos

```
EventBridge (60 min)    Lambda                  Azure DevOps         EC2
       │            cleanUpAgents                    │               │
       │                   │                          │               │
       │──schedule ───────►│                          │               │
       │                   │──GET agents (minimal) ──►│               │
       │                   │◄──── agents[] ───────────│               │
       │                   │                          │               │
       │                   │──DescribeInstances ────────────────────►│
       │                   │◄──── instances[] ──────────────────────-│
       │                   │                          │               │
       │                   │ para cada EC2 running:   │               │
       │                   │   - pasó CLEANUP_EC2_INTERVAL?           │
       │                   │   - instanceId en agents[]?              │
       │                   │   - agente offline?       │               │
       │                   │                          │               │
       │                   │──TerminateInstances ───────────────────►│
       │                   │  (solo huérfanos)         │               │
       │                   │◄──── OK ───────────────────────────────-│
```

---

## Estructura de datos clave

### Job request de Azure DevOps (GET /jobrequests)

```json
{
  "requestId": 12345,
  "queueTime": "2026-04-14T10:00:00Z",
  "assignTime": null,          ← null = job pendiente
  "receiveTime": null,
  "finishTime": null,
  "definition": { "id": 99, "name": "mi-pipeline" },
  "owner": { "id": "abc", "name": "Build" },
  "poolId": 123,
  "demands": ["Agent.OS -equals Linux"]
}
```

### Agente de Azure DevOps (GET /agents)

```json
{
  "id": 456,
  "name": "i-0abc1234def567890",   ← instanceId de EC2
  "status": "online",              ← "online" | "offline"
  "enabled": true,
  "createdOn": "2026-04-14T10:05:00Z",
  "assignedRequest": null,          ← null = disponible
  "lastCompletedRequest": {
    "requestId": 12344,
    "finishTime": "2026-04-14T10:45:00Z"
  },
  "pendingUpdate": null,
  "systemCapabilities": {
    "Agent.OS": "Linux",
    "Agent.OSArchitecture": "ARM64",
    "docker": "/usr/bin/docker"
  }
}
```

### Item DynamoDB (caché de jobs)

```json
{
  "conditions": { "S": "LnxArmJobs" },
  "jobsRequested": {
    "L": [
      { "S": "12345" },
      { "S": "12346" },
      { "S": "12347" }
    ]
  }
}
```

### Payload de Azure DevOps Service Hook (POST al webhook)

```json
{
  "subscriptionId": "guid",
  "notificationId": 1,
  "id": "guid",
  "eventType": "ms.vss-pipelines.run-state-changed-event",
  "publisherId": "pipelines",
  "resource": {
    "id": "abc-run-id",
    "run": {
      "id": 789,
      "name": "20260414.1",
      "state": "inProgress"
    },
    "stageName": "Build",
    "stageStateId": "inProgress"
  }
}
```

---

## Ciclo de vida de una instancia EC2

```
Estado EC2          Estado Azure Agent          Acción del sistema
─────────────────────────────────────────────────────────────────────
[pending]           (no existe aún)             generateAgents lo lanzó
     │
[running]           (instalando agente...)       UserData ejecutando
     │
[running]           [online]                    Agente registrado, listo
     │                  │
     │               job asignado               Pipeline ejecutando
     │                  │
     │               job completado             finishTime establecido
     │                  │
     │              [online] sin job            Esperando
     │                  │
     │              (> DELETE_AGENT_INTERVAL)   terminateAgents detecta
     │                  │
[shutting-down]     [deleted en Azure]          terminateAgents lo elimina
     │
[terminated]        —                           Fin del ciclo
```

```
Caso alternativo — EC2 huérfana (UserData falló):
─────────────────────────────────────────────────
[running]           (no existe en Azure)        cleanUpAgents espera CLEANUP_EC2_INTERVAL
     │
     │              (pasó el intervalo)          cleanUpAgents detecta huérfana
     │
[terminated]        —                           Fin del ciclo
```
