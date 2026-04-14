# CHANGELOG

## [Unreleased] — 2026-04-14

### Correcciones

- **Rutas de importación corregidas en todos los módulos**: Los archivos
  TypeScript apuntaban a rutas inexistentes (`../util/`, `./apis/`).
  Ahora apuntan a las rutas reales del proyecto (`../utils/`, `./api/`).
  El proyecto no compilaba antes de este fix.

- **Imports duplicados eliminados**: `secrects-manager.ts` importaba
  `REGION` dos veces desde rutas distintas. Consolidado en una sola línea.

### Mejoras

- **Soporte para entorno local (LocalStack)**: Los clientes de EC2,
  DynamoDB y Secrets Manager ahora leen la variable `AWS_ENDPOINT_URL`.
  Si está definida, apuntan a LocalStack en lugar de AWS real, sin
  ningún cambio en la lógica de negocio.

- **TypeScript configurado para reconocer tipos de Node.js**: Se agregó
  `"types": ["node"]` en `tsconfig.json` para evitar falsos errores del
  IDE con `process.env`.

### Infraestructura / Laboratorio

- **`docker-compose.yml` añadido**: Levanta LocalStack 3.4 con los
  servicios EC2, DynamoDB y Secrets Manager en `localhost:4566`.

- **Script de inicialización automática (`localstack-init/01-setup.sh`)**:
  Crea la tabla DynamoDB `agents-monitor-lnx-arm`, inserta la fila
  inicial `LnxArmJobs` y registra un secreto de prueba en Secrets
  Manager al arrancar el contenedor.

- **`.env.local` añadido**: Variables de entorno preconfiguradas para
  desarrollo local con credenciales dummy de LocalStack.

- **Nuevos scripts en `package.json`**:
  - `localstack:up` — levanta el contenedor
  - `localstack:down` — detiene el contenedor
  - `localstack:status` — muestra el estado de salud de LocalStack
  - `localstack:dynamo:scan` — consulta la tabla DynamoDB local

- **`.gitignore` actualizado**: Se excluyeron `dist/`, `.env` y
  `.env.local` del repositorio.

---

## [1.0.0] — 2026-04-14

### Lanzamiento inicial

- **Escalador automático de agentes EC2 Linux ARM64**: Sistema serverless
  que crea y destruye instancias EC2 dinámicamente según la demanda del
  pool de agentes en Azure Pipelines.

- **Tres funciones Lambda independientes**:
  - `generateAgents` (cada 1 min): detecta jobs encolados y lanza EC2
  - `terminateAgents` (cada 30 min): termina agentes expirados
  - `cleanUpAgents` (cada 60 min): elimina EC2 que no se conectaron

- **Anti-duplicados con DynamoDB**: Caché de `requestId` para evitar
  lanzar múltiples instancias por el mismo job.

- **Agente dummy**: Mantiene un agente offline en el pool de Azure
  DevOps con las capabilities del último agente real, para que el
  scheduler pueda evaluar el pool sin agentes activos.

- **Autenticación segura**: PAT de Azure DevOps almacenado en AWS
  Secrets Manager, nunca en variables de entorno en texto plano.

- **CloudFormation para EC2 Launch Template**: `template/instancia.yml`
  provisiona el template ARM64 con UserData que instala Docker, AWS CLI
  y el agente de Azure Pipelines automáticamente.
